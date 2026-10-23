import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// exponential approach, frame-rate independent
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

// picks a key of {key: weight}
export function pickWeighted(rnd, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = rnd() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

const perlin = new ImprovedNoise();

export const noise3 = (x, y, z) => perlin.noise(x, y, z);
export const noise2 = (x, y) => perlin.noise(x, y, 0.37);

// fractal noise, roughly in [-0.6, 0.6] (p05..p95 ~ -0.3..0.3 for 3 octaves)
export function fbm2(x, y, octaves = 3) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise(x * freq, y * freq, 1.7 + i * 3.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---- shared world functions (terrain + vegetation use the same fields) ----

export function naturalHeight(x, z) {
  const big = fbm2(x / 1500, z / 1500, 3) * 95;
  const mid = fbm2(x / 430 + 31.7, z / 430 - 12.3, 3) * 30;
  const small = noise2(x / 85 + 7.1, z / 85 + 3.3) * 2.4;
  return big + mid + small;
}

// 0..1 - how much forest grows here
export function forestDensity(x, z) {
  return smoothstep(0.15, 0.25, fbm2(x / 360 + 11.3, z / 360 - 4.7, 3));
}

export function hexToVec3(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
