<script setup lang="ts">
import { computed, nextTick, ref, watchEffect } from 'vue';
import type { EnvelopeConfig, LfoConfig, ModulationTarget } from '../modulation';
import type { ModulationPanelModel } from '../modulation-panel-model';

type Props = {
  model: ModulationPanelModel;
};

const props = defineProps<Props>();
const model = props.model;
const state = model.state;

const selectedRegion = computed(() => model.getSelectedRegion());
const selectedLfo = computed(() => model.getSelectedLfo());
const selectedEnv = computed(() => model.getSelectedEnvelope());
const showInitialValues = computed(() => !state.selectedRegionId || !selectedRegion.value);

const waveOptions = computed(() => model.getWaveOptions());

const targets = computed(() => {
  void state.revision;
  return model.getSortedTargets();
});

const targetGroups = computed(() => {
  void state.revision;
  const groups = new Map<string, ModulationTarget[]>();
  for (const target of targets.value) {
    const group = target.group ?? 'Other';
    const bucket = groups.get(group) ?? [];
    bucket.push(target);
    groups.set(group, bucket);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, targets]) => ({ name, targets }));
});

const presetGroups = [
  {
    label: 'Quick',
    presets: [
      { label: '1/16', value: 1 / 16 },
      { label: '1/8', value: 1 / 8 },
      { label: '1/4', value: 1 / 4 },
      { label: '1/2', value: 1 / 2 },
      { label: '1/1', value: 1 },
      { label: '2/1', value: 2 },
      { label: '4/1', value: 4 },
      { label: '8/1', value: 8 },
    ],
  },
  {
    label: 'Dotted',
    presets: [
      { label: '1/16.', value: (1 / 16) * 1.5 },
      { label: '1/8.', value: (1 / 8) * 1.5 },
      { label: '1/4.', value: (1 / 4) * 1.5 },
      { label: '1/2.', value: (1 / 2) * 1.5 },
      { label: '1/1.', value: 1 * 1.5 },
      { label: '2/1.', value: 2 * 1.5 },
      { label: '4/1.', value: 4 * 1.5 },
      { label: '8/1.', value: 8 * 1.5 },
    ],
  },
  {
    label: 'Triplet',
    presets: [
      { label: '1/16t', value: (1 / 16) * (2 / 3) },
      { label: '1/8t', value: (1 / 8) * (2 / 3) },
      { label: '1/4t', value: (1 / 4) * (2 / 3) },
      { label: '1/2t', value: (1 / 2) * (2 / 3) },
      { label: '1/1t', value: 1 * (2 / 3) },
      { label: '2/1t', value: 2 * (2 / 3) },
      { label: '4/1t', value: 4 * (2 / 3) },
      { label: '8/1t', value: 8 * (2 / 3) },
    ],
  },
];

const approxEq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

const updateRegionStart = (event: Event) => {
  const region = selectedRegion.value;
  if (!region) return;
  const input = event.target as HTMLInputElement;
  const nextStart = Number(input.value) || 0;
  model.applyRegionTimeWindow(region, nextStart, region.endSeconds, 'floor', 'ceil');
};

const updateRegionEnd = (event: Event) => {
  const region = selectedRegion.value;
  if (!region) return;
  const input = event.target as HTMLInputElement;
  const nextEnd = Number(input.value) || 0;
  model.applyRegionTimeWindow(region, region.startSeconds, nextEnd, 'floor', 'ceil');
};

const setLfoBpmCoeff = (lfo: LfoConfig, value: number) => {
  lfo.bpmCoefficient = Math.max(1e-6, value);
};

const onLfoTargetChange = (lfo: LfoConfig, event: Event) => {
  lfo.targetId = (event.target as HTMLSelectElement).value;
};

const onLfoWaveChange = (lfo: LfoConfig, event: Event) => {
  lfo.wave = (event.target as HTMLSelectElement).value as LfoConfig['wave'];
};

const onEnvTargetChange = (env: EnvelopeConfig, event: Event) => {
  env.targetId = (event.target as HTMLSelectElement).value;
};

const onEnvWaveChange = (env: EnvelopeConfig, event: Event) => {
  env.wave = (event.target as HTMLSelectElement).value as EnvelopeConfig['wave'];
};

const onBaseValueChange = (target: ModulationTarget, event: Event) => {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!isFinite(raw)) {
    model.touch();
    return;
  }
  model.setTargetBaseValue(target, raw);
};

const onLfoPhaseChange = (lfo: LfoConfig, event: Event) => {
  lfo.phase = Number((event.target as HTMLInputElement).value) || 0;
};

const onLfoSmoothChange = (lfo: LfoConfig, event: Event) => {
  lfo.smoothSeconds = Math.max(0, Number((event.target as HTMLInputElement).value) || 0);
};

const onLfoBipolarChange = (lfo: LfoConfig, event: Event) => {
  const before = model.computeDeltaRange(lfo);
  lfo.bipolar = (event.target as HTMLInputElement).checked;
  model.applyLfoDeltaRange(lfo, before.min, before.max);
};

const lfoRange = computed(() => {
  void state.revision;
  const lfo = selectedLfo.value;
  if (!lfo) return null;
  const base = model.getLfoBaseValue(lfo);
  const { min, max, target } = model.computeDeltaRange(lfo);
  const absMin = base + min;
  const absMax = base + max;
  return { base, min, max, absMin, absMax, target };
});

const lfoRangeText = computed(() => {
  const range = lfoRange.value;
  if (!range) return '';
  const fmt = (v: number) => v.toFixed(3);
  const label = range.target ? ` (${range.target.label})` : '';
  return `Range: ${fmt(range.absMin)} .. ${fmt(range.absMax)} | Delta: ${fmt(range.min)} .. ${fmt(range.max)}${label}`;
});

const lfoMinInputRef = ref<HTMLInputElement | null>(null);
const lfoMaxInputRef = ref<HTMLInputElement | null>(null);

const onLfoRangeChange = () => {
  const lfo = selectedLfo.value;
  if (!lfo) return;
  const minInput = lfoMinInputRef.value;
  const maxInput = lfoMaxInputRef.value;
  if (!minInput || !maxInput) return;
  const minAbsRaw = Number(minInput.value);
  const maxAbsRaw = Number(maxInput.value);
  if (!isFinite(minAbsRaw) || !isFinite(maxAbsRaw)) {
    model.touch();
    return;
  }
  const clamped = model.clampRangeToTarget(lfo.targetId, minAbsRaw, maxAbsRaw);
  const base = model.getLfoBaseValue(lfo);
  model.applyLfoDeltaRange(lfo, clamped.min - base, clamped.max - base);
};

const envRangeText = computed(() => {
  const env = selectedEnv.value;
  if (!env) return '';
  const fmt = (v: number) => v.toFixed(3);
  const target = model.getTarget(env.targetId);
  const label = target ? ` (${target.label})` : '';
  return `Range: ${fmt(env.min)} .. ${fmt(env.max)}${label}`;
});

const envMinInputRef = ref<HTMLInputElement | null>(null);
const envMaxInputRef = ref<HTMLInputElement | null>(null);

const onEnvRangeChange = () => {
  const env = selectedEnv.value;
  if (!env) return;
  const minInput = envMinInputRef.value;
  const maxInput = envMaxInputRef.value;
  if (!minInput || !maxInput) return;
  const nextMin = Number(minInput.value);
  const nextMax = Number(maxInput.value);
  env.min = isFinite(nextMin) ? nextMin : env.min;
  env.max = isFinite(nextMax) ? nextMax : env.max;
  if (env.min > env.max) {
    const tmp = env.min;
    env.min = env.max;
    env.max = tmp;
  }
};

const lfoPreviewRef = ref<HTMLDivElement | null>(null);
const lfoCanvasRef = ref<HTMLCanvasElement | null>(null);
const envPreviewRef = ref<HTMLDivElement | null>(null);
const envCanvasRef = ref<HTMLCanvasElement | null>(null);

const TAU = Math.PI * 2;

const hashStringToSeed = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const wrap01 = (v: number) => ((v % 1) + 1) % 1;
const expDecayWave = (t: number, k: number) => 2 * Math.exp(-k * t) - 1;
const exp2DecayWave = (t: number, k: number) => 2 * Math.exp(-k * t * t) - 1;

const drawLfoPreview = () => {
  const lfo = selectedLfo.value;
  const preview = lfoPreviewRef.value;
  const canvas = lfoCanvasRef.value;
  if (!lfo || !preview || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const style = getComputedStyle(preview);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const cssW = Math.max(1, (preview.clientWidth || 240) - padLeft - padRight);
  const cssH = 64;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas.style.width = '100%';
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = 'rgba(8, 12, 18, 0.65)';
  ctx.fillRect(0, 0, cssW, cssH);

  const PREVIEW_BARS = 8;
  const startTime = 0;
  const barSeconds = (60 / state.bpm) * 4;
  const duration = Math.max(1e-6, barSeconds * PREVIEW_BARS);
  const samples = 220;
  const dt = duration / Math.max(1, samples - 1);

  const beatsPerSecond = state.bpm / 60;
  const beatsPerBar = 4;
  const coeff = PREVIEW_BARS;
  const effectiveFreq = coeff > 0 ? beatsPerSecond / (beatsPerBar * coeff) : 0;

  const rng = mulberry32(hashStringToSeed(lfo.id));
  let lastValue = 0;
  let holdValue = rng() * 2 - 1;
  let lastHoldTime = startTime;
  const smooth = Math.max(0, lfo.smoothSeconds);

  const baseValue = model.getLfoBaseValue(lfo);
  const { min: deltaMinRaw, max: deltaMaxRaw, scale } = model.computeDeltaRange(lfo);
  let absMin = baseValue + deltaMinRaw;
  let absMax = baseValue + deltaMaxRaw;
  if (!isFinite(absMin) || !isFinite(absMax) || Math.abs(absMax - absMin) < 1e-9) {
    absMin = baseValue - 1;
    absMax = baseValue + 1;
  }
  if (absMin > absMax) {
    const tmp = absMin;
    absMin = absMax;
    absMax = tmp;
  }
  const padY = 6;
  const denom = absMax - absMin;
  const yFor = (v: number) => {
    const t = denom !== 0 ? (v - absMin) / denom : 0.5;
    const clamped = Math.min(1, Math.max(0, t));
    return padY + (1 - clamped) * (cssH - padY * 2);
  };

  if (baseValue > absMin && baseValue < absMax) {
    ctx.strokeStyle = 'rgba(220, 231, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yFor(baseValue));
    ctx.lineTo(cssW, yFor(baseValue));
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(79, 209, 255, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < samples; i++) {
    const timeSeconds = startTime + (i / Math.max(1, samples - 1)) * duration;
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
        const t = wrap01(phase / TAU);
        raw = t * 2 - 1;
        break;
      }
      case 'expDecay': {
        const t = wrap01(phase / TAU);
        raw = expDecayWave(t, 6);
        break;
      }
      case 'invExpDecay': {
        const t = wrap01(phase / TAU);
        raw = -expDecayWave(t, 6);
        break;
      }
      case 'exp2Decay': {
        const t = wrap01(phase / TAU);
        raw = exp2DecayWave(t, 6);
        break;
      }
      case 'invExp2Decay': {
        const t = wrap01(phase / TAU);
        raw = -exp2DecayWave(t, 6);
        break;
      }
      case 'noise':
        raw = rng() * 2 - 1;
        break;
      case 'sampleHold': {
        const interval = 1 / Math.max(0.0001, effectiveFreq || 0.0001);
        if (timeSeconds - lastHoldTime >= interval) {
          holdValue = rng() * 2 - 1;
          lastHoldTime = timeSeconds;
        }
        raw = holdValue;
        break;
      }
      case 'sine':
      default:
        raw = Math.sin(phase);
        break;
    }

    if (smooth > 0 && dt > 0) {
      const alpha = Math.min(1, Math.max(0, 1 - Math.exp(-dt / smooth)));
      raw = lastValue + (raw - lastValue) * alpha;
    }
    lastValue = raw;

    const normalized = lfo.bipolar ? raw : raw * 0.5 + 0.5;
    const delta = lfo.offset * scale + normalized * lfo.amount * scale;
    const out = baseValue + delta;

    const x = (i / Math.max(1, samples - 1)) * cssW;
    const y = yFor(out);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
};

const drawEnvPreview = () => {
  const env = selectedEnv.value;
  const region = selectedRegion.value;
  const preview = envPreviewRef.value;
  const canvas = envCanvasRef.value;
  if (!env || !region || !preview || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const style = getComputedStyle(preview);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const cssW = Math.max(1, (preview.clientWidth || 240) - padLeft - padRight);
  const cssH = 64;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas.style.width = '100%';
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = 'rgba(8, 12, 18, 0.65)';
  ctx.fillRect(0, 0, cssW, cssH);

  const startTime = region.startSeconds;
  const endTime = region.endSeconds;
  const duration = Math.max(1e-6, endTime - startTime);
  const samples = 220;

  let minV = Math.min(env.min, env.max);
  let maxV = Math.max(env.min, env.max);
  if (!isFinite(minV) || !isFinite(maxV) || Math.abs(maxV - minV) < 1e-9) {
    minV = 0;
    maxV = 1;
  }
  const padY = 6;
  const denom = maxV - minV;
  const yFor = (v: number) => {
    const t = denom !== 0 ? (v - minV) / denom : 0.5;
    const clamped = Math.min(1, Math.max(0, t));
    return padY + (1 - clamped) * (cssH - padY * 2);
  };

  const rng = mulberry32(hashStringToSeed(env.id));
  let holdValue = rng() * 2 - 1;
  let lastHoldTime = startTime;

  ctx.strokeStyle = 'rgba(167, 139, 250, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < samples; i++) {
    const u = i / Math.max(1, samples - 1);
    const timeSeconds = startTime + u * duration;
    const tNorm = Math.min(1, Math.max(0, (timeSeconds - startTime) / duration));
    const phase = tNorm * TAU;

    let raw: number;
    switch (env.wave) {
      case 'triangle':
        raw = (2 / Math.PI) * Math.asin(Math.sin(phase));
        break;
      case 'square':
        raw = Math.sign(Math.sin(phase)) || 1;
        break;
      case 'saw': {
        const t = wrap01(phase / TAU);
        raw = t * 2 - 1;
        break;
      }
      case 'expDecay': {
        const t = wrap01(phase / TAU);
        raw = expDecayWave(t, 6);
        break;
      }
      case 'invExpDecay': {
        const t = wrap01(phase / TAU);
        raw = -expDecayWave(t, 6);
        break;
      }
      case 'exp2Decay': {
        const t = wrap01(phase / TAU);
        raw = exp2DecayWave(t, 6);
        break;
      }
      case 'invExp2Decay': {
        const t = wrap01(phase / TAU);
        raw = -exp2DecayWave(t, 6);
        break;
      }
      case 'noise':
        raw = rng() * 2 - 1;
        break;
      case 'sampleHold': {
        const interval = duration;
        if (timeSeconds - lastHoldTime >= interval) {
          holdValue = rng() * 2 - 1;
          lastHoldTime = timeSeconds;
        }
        raw = holdValue;
        break;
      }
      case 'sine':
      default:
        raw = Math.sin(phase);
        break;
    }

    const normalized = raw * 0.5 + 0.5;
    const value = env.min + normalized * (env.max - env.min);

    const x = u * cssW;
    const y = yFor(value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
};

watchEffect(() => {
  const lfo = selectedLfo.value;
  if (!lfo) return;
  void lfo.wave;
  void lfo.bpmCoefficient;
  void lfo.amount;
  void lfo.offset;
  void lfo.phase;
  void lfo.bipolar;
  void lfo.smoothSeconds;
  void lfo.targetId;
  void state.bpm;
  void state.revision;
  nextTick(() => drawLfoPreview());
});

watchEffect(() => {
  const env = selectedEnv.value;
  const region = selectedRegion.value;
  if (!env || !region) return;
  void env.wave;
  void env.min;
  void env.max;
  void region.startSeconds;
  void region.endSeconds;
  nextTick(() => drawEnvPreview());
});
</script>

<template>
  <div class="lfo-editor">
    <template v-if="showInitialValues">
      <div class="initial-values-title">Initial values (00:00:00)</div>
      <div class="initial-values-hint">Edit base values used at the start of the timeline.</div>
      <div class="initial-values-actions">
        <button type="button" @click="model.captureInitialValues()">Capture current values</button>
        <button type="button" @click="model.jumpToZero()">Jump 00:00</button>
      </div>

      <div v-for="group in targetGroups" :key="group.name" class="initial-values-group">
        <div class="initial-values-group-title">{{ group.name }}</div>
        <label v-for="target in group.targets" :key="target.id" class="initial-values-row">
          <span>{{ target.label }}</span>
          <input
            type="number"
            step="0.01"
            :min="target.min"
            :max="target.max"
            :value="model.getTargetBaseValue(target)"
            @change="onBaseValueChange(target, $event)"
          />
        </label>
      </div>
    </template>

    <template v-else-if="selectedLfo">
      <div class="lfo-editor-title">
        <span>LFO {{ selectedLfo.id }}</span>
        <button type="button" class="lfo-convert" @click="model.convertSelectedEvent('envelope')">
          Convert -> ENV
        </button>
      </div>

      <label class="lfo-row">
        <span>Enabled</span>
        <input type="checkbox" v-model="selectedLfo.enabled" />
      </label>

      <label class="lfo-row">
        <span>Start (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          :max="state.durationSeconds ?? undefined"
          :value="selectedRegion?.startSeconds"
          @change="updateRegionStart"
        />
      </label>

      <label class="lfo-row">
        <span>End (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          :max="state.durationSeconds ?? undefined"
          :value="selectedRegion?.endSeconds"
          @change="updateRegionEnd"
        />
      </label>

      <label class="lfo-row">
        <span>Target</span>
        <select :value="selectedLfo.targetId" @change="onLfoTargetChange(selectedLfo, $event)">
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.group ? `${target.group} - ` : '' }}{{ target.label }}
          </option>
        </select>
      </label>

      <label class="lfo-row">
        <span>Wave</span>
        <select :value="selectedLfo.wave" @change="onLfoWaveChange(selectedLfo, $event)">
          <option v-for="opt in waveOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>

      <label v-for="group in presetGroups" :key="group.label" class="lfo-row">
        <span>{{ group.label }}</span>
        <div class="lfo-presets">
          <button
            v-for="preset in group.presets"
            :key="preset.label"
            type="button"
            class="lfo-preset"
            :class="{ selected: approxEq(selectedLfo.bpmCoefficient, preset.value) }"
            @click="setLfoBpmCoeff(selectedLfo, preset.value)"
          >
            {{ preset.label }}
          </button>
        </div>
      </label>

      <label class="lfo-row">
        <span>Phase (rad)</span>
        <input
          type="number"
          step="0.001"
          min="0"
          :max="Math.PI * 2"
          :value="selectedLfo.phase"
          @change="onLfoPhaseChange(selectedLfo, $event)"
        />
      </label>

      <div class="lfo-range">{{ lfoRangeText }}</div>

      <label class="lfo-row">
        <span>Min</span>
        <input
          ref="lfoMinInputRef"
          type="number"
          step="0.01"
          :min="model.getTarget(selectedLfo.targetId)?.min"
          :max="model.getTarget(selectedLfo.targetId)?.max"
          :value="Number.isFinite(lfoRange?.absMin) ? lfoRange?.absMin : 0"
          @change="onLfoRangeChange"
        />
      </label>

      <label class="lfo-row">
        <span>Max</span>
        <input
          ref="lfoMaxInputRef"
          type="number"
          step="0.01"
          :min="model.getTarget(selectedLfo.targetId)?.min"
          :max="model.getTarget(selectedLfo.targetId)?.max"
          :value="Number.isFinite(lfoRange?.absMax) ? lfoRange?.absMax : 0"
          @change="onLfoRangeChange"
        />
      </label>

      <label class="lfo-row">
        <span>Bipolar</span>
        <input type="checkbox" :checked="selectedLfo.bipolar" @change="onLfoBipolarChange(selectedLfo, $event)" />
      </label>

      <label class="lfo-row">
        <span>Smooth (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          max="4"
          :value="selectedLfo.smoothSeconds"
          @change="onLfoSmoothChange(selectedLfo, $event)"
        />
      </label>

      <div ref="lfoPreviewRef" class="mod-preview">
        <canvas ref="lfoCanvasRef" class="mod-preview-canvas"></canvas>
      </div>
    </template>

    <template v-else-if="selectedEnv">
      <div class="lfo-editor-title">
        <span>Envelope {{ selectedEnv.id }}</span>
        <button type="button" class="lfo-convert" @click="model.convertSelectedEvent('lfo')">Convert -> LFO</button>
      </div>

      <label class="lfo-row">
        <span>Enabled</span>
        <input type="checkbox" v-model="selectedEnv.enabled" />
      </label>

      <label class="lfo-row">
        <span>Start (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          :max="state.durationSeconds ?? undefined"
          :value="selectedRegion?.startSeconds"
          @change="updateRegionStart"
        />
      </label>

      <label class="lfo-row">
        <span>End (s)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          :max="state.durationSeconds ?? undefined"
          :value="selectedRegion?.endSeconds"
          @change="updateRegionEnd"
        />
      </label>

      <label class="lfo-row">
        <span>Target</span>
        <select :value="selectedEnv.targetId" @change="onEnvTargetChange(selectedEnv, $event)">
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.group ? `${target.group} - ` : '' }}{{ target.label }}
          </option>
        </select>
      </label>

      <label class="lfo-row">
        <span>Wave</span>
        <select :value="selectedEnv.wave" @change="onEnvWaveChange(selectedEnv, $event)">
          <option v-for="opt in waveOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </label>

      <label class="lfo-row">
        <span>Min</span>
        <input
          type="number"
          step="0.01"
          :min="model.getTarget(selectedEnv.targetId)?.min"
          :max="model.getTarget(selectedEnv.targetId)?.max"
          ref="envMinInputRef"
          :value="selectedEnv.min"
          @change="onEnvRangeChange"
        />
      </label>

      <label class="lfo-row">
        <span>Max</span>
        <input
          type="number"
          step="0.01"
          :min="model.getTarget(selectedEnv.targetId)?.min"
          :max="model.getTarget(selectedEnv.targetId)?.max"
          ref="envMaxInputRef"
          :value="selectedEnv.max"
          @change="onEnvRangeChange"
        />
      </label>

      <div class="lfo-range">{{ envRangeText }}</div>

      <div ref="envPreviewRef" class="mod-preview">
        <canvas ref="envCanvasRef" class="mod-preview-canvas"></canvas>
      </div>
    </template>
  </div>
</template>
