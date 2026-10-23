import * as THREE from 'three';
import { COLORS, SUN_DIR } from './config.js';
import { hexToVec3 } from './util.js';

const glslVec3 = (v) => `vec3(${v.map((x) => x.toFixed(5)).join(', ')})`;

// Fog tinted towards the sun. Patched globally so every built-in material uses it.
// Fog is applied after tone mapping, so fogColor and FOG_SUN are display (sRGB) colors.
export function patchFog() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogView = mvPosition.xyz;
  vFogDepth = length( mvPosition.xyz );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogSunV = normalize( ( viewMatrix * vec4( ${glslVec3(SUN_DIR)}, 0.0 ) ).xyz );
  float fogSunAmt = pow( max( dot( normalize( vFogView ), fogSunV ), 0.0 ), 4.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, ${glslVec3(hexToVec3(COLORS.fogSun))}, fogSunAmt ), fogFactor );
#endif`;
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const skyFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uFog;
uniform vec3 uFogSun;
uniform vec3 uSun;
uniform float uTime;
uniform float uLinear;
varying vec3 vDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.02 + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  float sunDot = max(dot(d, uSunDir), 0.0);
  // identical to the patched fog, so the horizon blends with distant terrain
  vec3 horizon = mix(uFog, uFogSun, pow(sunDot, 4.0));

  float t = max(e, 0.0);
  vec3 col = mix(horizon, uMid, smoothstep(0.0, 0.34, t));
  col = mix(col, uZenith, smoothstep(0.28, 0.95, t));
  col += uSun * (pow(sunDot, 8.0) * 0.32 + pow(sunDot, 70.0) * 0.5);

  // wispy, sunset-lit clouds
  if (e > 0.0) {
    vec2 uv = d.xz / (e + 0.1);
    uv = mat2(0.8, -0.6, 0.6, 0.8) * uv;
    float n = fbm(vec2(uv.x * 0.42, uv.y * 1.7) + vec2(uTime * 0.004, 0.0));
    float c = smoothstep(0.53, 0.82, n) * smoothstep(0.35, 0.6, fbm(uv * 0.23 + 4.0));
    c *= smoothstep(0.02, 0.14, e) * (1.0 - smoothstep(0.5, 0.9, e));
    vec3 cc = mix(vec3(1.0, 0.8, 0.64), vec3(1.0, 0.9, 0.66), pow(sunDot, 2.0));
    cc = mix(cc, vec3(0.96, 0.74, 0.7), smoothstep(0.18, 0.5, e) * 0.55);
    cc += uSun * pow(sunDot, 6.0) * 0.3;
    col = mix(col, cc, c * 0.72);
  }

  col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.99955, 0.9998, sunDot));

  // distant forested ridges on the horizon
  float az = atan(d.z, d.x);
  vec2 cp = vec2(cos(az), sin(az));
  float ridgeFar = 0.006 + 0.034 * fbm(cp * 2.3 + 7.0);
  float ridgeNear = 0.001 + 0.024 * fbm(cp * 4.6 + 19.0) + 0.0035 * vnoise(cp * 190.0);
  if (e < ridgeFar) {
    vec3 hillFar = vec3(0.80, 0.55, 0.42);
    col = mix(horizon, hillFar, 0.42 * smoothstep(0.0, ridgeFar, e + 0.004));
  }
  if (e < ridgeNear) {
    float tex = vnoise(vec2(cp.x * 520.0 + cp.y * 310.0, e * 1500.0));
    vec3 hillNear = vec3(0.70, 0.36, 0.2) * (0.8 + 0.35 * tex);
    col = mix(horizon, hillNear, 0.6 * smoothstep(0.0, ridgeNear, e + 0.003));
  }
  if (e < 0.0) col = horizon;

  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  if (uLinear > 0.5) col = pow(col, vec3(2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

function skyMaterial(linear) {
  const v3 = (hex) => new THREE.Vector3(...hexToVec3(hex));
  return new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(...SUN_DIR) },
      uZenith: { value: v3(COLORS.skyZenith) },
      uMid: { value: v3(COLORS.skyMid) },
      uFog: { value: v3(COLORS.fog) },
      uFogSun: { value: v3(COLORS.fogSun) },
      uSun: { value: v3(COLORS.sun) },
      uTime: { value: 0 },
      uLinear: { value: linear ? 1 : 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

// The procedural sky is expensive per pixel, so it is baked once into a cube map
// (raw display colors) and the visible dome only samples it.
export function createSky(renderer, size = 1024) {
  const bakeScene = new THREE.Scene();
  bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), skyMaterial(false)));
  const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, rt);
  cubeCamera.update(renderer, bakeScene);
  bakeScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });

  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: /* glsl */ `
      uniform samplerCube tSky;
      varying vec3 vDir;
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 col = textureCube(tSky, normalize(vDir)).rgb;
        col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
    uniforms: { tSky: { value: rt.texture } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}

export function createEnvironment(renderer) {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(true)));
  // warm ground so reflections below the horizon are not sky-coloured
  const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 32), new THREE.MeshBasicMaterial({ color: '#7a5a30' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
  pmrem.dispose();
  return rt.texture;
}

export function createLights(scene) {
  const sun = new THREE.DirectionalLight('#ffd6a0', 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -95;
  cam.right = 95;
  cam.top = 95;
  cam.bottom = -95;
  cam.near = 1;
  cam.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight('#b4c9e8', '#b08548', 1.25);
  scene.add(hemi);
  return { sun, hemi };
}

const sunVec = new THREE.Vector3(...SUN_DIR);
const lsX = new THREE.Vector3(), lsY = new THREE.Vector3(), tmp = new THREE.Vector3();

// keep the shadow frustum centered ahead of the player, snapped to shadow texels to avoid shimmering
export function updateSun(sun, focus) {
  const cam = sun.shadow.camera;
  const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
  lsX.crossVectors(sunVec, THREE.Object3D.DEFAULT_UP).normalize();
  lsY.crossVectors(lsX, sunVec).normalize();
  const x = Math.round(focus.dot(lsX) / texel) * texel;
  const y = Math.round(focus.dot(lsY) / texel) * texel;
  const z = focus.dot(sunVec);
  tmp.copy(lsX).multiplyScalar(x).addScaledVector(lsY, y).addScaledVector(sunVec, z);
  sun.target.position.copy(tmp);
  sun.position.copy(tmp).addScaledVector(sunVec, 450);
  sun.target.updateMatrixWorld();
}
