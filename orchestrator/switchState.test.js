/*
 * switchState.test.js — pure tests for the auto-switch daily-count reset.
 * Run: node orchestrator/switchState.test.js
 *
 * No Docker, no config.js, no clock: `today` is passed in explicitly. Each test
 * encodes WHY — the day-reset + cooldown-carryover is the runner logic that's
 * otherwise only exercised by the live desktop tick (same class of bug the
 * validation loop hit with overnight rotation).
 */

const assert = require('node:assert');
const { resolveState } = require('./switchState');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const TODAY = '20260607';
const YESTERDAY = '20260606';

// ── same day ────────────────────────────────────────────────────────────────
// WHY: within a day the count must accumulate so maxSwitchesPerDay can ever trip.
test('same day → count is preserved', () => {
  const s = resolveState({ lastSwitchTime: 111, day: TODAY, count: 3 }, TODAY);
  assert.deepStrictEqual(s, { lastSwitchTime: 111, day: TODAY, count: 3 });
});

// ── new day ───────────────────────────────────────────────────────────────────
// WHY: the cap is per-day; a new EST day must zero the count.
test('new day → count resets to 0', () => {
  const s = resolveState({ lastSwitchTime: 111, day: YESTERDAY, count: 9 }, TODAY);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.day, TODAY);
});

// WHY: cooldown must span midnight — a switch at 23:59 still blocks one at 00:01,
// so lastSwitchTime carries across the day boundary even as count resets.
test('new day → lastSwitchTime carries over (cooldown spans midnight)', () => {
  const s = resolveState({ lastSwitchTime: 999, day: YESTERDAY, count: 9 }, TODAY);
  assert.strictEqual(s.lastSwitchTime, 999);
  assert.strictEqual(s.count, 0);
});

// ── missing / corrupt input ─────────────────────────────────────────────────
// WHY: first run (no file) and a corrupt file must both degrade cleanly, never throw,
// and never invent a lastSwitchTime that would wrongly trigger/suppress a cooldown.
test('null raw (no state file yet) → clean defaults for today', () => {
  const s = resolveState(null, TODAY);
  assert.deepStrictEqual(s, { lastSwitchTime: 0, day: TODAY, count: 0 });
});

test('non-object raw → clean defaults, does not throw', () => {
  assert.deepStrictEqual(resolveState('garbage', TODAY), { lastSwitchTime: 0, day: TODAY, count: 0 });
  assert.deepStrictEqual(resolveState(42, TODAY), { lastSwitchTime: 0, day: TODAY, count: 0 });
});

test('partial raw (missing count) → count defaults to 0', () => {
  const s = resolveState({ lastSwitchTime: 5, day: TODAY }, TODAY);
  assert.deepStrictEqual(s, { lastSwitchTime: 5, day: TODAY, count: 0 });
});

console.log(`\nswitchState.test.js — ${passed} tests passed`);
