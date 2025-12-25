import Peaks, {
  type PeaksInstance,
  type WaveformViewPointerEvent,
} from 'peaks.js';
import { ModulationManager, type EnvelopeConfig, type LfoConfig, type ModulationTarget, type Waveform } from './modulation';
import { type ProjectFile, type ProjectTimeline, type ProjectSettings, parseProjectFile } from './project';

export type RenderSchedule = {
  bpm: number;
  durationSeconds: number;
  lfos: LfoConfig[];
  envelopes?: EnvelopeConfig[];
  videoResolution: number;
  settings?: ProjectSettings;
};

export type TimelineInitOptions = {
  container: HTMLElement;
  bpm: number;
  modulation: ModulationManager;
  onRenderVideo?: (durationSeconds: number) => void;
  onSaveProject?: () => void;
  onLoadProject?: (project: ProjectFile) => void;
  onBpmChange?: (bpm: number) => void;
  onRegionInserted?: (regionId: string) => void;
  onRegionUpdated?: (regionId: string) => void;
  onRegionRemoved?: (regionId: string) => void;
  onRegionSelected?: (regionId: string | null) => void;
};

type SnapMode = 'round' | 'floor' | 'ceil';
type TimelineEventKind = 'lfo' | 'envelope';

export function initTimeline(options: TimelineInitOptions) {
  const { container } = options;
  container.textContent = '';

  const controls = document.createElement('div');
  controls.className = 'timeline-controls';
  container.appendChild(controls);

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.textContent = 'Load MP3';
  controls.appendChild(loadBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/mpeg,audio/mp3';
  fileInput.style.display = 'none';
  controls.appendChild(fileInput);

  const bpmLabel = document.createElement('label');
  bpmLabel.className = 'timeline-bpm';
  bpmLabel.textContent = 'BPM';
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number';
  bpmInput.min = '10';
  bpmInput.max = '400';
  bpmInput.step = '1';
  bpmInput.value = String(options.bpm);
  bpmLabel.appendChild(bpmInput);
  controls.appendChild(bpmLabel);

  let insertKind: TimelineEventKind = 'lfo';
  const insertLabel = document.createElement('label');
  insertLabel.className = 'timeline-insert';
  insertLabel.textContent = 'Insert';
  const insertSelect = document.createElement('select');
  insertSelect.setAttribute('aria-label', 'Region insert modulator type');
  for (const opt of [
    { label: 'LFO', value: 'lfo' as const },
    { label: 'Envelope', value: 'envelope' as const },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    insertSelect.appendChild(option);
  }
  insertSelect.value = insertKind;
  insertSelect.addEventListener('change', () => {
    insertKind = (insertSelect.value as TimelineEventKind) || 'lfo';
  });
  insertLabel.appendChild(insertSelect);
  controls.appendChild(insertLabel);

  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.textContent = '−';
  controls.appendChild(zoomOutBtn);

  const zoomInBtn = document.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.textContent = '+';
  controls.appendChild(zoomInBtn);

  const zoomLabel = document.createElement('label');
  zoomLabel.className = 'timeline-zoom';
  zoomLabel.textContent = 'Zoom';
  const zoomRange = document.createElement('input');
  zoomRange.type = 'range';
  zoomRange.min = '0';
  zoomRange.max = '0';
  zoomRange.step = '1';
  zoomRange.value = '0';
  zoomRange.disabled = true;
  zoomRange.setAttribute('aria-label', 'Timeline zoom level');
  zoomLabel.appendChild(zoomRange);
  controls.appendChild(zoomLabel);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = 'Play';
  controls.appendChild(playBtn);

  let videoResolution = 1080;
  const resolutionLabel = document.createElement('label');
  resolutionLabel.className = 'timeline-resolution';
  resolutionLabel.textContent = 'Res';
  const resolutionSelect = document.createElement('select');
  resolutionSelect.setAttribute('aria-label', 'Video resolution');
  for (const res of [360, 720, 1080, 1920]) {
    const option = document.createElement('option');
    option.value = String(res);
    option.textContent = String(res);
    resolutionSelect.appendChild(option);
  }
  resolutionSelect.value = String(videoResolution);
  resolutionSelect.addEventListener('change', () => {
    const next = Math.round(Number(resolutionSelect.value));
    if (isFinite(next) && next > 0) videoResolution = next;
  });
  resolutionLabel.appendChild(resolutionSelect);
  controls.appendChild(resolutionLabel);

  const PREVIEW_RENDER_SECONDS = 21;

  const renderBtn = document.createElement('button');
  renderBtn.type = 'button';
  renderBtn.textContent = 'Render Video';
  renderBtn.disabled = true;
  controls.appendChild(renderBtn);

  const previewToggle = document.createElement('input');
  previewToggle.type = 'checkbox';
  previewToggle.setAttribute('aria-label', `Render first ${PREVIEW_RENDER_SECONDS}s only`);

  const previewLabel = document.createElement('label');
  previewLabel.className = 'timeline-preview-toggle';
  previewLabel.title = `Render only the first ${PREVIEW_RENDER_SECONDS}s`;
  previewLabel.appendChild(previewToggle);
  previewLabel.appendChild(document.createTextNode(`Preview ${PREVIEW_RENDER_SECONDS}s`));
  controls.appendChild(previewLabel);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save Project';
  saveBtn.disabled = !options.onSaveProject;
  controls.appendChild(saveBtn);

  const loadProjectBtn = document.createElement('button');
  loadProjectBtn.type = 'button';
  loadProjectBtn.textContent = 'Load Project';
  loadProjectBtn.disabled = !options.onLoadProject;
  controls.appendChild(loadProjectBtn);

  const projectInput = document.createElement('input');
  projectInput.type = 'file';
  projectInput.accept = 'application/json,.json';
  projectInput.style.display = 'none';
  controls.appendChild(projectInput);

  const body = document.createElement('div');
  body.className = 'timeline-body';
  container.appendChild(body);

  const lfoPanel = document.createElement('div');
  lfoPanel.className = 'lfo-panel';
  body.appendChild(lfoPanel);

  const lfoList = document.createElement('div');
  lfoList.className = 'lfo-list';
  lfoPanel.appendChild(lfoList);

  const lfoEditor = document.createElement('div');
  lfoEditor.className = 'lfo-editor';
  lfoPanel.appendChild(lfoEditor);

  const waveformStack = document.createElement('div');
  waveformStack.className = 'waveform-stack';
  body.appendChild(waveformStack);

  const overviewContainer = document.createElement('div');
  overviewContainer.className = 'peaks-overview';
  waveformStack.appendChild(overviewContainer);

  const zoomviewContainer = document.createElement('div');
  zoomviewContainer.className = 'peaks-zoomview';
  waveformStack.appendChild(zoomviewContainer);

  const zoomviewRegionLanesOverlay = document.createElement('div');
  zoomviewRegionLanesOverlay.className = 'zoomview-region-lanes-overlay';
  zoomviewRegionLanesOverlay.style.display = 'none';
  zoomviewContainer.appendChild(zoomviewRegionLanesOverlay);

  const audioEl = document.createElement('audio');
  audioEl.className = 'peaks-audio';
  audioEl.preload = 'auto';
  audioEl.style.display = 'none';
  container.appendChild(audioEl);

  const lfoContextMenu = document.createElement('div');
  lfoContextMenu.className = 'lfo-context-menu';
  lfoContextMenu.style.display = 'none';
  container.appendChild(lfoContextMenu);

  let peaks: PeaksInstance | null = null;
  let audioUrl: string | null = null;
  let audioDurationSeconds: number | null = null;
  let audioFileName: string | null = null;
  let audioLoadToken = 0;
  let selectedRegionId: string | null = null;
  let selectedModulator: { kind: TimelineEventKind; id: string } | null = null;
  let bpm = Math.max(10, options.bpm);
  const modulation = options.modulation;

  type TimelineLfo = LfoConfig & { startSeconds?: number; endSeconds?: number };
  type TimelineEnvelope = EnvelopeConfig & { startSeconds?: number; endSeconds?: number };

  type TimelineRegion = {
    id: string;
    startSeconds: number;
    endSeconds: number;
    lfos: TimelineLfo[];
    envelopes: TimelineEnvelope[];
  };
  const regionsById = new Map<string, TimelineRegion>();

  const getSortedTargets = () =>
    modulation
      .getTargets()
      .slice()
      .sort((a, b) => {
        const ga = a.group ?? '';
        const gb = b.group ?? '';
        if (ga !== gb) return ga.localeCompare(gb);
        return a.label.localeCompare(b.label);
      });

  const beatsPerBar = 4;
  const zoomLevels = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
  const barSeconds = () => (60 / bpm) * beatsPerBar;

  const updateRenderEnabled = () => {
    const canRender =
      Boolean(options.onRenderVideo) &&
      audioDurationSeconds !== null &&
      isFinite(audioDurationSeconds) &&
      audioDurationSeconds > 0;
    renderBtn.disabled = !canRender;
  };

  const updateAudioLabel = () => {
    const fileName = audioFileName;
    if (!fileName) {
      loadBtn.textContent = 'Load MP3';
      return;
    }
    loadBtn.textContent = `Load MP3 (${fileName})`;
  };

  const snapToBar = (time: number, mode: SnapMode) => {
    const bar = barSeconds();
    if (!isFinite(bar) || bar <= 0) return time;
    const k = time / bar;
    const snapped =
      mode === 'floor' ? Math.floor(k) : mode === 'ceil' ? Math.ceil(k) : Math.round(k);
    return snapped * bar;
  };

  const fmtTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = (time % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  };

  const getTargetScale = (target: ModulationTarget) => {
    if (target.range !== undefined) return target.range;
    const span = (target.max ?? 0) - (target.min ?? 0);
    if (isFinite(span) && Math.abs(span) > 0) return span;
    return 1;
  };

  const computeDeltaRange = (lfo: TimelineLfo) => {
    const target = modulation.getTarget(lfo.targetId);
    const scale = target ? getTargetScale(target) : 1;
    const offset = lfo.offset * scale;
    const amt = lfo.amount * scale;
    const min = lfo.bipolar ? offset - amt : offset;
    const max = lfo.bipolar ? offset + amt : offset + amt;
    return { min, max, scale, target };
  };

  const TAU = Math.PI * 2;

  const hashStringToSeed = (text: string) => {
    // FNV-1a 32-bit hash
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

  const clampTime = (time: number) => {
    let v = Math.max(0, time);
    if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
      v = Math.min(audioDurationSeconds, v);
    }
    return v;
  };

  const snapRegionWindow = (
    startSeconds: number,
    endSeconds: number,
    startMode: SnapMode,
    endMode: SnapMode
  ) => {
    const bar = barSeconds();
    const start = snapToBar(clampTime(startSeconds), startMode);
    const endRaw = snapToBar(clampTime(endSeconds), endMode);
    const end = endRaw <= start ? start + bar : endRaw;
    return { start, end: clampTime(end) };
  };

  const applyRegionTimeWindow = (
    region: TimelineRegion,
    startSeconds: number,
    endSeconds: number,
    startMode: SnapMode,
    endMode: SnapMode
  ) => {
    const { start, end } = snapRegionWindow(startSeconds, endSeconds, startMode, endMode);
    region.startSeconds = start;
    region.endSeconds = end;
    for (const lfo of region.lfos) {
      lfo.startSeconds = start;
      lfo.endSeconds = end;
    }
    for (const env of region.envelopes) {
      env.startSeconds = start;
      env.endSeconds = end;
    }
    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
    options.onRegionUpdated?.(region.id);
  };

  const getSelectedRegion = () => {
    if (!selectedRegionId) return null;
    return regionsById.get(selectedRegionId) ?? null;
  };

  const ensureSelectedModulatorForRegion = (region: TimelineRegion) => {
    const sel = selectedModulator;
    if (sel) {
      const exists =
        (sel.kind === 'lfo' && region.lfos.some((l) => l.id === sel.id)) ||
        (sel.kind === 'envelope' && region.envelopes.some((e) => e.id === sel.id));
      if (exists) return;
    }
    const firstLfo = region.lfos[0] ?? null;
    const firstEnv = region.envelopes[0] ?? null;
    if (firstLfo) selectedModulator = { kind: 'lfo', id: firstLfo.id };
    else if (firstEnv) selectedModulator = { kind: 'envelope', id: firstEnv.id };
    else selectedModulator = null;
  };

  const scrollSelectedListIntoView = () => {
    // Prefer scrolling to the selected modulator row; otherwise scroll to the selected region item;
    // otherwise scroll to the "Initial values" button.
    const selectedEl =
      (lfoList.querySelector('.region-mod.selected') as HTMLElement | null) ??
      (lfoList.querySelector('.lfo-item.selected') as HTMLElement | null) ??
      (lfoList.querySelector('.lfo-list-initial.selected') as HTMLElement | null);
    if (!selectedEl) return;

    const container = lfoList;
    const c = container.getBoundingClientRect();
    const r = selectedEl.getBoundingClientRect();
    const pad = 8;
    const above = r.top < c.top + pad;
    const below = r.bottom > c.bottom - pad;
    if (!above && !below) return;

    // Use nearest to avoid jumping too far when the element is partially visible.
    selectedEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  const selectRegion = (regionId: string | null) => {
    selectedRegionId = regionId;
    if (!regionId) {
      selectedModulator = null;
    } else {
      const region = regionsById.get(regionId);
      if (region) ensureSelectedModulatorForRegion(region);
    }
    renderRegionLanes();
    renderLfoList();
    scrollSelectedListIntoView();
    renderLfoEditor();
    options.onRegionSelected?.(regionId);
  };

  const selectModulatorInRegion = (regionId: string, modulator: { kind: TimelineEventKind; id: string }) => {
    selectedRegionId = regionId;
    selectedModulator = modulator;
    const region = regionsById.get(regionId);
    if (region) ensureSelectedModulatorForRegion(region);
    renderRegionLanes();
    renderLfoList();
    scrollSelectedListIntoView();
    renderLfoEditor();
    options.onRegionSelected?.(regionId);
  };

  const hideContextMenu = () => {
    lfoContextMenu.style.display = 'none';
    lfoContextMenu.textContent = '';
  };

  const convertSelectedEvent = (toKind: TimelineEventKind) => {
    const region = getSelectedRegion();
    if (!region) return;
    const selected = selectedModulator;
    if (!selected) return;
    if (selected.kind === toKind) return;

    const start = region.startSeconds;
    const end = region.endSeconds;

    if (toKind === 'envelope' && selected.kind === 'lfo') {
      const idx = region.lfos.findIndex((l) => l.id === selected.id);
      if (idx < 0) return;
      const lfo = region.lfos[idx];
      const target = modulation.getTarget(lfo.targetId);
      const base = target ? target.getCurrent() : 0;
      const delta = computeDeltaRange(lfo);
      let min = base + delta.min;
      let max = base + delta.max;
      if (min > max) {
        const tmp = min;
        min = max;
        max = tmp;
      }
      if (target?.min !== undefined) {
        min = Math.max(target.min, min);
        max = Math.max(target.min, max);
      }
      if (target?.max !== undefined) {
        min = Math.min(target.max, min);
        max = Math.min(target.max, max);
      }

      modulation.removeLfo(lfo.id);
      region.lfos.splice(idx, 1);

      const created = modulation.addEnvelope({
        targetId: lfo.targetId,
        wave: lfo.wave,
        min,
        max,
        enabled: lfo.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) return;
      const env = created as TimelineEnvelope;
      env.startSeconds = start;
      env.endSeconds = end;
      region.envelopes.push(env);
      selectedModulator = { kind: 'envelope', id: env.id };
    }

    if (toKind === 'lfo' && selected.kind === 'envelope') {
      const idx = region.envelopes.findIndex((e) => e.id === selected.id);
      if (idx < 0) return;
      const env = region.envelopes[idx];
      const duration = Math.max(1e-6, end - start);
      const target = modulation.getTarget(env.targetId);
      const base = target ? target.getCurrent() : (env.min + env.max) * 0.5;
      const scale = target ? getTargetScale(target) : 1;

      const center = (env.min + env.max) * 0.5;
      const offsetAbs = center - base;
      const amountAbs = Math.abs(env.max - env.min) * 0.5;
      const offset = isFinite(offsetAbs / scale) ? offsetAbs / scale : 0;
      const amount = isFinite(amountAbs / scale) ? amountAbs / scale : 0;

      // LFOs are BPM-synced; choose a coefficient so the LFO completes ~1 cycle over the segment.
      // bpmCoefficient is expressed as a fraction of a 4-beat bar (1/1 = 1 bar, 1/4 = 1 beat).
      const bar = barSeconds();
      const bpmCoefficient = bar > 0 ? duration / bar : 1;
      const beatsPerSecond = bpm / 60;
      const beatsPerBar = 4;
      const effectiveFreq = bpmCoefficient > 0 ? beatsPerSecond / (beatsPerBar * bpmCoefficient) : 0;
      const phase = effectiveFreq <= 0 ? 0 : -start * effectiveFreq * Math.PI * 2;

      modulation.removeEnvelope(env.id);
      region.envelopes.splice(idx, 1);

      const created = modulation.addLfo({
        targetId: env.targetId,
        wave: env.wave,
        bpmCoefficient,
        amount,
        offset,
        phase,
        bipolar: true,
        smoothSeconds: 0,
        enabled: env.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) return;
      const lfo = created as TimelineLfo;
      lfo.startSeconds = start;
      lfo.endSeconds = end;
      region.lfos.push(lfo);
      selectedModulator = { kind: 'lfo', id: lfo.id };
    }

    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
  };

  const createRegionId = () => `reg-${Math.random().toString(16).slice(2)}`;

  const addModulatorToRegion = (region: TimelineRegion, kind: TimelineEventKind) => {
    if (kind === 'lfo') {
      const created = modulation.addLfo({
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
      });
      if (!created) return;
      const lfo = created as TimelineLfo;
      lfo.startSeconds = region.startSeconds;
      lfo.endSeconds = region.endSeconds;
      region.lfos.push(lfo);
      selectedRegionId = region.id;
      selectedModulator = { kind: 'lfo', id: lfo.id };
    } else {
      const created = modulation.addEnvelope({
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
      });
      if (!created) return;
      const env = created as TimelineEnvelope;
      env.startSeconds = region.startSeconds;
      env.endSeconds = region.endSeconds;
      region.envelopes.push(env);
      selectedRegionId = region.id;
      selectedModulator = { kind: 'envelope', id: env.id };
    }
    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
    options.onRegionUpdated?.(region.id);
  };

  const addRegionAtTime = (timeSeconds: number, anchor: 'start' | 'end') => {
    const bar = barSeconds();
    if (!isFinite(bar) || bar <= 0) return;

    const t = clampTime(timeSeconds);
    let start: number;
    let end: number;

    if (anchor === 'start') {
      start = snapToBar(t, 'floor');
      end = start + bar;
    } else {
      end = snapToBar(t, 'ceil');
      start = end - bar;
    }

    start = clampTime(start);
    end = clampTime(end);

    if (end <= start) {
      end = clampTime(start + bar);
    }
    if (end <= start) return;

    const regionId = createRegionId();
    const region: TimelineRegion = {
      id: regionId,
      startSeconds: start,
      endSeconds: end,
      lfos: [],
      envelopes: [],
    };
    regionsById.set(regionId, region);
    addModulatorToRegion(region, insertKind);
    selectRegion(regionId);
    options.onRegionInserted?.(regionId);
  };

  const showTimelineContextMenu = (clientX: number, clientY: number, timeSeconds: number) => {
    lfoContextMenu.textContent = '';

    const kindLabel = insertKind === 'envelope' ? 'ENV' : 'LFO';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = `New region (${kindLabel}): use this as START`;
    startBtn.addEventListener('click', () => {
      addRegionAtTime(timeSeconds, 'start');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(startBtn);

    const endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.textContent = `New region (${kindLabel}): use this as END`;
    endBtn.addEventListener('click', () => {
      addRegionAtTime(timeSeconds, 'end');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(endBtn);

    lfoContextMenu.style.left = `${clientX}px`;
    lfoContextMenu.style.top = `${clientY}px`;
    lfoContextMenu.style.display = 'block';
  };

  const duplicateRegion = (regionId: string, startOverride?: number, endOverride?: number) => {
    const region = regionsById.get(regionId);
    if (!region) return;

    let start = clampTime(startOverride ?? region.startSeconds);
    let end = clampTime(endOverride ?? region.endSeconds);
    if (end <= start) {
      const bar = barSeconds();
      if (isFinite(bar) && bar > 0) {
        end = clampTime(start + bar);
      }
    }
    if (end <= start) return;

    const newRegionId = createRegionId();
    const nextRegion: TimelineRegion = {
      id: newRegionId,
      startSeconds: start,
      endSeconds: end,
      lfos: [],
      envelopes: [],
    };

    for (const lfo of region.lfos) {
      const created = modulation.addLfo({
        targetId: lfo.targetId,
        wave: lfo.wave,
        bpmCoefficient: lfo.bpmCoefficient,
        amount: lfo.amount,
        offset: lfo.offset,
        phase: lfo.phase,
        bipolar: lfo.bipolar,
        smoothSeconds: lfo.smoothSeconds,
        enabled: lfo.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) continue;
      const next = created as TimelineLfo;
      next.startSeconds = start;
      next.endSeconds = end;
      nextRegion.lfos.push(next);
    }

    for (const env of region.envelopes) {
      const created = modulation.addEnvelope({
        targetId: env.targetId,
        wave: env.wave,
        min: env.min,
        max: env.max,
        enabled: env.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) continue;
      const next = created as TimelineEnvelope;
      next.startSeconds = start;
      next.endSeconds = end;
      nextRegion.envelopes.push(next);
    }

    if (nextRegion.lfos.length + nextRegion.envelopes.length <= 0) return;
    regionsById.set(newRegionId, nextRegion);
    selectRegion(newRegionId);
    options.onRegionInserted?.(newRegionId);
  };

  const duplicateRegionNext = (regionId: string) => {
    const region = regionsById.get(regionId);
    if (!region) return;
    const start = region.startSeconds;
    const end = region.endSeconds;
    const duration = Math.max(1e-6, end - start);
    duplicateRegion(regionId, end, end + duration);
  };

  const removeModulatorFromRegion = (regionId: string, modulator: { kind: TimelineEventKind; id: string }) => {
    const region = regionsById.get(regionId);
    if (!region) return;

    if (modulator.kind === 'lfo') {
      const idx = region.lfos.findIndex((l) => l.id === modulator.id);
      if (idx >= 0) {
        const lfo = region.lfos[idx];
        modulation.removeLfo(lfo.id);
        region.lfos.splice(idx, 1);
      }
    } else {
      const idx = region.envelopes.findIndex((e) => e.id === modulator.id);
      if (idx >= 0) {
        const env = region.envelopes[idx];
        modulation.removeEnvelope(env.id);
        region.envelopes.splice(idx, 1);
      }
    }

    const remaining = region.lfos.length + region.envelopes.length;
    if (remaining <= 0) {
      removeRegion(regionId);
      return;
    }

    if (selectedRegionId === regionId && selectedModulator?.id === modulator.id && selectedModulator?.kind === modulator.kind) {
      ensureSelectedModulatorForRegion(region);
    }

    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
    options.onRegionUpdated?.(regionId);
  };

  const removeRegion = (regionId: string) => {
    const region = regionsById.get(regionId);
    if (!region) return;
    for (const lfo of region.lfos) modulation.removeLfo(lfo.id);
    for (const env of region.envelopes) modulation.removeEnvelope(env.id);
    regionsById.delete(regionId);
    if (selectedRegionId === regionId) {
      selectedRegionId = null;
      selectedModulator = null;
      options.onRegionSelected?.(null);
    }
    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
    options.onRegionRemoved?.(regionId);
  };

  const showRegionContextMenu = (clientX: number, clientY: number, regionId: string) => {
    const region = regionsById.get(regionId);
    if (!region) return;
    lfoContextMenu.textContent = '';

    const addLfoBtn = document.createElement('button');
    addLfoBtn.type = 'button';
    addLfoBtn.textContent = 'Add LFO to region';
    addLfoBtn.addEventListener('click', () => {
      addModulatorToRegion(region, 'lfo');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(addLfoBtn);

    const addEnvBtn = document.createElement('button');
    addEnvBtn.type = 'button';
    addEnvBtn.textContent = 'Add Envelope to region';
    addEnvBtn.addEventListener('click', () => {
      addModulatorToRegion(region, 'envelope');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(addEnvBtn);

    const fullTrackBtn = document.createElement('button');
    fullTrackBtn.type = 'button';
    fullTrackBtn.textContent = 'Set to full track (0 → end)';
    const duration = audioDurationSeconds;
    fullTrackBtn.disabled = duration === null || !isFinite(duration);
    fullTrackBtn.addEventListener('click', () => {
      const end = duration ?? region.endSeconds ?? 0;
      applyRegionTimeWindow(region, 0, end, 'floor', 'ceil');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(fullTrackBtn);

    const duplicateBtn = document.createElement('button');
    duplicateBtn.type = 'button';
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.addEventListener('click', () => {
      duplicateRegion(regionId);
      hideContextMenu();
    });
    lfoContextMenu.appendChild(duplicateBtn);

    const duplicateNextBtn = document.createElement('button');
    duplicateNextBtn.type = 'button';
    duplicateNextBtn.textContent = 'Duplicate next';
    duplicateNextBtn.addEventListener('click', () => {
      duplicateRegionNext(regionId);
      hideContextMenu();
    });
    lfoContextMenu.appendChild(duplicateNextBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete region';
    deleteBtn.addEventListener('click', () => {
      removeRegion(regionId);
      hideContextMenu();
    });
    lfoContextMenu.appendChild(deleteBtn);

    lfoContextMenu.style.left = `${clientX}px`;
    lfoContextMenu.style.top = `${clientY}px`;
    lfoContextMenu.style.display = 'block';
  };

  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  type DraggedModulatorPayload = { fromRegionId: string; kind: TimelineEventKind; id: string };
  let draggingModulator: DraggedModulatorPayload | null = null;

  const clearRegionListDragOver = () => {
    for (const el of Array.from(lfoList.querySelectorAll('.lfo-item.drag-over'))) {
      el.classList.remove('drag-over');
    }
  };

  const readDraggedModulator = (e: DragEvent): DraggedModulatorPayload | null => {
    if (draggingModulator) return draggingModulator;
    const dt = e.dataTransfer;
    if (!dt) return null;
    const raw =
      dt.getData('application/x-pipes-modulator') ||
      dt.getData('text/plain') ||
      '';
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<DraggedModulatorPayload>;
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.fromRegionId !== 'string') return null;
      if (parsed.kind !== 'lfo' && parsed.kind !== 'envelope') return null;
      if (typeof parsed.id !== 'string') return null;
      return parsed as DraggedModulatorPayload;
    } catch {
      return null;
    }
  };

  const moveModulatorBetweenRegions = (payload: DraggedModulatorPayload, toRegionId: string) => {
    const from = regionsById.get(payload.fromRegionId);
    const to = regionsById.get(toRegionId);
    if (!from || !to) return;
    if (from.id === to.id) return;

    let moved: TimelineLfo | TimelineEnvelope | null = null;

    if (payload.kind === 'lfo') {
      const idx = from.lfos.findIndex((l) => l.id === payload.id);
      if (idx < 0) return;
      moved = from.lfos.splice(idx, 1)[0] ?? null;
      if (moved) {
        moved.startSeconds = to.startSeconds;
        moved.endSeconds = to.endSeconds;
        to.lfos.push(moved as TimelineLfo);
      }
    } else {
      const idx = from.envelopes.findIndex((env) => env.id === payload.id);
      if (idx < 0) return;
      moved = from.envelopes.splice(idx, 1)[0] ?? null;
      if (moved) {
        moved.startSeconds = to.startSeconds;
        moved.endSeconds = to.endSeconds;
        to.envelopes.push(moved as TimelineEnvelope);
      }
    }
    if (!moved) return;

    const fromNowEmpty = from.lfos.length + from.envelopes.length <= 0;
    if (fromNowEmpty) {
      regionsById.delete(from.id);
      options.onRegionRemoved?.(from.id);
    } else {
      options.onRegionUpdated?.(from.id);
    }
    options.onRegionUpdated?.(to.id);

    // If the moved modulator was selected, keep it selected in its new region.
    if (
      selectedRegionId === from.id &&
      selectedModulator?.kind === payload.kind &&
      selectedModulator?.id === payload.id
    ) {
      selectModulatorInRegion(to.id, { kind: payload.kind, id: payload.id });
      return;
    }

    // If the selected region was deleted by moving the last modulator out, keep selection sensible.
    if (fromNowEmpty && selectedRegionId === from.id) {
      selectRegion(to.id);
      return;
    }

    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
  };

  type RegionDragMode = 'move' | 'resize-start' | 'resize-end';
  type RegionDragState = {
    regionId: string;
    mode: RegionDragMode;
    startClientX: number;
    originStart: number;
    originEnd: number;
    secondsPerPx: number;
  };

  let regionDrag: RegionDragState | null = null;

  const REGION_ROW_HEIGHT_PX = 22;
  const REGION_LANES_MAX_HEIGHT_PX = 160;

  const beginRegionDrag = (regionId: string, mode: RegionDragMode, secondsPerPx: number, e: PointerEvent) => {
    const region = regionsById.get(regionId);
    if (!region) return;
    e.preventDefault();
    e.stopPropagation();
    hideContextMenu();
    selectRegion(regionId);
    regionDrag = {
      regionId,
      mode,
      startClientX: e.clientX,
      originStart: region.startSeconds,
      originEnd: region.endSeconds,
      secondsPerPx,
    };
  };

  const packRegionsIntoRows = (regions: TimelineRegion[]) => {
    const sorted = regions
      .slice()
      .sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds || a.id.localeCompare(b.id));
    const rowsEnd: number[] = [];
    const rowByRegionId = new Map<string, number>();
    for (const region of sorted) {
      let row = -1;
      for (let i = 0; i < rowsEnd.length; i++) {
        const rowEnd = rowsEnd[i] ?? -Infinity;
        if (region.startSeconds >= rowEnd - 1e-6) {
          row = i;
          break;
        }
      }
      if (row < 0) {
        row = rowsEnd.length;
        rowsEnd.push(region.endSeconds);
      } else {
        rowsEnd[row] = Math.max(rowsEnd[row] ?? -Infinity, region.endSeconds);
      }
      rowByRegionId.set(region.id, row);
    }
    return { rowByRegionId, rowCount: rowsEnd.length };
  };

  const renderRegionLanes = () => {
    zoomviewRegionLanesOverlay.textContent = '';

    // Lanes are aligned to the zoomview so they match the main waveform timeline.
    const laneView = peaks?.views.getView('zoomview') ?? null;
    if (!laneView) {
      zoomviewRegionLanesOverlay.style.display = 'none';
      return;
    }

    const viewStart = laneView.getStartTime();
    const viewEnd = laneView.getEndTime();
    const laneAny = laneView as any;
    const viewWidthPx =
      (typeof laneAny.getWidth === 'function' ? Number(laneAny.getWidth()) : 0) ||
      zoomviewContainer.clientWidth ||
      Math.round(zoomviewContainer.getBoundingClientRect().width);
    if (!isFinite(viewStart) || !isFinite(viewEnd) || viewEnd <= viewStart || viewWidthPx <= 0) {
      zoomviewRegionLanesOverlay.style.display = 'none';
      return;
    }

    const regions = Array.from(regionsById.values());
    if (regions.length === 0) {
      zoomviewRegionLanesOverlay.style.display = 'none';
      return;
    }

    const { rowByRegionId, rowCount } = packRegionsIntoRows(regions);
    const safeRowCount = Math.max(1, rowCount);
    // Avoid vertical scrollbars (which can steal horizontal width and cause alignment drift).
    // Instead, compress rows to always fit inside the max overlay height.
    // NOTE: Keep a minimum tall enough to show a visible bar even with top/bottom insets.
    const rowHeightPx = Math.max(
      10,
      Math.min(REGION_ROW_HEIGHT_PX, Math.floor(REGION_LANES_MAX_HEIGHT_PX / safeRowCount))
    );
    const contentHeight = safeRowCount * rowHeightPx;
    zoomviewRegionLanesOverlay.style.display = 'block';
    zoomviewRegionLanesOverlay.style.height = `${contentHeight}px`;

    const timeToOffset = (timeSeconds: number) => {
      if (typeof laneAny.timeToPixelOffset === 'function') {
        return Number(laneAny.timeToPixelOffset(timeSeconds));
      }
      // Fallback: linear mapping over the visible time span.
      const t = (timeSeconds - viewStart) / (viewEnd - viewStart);
      return t * viewWidthPx;
    };

    const secondsPerPx =
      typeof laneAny.pixelsToTime === 'function'
        ? Number(laneAny.pixelsToTime(1))
        : (viewEnd - viewStart) / Math.max(1, viewWidthPx);

    const rows: HTMLDivElement[] = [];
    for (let i = 0; i < safeRowCount; i++) {
      const row = document.createElement('div');
      row.className = 'region-lane-row';
      row.style.height = `${rowHeightPx}px`;
      row.style.width = `${viewWidthPx}px`;
      zoomviewRegionLanesOverlay.appendChild(row);
      rows.push(row);
    }

    for (const region of regions) {
      const rowIdx = rowByRegionId.get(region.id) ?? 0;
      const row = rows[Math.max(0, Math.min(rows.length - 1, rowIdx))];
      if (!row) continue;

      const leftRaw = timeToOffset(region.startSeconds);
      const rightRaw = timeToOffset(region.endSeconds);
      const left = Math.max(0, leftRaw);
      const right = Math.min(viewWidthPx, rightRaw);
      if (right <= 0 || left >= viewWidthPx) continue;
      const width = Math.max(1, right - left);

      const block = document.createElement('div');
      const selected = region.id === selectedRegionId;
      block.className = `region-block${selected ? ' selected' : ''}`;
      block.style.left = `${left}px`;
      block.style.width = `${width}px`;
      // When row height gets compressed, reduce the inner inset so bars stay visible.
      const inset = Math.max(1, Math.min(3, Math.floor(rowHeightPx / 5)));
      block.style.top = `${inset}px`;
      block.style.bottom = `${inset}px`;
      block.title = `${fmtTime(region.startSeconds)} → ${fmtTime(region.endSeconds)}`;

      const modCount = region.lfos.length + region.envelopes.length;
      const label = document.createElement('div');
      label.className = 'region-label';
      label.textContent = `${modCount} mod${modCount === 1 ? '' : 's'}`;
      if (rowHeightPx < 14) {
        label.style.display = 'none';
      }
      block.appendChild(label);

      block.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRegion(region.id);
      });
      block.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectRegion(region.id);
        showRegionContextMenu(e.clientX, e.clientY, region.id);
      });

      if (selected) {
        const startHandle = document.createElement('div');
        startHandle.className = 'region-handle start';
        block.appendChild(startHandle);

        const endHandle = document.createElement('div');
        endHandle.className = 'region-handle end';
        block.appendChild(endHandle);

        block.addEventListener('pointerdown', (e) => beginRegionDrag(region.id, 'move', secondsPerPx, e));
        startHandle.addEventListener('pointerdown', (e) => beginRegionDrag(region.id, 'resize-start', secondsPerPx, e));
        endHandle.addEventListener('pointerdown', (e) => beginRegionDrag(region.id, 'resize-end', secondsPerPx, e));
      }

      row.appendChild(block);
    }
  };

  const onRegionPointerMove = (e: PointerEvent) => {
    const drag = regionDrag;
    if (!drag) return;
    const region = regionsById.get(drag.regionId);
    if (!region) return;
    e.preventDefault();

    const dx = e.clientX - drag.startClientX;
    const dt = dx * drag.secondsPerPx;

    let nextStart = drag.originStart;
    let nextEnd = drag.originEnd;
    if (drag.mode === 'move') {
      nextStart = drag.originStart + dt;
      nextEnd = drag.originEnd + dt;
    } else if (drag.mode === 'resize-start') {
      nextStart = drag.originStart + dt;
    } else {
      nextEnd = drag.originEnd + dt;
    }

    applyRegionTimeWindow(region, nextStart, nextEnd, 'round', 'round');
  };

  const onRegionPointerUp = () => {
    regionDrag = null;
  };

  window.addEventListener('pointermove', onRegionPointerMove);
  window.addEventListener('pointerup', onRegionPointerUp);

  const renderLfoList = () => {
    lfoList.textContent = '';

    const header = document.createElement('div');
    header.className = 'lfo-list-header';
    const title = document.createElement('span');
    title.textContent = 'Regions';
    header.appendChild(title);
    const initialBtn = document.createElement('button');
    initialBtn.type = 'button';
    initialBtn.className = 'lfo-list-initial';
    initialBtn.textContent = 'Initial values';
    if (!selectedRegionId) {
      initialBtn.classList.add('selected');
    }
    initialBtn.addEventListener('click', () => selectRegion(null));
    header.appendChild(initialBtn);
    lfoList.appendChild(header);

    const regions = Array.from(regionsById.values()).sort((a, b) => a.startSeconds - b.startSeconds);
    if (!regions.length) {
      const empty = document.createElement('div');
      empty.className = 'lfo-empty';
      empty.textContent = 'No regions yet — right click the waveform to add one.';
      lfoList.appendChild(empty);
      return;
    }

    for (const region of regions) {
      const item = document.createElement('div');
      item.className = `lfo-item${region.id === selectedRegionId ? ' selected' : ''}`;

      const title = document.createElement('div');
      title.className = 'lfo-title';
      const modCount = region.lfos.length + region.envelopes.length;
      title.textContent = `${modCount} mod${modCount === 1 ? '' : 's'}`;
      item.appendChild(title);

      const times = document.createElement('div');
      times.className = 'lfo-times';
      times.textContent = `${fmtTime(region.startSeconds)} → ${fmtTime(region.endSeconds)}`;
      item.appendChild(times);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'lfo-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRegion(region.id);
      });
      item.appendChild(removeBtn);

      const mods = document.createElement('div');
      mods.className = 'region-modulators';

      const addModEntry = (kind: TimelineEventKind, id: string, labelText: string) => {
        const mod = document.createElement('div');
        const isSelected =
          region.id === selectedRegionId &&
          selectedModulator?.kind === kind &&
          selectedModulator?.id === id;
        mod.className = `region-mod${isSelected ? ' selected' : ''}`;
        mod.draggable = true;
        const text = document.createElement('span');
        text.textContent = labelText;
        mod.appendChild(text);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'region-mod-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeModulatorFromRegion(region.id, { kind, id });
        });
        removeBtn.draggable = false;
        mod.appendChild(removeBtn);
        mod.addEventListener('click', (e) => {
          e.stopPropagation();
          selectModulatorInRegion(region.id, { kind, id });
        });
        mod.addEventListener('dragstart', (e) => {
          const evt = e as DragEvent;
          const payload: DraggedModulatorPayload = { fromRegionId: region.id, kind, id };
          draggingModulator = payload;
          mod.classList.add('dragging');
          const dt = evt.dataTransfer;
          if (dt) {
            dt.effectAllowed = 'move';
            const json = JSON.stringify(payload);
            dt.setData('application/x-pipes-modulator', json);
            dt.setData('text/plain', json);
          }
          clearRegionListDragOver();
        });
        mod.addEventListener('dragend', () => {
          draggingModulator = null;
          mod.classList.remove('dragging');
          clearRegionListDragOver();
        });
        mods.appendChild(mod);
      };

      for (const lfo of region.lfos) {
        const target = modulation.getTarget(lfo.targetId);
        addModEntry('lfo', lfo.id, `LFO • ${target ? target.label : lfo.targetId}`);
      }
      for (const env of region.envelopes) {
        const target = modulation.getTarget(env.targetId);
        addModEntry('envelope', env.id, `ENV • ${target ? target.label : env.targetId}`);
      }

      item.appendChild(mods);

      item.addEventListener('dragover', (e) => {
        const evt = e as DragEvent;
        const payload = readDraggedModulator(evt);
        if (!payload) return;
        if (payload.fromRegionId === region.id) return;
        e.preventDefault();
        (evt.dataTransfer as DataTransfer | null)?.dropEffect && ((evt.dataTransfer as DataTransfer).dropEffect = 'move');
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      item.addEventListener('drop', (e) => {
        const evt = e as DragEvent;
        const payload = readDraggedModulator(evt);
        item.classList.remove('drag-over');
        clearRegionListDragOver();
        if (!payload) return;
        e.preventDefault();
        e.stopPropagation();
        moveModulatorBetweenRegions(payload, region.id);
      });

      item.addEventListener('click', () => selectRegion(region.id));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectRegion(region.id);
        showRegionContextMenu(e.clientX, e.clientY, region.id);
      });

      lfoList.appendChild(item);
    }
  };

  const renderInitialValuesEditor = () => {
    const header = document.createElement('div');
    header.className = 'initial-values-title';
    header.textContent = 'Initial values (00:00:00)';
    lfoEditor.appendChild(header);

    const hint = document.createElement('div');
    hint.className = 'initial-values-hint';
    hint.textContent = 'Edit base values used at the start of the timeline.';
    lfoEditor.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'initial-values-actions';

    const captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.textContent = 'Capture current values';
    captureBtn.addEventListener('click', () => {
      for (const target of getSortedTargets()) {
        const current = target.getCurrent();
        if (!isFinite(current)) continue;
        modulation.setBaseValue(target.id, current);
      }
      renderLfoEditor();
    });
    actions.appendChild(captureBtn);

    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.textContent = 'Jump 00:00';
    jumpBtn.addEventListener('click', () => {
      if (peaks) {
        peaks.player.pause();
        const seek = (peaks.player as any)?.seek;
        if (typeof seek === 'function') {
          seek.call(peaks.player, 0);
        }
      }
      audioEl.currentTime = 0;
      updatePlayBtn();
    });
    actions.appendChild(jumpBtn);

    lfoEditor.appendChild(actions);

    const targets = getSortedTargets();
    const grouped = new Map<string, ModulationTarget[]>();
    for (const target of targets) {
      const group = target.group ?? 'Other';
      const bucket = grouped.get(group) ?? [];
      bucket.push(target);
      grouped.set(group, bucket);
    }

    const groupNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
    for (const groupName of groupNames) {
      const group = document.createElement('div');
      group.className = 'initial-values-group';
      const groupTitle = document.createElement('div');
      groupTitle.className = 'initial-values-group-title';
      groupTitle.textContent = groupName;
      group.appendChild(groupTitle);

      const items = grouped.get(groupName) ?? [];
      for (const target of items) {
        const row = document.createElement('label');
        row.className = 'initial-values-row';
        const text = document.createElement('span');
        text.textContent = target.label;
        row.appendChild(text);

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        if (target.min !== undefined) input.min = String(target.min);
        if (target.max !== undefined) input.max = String(target.max);

        const syncValue = () => {
          const base = modulation.getBaseValue(target.id);
          const value = typeof base === 'number' && isFinite(base) ? base : target.getCurrent();
          input.value = String(value);
        };
        syncValue();

        input.addEventListener('change', () => {
          const raw = Number(input.value);
          if (!isFinite(raw)) {
            syncValue();
            return;
          }
          let next = raw;
          if (target.min !== undefined) next = Math.max(target.min, next);
          if (target.max !== undefined) next = Math.min(target.max, next);
          input.value = String(next);
          target.apply(next);
          modulation.setBaseValue(target.id, next);
        });

        row.appendChild(input);
        group.appendChild(row);
      }
      lfoEditor.appendChild(group);
    }
  };

  const renderLfoEditor = () => {
    lfoEditor.textContent = '';
    if (!selectedRegionId) {
      renderInitialValuesEditor();
      return;
    }
    const region = regionsById.get(selectedRegionId) ?? null;
    if (!region) {
      renderInitialValuesEditor();
      return;
    }
    ensureSelectedModulatorForRegion(region);
    const selection = selectedModulator;
    if (!selection) return;
    const lfo = selection.kind === 'lfo' ? region.lfos.find((l) => l.id === selection.id) ?? null : null;
    const env = selection.kind === 'envelope' ? region.envelopes.find((e) => e.id === selection.id) ?? null : null;
    if (!lfo && !env) return;

    const addRow = (labelText: string, input: HTMLElement) => {
      const row = document.createElement('label');
      row.className = 'lfo-row';
      const text = document.createElement('span');
      text.textContent = labelText;
      row.appendChild(text);
      row.appendChild(input);
      lfoEditor.appendChild(row);
      return input;
    };

    const targets = getSortedTargets();
    const waveOpts: Array<{ label: string; value: Waveform }> = [
      { label: 'Sine', value: 'sine' },
      { label: 'Triangle', value: 'triangle' },
      { label: 'Square', value: 'square' },
      { label: 'Saw', value: 'saw' },
      { label: 'Noise', value: 'noise' },
      { label: 'Sample & Hold', value: 'sampleHold' },
      { label: 'Exp decay', value: 'expDecay' },
      { label: 'Inv exp decay', value: 'invExpDecay' },
      { label: 'Exp2 decay', value: 'exp2Decay' },
      { label: 'Inv exp2 decay', value: 'invExp2Decay' },
    ];
    if (lfo) {
      let schedulePreviewDraw = () => {};

      const header = document.createElement('div');
      header.className = 'lfo-editor-title';
      const title = document.createElement('span');
      title.textContent = `LFO ${lfo.id}`;
      header.appendChild(title);

      const convertBtn = document.createElement('button');
      convertBtn.type = 'button';
      convertBtn.className = 'lfo-convert';
      convertBtn.textContent = 'Convert → ENV';
      convertBtn.addEventListener('click', () => convertSelectedEvent('envelope'));
      header.appendChild(convertBtn);
      lfoEditor.appendChild(header);

      const enabledInput = document.createElement('input');
      enabledInput.type = 'checkbox';
      enabledInput.checked = lfo.enabled;
      enabledInput.addEventListener('change', () => {
        lfo.enabled = enabledInput.checked;
      });
      addRow('Enabled', enabledInput);

      const startInput = document.createElement('input');
      startInput.type = 'number';
      startInput.step = '0.01';
      startInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        startInput.max = String(audioDurationSeconds);
      }
      startInput.value = String(region.startSeconds);
      startInput.addEventListener('change', () => {
        const nextStart = Number(startInput.value) || 0;
        applyRegionTimeWindow(region, nextStart, region.endSeconds, 'floor', 'ceil');
      });
      addRow('Start (s)', startInput);

      const endInput = document.createElement('input');
      endInput.type = 'number';
      endInput.step = '0.01';
      endInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        endInput.max = String(audioDurationSeconds);
      }
      endInput.value = String(region.endSeconds);
      endInput.addEventListener('change', () => {
        const nextEnd = Number(endInput.value) || 0;
        applyRegionTimeWindow(region, region.startSeconds, nextEnd, 'floor', 'ceil');
      });
      addRow('End (s)', endInput);

      const targetSelect = document.createElement('select');
      for (const t of targets) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.group ? `${t.group} • ` : ''}${t.label}`;
        targetSelect.appendChild(opt);
      }
      targetSelect.value = lfo.targetId;
      targetSelect.addEventListener('change', () => {
        lfo.targetId = targetSelect.value;
        renderLfoList();
        renderLfoEditor();
      });
      addRow('Target', targetSelect);

      const waveSelect = document.createElement('select');
      for (const w of waveOpts) {
        const opt = document.createElement('option');
        opt.value = w.value;
        opt.textContent = w.label;
        waveSelect.appendChild(opt);
      }
      waveSelect.value = lfo.wave;
      waveSelect.addEventListener('change', () => {
        lfo.wave = waveSelect.value as Waveform;
        schedulePreviewDraw();
      });
      addRow('Wave', waveSelect);

      const approxEq = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
      const presetButtons: Array<{ value: number; btn: HTMLButtonElement }> = [];
      const updatePresetSelections = () => {
        for (const { value, btn } of presetButtons) {
          btn.classList.toggle('selected', approxEq(lfo.bpmCoefficient, value));
        }
      };
      const setBpmCoeff = (value: number) => {
        lfo.bpmCoefficient = Math.max(1e-6, value);
        updatePresetSelections();
        schedulePreviewDraw();
      };

      const addPresetRow = (labelText: string, presets: Array<{ label: string; value: number }>) => {
        const group = document.createElement('div');
        group.className = 'lfo-presets';
        for (const p of presets) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lfo-preset';
          btn.textContent = p.label;
          btn.addEventListener('click', () => setBpmCoeff(p.value));
          group.appendChild(btn);
          presetButtons.push({ value: p.value, btn });
        }
        addRow(labelText, group);
      };

      const basePresets: Array<{ label: string; value: number }> = [
        { label: '1/16', value: 1 / 16 },
        { label: '1/8', value: 1 / 8 },
        { label: '1/4', value: 1 / 4 },
        { label: '1/2', value: 1 / 2 },
        { label: '1/1', value: 1 },
        { label: '2/1', value: 2 },
        { label: '4/1', value: 4 },
        { label: '8/1', value: 8 },
      ];
      const dottedPresets: Array<{ label: string; value: number }> = [
        { label: '1/16.', value: (1 / 16) * 1.5 },
        { label: '1/8.', value: (1 / 8) * 1.5 },
        { label: '1/4.', value: (1 / 4) * 1.5 },
        { label: '1/2.', value: (1 / 2) * 1.5 },
        { label: '1/1.', value: 1 * 1.5 },
        { label: '2/1.', value: 2 * 1.5 },
        { label: '4/1.', value: 4 * 1.5 },
        { label: '8/1.', value: 8 * 1.5 },
      ];
      const tripletPresets: Array<{ label: string; value: number }> = [
        { label: '1/16t', value: (1 / 16) * (2 / 3) },
        { label: '1/8t', value: (1 / 8) * (2 / 3) },
        { label: '1/4t', value: (1 / 4) * (2 / 3) },
        { label: '1/2t', value: (1 / 2) * (2 / 3) },
        { label: '1/1t', value: 1 * (2 / 3) },
        { label: '2/1t', value: 2 * (2 / 3) },
        { label: '4/1t', value: 4 * (2 / 3) },
        { label: '8/1t', value: 8 * (2 / 3) },
      ];
      addPresetRow('Quick', basePresets);
      addPresetRow('Dotted', dottedPresets);
      addPresetRow('Triplet', tripletPresets);
      updatePresetSelections();

      const phaseInput = document.createElement('input');
      phaseInput.type = 'number';
      phaseInput.step = '0.001';
      phaseInput.min = '0';
      phaseInput.max = String(Math.PI * 2);
      phaseInput.value = String(lfo.phase);
      phaseInput.addEventListener('change', () => {
        lfo.phase = Number(phaseInput.value) || 0;
        schedulePreviewDraw();
      });
      addRow('Phase (rad)', phaseInput);

      const rangeDisplay = document.createElement('div');
      rangeDisplay.className = 'lfo-range';
      lfoEditor.appendChild(rangeDisplay);

      const rangeMinInput = document.createElement('input');
      rangeMinInput.type = 'number';
      rangeMinInput.step = '0.01';

      const rangeMaxInput = document.createElement('input');
      rangeMaxInput.type = 'number';
      rangeMaxInput.step = '0.01';

      const applyDeltaRange = (deltaMin: number, deltaMax: number) => {
        if (!isFinite(deltaMin) || !isFinite(deltaMax)) return;
        let min = deltaMin;
        let max = deltaMax;
        if (min > max) {
          const tmp = min;
          min = max;
          max = tmp;
        }
        const target = modulation.getTarget(lfo.targetId);
        const rawScale = target ? getTargetScale(target) : 1;
        const scale = isFinite(rawScale) && Math.abs(rawScale) > 1e-9 ? rawScale : 1;

        let offsetAbs: number;
        let amountAbs: number;
        if (lfo.bipolar) {
          offsetAbs = (min + max) * 0.5;
          amountAbs = (max - min) * 0.5;
        } else {
          offsetAbs = min;
          amountAbs = max - min;
        }
        lfo.offset = offsetAbs / scale;
        lfo.amount = Math.max(0, amountAbs / scale);
      };

      const getLfoBaseValue = () => {
        const target = modulation.getTarget(lfo.targetId);
        const base = modulation.getBaseValue(lfo.targetId);
        const baseValue =
          typeof base === 'number' && isFinite(base) ? base : target ? target.getCurrent() : 0;
        return isFinite(baseValue) ? baseValue : 0;
      };

      const updateRangeBounds = () => {
        const target = modulation.getTarget(lfo.targetId);
        const min = target?.min;
        const max = target?.max;
        if (min !== undefined) {
          rangeMinInput.min = String(min);
          rangeMaxInput.min = String(min);
        } else {
          rangeMinInput.removeAttribute('min');
          rangeMaxInput.removeAttribute('min');
        }
        if (max !== undefined) {
          rangeMinInput.max = String(max);
          rangeMaxInput.max = String(max);
        } else {
          rangeMinInput.removeAttribute('max');
          rangeMaxInput.removeAttribute('max');
        }
      };

      const bipolarInput = document.createElement('input');
      bipolarInput.type = 'checkbox';
      bipolarInput.checked = lfo.bipolar;
      bipolarInput.addEventListener('change', () => {
        // Preserve the current Δ range when switching modes.
        const before = computeDeltaRange(lfo);
        lfo.bipolar = bipolarInput.checked;
        applyDeltaRange(before.min, before.max);
        updateRangeDisplay();
        schedulePreviewDraw();
      });
      addRow('Bipolar', bipolarInput);

      const smoothInput = document.createElement('input');
      smoothInput.type = 'number';
      smoothInput.step = '0.01';
      smoothInput.min = '0';
      smoothInput.max = '4';
      smoothInput.value = String(lfo.smoothSeconds);
      smoothInput.addEventListener('change', () => {
        lfo.smoothSeconds = Math.max(0, Number(smoothInput.value) || 0);
        schedulePreviewDraw();
      });
      addRow('Smooth (s)', smoothInput);

      const preview = document.createElement('div');
      preview.className = 'mod-preview';
      const canvas = document.createElement('canvas');
      canvas.className = 'mod-preview-canvas';
      preview.appendChild(canvas);
      lfoEditor.appendChild(preview);

      schedulePreviewDraw = () => {
        // Defer to next frame so layout (clientWidth) is available.
        requestAnimationFrame(() => {
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

          // Background
          ctx.clearRect(0, 0, cssW, cssH);
          ctx.fillStyle = 'rgba(8, 12, 18, 0.65)';
          ctx.fillRect(0, 0, cssW, cssH);

          // Preview should always render a fixed 8/1 window (8 bars) so changing
          // the LFO length (bpmCoefficient) doesn't change the preview waveform.
          const PREVIEW_BARS = 8;
          const startTime = 0;
          const duration = Math.max(1e-6, barSeconds() * PREVIEW_BARS);
          const samples = 220;
          const dt = duration / Math.max(1, samples - 1);

          const beatsPerSecond = bpm / 60;
          const beatsPerBar = 4;
          const coeff = PREVIEW_BARS; // 8/1
          const effectiveFreq =
            coeff > 0 ? beatsPerSecond / (beatsPerBar * coeff) : 0;

          const rng = mulberry32(hashStringToSeed(lfo.id));
          let lastValue = 0;
          let holdValue = rng() * 2 - 1;
          let lastHoldTime = startTime;
          const smooth = Math.max(0, lfo.smoothSeconds);

          const baseValue = getLfoBaseValue();
          const { min: deltaMinRaw, max: deltaMaxRaw, scale } = computeDeltaRange(lfo);
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
          // Slight padding so the line doesn't touch edges
          const padY = 6;
          const denom = absMax - absMin;
          const yFor = (v: number) => {
            const t = denom !== 0 ? (v - absMin) / denom : 0.5;
            const clamped = Math.min(1, Math.max(0, t));
            return padY + (1 - clamped) * (cssH - padY * 2);
          };

          // Grid: base value (0 delta) if in range
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
        });
      };

      rangeMinInput.addEventListener('change', () => {
        const minAbsRaw = Number(rangeMinInput.value);
        const maxAbsRaw = Number(rangeMaxInput.value);
        if (!isFinite(minAbsRaw) || !isFinite(maxAbsRaw)) {
          updateRangeDisplay();
          return;
        }
        updateRangeBounds();
        const target = modulation.getTarget(lfo.targetId);
        let minAbs = minAbsRaw;
        let maxAbs = maxAbsRaw;
        if (target?.min !== undefined) {
          minAbs = Math.max(target.min, minAbs);
          maxAbs = Math.max(target.min, maxAbs);
        }
        if (target?.max !== undefined) {
          minAbs = Math.min(target.max, minAbs);
          maxAbs = Math.min(target.max, maxAbs);
        }
        if (minAbs > maxAbs) {
          const tmp = minAbs;
          minAbs = maxAbs;
          maxAbs = tmp;
        }
        const base = getLfoBaseValue();
        applyDeltaRange(minAbs - base, maxAbs - base);
        updateRangeDisplay();
        schedulePreviewDraw();
      });

      rangeMaxInput.addEventListener('change', () => {
        const minAbsRaw = Number(rangeMinInput.value);
        const maxAbsRaw = Number(rangeMaxInput.value);
        if (!isFinite(minAbsRaw) || !isFinite(maxAbsRaw)) {
          updateRangeDisplay();
          return;
        }
        updateRangeBounds();
        const target = modulation.getTarget(lfo.targetId);
        let minAbs = minAbsRaw;
        let maxAbs = maxAbsRaw;
        if (target?.min !== undefined) {
          minAbs = Math.max(target.min, minAbs);
          maxAbs = Math.max(target.min, maxAbs);
        }
        if (target?.max !== undefined) {
          minAbs = Math.min(target.max, minAbs);
          maxAbs = Math.min(target.max, maxAbs);
        }
        if (minAbs > maxAbs) {
          const tmp = minAbs;
          minAbs = maxAbs;
          maxAbs = tmp;
        }
        const base = getLfoBaseValue();
        applyDeltaRange(minAbs - base, maxAbs - base);
        updateRangeDisplay();
        schedulePreviewDraw();
      });

      addRow('Min', rangeMinInput);
      addRow('Max', rangeMaxInput);

      const updateRangeDisplay = () => {
        updateRangeBounds();
        const base = getLfoBaseValue();
        const { min, max, target } = computeDeltaRange(lfo);
        const fmt = (v: number) => v.toFixed(3);
        const absMin = base + min;
        const absMax = base + max;
        rangeDisplay.textContent =
          `Range: ${fmt(absMin)} … ${fmt(absMax)}` +
          `  |  Δ: ${fmt(min)} … ${fmt(max)}` +
          `${target ? ` (${target.label})` : ''}`;
        // Keep the inputs in sync unless the user is actively editing one.
        if (document.activeElement !== rangeMinInput) {
          rangeMinInput.value = String(Number.isFinite(absMin) ? absMin : 0);
        }
        if (document.activeElement !== rangeMaxInput) {
          rangeMaxInput.value = String(Number.isFinite(absMax) ? absMax : 0);
        }
        schedulePreviewDraw();
      };
      updateRangeDisplay();
      return;
    }

    if (env) {
      let schedulePreviewDraw = () => {};

      const header = document.createElement('div');
      header.className = 'lfo-editor-title';
      const title = document.createElement('span');
      title.textContent = `Envelope ${env.id}`;
      header.appendChild(title);

      const convertBtn = document.createElement('button');
      convertBtn.type = 'button';
      convertBtn.className = 'lfo-convert';
      convertBtn.textContent = 'Convert → LFO';
      convertBtn.addEventListener('click', () => convertSelectedEvent('lfo'));
      header.appendChild(convertBtn);
      lfoEditor.appendChild(header);

      const enabledInput = document.createElement('input');
      enabledInput.type = 'checkbox';
      enabledInput.checked = env.enabled;
      enabledInput.addEventListener('change', () => {
        env.enabled = enabledInput.checked;
      });
      addRow('Enabled', enabledInput);

      const startInput = document.createElement('input');
      startInput.type = 'number';
      startInput.step = '0.01';
      startInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        startInput.max = String(audioDurationSeconds);
      }
      startInput.value = String(region.startSeconds);
      startInput.addEventListener('change', () => {
        const nextStart = Number(startInput.value) || 0;
        applyRegionTimeWindow(region, nextStart, region.endSeconds, 'floor', 'ceil');
      });
      addRow('Start (s)', startInput);

      const endInput = document.createElement('input');
      endInput.type = 'number';
      endInput.step = '0.01';
      endInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        endInput.max = String(audioDurationSeconds);
      }
      endInput.value = String(region.endSeconds);
      endInput.addEventListener('change', () => {
        const nextEnd = Number(endInput.value) || 0;
        applyRegionTimeWindow(region, region.startSeconds, nextEnd, 'floor', 'ceil');
      });
      addRow('End (s)', endInput);

      const targetSelect = document.createElement('select');
      for (const t of targets) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.group ? `${t.group} • ` : ''}${t.label}`;
        targetSelect.appendChild(opt);
      }
      targetSelect.value = env.targetId;
      targetSelect.addEventListener('change', () => {
        env.targetId = targetSelect.value;
        renderLfoList();
        renderLfoEditor();
      });
      addRow('Target', targetSelect);

      const waveSelect = document.createElement('select');
      for (const w of waveOpts) {
        const opt = document.createElement('option');
        opt.value = w.value;
        opt.textContent = w.label;
        waveSelect.appendChild(opt);
      }
      waveSelect.value = env.wave;
      waveSelect.addEventListener('change', () => {
        env.wave = waveSelect.value as Waveform;
        schedulePreviewDraw();
      });
      addRow('Wave', waveSelect);

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.step = '0.01';
      minInput.value = String(env.min);

      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.step = '0.01';
      maxInput.value = String(env.max);

      const rangeDisplay = document.createElement('div');
      rangeDisplay.className = 'lfo-range';

      const preview = document.createElement('div');
      preview.className = 'mod-preview';
      const canvas = document.createElement('canvas');
      canvas.className = 'mod-preview-canvas';
      preview.appendChild(canvas);

      const updateBounds = () => {
        const target = modulation.getTarget(env.targetId);
        const min = target?.min;
        const max = target?.max;
        if (min !== undefined) {
          minInput.min = String(min);
          maxInput.min = String(min);
        } else {
          minInput.removeAttribute('min');
          maxInput.removeAttribute('min');
        }
        if (max !== undefined) {
          minInput.max = String(max);
          maxInput.max = String(max);
        } else {
          minInput.removeAttribute('max');
          maxInput.removeAttribute('max');
        }
      };

      const updateRangeDisplay = () => {
        const fmt = (v: number) => v.toFixed(3);
        const target = modulation.getTarget(env.targetId);
        rangeDisplay.textContent = `Range: ${fmt(env.min)} … ${fmt(env.max)}${target ? ` (${target.label})` : ''}`;
      };

      schedulePreviewDraw = () => {
        requestAnimationFrame(() => {
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
        });
      };

      const syncRangeFromInputs = () => {
        const nextMin = Number(minInput.value);
        const nextMax = Number(maxInput.value);
        env.min = isFinite(nextMin) ? nextMin : env.min;
        env.max = isFinite(nextMax) ? nextMax : env.max;
        if (env.min > env.max) {
          const tmp = env.min;
          env.min = env.max;
          env.max = tmp;
          minInput.value = String(env.min);
          maxInput.value = String(env.max);
        }
        updateRangeDisplay();
        schedulePreviewDraw();
      };

      minInput.addEventListener('change', syncRangeFromInputs);
      maxInput.addEventListener('change', syncRangeFromInputs);
      updateBounds();
      updateRangeDisplay();

      addRow('Min', minInput);
      addRow('Max', maxInput);
      lfoEditor.appendChild(rangeDisplay);
      lfoEditor.appendChild(preview);
      schedulePreviewDraw();
    }
  };

  const clearSchedule = () => {
    for (const region of regionsById.values()) {
      for (const lfo of region.lfos) modulation.removeLfo(lfo.id);
      for (const env of region.envelopes) modulation.removeEnvelope(env.id);
    }
    regionsById.clear();
    selectRegion(null);
  };

  const destroyPeaks = (keepAudio = false) => {
    if (peaks) {
      peaks.destroy();
      peaks = null;
    }
    if (!keepAudio && audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
      audioEl.removeAttribute('src');
      audioEl.load();
      audioDurationSeconds = null;
    }
    overviewContainer.textContent = '';
    zoomviewContainer.textContent = '';
    zoomviewContainer.appendChild(zoomviewRegionLanesOverlay);
    zoomviewRegionLanesOverlay.textContent = '';
    zoomviewRegionLanesOverlay.style.display = 'none';
    updateRenderEnabled();
  };

  const updatePlayBtn = () => {
    if (!peaks) {
      playBtn.textContent = 'Play';
      return;
    }
    playBtn.textContent = audioEl.paused ? 'Play' : 'Pause';
  };

  const syncZoomControls = (zoomIndex?: number) => {
    if (!peaks) return;
    const idx = zoomIndex ?? peaks.zoom.getZoom();
    zoomRange.value = String(idx);
  };

  const initPeaks = (audioBuffer: AudioBuffer) => {
    destroyPeaks(true);
    Peaks.init(
      {
        mediaElement: audioEl,
        webAudio: { audioBuffer, multiChannel: false },
        overview: {
          container: overviewContainer,
          enableSegments: false,
          enablePoints: false,
          showAxisLabels: true,
          waveformColor: 'rgba(220, 231, 255, 0.14)',
          playedWaveformColor: 'rgba(220, 231, 255, 0.08)',
        },
        zoomview: {
          container: zoomviewContainer,
          enableSegments: false,
          enablePoints: false,
          wheelMode: 'scroll',
          autoScroll: true,
          showAxisLabels: true,
          waveformColor: 'rgba(220, 231, 255, 0.12)',
          playedWaveformColor: 'rgba(220, 231, 255, 0.06)',
        },
        segmentOptions: {
          overlay: true,
          markers: true,
          overlayOpacity: 0.25,
          overlayBorderWidth: 1,
          overlayColor: '#4fd1ff',
          startMarkerColor: '#4fd1ff',
          endMarkerColor: '#4fd1ff',
        },
        zoomLevels,
        keyboard: true,
      },
      (err, instance) => {
        if (err || !instance) {
          console.error('Peaks init failed', err);
          return;
        }
        peaks = instance;
        // Peaks/Konva may replace the zoomview container contents during init;
        // ensure our DOM overlays are attached *after* Peaks has created its stage.
        zoomviewContainer.appendChild(zoomviewRegionLanesOverlay);
        zoomRange.max = String(zoomLevels.length - 1);
        zoomRange.disabled = false;
        syncZoomControls();
        const zoomView = peaks.views.getView('zoomview');
        zoomView?.setWaveformDragMode('scroll');
        updatePlayBtn();

        peaks.on('player.timeupdate', updatePlayBtn);
        peaks.on('player.pause', updatePlayBtn);
        peaks.on('player.playing', updatePlayBtn);
        peaks.on('zoom.update', () => {
          // Peaks emits zoom.update.currentZoom as the scale (samples-per-pixel), not the zoom index.
          // Keep our slider synced to the actual zoom index.
          syncZoomControls();
          renderRegionLanes();
        });
        peaks.on('zoomview.update', () => {
          renderRegionLanes();
        });

        const onWaveformContextMenu = (event: WaveformViewPointerEvent) => {
          event.evt.preventDefault();
          event.evt.stopPropagation();
          showTimelineContextMenu(event.evt.clientX, event.evt.clientY, event.time);
        };
        peaks.on('zoomview.contextmenu', onWaveformContextMenu);
        peaks.on('overview.contextmenu', onWaveformContextMenu);

        renderRegionLanes();
        renderLfoList();
        renderLfoEditor();
      }
    );
  };

  loadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const token = ++audioLoadToken;
    hideContextMenu();
    destroyPeaks(false);

    renderBtn.disabled = true;
    audioUrl = URL.createObjectURL(file);
    audioFileName = file.name;
    updateAudioLabel();
    audioEl.src = audioUrl;
    audioEl.load();

    const canPlay = new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed to load audio'));
      };
      const cleanup = () => {
        audioEl.removeEventListener('canplay', onCanPlay);
        audioEl.removeEventListener('error', onError);
      };
      audioEl.addEventListener('canplay', onCanPlay);
      audioEl.addEventListener('error', onError);
    });

    const decodeAudio = async () => {
      const encoded = await file.arrayBuffer();
      const ctx = new AudioContext();
      try {
        return await ctx.decodeAudioData(encoded);
      } finally {
        await ctx.close().catch(() => undefined);
      }
    };

    try {
      const [, audioBuffer] = await Promise.all([canPlay, decodeAudio()]);
      if (token !== audioLoadToken) return;
      audioDurationSeconds = isFinite(audioEl.duration) ? audioEl.duration : isFinite(audioBuffer.duration) ? audioBuffer.duration : null;
      updateRenderEnabled();
      initPeaks(audioBuffer);
    } catch (err) {
      console.error('Failed to load MP3 into Peaks', err);
      audioDurationSeconds = isFinite(audioEl.duration) ? audioEl.duration : null;
      updateRenderEnabled();
    }
  });

  bpmInput.addEventListener('change', () => {
    const next = Math.max(10, Number(bpmInput.value) || bpm);
    bpm = next;
    bpmInput.value = String(next);
    options.onBpmChange?.(next);
    // Re-snap all region windows to the new bar duration.
    for (const region of regionsById.values()) {
      const { start, end } = snapRegionWindow(region.startSeconds, region.endSeconds, 'floor', 'ceil');
      region.startSeconds = start;
      region.endSeconds = end;
      for (const lfo of region.lfos) {
        lfo.startSeconds = start;
        lfo.endSeconds = end;
      }
      for (const env of region.envelopes) {
        env.startSeconds = start;
        env.endSeconds = end;
      }
    }
    renderRegionLanes();
    renderLfoList();
    renderLfoEditor();
  });

  zoomOutBtn.addEventListener('click', () => {
    peaks?.zoom.zoomOut();
    syncZoomControls();
  });
  zoomInBtn.addEventListener('click', () => {
    peaks?.zoom.zoomIn();
    syncZoomControls();
  });

  zoomRange.addEventListener('input', () => {
    if (!peaks) return;
    peaks.zoom.setZoom(Math.round(Number(zoomRange.value)));
    syncZoomControls();
  });

  playBtn.addEventListener('click', () => {
    if (!peaks) return;
    if (audioEl.paused) {
      peaks.player.play().catch((err) => console.warn('Play failed', err));
    } else {
      peaks.player.pause();
    }
    updatePlayBtn();
  });

  renderBtn.addEventListener('click', () => {
    const baseDuration =
      audioDurationSeconds !== null && isFinite(audioDurationSeconds) ? audioDurationSeconds : 10;
    const duration = previewToggle.checked ? Math.min(PREVIEW_RENDER_SECONDS, baseDuration) : baseDuration;
    options.onRenderVideo?.(duration);
  });

  saveBtn.addEventListener('click', () => {
    options.onSaveProject?.();
  });

  loadProjectBtn.addEventListener('click', () => {
    projectInput.value = '';
    projectInput.click();
  });

  projectInput.addEventListener('change', async () => {
    const file = projectInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = parseProjectFile(text);
      options.onLoadProject?.(project);
    } catch (err) {
      console.error('Failed to load project', err);
    }
  });

  const fitWaveforms = () => {
    peaks?.views.getView('overview')?.fitToContainer();
    peaks?.views.getView('zoomview')?.fitToContainer();
    renderRegionLanes();
  };

  const resizeObserver = new ResizeObserver(() => fitWaveforms());
  resizeObserver.observe(container);

  return {
    getPeaks: () => peaks,
    getSelectedRegionId: () => selectedRegionId,
    getPlayheadSeconds: () => {
      if (!audioEl.src) return null;
      return audioEl.currentTime;
    },
    getRenderSchedule: (): RenderSchedule | null => {
      if (audioDurationSeconds === null || !isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return null;
      const lfos: LfoConfig[] = Array.from(regionsById.values()).flatMap((region) =>
        region.lfos.map((lfo) => ({
        id: lfo.id,
        targetId: lfo.targetId,
        wave: lfo.wave,
        bpmCoefficient: lfo.bpmCoefficient,
        amount: lfo.amount,
        offset: lfo.offset,
        phase: lfo.phase,
        bipolar: lfo.bipolar,
        smoothSeconds: lfo.smoothSeconds,
        enabled: lfo.enabled,
          startSeconds: region.startSeconds,
          endSeconds: region.endSeconds,
        }))
      );
      const envelopes: EnvelopeConfig[] = Array.from(regionsById.values()).flatMap((region) =>
        region.envelopes.map((env) => ({
        id: env.id,
        targetId: env.targetId,
        wave: env.wave,
        min: env.min,
        max: env.max,
        enabled: env.enabled,
          startSeconds: region.startSeconds,
          endSeconds: region.endSeconds,
        }))
      );
      return { bpm, durationSeconds: audioDurationSeconds, lfos, envelopes, videoResolution };
    },
    getProjectTimeline: (): ProjectTimeline => {
      const lfos = Array.from(regionsById.values()).flatMap((region) =>
        region.lfos.map((lfo) => ({
          segmentId: region.id,
        lfo: {
          id: lfo.id,
          targetId: lfo.targetId,
          wave: lfo.wave,
          bpmCoefficient: lfo.bpmCoefficient,
          amount: lfo.amount,
          offset: lfo.offset,
          phase: lfo.phase,
          bipolar: lfo.bipolar,
          smoothSeconds: lfo.smoothSeconds,
          enabled: lfo.enabled,
            startSeconds: region.startSeconds,
            endSeconds: region.endSeconds,
        } satisfies Partial<LfoConfig>,
        }))
      );
      const envelopes = Array.from(regionsById.values()).flatMap((region) =>
        region.envelopes.map((env) => ({
          segmentId: region.id,
        envelope: {
          id: env.id,
          targetId: env.targetId,
          wave: env.wave,
          min: env.min,
          max: env.max,
          enabled: env.enabled,
            startSeconds: region.startSeconds,
            endSeconds: region.endSeconds,
        } satisfies Partial<EnvelopeConfig>,
        }))
      );
      return {
        bpm,
        durationSeconds: audioDurationSeconds && isFinite(audioDurationSeconds) ? audioDurationSeconds : 0,
        audioFileName,
        lfos,
        envelopes: envelopes.length ? envelopes : undefined,
      };
    },
    loadProjectTimeline: (timeline: ProjectTimeline) => {
      hideContextMenu();
      destroyPeaks(false);
      clearSchedule();

      bpm = Math.max(10, Number(timeline.bpm) || bpm);
      bpmInput.value = String(bpm);
      options.onBpmChange?.(bpm);

      audioDurationSeconds =
        isFinite(Number(timeline.durationSeconds)) && Number(timeline.durationSeconds) > 0
          ? Number(timeline.durationSeconds)
          : null;
      audioFileName = timeline.audioFileName ?? null;
      updateAudioLabel();
      updateRenderEnabled();

      const ensureRegion = (regionId: string, startSeconds: number, endSeconds: number) => {
        const existing = regionsById.get(regionId);
        if (existing) {
          existing.startSeconds = Math.min(existing.startSeconds, startSeconds);
          existing.endSeconds = Math.max(existing.endSeconds, endSeconds);
          return existing;
        }
        const region: TimelineRegion = {
          id: regionId,
          startSeconds,
          endSeconds,
          lfos: [],
          envelopes: [],
        };
        regionsById.set(regionId, region);
        return region;
      };

      for (const entry of timeline.lfos ?? []) {
        const created = modulation.addLfo(entry.lfo);
        if (!created) continue;
        const regionId = entry.segmentId || created.id;
        const lfo = created as TimelineLfo;
        const start = typeof lfo.startSeconds === 'number' && isFinite(lfo.startSeconds) ? lfo.startSeconds : 0;
        const endRaw = typeof lfo.endSeconds === 'number' && isFinite(lfo.endSeconds) ? lfo.endSeconds : start + barSeconds();
        const region = ensureRegion(regionId, start, endRaw);
        region.lfos.push(lfo);
      }

      for (const entry of timeline.envelopes ?? []) {
        const created = modulation.addEnvelope(entry.envelope);
        if (!created) continue;
        const regionId = entry.segmentId || created.id;
        const env = created as TimelineEnvelope;
        const start = typeof env.startSeconds === 'number' && isFinite(env.startSeconds) ? env.startSeconds : 0;
        const endRaw = typeof env.endSeconds === 'number' && isFinite(env.endSeconds) ? env.endSeconds : start + barSeconds();
        const region = ensureRegion(regionId, start, endRaw);
        region.envelopes.push(env);
      }

      // Normalize all modulators to share their region's window, then snap to bars.
      for (const region of regionsById.values()) {
        const { start, end } = snapRegionWindow(region.startSeconds, region.endSeconds, 'floor', 'ceil');
        region.startSeconds = start;
        region.endSeconds = end;
        for (const lfo of region.lfos) {
          lfo.startSeconds = start;
          lfo.endSeconds = end;
        }
        for (const env of region.envelopes) {
          env.startSeconds = start;
          env.endSeconds = end;
        }
      }

      renderLfoList();
      const preferred =
        timeline.lfos?.[0]?.segmentId ??
        timeline.envelopes?.[0]?.segmentId ??
        Array.from(regionsById.values()).sort((a, b) => a.startSeconds - b.startSeconds)[0]?.id ??
        null;
      selectRegion(preferred);
    },
    destroy: () => {
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onRegionPointerMove);
      window.removeEventListener('pointerup', onRegionPointerUp);
      document.removeEventListener('click', hideContextMenu);
      window.removeEventListener('blur', hideContextMenu);
      destroyPeaks();
      clearSchedule();
    },
  };
}
