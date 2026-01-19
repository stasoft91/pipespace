import { reactive } from 'vue';
import type { EnvelopeConfig, LfoConfig, ModulationTarget, Waveform } from './modulation';
import type {
  ModulationBackend,
  ModulationRenderSchedule,
  ModulationTimelineData,
  ModulationTimelineImport,
  TimelineEventKind,
  TimelineViewMetrics,
} from './modulation-panel-types';

type SnapMode = 'round' | 'floor' | 'ceil';

type TimelineLfo = LfoConfig & { startSeconds?: number; endSeconds?: number };

type TimelineEnvelope = EnvelopeConfig & { startSeconds?: number; endSeconds?: number };

type TimelineRegion = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  lfos: TimelineLfo[];
  envelopes: TimelineEnvelope[];
};

type SelectedModulator = { kind: TimelineEventKind; id: string };

type DraggedModulatorPayload = { fromRegionId: string; kind: TimelineEventKind; id: string };

type RegionDragMode = 'move' | 'resize-start' | 'resize-end';

type RegionDragState = {
  regionId: string;
  mode: RegionDragMode;
  startClientX: number;
  originStart: number;
  originEnd: number;
  secondsPerPx: number;
};

type ContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  action: () => void;
};

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type OverlayBlock = {
  id: string;
  regionId: string;
  left: number;
  width: number;
  top: number;
  bottom: number;
  label: string;
  title: string;
  selected: boolean;
  showLabel: boolean;
};

type OverlayRow = {
  id: number;
  heightPx: number;
  widthPx: number;
  blocks: OverlayBlock[];
};

type OverlayState = {
  visible: boolean;
  heightPx: number;
  rows: OverlayRow[];
  viewWidthPx: number;
  secondsPerPx: number;
};

type ModulationPanelState = {
  bpm: number;
  durationSeconds: number | null;
  insertKind: TimelineEventKind;
  selectedRegionId: string | null;
  selectedModulator: SelectedModulator | null;
  regionsById: Map<string, TimelineRegion>;
  contextMenu: ContextMenuState;
  overlay: OverlayState;
  draggingModulator: DraggedModulatorPayload | null;
  revision: number;
};

const BEATS_PER_BAR = 4;
const REGION_ROW_HEIGHT_PX = 22;
const REGION_LANES_MAX_HEIGHT_PX = 160;

export class ModulationPanelModel {
  readonly state: ModulationPanelState;

  private modulation: ModulationBackend;
  private onRegionInserted?: (regionId: string) => void;
  private onRegionUpdated?: (regionId: string) => void;
  private onRegionRemoved?: (regionId: string) => void;
  private onRegionSelected?: (regionId: string | null) => void;
  private onJumpToZero?: () => void;

  private viewMetrics: TimelineViewMetrics | null = null;
  private regionDrag: RegionDragState | null = null;

  constructor(options: {
    modulation: ModulationBackend;
    bpm: number;
    durationSeconds?: number | null;
    insertKind?: TimelineEventKind;
    onRegionInserted?: (regionId: string) => void;
    onRegionUpdated?: (regionId: string) => void;
    onRegionRemoved?: (regionId: string) => void;
    onRegionSelected?: (regionId: string | null) => void;
    onJumpToZero?: () => void;
  }) {
    this.modulation = options.modulation;
    this.onRegionInserted = options.onRegionInserted;
    this.onRegionUpdated = options.onRegionUpdated;
    this.onRegionRemoved = options.onRegionRemoved;
    this.onRegionSelected = options.onRegionSelected;
    this.onJumpToZero = options.onJumpToZero;

    this.state = reactive({
      bpm: this.normalizeBpm(options.bpm),
      durationSeconds: this.normalizeDuration(options.durationSeconds ?? null),
      insertKind: options.insertKind ?? 'lfo',
      selectedRegionId: null,
      selectedModulator: null,
      regionsById: new Map<string, TimelineRegion>(),
      contextMenu: {
        open: false,
        x: 0,
        y: 0,
        items: [],
      },
      overlay: {
        visible: false,
        heightPx: 0,
        rows: [],
        viewWidthPx: 0,
        secondsPerPx: 0,
      },
      draggingModulator: null,
      revision: 0,
    });
  }

  setViewMetrics(metrics: TimelineViewMetrics | null) {
    this.viewMetrics = metrics;
    this.refreshOverlay();
  }

  getViewMetrics() {
    return this.viewMetrics;
  }

  refreshOverlay() {
    this.state.overlay = this.computeOverlayState();
  }

  closeContextMenu() {
    this.state.contextMenu.open = false;
    this.state.contextMenu.items = [];
  }

  openTimelineContextMenu(clientX: number, clientY: number, timeSeconds: number) {
    const kindLabel = this.state.insertKind === 'envelope' ? 'ENV' : 'LFO';
    this.state.contextMenu = {
      open: true,
      x: clientX,
      y: clientY,
      items: [
        {
          id: 'timeline-start',
          label: `New region (${kindLabel}): use this as START`,
          action: () => this.addRegionAtTime(timeSeconds, 'start'),
        },
        {
          id: 'timeline-end',
          label: `New region (${kindLabel}): use this as END`,
          action: () => this.addRegionAtTime(timeSeconds, 'end'),
        },
      ],
    };
  }

  openRegionContextMenu(clientX: number, clientY: number, regionId: string) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;
    const duration = this.state.durationSeconds;
    this.state.contextMenu = {
      open: true,
      x: clientX,
      y: clientY,
      items: [
        {
          id: 'region-add-lfo',
          label: 'Add LFO to region',
          action: () => this.addModulatorToRegion(region, 'lfo'),
        },
        {
          id: 'region-add-env',
          label: 'Add Envelope to region',
          action: () => this.addModulatorToRegion(region, 'envelope'),
        },
        {
          id: 'region-full-track',
          label: 'Set to full track (0 -> end)',
          disabled: duration === null || !isFinite(duration),
          action: () => {
            const end = duration ?? region.endSeconds ?? 0;
            this.applyRegionTimeWindow(region, 0, end, 'floor', 'ceil');
          },
        },
        {
          id: 'region-duplicate',
          label: 'Duplicate',
          action: () => this.duplicateRegion(regionId),
        },
        {
          id: 'region-duplicate-next',
          label: 'Duplicate next',
          action: () => this.duplicateRegionNext(regionId),
        },
        {
          id: 'region-delete',
          label: 'Delete region',
          action: () => this.removeRegion(regionId),
        },
      ],
    };
  }

  setBpm(bpm: number) {
    this.state.bpm = this.normalizeBpm(bpm);
    for (const region of this.state.regionsById.values()) {
      const { start, end } = this.snapRegionWindow(region.startSeconds, region.endSeconds, 'floor', 'ceil');
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
    this.refreshOverlay();
  }

  getBpm() {
    return this.state.bpm;
  }

  setDuration(durationSeconds: number | null) {
    this.state.durationSeconds = this.normalizeDuration(durationSeconds);
    this.refreshOverlay();
  }

  getDurationSeconds() {
    return this.state.durationSeconds;
  }

  setInsertKind(kind: TimelineEventKind) {
    this.state.insertKind = kind;
  }

  getSelectedRegionId() {
    return this.state.selectedRegionId;
  }

  getSelectedRegion(): TimelineRegion | null {
    if (!this.state.selectedRegionId) return null;
    return this.state.regionsById.get(this.state.selectedRegionId) ?? null;
  }

  getSelectedModulator(): SelectedModulator | null {
    return this.state.selectedModulator;
  }

  getSelectedLfo(): TimelineLfo | null {
    const region = this.getSelectedRegion();
    const selected = this.state.selectedModulator;
    if (!region || !selected || selected.kind !== 'lfo') return null;
    return region.lfos.find((l) => l.id === selected.id) ?? null;
  }

  getSelectedEnvelope(): TimelineEnvelope | null {
    const region = this.getSelectedRegion();
    const selected = this.state.selectedModulator;
    if (!region || !selected || selected.kind !== 'envelope') return null;
    return region.envelopes.find((e) => e.id === selected.id) ?? null;
  }

  getRenderSchedule(): ModulationRenderSchedule | null {
    const duration = this.state.durationSeconds;
    if (duration === null || !isFinite(duration) || duration <= 0) return null;
    const lfos: LfoConfig[] = Array.from(this.state.regionsById.values()).flatMap((region) =>
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
    const envelopes: EnvelopeConfig[] = Array.from(this.state.regionsById.values()).flatMap((region) =>
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
    return {
      bpm: this.state.bpm,
      durationSeconds: duration,
      lfos,
      envelopes: envelopes.length ? envelopes : undefined,
    };
  }

  getTimelineData(): ModulationTimelineData {
    const lfos = Array.from(this.state.regionsById.values()).flatMap((region) =>
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
    const envelopes = Array.from(this.state.regionsById.values()).flatMap((region) =>
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
      bpm: this.state.bpm,
      durationSeconds: this.state.durationSeconds && isFinite(this.state.durationSeconds) ? this.state.durationSeconds : 0,
      lfos,
      envelopes: envelopes.length ? envelopes : undefined,
    };
  }

  loadTimelineData(data: ModulationTimelineImport) {
    this.closeContextMenu();
    if (typeof data.bpm === 'number' && isFinite(data.bpm)) {
      this.state.bpm = this.normalizeBpm(data.bpm);
    }
    if (data.durationSeconds !== undefined) {
      this.state.durationSeconds = this.normalizeDuration(data.durationSeconds ?? null);
    }

    this.clearSchedule(false);

    const ensureRegion = (regionId: string, startSeconds: number, endSeconds: number) => {
      const existing = this.state.regionsById.get(regionId);
      if (existing) {
        existing.startSeconds = Math.min(existing.startSeconds, startSeconds);
        existing.endSeconds = Math.max(existing.endSeconds, endSeconds);
        return existing;
      }
      const region = reactive({
        id: regionId,
        startSeconds,
        endSeconds,
        lfos: [],
        envelopes: [],
      }) as TimelineRegion;
      this.state.regionsById.set(regionId, region);
      return region;
    };

    for (const entry of data.lfos ?? []) {
      const created = this.modulation.addLfo(entry.lfo);
      if (!created) continue;
      const regionId = entry.segmentId || created.id;
      const lfo = reactive(created as TimelineLfo);
      const start = typeof lfo.startSeconds === 'number' && isFinite(lfo.startSeconds) ? lfo.startSeconds : 0;
      const endRaw =
        typeof lfo.endSeconds === 'number' && isFinite(lfo.endSeconds)
          ? lfo.endSeconds
          : start + this.barSeconds();
      const region = ensureRegion(regionId, start, endRaw);
      region.lfos.push(lfo);
    }

    for (const entry of data.envelopes ?? []) {
      const created = this.modulation.addEnvelope(entry.envelope);
      if (!created) continue;
      const regionId = entry.segmentId || created.id;
      const env = reactive(created as TimelineEnvelope);
      const start = typeof env.startSeconds === 'number' && isFinite(env.startSeconds) ? env.startSeconds : 0;
      const endRaw =
        typeof env.endSeconds === 'number' && isFinite(env.endSeconds)
          ? env.endSeconds
          : start + this.barSeconds();
      const region = ensureRegion(regionId, start, endRaw);
      region.envelopes.push(env);
    }

    for (const region of this.state.regionsById.values()) {
      const { start, end } = this.snapRegionWindow(region.startSeconds, region.endSeconds, 'floor', 'ceil');
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

    const preferred =
      data.lfos?.[0]?.segmentId ??
      data.envelopes?.[0]?.segmentId ??
      Array.from(this.state.regionsById.values()).sort((a, b) => a.startSeconds - b.startSeconds)[0]?.id ??
      null;
    this.selectRegion(preferred);
  }

  clear() {
    this.clearSchedule();
  }

  destroy() {
    this.closeContextMenu();
    this.clearSchedule();
    this.viewMetrics = null;
  }

  selectRegion(regionId: string | null) {
    this.state.selectedRegionId = regionId;
    if (!regionId) {
      this.state.selectedModulator = null;
    } else {
      const region = this.state.regionsById.get(regionId);
      if (region) this.ensureSelectedModulatorForRegion(region);
    }
    this.refreshOverlay();
    this.onRegionSelected?.(regionId);
  }

  selectModulatorInRegion(regionId: string, modulator: SelectedModulator) {
    this.state.selectedRegionId = regionId;
    this.state.selectedModulator = modulator;
    const region = this.state.regionsById.get(regionId);
    if (region) this.ensureSelectedModulatorForRegion(region);
    this.refreshOverlay();
    this.onRegionSelected?.(regionId);
  }

  convertSelectedEvent(toKind: TimelineEventKind) {
    const region = this.getSelectedRegion();
    if (!region) return;
    const selected = this.state.selectedModulator;
    if (!selected || selected.kind === toKind) return;

    const start = region.startSeconds;
    const end = region.endSeconds;

    if (toKind === 'envelope' && selected.kind === 'lfo') {
      const idx = region.lfos.findIndex((l) => l.id === selected.id);
      if (idx < 0) return;
      const lfo = region.lfos[idx];
      const target = this.modulation.getTarget(lfo.targetId);
      const base = target ? target.getCurrent() : 0;
      const delta = this.computeDeltaRange(lfo);
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

      this.modulation.removeLfo(lfo.id);
      region.lfos.splice(idx, 1);

      const created = this.modulation.addEnvelope({
        targetId: lfo.targetId,
        wave: lfo.wave,
        min,
        max,
        enabled: lfo.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) return;
      const env = reactive(created as TimelineEnvelope);
      env.startSeconds = start;
      env.endSeconds = end;
      region.envelopes.push(env);
      this.state.selectedModulator = { kind: 'envelope', id: env.id };
    }

    if (toKind === 'lfo' && selected.kind === 'envelope') {
      const idx = region.envelopes.findIndex((e) => e.id === selected.id);
      if (idx < 0) return;
      const env = region.envelopes[idx];
      const duration = Math.max(1e-6, end - start);
      const target = this.modulation.getTarget(env.targetId);
      const base = target ? target.getCurrent() : (env.min + env.max) * 0.5;
      const scale = target ? this.getTargetScale(target) : 1;

      const center = (env.min + env.max) * 0.5;
      const offsetAbs = center - base;
      const amountAbs = Math.abs(env.max - env.min) * 0.5;
      const offset = isFinite(offsetAbs / scale) ? offsetAbs / scale : 0;
      const amount = isFinite(amountAbs / scale) ? amountAbs / scale : 0;

      const bar = this.barSeconds();
      const bpmCoefficient = bar > 0 ? duration / bar : 1;
      const beatsPerSecond = this.state.bpm / 60;
      const beatsPerBar = 4;
      const effectiveFreq = bpmCoefficient > 0 ? beatsPerSecond / (beatsPerBar * bpmCoefficient) : 0;
      const phase = effectiveFreq <= 0 ? 0 : -start * effectiveFreq * Math.PI * 2;

      this.modulation.removeEnvelope(env.id);
      region.envelopes.splice(idx, 1);

      const created = this.modulation.addLfo({
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
      const lfo = reactive(created as TimelineLfo);
      lfo.startSeconds = start;
      lfo.endSeconds = end;
      region.lfos.push(lfo);
      this.state.selectedModulator = { kind: 'lfo', id: lfo.id };
    }

    this.refreshOverlay();
  }

  addRegionAtTime(timeSeconds: number, anchor: 'start' | 'end') {
    const bar = this.barSeconds();
    if (!isFinite(bar) || bar <= 0) return;

    const t = this.clampTime(timeSeconds);
    let start: number;
    let end: number;

    if (anchor === 'start') {
      start = this.snapToBar(t, 'floor');
      end = start + bar;
    } else {
      end = this.snapToBar(t, 'ceil');
      start = end - bar;
    }

    start = this.clampTime(start);
    end = this.clampTime(end);

    if (end <= start) {
      end = this.clampTime(start + bar);
    }
    if (end <= start) return;

    const regionId = this.createRegionId();
    const region = reactive({
      id: regionId,
      startSeconds: start,
      endSeconds: end,
      lfos: [],
      envelopes: [],
    }) as TimelineRegion;
    this.state.regionsById.set(regionId, region);
    this.addModulatorToRegion(region, this.state.insertKind);
    this.selectRegion(regionId);
    this.onRegionInserted?.(regionId);
  }

  duplicateRegion(regionId: string, startOverride?: number, endOverride?: number) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;

    let start = this.clampTime(startOverride ?? region.startSeconds);
    let end = this.clampTime(endOverride ?? region.endSeconds);
    if (end <= start) {
      const bar = this.barSeconds();
      if (isFinite(bar) && bar > 0) {
        end = this.clampTime(start + bar);
      }
    }
    if (end <= start) return;

    const newRegionId = this.createRegionId();
    const nextRegion = reactive({
      id: newRegionId,
      startSeconds: start,
      endSeconds: end,
      lfos: [],
      envelopes: [],
    }) as TimelineRegion;

    for (const lfo of region.lfos) {
      const created = this.modulation.addLfo({
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
      const next = reactive(created as TimelineLfo);
      next.startSeconds = start;
      next.endSeconds = end;
      nextRegion.lfos.push(next);
    }

    for (const env of region.envelopes) {
      const created = this.modulation.addEnvelope({
        targetId: env.targetId,
        wave: env.wave,
        min: env.min,
        max: env.max,
        enabled: env.enabled,
        startSeconds: start,
        endSeconds: end,
      });
      if (!created) continue;
      const next = reactive(created as TimelineEnvelope);
      next.startSeconds = start;
      next.endSeconds = end;
      nextRegion.envelopes.push(next);
    }

    if (nextRegion.lfos.length + nextRegion.envelopes.length <= 0) return;
    this.state.regionsById.set(newRegionId, nextRegion);
    this.selectRegion(newRegionId);
    this.onRegionInserted?.(newRegionId);
  }

  duplicateRegionNext(regionId: string) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;
    const start = region.startSeconds;
    const end = region.endSeconds;
    const duration = Math.max(1e-6, end - start);
    this.duplicateRegion(regionId, end, end + duration);
  }

  addModulatorToRegion(region: TimelineRegion, kind: TimelineEventKind) {
    if (kind === 'lfo') {
      const created = this.modulation.addLfo({
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
      });
      if (!created) return;
      const lfo = reactive(created as TimelineLfo);
      lfo.startSeconds = region.startSeconds;
      lfo.endSeconds = region.endSeconds;
      region.lfos.push(lfo);
      this.state.selectedRegionId = region.id;
      this.state.selectedModulator = { kind: 'lfo', id: lfo.id };
    } else {
      const created = this.modulation.addEnvelope({
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
      });
      if (!created) return;
      const env = reactive(created as TimelineEnvelope);
      env.startSeconds = region.startSeconds;
      env.endSeconds = region.endSeconds;
      region.envelopes.push(env);
      this.state.selectedRegionId = region.id;
      this.state.selectedModulator = { kind: 'envelope', id: env.id };
    }
    this.refreshOverlay();
    this.onRegionUpdated?.(region.id);
  }

  removeModulatorFromRegion(regionId: string, modulator: SelectedModulator) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;

    if (modulator.kind === 'lfo') {
      const idx = region.lfos.findIndex((l) => l.id === modulator.id);
      if (idx >= 0) {
        const lfo = region.lfos[idx];
        this.modulation.removeLfo(lfo.id);
        region.lfos.splice(idx, 1);
      }
    } else {
      const idx = region.envelopes.findIndex((e) => e.id === modulator.id);
      if (idx >= 0) {
        const env = region.envelopes[idx];
        this.modulation.removeEnvelope(env.id);
        region.envelopes.splice(idx, 1);
      }
    }

    const remaining = region.lfos.length + region.envelopes.length;
    if (remaining <= 0) {
      this.removeRegion(regionId);
      return;
    }

    if (
      this.state.selectedRegionId === regionId &&
      this.state.selectedModulator?.id === modulator.id &&
      this.state.selectedModulator?.kind === modulator.kind
    ) {
      this.ensureSelectedModulatorForRegion(region);
    }

    this.refreshOverlay();
    this.onRegionUpdated?.(regionId);
  }

  removeRegion(regionId: string) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;
    for (const lfo of region.lfos) this.modulation.removeLfo(lfo.id);
    for (const env of region.envelopes) this.modulation.removeEnvelope(env.id);
    this.state.regionsById.delete(regionId);
    if (this.state.selectedRegionId === regionId) {
      this.state.selectedRegionId = null;
      this.state.selectedModulator = null;
      this.onRegionSelected?.(null);
    }
    this.refreshOverlay();
    this.onRegionRemoved?.(regionId);
  }

  moveModulatorBetweenRegions(payload: DraggedModulatorPayload, toRegionId: string) {
    const from = this.state.regionsById.get(payload.fromRegionId);
    const to = this.state.regionsById.get(toRegionId);
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
      this.state.regionsById.delete(from.id);
      this.onRegionRemoved?.(from.id);
    } else {
      this.onRegionUpdated?.(from.id);
    }
    this.onRegionUpdated?.(to.id);

    if (
      this.state.selectedRegionId === from.id &&
      this.state.selectedModulator?.kind === payload.kind &&
      this.state.selectedModulator?.id === payload.id
    ) {
      this.selectModulatorInRegion(to.id, { kind: payload.kind, id: payload.id });
      return;
    }

    if (fromNowEmpty && this.state.selectedRegionId === from.id) {
      this.selectRegion(to.id);
      return;
    }

    this.refreshOverlay();
  }

  readDraggedModulator(e: DragEvent): DraggedModulatorPayload | null {
    if (this.state.draggingModulator) return this.state.draggingModulator;
    const dt = e.dataTransfer;
    if (!dt) return null;
    const raw = dt.getData('application/x-pipes-modulator') || dt.getData('text/plain') || '';
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
  }

  setDraggingModulator(payload: DraggedModulatorPayload | null) {
    this.state.draggingModulator = payload;
  }

  beginRegionDrag(regionId: string, mode: RegionDragMode, secondsPerPx: number, e: PointerEvent) {
    const region = this.state.regionsById.get(regionId);
    if (!region) return;
    this.closeContextMenu();
    this.selectRegion(regionId);
    this.regionDrag = {
      regionId,
      mode,
      startClientX: e.clientX,
      originStart: region.startSeconds,
      originEnd: region.endSeconds,
      secondsPerPx,
    };
  }

  updateRegionDrag(clientX: number) {
    const drag = this.regionDrag;
    if (!drag) return false;
    const region = this.state.regionsById.get(drag.regionId);
    if (!region) return false;

    const dx = clientX - drag.startClientX;
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

    this.applyRegionTimeWindow(region, nextStart, nextEnd, 'round', 'round');
    return true;
  }

  endRegionDrag() {
    this.regionDrag = null;
  }

  applyRegionTimeWindow(
    region: TimelineRegion,
    startSeconds: number,
    endSeconds: number,
    startMode: SnapMode,
    endMode: SnapMode
  ) {
    const { start, end } = this.snapRegionWindow(startSeconds, endSeconds, startMode, endMode);
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
    this.refreshOverlay();
    this.onRegionUpdated?.(region.id);
  }

  captureInitialValues() {
    for (const target of this.getSortedTargets()) {
      const current = target.getCurrent();
      if (!isFinite(current)) continue;
      this.modulation.setBaseValue(target.id, current);
    }
    this.touch();
  }

  jumpToZero() {
    this.onJumpToZero?.();
  }

  setTargetBaseValue(target: ModulationTarget, value: number) {
    if (!isFinite(value)) return;
    let next = value;
    if (target.min !== undefined) next = Math.max(target.min, next);
    if (target.max !== undefined) next = Math.min(target.max, next);
    target.apply(next);
    this.modulation.setBaseValue(target.id, next);
    this.touch();
  }

  getTargetBaseValue(target: ModulationTarget) {
    const base = this.modulation.getBaseValue(target.id);
    const value = typeof base === 'number' && isFinite(base) ? base : target.getCurrent();
    return isFinite(value) ? value : 0;
  }

  getSortedTargets() {
    return this.modulation
      .getTargets()
      .slice()
      .sort((a, b) => {
        const ga = a.group ?? '';
        const gb = b.group ?? '';
        if (ga !== gb) return ga.localeCompare(gb);
        return a.label.localeCompare(b.label);
      });
  }

  getWaveOptions(): Array<{ label: string; value: Waveform }> {
    return [
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
  }

  fmtTime(time: number) {
    const m = Math.floor(time / 60);
    const s = (time % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  computeDeltaRange(lfo: TimelineLfo) {
    const target = this.modulation.getTarget(lfo.targetId);
    const scale = target ? this.getTargetScale(target) : 1;
    const offset = lfo.offset * scale;
    const amt = lfo.amount * scale;
    const min = lfo.bipolar ? offset - amt : offset;
    const max = lfo.bipolar ? offset + amt : offset + amt;
    return { min, max, scale, target };
  }

  applyLfoDeltaRange(lfo: TimelineLfo, deltaMin: number, deltaMax: number) {
    if (!isFinite(deltaMin) || !isFinite(deltaMax)) return;
    let min = deltaMin;
    let max = deltaMax;
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    const target = this.modulation.getTarget(lfo.targetId);
    const rawScale = target ? this.getTargetScale(target) : 1;
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
  }

  getLfoBaseValue(lfo: TimelineLfo) {
    const target = this.modulation.getTarget(lfo.targetId);
    const base = this.modulation.getBaseValue(lfo.targetId);
    const baseValue = typeof base === 'number' && isFinite(base) ? base : target ? target.getCurrent() : 0;
    return isFinite(baseValue) ? baseValue : 0;
  }

  clampRangeToTarget(targetId: string, min: number, max: number) {
    const target = this.modulation.getTarget(targetId);
    let minAbs = min;
    let maxAbs = max;
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
    return { min: minAbs, max: maxAbs };
  }

  getTarget(targetId: string) {
    return this.modulation.getTarget(targetId);
  }

  getTargetLabel(targetId: string) {
    return this.modulation.getTarget(targetId)?.label ?? targetId;
  }

  getTargetGroupLabel(targetId: string) {
    return this.modulation.getTarget(targetId)?.group ?? '';
  }

  touch() {
    this.state.revision += 1;
  }

  private normalizeBpm(bpm: number) {
    if (!isFinite(bpm)) return 120;
    return Math.max(10, bpm);
  }

  private normalizeDuration(duration: number | null) {
    if (typeof duration !== 'number' || !isFinite(duration) || duration <= 0) return null;
    return duration;
  }

  private barSeconds() {
    return (60 / this.state.bpm) * BEATS_PER_BAR;
  }

  private getTargetScale(target: ModulationTarget) {
    if (target.range !== undefined) return target.range;
    const span = (target.max ?? 0) - (target.min ?? 0);
    if (isFinite(span) && Math.abs(span) > 0) return span;
    return 1;
  }

  private snapToBar(time: number, mode: SnapMode) {
    const bar = this.barSeconds();
    if (!isFinite(bar) || bar <= 0) return time;
    const k = time / bar;
    const snapped = mode === 'floor' ? Math.floor(k) : mode === 'ceil' ? Math.ceil(k) : Math.round(k);
    return snapped * bar;
  }

  private clampTime(time: number) {
    let v = Math.max(0, time);
    if (this.state.durationSeconds !== null && isFinite(this.state.durationSeconds)) {
      v = Math.min(this.state.durationSeconds, v);
    }
    return v;
  }

  private snapRegionWindow(startSeconds: number, endSeconds: number, startMode: SnapMode, endMode: SnapMode) {
    const bar = this.barSeconds();
    const start = this.snapToBar(this.clampTime(startSeconds), startMode);
    const endRaw = this.snapToBar(this.clampTime(endSeconds), endMode);
    const end = endRaw <= start ? start + bar : endRaw;
    return { start, end: this.clampTime(end) };
  }

  private ensureSelectedModulatorForRegion(region: TimelineRegion) {
    const sel = this.state.selectedModulator;
    if (sel) {
      const exists =
        (sel.kind === 'lfo' && region.lfos.some((l) => l.id === sel.id)) ||
        (sel.kind === 'envelope' && region.envelopes.some((e) => e.id === sel.id));
      if (exists) return;
    }
    const firstLfo = region.lfos[0] ?? null;
    const firstEnv = region.envelopes[0] ?? null;
    if (firstLfo) this.state.selectedModulator = { kind: 'lfo', id: firstLfo.id };
    else if (firstEnv) this.state.selectedModulator = { kind: 'envelope', id: firstEnv.id };
    else this.state.selectedModulator = null;
  }

  private createRegionId() {
    return `reg-${Math.random().toString(16).slice(2)}`;
  }

  private packRegionsIntoRows(regions: TimelineRegion[]) {
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
  }

  private computeOverlayState(): OverlayState {
    const metrics = this.viewMetrics;
    if (!metrics) {
      return { visible: false, heightPx: 0, rows: [], viewWidthPx: 0, secondsPerPx: 0 };
    }
    const { startSeconds: viewStart, endSeconds: viewEnd, widthPx: viewWidthPx, secondsPerPx, timeToPixelOffset } =
      metrics;
    if (!isFinite(viewStart) || !isFinite(viewEnd) || viewEnd <= viewStart || viewWidthPx <= 0) {
      return { visible: false, heightPx: 0, rows: [], viewWidthPx: 0, secondsPerPx: 0 };
    }

    const regions = Array.from(this.state.regionsById.values());
    if (regions.length === 0) {
      return { visible: false, heightPx: 0, rows: [], viewWidthPx: 0, secondsPerPx };
    }

    const { rowByRegionId, rowCount } = this.packRegionsIntoRows(regions);
    const safeRowCount = Math.max(1, rowCount);
    const rowHeightPx = Math.max(
      10,
      Math.min(REGION_ROW_HEIGHT_PX, Math.floor(REGION_LANES_MAX_HEIGHT_PX / safeRowCount))
    );
    const contentHeight = safeRowCount * rowHeightPx;

    const rows: OverlayRow[] = [];
    for (let i = 0; i < safeRowCount; i++) {
      rows.push({ id: i, heightPx: rowHeightPx, widthPx: viewWidthPx, blocks: [] });
    }

    for (const region of regions) {
      const rowIdx = rowByRegionId.get(region.id) ?? 0;
      const row = rows[Math.max(0, Math.min(rows.length - 1, rowIdx))];
      if (!row) continue;

      const leftRaw = timeToPixelOffset(region.startSeconds);
      const rightRaw = timeToPixelOffset(region.endSeconds);
      const left = Math.max(0, leftRaw);
      const right = Math.min(viewWidthPx, rightRaw);
      if (right <= 0 || left >= viewWidthPx) continue;
      const width = Math.max(1, right - left);
      const inset = Math.max(1, Math.min(3, Math.floor(rowHeightPx / 5)));
      const selected = region.id === this.state.selectedRegionId;
      const modCount = region.lfos.length + region.envelopes.length;
      const label = `${modCount} mod${modCount === 1 ? '' : 's'}`;

      row.blocks.push({
        id: region.id,
        regionId: region.id,
        left,
        width,
        top: inset,
        bottom: inset,
        label,
        title: `${this.fmtTime(region.startSeconds)} -> ${this.fmtTime(region.endSeconds)}`,
        selected,
        showLabel: rowHeightPx >= 14,
      });
    }

    return {
      visible: regions.length > 0,
      heightPx: contentHeight,
      rows,
      viewWidthPx,
      secondsPerPx,
    };
  }

  private clearSchedule(shouldSelect = true) {
    this.state.draggingModulator = null;
    this.regionDrag = null;
    for (const region of this.state.regionsById.values()) {
      for (const lfo of region.lfos) this.modulation.removeLfo(lfo.id);
      for (const env of region.envelopes) this.modulation.removeEnvelope(env.id);
    }
    this.state.regionsById.clear();
    if (shouldSelect) {
      this.selectRegion(null);
    } else {
      this.state.selectedRegionId = null;
      this.state.selectedModulator = null;
    }
  }
}

export type { DraggedModulatorPayload, TimelineRegion };
