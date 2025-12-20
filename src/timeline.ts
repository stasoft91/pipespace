import Peaks, {
  type PeaksInstance,
  type Segment,
  type SegmentDragEvent,
  type SegmentPointerEvent,
  type SegmentsInsertEvent,
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
  onSegmentInserted?: (segment: Segment) => void;
  onSegmentUpdated?: (segment: Segment) => void;
  onSegmentRemoved?: (segmentId: string) => void;
  onSegmentSelected?: (segmentId: string | null) => void;
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
  insertSelect.setAttribute('aria-label', 'Segment insert type');
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

  const renderBtn = document.createElement('button');
  renderBtn.type = 'button';
  renderBtn.textContent = 'Render Video';
  renderBtn.disabled = true;
  controls.appendChild(renderBtn);

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
  let selectedSegmentId: string | null = null;
  let isSnapping = false;
  let bpm = Math.max(10, options.bpm);
  const modulation = options.modulation;

  type TimelineLfo = LfoConfig & { startSeconds?: number; endSeconds?: number; segmentId?: string };
  const lfoBySegmentId = new Map<string, TimelineLfo>();
  type TimelineEnvelope = EnvelopeConfig & { startSeconds?: number; endSeconds?: number; segmentId?: string };
  const envelopeBySegmentId = new Map<string, TimelineEnvelope>();

  const COLOR_SELECTED = '#ffd166';
  const COLOR_LFO = '#4fd1ff';
  const COLOR_ENV = '#a78bfa';

  const getSegmentKind = (segmentId: string | null): TimelineEventKind | null => {
    if (!segmentId) return null;
    if (lfoBySegmentId.has(segmentId)) return 'lfo';
    if (envelopeBySegmentId.has(segmentId)) return 'envelope';
    return null;
  };

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

  const applySnapToSegment = (segment: Segment, startMode: SnapMode, endMode: SnapMode) => {
    const start = snapToBar(segment.startTime, startMode);
    const endRaw = snapToBar(segment.endTime, endMode);
    const bar = barSeconds();
    const end = endRaw <= start ? start + bar : endRaw;
    if (Math.abs(start - segment.startTime) < 1e-4 && Math.abs(end - segment.endTime) < 1e-4) {
      return;
    }
    isSnapping = true;
    segment.update({ startTime: start, endTime: end });
    isSnapping = false;
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

  const clampTime = (time: number) => {
    let v = Math.max(0, time);
    if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
      v = Math.min(audioDurationSeconds, v);
    }
    return v;
  };

  const applyLfoTimeWindow = (lfo: TimelineLfo, startSeconds: number, endSeconds: number) => {
    const bar = barSeconds();
    const snappedStart = snapToBar(clampTime(startSeconds), 'floor');
    const snappedEndRaw = snapToBar(clampTime(endSeconds), 'ceil');
    const snappedEnd = snappedEndRaw <= snappedStart ? snappedStart + bar : snappedEndRaw;

    lfo.startSeconds = snappedStart;
    lfo.endSeconds = snappedEnd;

    if (peaks && lfo.segmentId) {
      const seg = peaks.segments.getSegment(lfo.segmentId);
      if (seg) {
        isSnapping = true;
        seg.update({ startTime: snappedStart, endTime: snappedEnd });
        isSnapping = false;
      }
    }

    renderLfoList();
    if (selectedSegmentId === lfo.segmentId) renderLfoEditor();
    refreshSegmentColors();
  };

  const applyEnvelopeTimeWindow = (env: TimelineEnvelope, startSeconds: number, endSeconds: number) => {
    const bar = barSeconds();
    const snappedStart = snapToBar(clampTime(startSeconds), 'floor');
    const snappedEndRaw = snapToBar(clampTime(endSeconds), 'ceil');
    const snappedEnd = snappedEndRaw <= snappedStart ? snappedStart + bar : snappedEndRaw;

    env.startSeconds = snappedStart;
    env.endSeconds = snappedEnd;

    if (peaks && env.segmentId) {
      const seg = peaks.segments.getSegment(env.segmentId);
      if (seg) {
        isSnapping = true;
        seg.update({ startTime: snappedStart, endTime: snappedEnd });
        isSnapping = false;
      }
    }

    renderLfoList();
    if (selectedSegmentId === env.segmentId) renderLfoEditor();
    refreshSegmentColors();
  };

  const refreshSegmentColors = () => {
    if (!peaks) return;
    const zoomView = peaks.views.getView('zoomview');
    // Peaks keeps segment overlay drag handlers around; explicitly toggle dragging so
    // only the currently-selected segment is draggable.
    zoomView?.enableSegmentDragging(false);
    const segments = peaks.segments.getSegments();
    for (const seg of segments) {
      const id = seg.id;
      if (!id) continue;
      const kind = getSegmentKind(id);
      const base = kind === 'envelope' ? COLOR_ENV : COLOR_LFO;
      const selected = id === selectedSegmentId;
      seg.update({
        color: selected ? COLOR_SELECTED : base,
        editable: selected,
      });
    }
    if (selectedSegmentId) {
      const selectedSeg = peaks.segments.getSegment(selectedSegmentId);
      if (selectedSeg) {
        // Ensure the selected segment is above any overlapping segments, so dragging
        // targets the selected region (not the top-most).
        const segmentsLayer =
          (zoomView as any)?.getSegmentsLayer?.() ??
          (zoomView as any)?._segmentsLayer ??
          null;
        const shape = segmentsLayer?.getSegmentShape?.(selectedSeg) ?? null;
        (shape as any)?._moveToTop?.();
      }
    }
    zoomView?.enableSegmentDragging(true);
  };

  const selectSegment = (segmentId: string | null) => {
    selectedSegmentId = segmentId;
    refreshSegmentColors();
    renderLfoList();
    renderLfoEditor();
    options.onSegmentSelected?.(segmentId);
  };

  const hideContextMenu = () => {
    lfoContextMenu.style.display = 'none';
    lfoContextMenu.textContent = '';
  };

  const convertSelectedEvent = (toKind: TimelineEventKind) => {
    const segmentId = selectedSegmentId;
    if (!segmentId) return;

    const existingLfo = lfoBySegmentId.get(segmentId);
    const existingEnv = envelopeBySegmentId.get(segmentId);
    if (toKind === 'envelope' && !existingLfo) return;
    if (toKind === 'lfo' && !existingEnv) return;

    const seg = peaks?.segments.getSegment(segmentId);
    const getWindow = (startSeconds?: number, endSeconds?: number) => {
      const start = seg?.startTime ?? startSeconds ?? 0;
      const end = seg?.endTime ?? endSeconds ?? start + barSeconds();
      return { start, end };
    };

    if (toKind === 'envelope' && existingLfo) {
      const lfo = existingLfo;
      const { start, end } = getWindow(lfo.startSeconds, lfo.endSeconds);
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
      lfoBySegmentId.delete(segmentId);

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
      env.segmentId = segmentId;
      env.startSeconds = start;
      env.endSeconds = end;
      envelopeBySegmentId.set(segmentId, env);
      (seg as any)?.update?.({ labelText: target ? target.label : env.targetId });
      if (seg) {
        (seg as any).envelopeId = env.id;
        delete (seg as any).lfoId;
      }
    }

    if (toKind === 'lfo' && existingEnv) {
      const env = existingEnv;
      const { start, end } = getWindow(env.startSeconds, env.endSeconds);
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
      envelopeBySegmentId.delete(segmentId);

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
      lfo.segmentId = segmentId;
      lfo.startSeconds = start;
      lfo.endSeconds = end;
      lfoBySegmentId.set(segmentId, lfo);
      (seg as any)?.update?.({ labelText: target ? target.label : lfo.targetId });
      if (seg) {
        (seg as any).lfoId = lfo.id;
        delete (seg as any).envelopeId;
      }
    }

    renderLfoList();
    renderLfoEditor();
    refreshSegmentColors();
  };

  const addEventAtTime = (timeSeconds: number, anchor: 'start' | 'end') => {
    if (!peaks) return;
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

    const seg = peaks.segments.add({
      startTime: start,
      endTime: end,
      // Markers + draggable overlay are created at segment construction time in Peaks,
      // so keep these enabled and then hide/lock via selection state.
      editable: true,
      markers: true,
      color: insertKind === 'envelope' ? COLOR_ENV : COLOR_LFO,
    });
    createEventForSegment(seg);
    options.onSegmentInserted?.(seg);
  };

  const showTimelineContextMenu = (clientX: number, clientY: number, timeSeconds: number) => {
    lfoContextMenu.textContent = '';

    const kindLabel = insertKind === 'envelope' ? 'ENV' : 'LFO';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = `New ${kindLabel}: use this as START`;
    startBtn.addEventListener('click', () => {
      addEventAtTime(timeSeconds, 'start');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(startBtn);

    const endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.textContent = `New ${kindLabel}: use this as END`;
    endBtn.addEventListener('click', () => {
      addEventAtTime(timeSeconds, 'end');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(endBtn);

    lfoContextMenu.style.left = `${clientX}px`;
    lfoContextMenu.style.top = `${clientY}px`;
    lfoContextMenu.style.display = 'block';
  };

  const showSegmentContextMenu = (clientX: number, clientY: number, segmentId: string) => {
    const lfo = lfoBySegmentId.get(segmentId);
    const env = envelopeBySegmentId.get(segmentId);
    const kind: TimelineEventKind | null = lfo ? 'lfo' : env ? 'envelope' : null;
    if (!kind) return;
    lfoContextMenu.textContent = '';

    const fullTrackBtn = document.createElement('button');
    fullTrackBtn.type = 'button';
    fullTrackBtn.textContent = 'Set to full track (0 → end)';
    const duration = audioDurationSeconds;
    fullTrackBtn.disabled = duration === null || !isFinite(duration);
    fullTrackBtn.addEventListener('click', () => {
      const end =
        duration ??
        (kind === 'lfo' ? lfo?.endSeconds : env?.endSeconds) ??
        0;
      if (kind === 'lfo' && lfo) applyLfoTimeWindow(lfo, 0, end);
      if (kind === 'envelope' && env) applyEnvelopeTimeWindow(env, 0, end);
      hideContextMenu();
    });
    lfoContextMenu.appendChild(fullTrackBtn);

    const convertBtn = document.createElement('button');
    convertBtn.type = 'button';
    convertBtn.textContent = kind === 'lfo' ? 'Convert to Envelope' : 'Convert to LFO';
    convertBtn.addEventListener('click', () => {
      selectSegment(segmentId);
      convertSelectedEvent(kind === 'lfo' ? 'envelope' : 'lfo');
      hideContextMenu();
    });
    lfoContextMenu.appendChild(convertBtn);

    lfoContextMenu.style.left = `${clientX}px`;
    lfoContextMenu.style.top = `${clientY}px`;
    lfoContextMenu.style.display = 'block';
  };

  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  const renderLfoList = () => {
    lfoList.textContent = '';
    type Entry =
      | { kind: 'lfo'; segmentId: string; config: TimelineLfo }
      | { kind: 'envelope'; segmentId: string; config: TimelineEnvelope };

    const entries: Entry[] = [
      ...Array.from(lfoBySegmentId.entries()).map(([segmentId, lfo]) => ({
        kind: 'lfo' as const,
        segmentId,
        config: lfo,
      })),
      ...Array.from(envelopeBySegmentId.entries()).map(([segmentId, env]) => ({
        kind: 'envelope' as const,
        segmentId,
        config: env,
      })),
    ].sort((a, b) => {
      const sa = a.config.startSeconds ?? 0;
      const sb = b.config.startSeconds ?? 0;
      return sa - sb;
    });

    for (const entry of entries) {
      const { segmentId } = entry;
      const item = document.createElement('div');
      item.className = `lfo-item${segmentId === selectedSegmentId ? ' selected' : ''}`;

      const title = document.createElement('div');
      title.className = 'lfo-title';
      const target = modulation.getTarget(entry.config.targetId);
      const kindLabel = entry.kind === 'lfo' ? 'LFO' : 'ENV';
      title.textContent = `${kindLabel} • ${target ? target.label : entry.config.targetId}`;
      item.appendChild(title);

      const times = document.createElement('div');
      times.className = 'lfo-times';
      const start = entry.config.startSeconds ?? 0;
      const end = entry.config.endSeconds ?? start;
      times.textContent = `${fmtTime(start)} → ${fmtTime(end)}`;
      item.appendChild(times);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'lfo-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (peaks) {
          peaks.segments.removeById(segmentId);
        } else {
          if (entry.kind === 'lfo') {
            const existing = lfoBySegmentId.get(segmentId);
            if (existing) modulation.removeLfo(existing.id);
            lfoBySegmentId.delete(segmentId);
          } else {
            const existing = envelopeBySegmentId.get(segmentId);
            if (existing) modulation.removeEnvelope(existing.id);
            envelopeBySegmentId.delete(segmentId);
          }
          if (selectedSegmentId === segmentId) selectedSegmentId = null;
          renderLfoList();
          renderLfoEditor();
        }
      });
      item.appendChild(removeBtn);

      item.addEventListener('click', () => selectSegment(segmentId));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectSegment(segmentId);
        showSegmentContextMenu(e.clientX, e.clientY, segmentId);
      });
      lfoList.appendChild(item);
    }
  };

  const renderLfoEditor = () => {
    lfoEditor.textContent = '';
    if (!selectedSegmentId) {
      const empty = document.createElement('div');
      empty.className = 'lfo-empty';
      empty.textContent = 'Select a segment';
      lfoEditor.appendChild(empty);
      return;
    }
    const lfo = lfoBySegmentId.get(selectedSegmentId);
    const env = envelopeBySegmentId.get(selectedSegmentId);
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

    const targets = modulation
      .getTargets()
      .slice()
      .sort((a, b) => {
        const ga = a.group ?? '';
        const gb = b.group ?? '';
        if (ga !== gb) return ga.localeCompare(gb);
        return a.label.localeCompare(b.label);
      });
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
      startInput.value = String(lfo.startSeconds ?? 0);
      startInput.addEventListener('change', () => {
        const nextStart = Number(startInput.value) || 0;
        const nextEnd = lfo.endSeconds ?? nextStart;
        applyLfoTimeWindow(lfo, nextStart, nextEnd);
      });
      addRow('Start (s)', startInput);

      const endInput = document.createElement('input');
      endInput.type = 'number';
      endInput.step = '0.01';
      endInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        endInput.max = String(audioDurationSeconds);
      }
      endInput.value = String(lfo.endSeconds ?? lfo.startSeconds ?? 0);
      endInput.addEventListener('change', () => {
        const nextEnd = Number(endInput.value) || 0;
        const nextStart = lfo.startSeconds ?? 0;
        applyLfoTimeWindow(lfo, nextStart, nextEnd);
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
        if (peaks && selectedSegmentId) {
          const seg = peaks.segments.getSegment(selectedSegmentId);
          const target = modulation.getTarget(lfo.targetId);
          if (seg) seg.update({ labelText: target ? target.label : lfo.targetId });
        }
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
      ];
      const dottedPresets: Array<{ label: string; value: number }> = [
        { label: '1/16.', value: (1 / 16) * 1.5 },
        { label: '1/8.', value: (1 / 8) * 1.5 },
        { label: '1/4.', value: (1 / 4) * 1.5 },
        { label: '1/2.', value: (1 / 2) * 1.5 },
      ];
      addPresetRow('Quick', basePresets);
      addPresetRow('Dotted', dottedPresets);
      updatePresetSelections();

      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.step = '0.01';
      amountInput.min = '0';
      amountInput.max = '4';
      amountInput.value = String(lfo.amount);
      amountInput.addEventListener('change', () => {
        lfo.amount = Math.max(0, Number(amountInput.value) || 0);
        updateRangeDisplay();
      });
      addRow('Amount', amountInput);

      const offsetInput = document.createElement('input');
      offsetInput.type = 'number';
      offsetInput.step = '0.01';
      offsetInput.min = '-2';
      offsetInput.max = '2';
      offsetInput.value = String(lfo.offset);
      offsetInput.addEventListener('change', () => {
        lfo.offset = Number(offsetInput.value) || 0;
        updateRangeDisplay();
      });
      addRow('Offset', offsetInput);

      const phaseInput = document.createElement('input');
      phaseInput.type = 'number';
      phaseInput.step = '0.001';
      phaseInput.min = '0';
      phaseInput.max = String(Math.PI * 2);
      phaseInput.value = String(lfo.phase);
      phaseInput.addEventListener('change', () => {
        lfo.phase = Number(phaseInput.value) || 0;
      });
      addRow('Phase (rad)', phaseInput);

      const bipolarInput = document.createElement('input');
      bipolarInput.type = 'checkbox';
      bipolarInput.checked = lfo.bipolar;
      bipolarInput.addEventListener('change', () => {
        lfo.bipolar = bipolarInput.checked;
        updateRangeDisplay();
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
      });
      addRow('Smooth (s)', smoothInput);

      const rangeDisplay = document.createElement('div');
      rangeDisplay.className = 'lfo-range';
      lfoEditor.appendChild(rangeDisplay);

      const updateRangeDisplay = () => {
        const { min, max, target } = computeDeltaRange(lfo);
        const fmt = (v: number) => v.toFixed(3);
        rangeDisplay.textContent = `Δ range: ${fmt(min)} … ${fmt(max)}${target ? ` (${target.label})` : ''}`;
      };
      updateRangeDisplay();
      return;
    }

    if (env) {
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
      startInput.value = String(env.startSeconds ?? 0);
      startInput.addEventListener('change', () => {
        const nextStart = Number(startInput.value) || 0;
        const nextEnd = env.endSeconds ?? nextStart;
        applyEnvelopeTimeWindow(env, nextStart, nextEnd);
      });
      addRow('Start (s)', startInput);

      const endInput = document.createElement('input');
      endInput.type = 'number';
      endInput.step = '0.01';
      endInput.min = '0';
      if (audioDurationSeconds !== null && isFinite(audioDurationSeconds)) {
        endInput.max = String(audioDurationSeconds);
      }
      endInput.value = String(env.endSeconds ?? env.startSeconds ?? 0);
      endInput.addEventListener('change', () => {
        const nextEnd = Number(endInput.value) || 0;
        const nextStart = env.startSeconds ?? 0;
        applyEnvelopeTimeWindow(env, nextStart, nextEnd);
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
        if (peaks && selectedSegmentId) {
          const seg = peaks.segments.getSegment(selectedSegmentId);
          const target = modulation.getTarget(env.targetId);
          if (seg) seg.update({ labelText: target ? target.label : env.targetId });
        }
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
      };

      minInput.addEventListener('change', syncRangeFromInputs);
      maxInput.addEventListener('change', syncRangeFromInputs);
      updateBounds();
      updateRangeDisplay();

      addRow('Min', minInput);
      addRow('Max', maxInput);
      lfoEditor.appendChild(rangeDisplay);
    }
  };

  const ensureSegmentId = (segment: Segment) => {
    if (segment.id) return segment.id;
    const id = `seg-${Math.random().toString(16).slice(2)}`;
    (segment as any).id = id;
    return id;
  };

  const createLfoForSegment = (segment: Segment) => {
    const segmentId = ensureSegmentId(segment);
    if (envelopeBySegmentId.has(segmentId)) return null;
    if (lfoBySegmentId.has(segmentId)) return lfoBySegmentId.get(segmentId) ?? null;
    const created = modulation.addLfo({});
    if (!created) return null;
    const lfo = created as TimelineLfo;
    lfo.startSeconds = segment.startTime;
    lfo.endSeconds = segment.endTime;
    lfo.segmentId = segmentId;
    lfoBySegmentId.set(segmentId, lfo);
    (segment as any).lfoId = lfo.id;
    segment.update({ labelText: `LFO ${lfoBySegmentId.size}` });
    renderLfoList();
    selectSegment(segmentId);
    return lfo;
  };

  const createEnvelopeForSegment = (segment: Segment) => {
    const segmentId = ensureSegmentId(segment);
    if (lfoBySegmentId.has(segmentId)) return null;
    if (envelopeBySegmentId.has(segmentId)) return envelopeBySegmentId.get(segmentId) ?? null;
    const created = modulation.addEnvelope({});
    if (!created) return null;
    const env = created as TimelineEnvelope;
    env.startSeconds = segment.startTime;
    env.endSeconds = segment.endTime;
    env.segmentId = segmentId;
    envelopeBySegmentId.set(segmentId, env);
    (segment as any).envelopeId = env.id;
    segment.update({ labelText: `ENV ${envelopeBySegmentId.size}` });
    renderLfoList();
    selectSegment(segmentId);
    return env;
  };

  const createEventForSegment = (segment: Segment) => {
    return insertKind === 'envelope' ? createEnvelopeForSegment(segment) : createLfoForSegment(segment);
  };

  const updateEventFromSegment = (segment: Segment) => {
    const segmentId = segment.id;
    if (!segmentId) return;
    const lfo = lfoBySegmentId.get(segmentId);
    if (lfo) {
      lfo.startSeconds = segment.startTime;
      lfo.endSeconds = segment.endTime;
    } else {
      const env = envelopeBySegmentId.get(segmentId);
      if (!env) return;
      env.startSeconds = segment.startTime;
      env.endSeconds = segment.endTime;
    }
    renderLfoList();
    if (selectedSegmentId === segmentId) renderLfoEditor();
  };

  const removeEventsForSegments = (segments: Segment[]) => {
    for (const seg of segments) {
      const id = seg.id;
      if (!id) continue;
      const lfo = lfoBySegmentId.get(id);
      if (lfo) {
        modulation.removeLfo(lfo.id);
        lfoBySegmentId.delete(id);
        continue;
      }
      const env = envelopeBySegmentId.get(id);
      if (env) {
        modulation.removeEnvelope(env.id);
        envelopeBySegmentId.delete(id);
      }
    }
    renderLfoList();
    renderLfoEditor();
  };

  const clearSchedule = () => {
    if (lfoBySegmentId.size) {
      for (const lfo of lfoBySegmentId.values()) {
        modulation.removeLfo(lfo.id);
      }
      lfoBySegmentId.clear();
    }
    if (envelopeBySegmentId.size) {
      for (const env of envelopeBySegmentId.values()) {
        modulation.removeEnvelope(env.id);
      }
      envelopeBySegmentId.clear();
    }
    selectSegment(null);
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
          enableSegments: true,
          enablePoints: false,
          showAxisLabels: true,
        },
        zoomview: {
          container: zoomviewContainer,
          enableSegments: true,
          enablePoints: false,
          wheelMode: 'scroll',
          autoScroll: true,
          showAxisLabels: true,
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
        zoomRange.max = String(zoomLevels.length - 1);
        zoomRange.disabled = false;
        syncZoomControls();
        const zoomView = peaks.views.getView('zoomview');
        zoomView?.enableSegmentDragging(true);
        zoomView?.setSegmentDragMode('overlap');
        zoomView?.setMinSegmentDragWidth(3);
        // Left click should seek/select, not insert new segments (insertion is via context menu).
        zoomView?.setWaveformDragMode('scroll');
        updatePlayBtn();

        peaks.on('player.timeupdate', updatePlayBtn);
        peaks.on('player.pause', updatePlayBtn);
        peaks.on('player.playing', updatePlayBtn);
        peaks.on('zoom.update', (event) => {
          syncZoomControls(event.currentZoom);
        });

        // If a project was loaded before audio, re-create segments now.
        for (const [segmentId, lfo] of lfoBySegmentId.entries()) {
          const start = lfo.startSeconds ?? 0;
          const end = lfo.endSeconds ?? start + barSeconds();
          const target = modulation.getTarget(lfo.targetId);
          peaks.segments.add({
            id: segmentId,
            startTime: start,
            endTime: end,
            // Markers + draggable overlay are created at segment construction time in Peaks.
            // We hide markers and "lock" editing via selection state in refreshSegmentColors().
            editable: true,
            markers: true,
            labelText: target ? target.label : lfo.targetId,
            color: segmentId === selectedSegmentId ? COLOR_SELECTED : COLOR_LFO,
          });
        }
        for (const [segmentId, env] of envelopeBySegmentId.entries()) {
          const start = env.startSeconds ?? 0;
          const end = env.endSeconds ?? start + barSeconds();
          const target = modulation.getTarget(env.targetId);
          peaks.segments.add({
            id: segmentId,
            startTime: start,
            endTime: end,
            editable: true,
            markers: true,
            labelText: target ? target.label : env.targetId,
            color: segmentId === selectedSegmentId ? COLOR_SELECTED : COLOR_ENV,
          });
        }
        refreshSegmentColors();

        peaks.on('segments.insert', (event: SegmentsInsertEvent) => {
          if (isSnapping) return;
          applySnapToSegment(event.segment, 'floor', 'ceil');
          createEventForSegment(event.segment);
          options.onSegmentInserted?.(event.segment);
        });

        const onDragged = (event: SegmentDragEvent) => {
          if (isSnapping) return;
          applySnapToSegment(event.segment, 'round', 'round');
          updateEventFromSegment(event.segment);
          options.onSegmentUpdated?.(event.segment);
        };

        peaks.on('segments.dragged', onDragged);
        peaks.on('segments.dragend', onDragged);

        peaks.on('segments.click', (event) => {
          selectSegment(event.segment.id ?? null);
        });

        peaks.on('segments.contextmenu', (event: SegmentPointerEvent) => {
          event.evt.preventDefault();
          event.evt.stopPropagation();
          event.preventViewEvent();
          const segmentId = event.segment.id ?? null;
          if (!segmentId) return;
          selectSegment(segmentId);
          showSegmentContextMenu(event.evt.clientX, event.evt.clientY, segmentId);
        });

        const onWaveformContextMenu = (event: WaveformViewPointerEvent) => {
          event.evt.preventDefault();
          event.evt.stopPropagation();
          showTimelineContextMenu(event.evt.clientX, event.evt.clientY, event.time);
        };
        peaks.on('zoomview.contextmenu', onWaveformContextMenu);
        peaks.on('overview.contextmenu', onWaveformContextMenu);

        peaks.on('segments.remove', (event) => {
          removeEventsForSegments(event.segments);
          for (const seg of event.segments) {
            options.onSegmentRemoved?.(seg.id ?? '');
          }
          if (selectedSegmentId && event.segments.some((s) => s.id === selectedSegmentId)) {
            selectSegment(null);
          }
        });
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
    if (peaks) {
      for (const seg of peaks.segments.getSegments()) {
        applySnapToSegment(seg, 'floor', 'ceil');
        updateEventFromSegment(seg);
      }
      refreshSegmentColors();
    }
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
    const duration = audioDurationSeconds ?? 10;
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
  };

  const resizeObserver = new ResizeObserver(() => fitWaveforms());
  resizeObserver.observe(container);

  return {
    getPeaks: () => peaks,
    getSelectedSegmentId: () => selectedSegmentId,
    getPlayheadSeconds: () => {
      if (!audioEl.src) return null;
      return audioEl.currentTime;
    },
    getRenderSchedule: (): RenderSchedule | null => {
      if (audioDurationSeconds === null || !isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) return null;
      const lfos: LfoConfig[] = Array.from(lfoBySegmentId.values()).map((lfo) => ({
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
        startSeconds: lfo.startSeconds,
        endSeconds: lfo.endSeconds,
      }));
      const envelopes: EnvelopeConfig[] = Array.from(envelopeBySegmentId.values()).map((env) => ({
        id: env.id,
        targetId: env.targetId,
        wave: env.wave,
        min: env.min,
        max: env.max,
        enabled: env.enabled,
        startSeconds: env.startSeconds,
        endSeconds: env.endSeconds,
      }));
      return { bpm, durationSeconds: audioDurationSeconds, lfos, envelopes, videoResolution };
    },
    getProjectTimeline: (): ProjectTimeline => {
      const lfos = Array.from(lfoBySegmentId.entries()).map(([segmentId, lfo]) => ({
        segmentId,
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
          startSeconds: lfo.startSeconds,
          endSeconds: lfo.endSeconds,
        } satisfies Partial<LfoConfig>,
      }));
      const envelopes = Array.from(envelopeBySegmentId.entries()).map(([segmentId, env]) => ({
        segmentId,
        envelope: {
          id: env.id,
          targetId: env.targetId,
          wave: env.wave,
          min: env.min,
          max: env.max,
          enabled: env.enabled,
          startSeconds: env.startSeconds,
          endSeconds: env.endSeconds,
        } satisfies Partial<EnvelopeConfig>,
      }));
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

      for (const entry of timeline.lfos ?? []) {
        const created = modulation.addLfo(entry.lfo);
        if (!created) continue;
        const segmentId = entry.segmentId || created.id;
        const lfo = created as TimelineLfo;
        lfo.segmentId = segmentId;
        lfoBySegmentId.set(segmentId, lfo);
      }
      for (const entry of timeline.envelopes ?? []) {
        const created = modulation.addEnvelope(entry.envelope);
        if (!created) continue;
        const segmentId = entry.segmentId || created.id;
        const env = created as TimelineEnvelope;
        env.segmentId = segmentId;
        envelopeBySegmentId.set(segmentId, env);
      }
      renderLfoList();
      selectSegment(timeline.lfos?.[0]?.segmentId ?? timeline.envelopes?.[0]?.segmentId ?? null);
    },
    destroy: () => {
      resizeObserver.disconnect();
      destroyPeaks();
      clearSchedule();
    },
  };
}
