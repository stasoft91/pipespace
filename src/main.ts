import './style.css';
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  EdgesGeometry,
  AdditiveBlending,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  Vector2,
  WebGLRenderer,
  DoubleSide,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { Pipe, Simulation } from './simulation';
import type { SimulationConfig, Vec3 } from './simulation';
import { PhysicalRayMirrorSystem, RasterMirrorSystem, RayMirrorSystem } from './mirrors';
import type { MirrorReflectionMode, MirrorSystem } from './mirrors';

type RenderSettings = {
  pipeRadius: number;
  tubularSegments: number;
  radialSegments: number;
  colorShift: number;
  headLightIntensity: number;
  headLightRange: number;
  headLightsEnabled: boolean;
  maxHeadLights: number;
  backLightEnabled: boolean;
  backLightIntensity: number;
  backLightRange: number;
  backLightColor: string;
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

type CameraMode = 'wall' | 'orbit' | 'manual' | 'rail';
type MirrorRenderer = 'raster' | 'ray' | 'physicalRay';

let roomPadding = 15; // gap between grid extents and room walls
const roomGuiSettings = {
  wallGap: roomPadding,
};
let mirrorInset = 0.01;
let reflectorResScale = 1;
let reflectorMaxRes = 4096 * 4;
let mirrorFacesPerFrame = 6; // how many faces update each frame (reduces flicker/load)
let rayMaxBounces = 3;
let mirrorEnabled = true;
let mirrorReflectionMode: MirrorReflectionMode = 'all'; // how mirrors see each other
let mirrorRenderer: MirrorRenderer = 'ray';
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
const canvas = document.createElement('canvas');
canvas.id = 'pipes-canvas';
document.body.appendChild(canvas);

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

function setRecordingProgress(fraction: number | null, label: string) {
  if (fraction === null) {
    recordingOverlay.style.display = 'none';
    return;
  }
  const clamped = clamp(fraction, 0, 1);
  const pct = Math.round(clamped * 100);
  recordingOverlay.textContent = `${label} ${pct}%`;
  recordingOverlay.style.display = 'block';
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
  pipeRadius: 0.08,
  tubularSegments: 7,
  radialSegments: 10,
  colorShift: 0,
  headLightIntensity: 8,
  headLightRange: 0, // 0 = infinite distance in three.js
  headLightsEnabled: false,
  maxHeadLights: 8,
  backLightEnabled: false,
  backLightIntensity: 1200,
  backLightRange: 0,
  backLightColor: '#ffffff',
  roomRoughness: 0.25,
  roomMetalness: 0.75,
  roomReflectivity: 1,
  roomColor: '#ffffff',
  showGrid: false,
  hidePipesInMainCamera: true,
  pipeMetalness: 0.18,
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
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new Scene();
scene.background = new Color('#000000');

const camera = new PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.1, 5000);
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
  });
}

let roomMirrors: MirrorSystem = createMirrorSystem(mirrorRenderer);

let gridLines = createGridOutline(defaultSimConfig.gridSize);
gridLines.visible = renderSettings.showGrid;
scene.add(gridLines);

const pipeMaterial = new MeshPhysicalMaterial({ vertexColors: true });
updatePipeMaterial(renderSettings);

let pipeManager!: PipeVisualManager;
let bloomPass!: UnrealBloomPass;
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
const orbitState = {
  phase: 0,
  swayPhase: Math.random() * Math.PI * 2,
  targetPos: new Vector3(),
  smoothedPos: new Vector3(),
};
let lastCameraMode: CameraMode = cameraControl.mode;

function mirrorTargetSize() {
  const { innerWidth, innerHeight } = window;
  const pixelRatio = renderer.getPixelRatio();
  return {
    width: Math.min(reflectorMaxRes, innerWidth * pixelRatio * reflectorResScale),
    height: Math.min(reflectorMaxRes, innerHeight * pixelRatio * reflectorResScale),
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
  const { innerWidth, innerHeight } = window;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  composer.setSize(innerWidth, innerHeight);
  bloomPass.setSize(innerWidth, innerHeight);
  updateMirrorResolution();
}

window.addEventListener('resize', resize);
resize();

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
  frameIndex++;
  const enteringOrbit = cameraControl.mode === 'orbit' && lastCameraMode !== 'orbit';
  updateMirrorMask();
  updateMirrorDistortionUniforms(state.elapsed);
  roomMirrors.updateFrame?.(renderer, scene, camera);

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
  const totalFrames = Math.max(1, Math.round(clamp(durationSeconds, 5, 20) * 60));

  const chunks: EncodedVideoChunk[] = [];
  const encoder = new VideoEncoder({
    output: (chunk) => {
      chunks.push(chunk);
    },
    error: (e) => {
      console.error('WebCodecs encoder error', e);
    },
  });

  encoder.configure({
    codec: 'vp09.00.10.08',
    width,
    height,
    bitrate: 125_000_000,
    framerate: 60,
  });

  // Pause RAF during offline render
  const wasRunning = typeof rafHandle === 'number';
  if (wasRunning) cancelAnimationFrame(rafHandle);

  for (let i = 0; i < totalFrames; i++) {
    setRecordingProgress(i / totalFrames, 'Encoding (WebCodecs)');
    stepFrame(1 / 60);
    const bitmap = await createImageBitmap(canvas);
    const frame = new VideoFrame(bitmap, { timestamp: i });
    encoder.encode(frame);
    frame.close();
    bitmap.close();
  }

  await encoder.flush();
  encoder.close();

  if (!chunks.length) {
    console.warn('WebCodecs produced no chunks');
    if (wasRunning) rafHandle = requestAnimationFrame(frame);
    return null;
  }

  // Build IVF container (simple and widely supported)
  const frameCount = chunks.length;
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

  // Calculate total buffer size
  let totalSize = header.byteLength;
  for (const chunk of chunks) {
    totalSize += 12 + chunk.byteLength; // frame header + data
  }

  const out = new Uint8Array(totalSize);
  out.set(new Uint8Array(header), 0);
  let offset = header.byteLength;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const frameHeader = new DataView(out.buffer, offset, 12);
    frameHeader.setUint32(0, chunk.byteLength, true);
    frameHeader.setBigUint64(4, BigInt(i), true);
    offset += 12;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    out.set(data, offset);
    offset += chunk.byteLength;
  }

  const blob = new Blob([out], { type: 'video/x-ivf' });
  if (wasRunning) rafHandle = requestAnimationFrame(frame);
  setRecordingProgress(null, '');
  return blob;
}

async function renderVideoCapture(durationSeconds: number) {
  if (videoCaptureSettings.recording) return;

  // Prefer offline WebCodecs encoding (decoupled from real-time)
  if (supportsWebCodecs()) {
    const blob = await encodeIvfWithWebCodecs(durationSeconds);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = url;
      download.download = `pipes-${clamp(durationSeconds, 5, 20)}s-${Date.now()}.ivf`;
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setRecordingProgress(null, '');
      return;
    }
  }

  const targetDuration = clamp(durationSeconds, 5, 20);
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
    download.download = `pipes-${targetDuration}s-${Date.now()}.webm`;
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
}

function setupGui() {
  const gui = new GUI();
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
    });
  targetCountController = simFolder.add(defaultSimConfig, 'targetPipeCount', 1, 64, 1).name('Pipe cap').onChange((v: number) => {
    sim.config.targetPipeCount = v;
  });
  maxLengthController = simFolder
    .add(defaultSimConfig, 'maxPipeLength', 0, 300, 1)
    .name('Max length (0=inf)')
    .onChange((v: number) => {
      const normalized = Math.max(0, Math.floor(v));
      defaultSimConfig.maxPipeLength = normalized;
      sim.config.maxPipeLength = normalized === 0 ? 0 : Math.max(4, normalized);
    });
  growthIntervalController = simFolder.add(defaultSimConfig, 'growthInterval', 0.001, 1, 0.001).name('Growth interval').onChange((v: number) => {
    sim.config.growthInterval = Math.max(0.01, v);
  });
  turnController = simFolder
    .add(turnProxy, 'turnChance', 0, 100, 1)
    .name('Turn probability %')
    .onChange((v: number) => {
      const normalized = Math.min(1, Math.max(0, v / 100));
      defaultSimConfig.turnProbability = normalized;
      sim.config.turnProbability = normalized;
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
  pipeFolder.add(renderSettings, 'pipeRadius', 0.05, 0.6, 0.01).name('Radius');
  pipeFolder.add(renderSettings, 'tubularSegments', 3, 20, 1).name('Smoothness');
  pipeFolder.add(renderSettings, 'radialSegments', 4, 32, 1).name('Radial slices');
  pipeFolder.add(renderSettings, 'colorShift', 0, 0.4, 0.005).name('Color shift');
  pipeFolder
    .add(renderSettings, 'hidePipesInMainCamera')
    .name('Hide in main camera')
    .onChange(() => {
      syncPipeVisibilityToMainCamera();
    });
  pipeFolder.add(renderSettings, 'pipeRoughness', 0, 1, 0.01).name('Roughness').onChange((v: number) => {
    pipeMaterial.roughness = v;
  });
  pipeFolder.add(renderSettings, 'pipeMetalness', 0, 1, 0.01).name('Metalness').onChange((v: number) => {
    pipeMaterial.metalness = v;
  });
  pipeFolder
    .add(renderSettings, 'cornerTension', 0, 3, 0.01)
    .name('Corner smoothness')
    .onChange(() => {
      pipeManager.forceGeometryRefresh();
    });
  pipeFolder.add(renderSettings, 'neonEnabled').name('Neon glow').onChange(() => {
    pipeManager.forceGeometryRefresh();
  });
  pipeFolder.add(renderSettings, 'neonStrength', 0, 4, 0.05).name('Neon intensity').onChange(() => {
    pipeManager.forceGeometryRefresh();
  });
  pipeFolder.add(renderSettings, 'neonSize', 0.98, 1.2, 0.005).name('Neon size').onChange(() => {
    pipeManager.forceGeometryRefresh();
  });
  pipeFolder.add(renderSettings, 'glassEnabled').name('Glass mode').onChange((enabled: boolean) => {
    renderSettings.glassEnabled = enabled;
    updatePipeMaterial(renderSettings);
  });
  pipeFolder.add(renderSettings, 'glassTransmission', 0, 1, 0.01).name('Glass transmission').onChange((v: number) => {
    renderSettings.glassTransmission = v;
    updatePipeMaterial(renderSettings);
  });
  pipeFolder.add(renderSettings, 'glassOpacity', 0, 1, 0.01).name('Glass opacity').onChange((v: number) => {
    renderSettings.glassOpacity = v;
    updatePipeMaterial(renderSettings);
  });
  pipeFolder.add(renderSettings, 'glassIor', 1, 2.5, 0.01).name('Glass IOR').onChange((v: number) => {
    renderSettings.glassIor = v;
    updatePipeMaterial(renderSettings);
  });

  const lightsFolder = gui.addFolder('Head lights');
  lightsFolder.add(renderSettings, 'headLightsEnabled').name('Enabled');
  lightsFolder.add(renderSettings, 'headLightIntensity', 0, 20, 0.1).name('Intensity');
  lightsFolder.add(renderSettings, 'headLightRange', 0, 999, 0.1).name('Range (0 = inf)');
  lightsFolder.add(renderSettings, 'maxHeadLights', 0, 32, 1).name('Cap');

  const mirrorFolder = gui.addFolder('Mirrors');
  mirrorFolder.addColor(renderSettings, 'roomColor').name('Tint').onChange((v: string) => {
    room.material.color.set(v);
    roomMirrors.update(room.size, v);
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
    });
  mirrorFolder.add(mirrorGuiSettings, 'enabled').name('Enabled').onChange((v: boolean) => {
    mirrorEnabled = v;
    roomMirrors.setEnabled(v);
  });
  mirrorFolder
    .add(mirrorGuiSettings, 'renderer', {
      Raster: 'raster',
      'Ray (experimental)': 'ray',
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
      if (mirrorRenderer === 'ray' || mirrorRenderer === 'physicalRay') {
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
      if (mirrorRenderer === 'ray' || mirrorRenderer === 'physicalRay') {
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
      if (mirrorRenderer === 'ray' || mirrorRenderer === 'physicalRay') {
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
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'blur', 0, 1, 0.01)
    .name('Radial blur')
    .onChange((v: number) => {
      mirrorBlurAmount = Math.max(0, Math.min(1, v));
      updateMirrorBlur();
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'chromaticShift', 0, 0.1, 0.0005)
    .name('Chromatic shift')
    .onChange((v: number) => {
      mirrorChromaticShift = Math.max(0, v);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'warpStrength', 0, 0.05, 0.0005)
    .name('Warp strength')
    .onChange((v: number) => {
      mirrorWarpStrength = Math.max(0, v);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'warpSpeed', 0, 5, 0.05)
    .name('Warp speed')
    .onChange((v: number) => {
      mirrorWarpSpeed = Math.max(0, v);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'refractionOffset', -0.05, 0.05, 0.0005)
    .name('Refraction offset')
    .onChange((v: number) => {
      mirrorRefractionOffset = v;
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'noiseStrength', 0, 0.01, 0.0002)
    .name('Noise shimmer')
    .onChange((v: number) => {
      mirrorNoiseStrength = Math.max(0, v);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'maxResolution', 256, 4096 * 4, 64)
    .name('Max resolution')
    .onChange((v: number) => {
      reflectorMaxRes = v;
      updateMirrorResolution();
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'facesPerFrame', 1, 6, 1)
    .name('Faces per frame')
    .onChange((v: number) => {
      mirrorFacesPerFrame = Math.max(1, Math.floor(v));
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
    });
  camLightFolder
    .add(renderSettings, 'backLightRange', 0, 420, 1)
    .name('Range (0=inf)')
    .onChange((v: number) => {
      cameraLight.distance = v;
    });
  camLightFolder.addColor(renderSettings, 'backLightColor').name('Color').onChange((v: string) => {
    cameraLight.color.set(v);
  });

  const cameraFolder = gui.addFolder('Camera');
  cameraModeController = cameraFolder
    .add(cameraControl, 'mode', ['wall', 'orbit', 'manual', 'rail'])
    .name('Mode (wall/orbit/manual/rail)')
    .onChange((mode: CameraMode) => {
      cameraControl.mode = mode;
      if (mode === 'manual' && cameraControl.distance === 0) {
        cameraControl.distance = room.size * 0.48;
      }
      if (mode === 'rail') {
        railState.phase = 0;
        railState.currentPos.copy(camera.position);
        railState.lastPos.copy(camera.position);
        railState.smoothedTarget.set(0, 0, 0);
      }
    });
  cameraFolder
    .add(cameraControl, 'wallFace', { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 })
    .name('Wall facing')
    .onChange((v: number) => {
      cameraControl.wallFace = clamp(Math.round(v), 0, 5);
    });
  orbitSpeedController = cameraFolder.add(orbitSettings, 'orbitSpeed', 0.02, 0.6, 0.01).name('Orbit speed');
  orbitBobController = cameraFolder.add(orbitSettings, 'bobStrength', 0, 0.8, 0.01).name('Bob strength');
  mouseSensController = cameraFolder.add(cameraControl, 'mouseSensitivity', 0.001, 0.02, 0.0005).name('Mouse sens');
  turnSpeedController = cameraFolder.add(cameraControl, 'turnSpeed', 0.2, 4, 0.1).name('Turn speed');
  pitchSpeedController = cameraFolder.add(cameraControl, 'pitchSpeed', 0.2, 4, 0.1).name('Pitch speed');
  const railFolder = cameraFolder.addFolder('Cinematic rail');
  railSpeedController = railFolder.add(railSettings, 'speed', 0.02, 1.2, 0.01).name('Path speed');
  railRadiusController = railFolder.add(railSettings, 'radialFactor', 0.2, 1.2, 0.01).name('Radius factor');
  railWaveController = railFolder.add(railSettings, 'verticalWave', 0, 1, 0.01).name('Vertical wave');
  railNoiseController = railFolder.add(railSettings, 'noise', 0, 0.8, 0.01).name('Noise');
  railPosSmoothController = railFolder.add(railSettings, 'posSmoothing', 0.01, 1.5, 0.01).name('Pos smooth (s)');
  railVelSmoothController = railFolder
    .add(railSettings, 'velocitySmoothing', 0.01, 1.5, 0.01)
    .name('Vel smooth (s)');
  railTargetSmoothController = railFolder
    .add(railSettings, 'targetSmoothing', 0.01, 1.5, 0.01)
    .name('Look smooth (s)');
  railLookAheadController = railFolder.add(railSettings, 'lookAhead', 0, 1, 0.01).name('Look ahead');
  railNudgeController = railFolder.add(railSettings, 'manualNudge', 0, 0.8, 0.01).name('Arrow nudge');
  railRollController = railFolder.add(railSettings, 'rollStrength', 0, 1.2, 0.01).name('Roll');
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
  });
  postFolder.add(renderSettings, 'bloomRadius', 0, 1, 0.01).name('Bloom radius').onChange((v: number) => {
    bloomPass.radius = v;
  });
  postFolder.add(renderSettings, 'bloomThreshold', 0, 1, 0.01).name('Bloom threshold').onChange((v: number) => {
    bloomPass.threshold = v;
  });
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

function cameraDistanceBounds() {
  return {
    min: Math.max(2, (sim.config.gridSize + roomPadding) * 0.3),
    max: room.size * 0.45,
  };
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
  const modes: CameraMode[] = ['wall', 'orbit', 'manual', 'rail'];
  const pickedMode = modes[randInt(0, modes.length - 1)];

  orbitSettings.orbitSpeed = rand(0.05, 0.55);
  orbitSettings.bobStrength = rand(0.04, 0.7);

  cameraControl.mouseSensitivity = rand(0.0012, 0.015);
  cameraControl.turnSpeed = rand(0.4, 3.2);
  cameraControl.pitchSpeed = rand(0.4, 3.2);
  cameraControl.yaw = rand(-Math.PI, Math.PI);
  cameraControl.pitch = clamp(rand(-0.45, 0.45), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  cameraControl.wallFace = randInt(0, 5);

  const { min, max } = cameraDistanceBounds();
  cameraControl.distance = clamp(rand(min * 0.9, max * 0.85), min, max);
  cameraControl.mode = pickedMode;

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
  mouseSensController?.setValue(cameraControl.mouseSensitivity);
  turnSpeedController?.setValue(cameraControl.turnSpeed);
  pitchSpeedController?.setValue(cameraControl.pitchSpeed);

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
  renderSettings.headLightIntensity = rand(4, 14);
  renderSettings.headLightRange = randBool(0.3) ? 0 : rand(8, 60);
  renderSettings.headLightsEnabled = randBool(0.85);
  renderSettings.maxHeadLights = randInt(4, 18);
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
const cellSize = 1;
const toWorld = (gridSize: number, cell: Vec3): Vector3 => {
  const half = gridSize / 2;
  return new Vector3(cell.x - half + 0.5, cell.y - half + 0.5, cell.z - half + 0.5).multiplyScalar(cellSize);
};

class PipeVisual {
  mesh: Mesh;
  glow?: Mesh;
  glowMaterial?: MeshBasicMaterial;
  light: PointLight;
  headColor = new Color();
  private lastVersion = -1;
  private lastRadius = renderSettings.pipeRadius;
  private lastSegments = renderSettings.tubularSegments;
  private lastColorShift = renderSettings.colorShift;
  private lastRadialSegments = renderSettings.radialSegments;
  private lastCornerTension = renderSettings.cornerTension;
  private material: MeshPhysicalMaterial;
  private gridSize: number;

  constructor(material: MeshPhysicalMaterial, gridSize: number, pipe: Pipe, settings: RenderSettings) {
    this.material = material;
    this.gridSize = gridSize;
    this.mesh = new Mesh(undefined, this.material);
    this.mesh.layers.set(PIPE_LAYER);
    this.glow = undefined;
    this.glowMaterial = undefined;
    this.light = new PointLight(0xffffff, 0, 0, 2);
    this.light.castShadow = false;
    this.light.visible = false;
    this.light.layers.set(PIPE_LAYER);
    this.update(pipe, settings, false);
  }

  update(pipe: Pipe, settings: RenderSettings, headLightOn: boolean): void {
    const needsGeometry =
      pipe.version !== this.lastVersion ||
      settings.pipeRadius !== this.lastRadius ||
      settings.tubularSegments !== this.lastSegments ||
      settings.colorShift !== this.lastColorShift ||
      settings.radialSegments !== this.lastRadialSegments ||
      settings.cornerTension !== this.lastCornerTension;

    if (needsGeometry) {
      this.mesh.geometry?.dispose();
      this.mesh.geometry = createPipeGeometry(pipe, this.gridSize, settings, this.headColor);
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
    }

    const headPos = toWorld(this.gridSize, pipe.head);
    if (pipe.headLerp < 1 && pipe.cells.length > 1) {
      const prev = toWorld(this.gridSize, pipe.prevHead);
      headPos.lerpVectors(prev, headPos, pipe.headLerp);
    }

    this.light.visible = headLightOn;
    if (headLightOn) {
      this.light.intensity = settings.headLightIntensity;
      this.light.distance = settings.headLightRange;
      this.light.decay = 1.2;
      this.light.color.copy(this.headColor);
    } else {
      this.light.intensity = 0;
    }
    this.light.position.copy(headPos);

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
  private headLightIds = new Set<number>();
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
        this.scene.remove(visual.mesh, visual.light);
        if (visual.glow) this.scene.remove(visual.glow);
        visual.dispose();
        this.visuals.delete(id);
      }
    }

    const sortedByBirth = [...pipes].sort((a, b) => b.birthIndex - a.birthIndex).slice(0, settings.maxHeadLights);
    this.headLightIds = new Set(sortedByBirth.map((p) => p.id));

    for (const pipe of pipes) {
      let visual = this.visuals.get(pipe.id);
      if (!visual) {
        visual = new PipeVisual(this.material, this.gridSize, pipe, settings);
        this.visuals.set(pipe.id, visual);
        this.scene.add(visual.mesh, visual.light);
        const glow = visual.glow;
        if (glow) this.scene.add(glow);
      }
      const hasHeadLight = settings.headLightsEnabled && this.headLightIds.has(pipe.id);
      visual.update(pipe, settings, hasHeadLight);
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

function createPipeGeometry(pipe: Pipe, gridSize: number, settings: RenderSettings, headColor: Color) {
  const path = pipe.cells.map((cell) => toWorld(gridSize, cell));
  if (pipe.headLerp < 1 && pipe.cells.length > 1) {
    const last = path.length - 1;
    const prev = toWorld(gridSize, pipe.prevHead);
    path[last] = prev.clone().lerp(path[last], pipe.headLerp);
  }
  if (path.length === 1) path.push(path[0].clone().add(new Vector3(0.001, 0.001, 0.001)));

  const curve = new CatmullRomCurve3(path, false, 'catmullrom', settings.cornerTension);
  const tubularSegments = Math.max(6, Math.floor(settings.tubularSegments * path.length));
  const geometry = new TubeGeometry(curve, tubularSegments, settings.pipeRadius, settings.radialSegments, false);

  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  let maxV = -Infinity;

  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const v = uv.getY(i); // 0..1 along tube length
    const hue = pipe.colorSeed + settings.colorShift * (v - 0.5);
    const light = clamp(0.35, 0.9, 0.58 + 0.12 * (v - 0.5));
    const c = new Color().setHSL(hue - Math.floor(hue), 0.65, light);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    if (v >= maxV) {
      headColor.copy(c);
      maxV = v;
    }
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

pipeManager = new PipeVisualManager(scene, pipeMaterial, defaultSimConfig.gridSize);
requestAnimationFrame(frame);
setupGui();

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
