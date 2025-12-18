import type { LfoConfig } from './modulation';
import type { SimulationConfig } from './simulation';
import type { MirrorReflectionMode } from './mirrors/types';

export const PROJECT_VERSION = 1 as const;

export type ProjectLfo = {
  segmentId: string;
  lfo: Partial<LfoConfig>;
};

export type ProjectTimeline = {
  bpm: number;
  durationSeconds: number;
  audioFileName: string | null;
  lfos: ProjectLfo[];
};

export type ProjectRenderSettings = {
  pathType: 'polyline' | 'catmullrom' | 'centripetal' | 'chordal';
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
  bloomResolutionScale: number;
};

export type ProjectMirrorSettings = {
  inset: number;
  resolutionScale: number;
  maxResolution: number;
  facesPerFrame: number;
  enabled: boolean;
  renderer: 'raster' | 'ray' | 'rayAllFaces' | 'physicalRay';
  rayBounces: number;
  reflectionMode: MirrorReflectionMode;
  blur: number;
  chromaticShift: number;
  warpStrength: number;
  warpSpeed: number;
  refractionOffset: number;
  noiseStrength: number;
  bounceAttenuation: number;
  bounceAttenuationMode: 'skipFirst' | 'allBounces';
};

export type ProjectCameraControl = {
  mode: 'wall' | 'wallDrift' | 'orbit' | 'manual' | 'rail';
  wallFace: number;
  yaw: number;
  pitch: number;
  distance: number;
  zoomFactor: number;
  turnSpeed: number;
  pitchSpeed: number;
  mouseSensitivity: number;
  zoomSpeed: number;
};

export type ProjectOrbitSettings = {
  orbitSpeed: number;
  bobStrength: number;
};

export type ProjectWallDriftSettings = {
  movement: number;
  bobStrength: number;
};

export type ProjectRailSettings = {
  speed: number;
  radialFactor: number;
  verticalWave: number;
  noise: number;
  posSmoothing: number;
  targetSmoothing: number;
  velocitySmoothing: number;
  lookAhead: number;
  manualNudge: number;
  rollStrength: number;
};

export type ProjectSettings = {
  simConfig: SimulationConfig;
  renderSettings: ProjectRenderSettings;
  roomPadding: number;
  mirror: ProjectMirrorSettings;
  camera: ProjectCameraControl;
  orbit: ProjectOrbitSettings;
  wallDrift: ProjectWallDriftSettings;
  rail: ProjectRailSettings;
};

export type ProjectFile = {
  version: typeof PROJECT_VERSION;
  savedAt: string;
  name?: string;
  timeline: ProjectTimeline;
  settings: ProjectSettings;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseProjectFile(jsonText: string): ProjectFile {
  const data = JSON.parse(jsonText) as unknown;
  if (!isRecord(data)) throw new Error('Project JSON must be an object');
  if (data.version !== PROJECT_VERSION) throw new Error(`Unsupported project version: ${String(data.version)}`);
  if (!isRecord(data.timeline)) throw new Error('Missing timeline');
  if (!isRecord(data.settings)) throw new Error('Missing settings');
  return data as ProjectFile;
}

export function stringifyProjectFile(project: ProjectFile): string {
  return JSON.stringify(project, null, 2);
}
