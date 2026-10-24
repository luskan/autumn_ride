import * as THREE from 'three';
import './style.css';
import { WORLD, PLAYER, KMH, COLORS } from './config.js';
import { nextFrame, damp, clamp } from './util.js';
import { buildTrack } from './track.js';
import { Terrain } from './terrain.js';
import * as TX from './textures.js';
import { buildRoad, roadPeriod, CHUNK } from './road.js';
import { patchFog, createSky, createEnvironment, createLights, updateSun } from './sky.js';
import { Vegetation, buildGrass } from './vegetation.js';
import { planVillages, buildVillages, buildHayBales, buildSigns } from './props.js';
import { createCarMaterials, Traffic } from './traffic.js';
import { Player } from './player.js';
import { Autopilot } from './autopilot.js';
import { ResolutionGovernor } from './resolution.js';
import { Leaves, Sparks } from './effects.js';
import { AudioFx } from './audio.js';
import { Hud } from './hud.js';
import { setupTouchControls, setupMouseCamera } from './touch.js';
import { shaderTime } from './materials.js';

patchFog();

const params = new URLSearchParams(location.search);
const hud = new Hud();
const audio = new AudioFx();
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: params.get('aa') !== '0', powerPreference: 'high-performance' });
// ?pr=1.5 forces a fixed pixel ratio; otherwise start conservatively and let the governor adapt
const fixedPixelRatio = params.has('pr') ? Number(params.get('pr')) : null;
const maxPixelRatio = fixedPixelRatio ?? Math.min(window.devicePixelRatio || 1, 1.5);
let pixelRatio = fixedPixelRatio ?? Math.min(1, maxPixelRatio);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLORS.fog, WORLD.fogDensity);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 2400);

const CAMERAS = [
  { name: 'zza auta', back: 8.4, up: 3.0, ahead: 14, lookUp: 1.1, fov: 58 },
  { name: 'z lotu ptaka', back: 19, up: 9.5, ahead: 26, lookUp: 0, fov: 54 },
  { name: 'blisko', back: 5.6, up: 1.75, ahead: 12, lookUp: 1.0, fov: 64 },
];

const input = { up: false, down: false, left: false, right: false };
const state = {
  mode: 'loading',
  time: 0,
  camMode: 0,
  shake: 0,
  stats: { time: 0, distance: 0, overtakes: 0, bumps: 0 },
  startDistance: 0,
  fps: 0,
};
let world = null;

// objects hidden beyond a distance from the camera (grass, posts)
const distanceCulled = [];
function cullByDistance(obj, maxDist) {
  if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
  const sphere = obj.boundingSphere || obj.geometry.boundingSphere;
  distanceCulled.push({ obj, center: sphere.center.clone(), max: maxDist + sphere.radius });
}
function updateDistanceCulling() {
  for (const it of distanceCulled) it.obj.visible = it.center.distanceTo(camera.position) < it.max;
}

// ---------- world creation ----------

function findStart(track) {
  let best = 0, bestK = Infinity;
  for (let s = 0; s < track.length; s += 25) {
    let k = 0;
    for (let a = -60; a < 320; a += 10) k = Math.max(k, Math.abs(track.kappaAt(s + a)));
    if (k < bestK) {
      bestK = k;
      best = s;
    }
  }
  return best;
}

async function init() {
  const t0 = performance.now();
  let tStep = t0;
  state.loadSteps = {};
  const step = async (text, frac) => {
    const now = performance.now();
    state.loadSteps[text] = Math.round(now - tStep);
    hud.setLoading(text, frac);
    await nextFrame();
    tStep = performance.now();
  };
  await step('Wytyczanie trasy...', 0.05);
  const track = buildTrack(WORLD.seed);
  track.buildDistanceField(WORLD.terrainSize, 30);

  await step('Kształtowanie terenu...', 0.15);
  const terrain = new Terrain(track, { size: WORLD.terrainSize, segments: WORLD.terrainSegments });
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const groundTex = TX.makeGroundDetailTexture();
  scene.add(terrain.createMesh(groundTex));

  await step('Malowanie drogi...', 0.4);
  const env = createEnvironment(renderer);
  const localGround = groundTex.clone();
  localGround.needsUpdate = true;
  const road = buildRoad(track, { roadTexture: TX.makeRoadTexture(roadPeriod(track), aniso), groundTexture: localGround, env });
  scene.add(road.group);
  for (const c of road.chunks) cullByDistance(c.posts, 650);

  await step('Sadzenie drzew...', 0.5);
  const villages = planVillages(track, terrain, 11);
  const vegetation = new Vegetation(track, terrain, { villages, seed: 21 });
  scene.add(vegetation.mesh);
  for (const g of buildGrass(track, terrain, [TX.makeGrassTexture(0), TX.makeGrassTexture(1)], 31, CHUNK, vegetation.bushSpots)) {
    scene.add(g);
    cullByDistance(g, 260);
  }

  await step('Stawianie znaków...', 0.72);
  scene.add(buildVillages(villages, terrain));
  scene.add(buildHayBales(track, terrain, villages, localGround, 41));
  const signs = buildSigns(track, terrain, TX.makeSignAtlas(aniso), env, villages);
  scene.add(signs);

  await step('Wyprowadzanie aut...', 0.85);
  const sky = createSky(renderer);
  scene.add(sky);
  const lights = createLights(scene);
  const carMats = createCarMaterials(env, { truckLogo: TX.makeTruckLogoTexture(aniso) });
  const shadowTex = TX.makeBlobShadowTexture();
  const player = new Player(track, carMats, { env, plateTexture: TX.makePlateTexture('AUTOMAPA'), shadowTexture: shadowTex });
  player.reset(findStart(track));
  scene.add(player.group);
  const traffic = new Traffic(track, { sameCount: 28, oncomingCount: 22, seed: 5, materials: carMats, shadowTexture: shadowTex });
  // keep the start area clear
  for (const c of traffic.cars) {
    const rel = track.delta(player.s, c.s);
    if (Math.abs(rel) < 60) c.s = track.wrap(c.s + (c.dir > 0 ? 120 : -260));
  }
  scene.add(traffic.group);
  const leaves = new Leaves(TX.makeLeafTexture());
  scene.add(leaves.mesh);
  const sparks = new Sparks(TX.makeSparkTexture());
  scene.add(sparks.points);

  const pilot = new Autopilot(track, traffic);
  // the menu shows the same autopilot driving at a relaxed pace
  const menuPilot = new Autopilot(track, traffic);
  menuPilot.engage(player, 70 / KMH);

  world = { track, terrain, vegetation, player, traffic, leaves, sparks, sky, lights, signs, villages, pilot, menuPilot };
  window.__game = { THREE, scene, camera, renderer, state, input, world, setInput, startGame, setCamera, setPaused, simulate, toggleAutopilot, orbitCam };

  await step('Rozgrzewanie silnika...', 0.95);
  updateCamera(0, true);
  updateDistanceCulling();
  renderer.compile(scene, camera);
  state.loadMs = Math.round(performance.now() - t0);
  state.mode = 'menu';
  hud.show('loading', false);
  hud.show('start', true);
  hud.setCamera(CAMERAS[state.camMode].name);
  document.getElementById('start-btn').focus();
}

// ---------- game flow ----------

// ---------- fullscreen (phones) ----------

const touchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
// phones never render below 1.0: it looks blocky on their small, dense screens
const governor = fixedPixelRatio === null
  ? new ResolutionGovernor({ max: maxPixelRatio, floor: touchDevice && window.devicePixelRatio >= 2 ? 1 : 0.75, start: pixelRatio })
  : null;
const root = document.documentElement;
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const standalone = window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

// No orientation lock: the game works in portrait too, and rotating the screen while
// fullscreen switches has left Chrome tabs unable to enter fullscreen again.
function enterFullscreen() {
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!canFullscreen || !request || isFullscreen()) return;
  let settled = false;
  const failed = () => hud.toast('Pełny ekran niedostępny - otwórz grę w nowej karcie', 'bump');
  // promise or undefined depending on the browser
  Promise.resolve(request.call(root, { navigationUI: 'hide' })).then(
    () => (settled = true),
    () => {
      settled = true;
      failed();
    },
  );
  // a request that never answers is a stuck tab: say so instead of doing nothing
  setTimeout(() => {
    if (!settled && !isFullscreen()) failed();
  }, 1500);
}

function toggleFullscreen() {
  if (!isFullscreen()) return enterFullscreen();
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  Promise.resolve(exit.call(document)).catch(() => {});
}

const fsButton = document.getElementById('fs-btn');
function updateFullscreenButton() {
  fsButton.classList.toggle('hidden', !canFullscreen || standalone);
  fsButton.setAttribute('aria-label', isFullscreen() ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran');
}
fsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleFullscreen();
  fsButton.blur();
});
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
updateFullscreenButton();
// iPhone Safari has no fullscreen API for pages; a home screen web app runs full screen instead
document.getElementById('ios-hint').classList.toggle('hidden', !(touchDevice && !canFullscreen && !standalone));

// Installed app (home screen icon): it already runs full screen, and system gestures are the
// way out, so it gets an explicit exit button instead of another fullscreen request.
function exitApp() {
  window.close();
  // still here: the browser did not allow closing
  setTimeout(() => hud.toast('Aby wyjść, przesuń od krawędzi ekranu i dotknij Wstecz'), 400);
}
for (const btn of document.querySelectorAll('.exit-btn')) {
  btn.classList.toggle('hidden', !standalone);
  btn.addEventListener('click', exitApp);
}
// the manifest only makes sense when served over http(s), file:// would log an error
if (location.protocol.startsWith('http')) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
}

function startGame() {
  if (state.mode !== 'menu') return;
  // an installed app is full screen already; requesting it again keeps the system bars from
  // showing on a swipe, which leaves no way to leave the game
  if (touchDevice && !standalone) enterFullscreen();
  state.mode = 'play';
  state.stats = { time: 0, distance: 0, overtakes: 0, bumps: 0 };
  state.startDistance = world.player.distance;
  for (const c of world.traffic.cars) c.overtaken = false;
  world.pilot.disengage();
  audio.init();
  hud.show('start', false);
  hud.show('hud', true);
  // on touch screens the fullscreen button joins the row of small HUD buttons
  document.querySelector('#touch-controls .tc-top').prepend(fsButton);
  hud.toast('Szerokiej drogi!');
}

function setPaused(paused) {
  if (paused && state.mode === 'play') {
    state.mode = 'pause';
    hud.show('pause', true);
  } else if (!paused && state.mode === 'pause') {
    state.mode = 'play';
    hud.show('pause', false);
  }
  for (const k in input) input[k] = false;
}

function setCamera(i) {
  state.camMode = i % CAMERAS.length;
  hud.setCamera(CAMERAS[state.camMode].name);
}

function setInput(key, value) {
  input[key] = value;
}

function toggleAutopilot() {
  if (state.mode !== 'play') return;
  const { pilot, player } = world;
  if (pilot.active) {
    pilot.disengage();
    hud.toast('Autopilot wyłączony');
  } else {
    pilot.engage(player);
    hud.toast(`Autopilot: ${Math.round(pilot.setSpeed * KMH)} km/h`);
  }
}

const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

// driving controls shared by the keyboard and the touch buttons
function press(k) {
  if (state.mode !== 'play') return;
  input[k] = true;
  // steering takes the wheel back from the autopilot
  if ((k === 'left' || k === 'right') && world.pilot.active) {
    world.pilot.disengage();
    hud.toast('Autopilot wyłączony - przejmujesz kierownicę');
  }
}

function release(k) {
  input[k] = false;
}

// camera orbit around the car (drag on touch screens or with the mouse), returns behind the car when let go
const orbitCam = { yaw: 0, pitch: 0, zoom: 1, dragging: false, idle: 0 };
const cameraControls = {
  orbit(dx, dy) {
    orbitCam.yaw -= dx * 0.008;
    orbitCam.pitch = clamp(orbitCam.pitch + dy * 0.005, -0.35, 0.9);
    orbitCam.dragging = true;
    orbitCam.idle = 0;
  },
  zoom(k) {
    orbitCam.zoom = clamp(orbitCam.zoom * k, 0.55, 2.2);
  },
  orbitEnd() {
    orbitCam.dragging = false;
  },
};

// thumbstick: analog throttle / brake / steering
function drive({ throttle, brake, steer }) {
  if (state.mode !== 'play') return;
  input.throttle = throttle;
  input.brake = brake;
  input.steer = steer;
  if (Math.abs(steer) > 0.35 && world.pilot.active) {
    world.pilot.disengage();
    hud.toast('Autopilot wyłączony - przejmujesz kierownicę');
  }
}

function releaseStick() {
  delete input.throttle;
  delete input.brake;
  delete input.steer;
}

const touch = setupTouchControls({
  drive,
  release: releaseStick,
  toggleAutopilot,
  nextCamera: () => setCamera(state.camMode + 1),
  pause: () => setPaused(true),
  ...cameraControls,
});
setupMouseCamera(canvas, cameraControls);
// touch controls on touch screens; a laptop with a touchscreen gets them on the first touch
const useTouchControls = () => document.body.classList.add('touch');
if (touchDevice) useTouchControls();
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') useTouchControls();
});

window.addEventListener('keydown', (e) => {
  const k = KEYS[e.code];
  if (k) {
    e.preventDefault();
    press(k);
  }
  if (state.mode === 'menu' && (e.code === 'Enter' || e.code === 'Space' || k === 'up')) {
    e.preventDefault();
    startGame();
    if (k) press(k);
  } else if (e.code === 'KeyA' && !e.repeat) {
    toggleAutopilot();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    setPaused(state.mode === 'play');
  } else if (e.code === 'KeyC' && !e.repeat) {
    setCamera(state.camMode + 1);
  } else if (e.code === 'KeyM' && !e.repeat) {
    hud.setSound(!audio.toggleMute());
  }
});
window.addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k) release(k);
});
window.addEventListener('blur', () => setPaused(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- simulation ----------

const AUTO_RATE = 15 / KMH; // set speed change per second while holding up/down

function driverInput(dt) {
  const { player, pilot, menuPilot } = world;
  if (state.mode !== 'play') return menuPilot.update(dt, player);
  if (!pilot.active) return input;
  // keys or the thumbstick pushed up / down change the cruise speed
  if (input.up || input.throttle > 0.5) pilot.adjust(AUTO_RATE * dt);
  if (input.down || input.brake > 0.5) pilot.adjust(-AUTO_RATE * dt);
  return pilot.update(dt, player);
}

function simulate(dt) {
  const { player, traffic } = world;
  const events = [];
  const playing = state.mode === 'play';
  player.update(dt, driverInput(dt), events);
  traffic.update(dt, player);
  traffic.collide(player, events);
  for (const ev of events) {
    if (ev.type === 'bump') {
      state.shake = Math.min(0.5, 0.12 + ev.strength * 0.03);
      if (playing) {
        state.stats.bumps++;
        audio.bump(ev.strength);
        hud.toast('Stłuczka! Bez szkód - jedziemy dalej.', 'bump');
      }
    } else if (ev.type === 'rail') {
      state.shake = Math.max(state.shake, 0.1 + ev.strength * 0.02);
      if (playing) audio.bump(ev.strength * 0.5);
    } else if (ev.type === 'overtake' && playing) {
      state.stats.overtakes++;
    } else if (ev.type === 'overtaken' && playing) {
      state.stats.overtakes = Math.max(0, state.stats.overtakes - 1);
    }
  }
  if (playing) {
    state.stats.time += dt;
    state.stats.distance = player.distance - state.startDistance;
  }
}

// ---------- camera ----------

const camF = { pos: new THREE.Vector3(), T: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3() };
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();

const PORTRAIT_HFOV = 52; // degrees of horizontal view kept on portrait screens
const camDesired = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camOffset = new THREE.Vector3();
const carCenter = new THREE.Vector3();

// rotate / tilt / scale the chase offset around the car
function applyOrbit(dt, desired, look, car) {
  const o = orbitCam;
  if (!o.dragging) {
    o.idle += dt;
    if (o.idle > 1) {
      o.yaw = damp(o.yaw, 0, 2.5, dt);
      o.pitch = damp(o.pitch, 0, 2.5, dt);
    }
  }
  o.yaw = Math.atan2(Math.sin(o.yaw), Math.cos(o.yaw));
  if (Math.abs(o.yaw) < 1e-3 && Math.abs(o.pitch) < 1e-3 && Math.abs(o.zoom - 1) < 1e-3) return;
  camOffset.subVectors(desired, car);
  const len = camOffset.length() * o.zoom;
  const el = clamp(Math.atan2(camOffset.y, Math.hypot(camOffset.x, camOffset.z)) + o.pitch, 0.08, 1.35);
  const az = Math.atan2(camOffset.z, camOffset.x) + o.yaw;
  desired.set(car.x + Math.cos(az) * Math.cos(el) * len, car.y + Math.sin(el) * len, car.z + Math.sin(az) * Math.cos(el) * len);
  // when looking around, aim at the car instead of the road ahead
  carCenter.copy(car);
  carCenter.y += 1.1;
  look.lerp(carCenter, Math.min(1, (Math.abs(o.yaw) + Math.abs(o.pitch)) / 0.5));
}

function updateCamera(dt, snap = false) {
  const { player, track } = world;
  if (state.debugCam) {
    const { pos, look } = state.debugCam;
    camera.position.set(...pos);
    camera.lookAt(...look);
    return;
  }
  const md = CAMERAS[state.camMode];
  track.frameAt(player.s - md.back, camF);
  const desired = camDesired.copy(camF.pos).addScaledVector(camF.R, player.d * 0.85);
  desired.y += md.up;
  track.frameAt(player.s + md.ahead, camF);
  const look = camTarget.copy(camF.pos).addScaledVector(camF.R, player.d * 0.7);
  look.y += md.lookUp;
  applyOrbit(dt, desired, look, player.group.position);
  if (snap) camPos.copy(desired);
  else camPos.lerp(desired, 1 - Math.exp(-7 * dt));
  if (snap) camLook.copy(look);
  else camLook.lerp(look, 1 - Math.exp(-9 * dt));

  camera.position.copy(camPos);
  if (state.shake > 0.001) {
    const s = state.shake;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    state.shake = damp(state.shake, 0, 6, dt);
  }
  camera.lookAt(camLook);
  const speedFov = (player.v / PLAYER.maxSpeed) * 7;
  let fov = md.fov + speedFov;
  // portrait: widen the vertical angle so the horizontal view does not shrink to a slit
  if (camera.aspect < 1) {
    const portrait = (2 * Math.atan(Math.tan((PORTRAIT_HFOV * Math.PI) / 360) / camera.aspect) * 180) / Math.PI;
    fov = Math.min(100, Math.max(fov, portrait + speedFov));
  }
  if (Math.abs(camera.fov - fov) > 0.02) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ---------- render loop ----------

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let perfFrames = 0, perfTime = 0;
const sparkOrigin = new THREE.Vector3();
const sparkVel = new THREE.Vector3();
const sunFocus = new THREE.Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!world) return;
  const { player, traffic, vegetation, leaves, sparks, sky, lights } = world;

  if (state.mode === 'play' || state.mode === 'menu') {
    acc += dt;
    while (acc >= STEP) {
      simulate(STEP);
      acc -= STEP;
    }
  }
  state.time += dt;
  shaderTime.value = state.time;

  player.updateVisual(dt, state.time);
  traffic.updateMeshes();
  updateCamera(dt);
  sky.position.copy(camera.position);
  camera.getWorldDirection(sunFocus);
  sunFocus.y = 0;
  sunFocus.normalize().multiplyScalar(55).add(player.group.position);
  updateSun(lights.sun, sunFocus);
  vegetation.update(camera);
  if (perfFrames % 8 === 0) updateDistanceCulling();
  leaves.update(dt, camera, player.group.position.y);

  if (player.scrape > 0 && state.mode !== 'pause') {
    camF.T.set(0, 0, 1).applyQuaternion(player.group.quaternion);
    camF.R.set(-1, 0, 0).applyQuaternion(player.group.quaternion);
    sparkOrigin.copy(player.group.position).addScaledVector(camF.R, player.scrapeSide * 0.95).addScaledVector(camF.T, (Math.random() - 0.3) * 3);
    sparkOrigin.y += 0.45;
    sparkVel.copy(camF.T).multiplyScalar(player.v * 0.25);
    sparks.emit(sparkOrigin, sparkVel, Math.ceil(player.scrape * 3));
  }
  sparks.update(dt);

  audio.update(player.v / PLAYER.maxSpeed, player.throttle, player.scrape, state.mode === 'play');
  if (state.mode !== 'menu') {
    hud.update({
      kmh: player.v * KMH, distance: state.stats.distance, time: state.stats.time,
      overtakes: state.stats.overtakes, bumps: state.stats.bumps,
      auto: world.pilot.active ? { kmh: world.pilot.setSpeed * KMH, state: world.pilot.state } : null,
    });
    touch.update(world.pilot.active);
  }

  renderer.render(scene, camera);

  // adaptive resolution
  perfFrames++;
  perfTime += dt;
  if (perfTime > 1.5) {
    const ms = (perfTime / perfFrames) * 1000;
    state.fps = Math.round(1000 / ms);
    if (governor) {
      const next = governor.update(ms, perfTime);
      if (next !== pixelRatio) {
        pixelRatio = next;
        renderer.setPixelRatio(pixelRatio);
      }
    }
    state.pixelRatio = pixelRatio;
    perfFrames = 0;
    perfTime = 0;
  }
}

init()
  .then(() => requestAnimationFrame(frame))
  .catch((err) => {
    console.error(err);
    hud.setLoading('Nie udało się uruchomić gry: ' + err.message, 1);
  });
