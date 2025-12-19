import { Vector2 } from 'three';

export const PrismWarpShader = {
  name: 'PrismWarpShader',
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    resolution: { value: new Vector2(1, 1) },
    strength: { value: 0.35 },
    warp: { value: 0.02 },
    chroma: { value: 0.006 },
    grain: { value: 0.08 },
    vignette: { value: 0.35 },
    scanlines: { value: 0.12 },
    speed: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 resolution;
    uniform float strength;
    uniform float warp;
    uniform float chroma;
    uniform float grain;
    uniform float vignette;
    uniform float scanlines;
    uniform float speed;

    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 p = uv * 2.0 - 1.0;
      float r = length(p);
      float t = time * speed;

      float wobble =
        sin((p.y + t * 0.15) * 10.0) *
        cos((p.x - t * 0.13) * 10.0);
      float radial =
        sin(r * 8.0 - t * 1.2) *
        cos(r * 3.0 + t * 0.7);

      float wave = wobble + radial;
      float falloff = smoothstep(1.25, 0.0, r);
      vec2 dir = r > 0.0001 ? p / r : vec2(0.0);

      vec2 uvWarp = uv + dir * wave * warp * strength * 0.35 * falloff;
      uvWarp = clamp(uvWarp, 0.0, 1.0);

      float ca = chroma * strength * (0.25 + 0.75 * falloff);
      vec2 caDir = dir * ca;

      vec4 base = texture2D(tDiffuse, uvWarp);
      vec3 col = vec3(
        texture2D(tDiffuse, clamp(uvWarp + caDir, 0.0, 1.0)).r,
        base.g,
        texture2D(tDiffuse, clamp(uvWarp - caDir, 0.0, 1.0)).b
      );

      float n = hash21(uv * resolution + t * 60.0) - 0.5;
      col += n * grain * strength;

      float line = sin(uv.y * resolution.y * 3.14159);
      col *= 1.0 - scanlines * strength * 0.15 * (0.5 + 0.5 * line);

      float vig = smoothstep(0.2, 1.0, r);
      col *= 1.0 - vignette * strength * 0.55 * vig;

      gl_FragColor = vec4(col, base.a);
    }
  `,
} as const;

