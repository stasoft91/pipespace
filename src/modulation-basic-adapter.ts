import type { ModulationTimelineAdapter, TimelineViewMetrics } from './modulation-panel-types';

export type BasicTimelineView = {
  startSeconds: number;
  endSeconds: number;
  widthPx: number;
};

export type BasicTimelineAdapterOptions = {
  container?: HTMLElement | null;
  view?: BasicTimelineView | null;
};

export class BasicTimelineAdapter implements ModulationTimelineAdapter {
  private container: HTMLElement | null = null;
  private view: BasicTimelineView | null = null;
  private contextHandlers = new Set<(clientX: number, clientY: number, timeSeconds: number) => void>();
  private viewHandlers = new Set<() => void>();
  private boundContextMenu: ((event: MouseEvent) => void) | null = null;

  constructor(options: BasicTimelineAdapterOptions = {}) {
    this.container = options.container ?? null;
    this.view = options.view ?? null;
    this.bindContainer();
  }

  setContainer(container: HTMLElement | null) {
    if (container === this.container) return;
    this.unbindContainer();
    this.container = container;
    this.bindContainer();
  }

  setView(view: BasicTimelineView | null) {
    this.view = view;
    this.emitViewUpdated();
  }

  setViewWindow(startSeconds: number, endSeconds: number, widthPx?: number) {
    const resolvedWidth =
      typeof widthPx === 'number'
        ? widthPx
        : this.view?.widthPx ?? this.container?.clientWidth ?? this.container?.getBoundingClientRect().width ?? 0;
    this.view = {
      startSeconds,
      endSeconds,
      widthPx: Math.max(0, Math.round(resolvedWidth)),
    };
    this.emitViewUpdated();
  }

  notifyViewUpdated() {
    this.emitViewUpdated();
  }

  getViewMetrics(): TimelineViewMetrics | null {
    if (!this.view) return null;
    const { startSeconds, endSeconds, widthPx } = this.view;
    if (!isFinite(startSeconds) || !isFinite(endSeconds) || endSeconds <= startSeconds || widthPx <= 0) {
      return null;
    }
    const secondsPerPx = (endSeconds - startSeconds) / Math.max(1, widthPx);
    const timeToPixelOffset = (timeSeconds: number) => {
      const duration = endSeconds - startSeconds;
      if (!isFinite(duration) || duration <= 0) return 0;
      const t = (timeSeconds - startSeconds) / duration;
      return t * widthPx;
    };
    return { startSeconds, endSeconds, widthPx, secondsPerPx, timeToPixelOffset };
  }

  onContextMenu(handler: (clientX: number, clientY: number, timeSeconds: number) => void) {
    this.contextHandlers.add(handler);
    return () => this.contextHandlers.delete(handler);
  }

  onViewUpdated(handler: () => void) {
    this.viewHandlers.add(handler);
    return () => this.viewHandlers.delete(handler);
  }

  destroy() {
    this.unbindContainer();
    this.contextHandlers.clear();
    this.viewHandlers.clear();
  }

  private bindContainer() {
    if (!this.container) return;
    this.boundContextMenu = (event: MouseEvent) => {
      const metrics = this.getViewMetrics();
      if (!metrics) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = this.container?.getBoundingClientRect();
      if (!rect) return;
      const localX = event.clientX - rect.left;
      const clampedX = Math.max(0, Math.min(metrics.widthPx, localX));
      const t =
        metrics.startSeconds +
        (clampedX / Math.max(1, metrics.widthPx)) * (metrics.endSeconds - metrics.startSeconds);
      for (const handler of this.contextHandlers) {
        handler(event.clientX, event.clientY, t);
      }
    };
    this.container.addEventListener('contextmenu', this.boundContextMenu);
  }

  private unbindContainer() {
    if (this.container && this.boundContextMenu) {
      this.container.removeEventListener('contextmenu', this.boundContextMenu);
    }
    this.boundContextMenu = null;
  }

  private emitViewUpdated() {
    for (const handler of this.viewHandlers) {
      handler();
    }
  }
}
