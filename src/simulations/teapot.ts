import { Color, DoubleSide, Mesh, MeshPhysicalMaterial, Vector3 } from 'three';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';

export type TeapotVisual = {
  readonly mesh: Mesh;
  setVisible: (visible: boolean) => void;
  /**
   * Scales the teapot so its largest dimension is `roomSize * sizeFactor`.
   */
  syncToRoom: (roomSize: number) => void;
  /**
   * Convenience hook so existing "pipe material" controls can drive the teapot too.
   */
  setMaterial: (params: { metalness: number; roughness: number }) => void;
  dispose: () => void;
};

export function createTeapotVisual(
  layer: number,
  initialRoomSize: number,
  opts: { sizeFactor?: number } = {}
): TeapotVisual {
  const sizeFactor = Number.isFinite(opts.sizeFactor) ? (opts.sizeFactor as number) : 0.5;

  // Keep the source geometry normalized so we can scale to "half the room side" precisely.
  const geometry = new TeapotGeometry(1, 18, true, true, true, true, true);
  geometry.computeBoundingBox();

  const tmpSize = new Vector3();
  const bbox = geometry.boundingBox;
  const size = bbox ? bbox.getSize(tmpSize) : tmpSize.set(1, 1, 1);
  const baseMaxDim = Math.max(1e-6, size.x, size.y, size.z);

  geometry.center();

  const material = new MeshPhysicalMaterial({
    color: new Color('#bfc3c7'),
    metalness: 1,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.layers.set(layer);
  mesh.frustumCulled = false;

  const syncToRoom = (roomSize: number) => {
    const safeRoom = Number.isFinite(roomSize) ? roomSize : 0;
    const target = safeRoom * sizeFactor;
    mesh.scale.setScalar(target / baseMaxDim);
  };

  const setMaterial = (params: { metalness: number; roughness: number }) => {
    material.metalness = clamp01(params.metalness);
    material.roughness = clamp01(params.roughness);
    material.needsUpdate = true;
  };

  syncToRoom(initialRoomSize);

  return {
    mesh,
    setVisible: (visible) => {
      mesh.visible = visible;
    },
    syncToRoom,
    setMaterial,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}


