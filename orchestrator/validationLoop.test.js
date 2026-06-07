/*
 * validationLoop.test.js — unit tests for the validation-record scoring.
 * Plain node:assert. Run: node orchestrator/validationLoop.test.js
 *
 * Changelog
 * 2026-06-06  created — P2-1 tests: buildValidationRecord
 * 2026-06-06  P2-2 tests: nextCurrent + state persistence
 * 2026-06-06  P2-3 tests: runValidationOnce orchestration (mocked switch/speedtest)
 */

const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildValidationRecord, nextCurrent, nextLoopState, loadState, saveState, runValidationOnce } = require('./validationLoop');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }

// A recommend()-shaped decision (only the fields the record reads).
function decision(over = {}) {
  return {
    action: 'switch', from: 'Cur', to: 'Alt', zone: 'jump',
    currentLoad: 80, expectedCurrent: 228,
    bestAlternative: { server: 'Alt', load: 43, expected: 296 },
    ...over,
  };
}

test('record carries through the decision context (servers, loads, predictions)', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision(), currentMeasured: [220, 240], altMeasured: [300, 310] });
  assert.strictEqual(rec.current.server, 'Cur');
  assert.strictEqual(rec.current.load, 80);
  assert.strictEqual(rec.current.predicted, 228);
  assert.strictEqual(rec.alternative.server, 'Alt');
  assert.strictEqual(rec.alternative.predicted, 296);
});

test('measured is the median of the runs on each server', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision(), currentMeasured: [220, 240], altMeasured: [300, 320] });
  assert.strictEqual(rec.current.measured, 230);     // median(220,240)
  assert.strictEqual(rec.alternative.measured, 310);  // median(300,320)
});

test('prediction error = measured - predicted, per server', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision(), currentMeasured: [200, 200], altMeasured: [350, 350] });
  assert.strictEqual(rec.scoring.currentPredictionError, 200 - 228); // -28
  assert.strictEqual(rec.scoring.altPredictionError, 350 - 296);     // +54
});

test('SWITCH is correct when the alternative was actually faster', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision({ action: 'switch' }), currentMeasured: [200], altMeasured: [300] });
  assert.strictEqual(rec.scoring.measuredGap, 100);
  assert.strictEqual(rec.scoring.decisionCorrect, true);
});

test('SWITCH is wrong when the alternative was actually slower', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision({ action: 'switch' }), currentMeasured: [300], altMeasured: [200] });
  assert.strictEqual(rec.scoring.measuredGap, -100);
  assert.strictEqual(rec.scoring.decisionCorrect, false);
});

test('STAY is correct when we did NOT miss a faster server', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision({ action: 'stay' }), currentMeasured: [300], altMeasured: [250] });
  assert.strictEqual(rec.scoring.decisionCorrect, true); // gap -50 <= 0
});

test('STAY is wrong when a faster server was available', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision({ action: 'stay' }), currentMeasured: [250], altMeasured: [300] });
  assert.strictEqual(rec.scoring.decisionCorrect, false); // gap +50 > 0
});

test('no alternative -> alternative null, gap + correctness null', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision({ action: 'stay', bestAlternative: null }), currentMeasured: [250] });
  assert.strictEqual(rec.alternative, null);
  assert.strictEqual(rec.scoring.measuredGap, null);
  assert.strictEqual(rec.scoring.decisionCorrect, null);
});

test('a failed speed test (no runs) degrades to null, never throws', () => {
  const rec = buildValidationRecord({ at: 'T', decision: decision(), currentMeasured: [], altMeasured: [300] });
  assert.strictEqual(rec.current.measured, null);
  assert.strictEqual(rec.scoring.measuredGap, null);
  assert.strictEqual(rec.scoring.decisionCorrect, null);
});

// --- nextCurrent ----------------------------------------------------------
test('nextCurrent: a SWITCH adopts the new server next run', () => {
  assert.strictEqual(nextCurrent({ action: 'switch', from: 'Cur', to: 'Alt' }), 'Alt');
});
test('nextCurrent: a STAY keeps the current server', () => {
  assert.strictEqual(nextCurrent({ action: 'stay', from: 'Cur', to: null }), 'Cur');
});
test('nextCurrent: first run with no current stays null', () => {
  assert.strictEqual(nextCurrent({ action: 'stay', from: null, to: null }), null);
});

// --- nextLoopState (coverage rotation) ------------------------------------
const TOP = ['Leo', 'Aladfar', 'Meleph', 'Volans', 'Ascella', 'Scutum', 'Polis', 'Giausar', 'Helvetios', 'Chertan'];

test('nextLoopState: a SWITCH follows the advisor and syncs the cursor', () => {
  const s = nextLoopState({ action: 'switch', from: 'Leo', to: 'Volans' }, { current: 'Leo', staysOnCurrent: 1, cursorIndex: 0 }, TOP);
  assert.deepStrictEqual(s, { current: 'Volans', staysOnCurrent: 0, cursorIndex: 3 });
});
test('nextLoopState: one STAY holds the current server and counts it', () => {
  const s = nextLoopState({ action: 'stay', from: 'Volans' }, { current: 'Volans', staysOnCurrent: 0, cursorIndex: 3 }, TOP);
  assert.deepStrictEqual(s, { current: 'Volans', staysOnCurrent: 1, cursorIndex: 3 });
});
test('nextLoopState: TWO stays in a row force-rotate to the next server in the list', () => {
  const s = nextLoopState({ action: 'stay', from: 'Volans' }, { current: 'Volans', staysOnCurrent: 1, cursorIndex: 3 }, TOP);
  assert.deepStrictEqual(s, { current: 'Ascella', staysOnCurrent: 0, cursorIndex: 4 }); // index 3 -> 4
});
test('nextLoopState: rotation wraps around at the end of the list', () => {
  const s = nextLoopState({ action: 'stay', from: 'Chertan' }, { current: 'Chertan', staysOnCurrent: 1, cursorIndex: 9 }, TOP);
  assert.deepStrictEqual(s, { current: 'Leo', staysOnCurrent: 0, cursorIndex: 0 }); // index 9 -> 0
});
test('nextLoopState: custom maxStays threshold is honored', () => {
  // with maxStays=3, the 2nd stay still holds
  const s = nextLoopState({ action: 'stay', from: 'Leo' }, { current: 'Leo', staysOnCurrent: 1, cursorIndex: 0 }, TOP, 3);
  assert.deepStrictEqual(s, { current: 'Leo', staysOnCurrent: 2, cursorIndex: 0 });
});

// --- state persistence ----------------------------------------------------
const tmp = path.join(os.tmpdir(), 'vpn-advisor-state.test.json');
function cleanup() { try { fs.unlinkSync(tmp); } catch {} }

test('loadState: missing file returns clean defaults (incl rotation fields)', () => {
  cleanup();
  assert.deepStrictEqual(loadState(tmp), { current: null, staysOnCurrent: 0, cursorIndex: 0, updatedAt: null });
});
test('loadState: corrupt file degrades to clean defaults (never throws)', () => {
  fs.writeFileSync(tmp, 'not json{');
  assert.deepStrictEqual(loadState(tmp), { current: null, staysOnCurrent: 0, cursorIndex: 0, updatedAt: null });
  cleanup();
});
test('saveState then loadState round-trips the FULL rotation state', () => {
  // Regression: loadState used to drop staysOnCurrent/cursorIndex, so rotation never fired.
  saveState(tmp, { current: 'Volans', staysOnCurrent: 1, cursorIndex: 3, updatedAt: '2026-06-06T00:00:00Z' });
  assert.deepStrictEqual(loadState(tmp), { current: 'Volans', staysOnCurrent: 1, cursorIndex: 3, updatedAt: '2026-06-06T00:00:00Z' });
  cleanup();
});
test('integration: persisted state -> nextLoopState rotates on the 2nd stay (the overnight bug)', () => {
  const TOP2 = ['Leo', 'Aladfar', 'Meleph', 'Volans', 'Ascella'];
  // pass 1: stay on Volans (staysOnCurrent 0 -> 1), persist, reload
  saveState(tmp, { ...nextLoopState({ action: 'stay', from: 'Volans' }, { current: 'Volans', staysOnCurrent: 0, cursorIndex: 3 }, TOP2) });
  let s = loadState(tmp);
  assert.strictEqual(s.staysOnCurrent, 1); // survived the round-trip (the bug reset this to 0)
  // pass 2: stay again -> must rotate to next index
  s = nextLoopState({ action: 'stay', from: s.current }, s, TOP2);
  assert.strictEqual(s.current, 'Ascella');
  assert.strictEqual(s.cursorIndex, 4);
  cleanup();
});

// --- runValidationOnce (orchestration, mocked Docker) ---------------------
const cand = (server, expected, cp = {}) => ({
  server, city: 'X', runs: 30, medDownload: expected, medPing: 30, healthy: expected,
  anchored: cp.anchored !== false, checkAbove: cp.checkAbove ?? null, jumpAbove: cp.jumpAbove ?? null,
  curve: [{ lo: 0, hi: 100, mid: 50, n: 10, medDl: expected }],
});
const MODEL = { params: { minGainMbps: 75, minGainPct: 30 }, candidates: [cand('Cur', 200, { checkAbove: 51, jumpAbove: 71 }), cand('Alt', 300)] };
const liveStatus = pairs => Object.entries(pairs).map(([public_name, currentload]) => ({ public_name, currentload, health: 'ok' }));

// Mock that returns each server's speed based on whichever was last switched to.
function mock(speeds, { throwEvery = 0 } = {}) {
  const switches = [];
  let cur = null, calls = 0;
  return {
    switches,
    get calls() { return calls; },
    switchServer: async name => { switches.push(name); cur = name; },
    runSpeedtest: async () => {
      calls++;
      if (throwEvery && calls % throwEvery === 0) throw new Error('speedtest failed');
      return { download: (speeds[cur] ?? 0) * 1e6 };
    },
  };
}

(async () => {
  await (async function () {
    // switch scenario: current Cur@80 (jump) -> switch to Alt; both measured
    const m = mock({ Cur: 210, Alt: 305 });
    const out = await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => liveStatus({ Cur: 80, Alt: 20 }),
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 2, now: () => 'T',
    });
    test('runValidationOnce: switch decision measures current THEN alt, carries alt forward', () => {
      assert.strictEqual(out.decision.action, 'switch');
      assert.deepStrictEqual(m.switches, ['Cur', 'Alt']);
      assert.strictEqual(out.record.current.measured, 210);
      assert.strictEqual(out.record.alternative.measured, 305);
      assert.strictEqual(out.record.scoring.decisionCorrect, true); // alt really faster
      assert.strictEqual(out.next, 'Alt');
    });
  })();

  await (async function () {
    const m = mock({ Cur: 200, Alt: 300 });
    await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => liveStatus({ Cur: 80, Alt: 20 }),
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 3, now: () => 'T',
    });
    test('runValidationOnce: runs the speedtest runsPerServer times on each server', () => {
      assert.strictEqual(m.calls, 6); // 3 current + 3 alt
    });
  })();

  await (async function () {
    const m = mock({ Cur: 210, Alt: 305 }, { throwEvery: 2 }); // every other run throws
    const out = await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => liveStatus({ Cur: 80, Alt: 20 }),
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 2, now: () => 'T',
    });
    test('runValidationOnce: a failed individual run is tolerated (still records)', () => {
      assert.strictEqual(out.record.current.measured, 210); // the one surviving run
      assert.strictEqual(out.record.alternative.measured, 305);
    });
  })();

  await (async function () {
    const m = mock({ Alt: 305 });
    const out = await runValidationOnce({
      model: MODEL, currentServer: null, fetchStatus: async () => liveStatus({ Cur: 20, Alt: 20 }),
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 2, now: () => 'T',
    });
    test('runValidationOnce: first run (no current) measures only the alternative', () => {
      assert.strictEqual(out.decision.zone, 'unknown-current');
      assert.deepStrictEqual(m.switches, ['Alt']); // current is null -> not measured
      assert.strictEqual(out.record.current.measured, null);
      assert.strictEqual(out.next, 'Alt');
    });
  })();

  await (async function () {
    const m = mock({});
    const out = await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => { throw new Error('AirVPN down'); },
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 2, now: () => 'T',
    });
    test('runValidationOnce: AirVPN fetch failure -> fail-safe stay, nothing switched', () => {
      assert.strictEqual(out.decision.zone, 'no-live-data');
      assert.strictEqual(out.decision.action, 'stay');
      assert.deepStrictEqual(m.switches, []);
      assert.strictEqual(out.next, 'Cur');
    });
  })();

  await (async function () {
    // Clock advances only inside the mocked switch/speedtest, so timing is deterministic.
    let t = 0, cur = null;
    const clock = () => t;
    const switchServer = async name => { t += 5000; cur = name; };          // each switch = 5s
    const runSpeedtest = async () => { t += 30000; return { download: ({ Cur: 200, Alt: 300 }[cur] ?? 0) * 1e6 }; }; // each test = 30s
    const out = await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => liveStatus({ Cur: 80, Alt: 20 }),
      switchServer, runSpeedtest, runsPerServer: 2, now: () => 'T', clock,
    });
    test('runValidationOnce: records per-run timing (total + per-server switch/run)', () => {
      // current: switch 5s + 2x30s ; alt: switch 5s + 2x30s = 130s total
      assert.strictEqual(out.record.timing.durationMs, 130000);
      assert.strictEqual(out.record.timing.current.switchMs, 5000);
      assert.deepStrictEqual(out.record.timing.current.runMs, [30000, 30000]);
      assert.strictEqual(out.record.timing.alternative.switchMs, 5000);
    });
  })();

  await (async function () {
    const m = mock({ Cur: 210, Alt: 305 });
    const out = await runValidationOnce({
      model: MODEL, currentServer: 'Cur', fetchStatus: async () => liveStatus({ Cur: 80, Alt: 20 }),
      switchServer: m.switchServer, runSpeedtest: m.runSpeedtest, runsPerServer: 2,
      now: () => 'T', sessionStamp: () => '20260607010101',
    });
    test('runValidationOnce: surfaces raw canonical capture (full results + live row + ts)', () => {
      assert.strictEqual(out.raw.current.server, 'Cur');
      assert.strictEqual(out.raw.current.ts, '20260607010101');
      assert.strictEqual(out.raw.current.liveRow.public_name, 'Cur'); // the live AirVPN row
      assert.strictEqual(out.raw.current.runs.length, 2);             // full speedtest objects
      assert.strictEqual(typeof out.raw.current.runs[0].download, 'number');
      assert.strictEqual(out.raw.alternative.server, 'Alt');
    });
  })();

  console.log(`\n${passed} tests passed`);
})();
