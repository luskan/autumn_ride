// Unit tests for the encoded author credits (no browser needed): node tests/credits.test.mjs
// Also guards that the name and the e-mail address never land in a file as plain text.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { encode, decode, getCredits } from '../src/credits.js';

const { name, mail } = getCredits();
// the name without diacritics counts as plain text too
const variants = [name, name.normalize('NFD').replace(/\p{M}/gu, ''), mail];

const cases = {
  'encoding round-trips any text, Polish letters included'() {
    for (const text of ['Zażółć gęślą jaźń', 'a', 'x@y.pl', '']) assert.equal(decode(encode(text)), text);
  },
  'encoded bytes differ from the plain UTF-8 bytes'() {
    const plain = [...new TextEncoder().encode('marcin')];
    assert.ok(encode('marcin').every((b, i) => b !== plain[i]));
  },
  'credits decode to a full name and an e-mail address'() {
    assert.ok(name.trim().split(/\s+/).length >= 2, 'first name and surname');
    assert.match(mail, /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/);
  },
  'no project file holds the credits as plain text'() {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\n').filter((f) => f && existsSync(f));
    if (existsSync('dist/index.html')) files.push('dist/index.html');
    const leaks = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return variants.some((v) => text.includes(v));
    });
    assert.deepEqual(leaks, []);
  },
};

let failed = 0;
for (const [title, fn] of Object.entries(cases)) {
  try {
    fn();
    console.log(`PASS  ${title}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${title}  - ${e.message}`);
  }
}
console.log(`\n${Object.keys(cases).length - failed}/${Object.keys(cases).length} credits checks passed`);
process.exit(failed ? 1 : 0);
