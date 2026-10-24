import * as THREE from 'three';
import { PLAYER, ROAD } from './config.js';
import { foliageMaterial } from './materials.js';
import { forestDensity, mulberry32, pick } from './util.js';

const PILE_COLORS = {
  oak: ['#a7642e', '#a85a2b', '#8c4c27'],
  maple: ['#854129', '#9e4928', '#ab5429'],
  amber: ['#a87130', '#9c5e29', '#b28238'],
  birch: ['#a08038', '#987132', '#ae8c3d'],
};
const LEAF_COLORS = {
  oak: ['#e48725', '#f0b63b', '#bd4b20', '#d5651e', '#aa4423'],
  maple: ['#b63e21', '#d15724', '#e27a2a', '#a73522', '#cf6829'],
  amber: ['#e1aa37', '#edc24b', '#c97824', '#d8932b', '#a95b26'],
  birch: ['#ead055', '#e6b93f', '#c69a30', '#f0d768', '#aa7a2b'],
};
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function frame() {
  return { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
}

// A shallow, uneven mound. Its silhouette is visible at driving distance, while
// individual textured leaves break up the surface when the camera gets close.
function moundGeometry() {
  const segments = 17;
  const rings = [0, 0.52, 1];
  const positions = [], colors = [], indices = [];
  const rnd = mulberry32(801);
  const wobble = Array.from({ length: segments }, () => 0.76 + rnd() * 0.45);
  for (let ring = 0; ring < rings.length; ring++) {
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const r = rings[ring] * wobble[i];
      const h = [1, 0.72, 0.015][ring] * (0.88 + rnd() * 0.22);
      positions.push(Math.cos(a) * r, h, Math.sin(a) * r);
      const shade = [0.95, 0.9, 0.57][ring] * (0.86 + rnd() * 0.22);
      colors.push(shade, shade * 0.95, shade * 0.84);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = ring * segments + i, b = ring * segments + next;
      const c = (ring + 1) * segments + i, d = (ring + 1) * segments + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class LeafPiles {
  constructor(track, terrain, vegetation, villages, texture, chunkSize) {
    this.track = track;
    this.terrain = terrain;
    this.rnd = mulberry32(20261024);
    this.piles = [];
    this.group = new THREE.Group();
    this.group.name = 'leaf-piles';
    this.particles = this.makeParticles(texture);
    this.place(vegetation, villages);
    this.buildMeshes(texture, chunkSize);
  }

  roadHeight(s, d) {
    return this.track.heightAt(s) + 0.04 * (1 - Math.abs(d) / ROAD.half) + 0.004;
  }

  addPile(s, d, width, length, height, road, f, sourceTree) {
    const x = f.pos.x + f.R.x * d;
    const z = f.pos.z + f.R.z * d;
    const y = road ? this.roadHeight(s, d) : this.terrain.heightAt(x, z);
    const pile = { s, d, x, y, z, width, length, height, road, sourceTree, kind: sourceTree.kind,
      angle: Math.atan2(f.T.x, f.T.z) + (this.rnd() - 0.5) * 0.35, hiddenFor: 0 };
    this.piles.push(pile);
  }

  place(vegetation, villages) {
    const rnd = this.rnd, tr = this.track, f = frame();
    const trees = [];
    for (const tree of vegetation.items) {
      if (!LEAF_COLORS[tree.kind] || tree.near < 6 || tree.near > 95) continue;
      const q = tr.nearest(tree.x, tree.z, 100);
      if (!q || !q.side) continue;
      trees.push({ tree, s: q.i * tr.ds, d: q.side * q.dist, near: q.dist, side: q.side,
        forest: forestDensity(tree.x, tree.z), rank: rnd() });
    }

    // Every road pile has an actual colored crown behind it. Favor the trees
    // moved closer to the verge, then keep enough distance between leaf drifts.
    const roadside = trees.filter(o => o.near < 18.5 && o.forest > 0.55)
      .sort((a, b) => (a.near - (a.tree.movedRoadside ? 4 : 0) + a.rank * 5)
        - (b.near - (b.tree.movedRoadside ? 4 : 0) + b.rank * 5));
    const selectedRoad = [];
    for (const o of roadside) {
      if (selectedRoad.some(prev => Math.abs(tr.delta(prev.s, o.s)) < (prev.side === o.side ? 28 : 12))) continue;
      selectedRoad.push(o);
      const s = tr.wrap(o.s + (rnd() - 0.5) * 3);
      const size = rnd();
      const width = size < 0.5 ? 0.43 + rnd() * 0.22 : size < 0.84 ? 0.66 + rnd() * 0.16 : 0.84 + rnd() * 0.14;
      const length = size < 0.5 ? 0.7 + rnd() * 0.35 : size < 0.84 ? 1.05 + rnd() * 0.4 : 1.48 + rnd() * 0.5;
      const height = size < 0.5 ? 0.07 + rnd() * 0.035 : size < 0.84 ? 0.11 + rnd() * 0.045 : 0.16 + rnd() * 0.06;
      const d = o.side * (4.68 - width * 0.52 + (rnd() - 0.5) * 0.12);
      tr.frameAt(s, f);
      this.addPile(s, d, width, length, height, true, f, o.tree);

      // Some leaves have blown roughly one third of the full road width in
      // from that tree's edge, making the forest sections pleasant to drive through.
      if (rnd() < 0.34) {
        const ss = tr.wrap(s + 3.5 + rnd() * 4);
        tr.frameAt(ss, f);
        const innerD = o.side * (ROAD.half - ROAD.half * 2 / 3 + (rnd() - 0.5) * 0.6);
        this.addPile(ss, innerD, 0.56 + rnd() * 0.3, 0.95 + rnd() * 0.65, 0.065 + rnd() * 0.055, true, f, o.tree);
      }
    }

    // Distant piles sit just in front of individual field trees rather than
    // appearing at unrelated random points across the landscape.
    const fieldTrees = trees.filter(o => o.near > 27 && o.near < 90).sort((a, b) => a.rank - b.rank);
    const selectedField = [];
    for (const o of fieldTrees) {
      if (selectedField.some(prev => Math.abs(tr.delta(prev.s, o.s)) < 95)) continue;
      const s = tr.wrap(o.s + (rnd() - 0.5) * 2);
      const d = o.d - o.side * (1.6 + rnd() * 1.2);
      tr.frameAt(s, f);
      const x = f.pos.x + f.R.x * d, z = f.pos.z + f.R.z * d;
      if (villages.some(v => Math.hypot(v.x - x, v.z - z) < v.radius)) continue;
      const width = 0.65 + rnd() * 0.65;
      const length = 0.9 + rnd() * 1.25;
      const height = 0.09 + rnd() * 0.15;
      if (Math.abs(this.terrain.heightAt(x + width, z) - this.terrain.heightAt(x - width, z)) > 0.7) continue;
      selectedField.push(o);
      this.addPile(s, d, width, length, height, false, f, o.tree);
    }
  }

  buildMeshes(texture, chunkSize) {
    const rnd = this.rnd, tr = this.track;
    const buckets = Array.from({ length: Math.ceil(tr.M / chunkSize) }, () => ({ mounds: [], leaves: [] }));
    const moundGeo = moundGeometry();
    const leafGeo = new THREE.PlaneGeometry(1, 1);
    leafGeo.rotateX(-Math.PI / 2);
    const moundMat = foliageMaterial({ vertexColors: true, side: THREE.DoubleSide }, { glow: 0.18, ambient: 0.12 });
    const leafMat = foliageMaterial({ map: texture, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide }, { glow: 0.27, ambient: 0.32 });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scale = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const f = frame();
    for (const pile of this.piles) {
      const bucket = buckets[Math.min(buckets.length - 1, Math.floor(pile.s / tr.ds / chunkSize))];
      pile.bucket = bucket;
      tr.frameAt(pile.s, f);
      q.setFromAxisAngle(UP, pile.angle);
      if (pile.road) {
        tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.asin(f.T.y));
        q.multiply(tilt);
      } else {
        const dx = (this.terrain.heightAt(pile.x + 1, pile.z) - this.terrain.heightAt(pile.x - 1, pile.z)) * 0.5;
        const dz = (this.terrain.heightAt(pile.x, pile.z + 1) - this.terrain.heightAt(pile.x, pile.z - 1)) * 0.5;
        tilt.setFromUnitVectors(UP, normal.set(-dx, 1, -dz).normalize());
        q.premultiply(tilt);
      }
      const mound = m.compose(pos.set(pile.x, pile.y + 0.006, pile.z), q, scale.set(pile.width * 0.78, pile.height, pile.length * 0.82)).clone();
      pile.moundIndex = bucket.mounds.length;
      bucket.mounds.push({ matrix: mound, color: pick(rnd, PILE_COLORS[pile.kind]) });
      pile.leafIndices = [];
      const count = Math.round(38 + pile.width * pile.length * 75);
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * (rnd() < 0.15 ? 1.26 : 0.98);
        const across = Math.cos(a) * r * pile.width;
        const along = Math.sin(a) * r * pile.length;
        const x = pile.x + f.R.x * across + f.T.x * along;
        const z = pile.z + f.R.z * across + f.T.z * along;
        const ground = pile.road ? this.roadHeight(pile.s + along, pile.d + across) : this.terrain.heightAt(x, z);
        const mr = r / 0.8;
        const top = pile.height * (mr < 0.52 ? 1 - 0.28 * mr / 0.52 : Math.max(0, 0.72 * (1 - (mr - 0.52) / 0.48)));
        const y = ground + top + 0.035 + rnd() * 0.035;
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.55, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.55, 'YXZ'));
        const size = (0.17 + rnd() * 0.19) * (pile.width > 0.8 ? 1.12 : 1);
        const leaf = m.compose(pos.set(x, y, z), q, scale.set(size, size, size)).clone();
        pile.leafIndices.push(bucket.leaves.length);
        bucket.leaves.push({ matrix: leaf, color: pick(rnd, LEAF_COLORS[pile.kind]) });
      }
    }
    const color = new THREE.Color();
    for (const bucket of buckets) {
      if (!bucket.mounds.length) continue;
      const moundMesh = new THREE.InstancedMesh(moundGeo, moundMat, bucket.mounds.length);
      const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, bucket.leaves.length);
      moundMesh.name = 'leaf-pile-mounds';
      leafMesh.name = 'leaf-pile-details';
      for (const [mesh, list] of [[moundMesh, bucket.mounds], [leafMesh, bucket.leaves]]) {
        list.forEach((item, i) => {
          mesh.setMatrixAt(i, item.matrix);
          mesh.setColorAt(i, color.set(item.color));
        });
        mesh.computeBoundingSphere();
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      bucket.moundMesh = moundMesh;
      bucket.leafMesh = leafMesh;
    }
  }

  makeParticles(texture) {
    const count = 620;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = foliageMaterial({ map: texture, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide }, { glow: 0.4, ambient: 0.4 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = 'flying-leaves';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, HIDDEN);
      mesh.setColorAt(i, color.set(LEAF_COLORS.oak[i % LEAF_COLORS.oak.length]));
    }
    this.particleList = Array.from({ length: count }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3() }));
    this.nextParticle = 0;
    return mesh;
  }

  setPileVisible(pile, visible) {
    const b = pile.bucket;
    b.moundMesh.setMatrixAt(pile.moundIndex, visible ? b.mounds[pile.moundIndex].matrix : HIDDEN);
    b.moundMesh.instanceMatrix.needsUpdate = true;
    for (const i of pile.leafIndices) b.leafMesh.setMatrixAt(i, visible ? b.leaves[i].matrix : HIDDEN);
    b.leafMesh.instanceMatrix.needsUpdate = true;
  }

  checkCar(car) {
    const speed = car.dir ? car.dir * car.v : car.v;
    if (Math.abs(speed) < 2.5) return;
    const tr = this.track;
    for (const pile of this.piles) {
      if (!pile.road || pile.hiddenFor > 0) continue;
      const along = Math.abs(tr.delta(car.s, pile.s));
      if (along > (car.len ?? PLAYER.length) * 0.5 + pile.length * 0.65) continue;
      if (Math.abs(car.d - pile.d) > (car.halfW ?? PLAYER.width * 0.5) + pile.width * 0.65) continue;
      pile.hiddenFor = 45;
      this.setPileVisible(pile, false);
      this.burst(pile, { s: car.s, v: speed });
    }
  }

  checkTraffic(cars, playerS) {
    // Only simulate bursts that the player can see or approach soon.
    for (const car of cars) {
      if (Math.abs(this.track.delta(playerS, car.s)) < 180) this.checkCar(car);
    }
  }

  burst(pile, player) {
    const rnd = this.rnd, f = frame();
    const color = new THREE.Color();
    this.track.frameAt(player.s, f);
    const count = Math.round(42 + pile.width * pile.length * 39);
    for (let i = 0; i < count; i++) {
      const p = this.particleList[this.nextParticle];
      this.particles.setColorAt(this.nextParticle, color.set(pick(rnd, LEAF_COLORS[pile.kind])));
      this.nextParticle = (this.nextParticle + 1) % this.particleList.length;
      const a = rnd() * Math.PI * 2, spread = Math.sqrt(rnd());
      p.pos.set(pile.x + Math.cos(a) * spread * pile.width, pile.y + 0.06 + rnd() * pile.height, pile.z + Math.sin(a) * spread * pile.length);
      const forward = Math.sign(player.v) * Math.min(4.5, Math.abs(player.v) * 0.17);
      p.vel.set(f.T.x * forward + (rnd() - 0.5) * 8, 2 + rnd() * 3.8, f.T.z * forward + (rnd() - 0.5) * 8);
      p.axis.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      p.angle = rnd() * Math.PI * 2;
      p.spin = (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 10);
      p.size = 0.19 + rnd() * 0.25;
      p.life = p.duration = 1.65 + rnd() * 1.15;
      p.ground = pile.y;
    }
    this.particles.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (const pile of this.piles) {
      if (pile.hiddenFor <= 0) continue;
      pile.hiddenFor -= dt;
      if (pile.hiddenFor <= 0) {
        pile.hiddenFor = 0;
        this.setPileVisible(pile, true);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), size = new THREE.Vector3();
    for (let i = 0; i < this.particleList.length; i++) {
      const p = this.particleList[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.x *= Math.exp(-0.55 * dt);
      p.vel.z *= Math.exp(-0.55 * dt);
      p.vel.y -= 3.9 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.angle * 0.34) * 0.25 * dt;
      p.angle += p.spin * dt;
      if (p.life <= 0 || p.pos.y < p.ground + 0.025) {
        p.life = 0;
        this.particles.setMatrixAt(i, HIDDEN);
        continue;
      }
      q.setFromAxisAngle(p.axis, p.angle);
      const k = p.size * Math.min(1, p.life / 0.5);
      this.particles.setMatrixAt(i, m.compose(p.pos, q, size.setScalar(k)));
    }
    this.particles.instanceMatrix.needsUpdate = true;
  }
}
