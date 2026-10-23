import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Side profiles are (z, y) points: z runs from the rear (-) to the front (+).
export const CAR_TYPES = {
  hatch: {
    L: 4.1, W: 1.78, wheelR: 0.32, clearance: 0.3, wheelZ: [-1.32, 1.3], cabinW: 0.86,
    body: [[-2.05, 0.3], [-2.06, 0.62], [-2.0, 1.0], [1.2, 0.98], [1.92, 0.8], [2.05, 0.62], [2.03, 0.32]],
    cabin: [[-1.97, 0.98], [-1.8, 1.42], [-1.58, 1.49], [0.25, 1.5], [1.18, 0.98]],
    tail: { y: 0.86, h: 0.17, w: 0.42, x: 0.6 }, head: { y: 0.7, h: 0.12, w: 0.36, x: 0.6 }, plateY: 0.5, spoiler: true,
  },
  sedan: {
    L: 4.7, W: 1.82, wheelR: 0.32, clearance: 0.3, wheelZ: [-1.42, 1.45], cabinW: 0.86,
    body: [[-2.35, 0.32], [-2.37, 0.66], [-2.3, 1.02], [-1.45, 1.04], [1.3, 1.0], [2.1, 0.8], [2.33, 0.64], [2.32, 0.34]],
    cabin: [[-1.52, 1.02], [-0.95, 1.43], [0.3, 1.45], [1.27, 1.0]],
    tail: { y: 0.9, h: 0.14, w: 0.4, x: 0.62 }, head: { y: 0.72, h: 0.11, w: 0.38, x: 0.62 }, plateY: 0.55,
  },
  suv: {
    L: 4.6, W: 1.88, wheelR: 0.38, clearance: 0.38, wheelZ: [-1.4, 1.38], cabinW: 0.88,
    body: [[-2.28, 0.42], [-2.3, 0.76], [-2.24, 1.18], [1.25, 1.16], [2.05, 0.98], [2.28, 0.8], [2.27, 0.44]],
    cabin: [[-2.2, 1.16], [-2.1, 1.7], [-1.9, 1.77], [0.45, 1.77], [1.3, 1.16]],
    tail: { y: 1.02, h: 0.16, w: 0.36, x: 0.7 }, head: { y: 0.86, h: 0.13, w: 0.4, x: 0.64 }, plateY: 0.62,
  },
  van: {
    L: 5.4, W: 1.98, wheelR: 0.36, clearance: 0.38, wheelZ: [-1.75, 1.7], cabinW: 0.98,
    body: [[-2.7, 0.38], [-2.71, 1.1], [1.45, 1.1], [2.45, 0.98], [2.7, 0.8], [2.68, 0.42]],
    cabin: [[-2.69, 1.08], [-2.69, 2.4], [0.85, 2.44], [1.55, 1.1]],
    sideWindow: [[0.5, 1.28], [1.32, 1.28], [0.82, 2.08], [0.5, 2.08]], taper: 0.04,
    rearWindowFrac: [0.55, 0.9],
    tail: { y: 0.92, h: 0.42, w: 0.14, x: 0.86 }, head: { y: 0.86, h: 0.14, w: 0.4, x: 0.66 }, plateY: 0.55,
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
    bevelSegments: 3, curveSegments: 10,
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

function wheels(t, parts) {
  const xs = t.W / 2 - 0.15;
  const zs = t.truck ? [-3.6, -2.3, 3.0] : t.wheelZ;
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      parts.detail.push(prep(new THREE.CylinderGeometry(t.wheelR, t.wheelR, 0.26, 16).rotateZ(Math.PI / 2).translate(sx * xs, t.wheelR, z), '#1b1b1d'));
      parts.detail.push(prep(new THREE.CylinderGeometry(t.wheelR * 0.6, t.wheelR * 0.6, 0.27, 12).rotateZ(Math.PI / 2).translate(sx * xs, t.wheelR, z), '#a3a7ad'));
    }
  }
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
  const cab = extrudeProfile([[2.15, 0.75], [2.15, 3.0], [4.35, 3.0], [4.5, 2.2], [4.6, 0.75]], W * 0.98, 0.06);
  parts.paint.push(prep(cab));
  // chassis, bumpers, cargo door seams
  parts.detail.push(prep(box(W * 0.8, 0.35, 8.9, 0, 0.85, 0), '#26282c'));
  parts.detail.push(prep(box(W, 0.18, 0.15, 0, 0.72, -4.58), '#2a2c30'));
  parts.detail.push(prep(box(W * 0.98, 0.3, 0.12, 0, 0.75, 4.62), '#2a2c30'));
  parts.detail.push(prep(box(0.05, 2.5, 0.04, 0, 2.55, -4.57), '#8a8d92'));
  for (const sx of [-1, 1]) parts.detail.push(prep(box(0.08, 2.5, 0.05, sx * (W / 2 - 0.08), 2.55, -4.57), '#8a8d92'));
  parts.detail.push(prep(box(0.52, 0.12, 0.03, 0, 0.98, -4.6), '#f2f2ee'));
  parts.detail.push(prep(box(0.9, 0.25, 0.03, 0, 1.25, 4.63), '#1e2024'));
  // glass
  const cen = [3.3, 1.9];
  parts.glass.push(prep(paneOnSegment([4.5, 2.2], [4.35, 3.0], W * 0.84, 0.05, 0.92, 0.06, cen)));
  for (const sx of [-1, 1]) parts.glass.push(prep(box(0.03, 0.75, 1.1, sx * (W * 0.49 + 0.02), 2.4, 3.6)));
  // lights
  for (const sx of [-1, 1]) {
    parts.tail.push(prep(box(0.3, 0.14, 0.05, sx * 0.9, 0.82, -4.62), '#d8141c'));
    parts.head.push(prep(box(0.34, 0.16, 0.05, sx * 0.85, 1.0, 4.66), '#fff6dc'));
  }
  parts.decal.push(...truckDecals(W));
  wheels(t, parts);
  return parts;
}

// returns geometry lists: paint (tinted), glass, detail/tail/head (vertex colored), decal (textured)
// opts.plate: { scale, lift } enlarges the rear plate (the player's car carries a readable one)
export function buildCarParts(typeName, opts = {}) {
  const t = CAR_TYPES[typeName];
  if (t.truck) return buildTruck(t);
  const parts = { paint: [], glass: [], detail: [], tail: [], head: [], decal: [] };
  const W = t.W;
  const bevel = 0.1;
  const [zr, zf] = t.wheelZ;
  const ar = t.wheelR + 0.06 + bevel * 0.85;
  const y0 = t.clearance;
  parts.paint.push(prep(extrudeProfile(t.body, W, bevel, (s) => {
    s.lineTo(zf + ar, y0);
    s.absarc(zf, y0, ar, 0, Math.PI, false);
    s.lineTo(zr + ar, y0);
    s.absarc(zr, y0, ar, 0, Math.PI, false);
  })));
  const cw = W * t.cabinW;
  const cb = 0.07;
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

  // glass: side windows, rear window, windshield
  const cen = centroid(t.cabin);
  const sidePoly = t.sideWindow || insetPolygon(t.cabin, 0.075).map(([z, y]) => [z, Math.max(y, belt + 0.06)]);
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape(sidePoly.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateY(-Math.PI / 2);
    g.translate(sx * (cw / 2 + 0.012), 0, 0);
    parts.glass.push(taper(prep(g)));
  }
  const [rf0, rf1] = t.rearWindowFrac || [0.1, 0.9];
  parts.glass.push(taper(prep(paneOnSegment(t.cabin[0], t.cabin[1], cw - 0.22, rf0, rf1, cb * 0.85 + 0.012, cen))));
  const n = t.cabin.length;
  parts.glass.push(taper(prep(paneOnSegment(t.cabin[n - 1], t.cabin[n - 2], cw - 0.18, 0.06, 0.94, cb * 0.85 + 0.012, cen))));
  // B-pillar
  if (!t.sideWindow) {
    const bz = (t.cabin[0][0] + t.cabin[n - 1][0]) / 2 + 0.25;
    for (const sx of [-1, 1]) parts.paint.push(taper(prep(box(0.03, 0.42, 0.1, sx * (cw / 2 + 0.02), belt + 0.26, bz))));
  }

  // rear details
  const rz = (y) => endZ(t.body, y, -1) - bevel * 0.85;
  const fz = (y) => endZ(t.body, y, 1) + bevel * 0.85;
  parts.detail.push(prep(box(W * 0.9, 0.16, 0.14, 0, y0 + 0.08, rz(y0 + 0.08) + 0.03), '#2a2c30'));
  const ps = opts.plate?.scale ?? 1;
  const py = t.plateY + (opts.plate?.lift ?? 0);
  parts.detail.push(prep(box(0.52 * ps + 0.02, 0.12 * ps + 0.012, 0.03, 0, py, rz(py) - 0.01), ps > 1 ? '#1b1d21' : '#f2f2ee'));
  // EU strip on the left as seen from behind (+x is the car's left)
  if (ps === 1) parts.detail.push(prep(box(0.06, 0.12, 0.035, 0.24, py, rz(py) - 0.012), '#2346a0'));
  // where a textured rear plate can sit: just outside the plate's back face
  parts.rearPlate = { y: py, z: rz(py) - 0.01 - 0.015 - 0.006, w: 0.52 * ps, h: 0.114 * ps };
  // front details
  parts.detail.push(prep(box(W * 0.86, 0.18, 0.12, 0, y0 + 0.1, fz(y0 + 0.1) - 0.03), '#2a2c30'));
  parts.detail.push(prep(box(W * 0.46, 0.13, 0.05, 0, t.head.y - 0.04, fz(t.head.y - 0.04)), '#1e2024'));
  parts.detail.push(prep(box(0.52, 0.12, 0.03, 0, y0 + 0.24, fz(y0 + 0.24) + 0.01), '#f2f2ee'));
  // mirrors
  const mz = t.cabin[n - 1][0] - 0.25;
  for (const sx of [-1, 1]) parts.paint.push(prep(box(0.14, 0.11, 0.2, sx * (W / 2 + 0.06), t.cabin[0][1] + 0.1, mz)));

  if (t.spoiler) {
    const top = t.cabin[2];
    parts.paint.push(prep(box(cw * 0.8, 0.05, 0.3, 0, top[1] + cb * 0.85 + 0.01, top[0] - 0.08)));
  }

  // lights, wrapping around the rear corners
  for (const sx of [-1, 1]) {
    parts.tail.push(prep(box(t.tail.w, t.tail.h, 0.06, sx * t.tail.x, t.tail.y, rz(t.tail.y) + 0.005), '#d8141c'));
    if (t.tail.w > 0.2) parts.tail.push(prep(box(0.04, t.tail.h * 0.85, 0.22, sx * (W / 2 + 0.005), t.tail.y, rz(t.tail.y) + 0.2), '#d8141c'));
    parts.head.push(prep(box(t.head.w, t.head.h, 0.06, sx * t.head.x, t.head.y, fz(t.head.y) - 0.005), '#fff6dc'));
  }

  // soften the slab: barrel-shaped sides and rounded corners seen from above
  // (normals are kept, only the silhouette changes)
  const halfL = t.L / 2;
  for (const list of [parts.paint, parts.glass, parts.detail, parts.tail, parts.head]) {
    for (const g of list) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), z = p.getZ(i);
        let k = 1;
        if (y < belt) {
          const yy = Math.min(1, Math.abs(y - (belt + y0) / 2) / ((belt - y0) / 2));
          k -= 0.05 * yy * yy;
        }
        const e = Math.min(1, Math.max(0, (Math.abs(z) - (halfL - 0.6)) / 0.7));
        k -= 0.1 * e * e;
        p.setX(i, p.getX(i) * k);
      }
    }
  }
  wheels(t, parts);
  return parts;
}

export function mergeParts(list) {
  return mergeGeometries(list);
}
