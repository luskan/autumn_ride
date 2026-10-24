import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Track, buildTrack } from '../src/track.js';
import { Terrain } from '../src/terrain.js';
import { WORLD } from '../src/config.js';
import { ROAD_RULES, RoadRules, buildRoadRules, hasPassingSight } from '../src/road-rules.js';
import { buildCenterMarkings, roadPeriod, CHUNK } from '../src/road.js';
import { planSigns, SIGN } from '../src/road-signs.js';
import { Autopilot } from '../src/autopilot.js';

function fixture(height = () => 0, curvature = () => 0, length = 2400) {
  const M = length / 5, ds = 5;
  const d = { M, ds, length };
  for (const key of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'rx', 'rz', 'ux', 'uy', 'uz', 'kappa']) d[key] = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const s = i * ds, a = s / length * Math.PI * 2, r = length / (2 * Math.PI);
    d.px[i] = r * Math.cos(a); d.py[i] = height(s); d.pz[i] = r * Math.sin(a);
    d.tx[i] = -Math.sin(a); d.tz[i] = Math.cos(a);
    d.rx[i] = -Math.cos(a); d.rz[i] = -Math.sin(a); d.uy[i] = 1;
    d.kappa[i] = curvature(s);
  }
  return new Track(d);
}

test('a clear flat road stays dashed; an open uphill stretch alone is not a ban', () => {
  const flat = fixture();
  const rules = buildRoadRules(flat);
  assert.equal(rules.restrictions.length, 0);
  assert.equal(rules.markingAt(100), 'dashed');
  assert.equal(rules.availableDistance(100), Infinity);
  const ramp = fixture(s => s * 0.04);
  assert.equal(hasPassingSight(ramp, null, 600, 1), true);
  assert.equal(hasPassingSight(ramp, null, 1000, -1), true);
});

test('a blind crest restricts both approaches even when the far hill is visible', () => {
  const hill = fixture(s => 12 * Math.exp(-(((s - 1200) / 110) ** 2)));
  assert.equal(hasPassingSight(hill, null, 1050, 1), false);
  assert.equal(hasPassingSight(hill, null, 1350, -1), false);
  const rules = buildRoadRules(hill);
  assert.equal(rules.allowsPassing(1050, 1), false);
  assert.equal(rules.allowsPassing(1350, -1), false);
  assert.equal(rules.allowsPassing(200, 1), true);
});

test('a hillside crossing the sight line blocks passing on an otherwise flat road', () => {
  const track = fixture();
  const bank = { heightAt: () => 4 };
  assert.equal(hasPassingSight(track, bank, 500, 1), false);
});

test('tight bends and short gaps form a continuous restriction; gentle bends remain open', () => {
  const track = fixture(() => 0, s => (s >= 700 && s < 800) || (s >= 850 && s < 950) ? 1 / 200 : 0);
  const rules = buildRoadRules(track);
  assert.equal(rules.allowsPassing(825, 1), false);
  assert.equal(rules.allowsPassing(825, -1), false);
  assert.equal(rules.allowsPassing(665, 1), false);
  assert.equal(buildRoadRules(fixture(() => 0, () => 1 / 700)).restrictions.length, 0);
});

test('directional permissions and lookahead remain correct across the loop seam', () => {
  const track = fixture(() => 0, () => 0, 1000);
  const masks = new Uint8Array(100);
  masks.fill(1, 10, 20); masks.fill(2, 70, 80);
  const rules = new RoadRules(track, masks);
  assert.equal(rules.markingAt(150), 'solid-forward');
  assert.equal(rules.allowsPassing(150, -1), true);
  assert.equal(rules.availableDistance(50, 1), 50);
  assert.equal(rules.availableDistance(50, -1), 250);
  assert.equal(rules.availableDistance(950, 1), 150);
  assert.equal(rules.canCompletePass(950, 151), false);
  assert.equal(rules.allowsPassing(800, -1), false);
  assert.equal(rules.allowsPassing(700, -1), true);
  const allClosed = new RoadRules(track, new Uint8Array(100).fill(3));
  assert.equal(allClosed.availableDistance(99), 0);
});

const track = buildTrack(WORLD.seed);
const terrain = new Terrain(track, { size: WORLD.terrainSize, segments: WORLD.terrainSegments });
const rules = buildRoadRules(track, terrain);
const signs = planSigns(track, [], rules);

test('the generated route has useful passing stretches and all four marking patterns', () => {
  const types = new Set(rules.runs.map(run => rules.markingAt((run.a + run.b) / 2)));
  for (const type of ['dashed', 'warning', 'solid', 'solid-forward', 'solid-reverse']) assert.ok(types.has(type), type);
  for (const dir of [1, -1]) assert.ok(Math.max(...rules.openDistances[dir]) > 500);
});

test('each ban and its end sign coincide with the line change, in both directions', () => {
  for (const section of rules.restrictions) {
    const pair = signs.filter(sign => sign.restrictionId === section.id);
    assert.equal(pair.length, 2);
    const start = pair.find(sign => sign.kind === 'no-overtaking');
    const end = pair.find(sign => sign.kind === 'end-overtaking');
    assert.equal(start.s, section.s); assert.equal(end.s, section.endS);
    assert.equal(start.side, section.dir); assert.equal(end.dir, section.dir);
    assert.equal(rules.allowsPassing(start.s - section.dir * 0.2, section.dir), true);
    assert.equal(rules.allowsPassing(start.s + section.dir * 0.2, section.dir), false);
    assert.equal(rules.allowsPassing(end.s - section.dir * 0.2, section.dir), false);
    assert.equal(rules.allowsPassing(end.s + section.dir * 0.2, section.dir), true);
  }
});

test('curve signs face both approaches and reverse the arrow for opposing traffic', () => {
  for (const curve of rules.curves) {
    const pair = signs.filter(sign => sign.curveId === curve.id);
    assert.equal(pair.length, 2);
    for (const sign of pair) {
      assert.deepEqual(sign.cell, curve.turn * sign.dir > 0 ? SIGN.curveRight : SIGN.curveLeft);
      const entry = sign.dir > 0 ? curve.a : curve.b;
      const ahead = track.wrap((entry - sign.s) * sign.dir);
      assert.ok(ahead >= ROAD_RULES.curveSignDistance - 0.01 && ahead <= 225.01);
    }
  }
});

test('paint meshes remain finite and light', () => {
  let triangles = 0;
  for (let i = 0; i < track.M; i += CHUNK) {
    const g = buildCenterMarkings(track, rules, i, Math.min(i + CHUNK, track.M));
    for (const attr of Object.values(g.attributes)) assert.ok(Array.from(attr.array).every(Number.isFinite));
    triangles += g.index.count / 3;
    g.dispose();
  }
  assert.ok(triangles < 50000, `${triangles} paint triangles`);
});

test('continuous paint meets exactly at chunk boundaries and at the closed-loop seam', () => {
  const solid = new RoadRules(track, new Uint8Array(100).fill(3));
  const edge = (geometry, i) => {
    const vertices = [], p = geometry.attributes.position;
    const x = track.px[i % track.M], z = track.pz[i % track.M];
    for (let j = 0; j < p.count; j++) {
      if (Math.hypot(p.getX(j) - x, p.getZ(j) - z) < 0.3) vertices.push([p.getX(j), p.getY(j), p.getZ(j)]);
    }
    assert.equal(vertices.length, 4);
    return vertices.sort((a, b) => a[0] - b[0]);
  };
  const first = buildCenterMarkings(track, solid, 0, CHUNK);
  const next = buildCenterMarkings(track, solid, CHUNK, CHUNK * 2);
  const last = buildCenterMarkings(track, solid, track.M - 20, track.M);
  assert.deepEqual(edge(first, CHUNK), edge(next, CHUNK));
  assert.deepEqual(edge(first, 0), edge(last, 0));
});

test('a mixed line paints the solid stripe on the restricted direction’s side', () => {
  const period = roadPeriod(track);
  const material = new THREE.MeshBasicMaterial();
  for (const mask of [1, 2]) {
    const run = rules.runs.find(run => run.mask === mask && run.b - run.a > 40);
    const s = (Math.ceil((run.a + 10) / period) + 0.9) * period;
    const chunk = Math.floor(track.index(s) / CHUNK) * CHUNK;
    const mesh = new THREE.Mesh(buildCenterMarkings(track, rules, chunk, Math.min(chunk + CHUNK, track.M)), material);
    mesh.updateMatrixWorld(true);
    const f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
    track.frameAt(s, f);
    for (const dir of [1, -1]) {
      const start = f.pos.clone().addScaledVector(f.R, dir * 0.15).add(new THREE.Vector3(0, 2, 0));
      const ray = new THREE.Raycaster(start, new THREE.Vector3(0, -1, 0), 0, 5);
      assert.equal(ray.intersectObject(mesh).length > 0, (mask & (dir > 0 ? 1 : 2)) !== 0);
    }
  }
});

test('autopilot requires space for the whole pass, including an evasive pull-out', () => {
  const track = fixture(() => 0, () => 0, 1000);
  const masks = new Uint8Array(100); masks.fill(1, 50, 75);
  const rules = new RoadRules(track, masks);
  const lead = { dir: 1, rel: 50, s: 50, d: 1.85, len: 4.1, halfW: 0.9, v: 12 };
  const pilot = new Autopilot(track, { cars: [lead] }, rules);
  pilot.setSpeed = 25; pilot.right = [lead];
  assert.equal(pilot.canPass(lead, 25, false, 100), lead);
  assert.equal(pilot.canPass(lead, 25, false, 450), null);
  assert.equal(pilot.canPass(lead, 25, true, 550), null);
  assert.equal(pilot.canPass(lead, 25, false, 950), lead);
});

test('autopilot cancels a pass if a changed convoy speed consumes the remaining opening', () => {
  const track = fixture(() => 0, () => 0, 1000);
  const masks = new Uint8Array(100); masks.fill(1, 50, 75);
  const lead = { dir: 1, s: 250, d: 1.85, len: 4.1, halfW: 0.9, v: 24 };
  const pilot = new Autopilot(track, { cars: [lead] }, new RoadRules(track, masks));
  pilot.setSpeed = 25; pilot.state = 'passing'; pilot.passEnd = lead;
  pilot.update(1 / 60, { s: 200, d: -1.85, v: 25 });
  assert.equal(pilot.state, 'abort');
});
