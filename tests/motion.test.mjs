import assert from 'node:assert/strict';
import test from 'node:test';
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
