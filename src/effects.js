import * as THREE from 'three';
import { foliageMaterial } from './materials.js';
import { mulberry32, pick } from './util.js';

const LEAF_COLORS = ['#e07a1f', '#c8401c', '#f0b234', '#a8401a', '#d9952a', '#8a5a22', '#e8a03a'];

// leaves drifting down around the camera
export class Leaves {
  constructor(texture, count = 220) {
    const rnd = (this.rnd = mulberry32(99));
    const mat = foliageMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }, { glow: 0.35, ambient: 0.4 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.17), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'leaves';
    const col = new THREE.Color();
    this.p = [];
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, col.set(pick(rnd, LEAF_COLORS)));
      this.p.push({
        pos: new THREE.Vector3(), axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        angle: rnd() * 6, spin: 1.5 + rnd() * 4, fall: 0.55 + rnd() * 0.6, phase: rnd() * 10, scale: 0.7 + rnd() * 0.7, alive: false,
      });
    }
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.time = 0;
  }

  spawn(p, groundY, anywhere) {
    const r = this.rnd;
    const f = anywhere ? (r() - 0.5) * 50 : 22 + r() * 4;
    const l = (r() - 0.5) * 44;
    p.pos.copy(this.center).addScaledVector(this.fwd, f).addScaledVector(this.right, l);
    p.pos.y = groundY + 0.4 + r() * 8.5;
    p.alive = true;
  }

  update(dt, camera, groundY) {
    this.time += dt;
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    this.fwd.normalize();
    this.right.set(-this.fwd.z, 0, this.fwd.x);
    this.center.copy(camera.position).addScaledVector(this.fwd, 18);
    const rel = new THREE.Vector3();
    this.p.forEach((p, i) => {
      if (!p.alive) this.spawn(p, groundY, true);
      p.pos.x += (0.6 + Math.sin(this.time * 1.3 + p.phase) * 0.7) * dt;
      p.pos.z += Math.cos(this.time * 0.9 + p.phase) * 0.5 * dt;
      p.pos.y -= p.fall * dt;
      p.angle += p.spin * dt;
      rel.subVectors(p.pos, this.center);
      const f = rel.dot(this.fwd), l = rel.dot(this.right);
      if (f < -26 || f > 30 || Math.abs(l) > 24) this.spawn(p, groundY, false);
      else if (p.pos.y < groundY - 1.5) {
        this.spawn(p, groundY, true);
        p.pos.y = groundY + 6 + this.rnd() * 3;
      }
      this.q.setFromAxisAngle(p.axis, p.angle);
      this.m.compose(p.pos, this.q, this.s.setScalar(p.scale));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// sparks when scraping the guardrail
export class Sparks {
  constructor(texture, count = 90) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: '#ffb447', map: texture, size: 0.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.next = 0;
    this.rnd = mulberry32(5);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -1e4;
  }

  emit(origin, velocity, n) {
    const r = this.rnd;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      this.pos.set([origin.x, origin.y, origin.z], i * 3);
      this.vel.set([velocity.x + (r() - 0.5) * 3, 1 + r() * 2.5, velocity.z + (r() - 0.5) * 3], i * 3);
      this.life[i] = 0.25 + r() * 0.3;
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1e4;
        continue;
      }
      this.vel[i * 3 + 1] -= 9.8 * dt;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
