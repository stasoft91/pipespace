import { BackSide, BoxGeometry, Color, Group, Matrix4, Mesh, ShaderMaterial, Vector3 } from 'three';

export type JuliaBulbConfig = {
  juliaBulbCount?: number;
  juliaScale: number;
  juliaSpeed: number;
  juliaSpin: number;
  juliaPower: number;
  juliaIterations: number;
  juliaCX: number;
  juliaCY: number;
  juliaCZ: number;
  juliaZoom: number;
  juliaColorA: string;
  juliaColorB: string;
  juliaFogColor: string;
  juliaFogDensity: number;
  juliaDepthMix: number;
  juliaDepthCurve: number;
  juliaIntensity: number;
  juliaReflectivity?: number;
  juliaMetalness?: number;
  juliaRoughness?: number;
  juliaMaxSteps: number;
  juliaSurfaceDistance: number;
  edgeNeonEnabled?: boolean;
  edgeNeonStrength?: number;
  edgeNeonColor?: string;
  edgeHueTravelEnabled?: boolean;
  edgeHueTravelPeriod?: number;
  edgeNeonWidth?: number;
};

export type JuliaBulbVisual = {
  readonly mesh: Group;
  setVisible: (visible: boolean) => void;
  syncToRoom: (roomSize: number, wallInset: number, config: JuliaBulbConfig) => void;
  update: (dt: number, time: number, roomSize: number, wallInset: number, config: JuliaBulbConfig) => void;
  reset: (roomSize: number, wallInset: number, config: JuliaBulbConfig, time?: number) => void;
  dispose: () => void;
};

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 colorA;
  uniform vec3 colorB;
  uniform vec3 fogColor;
  uniform float time;
  uniform float depthMix;
  uniform float depthCurve;
  uniform float intensity;
  uniform float reflectivity;
  uniform float metalness;
  uniform float roughness;
  uniform float power;
  uniform float iterations;
  uniform vec3 juliaC;
  uniform float zoom;
  uniform float maxSteps;
  uniform float surfaceDistance;
  uniform float fogDensity;
  uniform mat4 invModelMatrix;
  uniform mat4 modelMatrixWorld;
  uniform vec3 edgeColor;
  uniform float edgeStrength;
  uniform float roomHalfSize;
  uniform float edgeFalloff;

  varying vec3 vWorldPosition;

  const int MAX_STEPS = 128;
  const int MAX_ITER = 24;

  float juliaBulbDE(vec3 p) {
    float z = max(0.0001, zoom);
    vec3 w = p * z;
    float r = 0.0;
    float dr = 1.0;
    int maxIter = int(clamp(iterations, 1.0, float(MAX_ITER)));
    float pw = max(2.0, power);

    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= maxIter) break;
      r = length(w);
      if (r > 2.5) break;
      float rSafe = max(r, 1e-6);
      float rPow = pow(rSafe, pw - 1.0);
      dr = rPow * pw * dr + 1.0;
      float theta = acos(clamp(w.z / rSafe, -1.0, 1.0));
      float phi = atan(w.y, w.x);
      float zr = pow(rSafe, pw);
      theta *= pw;
      phi *= pw;
      w = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      w += juliaC;
    }

    float dist = 0.5 * log(max(r, 1e-6)) * r / dr;
    return dist / z;
  }

  float mapScene(vec3 p) {
    return juliaBulbDE(p);
  }

  vec3 calcNormal(vec3 p, float eps) {
    vec2 e = vec2(eps, 0.0);
    return normalize(vec3(
      mapScene(p + e.xyy) - mapScene(p - e.xyy),
      mapScene(p + e.yxy) - mapScene(p - e.yxy),
      mapScene(p + e.yyx) - mapScene(p - e.yyx)
    ));
  }

  vec2 intersectBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (bmin - ro) * inv;
    vec3 t1 = (bmax - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);
    return vec2(tNear, tFar);
  }

  void main() {
    vec3 ro = (invModelMatrix * vec4(cameraPosition, 1.0)).xyz;
    vec3 rd = normalize((invModelMatrix * vec4(vWorldPosition, 1.0)).xyz - ro);

    vec2 hit = intersectBox(ro, rd, vec3(-1.0), vec3(1.0));
    if (hit.x > hit.y) discard;
    if (hit.y < 0.0) discard;

    float tNear = max(hit.x, 0.0);
    float tFar = hit.y;
    float t = tNear;
    float surf = max(surfaceDistance, 0.00002);
    int steps = int(clamp(maxSteps, 1.0, float(MAX_STEPS)));
    bool found = false;
    int usedSteps = 0;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= steps) break;
      vec3 p = ro + rd * t;
      float d = mapScene(p);
      if (d < surf) {
        found = true;
        usedSteps = i;
        break;
      }
      t += d * 0.9;
      if (t > tFar) break;
    }

    if (!found) discard;

    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, surf * 3.0);
    vec3 worldPos = (modelMatrixWorld * vec4(p, 1.0)).xyz;
    vec3 signPos = step(vec3(0.0), worldPos) * 2.0 - 1.0;
    float roomHalf = max(roomHalfSize, 0.001);
    float range = max(0.1, edgeFalloff * 0.35);
    float invRange = 1.0 / max(range * range, 0.0001);

    vec3 lineX = vec3(clamp(worldPos.x, -roomHalf, roomHalf), signPos.y * roomHalf, signPos.z * roomHalf);
    vec3 lineY = vec3(signPos.x * roomHalf, clamp(worldPos.y, -roomHalf, roomHalf), signPos.z * roomHalf);
    vec3 lineZ = vec3(signPos.x * roomHalf, signPos.y * roomHalf, clamp(worldPos.z, -roomHalf, roomHalf));

    vec3 toX = lineX - worldPos;
    vec3 toY = lineY - worldPos;
    vec3 toZ = lineZ - worldPos;

    float wX = exp(-dot(toX, toX) * invRange);
    float wY = exp(-dot(toY, toY) * invRange);
    float wZ = exp(-dot(toZ, toZ) * invRange);
    float wSum = wX + wY + wZ;
    vec3 lightDir = normalize(toX * wX + toY * wY + toZ * wZ + n * 0.001);
    float edgeLight = clamp(wSum * 0.3333, 0.0, 1.0);
    float lightBoost = edgeLight * clamp(edgeStrength * 18.0, 0.0, 3.0);
    vec3 lightTint = mix(vec3(1.0), edgeColor, 0.7);

    float diff = max(dot(n, lightDir), 0.0) * lightBoost;
    float rough = clamp(roughness, 0.0, 1.0);
    float metal = clamp(metalness, 0.0, 1.0);
    float refl = clamp(reflectivity, 0.0, 1.0);
    float specPower = mix(36.0, 10.0, rough);
    float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), specPower) * lightBoost;
    spec *= mix(0.8, 1.35, metal);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.2);
    float ao = 1.0 - float(usedSteps) / float(MAX_STEPS);

    float depth = clamp((t - tNear) / max(0.0001, tFar - tNear), 0.0, 1.0);
    float depthT = pow(depth, max(0.1, depthCurve));
    float depthBlend = mix(0.15, depthT, clamp(depthMix, 0.0, 1.0));
    vec3 base = mix(colorA, colorB, depthBlend);

    vec3 col = base * 0.15;
    col += base * diff * 0.85 * lightTint;
    col += lightTint * spec * 0.55;
    col += base * rim * 0.3;
    col *= (0.6 + 0.4 * ao);

    vec3 normalWorld = normalize(mat3(modelMatrixWorld) * n);
    vec3 viewDir = normalize(cameraPosition - worldPos);
    float fresnel = pow(1.0 - clamp(dot(normalWorld, viewDir), 0.0, 1.0), 5.0);
    vec3 reflDir = reflect(-viewDir, normalWorld);

    vec2 envHit = intersectBox(worldPos, reflDir, vec3(-roomHalf), vec3(roomHalf));
    float envT = max(envHit.y, 0.0);
    vec3 envPos = worldPos + reflDir * envT;

    vec3 envSign = step(vec3(0.0), envPos) * 2.0 - 1.0;
    vec3 envLineX = vec3(clamp(envPos.x, -roomHalf, roomHalf), envSign.y * roomHalf, envSign.z * roomHalf);
    vec3 envLineY = vec3(envSign.x * roomHalf, clamp(envPos.y, -roomHalf, roomHalf), envSign.z * roomHalf);
    vec3 envLineZ = vec3(envSign.x * roomHalf, envSign.y * roomHalf, clamp(envPos.z, -roomHalf, roomHalf));

    vec3 envToX = envLineX - envPos;
    vec3 envToY = envLineY - envPos;
    vec3 envToZ = envLineZ - envPos;

    float envWX = exp(-dot(envToX, envToX) * invRange);
    float envWY = exp(-dot(envToY, envToY) * invRange);
    float envWZ = exp(-dot(envToZ, envToZ) * invRange);
    float envEdge = clamp((envWX + envWY + envWZ) * 0.3333, 0.0, 1.0);

    float envWallDist = roomHalf - max(abs(envPos.x), max(abs(envPos.y), abs(envPos.z)));
    float envWallGlow = 1.0 - smoothstep(0.0, edgeFalloff, envWallDist);

    float edgeBoost = clamp(edgeStrength * 10.0, 0.0, 4.0);
    vec3 envBase = mix(fogColor, vec3(1.0), 0.1);
    vec3 env = envBase + edgeColor * (envEdge * edgeBoost + envWallGlow * edgeStrength * 1.6);
    env = mix(env, fogColor, rough * 0.7);

    vec3 reflectionTint = mix(vec3(1.0), base, metal);
    float reflectionFactor = refl * mix(0.15, 1.0, fresnel);
    col = mix(col, env * reflectionTint, reflectionFactor);

    col *= max(intensity, 0.0);

    float fog = 1.0 - exp(-max(0.0, fogDensity) * t);
    col = mix(col, fogColor, clamp(fog, 0.0, 1.0));

    float wallDist = roomHalfSize - max(abs(worldPos.x), max(abs(worldPos.y), abs(worldPos.z)));
    float edgeGlow = 1.0 - smoothstep(0.0, edgeFalloff, wallDist);
    col += edgeColor * edgeStrength * edgeGlow;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createJuliaBulbVisual(layer: number, initialRoomSize: number): JuliaBulbVisual {
  const geometry = new BoxGeometry(2, 2, 2);
  const createMaterial = () => {
    const material = new ShaderMaterial({
      uniforms: {
        colorA: { value: new Color('#f4b1ff') },
        colorB: { value: new Color('#3bd4ff') },
        fogColor: { value: new Color('#0b1424') },
        time: { value: 0 },
        depthMix: { value: 0.75 },
        depthCurve: { value: 1.1 },
        intensity: { value: 1.2 },
        reflectivity: { value: 0.45 },
        metalness: { value: 0.2 },
        roughness: { value: 0.2 },
        power: { value: 8 },
        iterations: { value: 8 },
        juliaC: { value: new Vector3(-0.8, -1.0, -0.07) },
        zoom: { value: 1.0 },
        maxSteps: { value: 64 },
        surfaceDistance: { value: 0.001 },
        fogDensity: { value: 0.2 },
        invModelMatrix: { value: new Matrix4() },
        modelMatrixWorld: { value: new Matrix4() },
        edgeColor: { value: new Color('#ffffff') },
        edgeStrength: { value: 0 },
        roomHalfSize: { value: 1 },
        edgeFalloff: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
    material.side = BackSide;
    material.toneMapped = true;
    return material;
  };

  type BulbState = {
    mesh: Mesh;
    material: ShaderMaterial;
    velocity: Vector3;
    spinAxis: Vector3;
    spawnTime: number;
    scaleFactor: number;
    radius: number;
    limit: number;
    shrinking: boolean;
    shrinkStartTime: number;
    shrinkStartScale: number;
    hueOffset: number;
    accentOffset: number;
    satOffset: number;
    lightOffset: number;
    colorA: Color;
    colorB: Color;
    fogColor: Color;
  };

  const group = new Group();
  const bulbs: BulbState[] = [];
  const baseSpinAxis = new Vector3(0.2, 0.9, 0.3).normalize();
  const invModel = new Matrix4();
  const colorA = new Color();
  const colorB = new Color();
  const fogColor = new Color();
  const baseAHsl = { h: 0, s: 0, l: 0 };
  const baseBHsl = { h: 0, s: 0, l: 0 };
  const baseFogHsl = { h: 0, s: 0, l: 0 };
  const edgeBase = new Color();
  const edgeAnimated = new Color();
  const edgeHsl = { h: 0, s: 0, l: 0 };
  const tmpVec = new Vector3();
  const tmpNormal = new Vector3();
  const tmpRelVel = new Vector3();

  const START_SCALE = 0.01;
  const GROWTH_DURATION = 0.42;
  const SHRINK_DURATION = 0.42;
  const MAX_BULBS = 12;
  let lastSpeed = 0;
  let lastTime = 0;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;
  const wrapHue = (h: number) => {
    const wrapped = h % 1;
    return wrapped < 0 ? wrapped + 1 : wrapped;
  };
  const randomDirection = () => {
    const v = new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    if (v.lengthSq() < 1e-4) {
      v.set(1, 0, 0);
    }
    return v.normalize();
  };
  const clampBulbCount = (count: number) => clamp(Math.round(count), 1, MAX_BULBS);
  const targetScaleFromConfig = (config: JuliaBulbConfig) => clamp(config.juliaScale, 0.12, 0.75);
  const calcLimit = (roomSize: number, wallInset: number, radius: number) => {
    const margin = Math.max(0.05, roomSize * 0.02);
    return Math.max(0, roomSize * 0.5 - wallInset - radius - margin);
  };
  const calcGrowthScale = (bulb: BulbState, targetScale: number, time: number) => {
    const growth = clamp((time - bulb.spawnTime) / GROWTH_DURATION, 0, 1);
    return START_SCALE + (targetScale - START_SCALE) * growth;
  };
  const calcShrinkScale = (bulb: BulbState, time: number) => {
    const t = clamp((time - bulb.shrinkStartTime) / SHRINK_DURATION, 0, 1);
    return bulb.shrinkStartScale + (START_SCALE - bulb.shrinkStartScale) * t;
  };
  const calcScaleFactor = (bulb: BulbState, targetScale: number, time: number) =>
    bulb.shrinking ? calcShrinkScale(bulb, time) : calcGrowthScale(bulb, targetScale, time);
  const beginShrink = (bulb: BulbState, time: number) => {
    if (bulb.shrinking) return;
    bulb.shrinking = true;
    bulb.shrinkStartTime = time;
    bulb.shrinkStartScale = Math.max(START_SCALE, bulb.scaleFactor);
  };
  const reviveBulb = (bulb: BulbState, time: number, targetScale: number) => {
    bulb.shrinking = false;
    bulb.shrinkStartTime = 0;
    bulb.shrinkStartScale = START_SCALE;
    const denom = Math.max(1e-4, targetScale - START_SCALE);
    const growth = clamp((bulb.scaleFactor - START_SCALE) / denom, 0, 1);
    bulb.spawnTime = time - growth * GROWTH_DURATION;
  };

  const applyScaleAndClamp = (bulb: BulbState, roomSize: number, wallInset: number, scaleFactor: number) => {
    bulb.scaleFactor = scaleFactor;
    const size = roomSize * Math.max(0.001, scaleFactor);
    const half = size * 0.5;
    const radius = half * Math.sqrt(3);
    bulb.radius = radius;
    bulb.mesh.scale.setScalar(Math.max(0.001, half));
    bulb.limit = calcLimit(roomSize, wallInset, radius);
    if (bulb.limit <= 0) {
      bulb.mesh.position.set(0, 0, 0);
      return;
    }
    bulb.mesh.position.x = clamp(bulb.mesh.position.x, -bulb.limit, bulb.limit);
    bulb.mesh.position.y = clamp(bulb.mesh.position.y, -bulb.limit, bulb.limit);
    bulb.mesh.position.z = clamp(bulb.mesh.position.z, -bulb.limit, bulb.limit);
  };

  const clampToLimit = (bulb: BulbState) => {
    if (bulb.limit <= 0) {
      bulb.mesh.position.set(0, 0, 0);
      return;
    }
    if (bulb.mesh.position.x > bulb.limit) {
      bulb.mesh.position.x = bulb.limit;
      bulb.velocity.x = -Math.abs(bulb.velocity.x);
    } else if (bulb.mesh.position.x < -bulb.limit) {
      bulb.mesh.position.x = -bulb.limit;
      bulb.velocity.x = Math.abs(bulb.velocity.x);
    }
    if (bulb.mesh.position.y > bulb.limit) {
      bulb.mesh.position.y = bulb.limit;
      bulb.velocity.y = -Math.abs(bulb.velocity.y);
    } else if (bulb.mesh.position.y < -bulb.limit) {
      bulb.mesh.position.y = -bulb.limit;
      bulb.velocity.y = Math.abs(bulb.velocity.y);
    }
    if (bulb.mesh.position.z > bulb.limit) {
      bulb.mesh.position.z = bulb.limit;
      bulb.velocity.z = -Math.abs(bulb.velocity.z);
    } else if (bulb.mesh.position.z < -bulb.limit) {
      bulb.mesh.position.z = -bulb.limit;
      bulb.velocity.z = Math.abs(bulb.velocity.z);
    }
  };

  const syncUniforms = (time: number, roomSize: number, wallInset: number, config: JuliaBulbConfig) => {
    const depthMix = clamp(config.juliaDepthMix, 0, 1);
    const depthCurve = clamp(config.juliaDepthCurve, 0.1, 3);
    const intensity = clamp(config.juliaIntensity, 0, 4);
    const reflectivity = clamp(config.juliaReflectivity ?? 0.45, 0, 1);
    const metalness = clamp(config.juliaMetalness ?? 0.2, 0, 1);
    const roughness = clamp(config.juliaRoughness ?? 0.2, 0, 1);
    const power = clamp(config.juliaPower, 2, 20);
    const iterations = clamp(Math.round(config.juliaIterations), 1, 24);
    const zoom = clamp(config.juliaZoom, 0.4, 2.5);
    const maxSteps = clamp(Math.round(config.juliaMaxSteps), 8, 128);
    const surfaceDistance = clamp(config.juliaSurfaceDistance, 0.00005, 0.01);
    const fogDensity = clamp(config.juliaFogDensity, 0, 3);
    colorA.set(config.juliaColorA);
    colorB.set(config.juliaColorB);
    fogColor.set(config.juliaFogColor);
    colorA.getHSL(baseAHsl);
    colorB.getHSL(baseBHsl);
    fogColor.getHSL(baseFogHsl);

    const edgeEnabled = Boolean(config.edgeNeonEnabled);
    if (edgeEnabled) {
      edgeBase.set(config.edgeNeonColor ?? '#ffffff');
      edgeBase.getHSL(edgeHsl);
      let hue = edgeHsl.h;
      if (config.edgeHueTravelEnabled) {
        const period = Math.max(0.01, config.edgeHueTravelPeriod ?? 1);
        hue = (hue + time / period) % 1;
      }
      edgeAnimated.setHSL(hue, edgeHsl.s, edgeHsl.l);
    } else {
      edgeAnimated.setRGB(0, 0, 0);
    }
    const edgeStrength = edgeEnabled ? clamp((config.edgeNeonStrength ?? 0) * 0.02, 0, 2) : 0;
    const roomHalf = Math.max(0.1, roomSize * 0.5 - wallInset);
    const width = Math.max(0.02, config.edgeNeonWidth ?? 0.08);
    const falloff = Math.max(width * 10, roomSize * 0.08);
    const edgeFalloff = Math.min(falloff, roomHalf);

    for (const bulb of bulbs) {
      bulb.colorA.setHSL(
        wrapHue(baseAHsl.h + bulb.hueOffset),
        clamp(baseAHsl.s + bulb.satOffset, 0, 1),
        clamp(baseAHsl.l + bulb.lightOffset, 0, 1)
      );
      bulb.colorB.setHSL(
        wrapHue(baseBHsl.h + bulb.hueOffset + bulb.accentOffset),
        clamp(baseBHsl.s + bulb.satOffset, 0, 1),
        clamp(baseBHsl.l + bulb.lightOffset, 0, 1)
      );
      bulb.fogColor.setHSL(
        wrapHue(baseFogHsl.h + bulb.hueOffset * 0.5),
        clamp(baseFogHsl.s + bulb.satOffset * 0.5, 0, 1),
        clamp(baseFogHsl.l + bulb.lightOffset * 0.5, 0, 1)
      );
      const uniforms = bulb.material.uniforms as Record<string, { value: any }>;
      uniforms.time.value = time;
      uniforms.depthMix.value = depthMix;
      uniforms.depthCurve.value = depthCurve;
      uniforms.intensity.value = intensity;
      uniforms.reflectivity.value = reflectivity;
      uniforms.metalness.value = metalness;
      uniforms.roughness.value = roughness;
      uniforms.power.value = power;
      uniforms.iterations.value = iterations;
      uniforms.zoom.value = zoom;
      uniforms.maxSteps.value = maxSteps;
      uniforms.surfaceDistance.value = surfaceDistance;
      uniforms.fogDensity.value = fogDensity;
      (uniforms.juliaC.value as Vector3).set(config.juliaCX, config.juliaCY, config.juliaCZ);
      uniforms.colorA.value.copy(bulb.colorA);
      uniforms.colorB.value.copy(bulb.colorB);
      uniforms.fogColor.value.copy(bulb.fogColor);
      uniforms.edgeColor.value.copy(edgeAnimated);
      uniforms.edgeStrength.value = edgeStrength;
      uniforms.roomHalfSize.value = roomHalf;
      uniforms.edgeFalloff.value = edgeFalloff;
    }
  };

  const updateTransform = (bulb: BulbState) => {
    bulb.mesh.updateMatrixWorld();
    invModel.copy(bulb.mesh.matrixWorld).invert();
    (bulb.material.uniforms.invModelMatrix as { value: Matrix4 }).value.copy(invModel);
    (bulb.material.uniforms.modelMatrixWorld as { value: Matrix4 }).value.copy(bulb.mesh.matrixWorld);
  };

  const placeBulb = (bulb: BulbState, roomSize: number, wallInset: number, config: JuliaBulbConfig) => {
    const targetScale = targetScaleFromConfig(config);
    const size = roomSize * targetScale;
    const half = size * 0.5;
    const radius = half * Math.sqrt(3);
    const limit = calcLimit(roomSize, wallInset, radius);
    if (limit <= 0) {
      bulb.mesh.position.set(0, 0, 0);
      return;
    }

    const tries = 40;
    for (let i = 0; i < tries; i++) {
      tmpVec.set(rand(-limit, limit), rand(-limit, limit), rand(-limit, limit));
      let ok = true;
      for (const other of bulbs) {
        const otherRadius = Math.max(radius, other.radius || 0);
        const minDist = radius + otherRadius;
        if (tmpVec.distanceToSquared(other.mesh.position) < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (ok) {
        bulb.mesh.position.copy(tmpVec);
        return;
      }
    }

    bulb.mesh.position.set(rand(-limit, limit), rand(-limit, limit), rand(-limit, limit));
  };

  const spawnBulb = (
    time: number,
    roomSize: number,
    wallInset: number,
    config: JuliaBulbConfig,
    speed: number
  ) => {
    const material = createMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.layers.set(layer);
    mesh.frustumCulled = false;

    const velocity = new Vector3();
    if (speed > 0) {
      velocity.copy(randomDirection()).multiplyScalar(speed);
    }

    const hueOffset = rand(0, 1);
    const accentOffset = rand(-0.2, 0.2);
    const satOffset = rand(-0.12, 0.12);
    const lightOffset = rand(-0.08, 0.08);

    const bulb: BulbState = {
      mesh,
      material,
      velocity,
      spinAxis: baseSpinAxis.clone(),
      spawnTime: time,
      scaleFactor: START_SCALE,
      radius: 0,
      limit: 0,
      shrinking: false,
      shrinkStartTime: 0,
      shrinkStartScale: START_SCALE,
      hueOffset,
      accentOffset,
      satOffset,
      lightOffset,
      colorA: new Color(),
      colorB: new Color(),
      fogColor: new Color(),
    };
    mesh.rotation.set(0, 0, 0);
    placeBulb(bulb, roomSize, wallInset, config);
    bulbs.push(bulb);
    group.add(mesh);

    const targetScale = targetScaleFromConfig(config);
    const scaleFactor = calcGrowthScale(bulb, targetScale, time);
    applyScaleAndClamp(bulb, roomSize, wallInset, scaleFactor);
  };

  const ensureBulbCount = (
    time: number,
    roomSize: number,
    wallInset: number,
    config: JuliaBulbConfig,
    speed: number,
    targetScale: number
  ) => {
    const targetCount = clampBulbCount(config.juliaBulbCount ?? 1);
    let activeCount = 0;
    for (const bulb of bulbs) {
      if (!bulb.shrinking) activeCount++;
    }
    if (activeCount > targetCount) {
      let toShrink = activeCount - targetCount;
      for (let i = bulbs.length - 1; i >= 0 && toShrink > 0; i--) {
        const bulb = bulbs[i];
        if (!bulb.shrinking) {
          beginShrink(bulb, time);
          toShrink--;
        }
      }
    } else if (activeCount < targetCount) {
      let toRestore = targetCount - activeCount;
      for (let i = bulbs.length - 1; i >= 0 && toRestore > 0; i--) {
        const bulb = bulbs[i];
        if (bulb.shrinking) {
          reviveBulb(bulb, time, targetScale);
          toRestore--;
        }
      }
      for (let i = 0; i < toRestore; i++) {
        spawnBulb(time, roomSize, wallInset, config, speed);
      }
    }
  };

  const update = (dt: number, time: number, roomSize: number, wallInset: number, config: JuliaBulbConfig) => {
    lastTime = time;
    const speed = Math.max(0, config.juliaSpeed) * roomSize;
    const targetScale = targetScaleFromConfig(config);
    ensureBulbCount(time, roomSize, wallInset, config, speed, targetScale);

    if (Math.abs(speed - lastSpeed) > 1e-4) {
      if (speed <= 0) {
        for (const bulb of bulbs) {
          bulb.velocity.set(0, 0, 0);
        }
      } else if (lastSpeed > 1e-4) {
        const scale = speed / lastSpeed;
        for (const bulb of bulbs) {
          bulb.velocity.multiplyScalar(scale);
        }
      } else {
        for (const bulb of bulbs) {
          bulb.velocity.copy(randomDirection()).multiplyScalar(speed);
        }
      }
      lastSpeed = speed;
    }

    for (const bulb of bulbs) {
      const scaleFactor = calcScaleFactor(bulb, targetScale, time);
      applyScaleAndClamp(bulb, roomSize, wallInset, scaleFactor);
    }

    if (dt > 0 && speed > 0) {
      for (const bulb of bulbs) {
        if (bulb.limit <= 0) {
          bulb.mesh.position.set(0, 0, 0);
          bulb.velocity.set(0, 0, 0);
          continue;
        }
        bulb.mesh.position.addScaledVector(bulb.velocity, dt);
        if (bulb.mesh.position.x > bulb.limit) {
          bulb.mesh.position.x = bulb.limit;
          bulb.velocity.x = -Math.abs(bulb.velocity.x);
        } else if (bulb.mesh.position.x < -bulb.limit) {
          bulb.mesh.position.x = -bulb.limit;
          bulb.velocity.x = Math.abs(bulb.velocity.x);
        }
        if (bulb.mesh.position.y > bulb.limit) {
          bulb.mesh.position.y = bulb.limit;
          bulb.velocity.y = -Math.abs(bulb.velocity.y);
        } else if (bulb.mesh.position.y < -bulb.limit) {
          bulb.mesh.position.y = -bulb.limit;
          bulb.velocity.y = Math.abs(bulb.velocity.y);
        }
        if (bulb.mesh.position.z > bulb.limit) {
          bulb.mesh.position.z = bulb.limit;
          bulb.velocity.z = -Math.abs(bulb.velocity.z);
        } else if (bulb.mesh.position.z < -bulb.limit) {
          bulb.mesh.position.z = -bulb.limit;
          bulb.velocity.z = Math.abs(bulb.velocity.z);
        }
      }
    }

    if (dt > 0 && bulbs.length > 1) {
      for (let i = 0; i < bulbs.length; i++) {
        for (let j = i + 1; j < bulbs.length; j++) {
          const a = bulbs[i];
          const b = bulbs[j];
          tmpVec.copy(b.mesh.position).sub(a.mesh.position);
          const minDist = a.radius + b.radius;
          const minDistSq = minDist * minDist;
          const distSq = tmpVec.lengthSq();
          if (distSq < minDistSq) {
            let normal: Vector3;
            if (distSq > 1e-6) {
              const dist = Math.sqrt(distSq);
              normal = tmpVec.multiplyScalar(1 / dist);
              const overlap = minDist - dist;
              a.mesh.position.addScaledVector(normal, -overlap * 0.5);
              b.mesh.position.addScaledVector(normal, overlap * 0.5);
            } else {
              tmpNormal.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
              if (tmpNormal.lengthSq() < 1e-6) {
                tmpNormal.set(1, 0, 0);
              }
              tmpNormal.normalize();
              const overlap = minDist;
              a.mesh.position.addScaledVector(tmpNormal, -overlap * 0.5);
              b.mesh.position.addScaledVector(tmpNormal, overlap * 0.5);
              normal = tmpNormal;
            }

            tmpRelVel.copy(b.velocity).sub(a.velocity);
            const velAlongNormal = tmpRelVel.dot(normal);
            if (velAlongNormal < 0) {
              const impulse = -velAlongNormal;
              a.velocity.addScaledVector(normal, -impulse);
              b.velocity.addScaledVector(normal, impulse);
            }
          }
        }
      }
    }

    for (const bulb of bulbs) {
      clampToLimit(bulb);
    }

    const spin = config.juliaSpin;
    if (dt > 0 && Math.abs(spin) > 1e-4) {
      for (const bulb of bulbs) {
        bulb.mesh.rotateOnAxis(bulb.spinAxis, spin * dt);
      }
    }

    syncUniforms(time, roomSize, wallInset, config);
    for (const bulb of bulbs) {
      updateTransform(bulb);
    }
    const removalDelay = Math.max(dt, 1 / 60);
    for (let i = bulbs.length - 1; i >= 0; i--) {
      const bulb = bulbs[i];
      if (bulb.shrinking && time - bulb.shrinkStartTime >= SHRINK_DURATION + removalDelay) {
        group.remove(bulb.mesh);
        bulb.material.dispose();
        bulbs.splice(i, 1);
      }
    }
  };

  const syncToRoom = (roomSize: number, wallInset: number, config: JuliaBulbConfig) => {
    if (bulbs.length === 0) {
      const speed = Math.max(0, config.juliaSpeed) * roomSize;
      const targetScale = targetScaleFromConfig(config);
      ensureBulbCount(lastTime, roomSize, wallInset, config, speed, targetScale);
      lastSpeed = speed;
    }
    const targetScale = targetScaleFromConfig(config);
    for (const bulb of bulbs) {
      const scaleFactor = calcScaleFactor(bulb, targetScale, lastTime);
      applyScaleAndClamp(bulb, roomSize, wallInset, scaleFactor);
      updateTransform(bulb);
    }
    syncUniforms(lastTime, roomSize, wallInset, config);
  };

  const reset = (roomSize: number, wallInset: number, config: JuliaBulbConfig, time = 0) => {
    lastTime = time;
    const speed = Math.max(0, config.juliaSpeed) * roomSize;
    lastSpeed = speed;
    while (bulbs.length) {
      const bulb = bulbs.pop();
      if (!bulb) break;
      group.remove(bulb.mesh);
      bulb.material.dispose();
    }
    const count = clampBulbCount(config.juliaBulbCount ?? 1);
    for (let i = 0; i < count; i++) {
      spawnBulb(time, roomSize, wallInset, config, speed);
    }
    syncUniforms(time, roomSize, wallInset, config);
    for (const bulb of bulbs) {
      updateTransform(bulb);
    }
  };

  reset(initialRoomSize, 0, {
    juliaBulbCount: 1,
    juliaScale: 0.32,
    juliaSpeed: 0.05,
    juliaSpin: 0.25,
    juliaPower: 8,
    juliaIterations: 8,
    juliaCX: -0.8,
    juliaCY: -1.0,
    juliaCZ: -0.07,
    juliaZoom: 1.0,
    juliaColorA: '#f4b1ff',
    juliaColorB: '#3bd4ff',
    juliaFogColor: '#0b1424',
    juliaFogDensity: 0.2,
    juliaDepthMix: 0.75,
    juliaDepthCurve: 1.1,
    juliaIntensity: 1.2,
    juliaReflectivity: 0.45,
    juliaMetalness: 0.2,
    juliaRoughness: 0.2,
    juliaMaxSteps: 64,
    juliaSurfaceDistance: 0.001,
  });

  return {
    mesh: group,
    setVisible: (visible) => {
      group.visible = visible;
    },
    syncToRoom,
    update,
    reset,
    dispose: () => {
      while (bulbs.length) {
        const bulb = bulbs.pop();
        if (!bulb) break;
        group.remove(bulb.mesh);
        bulb.material.dispose();
      }
      geometry.dispose();
    },
  };
}
