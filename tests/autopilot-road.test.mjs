import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrack } from '../src/track.js';
import { Terrain } from '../src/terrain.js';
import { WORLD, PLAYER } from '../src/config.js';
import { buildRoadRules } from '../src/road-rules.js';
import { createCarMaterials, Traffic } from '../src/traffic.js';
import { Player } from '../src/player.js';
import { Autopilot } from '../src/autopilot.js';

const track = buildTrack(WORLD.seed);
const terrain = new Terrain(track, { size: WORLD.terrainSize, segments: WORLD.terrainSegments });
const rules = buildRoadRules(track, terrain);
const materials = createCarMaterials(null, { truckLogo: null });
const start = rules.openDistances[1].indexOf(Math.max(...rules.openDistances[1])) * rules.step + 5;

function scenario(speed) {
  const player = new Player(track, materials, { env: null, plateTexture: null, shadowTexture: null });
  player.reset(start); player.v = speed;
  const traffic = new Traffic(track, { materials, shadowTexture: null });
  for (const car of traffic.cars) if (Math.abs(track.delta(player.s, car.s)) < 250) car.s = track.wrap(car.s + 900);
  const pilot = new Autopilot(track, traffic, rules);
  pilot.engage(player, speed);
  return { player, traffic, pilot };
}

function step({ player, traffic, pilot }) {
  const events = [], dt = 1 / 120;
  player.update(dt, pilot.update(dt, player), events);
  traffic.update(dt, player); traffic.collide(player, events);
  return events;
}

const overSolid = p => p.d < PLAYER.width / 2 + 0.22 && !rules.allowsPassing(p.s + PLAYER.length / 2);

test('autopilot completes the actual route, overtakes and stays off restricted center lines', () => {
  const world = scenario(110 / 3.6);
  let steps = 0, violations = 0, bumps = 0, overtakes = 0, rails = 0;
  while (world.player.distance < track.length && steps++ < 120 * 900) {
    for (const event of step(world)) {
      if (event.type === 'bump') bumps++;
      if (event.type === 'overtake') overtakes++;
      if (event.type === 'rail') rails++;
    }
    if (overSolid(world.player)) violations++;
  }
  console.log('road-rules lap', { km: world.player.distance / 1000, overtakes, bumps, rails, violations });
  assert.ok(world.player.distance >= track.length);
  assert.ok(overtakes > 0, 'the rules must leave practical overtaking opportunities');
  assert.equal(violations, 0); assert.equal(bumps, 0); assert.equal(rails, 0);
});

test('a lead car accelerating during a pass causes a safe return before the next restriction', () => {
  const world = scenario(25), { player, traffic, pilot } = world;
  for (const car of traffic.cars) if (Math.abs(track.delta(player.s, car.s)) < 1200) car.s = track.wrap(car.s + 2400);
  const lead = traffic.cars.find(c => c.dir > 0 && c.type === 'hatch');
  lead.s = track.wrap(player.s + 55); lead.d = lead.lane = 1.85; lead.v = lead.vDesired = 12;
  let changed = false, returned = false, violations = 0, bumps = 0;
  for (let i = 0; i < 120 * 45; i++) {
    if (!changed && pilot.state === 'passing' && player.d < 0) { lead.vDesired = 24; changed = true; }
    for (const event of step(world)) if (event.type === 'bump') bumps++;
    if (changed && player.d > 1.5 && pilot.state === 'lane') returned = true;
    if (overSolid(player)) violations++;
  }
  assert.equal(changed, true); assert.equal(returned, true);
  assert.equal(violations, 0); assert.equal(bumps, 0);
});
