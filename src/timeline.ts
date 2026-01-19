import Peaks, { type PeaksInstance } from 'peaks.js';
import type { EnvelopeConfig, LfoConfig } from './modulation';
import { ModulationPanel, type ModulationBackend, type TimelineEventKind } from './modulation-panel';
import { PeaksTimelineAdapter } from './modulation-peaks-adapter';
import { type ProjectFile, type ProjectTimeline, type ProjectSettings, parseProjectFile } from './project';

export type RenderSchedule = {
  bpm: number;
  durationSeconds: number;
  lfos: LfoConfig[];
  envelopes?: EnvelopeConfig[];
  videoResolution: number;
  videoFps?: number;
  settings?: ProjectSettings;
};

export type TimelineInitOptions = {
  container: HTMLElement;
  bpm: number;
  modulation: ModulationBackend;
  onRenderVideo?: (durationSeconds: number) => void;
  onSaveProject?: () => void;
  onLoadProject?: (project: ProjectFile) => void;
  onBpmChange?: (bpm: number) => void;
  onRegionInserted?: (regionId: string) => void;
  onRegionUpdated?: (regionId: string) => void;
  onRegionRemoved?: (regionId: string) => void;
  onRegionSelected?: (regionId: string | null) => void;
};

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
  let modulationPanel: ModulationPanel | null = null;
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
    modulationPanel?.setInsertKind(insertKind);
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
  let peaks: PeaksInstance | null = null;
  let audioUrl: string | null = null;
  let audioDurationSeconds: number | null = null;
  let audioFileName: string | null = null;
  let audioLoadToken = 0;
  let bpm = Math.max(10, options.bpm);

  const jumpToZero = () => {
    if (peaks) {
      peaks.player.pause();
      const seek = (peaks.player as any)?.seek;
      if (typeof seek === 'function') {
        seek.call(peaks.player, 0);
      }
    }
    audioEl.currentTime = 0;
    updatePlayBtn();
  };

  modulationPanel = new ModulationPanel({
    container: lfoPanel,
    overlayContainer: zoomviewRegionLanesOverlay,
    modulation: options.modulation,
    bpm,
    durationSeconds: audioDurationSeconds,
    insertKind,
    menuRoot: container,
    onRegionInserted: options.onRegionInserted,
    onRegionUpdated: options.onRegionUpdated,
    onRegionRemoved: options.onRegionRemoved,
    onRegionSelected: options.onRegionSelected,
    onJumpToZero: jumpToZero,
  });

  const zoomLevels = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];

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

  const detachZoomviewContent = () => {
    for (const child of Array.from(zoomviewContainer.children)) {
      if (child !== zoomviewRegionLanesOverlay) {
        zoomviewContainer.removeChild(child);
      }
    }
    if (!zoomviewRegionLanesOverlay.parentElement) {
      zoomviewContainer.appendChild(zoomviewRegionLanesOverlay);
    }
  };

  const destroyPeaks = (keepAudio = false) => {
    if (peaks) {
      peaks.destroy();
      peaks = null;
    }
    modulationPanel?.setTimelineAdapter(null);
    if (!keepAudio && audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
      audioEl.removeAttribute('src');
      audioEl.load();
      audioDurationSeconds = null;
      modulationPanel?.setDuration(audioDurationSeconds);
    }
    overviewContainer.textContent = '';
    detachZoomviewContent();
    modulationPanel?.renderOverlay();
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
        });

        modulationPanel?.setTimelineAdapter(new PeaksTimelineAdapter(peaks, zoomviewContainer));
        modulationPanel?.renderOverlay();
      }
    );
  };

  loadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const token = ++audioLoadToken;
    modulationPanel?.closeContextMenu();
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
      modulationPanel?.setDuration(audioDurationSeconds);
      updateRenderEnabled();
      initPeaks(audioBuffer);
    } catch (err) {
      console.error('Failed to load MP3 into Peaks', err);
      audioDurationSeconds = isFinite(audioEl.duration) ? audioEl.duration : null;
      modulationPanel?.setDuration(audioDurationSeconds);
      updateRenderEnabled();
    }
  });

  bpmInput.addEventListener('change', () => {
    const next = Math.max(10, Number(bpmInput.value) || bpm);
    bpm = next;
    bpmInput.value = String(next);
    modulationPanel?.setBpm(next);
    options.onBpmChange?.(next);
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
    modulationPanel?.renderOverlay();
  };

  const resizeObserver = new ResizeObserver(() => fitWaveforms());
  resizeObserver.observe(container);

  return {
    getPeaks: () => peaks,
    getSelectedRegionId: () => modulationPanel?.getSelectedRegionId() ?? null,
    getPlayheadSeconds: () => {
      if (!audioEl.src) return null;
      return audioEl.currentTime;
    },
    getRenderSchedule: (): RenderSchedule | null => {
      const schedule = modulationPanel?.getRenderSchedule();
      if (!schedule) return null;
      return { ...schedule, videoResolution };
    },
    getProjectTimeline: (): ProjectTimeline => {
      const data = modulationPanel?.getTimelineData();
      return {
        bpm: data?.bpm ?? bpm,
        durationSeconds: data?.durationSeconds ?? 0,
        audioFileName,
        lfos: data?.lfos ?? [],
        envelopes: data?.envelopes,
      };
    },
    loadProjectTimeline: (timeline: ProjectTimeline) => {
      modulationPanel?.closeContextMenu();
      destroyPeaks(false);
      modulationPanel?.clear();

      bpm = Math.max(10, Number(timeline.bpm) || bpm);
      bpmInput.value = String(bpm);
      modulationPanel?.setBpm(bpm);
      options.onBpmChange?.(bpm);

      audioDurationSeconds =
        isFinite(Number(timeline.durationSeconds)) && Number(timeline.durationSeconds) > 0
          ? Number(timeline.durationSeconds)
          : null;
      modulationPanel?.setDuration(audioDurationSeconds);
      audioFileName = timeline.audioFileName ?? null;
      updateAudioLabel();
      updateRenderEnabled();
      modulationPanel?.loadTimelineData({
        lfos: timeline.lfos ?? [],
        envelopes: timeline.envelopes ?? [],
      });
    },
    destroy: () => {
      resizeObserver.disconnect();
      destroyPeaks();
      modulationPanel?.destroy();
      modulationPanel = null;
    },
  };
}
