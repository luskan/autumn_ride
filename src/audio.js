// Procedural engine / wind / scrape / bump sounds (WebAudio)
const GEARS = [0, 0.14, 0.3, 0.48, 0.68, 0.88, 1.3];
const VOLUME = 0.5;

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(ctx.destination);

    this.engA = ctx.createOscillator();
    this.engA.type = 'sawtooth';
    this.engB = ctx.createOscillator();
    this.engB.type = 'square';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.45;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 2.5;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engA.connect(this.engFilter);
    this.engB.connect(bGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.windGain = loop('lowpass', 700, 0.7);
    this.scrapeGain = loop('bandpass', 2600, 4);
    this.engA.start();
    this.engB.start();
  }

  update(speedFrac, throttle, scrape, active) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    let g = 0;
    while (g < GEARS.length - 2 && speedFrac > GEARS[g + 1]) g++;
    const lo = GEARS[g], hi = GEARS[g + 1];
    const rpm = speedFrac < 0.01 ? 0.15 : 0.22 + 0.75 * Math.min(1, (speedFrac - lo) / (hi - lo));
    const freq = 36 + rpm * 115;
    this.engA.frequency.setTargetAtTime(freq, now, 0.06);
    this.engB.frequency.setTargetAtTime(freq * 0.5, now, 0.06);
    this.engFilter.frequency.setTargetAtTime(280 + rpm * 1100 + throttle * 500, now, 0.08);
    const on = active ? 1 : 0;
    this.engGain.gain.setTargetAtTime(on * (0.045 + rpm * 0.04 + throttle * 0.035), now, 0.1);
    this.windGain.gain.setTargetAtTime(on * speedFrac * speedFrac * 0.16, now, 0.2);
    this.scrapeGain.gain.setTargetAtTime(on * scrape * 0.22, now, 0.05);
  }

  bump(strength) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = Math.min(1, 0.25 + strength / 12);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * k, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 0.35);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6 * k, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(og).connect(this.master);
    o.start(now);
    o.stop(now + 0.3);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
