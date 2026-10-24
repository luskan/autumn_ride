import { ROAD, PLAYER, KMH } from './config.js';
import { clamp } from './util.js';
import { BRAKE_DECEL, engineAccel, resistance, maxYaw, DRIFT } from './player.js';

export const AUTO_MIN = 30 / KMH;
export const AUTO_MAX = 150 / KMH;

const LANE = ROAD.laneCenter;
const L = PLAYER.length;
const HALF_W = PLAYER.width / 2;
const MAX_LAT = 2.6; // m/s, lateral speed of a lane change
const CONVOY_GAP = 24; // cars closer than this are overtaken together
const MERGE_MARGIN = 7; // m of clearance in front of the overtaken car before merging back

// Cruise control + lane keeping + overtaking. Produces analog input for Player.update.
// States: lane (keep right, follow slower cars), passing (in the left lane),
// returning (merging back right), abort (overtake cancelled, drop back and merge).
export class Autopilot {
  constructor(track, traffic, roadRules) {
    this.track = track;
    this.traffic = traffic;
    this.roadRules = roadRules;
    this.active = false;
    this.setSpeed = AUTO_MIN;
    this.state = 'lane';
    this.passEnd = null;
    this.rush = false;
    this.evasive = false;
    this.cooldown = 0;
    this.out = { throttle: 0, brake: 0, steer: 0 };
    this.right = [];
  }

  engage(player, speed = player.v) {
    this.active = true;
    this.setSpeed = clamp(speed, AUTO_MIN, AUTO_MAX);
    this.state = player.d < 0.5 ? 'abort' : 'lane';
    this.passEnd = null;
    this.cooldown = 1;
  }

  disengage() {
    this.active = false;
  }

  adjust(delta) {
    this.setSpeed = clamp(this.setSpeed + delta, AUTO_MIN, AUTO_MAX);
  }

  // no same-direction car in the right lane around the player
  rightLaneFree(behind = 6) {
    for (const c of this.right) {
      const span = (c.len + L) / 2;
      if (c.rel > -span - behind && c.rel < span + 12) return false;
    }
    return true;
  }

  // seconds until the nearest oncoming car in the left lane reaches the player
  oncomingTime(v) {
    let t = Infinity;
    for (const c of this.traffic.cars) {
      if (c.dir > 0 || c.d > 0.6) continue;
      const span = (c.len + L) / 2;
      if (c.rel < -span) continue;
      t = Math.min(t, (c.rel - span - 5) / Math.max(v + c.v, 1));
    }
    return t;
  }

  // will the oncoming lane stay free for T seconds while the player covers D meters?
  oncomingClear(T, D, buffer) {
    for (const c of this.traffic.cars) {
      if (c.dir > 0 || c.d > 0.6) continue;
      const span = (c.len + L) / 2;
      if (c.rel < -span) continue;
      if (c.rel - span - c.v * (T + buffer) - D - 12 < 0) return false;
    }
    return true;
  }

  // relative distance to gain and the time it takes to get past `end`
  passPlan(end, v, dv) {
    const gain = end.rel + (end.len + L) / 2 + MERGE_MARGIN;
    const T = Math.max(gain, 0) / Math.max(dv, 0.5) + 2.5;
    return { T, D: v * T };
  }

  // evasive: braking is no longer enough, so swerve even without the usual pull-out room
  canPass(lead, v, evasive = false, s) {
    // room to pull out without clipping the lead while closing in on it
    if (!evasive && lead.rel - (lead.len + L) / 2 < Math.max(0, v - lead.v) * 1.2 + 4) return null;
    // the whole column of closely spaced cars has to be passed at once
    let end = lead;
    let convoyV = lead.v;
    for (const c of this.right) {
      if (c.rel <= end.rel) continue;
      if (c.rel - end.rel - (c.len + end.len) / 2 > CONVOY_GAP) break;
      end = c;
      convoyV = Math.min(convoyV, c.v);
    }
    const dv = this.setSpeed - convoyV;
    if (dv < (evasive ? 0.5 : 2.5)) return null;
    const { T, D } = this.passPlan(end, Math.max(v, this.setSpeed), dv);
    if (T > 16) return null;
    // Reserve room for acceleration and the complete return, including the car's
    // front bumper. Even an evasive overtake may not start across a solid line.
    const reserve = Math.max(v, this.setSpeed) * 3 + L + Math.max(0, this.setSpeed - v) * 3;
    if (this.roadRules && !this.roadRules.canCompletePass(s, D + reserve)) return null;
    // somebody else already in the left lane ahead
    for (const c of this.traffic.cars) {
      if (c.dir > 0 && c.d < 0 && c.rel > -5 && c.rel < D) return null;
    }
    return this.oncomingClear(T, D, evasive ? 1 : 2.5) ? end : null;
  }

  update(dt, player) {
    const tr = this.track;
    const cars = this.traffic.cars;
    const v = player.v;
    this.cooldown = Math.max(0, this.cooldown - dt);

    this.right.length = 0;
    for (const c of cars) {
      c.rel = tr.delta(player.s, c.s);
      if (c.dir > 0 && Math.abs(c.d - LANE) < 1.4) this.right.push(c);
    }
    this.right.sort((a, b) => a.rel - b.rel);
    let lead = null;
    for (const c of this.right) {
      if (c.rel > 0) {
        lead = c;
        break;
      }
    }

    let targetV = this.setSpeed;
    let targetD = LANE;

    if (this.state === 'lane' && lead) {
      const gap = lead.rel - (lead.len + L) / 2;
      const closing = v - lead.v;
      const evasive = closing > 0 && gap < (closing * closing) / (2 * 9) + 3;
      // pull out from a natural following distance, earlier when going faster
      if (gap < 20 + v * 1.3 && (this.cooldown <= 0 || evasive)) {
        const end = this.canPass(lead, v, evasive, player.s);
        if (end) {
          this.state = 'passing';
          this.passEnd = end;
          this.rush = false;
          this.evasive = evasive;
        }
      }
    }
    if (this.state === 'passing') {
      targetD = -LANE;
      const end = this.passEnd;
      const margin = this.rush ? 2 : MERGE_MARGIN;
      if (end.rel < -((end.len + L) / 2 + margin)) {
        if (this.rightLaneFree(this.rush ? 1 : 6)) this.state = 'returning';
      } else if (!this.rush) {
        // keep checking: traffic may have changed since the decision
        const { T, D } = this.passPlan(end, Math.max(v, this.setSpeed), this.setSpeed - end.v);
        const roadClear = !this.roadRules || this.roadRules.canCompletePass(player.s, D + Math.max(v, this.setSpeed) * 3 + L);
        if (!roadClear) this.state = 'abort';
        else if (!this.oncomingClear(T, D, 0.5)) {
          // finish with a short merge gap if that beats the oncoming car, otherwise drop back
          const rem = end.rel + (end.len + L) / 2 + 2;
          const finish = rem / Math.max(v - end.v, 0.5) + 1.2;
          if (finish < this.oncomingTime(v) - 1) this.rush = true;
          else this.state = 'abort';
        }
      }
    }
    if (this.state === 'returning') {
      if (Math.abs(player.d - LANE) < 0.3) {
        this.state = 'lane';
        this.cooldown = 1;
      }
    }
    if (this.state === 'abort') {
      // drop back behind the cars next to us, merge right once there is room
      const free = this.rightLaneFree();
      targetD = free ? LANE : -LANE;
      if (!free) {
        for (const c of this.right) {
          if (c.rel > -((c.len + L) / 2) - 6 && c.rel < 40) targetV = Math.min(targetV, c.v - 3);
        }
      }
      if (player.d > LANE - 0.4) {
        this.state = 'lane';
        this.cooldown = 4;
      }
    }
    if (this.state === 'passing') targetD = -LANE;

    // adaptive cruise: everything ahead in the lane we are in or moving to
    // (an evasive swerve keeps braking for the car ahead until it is clear of it)
    if (this.evasive && player.d < LANE - 1.2) this.evasive = false;
    const moving = (this.state === 'passing' && !this.evasive) || this.state === 'returning';
    const lo = (moving ? targetD : Math.min(player.d, targetD)) - HALF_W - 0.25;
    const hi = (moving ? targetD : Math.max(player.d, targetD)) + HALF_W + 0.25;
    for (const c of cars) {
      if (c.rel <= 0 || c.rel > 160) continue;
      if (c.d + c.halfW < lo || c.d - c.halfW > hi) continue;
      const gap = c.rel - (c.len + L) / 2;
      if (c.dir > 0) {
        const want = 5 + 1.2 * v;
        targetV = Math.min(targetV, gap < 2 ? 0 : c.v + (gap - want) * 0.4);
      } else if (gap / Math.max(v + c.v, 1) < 1.6) {
        // emergency only: regular oncoming traffic is handled by the overtaking plan
        targetV = Math.min(targetV, gap < 15 ? 0 : v - 3);
        if (this.state === 'passing') this.state = 'abort';
      }
    }
    targetV = Math.max(0, targetV);

    // speed: required acceleration -> throttle or brake
    const slope = tr.ty[tr.index(player.s)];
    const need = clamp((targetV - v) * 1.2, -BRAKE_DECEL, 6) + resistance(v, slope);
    const out = this.out;
    if (need >= 0) {
      out.throttle = clamp(need / engineAccel(v), 0, 1);
      out.brake = 0;
    } else {
      out.throttle = 0;
      out.brake = need < -0.3 ? clamp(-need / BRAKE_DECEL, 0, 1) : 0;
    }

    // steering: lateral speed towards the target lane, compensating the bend's drift
    const latWanted = clamp((targetD - player.d) * 1.1, -MAX_LAT, MAX_LAT);
    const drift = tr.kappaAt(player.s) * v * v * DRIFT;
    const yawMaxNow = maxYaw(v);
    if (v < 0.5 || yawMaxNow < 1e-3) out.steer = 0;
    else out.steer = clamp(Math.asin(clamp((latWanted + drift) / v, -0.6, 0.6)) / yawMaxNow, -1, 1);
    this.targetD = targetD;
    this.targetV = targetV;
    return out;
  }
}
