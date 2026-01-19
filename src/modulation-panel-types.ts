import type { EnvelopeConfig, LfoConfig, ModulationTarget } from './modulation';

export type TimelineEventKind = 'lfo' | 'envelope';

export interface ModulationBackend {
  getTargets(): ModulationTarget[];
  getTarget(id: string): ModulationTarget | undefined;
  addLfo(partial: Partial<LfoConfig>): LfoConfig | null;
  removeLfo(id: string): void;
  addEnvelope(partial: Partial<EnvelopeConfig>): EnvelopeConfig | null;
  removeEnvelope(id: string): void;
  setBaseValue(targetId: string, value: number): void;
  getBaseValue(targetId: string): number | undefined;
}

export type TimelineViewMetrics = {
  startSeconds: number;
  endSeconds: number;
  widthPx: number;
  secondsPerPx: number;
  timeToPixelOffset: (timeSeconds: number) => number;
};

export interface ModulationTimelineAdapter {
  getViewMetrics(): TimelineViewMetrics | null;
  onContextMenu(handler: (clientX: number, clientY: number, timeSeconds: number) => void): () => void;
  onViewUpdated(handler: () => void): () => void;
}

export type ModulationPanelOptions = {
  container: HTMLElement;
  overlayContainer: HTMLElement;
  modulation: ModulationBackend;
  bpm: number;
  durationSeconds?: number | null;
  insertKind?: TimelineEventKind;
  menuRoot?: HTMLElement;
  onRegionInserted?: (regionId: string) => void;
  onRegionUpdated?: (regionId: string) => void;
  onRegionRemoved?: (regionId: string) => void;
  onRegionSelected?: (regionId: string | null) => void;
  onJumpToZero?: () => void;
};

export type ModulationRenderSchedule = {
  bpm: number;
  durationSeconds: number;
  lfos: LfoConfig[];
  envelopes?: EnvelopeConfig[];
};

export type ModulationTimelineData = {
  bpm: number;
  durationSeconds: number;
  lfos: ModulationSegmentLfo[];
  envelopes?: ModulationSegmentEnvelope[];
};

export type ModulationSegmentLfo = {
  segmentId: string;
  lfo: Partial<LfoConfig>;
};

export type ModulationSegmentEnvelope = {
  segmentId: string;
  envelope: Partial<EnvelopeConfig>;
};

export type ModulationTimelineImport = {
  lfos: ModulationSegmentLfo[];
  envelopes?: ModulationSegmentEnvelope[];
  bpm?: number;
  durationSeconds?: number | null;
};
