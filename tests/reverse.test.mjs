import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { PLAYER, ROAD } from '../src/config.js';
import { Player } from '../src/player.js';
import { Autopilot } from '../src/autopilot.js';
import { Traffic, createCarMaterials } from '../src/traffic.js';

const STEP = 1 / 120;
const materials = createCarMaterials(null, { truckLogo: null });

function straightTrack() {
  return {
    length: 1000,
    ty: [0],
    index: () => 0,
    wrap: s => ((s % 1000) + 1000) % 1000,
    delta: (a, b) => ((b - a + 1500) % 1000) - 500,
    kappaAt: () => 0,
    frameAt(s, frame) {
      frame.pos.set(0, 0, s);
      frame.T.set(0, 0, 1);
      frame.R.set(1, 0, 0);
      frame.U.set(0, 1, 0);
      return frame;
    },
  };
}

function player() {
  const p = new Player(straightTrack(), materials, { env: null, plateTexture: null, shadowTexture: null });
  p.reset(500);
  return p;
}

function run(p, seconds, input, traffic = null) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    p.update(STEP, typeof input === 'function' ? input() : input, events);
    if (traffic) {
      traffic.update(STEP, p);
      traffic.collide(p, events);
    }
  }
  return events;
}

function trafficNear(p, dir, rel, speed = 0) {
  const traffic = Object.assign(Object.create(Traffic.prototype), { track: p.track, time: 0 });
  traffic.cars = [{
    dir, s: p.track.wrap(p.s + rel), d: p.d, lane: p.d, targetD: p.d,
    v: speed, vDesired: speed, vd: 0, phase: 0,
    len: PLAYER.length, halfW: PLAYER.width / 2,
    stun: 0, bumpCooldown: 0, prevRel: null, overtaken: false,
  }];
  return traffic;
}

test('holding Down brakes to a stop before reversing, with a lower speed limit', () => {
  const p = player();
  p.v = 8;
  while (p.v > 0) {
    p.update(STEP, { down: true }, []);
    assert.ok(p.v >= 0, 'forward braking must reach zero before engaging reverse');
  }
  const stoppedAt = p.s, distanceAtStop = p.distance;
  run(p, 4, { down: true });
  assert.equal(p.v, -PLAYER.maxReverseSpeed);
  assert.ok(p.track.delta(stoppedAt, p.s) < -10);
  assert.ok(p.distance > distanceAtStop + 10, 'the odometer also counts distance driven backwards');
});

test('Up brakes while reversing, then drives forwards; both pedals hold the car stopped', () => {
  const p = player();
  p.v = -PLAYER.maxReverseSpeed;
  while (p.v < 0) {
    p.update(STEP, { up: true }, []);
    assert.ok(p.v <= 0, 'reverse braking must reach zero before driving forwards');
  }
  run(p, 1, { up: true });
  assert.ok(p.v > 5);
  p.v = -4;
  run(p, 3, { up: true, down: true });
  assert.equal(p.v, 0);
});

test('analog braking only stops; explicit analog reverse drives backwards', () => {
  const p = player();
  p.v = 8;
  run(p, 4, { throttle: 0, brake: 1, steer: 0 });
  assert.equal(p.v, 0, 'autopilot braking must never engage reverse');
  run(p, 2, { throttle: 0, brake: 1, reverse: 1, steer: 0 });
  assert.ok(p.v < -5, 'pulling the touch joystick down must engage reverse');
  p.v = -1;
  run(p, 4, {});
  assert.equal(p.v, 0, 'coasting backwards must stop without switching direction');
});

test('reverse steering turns the rear in the requested direction and swings the nose the other way', () => {
  const p = player(), startD = p.d;
  run(p, 2, { down: true, right: true });
  assert.ok(p.d > startD + 0.5);
  p.updateVisual(STEP, 2);
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
  assert.ok(facing.z > 0.9 && facing.x < 0, 'backing right must swing the nose left without turning the model around');
  assert.ok(p.throttle > 0.9, 'reverse also powers the engine sound');
});

test('a guardrail slows reverse movement without cancelling it, and the player can steer away', () => {
  const p = player(), limit = ROAD.rail - PLAYER.width / 2 - 0.08;
  p.d = limit + 0.1;
  p.v = -5;
  p.yaw = -0.2;
  p.update(STEP, { down: true }, []);
  assert.equal(p.d, limit);
  assert.ok(p.v < -4 && p.scrape > 0);
  run(p, 2, { down: true, left: true });
  assert.ok(p.d < limit - 0.5 && !p.touchingRail);
});

test('reverse movement wraps around the start of the route', () => {
  const p = player();
  p.reset(0.1);
  run(p, 1, { down: true });
  assert.ok(p.s > 995 && p.s < p.track.length);
  assert.ok(p.distance > 1);
});

test('the autopilot can be engaged while reversing and safely resumes forward driving', () => {
  const p = player(), pilot = new Autopilot(p.track, { cars: [] });
  p.v = -4;
  pilot.engage(p);
  run(p, 3, () => pilot.update(STEP, p));
  assert.ok(Number.isFinite(p.v + p.s + p.d));
  assert.ok(p.v > 5);
});

test('the player can reverse clear of a head-on collision within two seconds', () => {
  const p = player();
  p.d = -ROAD.laneCenter;
  p.v = 15;
  const traffic = trafficNear(p, -1, PLAYER.length - 0.1, 10), events = [];
  traffic.collide(p, events);
  assert.equal(p.v, 0);
  assert.equal(traffic.cars[0].v, 0);
  assert.ok(events.some(event => event.type === 'bump'));
  const hitAt = p.s;
  const reverseEvents = run(p, 2, { down: true }, traffic);
  assert.ok(p.v < -4);
  assert.ok(p.track.delta(hitAt, p.s) < -4);
  assert.ok(!reverseEvents.some(event => event.type === 'bump'));
});

test('contact with an oncoming car ahead preserves an existing retreat', () => {
  const p = player();
  p.v = -3;
  const traffic = trafficNear(p, -1, PLAYER.length - 0.1, 12);
  traffic.collide(p, []);
  assert.equal(p.v, -3);
  assert.equal(traffic.cars[0].v, 0);
});

test('side contact while reversing deflects the car away without cancelling reverse', () => {
  const p = player();
  p.v = -4;
  p.yaw = -0.2;
  p.latV = 0.8;
  const traffic = trafficNear(p, 1, 0);
  traffic.cars[0].d += PLAYER.width - 0.1;
  const beforeD = p.d;
  traffic.collide(p, []);
  assert.ok(p.d < beforeD && p.yaw > 0);
  assert.ok(p.v < 0);
});

for (const dir of [1, -1]) {
  test(`reversing into a stopped car behind (direction ${dir}) cannot push through it`, () => {
    const p = player();
    p.v = -4;
    const traffic = trafficNear(p, dir, -PLAYER.length + 0.1), hitAt = p.s;
    traffic.collide(p, []);
    assert.equal(p.v, 0);
    run(p, 1, { down: true }, traffic);
    const car = traffic.cars[0];
    assert.ok(p.track.delta(car.s, p.s) >= PLAYER.length);
    assert.ok(Math.abs(p.track.delta(hitAt, p.s)) < 0.2);
    assert.ok(car.v >= 0);
  });
}

test('traffic following a reversing player brakes without driving backwards itself', () => {
  const p = player();
  p.v = -6;
  const traffic = trafficNear(p, 1, -10);
  traffic.cars[0].vDesired = 20;
  traffic.update(0.5, p);
  assert.equal(traffic.cars[0].v, 0);
});
