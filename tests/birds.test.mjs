import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Birds } from '../src/birds.js';
import { BIRDS, WORLD } from '../src/config.js';
import { buildTrack } from '../src/track.js';
import { Terrain } from '../src/terrain.js';
import { Vegetation } from '../src/vegetation.js';
import { planVillages } from '../src/props.js';

// Use the actual hills, bends and crowns: flat mock scenery misses unsafe paths.
const track = buildTrack(WORLD.seed);
track.buildDistanceField(WORLD.terrainSize, 30);
const terrain = new Terrain(track, { size: WORLD.terrainSize, segments: WORLD.terrainSegments });
const vegetation = new Vegetation(track, terrain, { seed: 21, villages: planVillages(track, terrain, 11) });
const frame = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };

function viewAt(s) {
  const camera = new THREE.PerspectiveCamera(58, 1.75, 0.3, 2400);
  track.frameAt(s, frame);
  camera.position.copy(frame.pos).addScaledVector(frame.R, 1.85).addScaledVector(frame.T, -8.4);
  camera.position.y += 3;
  camera.lookAt(frame.pos.clone().addScaledVector(frame.T, 14).add(new THREE.Vector3(0, 1.1, 0)));
  return camera;
}

function scenario(type) {
  const birds = new Birds(track, terrain, vegetation);
  birds.nextSpawn = Infinity;
  for (let s = 0; s < track.length; s += 150) {
    const camera = viewAt(s);
    if (birds.spawn(camera, type)) return { birds, camera, flock: birds.flocks[0] };
  }
  assert.fail(`no ${type} could be generated anywhere on the route`);
}

for (const type of ['migration', 'single', 'takeoff', 'landing']) {
  test(`${type}: animated birds stay away from every road segment and above the real terrain`, () => {
    const { birds, camera, flock } = scenario(type);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    let visible = false;
    for (let t = 0; t < flock.lifetime + 1; t += 0.25) {
      birds.update(0.25, camera);
      for (let i = 0; i < birds.meshes[0].count; i++) {
        birds.meshes[0].getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        assert.equal(track.nearest(position.x, position.z, BIRDS.minRoadDistance), null, 'a follower drifted into the road corridor');
        assert.ok(position.y > terrain.heightAt(position.x, position.z), 'a bird clipped through a hill');
        assert.ok(position.distanceTo(camera.position) > BIRDS.minCameraDistance, 'a bird approached the camera');
        assert.ok(Number.isFinite(matrix.determinant()) && matrix.determinant() > 0);
        if (birds.opacity.array[i] > 0.5) visible = true;
      }
    }
    assert.ok(visible, 'the flyby never became visible');
    assert.equal(birds.flocks.length, 0, 'the finished event was not retired');
    assert.equal(birds.meshes[0].count, 0, 'expired instances remain on screen');
  });
}

test('forest arrivals and departures end inside opaque crowns from several viewing directions', () => {
  vegetation.mesh.updateMatrixWorld(true);
  for (const type of ['takeoff', 'landing']) {
    const { flock } = scenario(type);
    const hidden = flock.points[type === 'takeoff' ? 0 : 3];
    for (const azimuth of [0, 1.2, 2.7, 4.5]) {
      const origin = hidden.clone().add(new THREE.Vector3(Math.cos(azimuth) * 20, 2, Math.sin(azimuth) * 20));
      const direction = hidden.clone().sub(origin);
      const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0.1, direction.length() - 0.05);
      assert.ok(ray.intersectObject(vegetation.mesh).length > 0, `${type} endpoint is exposed at azimuth ${azimuth}`);
    }
  }
});

test('looking around leaves an established flock fixed in world coordinates', () => {
  const { birds, camera } = scenario('migration');
  birds.update(5, camera);
  const matrices = birds.meshes.map(mesh => mesh.instanceMatrix.array.slice());
  camera.rotateY(Math.PI * 0.7);
  birds.update(0, camera);
  birds.meshes.forEach((mesh, i) => assert.deepEqual(mesh.instanceMatrix.array, matrices[i]));
});

test('pause freezes lifetimes, wingbeats and the event scheduler', () => {
  const { birds, camera } = scenario('migration');
  birds.update(5, camera);
  birds.nextSpawn = birds.time;
  const time = birds.time, flocks = birds.flocks.slice();
  const matrices = birds.meshes.map(mesh => mesh.instanceMatrix.array.slice());
  birds.update(60, camera, false);
  assert.equal(birds.time, time);
  assert.deepEqual(birds.flocks, flocks);
  birds.meshes.forEach((mesh, i) => assert.deepEqual(mesh.instanceMatrix.array, matrices[i]));
  birds.update(0.25, camera);
  assert.equal(birds.time, time + 0.25);
  assert.notDeepEqual(birds.meshes[1].instanceMatrix.array, matrices[1]);
});

test('repeated events keep fixed rendering buffers and stay within flock and bird budgets', () => {
  const birds = new Birds(track, terrain, vegetation, { interval: [0.1, 0.2] });
  const buffers = birds.meshes.map(mesh => mesh.instanceMatrix.array);
  const opacity = birds.opacity.array;
  let events = 0;
  const seen = new Set();
  for (let t = 0; t < 360; t += 0.5) {
    birds.update(0.5, viewAt(t * 24));
    assert.ok(birds.flocks.length <= BIRDS.maxFlocks);
    for (const flock of birds.flocks) if (!seen.has(flock)) { seen.add(flock); events++; }
    assert.ok(birds.flocks.reduce((n, flock) => n + flock.members.length, 0) <= BIRDS.maxBirds);
    birds.meshes.forEach((mesh, i) => {
      assert.equal(mesh.instanceMatrix.array, buffers[i]);
      assert.ok(mesh.count <= BIRDS.maxBirds);
    });
    assert.equal(birds.opacity.array, opacity);
  }
  assert.ok(events >= 10, 'too few events exercised pool reuse');
});

test('the same seed reproduces a flyby for visual regression checks', () => {
  const { camera } = scenario('migration');
  const a = new Birds(track, terrain, vegetation), b = new Birds(track, terrain, vegetation);
  a.update(5, camera); b.update(5, camera);
  assert.deepEqual(a.flocks, b.flocks);
  assert.ok(a.flocks.length > 0);
  a.meshes.forEach((mesh, i) => assert.deepEqual(mesh.instanceMatrix.array, b.meshes[i].instanceMatrix.array));
});
