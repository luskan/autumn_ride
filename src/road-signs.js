import { forestDensity } from './util.js';
import { ROAD_RULES } from './road-rules.js';

export const SIGN_COLS = 4, SIGN_ROWS = 5;
export const SIGN = {
  limit50: [0, 0], limit70: [1, 0], limit90: [2, 0], curveRight: [3, 0],
  curveLeft: [0, 1], deer: [1, 1], chevronRight: [2, 1], chevronLeft: [3, 1],
  backCircle: [0, 2], backTriangle: [1, 2], backRect: [2, 2], backWide: [3, 2],
  distA: [0, 3, 2], distB: [2, 3, 2],
  noOvertaking: [0, 4], endOvertaking: [1, 4],
};

export function signUV(cell) {
  const [cx, cy, span = 1] = cell;
  return { u0: cx / SIGN_COLS, u1: (cx + span) / SIGN_COLS, v0: 1 - (cy + 1) / SIGN_ROWS, v1: 1 - cy / SIGN_ROWS };
}

export function planSigns(track, villages, rules) {
  const M = track.M;
  const list = [];
  const taken = [];
  const free = (s, side, gap = 35) => !taken.some((t) => t.side === side && Math.abs(track.delta(t.s, s)) < gap);
  const add = (o) => {
    o.s = track.wrap(o.s);
    if (!o.required && !free(o.s, o.side, o.gap ?? 35)) return false;
    taken.push({ s: o.s, side: o.side });
    list.push(o);
    return true;
  };

  // Regulatory signs are mandatory and reserve their exact line-transition points
  // before decorative signs are placed. A spacing filter must never drop a B-27.
  for (const section of rules.restrictions) {
    const common = { side: section.dir, dir: section.dir, back: SIGN.backCircle, size: [1.05, 1.05], required: true, restrictionId: section.id };
    add({ ...common, s: section.s, cell: SIGN.noOvertaking, kind: 'no-overtaking' });
    if (section.length < track.length - 1) add({ ...common, s: section.endS, cell: SIGN.endOvertaking, kind: 'end-overtaking' });
  }

  for (const c of rules.curves) {
    const right = c.turn > 0;
    for (const dir of [1, -1]) {
      const entry = dir > 0 ? c.a : c.b;
      const warning = { side: dir, dir, cell: c.turn * dir > 0 ? SIGN.curveRight : SIGN.curveLeft, back: SIGN.backTriangle, size: [1.25, 1.25], kind: 'curve', curveId: c.id };
      let placed = false;
      for (let extra = 0; extra <= 75 && !placed; extra += 25) placed = add({ ...warning, s: entry - dir * (ROAD_RULES.curveSignDistance + extra) });
      if (!placed) add({ ...warning, s: entry - dir * ROAD_RULES.curveSignDistance, required: true, lift: 1.4 });
      if (c.peak > 1 / 260) add({ s: entry - dir * 75, side: dir, dir, cell: SIGN.limit70, back: SIGN.backCircle, size: [1.05, 1.05] });
    }
    if (c.peak > 1 / 300) {
      // chevrons on the outer side, readable from both directions
      const outer = right ? -1 : 1;
      const len = c.b - c.a;
      for (let t = 0.15; t <= 0.86; t += 0.14) {
        add({
          s: c.a + len * t, side: outer, dir: 1, low: true, gap: 8,
          cell: right ? SIGN.chevronRight : SIGN.chevronLeft, back: right ? SIGN.chevronLeft : SIGN.chevronRight, size: [0.85, 0.85],
        });
      }
    }
  }

  // long straights get a 90 limit
  let run = 0;
  for (let i = 0; i < M; i++) {
    run = Math.abs(track.kappa[i]) < 1 / 900 ? run + track.ds : 0;
    if (run > 450) {
      add({ s: i * track.ds - 380, side: 1, dir: 1, cell: SIGN.limit90, back: SIGN.backCircle, size: [1.05, 1.05] });
      run = -2000;
    }
  }

  // wild animals where forest reaches the road
  let deer = 0;
  for (let i = 0; i < M && deer < 5; i += 50) {
    if (forestDensity(track.px[i], track.pz[i]) > 0.4) {
      if (add({ s: i * track.ds - 60, side: 1, dir: 1, cell: SIGN.deer, back: SIGN.backTriangle, size: [1.25, 1.25] })) {
        deer++;
        i += 1500;
      }
    }
  }

  // 50 where the road passes the villages
  for (const v of villages) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < M; i += 10) {
      const d = Math.hypot(track.px[i] - v.x, track.pz[i] - v.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    add({ s: best * track.ds - 260, side: 1, dir: 1, cell: SIGN.limit50, back: SIGN.backCircle, size: [1.05, 1.05] });
    add({ s: best * track.ds + 260, side: 1, dir: 1, cell: SIGN.limit90, back: SIGN.backCircle, size: [1.05, 1.05] });
  }

  // town distances
  let k = 0;
  for (let s = 220; s < track.length - 200; s += 2700) {
    for (let shift = 0; shift < 400; shift += 40) {
      if (add({ s: s + shift, side: 1, dir: 1, wide: true, cell: k % 2 ? SIGN.distB : SIGN.distA, back: SIGN.backWide, size: [3.0, 1.5], gap: 45 })) break;
    }
    k++;
  }
  return list;
}

