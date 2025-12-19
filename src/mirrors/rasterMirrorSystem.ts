import { DoubleSide, Mesh, PlaneGeometry, Scene, Vector2, Vector3 } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { MirrorDistortionUniforms, MirrorSystem } from './types';

type MirrorUniformBag = {
  warpStrength?: { value: number };
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
  showRoomMesh?: boolean;
};

export class RasterMirrorSystem implements MirrorSystem {
  private scene: Scene;
  private roomMesh: Mesh;
  private pipeLayer: number;
  private baseShader: any;
  private showRoomMesh: boolean;

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
    this.showRoomMesh = opts.showRoomMesh ?? true;

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
    this.roomMesh.visible = this.enabled && this.showRoomMesh;
  }

  private applyDistortionUniforms() {
    for (const uniforms of this.mirrorUniforms.values()) {
      if (uniforms.warpStrength) uniforms.warpStrength.value = this.distortion.warpStrength;
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
        warpStrength: { value: this.distortion.warpStrength },
        time: { value: this.distortion.time ?? 0 },
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
        uniform float warpStrength;
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
          vec2 dir = uv - vec2(0.5);
          float len = length(dir);
          vec2 dirNorm = len < 1e-4 ? vec2(1.0, 0.0) : dir / len;

          // warp
          float warp = warpStrength;
          if (warp > 0.0) {
            float wobble = sin(len * 24.0 + time * 6.28318);
            uv += dirNorm * wobble * warp;
          }

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

            // base sample with fractal warp applied
            vec4 projSample = vec4(uvWarp * projUv.w, projUv.zw);
            col = sampleProj(projSample);

            // Domain mix (cosine / escape-time)
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
            // base sample without fractal warp
            vec4 projSample = vec4(uvSample * projUv.w, projUv.zw);
            col = sampleProj(projSample);
          }

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
