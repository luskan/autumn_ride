// End-to-end smoke test: loads the built game in Chrome, drives the car and checks the rules.
// Usage: npm run build && npm test   (screenshots land in test-results/)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = resolve('test-results');
mkdirSync(OUT, { recursive: true });
const url = process.env.GAME_URL || pathToFileURL(resolve('dist/index.html')).href;
const headless = process.env.HEADED ? false : true;

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`);
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});

const g = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const playerState = () => g(() => {
  const p = window.__game.world.player;
  return { s: p.s, d: p.d, v: p.v, kmh: p.v * 3.6, yaw: p.yaw };
});

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.state.mode === 'menu', null, { timeout: 90000 });
  const info = await g(() => {
    const gl = window.__game.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const st = window.__game.state;
    const w = window.__game.world;
    return {
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a',
      loadMs: st.loadMs,
      trackKm: (w.track.length / 1000).toFixed(2),
      trees: w.vegetation.items.length,
      signs: w.signs.userData.count,
      cars: w.traffic.cars.length,
    };
  });
  console.log('info', JSON.stringify(info));
  check('game loads to the start screen', true, `${info.loadMs} ms`);
  check('road signs are placed along the road', info.signs >= 15, `${info.signs} signs`);
  check('traffic exists in both directions', info.cars > 20);
  const markingInfo = await g(() => {
    const { world, scene } = window.__game;
    const rules = world.roadRules;
    const signs = world.signs.userData.signs;
    return {
      types: [...new Set(rules.runs.map(run => rules.markingAt((run.a + run.b) / 2)))],
      restrictions: rules.restrictions.length,
      starts: signs.filter(sign => sign.kind === 'no-overtaking').length,
      ends: signs.filter(sign => sign.kind === 'end-overtaking').length,
      paintMeshes: scene.getObjectByName('road').children.filter(mesh => mesh.name === 'center-markings').length,
    };
  });
  check('road shows dashed, warning, solid and directional markings', markingInfo.types.length === 5 && markingInfo.paintMeshes > 0, markingInfo.types.join(', '));
  check('every passing restriction has matching start and end signs', markingInfo.restrictions > 0 && markingInfo.starts === markingInfo.restrictions && markingInfo.ends === markingInfo.restrictions, `${markingInfo.restrictions} directional sections`);
  const logos = await g(() => {
    const m = window.__game.scene.getObjectByName('truck-logo');
    const trucks = window.__game.world.traffic.cars.filter((c) => c.type === 'truck').length;
    return { mesh: !!m, capacity: m ? m.instanceMatrix.count : 0, count: m ? m.count : 0, trucks, textured: !!(m && m.material.map && m.material.map.image) };
  });
  check('trucks carry the AutoMapa logo panels', logos.mesh && logos.textured && logos.capacity === logos.trucks && logos.trucks > 0, `${logos.count}/${logos.trucks} trucks currently rendered`);
  const renderComparison = await g(() => {
    const G = window.__game, { THREE: T, scene, renderer, camera } = G;
    const { vegetation, traffic, lights } = G.world, source = vegetation.mesh;
    const vertices = source.geometries.reduce((n, geo) => n + geo.attributes.position.count, 0);
    const indices = source.geometries.reduce((n, geo) => n + geo.index.count, 0);
    const reference = new T.BatchedMesh(source.instanceCount, vertices, indices, source.material);
    reference.sortObjects = false; reference.castShadow = reference.receiveShadow = true;
    const shapes = source.geometries.map(geo => reference.addGeometry(geo));
    const matrix = new T.Matrix4(), color = new T.Color();
    for (let id = 0; id < source.instanceCount; id++) {
      reference.addInstance(shapes[source.getGeometryIdAt(id)]);
      reference.setMatrixAt(id, source.getMatrixAt(id, matrix));
      reference.setColorAt(id, source.getColorAt(id, color));
    }
    scene.add(reference);
    const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const optimized = new Uint8Array(width * height * 4), original = new Uint8Array(optimized.length);
    const savedRotation = camera.quaternion.clone(), cases = [];
    try {
      for (const angle of [0, Math.PI / 2, Math.PI]) {
        camera.quaternion.copy(savedRotation); camera.rotateY(angle); camera.updateMatrixWorld();
        source.visible = true; reference.visible = false;
        source.updateVisibility(camera, lights.sun.shadow.camera);
        traffic.updateMeshes(camera, lights.sun.shadow.camera);
        const renderedCars = traffic.blobs.count;
        renderer.render(scene, camera);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, optimized);
        source.visible = false; reference.visible = true;
        traffic.updateMeshes(); renderer.render(scene, camera);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, original);
        let changed = 0;
        for (let i = 0; i < original.length; i += 4) {
          const delta = Math.abs(original[i] - optimized[i]) + Math.abs(original[i + 1] - optimized[i + 1]) + Math.abs(original[i + 2] - optimized[i + 2]);
          if (delta > 3) changed++;
        }
        cases.push({ changed, fraction: changed / (width * height), renderedCars });
      }
    } finally {
      scene.remove(reference); reference.dispose(); source.visible = true;
      camera.quaternion.copy(savedRotation); camera.updateMatrixWorld();
      source.updateVisibility(camera, lights.sun.shadow.camera);
      traffic.updateMeshes(camera, lights.sun.shadow.camera);
    }
    return { cases, cars: traffic.cars.length };
  });
  check('optimized trees, cars and shadows match the full scene from three viewing directions', renderComparison.cases.every(c => c.fraction < 0.0005), JSON.stringify(renderComparison.cases));
  check('cars outside both viewing and shadow frusta skip rendering', renderComparison.cases.every(c => c.renderedCars < renderComparison.cars));
  // the textured rear plate must sit outside the car body: a ray from behind hits it first
  const plate = await g(() => {
    const { THREE, world } = window.__game;
    const group = world.player.group;
    group.updateMatrixWorld(true);
    const mesh = group.getObjectByName('rear-plate');
    if (!mesh) return { first: 'no plate mesh' };
    const target = mesh.getWorldPosition(new THREE.Vector3());
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    const ray = new THREE.Raycaster(target.clone().addScaledVector(back, 3), back.clone().negate(), 0, 10);
    const hit = ray.intersectObject(group, true)[0];
    return { first: hit ? hit.object.name || hit.object.type : 'nothing', text: !!mesh.material.map };
  });
  check('rear plate AUTOMAPA is visible behind the bumper', plate.first === 'rear-plate' && plate.text, `first hit from behind: ${plate.first}`);
  const birdRendering = await g(() => {
    const { world, camera, scene, renderer } = window.__game, birds = world.birds;
    const savedFlocks = birds.flocks, savedTime = birds.time;
    birds.flocks = [];
    let pixels = 0, calls = 0;
    try {
      for (let i = 0; !birds.flocks.length && i < 8; i++) birds.spawn(camera, 'migration');
      if (!birds.flocks.length) return { pixels, calls };
      const gl = renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const on = new Uint8Array(width * height * 4), off = new Uint8Array(on.length);
      for (const phase of [0.2, 0.4, 0.6, 0.8]) {
        birds.time = birds.flocks[0].startedAt + birds.flocks[0].duration * phase;
        birds.update(0, camera, false);
        birds.group.visible = false;
        renderer.render(scene, camera);
        const baselineCalls = renderer.info.render.calls;
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, off);
        birds.group.visible = true;
        renderer.render(scene, camera);
        calls = Math.max(calls, renderer.info.render.calls - baselineCalls);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, on);
        let changed = 0;
        for (let i = 0; i < on.length; i += 4) {
          if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 12) changed++;
        }
        pixels = Math.max(pixels, changed);
      }
      return { pixels, calls };
    } finally {
      birds.flocks = savedFlocks;
      birds.time = savedTime;
      birds.group.visible = true;
      birds.update(0, camera, false);
    }
  });
  check('distant birds draw visible silhouettes using only three additional calls', birdRendering.pixels >= 5 && birdRendering.calls === 3, `${birdRendering.pixels} pixels, ${birdRendering.calls} calls`);
  await wait(1500);
  await shot('01-menu');

  // start + accelerate
  await page.keyboard.press('Enter');
  await wait(300);
  check('start screen hides after Enter', await g(() => window.__game.state.mode === 'play'));
  const p0 = await playerState();
  await page.keyboard.down('ArrowUp');
  await wait(4000);
  const p1 = await playerState();
  check('ArrowUp accelerates', p1.v > p0.v + 8, `${p0.kmh.toFixed(0)} -> ${p1.kmh.toFixed(0)} km/h`);
  await shot('02-driving');
  await wait(6000);
  const p2 = await playerState();
  check('top speed is limited', p2.kmh < 170, `${p2.kmh.toFixed(0)} km/h`);
  await page.keyboard.up('ArrowUp');

  // braking
  await page.keyboard.down('ArrowDown');
  await wait(1500);
  const p3 = await playerState();
  await page.keyboard.up('ArrowDown');
  check('ArrowDown slows down', p3.v < p2.v - 10, `${p2.kmh.toFixed(0)} -> ${p3.kmh.toFixed(0)} km/h`);
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__game.world.player.v < -0.5, null, { timeout: 8000 });
  await wait(300);
  const reverseHud = await g(() => ({ speed: Number(document.getElementById('hud-speed').textContent), unit: document.getElementById('hud-unit').textContent }));
  await page.keyboard.up('ArrowDown');
  const p3b = await playerState();
  check('holding ArrowDown stops the car and engages reverse', p3b.v < -0.5 && p3b.v >= -6, `${p3b.kmh.toFixed(1)} km/h`);
  check('the speedometer shows positive speed and R while reversing', reverseHud.speed > 0 && reverseHud.unit === 'R · km/h', JSON.stringify(reverseHud));

  // steering + road limits (move away from traffic first)
  await g(() => {
    const w = window.__game.world;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < 400) c.s = w.track.wrap(c.s + 900);
  });
  await page.keyboard.down('ArrowUp');
  await wait(2500);
  const before = await playerState();
  await page.keyboard.down('ArrowLeft');
  await wait(3500);
  const left = await playerState();
  await shot('03-left-rail');
  await page.keyboard.up('ArrowLeft');
  check('ArrowLeft steers left', left.d < before.d - 2, `d ${before.d.toFixed(2)} -> ${left.d.toFixed(2)}`);
  check('guardrail keeps the car on the road (left)', left.d >= -4.04, `d = ${left.d.toFixed(3)}`);
  await page.keyboard.down('ArrowRight');
  await wait(4500);
  const right = await playerState();
  await page.keyboard.up('ArrowRight');
  check('ArrowRight steers right', right.d > left.d + 2, `d ${left.d.toFixed(2)} -> ${right.d.toFixed(2)}`);
  check('guardrail keeps the car on the road (right)', right.d <= 4.04, `d = ${right.d.toFixed(3)}`);
  await page.keyboard.up('ArrowUp');

  // rear-end collision: a slow car right ahead in our lane
  await g(() => {
    const w = window.__game.world;
    const p = w.player;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(p.s, c.s)) < 400) c.s = w.track.wrap(c.s + 900);
    p.d = 1.85; p.yaw = 0; p.v = 25;
    const c = w.traffic.cars.find((c) => c.dir > 0 && c.type !== 'truck');
    c.s = w.track.wrap(p.s + 18); c.d = 1.85; c.lane = 1.85; c.v = 8; c.vDesired = 8;
    window.__testCar = c;
  });
  const bumps0 = await g(() => window.__game.state.stats.bumps);
  await page.keyboard.down('ArrowUp');
  await wait(2500);
  const afterHit = await g(() => {
    const w = window.__game.world;
    return { bumps: window.__game.state.stats.bumps, gap: w.track.delta(w.player.s, window.__testCar.s), v: w.player.v };
  });
  await shot('04-rear-end');
  check('collision with a car registers as a bump', afterHit.bumps > bumps0, `bumps ${bumps0} -> ${afterHit.bumps}`);
  check('cars do not pass through each other', afterHit.gap > 0, `gap ${afterHit.gap.toFixed(2)} m`);
  // overtake it after the bump: the car still drives (no damage)
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => window.__game.world.player.d < -0.4, null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.up('ArrowLeft');
  await wait(3000);
  const passed = await g(() => {
    const w = window.__game.world;
    return { rel: w.track.delta(w.player.s, window.__testCar.s), v: w.player.v, overtakes: window.__game.state.stats.overtakes };
  });
  await page.keyboard.up('ArrowUp');
  check('car keeps driving normally after a bump (no damage)', passed.v * 3.6 > 50, `${(passed.v * 3.6).toFixed(0)} km/h`);
  check('overtaking is counted', passed.rel < 0 && passed.overtakes >= 1, `overtakes ${passed.overtakes}`);

  // head-on bump with an oncoming car
  await g(() => {
    const w = window.__game.world;
    const p = w.player;
    // restore the slowed test car and clear the area so the scenario is isolated
    window.__testCar.vDesired = 20;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(p.s, c.s)) < 400) c.s = w.track.wrap(c.s + 900);
    p.d = -1.85; p.yaw = 0; p.v = 15;
    const c = w.traffic.cars.find((c) => c.dir < 0);
    c.s = w.track.wrap(p.s + 16); c.d = -1.85; c.v = 15;
    window.__testCar = c;
  });
  const b1 = await g(() => window.__game.state.stats.bumps);
  await wait(1200);
  const b2 = await g(() => ({ bumps: window.__game.state.stats.bumps, v: window.__game.world.player.v }));
  check('head-on contact is a harmless bump', b2.bumps > b1, `bumps ${b1} -> ${b2.bumps}`);
  await shot('05-head-on');

  const hitAt = (await playerState()).s;
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__game.world.player.v < -3, null, { timeout: 5000 });
  await page.keyboard.up('ArrowDown');
  const reversed = await g((s) => {
    const { player, track } = window.__game.world;
    return { v: player.v, moved: track.delta(s, player.s) };
  }, hitAt);
  check('the player can reverse away after a head-on bump', reversed.v < -2 && reversed.moved < -1, `${reversed.moved.toFixed(1)} m`);
  await shot('05-reverse');

  // the car can drive on afterwards: steer back into our lane, then accelerate
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__game.world.player.d > 1.2, null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.up('ArrowRight');
  await wait(2500);
  await page.keyboard.up('ArrowUp');
  const after = await playerState();
  check('player drives on after the head-on bump', after.kmh > 40, `${after.kmh.toFixed(0)} km/h, d ${after.d.toFixed(2)}`);

  // pause
  await page.keyboard.press('KeyP');
  const sP = (await playerState()).s;
  const birdTimeP = await g(() => window.__game.world.birds.time);
  await wait(700);
  const sP2 = (await playerState()).s;
  check('P pauses the game', sP === sP2 && (await g(() => window.__game.state.mode === 'pause')));
  check('P also freezes bird animation and spawning', birdTimeP === (await g(() => window.__game.world.birds.time)));
  await shot('06-pause');
  await page.keyboard.press('KeyP');

  // scenic shots at signs and curves, all camera modes
  const spots = await g(() => {
    const signs = window.__game.world.signs.userData.signs;
    const pickS = (pred) => (signs.find(pred) || signs[0]).s;
    return [
      pickS((s) => s.wide),
      pickS((s) => s.cell[0] === 3 && s.cell[1] === 0),
      pickS((s) => s.low),
      pickS((s) => s.cell[0] === 1 && s.cell[1] === 1),
    ];
  });
  for (const [i, s] of spots.entries()) {
    await g(({ s, cam }) => {
      const G = window.__game;
      G.setCamera(cam);
      const p = G.world.player;
      p.s = G.world.track.wrap(s - 45); p.d = 1.85; p.v = 12; p.yaw = 0;
    }, { s, cam: i === 3 ? 1 : 0 });
    await wait(1200);
    await shot(`07-scene-${i}`);
  }

  // performance sample while driving
  await g(() => window.__game.setCamera(0));
  await page.keyboard.down('ArrowUp');
  await wait(3500);
  const fps = await g(() => ({ fps: window.__game.state.fps, pr: window.__game.state.pixelRatio }));
  await page.keyboard.up('ArrowUp');
  console.log('perf', JSON.stringify(fps));
  check('renders at a playable frame rate', fps.fps >= 25, `${fps.fps} fps @ pixelRatio ${fps.pr}`);
  await shot('08-final');

  // geometry: the terrain must never poke through the road surface
  const ground = await g(() => {
    const { track, terrain } = window.__game.world;
    let bad = 0, worst = -Infinity;
    for (let i = 0; i < track.M; i += 3) {
      for (const u of [-5.4, -3, 0, 3, 5.4]) {
        const h = terrain.heightAt(track.px[i] + track.rx[i] * u, track.pz[i] + track.rz[i] * u);
        const over = h - (track.py[i] - 0.05);
        worst = Math.max(worst, over);
        if (over > 0) bad++;
      }
    }
    return { bad, worst };
  });
  check('terrain stays below the road everywhere', ground.bad === 0, `worst ${ground.worst.toFixed(3)} m`);

  // soak: a simulated driver keeps the lane at full throttle for a whole lap
  const soak = await g(() => {
    const G = window.__game;
    const { player, track, traffic } = G.world;
    G.state.mode = 'play';
    const startDist = player.distance;
    let minD = Infinity, maxD = -Infinity, maxV = 0, nan = false, steps = 0;
    const bumps0 = G.state.stats.bumps;
    while (player.distance - startDist < track.length + 50 && steps < 120 * 600) {
      let blocked = false;
      for (const c of traffic.cars) {
        if (c.dir < 0 || Math.abs(c.d - player.d) > 1.9) continue;
        const gap = track.delta(player.s, c.s);
        if (gap > 0 && gap < 25 + player.v * 0.8) blocked = true;
      }
      const err = 1.85 - player.d - player.latV * 0.5;
      G.input.left = err < -0.15;
      G.input.right = err > 0.15;
      G.input.up = !blocked;
      G.input.down = blocked && player.v > 12;
      G.simulate(1 / 120);
      steps++;
      if (!Number.isFinite(player.s + player.d + player.v)) nan = true;
      minD = Math.min(minD, player.d);
      maxD = Math.max(maxD, player.d);
      maxV = Math.max(maxV, player.v);
    }
    for (const k in G.input) G.input[k] = false;
    return { km: (player.distance - startDist) / 1000, minutes: steps / 120 / 60, minD, maxD, kmh: maxV * 3.6, nan, bumps: G.state.stats.bumps - bumps0 };
  });
  console.log('soak', JSON.stringify(soak));
  check('a full lap can be driven', soak.km > 8.5 && !soak.nan, `${soak.km.toFixed(2)} km in ${soak.minutes.toFixed(1)} min, max ${soak.kmh.toFixed(0)} km/h`);
  check('car stays on the road for the whole lap', soak.minD >= -4.04 && soak.maxD <= 4.04, `d ${soak.minD.toFixed(2)}..${soak.maxD.toFixed(2)}`);

  // ---- autopilot ----
  const clearAround = (range) => g((range) => {
    const w = window.__game.world;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < range) c.s = w.track.wrap(c.s + 2 * range);
  }, range);
  await g(() => {
    const G = window.__game;
    G.state.mode = 'play';
    const p = G.world.player;
    p.d = 1.85; p.yaw = 0; p.v = 25;
  });
  await clearAround(600);
  await page.keyboard.press('KeyA');
  await wait(4000);
  const a1 = await g(() => {
    const { pilot, player } = window.__game.world;
    return { active: pilot.active, set: pilot.setSpeed, v: player.v, d: player.d, badge: !document.getElementById('auto-badge').classList.contains('hidden') };
  });
  check('A engages the autopilot at the current speed', a1.active && Math.abs(a1.set - 25) < 0.6 && a1.badge, `set ${(a1.set * 3.6).toFixed(0)} km/h`);
  check('autopilot holds the speed and the lane', Math.abs(a1.v - a1.set) < 1 && Math.abs(a1.d - 1.85) < 0.3, `${(a1.v * 3.6).toFixed(0)} km/h, d ${a1.d.toFixed(2)}`);
  // the set speed rises by 15 km/h per second of (simulated) time while ArrowUp is held
  const t0 = await g(() => window.__game.state.stats.time);
  await page.keyboard.down('ArrowUp');
  await wait(1000);
  await page.keyboard.up('ArrowUp');
  const a2 = await g(() => ({ set: window.__game.world.pilot.setSpeed, t: window.__game.state.stats.time }));
  const expected = (15 / 3.6) * (a2.t - t0);
  check('ArrowUp raises the autopilot speed', expected > 0.5 && Math.abs(a2.set - a1.set - expected) < 0.6, `${(a1.set * 3.6).toFixed(0)} -> ${(a2.set * 3.6).toFixed(0)} km/h`);

  // overtakes a slow car when the oncoming lane is free, then returns to its lane
  const prepareOvertake = () => g(() => {
    const w = window.__game.world, r = w.roadRules;
    const index = r.openDistances[1].indexOf(Math.max(...r.openDistances[1]));
    w.player.reset(index * r.step + 5); w.player.v = 25;
    w.pilot.engage(w.player, 25);
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < 1000) c.s = w.track.wrap(c.s + 2000);
  });
  await prepareOvertake();
  await g(() => {
    const w = window.__game.world;
    w.pilot.setSpeed = 25;
    const c = w.traffic.cars.find((c) => c.dir > 0 && c.type === 'hatch');
    c.s = w.track.wrap(w.player.s + 60); c.d = 1.85; c.lane = 1.85; c.v = 12; c.vDesired = 12;
    window.__slow = c;
    window.__bumps0 = window.__game.state.stats.bumps;
  });
  await page.waitForFunction(() => window.__game.world.pilot.state === 'passing', null, { timeout: 15000 }).catch(() => {});
  await wait(1200);
  await shot('09-autopilot-overtake');
  await page.waitForFunction(() => {
    const w = window.__game.world;
    return w.track.delta(w.player.s, window.__slow.s) < -15 && w.player.d > 1.5;
  }, null, { timeout: 25000 }).catch(() => {});
  const a3 = await g(() => {
    const w = window.__game.world;
    return { rel: w.track.delta(w.player.s, window.__slow.s), d: w.player.d, bumps: window.__game.state.stats.bumps - window.__bumps0, active: w.pilot.active };
  });
  check('autopilot overtakes a slower car and returns to its lane', a3.rel < -15 && a3.d > 1.5 && a3.bumps === 0 && a3.active, `rel ${a3.rel.toFixed(1)} m, d ${a3.d.toFixed(2)}, bumps ${a3.bumps}`);

  // waits behind the slow car while an oncoming car is near, overtakes afterwards
  await prepareOvertake();
  await g(() => {
    const w = window.__game.world;
    const slow = window.__slow;
    slow.s = w.track.wrap(w.player.s + 50); slow.d = 1.85; slow.v = 12;
    const on = w.traffic.cars.find((c) => c.dir < 0);
    on.s = w.track.wrap(w.player.s + 280); on.d = -1.85; on.lane = -1.85; on.v = 20; on.vDesired = 20;
    window.__oncoming = on;
    window.__bumps0 = window.__game.state.stats.bumps;
    window.__metD = null;
    const watch = () => {
      const r = w.track.delta(w.player.s, on.s);
      if (window.__metD === null && r < 0) window.__metD = w.player.d;
      else if (window.__metD === null) requestAnimationFrame(watch);
    };
    watch();
  });
  await page.waitForFunction(() => {
    const w = window.__game.world;
    return window.__metD !== null && w.track.delta(w.player.s, window.__slow.s) < -15 && w.player.d > 1.5;
  }, null, { timeout: 40000 }).catch(() => {});
  const a4 = await g(() => {
    const w = window.__game.world;
    return { metD: window.__metD, rel: w.track.delta(w.player.s, window.__slow.s), bumps: window.__game.state.stats.bumps - window.__bumps0 };
  });
  check('autopilot does not pull out into oncoming traffic', a4.metD !== null && a4.metD > 1.2 && a4.bumps === 0, `lane offset when the oncoming car passed: ${a4.metD?.toFixed(2)}, bumps ${a4.bumps}`);
  check('autopilot overtakes once the oncoming car has passed', a4.rel < -15, `rel ${a4.rel.toFixed(1)} m`);

  const follows = await g(() => {
    const G = window.__game, w = G.world;
    const section = w.roadRules.restrictions.find(section => section.dir === 1 && section.length > 700);
    w.player.reset(section.s + 50); w.player.v = 20;
    for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < 1000) c.s = w.track.wrap(c.s + 2000);
    const lead = window.__slow;
    lead.s = w.track.wrap(w.player.s + 55); lead.d = lead.lane = 1.85; lead.v = lead.vDesired = 12;
    w.pilot.engage(w.player, 25);
    const bumps = G.state.stats.bumps;
    let pulledOut = false;
    for (let i = 0; i < 120 * 20; i++) {
      G.simulate(1 / 120);
      pulledOut ||= w.pilot.state === 'passing' || w.player.d < 1.2;
    }
    return { pulledOut, bumps: G.state.stats.bumps - bumps, speed: w.player.v };
  });
  check('autopilot follows a slower car through a no-passing section', !follows.pulledOut && follows.bumps === 0 && follows.speed < 14, `${(follows.speed * 3.6).toFixed(0)} km/h`);

  // steering takes over
  await page.keyboard.down('ArrowLeft');
  await wait(150);
  await page.keyboard.up('ArrowLeft');
  check('steering switches the autopilot off', !(await g(() => window.__game.world.pilot.active)));

  // a whole lap on autopilot in regular traffic
  const lap = await g(() => {
    const G = window.__game;
    const { player, track, pilot } = G.world;
    for (const k in G.input) G.input[k] = false;
    // start on a clear stretch (an instant speed change right behind a car could not be braked)
    for (const c of G.world.traffic.cars) if (Math.abs(track.delta(player.s, c.s)) < 300) c.s = track.wrap(c.s + 600);
    player.d = 1.85; player.yaw = 0; player.v = 110 / 3.6;
    pilot.engage(player);
    const st = G.state.stats;
    const b0 = st.bumps, o0 = st.overtakes, d0 = player.distance;
    let steps = 0, rail = 0, minD = Infinity, maxD = -Infinity, lineViolations = 0;
    while (player.distance - d0 < track.length && steps < 120 * 900) {
      G.simulate(1 / 120);
      steps++;
      if (player.touchingRail) rail++;
      minD = Math.min(minD, player.d);
      maxD = Math.max(maxD, player.d);
      if (player.d < 1.11 && !G.world.roadRules.allowsPassing(player.s + 2.05)) lineViolations++;
    }
    pilot.disengage();
    return { km: (player.distance - d0) / 1000, minutes: steps / 7200, bumps: st.bumps - b0, overtakes: st.overtakes - o0, rail, minD, maxD, lineViolations };
  });
  console.log('autopilot lap', JSON.stringify(lap));
  check('autopilot drives a full lap in traffic', lap.km > 8.5 && lap.rail === 0 && lap.bumps <= 1, `${lap.km.toFixed(2)} km in ${lap.minutes.toFixed(1)} min, bumps ${lap.bumps}, rail contacts ${lap.rail}`);
  check('autopilot overtakes on permitted sections during the lap', lap.overtakes >= 1, `${lap.overtakes} overtakes, d ${lap.minD.toFixed(2)}..${lap.maxD.toFixed(2)}`);
  check('autopilot returns before every solid line during the lap', lap.lineViolations === 0, `${lap.lineViolations} violations`);

  // ---- phones in landscape: the start menu fits, start goes full screen where the browser allows it ----
  for (const [name, width, height, ios] of [['iPhone, Safari bars visible', 750, 340, true], ['Android phone', 740, 360, false]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await ctx.newPage();
    mp.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
    // iPhone Safari offers no fullscreen API to pages
    if (ios) await mp.addInitScript(() => { for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled']) Object.defineProperty(Document.prototype, k, { get: () => false, configurable: true }); });
    await mp.goto(url);
    await mp.waitForFunction(() => window.__game && window.__game.state.mode === 'menu', null, { timeout: 90000 });
    const fits = await mp.evaluate(() => {
      const b = document.querySelector('#start .card').getBoundingClientRect();
      return b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth;
    });
    check(`${name} ${width}x${height}: start menu fits on screen`, fits);
    await mp.screenshot({ path: `${OUT}/10-mobile-${ios ? 'ios' : 'android'}-menu.png` });
    await mp.tap('#start-btn');
    await mp.waitForTimeout(800);
    const st = await mp.evaluate(() => ({
      mode: window.__game.state.mode,
      fullscreen: !!document.fullscreenElement,
      iosHint: !document.getElementById('ios-hint').classList.contains('hidden'),
    }));
    if (ios) check(`${name}: shows the home screen hint instead of fullscreen`, st.mode === 'play' && st.iosHint && !st.fullscreen);
    else check(`${name}: tapping start enters full screen`, st.mode === 'play' && st.fullscreen);
    await mp.screenshot({ path: `${OUT}/10-mobile-${ios ? 'ios' : 'android'}-play.png` });

    if (!ios) {
      // touch controls, driven with real touch events (several fingers at once)
      await mp.evaluate(() => {
        const w = window.__game.world;
        for (const c of w.traffic.cars) if (Math.abs(w.track.delta(w.player.s, c.s)) < 500) c.s = w.track.wrap(c.s + 1000);
        w.player.v = 0; w.player.d = 1.85; w.player.yaw = 0;
      });
      const cdp = await ctx.newCDPSession(mp);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      const at = (sel, fx = 0.5) => mp.evaluate(([sel, fx]) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return { x: b.left + b.width * fx, y: b.top + b.height / 2 };
      }, [sel, fx]);
      const tstate = () => mp.evaluate(() => {
        const G = window.__game;
        return { v: G.world.player.v, d: G.world.player.d, input: { ...G.input }, pilot: G.world.pilot.active, mode: G.state.mode };
      });
      // Roblox-style thumbstick: put the thumb down on the left half, push up and to the left
      const { w: vw, h: vh } = await mp.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const thumb = { x: vw * 0.2, y: vh * 0.7, id: 1 };
      await touch('touchStart', [thumb]);
      await touch('touchMove', [{ ...thumb, y: thumb.y - 60 }]);
      // wait on the game state rather than the clock: under load frames (and simulated time) slow down
      await mp.waitForFunction(() => window.__game.world.player.v > 8, null, { timeout: 5000 }).catch(() => {});
      const t0 = await tstate();
      await touch('touchMove', [{ ...thumb, x: thumb.x - 45, y: thumb.y - 45 }]);
      await mp.waitForFunction(() => window.__game.world.player.d < 1.5, null, { timeout: 5000 }).catch(() => {});
      const t1 = await tstate();
      // a second finger on the right half orbits the camera meanwhile
      const yaw0 = await mp.evaluate(() => window.__game.orbitCam.yaw);
      const camFinger = { x: vw * 0.75, y: vh * 0.5, id: 2 };
      await touch('touchStart', [{ ...thumb, x: thumb.x - 45, y: thumb.y - 45 }, camFinger]);
      await touch('touchMove', [{ ...thumb, x: thumb.x - 45, y: thumb.y - 45 }, { ...camFinger, x: camFinger.x - 120 }]);
      // pointer moves are delivered with the next frame, which can take a while under load
      await mp.waitForFunction((y0) => Math.abs(window.__game.orbitCam.yaw - y0) > 0.5, yaw0, { timeout: 3000 }).catch(() => {});
      const yaw1 = await mp.evaluate(() => window.__game.orbitCam.yaw);
      await mp.screenshot({ path: `${OUT}/10-mobile-thumbstick.png` });
      await touch('touchEnd', []);
      await mp.waitForTimeout(100);
      const t2 = await tstate();
      check(`${name}: thumbstick up accelerates, diagonal steers (analog)`, t0.input.throttle > 0.9 && t0.v > 8 && t1.input.steer < -0.5 && t1.input.throttle > 0.5 && t1.d < 1.5, `${(t0.v * 3.6).toFixed(0)} km/h, steer ${t1.input.steer?.toFixed(2)}, d ${t1.d.toFixed(2)}`);
      check(`${name}: releasing the thumbstick clears the input`, t2.input.throttle === undefined && t2.input.steer === undefined);
      check(`${name}: dragging on the right half orbits the camera`, Math.abs(yaw1 - yaw0) > 0.5, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);
      await mp.waitForTimeout(3500);
      const yaw2 = await mp.evaluate(() => window.__game.orbitCam.yaw);
      check(`${name}: the camera swings back behind the car when let go`, Math.abs(yaw2) < 0.1, `yaw ${yaw2.toFixed(2)}`);
      await mp.evaluate(() => {
        const { player, traffic, track } = window.__game.world;
        player.reset(player.s);
        for (const c of traffic.cars) if (Math.abs(track.delta(player.s, c.s)) < 500) c.s = track.wrap(c.s + 1000);
      });
      const backThumb = { x: vw * 0.2, y: vh * 0.55, id: 4 };
      await touch('touchStart', [backThumb]);
      await touch('touchMove', [{ ...backThumb, y: backThumb.y + 60 }]);
      await mp.waitForFunction(() => window.__game.world.player.v < -1, null, { timeout: 5000 });
      const reverseTouch = await tstate();
      const reverseUnit = await mp.locator('#hud-unit').textContent();
      await touch('touchEnd', []);
      await mp.waitForTimeout(100);
      check(`${name}: pulling the thumbstick down reverses and shows R`, reverseTouch.v < -1 && reverseTouch.input.reverse > 0.9 && reverseUnit === 'R · km/h');
      check(`${name}: releasing the thumbstick clears reverse`, (await tstate()).input.reverse === undefined);
      const left = { x: vw * 0.2, y: vh * 0.7, id: 3 };
      await mp.evaluate(() => { const p = window.__game.world.player; p.v = 22; p.d = 1.85; p.yaw = 0; });
      await mp.tap('#tc-auto');
      await mp.waitForTimeout(200);
      const t3 = await tstate();
      await touch('touchStart', [left]);
      await touch('touchMove', [{ ...left, x: left.x + 50 }]);
      await mp.waitForTimeout(150);
      await touch('touchEnd', []);
      const t4 = await tstate();
      check(`${name}: AUTO button engages the autopilot, steering with the thumbstick takes over`, t3.pilot && !t4.pilot);
      await mp.tap('#tc-pause');
      await mp.waitForTimeout(150);
      const paused = (await tstate()).mode === 'pause';
      await mp.tap('#resume-btn');
      await mp.waitForTimeout(150);
      check(`${name}: pause button pauses, resume continues`, paused && (await tstate()).mode === 'play');
    }
    await ctx.close();
  }
  // ---- installed app (home screen icon, display-mode fullscreen) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const ap = await ctx.newPage();
    await ap.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: fullscreen') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
      window.__calls = { fullscreen: 0, close: 0 };
      Element.prototype.requestFullscreen = function () { window.__calls.fullscreen++; return Promise.resolve(); };
      window.close = () => { window.__calls.close++; };
    });
    await ap.goto(url);
    await ap.waitForFunction(() => window.__game && window.__game.state.mode === 'menu', null, { timeout: 90000 });
    const visible = (sel) => ap.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0), sel);
    const menuExit = await visible('#start .exit-btn');
    const fsBtnHidden = !(await visible('#fs-btn'));
    await ap.tap('#start-btn');
    await ap.waitForTimeout(300);
    const afterStart = await ap.evaluate(() => ({ mode: window.__game.state.mode, calls: { ...window.__calls } }));
    await ap.tap('#tc-pause');
    await ap.waitForTimeout(200);
    const pauseExit = await visible('#pause .exit-btn');
    await ap.screenshot({ path: `${OUT}/12-installed-pause.png` });
    await ap.tap('#pause .exit-btn');
    await ap.waitForTimeout(100);
    const closeCalls = await ap.evaluate(() => window.__calls.close);
    check('installed app: starts without requesting fullscreen again (system bars can be swiped in)', afterStart.mode === 'play' && afterStart.calls.fullscreen === 0 && fsBtnHidden, JSON.stringify(afterStart.calls));
    check('installed app: exit button on the start screen and in pause closes the app', menuExit && pauseExit && closeCalls === 1);
    await ctx.close();
  }
  const exitInBrowser = await g(() => [...document.querySelectorAll('.exit-btn')].some((e) => !e.classList.contains('hidden')));
  check('browser tab: no exit button (a page cannot close the tab)', !exitInBrowser);

  // ---- phone in portrait: HUD pieces must not overlap, the view must not shrink to a slit ----
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 643 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const pp = await ctx.newPage();
    await pp.goto(url);
    await pp.waitForFunction(() => window.__game && window.__game.state.mode === 'menu', null, { timeout: 90000 });
    const menuFits = await pp.evaluate(() => {
      const b = document.querySelector('#start .card').getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight;
    });
    await pp.tap('#start-btn');
    await pp.waitForTimeout(300);
    await pp.evaluate(() => { window.__game.world.player.v = 22; window.__game.toggleAutopilot(); });
    await pp.waitForTimeout(1000);
    const lay = await pp.evaluate(() => {
      const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e || getComputedStyle(e).display === 'none' || e.classList.contains('hidden')) return null;
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const E = { statsL: box('.stats-left'), statsR: box('.stats-right'), buttons: box('.tc-top'), speed: box('.speedo'), auto: box('#auto-badge'), stick: box('#stick'), toast: box('#toast.show') };
      const keys = Object.keys(E).filter((k) => E[k]);
      const over = [];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = E[keys[i]], b = E[keys[j]];
          if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) over.push(`${keys[i]}/${keys[j]}`);
        }
      }
      const outside = keys.filter((k) => E[k].l < 0 || E[k].t < 0 || E[k].r > innerWidth || E[k].b > innerHeight);
      return { over, outside, fov: window.__game.camera.fov };
    });
    await pp.screenshot({ path: `${OUT}/11-portrait.png` });
    check('portrait phone: start menu fits on screen', menuFits);
    check('portrait phone: HUD does not overlap and stays on screen', lay.over.length === 0 && lay.outside.length === 0, [...lay.over, ...lay.outside].join(', '));
    check('portrait phone: camera widens its view', lay.fov > 75, `fov ${lay.fov.toFixed(0)}`);
    await ctx.close();
  }
  const noTouchOnDesktop = await g(() => getComputedStyle(document.getElementById('touch-controls')).display === 'none');
  check('desktop shows no touch controls', noTouchOnDesktop);
  const yawD0 = await g(() => window.__game.orbitCam.yaw);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(560, 380, { steps: 6 });
  const yawD1 = await g(() => window.__game.orbitCam.yaw);
  await page.mouse.up();
  await page.mouse.wheel(0, 400);
  await wait(100);
  const zoomD = await g(() => window.__game.orbitCam.zoom);
  check('desktop: mouse drag orbits the camera, the wheel zooms', Math.abs(yawD1 - yawD0) > 0.5 && zoomD > 1.2, `yaw ${yawD0.toFixed(2)} -> ${yawD1.toFixed(2)}, zoom ${zoomD.toFixed(2)}`);

  // ---- adaptive resolution under sustained load ----
  // runs last with the main page parked, so no other page competes for the GPU
  await page.goto('about:blank');
  for (const phone of [false, true]) {
    const ctx = await browser.newContext(phone
      ? { viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
    const rp = await ctx.newPage();
    await rp.goto(url);
    await rp.waitForFunction(() => window.__game && window.__game.state.mode === 'menu', null, { timeout: 90000 });
    await rp.evaluate(() => {
      window.__game.startGame();
      const r = window.__game.renderer;
      const render = r.render.bind(r);
      window.__load = 0;
      // busy-wait inside a frame to simulate a slow GPU / CPU
      r.render = (sc, cam) => {
        const end = performance.now() + window.__load;
        while (performance.now() < end);
        render(sc, cam);
      };
    });
    const pr = () => rp.evaluate(() => window.__game.renderer.getPixelRatio());
    await rp.waitForTimeout(4000);
    const before = await pr();
    await rp.evaluate(() => { window.__load = 35; });
    let lowest = Infinity;
    for (let i = 0; i < 8; i++) {
      await rp.waitForTimeout(1500);
      lowest = Math.min(lowest, await pr());
    }
    // the policy itself is unit tested in tests/resolution.test.mjs; this checks it is wired into the game
    if (phone) check('adaptive resolution: a phone never drops below 1.0', lowest >= 1, `lowest ${lowest}`);
    else check('adaptive resolution: sustained load lowers the resolution', lowest < before, `before ${before}, under load ${lowest}`);
    await ctx.close();
  }

  const relevant = errors.filter((e) => !/GPU stall|ReadPixels|Automatic fallback to software WebGL/.test(e));
  check('no console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
} catch (e) {
  check('test run finished', false, e.message);
  console.log(errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
