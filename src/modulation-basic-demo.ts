import { ModulationPanel } from './modulation-panel';
import { BasicTimelineAdapter } from './modulation-basic-adapter';
import type { ModulationBackend, TimelineEventKind } from './modulation-panel-types';
import type { ProjectTimeline } from './project';
import type { RenderSchedule } from './timeline';

export type BasicTimelineInitOptions = {
  container: HTMLElement;
  bpm: number;
  modulation: ModulationBackend;
  durationSeconds?: number | null;
  onBpmChange?: (bpm: number) => void;
  onRegionInserted?: (regionId: string) => void;
  onRegionUpdated?: (regionId: string) => void;
  onRegionRemoved?: (regionId: string) => void;
  onRegionSelected?: (regionId: string | null) => void;
};

export function initBasicTimelineDemo(options: BasicTimelineInitOptions) {
  const { container } = options;
  container.textContent = '';

  const controls = document.createElement('div');
  controls.className = 'timeline-controls';
  container.appendChild(controls);

  const bpmLabel = document.createElement('label');
  bpmLabel.className = 'timeline-bpm';
  bpmLabel.textContent = 'BPM';
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number';
  bpmInput.min = '10';
  bpmInput.max = '400';
  bpmInput.step = '1';
  let bpm = Math.max(10, options.bpm);
  bpmInput.value = String(bpm);
  bpmLabel.appendChild(bpmInput);
  controls.appendChild(bpmLabel);

  const durationLabel = document.createElement('label');
  durationLabel.className = 'timeline-bpm';
  durationLabel.textContent = 'Duration (s)';
  const durationInput = document.createElement('input');
  durationInput.type = 'number';
  durationInput.min = '1';
  durationInput.step = '1';
  let durationSeconds =
    typeof options.durationSeconds === 'number' && isFinite(options.durationSeconds) && options.durationSeconds > 0
      ? options.durationSeconds
      : 60;
  durationInput.value = String(durationSeconds);
  durationLabel.appendChild(durationInput);
  controls.appendChild(durationLabel);

  const viewStartLabel = document.createElement('label');
  viewStartLabel.className = 'timeline-bpm';
  viewStartLabel.textContent = 'View start';
  const viewStartInput = document.createElement('input');
  viewStartInput.type = 'number';
  viewStartInput.min = '0';
  viewStartInput.step = '0.5';
  let viewStart = 0;
  viewStartInput.value = String(viewStart);
  viewStartLabel.appendChild(viewStartInput);
  controls.appendChild(viewStartLabel);

  const viewEndLabel = document.createElement('label');
  viewEndLabel.className = 'timeline-bpm';
  viewEndLabel.textContent = 'View end';
  const viewEndInput = document.createElement('input');
  viewEndInput.type = 'number';
  viewEndInput.min = '1';
  viewEndInput.step = '0.5';
  let viewEnd = Math.max(viewStart + 4, durationSeconds);
  viewEndInput.value = String(viewEnd);
  viewEndLabel.appendChild(viewEndInput);
  controls.appendChild(viewEndLabel);

  const body = document.createElement('div');
  body.className = 'timeline-body';
  container.appendChild(body);

  const lfoPanel = document.createElement('div');
  lfoPanel.className = 'lfo-panel';
  body.appendChild(lfoPanel);

  const timelineStack = document.createElement('div');
  timelineStack.className = 'waveform-stack';
  body.appendChild(timelineStack);

  const timelineView = document.createElement('div');
  timelineView.className = 'basic-timeline-view';
  timelineView.setAttribute('aria-label', 'Basic timeline view');
  timelineStack.appendChild(timelineView);

  const axis = document.createElement('div');
  axis.className = 'basic-timeline-axis';
  timelineView.appendChild(axis);

  const zoomviewRegionLanesOverlay = document.createElement('div');
  zoomviewRegionLanesOverlay.className = 'zoomview-region-lanes-overlay';
  zoomviewRegionLanesOverlay.style.display = 'none';
  timelineView.appendChild(zoomviewRegionLanesOverlay);

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
    modulationPanel.setInsertKind(insertKind);
  });
  insertLabel.appendChild(insertSelect);
  controls.appendChild(insertLabel);

  const modulationPanel = new ModulationPanel({
    container: lfoPanel,
    overlayContainer: zoomviewRegionLanesOverlay,
    modulation: options.modulation,
    bpm,
    durationSeconds,
    insertKind,
    menuRoot: container,
    onRegionInserted: options.onRegionInserted,
    onRegionUpdated: options.onRegionUpdated,
    onRegionRemoved: options.onRegionRemoved,
    onRegionSelected: options.onRegionSelected,
  });

  const adapter = new BasicTimelineAdapter({ container: timelineView });
  modulationPanel.setTimelineAdapter(adapter);

  const updateAxis = () => {
    axis.textContent = `View: ${viewStart.toFixed(2)}s -> ${viewEnd.toFixed(2)}s`;
  };

  const updateView = () => {
    if (!isFinite(viewStart)) viewStart = 0;
    if (!isFinite(viewEnd)) viewEnd = viewStart + 4;
    if (viewEnd <= viewStart) viewEnd = viewStart + 4;
    if (durationSeconds > 0) {
      viewStart = Math.max(0, Math.min(durationSeconds, viewStart));
      viewEnd = Math.max(viewStart + 0.1, Math.min(durationSeconds, viewEnd));
    }
    viewStartInput.value = String(viewStart);
    viewEndInput.value = String(viewEnd);

    const width = timelineView.clientWidth || Math.round(timelineView.getBoundingClientRect().width);
    adapter.setViewWindow(viewStart, viewEnd, width);
    modulationPanel.renderOverlay();
    updateAxis();
  };

  bpmInput.addEventListener('change', () => {
    const next = Math.max(10, Number(bpmInput.value) || bpm);
    bpm = next;
    bpmInput.value = String(next);
    modulationPanel.setBpm(next);
    options.onBpmChange?.(next);
  });

  durationInput.addEventListener('change', () => {
    const next = Math.max(1, Number(durationInput.value) || durationSeconds);
    durationSeconds = next;
    durationInput.value = String(next);
    modulationPanel.setDuration(durationSeconds);
    if (viewEnd > durationSeconds) viewEnd = durationSeconds;
    updateView();
  });

  viewStartInput.addEventListener('change', () => {
    viewStart = Number(viewStartInput.value) || 0;
    updateView();
  });

  viewEndInput.addEventListener('change', () => {
    viewEnd = Number(viewEndInput.value) || viewStart + 4;
    updateView();
  });

  const resizeObserver = new ResizeObserver(() => updateView());
  resizeObserver.observe(timelineView);

  updateView();

  return {
    getSelectedRegionId: () => modulationPanel.getSelectedRegionId(),
    getPlayheadSeconds: () => null,
    getRenderSchedule: (): RenderSchedule | null => {
      const schedule = modulationPanel.getRenderSchedule();
      if (!schedule) return null;
      return { ...schedule, videoResolution: 1080 };
    },
    getProjectTimeline: (): ProjectTimeline => {
      const data = modulationPanel.getTimelineData();
      return {
        bpm: data?.bpm ?? bpm,
        durationSeconds: data?.durationSeconds ?? durationSeconds,
        audioFileName: null,
        lfos: data?.lfos ?? [],
        envelopes: data?.envelopes,
      };
    },
    loadProjectTimeline: (timeline: ProjectTimeline) => {
      modulationPanel.closeContextMenu();
      modulationPanel.clear();

      bpm = Math.max(10, Number(timeline.bpm) || bpm);
      bpmInput.value = String(bpm);
      modulationPanel.setBpm(bpm);
      options.onBpmChange?.(bpm);

      durationSeconds =
        isFinite(Number(timeline.durationSeconds)) && Number(timeline.durationSeconds) > 0
          ? Number(timeline.durationSeconds)
          : durationSeconds;
      durationInput.value = String(durationSeconds);
      modulationPanel.setDuration(durationSeconds);

      viewStart = 0;
      viewEnd = Math.max(viewStart + 4, durationSeconds);
      updateView();

      modulationPanel.loadTimelineData({
        bpm,
        durationSeconds,
        lfos: timeline.lfos ?? [],
        envelopes: timeline.envelopes ?? [],
      });
    },
    destroy: () => {
      resizeObserver.disconnect();
      adapter.destroy();
      modulationPanel.destroy();
    },
  };
}
