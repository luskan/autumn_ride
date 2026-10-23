const $ = (id) => document.getElementById(id);
const MAX_KMH = 180;
const SWEEP = 270;

const pad = (n) => String(n).padStart(2, '0');
const AUTO_STATES = { lane: 'trzyma pas', passing: 'wyprzedza', returning: 'wraca na pas', abort: 'odpuszcza' };

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), loading: $('loading'), loadingText: $('loading-text'), loadingBar: $('loading-bar'),
      start: $('start'), pause: $('pause'), speed: $('hud-speed'), needle: $('needle'), arc: $('speed-arc'),
      dist: $('hud-dist'), time: $('hud-time'), overtakes: $('hud-overtakes'), bumps: $('hud-bumps'),
      toast: $('toast'), camera: $('hud-camera'), sound: $('hud-sound'),
      auto: $('auto-badge'), autoSpeed: $('auto-speed'), autoState: $('auto-state'), setMarker: $('set-marker'),
    };
    this.last = {};
    this.buildDial();
  }

  buildDial() {
    const ticks = $('ticks');
    const ns = 'http://www.w3.org/2000/svg';
    for (let v = 0; v <= MAX_KMH; v += 10) {
      const a = ((-SWEEP / 2 + (v / MAX_KMH) * SWEEP) * Math.PI) / 180;
      const major = v % 20 === 0;
      const r0 = major ? 70 : 75, r1 = 82;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', 100 + Math.sin(a) * r0);
      line.setAttribute('y1', 100 - Math.cos(a) * r0);
      line.setAttribute('x2', 100 + Math.sin(a) * r1);
      line.setAttribute('y2', 100 - Math.cos(a) * r1);
      line.setAttribute('class', major ? 'tick major' : 'tick');
      ticks.appendChild(line);
      if (major && v % 40 === 0) {
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', 100 + Math.sin(a) * 57);
        t.setAttribute('y', 104 - Math.cos(a) * 57);
        t.setAttribute('class', 'tick-label');
        t.textContent = v;
        ticks.appendChild(t);
      }
    }
    this.arcLen = this.el.arc.getTotalLength();
    this.el.arc.style.strokeDasharray = `${this.arcLen} ${this.arcLen}`;
  }

  setLoading(text, frac) {
    this.el.loadingText.textContent = text;
    this.el.loadingBar.style.width = `${Math.round(frac * 100)}%`;
  }

  show(name, visible) {
    this.el[name].classList.toggle('hidden', !visible);
  }

  set(key, el, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  update({ kmh, distance, time, overtakes, bumps, auto }) {
    this.updateAutopilot(auto);
    const k = Math.round(kmh);
    if (this.last.kmh !== k) {
      this.last.kmh = k;
      this.el.speed.textContent = k;
      const f = Math.min(1, kmh / MAX_KMH);
      this.el.needle.setAttribute('transform', `rotate(${-SWEEP / 2 + f * SWEEP} 100 100)`);
      this.el.arc.style.strokeDashoffset = `${this.arcLen * (1 - f)}`;
    }
    this.set('dist', this.el.dist, `${(distance / 1000).toFixed(1)} km`);
    const t = Math.floor(time);
    this.set('time', this.el.time, `${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    this.set('overtakes', this.el.overtakes, String(overtakes));
    this.set('bumps', this.el.bumps, String(bumps));
  }

  updateAutopilot(auto) {
    const on = !!auto;
    if (this.last.autoOn !== on) {
      this.last.autoOn = on;
      this.el.auto.classList.toggle('hidden', !on);
      this.el.setMarker.classList.toggle('hidden', !on);
    }
    if (!on) return;
    const k = Math.round(auto.kmh);
    if (this.last.autoKmh !== k) {
      this.last.autoKmh = k;
      this.el.autoSpeed.textContent = k;
      const f = Math.min(1, auto.kmh / MAX_KMH);
      this.el.setMarker.setAttribute('transform', `rotate(${-SWEEP / 2 + f * SWEEP} 100 100)`);
    }
    this.set('autoState', this.el.autoState, AUTO_STATES[auto.state] || '');
  }

  setCamera(name) {
    this.el.camera.textContent = name;
  }

  setSound(on) {
    this.el.sound.textContent = on ? 'wł.' : 'wył.';
  }

  toast(text, kind = '') {
    const el = this.el.toast;
    el.textContent = text;
    el.className = `show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.className = ''), 1800);
  }
}
