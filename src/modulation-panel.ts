import { createApp, type App } from 'vue';
import ModulationPanelApp from './modulation-panel-ui/ModulationPanelApp.vue';
import { ModulationPanelModel } from './modulation-panel-model';
import type {
  ModulationPanelOptions,
  ModulationRenderSchedule,
  ModulationTimelineData,
  ModulationTimelineImport,
  ModulationTimelineAdapter,
  TimelineEventKind,
} from './modulation-panel-types';

export type {
  ModulationBackend,
  ModulationPanelOptions,
  ModulationRenderSchedule,
  ModulationTimelineData,
  ModulationTimelineImport,
  ModulationTimelineAdapter,
  TimelineEventKind,
  TimelineViewMetrics,
} from './modulation-panel-types';

export class ModulationPanel {
  private container: HTMLElement;
  private overlayContainer: HTMLElement;
  private menuRoot: HTMLElement;
  private model: ModulationPanelModel;
  private app: App<Element> | null = null;

  private timelineAdapter: ModulationTimelineAdapter | null = null;
  private detachViewUpdates: (() => void) | null = null;
  private detachContextMenu: (() => void) | null = null;

  constructor(options: ModulationPanelOptions) {
    this.container = options.container;
    this.overlayContainer = options.overlayContainer;
    this.menuRoot = options.menuRoot ?? options.container;

    this.model = new ModulationPanelModel({
      modulation: options.modulation,
      bpm: options.bpm,
      durationSeconds: options.durationSeconds ?? null,
      insertKind: options.insertKind,
      onRegionInserted: options.onRegionInserted,
      onRegionUpdated: options.onRegionUpdated,
      onRegionRemoved: options.onRegionRemoved,
      onRegionSelected: options.onRegionSelected,
      onJumpToZero: options.onJumpToZero,
    });

    this.container.textContent = '';
    this.app = createApp(ModulationPanelApp, {
      model: this.model,
      overlayContainer: this.overlayContainer,
      menuRoot: this.menuRoot,
    });
    this.app.mount(this.container);
  }

  setTimelineAdapter(adapter: ModulationTimelineAdapter | null) {
    if (this.detachViewUpdates) {
      this.detachViewUpdates();
      this.detachViewUpdates = null;
    }
    if (this.detachContextMenu) {
      this.detachContextMenu();
      this.detachContextMenu = null;
    }

    this.timelineAdapter = adapter;
    if (adapter) {
      this.model.setViewMetrics(adapter.getViewMetrics());
      this.detachViewUpdates = adapter.onViewUpdated(() => this.model.setViewMetrics(adapter.getViewMetrics()));
      this.detachContextMenu = adapter.onContextMenu((clientX, clientY, timeSeconds) => {
        this.model.openTimelineContextMenu(clientX, clientY, timeSeconds);
      });
    } else {
      this.model.setViewMetrics(null);
    }
  }

  closeContextMenu() {
    this.model.closeContextMenu();
  }

  renderOverlay() {
    this.model.setViewMetrics(this.timelineAdapter?.getViewMetrics() ?? null);
  }

  setBpm(bpm: number) {
    this.model.setBpm(bpm);
  }

  getBpm() {
    return this.model.getBpm();
  }

  setDuration(durationSeconds: number | null) {
    this.model.setDuration(durationSeconds);
  }

  getDurationSeconds() {
    return this.model.getDurationSeconds();
  }

  setInsertKind(kind: TimelineEventKind) {
    this.model.setInsertKind(kind);
  }

  getSelectedRegionId() {
    return this.model.getSelectedRegionId();
  }

  getRenderSchedule(): ModulationRenderSchedule | null {
    return this.model.getRenderSchedule();
  }

  getTimelineData(): ModulationTimelineData {
    return this.model.getTimelineData();
  }

  loadTimelineData(data: ModulationTimelineImport) {
    this.model.loadTimelineData(data);
  }

  clear() {
    this.model.clear();
  }

  destroy() {
    this.setTimelineAdapter(null);
    this.model.destroy();
    this.app?.unmount();
    this.app = null;
  }
}
