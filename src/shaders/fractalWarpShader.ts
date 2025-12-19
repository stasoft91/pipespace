import { Vector2 } from 'three';

export const FractalWarpShader = {
  name: 'FractalWarpShader',
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0.0 },
    resolution: { value: new Vector2(1, 1) },
    strength: { value: 0.35 },
    iterations: { value: 48.0 },
    zoom: { value: 1.65 },
    center: { value: new Vector2(0.0, 0.0) },
    c: { value: new Vector2(-0.70176, -0.3842) },
    mode: { value: 0.0 }, // 0=julia, 1=mandelbrot
    segments: { value: 1.0 },
    rotation: { value: 0.0 },
    domainMix: { value: 0.0 },
    domainFrequency: { value: 6.0 },
    paletteShift: { value: 0.0 },
    colorScheme: { value: 0.0 }, // 0=cosine, 1=escape
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
    uniform float iterations;
    uniform float zoom;
    uniform vec2 center;
    uniform vec2 c;
    uniform float mode;
    uniform float segments;
    uniform float rotation;
    uniform float domainMix;
    uniform float domainFrequency;
    uniform float paletteShift;
    uniform float colorScheme;

    varying vec2 vUv;

    const float PI = 3.141592653589793;
    const float TAU = 6.283185307179586;

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
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

    float gridLine(float x, float width) {
      float f = fract(x);
      float d = min(f, 1.0 - f);
      return 1.0 - smoothstep(0.0, width, d);
    }

    void main() {
      vec2 uv = vUv;

      vec2 p = uv * 2.0 - 1.0;
      p.x *= resolution.x / max(1.0, resolution.y);
      float zf = max(0.0005, zoom);
      vec2 delta = p / zf;
      delta = kaleidoscope(delta, segments, rotation);
      vec2 coord = center + delta;

      vec2 z = mix(coord, vec2(0.0), step(0.5, mode));
      vec2 k = mix(c, coord, step(0.5, mode));

      int maxIter = int(clamp(iterations, 1.0, 128.0));
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
      float t = clamp(smoothIt / float(maxIter), 0.0, 1.0) * escaped;

      float m = it / float(maxIter);
      float edge = smoothstep(0.0, 1.0, 1.0 - m) * escaped;

      float argCoord = atan(coord.y, coord.x) / TAU;
      float magCoord = log(length(coord) + 1e-6);
      float magZ = log(length(z) + 1e-6);

      vec2 dir = normalize(vec2(z.y, -z.x) + 1e-4);
      float warp = strength * 0.035 * edge * (0.4 + 0.6 * sin(magZ * 1.7 + time * 0.25));
      vec2 uvWarp = uv + dir * warp;
      uvWarp = clamp(uvWarp, 0.0, 1.0);

      vec4 base = texture2D(tDiffuse, uvWarp);
      vec3 col = base.rgb;

      float dm = clamp(domainMix, 0.0, 1.0) * clamp(strength, 0.0, 2.0);
      if (dm > 0.0001) {
        float freq = max(0.0, domainFrequency);
        float scheme = floor(colorScheme + 0.5);
        float tNorm = clamp(smoothIt / float(maxIter), 0.0, 1.0);
        float ridge = pow(tNorm, 0.75) * escaped;
        float mixWeight = clamp(dm * (0.35 + 0.65 * ridge), 0.0, 1.0);

        vec3 dc = vec3(0.0);
        if (scheme < 0.5) {
          // Cosine palette (smooth iteration + domain orientation)
          float tt = fract(tNorm * (0.15 * freq + 1.0) + argCoord + paletteShift);
          vec3 a = vec3(0.5);
          vec3 b = vec3(0.5);
          vec3 c0 = vec3(1.0);
          vec3 d = vec3(0.0, 0.33, 0.67) + paletteShift;
          dc = cosinePalette(tt, a, b, c0, d) * (0.6 + 0.4 * ridge);
        } else {
          // Escape-time palette (classic smooth coloring with ridge stripes)
          float stripe =
            0.55 + 0.45 * sin((smoothIt) * (0.12 * freq + 0.75) + paletteShift * TAU);
          vec3 a = vec3(0.42, 0.4, 0.5);
          vec3 b = vec3(0.58, 0.6, 0.5);
          vec3 c0 = vec3(1.0, 1.0, 1.0);
          vec3 d = vec3(0.0, 0.2, 0.4) + paletteShift;
          dc = cosinePalette(tNorm, a, b, c0, d) * stripe * (0.5 + 0.5 * ridge);
        }
        col = mix(col, dc, mixWeight);
      }

      gl_FragColor = vec4(col, base.a);
    }
  `,
} as const;
