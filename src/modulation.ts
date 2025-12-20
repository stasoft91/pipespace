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
  /**
   * Musical length as a fraction of a 4-beat bar (i.e. a "whole note" in 4/4).
   * Examples:
   * - 1/4  => one beat (quarter note)
   * - 1/1  => one bar (whole note)
   * - 2/1  => two bars
   *
   * The effective frequency is computed from the global BPM.
   */
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

export type EnvelopeConfig = {
  id: string;
  targetId: string;
  wave: Waveform;
  min: number;
  max: number;
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

type HeldTargetState = {
  /**
   * Base value captured when a segment first becomes active for this target.
   * While held, manual base changes are ignored for modulation math.
   */
  baseValue: number;
  /**
   * Last value applied while a segment was active. When the segment ends, this
   * value is committed into the base so the parameter holds the last modulated value.
   */
  lastApplied: number;
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
  private envelopes: EnvelopeConfig[] = [];
  private envelopeRuntime = new Map<string, LfoRuntimeState>();
  private heldTargets = new Map<string, HeldTargetState>();
  private scratchValues = new Map<string, number>();
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
      // When bypassing, drop any "held" segment state so manual bases take effect again.
      this.heldTargets.clear();
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

  addEnvelope(partial: Partial<EnvelopeConfig>): EnvelopeConfig | null {
    const defaultTargetId = partial.targetId ?? this.getTargets()[0]?.id;
    if (!defaultTargetId) return null;
    const target = this.targets.get(defaultTargetId);
    const current = target ? target.getCurrent() : 0;
    const numOr = (v: unknown, fallback: number) => (typeof v === 'number' && isFinite(v) ? v : fallback);
    const minDefault = numOr(partial.min, target?.min ?? current);
    const maxDefault = numOr(partial.max, target?.max ?? minDefault + 1);
    const env: EnvelopeConfig = {
      id: partial.id ?? `env-${Math.random().toString(16).slice(2)}`,
      targetId: defaultTargetId,
      wave: partial.wave ?? 'sine',
      min: minDefault,
      max: maxDefault,
      enabled: partial.enabled ?? true,
      startSeconds: partial.startSeconds,
      endSeconds: partial.endSeconds,
    };
    this.envelopes.push(env);
    return env;
  }

  removeEnvelope(id: string) {
    this.envelopes = this.envelopes.filter((e) => e.id !== id);
    this.envelopeRuntime.delete(id);
  }

  getEnvelopes() {
    return this.envelopes;
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
    // External base sync means the authored "manual" state changed; reset segment holds.
    this.heldTargets.clear();
  }

  update(timeSeconds: number, dt: number) {
    if (this.targets.size === 0) return;
    if (this.lastUpdateSeconds !== null && timeSeconds < this.lastUpdateSeconds - 1e-6) {
      this.lfoRuntime.clear();
      this.envelopeRuntime.clear();
      this.heldTargets.clear();
      this.lastUpdateSeconds = null;
    }
    this.lastUpdateSeconds = timeSeconds;
    const values = this.scratchValues;
    values.clear();

    // Figure out which targets are currently driven by any active segment.
    const activeTargets = new Set<string>();
    const activeEnvelopes: EnvelopeConfig[] = [];
    const activeLfos: LfoConfig[] = [];
    if (!this.bypass) {
      for (const env of this.envelopes) {
        if (!env.enabled) continue;
        const startSeconds = env.startSeconds;
        const endSeconds = env.endSeconds;
        if (startSeconds === undefined || endSeconds === undefined) continue;
        if (endSeconds <= startSeconds) continue;
        if (timeSeconds < startSeconds || timeSeconds > endSeconds) continue;
        if (!this.targets.has(env.targetId)) continue;
        activeEnvelopes.push(env);
        activeTargets.add(env.targetId);
      }
      for (const lfo of this.lfos) {
        if (!lfo.enabled) continue;
        const startSeconds = lfo.startSeconds ?? -Infinity;
        const endSeconds = lfo.endSeconds ?? Infinity;
        if (timeSeconds < startSeconds || timeSeconds > endSeconds) continue;
        if (!this.targets.has(lfo.targetId)) continue;
        activeLfos.push(lfo);
        activeTargets.add(lfo.targetId);
      }
    }

    // If a target was held previously but is no longer driven now, commit the last driven value
    // into the base so the parameter "sticks" after the segment ends.
    for (const [targetId, hold] of this.heldTargets) {
      if (!activeTargets.has(targetId)) {
        this.baseValues.set(targetId, hold.lastApplied);
        this.heldTargets.delete(targetId);
      }
    }

    // If a target becomes driven now, capture its current base as the locked baseline.
    for (const targetId of activeTargets) {
      if (this.heldTargets.has(targetId)) continue;
      const target = this.targets.get(targetId);
      if (!target) continue;
      const base = this.baseValues.get(targetId) ?? target.getCurrent();
      this.heldTargets.set(targetId, { baseValue: base, lastApplied: base });
    }

    for (const [id, target] of this.targets) {
      const held = this.heldTargets.get(id);
      const base = held ? held.baseValue : this.baseValues.get(id);
      values.set(id, base ?? target.getCurrent());
    }

    if (!this.bypass) {
      for (const env of activeEnvelopes) {
        const target = this.targets.get(env.targetId);
        if (!target) continue;
        const raw = this.sampleEnvelopeWave(env, timeSeconds);
        const normalized = raw * 0.5 + 0.5;
        const next = env.min + normalized * (env.max - env.min);
        values.set(target.id, next);
      }

      for (const lfo of activeLfos) {
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
      const held = this.heldTargets.get(id);
      if (held) {
        held.lastApplied = v;
      }
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

    // Treat bpmCoefficient as a musical duration (fraction of a 4-beat bar).
    // The smaller the coefficient, the faster the modulation (shorter period).
    const beatsPerSecond = this.globalBpm / 60;
    const beatsPerBar = 4;
    const coeff = lfo.bpmCoefficient;
    const effectiveFreq =
      coeff > 0
        ? beatsPerSecond / (beatsPerBar * coeff)
        : 0;
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

  private sampleEnvelopeWave(env: EnvelopeConfig, timeSeconds: number) {
    const start = env.startSeconds ?? timeSeconds;
    const end = env.endSeconds ?? start + 1;
    const duration = Math.max(1e-6, end - start);
    const t = clamp((timeSeconds - start) / duration, 0, 1);
    const phase = t * TAU;

    const state: LfoRuntimeState = this.envelopeRuntime.get(env.id) ?? {
      lastValue: 0,
      holdValue: Math.random() * 2 - 1,
      lastHoldTime: timeSeconds,
    };

    const effectiveFreq = 1 / duration;
    let raw: number;

    switch (env.wave) {
      case 'triangle':
        raw = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'square':
        raw = Math.sign(Math.sin(phase)) || 1;
        break;
      case 'saw': {
        const tt = ((phase / TAU) % 1 + 1) % 1;
        raw = tt * 2 - 1;
        break;
      }
      case 'expDecay': {
        const tt = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = expDecayWave(tt, k);
        break;
      }
      case 'invExpDecay': {
        const tt = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = -expDecayWave(tt, k);
        break;
      }
      case 'exp2Decay': {
        const tt = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = exp2DecayWave(tt, k);
        break;
      }
      case 'invExp2Decay': {
        const tt = ((phase / TAU) % 1 + 1) % 1;
        const k = 6;
        raw = -exp2DecayWave(tt, k);
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

    state.lastValue = raw;
    this.envelopeRuntime.set(env.id, state);
    return raw;
  }
}
