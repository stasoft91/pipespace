export type Waveform =
  | 'sine'
  | 'triangle'
  | 'square'
  | 'saw'
  | 'noise'
  | 'sampleHold'
  | 'expDecay'
  | 'invExpDecay'
  | 'exp2Decay'
  | 'invExp2Decay';

export type LfoConfig = {
  id: string;
  targetId: string;
  wave: Waveform;
  freqHz: number;
  useGlobalBpm: boolean;
  bpmCoefficient: number;
  amount: number;
  offset: number;
  phase: number;
  bipolar: boolean;
  smoothSeconds: number;
  enabled: boolean;
  startSeconds?: number;
  endSeconds?: number;
};

export type ModulationTarget = {
  id: string;
  label: string;
  group?: string;
  min?: number;
  max?: number;
  range?: number;
  getCurrent: () => number;
  apply: (value: number) => void;
};

type LfoRuntimeState = {
  lastValue: number;
  holdValue: number;
  lastHoldTime: number;
};

const TAU = Math.PI * 2;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const expDecayWave = (t: number, k: number) => 2 * Math.exp(-k * t) - 1;
const exp2DecayWave = (t: number, k: number) => 2 * Math.exp(-k * t * t) - 1;

export class ModulationManager {
  private targets = new Map<string, ModulationTarget>();
  private baseValues = new Map<string, number>();
  private lfos: LfoConfig[] = [];
  private lfoRuntime = new Map<string, LfoRuntimeState>();
  private bypass = false;
  private globalBpm = 120;
  private lastUpdateSeconds: number | null = null;

  registerTarget(target: ModulationTarget) {
    this.targets.set(target.id, target);
    if (!this.baseValues.has(target.id)) {
      this.baseValues.set(target.id, target.getCurrent());
    }
  }

  getTargets() {
    return Array.from(this.targets.values());
  }

  getTarget(id: string) {
    return this.targets.get(id);
  }

  setBypass(enabled: boolean) {
    this.bypass = enabled;
    if (enabled) {
      this.applyBaseValues();
    }
  }

  setGlobalBpm(bpm: number) {
    this.globalBpm = Math.max(0.0001, bpm);
  }

  getGlobalBpm() {
    return this.globalBpm;
  }

  isBypassed() {
    return this.bypass;
  }

  addLfo(partial: Partial<LfoConfig>): LfoConfig | null {
    const defaultTargetId = partial.targetId ?? this.getTargets()[0]?.id;
    if (!defaultTargetId) return null;
    const lfo: LfoConfig = {
      id: partial.id ?? `lfo-${Math.random().toString(16).slice(2)}`,
      targetId: defaultTargetId,
      wave: partial.wave ?? 'sine',
      freqHz: partial.freqHz ?? 0.2,
      useGlobalBpm: partial.useGlobalBpm ?? false,
      bpmCoefficient: partial.bpmCoefficient ?? 1,
      amount: partial.amount ?? 0.35,
      offset: partial.offset ?? 0,
      phase: partial.phase ?? 0,
      bipolar: partial.bipolar ?? true,
      smoothSeconds: partial.smoothSeconds ?? 0,
      enabled: partial.enabled ?? true,
      startSeconds: partial.startSeconds,
      endSeconds: partial.endSeconds,
    };
    this.lfos.push(lfo);
    return lfo;
  }

  removeLfo(id: string) {
    this.lfos = this.lfos.filter((l) => l.id !== id);
    this.lfoRuntime.delete(id);
  }

  getLfos() {
    return this.lfos;
  }

  setBaseValue(targetId: string, value: number) {
    if (!this.targets.has(targetId)) return;
    this.baseValues.set(targetId, value);
  }

  syncBaseFromTargets(targetIds?: string[]) {
    const ids = targetIds ?? Array.from(this.targets.keys());
    for (const id of ids) {
      const target = this.targets.get(id);
      if (target) {
        this.baseValues.set(id, target.getCurrent());
      }
    }
  }

  update(timeSeconds: number, dt: number) {
    if (this.targets.size === 0) return;
    if (this.lastUpdateSeconds !== null && timeSeconds < this.lastUpdateSeconds - 1e-6) {
      this.lfoRuntime.clear();
      this.lastUpdateSeconds = null;
    }
    this.lastUpdateSeconds = timeSeconds;
    const values = new Map<string, number>();

    for (const [id, target] of this.targets) {
      const base = this.baseValues.get(id);
      values.set(id, base ?? target.getCurrent());
    }

    if (!this.bypass) {
      for (const lfo of this.lfos) {
        if (!lfo.enabled) continue;
        const startSeconds = lfo.startSeconds ?? -Infinity;
        const endSeconds = lfo.endSeconds ?? Infinity;
        if (timeSeconds < startSeconds || timeSeconds > endSeconds) continue;
        const target = this.targets.get(lfo.targetId);
        if (!target) continue;
        const base = values.get(target.id) ?? this.baseValues.get(target.id) ?? target.getCurrent();
        const scale = this.targetScale(target);
        const wave = this.sampleWave(lfo, timeSeconds, dt);
        const normalized = lfo.bipolar ? wave : wave * 0.5 + 0.5;
        const next = base + lfo.offset * scale + normalized * lfo.amount * scale;
        values.set(target.id, next);
      }
    }

    for (const [id, value] of values) {
      const target = this.targets.get(id);
      if (!target) continue;
      let v = value;
      if (target.min !== undefined) v = Math.max(target.min, v);
      if (target.max !== undefined) v = Math.min(target.max, v);
      const current = target.getCurrent();
      if (Math.abs(current - v) < 1e-6) continue;
      target.apply(v);
    }
  }

  private applyBaseValues() {
    for (const [id, target] of this.targets) {
      const base = this.baseValues.get(id) ?? target.getCurrent();
      let v = base;
      if (target.min !== undefined) v = Math.max(target.min, v);
      if (target.max !== undefined) v = Math.min(target.max, v);
      target.apply(v);
    }
  }

  private targetScale(target: ModulationTarget) {
    if (target.range !== undefined) return target.range;
    const span = (target.max ?? 0) - (target.min ?? 0);
    if (isFinite(span) && Math.abs(span) > 0) return span;
    return 1;
  }

  private sampleWave(lfo: LfoConfig, timeSeconds: number, dt: number) {
    const state: LfoRuntimeState = this.lfoRuntime.get(lfo.id) ?? {
      lastValue: 0,
      holdValue: Math.random() * 2 - 1,
      lastHoldTime: timeSeconds,
    };

    const bpmFreq = (this.globalBpm / 60) * Math.max(0, lfo.bpmCoefficient);
    const effectiveFreq = lfo.useGlobalBpm ? bpmFreq : lfo.freqHz;
    const phase = effectiveFreq <= 0 ? lfo.phase : timeSeconds * effectiveFreq * TAU + lfo.phase;
    let raw: number;

    switch (lfo.wave) {
      case 'triangle':
        raw = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'square':
        raw = Math.sign(Math.sin(phase)) || 1;
        break;
      case 'saw': {
        const t = ((phase / TAU) % 1 + 1) % 1;
        raw = t * 2 - 1;
        break;
      }
      case 'expDecay': {
        const t = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = expDecayWave(t, k);
        break;
      }
      case 'invExpDecay': {
        const t = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = -expDecayWave(t, k);
        break;
      }
      case 'exp2Decay': {
        const t = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = exp2DecayWave(t, k);
        break;
      }
      case 'invExp2Decay': {
        const t = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = -exp2DecayWave(t, k);
        break;
      }
      case 'noise':
        raw = Math.random() * 2 - 1;
        break;
      case 'sampleHold': {
        const interval = 1 / Math.max(0.0001, effectiveFreq || 0.0001);
        if (timeSeconds - state.lastHoldTime >= interval) {
          state.holdValue = Math.random() * 2 - 1;
          state.lastHoldTime = timeSeconds;
        }
        raw = state.holdValue;
        break;
      }
      case 'sine':
      default:
        raw = Math.sin(phase);
        break;
    }

    const smooth = Math.max(0, lfo.smoothSeconds);
    if (smooth > 0 && dt > 0) {
      const alpha = clamp(1 - Math.exp(-dt / smooth), 0, 1);
      raw = state.lastValue + (raw - state.lastValue) * alpha;
    }

    state.lastValue = raw;
    this.lfoRuntime.set(lfo.id, state);
    return raw;
  }
}
