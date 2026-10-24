import * as THREE from 'three';
import { BIRDS, WORLD } from './config.js';
import { clamp, lerp, mulberry32, pickWeighted, smoothstep } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const WING_AXIS = new THREE.Vector3(0, 0, 1);
const TYPES = { migration: 0.55, single: 0.2, takeoff: 0.125, landing: 0.125 };

// A narrow body and two angular wings; the whole bird has just 14 triangles.
function bodyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.04, 0.65, 0.12, 0, 0, 0, -0.09, -0.25,
    -0.12, 0, 0, 0, 0.12, -0.18, 0, 0, -0.65,
  ], 3));
  g.setIndex([0, 1, 4, 0, 4, 3, 0, 3, 2, 0, 2, 1, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1, 5]);
  return g;
}

function wingGeometry(side) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    side * 0.08, 0, 0.2, side * 0.7, 0.04, 0.13, side * 1.5, -0.03, -0.3,
    side * 0.7, 0, -0.3, side * 0.07, 0, -0.15,
  ], 3));
  g.setIndex([0, 1, 3, 1, 2, 3, 0, 3, 4]);
  return g;
}

function birdMaterial() {
  const mat = new THREE.MeshBasicMaterial({
    color: '#39362f', side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  mat.forceSinglePass = true;
  // Retain the built-in material's warm, sun-tinted fog and ordinary depth testing.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float birdOpacity;\nvarying float vBirdOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBirdOpacity = birdOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBirdOpacity;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vBirdOpacity;');
  };
  mat.customProgramCacheKey = () => 'autumn-birds';
  return mat;
}

// Position and derivative of a cubic flight path, without per-frame allocations.
function sampleFlight(flock, t, position, direction) {
  const [a, b, c, d] = flock.points;
  const v = 1 - t;
  position.copy(a).multiplyScalar(v * v * v)
    .addScaledVector(b, 3 * v * v * t).addScaledVector(c, 3 * v * t * t).addScaledVector(d, t * t * t);
  direction.set(
    3 * v * v * (b.x - a.x) + 6 * v * t * (c.x - b.x) + 3 * t * t * (d.x - c.x),
    3 * v * v * (b.y - a.y) + 6 * v * t * (c.y - b.y) + 3 * t * t * (d.y - c.y),
    3 * v * v * (b.z - a.z) + 6 * v * t * (c.z - b.z) + 3 * t * t * (d.z - c.z),
  ).normalize();
}

export class Birds {
  constructor(track, terrain, vegetation, { seed = WORLD.seed + 73, ...options } = {}) {
    this.track = track;
    this.terrain = terrain;
    this.canopies = vegetation.canopies;
    this.config = { ...BIRDS, ...options };
    this.rnd = mulberry32(seed);
    this.flocks = [];
    this.time = 0;
    this.nextSpawn = 0;
    this.started = false;

    // Only real groups of deciduous crowns can host a departure or arrival.
    const cells = new Map();
    for (const tree of vegetation.canopies) {
      if (track.coarseDistance(tree.x, tree.z) < this.config.minRoadDistance + 30) continue;
      const key = `${Math.floor(tree.x / 70)},${Math.floor(tree.z / 70)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(tree);
    }
    this.roosts = [...cells.values()].filter(trees => trees.length >= 4);

    this.group = new THREE.Group();
    this.group.name = 'birds';
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(this.config.maxBirds), 1).setUsage(THREE.DynamicDrawUsage);
    const mat = birdMaterial();
    this.meshes = [bodyGeometry(), wingGeometry(-1), wingGeometry(1)].map((geo, i) => {
      geo.setAttribute('birdOpacity', this.opacity);
      const mesh = new THREE.InstancedMesh(geo, mat, this.config.maxBirds);
      mesh.name = ['bird-bodies', 'bird-left-wings', 'bird-right-wings'][i];
      mesh.count = 0;
      mesh.frustumCulled = false; // the small pool moves over the whole landscape
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    });

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.roll = new THREE.Quaternion();
    this.wingRotation = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
  }

  range(a, b) { return lerp(a, b, this.rnd()); }

  makeMembers(type) {
    const migrating = type === 'migration';
    const count = migrating ? 7 + Math.floor(this.rnd() * 11) : type === 'single' ? 1 + Math.floor(this.rnd() * 3) : 3 + Math.floor(this.rnd() * 5);
    const spacing = this.range(5.5, 7.5);
    // Unequal arms occasionally turn the V into a loose J.
    const shortArm = this.rnd() < 0.4 ? this.range(0.55, 0.8) : 1;
    return Array.from({ length: count }, (_, i) => {
      const rank = Math.ceil(i / 2), side = i % 2 ? -1 : 1;
      return {
        side: i === 0 ? 0 : migrating ? side * rank * spacing * (side < 0 ? shortArm : 1) : this.range(-12, 12),
        back: i === 0 ? 0 : migrating ? rank * spacing * 1.25 : this.range(3, 18),
        lift: migrating ? rank * 0.32 + this.range(-0.4, 0.4) : this.range(-1, 1),
        delay: type === 'takeoff' || type === 'landing' ? i * 0.6 : 0,
        phase: this.range(0, Math.PI * 2), flap: this.range(2.1, 2.8), scale: this.range(0.9, 1.15),
      };
    });
  }

  makeFlyby(camera, type) {
    const distance = type === 'single' ? this.range(280, 580) : this.range(...this.config.flightDistance);
    const bearing = this.range(-0.75, 0.75);
    const center = camera.position.clone().addScaledVector(this.forward, Math.cos(bearing) * distance)
      .addScaledVector(this.right, Math.sin(bearing) * distance);
    center.y = Math.max(this.terrain.heightAt(center.x, center.z) + this.range(30, 55), camera.position.y + distance * this.range(0.035, 0.075));
    const heading = this.right.clone().multiplyScalar(this.rnd() < 0.5 ? -1 : 1)
      .addScaledVector(this.forward, this.range(-0.65, 0.65)).normalize();
    const length = this.range(340, 560);
    const a = center.clone().addScaledVector(heading, -length / 2);
    const d = center.clone().addScaledVector(heading, length / 2);
    d.y += this.range(-7, 7);
    const b = a.clone().lerp(d, 1 / 3).addScaledVector(this.forward, this.range(-35, 35));
    const c = a.clone().lerp(d, 2 / 3).addScaledVector(this.forward, this.range(-35, 35));
    return { points: [a, b, c, d], duration: length / this.range(12, 18) };
  }

  makeForestFlight(camera, type) {
    const candidates = [];
    for (const trees of this.roosts) {
      const tree = trees[0];
      const dx = tree.x - camera.position.x, dz = tree.z - camera.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < this.config.roostDistance[0] || distance > this.config.roostDistance[1]) continue;
      if ((dx * this.forward.x + dz * this.forward.z) / distance < 0.7) continue;
      candidates.push(trees);
    }
    if (!candidates.length) return null;
    const trees = candidates[Math.floor(this.rnd() * candidates.length)];
    const tree = trees[Math.floor(this.rnd() * trees.length)];
    // The hidden end stays inside an opaque crown even if the camera moves past it.
    const hidden = new THREE.Vector3(tree.x, tree.y - tree.radius * 0.15, tree.z);
    const away = hidden.clone().sub(camera.position).setY(0).normalize()
      .addScaledVector(this.right, this.range(-0.6, 0.6)).normalize();
    const length = this.range(260, 400);
    const high = hidden.clone().addScaledVector(away, length);
    high.y = Math.max(tree.top + this.range(36, 60), this.terrain.heightAt(high.x, high.z) + 40);
    const near = hidden.clone().addScaledVector(away, 45);
    near.y = tree.top + this.range(10, 17);
    const far = hidden.clone().lerp(high, 0.65);
    far.y += 8;
    const points = type === 'takeoff' ? [hidden, near, far, high] : [high, far, near, hidden];
    return { points, duration: length / this.range(11, 15), tree };
  }

  clearFlight(flock, camera) {
    const radius = Math.max(...flock.members.map(bird => Math.hypot(bird.side, bird.back))) + 4;
    const margin = this.config.minRoadDistance + radius + 15;
    const half = this.terrain.size / 2 - radius - 20;
    const samples = Math.ceil(flock.points[0].distanceTo(flock.points[3]) / 18);
    for (let i = 0; i <= samples; i++) {
      sampleFlight(flock, i / samples, this.position, this.direction);
      const p = this.position;
      if (Math.abs(p.x) > half || Math.abs(p.z) > half || this.track.nearest(p.x, p.z, margin)) return false;
      if (p.distanceTo(camera.position) < this.config.minCameraDistance + radius + 30) return false;
      const clearance = flock.tree ? 2 : 22;
      if (p.y < this.terrain.heightAt(p.x, p.z) + clearance) return false;
    }
    let visible = 0;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      sampleFlight(flock, t, this.position, this.direction);
      this.projected.copy(this.position).project(camera);
      const p = this.projected;
      if (p.z > -1 && p.z < 1 && Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.8 && this.canSee(this.position, camera.position)) visible++;
    }
    return visible >= 2;
  }

  canSee(point, eye) {
    const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
    const horizontalSq = dx * dx + dz * dz;
    // A few cheap hill samples and crown ellipsoids avoid expensive scene raycasts.
    const steps = Math.ceil(Math.sqrt(horizontalSq) / 35);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (eye.y + dy * t < this.terrain.heightAt(eye.x + dx * t, eye.z + dz * t) + 0.5) return false;
    }
    for (const tree of this.canopies) {
      const t = ((tree.x - eye.x) * dx + (tree.z - eye.z) * dz) / horizontalSq;
      if (t <= 0 || t >= 1) continue;
      const x = eye.x + dx * t - tree.x, z = eye.z + dz * t - tree.z;
      const y = eye.y + dy * t - tree.y, height = tree.top - tree.y;
      if ((x * x + z * z) / (tree.width * tree.width) + (y * y) / (height * height) < 0.85) return false;
    }
    return true;
  }

  spawn(camera, type = pickWeighted(this.rnd, TYPES)) {
    if (this.flocks.length >= this.config.maxFlocks) return false;
    const members = this.makeMembers(type);
    if (members.length + this.flocks.reduce((n, flock) => n + flock.members.length, 0) > this.config.maxBirds) return false;
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.001) this.forward.copy(FORWARD);
    this.forward.normalize();
    this.right.crossVectors(this.forward, UP).normalize();
    camera.updateMatrixWorld(true);

    for (let attempt = 0; attempt < 24; attempt++) {
      const route = type === 'takeoff' || type === 'landing' ? this.makeForestFlight(camera, type) : this.makeFlyby(camera, type);
      if (!route) return false;
      const flock = { ...route, type, members, startedAt: this.time };
      if (!this.clearFlight(flock, camera)) continue;
      flock.lifetime = flock.duration + members[members.length - 1].delay;
      this.flocks.push(flock);
      return true;
    }
    return false;
  }

  update(dt, camera, running = true) {
    if (running) {
      this.time += dt;
      this.flocks = this.flocks.filter(flock => this.time - flock.startedAt < flock.lifetime);
      if (this.time >= this.nextSpawn && this.flocks.length < this.config.maxFlocks) {
        const spawned = this.spawn(camera, this.started ? pickWeighted(this.rnd, TYPES) : 'migration');
        if (spawned) this.started = true;
        this.nextSpawn = this.time + (spawned ? this.range(...this.config.interval) : 3);
      }
    }

    let index = 0;
    for (const flock of this.flocks) {
      const age = this.time - flock.startedAt;
      for (const bird of flock.members) {
        const birdAge = age - bird.delay;
        if (birdAge < 0 || birdAge >= flock.duration) continue;
        const t = clamp(birdAge / flock.duration, 0, 1);
        sampleFlight(flock, t, this.position, this.direction);
        this.side.crossVectors(this.direction, UP).normalize();
        const spread = flock.type === 'takeoff' ? smoothstep(0, 0.24, t) : flock.type === 'landing' ? 1 - smoothstep(0.72, 1, t) : 1;
        this.position.addScaledVector(this.side, bird.side * spread).addScaledVector(this.direction, -bird.back * spread);
        this.position.y += (bird.lift + Math.sin(birdAge * 0.8 + bird.phase) * 0.45) * spread;

        const distance = this.position.distanceTo(camera.position);
        const fadeOut = flock.type === 'landing' ? 0.5 : 4;
        this.opacity.array[index] = smoothstep(0, 2.5, birdAge)
          * (1 - smoothstep(flock.duration - fadeOut, flock.duration, birdAge))
          * smoothstep(this.config.minCameraDistance, this.config.minCameraDistance + 80, distance)
          * (1 - smoothstep(...this.config.fadeDistance, distance));

        this.rotation.setFromUnitVectors(FORWARD, this.direction);
        this.roll.setFromAxisAngle(WING_AXIS, Math.sin(birdAge * 0.5 + bird.phase) * 0.055);
        this.rotation.multiply(this.roll);
        this.scale.setScalar(bird.scale);
        this.matrix.compose(this.position, this.rotation, this.scale);
        this.meshes[0].setMatrixAt(index, this.matrix);
        // Short stretches of gliding interrupt the individual wingbeat rhythms.
        const flapping = smoothstep(-0.45, 0.05, Math.sin(birdAge * 0.45 + bird.phase));
        const flap = 0.13 + Math.sin(birdAge * bird.flap * Math.PI * 2 + bird.phase) * 0.55 * flapping;
        for (let wing = 1; wing <= 2; wing++) {
          this.wingRotation.setFromAxisAngle(WING_AXIS, wing === 1 ? -flap : flap).premultiply(this.rotation);
          this.matrix.compose(this.position, this.wingRotation, this.scale);
          this.meshes[wing].setMatrixAt(index, this.matrix);
        }
        index++;
      }
    }
    for (const mesh of this.meshes) {
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.opacity.needsUpdate = true;
  }
}
