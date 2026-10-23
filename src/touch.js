// On-screen controls for touch screens: steering pad (left thumb), pedals (right thumb)
// and small buttons for autopilot, camera and pause. Uses pointer events, so several
// fingers work at once (e.g. gas + steering).

const capture = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {
    // synthetic or already finished pointers cannot be captured
  }
};

// button held down while a finger rests on it
function bindHold(el, down, up) {
  let pointer = null;
  const end = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    el.classList.remove('active');
    up();
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pointer !== null) return;
    pointer = e.pointerId;
    capture(el, pointer);
    el.classList.add('active');
    down();
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

function bindTap(el, action) {
  el.addEventListener('pointerdown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    e.preventDefault();
    action();
  });
}

export function setupTouchControls({ press, release, toggleAutopilot, nextCamera, pause }) {
  const root = document.getElementById('touch-controls');
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  for (const el of root.querySelectorAll('[data-key]')) {
    bindHold(el, () => press(el.dataset.key), () => release(el.dataset.key));
  }

  // steering: the half under the finger counts, so the thumb can slide from left to right
  const pad = document.getElementById('steer-pad');
  const halves = { left: pad.querySelector('[data-side="left"]'), right: pad.querySelector('[data-side="right"]') };
  let pointer = null;
  let side = null;
  const setSide = (next) => {
    if (next === side) return;
    if (side) {
      release(side);
      halves[side].classList.remove('active');
    }
    side = next;
    if (side) {
      press(side);
      halves[side].classList.add('active');
    }
  };
  const sideAt = (e) => {
    const r = pad.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'left' : 'right';
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pointer !== null) return;
    pointer = e.pointerId;
    capture(pad, pointer);
    setSide(sideAt(e));
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) setSide(sideAt(e));
  });
  const end = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    setSide(null);
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('lostpointercapture', end);

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
