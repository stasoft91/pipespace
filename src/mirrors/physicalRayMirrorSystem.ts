import { DoubleSide, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { MirrorDistortionUniforms, MirrorSystem } from './types';

type MirrorUniformBag = {
  blurAmount?: { value: number };
  chromaticShift?: { value: number };
  warpStrength?: { value: number };
  warpSpeed?: { value: number };
  refractionOffset?: { value: number };
  noiseStrength?: { value: number };
  time?: { value: number };
  surfaceIntensity?: { value: number };
};

type PhysicalRayMirrorSystemOptions = {
  scene: Scene;
  roomMesh: Mesh;
  pipeLayer: number;
  baseShader: any;
  size: number;
  color: string;
  inset: number;
  resolution: { width: number; height: number };
  distortion: MirrorDistortionUniforms;
  enabled: boolean;
  maxBounces: number;
  bounceAttenuation?: number;
  bounceAttenuationMode?: 'skipFirst' | 'allBounces';
};

/**
  * Physically faithful mirror solver: we mirror the current camera through every
  * face, recurse into that virtual camera, then resolve the face. This walks the
  * full bounce tree (up to maxBounces) instead of pairing faces, prioritizing
  * correctness over performance.
  */
export class PhysicalRayMirrorSystem implements MirrorSystem {
  private scene: Scene;
  private roomMesh: Mesh;
  private pipeLayer: number;
  private baseShader: any;
  private maxBounces: number;
  private bounceAttenuation: number;
  private bounceAttenuationMode: 'skipFirst' | 'allBounces';

  private facesList: Reflector[] = [];
  private mirrorUniforms = new Map<number, MirrorUniformBag>();
  private updateMask = new Set<number>();
  private size: number;
  private color: string;
  private inset: number;
  private resolution: { width: number; height: number };
  private distortion: MirrorDistortionUniforms;
  private enabled: boolean;
  private baseRenders: Array<
    (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, geometry?: any, material?: any, group?: any) => void
  > = [];
  private tmpMirrorPos = new Vector3();
  private tmpCameraPos = new Vector3();
  private tmpNormal = new Vector3();
  private tmpRotation = new Matrix4();
  private tmpView = new Vector3();
  private tmpLookAt = new Vector3();
  private tmpTarget = new Vector3();
  private tmpRayOrigin = new Vector3();
  private tmpRayDir = new Vector3();
  private tmpRayDelta = new Vector3();

  private faceNormals: Vector3[] = [];
  private faceCenters: Vector3[] = [];

  constructor(opts: PhysicalRayMirrorSystemOptions) {
    this.scene = opts.scene;
    this.roomMesh = opts.roomMesh;
    this.pipeLayer = opts.pipeLayer;
    this.baseShader = opts.baseShader;
    this.maxBounces = Math.max(1, Math.floor(opts.maxBounces));
    this.bounceAttenuation = Math.max(0, opts.bounceAttenuation ?? 0.65);
    this.bounceAttenuationMode = opts.bounceAttenuationMode ?? 'skipFirst';

    this.size = opts.size;
    this.color = opts.color;
    this.inset = opts.inset;
    this.resolution = opts.resolution;
    this.distortion = opts.distortion;
    this.enabled = opts.enabled;

    this.facesList = this.buildMirrors(this.size, this.color);
    this.addFaces(this.facesList);
    this.applyDistortionUniforms();
    this.applyEnabledState();
  }

  get faces(): Reflector[] {
    return this.facesList;
  }

  setInset(inset: number) {
    this.inset = inset;
  }

  update(size: number, color: string) {
    this.size = size;
    this.color = color;
    this.mirrorUniforms.clear();
    this.disposeFaces(this.facesList);
    this.facesList = this.buildMirrors(this.size, this.color);
    this.addFaces(this.facesList);
    this.applyDistortionUniforms();
    this.applyEnabledState();
  }

  setResolution(width: number, height: number) {
    this.resolution = { width, height };
    for (const face of this.facesList) {
      const target = (face as unknown as { getRenderTarget?: () => { setSize: (w: number, h: number) => void } }).getRenderTarget?.();
      target?.setSize(width, height);
    }
  }

  setBlur(amount: number) {
    this.distortion.blur = amount;
    this.applyDistortionUniforms();
  }

  setDistortion(u: MirrorDistortionUniforms) {
    this.distortion = { ...u };
    this.applyDistortionUniforms();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    this.applyEnabledState();
  }

  setUpdateMask(mask: Set<number>) {
    this.updateMask = mask;
  }

  updateFrame(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    if (!this.enabled || this.facesList.length === 0) return;

    const indices = this.updateMask.size > 0 ? Array.from(this.updateMask.values()) : this.facesList.map((_, i) => i);
    if (indices.length === 0) return;

    const baseExposure = renderer.toneMappingExposure ?? 1;
    const roomVisible = this.roomMesh.visible;

    this.roomMesh.visible = false; // mirrored cameras leave the box; hide the shell
    camera.updateMatrixWorld();

    this.renderRecursive(renderer, scene, camera, indices, this.maxBounces, 0, baseExposure);

    renderer.toneMappingExposure = baseExposure;
    this.roomMesh.visible = roomVisible;
  }

  dispose() {
    this.disposeFaces(this.facesList);
    this.facesList = [];
    this.mirrorUniforms.clear();
    this.baseRenders = [];
  }

  private renderRecursive(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    indices: number[],
    remainingBounces: number,
    depth: number,
    baseExposure: number
  ) {
    if (remainingBounces <= 0) return;

    for (const idx of indices) {
      const mirror = this.facesList[idx];
      const render = this.baseRenders[idx];
      if (!mirror || !render) continue;

      mirror.forceUpdate = true; // allow captures even when backfacing during recursion
      const virtualCamera = this.prepareMirrorCamera(mirror, camera);
      if (!virtualCamera) {
        mirror.forceUpdate = false;
        continue;
      }

      const nextFace = this.pickNextFace(virtualCamera, indices, idx);
      if (nextFace >= 0) {
        // Resolve what this mirror sees through the next face in the bounce chain.
        this.renderRecursive(renderer, scene, virtualCamera, [nextFace], remainingBounces - 1, depth + 1, baseExposure);
      }

      const prevExposure = renderer.toneMappingExposure;
      const exp = this.bounceAttenuationMode === 'allBounces' ? depth + 1 : Math.max(1, depth);
      const atten = Math.pow(this.bounceAttenuation, exp);
      renderer.toneMappingExposure = baseExposure * atten;
      render(renderer, scene, camera);
      renderer.toneMappingExposure = prevExposure;
      mirror.forceUpdate = false;
    }
  }

  private prepareMirrorCamera(mirror: Reflector, sourceCamera: PerspectiveCamera): PerspectiveCamera | null {
    // Mirrors can move if the room is resized, so recompute matrices every bounce.
    mirror.updateMatrixWorld();
    sourceCamera.updateMatrixWorld();

    const reflectorWorldPosition = this.tmpMirrorPos;
    const cameraWorldPosition = this.tmpCameraPos;
    const rotationMatrix = this.tmpRotation;
    const normal = this.tmpNormal;
    const view = this.tmpView;
    const target = this.tmpTarget;
    const lookAtPosition = this.tmpLookAt;

    reflectorWorldPosition.setFromMatrixPosition(mirror.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(sourceCamera.matrixWorld);

    rotationMatrix.extractRotation(mirror.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rotationMatrix);

    view.subVectors(reflectorWorldPosition, cameraWorldPosition);
    const facingAway = view.dot(normal) > 0;
    if (facingAway && mirror.forceUpdate === false) {
      return null;
    }

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(sourceCamera.matrixWorld);
    lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix);
    lookAtPosition.add(cameraWorldPosition);

    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    const virtualCamera = mirror.camera as PerspectiveCamera;
    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0);
    virtualCamera.up.applyMatrix4(rotationMatrix);
    virtualCamera.up.reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.near = sourceCamera.near;
    virtualCamera.far = sourceCamera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(sourceCamera.projectionMatrix);
    return virtualCamera;
  }

  private pickNextFace(camera: PerspectiveCamera, indices: number[], avoidIdx: number): number {
    if (indices.length === 0) return -1;

    camera.updateMatrixWorld();
    const origin = this.tmpRayOrigin;
    origin.setFromMatrixPosition(camera.matrixWorld);
    const dir = this.tmpRayDir;
    camera.getWorldDirection(dir);

    let best = -1;
    let bestDist = Infinity;
    const eps = 1e-4;

    for (const idx of indices) {
      if (idx === avoidIdx) continue;
      const normal = this.faceNormals[idx];
      const center = this.faceCenters[idx];
      if (!normal || !center) continue;
      const denom = dir.dot(normal);
      if (Math.abs(denom) < eps) continue;
      this.tmpRayDelta.copy(center).sub(origin);
      const dist = this.tmpRayDelta.dot(normal) / denom;
      if (dist <= eps) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }

    return best;
  }

  private applyEnabledState() {
    this.facesList.forEach((f) => {
      f.visible = this.enabled;
      f.matrixWorldNeedsUpdate = true;
    });
    this.roomMesh.visible = this.enabled;
  }

  private applyDistortionUniforms() {
    const intensity = this.computeSurfaceIntensity();
    for (const uniforms of this.mirrorUniforms.values()) {
      if (uniforms.blurAmount) uniforms.blurAmount.value = this.distortion.blur;
      if (uniforms.chromaticShift) uniforms.chromaticShift.value = this.distortion.chromaticShift;
      if (uniforms.warpStrength) uniforms.warpStrength.value = this.distortion.warpStrength;
      if (uniforms.warpSpeed) uniforms.warpSpeed.value = this.distortion.warpSpeed;
      if (uniforms.refractionOffset) uniforms.refractionOffset.value = this.distortion.refractionOffset;
      if (uniforms.noiseStrength) uniforms.noiseStrength.value = this.distortion.noiseStrength;
      if (uniforms.time) uniforms.time.value = this.distortion.time;
      if (uniforms.surfaceIntensity) uniforms.surfaceIntensity.value = intensity;
    }
  }

  private addFaces(list: Reflector[]) {
    list.forEach((f) => this.scene.add(f));
  }

  private disposeFaces(list: Reflector[]) {
    for (const face of list) {
      this.scene.remove(face);
      const target = (face as unknown as { getRenderTarget?: () => any }).getRenderTarget?.();
      target?.dispose?.();
      face.geometry.dispose();
      (face.material as any)?.dispose?.();
    }
  }

  private buildMirrors(size: number, color: string): Reflector[] {
    this.baseRenders = [];
    this.faceNormals = [];
    this.faceCenters = [];
    const half = size / 2 - this.inset;
    return [
      this.makeFace(new Vector3(half, 0, 0), (m) => m.rotateY(-Math.PI / 2), size, color, 0), // +X
      this.makeFace(new Vector3(-half, 0, 0), (m) => m.rotateY(Math.PI / 2), size, color, 1), // -X
      this.makeFace(new Vector3(0, half, 0), (m) => m.rotateX(Math.PI / 2), size, color, 2), // +Y
      this.makeFace(new Vector3(0, -half, 0), (m) => m.rotateX(-Math.PI / 2), size, color, 3), // -Y
      this.makeFace(new Vector3(0, 0, half), (m) => m.rotateY(Math.PI), size, color, 4), // +Z
      this.makeFace(new Vector3(0, 0, -half), (m) => m.rotateY(0), size, color, 5), // -Z
    ];
  }

  private makeFace(
    position: Vector3,
    rotate: (mirror: Reflector) => void,
    faceSize: number,
    faceColor: string,
    faceIndex: number
  ) {
    const mirrorShader = {
      ...this.baseShader,
      uniforms: {
        ...this.baseShader.uniforms,
        blurAmount: { value: this.distortion.blur },
        chromaticShift: { value: this.distortion.chromaticShift },
        warpStrength: { value: this.distortion.warpStrength },
        warpSpeed: { value: this.distortion.warpSpeed },
        refractionOffset: { value: this.distortion.refractionOffset },
        noiseStrength: { value: this.distortion.noiseStrength },
        time: { value: this.distortion.time ?? 0 },
        surfaceIntensity: { value: this.computeSurfaceIntensity() },
      },
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform float surfaceIntensity;
        varying vec4 vUv;

        #include <logdepthbuf_pars_fragment>

        float blendOverlay( float base, float blend ) {
          return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
        }

        vec3 blendOverlay( vec3 base, vec3 blend ) {
          return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec4 base = texture2DProj( tDiffuse, vUv );
          base.rgb *= surfaceIntensity;
          base.rgb = clamp(base.rgb * 0.5, 0.0, 1.5);
          gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    };

    const mirror = new Reflector(new PlaneGeometry(faceSize, faceSize), {
      clipBias: 0,
      textureWidth: this.resolution.width,
      textureHeight: this.resolution.height,
      color: faceColor,
      shader: mirrorShader,
    });
    (mirror.material as any).side = DoubleSide;
    mirror.frustumCulled = false;
    mirror.camera.layers.enable(this.pipeLayer);

    const baseRender = mirror.onBeforeRender.bind(mirror);
    mirror.onBeforeRender = () => {};
    this.baseRenders[faceIndex] = (
      renderer: WebGLRenderer,
      scene: Scene,
      camera: PerspectiveCamera,
      geometry?: any,
      material?: any,
      group?: any
    ) => {
      if (!this.enabled) return;
      baseRender(renderer, scene, camera, geometry, material, group);
    };

    mirror.position.copy(position);
    rotate(mirror);
    this.faceNormals[faceIndex] = new Vector3(0, 0, 1).applyQuaternion(mirror.quaternion).normalize();
    this.faceCenters[faceIndex] = mirror.position.clone();
    this.mirrorUniforms.set(faceIndex, (mirror.material as any).uniforms ?? {});
    return mirror;
  }

  private computeSurfaceIntensity() {
    return Math.max(0, this.bounceAttenuation);
  }
}
