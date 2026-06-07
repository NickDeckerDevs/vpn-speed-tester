/*
 * validationReport.test.js — unit tests for the dashboard aggregator.
 * Run: node analysis/validationReport.test.js
 *
 * Changelog
 * 2026-06-07  created — summarizeLog tests
 */

const assert = require('node:assert');
const { summarizeLog } = require('./validationReport');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// Minimal record shape the aggregator reads.
function rec(over = {}) {
  return {
    at: over.at || '2026-06-07T00:00:00Z',
    zone: over.zone || 'stay',
    action: over.action || 'stay',
    current: { server: over.cur || 'Volans', load: 30, predicted: 300, measured: over.curMeas ?? 280 },
    alternative: over.alt ? { server: over.alt, load: 40, predicted: 320, measured: 340 } : null,
    scoring: {
      currentPredictionError: over.predErr ?? -20,
      altPredictionError: 20,
      measuredGap: over.gap ?? 60,
      decisionCorrect: over.correct ?? false,
    },
  };
}

test('summarizeLog: overall correct% counts only scored records', () => {
  const recs = [rec({ correct: true }), rec({ correct: false }), { scoring: { decisionCorrect: null } }];
  const s = summarizeLog(recs);
  assert.strictEqual(s.passes, 3);
  assert.strictEqual(s.scored, 2);     // the null-scored one excluded
  assert.strictEqual(s.correct, 1);
  assert.strictEqual(s.correctPct, 50);
});

test('summarizeLog: breaks down by action and zone', () => {
  const recs = [
    rec({ action: 'stay', zone: 'stay', correct: false }),
    rec({ action: 'stay', zone: 'stay', correct: false }),
    rec({ action: 'switch', zone: 'jump', correct: true }),
  ];
  const s = summarizeLog(recs);
  assert.strictEqual(s.byAction.stay.n, 2);
  assert.strictEqual(s.byAction.stay.correctPct, 0);
  assert.strictEqual(s.byAction.switch.correctPct, 100);
  assert.strictEqual(s.byZone.jump.n, 1);
});

test('summarizeLog: per-current-server tally + median prediction error', () => {
  const recs = [
    rec({ cur: 'Volans', predErr: -60, correct: false }),
    rec({ cur: 'Volans', predErr: -40, correct: false }),
    rec({ cur: 'Leo', predErr: 10, correct: true }),
  ];
  const s = summarizeLog(recs);
  assert.strictEqual(s.byCurrentServer.Volans.n, 2);
  assert.strictEqual(s.byCurrentServer.Volans.medPredErr, -50); // median(-60,-40)
  assert.strictEqual(s.byCurrentServer.Leo.correctPct, 100);
});

test('summarizeLog: coverage counts current + alt across ALL records', () => {
  const recs = [rec({ cur: 'Volans', alt: 'Meleph' }), rec({ cur: 'Volans', alt: 'Ascella' })];
  const s = summarizeLog(recs);
  assert.strictEqual(s.coverageCurrent.Volans, 2);
  assert.strictEqual(s.coverageAlt.Meleph, 1);
  assert.strictEqual(s.coverageAlt.Ascella, 1);
});

test('summarizeLog: recent window reflects only the last N scored', () => {
  const recs = [rec({ correct: false }), rec({ correct: false }), rec({ correct: true })];
  const s = summarizeLog(recs, 1); // window = last 1 scored (the correct one)
  assert.strictEqual(s.recent.window, 1);
  assert.strictEqual(s.recent.correctPct, 100);
});

console.log(`\n${passed} tests passed`);
