import type { PeaksInstance, WaveformViewPointerEvent } from 'peaks.js';
import type { ModulationTimelineAdapter, TimelineViewMetrics } from './modulation-panel-types';

export class PeaksTimelineAdapter implements ModulationTimelineAdapter {
  private peaks: PeaksInstance;
  private zoomviewContainer: HTMLElement;

  constructor(peaks: PeaksInstance, zoomviewContainer: HTMLElement) {
    this.peaks = peaks;
    this.zoomviewContainer = zoomviewContainer;
  }

  getViewMetrics(): TimelineViewMetrics | null {
    const laneView = this.peaks.views.getView('zoomview') ?? null;
    if (!laneView) return null;
    const viewStart = laneView.getStartTime();
    const viewEnd = laneView.getEndTime();
    const laneAny = laneView as any;
    const viewWidthPx =
      (typeof laneAny.getWidth === 'function' ? Number(laneAny.getWidth()) : 0) ||
      this.zoomviewContainer.clientWidth ||
      Math.round(this.zoomviewContainer.getBoundingClientRect().width);
    if (!isFinite(viewStart) || !isFinite(viewEnd) || viewEnd <= viewStart || viewWidthPx <= 0) return null;

    const timeToPixelOffset = (timeSeconds: number) => {
      if (typeof laneAny.timeToPixelOffset === 'function') {
        return Number(laneAny.timeToPixelOffset(timeSeconds));
      }
      const t = (timeSeconds - viewStart) / (viewEnd - viewStart);
      return t * viewWidthPx;
    };

    const secondsPerPx =
      typeof laneAny.pixelsToTime === 'function'
        ? Number(laneAny.pixelsToTime(1))
        : (viewEnd - viewStart) / Math.max(1, viewWidthPx);

    return {
      startSeconds: viewStart,
      endSeconds: viewEnd,
      widthPx: viewWidthPx,
      secondsPerPx,
      timeToPixelOffset,
    };
  }

  onContextMenu(handler: (clientX: number, clientY: number, timeSeconds: number) => void) {
    const onWaveformContextMenu = (event: WaveformViewPointerEvent) => {
      event.evt.preventDefault();
      event.evt.stopPropagation();
      handler(event.evt.clientX, event.evt.clientY, event.time);
    };

    this.peaks.on('zoomview.contextmenu', onWaveformContextMenu);
    this.peaks.on('overview.contextmenu', onWaveformContextMenu);

    return () => {
      const peaksAny = this.peaks as PeaksInstance & { off?: (eventName: string, cb: (evt: any) => void) => void };
      peaksAny.off?.('zoomview.contextmenu', onWaveformContextMenu);
      peaksAny.off?.('overview.contextmenu', onWaveformContextMenu);
    };
  }

  onViewUpdated(handler: () => void) {
    const onZoom = () => handler();
    const onUpdate = () => handler();
    this.peaks.on('zoom.update', onZoom);
    this.peaks.on('zoomview.update', onUpdate);

    return () => {
      const peaksAny = this.peaks as PeaksInstance & { off?: (eventName: string, cb: () => void) => void };
      peaksAny.off?.('zoom.update', onZoom);
      peaksAny.off?.('zoomview.update', onUpdate);
    };
  }
}
