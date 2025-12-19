import type { PerspectiveCamera, Scene } from 'three';
import type { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export type MirrorReflectionMode = 'none' | 'cameraFacing' | 'all';

export type MirrorDistortionUniforms = {
  warpStrength: number;
  time: number;
};

export type MirrorSystem = {
  readonly faces: Reflector[];
  update: (size: number, color: string) => void;
  setResolution: (width: number, height: number) => void;
  setDistortion: (u: MirrorDistortionUniforms) => void;
  setEnabled: (enabled: boolean) => void;
  setUpdateMask: (mask: Set<number>) => void;
  setInset: (inset: number) => void;
  updateFrame?: (renderer: any, scene: any, camera: any) => void;
  dispose: () => void;
};

export type MirrorSystemDeps = {
  scene: Scene;
  camera: PerspectiveCamera;
};
