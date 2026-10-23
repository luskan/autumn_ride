import * as THREE from 'three';
import { CAR_TYPES, buildCarParts, mergeParts } from './cars.js';
import { ROAD, PLAYER } from './config.js';
import { mulberry32, pick, pickWeighted, clamp } from './util.js';

const PAINTS = ['#b8bcc2', '#e8e8e6', '#e4e4e0', '#22252a', '#24406b', '#a3201c', '#2e4a3a', '#c9b48a', '#4a4e55', '#6f8fb0', '#7a1c22', '#d8d4c8', '#1d2a44'];
const TRUCK_PAINTS = ['#eeeeea', '#e8e8e4', '#2c5aa0', '#b0281e', '#2f6a3a', '#d8a020'];
const SPEEDS = { hatch: [19, 25], sedan: [20, 26], suv: [19, 25], van: [17, 22], truck: [14, 17.5] };
const MIX = { hatch: 0.3, sedan: 0.25, suv: 0.2, van: 0.13, truck: 0.12 };
const LIMIT_D = ROAD.rail - 0.15;
const HIT = 4; // closing speed (m/s) that counts as a real knock
const PUSH = 2.5; // speed kept while pushing against a car

export function createCarMaterials(env, { truckLogo } = {}) {
  return {
    paint: new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.55, roughness: 0.34, envMap: env, envMapIntensity: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: '#223040', metalness: 0.85, roughness: 0.12, envMap: env, envMapIntensity: 1.3, side: THREE.DoubleSide }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.65, envMap: env, envMapIntensity: 0.5 }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true }),
    decal: new THREE.MeshStandardMaterial({
      map: truckLogo, metalness: 0.1, roughness: 0.45, envMap: env, envMapIntensity: 0.6,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    }),
  };
}

export class Traffic {
  constructor(track, { sameCount = 28, oncomingCount = 22, seed = 5, materials, shadowTexture }) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    const rnd = mulberry32(seed);
    this.cars = [];
    const counts = {};
    for (let i = 0; i < sameCount + oncomingCount; i++) {
      const dir = i < sameCount ? 1 : -1;
      const type = pickWeighted(rnd, MIX);
      const t = CAR_TYPES[type];
      const [v0, v1] = SPEEDS[type];
      const vDesired = v0 + rnd() * (v1 - v0);
      const n = dir > 0 ? sameCount : oncomingCount;
      const k = dir > 0 ? i : i - sameCount;
      const s = track.wrap(((k + 0.2 + rnd() * 0.6) / n) * track.length + (dir < 0 ? 137 : 0));
      const lane = dir * ROAD.laneCenter;
      counts[type] = (counts[type] || 0) + 1;
      this.cars.push({
        type, dir, s, d: lane, lane, targetD: lane, vd: 0, v: vDesired, vDesired,
        len: t.L, halfW: t.W / 2, idx: counts[type] - 1, stun: 0, bumpCooldown: 0,
        prevRel: null, overtaken: false, phase: rnd() * 10,
        paint: new THREE.Color(type === 'truck' ? pick(rnd, TRUCK_PAINTS) : pick(rnd, PAINTS)),
      });
    }

    this.meshes = {};
    for (const type of Object.keys(counts)) {
      const parts = buildCarParts(type);
      const make = (list, mat, { cast = true, receive = true } = {}) => {
        const mesh = new THREE.InstancedMesh(mergeParts(list), mat, counts[type]);
        mesh.frustumCulled = false;
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return mesh;
      };
      // paint must stay first: it carries the per-car color
      this.meshes[type] = [
        make(parts.paint, materials.paint),
        make(parts.glass, materials.glass),
        make(parts.detail, materials.detail),
        make([...parts.tail, ...parts.head], materials.lights, { cast: false, receive: false }),
      ];
      if (parts.decal.length) {
        const decal = make(parts.decal, materials.decal, { cast: false });
        decal.name = 'truck-logo';
        this.meshes[type].push(decal);
      }
    }
    for (const c of this.cars) this.meshes[c.type][0].setColorAt(c.idx, c.paint);

    const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.045, 0);
    const blobMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, this.cars.length);
    this.blobs.frustumCulled = false;
    this.group.add(this.blobs);

    this.time = 0;
    this._f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
  }

  update(dt, player) {
    const tr = this.track;
    this.time += dt;
    const pHalf = PLAYER.width / 2;
    for (const c of this.cars) {
      let target = c.vDesired;
      let targetD = c.lane + Math.sin(this.time * 0.25 + c.phase) * 0.12;
      if (c.bumpCooldown > 0) c.bumpCooldown -= dt;
      if (c.stun > 0) {
        c.stun -= dt;
        target = 0;
      }
      const relP = tr.delta(player.s, c.s);
      if (Math.abs(relP) < 1600) {
        // keep distance to the vehicle ahead (only around the player, far away cars may
        // overlap unseen; overlapping ones drop back before the player gets there)
        for (const o of this.cars) {
          if (o === c || o.dir !== c.dir || Math.abs(o.d - c.d) > 1.7) continue;
          const ahead = tr.delta(c.s, o.s) * c.dir;
          const gap = ahead - (c.len + o.len) / 2;
          if (gap > 0 && gap < 12 + c.v * 1.2) target = Math.min(target, o.v * (gap < 6 ? 0.6 : 1));
          else if (gap <= 0 && ahead > 0) target = Math.min(target, o.v * 0.5);
        }
        const gapP = tr.delta(c.s, player.s) * c.dir - (c.len + PLAYER.length) / 2;
        const inPath = Math.abs(player.d - c.d) < c.halfW + pHalf + 0.35;
        if (c.dir > 0) {
          if (inPath && gapP > 0 && gapP < 14 + c.v * 1.3) target = Math.min(target, player.v * (gapP < 6 ? 0.6 : 0.95));
        } else if (gapP > -(c.len + PLAYER.length) - 3 && gapP < 70 && Math.abs(player.d - c.lane) < c.halfW + pHalf + 0.6) {
          // (keeps avoiding until it is completely past the player)
          // the player is in my lane ahead: squeeze past along my own guardrail if there is
          // room (never into the player's lane, that is where the player escapes), else stop
          const squeeze = player.d - (c.halfW + pHalf + 0.15);
          if (squeeze >= -(LIMIT_D - c.halfW)) targetD = Math.min(c.lane, squeeze);
          else target = Math.min(target, gapP < 25 ? 0 : 6);
          target = Math.min(target, 11);
        }
      }
      const acc = target > c.v ? 2.6 : 7.5;
      c.v += clamp(target - c.v, -acc * dt, acc * dt);
      c.s = tr.wrap(c.s + c.dir * c.v * dt);
      c.targetD = targetD;
      c.vd = clamp((targetD - c.d) * 1.6, -2.4, 2.4);
      c.d = clamp(c.d + c.vd * dt, -(LIMIT_D - c.halfW), LIMIT_D - c.halfW);
    }
  }

  // resolves overlaps with the player; pushes events ('bump', 'overtake', 'overtaken')
  collide(player, events) {
    const tr = this.track;
    const pHalf = PLAYER.width / 2;
    for (const c of this.cars) {
      const rel = tr.delta(player.s, c.s);
      if (c.dir > 0 && c.prevRel !== null && Math.abs(rel) < 40) {
        if (c.prevRel > 0 && rel <= 0 && !c.overtaken) {
          c.overtaken = true;
          events.push({ type: 'overtake' });
        } else if (c.prevRel <= 0 && rel > 0 && c.overtaken) {
          c.overtaken = false;
          events.push({ type: 'overtaken' });
        }
      }
      c.prevRel = rel;
      // far away again (e.g. a lap later): it can be overtaken once more
      if (Math.abs(rel) > 1000) c.overtaken = false;
      if (Math.abs(rel) > 15) continue;

      const ovS = (c.len + PLAYER.length) / 2 - Math.abs(rel);
      const dd = c.d - player.d;
      const ovD = c.halfW + pHalf - Math.abs(dd);
      if (ovS <= 0 || ovD <= 0) continue;

      // impact: closing speed in m/s; gentle contact (< PUSH) just blocks the player
      // without killing its speed, so it can always slide out sideways
      let impact;
      if (ovD < ovS * 0.6) {
        // side contact: push apart sideways
        const push = Math.sign(dd) || 1;
        player.d -= push * ovD * 0.7;
        c.d += push * ovD * 0.3;
        if (Math.sign(player.yaw) === push) player.yaw *= -0.35;
        impact = Math.abs(player.latV - c.vd) * 1.6;
        player.v *= 0.985;
      } else if (rel > 0) {
        player.s = tr.wrap(player.s - ovS - 0.05);
        impact = c.dir > 0 ? player.v - c.v : player.v + c.v;
        if (impact < HIT) {
          player.v = Math.min(player.v, Math.max(c.dir > 0 ? c.v : 0, PUSH));
        } else if (c.dir > 0) {
          player.v = Math.min(player.v, c.v) * 0.82;
          c.v = Math.min(c.v + 2.5, c.vDesired + 4);
        } else {
          player.v = 0;
          c.v = 0;
          c.stun = 1.2;
        }
      } else if (c.dir > 0) {
        c.s = tr.wrap(c.s - ovS - 0.05);
        impact = c.v - player.v;
        c.v = player.v * 0.8;
        if (impact >= HIT) player.v += 1.5;
      } else {
        c.s = tr.wrap(c.s + ovS + 0.05);
        impact = c.v + player.v * 0.3;
        c.v = 0;
        c.stun = 0.8;
      }
      if (c.bumpCooldown <= 0 && impact > PUSH + 0.3) {
        c.bumpCooldown = 0.9;
        events.push({ type: 'bump', strength: impact });
      }
    }
  }

  updateMeshes() {
    const tr = this.track;
    const F = this._f;
    const m = new THREE.Matrix4();
    const X = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3(), S = new THREE.Vector3();
    this.cars.forEach((c, i) => {
      tr.frameAt(c.s, F);
      P.copy(F.pos).addScaledVector(F.R, c.d).addScaledVector(F.U, 0.02);
      Z.copy(F.T).multiplyScalar(c.dir * Math.max(c.v, 3)).addScaledVector(F.R, c.vd);
      Z.addScaledVector(F.U, -Z.dot(F.U)).normalize();
      X.crossVectors(F.U, Z);
      m.makeBasis(X, F.U, Z).setPosition(P);
      for (const mesh of this.meshes[c.type]) mesh.setMatrixAt(c.idx, m);
      const t = CAR_TYPES[c.type];
      m.scale(S.set(t.W * 1.35, 1, t.L * 1.12));
      this.blobs.setMatrixAt(i, m);
    });
    for (const type in this.meshes) for (const mesh of this.meshes[type]) mesh.instanceMatrix.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
  }
}
