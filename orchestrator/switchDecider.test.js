/*
 * switchDecider.test.js — pure-logic tests for the policy gate.
 * Run: node orchestrator/switchDecider.test.js
 *
 * No Docker, no config.js, no logger.js. decide() is pure + synchronous; we pass an
 * explicit `now` and last-switch state so there's no clock dependency. Each test
 * encodes WHY: the null-cap / 0-cooldown cases are the TESTING-phase defaults (guards
 * exist but are opt-in); the blocking cases prove the guards work once tightened.
 */

const assert = require('node:assert');
const { decide } = require('./switchDecider');

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

const SWITCH = { action: 'switch', to: 'Meleph' };
const STAY = { action: 'stay', to: null };
const NOW = 1_700_000_000_000; // fixed epoch ms

// ── nothing to act on ───────────────────────────────────────────────────────
// WHY: the gate must never invent a switch the advisor didn't recommend.
test('stay recommendation → never acts', () => {
  const r = decide({ recommendation: STAY, policy: { enabled: true }, now: NOW, lastSwitchTime: 0, switchesToday: 0 });
  assert.strictEqual(r.act, false);
  assert.strictEqual(r.wouldAct, false);
});

test('switch with no target → never acts', () => {
  const r = decide({ recommendation: { action: 'switch', to: null }, policy: { enabled: true }, now: NOW });
  assert.strictEqual(r.wouldAct, false);
  assert.strictEqual(r.act, false);
});

// ── the happy path (loose testing defaults) ─────────────────────────────────
// WHY: with the shipped defaults (no cap, short/elapsed cooldown) a clear switch acts.
test('clear switch, guards clear → acts', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, cooldownSec: 60, maxSwitchesPerDay: null }, now: NOW, lastSwitchTime: 0, switchesToday: 0 });
  assert.strictEqual(r.act, true);
  assert.strictEqual(r.wouldAct, true);
  assert.match(r.reason, /Meleph/);
});

// ── master switch + dry run ──────────────────────────────────────────────────
test('disabled → wouldAct true, act false', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: false }, now: NOW });
  assert.strictEqual(r.wouldAct, true);
  assert.strictEqual(r.act, false);
  assert.match(r.reason, /disabled/);
});

test('dryRun → wouldAct true, act false', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, dryRun: true }, now: NOW });
  assert.strictEqual(r.wouldAct, true);
  assert.strictEqual(r.act, false);
  assert.match(r.reason, /dryRun/);
});

// ── cooldown ──────────────────────────────────────────────────────────────────
// WHY: the primary go-live governor — don't yank a download more than once per N sec.
test('inside cooldown → blocked', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, cooldownSec: 1800 }, now: NOW, lastSwitchTime: NOW - 600_000, switchesToday: 0 });
  assert.strictEqual(r.act, false);
  assert.match(r.reason, /cooldown: \d+s left/);
});

test('cooldown elapsed → acts', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, cooldownSec: 1800 }, now: NOW, lastSwitchTime: NOW - 1_801_000, switchesToday: 0 });
  assert.strictEqual(r.act, true);
});

test('cooldownSec 0 → never blocked on time (testing default)', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, cooldownSec: 0 }, now: NOW, lastSwitchTime: NOW - 1, switchesToday: 999 });
  assert.strictEqual(r.act, true);
});

// ── daily cap ─────────────────────────────────────────────────────────────────
test('daily cap reached → blocked', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, maxSwitchesPerDay: 6 }, now: NOW, lastSwitchTime: 0, switchesToday: 6 });
  assert.strictEqual(r.act, false);
  assert.match(r.reason, /daily cap 6 reached/);
});

test('null cap → unlimited, never blocked on count (testing default)', () => {
  const r = decide({ recommendation: SWITCH, policy: { enabled: true, maxSwitchesPerDay: null }, now: NOW, lastSwitchTime: 0, switchesToday: 9999 });
  assert.strictEqual(r.act, true);
});

// ── fail-safe ─────────────────────────────────────────────────────────────────
// WHY: malformed input must never trigger an unintended switch.
test('empty args → fail-safe act false, does not throw', () => {
  const r = decide();
  assert.strictEqual(r.act, false);
  assert.strictEqual(r.wouldAct, false);
});

console.log(`\nswitchDecider.test.js — ${passed} tests passed`);
