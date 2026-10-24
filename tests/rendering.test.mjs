import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { StaticInstances } from '../src/static-instances.js';
import { Traffic, createCarMaterials } from '../src/traffic.js';

function view() {
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 200);
  camera.lookAt(0, 0, -100);
  camera.updateMatrixWorld();
  return camera;
}

function forest(positions) {
  const small = new THREE.BoxGeometry(2, 2, 2), large = new THREE.BoxGeometry(8, 8, 8);
  const batch = new StaticInstances(positions.length, new THREE.MeshBasicMaterial());
  const shapes = [batch.addGeometry(small), batch.addGeometry(large)];
  for (const position of positions) {
    const id = batch.addInstance(shapes[0]);
    batch.setMatrixAt(id, new THREE.Matrix4().makeTranslation(...position));
  }
  batch.buildSpatialIndex(positions.map(() => shapes));
  batch.updateMatrixWorld();
  const visible = () => positions.map((_, id) => id).filter(id => batch.getVisibleAt(id));
  const draw = (camera, shadow = null) => { batch.updateVisibility(camera, shadow); return visible(); };
  return { batch, shapes, visible, draw };
}

test('static trees enter and leave the view when the camera turns, without recalculating instance transforms', () => {
  const { batch, draw } = forest([[0, 0, -20], [0, 0, 20], [100, 0, -20], [0, 0, -600]]);
  const camera = view();
  let matrixReads = 0;
  const getMatrixAt = batch.getMatrixAt.bind(batch);
  batch.getMatrixAt = (...args) => { matrixReads++; return getMatrixAt(...args); };
  assert.deepEqual(draw(camera), [0]);
  camera.lookAt(0, 0, 100); camera.updateMatrixWorld();
  assert.deepEqual(draw(camera), [1]);
  camera.lookAt(0, 0, -100); camera.updateMatrixWorld();
  assert.deepEqual(draw(camera), [0]);
  assert.equal(matrixReads, 0, 'static instance matrices should only be read during initialization');
});

test('trees outside the main view stay rendered when the shadow camera needs them', () => {
  const { batch, visible, draw } = forest([[0, 0, -20], [0, 0, 20]]);
  const camera = view();
  const shadow = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 50);
  shadow.position.z = 45; shadow.lookAt(0, 0, 20); shadow.updateMatrixWorld();
  assert.deepEqual(draw(camera), [0]);
  draw(camera, shadow);
  assert.deepEqual(visible(), [0, 1]);
  assert.deepEqual(draw(camera), [0]);
});

test('unchanged static instance slots do not upload their matrices and colors again', () => {
  const { batch, draw } = forest([[0, 0, -20], [0, 0, 20]]), camera = view();
  draw(camera);
  const mesh = batch.batches[0].mesh;
  const versions = [mesh.instanceMatrix.version, mesh.instanceColor.version];
  draw(camera);
  assert.deepEqual([mesh.instanceMatrix.version, mesh.instanceColor.version], versions);
  camera.lookAt(0, 0, 100); camera.updateMatrixWorld(); draw(camera);
  assert.ok(mesh.instanceMatrix.version > versions[0]);
});

test('raycasts use the current compacted instances after the view changes', () => {
  const { batch, draw } = forest([[0, 0, -20], [0, 0, 20]]), camera = view();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  draw(camera);
  assert.ok(ray.intersectObject(batch).length > 0);
  camera.lookAt(0, 0, 100); camera.updateMatrixWorld(); draw(camera);
  ray.ray.direction.z = 1;
  assert.ok(ray.intersectObject(batch).length > 0);
});

test('an LOD change updates visibility at the edge of the view without losing the spatial cell', () => {
  const { batch, shapes, draw } = forest([[18, 0, -20]]);
  const camera = view();
  assert.deepEqual(draw(camera), []);
  batch.setGeometryIdAt(0, shapes[1]);
  assert.deepEqual(draw(camera), [0]);
  batch.setGeometryIdAt(0, shapes[0]);
  assert.deepEqual(draw(camera), []);
});

test('cached tree bounds remain correct when the whole forest is transformed', () => {
  const { batch, draw } = forest([[0, 0, -20]]), camera = view();
  batch.position.x = 120; batch.updateMatrixWorld();
  assert.deepEqual(draw(camera), []);
  camera.position.x = 120; camera.lookAt(120, 0, -100); camera.updateMatrixWorld();
  assert.deepEqual(draw(camera), [0]);
});

function traffic() {
  const track = {
    length: 1000, wrap: s => ((s % 1000) + 1000) % 1000,
    delta: (a, b) => ((b - a + 1500) % 1000) - 500,
    kappaAt: () => 0,
    frameAt(s, frame) {
      frame.pos.set(0, 0, -s); frame.T.set(0, 0, -1);
      frame.R.set(1, 0, 0); frame.U.set(0, 1, 0);
      return frame;
    },
  };
  const t = new Traffic(track, { sameCount: 20, oncomingCount: 0, seed: 5,
    materials: createCarMaterials(null, { truckLogo: null }), shadowTexture: null });
  for (const c of t.cars) { c.s = 600; c.d = 0; c.vd = 0; }
  return t;
}

test('traffic compacts visible instances while preserving colors, parts and the simulated cars', () => {
  const t = traffic(), camera = view();
  const first = t.cars[0], second = t.cars.find(c => c !== first && c.type === first.type);
  assert.ok(second);
  first.s = 20; second.s = 35;
  t.updateMeshes(camera);
  const meshes = t.meshes[first.type];
  assert.ok(meshes.every(mesh => mesh.count === 2));
  assert.ok(t.wheelMeshes[first.type].every(mesh => mesh.count === 2 * t.wheelSpecs[first.type].axles.length));
  assert.equal(t.blobs.count, 2);
  const color = new THREE.Color();
  meshes[0].getColorAt(1, color);
  assert.ok(['r', 'g', 'b'].every(key => Math.abs(color[key] - second.paint[key]) < 1e-6));

  first.s = 600; second.s = 30;
  t.updateMeshes(camera);
  assert.ok(meshes.every(mesh => mesh.count === 1));
  assert.ok(t.wheelMeshes[first.type].every(mesh => mesh.count === t.wheelSpecs[first.type].axles.length));
  meshes[0].getColorAt(0, color);
  assert.ok(['r', 'g', 'b'].every(key => Math.abs(color[key] - second.paint[key]) < 1e-6));
  const matrix = new THREE.Matrix4();
  for (const mesh of meshes) {
    mesh.getMatrixAt(0, matrix);
    assert.equal(matrix.elements[14], -30, 'glass, lights and decals must follow the same visible car');
  }
  assert.equal(t.cars.length, 20);
  assert.equal(t.blobs.count, 1);
});

test('a car behind the viewer remains rendered when its shadow is in the shadow camera', () => {
  const t = traffic(), camera = view(), car = t.cars[0];
  car.s = -20;
  t.updateMeshes(camera);
  assert.equal(t.blobs.count, 0);
  const shadow = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 50);
  shadow.position.z = 45; shadow.lookAt(0, 0, 20); shadow.updateMatrixWorld();
  t.updateMeshes(camera, shadow);
  assert.equal(t.blobs.count, 1);
  assert.ok(t.meshes[car.type].every(mesh => mesh.count === 1));
  assert.ok(t.wheelMeshes[car.type].every(mesh => mesh.count === t.wheelSpecs[car.type].axles.length));
  t.updateMeshes();
  assert.equal(t.blobs.count, 20, 'render culling must not remove cars from the simulation');
});

test('traffic wheel matrices roll independently and steer only the front axle', () => {
  const t = traffic(), camera = view(), car = t.cars[0];
  car.s = 20; car.v = 12; car.vd = 1.2; car.wheelSpin = 0.5;
  t.updateMeshes(camera);
  const { axles, x, radius } = t.wheelSpecs[car.type];
  const body = new THREE.Matrix4(), wheel = new THREE.Matrix4();
  t.meshes[car.type][0].getMatrixAt(0, body);
  const toLocal = body.clone().invert();
  const local = (axle) => {
    t.wheelMeshes[car.type][1].getMatrixAt(axle, wheel);
    return wheel.premultiply(toLocal).clone();
  };
  const rear = local(0), front = local(axles.length - 1);
  assert.ok(Math.abs(rear.elements[12] - x) < 1e-6);
  assert.ok(Math.abs(rear.elements[13] - radius) < 1e-6);
  assert.ok(Math.abs(rear.elements[14] - axles[0]) < 1e-6);
  const unroll = new THREE.Matrix4().makeRotationX(-car.wheelSpin);
  const rearStraight = rear.clone().multiply(unroll);
  const frontStraight = front.clone().multiply(unroll);
  assert.ok(Math.abs(rearStraight.elements[8]) < 1e-6, 'rear axle stays straight');
  const rearHeading = new THREE.Vector3(0, 0, 1).transformDirection(body.clone().multiply(rearStraight));
  const frontHeading = new THREE.Vector3(0, 0, 1).transformDirection(body.clone().multiply(frontStraight));
  assert.ok(frontHeading.x > rearHeading.x, 'front axle steers toward road right (+X) during a right lane change');

  const before = car.wheelSpin;
  t.update(0.1, { s: 800, d: 1.85, v: 0 });
  assert.ok(Math.abs(car.wheelSpin - (before + car.v * 0.1 / radius) % (Math.PI * 2)) < 1e-9);
});
