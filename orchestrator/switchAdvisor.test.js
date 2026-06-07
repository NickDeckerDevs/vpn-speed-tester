/*
 * switchAdvisor.test.js — unit tests for the stay-vs-switch brain.
 * Plain node:assert. Run: node orchestrator/switchAdvisor.test.js
 *
 * Changelog
 * 2026-06-06  created — Step 4 tests: expectedBandwidth curve interpolation
 * 2026-06-06  Step 5 tests: recommend() three zones + fail-safes
 */

const assert = require('node:assert');
const { expectedBandwidth, recommend } = require('./switchAdvisor');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// A curve like buildModel produces: mids 15 / 40.5 / 60.5 / 85.5.
const band = (lo, hi, n, medDl) => ({ lo, hi, mid: (lo + hi) / 2, n, medDl });
const fullCurve = [band(0, 30, 9, 400), band(31, 50, 15, 350), band(51, 70, 12, 280), band(71, 100, 24, 150)];
const entry = { medDownload: 300, curve: fullCurve };

// --- expectedBandwidth ----------------------------------------------------
test('expectedBandwidth: returns the band median at a band midpoint', () => {
  assert.strictEqual(expectedBandwidth(entry, 15), 400);
  assert.strictEqual(expectedBandwidth(entry, 85.5), 150);
});
test('expectedBandwidth: interpolates linearly between two bands', () => {
  // halfway between mid 15 (400) and mid 40.5 (350) => 375
  assert.strictEqual(expectedBandwidth(entry, (15 + 40.5) / 2), 375);
});
test('expectedBandwidth: clamps below the first sampled band (no upward extrapolation)', () => {
  assert.strictEqual(expectedBandwidth(entry, 0), 400);
  assert.strictEqual(expectedBandwidth(entry, 5), 400);
});
test('expectedBandwidth: clamps above the last sampled band', () => {
  assert.strictEqual(expectedBandwidth(entry, 100), 150);
});
test('expectedBandwidth: skips empty bands and interpolates across the gap', () => {
  // 31-50 band is empty -> interpolate between mid 15 (400) and mid 60.5 (280)
  const gapped = { medDownload: 300, curve: [band(0, 30, 9, 400), band(31, 50, 0, null), band(51, 70, 12, 280), band(71, 100, 6, 150)] };
  const y = expectedBandwidth(gapped, 40); // between x=15,y=400 and x=60.5,y=280
  const expify = 400 + (280 - 400) * (40 - 15) / (60.5 - 15);
  assert.ok(Math.abs(y - expify) < 1e-9, `got ${y}, expected ${expify}`);
});
test('expectedBandwidth: single populated band returns that value for any load', () => {
  const one = { medDownload: 300, curve: [band(71, 100, 24, 222)] };
  assert.strictEqual(expectedBandwidth(one, 5), 222);
  assert.strictEqual(expectedBandwidth(one, 95), 222);
});
test('expectedBandwidth: no populated bands falls back to overall median', () => {
  const none = { medDownload: 300, curve: [band(0, 30, 0, null)] };
  assert.strictEqual(expectedBandwidth(none, 50), 300);
});

// --- expectedBandwidth: hour-aware (v2) ------------------------------------
const hourEntry = {
  medDownload: 300,
  curve: fullCurve, // load-only: 400 @ load 15
  hourly: {
    13: [band(0, 30, 5, 500), band(31, 50, 5, 480), band(51, 70, 0, null), band(71, 100, 0, null)],
  },
};
test('expectedBandwidth: uses the per-hour curve when that hour is populated', () => {
  assert.strictEqual(expectedBandwidth(hourEntry, 15, 13), 500); // hour 13 cell, not the load-only 400
});
test('expectedBandwidth: falls back to load-only curve when the hour is absent', () => {
  assert.strictEqual(expectedBandwidth(hourEntry, 15, 2), 400);  // no hour-2 data -> load-only
});
test('expectedBandwidth: falls back when the hour exists but that load band is empty', () => {
  // hour 13 has no 71-100 cell -> use the load-only curve (same as omitting the hour)
  assert.strictEqual(expectedBandwidth(hourEntry, 85, 13), expectedBandwidth(hourEntry, 85));
});
test('expectedBandwidth: omitting hour keeps the original load-only behavior', () => {
  assert.strictEqual(expectedBandwidth(hourEntry, 15), 400);
});

// --- recommend() ----------------------------------------------------------
// A candidate whose expected speed is a CONSTANT (single-band curve), so each
// test controls zone (via cut-points + live load) and expected speed separately.
function E(server, expected, cp = {}) {
  return {
    server, city: 'X', runs: 30, medDownload: expected, medPing: 30, healthy: expected,
    anchored: cp.anchored !== false,
    checkAbove: cp.checkAbove ?? null,
    jumpAbove: cp.jumpAbove ?? null,
    curve: [{ lo: 0, hi: 100, mid: 50, n: 10, medDl: expected }],
  };
}
const live = pairs => Object.entries(pairs).map(([public_name, currentload]) => ({ public_name, currentload, health: 'ok' }));
const model = candidates => ({ params: { minGainMbps: 75, minGainPct: 30 }, candidates });

test('recommend: below check-point -> STAY, but still reports a best alternative', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 350)]);
  const r = recommend('Cur', live({ Cur: 20, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay');
  assert.strictEqual(r.zone, 'stay');
  assert.strictEqual(r.to, null);
  assert.strictEqual(r.bestAlternative.server, 'Alt');
});

test('recommend: check-zone with a clearly-better alt -> SWITCH', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 350)]);
  const r = recommend('Cur', live({ Cur: 60, Alt: 20 }), m);
  assert.strictEqual(r.action, 'switch');
  assert.strictEqual(r.to, 'Alt');
  assert.strictEqual(r.zone, 'check');
  assert.strictEqual(r.gainMbps, 150);
});

test('recommend: check-zone alt fails the +Mbps margin -> STAY', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 260)]);
  const r = recommend('Cur', live({ Cur: 60, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay'); // +60 Mbps < 75
  assert.strictEqual(r.zone, 'check');
});

test('recommend: check-zone alt clears +Mbps but fails +% -> STAY', () => {
  const m = model([E('Cur', 300, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 380)]);
  const r = recommend('Cur', live({ Cur: 60, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay'); // +80 Mbps >= 75 but +26.7% < 30
  assert.strictEqual(r.zone, 'check');
});

test('recommend: jump-zone with any better alt -> SWITCH (ignores margins)', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 210)]);
  const r = recommend('Cur', live({ Cur: 80, Alt: 20 }), m);
  assert.strictEqual(r.action, 'switch'); // only +10 Mbps, but we're past jump-point
  assert.strictEqual(r.to, 'Alt');
  assert.strictEqual(r.zone, 'jump');
});

test('recommend: jump-zone but nothing better -> STAY (everything saturated)', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 150)]);
  const r = recommend('Cur', live({ Cur: 80, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay');
  assert.strictEqual(r.zone, 'jump');
});

test('recommend: current server not in model -> SWITCH to a known-good candidate', () => {
  const m = model([E('Alt', 300)]);
  const r = recommend('Unknown', live({ Unknown: 90, Alt: 20 }), m);
  assert.strictEqual(r.action, 'switch');
  assert.strictEqual(r.to, 'Alt');
  assert.strictEqual(r.zone, 'unknown-current');
});

test('recommend: no live data -> STAY (fail-safe)', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 })]);
  const r = recommend('Cur', [], m);
  assert.strictEqual(r.action, 'stay');
  assert.strictEqual(r.zone, 'no-live-data');
});

test('recommend: an unhealthy alternative is excluded from the choices', () => {
  const m = model([E('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), E('Alt', 350)]);
  const servers = [
    { public_name: 'Cur', currentload: 60, health: 'ok' },
    { public_name: 'Alt', currentload: 20, health: 'maintenance' }, // not ok -> dropped
  ];
  const r = recommend('Cur', servers, m);
  assert.strictEqual(r.bestAlternative, null);
  assert.strictEqual(r.action, 'stay'); // check-zone but no viable alternative
});

test('recommend: a server the data shows never slips STAYS even when busy', () => {
  const m = model([E('Cur', 280, { checkAbove: null, jumpAbove: null }), E('Alt', 300)]);
  const r = recommend('Cur', live({ Cur: 90, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay');
  assert.strictEqual(r.zone, 'stay');
});

test('recommend: unanchored current (untrusted curve) -> STAY (fail-safe)', () => {
  const m = model([E('Cur', 200, { anchored: false }), E('Alt', 350)]);
  const r = recommend('Cur', live({ Cur: 90, Alt: 20 }), m);
  assert.strictEqual(r.action, 'stay');
  assert.strictEqual(r.zone, 'unanchored');
});

console.log(`\n${passed} tests passed`);
