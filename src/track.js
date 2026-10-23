import { mulberry32, naturalHeight, lerp } from './util.js';

const HASH_CELL = 40;
const hashKey = (cx, cz) => (cx + 512) * 1024 + (cz + 512);

function circularBlur(src, radius, passes) {
  const n = src.length;
  let a = Float64Array.from(src);
  let b = new Float64Array(n);
  const w = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += a[(k + n) % n];
    for (let i = 0; i < n; i++) {
      b[i] = sum / w;
      sum += a[(i + radius + 1) % n] - a[(i - radius + n) % n];
    }
    [a, b] = [b, a];
  }
  return a;
}

function maxGrade(h, ds) {
  const n = h.length;
  let g = 0;
  for (let i = 0; i < n; i++) {
    g = Math.max(g, Math.abs(h[(i + 1) % n] - h[(i - 1 + n) % n]) / (2 * ds));
  }
  return g;
}

// harmonic amplitudes of the polar road shape r(theta)
const HARMONICS = { 2: 170, 3: 130, 4: 85, 5: 62, 6: 48, 7: 38, 8: 30, 9: 24, 11: 16, 13: 11 };

function tryBuild(seed) {
  const rnd = mulberry32(seed);
  const harm = Object.entries(HARMONICS).map(([k, a]) => ({ k: +k, a: a * (0.55 + rnd() * 0.7), p: rnd() * Math.PI * 2 }));
  const R0 = 1300;
  // a polar curve never crosses itself; sample it finely, then resample by arc length
  const n = 24000;
  const fx = new Float64Array(n + 1), fz = new Float64Array(n + 1), acc = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    let r = R0;
    for (const h of harm) r += h.a * Math.cos(h.k * th + h.p);
    fx[i] = r * Math.cos(th);
    fz[i] = r * Math.sin(th);
    if (i > 0) acc[i] = acc[i - 1] + Math.hypot(fx[i] - fx[i - 1], fz[i] - fz[i - 1]);
  }
  const length = acc[n];
  const M = Math.round(length);
  const ds = length / M;

  const px = new Float32Array(M);
  const pz = new Float32Array(M);
  const hRaw = new Float64Array(M);
  let j = 0;
  for (let i = 0; i < M; i++) {
    const s = i * ds;
    while (acc[j + 1] < s) j++;
    const t = (s - acc[j]) / (acc[j + 1] - acc[j]);
    px[i] = lerp(fx[j], fx[j + 1], t);
    pz[i] = lerp(fz[j], fz[j + 1], t);
    hRaw[i] = naturalHeight(px[i], pz[i]);
  }

  // the road follows a heavily smoothed terrain profile, with a grade limit
  let h = circularBlur(hRaw, 90, 3);
  const g = maxGrade(h, ds);
  if (g > 0.07) {
    let mean = 0;
    for (let i = 0; i < M; i++) mean += h[i];
    mean /= M;
    const k = 0.07 / g;
    for (let i = 0; i < M; i++) h[i] = mean + (h[i] - mean) * k;
  }
  const py = Float32Array.from(h);

  const tx = new Float32Array(M), ty = new Float32Array(M), tz = new Float32Array(M);
  const rx = new Float32Array(M), rz = new Float32Array(M);
  const ux = new Float32Array(M), uy = new Float32Array(M), uz = new Float32Array(M);
  const hx = new Float32Array(M), hz = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const a = (i - 1 + M) % M;
    const b = (i + 1) % M;
    let x = px[b] - px[a], y = py[b] - py[a], z = pz[b] - pz[a];
    let l = Math.hypot(x, y, z);
    tx[i] = x / l; ty[i] = y / l; tz[i] = z / l;
    l = Math.hypot(x, z);
    hx[i] = x / l; hz[i] = z / l;
    // right = T x up (horizontal)
    rx[i] = -hz[i]; rz[i] = hx[i];
    // up = R x T
    ux[i] = 0 * tz[i] - rz[i] * ty[i];
    uy[i] = rz[i] * tx[i] - rx[i] * tz[i];
    uz[i] = rx[i] * ty[i] - 0 * tx[i];
    l = Math.hypot(ux[i], uy[i], uz[i]);
    ux[i] /= l; uy[i] /= l; uz[i] /= l;
  }

  // signed horizontal curvature, > 0 means the road bends right
  let kap = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const a = (i - 1 + M) % M;
    const b = (i + 1) % M;
    kap[i] = ((hx[b] - hx[a]) * rx[i] + (hz[b] - hz[a]) * rz[i]) / (2 * ds);
  }
  kap = circularBlur(kap, 12, 2);
  let maxK = 0;
  for (let i = 0; i < M; i++) maxK = Math.max(maxK, Math.abs(kap[i]));
  if (maxK > 1 / 130) return null;

  // distant parts of the loop must stay far from each other
  const step = 10;
  for (let i = 0; i < M; i += step) {
    for (let j = i + 40 * step; j < M; j += step) {
      const sep = Math.min(j - i, M - (j - i));
      if (sep < 400) continue;
      if (Math.hypot(px[i] - px[j], pz[i] - pz[j]) < 240) return null;
    }
  }

  return new Track({ M, ds, length, px, py, pz, tx, ty, tz, rx, rz, ux, uy, uz, kappa: Float32Array.from(kap), seed });
}

export function buildTrack(seed) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const t = tryBuild(seed + attempt * 7919);
    if (t) return t;
  }
  throw new Error('Track generation failed');
}

const nearestResult = { dist: 0, i: 0, h: 0, side: 0 };

export class Track {
  constructor(d) {
    Object.assign(this, d);
    this.buildHash();
  }

  wrap(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  // shortest signed distance from a to b along the loop
  delta(a, b) {
    let d = b - a;
    d -= Math.round(d / this.length) * this.length;
    return d;
  }

  index(s) {
    return Math.floor(this.wrap(s) / this.ds) % this.M;
  }

  // out = { pos, T, R, U } of THREE.Vector3
  frameAt(s, out) {
    const f = this.wrap(s) / this.ds;
    let i = Math.floor(f);
    const t = f - i;
    i %= this.M;
    const j = (i + 1) % this.M;
    out.pos.set(lerp(this.px[i], this.px[j], t), lerp(this.py[i], this.py[j], t), lerp(this.pz[i], this.pz[j], t));
    out.T.set(lerp(this.tx[i], this.tx[j], t), lerp(this.ty[i], this.ty[j], t), lerp(this.tz[i], this.tz[j], t)).normalize();
    out.R.set(lerp(this.rx[i], this.rx[j], t), 0, lerp(this.rz[i], this.rz[j], t)).normalize();
    out.U.set(lerp(this.ux[i], this.ux[j], t), lerp(this.uy[i], this.uy[j], t), lerp(this.uz[i], this.uz[j], t)).normalize();
    return out;
  }

  heightAt(s) {
    const f = this.wrap(s) / this.ds;
    let i = Math.floor(f);
    const t = f - i;
    i %= this.M;
    return lerp(this.py[i], this.py[(i + 1) % this.M], t);
  }

  kappaAt(s) {
    return this.kappa[this.index(s)];
  }

  // world position of a point at distance s, lateral offset d, height h above the road
  pointAt(s, d, h, out, frame) {
    this.frameAt(s, frame);
    return out.copy(frame.pos).addScaledVector(frame.R, d).addScaledVector(frame.U, h);
  }

  buildHash() {
    this.hash = new Map();
    for (let i = 0; i < this.M; i += 2) {
      const k = hashKey(Math.floor(this.px[i] / HASH_CELL), Math.floor(this.pz[i] / HASH_CELL));
      let list = this.hash.get(k);
      if (!list) this.hash.set(k, (list = []));
      list.push(i);
    }
  }

  // nearest road sample within maxDist; returns a shared object or null
  nearest(x, z, maxDist) {
    const r = Math.ceil(maxDist / HASH_CELL);
    const cx = Math.floor(x / HASH_CELL);
    const cz = Math.floor(z / HASH_CELL);
    let best = maxDist * maxDist;
    let bi = -1;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gz = cz - r; gz <= cz + r; gz++) {
        const list = this.hash.get(hashKey(gx, gz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          const dx = x - this.px[i], dz = z - this.pz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bi = i; }
        }
      }
    }
    if (bi < 0) return null;
    // refine against the neighbouring samples
    for (let k = -1; k <= 1; k += 2) {
      const i = (bi + k + this.M) % this.M;
      const dx = x - this.px[i], dz = z - this.pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    nearestResult.dist = Math.sqrt(best);
    nearestResult.i = bi;
    nearestResult.h = this.py[bi];
    nearestResult.side = Math.sign((x - this.px[bi]) * this.rx[bi] + (z - this.pz[bi]) * this.rz[bi]);
    return nearestResult;
  }

  // coarse distance-to-road field for far-away queries
  buildDistanceField(size, cell) {
    const n = Math.ceil(size / cell) + 1;
    const field = new Float32Array(n * n);
    const sub = [];
    for (let i = 0; i < this.M; i += 12) sub.push(this.px[i], this.pz[i]);
    for (let iz = 0; iz < n; iz++) {
      const z = -size / 2 + iz * cell;
      for (let ix = 0; ix < n; ix++) {
        const x = -size / 2 + ix * cell;
        let best = Infinity;
        for (let k = 0; k < sub.length; k += 2) {
          const dx = x - sub[k], dz = z - sub[k + 1];
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
        }
        field[iz * n + ix] = Math.sqrt(best);
      }
    }
    this.dfield = { n, cell, size, field };
  }

  coarseDistance(x, z) {
    const { n, cell, size, field } = this.dfield;
    const fx = Math.min(Math.max((x + size / 2) / cell, 0), n - 1.001);
    const fz = Math.min(Math.max((z + size / 2) / cell, 0), n - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const a = field[iz * n + ix], b = field[iz * n + ix + 1];
    const c = field[(iz + 1) * n + ix], d = field[(iz + 1) * n + ix + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
}
