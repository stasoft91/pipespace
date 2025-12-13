import './style.css';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CylinderGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  CurvePath,
  EdgesGeometry,
  AdditiveBlending,
  LineCurve3,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Group,
  TubeGeometry,
  Vector3,
  Vector2,
  WebGLRenderer,
  DoubleSide,
  Quaternion,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { ModulationManager } from './modulation';
import { initTimeline, type RenderSchedule } from './timeline';
import { PROJECT_VERSION, stringifyProjectFile, type ProjectFile, type ProjectSettings } from './project';
import { Pipe, Simulation } from './simulation';
import type { SimulationConfig, Vec3 } from './simulation';
import { PhysicalRayMirrorSystem, RasterMirrorSystem, RayMirrorSystem, RayMirrorSystemAllFaces } from './mirrors';
import type { MirrorReflectionMode, MirrorSystem } from './mirrors';

type PathType = 'polyline' | 'catmullrom' | 'centripetal' | 'chordal';

type RenderSettings = {
  pathType: PathType;
  pipeRadius: number;
  tubularSegments: number;
  radialSegments: number;
  colorShift: number;
  backLightEnabled: boolean;
  backLightIntensity: number;
  backLightRange: number;
  backLightColor: string;
  edgeNeonEnabled: boolean;
  edgeNeonColor: string;
  edgeHueTravelEnabled: boolean;
  edgeHueTravelPeriod: number;
  edgeNeonStrength: number;
  edgeNeonShowMeshes: boolean;
  edgeNeonWidth: number;
  roomRoughness: number;
  roomMetalness: number;
  roomReflectivity: number;
  roomColor: string;
  showGrid: boolean;
  hidePipesInMainCamera: boolean;
  pipeMetalness: number;
  pipeRoughness: number;
  glassEnabled: boolean;
  glassTransmission: number;
  glassOpacity: number;
  glassIor: number;
  cornerTension: number;
  neonEnabled: boolean;
  neonStrength: number;
  neonSize: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
};

type OrbitSettings = {
  orbitSpeed: number;
  bobStrength: number;
};

type CameraMode = 'wall' | 'wallDrift' | 'orbit' | 'manual' | 'rail';
type MirrorRenderer = 'raster' | 'ray' | 'rayAllFaces' | 'physicalRay';
const modulation = new ModulationManager();
const modulationGlobals = { bpm: 120 };
let modulationBaseSetters: Record<string, (v: number) => void> = {};
let timelineHandle: ReturnType<typeof initTimeline> | null = null;
let ignoreAudioForModulation = false;
const BACKEND_RENDER_URL = 'http://localhost:3333/render';

async function requestBackendRender(schedule: RenderSchedule) {
  if (videoCaptureSettings.recording) return;
  console.log('Requesting backend render…');
  const res = await fetch(BACKEND_RENDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule, appUrl: window.location.origin + '/', outputBase: `render-${Date.now()}` }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Backend render request failed (${res.status}): ${text || res.statusText}`);
  }
  const payload = (await res.json().catch(() => ({}))) as { jobId?: string; outputBase?: string };
  console.log('Backend render started', payload);
}

let roomPadding = 15; // gap between grid extents and room walls
const roomGuiSettings = {
  wallGap: roomPadding,
};
let mirrorInset = 0.01;
let reflectorResScale = 1;
let reflectorMaxRes = 4096;
let mirrorFacesPerFrame = 6; // how many faces update each frame (reduces flicker/load)
let rayMaxBounces = 2;
let mirrorEnabled = true;
let mirrorReflectionMode: MirrorReflectionMode = 'all'; // how mirrors see each other
let mirrorRenderer: MirrorRenderer = 'physicalRay';
let mirrorBounceAttenuation = 0.65;
let mirrorBounceAttenuationMode: 'skipFirst' | 'allBounces' = 'skipFirst';
let mirrorBlurAmount = 0;
let mirrorChromaticShift = 0;
let mirrorWarpStrength = 0;
let mirrorWarpSpeed = 1.5;
let mirrorRefractionOffset = 0;
let mirrorNoiseStrength = 0;
const BASE_REFLECTOR_SHADER = (Reflector as any).ReflectorShader as any;
const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const randBool = (p = 0.5) => Math.random() < p;
const randColorHex = () => {
  const c = new Color().setHSL(Math.random(), rand(0.35, 0.85), rand(0.45, 0.7));
  return `#${c.getHexString()}`;
};
const hueFromHex = (hex: string) => {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.h;
};
const applyHueToHex = (hex: string, hue: number) => {
  const base = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const next = new Color().setHSL(((hue % 1) + 1) % 1, hsl.s, hsl.l);
  return `#${next.getHexString()}`;
};
const PATH_TYPES: PathType[] = ['polyline', 'catmullrom', 'centripetal', 'chordal'];
const root = document.createElement('div');
root.id = 'root';
document.body.appendChild(root);

const simPane = document.createElement('div');
simPane.id = 'sim-pane';
root.appendChild(simPane);

const splitter = document.createElement('div');
splitter.id = 'splitter';
root.appendChild(splitter);

const timelinePane = document.createElement('div');
timelinePane.id = 'timeline-pane';
root.appendChild(timelinePane);

const canvas = document.createElement('canvas');
canvas.id = 'pipes-canvas';
simPane.appendChild(canvas);

const simBounds = () => {
  const width = simPane.clientWidth || window.innerWidth;
  const height = simPane.clientHeight || window.innerHeight;
  return { width, height };
};

const infoOverlay = document.createElement('div');
infoOverlay.id = 'info';
document.body.appendChild(infoOverlay);

const recordingOverlay = document.createElement('div');
recordingOverlay.id = 'recording-progress';
Object.assign(recordingOverlay.style, {
  position: 'fixed',
  left: '50%',
  top: '18px',
  transform: 'translateX(-50%)',
  padding: '6px 10px',
  background: 'rgba(0, 0, 0, 0.7)',
  color: '#e7f2ff',
  fontFamily: 'monospace',
  fontSize: '12px',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '6px',
  pointerEvents: 'none',
  zIndex: '9999',
  display: 'none',
});
document.body.appendChild(recordingOverlay);

let lastRecordingLog = { label: '', pct: -1 };

function setRecordingProgress(fraction: number | null, label: string) {
  if (fraction === null) {
    recordingOverlay.style.display = 'none';
    if (lastRecordingLog.pct >= 0) {
      console.log(`[render] done`);
    }
    lastRecordingLog = { label: '', pct: -1 };
    return;
  }
  const clamped = clamp(fraction, 0, 1);
  const pct = Math.round(clamped * 100);
  recordingOverlay.textContent = `${label} ${pct}%`;
  recordingOverlay.style.display = 'block';
  if (pct !== lastRecordingLog.pct || label !== lastRecordingLog.label) {
    console.log(`[render] ${label} ${pct}%`);
    lastRecordingLog = { label, pct };
  }
}

const defaultSimConfig: SimulationConfig = {
  gridSize: 64,
  maxPipeLength: 42,
  targetPipeCount: 64,
  growthInterval: 1/30,
  turnProbability: 1,
  disableTailShrink: false,
};
const turnProxy = { turnChance: defaultSimConfig.turnProbability * 100 };

const renderSettings: RenderSettings = {
  pathType: 'catmullrom',
  pipeRadius: 0.08,
  tubularSegments: 16,
  radialSegments: 16,
  colorShift: 0,
  backLightEnabled: false,
  backLightIntensity: 1200,
  backLightRange: 0,
  backLightColor: '#ffffff',
  edgeNeonEnabled: true,
  edgeNeonColor: '#3de1ff',
  edgeHueTravelEnabled: false,
  edgeHueTravelPeriod: 8,
  edgeNeonStrength: 1.2,
  edgeNeonShowMeshes: true,
  edgeNeonWidth: 0.07,
  roomRoughness: 0.25,
  roomMetalness: 0.75,
  roomReflectivity: 1,
  roomColor: '#ffffff',
  showGrid: false,
  hidePipesInMainCamera: true,
  pipeMetalness: 0.68,
  pipeRoughness: 0.3,
  glassEnabled: false,
  glassTransmission: 0.65,
  glassOpacity: 0.35,
  glassIor: 1.2,
  cornerTension: 0,
  neonEnabled: true,
  neonStrength: 0.69,
  neonSize: 1.0,
  bloomStrength: 1,
  bloomRadius: 1,
  bloomThreshold: 0,
};

const mirrorGuiSettings = {
  inset: mirrorInset,
  resolutionScale: reflectorResScale,
  maxResolution: reflectorMaxRes,
  facesPerFrame: mirrorFacesPerFrame,
  enabled: mirrorEnabled,
  renderer: mirrorRenderer,
  rayBounces: rayMaxBounces,
  reflectionMode: mirrorReflectionMode,
  blur: mirrorBlurAmount,
  chromaticShift: mirrorChromaticShift,
  warpStrength: mirrorWarpStrength,
  warpSpeed: mirrorWarpSpeed,
  refractionOffset: mirrorRefractionOffset,
  noiseStrength: mirrorNoiseStrength,
  bounceAttenuation: mirrorBounceAttenuation,
  bounceAttenuationMode: mirrorBounceAttenuationMode,
};

const orbitSettings: OrbitSettings = {
  orbitSpeed: 0.42,
  bobStrength: 0.42,
};

const wallDriftSettings = {
  movement: 0.35,
  bobStrength: 0.22,
};

const railSettings = {
  speed: 0.22,
  radialFactor: 0.78,
  verticalWave: 0.26,
  noise: 0.16,
  posSmoothing: 0.35,
  targetSmoothing: 0.42,
  velocitySmoothing: 0.22,
  lookAhead: 0.18,
  manualNudge: 0.14,
  rollStrength: 0.28,
};

const railState = {
  phase: 0,
  desiredPos: new Vector3(),
  currentPos: new Vector3(),
  lastPos: new Vector3(),
  velocity: new Vector3(),
  rawVelocity: new Vector3(),
  desiredTarget: new Vector3(),
  smoothedTarget: new Vector3(),
  roll: 0,
};

const cameraControl = {
  mode: 'wall' as CameraMode,
  wallFace: 4, // +Z
  yaw: 0,
  pitch: 0.2,
  distance: 0,
  zoomFactor: 1,
  turnSpeed: 1.8,
  pitchSpeed: 1.4,
  mouseSensitivity: 0.0035,
  zoomSpeed: 0.9,
};

const PIPE_LAYER = 1;

const sim = new Simulation(defaultSimConfig);

const renderer = new WebGLRenderer({
  antialias: true,
  canvas,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const { width: initialWidth, height: initialHeight } = simBounds();
renderer.setSize(initialWidth, initialHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new Scene();
scene.background = new Color('#000000');

const camera = new PerspectiveCamera(100, initialWidth / initialHeight, 0.1, 5000);
applyCameraZoom(cameraControl.zoomFactor);
scene.add(camera);
syncPipeVisibilityToMainCamera();
const cameraLight = new PointLight(renderSettings.backLightColor, renderSettings.backLightIntensity, renderSettings.backLightRange, 2);
// Restrict the camera light to the pipe layer so it lights pipes but doesn't hit room/mirror surfaces
cameraLight.layers.set(PIPE_LAYER);
cameraLight.visible = renderSettings.backLightEnabled;
scene.add(cameraLight);

const room = createRoom(defaultSimConfig.gridSize, renderSettings);
scene.add(room.mesh);
function createMirrorSystem(kind: MirrorRenderer): MirrorSystem {
  const showRoomMesh = kind === 'raster';
  if (kind === 'physicalRay') {
    return new PhysicalRayMirrorSystem({
      scene,
      roomMesh: room.mesh,
      pipeLayer: PIPE_LAYER,
      baseShader: BASE_REFLECTOR_SHADER,
      size: room.size,
      color: renderSettings.roomColor,
      inset: mirrorInset,
      resolution: mirrorTargetSize(),
      distortion: {
        blur: mirrorBlurAmount,
        chromaticShift: mirrorChromaticShift,
        warpStrength: mirrorWarpStrength,
        warpSpeed: mirrorWarpSpeed,
        refractionOffset: mirrorRefractionOffset,
        noiseStrength: mirrorNoiseStrength,
        time: 0,
      },
      enabled: mirrorEnabled,
      maxBounces: rayMaxBounces,
      bounceAttenuation: mirrorBounceAttenuation,
      bounceAttenuationMode: mirrorBounceAttenuationMode,
      showRoomMesh,
    });
  }
  if (kind === 'rayAllFaces') {
    return new RayMirrorSystemAllFaces({
      scene,
      roomMesh: room.mesh,
      pipeLayer: PIPE_LAYER,
      baseShader: BASE_REFLECTOR_SHADER,
      size: room.size,
      color: renderSettings.roomColor,
      inset: mirrorInset,
      resolution: mirrorTargetSize(),
      distortion: {
        blur: mirrorBlurAmount,
        chromaticShift: mirrorChromaticShift,
        warpStrength: mirrorWarpStrength,
        warpSpeed: mirrorWarpSpeed,
        refractionOffset: mirrorRefractionOffset,
        noiseStrength: mirrorNoiseStrength,
        time: 0,
      },
      enabled: mirrorEnabled,
      maxBounces: rayMaxBounces,
      bounceAttenuation: mirrorBounceAttenuation,
      bounceAttenuationMode: mirrorBounceAttenuationMode,
      showRoomMesh,
    });
  }
  if (kind === 'ray') {
    return new RayMirrorSystem({
      scene,
      roomMesh: room.mesh,
      pipeLayer: PIPE_LAYER,
      baseShader: BASE_REFLECTOR_SHADER,
      size: room.size,
      color: renderSettings.roomColor,
      inset: mirrorInset,
      resolution: mirrorTargetSize(),
      distortion: {
        blur: mirrorBlurAmount,
        chromaticShift: mirrorChromaticShift,
        warpStrength: mirrorWarpStrength,
        warpSpeed: mirrorWarpSpeed,
        refractionOffset: mirrorRefractionOffset,
        noiseStrength: mirrorNoiseStrength,
        time: 0,
      },
      enabled: mirrorEnabled,
      maxBounces: rayMaxBounces,
      bounceAttenuation: mirrorBounceAttenuation,
      bounceAttenuationMode: mirrorBounceAttenuationMode,
      showRoomMesh,
    });
  }

  return new RasterMirrorSystem({
    scene,
    roomMesh: room.mesh,
    pipeLayer: PIPE_LAYER,
    baseShader: BASE_REFLECTOR_SHADER,
    size: room.size,
    color: renderSettings.roomColor,
    inset: mirrorInset,
    resolution: mirrorTargetSize(),
    distortion: {
      blur: mirrorBlurAmount,
      chromaticShift: mirrorChromaticShift,
      warpStrength: mirrorWarpStrength,
      warpSpeed: mirrorWarpSpeed,
      refractionOffset: mirrorRefractionOffset,
      noiseStrength: mirrorNoiseStrength,
      time: 0,
    },
    enabled: mirrorEnabled,
    showRoomMesh,
  });
}

let roomMirrors: MirrorSystem = createMirrorSystem(mirrorRenderer);

let gridLines = createGridOutline(defaultSimConfig.gridSize);
gridLines.visible = renderSettings.showGrid;
scene.add(gridLines);

const pipeMaterial = new MeshPhysicalMaterial({ vertexColors: true });
updatePipeMaterial(renderSettings);

let edgeNeons!: EdgeNeonSystem;
let pipeManager!: PipeVisualManager;
let bloomPass!: UnrealBloomPass;
let guiInstance: GUI | null = null;
let gridSizeController: any;
let targetCountController: any;
let maxLengthController: any;
let growthIntervalController: any;
let turnController: any;
let tailShrinkController: any;
let cameraModeController: any;
let orbitSpeedController: any;
let orbitBobController: any;
let mouseSensController: any;
let turnSpeedController: any;
let pitchSpeedController: any;
let cameraZoomController: any;
let cameraDistanceController: any;
let wallMovementController: any;
let wallBobController: any;
let railSpeedController: any;
let railRadiusController: any;
let railWaveController: any;
let railNoiseController: any;
let railPosSmoothController: any;
let railVelSmoothController: any;
let railTargetSmoothController: any;
let railLookAheadController: any;
let railNudgeController: any;
let railRollController: any;

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const makeBloom = () =>
  new UnrealBloomPass(
    new Vector2(window.innerWidth, window.innerHeight),
    renderSettings.bloomStrength,
    renderSettings.bloomRadius,
    renderSettings.bloomThreshold
  );
bloomPass = makeBloom();
composer.addPass(renderPass);
composer.addPass(bloomPass);
modulation.setGlobalBpm(modulationGlobals.bpm);
modulationBaseSetters = setupModulationTargets();

const state = {
  paused: false,
  elapsed: 0,
  fpsSmoothed: 0,
};
const videoCaptureSettings = {
  durationSeconds: 10,
  recording: false,
};
let rafHandle: number;
let frameIndex = 0;
let mirrorUpdateOffset = 0;
let mirrorUpdateMask = new Set<number>();
const ORIGIN = new Vector3(0, 0, 0);
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_FORWARD = new Vector3(0, 0, 1);
const CAMERA_MARGIN = 1.5;
const CAMERA_WALL_EPS = 0.6;
const camDir = new Vector3();
const behind = new Vector3();
const wallNormals = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
] as const;
const wallFacingState = { target: new Vector3() };
const wallDriftState = {
  travelPhase: Math.random() * Math.PI * 2,
  bobPhase: Math.random() * Math.PI * 2,
  target: new Vector3(),
  tangentA: new Vector3(),
  tangentB: new Vector3(),
};
const orbitState = {
  phase: 0,
  swayPhase: Math.random() * Math.PI * 2,
  targetPos: new Vector3(),
  smoothedPos: new Vector3(),
};
let lastCameraMode: CameraMode = cameraControl.mode;

function mirrorTargetSize() {
  const { width, height } = simBounds();
  const pixelRatio = renderer.getPixelRatio();
  return {
    width: Math.min(reflectorMaxRes, width * pixelRatio * reflectorResScale),
    height: Math.min(reflectorMaxRes, height * pixelRatio * reflectorResScale),
  };
}

function updateMirrorResolution() {
  const { width, height } = mirrorTargetSize();
  roomMirrors.setResolution(width, height);
}

function updateMirrorBlur() {
  roomMirrors.setBlur(mirrorBlurAmount);
}

function updateMirrorDistortionUniforms(time: number) {
  roomMirrors.setDistortion({
    blur: mirrorBlurAmount,
    chromaticShift: mirrorChromaticShift,
    warpStrength: mirrorWarpStrength,
    warpSpeed: mirrorWarpSpeed,
    refractionOffset: mirrorRefractionOffset,
    noiseStrength: mirrorNoiseStrength,
    time,
  });
}

function updateMirrorMask() {
  const faces = roomMirrors.faces.length;
  if (faces === 0) return;
  mirrorUpdateMask = new Set<number>();

  if (mirrorReflectionMode === 'none') {
    // No mirrors get updated
    roomMirrors.setUpdateMask(mirrorUpdateMask);
    return;
  }

  let candidateFaces: number[] = [];
  if (mirrorReflectionMode === 'cameraFacing') {
    // Only update the camera-facing mirror
    const cameraDir = new Vector3();
    camera.getWorldDirection(cameraDir);
    let bestIdx = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < faces; i++) {
      const center = roomMirrors.faces[i].position;
      const toCenter = center.clone().sub(camera.position).normalize();
      const dot = cameraDir.dot(toCenter);
      if (dot > bestDot) {
        bestDot = dot;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      candidateFaces = [bestIdx];
    }
  } else {
    // 'all' mode: rotate through all faces
    candidateFaces = Array.from({length: faces}, (_, i) => i);
  }

  const count = Math.max(1, Math.min(candidateFaces.length, mirrorFacesPerFrame));
  for (let i = 0; i < count; i++) {
    const idx = (mirrorUpdateOffset + i) % candidateFaces.length;
    mirrorUpdateMask.add(candidateFaces[idx]);
  }
  mirrorUpdateOffset = (mirrorUpdateOffset + count) % candidateFaces.length;
  roomMirrors.setUpdateMask(mirrorUpdateMask);
}

function syncPipeVisibilityToMainCamera() {
  if (renderSettings.hidePipesInMainCamera) {
    camera.layers.disable(PIPE_LAYER);
  } else {
    camera.layers.enable(PIPE_LAYER);
  }
}

function resize() {
  const { width, height } = simBounds();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
  updateMirrorResolution();
}

window.addEventListener('resize', resize);
resize();

const splitterDrag = { active: false, pointerId: -1 };
const MIN_SIM_HEIGHT = 160;
const MIN_TIMELINE_HEIGHT = 140;

const stopSplitterEvent = (e: PointerEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

splitter.addEventListener('pointerdown', (e) => {
  stopSplitterEvent(e);
  splitterDrag.active = true;
  splitterDrag.pointerId = e.pointerId;
  splitter.setPointerCapture(e.pointerId);
});

splitter.addEventListener('pointermove', (e) => {
  if (!splitterDrag.active || e.pointerId !== splitterDrag.pointerId) return;
  stopSplitterEvent(e);
  const rootRect = root.getBoundingClientRect();
  const splitterRect = splitter.getBoundingClientRect();
  const y = e.clientY - rootRect.top;
  const maxSimHeight = rootRect.height - MIN_TIMELINE_HEIGHT - splitterRect.height;
  const simHeight = clamp(y, MIN_SIM_HEIGHT, maxSimHeight);
  const timelineHeight = rootRect.height - simHeight - splitterRect.height;
  timelinePane.style.height = `${timelineHeight}px`;
  resize();
});

const endSplitterDrag = (e: PointerEvent) => {
  if (e.pointerId !== splitterDrag.pointerId) return;
  stopSplitterEvent(e);
  splitterDrag.active = false;
  splitter.releasePointerCapture(e.pointerId);
  splitterDrag.pointerId = -1;
};

splitter.addEventListener('pointerup', endSplitterDrag);
splitter.addEventListener('pointercancel', endSplitterDrag);
splitter.addEventListener('lostpointercapture', () => {
  splitterDrag.active = false;
  splitterDrag.pointerId = -1;
});

let lastTime = performance.now();
const heldKeys = new Set<string>();
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

function onKeyDown(e: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    heldKeys.add(e.key);
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    heldKeys.delete(e.key);
  }
}

function onPointerDown(e: PointerEvent) {
  if (cameraControl.mode !== 'manual') return;
  isDragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
}

function onPointerMove(e: PointerEvent) {
  if (cameraControl.mode !== 'manual' || !isDragging) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  cameraControl.yaw -= dx * cameraControl.mouseSensitivity;
  cameraControl.pitch += dy * cameraControl.mouseSensitivity;
  cameraControl.pitch = clamp(cameraControl.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
}

function onPointerUp() {
  isDragging = false;
}

function onWheel(e: WheelEvent) {
  if (cameraControl.mode !== 'manual') return;
  const { min, max } = cameraDistanceBounds();
  const delta = (e.deltaY / 1000) * cameraControl.zoomSpeed * cameraControl.distance;
  cameraControl.distance = clamp(cameraControl.distance + delta, min, max);
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointerleave', onPointerUp);
window.addEventListener('wheel', onWheel, { passive: true });

function frame(now: number) {
  const dtRaw = (now - lastTime) / 1000;
  const dt = Math.min(dtRaw, 0.05); // clamp to avoid large physics jumps on tab switches
  lastTime = now;
  stepFrame(dt);
  rafHandle = requestAnimationFrame(frame);
}

function stepFrame(dt: number) {
  state.elapsed += dt;
  state.fpsSmoothed = state.fpsSmoothed * 0.9 + (1 / dt) * 0.1;
  const playheadSeconds = ignoreAudioForModulation ? null : timelineHandle?.getPlayheadSeconds();
  const modulationTime = playheadSeconds ?? state.elapsed;
  modulation.update(modulationTime, dt);
  frameIndex++;
  const enteringOrbit = cameraControl.mode === 'orbit' && lastCameraMode !== 'orbit';
  const enteringWallDrift = cameraControl.mode === 'wallDrift' && lastCameraMode !== 'wallDrift';

  if (!state.paused) {
    const allStuck = sim.update(dt);
    if (allStuck) {
      state.paused = true;
    }
  }

  const orbitRadius = room.size * 0.5;
  let lookTarget = ORIGIN;
  let roll = 0;
  if (cameraControl.mode === 'orbit') {
    if (enteringOrbit) {
      resetOrbitState(camera.position);
    }
    const orbitRate = Math.max(0.01, orbitSettings.orbitSpeed);
    orbitState.phase += dt * orbitRate;
    orbitState.swayPhase += dt * orbitRate * 0.65;

    const easedPhase = orbitState.phase + Math.sin(orbitState.phase * 0.45) * 0.08;
    const elliptical = 0.9 + Math.sin(orbitState.swayPhase * 0.5) * 0.08;
    const radius = orbitRadius * elliptical;

    const bob =
      Math.sin(orbitState.swayPhase * 1.2 + Math.cos(orbitState.phase) * 0.4) *
      orbitSettings.bobStrength *
      orbitRadius *
      0.35;

    orbitState.targetPos.set(
      Math.cos(easedPhase) * radius,
      orbitRadius * 0.22 + bob,
      Math.sin(easedPhase + Math.sin(orbitState.swayPhase) * 0.05) * radius
    );
    keepOrbitInside(orbitState.targetPos);
    softenCameraToRoom(orbitState.targetPos);

    const smoothAlpha = 1 - Math.exp(-dt / 0.45);
    orbitState.smoothedPos.lerp(orbitState.targetPos, clamp(smoothAlpha, 0, 1));
    camera.position.copy(orbitState.smoothedPos);
  } else if (cameraControl.mode === 'rail') {
    railState.phase += dt * railSettings.speed * Math.PI * 2;
    const t = railState.phase;
    const baseRadius = orbitRadius * railSettings.radialFactor;
    const wobble = Math.sin(t * 1.8) * railSettings.verticalWave * orbitRadius;
    railState.desiredPos.set(
      Math.sin(t * 1.3) * baseRadius + Math.sin(t * 2.6) * railSettings.noise * orbitRadius,
      orbitRadius * 0.2 + wobble,
      Math.cos(t * 0.9 + Math.PI * 0.25) * baseRadius + Math.cos(t * 2.3) * railSettings.noise * orbitRadius
    );
    const nudgeX =
      (Number(heldKeys.has('ArrowRight')) - Number(heldKeys.has('ArrowLeft'))) * railSettings.manualNudge * orbitRadius;
    const nudgeZ =
      (Number(heldKeys.has('ArrowDown')) - Number(heldKeys.has('ArrowUp'))) * railSettings.manualNudge * orbitRadius;
    railState.desiredPos.x += nudgeX;
    railState.desiredPos.z += nudgeZ;

    const posAlpha = 1 - Math.exp(-dt / Math.max(railSettings.posSmoothing, 0.001));
    railState.currentPos.lerp(railState.desiredPos, clamp(posAlpha, 0, 1));
    clampCameraToRoom(railState.currentPos);

    railState.rawVelocity.copy(railState.currentPos).sub(railState.lastPos).divideScalar(Math.max(dt, 0.0001));
    const velAlpha = 1 - Math.exp(-dt / Math.max(railSettings.velocitySmoothing, 0.001));
    railState.velocity.lerp(railState.rawVelocity, clamp(velAlpha, 0, 1));
    railState.lastPos.copy(railState.currentPos);

    railState.desiredTarget.set(0, 0, 0);
    railState.desiredTarget.addScaledVector(railState.velocity, railSettings.lookAhead * 0.02 * orbitRadius);
    railState.desiredTarget.y *= 0.6;
    const targetBlend =
      1 - Math.exp(-dt / Math.max(railSettings.targetSmoothing * (railSettings.lookAhead + 0.2), 0.001));
    railState.smoothedTarget.lerp(railState.desiredTarget, targetBlend);

    camera.position.copy(railState.currentPos);
    lookTarget = railState.smoothedTarget;

    const lean = Math.min(1, railState.velocity.length() / Math.max(1, orbitRadius * 1.5));
    const targetRoll = (Math.sin(t * 0.9 + Math.PI * 0.3) * 0.6 + lean * 0.4) * railSettings.rollStrength;
    const rollAlpha = 1 - Math.exp(-dt / 0.3);
    railState.roll += (targetRoll - railState.roll) * rollAlpha;
    roll = railState.roll;
  } else if (cameraControl.mode === 'wallDrift') {
    if (enteringWallDrift) {
      resetWallDriftState();
    }
    const half = room.size * 0.5 - mirrorInset * 0.5;
    const faceIdx = clamp(Math.round(cameraControl.wallFace ?? 0), 0, wallNormals.length - 1);
    const faceNormal = wallNormals[faceIdx];
    const opposingNormal = faceNormal.clone().negate();
    const moveSpeed = 0.7 + wallDriftSettings.movement * 0.6;
    wallDriftState.travelPhase += dt * moveSpeed;
    wallDriftState.bobPhase += dt * (0.9 + wallDriftSettings.movement * 0.8);
    buildWallBasis(faceNormal, wallDriftState.tangentA, wallDriftState.tangentB);

    const driftRange = Math.max(0, half * wallDriftSettings.movement);
    wallDriftState.target.copy(faceNormal).setLength(Math.max(0, half));
    if (driftRange > 0) {
      const sweepA = Math.sin(wallDriftState.travelPhase * 0.85) * driftRange;
      const sweepB =
        Math.sin(wallDriftState.travelPhase * 1.1 + Math.cos(wallDriftState.bobPhase) * 0.5) * driftRange;
      wallDriftState.target.addScaledVector(wallDriftState.tangentA, sweepA);
      wallDriftState.target.addScaledVector(wallDriftState.tangentB, sweepB);
    }

    const bobOffset =
      Math.sin(wallDriftState.bobPhase * 1.25 + Math.sin(wallDriftState.travelPhase) * 0.35) *
      wallDriftSettings.bobStrength *
      half *
      0.28;
    camera.position.copy(opposingNormal).setLength(Math.max(0, half));
    camera.position.addScaledVector(wallDriftState.tangentB, bobOffset);
    lookTarget = wallDriftState.target;
    roll = 0;
  } else if (cameraControl.mode === 'wall') {
    const half = room.size * 0.5 - mirrorInset * 0.5;
    const faceIdx = clamp(Math.round(cameraControl.wallFace ?? 0), 0, wallNormals.length - 1);
    wallFacingState.target.copy(wallNormals[faceIdx]).setLength(Math.max(0, half));
    // Position camera near the opposing wall instead of center
    const opposingNormal = wallNormals[faceIdx].clone().negate();
    camera.position.copy(opposingNormal).setLength(Math.max(0, half));
    lookTarget = wallFacingState.target;
    roll = 0;
  } else {
    if (cameraControl.distance === 0) {
      cameraControl.distance = orbitRadius;
    }
    const { min, max } = cameraDistanceBounds();
    cameraControl.distance = clamp(cameraControl.distance, min, max);

    const yawDelta = (Number(heldKeys.has('ArrowLeft')) - Number(heldKeys.has('ArrowRight'))) * cameraControl.turnSpeed * dt;
    const pitchDelta = (Number(heldKeys.has('ArrowUp')) - Number(heldKeys.has('ArrowDown'))) * cameraControl.pitchSpeed * dt;
    cameraControl.yaw += yawDelta;
    cameraControl.pitch = clamp(cameraControl.pitch + pitchDelta, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);

    const cp = Math.cos(cameraControl.pitch);
    const sp = Math.sin(cameraControl.pitch);
    const cy = Math.cos(cameraControl.yaw);
    const sy = Math.sin(cameraControl.yaw);
    const dist = cameraControl.distance;
    camera.position.set(cy * cp * dist, sp * dist, sy * cp * dist);
  }
  clampCameraToRoom(camera.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTarget);
  if (roll !== 0) {
    camera.rotateZ(roll);
  }
  camera.getWorldDirection(camDir);
  behind.copy(camDir).multiplyScalar(-0.6);
  cameraLight.position.copy(camera.position).add(behind);
  cameraLight.intensity = renderSettings.backLightIntensity;
  cameraLight.distance = renderSettings.backLightRange;
  cameraLight.visible = renderSettings.backLightEnabled;
  (cameraLight.color as Color).set(renderSettings.backLightColor);

  pipeManager.sync(sim.pipes, renderSettings);
  edgeNeons.sync(room.size, mirrorInset, renderSettings, state.elapsed);
  // Update mirrors after the camera and scene have settled for this frame
  camera.updateMatrixWorld();
  updateMirrorMask();
  updateMirrorDistortionUniforms(state.elapsed);
  roomMirrors.updateFrame?.(renderer, scene, camera);
  updateInfo(sim, state);

  lastCameraMode = cameraControl.mode;
  composer.render();
}

function pickRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function supportsWebCodecs() {
  return typeof VideoEncoder !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

async function encodeIvfWithWebCodecs(durationSeconds: number): Promise<Blob | null> {
  if (!supportsWebCodecs()) return null;
  const width = canvas.width;
  const height = canvas.height;
  const safeDuration = Math.max(0.1, durationSeconds);
  const totalFrames = Math.max(1, Math.round(safeDuration * 60));

  const chunks: BlobPart[] = [];
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const frameHeader = new ArrayBuffer(12);
      const headerView = new DataView(frameHeader);
      headerView.setUint32(0, chunk.byteLength, true);
      headerView.setBigUint64(4, BigInt(chunk.timestamp), true);

      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push(frameHeader, data);
    },
    error: (e) => {
      console.error('WebCodecs encoder error', e);
    },
  });

  encoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: 30_000_000,
    framerate: 60,
  });

  // Pause RAF during offline render
  const wasRunning = typeof rafHandle === 'number';
  if (wasRunning) cancelAnimationFrame(rafHandle);

  for (let i = 0; i < totalFrames; i++) {
    setRecordingProgress(i / totalFrames, 'Encoding (WebCodecs)');
    stepFrame(1 / 60);
    const frame = new VideoFrame(canvas, { timestamp: i });
    encoder.encode(frame);
    frame.close();
    if (i > 0 && i % 120 === 0) {
      await encoder.flush();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  encoder.close();

  if (!chunks.length) {
    console.warn('WebCodecs produced no chunks');
    if (wasRunning) rafHandle = requestAnimationFrame(frame);
    return null;
  }

  // Build IVF container (simple and widely supported)
  const frameCount = totalFrames;
  const header = new ArrayBuffer(32);
  const view = new DataView(header);
  // Signature 'DKIF'
  view.setUint8(0, 'D'.charCodeAt(0));
  view.setUint8(1, 'K'.charCodeAt(0));
  view.setUint8(2, 'I'.charCodeAt(0));
  view.setUint8(3, 'F'.charCodeAt(0));
  view.setUint16(4, 0, true); // version
  view.setUint16(6, 32, true); // header size
  view.setUint8(8, 'V'.charCodeAt(0));
  view.setUint8(9, 'P'.charCodeAt(0));
  view.setUint8(10, '9'.charCodeAt(0));
  view.setUint8(11, '0'.charCodeAt(0));
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  view.setUint32(16, 60, true); // framerate
  view.setUint32(20, 1, true); // timescale
  view.setUint32(24, frameCount, true); // frame count
  view.setUint32(28, 0, true); // unused

  const blob = new Blob([header, ...chunks], { type: 'video/x-ivf' });
  if (wasRunning) rafHandle = requestAnimationFrame(frame);
  setRecordingProgress(null, '');
  return blob;
}

async function renderVideoCapture(
  durationSeconds: number,
  opts: { startAtZero?: boolean; filenameBase?: string } = {}
) {
  if (videoCaptureSettings.recording) return;

  const safeDuration = Math.max(0.1, durationSeconds);
  const prevIgnoreAudio = ignoreAudioForModulation;
  ignoreAudioForModulation = true;
  if (opts.startAtZero) {
    state.elapsed = 0;
    state.paused = false;
    sim.reset();
    pipeManager.resetGridSize(sim.config.gridSize);
    pipeManager.sync([], renderSettings);
  }

  try {
    // Prefer offline WebCodecs encoding (decoupled from real-time)
    if (supportsWebCodecs()) {
      videoCaptureSettings.recording = true;
      try {
        const blob = await encodeIvfWithWebCodecs(safeDuration);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const download = document.createElement('a');
          download.href = url;
          const base = opts.filenameBase ?? `pipes-${safeDuration.toFixed(2)}s-${Date.now()}`;
          download.download = `${base}.ivf`;
          download.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          setRecordingProgress(null, '');
          return;
        }
      } finally {
        videoCaptureSettings.recording = false;
      }
    }

    const targetDuration = safeDuration;
  const mimeType = pickRecordingMimeType();
  if (!mimeType) {
    console.warn('MediaRecorder with WebM is not supported in this browser.');
    return;
  }
  if (!canvas.captureStream) {
    console.warn('captureStream is not supported on this canvas.');
    return;
  }

  const stream = canvas.captureStream(60);
  const track = stream.getVideoTracks()[0];
  if (track && (track as any).applyConstraints) {
    (track as any).applyConstraints({ frameRate: 60 }).catch(() => {
      /* ignore constraint failures */
    });
  }
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 25_000_000,
    });
  } catch (err) {
    console.error('Failed to start video recording', err);
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  const wasRunning = typeof rafHandle === 'number';
  if (wasRunning) cancelAnimationFrame(rafHandle);

  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener('stop', () => resolve(), { once: true });
  });

  recorder.addEventListener('dataavailable', (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  });
  recorder.addEventListener('error', (ev) => {
    console.error('Recorder error', ev);
  });

  videoCaptureSettings.recording = true;
  try {
    recorder.start();
    // Allow recorder to initialize
    await new Promise((r) => setTimeout(r, 0));
    const totalFrames = Math.max(1, Math.round(targetDuration * 60));
    for (let i = 0; i < totalFrames; i++) {
      setRecordingProgress(i / totalFrames, 'Recording (MediaRecorder)');
      stepFrame(1 / 60);
      if (track && (track as any).requestFrame) {
        (track as any).requestFrame();
      }
      // Yield to let the capture track publish the frame; rAF keeps cadence stable.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    recorder.stop();
    await stopped;
    if (!chunks.length) {
      console.warn('Recorder produced no data.');
      return;
    }
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = url;
    const base = opts.filenameBase ?? `pipes-${targetDuration.toFixed(2)}s-${Date.now()}`;
    download.download = `${base}.webm`;
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setRecordingProgress(null, '');
  } catch (err) {
    console.error('Recording failed', err);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    videoCaptureSettings.recording = false;
    if (wasRunning) {
      rafHandle = requestAnimationFrame(frame);
    }
  }
  } finally {
    ignoreAudioForModulation = prevIgnoreAudio;
  }
}

function setupGui() {
  const gui = new GUI();
  guiInstance = gui;
  gui.title('Pipes 98-ish');

  const simFolder = gui.addFolder('Simulation');
  gridSizeController = simFolder
    .add(defaultSimConfig, 'gridSize', 12, 64, 1)
    .name('Grid size')
    .onFinishChange((v: number) => {
      const size = Math.max(8, Math.floor(v));
      defaultSimConfig.gridSize = size;
      sim.reset({ gridSize: size });
      pipeManager.resetGridSize(size);
      room.updateSize(size, renderSettings);
      roomMirrors.update(room.size, renderSettings.roomColor);
      disposeGridLines(gridLines);
      scene.remove(gridLines);
      gridLines = createGridOutline(size);
      gridLines.visible = renderSettings.showGrid;
      scene.add(gridLines);
      const bounds = cameraDistanceBounds();
      cameraControl.distance = clamp(cameraControl.distance, bounds.min, bounds.max);
      refreshCameraDistanceController();
    });
  targetCountController = simFolder.add(defaultSimConfig, 'targetPipeCount', 1, 64, 1).name('Pipe cap').onChange((v: number) => {
    sim.config.targetPipeCount = v;
    modulationBaseSetters['sim.targetCount']?.(sim.config.targetPipeCount);
  });
  maxLengthController = simFolder
    .add(defaultSimConfig, 'maxPipeLength', 0, 300, 1)
    .name('Max length (0=inf)')
    .onChange((v: number) => {
      const normalized = Math.max(0, Math.floor(v));
      defaultSimConfig.maxPipeLength = normalized;
      sim.config.maxPipeLength = normalized === 0 ? 0 : Math.max(4, normalized);
      modulationBaseSetters['sim.maxLength']?.(defaultSimConfig.maxPipeLength);
    });
  growthIntervalController = simFolder.add(defaultSimConfig, 'growthInterval', 0.001, 1, 0.001).name('Growth interval').onChange((v: number) => {
    sim.config.growthInterval = Math.max(0.01, v);
    modulationBaseSetters['sim.growthInterval']?.(sim.config.growthInterval);
  });
  turnController = simFolder
    .add(turnProxy, 'turnChance', 0, 100, 1)
    .name('Turn probability %')
    .onChange((v: number) => {
      const normalized = Math.min(1, Math.max(0, v / 100));
      turnProxy.turnChance = v;
      defaultSimConfig.turnProbability = normalized;
      sim.config.turnProbability = normalized;
      modulationBaseSetters['sim.turnChance']?.(turnProxy.turnChance);
    });
  tailShrinkController = simFolder
    .add(defaultSimConfig, 'disableTailShrink')
    .name('Disable tail shrink')
    .onChange((v: boolean) => {
      sim.config.disableTailShrink = v;
    });
  simFolder.add(state, 'paused').name('Pause');
  simFolder
    .add(
      {
        reset: () => {
          sim.reset();
          pipeManager.resetGridSize(sim.config.gridSize);
          room.updateSize(sim.config.gridSize, renderSettings);
          roomMirrors.update(room.size, renderSettings.roomColor);
          disposeGridLines(gridLines);
          scene.remove(gridLines);
          gridLines = createGridOutline(sim.config.gridSize);
          gridLines.visible = renderSettings.showGrid;
          scene.add(gridLines);
          refreshCameraDistanceController();
          modulation.syncBaseFromTargets();
        },
      },
      'reset'
    )
    .name('Reset');
  simFolder
    .add(
      {
        randomize: () => {
          randomizeAll();
        },
      },
      'randomize'
    )
    .name('Randomize all');
  simFolder.add(videoCaptureSettings, 'durationSeconds', 5, 20, 1).name('Video length (s)');
  simFolder
    .add(
      {
        renderVideo: () => {
          renderVideoCapture(videoCaptureSettings.durationSeconds);
        },
      },
      'renderVideo'
    )
    .name('Render 60fps video');

  const pipeFolder = gui.addFolder('Pipes');
  pipeFolder
    .add(renderSettings, 'pipeRadius', 0.05, 0.6, 0.01)
    .name('Radius')
    .onChange((v: number) => {
      modulationBaseSetters['pipes.radius']?.(v);
    });
  pipeFolder
    .add(renderSettings, 'tubularSegments', 3, 20, 1)
    .name('Smoothness')
    .onChange((v: number) => {
      modulationBaseSetters['pipes.tubularSegments']?.(v);
    });
  pipeFolder
    .add(renderSettings, 'radialSegments', 4, 32, 1)
    .name('Radial slices')
    .onChange((v: number) => {
      modulationBaseSetters['pipes.radialSegments']?.(v);
    });
  pipeFolder
    .add(renderSettings, 'colorShift', 0, 0.4, 0.005)
    .name('Color shift')
    .onChange((v: number) => {
      modulationBaseSetters['pipes.colorShift']?.(v);
    });
  pipeFolder
    .add(renderSettings, 'pathType', {
      'Polyline (no smoothing)': 'polyline',
      'Catmull-Rom (uniform)': 'catmullrom',
      'Catmull-Rom (centripetal)': 'centripetal',
      'Catmull-Rom (chordal)': 'chordal',
    })
    .name('Path type')
    .onChange(() => {
      pipeManager.forceGeometryRefresh();
    });
  pipeFolder
    .add(renderSettings, 'hidePipesInMainCamera')
    .name('Hide in main camera')
    .onChange(() => {
      syncPipeVisibilityToMainCamera();
    });
  pipeFolder.add(renderSettings, 'pipeRoughness', 0, 1, 0.01).name('Roughness').onChange((v: number) => {
    pipeMaterial.roughness = v;
    modulationBaseSetters['pipes.roughness']?.(v);
  });
  pipeFolder.add(renderSettings, 'pipeMetalness', 0, 1, 0.01).name('Metalness').onChange((v: number) => {
    pipeMaterial.metalness = v;
    modulationBaseSetters['pipes.metalness']?.(v);
  });
  pipeFolder
    .add(renderSettings, 'cornerTension', 0, 3, 0.01)
    .name('Corner smoothness')
    .onChange(() => {
      pipeManager.forceGeometryRefresh();
      modulationBaseSetters['pipes.cornerTension']?.(renderSettings.cornerTension);
    });
  pipeFolder.add(renderSettings, 'neonEnabled').name('Neon glow').onChange(() => {
    pipeManager.forceGeometryRefresh();
  });
  pipeFolder.add(renderSettings, 'neonStrength', 0, 4, 0.05).name('Neon intensity').onChange(() => {
    pipeManager.forceGeometryRefresh();
    modulationBaseSetters['pipes.neonStrength']?.(renderSettings.neonStrength);
  });
  pipeFolder.add(renderSettings, 'neonSize', 0.98, 1.2, 0.005).name('Neon size').onChange(() => {
    pipeManager.forceGeometryRefresh();
    modulationBaseSetters['pipes.neonSize']?.(renderSettings.neonSize);
  });
  pipeFolder.add(renderSettings, 'glassEnabled').name('Glass mode').onChange((enabled: boolean) => {
    renderSettings.glassEnabled = enabled;
    updatePipeMaterial(renderSettings);
  });
  pipeFolder.add(renderSettings, 'glassTransmission', 0, 1, 0.01).name('Glass transmission').onChange((v: number) => {
    renderSettings.glassTransmission = v;
    updatePipeMaterial(renderSettings);
    modulationBaseSetters['pipes.glassTransmission']?.(v);
  });
  pipeFolder.add(renderSettings, 'glassOpacity', 0, 1, 0.01).name('Glass opacity').onChange((v: number) => {
    renderSettings.glassOpacity = v;
    updatePipeMaterial(renderSettings);
    modulationBaseSetters['pipes.glassOpacity']?.(v);
  });
  pipeFolder.add(renderSettings, 'glassIor', 1, 2.5, 0.01).name('Glass IOR').onChange((v: number) => {
    renderSettings.glassIor = v;
    updatePipeMaterial(renderSettings);
    modulationBaseSetters['pipes.glassIor']?.(v);
  });

  const edgeNeonFolder = gui.addFolder('Edge neon');
  edgeNeonFolder.add(renderSettings, 'edgeNeonEnabled').name('Enabled (shares neon size)');
  edgeNeonFolder.addColor(renderSettings, 'edgeNeonColor').name('Color').onChange(() => {
    modulationBaseSetters['edge.hue']?.(hueFromHex(renderSettings.edgeNeonColor));
  });
  edgeNeonFolder
    .add(renderSettings, 'edgeNeonStrength', 0, 200, 0.05)
    .name('Intensity')
    .onChange((v: number) => {
      modulationBaseSetters['edge.neonStrength']?.(v);
    });
  edgeNeonFolder.add(renderSettings, 'edgeNeonShowMeshes').name('Show beams');
  edgeNeonFolder
    .add(renderSettings, 'edgeNeonWidth', 0.02, 0.5, 0.005)
    .name('Width')
    .onChange((v: number) => {
      renderSettings.edgeNeonWidth = clamp(v, 0.02, 0.5);
      modulationBaseSetters['edge.width']?.(renderSettings.edgeNeonWidth);
    });
  edgeNeonFolder.add(renderSettings, 'edgeHueTravelEnabled').name('Hue travel');
  edgeNeonFolder
    .add(renderSettings, 'edgeHueTravelPeriod', 0.01, 60, 0.01)
    .name('Hue period (s)')
    .onChange((v: number) => {
      renderSettings.edgeHueTravelPeriod = Math.max(0.01, v);
      modulationBaseSetters['edge.huePeriod']?.(renderSettings.edgeHueTravelPeriod);
    });

  const mirrorFolder = gui.addFolder('Mirrors');
  mirrorFolder.addColor(renderSettings, 'roomColor').name('Tint').onChange((v: string) => {
    room.material.color.set(v);
    roomMirrors.update(room.size, v);
    modulationBaseSetters['room.hue']?.(hueFromHex(renderSettings.roomColor));
  });
  mirrorFolder
    .add(roomGuiSettings, 'wallGap', 0, 70, 0.5)
    .name('Wall gap')
    .onChange((v: number) => {
      roomPadding = Math.min(70, Math.max(0, v));
      roomGuiSettings.wallGap = roomPadding;
      room.updateSize(sim.config.gridSize, renderSettings);
      roomMirrors.update(room.size, renderSettings.roomColor);
      clampCameraToRoom(camera.position);
      const { min, max } = cameraDistanceBounds();
      cameraControl.distance = clamp(cameraControl.distance, min, max);
      refreshCameraDistanceController();
      modulationBaseSetters['room.wallGap']?.(roomPadding);
    });
  mirrorFolder.add(mirrorGuiSettings, 'enabled').name('Enabled').onChange((v: boolean) => {
    mirrorEnabled = v;
    roomMirrors.setEnabled(v);
  });
  mirrorFolder
    .add(mirrorGuiSettings, 'renderer', {
      Raster: 'raster',
      'Ray (experimental)': 'ray',
      'Ray (all faces)': 'rayAllFaces',
      'Ray tunnel (recursive)': 'physicalRay',
    })
    .name('Renderer')
    .onChange((v: MirrorRenderer) => {
      mirrorRenderer = v;
      roomMirrors.dispose();
      roomMirrors = createMirrorSystem(v);
      updateMirrorResolution();
      updateMirrorBlur();
      updateMirrorDistortionUniforms(state.elapsed);
      updateMirrorMask();
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'rayBounces', 1, 16, 1)
    .name('Ray bounces')
      .onChange((v: number) => {
        rayMaxBounces = Math.max(1, Math.floor(v));
        mirrorGuiSettings.rayBounces = rayMaxBounces;
        if (mirrorRenderer === 'ray' || mirrorRenderer === 'rayAllFaces' || mirrorRenderer === 'physicalRay') {
          roomMirrors.dispose();
          roomMirrors = createMirrorSystem(mirrorRenderer);
          updateMirrorResolution();
          updateMirrorBlur();
          updateMirrorDistortionUniforms(state.elapsed);
        updateMirrorMask();
      }
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'bounceAttenuation', 0, 10, 0.05)
    .name('Bounce attenuation')
      .onChange((v: number) => {
        mirrorBounceAttenuation = clamp(v, 0, 10);
        mirrorGuiSettings.bounceAttenuation = mirrorBounceAttenuation;
        if (mirrorRenderer === 'ray' || mirrorRenderer === 'rayAllFaces' || mirrorRenderer === 'physicalRay') {
          roomMirrors.dispose();
          roomMirrors = createMirrorSystem(mirrorRenderer);
          updateMirrorResolution();
          updateMirrorBlur();
          updateMirrorDistortionUniforms(state.elapsed);
        updateMirrorMask();
      }
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'bounceAttenuationMode', {
      'Skip first bounce': 'skipFirst',
      'Scale all bounces': 'allBounces',
    })
      .name('Attenuation math')
      .onChange((v: 'skipFirst' | 'allBounces') => {
        mirrorBounceAttenuationMode = v;
        if (mirrorRenderer === 'ray' || mirrorRenderer === 'rayAllFaces' || mirrorRenderer === 'physicalRay') {
          roomMirrors.dispose();
          roomMirrors = createMirrorSystem(mirrorRenderer);
          updateMirrorResolution();
          updateMirrorBlur();
          updateMirrorDistortionUniforms(state.elapsed);
        updateMirrorMask();
      }
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'reflectionMode', {
      'No inter-reflection': 'none',
      'Camera-facing only': 'cameraFacing',
      'All mirrors': 'all',
    })
    .name('Reflection mode')
    .onChange((v: MirrorReflectionMode) => {
      mirrorReflectionMode = v;
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'inset', 0.01, 20, 0.01)
    .name('Wall inset')
    .onChange((v: number) => {
      mirrorInset = Math.max(0, v);
      roomMirrors.setInset(mirrorInset);
      roomMirrors.update(room.size, renderSettings.roomColor);
      modulationBaseSetters['mirror.inset']?.(mirrorInset);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'blur', 0, 1, 0.01)
    .name('Radial blur')
    .onChange((v: number) => {
      mirrorBlurAmount = Math.max(0, Math.min(1, v));
      updateMirrorBlur();
      modulationBaseSetters['mirror.blur']?.(mirrorBlurAmount);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'chromaticShift', 0, 0.1, 0.0005)
    .name('Chromatic shift')
    .onChange((v: number) => {
      mirrorChromaticShift = Math.max(0, v);
      modulationBaseSetters['mirror.chromaticShift']?.(mirrorChromaticShift);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'warpStrength', 0, 0.05, 0.0005)
    .name('Warp strength')
    .onChange((v: number) => {
      mirrorWarpStrength = Math.max(0, v);
      modulationBaseSetters['mirror.warpStrength']?.(mirrorWarpStrength);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'warpSpeed', 0, 5, 0.05)
    .name('Warp speed')
    .onChange((v: number) => {
      mirrorWarpSpeed = Math.max(0, v);
      modulationBaseSetters['mirror.warpSpeed']?.(mirrorWarpSpeed);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'refractionOffset', -0.05, 0.05, 0.0005)
    .name('Refraction offset')
    .onChange((v: number) => {
      mirrorRefractionOffset = v;
      modulationBaseSetters['mirror.refractionOffset']?.(mirrorRefractionOffset);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'noiseStrength', 0, 0.01, 0.0002)
    .name('Noise shimmer')
    .onChange((v: number) => {
      mirrorNoiseStrength = Math.max(0, v);
      modulationBaseSetters['mirror.noiseStrength']?.(mirrorNoiseStrength);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'maxResolution', 256, 4096 * 4, 64)
    .name('Max resolution')
    .onChange((v: number) => {
      reflectorMaxRes = v;
      updateMirrorResolution();
      modulationBaseSetters['mirror.maxResolution']?.(reflectorMaxRes);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'facesPerFrame', 1, 6, 1)
    .name('Faces per frame')
    .onChange((v: number) => {
      mirrorFacesPerFrame = Math.max(1, Math.floor(v));
      modulationBaseSetters['mirror.facesPerFrame']?.(mirrorFacesPerFrame);
    });
  updateMirrorBlur();
  mirrorFolder.add(renderSettings, 'showGrid').name('Show grid').onChange((visible: boolean) => {
    gridLines.visible = visible;
  });

  const camLightFolder = gui.addFolder('Camera light');
  camLightFolder.add(renderSettings, 'backLightEnabled').name('Enabled');
  camLightFolder
    .add(renderSettings, 'backLightIntensity', 0, 1200, 0.1)
    .name('Intensity')
    .onChange((v: number) => {
      cameraLight.intensity = v;
      modulationBaseSetters['light.backIntensity']?.(v);
    });
  camLightFolder
    .add(renderSettings, 'backLightRange', 0, 420, 1)
    .name('Range (0=inf)')
    .onChange((v: number) => {
      cameraLight.distance = v;
      modulationBaseSetters['light.backRange']?.(v);
    });
  camLightFolder.addColor(renderSettings, 'backLightColor').name('Color').onChange((v: string) => {
    cameraLight.color.set(v);
    modulationBaseSetters['light.backHue']?.(hueFromHex(renderSettings.backLightColor));
  });

  const cameraFolder = gui.addFolder('Camera');
  cameraModeController = cameraFolder
    .add(cameraControl, 'mode', ['wall', 'wallDrift', 'orbit', 'manual', 'rail'])
    .name('Mode (wall/drift/orbit/manual/rail)')
    .onChange((mode: CameraMode) => {
      cameraControl.mode = mode;
      if (mode === 'manual' && cameraControl.distance === 0) {
        cameraControl.distance = room.size * 0.48;
      }
      refreshCameraDistanceController();
      cameraZoomController?.setValue(cameraControl.zoomFactor);
      if (mode === 'rail') {
        railState.phase = 0;
        railState.currentPos.copy(camera.position);
        railState.lastPos.copy(camera.position);
        railState.smoothedTarget.set(0, 0, 0);
      }
      if (mode === 'wallDrift') {
        resetWallDriftState();
      }
    });
  cameraFolder
    .add(cameraControl, 'wallFace', { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 })
    .name('Wall facing')
    .onChange((v: number) => {
      cameraControl.wallFace = clamp(Math.round(v), 0, 5);
    });
  const wallDriftFolder = cameraFolder.addFolder('Wall drift');
  wallMovementController = wallDriftFolder
    .add(wallDriftSettings, 'movement', 0, 1, 0.01)
    .name('Movement')
    .onChange((v: number) => {
      wallDriftSettings.movement = clamp(v, 0, 1);
      modulationBaseSetters['camera.wallMovement']?.(wallDriftSettings.movement);
    });
  wallBobController = wallDriftFolder
    .add(wallDriftSettings, 'bobStrength', 0, 1, 0.01)
    .name('Bob')
    .onChange((v: number) => {
      wallDriftSettings.bobStrength = clamp(v, 0, 1);
      modulationBaseSetters['camera.wallBob']?.(wallDriftSettings.bobStrength);
    });
  orbitSpeedController = cameraFolder
    .add(orbitSettings, 'orbitSpeed', 0.02, 0.6, 0.01)
    .name('Orbit speed')
    .onChange((v: number) => {
      modulationBaseSetters['camera.orbitSpeed']?.(v);
    });
  orbitBobController = cameraFolder
    .add(orbitSettings, 'bobStrength', 0, 0.8, 0.01)
    .name('Bob strength')
    .onChange((v: number) => {
      modulationBaseSetters['camera.bobStrength']?.(v);
    });
  mouseSensController = cameraFolder
    .add(cameraControl, 'mouseSensitivity', 0.001, 0.02, 0.0005)
    .name('Mouse sens')
    .onChange((v: number) => {
      modulationBaseSetters['camera.mouseSensitivity']?.(v);
    });
  turnSpeedController = cameraFolder
    .add(cameraControl, 'turnSpeed', 0.2, 4, 0.1)
    .name('Turn speed')
    .onChange((v: number) => {
      modulationBaseSetters['camera.turnSpeed']?.(v);
    });
  pitchSpeedController = cameraFolder
    .add(cameraControl, 'pitchSpeed', 0.2, 4, 0.1)
    .name('Pitch speed')
    .onChange((v: number) => {
      modulationBaseSetters['camera.pitchSpeed']?.(v);
    });
  const { min: zoomMin, max: zoomMax } = cameraDistanceBounds();
  cameraDistanceController = cameraFolder
    .add(cameraControl, 'distance', zoomMin, zoomMax, 0.1)
    .name('Manual zoom')
    .onChange((v: number) => {
      const bounds = cameraDistanceBounds();
      cameraControl.distance = clamp(v, bounds.min, bounds.max);
      refreshCameraDistanceController();
      modulationBaseSetters['camera.distance']?.(cameraControl.distance);
    });
  cameraZoomController = cameraFolder
    .add(cameraControl, 'zoomFactor', 0.01, 2, 0.01)
    .name('Camera zoom (all modes)')
    .onChange((v: number) => {
      applyCameraZoom(v);
      cameraZoomController?.setValue(cameraControl.zoomFactor);
      modulationBaseSetters['camera.zoom']?.(cameraControl.zoomFactor);
    });
  refreshCameraDistanceController();
  const railFolder = cameraFolder.addFolder('Cinematic rail');
  railSpeedController = railFolder
    .add(railSettings, 'speed', 0.02, 1.2, 0.01)
    .name('Path speed')
    .onChange((v: number) => {
      modulationBaseSetters['rail.speed']?.(v);
    });
  railRadiusController = railFolder
    .add(railSettings, 'radialFactor', 0.2, 1.2, 0.01)
    .name('Radius factor')
    .onChange((v: number) => {
      modulationBaseSetters['rail.radialFactor']?.(v);
    });
  railWaveController = railFolder
    .add(railSettings, 'verticalWave', 0, 1, 0.01)
    .name('Vertical wave')
    .onChange((v: number) => {
      modulationBaseSetters['rail.verticalWave']?.(v);
    });
  railNoiseController = railFolder
    .add(railSettings, 'noise', 0, 0.8, 0.01)
    .name('Noise')
    .onChange((v: number) => {
      modulationBaseSetters['rail.noise']?.(v);
    });
  railPosSmoothController = railFolder.add(railSettings, 'posSmoothing', 0.01, 1.5, 0.01).name('Pos smooth (s)');
  railVelSmoothController = railFolder
    .add(railSettings, 'velocitySmoothing', 0.01, 1.5, 0.01)
    .name('Vel smooth (s)');
  railTargetSmoothController = railFolder
    .add(railSettings, 'targetSmoothing', 0.01, 1.5, 0.01)
    .name('Look smooth (s)');
  railPosSmoothController.onChange((v: number) => {
    modulationBaseSetters['rail.posSmoothing']?.(v);
  });
  railVelSmoothController.onChange((v: number) => {
    modulationBaseSetters['rail.velocitySmoothing']?.(v);
  });
  railTargetSmoothController.onChange((v: number) => {
    modulationBaseSetters['rail.targetSmoothing']?.(v);
  });
  railLookAheadController = railFolder.add(railSettings, 'lookAhead', 0, 1, 0.01).name('Look ahead');
  railLookAheadController.onChange((v: number) => {
    modulationBaseSetters['rail.lookAhead']?.(v);
  });
  railNudgeController = railFolder.add(railSettings, 'manualNudge', 0, 0.8, 0.01).name('Arrow nudge');
  railNudgeController.onChange((v: number) => {
    modulationBaseSetters['rail.manualNudge']?.(v);
  });
  railRollController = railFolder
    .add(railSettings, 'rollStrength', 0, 1.2, 0.01)
    .name('Roll')
    .onChange((v: number) => {
      modulationBaseSetters['rail.rollStrength']?.(v);
    });
  cameraFolder
    .add(
      {
        randomize: () => {
          randomizeCameraSettings();
        },
      },
      'randomize'
    )
    .name('Randomize camera');

  const postFolder = gui.addFolder('Post FX');
  postFolder.add(renderSettings, 'bloomStrength', 0, 2, 0.01).name('Bloom strength').onChange((v: number) => {
    bloomPass.strength = v;
    modulationBaseSetters['post.bloomStrength']?.(v);
  });
  postFolder.add(renderSettings, 'bloomRadius', 0, 1, 0.01).name('Bloom radius').onChange((v: number) => {
    bloomPass.radius = v;
    modulationBaseSetters['post.bloomRadius']?.(v);
  });
  postFolder.add(renderSettings, 'bloomThreshold', 0, 1, 0.01).name('Bloom threshold').onChange((v: number) => {
    bloomPass.threshold = v;
    modulationBaseSetters['post.bloomThreshold']?.(v);
  });

}

function setupModulationTargets() {
  const setters: Record<string, (v: number) => void> = {};
  const register = (
    id: string,
    group: string,
    label: string,
    config: { min?: number; max?: number; range?: number; get: () => number; set: (v: number) => void }
  ) => {
    modulation.registerTarget({
      id,
      label,
      group,
      min: config.min,
      max: config.max,
      range: config.range,
      getCurrent: config.get,
      apply: config.set,
    });
    setters[id] = (v: number) => modulation.setBaseValue(id, v);
  };

  register('sim.turnChance', 'Simulation', 'Turn probability %', {
    min: 0,
    max: 100,
    range: 100,
    get: () => turnProxy.turnChance,
    set: (v: number) => {
      const pct = clamp(v, 0, 100);
      turnProxy.turnChance = pct;
      const normalized = pct / 100;
      defaultSimConfig.turnProbability = normalized;
      sim.config.turnProbability = normalized;
    },
  });
  register('sim.growthInterval', 'Simulation', 'Growth interval (s)', {
    min: 0.01,
    max: 1,
    range: 1,
    get: () => defaultSimConfig.growthInterval,
    set: (v: number) => {
      const clamped = clamp(v, 0.01, 1);
      defaultSimConfig.growthInterval = clamped;
      sim.config.growthInterval = clamped;
    },
  });
  register('sim.targetCount', 'Simulation', 'Pipe cap', {
    min: 1,
    max: 128,
    range: 127,
    get: () => defaultSimConfig.targetPipeCount,
    set: (v: number) => {
      const clamped = clamp(Math.round(v), 1, 128);
      defaultSimConfig.targetPipeCount = clamped;
      sim.config.targetPipeCount = clamped;
    },
  });
  register('sim.maxLength', 'Simulation', 'Max length (0=inf)', {
    min: 0,
    max: 300,
    range: 300,
    get: () => defaultSimConfig.maxPipeLength,
    set: (v: number) => {
      const normalized = Math.max(0, Math.floor(v));
      defaultSimConfig.maxPipeLength = normalized;
      sim.config.maxPipeLength = normalized === 0 ? 0 : Math.max(4, normalized);
    },
  });

  register('room.roughness', 'Room', 'Roughness', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.roomRoughness,
    set: (v: number) => {
      renderSettings.roomRoughness = clamp(v, 0, 1);
      room.material.roughness = renderSettings.roomRoughness;
    },
  });
  register('room.metalness', 'Room', 'Metalness', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.roomMetalness,
    set: (v: number) => {
      renderSettings.roomMetalness = clamp(v, 0, 1);
      room.material.metalness = renderSettings.roomMetalness;
    },
  });
  register('room.reflectivity', 'Room', 'Reflectivity', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.roomReflectivity,
    set: (v: number) => {
      renderSettings.roomReflectivity = clamp(v, 0, 1);
      room.material.reflectivity = renderSettings.roomReflectivity;
    },
  });
  register('room.hue', 'Room', 'Tint hue', {
    min: 0,
    max: 1,
    range: 1,
    get: () => hueFromHex(renderSettings.roomColor),
    set: (v: number) => {
      const next = applyHueToHex(renderSettings.roomColor, v);
      renderSettings.roomColor = next;
      room.material.color.set(next);
      roomMirrors.update(room.size, next);
    },
  });
  register('room.wallGap', 'Room', 'Wall gap', {
    min: 0,
    max: 70,
    range: 70,
    get: () => roomPadding,
    set: (v: number) => {
      roomPadding = clamp(v, 0, 70);
      roomGuiSettings.wallGap = roomPadding;
      room.updateSize(sim.config.gridSize, renderSettings);
      roomMirrors.update(room.size, renderSettings.roomColor);
      clampCameraToRoom(camera.position);
      const { min, max } = cameraDistanceBounds();
      cameraControl.distance = clamp(cameraControl.distance, min, max);
      refreshCameraDistanceController();
    },
  });

  register('mirror.inset', 'Mirrors', 'Wall inset', {
    min: 0,
    max: 20,
    range: 20,
    get: () => mirrorInset,
    set: (v: number) => {
      mirrorInset = Math.max(0, v);
      roomMirrors.setInset(mirrorInset);
      roomMirrors.update(room.size, renderSettings.roomColor);
    },
  });
  register('mirror.blur', 'Mirrors', 'Blur', {
    min: 0,
    max: 1,
    range: 1,
    get: () => mirrorBlurAmount,
    set: (v: number) => {
      mirrorBlurAmount = clamp(v, 0, 1);
      mirrorGuiSettings.blur = mirrorBlurAmount;
      updateMirrorBlur();
    },
  });
  register('mirror.chromaticShift', 'Mirrors', 'Chromatic shift', {
    min: 0,
    max: 0.1,
    range: 0.1,
    get: () => mirrorChromaticShift,
    set: (v: number) => {
      mirrorChromaticShift = clamp(v, 0, 0.1);
      mirrorGuiSettings.chromaticShift = mirrorChromaticShift;
    },
  });
  register('mirror.warpStrength', 'Mirrors', 'Warp strength', {
    min: 0,
    max: 0.05,
    range: 0.05,
    get: () => mirrorWarpStrength,
    set: (v: number) => {
      mirrorWarpStrength = clamp(v, 0, 0.05);
      mirrorGuiSettings.warpStrength = mirrorWarpStrength;
    },
  });
  register('mirror.warpSpeed', 'Mirrors', 'Warp speed', {
    min: 0,
    max: 5,
    range: 5,
    get: () => mirrorWarpSpeed,
    set: (v: number) => {
      mirrorWarpSpeed = clamp(v, 0, 5);
      mirrorGuiSettings.warpSpeed = mirrorWarpSpeed;
    },
  });
  register('mirror.refractionOffset', 'Mirrors', 'Refraction offset', {
    min: -0.05,
    max: 0.05,
    range: 0.1,
    get: () => mirrorRefractionOffset,
    set: (v: number) => {
      mirrorRefractionOffset = clamp(v, -0.05, 0.05);
      mirrorGuiSettings.refractionOffset = mirrorRefractionOffset;
    },
  });
  register('mirror.noiseStrength', 'Mirrors', 'Shimmer', {
    min: 0,
    max: 0.01,
    range: 0.01,
    get: () => mirrorNoiseStrength,
    set: (v: number) => {
      mirrorNoiseStrength = clamp(v, 0, 0.01);
      mirrorGuiSettings.noiseStrength = mirrorNoiseStrength;
    },
  });
  register('mirror.maxResolution', 'Mirrors', 'Max resolution', {
    min: 256,
    max: 4096 * 4,
    range: 4096 * 4 - 256,
    get: () => reflectorMaxRes,
    set: (v: number) => {
      reflectorMaxRes = clamp(v, 256, 4096 * 4);
      updateMirrorResolution();
    },
  });
  register('mirror.facesPerFrame', 'Mirrors', 'Faces per frame', {
    min: 1,
    max: 6,
    range: 5,
    get: () => mirrorFacesPerFrame,
    set: (v: number) => {
      mirrorFacesPerFrame = Math.max(1, Math.floor(v));
    },
  });

  register('edge.neonStrength', 'Edge neon', 'Intensity', {
    min: 0,
    max: 200,
    range: 200,
    get: () => renderSettings.edgeNeonStrength,
    set: (v: number) => {
      renderSettings.edgeNeonStrength = clamp(v, 0, 200);
    },
  });
  register('edge.huePeriod', 'Edge neon', 'Hue period', {
    min: 0.01,
    max: 60,
    range: 30,
    get: () => renderSettings.edgeHueTravelPeriod,
    set: (v: number) => {
      renderSettings.edgeHueTravelPeriod = clamp(v, 0.01, 60);
    },
  });
  register('edge.hue', 'Edge neon', 'Hue', {
    min: 0,
    max: 1,
    range: 1,
    get: () => hueFromHex(renderSettings.edgeNeonColor),
    set: (v: number) => {
      const next = applyHueToHex(renderSettings.edgeNeonColor, v);
      renderSettings.edgeNeonColor = next;
    },
  });
  register('edge.width', 'Edge neon', 'Width', {
    min: 0.02,
    max: 0.5,
    range: 0.48,
    get: () => renderSettings.edgeNeonWidth,
    set: (v: number) => {
      renderSettings.edgeNeonWidth = clamp(v, 0.02, 0.5);
    },
  });

  register('pipes.radius', 'Pipes', 'Radius', {
    min: 0.05,
    max: 0.6,
    range: 0.55,
    get: () => renderSettings.pipeRadius,
    set: (v: number) => {
      renderSettings.pipeRadius = clamp(v, 0.05, 0.6);
    },
  });
  register('pipes.tubularSegments', 'Pipes', 'Smoothness', {
    min: 3,
    max: 20,
    range: 17,
    get: () => renderSettings.tubularSegments,
    set: (v: number) => {
      renderSettings.tubularSegments = clamp(Math.round(v), 3, 20);
    },
  });
  register('pipes.radialSegments', 'Pipes', 'Radial slices', {
    min: 4,
    max: 32,
    range: 28,
    get: () => renderSettings.radialSegments,
    set: (v: number) => {
      renderSettings.radialSegments = clamp(Math.round(v), 4, 32);
    },
  });
  register('pipes.colorShift', 'Pipes', 'Color shift', {
    min: 0,
    max: 0.4,
    range: 0.4,
    get: () => renderSettings.colorShift,
    set: (v: number) => {
      renderSettings.colorShift = clamp(v, 0, 0.4);
    },
  });
  register('pipes.cornerTension', 'Pipes', 'Corner smoothness', {
    min: 0,
    max: 3,
    range: 3,
    get: () => renderSettings.cornerTension,
    set: (v: number) => {
      renderSettings.cornerTension = clamp(v, 0, 3);
    },
  });
  register('pipes.metalness', 'Pipes', 'Metalness', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.pipeMetalness,
    set: (v: number) => {
      renderSettings.pipeMetalness = clamp(v, 0, 1);
      if (!renderSettings.glassEnabled) pipeMaterial.metalness = renderSettings.pipeMetalness;
    },
  });
  register('pipes.roughness', 'Pipes', 'Roughness', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.pipeRoughness,
    set: (v: number) => {
      renderSettings.pipeRoughness = clamp(v, 0, 1);
      if (!renderSettings.glassEnabled) pipeMaterial.roughness = renderSettings.pipeRoughness;
    },
  });
  register('pipes.glassTransmission', 'Pipes', 'Glass transmission', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.glassTransmission,
    set: (v: number) => {
      renderSettings.glassTransmission = clamp(v, 0, 1);
      updatePipeMaterial(renderSettings);
    },
  });
  register('pipes.glassOpacity', 'Pipes', 'Glass opacity', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.glassOpacity,
    set: (v: number) => {
      renderSettings.glassOpacity = clamp(v, 0, 1);
      updatePipeMaterial(renderSettings);
    },
  });
  register('pipes.glassIor', 'Pipes', 'Glass IOR', {
    min: 1,
    max: 2.5,
    range: 1.5,
    get: () => renderSettings.glassIor,
    set: (v: number) => {
      renderSettings.glassIor = clamp(v, 1, 2.5);
      updatePipeMaterial(renderSettings);
    },
  });
  register('pipes.neonStrength', 'Pipes', 'Neon strength', {
    min: 0,
    max: 4,
    range: 4,
    get: () => renderSettings.neonStrength,
    set: (v: number) => {
      renderSettings.neonStrength = clamp(v, 0, 4);
    },
  });
  register('pipes.neonSize', 'Pipes', 'Neon size', {
    min: 0.98,
    max: 1.2,
    range: 0.22,
    get: () => renderSettings.neonSize,
    set: (v: number) => {
      renderSettings.neonSize = clamp(v, 0.98, 1.2);
    },
  });

  register('light.backHue', 'Lighting', 'Camera light hue', {
    min: 0,
    max: 1,
    range: 1,
    get: () => hueFromHex(renderSettings.backLightColor),
    set: (v: number) => {
      const next = applyHueToHex(renderSettings.backLightColor, v);
      renderSettings.backLightColor = next;
      cameraLight.color.set(next);
    },
  });
  register('light.backIntensity', 'Lighting', 'Camera light intensity', {
    min: 0,
    max: 1200,
    range: 1200,
    get: () => renderSettings.backLightIntensity,
    set: (v: number) => {
      renderSettings.backLightIntensity = clamp(v, 0, 1200);
      cameraLight.intensity = renderSettings.backLightIntensity;
    },
  });
  register('light.backRange', 'Lighting', 'Camera light range', {
    min: 0,
    max: 420,
    range: 420,
    get: () => renderSettings.backLightRange,
    set: (v: number) => {
      renderSettings.backLightRange = clamp(v, 0, 420);
      cameraLight.distance = renderSettings.backLightRange;
    },
  });

  register('post.bloomStrength', 'Post FX', 'Bloom strength', {
    min: 0,
    max: 2,
    range: 2,
    get: () => renderSettings.bloomStrength,
    set: (v: number) => {
      renderSettings.bloomStrength = clamp(v, 0, 2);
      bloomPass.strength = renderSettings.bloomStrength;
    },
  });
  register('post.bloomRadius', 'Post FX', 'Bloom radius', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.bloomRadius,
    set: (v: number) => {
      renderSettings.bloomRadius = clamp(v, 0, 1);
      bloomPass.radius = renderSettings.bloomRadius;
    },
  });
  register('post.bloomThreshold', 'Post FX', 'Bloom threshold', {
    min: 0,
    max: 1,
    range: 1,
    get: () => renderSettings.bloomThreshold,
    set: (v: number) => {
      renderSettings.bloomThreshold = clamp(v, 0, 1);
      bloomPass.threshold = renderSettings.bloomThreshold;
    },
  });

  register('camera.orbitSpeed', 'Camera', 'Orbit speed', {
    min: 0.02,
    max: 0.6,
    range: 0.6,
    get: () => orbitSettings.orbitSpeed,
    set: (v: number) => {
      orbitSettings.orbitSpeed = clamp(v, 0.02, 0.6);
    },
  });
  register('camera.bobStrength', 'Camera', 'Orbit bob', {
    min: 0,
    max: 0.8,
    range: 0.8,
    get: () => orbitSettings.bobStrength,
    set: (v: number) => {
      orbitSettings.bobStrength = clamp(v, 0, 0.8);
    },
  });
  register('camera.wallMovement', 'Camera', 'Wall movement', {
    min: 0,
    max: 1,
    range: 1,
    get: () => wallDriftSettings.movement,
    set: (v: number) => {
      wallDriftSettings.movement = clamp(v, 0, 1);
      wallMovementController?.setValue(wallDriftSettings.movement);
    },
  });
  register('camera.wallBob', 'Camera', 'Wall bob', {
    min: 0,
    max: 1,
    range: 1,
    get: () => wallDriftSettings.bobStrength,
    set: (v: number) => {
      wallDriftSettings.bobStrength = clamp(v, 0, 1);
      wallBobController?.setValue(wallDriftSettings.bobStrength);
    },
  });
  register('camera.turnSpeed', 'Camera', 'Turn speed', {
    min: 0.2,
    max: 4,
    range: 3.8,
    get: () => cameraControl.turnSpeed,
    set: (v: number) => {
      cameraControl.turnSpeed = clamp(v, 0.2, 4);
    },
  });
  register('camera.pitchSpeed', 'Camera', 'Pitch speed', {
    min: 0.2,
    max: 4,
    range: 3.8,
    get: () => cameraControl.pitchSpeed,
    set: (v: number) => {
      cameraControl.pitchSpeed = clamp(v, 0.2, 4);
    },
  });
  register('camera.mouseSensitivity', 'Camera', 'Mouse sensitivity', {
    min: 0.001,
    max: 0.02,
    range: 0.019,
    get: () => cameraControl.mouseSensitivity,
    set: (v: number) => {
      cameraControl.mouseSensitivity = clamp(v, 0.001, 0.02);
    },
  });
  register('camera.distance', 'Camera', 'Manual zoom distance', {
    min: cameraDistanceBounds().min,
    max: cameraDistanceBounds().max,
    range: cameraDistanceBounds().max - cameraDistanceBounds().min,
    get: () => cameraControl.distance,
    set: (v: number) => {
      const bounds = cameraDistanceBounds();
      cameraControl.distance = clamp(v, bounds.min, bounds.max);
      refreshCameraDistanceController();
    },
  });
  register('camera.zoom', 'Camera', 'Zoom factor', {
    min: 0.01,
    max: 2,
    range: 2,
    get: () => cameraControl.zoomFactor,
    set: (v: number) => {
      applyCameraZoom(v);
    },
  });

  register('rail.speed', 'Rail', 'Path speed', {
    min: 0.02,
    max: 1.2,
    range: 1.2,
    get: () => railSettings.speed,
    set: (v: number) => {
      railSettings.speed = clamp(v, 0.02, 1.2);
    },
  });
  register('rail.radialFactor', 'Rail', 'Radius factor', {
    min: 0.2,
    max: 1.2,
    range: 1,
    get: () => railSettings.radialFactor,
    set: (v: number) => {
      railSettings.radialFactor = clamp(v, 0.2, 1.2);
    },
  });
  register('rail.verticalWave', 'Rail', 'Vertical wave', {
    min: 0,
    max: 1,
    range: 1,
    get: () => railSettings.verticalWave,
    set: (v: number) => {
      railSettings.verticalWave = clamp(v, 0, 1);
    },
  });
  register('rail.noise', 'Rail', 'Noise', {
    min: 0,
    max: 0.8,
    range: 0.8,
    get: () => railSettings.noise,
    set: (v: number) => {
      railSettings.noise = clamp(v, 0, 0.8);
    },
  });
  register('rail.posSmoothing', 'Rail', 'Pos smooth (s)', {
    min: 0.01,
    max: 1.5,
    range: 1.49,
    get: () => railSettings.posSmoothing,
    set: (v: number) => {
      railSettings.posSmoothing = clamp(v, 0.01, 1.5);
    },
  });
  register('rail.velocitySmoothing', 'Rail', 'Vel smooth (s)', {
    min: 0.01,
    max: 1.5,
    range: 1.49,
    get: () => railSettings.velocitySmoothing,
    set: (v: number) => {
      railSettings.velocitySmoothing = clamp(v, 0.01, 1.5);
    },
  });
  register('rail.targetSmoothing', 'Rail', 'Look smooth (s)', {
    min: 0.01,
    max: 1.5,
    range: 1.49,
    get: () => railSettings.targetSmoothing,
    set: (v: number) => {
      railSettings.targetSmoothing = clamp(v, 0.01, 1.5);
    },
  });
  register('rail.lookAhead', 'Rail', 'Look ahead', {
    min: 0,
    max: 1,
    range: 1,
    get: () => railSettings.lookAhead,
    set: (v: number) => {
      railSettings.lookAhead = clamp(v, 0, 1);
    },
  });
  register('rail.manualNudge', 'Rail', 'Arrow nudge', {
    min: 0,
    max: 0.8,
    range: 0.8,
    get: () => railSettings.manualNudge,
    set: (v: number) => {
      railSettings.manualNudge = clamp(v, 0, 0.8);
    },
  });
  register('rail.rollStrength', 'Rail', 'Roll', {
    min: 0,
    max: 1.2,
    range: 1.2,
    get: () => railSettings.rollStrength,
    set: (v: number) => {
      railSettings.rollStrength = clamp(v, 0, 1.2);
    },
  });

  modulation.syncBaseFromTargets();
  return setters;
}

function updateInfo(currentSim: Simulation, currentState: { fpsSmoothed: number; elapsed: number }) {
  const counts = {
    growing: 0,
    dying: 0,
    stuck: 0,
  };
  for (const p of currentSim.pipes) {
    if (p.state === 'growing') counts.growing++;
    else if (p.state === 'dying') counts.dying++;
    else if (p.state === 'stuck') counts.stuck++;
  }
  infoOverlay.textContent = `pipes: ${currentSim.pipes.length} • G:${counts.growing} D:${counts.dying} S:${counts.stuck} • fps: ${currentState.fpsSmoothed.toFixed(0)}`;
}

function createGridOutline(size: number): LineSegments {
  const geo = new BoxGeometry(size, size, size);
  const edges = new EdgesGeometry(geo);
  const mat = new LineBasicMaterial({ color: 0x33425f, transparent: true, opacity: 0.35 });
  const lines = new LineSegments(edges, mat);
  return lines;
}

function disposeGridLines(lines: LineSegments) {
  lines.geometry.dispose();
  const mat = lines.material;
  if (Array.isArray(mat)) {
    mat.forEach((m) => m.dispose());
  } else {
    mat.dispose();
  }
}

function rebuildGrid(size: number) {
  disposeGridLines(gridLines);
  scene.remove(gridLines);
  gridLines = createGridOutline(size);
  gridLines.visible = renderSettings.showGrid;
  scene.add(gridLines);
}

function resetOrbitState(anchor: Vector3 = camera.position) {
  orbitState.targetPos.copy(anchor);
  orbitState.smoothedPos.copy(anchor);
  orbitState.phase = Math.atan2(anchor.z, anchor.x);
  orbitState.swayPhase = orbitState.phase * 0.35;
}

function resetWallDriftState() {
  wallDriftState.travelPhase = Math.random() * Math.PI * 2;
  wallDriftState.bobPhase = Math.random() * Math.PI * 2;
}

function cameraDistanceBounds() {
  return {
    min: Math.max(2, (sim.config.gridSize + roomPadding) * 0.3),
    max: room.size * 0.45,
  };
}

function applyCameraZoom(factor: number) {
  const clamped = clamp(factor, 0.01, 2);
  cameraControl.zoomFactor = clamped;
  camera.zoom = clamped;
  camera.updateProjectionMatrix();
}

function refreshCameraDistanceController() {
  if (!cameraDistanceController) return;
  const { min, max } = cameraDistanceBounds();
  cameraDistanceController.min(min);
  cameraDistanceController.max(max);
  cameraDistanceController.setValue(clamp(cameraControl.distance, min, max));
}

function cameraBoundsLimit(margin = CAMERA_MARGIN) {
  const inset = mirrorInset + CAMERA_WALL_EPS;
  const halfSize = room.size * 0.5;
  return Math.max(0.5, halfSize - inset - margin);
}

function clampCameraToRoom(v: Vector3, margin = CAMERA_MARGIN) {
  const limit = cameraBoundsLimit(margin);
  v.x = clamp(v.x, -limit, limit);
  v.y = clamp(v.y, -limit, limit);
  v.z = clamp(v.z, -limit, limit);
}

function buildWallBasis(normal: Vector3, outA: Vector3, outB: Vector3) {
  const ref = Math.abs(normal.y) > 0.9 ? WORLD_FORWARD : WORLD_UP;
  outA.copy(normal).cross(ref);
  if (outA.lengthSq() < 1e-6) {
    outA.set(1, 0, 0);
  } else {
    outA.normalize();
  }
  outB.copy(normal).cross(outA).normalize();
}

function softLimitAxis(value: number, limit: number, softness = 0.12) {
  if (!isFinite(value) || limit <= 0) return 0;
  const abs = Math.abs(value);
  const safeLimit = Math.max(0.001, limit);
  const linearZone = safeLimit * (1 - softness);
  if (abs <= linearZone) return value;
  const t = (abs - linearZone) / (safeLimit * softness);
  const eased = 1 - Math.exp(-t * 2); // fast rise, smooth tail
  const saturated = linearZone + safeLimit * softness * Math.tanh(eased);
  return Math.sign(value) * saturated;
}

function softenCameraToRoom(v: Vector3, margin = CAMERA_MARGIN) {
  const limit = cameraBoundsLimit(margin);
  v.x = softLimitAxis(v.x, limit);
  v.y = softLimitAxis(v.y, limit);
  v.z = softLimitAxis(v.z, limit);
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function keepOrbitInside(v: Vector3, margin = CAMERA_MARGIN) {
  const limit = cameraBoundsLimit(margin);
  const safe = limit * 0.9;
  const maxAbs = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  if (maxAbs <= safe || maxAbs < 1e-6) return;
  const span = Math.max(0.0001, limit - safe);
  const t = clamp((maxAbs - safe) / span, 0, 1);
  const scale = 1 - easeOut(t) * (1 - safe / maxAbs);
  v.multiplyScalar(scale);
}

function randomizeCameraSettings() {
  const modes: CameraMode[] = ['wall', 'wallDrift', 'orbit', 'manual', 'rail'];
  const pickedMode = modes[randInt(0, modes.length - 1)];

  orbitSettings.orbitSpeed = rand(0.05, 0.55);
  orbitSettings.bobStrength = rand(0.04, 0.7);
  wallDriftSettings.movement = rand(0.05, 1);
  wallDriftSettings.bobStrength = rand(0, 1);

  cameraControl.mouseSensitivity = rand(0.0012, 0.015);
  cameraControl.turnSpeed = rand(0.4, 3.2);
  cameraControl.pitchSpeed = rand(0.4, 3.2);
  cameraControl.yaw = rand(-Math.PI, Math.PI);
  cameraControl.pitch = clamp(rand(-0.45, 0.45), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  cameraControl.wallFace = randInt(0, 5);

  const { min, max } = cameraDistanceBounds();
  cameraControl.distance = clamp(rand(min * 0.9, max * 0.85), min, max);
  cameraControl.mode = pickedMode;
  if (pickedMode === 'wallDrift') {
    resetWallDriftState();
  }

  railSettings.speed = rand(0.05, 0.9);
  railSettings.radialFactor = rand(0.35, 1.05);
  railSettings.verticalWave = rand(0.05, 0.9);
  railSettings.noise = rand(0.02, 0.65);
  railSettings.posSmoothing = rand(0.05, 1.2);
  railSettings.velocitySmoothing = rand(0.05, 1.2);
  railSettings.targetSmoothing = rand(0.05, 1.2);
  railSettings.lookAhead = rand(0.05, 0.85);
  railSettings.manualNudge = rand(0.02, 0.7);
  railSettings.rollStrength = rand(0.05, 1.0);

  cameraModeController?.setValue(pickedMode);
  orbitSpeedController?.setValue(orbitSettings.orbitSpeed);
  orbitBobController?.setValue(orbitSettings.bobStrength);
  wallMovementController?.setValue(wallDriftSettings.movement);
  wallBobController?.setValue(wallDriftSettings.bobStrength);
  mouseSensController?.setValue(cameraControl.mouseSensitivity);
  turnSpeedController?.setValue(cameraControl.turnSpeed);
  pitchSpeedController?.setValue(cameraControl.pitchSpeed);
  refreshCameraDistanceController();
  cameraZoomController?.setValue(cameraControl.zoomFactor);

  railSpeedController?.setValue(railSettings.speed);
  railRadiusController?.setValue(railSettings.radialFactor);
  railWaveController?.setValue(railSettings.verticalWave);
  railNoiseController?.setValue(railSettings.noise);
  railPosSmoothController?.setValue(railSettings.posSmoothing);
  railVelSmoothController?.setValue(railSettings.velocitySmoothing);
  railTargetSmoothController?.setValue(railSettings.targetSmoothing);
  railLookAheadController?.setValue(railSettings.lookAhead);
  railNudgeController?.setValue(railSettings.manualNudge);
  railRollController?.setValue(railSettings.rollStrength);
  modulation.syncBaseFromTargets();
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function randomizeAll() {
  defaultSimConfig.gridSize = randInt(14, 64);
  defaultSimConfig.targetPipeCount = randInt(6, 32);
  const maxLen = randBool(0.2) ? 0 : randInt(40, 260);
  defaultSimConfig.maxPipeLength = maxLen === 0 ? 0 : Math.max(4, maxLen);
  defaultSimConfig.turnProbability = Math.random();
  turnProxy.turnChance = defaultSimConfig.turnProbability * 100;
  defaultSimConfig.disableTailShrink = randBool(0.35);

  renderSettings.pipeRadius = rand(0.1, 0.35);
  renderSettings.tubularSegments = randInt(6, 16);
  renderSettings.radialSegments = randInt(6, 22);
  renderSettings.colorShift = rand(0, 0.35);
  renderSettings.pathType = PATH_TYPES[randInt(0, PATH_TYPES.length - 1)];
  renderSettings.roomRoughness = rand(0, 0.25);
  renderSettings.roomMetalness = rand(0.7, 1);
  renderSettings.roomReflectivity = rand(0.85, 1);
  renderSettings.roomColor = randColorHex();
  renderSettings.showGrid = randBool(0.25);
  renderSettings.pipeMetalness = rand(0.08, 0.4);
  renderSettings.pipeRoughness = rand(0.05, 0.45);
  renderSettings.glassEnabled = randBool(0.45);
  renderSettings.glassTransmission = rand(0.4, 0.9);
  renderSettings.glassOpacity = rand(0.12, 0.55);
  renderSettings.glassIor = rand(1.05, 1.55);
  renderSettings.cornerTension = rand(0, 0.4);
  renderSettings.neonEnabled = randBool(0.8);
  renderSettings.neonStrength = rand(0.4, 1.4);
  renderSettings.neonSize = 1;
  renderSettings.edgeNeonEnabled = randBool(0.9);
  renderSettings.edgeNeonColor = randColorHex();
  renderSettings.edgeHueTravelEnabled = randBool(0.5);
  renderSettings.edgeHueTravelPeriod = rand(2, 14);
  renderSettings.edgeNeonStrength = rand(0.6, 6);
  renderSettings.edgeNeonShowMeshes = randBool(0.8);
  renderSettings.edgeNeonWidth = rand(0.03, 0.18);
  renderSettings.bloomStrength = rand(0.4, 1.2);
  renderSettings.bloomRadius = rand(0.2, 0.6);
  renderSettings.bloomThreshold = rand(0.08, 0.3);

  sim.reset({
    gridSize: defaultSimConfig.gridSize,
    maxPipeLength: defaultSimConfig.maxPipeLength,
    targetPipeCount: defaultSimConfig.targetPipeCount,
    growthInterval: defaultSimConfig.growthInterval,
    turnProbability: defaultSimConfig.turnProbability,
    disableTailShrink: defaultSimConfig.disableTailShrink,
  });
  pipeManager.resetGridSize(defaultSimConfig.gridSize);
  room.updateSize(defaultSimConfig.gridSize, renderSettings);
  room.material.color.set(renderSettings.roomColor);
  room.material.roughness = renderSettings.roomRoughness;
  room.material.metalness = renderSettings.roomMetalness;
  room.material.reflectivity = renderSettings.roomReflectivity;
  roomMirrors.update(room.size, renderSettings.roomColor);
  rebuildGrid(defaultSimConfig.gridSize);

  updatePipeMaterial(renderSettings);
  pipeManager.forceGeometryRefresh();
  bloomPass.strength = renderSettings.bloomStrength;
  bloomPass.radius = renderSettings.bloomRadius;
  bloomPass.threshold = renderSettings.bloomThreshold;

  gridLines.visible = renderSettings.showGrid;
  state.paused = false;

  gridSizeController?.setValue(defaultSimConfig.gridSize);
  targetCountController?.setValue(defaultSimConfig.targetPipeCount);
  maxLengthController?.setValue(defaultSimConfig.maxPipeLength);
  growthIntervalController?.setValue(defaultSimConfig.growthInterval);
  turnController?.setValue(turnProxy.turnChance);
  tailShrinkController?.setValue(defaultSimConfig.disableTailShrink);
  refreshCameraDistanceController();
  modulation.syncBaseFromTargets();
}

function createRoom(
  gridSize: number,
  settings: Pick<RenderSettings, 'roomMetalness' | 'roomReflectivity' | 'roomRoughness' | 'roomColor'>
): {
  mesh: Mesh;
  material: MeshPhysicalMaterial;
  readonly size: number;
  updateSize: (s: number, rs: RenderSettings) => void;
} {
  let currentSize = gridSize + roomPadding * 2;
  const geom = new BoxGeometry(currentSize, currentSize, currentSize);
  const mat = new MeshPhysicalMaterial({
    color: new Color(settings.roomColor),
    roughness: settings.roomRoughness,
    metalness: settings.roomMetalness,
    reflectivity: settings.roomReflectivity,
    clearcoat: 1,
    clearcoatRoughness: 0,
    side: DoubleSide,
  });
  const mesh = new Mesh(geom, mat);

  const updateSize = (newGridSize: number, rs: RenderSettings) => {
    currentSize = newGridSize + roomPadding * 2;
    mesh.geometry.dispose();
    mesh.geometry = new BoxGeometry(currentSize, currentSize, currentSize);
    mat.roughness = rs.roomRoughness;
    mat.metalness = rs.roomMetalness;
    mat.reflectivity = rs.roomReflectivity;
    mat.color.set(rs.roomColor);
  };

  return {
    mesh,
    material: mat,
    get size() {
      return currentSize;
    },
    updateSize,
  };
}

class EdgeNeonSystem {
  private group = new Group();
  private scene: Scene;
  private baseMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  private glowMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  private geometry: CylinderGeometry | null = null;
  private meshes: Mesh[] = [];
  private glowMeshes: Mesh[] = [];
  private lights: PointLight[] = [];
  private lastRoomSize = 0;
  private lastInset = 0;
  private lastRadius = 0;
  private baseColor = new Color();
  private animatedColor = new Color();
  private hsl = { h: 0, s: 0, l: 0 };
  private up = new Vector3(0, 1, 0);
  private tmpDir = new Vector3();
  private tmpQuat = new Quaternion();

  constructor(scene: Scene) {
    this.scene = scene;
    this.group.visible = false;
    this.scene.add(this.group);
  }

  sync(roomSize: number, wallInset: number, settings: RenderSettings, time: number) {
    const targetWidth = settings.edgeNeonWidth ?? settings.pipeRadius * 0.9;
    const width = Math.min(0.5, Math.max(0.02, targetWidth));
    const radius = Math.min(0.25, Math.max(0.01, width * 0.5));
    const inset = Math.max(0.08, wallInset + 0.12);
    if (
      !this.geometry ||
      Math.abs(roomSize - this.lastRoomSize) > 1e-4 ||
      Math.abs(inset - this.lastInset) > 1e-4 ||
      Math.abs(radius - this.lastRadius) > 1e-4
    ) {
      this.rebuild(roomSize, inset, radius);
    }
    this.updateAppearance(settings, time);
  }

  private rebuild(roomSize: number, inset: number, radius: number) {
    this.disposeGeometry();
    const half = Math.max(radius * 2, roomSize * 0.5 - inset);
    const length = Math.max(radius * 4, half * 2);
    this.geometry = new CylinderGeometry(radius, radius, length, 12, 1, true);
    const offsets = [-half, half];
    for (const y of offsets) {
      for (const z of offsets) {
        this.createEdge(new Vector3(-half, y, z), new Vector3(half, y, z), roomSize);
      }
    }
    for (const x of offsets) {
      for (const z of offsets) {
        this.createEdge(new Vector3(x, -half, z), new Vector3(x, half, z), roomSize);
      }
    }
    for (const x of offsets) {
      for (const y of offsets) {
        this.createEdge(new Vector3(x, y, -half), new Vector3(x, y, half), roomSize);
      }
    }
    this.lastRoomSize = roomSize;
    this.lastInset = inset;
    this.lastRadius = radius;
  }

  private createEdge(start: Vector3, end: Vector3, roomSize: number) {
    if (!this.geometry) return;
    const mesh = new Mesh(this.geometry, this.baseMaterial);
    const glow = new Mesh(this.geometry, this.glowMaterial);
    const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5);
    this.tmpDir.copy(end).sub(start).normalize();
    this.tmpQuat.setFromUnitVectors(this.up, this.tmpDir);
    mesh.position.copy(mid);
    mesh.quaternion.copy(this.tmpQuat);
    glow.position.copy(mid);
    glow.quaternion.copy(this.tmpQuat);
    this.group.add(mesh, glow);
    this.meshes.push(mesh);
    this.glowMeshes.push(glow);

    // Populate a few point lights along the edge to cast light into the room.
    const span = start.distanceTo(end);
    const segments = Math.min(12, Math.max(3, Math.round(span / 12)));
    for (let i = 0; i < segments; i++) {
      const t = (i + 0.5) / segments;
      const pos = new Vector3().lerpVectors(start, end, t);
      const light = new PointLight(this.baseColor.clone(), 0, Math.max(roomSize * 0.75, span * 0.6), 1.35);
      light.position.copy(pos);
      this.scene.add(light);
      this.lights.push(light);
    }
  }

  private updateAppearance(settings: RenderSettings, time: number) {
    const active = settings.edgeNeonEnabled;
    const showMeshes = settings.edgeNeonShowMeshes !== false;
    this.group.visible = active && showMeshes;
    this.baseColor.set(settings.edgeNeonColor);
    this.baseColor.getHSL(this.hsl);
    let hue = this.hsl.h;
    if (settings.edgeHueTravelEnabled) {
      const period = Math.max(0.01, settings.edgeHueTravelPeriod);
      hue = (hue + time / period) % 1;
    }
    this.animatedColor.setHSL(hue, this.hsl.s, this.hsl.l);
    const intensity = Math.max(0, settings.edgeNeonStrength);
    this.baseMaterial.color.copy(this.animatedColor);
    this.baseMaterial.opacity = Math.min(1, Math.max(0.05, intensity * 0.6));
    this.glowMaterial.color.copy(this.animatedColor).multiplyScalar(Math.max(0.01, intensity));
    this.glowMaterial.opacity = 1;
    const glowScale = settings.neonSize;
    for (const glow of this.glowMeshes) {
      glow.scale.setScalar(glowScale);
    }
    const lightDistance = Math.max(2, this.lastRoomSize * 0.75);
    const lightIntensity = active ? intensity * 35 : 0;
    for (const light of this.lights) {
      light.visible = active;
      light.color.copy(this.animatedColor);
      light.intensity = lightIntensity;
      light.distance = lightDistance;
      light.decay = 1.35;
    }
  }

  private disposeGeometry() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
    }
    for (const glow of this.glowMeshes) {
      this.group.remove(glow);
    }
    for (const light of this.lights) {
      this.scene.remove(light);
    }
    this.meshes = [];
    this.glowMeshes = [];
    this.lights = [];
    this.geometry?.dispose();
    this.geometry = null;
  }

  dispose() {
    this.disposeGeometry();
    this.scene.remove(this.group);
    this.baseMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
const cellSize = 1;
const toWorld = (gridSize: number, cell: Vec3): Vector3 => {
  const half = gridSize / 2;
  return new Vector3(cell.x - half + 0.5, cell.y - half + 0.5, cell.z - half + 0.5).multiplyScalar(cellSize);
};

class PipeVisual {
  mesh: Mesh;
  glow?: Mesh;
  glowMaterial?: MeshBasicMaterial;
  private lastVersion = -1;
  private lastRadius = renderSettings.pipeRadius;
  private lastSegments = renderSettings.tubularSegments;
  private lastColorShift = renderSettings.colorShift;
  private lastRadialSegments = renderSettings.radialSegments;
  private lastCornerTension = renderSettings.cornerTension;
  private lastPathType: PathType = renderSettings.pathType;
  private material: MeshPhysicalMaterial;
  private gridSize: number;

  constructor(material: MeshPhysicalMaterial, gridSize: number, pipe: Pipe, settings: RenderSettings) {
    this.material = material;
    this.gridSize = gridSize;
    this.mesh = new Mesh(undefined, this.material);
    this.mesh.layers.set(PIPE_LAYER);
    this.glow = undefined;
    this.glowMaterial = undefined;
    this.update(pipe, settings);
  }

  update(pipe: Pipe, settings: RenderSettings): void {
    const needsGeometry =
      pipe.version !== this.lastVersion ||
      settings.pipeRadius !== this.lastRadius ||
      settings.tubularSegments !== this.lastSegments ||
      settings.colorShift !== this.lastColorShift ||
      settings.radialSegments !== this.lastRadialSegments ||
      settings.cornerTension !== this.lastCornerTension ||
      settings.pathType !== this.lastPathType;

    if (needsGeometry) {
      this.mesh.geometry?.dispose();
      this.mesh.geometry = createPipeGeometry(pipe, this.gridSize, settings);
      if (this.glow) {
        this.glow.geometry.dispose();
        this.glow.geometry = this.mesh.geometry;
      }
      this.lastVersion = pipe.version;
      this.lastRadius = settings.pipeRadius;
      this.lastSegments = settings.tubularSegments;
      this.lastColorShift = settings.colorShift;
      this.lastRadialSegments = settings.radialSegments;
      this.lastCornerTension = settings.cornerTension;
      this.lastPathType = settings.pathType;
    }

    if (settings.neonEnabled) {
      if (!this.glow || !this.glowMaterial) {
        this.glowMaterial = new MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          opacity: settings.neonStrength,
        });
        this.glow = new Mesh(this.mesh.geometry, this.glowMaterial);
        this.glow.layers.set(PIPE_LAYER);
      }
      this.glowMaterial.opacity = settings.neonStrength;
      this.glow.scale.setScalar(settings.neonSize);
      this.glow.visible = true;
    } else if (this.glow) {
      this.glow.visible = false;
    }
  }

  dispose() {
    this.mesh.geometry?.dispose();
    if (this.glow) {
      this.glow.geometry?.dispose();
    }
    this.glowMaterial?.dispose();
  }

  forceGeometryRefresh() {
    this.lastVersion = -1;
  }
}

class PipeVisualManager {
  private visuals = new Map<number, PipeVisual>();
  private scene: Scene;
  private material: MeshPhysicalMaterial;
  private gridSize: number;

  constructor(scene: Scene, material: MeshPhysicalMaterial, gridSize: number) {
    this.scene = scene;
    this.material = material;
    this.gridSize = gridSize;
  }

  resetGridSize(size: number) {
    this.gridSize = size;
  }

  forceGeometryRefresh() {
    for (const visual of this.visuals.values()) {
      visual.forceGeometryRefresh();
    }
  }

  sync(pipes: Pipe[], settings: RenderSettings) {
    const activeIds = new Set(pipes.map((p) => p.id));
    for (const [id, visual] of this.visuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(visual.mesh);
        if (visual.glow) this.scene.remove(visual.glow);
        visual.dispose();
        this.visuals.delete(id);
      }
    }

    for (const pipe of pipes) {
      let visual = this.visuals.get(pipe.id);
      if (!visual) {
        visual = new PipeVisual(this.material, this.gridSize, pipe, settings);
        this.visuals.set(pipe.id, visual);
        this.scene.add(visual.mesh);
        const glow = visual.glow;
        if (glow) this.scene.add(glow);
      }
      visual.update(pipe, settings);
      const glowMesh = visual.glow as Mesh | undefined;
      if (glowMesh) {
        const present = this.scene.children.some((child) => child === glowMesh);
        if (!present) {
          this.scene.add(glowMesh);
        }
      }
    }
  }
}

function createPipeGeometry(pipe: Pipe, gridSize: number, settings: RenderSettings) {
  const path = pipe.cells.map((cell) => toWorld(gridSize, cell));
  if (pipe.headLerp < 1 && pipe.cells.length > 1) {
    const last = path.length - 1;
    const prev = toWorld(gridSize, pipe.prevHead);
    path[last] = prev.clone().lerp(path[last], pipe.headLerp);
  }
  if (path.length === 1) path.push(path[0].clone().add(new Vector3(0.001, 0.001, 0.001)));

  const curve =
    settings.pathType === 'polyline'
      ? (() => {
          const curvePath = new CurvePath<Vector3>();
          for (let i = 0; i < path.length - 1; i++) {
            curvePath.add(new LineCurve3(path[i], path[i + 1]));
          }
          return curvePath;
        })()
      : new CatmullRomCurve3(
          path,
          false,
          settings.pathType === 'catmullrom' ? 'catmullrom' : settings.pathType,
          settings.cornerTension
        );

  const baseSegments =
    settings.pathType === 'polyline' ? Math.max(1, path.length - 1) : Math.max(1, path.length);
  const tubularSegments = Math.max(6, Math.floor(settings.tubularSegments * baseSegments));
  const geometry = new TubeGeometry(curve, tubularSegments, settings.pipeRadius, settings.radialSegments, false);

  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(geometry.attributes.position.count * 3);

  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const v = uv.getY(i); // 0..1 along tube length
    const hue = pipe.colorSeed + settings.colorShift * (v - 0.5);
    const light = clamp(0.35, 0.9, 0.58 + 0.12 * (v - 0.5));
    const c = new Color().setHSL(hue - Math.floor(hue), 0.65, light);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

edgeNeons = new EdgeNeonSystem(scene);
pipeManager = new PipeVisualManager(scene, pipeMaterial, defaultSimConfig.gridSize);
requestAnimationFrame(frame);
setupGui();

function downloadTextFile(filename: string, text: string, mimeType = 'application/json') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function buildProjectSettings(): ProjectSettings {
  return {
    simConfig: { ...defaultSimConfig },
    renderSettings: { ...renderSettings },
    roomPadding,
    mirror: {
      inset: mirrorInset,
      resolutionScale: reflectorResScale,
      maxResolution: reflectorMaxRes,
      facesPerFrame: mirrorFacesPerFrame,
      enabled: mirrorEnabled,
      renderer: mirrorRenderer,
      rayBounces: rayMaxBounces,
      reflectionMode: mirrorReflectionMode,
      blur: mirrorBlurAmount,
      chromaticShift: mirrorChromaticShift,
      warpStrength: mirrorWarpStrength,
      warpSpeed: mirrorWarpSpeed,
      refractionOffset: mirrorRefractionOffset,
      noiseStrength: mirrorNoiseStrength,
      bounceAttenuation: mirrorBounceAttenuation,
      bounceAttenuationMode: mirrorBounceAttenuationMode,
    },
    camera: { ...cameraControl },
    orbit: { ...orbitSettings },
    wallDrift: { ...wallDriftSettings },
    rail: { ...railSettings },
  };
}

function snapshotProjectSettings(): ProjectSettings {
  const wasBypassed = modulation.isBypassed();
  const playheadSeconds = ignoreAudioForModulation ? null : timelineHandle?.getPlayheadSeconds();
  const modulationTime = playheadSeconds ?? state.elapsed;

  modulation.setBypass(true);
  const settings = buildProjectSettings();
  modulation.setBypass(wasBypassed);
  if (!wasBypassed) {
    modulation.update(modulationTime, 1 / 60);
  }
  return settings;
}

function applyProjectSettings(settings: ProjectSettings) {
  const cfg = settings.simConfig;
  defaultSimConfig.gridSize = Math.max(8, Math.floor(cfg.gridSize));
  defaultSimConfig.targetPipeCount = Math.max(1, Math.floor(cfg.targetPipeCount));
  defaultSimConfig.maxPipeLength = Math.max(0, Math.floor(cfg.maxPipeLength));
  defaultSimConfig.growthInterval = Math.max(0.001, cfg.growthInterval);
  defaultSimConfig.turnProbability = clamp(cfg.turnProbability, 0, 1);
  defaultSimConfig.disableTailShrink = Boolean(cfg.disableTailShrink);
  turnProxy.turnChance = defaultSimConfig.turnProbability * 100;

  roomPadding = clamp(settings.roomPadding, 0, 70);
  roomGuiSettings.wallGap = roomPadding;

  Object.assign(renderSettings, settings.renderSettings);

  const prevMirrorRenderer = mirrorRenderer;
  mirrorInset = Math.max(0, settings.mirror.inset);
  reflectorResScale = clamp(settings.mirror.resolutionScale, 0.05, 8);
  reflectorMaxRes = clamp(settings.mirror.maxResolution, 256, 4096 * 4);
  mirrorFacesPerFrame = clamp(Math.floor(settings.mirror.facesPerFrame), 1, 6);
  mirrorEnabled = Boolean(settings.mirror.enabled);
  mirrorRenderer = settings.mirror.renderer;
  rayMaxBounces = clamp(Math.floor(settings.mirror.rayBounces), 1, 16);
  mirrorReflectionMode = settings.mirror.reflectionMode;
  mirrorBlurAmount = clamp(settings.mirror.blur, 0, 1);
  mirrorChromaticShift = clamp(settings.mirror.chromaticShift, 0, 0.1);
  mirrorWarpStrength = clamp(settings.mirror.warpStrength, 0, 0.2);
  mirrorWarpSpeed = clamp(settings.mirror.warpSpeed, 0, 20);
  mirrorRefractionOffset = clamp(settings.mirror.refractionOffset, -1, 1);
  mirrorNoiseStrength = clamp(settings.mirror.noiseStrength, 0, 1);
  mirrorBounceAttenuation = clamp(settings.mirror.bounceAttenuation, 0, 10);
  mirrorBounceAttenuationMode = settings.mirror.bounceAttenuationMode;

  Object.assign(mirrorGuiSettings, {
    inset: mirrorInset,
    resolutionScale: reflectorResScale,
    maxResolution: reflectorMaxRes,
    facesPerFrame: mirrorFacesPerFrame,
    enabled: mirrorEnabled,
    renderer: mirrorRenderer,
    rayBounces: rayMaxBounces,
    reflectionMode: mirrorReflectionMode,
    blur: mirrorBlurAmount,
    chromaticShift: mirrorChromaticShift,
    warpStrength: mirrorWarpStrength,
    warpSpeed: mirrorWarpSpeed,
    refractionOffset: mirrorRefractionOffset,
    noiseStrength: mirrorNoiseStrength,
    bounceAttenuation: mirrorBounceAttenuation,
    bounceAttenuationMode: mirrorBounceAttenuationMode,
  });

  Object.assign(cameraControl, settings.camera);
  Object.assign(orbitSettings, settings.orbit);
  Object.assign(wallDriftSettings, settings.wallDrift);
  Object.assign(railSettings, settings.rail);

  applyCameraZoom(cameraControl.zoomFactor);

  state.elapsed = 0;
  state.paused = false;
  sim.reset(defaultSimConfig);
  pipeManager.resetGridSize(sim.config.gridSize);
  pipeManager.sync([], renderSettings);

  room.updateSize(sim.config.gridSize, renderSettings);
  roomMirrors.update(room.size, renderSettings.roomColor);
  rebuildGrid(sim.config.gridSize);

  syncPipeVisibilityToMainCamera();
  updatePipeMaterial(renderSettings);
  bloomPass.strength = renderSettings.bloomStrength;
  bloomPass.radius = renderSettings.bloomRadius;
  bloomPass.threshold = renderSettings.bloomThreshold;

  if (prevMirrorRenderer !== mirrorRenderer) {
    roomMirrors.dispose();
    roomMirrors = createMirrorSystem(mirrorRenderer);
  }
  roomMirrors.setEnabled(mirrorEnabled);
  roomMirrors.setInset(mirrorInset);
  updateMirrorResolution();
  updateMirrorBlur();
  updateMirrorDistortionUniforms(state.elapsed);
  updateMirrorMask();
  roomMirrors.update(room.size, renderSettings.roomColor);

  refreshCameraDistanceController();

  modulation.syncBaseFromTargets();
  if (guiInstance) {
    for (const controller of guiInstance.controllersRecursive()) {
      controller.updateDisplay();
    }
  }
}

function saveProject() {
  const timeline = timelineHandle?.getProjectTimeline();
  if (!timeline) return;
  const project: ProjectFile = {
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    name: timeline.audioFileName ?? undefined,
    timeline,
    settings: snapshotProjectSettings(),
  };
  const json = stringifyProjectFile(project);
  downloadTextFile(`pipes-project-${Date.now()}.json`, json);
}

function loadProject(project: ProjectFile) {
  applyProjectSettings(project.settings);
  timelineHandle?.loadProjectTimeline(project.timeline);
}

timelineHandle = initTimeline({
  container: timelinePane,
  bpm: modulationGlobals.bpm,
  modulation,
  onBpmChange: (bpm) => {
    modulationGlobals.bpm = bpm;
    modulation.setGlobalBpm(bpm);
  },
  onSaveProject: () => saveProject(),
  onLoadProject: (project) => loadProject(project),
  onRenderVideo: (durationSeconds) => {
    const schedule = timelineHandle?.getRenderSchedule();
    if (schedule) {
      requestBackendRender(schedule).catch((err) => {
        console.warn('Backend render failed; falling back to in-browser render', err);
        renderVideoCapture(durationSeconds, { startAtZero: true });
      });
      return;
    }
    renderVideoCapture(durationSeconds, { startAtZero: true });
  },
});

function applyRenderSchedule(schedule: RenderSchedule) {
  modulationGlobals.bpm = schedule.bpm;
  modulation.setGlobalBpm(schedule.bpm);
  for (const lfo of modulation.getLfos().slice()) {
    modulation.removeLfo(lfo.id);
  }
  for (const lfo of schedule.lfos) {
    modulation.addLfo(lfo);
  }
  modulation.syncBaseFromTargets();
}

(window as any).__pipesBackend = {
  ready: true,
  applySchedule: applyRenderSchedule,
  renderFromSchedule: async (schedule: RenderSchedule, filenameBase?: string) => {
    applyRenderSchedule(schedule);
    await renderVideoCapture(schedule.durationSeconds, { startAtZero: true, filenameBase });
  },
};

function updatePipeMaterial(settings: RenderSettings) {
  pipeMaterial.vertexColors = true;
  pipeMaterial.metalness = settings.glassEnabled ? 0 : settings.pipeMetalness;
  pipeMaterial.roughness = settings.glassEnabled ? Math.min(0.25, settings.pipeRoughness) : settings.pipeRoughness;
  pipeMaterial.transparent = settings.glassEnabled;
  pipeMaterial.transmission = settings.glassEnabled ? settings.glassTransmission : 0;
  pipeMaterial.opacity = settings.glassEnabled ? settings.glassOpacity : 1;
  pipeMaterial.ior = settings.glassEnabled ? settings.glassIor : 1.0;
  pipeMaterial.thickness = settings.glassEnabled ? 0.4 : 0;
  pipeMaterial.envMap = null;
  pipeMaterial.envMapIntensity = 0;
  pipeMaterial.needsUpdate = true;
}
