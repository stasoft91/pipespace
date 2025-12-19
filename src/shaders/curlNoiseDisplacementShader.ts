import { Vector2 } from 'three';

export const CurlNoiseDisplacementShader = {
  name: 'CurlNoiseDisplacementShader',
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    resolution: { value: new Vector2(1, 1) },
    strength: { value: 0.25 },
    curlScale: { value: 2.25 },
    timeRate: { value: 0.45 },
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
    uniform float curlScale;
    uniform float timeRate;

    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + 11.17;
        a *= 0.5;
      }
      return v;
    }

    vec2 curl(vec2 p) {
      float e = 0.15;
      float n1 = fbm(p + vec2(0.0, e));
      float n2 = fbm(p - vec2(0.0, e));
      float n3 = fbm(p + vec2(e, 0.0));
      float n4 = fbm(p - vec2(e, 0.0));
      float dy = (n1 - n2) / (2.0 * e);
      float dx = (n3 - n4) / (2.0 * e);
      return vec2(dy, -dx);
    }

    void main() {
      vec2 uv = vUv;
      vec2 asp = vec2(resolution.x / max(1.0, resolution.y), 1.0);
      vec2 p = (uv * 2.0 - 1.0) * asp;

      float t = time * timeRate;
      vec2 fieldPos = p * max(0.001, curlScale) + vec2(t * 0.7, -t * 0.55);
      vec2 v = curl(fieldPos);

      float amt = clamp(strength, 0.0, 2.0) * 0.015;
      vec2 uvWarp = uv + v * amt;
      uvWarp = clamp(uvWarp, 0.0, 1.0);

      gl_FragColor = texture2D(tDiffuse, uvWarp);
    }
  `,
} as const;

