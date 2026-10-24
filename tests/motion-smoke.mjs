// Run the actual game loop with controlled display timestamps, independently of
// the test machine's monitor refresh rate. This catches missing render interpolation.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const clock = window.__motionClock = { manual: false, pending: [], time: 0 };
    window.requestAnimationFrame = callback => {
      if (clock.manual) { clock.pending.push(callback); return 0; }
      return raf(time => {
        if (clock.manual) clock.pending.push(callback);
        else { clock.time = time; callback(time); }
      });
    };
    clock.tick = dt => {
      clock.time += dt * 1000;
      const callbacks = clock.pending;
      clock.pending = [];
      for (const callback of callbacks) callback(clock.time);
    };
  });
  await page.goto(process.env.GAME_URL || pathToFileURL(resolve('dist/index.html')).href + '?pr=1');
  await page.waitForFunction(() => window.__game?.state.mode === 'menu', null, { timeout: 90000 });
  await page.evaluate(() => {
    const G = window.__game, w = G.world;
    G.startGame(); w.player.reset(w.player.s); w.player.v = 30;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < 1000) c.s = w.track.wrap(c.s + 2400);
    w.pilot.engage(w.player, 30);
    window.__motionClock.manual = true;
  });
  await page.waitForFunction(() => window.__motionClock.pending.length > 0, null, { polling: 20 });
  for (const hz of [90, 144, 165]) {
    const result = await page.evaluate(hz => {
      const G = window.__game, p = G.world.player, clock = window.__motionClock, track = G.world.track;
      for (let i = 0; i < hz * 2; i++) clock.tick(1 / hz);
      let previous = p.renderState.s, still = 0, worstError = 0, minBodyY = Infinity, maxBodyY = -Infinity;
      for (let i = 0; i < hz * 2; i++) {
        clock.tick(1 / hz);
        const moved = track.delta(previous, p.renderState.s);
        const expected = p.renderState.v / hz;
        if (moved <= 1e-6) still++;
        worstError = Math.max(worstError, Math.abs(moved / expected - 1));
        minBodyY = Math.min(minBodyY, p.pivot.position.y); maxBodyY = Math.max(maxBodyY, p.pivot.position.y);
        previous = p.renderState.s;
      }
      return { still, worstError, bodyLift: maxBodyY - minBodyY };
    }, hz);
    assert.equal(result.still, 0);
    assert.ok(result.worstError < 0.02, JSON.stringify(result));
    assert.equal(result.bodyLift, 0);
    console.log(`PASS game loop renders smooth car motion at ${hz} Hz`, JSON.stringify(result));
  }
  const paused = await page.evaluate(() => {
    const G = window.__game, p = G.world.player;
    G.setPaused(true);
    const before = p.group.position.clone();
    for (let i = 0; i < 30; i++) window.__motionClock.tick(1 / 144);
    return before.distanceTo(p.group.position);
  });
  assert.equal(paused, 0);
  assert.deepEqual(errors, []);
  console.log('PASS pausing holds the interpolated car position; no runtime errors');
} finally { await browser.close(); }
