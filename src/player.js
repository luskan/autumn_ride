import * as THREE from 'three';
import { buildCarParts, mergeParts, CAR_TYPES } from './cars.js';
import { PLAYER, ROAD } from './config.js';
import { clamp, damp } from './util.js';

const moveTowards = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// longitudinal model, shared with the autopilot
export const BRAKE_DECEL = 11;
export const engineAccel = (v) => 6.2 * (1 - Math.pow(v / PLAYER.maxSpeed, 1.8)) + 0.4;
export const resistance = (v, slope) => 0.35 + 0.00042 * v * v + 9.81 * slope * 0.6;
// steering model: how far the car may turn away from the road heading at speed v
export const maxYaw = (v) => (0.07 + 0.32 / (1 + v / 7)) * Math.min(1, v / 2.5);
export const DRIFT = 0.22;

export class Player {
  constructor(track, materials, { env, plateTexture, shadowTexture }) {
    this.track = track;
    this.s = 0;
    this.d = ROAD.laneCenter;
    this.v = 0;
    this.yaw = 0;
    this.steer = 0;
    this.latV = 0;
    this.braking = false;
    this.throttle = 0;
    this.scrape = 0;
    this.scrapeSide = 0;
    this.touchingRail = false;
    this.distance = 0;

    const t = CAR_TYPES.hatch;
    const parts = buildCarParts('hatch', { plate: { scale: 1.3, lift: 0.05 } });
    // third brake light above the rear window
    parts.tail.push(new THREE.BoxGeometry(0.34, 0.04, 0.03).translate(0, 1.4, -1.86).toNonIndexed());
    const tb = parts.tail[parts.tail.length - 1];
    tb.deleteAttribute('uv');
    const red = new Float32Array(tb.attributes.position.count * 3);
    for (let i = 0; i < red.length; i += 3) red.set([0.69, 0.006, 0.01], i);
    tb.setAttribute('color', new THREE.BufferAttribute(red, 3));

    this.paintMat = new THREE.MeshStandardMaterial({ color: '#8e99a6', metalness: 0.72, roughness: 0.26, envMap: env, envMapIntensity: 1.1 });
    this.tailMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    this.group.name = 'player';
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.55;
    const model = new THREE.Group();
    model.position.y = -0.55;
    this.pivot.add(model);
    this.group.add(this.pivot);
    const add = (geo, mat, shadow = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      model.add(mesh);
      return mesh;
    };
    add(mergeParts(parts.paint), this.paintMat);
    add(mergeParts(parts.glass), materials.glass);
    add(mergeParts(parts.detail), materials.detail);
    add(mergeParts(parts.head), materials.lights, false);
    add(mergeParts(parts.tail), this.tailMat, false);
    // pure black on white, sampled slightly sharper so the text survives minification
    const plateMat = new THREE.MeshBasicMaterial({ map: plateTexture, toneMapped: false });
    plateMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv, -0.8 );\ndiffuseColor *= sampledDiffuseColor;',
      );
    };
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(parts.rearPlate.w, parts.rearPlate.h), plateMat);
    plate.rotation.y = Math.PI;
    plate.position.set(0, parts.rearPlate.y, parts.rearPlate.z);
    plate.name = 'rear-plate';
    model.add(plate);

    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(t.W * 1.4, t.L * 1.15).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    blob.position.y = 0.045;
    this.group.add(blob);

    this._f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
    this._m = new THREE.Matrix4();
  }

  reset(s, d = ROAD.laneCenter) {
    this.s = this.track.wrap(s);
    this.d = d;
    this.v = 0;
    this.yaw = 0;
    this.steer = 0;
    this.latV = 0;
  }

  // input: keys {up, down, left, right} or analog {throttle, brake, steer} (autopilot)
  update(dt, input, events) {
    const tr = this.track;
    const F = tr.frameAt(this.s, this._f);

    const gas = typeof input.throttle === 'number' ? clamp(input.throttle, 0, 1) : input.up ? 1 : 0;
    const brake = typeof input.brake === 'number' ? clamp(input.brake, 0, 1) : input.down ? 1 : 0;
    this.throttle = damp(this.throttle, gas, 10, dt);
    const a = gas * engineAccel(this.v) - brake * BRAKE_DECEL - resistance(this.v, F.T.y);
    this.v = clamp(this.v + a * dt, 0, PLAYER.maxSpeed);
    this.braking = brake > 0.05 && this.v > 0.3;

    const steerIn = typeof input.steer === 'number' ? clamp(input.steer, -1, 1) : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steer = moveTowards(this.steer, steerIn, (steerIn !== 0 ? 4.5 : 6) * dt);
    this.yaw = damp(this.yaw, this.steer * maxYaw(this.v), 7, dt);
    // the bend pushes the car to its outer side
    const drift = tr.kappaAt(this.s) * this.v * this.v * DRIFT;
    this.latV = this.v * Math.sin(this.yaw) - drift;
    this.d += this.latV * dt;
    const ds = this.v * Math.cos(this.yaw) * dt;
    this.s = tr.wrap(this.s + ds);
    this.distance += ds;

    // guardrails keep the car on the road
    const lim = ROAD.rail - PLAYER.width / 2 - 0.08;
    const wasTouching = this.touchingRail;
    this.touchingRail = false;
    this.scrape = 0;
    if (Math.abs(this.d) > lim) {
      const side = Math.sign(this.d);
      const into = Math.max(0, this.latV * side);
      this.d = side * lim;
      this.touchingRail = true;
      this.scrapeSide = side;
      if (Math.sign(this.yaw) === side) this.yaw *= -0.25;
      this.v = Math.max(0, this.v - (2.0 + into * 1.5 + this.v * 0.22) * dt);
      this.scrape = this.v > 1 ? Math.min(1, 0.25 + into * 0.25 + this.v / 60) : 0;
      if (!wasTouching && into > 1.2) events.push({ type: 'rail', strength: into });
    }
  }

  updateVisual(dt, time) {
    const F = this.track.frameAt(this.s, this._f);
    const vy = Math.atan2(this.latV, Math.max(this.v, 1.5));
    const Z = F.T.clone().multiplyScalar(Math.cos(vy)).addScaledVector(F.R, Math.sin(vy)).normalize();
    const X = new THREE.Vector3().crossVectors(F.U, Z);
    this._m.makeBasis(X, F.U, Z);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.position.copy(F.pos).addScaledVector(F.R, this.d).addScaledVector(F.U, 0.02);

    const sp = Math.min(1, this.v / 20);
    this.pivot.rotation.z = damp(this.pivot.rotation.z, -this.steer * 0.035 * sp, 6, dt);
    const pitch = this.braking ? 0.022 : -0.012 * this.throttle * (1 - this.v / PLAYER.maxSpeed);
    this.pivot.rotation.x = damp(this.pivot.rotation.x, pitch, 5, dt);
    this.pivot.position.y = 0.55 + Math.sin(time * 31) * 0.004 * (this.v / PLAYER.maxSpeed) + (this.touchingRail ? Math.sin(time * 60) * 0.006 : 0);
    const b = this.braking ? 1.9 : 0.75;
    this.tailMat.color.setRGB(b, b, b);
  }
}
