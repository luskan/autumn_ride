import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from './config.js';

export const CHUNK = 400; // track samples (~m) per road chunk

// dash period that divides the loop length exactly, so the markings have no seam
export function roadPeriod(track) {
  return track.length / Math.round(track.length / 12);
}

// A strip following the track between samples i0..i1. cols = [{u, h, tu}]
function ribbon(track, cols, step, vScale, i0, i1) {
  const M = track.M;
  const rows = [];
  for (let idx = i0; idx < i1; idx += step) rows.push(idx);
  rows.push(i1);
  const nc = cols.length;
  const pos = new Float32Array(rows.length * nc * 3);
  const uv = new Float32Array(rows.length * nc * 2);
  rows.forEach((idx, r) => {
    const i = idx % M;
    const s = idx * track.ds;
    for (let c = 0; c < nc; c++) {
      const { u, h, tu } = cols[c];
      const k = (r * nc + c) * 3;
      pos[k] = track.px[i] + track.rx[i] * u + track.ux[i] * h;
      pos[k + 1] = track.py[i] + track.uy[i] * h;
      pos[k + 2] = track.pz[i] + track.rz[i] * u + track.uz[i] * h;
      uv[(r * nc + c) * 2] = tu;
      uv[(r * nc + c) * 2 + 1] = s / vScale;
    }
  });
  const index = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < nc - 1; c++) {
      const a = r * nc + c, b = a + 1, c2 = a + nc, d = c2 + 1;
      index.push(a, b, c2, b, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

const both = (make) => mergeGeometries([make(-1), make(1)]);

export function buildRoad(track, { roadTexture, groundTexture, env }) {
  const group = new THREE.Group();
  group.name = 'road';
  const period = roadPeriod(track);
  const H = ROAD.half;
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture });
  const skirtMat = new THREE.MeshLambertMaterial({ color: '#c09c56', map: groundTexture });
  const railMat = new THREE.MeshStandardMaterial({
    color: '#c9cdd2', metalness: 0.75, roughness: 0.34, side: THREE.DoubleSide, envMap: env, envMapIntensity: 1.0,
  });
  const postGeo = new THREE.BoxGeometry(0.11, 0.9, 0.09);
  postGeo.translate(0, 0.45 - 0.16, 0);
  const postMat = new THREE.MeshStandardMaterial({ color: '#9da2a8', metalness: 0.6, roughness: 0.5, envMap: env, envMapIntensity: 0.8 });
  const profile = [[0, 0.42], [0.07, 0.47], [0.025, 0.585], [0.07, 0.7], [0, 0.76]];
  const postStep = 4;
  const m = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3();
  const chunks = [];

  for (let i0 = 0; i0 < track.M; i0 += CHUNK) {
    const i1 = Math.min(i0 + CHUNK, track.M);
    const add = (geo, mat, name, cast) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = cast;
      mesh.name = name;
      group.add(mesh);
      return mesh;
    };
    add(ribbon(track, [{ u: -H, h: 0, tu: 0 }, { u: 0, h: 0.04, tu: 0.5 }, { u: H, h: 0, tu: 1 }], 1, period, i0, i1), roadMat, 'asphalt', false);

    // grassy embankment skirts hide the step between road and terrain
    add(both((sgn) => {
      const cols = [{ u: sgn * H, h: 0, tu: 0 }, { u: sgn * (H + 1.2), h: -0.35, tu: 0.15 }, { u: sgn * (H + 2.6), h: -1.1, tu: 0.3 }];
      return ribbon(track, sgn < 0 ? cols.reverse() : cols, 2, 9, i0, i1);
    }), skirtMat, 'skirt', false);

    // W-beam guardrails, faces towards the road
    add(both((sgn) => {
      const cols = profile.map(([off, h]) => ({ u: sgn * (ROAD.rail + 0.07 - off), h, tu: h }));
      return ribbon(track, sgn < 0 ? cols.reverse() : cols, 2, 4, i0, i1);
    }), railMat, 'rail', true);

    const posts = new THREE.InstancedMesh(postGeo, postMat, Math.ceil((i1 - i0) / postStep) * 2);
    let n = 0;
    for (let i = i0; i < i1; i += postStep) {
      for (const sgn of [-1, 1]) {
        const u = sgn * ROAD.post;
        X.set(-track.rx[i], 0, -track.rz[i]);
        Y.set(track.ux[i], track.uy[i], track.uz[i]);
        Z.set(track.tx[i], track.ty[i], track.tz[i]);
        P.set(track.px[i] + track.rx[i] * u, track.py[i], track.pz[i] + track.rz[i] * u);
        posts.setMatrixAt(n++, m.makeBasis(X, Y, Z).setPosition(P));
      }
    }
    posts.count = n;
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.computeBoundingSphere();
    posts.name = 'posts';
    group.add(posts);
    chunks.push({ posts });
  }
  return { group, chunks };
}
