import { DoubleSide, Matrix4, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { MirrorDistortionUniforms, MirrorSystem } from './types';

type MirrorUniformBag = {
  warpStrength?: { value: number };
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
  showRoomMesh?: boolean;
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
  private showRoomMesh: boolean;

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
  private hasMainViewCapture: boolean[] = [];
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
  private tmpCamDir = new Vector3();
  private tmpToCenter = new Vector3();

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
    this.showRoomMesh = opts.showRoomMesh ?? true;

    this.size = opts.size;
    this.color = opts.color;
    this.inset = opts.inset;
    this.resolution = opts.resolution;
    this.distortion = opts.distortion;
    this.enabled = opts.enabled;

    this.facesList = this.buildMirrors(this.size, this.color);
    this.addFaces(this.facesList);
    this.hasMainViewCapture = new Array(this.facesList.length).fill(false);
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
    this.hasMainViewCapture = new Array(this.facesList.length).fill(false);
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
    // Empty mask is an explicit "none" mode from the UI: render a single non-recursive pass
    // for every face so reflections still exist but mirrors don't recurse into each other.
    if (this.updateMask.size === 0) {
      const baseExposure = renderer.toneMappingExposure ?? 1;
      const baseExposureScaled = baseExposure * 0.4;
      const roomVisible = this.roomMesh.visible;

      this.roomMesh.visible = false;
      camera.updateMatrixWorld();
      renderer.toneMappingExposure = baseExposureScaled;
      for (let idx = 0; idx < this.facesList.length; idx++) {
        const mirror = this.facesList[idx];
        const render = this.baseRenders[idx];
        if (!mirror || !render) continue;
        mirror.forceUpdate = true;
        render(renderer, scene, camera);
        mirror.forceUpdate = false;
        this.hasMainViewCapture[idx] = true;
      }

      renderer.toneMappingExposure = baseExposure;
      this.roomMesh.visible = roomVisible;
      return;
    }

    const indices = Array.from(this.updateMask.values()).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < this.facesList.length
    );
    if (indices.length === 0) return;
    const renderOrder = this.sortFacesByFacing(indices, camera);
    const frontIdx = renderOrder[renderOrder.length - 1] ?? -1;

    const baseExposure = renderer.toneMappingExposure ?? 1;
    const roomVisible = this.roomMesh.visible;

    this.roomMesh.visible = false; // mirrored cameras leave the box; hide the shell
    camera.updateMatrixWorld();

    this.renderRecursive(renderer, scene, camera, renderOrder, this.maxBounces, 0, baseExposure);
    for (const idx of renderOrder) {
      if (idx >= 0 && idx < this.hasMainViewCapture.length) this.hasMainViewCapture[idx] = true;
    }

    // Final facing-mirror resolve: refresh all other faces from the camera-facing
    // mirror's virtual camera, then re-render it. This fixes the classic “one wall
    // missing” artifact while moving the camera in the recursive tunnel mode.
    this.refreshFromFacingMirror(frontIdx, renderer, scene, camera, baseExposure);

    // Restore all other faces for the main view so they don't end the frame with a
    // textureMatrix/projection computed from a virtual camera (looks like a missing wall).
    renderer.toneMappingExposure = this.exposureForDepth(baseExposure, 0);
    for (let idx = 0; idx < this.facesList.length; idx++) {
      if (idx === frontIdx) continue;
      const mirror = this.facesList[idx];
      const render = this.baseRenders[idx];
      if (!mirror || !render) continue;
      mirror.forceUpdate = true;
      render(renderer, scene, camera);
      mirror.forceUpdate = false;
      this.hasMainViewCapture[idx] = true;
    }

    // Baseline update for faces outside the update mask so visible side mirrors
    // aren't left in an uninitialized/wrong-camera state.
    const requestedSet = new Set(indices);
    renderer.toneMappingExposure = baseExposure * 0.4;
    for (let idx = 0; idx < this.facesList.length; idx++) {
      if (requestedSet.has(idx)) continue;
      if (this.hasMainViewCapture[idx]) continue;
      const mirror = this.facesList[idx];
      const render = this.baseRenders[idx];
      if (!mirror || !render) continue;
      mirror.forceUpdate = true;
      render(renderer, scene, camera);
      mirror.forceUpdate = false;
      this.hasMainViewCapture[idx] = true;
    }

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

      const nextFace = this.pickNextFace(virtualCamera, idx);
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

  private refreshFromFacingMirror(
    frontIdx: number,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    baseExposure: number
  ) {
    if (frontIdx < 0) return;
    const frontMirror = this.facesList[frontIdx];
    const frontRender = this.baseRenders[frontIdx];
    const captureCam = frontMirror?.camera as PerspectiveCamera | undefined;
    if (!frontMirror || !frontRender || !captureCam) return;

    const prevExposure = renderer.toneMappingExposure ?? baseExposure;

    const nextFace = this.pickNextFace(captureCam, frontIdx);
    if (nextFace >= 0 && this.maxBounces > 1) {
      this.renderRecursive(renderer, scene, captureCam, [nextFace], this.maxBounces - 1, 1, baseExposure);
    }

    // Refresh all other faces once from the facing mirror's virtual camera so the
    // captured tunnel has all 4 side walls (prevents a missing quadrant at 90°).
    renderer.toneMappingExposure = this.exposureForDepth(baseExposure, 1);
    for (let idx = 0; idx < this.facesList.length; idx++) {
      if (idx === frontIdx) continue;
      if (idx === nextFace) continue; // keep the deeper recursion result intact
      const mirror = this.facesList[idx];
      const render = this.baseRenders[idx];
      if (!mirror || !render) continue;
      mirror.forceUpdate = true;
      render(renderer, scene, captureCam);
      mirror.forceUpdate = false;
    }

    // Resolve the facing mirror again from the real camera with the freshly updated neighbors.
    renderer.toneMappingExposure = this.exposureForDepth(baseExposure, 0);
    frontMirror.forceUpdate = true;
    frontRender(renderer, scene, camera);
    frontMirror.forceUpdate = false;

    renderer.toneMappingExposure = prevExposure;
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

  private pickNextFace(camera: PerspectiveCamera, avoidIdx: number): number {
    if (this.facesList.length <= 1) return -1;

    camera.updateMatrixWorld();
    const origin = this.tmpRayOrigin;
    origin.setFromMatrixPosition(camera.matrixWorld);
    const dir = this.tmpRayDir;
    camera.getWorldDirection(dir);

    let best = -1;
    let bestDist = Infinity;
    const eps = 1e-4;

    for (let idx = 0; idx < this.facesList.length; idx++) {
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

  private sortFacesByFacing(indices: number[], camera: PerspectiveCamera) {
    if (indices.length <= 1) return indices;
    camera.getWorldDirection(this.tmpCamDir);
    return [...indices].sort((a, b) => {
      const dotA = this.faceDot(a, camera);
      const dotB = this.faceDot(b, camera);
      if (dotA === dotB) return a - b;
      return dotA - dotB;
    });
  }

  private faceDot(idx: number, camera: PerspectiveCamera) {
    const center = this.faceCenters[idx];
    if (!center) return -Infinity;
    this.tmpToCenter.copy(center).sub(camera.position).normalize();
    return this.tmpCamDir.dot(this.tmpToCenter);
  }

  private exposureForDepth(baseExposure: number, depth: number) {
    const exp = this.bounceAttenuationMode === 'allBounces' ? depth + 1 : Math.max(1, depth);
    const atten = Math.pow(this.bounceAttenuation, exp);
    return baseExposure * atten;
  }

  private applyEnabledState() {
    this.facesList.forEach((f) => {
      f.visible = this.enabled;
      f.matrixWorldNeedsUpdate = true;
    });
    this.roomMesh.visible = this.enabled && this.showRoomMesh;
  }

  private applyDistortionUniforms() {
    const intensity = this.computeSurfaceIntensity();
    for (const uniforms of this.mirrorUniforms.values()) {
      if (uniforms.warpStrength) uniforms.warpStrength.value = this.distortion.warpStrength;
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
        warpStrength: { value: this.distortion.warpStrength },
        time: { value: this.distortion.time ?? 0 },
        surfaceIntensity: { value: this.computeSurfaceIntensity() },
        mFractalEnabled: { value: 0.0 },
        mFractalStrength: { value: 0.35 },
        mFractalIterations: { value: 48.0 },
        mFractalZoom: { value: 1.65 },
        mFractalCenter: { value: new Vector2(0.0, 0.0) },
        mFractalC: { value: new Vector2(-0.70176, -0.3842) },
        mFractalMode: { value: 0.0 }, // 0=julia, 1=mandelbrot
        mFractalSegments: { value: 1.0 },
        mFractalRotation: { value: 0.0 },
        mFractalDomainMix: { value: 0.35 },
        mFractalDomainFrequency: { value: 6.0 },
        mFractalPaletteShift: { value: 0.0 },
        mFractalColorScheme: { value: 0.0 }, // 0=cosine, 1=escape
        mFractalResolution: { value: new Vector2(this.resolution.width, this.resolution.height) },
      },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec2 vSurfaceUv;

        void main() {
          vSurfaceUv = uv;
          vUv = textureMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform float surfaceIntensity;
        uniform float time;
        uniform float mFractalEnabled;
        uniform float mFractalStrength;
        uniform float mFractalIterations;
        uniform float mFractalZoom;
        uniform vec2 mFractalCenter;
        uniform vec2 mFractalC;
        uniform float mFractalMode;
        uniform float mFractalSegments;
        uniform float mFractalRotation;
        uniform float mFractalDomainMix;
        uniform float mFractalDomainFrequency;
        uniform float mFractalPaletteShift;
        uniform float mFractalColorScheme;
        uniform vec2 mFractalResolution;
        varying vec4 vUv;
        varying vec2 vSurfaceUv;

        #include <logdepthbuf_pars_fragment>

        const float PI = 3.141592653589793;
        const float TAU = 6.283185307179586;

        float blendOverlay( float base, float blend ) {
          return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
        }

        vec3 blendOverlay( vec3 base, vec3 blend ) {
          return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
        }

        vec3 sampleProj(vec4 proj) {
          return texture2DProj( tDiffuse, proj ).rgb;
        }

        vec2 kaleidoscope(vec2 p, float segs, float rot) {
          segs = max(1.0, segs);
          if (segs <= 1.5) return p;
          float a = atan(p.y, p.x) + rot;
          float r = length(p);
          float seg = 2.0 * PI / segs;
          a = mod(a, seg);
          a = abs(a - seg * 0.5);
          return vec2(cos(a), sin(a)) * r;
        }

        vec2 csqr(vec2 z) {
          return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
        }

        vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
          return a + b * cos(TAU * (c * t + d));
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec4 projUv = vUv;
          vec2 uv = projUv.xy / projUv.w;
          vec2 uvSample = clamp(uv, 0.0, 1.0);

          vec3 col = vec3(0.0);
          float fEnabled = mFractalEnabled;
          float fStrength = clamp(mFractalStrength, 0.0, 2.0);
          if (fEnabled > 0.5 && fStrength > 0.0001) {
            vec2 wallUv = vSurfaceUv;
            vec2 p = wallUv * 2.0 - 1.0;
            float zf = max(0.0005, mFractalZoom);
            vec2 delta = p / zf;
            delta = kaleidoscope(delta, mFractalSegments, mFractalRotation);
            vec2 coord = mFractalCenter + delta;

            vec2 z = mix(coord, vec2(0.0), step(0.5, mFractalMode));
            vec2 k = mix(mFractalC, coord, step(0.5, mFractalMode));

            int maxIter = int(clamp(mFractalIterations, 1.0, 128.0));
            float it = 0.0;
            float escaped = 0.0;
            for (int i = 0; i < 128; i++) {
              if (i >= maxIter) break;
              z = csqr(z) + k;
              it = float(i);
              if (dot(z, z) > 16.0) {
                escaped = 1.0;
                break;
              }
            }

            float smoothIt = it;
            if (escaped > 0.5) {
              float zz = max(1e-12, dot(z, z));
              float log_zn = log(zz) / 2.0;
              float nu = log(log_zn / log(2.0)) / log(2.0);
              smoothIt = it + 1.0 - nu;
            }

            float tNorm = clamp(smoothIt / float(maxIter), 0.0, 1.0);
            float ridge = pow(tNorm, 0.75) * escaped;
            float m = it / float(maxIter);
            float edge = smoothstep(0.0, 1.0, 1.0 - m) * escaped;
            float magZ = log(length(z) + 1e-6);
            vec2 fDir = normalize(vec2(z.y, -z.x) + 1e-4);
            float fWarp = fStrength * 0.035 * edge * (0.4 + 0.6 * sin(magZ * 1.7 + time * 0.25));
            vec2 uvWarp = clamp(uvSample + fDir * fWarp, 0.0, 1.0);

            vec4 projSample = vec4(uvWarp * projUv.w, projUv.zw);
            col = sampleProj(projSample);

            float dm = clamp(mFractalDomainMix, 0.0, 1.0) * fStrength;
            if (dm > 0.0001) {
              float freq = max(0.0, mFractalDomainFrequency);
              float scheme = floor(mFractalColorScheme + 0.5);
              float argCoord = atan(coord.y, coord.x) / TAU;
              float ps = mFractalPaletteShift;
              float mixWeight = clamp(dm * (0.35 + 0.65 * ridge), 0.0, 1.0);

              vec3 dc = vec3(0.0);
              if (scheme < 0.5) {
                float tt = fract(tNorm * (0.15 * freq + 1.0) + argCoord + ps);
                vec3 a = vec3(0.5);
                vec3 b = vec3(0.5);
                vec3 c0 = vec3(1.0);
                vec3 d = vec3(0.0, 0.33, 0.67) + ps;
                dc = cosinePalette(tt, a, b, c0, d) * (0.6 + 0.4 * ridge);
              } else {
                float stripe = 0.55 + 0.45 * sin((smoothIt) * (0.12 * freq + 0.75) + ps * TAU);
                vec3 a = vec3(0.42, 0.4, 0.5);
                vec3 b = vec3(0.58, 0.6, 0.5);
                vec3 c0 = vec3(1.0, 1.0, 1.0);
                vec3 d = vec3(0.0, 0.2, 0.4) + ps;
                dc = cosinePalette(tNorm, a, b, c0, d) * stripe * (0.5 + 0.5 * ridge);
              }
              col = mix(col, dc, mixWeight);
            }
          } else {
            vec4 projSample = vec4(uvSample * projUv.w, projUv.zw);
            col = sampleProj(projSample);
          }

          col *= surfaceIntensity;
          col = clamp(col * 0.5, 0.0, 1.5);
          gl_FragColor = vec4( blendOverlay( col, color ), 1.0 );

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
