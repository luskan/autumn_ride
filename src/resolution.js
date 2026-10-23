// Adaptive render resolution. Frame time is capped by vsync, so "fast" means hitting the
// refresh rate. Only a slowdown lasting two measuring windows (~3 s) lowers the pixel ratio,
// so a one-off hiccup (loading, rotation, system bars) does not; a level that proved too slow
// is retried after ~10 s of smooth play, and the ratio never drops below `floor`.
export const FAST_MS = 17.8;
export const SLOW_MS = 20;
const STEP = 0.25;
const SLOW_WINDOWS = 2;
const FAST_WINDOWS_TO_RETRY = 7;

export class ResolutionGovernor {
  constructor({ max, floor, start = Math.min(1, max) }) {
    this.max = max;
    this.floor = Math.min(floor, max);
    this.ratio = start;
    this.ceiling = max;
    this.fast = 0;
    this.slow = 0;
    this.cooldown = 3; // seconds before the first decision
  }

  // ms: average frame time over the last window of `seconds`; returns the pixel ratio to use
  update(ms, seconds) {
    this.cooldown -= seconds;
    if (this.cooldown > 0) return this.ratio;
    this.fast = ms < FAST_MS ? this.fast + 1 : 0;
    this.slow = ms > SLOW_MS ? this.slow + 1 : 0;
    if (this.fast >= FAST_WINDOWS_TO_RETRY && this.ceiling < this.max) {
      this.ceiling = Math.min(this.max, this.ceiling + STEP);
      this.fast = 0;
    }
    let next = this.ratio;
    if (this.slow >= SLOW_WINDOWS && this.ratio > this.floor) {
      next = Math.max(this.floor, this.ratio - STEP);
      this.ceiling = next;
      this.slow = 0;
    } else if (ms < FAST_MS && this.ratio < this.ceiling) {
      next = Math.min(this.ceiling, this.ratio + STEP);
    }
    if (next !== this.ratio) {
      this.ratio = next;
      this.cooldown = 4; // let the new resolution settle before judging it
    }
    return this.ratio;
  }
}
