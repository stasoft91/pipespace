import { DoubleSide, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
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
};

type RayMirrorSystemOptions = {
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
};

/**
 * Approximates recursive reflections by iterating multiple capture passes
 * per frame (maxBounces) with inter-reflection enabled. This is still raster-
 * based but gives deeper bounces than the single-pass raster mode.
 */
export class RayMirrorSystem implements MirrorSystem {
  private scene: Scene;
  private roomMesh: Mesh;
  private pipeLayer: number;
  private baseShader: any;
  private maxBounces: number;

  private facesList: Reflector[] = [];
  private faceCenters: Vector3[] = [];
  private mirrorUniforms = new Map<number, MirrorUniformBag>();
  private updateMask = new Set<number>();

  private size: number;
  private color: string;
  private inset: number;
  private resolution: { width: number; height: number };
  private distortion: MirrorDistortionUniforms;
  private enabled: boolean;
  private bounceAttenuation: number;

  private baseRenders: Array<
    (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, geometry?: any, material?: any, group?: any) => void
  > = [];

  constructor(opts: RayMirrorSystemOptions) {
    this.scene = opts.scene;
    this.roomMesh = opts.roomMesh;
    this.pipeLayer = opts.pipeLayer;
    this.baseShader = opts.baseShader;
    this.maxBounces = Math.max(1, Math.floor(opts.maxBounces));

    this.size = opts.size;
    this.color = opts.color;
    this.inset = opts.inset;
    this.resolution = opts.resolution;
    this.distortion = opts.distortion;
    this.enabled = opts.enabled;
    this.bounceAttenuation = Math.max(0.3, Math.min(1, opts.bounceAttenuation ?? 0.65));

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
    if (!this.enabled) return;
    if (this.facesList.length === 0) return;

    const indices = this.updateMask.size > 0 ? Array.from(this.updateMask.values()) : this.facesList.map((_, i) => i);
    const baseExposure = renderer.toneMappingExposure ?? 1;
    const baseExposureScaled = baseExposure * 0.4; // dim captures to avoid persistent glare

    for (let bounce = 0; bounce < this.maxBounces; bounce++) {
      const atten = Math.pow(this.bounceAttenuation, bounce);
      renderer.toneMappingExposure = baseExposureScaled * atten;
      for (const idx of indices) {
        const baseRender = this.baseRenders[idx];
        if (!baseRender) continue;
        baseRender(renderer, scene, camera);
      }
    }
    renderer.toneMappingExposure = baseExposure;
  }

  dispose() {
    this.disposeFaces(this.facesList);
    this.facesList = [];
    this.mirrorUniforms.clear();
    this.faceCenters = [];
    this.baseRenders = [];
  }

  private applyEnabledState() {
    this.facesList.forEach((f) => {
      f.visible = this.enabled;
      f.matrixWorldNeedsUpdate = true;
    });
    this.roomMesh.visible = this.enabled;
  }

  private applyDistortionUniforms() {
    for (const uniforms of this.mirrorUniforms.values()) {
      if (uniforms.blurAmount) uniforms.blurAmount.value = this.distortion.blur;
      if (uniforms.chromaticShift) uniforms.chromaticShift.value = this.distortion.chromaticShift;
      if (uniforms.warpStrength) uniforms.warpStrength.value = this.distortion.warpStrength;
      if (uniforms.warpSpeed) uniforms.warpSpeed.value = this.distortion.warpSpeed;
      if (uniforms.refractionOffset) uniforms.refractionOffset.value = this.distortion.refractionOffset;
      if (uniforms.noiseStrength) uniforms.noiseStrength.value = this.distortion.noiseStrength;
      if (uniforms.time) uniforms.time.value = this.distortion.time;
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
    this.faceCenters = [];
    this.baseRenders = [];
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
    this.faceCenters[faceIndex] = position.clone();
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
      },
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
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
          base.rgb = clamp(base.rgb * 0.5, 0.0, 1.5); // stronger clamp to reduce persistent glare
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
    // disable automatic per-draw updates; we'll drive multi-bounce manually
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
    this.mirrorUniforms.set(faceIndex, (mirror.material as any).uniforms ?? {});
    return mirror;
  }

}

