import { DoubleSide, Mesh, PlaneGeometry, Scene, Vector3 } from 'three';
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

type RasterMirrorSystemOptions = {
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
};

export class RasterMirrorSystem implements MirrorSystem {
  private scene: Scene;
  private roomMesh: Mesh;
  private pipeLayer: number;
  private baseShader: any;

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

  constructor(opts: RasterMirrorSystemOptions) {
    this.scene = opts.scene;
    this.roomMesh = opts.roomMesh;
    this.pipeLayer = opts.pipeLayer;
    this.baseShader = opts.baseShader;

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


  updateFrame(): void {
    // raster mode updates via onBeforeRender hooks driven by main render pass
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

  dispose() {
    this.disposeFaces(this.facesList);
    this.facesList = [];
    this.mirrorUniforms.clear();
    this.faceCenters = [];
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
        uniform float blurAmount;
        uniform float chromaticShift;
        uniform float warpStrength;
        uniform float warpSpeed;
        uniform float refractionOffset;
        uniform float noiseStrength;
        uniform float time;
        varying vec4 vUv;

        #include <logdepthbuf_pars_fragment>

        float blendOverlay( float base, float blend ) {
          return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
        }

        vec3 blendOverlay( vec3 base, vec3 blend ) {
          return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
        }

        vec3 sampleProj(vec4 proj) {
          return texture2DProj( tDiffuse, proj ).rgb;
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec4 projUv = vUv;
          vec2 uv = projUv.xy / projUv.w;
          vec2 dir = uv - vec2(0.5);
          float len = length(dir);
          vec2 dirNorm = len < 1e-4 ? vec2(1.0, 0.0) : dir / len;

          // noise shimmer
          if (noiseStrength > 0.0) {
            float n = sin(dot(uv * vec2(1733.1, 927.7), vec2(12.9898, 78.233)) + time * 57.0);
            vec2 noiseVec = vec2(n, fract(n * 1.2154) - 0.5);
            uv += noiseVec * noiseStrength;
          }

          // warp
          float warp = warpStrength;
          if (warp > 0.0) {
            float wobble = sin(len * 24.0 + time * warpSpeed * 6.28318);
            uv += dirNorm * wobble * warp;
          }

          // refraction-like offset
          if (abs(refractionOffset) > 0.0001) {
            uv += dirNorm * refractionOffset;
          }

          // reconstruct projective coords after UV shifts
          vec4 projSample = vec4(uv * projUv.w, projUv.zw);

          // base sample
          vec3 base = sampleProj(projSample);
          float blur = clamp(blurAmount, 0.0, 1.0);

          if (blur > 0.0) {
            float radius = mix(0.0, 0.06, blur); // tune radius
            vec3 accum = base;
            float weight = 1.0;
            const int samples = 5;
            for (int i = 1; i <= samples; i++) {
              float t = float(i) / float(samples);
              vec2 offset = dir * radius * t;
              vec4 offProj = vec4((uv + offset) * projUv.w, projUv.zw);
              vec3 s = sampleProj(offProj);
              float w = 1.0 - t * 0.65;
              accum += s * w;
              weight += w;
            }
            base = accum / weight;
          }

          // chromatic shift
          float shift = chromaticShift;
          if (shift > 0.0) {
            vec2 cOff = dirNorm * shift;
            float r = texture2DProj( tDiffuse, vec4((uv + cOff) * projUv.w, projUv.zw) ).r;
            float g = texture2DProj( tDiffuse, vec4(uv * projUv.w, projUv.zw) ).g;
            float b = texture2DProj( tDiffuse, vec4((uv - cOff) * projUv.w, projUv.zw) ).b;
            base = vec3(r, g, b);
          }

          gl_FragColor = vec4( blendOverlay( base, color ), 1.0 );

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
    mirror.onBeforeRender = (...args) => {
      if (!this.enabled) return;
      if (!this.updateMask.has(faceIndex)) return;
      baseRender(...args);
    };
    mirror.position.copy(position);
    rotate(mirror);
    this.mirrorUniforms.set(faceIndex, (mirror.material as any).uniforms ?? {});
    return mirror;
  }
}

