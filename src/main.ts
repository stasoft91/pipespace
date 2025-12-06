import './style.css';
import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  EdgesGeometry,
  AdditiveBlending,
  PlaneGeometry,
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
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { Pipe, Simulation } from './simulation';
import type { SimulationConfig, Vec3 } from './simulation';

type RenderSettings = {
  pipeRadius: number;
  tubularSegments: number;
  radialSegments: number;
  colorShift: number;
  headLightIntensity: number;
  headLightRange: number;
  headLightsEnabled: boolean;
  maxHeadLights: number;
  roomRoughness: number;
  roomMetalness: number;
  roomReflectivity: number;
  roomColor: string;
  showGrid: boolean;
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

type CameraMode = 'orbit' | 'manual';

const ROOM_PADDING = 20; // gap between grid extents and room walls
let mirrorInset = 20.01;
let reflectorResScale = 1;
let reflectorMaxRes = 4096;
let mirrorFacesPerFrame = 6; // how many faces update each frame (reduces flicker/load)
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
  pipeRadius: 0.05,
  tubularSegments: 7,
  radialSegments: 10,
  colorShift: 0.1,
  headLightIntensity: 8,
  headLightRange: 0, // 0 = infinite distance in three.js
  headLightsEnabled: false,
  maxHeadLights: 8,
  roomRoughness: 0.25,
  roomMetalness: 0.75,
  roomReflectivity: 1,
  roomColor: '#000000',
  showGrid: false,
  pipeMetalness: 0.18,
  pipeRoughness: 0.3,
  glassEnabled: false,
  glassTransmission: 0.65,
  glassOpacity: 0.35,
  glassIor: 1.2,
  cornerTension: 0,
  neonEnabled: true,
  neonStrength: 2.0,
  neonSize: 1.0,
  bloomStrength: 2,
  bloomRadius: 1,
  bloomThreshold: 0,
};

const mirrorGuiSettings = {
  inset: mirrorInset,
  resolutionScale: reflectorResScale,
  maxResolution: reflectorMaxRes,
  facesPerFrame: mirrorFacesPerFrame,
};

const orbitSettings: OrbitSettings = {
  orbitSpeed: 0.42,
  bobStrength: 0.42,
};

const cameraControl = {
  mode: 'orbit' as CameraMode,
  yaw: 0,
  pitch: 0.2,
  distance: 0,
  turnSpeed: 1.8,
  pitchSpeed: 1.4,
  mouseSensitivity: 0.0035,
  zoomSpeed: 0.9,
};

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

const room = createRoom(defaultSimConfig.gridSize, renderSettings);
scene.add(room.mesh);
let roomMirrors = createRoomMirrors(room.size, renderSettings.roomColor);

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
let frameIndex = 0;
let mirrorUpdateOffset = 0;
let mirrorUpdateMask = new Set<number>();

function mirrorTargetSize() {
  const { innerWidth, innerHeight } = window;
  const pixelRatio = renderer.getPixelRatio();
  return {
    w: Math.min(reflectorMaxRes, innerWidth * pixelRatio * reflectorResScale),
    h: Math.min(reflectorMaxRes, innerHeight * pixelRatio * reflectorResScale),
  };
}

function updateMirrorResolution() {
  const { w, h } = mirrorTargetSize();
  roomMirrors.setResolution(w, h);
}

function updateMirrorMask() {
  const faces = roomMirrors.faces.length;
  mirrorUpdateMask = new Set<number>();
  const count = Math.max(1, Math.min(faces, mirrorFacesPerFrame));
  for (let i = 0; i < count; i++) {
    mirrorUpdateMask.add((mirrorUpdateOffset + i) % faces);
  }
  mirrorUpdateOffset = (mirrorUpdateOffset + count) % faces;
  roomMirrors.setUpdateMask(mirrorUpdateMask);
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
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  state.elapsed += dt;
  state.fpsSmoothed = state.fpsSmoothed * 0.9 + (1 / dt) * 0.1;
  frameIndex++;
  updateMirrorMask();

  if (!state.paused) {
    const allStuck = sim.update(dt);
    if (allStuck) {
      state.paused = true;
    }
  }

  const orbitRadius = room.size * 0.4;
  if (cameraControl.mode === 'orbit') {
    const orbitPhase = now * 0.001 * orbitSettings.orbitSpeed;
    const bob = Math.sin(now * 0.0007) * orbitSettings.bobStrength;
    camera.position.set(
      Math.cos(orbitPhase) * orbitRadius,
      orbitRadius * 0.22 + bob * orbitRadius,
      Math.sin(orbitPhase) * orbitRadius
    );
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
  camera.lookAt(0, 0, 0);

  pipeManager.sync(sim.pipes, renderSettings);
  updateInfo(sim, state);

  composer.render();
  requestAnimationFrame(frame);
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
  growthIntervalController = simFolder.add(defaultSimConfig, 'growthInterval', 0.01, 0.6, 0.01).name('Growth interval').onChange((v: number) => {
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

  const pipeFolder = gui.addFolder('Pipes');
  pipeFolder.add(renderSettings, 'pipeRadius', 0.05, 0.6, 0.01).name('Radius');
  pipeFolder.add(renderSettings, 'tubularSegments', 3, 20, 1).name('Smoothness');
  pipeFolder.add(renderSettings, 'radialSegments', 4, 32, 1).name('Radial slices');
  pipeFolder.add(renderSettings, 'colorShift', 0, 0.6, 0.01).name('Color shift');
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
    .add(mirrorGuiSettings, 'inset', 0.01, 20, 0.01)
    .name('Wall inset')
    .onChange((v: number) => {
      mirrorInset = Math.max(0, v);
      roomMirrors.update(room.size, renderSettings.roomColor);
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'resolutionScale', 0.1, 1, 0.01)
    .name('Resolution scale')
    .onChange((v: number) => {
      reflectorResScale = v;
      updateMirrorResolution();
    });
  mirrorFolder
    .add(mirrorGuiSettings, 'maxResolution', 256, 4096, 64)
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
  mirrorFolder.add(renderSettings, 'showGrid').name('Show grid').onChange((visible: boolean) => {
    gridLines.visible = visible;
  });

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder
    .add(cameraControl, 'mode', ['orbit', 'manual'])
    .name('Mode (orbit/manual)')
    .onChange((mode: CameraMode) => {
      cameraControl.mode = mode;
      if (mode === 'manual' && cameraControl.distance === 0) {
        cameraControl.distance = room.size * 0.48;
      }
    });
  cameraFolder.add(orbitSettings, 'orbitSpeed', 0.02, 0.6, 0.01).name('Orbit speed');
  cameraFolder.add(orbitSettings, 'bobStrength', 0, 0.8, 0.01).name('Bob strength');
  cameraFolder.add(cameraControl, 'mouseSensitivity', 0.001, 0.02, 0.0005).name('Mouse sens');
  cameraFolder.add(cameraControl, 'turnSpeed', 0.2, 4, 0.1).name('Turn speed');
  cameraFolder.add(cameraControl, 'pitchSpeed', 0.2, 4, 0.1).name('Pitch speed');

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

function cameraDistanceBounds() {
  return {
    min: Math.max(2, (sim.config.gridSize + ROOM_PADDING) * 0.3),
    max: room.size * 0.45,
  };
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
  let currentSize = gridSize + ROOM_PADDING * 2;
  const geom = new BoxGeometry(currentSize, currentSize, currentSize);
  const mat = new MeshPhysicalMaterial({
    color: new Color(settings.roomColor),
    roughness: settings.roomRoughness,
    metalness: settings.roomMetalness,
    reflectivity: settings.roomReflectivity,
    clearcoat: 1,
    clearcoatRoughness: 0,
    side: BackSide,
  });
  const mesh = new Mesh(geom, mat);

  const updateSize = (newGridSize: number, rs: RenderSettings) => {
    currentSize = newGridSize + ROOM_PADDING * 2;
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

type RoomMirrors = {
  faces: Reflector[];
  update: (size: number, color: string) => void;
  setResolution: (width: number, height: number) => void;
  setUpdateMask: (mask: Set<number>) => void;
  dispose: () => void;
};

function createRoomMirrors(size: number, color: string): RoomMirrors {
  let updateMask = new Set<number>();

  // keep a live reference so onBeforeRender can hide peer mirrors during capture
  let faces: Reflector[] = [];

  const makeFace = (
    position: Vector3,
    rotate: (mirror: Reflector) => void,
    faceSize: number,
    faceColor: string,
    faceIndex: number
  ) => {
    const mirror = new Reflector(new PlaneGeometry(faceSize, faceSize), {
      clipBias: 0,
      textureWidth: Math.min(reflectorMaxRes, window.innerWidth * renderer.getPixelRatio() * reflectorResScale),
      textureHeight: Math.min(reflectorMaxRes, window.innerHeight * renderer.getPixelRatio() * reflectorResScale),
      color: faceColor,
    });
    const baseRender = mirror.onBeforeRender.bind(mirror);
    mirror.onBeforeRender = (...args) => {
      if (!updateMask.has(faceIndex)) return;
       // prevent mirrors from reflecting each other; hide peers during this capture
      const prevVisible = faces.map((f) => f.visible);
      faces.forEach((f, i) => {
        if (i !== faceIndex) f.visible = false;
      });
      baseRender(...args);
      faces.forEach((f, i) => {
        f.visible = prevVisible[i];
      });
    };
    mirror.position.copy(position);
    rotate(mirror);
    return mirror;
  };

  const buildMirrors = (nextSize: number, nextColor: string) => {
    const half = nextSize / 2 - mirrorInset;
    return [
      makeFace(new Vector3(half, 0, 0), (m) => m.rotateY(-Math.PI / 2), nextSize, nextColor, 0), // +X
      makeFace(new Vector3(-half, 0, 0), (m) => m.rotateY(Math.PI / 2), nextSize, nextColor, 1), // -X
      makeFace(new Vector3(0, half, 0), (m) => m.rotateX(Math.PI / 2), nextSize, nextColor, 2), // +Y
      makeFace(new Vector3(0, -half, 0), (m) => m.rotateX(-Math.PI / 2), nextSize, nextColor, 3), // -Y
      makeFace(new Vector3(0, 0, half), (m) => m.rotateY(Math.PI), nextSize, nextColor, 4), // +Z
      makeFace(new Vector3(0, 0, -half), (m) => m.rotateY(0), nextSize, nextColor, 5), // -Z
    ];
  };

  faces = buildMirrors(size, color);
  const addFaces = (list: Reflector[]) => list.forEach((f) => scene.add(f));
  const disposeFaces = (list: Reflector[]) => {
    for (const face of list) {
      scene.remove(face);
      const target = (face as unknown as { getRenderTarget?: () => any }).getRenderTarget?.();
      target?.dispose?.();
      face.geometry.dispose();
      (face.material as any)?.dispose?.();
    }
  };

  addFaces(faces);

  return {
    get faces() {
      return faces;
    },
    update: (nextSize: number, nextColor: string) => {
      disposeFaces(faces);
      faces = buildMirrors(nextSize, nextColor);
      addFaces(faces);
    },
    setResolution: (width: number, height: number) => {
      for (const face of faces) {
        const target = (face as unknown as { getRenderTarget?: () => { setSize: (w: number, h: number) => void } }).getRenderTarget?.();
        target?.setSize(width, height);
      }
    },
    setUpdateMask: (mask: Set<number>) => {
      updateMask = mask;
    },
    dispose: () => {
      disposeFaces(faces);
      faces = [];
    },
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
    this.glow = undefined;
    this.glowMaterial = undefined;
    this.light = new PointLight(0xffffff, 0, 0, 2);
    this.light.castShadow = false;
    this.light.visible = false;
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
  const baseColor = new Color().setHSL(pipe.colorSeed, 0.65, 0.58);
  let maxV = -Infinity;

  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const v = uv.getY(i);
    const c = baseColor.clone();
    c.offsetHSL(settings.colorShift * (v - 0.5), 0, 0.08 * (v - 0.5));
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
