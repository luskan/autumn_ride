import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Player, engineAccel, resistance } from '../src/player.js';
import { createCarMaterials } from '../src/traffic.js';

const STEP = 1 / 120;
const materials = createCarMaterials(null, { truckLogo: null });
const track = {
  wrap: s => ((s % 1000) + 1000) % 1000,
  delta: (a, b) => ((b - a + 1500) % 1000) - 500,
  kappaAt: () => 0,
  frameAt(s, f) {
    f.pos.set(0, 0, s); f.T.set(0, 0, 1);
    f.R.set(1, 0, 0); f.U.set(0, 1, 0);
    return f;
  },
};
const player = () => {
  const p = new Player(track, materials, { env: null, plateTexture: null, shadowTexture: null });
  p.reset(100);
  return p;
};

function checkConstantMotion(durations, speed = 30) {
  const p = player();
  p.v = speed;
  const input = speed < 0 ? { down: true } : { throttle: resistance(speed, 0) / engineAccel(speed) };
  let accumulator = 0, time = 0, previous = null;
  for (let i = 0; i < 400; i++) {
    const dt = durations[i % durations.length];
    time += dt; accumulator += dt;
    while (accumulator >= STEP) {
      p.update(STEP, input, []);
      accumulator -= STEP;
    }
    const physicalS = p.s;
    p.updateVisual(dt, time, accumulator / STEP);
    assert.equal(p.s, physicalS, 'rendering must not change the physics position');
    if (i > 10) {
      const moved = track.delta(previous, p.renderState.s);
      assert.ok(Math.abs(moved - speed * dt) < 1e-9, `frame ${i}: moved ${moved}, expected ${speed * dt}`);
    }
    assert.equal(p.pivot.position.y, 0.55, 'a smooth road must not produce artificial vertical bumps');
    previous = p.renderState.s;
  }
}

for (const hz of [30, 60, 90, 120, 144, 165, 240]) {
  test(`constant driving renders continuously at ${hz} Hz`, () => checkConstantMotion([1 / hz]));
}

test('small variations in frame time do not make the car stick or jump', () => {
  checkConstantMotion([0.0162, 0.0171, 0.012, 0.019, 0.007, 0.024]);
});

test('reverse driving also renders continuously between physics steps', () => {
  checkConstantMotion([1 / 144], -6);
});

test('render interpolation takes the short path across both ends of the route', () => {
  for (const [start, speed, input] of [[999.9, 30, { throttle: resistance(30, 0) / engineAccel(30) }], [0.02, -6, { down: true }]]) {
    const p = player();
    p.reset(start); p.v = speed; p.update(STEP, input, []);
    p.updateVisual(0, 0, 0.5);
    assert.ok(Math.abs(track.delta(start, p.renderState.s) - speed * STEP * 0.5) < 1e-9);
  }
});

test('a reset immediately resets the rendered position instead of sweeping across the map', () => {
  const p = player();
  p.v = 30; p.update(STEP, { up: true }, []); p.updateVisual(STEP, 1, 0.5);
  p.reset(900, -1.85);
  for (const alpha of [0, 0.2, 1]) {
    p.updateVisual(STEP, 2, alpha);
    assert.equal(p.renderState.s, 900);
    assert.equal(p.group.position.z, 900);
    assert.equal(p.group.position.x, -1.85);
  }
});

test('braking and steering still tilt the body smoothly without lifting it off the road', () => {
  const p = player(); p.v = 20;
  for (let i = 0; i < 24; i++) {
    p.update(STEP, { down: true, right: true }, []);
    p.updateVisual(STEP, i * STEP, 1);
  }
  assert.ok(p.pivot.rotation.x > 0);
  assert.ok(p.pivot.rotation.z < 0);
  assert.equal(p.pivot.position.y, 0.55);
});

test('wheel rotation follows rendered travel in both directions and freezes when the car stops moving', () => {
  const p = player();
  p.v = 12;
  p.update(STEP, { throttle: resistance(12, 0) / engineAccel(12) }, []);
  p.updateVisual(STEP, STEP, 1);
  const forward = p.wheelSpin;
  assert.ok(Math.abs(forward - 12 * STEP / p.wheelRadius) < 1e-9);
  assert.ok(p.wheels.every(wheel => wheel.roll.rotation.x === forward));
  p.updateVisual(STEP, 2 * STEP, 1);
  assert.equal(p.wheelSpin, forward, 'rendering the same position again must not spin the wheels');

  p.reset(100);
  assert.equal(p.wheelSpin, 0);
  p.v = -6;
  p.update(STEP, { down: true }, []);
  p.updateVisual(STEP, 3 * STEP, 1);
  assert.ok(p.wheelSpin < 0);
  assert.ok(Math.abs(p.wheelSpin - track.delta(100, p.renderState.s) / p.wheelRadius) < 1e-9);
});

test('only the front wheels steer, including while stationary and reversing', () => {
  const p = player();
  p.steer = 1;
  p.updateVisual(0, 0, 1);
  assert.equal(p.wheels.filter(wheel => wheel.front).length, 2);
  assert.ok(p.wheels.filter(wheel => wheel.front).every(wheel => Math.abs(wheel.steer.rotation.y + 0.42) < 1e-9));
  assert.ok(p.wheels.filter(wheel => !wheel.front).every(wheel => wheel.steer.rotation.y === 0));
  p.steer = -1;
  p.v = -6;
  p.updateVisual(0, 0, 1);
  assert.ok(p.wheels.filter(wheel => wheel.front).every(wheel => wheel.steer.rotation.y > 0));
  assert.ok(p.wheels.filter(wheel => !wheel.front).every(wheel => wheel.steer.rotation.y === 0));
});

test('a right turn aims the front wheels toward the actual right side of the road', () => {
  const physicalTrack = {
    ...track,
    frameAt(s, frame) {
      track.frameAt(s, frame);
      frame.R.set(-1, 0, 0); // +Z travel has its right side at -X
      return frame;
    },
  };
  const p = new Player(physicalTrack, materials, { env: null, plateTexture: null, shadowTexture: null });
  p.reset(100);
  const front = p.wheels.find(wheel => wheel.front);
  const heading = new THREE.Vector3();
  p.steer = 1;
  p.updateVisual(0, 0, 1);
  front.steer.getWorldDirection(heading);
  assert.ok(heading.x < -0.1, 'right input must aim the wheel toward road right (-X)');
  p.steer = -1;
  p.updateVisual(0, 0, 1);
  front.steer.getWorldDirection(heading);
  assert.ok(heading.x > 0.1, 'left input must aim the wheel toward road left (+X)');
});
