import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from './config.js';
import { mulberry32, pick, forestDensity } from './util.js';
import { planSigns, signUV } from './road-signs.js';

const frame = () => ({ pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() });

function colorize(g, hex) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// gable roof prism, ridge along z, sitting on y = 0
function roofGeo(w, d, h, roofHex, wallHex) {
  const x = w / 2, z = d / 2;
  const slope = [
    [-x, 0, z], [0, h, z], [0, h, -z], [-x, 0, z], [0, h, -z], [-x, 0, -z],
    [x, 0, z], [x, 0, -z], [0, h, -z], [x, 0, z], [0, h, -z], [0, h, z],
  ];
  const gable = [[-x, 0, z], [x, 0, z], [0, h, z], [x, 0, -z], [-x, 0, -z], [0, h, -z]];
  const mk = (pts, hex) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    g.computeVertexNormals();
    return colorize(g, hex);
  };
  return [mk(slope, roofHex), mk(gable, wallHex)];
}

const ROOFS = ['#a63a24', '#8c2f1e', '#b5532e', '#5a3a2c', '#4b4f56'];
const WALLS = ['#efe7d8', '#e8dcc3', '#f3efe6', '#e2d2b4', '#d9cbb0'];

export function planVillages(track, terrain, seed) {
  const rnd = mulberry32(seed);
  const f = frame();
  return [0.2, 0.55, 0.83].map((t, vi) => {
    track.frameAt(t * track.length, f);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 150 + rnd() * 100;
    const cx = f.pos.x + f.R.x * off * side;
    const cz = f.pos.z + f.R.z * off * side;
    const houses = [];
    if (vi === 1) houses.push({ type: 'church', x: cx, z: cz, w: 9, d: 20, h: 8, rot: Math.atan2(f.T.x, f.T.z) });
    const target = 8 + Math.floor(rnd() * 7);
    for (let k = 0; k < 200 && houses.length < target; k++) {
      const a = rnd() * Math.PI * 2, r = 14 + rnd() * 62;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (track.nearest(x, z, 45)) continue;
      if (houses.some((o) => Math.hypot(o.x - x, o.z - z) < (o.type === 'church' ? 22 : 15))) continue;
      const barn = rnd() < 0.2;
      houses.push({
        type: barn ? 'barn' : 'house', x, z,
        w: barn ? 9 + rnd() * 3 : 7 + rnd() * 3, d: barn ? 14 + rnd() * 4 : 9 + rnd() * 3, h: barn ? 4.5 : 3 + rnd() * 2.2,
        rot: rnd() * Math.PI, roof: barn ? '#5d3a26' : pick(rnd, ROOFS), wall: barn ? '#8a3b2a' : pick(rnd, WALLS),
      });
    }
    return {
      x: cx, z: cz, radius: 110, houses,
      blocked: (x, z) => houses.some((o) => Math.hypot(o.x - x, o.z - z) < Math.max(o.w, o.d) * 0.7 + 4),
    };
  });
}

export function buildVillages(villages, terrain) {
  const parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const v of villages) {
    for (const o of v.houses) {
      // sit on the lowest corner, foundation goes into the ground
      let base = Infinity;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const ca = Math.cos(o.rot), sa = Math.sin(o.rot);
        const lx = (sx * o.w) / 2, lz = (sz * o.d) / 2;
        base = Math.min(base, terrain.heightAt(o.x + lx * ca + lz * sa, o.z - lx * sa + lz * ca));
      }
      const local = [];
      if (o.type === 'church') {
        const wall = new THREE.BoxGeometry(o.w, o.h + 3, o.d);
        wall.translate(0, (o.h + 3) / 2 - 3, 0);
        local.push(colorize(wall, '#f2ede2'), ...roofGeo(o.w + 0.8, o.d + 0.8, 5, '#3f4248', '#f2ede2').map((g) => g.translate(0, o.h, 0)));
        const tower = new THREE.BoxGeometry(5, 19, 5);
        tower.translate(0, 9.5 - 3, o.d / 2 + 2.2);
        local.push(colorize(tower, '#f4efe4'));
        const spire = new THREE.ConeGeometry(3.4, 10, 4);
        spire.rotateY(Math.PI / 4);
        spire.translate(0, 16 + 5, o.d / 2 + 2.2);
        local.push(colorize(spire, '#3a3d44'));
      } else {
        const wall = new THREE.BoxGeometry(o.w, o.h + 2, o.d);
        wall.translate(0, (o.h + 2) / 2 - 2, 0);
        local.push(colorize(wall, o.wall));
        local.push(...roofGeo(o.w + 0.7, o.d + 0.6, o.w * (o.type === 'barn' ? 0.5 : 0.42), o.roof, o.wall).map((g) => g.translate(0, o.h, 0)));
        if (o.type === 'house') {
          for (const sx of [-1, 1]) {
            for (const wz of [-0.25, 0.25]) {
              const win = new THREE.BoxGeometry(0.08, 1.1, 1.0);
              win.translate((sx * o.w) / 2 + sx * 0.03, o.h * 0.55, wz * o.d);
              local.push(colorize(win, '#2c3440'));
            }
          }
          const chimney = new THREE.BoxGeometry(0.6, 1.8, 0.6);
          chimney.translate(o.w * 0.18, o.h + o.w * 0.3, o.d * 0.2);
          local.push(colorize(chimney, '#7a4a3a'));
        }
      }
      q.setFromAxisAngle(up, o.rot);
      m.compose(new THREE.Vector3(o.x, base, o.z), q, one);
      for (const g of local) parts.push(g.applyMatrix4(m));
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'villages';
  return mesh;
}

export function buildHayBales(track, terrain, villages, groundTexture, seed) {
  const rnd = mulberry32(seed);
  const spots = [];
  const f = frame();
  for (let tries = 0; tries < 900 && spots.length < 150; tries++) {
    const s = rnd() * track.length;
    track.frameAt(s, f);
    const side = rnd() < 0.5 ? -1 : 1;
    const d = 28 + rnd() * 170;
    const cx = f.pos.x + f.R.x * d * side, cz = f.pos.z + f.R.z * d * side;
    if (forestDensity(cx, cz) > 0.02 || track.nearest(cx, cz, 24)) continue;
    if (villages.some((v) => Math.hypot(v.x - cx, v.z - cz) < v.radius)) continue;
    const n = 2 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 30, z = cz + (rnd() - 0.5) * 30;
      spots.push({ x, z, y: terrain.heightAt(x, z), rot: rnd() * Math.PI });
    }
  }
  const geo = new THREE.CylinderGeometry(0.78, 0.78, 1.25, 16, 1);
  geo.rotateZ(Math.PI / 2);
  geo.translate(0, 0.72, 0);
  const mat = new THREE.MeshLambertMaterial({ color: '#d9b45e', map: groundTexture });
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  spots.forEach((o, i) => {
    q.setFromAxisAngle(up, o.rot);
    mesh.setMatrixAt(i, m.compose(p.set(o.x, o.y - 0.05, o.z), q, sc));
  });
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'hay';
  return mesh;
}

// ---- road signs ----


function quad(w, h, uv, flip) {
  const g = new THREE.PlaneGeometry(w, h);
  if (flip) g.rotateY(Math.PI);
  // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0); after the flip the same order
  // still reads left-to-right for a viewer standing behind the sign
  const a = g.attributes.uv;
  const us = [uv.u0, uv.u1, uv.u0, uv.u1];
  const vs = [uv.v1, uv.v1, uv.v0, uv.v0];
  for (let i = 0; i < 4; i++) a.setXY(i, us[i], vs[i]);
  return g;
}

export function buildSigns(track, terrain, atlas, env, villages, rules) {
  const plates = [], poles = [];
  const f = frame();
  const m = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(), P = new THREE.Vector3();
  const signs = planSigns(track, villages, rules);
  for (const o of signs) {
    track.frameAt(o.s, f);
    const d = o.low ? o.side * (ROAD.rail + 0.35) : o.side * (ROAD.signD + (o.wide ? 0.9 : 0));
    P.copy(f.pos).addScaledVector(f.R, d);
    const roadY = f.pos.y;
    const ground = Math.min(terrain.heightAt(P.x, P.z), roadY - 0.3);
    // face drivers of direction `dir`, turned slightly towards the road
    Z.set(-f.T.x * o.dir, 0, -f.T.z * o.dir).addScaledVector(f.R, -o.side * 0.14).normalize();
    X.crossVectors(Y, Z);
    const [w, h] = o.size;
    const centerY = (o.low ? roadY + 0.75 + h / 2 : roadY + (o.wide ? 1.6 : 1.75) + h / 2) + (o.lift || 0);
    m.makeBasis(X, Y, Z).setPosition(P.x, centerY, P.z);
    plates.push(quad(w, h, signUV(o.cell), false).applyMatrix4(m));
    const back = quad(w, h, signUV(o.back), true);
    back.translate(0, 0, -0.03);
    plates.push(back.applyMatrix4(m));
    const poleH = centerY - ground + (o.low ? 0 : h * 0.3);
    for (const px of o.wide ? [-w * 0.32, w * 0.32] : [0]) {
      const pole = new THREE.CylinderGeometry(0.045, 0.05, poleH, 6);
      pole.deleteAttribute('uv');
      pole.translate(px, ground + poleH / 2 - centerY, -0.07);
      poles.push(pole.applyMatrix4(m));
    }
  }
  const group = new THREE.Group();
  group.name = 'signs';
  const plateMesh = new THREE.Mesh(mergeGeometries(plates), new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, emissive: '#ffffff', emissiveIntensity: 0.12, emissiveMap: atlas }));
  plateMesh.castShadow = true;
  plateMesh.receiveShadow = true;
  const poleMesh = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.6, roughness: 0.45, envMap: env }));
  poleMesh.castShadow = true;
  group.add(plateMesh, poleMesh);
  group.userData.count = signs.length;
  group.userData.signs = signs;
  return group;
}
