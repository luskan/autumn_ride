// Roblox-style touch controls. Left half of the screen: a dynamic thumbstick that appears
// under the thumb (up = gas, down = brake / reverse, sideways = steering, all analog). Right half:
// drag to orbit the camera, pinch with two fingers to zoom. Small buttons on top:
// autopilot, camera and pause.

const STICK_R = 58; // px of thumb travel for full deflection
const KNOB_TRAVEL = 34 / STICK_R; // the drawn knob stays inside its ring
const DEAD = 0.12;

// dead zone, then linear up to 1
const shape = (v) => {
  const a = Math.abs(v);
  return a < DEAD ? 0 : Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
};

const capture = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {
    // synthetic or already finished pointers cannot be captured
  }
};

function bindTap(el, action) {
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    e.preventDefault();
    action();
  });
}

export function setupTouchControls({ drive, release, toggleAutopilot, nextCamera, pause, orbit, zoom, orbitEnd }) {
  const root = document.getElementById('touch-controls');
  const zone = document.getElementById('touch-zone');
  const base = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  let stick = null; // { id, cx, cy } while a thumb drives
  const cams = new Map(); // camera fingers: pointerId -> last position
  let pinch = null;

  const placeStick = (cx, cy, dx, dy) => {
    base.style.left = `${cx}px`;
    base.style.top = `${cy}px`;
    knob.style.transform = `translate(${dx * KNOB_TRAVEL}px, ${dy * KNOB_TRAVEL}px)`;
  };
  const resetStick = () => {
    base.classList.remove('active');
    base.style.left = base.style.top = '';
    knob.style.transform = '';
  };

  const moveStick = (e) => {
    let dx = e.clientX - stick.cx;
    let dy = e.clientY - stick.cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_R) {
      // like Roblox: the base follows a thumb that slides too far
      const k = 1 - STICK_R / len;
      stick.cx += dx * k;
      stick.cy += dy * k;
      dx = e.clientX - stick.cx;
      dy = e.clientY - stick.cy;
    }
    placeStick(stick.cx, stick.cy, dx, dy);
    const forward = shape(-dy / STICK_R);
    drive({ throttle: Math.max(0, forward), brake: Math.max(0, -forward), steer: shape(dx / STICK_R) });
  };

  const pinchDistance = () => {
    const [a, b] = [...cams.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    capture(zone, e.pointerId);
    if (!stick && e.clientX < window.innerWidth / 2) {
      stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
      base.classList.add('active');
      moveStick(e);
    } else {
      cams.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = cams.size === 2 ? pinchDistance() : null;
    }
  });

  zone.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) {
      moveStick(e);
      return;
    }
    const p = cams.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (cams.size >= 2) {
      const d = pinchDistance();
      if (pinch) zoom(pinch / d);
      pinch = d;
    } else {
      orbit(dx, dy);
    }
  });

  const end = (e) => {
    if (stick && e.pointerId === stick.id) {
      stick = null;
      resetStick();
      release();
      return;
    }
    if (cams.delete(e.pointerId)) {
      pinch = null;
      if (cams.size === 0) orbitEnd();
    }
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  const autoBtn = document.getElementById('tc-auto');
  bindTap(autoBtn, toggleAutopilot);
  bindTap(document.getElementById('tc-cam'), nextCamera);
  bindTap(document.getElementById('tc-pause'), pause);

  let autoOn = null;
  return {
    root,
    // reflect the autopilot state on its button
    update(autopilot) {
      if (autopilot === autoOn) return;
      autoOn = autopilot;
      autoBtn.classList.toggle('on', autopilot);
    },
  };
}

// Desktop counterpart: drag with the mouse to orbit the camera, wheel to zoom.
export function setupMouseCamera(canvas, { orbit, zoom, orbitEnd }) {
  let dragging = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    dragging = { x: e.clientX, y: e.clientY };
    capture(canvas, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerType !== 'mouse') return;
    orbit(e.clientX - dragging.x, e.clientY - dragging.y);
    dragging = { x: e.clientX, y: e.clientY };
  });
  const end = (e) => {
    if (!dragging || e.pointerType !== 'mouse') return;
    dragging = null;
    orbitEnd();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false },
  );
}
