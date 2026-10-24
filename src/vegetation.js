import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from './config.js';
import { forestDensity, noise3, smoothstep, pick, pickWeighted, mulberry32 } from './util.js';
import { foliageMaterial } from './materials.js';
import { StaticInstances } from './static-instances.js';

const PALETTES = {
  orange: ['#e0721c', '#f0912a', '#c75516', '#f6ac3a', '#d8641a'],
  red: ['#b52e1a', '#d24722', '#8e2214', '#e2622c', '#c23a1c'],
  yellow: ['#e6b22a', '#f0c944', '#cf9420', '#f5d968', '#dca52a'],
  amber: ['#d98824', '#b9481c', '#e9ad38', '#a8601c', '#cf6e22'],
  green: ['#9a9c38', '#b9ad3e', '#7f8a34', '#d2bd4a', '#a48a30'],
  // shrubs: deeper, browner tones than the tree crowns
  burgundy: ['#7a1f1c', '#9c2a1e', '#5e1a18', '#b23a22'],
  rust: ['#a2481d', '#c0602a', '#7e3a1a', '#d07a34'],
  olive: ['#7d7a2e', '#958a36', '#5f5f26', '#c08a30'],
};

// Deciduous trees are generated from these parameters: total height h, crown radius r,
// where the crown starts (fraction of the height), number of branches and crown lumps.
const SPECIES = {
  oak: { palette: 'orange', accent: 'red', bark: '#4a3424', h: [8.6, 10.6], r: [3.5, 4.3], base: 0.34, trunkR: 0.34, branches: 4, lumps: [7, 9] },
  maple: { palette: 'red', accent: 'orange', bark: '#46301f', h: [7.6, 9.2], r: [3.1, 3.7], base: 0.32, trunkR: 0.3, branches: 4, lumps: [6, 8] },
  amber: { palette: 'amber', accent: 'yellow', bark: '#4a3424', h: [8.0, 9.6], r: [3.2, 3.9], base: 0.34, trunkR: 0.3, branches: 3, lumps: [6, 8] },
  late: { palette: 'green', accent: 'yellow', bark: '#4a3424', h: [8.4, 10.0], r: [3.3, 4.0], base: 0.36, trunkR: 0.3, branches: 3, lumps: [6, 8] },
  birch: { palette: 'yellow', accent: 'amber', bark: '#e4dfd4', h: [10, 12], r: [2.0, 2.5], base: 0.3, trunkR: 0.2, branches: 3, lumps: [9, 11], birch: true },
};
const BUSH_PALETTES = { bushBurgundy: 'burgundy', bushRust: 'rust', bushOlive: 'olive' };
const BUSHES = Object.keys(BUSH_PALETTES);
const TREE_WEIGHTS = { oak: 0.27, maple: 0.22, amber: 0.2, birch: 0.12, late: 0.1, spruce: 0.09 };
const VARIANTS = 3; // shapes per species, so a forest is not made of clones
// LOD switch distances (m) for trees / bushes
const LOD_TREE = [150, 470];
const LOD_BUSH = [85, 300];

const lerp = (a, b, t) => a + (b - a) * t;
const UP = new THREE.Vector3(0, 1, 0);

function finish(g, colorFn) {
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    colorFn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// tapered cylinder from point a to point b (trunks, branches, twigs)
function limb(a, b, r0, r1, sides, segments, colorFn) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, segments, true);
  g.deleteAttribute('uv');
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return finish(g, colorFn);
}

function barkColor(hex, birch, rnd) {
  const base = new THREE.Color(hex);
  return (c, x, y) => {
    c.copy(base).multiplyScalar(birch ? (rnd() < 0.3 ? 0.35 : 1) : 0.85 + 0.25 * rnd());
    if (y < 0.4) c.multiplyScalar(0.7);
  };
}

// One lump of foliage: a noise-displaced icosahedron. l = { x, y, z, r, ry?, c0, c1, seed }
// env = { center, rx, ry } is the whole crown, used for soft normals and shading.
function lumpGeo(l, detail, env) {
  const rnd = mulberry32(l.seed);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const seed = (l.seed % 1000) / 10;
  const ry = l.ry ?? l.r;
  const pos = g.attributes.position;
  const bumps = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise3(x * 1.9 + seed, y * 1.9, z * 1.9 - seed);
    bumps[i] = n;
    const k = 1 + (l.rough ?? 0.24) * n;
    pos.setXYZ(i, l.x + x * l.r * k, l.y + y * ry * k * (y < 0 ? 0.8 : 0.95), l.z + z * l.r * k);
  }
  g.computeVertexNormals();
  const { center, rx, ry: ery } = env;
  // blend towards the crown's ellipsoid normal for soft, fluffy shading
  const nor = g.attributes.normal;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set((pos.getX(i) - center.x) / (rx * rx), (pos.getY(i) - center.y) / (ery * ery), (pos.getZ(i) - center.z) / (rx * rx)).normalize();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, 0.55).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  const c0 = new THREE.Color(l.c0), c1 = new THREE.Color(l.c1);
  return finish(g, (c, x, y, z, i) => {
    c.copy(c0).lerp(c1, smoothstep(-0.25, 0.25, noise3(x * 0.9 + seed, y * 0.9, z * 0.9)));
    // lighter on top, darker underneath and deep inside the crown
    let shade = 0.5 + 0.55 * smoothstep(center.y - ery, center.y + ery, y);
    const e = Math.hypot((x - center.x) / rx, (y - center.y) / ery, (z - center.z) / rx);
    shade *= 0.62 + 0.38 * smoothstep(0.45, 0.95, e);
    shade *= 0.8 + 0.35 * smoothstep(-0.5, 0.5, bumps[i]);
    shade *= 0.88 + rnd() * 0.24;
    c.multiplyScalar(shade);
  });
}

// Shape of one tree variant, shared by all of its LODs (so nothing pops but detail).
function treeShape(sp, seed) {
  const rnd = mulberry32(seed);
  const H = lerp(sp.h[0], sp.h[1], rnd());
  const R = lerp(sp.r[0], sp.r[1], rnd());
  const bottom = H * sp.base * (0.9 + rnd() * 0.2);
  const Ry = (H - bottom) / 2;
  const lean = (rnd() - 0.5) * 0.6, leanA = rnd() * Math.PI * 2;
  const center = new THREE.Vector3(Math.cos(leanA) * lean, bottom + Ry, Math.sin(leanA) * lean);
  const pal = PALETTES[sp.palette], acc = PALETTES[sp.accent];
  const colors = () => {
    const p = rnd() < 0.2 ? acc : pal;
    return { c0: pick(rnd, p), c1: pick(rnd, pal), seed: Math.floor(rnd() * 1e9) };
  };
  // a core lump keeps the crown closed, the others give it an irregular outline
  const lumps = [{ x: center.x, y: center.y, z: center.z, r: R * 0.8, ry: Ry * 0.82, ...colors() }];
  const count = sp.lumps[0] + 2 + Math.floor(rnd() * (sp.lumps[1] - sp.lumps[0] + 1));
  const lumpR = (R + Ry) / 2;
  for (let k = 0; k < count; k++) {
    // lumps overlap the core, so the crown reads as one mass with a bumpy outline
    const a = rnd() * Math.PI * 2;
    const up = -0.65 + rnd() * 1.5;
    const horiz = Math.sqrt(Math.max(0, 1 - up * up));
    const d = 0.38 + rnd() * 0.3;
    lumps.push({ x: center.x + Math.cos(a) * horiz * R * d, y: center.y + up * Ry * d, z: center.z + Math.sin(a) * horiz * R * d, r: lumpR * (0.34 + rnd() * 0.2), ...colors() });
  }
  const side = lumps.slice(1).sort((p, q) => q.r - p.r);
  // branches leave the trunk below the crown and end inside the biggest side lumps
  const base = new THREE.Vector3(0, -0.4, 0);
  const branches = side.slice(0, sp.branches).map((l) => {
    const t = (bottom * (0.8 + rnd() * 0.25) - base.y) / (center.y - base.y);
    const from = base.clone().lerp(center, Math.min(0.92, t));
    const to = from.clone().lerp(new THREE.Vector3(l.x, l.y, l.z), 0.75);
    return { from, to };
  });
  return { H, R, Ry, bottom, center, lumps: [lumps[0], ...side], branches, base, barkSeed: Math.floor(rnd() * 1e9) };
}

function treeGeo(sp, shape, lod) {
  const rnd = mulberry32(shape.barkSeed);
  const color = barkColor(sp.bark, !!sp.birch, rnd);
  const { center, R, Ry, base } = shape;
  const env = { center, rx: R, ry: Ry };
  // the trunk reaches the middle of the crown, so it never ends below the foliage
  const parts = [limb(base, center, sp.trunkR, sp.trunkR * 0.45, [7, 5, 4][lod], lod === 0 ? 4 : 1, color)];
  const nBranches = [shape.branches.length, 2, 0][lod];
  for (const b of shape.branches.slice(0, nBranches)) parts.push(limb(b.from, b.to, sp.trunkR * 0.42, sp.trunkR * 0.18, lod === 0 ? 5 : 4, 1, color));
  if (lod === 2) {
    parts.push(lumpGeo({ ...shape.lumps[0], r: R * 0.95, ry: Ry * 0.98 }, 1, env));
  } else {
    const lumps = lod === 1 ? shape.lumps.slice(0, 4) : shape.lumps;
    lumps.forEach((l, i) => parts.push(lumpGeo(i === 0 && lod === 1 ? { ...l, r: l.r * 1.12 } : l, lod === 0 && i === 0 ? 2 : 1, env)));
  }
  const geometry = mergeGeometries(parts);
  // A point safely inside the closed crown, including its distant LOD.
  geometry.userData.canopy = { center: center.clone(), radius: Math.min(R, Ry) * 0.4, width: R, height: Ry };
  return geometry;
}

// Shrub: a low dome of many small lumps with a few twigs, sunk slightly into the ground.
function bushShape(paletteName, seed) {
  const rnd = mulberry32(seed);
  const pal = PALETTES[paletteName];
  const W = 0.65 + rnd() * 0.35; // half width
  const Hb = 0.85 + rnd() * 0.5; // height
  const center = new THREE.Vector3(0, Hb * 0.3, 0);
  const colors = () => ({ c0: pick(rnd, pal), c1: pick(rnd, pal), seed: Math.floor(rnd() * 1e9) });
  const lumps = [{ x: 0, y: Hb * 0.34, z: 0, r: W * 0.62, ry: Hb * 0.5, rough: 0.32, ...colors() }];
  const n = 13 + Math.floor(rnd() * 5);
  for (let k = 0; k < n; k++) {
    const rho = Math.sqrt(rnd()) * W * 0.85, a = rnd() * Math.PI * 2;
    const y = Hb * 0.62 * Math.sqrt(Math.max(0, 1 - (rho / W) ** 2)) + (rnd() - 0.5) * 0.16;
    lumps.push({ x: Math.cos(a) * rho, y, z: Math.sin(a) * rho, r: (0.16 + rnd() * 0.16) * (1.3 - 0.5 * (rho / W)), rough: 0.34, ...colors() });
  }
  const twigs = [];
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2, r0 = rnd() * W * 0.25, out = W * (0.45 + rnd() * 0.6);
    twigs.push({
      from: new THREE.Vector3(Math.cos(a) * r0, -0.1, Math.sin(a) * r0),
      to: new THREE.Vector3(Math.cos(a) * out, Hb * (0.75 + rnd() * 0.55), Math.sin(a) * out),
    });
  }
  return { W, Hb, center, lumps: [lumps[0], ...lumps.slice(1).sort((p, q) => q.r - p.r)], twigs, barkSeed: Math.floor(rnd() * 1e9) };
}

function bushGeo(shape, lod) {
  const { W, Hb, center } = shape;
  const env = { center, rx: W, ry: Hb * 0.6 };
  const parts = [];
  const rnd = mulberry32(shape.barkSeed);
  const nTwigs = [7, 3, 0][lod];
  for (const t of shape.twigs.slice(0, nTwigs)) parts.push(limb(t.from, t.to, 0.035, 0.012, 3, 1, barkColor('#3e2a1c', false, rnd)));
  const lumps = [shape.lumps, shape.lumps.slice(0, 6), shape.lumps.slice(0, 3)][lod];
  lumps.forEach((l, i) => parts.push(lumpGeo(lod === 2 && i === 0 ? { ...l, r: l.r * 1.25 } : l, lod === 0 ? 1 : 0, env)));
  return mergeGeometries(parts);
}

function coniferGeo(lod, rnd) {
  const parts = [limb(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, 3.5, 0), 0.3, 0.16, lod === 0 ? 6 : 4, 1, barkColor('#4a3424', false, rnd))];
  const tiers = lod === 2 ? [[2.4, 1.0, 9.0]] : [[2.7, 1.2, 4.2], [2.2, 3.4, 3.6], [1.6, 5.4, 3.0], [1.0, 7.2, 2.4]];
  const sides = lod === 0 ? 9 : 6;
  const dark = new THREE.Color('#2c4428'), light = new THREE.Color('#58743c');
  for (const [r, y0, h] of tiers) {
    const g = new THREE.ConeGeometry(r, h, sides, 1, true);
    g.deleteAttribute('uv');
    g.translate(0, y0 + h / 2, 0);
    parts.push(finish(g, (c, x, y) => {
      c.copy(dark).lerp(light, smoothstep(y0, y0 + h, y) * 0.6 + rnd() * 0.25);
    }));
  }
  return mergeGeometries(parts);
}

// [variant][lod] geometries for every kind
function buildGeometries(seed) {
  const out = {};
  let k = 0;
  for (const [name, sp] of Object.entries(SPECIES)) {
    out[name] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const shape = treeShape(sp, seed * 131 + k * 17 + v);
      out[name].push([0, 1, 2].map((lod) => treeGeo(sp, shape, lod)));
    }
    k++;
  }
  for (const [name, pal] of Object.entries(BUSH_PALETTES)) {
    out[name] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const shape = bushShape(pal, seed * 131 + k * 17 + v);
      out[name].push([0, 1, 2].map((lod) => bushGeo(shape, lod)));
    }
    k++;
  }
  out.spruce = [[0, 1, 2].map((lod) => coniferGeo(lod, mulberry32(seed + 7)))];
  return out;
}

export class Vegetation {
  constructor(track, terrain, { villages = [], seed = 1 } = {}) {
    const rnd = mulberry32(seed);
    this.items = this.place(track, terrain, villages, rnd);
    // Bring a few existing deciduous trees over the forest verge. This keeps the
    // original tree count and gives the fallen leaves a visible source.
    this.roadsideMoved = this.moveRoadsideTrees(this.items, track, terrain, villages, mulberry32(seed + 1049));

    const geos = buildGeometries(seed);
    const mat = foliageMaterial({ vertexColors: true }, { glow: 0.45 });
    const bm = new StaticInstances(this.items.length, mat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    bm.name = 'trees';
    this.ids = {};
    for (const name in geos) this.ids[name] = geos[name].map((variant) => variant.map((g) => bm.addGeometry(g)));

    const n = this.items.length;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.lod = new Int8Array(n);
    this.kindOf = [];
    this.isBush = new Uint8Array(n);
    // grass grows around shrubs near the road so they sit in the field instead of on it
    this.bushSpots = [];
    this.canopies = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    this.items.forEach((it, idx) => {
      const variants = this.ids[it.kind];
      const variant = Math.floor(rnd() * variants.length) % variants.length;
      const lods = variants[variant];
      const id = bm.addInstance(lods[2]);
      e.set((rnd() - 0.5) * 0.08, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.08);
      q.setFromEuler(e);
      s.set(it.scale * (0.9 + rnd() * 0.2), it.scale * (0.9 + rnd() * 0.25), it.scale * (0.9 + rnd() * 0.2));
      p.set(it.x, it.y, it.z);
      bm.setMatrixAt(id, m.compose(p, q, s));
      const b = 0.84 + rnd() * 0.28;
      bm.setColorAt(id, col.setRGB(b, b * (0.94 + rnd() * 0.1), b * (0.9 + rnd() * 0.12)));
      this.px[idx] = it.x;
      this.pz[idx] = it.z;
      this.lod[idx] = 2;
      this.kindOf[idx] = lods;
      const bush = BUSHES.includes(it.kind);
      this.isBush[idx] = bush ? 1 : 0;
      if (bush && it.near < 45) this.bushSpots.push({ x: it.x, y: it.y, z: it.z, w: it.scale });
      const canopy = geos[it.kind][variant][2].userData.canopy;
      if (canopy) {
        const center = canopy.center.clone().applyMatrix4(m);
        this.canopies.push({
          x: center.x, y: center.y, z: center.z,
          radius: canopy.radius * Math.min(s.x, s.y, s.z),
          width: canopy.width * Math.max(s.x, s.z),
          top: center.y + canopy.height * s.y,
        });
      }
    });
    bm.buildSpatialIndex(this.kindOf);
    this.mesh = bm;
    this.frame = 0;
  }

  place(track, terrain, villages, rnd) {
    const items = [];
    const STEP = 9;
    const half = terrain.size / 2 - 30;
    for (let gz = -half; gz < half; gz += STEP) {
      for (let gx = -half; gx < half; gx += STEP) {
        const x = gx + rnd() * STEP, z = gz + rnd() * STEP;
        const r1 = rnd(), r2 = rnd();
        const cd = track.coarseDistance(x, z);
        if (cd > 1150) continue;
        let near = 1e9;
        if (cd < 110) {
          const q = track.nearest(x, z, 120);
          if (q) near = q.dist;
        }
        if (near < ROAD.half + 3.4) continue;
        let villageFactor = 1;
        for (const v of villages) {
          const d = Math.hypot(x - v.x, z - v.z);
          if (d < v.radius) villageFactor = Math.min(villageFactor, v.blocked(x, z) ? 0 : 0.12);
        }
        if (villageFactor === 0) continue;
        const f = forestDensity(x, z);
        let p = f * 0.85 + 0.008;
        if (near < 36) p += 0.1 * (1 - (near - 8.8) / 27);
        if (cd > 380) p *= 0.42;
        p *= villageFactor;
        if (r1 > p) continue;

        let kind;
        if ((near < 24 && r2 < 0.62) || (f < 0.45 && r2 < 0.3)) kind = BUSHES[Math.floor(rnd() * BUSHES.length)];
        else kind = pickWeighted(rnd, TREE_WEIGHTS);
        const bush = BUSHES.includes(kind);
        let scale = bush ? 0.85 + rnd() * 0.45 : 0.78 + rnd() * 0.45;
        if (cd > 380 && !bush) scale *= 1.25;
        items.push({ kind, x, z, y: terrain.heightAt(x, z) - (bush ? 0.12 : 0.25), scale, near });
      }
    }
    return items;
  }

  moveRoadsideTrees(items, track, terrain, villages, rnd) {
    const moved = [];
    const f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
    for (const it of items) {
      if (!['oak', 'maple', 'amber', 'birch'].includes(it.kind) || it.near < 8.8 || it.near > 20) continue;
      if (forestDensity(it.x, it.z) < 0.55 || rnd() > 0.5) continue;
      const q = track.nearest(it.x, it.z, 24);
      if (!q || !q.side) continue;
      const s = q.i * track.ds, side = q.side;
      if (moved.some(o => o.side === side && Math.abs(track.delta(o.s, s)) < 24)) continue;
      track.frameAt(s, f);
      const d = side * (7.15 + rnd() * 1.25);
      const x = f.pos.x + f.R.x * d, z = f.pos.z + f.R.z * d;
      if (villages.some(v => Math.hypot(v.x - x, v.z - z) < v.radius)) continue;
      if (items.some(other => other !== it && !BUSHES.includes(other.kind) && Math.hypot(other.x - x, other.z - z) < 3.6)) continue;
      it.x = x;
      it.z = z;
      it.y = terrain.heightAt(x, z) - 0.25;
      it.near = Math.abs(d);
      it.movedRoadside = true;
      moved.push({ s, side });
    }
    return moved.length;
  }

  update(camera, shadowCamera = null) {
    const cx = camera.position.x, cz = camera.position.z;
    const bm = this.mesh;
    if (this.frame++ % 10 === 0) {
      for (let i = 0; i < this.px.length; i++) {
        const dx = this.px[i] - cx, dz = this.pz[i] - cz;
        const d2 = dx * dx + dz * dz;
        const t = this.isBush[i] ? LOD_BUSH : LOD_TREE;
        const lod = d2 < t[0] * t[0] ? 0 : d2 < t[1] * t[1] ? 1 : 2;
        if (lod !== this.lod[i]) {
          this.lod[i] = lod;
          bm.setGeometryIdAt(i, this.kindOf[i][lod]);
        }
      }
    }
    bm.updateVisibility(camera, shadowCamera);
  }
}

// ---- dry grass tufts along the road, one instanced mesh per road chunk and variant ----
// around: [{ x, y, z, w }] spots (shrubs) that get a ring of tufts
export function buildGrass(track, terrain, textures, seed, chunkSize, around = []) {
  const rnd = mulberry32(seed);
  const plane = (rot) => {
    const g = new THREE.PlaneGeometry(1.4, 1.0, 1, 1);
    g.translate(0, 0.5, 0);
    g.rotateY(rot);
    return g;
  };
  const geo = mergeGeometries([plane(0), plane(Math.PI / 3), plane((2 * Math.PI) / 3)]);
  const nor = geo.attributes.normal;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);

  const skirtHeight = (ad) => (ad < ROAD.half ? -0.02 : ad < ROAD.half + 1.2 ? -0.35 * ((ad - ROAD.half) / 1.2) : -0.35 - 0.75 * ((ad - ROAD.half - 1.2) / 1.4));
  const frame = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
  const nChunks = Math.ceil(track.M / chunkSize);
  const buckets = Array.from({ length: nChunks * 2 }, () => []);
  for (let s = 0; s < track.length; s += 0.42) {
    for (const sgn of [-1, 1]) {
      if (rnd() < 0.12) continue;
      const far = rnd() < 0.1;
      const ad = far ? 26 + rnd() * 30 : ROAD.half - 0.25 + 20 * Math.pow(rnd(), 2.2);
      const ss = s + rnd() * 0.42;
      track.frameAt(ss, frame);
      const x = frame.pos.x + frame.R.x * ad * sgn;
      const z = frame.pos.z + frame.R.z * ad * sgn;
      let y = terrain.heightAt(x, z);
      if (ad < ROAD.half + 2.6) y = Math.max(y, frame.pos.y + skirtHeight(ad));
      const flower = rnd() < (ad < 12 ? 0.24 : 0.12) ? 1 : 0;
      const chunk = Math.min(nChunks - 1, Math.floor(track.wrap(ss) / track.ds / chunkSize));
      buckets[chunk * 2 + flower].push({ x, y, z, s: 0.55 + rnd() * 0.8 });
    }
  }
  for (const spot of around) {
    const q = track.nearest(spot.x, spot.z, 80);
    if (!q) continue;
    const chunk = Math.min(nChunks - 1, Math.floor(q.i / chunkSize));
    const n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = spot.w * (0.7 + rnd() * 0.6);
      const x = spot.x + Math.cos(a) * d, z = spot.z + Math.sin(a) * d;
      buckets[chunk * 2 + (rnd() < 0.15 ? 1 : 0)].push({ x, y: terrain.heightAt(x, z), z, s: 0.6 + rnd() * 0.5 });
    }
  }

  const mats = [0, 1].map((v) => foliageMaterial({ map: textures[v], alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide }, { glow: 0.55, sway: 0.09 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  return buckets.map((list, k) => {
    const mesh = new THREE.InstancedMesh(geo, mats[k % 2], list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, rnd() * Math.PI);
      sc.set(it.s * (0.8 + rnd() * 0.5), it.s, it.s * (0.8 + rnd() * 0.5));
      p.set(it.x, it.y - 0.05, it.z);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      const b = 0.9 + rnd() * 0.3;
      mesh.setColorAt(i, col.setRGB(b, b * (0.94 + rnd() * 0.08), b * 0.9));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    return mesh;
  });
}
