import { ROAD } from './config.js';

// Game-scale sight distances, fixed when the road is built (never by player speed).
export const ROAD_RULES = {
  sample: 5, sight: 320, eyeHeight: 1.15,
  curveWarningRadius: 420, tightCurveRadius: 300,
  approach: 35, departure: 20, minRestricted: 80, minOpening: 220,
  warningLength: 84, curveSignDistance: 150,
};

const mod = (i, n) => ((i % n) + n) % n;
const bitFor = dir => dir > 0 ? 1 : 2;

// Circular runs retain an unwrapped end, including a section across the loop seam.
function sections(values, step, active) {
  const n = values.length;
  if (values.every(active)) return [{ a: 0, b: n * step, length: n * step }];
  const runs = [];
  for (let i = 0; i < n; i++) {
    if (!active(values[i]) || active(values[mod(i - 1, n)])) continue;
    let count = 1;
    while (count < n && active(values[(i + count) % n])) count++;
    runs.push({ a: i * step, b: (i + count) * step, length: count * step });
  }
  return runs;
}

export function findCurveSections(track) {
  const curves = [];
  for (const turn of [-1, 1]) {
    for (const run of sections(track.kappa, track.ds, k => k * turn > 1 / ROAD_RULES.curveWarningRadius)) {
      if (run.length < 50) continue;
      let peak = 0;
      for (let s = run.a; s < run.b; s += track.ds) peak = Math.max(peak, Math.abs(track.kappaAt(s)));
      curves.push({ ...run, turn, peak, id: `curve-${curves.length}` });
    }
  }
  return curves;
}

function roadPoint(track, s, lateral) {
  const f = track.wrap(s) / track.ds, i = Math.floor(f), j = (i + 1) % track.M, t = f - i;
  const mix = a => a[i] + (a[j] - a[i]) * t;
  return { x: mix(track.px) + mix(track.rx) * lateral, y: mix(track.py), z: mix(track.pz) + mix(track.rz) * lateral };
}

// Check intermediate targets too: a distant visible hill must not hide a blind dip.
// Terrain catches a hillside inside a bend; the road profile catches raised crests.
export function hasPassingSight(track, terrain, s, dir, options = ROAD_RULES) {
  const eye = roadPoint(track, s, dir * ROAD.laneCenter);
  eye.y += options.eyeHeight;
  for (let distance = 60; distance <= options.sight; distance += 20) {
    const target = roadPoint(track, s + dir * distance, -dir * ROAD.laneCenter);
    target.y += options.eyeHeight;
    for (let d = 10; d < distance; d += 10) {
      const f = d / distance;
      const y = eye.y + (target.y - eye.y) * f;
      if (track.heightAt(s + dir * d) > y) return false;
      if (terrain && terrain.heightAt(eye.x + (target.x - eye.x) * f, eye.z + (target.z - eye.z) * f) > y) return false;
    }
  }
  return true;
}

export class RoadRules {
  constructor(track, masks, curves = [], options = ROAD_RULES) {
    this.track = track;
    this.length = track.length;
    this.masks = masks;
    this.step = this.length / masks.length;
    this.curves = curves;
    this.warningLength = options.warningLength;
    this.restrictions = [];
    this.openDistances = {};
    const n = masks.length;
    for (const dir of [1, -1]) {
      const bit = bitFor(dir);
      for (const run of sections(masks, this.step, m => (m & bit) !== 0)) {
        this.restrictions.push({
          s: track.wrap(dir > 0 ? run.a : run.b), endS: track.wrap(dir > 0 ? run.b : run.a),
          length: run.length, dir, id: `restriction-${this.restrictions.length}`,
        });
      }
      const distances = new Float32Array(n);
      if (!masks.some(m => m & bit)) distances.fill(Infinity);
      else {
        let open = 0;
        for (let k = 2 * n - 1; k >= 0; k--) {
          const i = dir > 0 ? k % n : n - 1 - k % n;
          open = masks[i] & bit ? 0 : open + this.step;
          if (k < n) distances[i] = open;
        }
      }
      this.openDistances[dir] = distances;
    }
    this.runs = [];
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * this.step;
      let warning = 0;
      for (const dir of [1, -1]) {
        const available = this.availableDistance(s, dir);
        if (available > 0 && available <= this.warningLength) warning |= bitFor(dir);
      }
      const code = masks[i] | (warning << 2);
      const last = this.runs.at(-1);
      if (last?.code === code) last.b = (i + 1) * this.step;
      else this.runs.push({ a: i * this.step, b: (i + 1) * this.step, code, mask: masks[i], warning });
    }
  }

  index(s, dir = 1) {
    return Math.floor(this.track.wrap(s - (dir < 0 ? 1e-7 : 0)) / this.step) % this.masks.length;
  }

  allowsPassing(s, dir = 1) {
    return (this.masks[this.index(s, dir)] & bitFor(dir)) === 0;
  }

  availableDistance(s, dir = 1) {
    const i = this.index(s, dir);
    const distance = this.openDistances[dir][i];
    if (distance === 0) return 0;
    const offset = this.track.wrap(s - i * this.step);
    return Math.max(0, distance - (dir > 0 ? offset : this.step - offset));
  }

  canCompletePass(s, distance, dir = 1) {
    return this.allowsPassing(s, dir) && this.availableDistance(s, dir) >= distance;
  }

  markingAt(s) {
    const mask = this.masks[this.index(s)];
    if (mask === 3) return 'solid';
    if (mask === 1) return 'solid-forward';
    if (mask === 2) return 'solid-reverse';
    return Math.min(this.availableDistance(s, 1), this.availableDistance(s, -1)) <= this.warningLength ? 'warning' : 'dashed';
  }
}

export function buildRoadRules(track, terrain, options = {}) {
  const opt = { ...ROAD_RULES, ...options };
  const n = Math.ceil(track.length / opt.sample), step = track.length / n;
  const curves = findCurveSections(track);
  const masks = new Uint8Array(n);
  for (const dir of [1, -1]) {
    const blocked = new Uint8Array(n);
    const mark = (a, b) => {
      for (let i = Math.floor(a / step); i < Math.ceil(b / step); i++) blocked[mod(i, n)] = 1;
    };
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * step;
      if (!hasPassingSight(track, terrain, s, dir, opt)) blocked[i] = 1;
    }
    for (const curve of curves) {
      if (curve.peak > 1 / opt.tightCurveRadius) mark(curve.a, curve.b);
    }
    // Extend each hazard before entering it; never cut a short unsafe section away.
    for (const run of sections(blocked, step, Boolean)) {
      const extra = Math.max(0, opt.minRestricted - run.length) / 2;
      mark(run.a - extra - (dir > 0 ? opt.approach : opt.departure), run.b + extra + (dir > 0 ? opt.departure : opt.approach));
    }
    for (const gap of sections(blocked, step, v => !v)) {
      if (gap.length < opt.minOpening) mark(gap.a, gap.b);
    }
    for (let i = 0; i < n; i++) if (blocked[i]) masks[i] |= bitFor(dir);
  }
  return new RoadRules(track, masks, curves, opt);
}
