import * as THREE from 'three';

// Repeated trees share a real instanced draw per shape/LOD, rather than a separate
// multi-draw entry per tree. Cache static transforms and cull spatial cells first.
export class StaticInstances extends THREE.Group {
  constructor(maxInstances, material) {
    super();
    this.material = material;
    this.maxInstances = maxInstances;
    this.instanceCount = 0;
    this.matrices = new Float32Array(maxInstances * 16);
    this.colors = new Float32Array(maxInstances * 3);
    this.geometryIds = new Uint32Array(maxInstances);
    this.geometries = [];
    this.batches = [];
    this.cells = [];
    this.bounds = [];
    this.activeBounds = [];
    this.visibleInstances = [];
    this.viewFrustum = new THREE.Frustum();
    this.shadowFrustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
  }

  addGeometry(geometry) {
    geometry.computeBoundingSphere();
    return this.geometries.push(geometry) - 1;
  }

  addInstance(geometryId) {
    const id = this.instanceCount++;
    this.geometryIds[id] = geometryId;
    return id;
  }

  setMatrixAt(id, matrix) { matrix.toArray(this.matrices, id * 16); }
  getMatrixAt(id, target) { return target.fromArray(this.matrices, id * 16); }
  setColorAt(id, color) { color.toArray(this.colors, id * 3); }
  getColorAt(id, target) { return target.fromArray(this.colors, id * 3); }
  getGeometryIdAt(id) { return this.geometryIds[id]; }
  getVisibleAt(id) { return this.visibleGeneration[id] === this.generation; }

  // Matrices and the available LOD shapes are fixed after this initialization.
  buildSpatialIndex(geometryChoices, cellSize = 160) {
    const cells = new Map();
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    const capacities = new Uint32Array(this.geometries.length);
    this.visibleGeneration = new Uint32Array(this.maxInstances);
    this.generation = 0;
    geometryChoices.forEach((choices, id) => {
      this.getMatrixAt(id, matrix);
      const bounds = new Map();
      const box = new THREE.Box3();
      for (const geometryId of choices) {
        capacities[geometryId]++;
        const sphere = this.geometries[geometryId].boundingSphere.clone().applyMatrix4(matrix);
        bounds.set(geometryId, sphere);
        box.expandByPoint(point.copy(sphere.center).addScalar(sphere.radius));
        box.expandByPoint(point.copy(sphere.center).addScalar(-sphere.radius));
      }
      this.bounds[id] = bounds;
      this.activeBounds[id] = bounds.get(this.getGeometryIdAt(id));
      const center = this.activeBounds[id].center;
      const key = `${Math.floor(center.x / cellSize)},${Math.floor(center.z / cellSize)}`;
      if (!cells.has(key)) cells.set(key, { box: new THREE.Box3(), ids: [] });
      const cell = cells.get(key);
      cell.box.union(box);
      cell.ids.push(id);
    });
    this.cells = [...cells.values()];
    this.geometries.forEach((geometry, id) => {
      const capacity = capacities[id];
      if (!capacity) return;
      const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
      mesh.name = `vegetation-${id}`;
      mesh.frustumCulled = false; // the compact list already covers both camera frusta
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      this.batches[id] = { mesh, slots: new Int32Array(capacity).fill(-1), dirty: false };
      this.add(mesh);
    });
  }

  setGeometryIdAt(id, geometryId) {
    this.geometryIds[id] = geometryId;
    if (this.bounds[id]) this.activeBounds[id] = this.bounds[id].get(geometryId);
    return this;
  }

  updateVisibility(camera, shadowCamera = null) {
    const prepareFrustum = (frustum, cam) => {
      this.projection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(this.matrixWorld);
      frustum.setFromProjectionMatrix(this.projection, cam.coordinateSystem, cam.reversedDepth);
    };
    prepareFrustum(this.viewFrustum, camera);
    if (shadowCamera) prepareFrustum(this.shadowFrustum, shadowCamera);
    this.generation = (this.generation + 1) >>> 0;
    this.visibleInstances.length = 0;
    for (const batch of this.batches) {
      if (batch) { batch.previousCount = batch.mesh.count; batch.mesh.count = 0; batch.dirty = false; }
    }
    for (const cell of this.cells) {
      if (!this.viewFrustum.intersectsBox(cell.box)
        && (!shadowCamera || !this.shadowFrustum.intersectsBox(cell.box))) continue;
      for (const id of cell.ids) {
        const sphere = this.activeBounds[id];
        if (!this.viewFrustum.intersectsSphere(sphere)
          && (!shadowCamera || !this.shadowFrustum.intersectsSphere(sphere))) continue;
        this.visibleGeneration[id] = this.generation;
        this.visibleInstances.push(id);
        const batch = this.batches[this.geometryIds[id]];
        const index = batch.mesh.count++;
        // Static matrices/colors stay on the GPU until a slot changes its occupant.
        if (batch.slots[index] !== id) {
          batch.slots[index] = id;
          for (let j = 0; j < 16; j++) batch.mesh.instanceMatrix.array[index * 16 + j] = this.matrices[id * 16 + j];
          for (let j = 0; j < 3; j++) batch.mesh.instanceColor.array[index * 3 + j] = this.colors[id * 3 + j];
          batch.dirty = true;
        }
      }
    }
    for (const batch of this.batches) {
      if (!batch) continue;
      batch.mesh.visible = batch.mesh.count > 0;
      if (batch.dirty || batch.previousCount !== batch.mesh.count) {
        batch.mesh.boundingSphere = null;
        batch.mesh.boundingBox = null;
      }
      if (batch.dirty) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
