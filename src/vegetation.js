import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from './config.js';
import { forestDensity, noise3, smoothstep, pick, pickWeighted, mulberry32 } from './util.js';
import { foliageMaterial } from './materials.js';

const PALETTES = {
  orange: ['#e0721c', '#f0912a', '#c75516', '#f6ac3a', '#d8641a'],
  red: ['#b52e1a', '#d24722', '#8e2214', '#e2622c', '#c23a1c'],
  yellow: ['#e6b22a', '#f0c944', '#cf9420', '#f5d968', '#dca52a'],
  amber: ['#d98824', '#b9481c', '#e9ad38', '#a8601c', '#cf6e22'],
  green: ['#9a9c38', '#b9ad3e', '#7f8a34', '#d2bd4a', '#a48a30'],
};

// trunk: [height, bottom radius, top radius]; blobs: [x, y, z, radius]
const KINDS = {
  oak: { trunk: [3.0, 0.34, 0.22], palette: 'orange', blobs: [[0, 6.0, 0, 3.2], [1.9, 5.2, 0.6, 2.3], [-1.8, 5.4, -0.5, 2.4], [0.4, 7.6, -0.4, 2.2], [-0.6, 4.8, 1.7, 2.0]] },
  maple: { trunk: [2.6, 0.3, 0.2], palette: 'red', blobs: [[0, 5.4, 0, 3.0], [1.6, 4.8, -0.8, 2.2], [-1.5, 5.0, 0.9, 2.1], [0, 7.0, 0, 2.0]] },
  birch: { trunk: [4.6, 0.2, 0.13], trunkColor: '#e4dfd4', palette: 'yellow', blobs: [[0, 6.0, 0, 1.9], [0.3, 7.8, 0.2, 1.7], [-0.4, 9.3, -0.1, 1.3], [0.5, 6.8, -0.6, 1.5]] },
  amber: { trunk: [3.0, 0.3, 0.2], palette: 'amber', blobs: [[0, 5.8, 0, 3.0], [-1.7, 5.0, 0.4, 2.2], [1.6, 5.6, -0.4, 2.2], [0.2, 7.4, 0.5, 2.0]] },
  late: { trunk: [3.2, 0.3, 0.2], palette: 'green', blobs: [[0, 6.2, 0, 3.1], [1.7, 5.4, 0.7, 2.2], [-1.6, 5.6, -0.6, 2.3], [0.3, 7.9, 0, 2.0]] },
  spruce: { conifer: true },
  bushRed: { palette: 'red', blobs: [[0, 0.9, 0, 1.3], [1.0, 0.75, 0.3, 1.0], [-0.95, 0.7, -0.2, 1.0], [0.2, 1.5, -0.1, 0.9]] },
  bushOrange: { palette: 'orange', blobs: [[0, 0.95, 0, 1.35], [1.1, 0.7, -0.2, 1.0], [-0.9, 0.75, 0.3, 1.05], [-0.1, 1.6, 0.2, 0.85]] },
  bushAmber: { palette: 'amber', blobs: [[0, 0.85, 0, 1.2], [0.9, 0.7, 0.4, 0.95], [-1.0, 0.65, -0.3, 0.9]] },
};
const BUSHES = ['bushRed', 'bushOrange', 'bushAmber'];
const TREE_WEIGHTS = { oak: 0.27, maple: 0.22, amber: 0.2, birch: 0.12, late: 0.1, spruce: 0.09 };
// LOD switch distances (m) for trees / bushes
const LOD_TREE = [150, 470];
const LOD_BUSH = [85, 300];

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

function trunkGeo(h, r0, r1, sides, hex, rnd) {
  const g = new THREE.CylinderGeometry(r1, r0, h + 0.4, sides, 1, true);
  g.deleteAttribute('uv');
  g.translate(0, h / 2 - 0.2, 0);
  const base = new THREE.Color(hex);
  const birch = hex !== '#4a3424';
  return finish(g, (c, x, y) => {
    c.copy(base).multiplyScalar(birch ? (rnd() < 0.3 ? 0.35 : 1) : 0.85 + 0.25 * rnd());
    if (y < 0.3) c.multiplyScalar(0.7);
  });
}

function blobGeo(b, detail, palette, rnd, center) {
  const [cx, cy, cz, r] = b;
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const seed = rnd() * 100;
  const pos = g.attributes.position;
  const bumps = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise3(x * 1.9 + seed, y * 1.9, z * 1.9 - seed);
    bumps[i] = n;
    const k = r * (1 + 0.24 * n);
    pos.setXYZ(i, cx + x * k, cy + y * k * (y < 0 ? 0.72 : 0.95), cz + z * k);
  }
  g.computeVertexNormals();
  // blend towards crown-spherical normals for a soft, fluffy shading
  const nor = g.attributes.normal;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).normalize();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, 0.55).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  const pal = PALETTES[palette];
  const c0 = new THREE.Color(pick(rnd, pal));
  const c1 = new THREE.Color(pick(rnd, pal));
  return finish(g, (c, x, y, z, i) => {
    const m = smoothstep(-0.25, 0.25, noise3(x * 0.9 + seed, y * 0.9, z * 0.9));
    c.copy(c0).lerp(c1, m);
    const top = smoothstep(cy - r, cy + r, y);
    let shade = 0.55 + 0.5 * top;
    shade *= 0.8 + 0.35 * smoothstep(-0.5, 0.5, bumps[i]);
    shade *= 0.88 + rnd() * 0.24;
    c.multiplyScalar(shade);
  });
}

function crownCenter(blobs) {
  const c = new THREE.Vector3();
  let w = 0;
  for (const [x, y, z, r] of blobs) {
    c.x += x * r; c.y += y * r; c.z += z * r;
    w += r;
  }
  return c.divideScalar(w);
}

function coniferGeo(lod, rnd) {
  const parts = [trunkGeo(2.2, 0.3, 0.18, lod === 0 ? 6 : 4, '#4a3424', rnd)];
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

function kindGeo(name, lod, rnd) {
  const k = KINDS[name];
  if (k.conifer) return coniferGeo(lod, rnd);
  const parts = [];
  const isBush = !k.trunk;
  if (k.trunk) {
    const [h, r0, r1] = k.trunk;
    parts.push(trunkGeo(h, r0, r1, [7, 5, 4][lod], k.trunkColor || '#4a3424', rnd));
  }
  const center = crownCenter(k.blobs);
  if (lod === 2) {
    // single lump approximating the whole crown
    let ext = 0;
    for (const [x, y, z, r] of k.blobs) ext = Math.max(ext, Math.hypot(x - center.x, (y - center.y) * 0.9, z - center.z) + r);
    parts.push(blobGeo([center.x, center.y, center.z, ext * 0.82], isBush ? 0 : 1, k.palette, rnd, center));
  } else {
    const blobs = lod === 1 ? k.blobs.slice(0, 3) : k.blobs;
    for (const b of blobs) {
      const detail = lod === 0 ? (b[3] > 2.5 ? 2 : 1) : 1;
      parts.push(blobGeo(b, detail, k.palette, rnd, center));
    }
  }
  return mergeGeometries(parts);
}

export class Vegetation {
  constructor(track, terrain, { villages = [], seed = 1 } = {}) {
    const rnd = mulberry32(seed);
    this.items = this.place(track, terrain, villages, rnd);

    const names = Object.keys(KINDS);
    const geos = {};
    let maxV = 0, maxI = 0;
    for (const name of names) {
      geos[name] = [0, 1, 2].map((lod) => kindGeo(name, lod, rnd));
      for (const g of geos[name]) {
        maxV += g.attributes.position.count;
        maxI += g.index.count;
      }
    }
    const mat = foliageMaterial({ vertexColors: true }, { glow: 0.45 });
    const bm = new THREE.BatchedMesh(this.items.length, maxV, maxI, mat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    bm.sortObjects = false;
    bm.name = 'trees';
    this.ids = {};
    for (const name of names) this.ids[name] = geos[name].map((g) => bm.addGeometry(g));

    const n = this.items.length;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.lod = new Int8Array(n);
    this.kindOf = [];
    this.isBush = new Uint8Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    this.items.forEach((it, idx) => {
      const id = bm.addInstance(this.ids[it.kind][2]);
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
      this.kindOf[idx] = this.ids[it.kind];
      this.isBush[idx] = BUSHES.includes(it.kind) ? 1 : 0;
    });
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
        if ((near < 24 && r2 < 0.62) || (f < 0.45 && r2 < 0.3)) kind = BUSHES[Math.floor(rnd() * 3)];
        else kind = pickWeighted(rnd, TREE_WEIGHTS);
        const bush = BUSHES.includes(kind);
        let scale = bush ? 0.7 + rnd() * 0.6 : 0.78 + rnd() * 0.45;
        if (cd > 380 && !bush) scale *= 1.25;
        items.push({ kind, x, z, y: terrain.heightAt(x, z) - (bush ? 0.15 : 0.25), scale });
      }
    }
    return items;
  }

  update(camera) {
    if (this.frame++ % 10 !== 0) return;
    const cx = camera.position.x, cz = camera.position.z;
    const bm = this.mesh;
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
}

// ---- dry grass tufts along the road, one instanced mesh per road chunk and variant ----
export function buildGrass(track, terrain, textures, seed, chunkSize) {
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
