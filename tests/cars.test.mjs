import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { CAR_TYPES, buildCarParts, mergeParts } from '../src/cars.js';

const groups = ['paint', 'glass', 'detail', 'tail', 'head', 'decal'];
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

function model(parts) {
  const group = new THREE.Group();
  for (const key of groups) {
    if (!parts[key].length) continue;
    const mesh = new THREE.Mesh(mergeParts(parts[key]), material);
    mesh.name = key;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return group;
}

for (const [type, spec] of Object.entries(CAR_TYPES)) {
  test(`${type}: finite, mergeable low-poly geometry fits the vehicle`, () => {
    const parts = buildCarParts(type);
    const bounds = new THREE.Box3();
    let triangles = 0;
    for (const key of groups) {
      if (!parts[key].length) continue;
      const g = mergeParts(parts[key]);
      assert.ok(g, `${key} must merge into one material batch`);
      for (const [name, attr] of Object.entries(g.attributes)) {
        assert.ok(Array.from(attr.array).every(Number.isFinite), `${key}.${name} contains a non-finite value`);
      }
      const normals = g.attributes.normal;
      for (let i = 0; i < normals.count; i++) {
        const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
        assert.ok(Math.abs(length - 1) < 0.001, `${key} has a collapsed face or invalid shading normal`);
      }
      if (['detail', 'tail', 'head'].includes(key)) assert.equal(g.attributes.color.count, g.attributes.position.count);
      if (key === 'decal') assert.equal(g.attributes.uv.count, g.attributes.position.count);
      g.computeBoundingBox(); bounds.union(g.boundingBox);
      triangles += (g.index?.count ?? g.attributes.position.count) / 3;
    }
    const { wheels } = parts;
    assert.equal(wheels.radius, spec.wheelR);
    assert.equal(wheels.axles.length, spec.truck ? 3 : 2);
    for (const [sideIndex, sx] of [-1, 1].entries()) {
      const g = wheels.geometries[sideIndex];
      assert.equal(g.attributes.color.count, g.attributes.position.count);
      for (const attr of Object.values(g.attributes)) {
        assert.ok(Array.from(attr.array).every(Number.isFinite), 'wheel geometry contains a non-finite value');
      }
      const normals = g.attributes.normal;
      for (let i = 0; i < normals.count; i++) {
        const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
        assert.ok(Math.abs(length - 1) < 0.001, 'wheel has an invalid shading normal');
      }
      g.computeBoundingBox();
      for (const z of wheels.axles) {
        bounds.union(g.boundingBox.clone().translate(new THREE.Vector3(sx * wheels.x, wheels.radius, z)));
      }
      triangles += (g.index?.count ?? g.attributes.position.count) / 3 * wheels.axles.length;
    }
    assert.ok(triangles < 2200, `${triangles} triangles exceeds the mobile model budget`);
    assert.ok(bounds.min.y > -0.001 && bounds.min.y < 0.02, 'tires must meet the ground');
    assert.ok(bounds.max.z < spec.L / 2 + 0.18 && bounds.min.z > -spec.L / 2 - 0.18, 'body must fit the collision length');
    assert.ok(bounds.max.x < spec.W / 2 + 0.3 && bounds.min.x > -spec.W / 2 - 0.3, 'only mirrors extend beyond the body');
  });

  if (spec.truck) continue;
  test(`${type}: both headlight lenses stay outside the sloping bonnet`, () => {
    const parts = buildCarParts(type);
    const car = model(parts);
    const lenses = parts.head.filter(g => {
      g.computeBoundingBox();
      const size = g.boundingBox.getSize(new THREE.Vector3());
      const center = g.boundingBox.getCenter(new THREE.Vector3());
      return Math.abs(center.y - spec.head.y) < 0.015 && size.x > spec.head.w * 0.8;
    });
    assert.equal(lenses.length, 2);
    for (const lens of lenses) {
      const center = lens.boundingBox.getCenter(new THREE.Vector3());
      const ray = new THREE.Raycaster(new THREE.Vector3(center.x, center.y, spec.L), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(car, true)[0];
      assert.equal(hit?.object.name, 'head', `headlight hidden by ${hit?.object.name}`);
    }
  });
}

test('the enlarged AUTOMAPA plate remains exposed across its whole face', () => {
  const parts = buildCarParts('hatch', { plate: { scale: 1.3, lift: 0.05 } });
  const car = model(parts);
  const { w, h, y, z } = parts.rearPlate;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  plate.rotation.y = Math.PI; plate.position.set(0, y, z); plate.name = 'plate'; car.add(plate);
  car.updateMatrixWorld(true);
  for (const x of [-w * 0.45, 0, w * 0.45]) {
    for (const py of [y - h * 0.45, y, y + h * 0.45]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, py, z - 2), new THREE.Vector3(0, 0, 1));
      assert.equal(ray.intersectObject(car, true)[0]?.object.name, 'plate');
    }
  }
});
