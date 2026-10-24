import * as THREE from 'three';
import { buildCarParts, mergeParts, CAR_TYPES } from './cars.js';
import { PLAYER, ROAD } from './config.js';
import { clamp, damp } from './util.js';

const moveTowards = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// longitudinal model, shared with the autopilot
export const BRAKE_DECEL = 11;
const REVERSE_ACCEL = 3.8;
export const engineAccel = (v) => 6.2 * (1 - Math.pow(Math.abs(v) / PLAYER.maxSpeed, 1.8)) + 0.4;
export const resistance = (v, slope) => 0.35 + 0.00042 * v * v + 9.81 * slope * 0.6;
// steering model: how far the car may turn away from the road heading at speed v
export const maxYaw = (v) => (0.07 + 0.32 / (1 + Math.abs(v) / 7)) * Math.min(1, Math.abs(v) / 2.5);
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
    this.paintMat = new THREE.MeshStandardMaterial({ color: '#8e99a6', metalness: 0.42, roughness: 0.36, envMap: env, envMapIntensity: 0.85 });
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

  // Down brakes, then reverses. Analog reverse is explicit so autopilot braking only stops.
  update(dt, input, events) {
    const tr = this.track;
    const F = tr.frameAt(this.s, this._f);

    const gas = typeof input.throttle === 'number' ? clamp(input.throttle, 0, 1) : input.up ? 1 : 0;
    const brake = typeof input.brake === 'number' ? clamp(input.brake, 0, 1) : input.down ? 1 : 0;
    const reverse = typeof input.reverse === 'number' ? clamp(input.reverse, 0, 1) : input.down ? 1 : 0;
    const reversing = reverse > 0 && gas === 0 && this.v <= 0;
    const direction = this.v < 0 || reversing ? -1 : 1;
    const braking = reversing ? 0 : this.v < 0 ? Math.max(gas, brake) : brake;
    const drive = reversing ? -reverse * REVERSE_ACCEL : this.v >= 0 ? gas * engineAccel(this.v) : 0;
    this.throttle = damp(this.throttle, reversing ? reverse : this.v >= 0 ? gas : 0, 10, dt);
    const a = drive - direction * (braking * BRAKE_DECEL + resistance(this.v, F.T.y * direction));
    // Changing direction always goes through a stop, including with both pedals held.
    this.v = clamp(this.v + a * dt, direction < 0 ? -PLAYER.maxReverseSpeed : 0, direction < 0 ? 0 : PLAYER.maxSpeed);
    this.braking = braking > 0.05 && Math.abs(this.v) > 0.3;

    const steerIn = typeof input.steer === 'number' ? clamp(input.steer, -1, 1) : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.steer = moveTowards(this.steer, steerIn, (steerIn !== 0 ? 4.5 : 6) * dt);
    this.yaw = damp(this.yaw, this.steer * maxYaw(this.v) * direction, 7, dt);
    // the bend pushes the car to its outer side
    const drift = tr.kappaAt(this.s) * this.v * this.v * DRIFT;
    this.latV = this.v * Math.sin(this.yaw) - drift;
    this.d += this.latV * dt;
    const ds = this.v * Math.cos(this.yaw) * dt;
    this.s = tr.wrap(this.s + ds);
    this.distance += Math.abs(ds);

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
      if (Math.sign(this.yaw) === side * Math.sign(this.v)) this.yaw *= -0.25;
      this.v = moveTowards(this.v, 0, (2.0 + into * 1.5 + Math.abs(this.v) * 0.22) * dt);
      this.scrape = Math.abs(this.v) > 1 ? Math.min(1, 0.25 + into * 0.25 + Math.abs(this.v) / 60) : 0;
      if (!wasTouching && into > 1.2) events.push({ type: 'rail', strength: into });
    }
  }

  updateVisual(dt, time) {
    const F = this.track.frameAt(this.s, this._f);
    const speed = Math.abs(this.v);
    const direction = this.v < 0 ? -1 : 1;
    const vy = Math.atan2(this.latV * direction, Math.max(speed, 1.5));
    const Z = F.T.clone().multiplyScalar(Math.cos(vy)).addScaledVector(F.R, Math.sin(vy)).normalize();
    const X = new THREE.Vector3().crossVectors(F.U, Z);
    this._m.makeBasis(X, F.U, Z);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.position.copy(F.pos).addScaledVector(F.R, this.d).addScaledVector(F.U, 0.02);

    const sp = Math.min(1, speed / 20);
    this.pivot.rotation.z = damp(this.pivot.rotation.z, -this.steer * 0.035 * sp, 6, dt);
    const pitch = direction * (this.braking ? 0.022 : -0.012 * this.throttle * (1 - speed / PLAYER.maxSpeed));
    this.pivot.rotation.x = damp(this.pivot.rotation.x, pitch, 5, dt);
    this.pivot.position.y = 0.55 + Math.sin(time * 31) * 0.004 * (speed / PLAYER.maxSpeed) + (this.touchingRail ? Math.sin(time * 60) * 0.006 : 0);
    const b = this.braking ? 1.9 : 0.75;
    this.tailMat.color.setRGB(b, b, b);
  }
}
