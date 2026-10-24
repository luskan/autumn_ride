import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WORLD } from '../src/config.js';
import { LeafPiles } from '../src/leaf-piles.js';
import { planVillages } from '../src/props.js';
import { Terrain } from '../src/terrain.js';
import { buildTrack } from '../src/track.js';
import { forestDensity, mulberry32 } from '../src/util.js';
import { Vegetation } from '../src/vegetation.js';

const track = buildTrack(WORLD.seed);
track.buildDistanceField(WORLD.terrainSize, 30);
const terrain = new Terrain(track, { size: WORLD.terrainSize, segments: WORLD.terrainSegments });
const villages = planVillages(track, terrain, 11);
const items = Vegetation.prototype.place(track, terrain, villages, mulberry32(21));
const originalCount = items.length;
const moved = Vegetation.prototype.moveRoadsideTrees(items, track, terrain, villages, mulberry32(21 + 1049));
const makePiles = () => new LeafPiles(track, terrain, { items }, villages, new THREE.Texture(), 400);

test('forest trees move closer without increasing the tree count', () => {
  assert.equal(items.length, originalCount);
  assert.ok(moved > 15);
  assert.equal(items.filter(tree => tree.movedRoadside).length, moved);
  assert.ok(items.filter(tree => tree.movedRoadside).every(tree => tree.near >= 7 && tree.near < 8.5));
});

test('road and field leaf piles belong to real colored trees', () => {
  const piles = makePiles();
  const road = piles.piles.filter(p => p.road);
  const field = piles.piles.filter(p => !p.road);
  const inner = road.filter(p => Math.abs(p.d) < 2.3);
  assert.ok(road.length > 40);
  assert.ok(field.length > 30);
  assert.ok(inner.length > 8, 'some leaves should blow a third of the way into the road');
  assert.ok(road.every(p => forestDensity(p.sourceTree.x, p.sourceTree.z) > 0.55));
  assert.ok(piles.piles.every(p => ['oak', 'maple', 'amber', 'birch'].includes(p.sourceTree.kind)));
  assert.ok(road.every(p => Math.hypot(p.x - p.sourceTree.x, p.z - p.sourceTree.z) < 19));
  assert.ok(field.every(p => Math.hypot(p.x - p.sourceTree.x, p.z - p.sourceTree.z) < 4));
  assert.ok(Math.max(...road.map(p => p.length)) > 1.6);
  assert.ok(Math.min(...road.map(p => p.length)) < 1.1);
});

test('driving through edge and lane leaf piles launches leaves, then restores the pile', () => {
  const piles = makePiles();
  const edge = piles.piles.find(p => p.road && Math.abs(p.d) > 3.5 && p.width > 0.8);
  const inner = piles.piles.find(p => p.road && Math.abs(p.d) < 2.3);
  assert.ok(edge && inner);
  const car = { s: edge.s, d: Math.sign(edge.d) * 1.85, v: 18 };
  piles.checkCar(car);
  assert.equal(edge.hiddenFor, 0, 'ordinary lane driving should miss an edge pile');
  car.d = edge.d - Math.sign(edge.d) * 0.9;
  piles.checkCar(car);
  assert.equal(edge.hiddenFor, 45);
  assert.ok(piles.particleList.filter(p => p.life > 0).length >= 60);
  const hidden = new THREE.Matrix4();
  edge.bucket.moundMesh.getMatrixAt(edge.moundIndex, hidden);
  assert.equal(hidden.elements[0], 0);
  piles.update(45.1);
  assert.equal(edge.hiddenFor, 0);
  const restored = new THREE.Matrix4();
  edge.bucket.moundMesh.getMatrixAt(edge.moundIndex, restored);
  assert.ok(restored.elements[0] !== 0 || restored.elements[8] !== 0);

  car.s = inner.s;
  car.d = Math.sign(inner.d) * 1.85;
  piles.checkCar(car);
  assert.equal(inner.hiddenFor, 45, 'a normal lane should cross the windblown pile');
});

test('nearby traffic also throws leaves from lane piles', () => {
  const piles = makePiles();
  const inner = piles.piles.find(p => p.road && Math.abs(p.d) < 2.3);
  const trafficCar = { s: inner.s, d: inner.d, v: 20, dir: Math.sign(inner.d), len: 4.5, halfW: 0.9 };
  piles.checkTraffic([trafficCar], inner.s);
  assert.equal(inner.hiddenFor, 45);
  assert.ok(piles.particleList.some(p => p.life > 0));
});
