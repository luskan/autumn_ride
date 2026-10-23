// Unit tests for the adaptive resolution policy (no browser needed): node tests/resolution.test.mjs
import assert from 'node:assert/strict';
import { ResolutionGovernor } from '../src/resolution.js';

const FAST = 16.7; // 60 fps
const SLOW = 33; // 30 fps
const WINDOW = 1.5; // seconds per measuring window, as in the game loop

// feeds a list of window averages, returns the pixel ratio after each window
const run = (gov, windows) => windows.map((ms) => gov.update(ms, WINDOW));
const repeat = (ms, n) => Array(n).fill(ms);

const cases = {
  'warms up from 1.0 to the maximum on a fast device'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 1, start: 1 });
    const r = run(g, repeat(FAST, 10));
    assert.equal(r.at(-1), 1.5);
    assert.ok(r.every((v, i) => i === 0 || v >= r[i - 1]), 'never goes down while fast');
  },
  'a single slow window does not lower the resolution'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 0.75, start: 1.5 });
    run(g, repeat(FAST, 3));
    const r = run(g, [SLOW, FAST, FAST, SLOW, FAST]);
    assert.ok(r.every((v) => v === 1.5), `stayed at 1.5, got ${r}`);
  },
  'two slow windows in a row lower it by one step'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 0.75, start: 1.5 });
    run(g, repeat(FAST, 3));
    const r = run(g, [SLOW, SLOW]);
    assert.equal(r.at(-1), 1.25);
  },
  'a phone never goes below its floor of 1.0'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 1, start: 1.5 });
    const r = run(g, repeat(SLOW, 40));
    assert.equal(Math.min(...r), 1);
  },
  'a desktop under sustained load goes down to 0.75 and stops there'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 0.75, start: 1.5 });
    const r = run(g, repeat(SLOW, 40));
    assert.equal(r.at(-1), 0.75);
    assert.equal(Math.min(...r), 0.75);
  },
  'after the load is gone a step is retried within ~10 s'() {
    const g = new ResolutionGovernor({ max: 1.5, floor: 1, start: 1.5 });
    run(g, repeat(SLOW, 20)); // down at the 1.0 floor
    assert.equal(g.ratio, 1);
    const r = run(g, repeat(FAST, 8)); // 8 windows = 12 s
    assert.equal(r.at(-1), 1.25);
    const more = run(g, repeat(FAST, 8));
    assert.equal(more.at(-1), 1.5, 'and the next step another ~10 s later');
  },
  'the floor never exceeds the maximum'() {
    const g = new ResolutionGovernor({ max: 0.8, floor: 1, start: 0.8 });
    assert.equal(Math.min(...run(g, repeat(SLOW, 10))), 0.8);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}  - ${e.message}`);
  }
}
console.log(`\n${Object.keys(cases).length - failed}/${Object.keys(cases).length} resolution checks passed`);
process.exit(failed ? 1 : 0);
