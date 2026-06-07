/*
 * modelReport.test.js — unit tests for the model-review aggregators.
 * Run: node analysis/modelReport.test.js
 *
 * Changelog
 * 2026-06-07  created — biasTable, coverageTally, replayTally
 */

const assert = require('node:assert');
const { biasTable, coverageTally, replayTally } = require('./modelReport');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// A candidate whose expected speed is a CONSTANT (single-band curve).
const cand = (server, expected, cp = {}) => ({
  server, city: 'X', runs: 30, medDownload: expected, medPing: 30, healthy: expected,
  anchored: cp.anchored !== false, checkAbove: cp.checkAbove ?? null, jumpAbove: cp.jumpAbove ?? null,
  curve: [{ lo: 0, hi: 100, mid: 50, n: 10, medDl: expected }],
});
const model = candidates => ({ params: { minGainMbps: 75, minGainPct: 30 }, candidates });

// --- biasTable ------------------------------------------------------------
test('biasTable: reports desktop vs NAS medians + per-load delta', () => {
  const bt = biasTable(model([cand('Cur', 300)]), model([cand('Cur', 200)]));
  assert.strictEqual(bt[0].medDesktop, 300);
  assert.strictEqual(bt[0].medNas, 200);
  assert.strictEqual(bt[0].atLoad[20].delta, 100); // desktop 300 - nas 200
});
test('biasTable: server missing from NAS model -> null nas/delta', () => {
  const bt = biasTable(model([cand('NewSrv', 300)]), model([cand('Other', 200)]));
  assert.strictEqual(bt[0].medNas, null);
  assert.strictEqual(bt[0].atLoad[50].delta, null);
});

// --- coverageTally --------------------------------------------------------
test('coverageTally: counts filled hour×band cells + hours seen, out of 96', () => {
  const dm = { candidates: [{ server: 'Cur', runs: 7, hourly: {
    '13': [{ lo: 0, hi: 30, mid: 15, n: 5, medDl: 400 }, { lo: 31, hi: 50, mid: 40, n: 0, medDl: null }],
    '2':  [{ lo: 71, hi: 100, mid: 85, n: 3, medDl: 150 }],
  } }] };
  const c = coverageTally(dm)[0];
  assert.strictEqual(c.filledCells, 2);   // hour13 band0 + hour2 band71 (the n=0 cell doesn't count)
  assert.strictEqual(c.hoursWithData, 2);
  assert.strictEqual(c.totalCells, 96);
});

// --- replayTally ----------------------------------------------------------
test('replayTally: re-scores recorded decisions under a model vs measured speeds', () => {
  const m = model([cand('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), cand('Alt', 300)]);
  const records = [
    // Cur@80 is past jump-point -> switch to Alt; measured (300>200) agrees -> correct
    { current: { server: 'Cur', load: 80, measured: 200 }, alternative: { server: 'Alt', load: 20, measured: 300 } },
    // current 'X' not in the model -> skipped
    { current: { server: 'X', load: 80, measured: 200 }, alternative: { server: 'Alt', load: 20, measured: 300 } },
    // alt unmeasured -> not scoreable (silently skipped, not counted)
    { current: { server: 'Cur', load: 80, measured: 200 }, alternative: { server: 'Alt', load: 20, measured: null } },
  ];
  const t = replayTally(records, m);
  assert.strictEqual(t.scored, 1);
  assert.strictEqual(t.correct, 1);
  assert.strictEqual(t.pct, 100);
  assert.strictEqual(t.skipped, 1); // the 'X' record
});

console.log(`\n${passed} tests passed`);
