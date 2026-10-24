import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Side profiles are (z, y) points: z runs from the rear (-) to the front (+).
export const CAR_TYPES = {
  hatch: {
    L: 4.1, W: 1.78, wheelR: 0.32, clearance: 0.3, wheelZ: [-1.32, 1.3], cabinW: 0.86,
    body: [[-2.05, 0.3], [-2.06, 0.62], [-2.0, 1.0], [1.2, 0.98], [1.92, 0.8], [2.05, 0.62], [2.03, 0.32]],
    cabin: [[-1.94, 0.98], [-1.48, 1.46], [-1.27, 1.5], [0.22, 1.5], [1.18, 0.98]],
    pillarZ: -0.18,
    tail: { y: 0.86, h: 0.17, w: 0.42, x: 0.6 }, head: { y: 0.7, h: 0.12, w: 0.36, x: 0.6 }, plateY: 0.5, spoiler: true,
  },
  sedan: {
    L: 4.7, W: 1.82, wheelR: 0.32, clearance: 0.3, wheelZ: [-1.42, 1.45], cabinW: 0.86,
    body: [[-2.35, 0.32], [-2.37, 0.66], [-2.3, 1.02], [-1.45, 1.04], [1.3, 1.0], [2.1, 0.8], [2.33, 0.64], [2.32, 0.34]],
    cabin: [[-1.52, 1.02], [-0.95, 1.43], [0.3, 1.45], [1.27, 1.0]],
    pillarZ: -0.12,
    tail: { y: 0.9, h: 0.14, w: 0.4, x: 0.62 }, head: { y: 0.72, h: 0.11, w: 0.38, x: 0.62 }, plateY: 0.55,
  },
  suv: {
    L: 4.6, W: 1.88, wheelR: 0.38, clearance: 0.38, wheelZ: [-1.4, 1.38], cabinW: 0.88,
    body: [[-2.28, 0.42], [-2.3, 0.76], [-2.24, 1.18], [1.25, 1.16], [2.05, 0.98], [2.28, 0.8], [2.27, 0.44]],
    cabin: [[-2.2, 1.16], [-2.1, 1.7], [-1.9, 1.77], [0.45, 1.77], [1.3, 1.16]],
    pillarZ: -0.2, quarterZ: -1.35,
    tail: { y: 1.02, h: 0.16, w: 0.36, x: 0.7 }, head: { y: 0.86, h: 0.13, w: 0.4, x: 0.64 }, plateY: 0.62,
  },
  van: {
    L: 5.4, W: 1.98, wheelR: 0.36, clearance: 0.38, wheelZ: [-1.75, 1.7], cabinW: 0.98,
    body: [[-2.7, 0.38], [-2.71, 1.1], [1.45, 1.1], [2.45, 0.98], [2.7, 0.8], [2.68, 0.42]],
    cabin: [[-2.69, 1.08], [-2.69, 2.4], [0.85, 2.44], [1.55, 1.1]],
    sideWindow: [[0.5, 1.28], [1.32, 1.28], [0.82, 2.08], [0.5, 2.08]], taper: 0.04,
    rearWindowFrac: [0.55, 0.9],
    tail: { y: 0.9, h: 0.32, w: 0.14, x: 0.86 }, head: { y: 0.86, h: 0.14, w: 0.4, x: 0.66 }, plateY: 0.55,
  },
  truck: { truck: true, L: 9.2, W: 2.45, wheelR: 0.5 },
};

function prep(g, hex) {
  if (g.index) g = g.toNonIndexed();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  if (hex) {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// extrude a (z, y) profile across the car width, centered on x = 0
function extrudeProfile(points, width, bevel, underside) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  if (underside) underside(s);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.85,
    bevelSegments: 1, curveSegments: 4,
  });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function centroid(pts) {
  let z = 0, y = 0;
  for (const p of pts) { z += p[0]; y += p[1]; }
  return [z / pts.length, y / pts.length];
}

// inset a convex polygon by d (miter join)
function insetPolygon(pts, d) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? 1 : -1;
  const nrm = (a, b) => {
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dz, dy);
    return [(-dy / l) * sgn, (dz / l) * sgn];
  };
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const n1 = nrm(prev, p), n2 = nrm(p, next);
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
}

// glass pane lying on the profile segment a->b (fractions f0..f1), pushed outwards by `out`
function paneOnSegment(a, b, width, f0, f1, out, cen) {
  const A = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0];
  const B = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const Y = new THREE.Vector3(0, B[1] - A[1], B[0] - A[0]).normalize();
  const N = new THREE.Vector3(0, -Y.z, Y.y);
  const mid = new THREE.Vector3(0, (A[1] + B[1]) / 2, (A[0] + B[0]) / 2);
  if (N.dot(new THREE.Vector3(0, mid.y - cen[1], mid.z - cen[0])) < 0) N.negate();
  const X = new THREE.Vector3().crossVectors(Y, N);
  const g = new THREE.PlaneGeometry(width, len);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, N).setPosition(mid.addScaledVector(N, out)));
  return g;
}

// z of the profile outline at height y on the rear (side < 0) or front (side > 0) end
function endZ(body, y, side) {
  let best = side < 0 ? Infinity : -Infinity;
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const z = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    best = side < 0 ? Math.min(best, z) : Math.max(best, z);
  }
  return best;
}

const TRIM = '#242b32';
const SEAM = '#48505a';
const ALLOY = '#b5c0c9';
const BODY_BEVEL = 0.065;

// All detailing is merged into the existing material batches, including the rims.
function polygon(points) {
  return new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))));
}

function flipFaces(g) {
  const index = g.index.array;
  for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  return g;
}

function sidePanel(points, x) {
  const g = polygon(points);
  if (x > 0) flipFaces(g);
  return g.rotateY(-Math.PI / 2).translate(x, 0, 0);
}

function sideLine(points, x, width) {
  const pieces = [];
  for (let i = 1; i < points.length; i++) {
    const [z0, y0] = points[i - 1], [z1, y1] = points[i];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const dz = -(y1 - y0) / len * width / 2, dy = (z1 - z0) / len * width / 2;
    pieces.push(prep(sidePanel([[z0 + dz, y0 + dy], [z1 + dz, y1 + dy], [z1 - dz, y1 - dy], [z0 - dz, y0 - dy]], x)));
  }
  return mergeParts(pieces);
}

// Clip a window at a pillar; each pane has its own rubber surround.
function clipZ(points, z, keepGreater) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const insideA = keepGreater ? a[0] >= z : a[0] <= z;
    const insideB = keepGreater ? b[0] >= z : b[0] <= z;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const f = (z - a[0]) / (b[0] - a[0]);
      out.push([z, a[1] + f * (b[1] - a[1])]);
    }
  }
  return out;
}

// Lamps and grilles follow the sloping front/rear, instead of intersecting the body.
function endPanel(t, points, side, offset = 0.014) {
  const g = polygon(points);
  if (side < 0) flipFaces(g);
  const p = g.attributes.position;
  const outline = insetPolygon(t.body, -BODY_BEVEL * 0.85);
  for (let i = 0; i < p.count; i++) p.setZ(i, endZ(outline, p.getY(i), side) + side * offset);
  return g;
}

function endRect(t, x, y, w, h, side, offset = 0.014) {
  return endPanel(t, [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], side, offset);
}

function endLine(t, points, side, width) {
  return mergeParts(points.slice(1).map(([x1, y1], i) => {
    const [x0, y0] = points[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dx = -(y1 - y0) / len * width / 2, dy = (x1 - x0) / len * width / 2;
    return prep(endPanel(t, [[x0 + dx, y0 + dy], [x1 + dx, y1 + dy], [x1 - dx, y1 - dy], [x0 - dx, y0 - dy]], side, 0.019));
  }));
}

// Split the large body-side triangles at each styling crease before narrowing
// the ends. Without these edges the deformed side looks dented along diagonals.
function splitAtCreases(g, planes) {
  let triangles = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) triangles.push([0, 1, 2].map(j => [p.getX(i + j), p.getY(i + j), p.getZ(i + j)]));
  for (const [axis, value] of planes) {
    const next = [];
    for (const tri of triangles) {
      if (!tri.some(v => v[axis] < value - 1e-6) || !tri.some(v => v[axis] > value + 1e-6)) {
        next.push(tri);
        continue;
      }
      for (const side of [-1, 1]) {
        const clipped = [];
        for (let i = 0; i < 3; i++) {
          const a = tri[i], b = tri[(i + 1) % 3];
          const da = side * (a[axis] - value), db = side * (b[axis] - value);
          if (da >= 0) clipped.push(a);
          if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
            const f = da / (da - db);
            clipped.push(a.map((v, j) => v + (b[j] - v) * f));
          }
        }
        for (let i = 1; i < clipped.length - 1; i++) next.push([clipped[0], clipped[i], clipped[i + 1]]);
      }
    }
    triangles = next;
  }
  const result = new THREE.BufferGeometry();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  // Clipping through an existing vertex can leave a zero-area triangle.
  const faces = triangles.filter(([a, b, c]) => {
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    return ab.cross(ac).lengthSq() > 1e-12;
  });
  result.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(2), 3));
  result.computeVertexNormals();
  g.dispose();
  return result;
}

function finishParts(parts) {
  // Tapering changes surface directions: recompute after every deformation.
  // Non-indexed triangles retain crisp facets, with no extra smoothing geometry.
  for (const key of ['paint', 'glass', 'detail', 'tail', 'head']) {
    for (const g of parts[key]) g.computeVertexNormals();
  }
  return parts;
}

function wheelGeometry(r, sx) {
  const pieces = [];
  const profile = [[r * 0.63, -0.14], [r * 0.86, -0.14], [r, -0.09], [r, 0.09], [r * 0.86, 0.14], [r * 0.63, 0.14]];
  pieces.push(prep(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p)), 12).rotateZ(Math.PI / 2), '#20242a'));
  const face = (g, offset, color) => pieces.push(prep(g.rotateY(sx * Math.PI / 2).translate(sx * offset, 0, 0), color));
  face(new THREE.CircleGeometry(r * 0.65, 12), 0.142, '#343c44');
  face(new THREE.RingGeometry(r * 0.56, r * 0.67, 12), 0.146, ALLOY);
  // Five tapered spokes leave visible dark pockets between the machined faces.
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + 0.15;
    const spoke = polygon([[-r * 0.1, r * 0.12], [r * 0.1, r * 0.12], [r * 0.065, r * 0.6], [-r * 0.065, r * 0.6]]).rotateZ(a);
    face(spoke, 0.15, ALLOY);
  }
  face(new THREE.CircleGeometry(r * 0.2, 10), 0.153, '#7b8792');
  face(new THREE.CircleGeometry(r * 0.1, 8), 0.155, '#bfc8ce');
  // A single valve makes rotation readable even when the five spokes alias at speed.
  face(new THREE.CircleGeometry(r * 0.045, 6).translate(r * 0.48, 0, 0), 0.157, '#73808a');
  return mergeParts(pieces);
}

function wheels(t) {
  const xs = t.W / 2 - 0.12;
  const zs = t.truck ? [-3.6, -2.3, 3.0] : t.wheelZ;
  const r = t.wheelR;
  return { x: xs, radius: r, axles: zs, geometries: [wheelGeometry(r, -1), wheelGeometry(r, 1)] };
}

// textured logo panels: both sides and the rear doors of the cargo box (uv kept, no colors)
function truckDecals(W) {
  const side = (sx) => new THREE.PlaneGeometry(6.1, 2.3).rotateY((sx * Math.PI) / 2).translate(sx * (W / 2 + 0.015), 2.55, -1.3);
  const rear = new THREE.PlaneGeometry(2.1, 0.82).rotateY(Math.PI).translate(0, 3.25, -4.565);
  return [side(1), side(-1), rear];
}

function buildTruck(t) {
  const parts = { paint: [], glass: [], detail: [], tail: [], head: [], decal: [] };
  const W = t.W;
  // cargo box + cab (painted)
  parts.paint.push(prep(box(W, 2.7, 6.5, 0, 2.55, -1.3)));
  const cab = extrudeProfile([[2.15, 0.65], [2.15, 3.0], [4.35, 3.0], [4.5, 2.2], [4.6, 0.65]], W * 0.98, 0.06, s => {
    s.lineTo(3.58, 0.65);
    s.absarc(3.0, 0.65, 0.58, 0, Math.PI, false);
  });
  parts.paint.push(prep(cab));
  // chassis, bumpers, cargo door seams
  parts.detail.push(prep(box(W * 0.8, 0.35, 8.9, 0, 0.85, 0), '#26282c'));
  parts.detail.push(prep(box(W, 0.18, 0.15, 0, 0.72, -4.58), '#2a2c30'));
  parts.detail.push(prep(box(W * 0.98, 0.3, 0.12, 0, 0.75, 4.62), '#2a2c30'));
  parts.detail.push(prep(box(0.05, 2.5, 0.04, 0, 2.55, -4.57), '#8a8d92'));
  for (const sx of [-1, 1]) parts.detail.push(prep(box(0.08, 2.5, 0.05, sx * (W / 2 - 0.08), 2.55, -4.57), '#8a8d92'));
  parts.detail.push(prep(box(0.52, 0.12, 0.03, 0, 0.98, -4.6), '#f2f2ee'));
  parts.detail.push(prep(box(W * 0.55, 0.38, 0.035, 0, 1.55, 4.59), TRIM));
  for (const y of [1.43, 1.55, 1.67]) parts.detail.push(prep(box(W * 0.5, 0.027, 0.04, 0, y, 4.615), '#71808a'));
  parts.detail.push(prep(box(0.52, 0.12, 0.035, 0, 0.82, 4.7), '#eeeee8'));
  parts.detail.push(prep(box(0.12, 0.075, 0.03, 0, 1.92, 4.58), ALLOY));
  // glass
  const cen = [3.3, 1.9];
  parts.detail.push(prep(paneOnSegment([4.5, 2.2], [4.35, 3.0], W * 0.88, 0.04, 0.94, 0.06, cen), TRIM));
  parts.glass.push(prep(paneOnSegment([4.5, 2.2], [4.35, 3.0], W * 0.84, 0.08, 0.9, 0.066, cen)));
  for (const sx of [-1, 1]) {
    const sideWindow = [[2.85, 2.13], [4.32, 2.13], [4.2, 2.86], [2.85, 2.86]];
    parts.detail.push(prep(sidePanel(sideWindow, sx * (W * 0.49 + 0.008)), TRIM));
    parts.glass.push(prep(sidePanel(insetPolygon(sideWindow, 0.04), sx * (W * 0.49 + 0.014))));
    parts.detail.push(prep(sideLine([[2.7, 1.35], [2.7, 2.9], [4.24, 2.9]], sx * (W * 0.49 + 0.01), 0.018), SEAM));
    parts.detail.push(prep(box(0.04, 0.055, 0.23, sx * (W * 0.49 + 0.015), 1.93, 2.93), TRIM));
    parts.detail.push(prep(box(0.21, 0.06, 0.1, sx * (W / 2 + 0.07), 2.58, 4.22), TRIM));
    parts.detail.push(prep(box(0.13, 0.38, 0.15, sx * (W / 2 + 0.2), 2.41, 4.22), TRIM));
    parts.glass.push(prep(box(0.105, 0.31, 0.012, sx * (W / 2 + 0.2), 2.41, 4.137)));
    parts.detail.push(prep(box(0.21, 0.08, 0.6, sx * (W / 2 - 0.04), 0.83, 3.93), '#67727b'));
    // Cargo edge rails, rear-door locking bars and hinges stay clear of the logos.
    for (const y of [1.24, 3.87]) parts.detail.push(prep(box(0.04, 0.065, 6.48, sx * (W / 2 + 0.005), y, -1.3), ALLOY));
    parts.detail.push(prep(box(0.045, 2.62, 0.06, sx * (W / 2 + 0.005), 2.55, -4.51), ALLOY));
    parts.detail.push(prep(box(0.035, 1.46, 0.035, sx * 0.48, 2.0, -4.6), '#6b7780'));
    for (const y of [1.55, 2.53]) parts.detail.push(prep(box(0.17, 0.07, 0.06, sx * (W / 2 - 0.1), y, -4.6), '#707b84'));
    for (const z of [-4.25, -1.4, 1.6]) parts.head.push(prep(box(0.035, 0.07, 0.12, sx * (W / 2 + 0.035), 1.29, z), '#ecac45'));
  }
  // lights
  for (const sx of [-1, 1]) {
    parts.detail.push(prep(box(0.4, 0.2, 0.055, sx * 0.88, 0.84, -4.64), TRIM));
    parts.tail.push(prep(box(0.28, 0.115, 0.06, sx * 0.92, 0.85, -4.65), '#cb303c'));
    parts.detail.push(prep(box(0.07, 0.1, 0.065, sx * 0.74, 0.85, -4.65), '#e4c38c'));
    parts.detail.push(prep(box(0.43, 0.22, 0.055, sx * 0.85, 1.02, 4.63), TRIM));
    parts.head.push(prep(box(0.34, 0.12, 0.06, sx * 0.85, 1.04, 4.64), '#fff6dc'));
  }
  parts.decal.push(...truckDecals(W));
  parts.wheels = wheels(t);
  return finishParts(parts);
}

// returns geometry lists: paint (tinted), glass, detail/tail/head (vertex colored), decal (textured)
// opts.plate: { scale, lift } enlarges the rear plate (the player's car carries a readable one)
export function buildCarParts(typeName, opts = {}) {
  const t = CAR_TYPES[typeName];
  if (t.truck) return buildTruck(t);
  const parts = { paint: [], glass: [], detail: [], tail: [], head: [], decal: [] };
  const W = t.W;
  const bevel = BODY_BEVEL;
  const [zr, zf] = t.wheelZ;
  const ar = t.wheelR + 0.025 + bevel * 0.85;
  const y0 = t.clearance;
  parts.paint.push(prep(extrudeProfile(t.body, W, bevel, (s) => {
    s.lineTo(zf + ar, y0);
    s.absarc(zf, y0, ar, 0, Math.PI, false);
    s.lineTo(zr + ar, y0);
    s.absarc(zr, y0, ar, 0, Math.PI, false);
  })));
  const cw = W * t.cabinW;
  const cb = 0.045;
  // the greenhouse narrows towards the roof (tumblehome)
  const belt = t.cabin[0][1];
  const roof = Math.max(...t.cabin.map((p) => p[1]));
  const taper = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > belt) p.setX(i, p.getX(i) * (1 - (t.taper ?? 0.12) * Math.min(1, (y - belt) / (roof - belt))));
    }
    return g;
  };
  parts.paint.push(taper(prep(extrudeProfile(t.cabin, cw, cb))));

  const cen = centroid(t.cabin);
  const n = t.cabin.length;
  const sidePoly = t.sideWindow || insetPolygon(t.cabin, 0.085).map(([z, y]) => [z, Math.max(y, belt + 0.065)]);
  let panes = [sidePoly];
  if (!t.sideWindow) {
    panes = [clipZ(sidePoly, t.pillarZ - 0.045, false), clipZ(sidePoly, t.pillarZ + 0.045, true)];
    if (t.quarterZ) panes.splice(0, 1, clipZ(panes[0], t.quarterZ - 0.035, false), clipZ(panes[0], t.quarterZ + 0.035, true));
  }
  for (const sx of [-1, 1]) {
    // A dark surround also fills the B-pillar between the separate panes.
    parts.detail.push(taper(prep(sidePanel(sidePoly, sx * (cw / 2 + 0.008)), TRIM)));
    for (const pane of panes) parts.glass.push(taper(prep(sidePanel(insetPolygon(pane, 0.018), sx * (cw / 2 + 0.012)))));
  }
  const rearA = t.cabin[0], rearB = t.cabin[1];
  const frontA = t.cabin[n - 1], frontB = t.cabin[n - 2];
  const [rf0, rf1] = t.rearWindowFrac || [0.12, 0.88];
  for (const [a, b, f0, f1] of [[rearA, rearB, rf0, rf1], [frontA, frontB, 0.1, 0.91]]) {
    parts.detail.push(taper(prep(paneOnSegment(a, b, cw - 0.16, f0 - 0.025, f1 + 0.025, cb * 0.85 + 0.012, cen), TRIM)));
    parts.glass.push(taper(prep(paneOnSegment(a, b, cw - 0.21, f0, f1, cb * 0.85 + 0.017, cen))));
  }
  // Rear wiper and high-mounted brake light share the actual rear glass angle.
  if (typeName !== 'sedan') {
    parts.detail.push(taper(prep(paneOnSegment(rearA, rearB, 0.32, rf0 + 0.065, rf0 + 0.095, cb * 0.85 + 0.024, cen), TRIM)));
    parts.tail.push(taper(prep(paneOnSegment(rearA, rearB, 0.3, rf1 - 0.025, rf1 + 0.005, cb * 0.85 + 0.025, cen), '#c72b35')));
  }

  const endOutline = insetPolygon(t.body, -bevel * 0.85);
  const rz = (y) => endZ(endOutline, y, -1);
  const fz = (y) => endZ(endOutline, y, 1);
  const bumperBottom = Math.max(y0 + 0.01, Math.min(...t.body.map(p => p[1])) + 0.005);
  const rearValance = [[-W * 0.42, bumperBottom], [W * 0.42, bumperBottom], [W * 0.4, y0 + 0.16], [W * 0.27, y0 + 0.2], [-W * 0.27, y0 + 0.2], [-W * 0.4, y0 + 0.16]];
  parts.detail.push(prep(endPanel(t, rearValance, -1), TRIM));
  // A shallow recess, a small tailgate grip and a restrained metal badge.
  const ps = opts.plate?.scale ?? 1;
  const py = t.plateY + (opts.plate?.lift ?? 0);
  parts.detail.push(prep(endRect(t, 0, py, 0.52 * ps + 0.1, 0.12 * ps + 0.065, -1), SEAM));
  parts.detail.push(prep(box(0.52 * ps + 0.02, 0.12 * ps + 0.012, 0.03, 0, py, rz(py) - 0.025), ps > 1 ? TRIM : '#f2f2ee'));
  if (ps === 1) parts.detail.push(prep(box(0.055, 0.12, 0.035, 0.235, py, rz(py) - 0.027), '#2346a0'));
  parts.rearPlate = { y: py, z: rz(py) - 0.025 - 0.015 - 0.006, w: 0.52 * ps, h: 0.114 * ps };
  parts.detail.push(prep(endRect(t, 0, t.tail.y - 0.11, 0.19, 0.024, -1, 0.019), TRIM));
  parts.detail.push(prep(endRect(t, 0, t.tail.y + 0.025, 0.075, 0.036, -1, 0.019), ALLOY));
  if (typeName !== 'van') {
    const top = Math.min(belt - 0.02, Math.max(...t.body.map(p => p[1])) - 0.025);
    const w = W * 0.27;
    parts.detail.push(prep(endLine(t, [[-w * 1.2, top], [-w, t.tail.y - 0.13], [-w, py - 0.11], [w, py - 0.11], [w, t.tail.y - 0.13], [w * 1.2, top]], -1, 0.009), SEAM));
  }

  // Shaped lower intake, narrow grille and bumper corner recesses.
  const intakeY = y0 + 0.18;
  parts.detail.push(prep(endPanel(t, [[-W * 0.31, intakeY - 0.08], [W * 0.31, intakeY - 0.08], [W * 0.28, intakeY + 0.075], [-W * 0.28, intakeY + 0.075]], 1), TRIM));
  parts.detail.push(prep(endRect(t, 0, t.head.y, W * 0.4, 0.085, 1), TRIM));
  parts.detail.push(prep(endRect(t, 0, t.head.y + 0.019, W * 0.35, 0.013, 1, 0.019), '#84919a'));
  parts.detail.push(prep(endRect(t, 0, t.head.y + 0.007, 0.07, 0.039, 1, 0.024), ALLOY));
  parts.detail.push(prep(box(0.52, 0.114, 0.03, 0, y0 + 0.24, fz(y0 + 0.24) + 0.025), '#f2f2ee'));
  parts.detail.push(prep(box(0.055, 0.114, 0.035, -0.235, y0 + 0.24, fz(y0 + 0.24) + 0.028), '#2346a0'));

  for (const sx of [-1, 1]) {
    // Silhouette details: sill, cut door seams, handles and mounted mirrors.
    const x = sx * (W / 2 + 0.006);
    const doorRear = typeName === 'van' ? -1.18 : zr + 0.28;
    const doorFront = zf - 0.45;
    const low = y0 + 0.18;
    parts.detail.push(prep(sideLine([[doorRear - 0.12, belt - 0.09], [doorRear + 0.11, low], [doorFront, low], [doorFront + 0.16, belt - 0.09]], x, 0.012), SEAM));
    const split = t.pillarZ ?? 0.4;
    parts.detail.push(prep(sideLine([[split, low], [split, belt - 0.045]], x, 0.012), SEAM));
    parts.detail.push(prep(box(0.035, 0.065, zf - zr - ar * 1.5, sx * (W / 2 - 0.006), y0 + 0.035, (zr + zf) / 2), typeName === 'suv' ? TRIM : '#424b54'));
    for (const z of [split + 0.17, doorRear + 0.24]) {
      parts.detail.push(prep(box(0.025, 0.035, 0.18, sx * (W / 2 + 0.012), belt - 0.15, z), SEAM));
      parts.paint.push(prep(box(0.035, 0.019, 0.145, sx * (W / 2 + 0.025), belt - 0.141, z + 0.005)));
    }
    // Faceted arch lips and the dark inset wheel wells.
    for (const z of t.wheelZ) {
      const outer = ar + (typeName === 'suv' ? 0.07 : 0.032);
      const inner = ar - 0.004;
      const ring = [];
      for (let i = 0; i <= 8; i++) ring.push([z + outer * Math.cos(i * Math.PI / 8), y0 + outer * Math.sin(i * Math.PI / 8)]);
      for (let i = 8; i >= 0; i--) ring.push([z + inner * Math.cos(i * Math.PI / 8), y0 + inner * Math.sin(i * Math.PI / 8)]);
      const lip = prep(sidePanel(ring, sx * (W / 2 + 0.008)), typeName === 'suv' ? TRIM : undefined);
      (typeName === 'suv' ? parts.detail : parts.paint).push(lip);
    }
    const mz = frontA[0] - 0.24;
    parts.detail.push(prep(box(0.18, 0.045, 0.065, sx * (W / 2 + 0.015), belt + 0.09, mz), TRIM));
    const mirror = extrudeProfile([[mz - 0.135, belt + 0.08], [mz - 0.13, belt + 0.19], [mz + 0.09, belt + 0.18], [mz + 0.13, belt + 0.11]], 0.18, 0.02).translate(sx * (W / 2 + 0.13), 0, 0);
    parts.paint.push(prep(mirror));
    parts.glass.push(prep(box(0.135, 0.07, 0.008, sx * (W / 2 + 0.13), belt + 0.135, mz - 0.146)));
    parts.detail.push(prep(endRect(t, sx * W * 0.37, intakeY + 0.015, 0.16, 0.11, 1), TRIM));
    parts.head.push(prep(endRect(t, sx * W * 0.37, intakeY + 0.02, 0.08, 0.025, 1, 0.02), '#e0e6dc'));
    parts.tail.push(prep(endRect(t, sx * W * 0.36, y0 + 0.14, 0.16, 0.027, -1, 0.021), '#9c1b29'));
  }

  if (t.spoiler) {
    const top = t.cabin[1];
    const spoiler = extrudeProfile([[top[0] - 0.23, top[1] + 0.07], [top[0] + 0.13, top[1] + 0.08], [top[0] + 0.16, top[1] + 0.04], [top[0] - 0.21, top[1] + 0.035]], cw * 0.88, 0.008);
    parts.paint.push(prep(spoiler));
  }
  if (typeName === 'suv') {
    for (const sx of [-1, 1]) {
      const x = sx * cw * 0.36;
      parts.detail.push(prep(box(0.05, 0.045, 2.0, x, roof + 0.12, -0.6), '#4d5860'));
      for (const z of [-1.4, 0.2]) parts.detail.push(prep(box(0.065, 0.08, 0.12, x, roof + 0.075, z), TRIM));
    }
  }
  if (typeName === 'van') {
    for (const sx of [-1, 1]) {
      const x = sx * (cw / 2 + 0.007);
      parts.detail.push(taper(prep(sideLine([[-2.44, 1.28], [-2.44, 2.19], [0.23, 2.19], [0.23, 1.28]], x, 0.012), SEAM)));
      parts.detail.push(taper(prep(sideLine([[-2.45, 1.4], [0.14, 1.4]], x + sx * 0.008, 0.025), TRIM)));
      parts.detail.push(taper(prep(box(0.027, 0.04, 0.2, x, 1.6, -0.02), TRIM)));
    }
    parts.detail.push(prep(box(0.016, 1.15, 0.014, 0, 1.76, -2.735), SEAM));
  }

  // Angular lenses sit in dark housings; the inner strip reads at driving distance.
  for (const sx of [-1, 1]) {
    for (const [lamp, side, list, color] of [[t.tail, -1, parts.tail, '#b62435'], [t.head, 1, parts.head, '#c5d4de']]) {
      const x = lamp.x, y = lamp.y, w = lamp.w, h = lamp.h;
      const pts = [[x - w / 2, y - h * 0.32], [x + w * 0.43, y - h * 0.5], [x + w / 2, y + h * 0.5], [x - w / 2, y + h * 0.38]];
      const mirrored = pts.map(([px, py]) => [sx * px, py]);
      parts.detail.push(prep(endPanel(t, mirrored, side, 0.016), TRIM));
      list.push(prep(endPanel(t, insetPolygon(mirrored, 0.012), side, 0.021), color));
      list.push(prep(endRect(t, sx * x, y + h * 0.16, w * 0.77, h * 0.19, side, 0.027), side < 0 ? '#f04b4d' : '#fff5dc'));
      if (side < 0 && w > 0.2) {
        parts.detail.push(prep(endRect(t, sx * (x - w * 0.3), y - h * 0.14, w * 0.19, h * 0.24, -1, 0.027), '#cbd2d3'));
      }
    }
  }

  // Slightly tucked sills and chamfered ends keep the body visibly low poly.
  const halfL = t.L / 2;
  parts.paint[0] = splitAtCreases(parts.paint[0], [[1, y0], [1, belt], [2, -halfL + 0.55], [2, halfL - 0.55]]);
  for (const list of [parts.paint, parts.glass, parts.detail, parts.tail, parts.head]) {
    for (const g of list) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), z = p.getZ(i);
        const tuck = y < belt ? 0.045 * Math.min(1, Math.max(0, (belt - y) / (belt - y0))) : 0;
        const corner = Math.min(1, Math.max(0, (Math.abs(z) - (halfL - 0.55)) / 0.65));
        p.setX(i, p.getX(i) * (1 - tuck - 0.09 * corner));
      }
    }
  }
  parts.wheels = wheels(t);
  return finishParts(parts);
}

export function mergeParts(list) {
  return mergeGeometries(list);
}
