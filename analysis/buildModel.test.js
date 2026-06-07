/*
 * buildModel.test.js — unit tests for the cheat-sheet builder.
 * Plain node:assert (repo has no test framework). Run: node analysis/buildModel.test.js
 *
 * Changelog
 * 2026-06-06  created — Step 1 tests: median, toMbps, joinRunsToLoad
 * 2026-06-06  Step 2 tests: bucketMedians, deriveCutPoints
 * 2026-06-06  Step 3 tests: buildCandidates, buildModelObject
 */

const assert = require('node:assert');
const {
  median, toMbps, joinRunsToLoad,
  bucketMedians, deriveCutPoints,
  buildCandidates, buildModelObject,
} = require('./buildModel');

/** n points all at the same load + download — handy for shaping a curve. */
function rep(load, dl, n = 3) {
  return Array.from({ length: n }, () => ({ load, dl, ping: 30 }));
}

/** A server with n light-load points at a fixed download + ping. */
function srv(city, dl, ping, n) {
  return { city, points: Array.from({ length: n }, () => ({ load: 20, dl, ping })) };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// --- median ---------------------------------------------------------------
test('median: odd-length returns the middle value', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
});
test('median: even-length returns the average of the two middles', () => {
  assert.strictEqual(median([10, 20, 30, 40]), 25);
});
test('median: empty array returns null', () => {
  assert.strictEqual(median([]), null);
});
test('median: does not mutate its input', () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepStrictEqual(input, [3, 1, 2]);
});

// --- toMbps ---------------------------------------------------------------
test('toMbps: converts bits/s to Mbps (divide by 1e6)', () => {
  assert.strictEqual(toMbps(288_600_509), 288.600509);
});

// --- joinRunsToLoad -------------------------------------------------------
const serverData = {
  '20260508111152': { public_name: 'Aladfar', currentload: 62, location: 'Miami' },
  '20260508120000': { public_name: 'Leo', currentload: 20, location: 'Dallas, Texas' },
};

test('joinRunsToLoad: pairs a run with its session load + city, converting to Mbps', () => {
  const raw = { '20260508111152_1-3': { download: 140_848_921, ping: 26 } };
  const out = joinRunsToLoad(raw, serverData);
  assert.strictEqual(out.Aladfar.city, 'Miami');
  assert.strictEqual(out.Aladfar.points.length, 1);
  assert.strictEqual(out.Aladfar.points[0].load, 62);
  assert.ok(Math.abs(out.Aladfar.points[0].dl - 140.848921) < 1e-9);
  assert.strictEqual(out.Aladfar.points[0].ping, 26);
});

test('joinRunsToLoad: groups multiple runs of one session under the same server', () => {
  const raw = {
    '20260508111152_1-3': { download: 100_000_000, ping: 26 },
    '20260508111152_2-3': { download: 200_000_000, ping: 16 },
    '20260508111152_3-3': { download: 300_000_000, ping: 20 },
  };
  const out = joinRunsToLoad(raw, serverData);
  assert.strictEqual(out.Aladfar.points.length, 3);
  assert.deepStrictEqual(out.Aladfar.points.map(p => p.dl), [100, 200, 300]);
});

test('joinRunsToLoad: skips runs whose timestamp has no server-data entry', () => {
  const raw = { '29991231000000_1-3': { download: 100_000_000, ping: 5 } };
  const out = joinRunsToLoad(raw, serverData);
  assert.deepStrictEqual(out, {});
});

test('joinRunsToLoad: skips runs with a non-finite or negative download', () => {
  const raw = {
    '20260508111152_1-3': { download: null, ping: 26 },
    '20260508111152_2-3': { download: -5, ping: 26 },
    '20260508120000_1-3': { download: 333_000_000, ping: 55 },
  };
  const out = joinRunsToLoad(raw, serverData);
  assert.strictEqual(out.Aladfar, undefined); // both Aladfar runs were invalid
  assert.strictEqual(out.Leo.points.length, 1);
  assert.strictEqual(out.Leo.points[0].dl, 333);
});

// --- bucketMedians --------------------------------------------------------
test('bucketMedians: sorts points into the four load bands with right medians', () => {
  const pts = [
    ...rep(20, 400), // 0-30
    ...rep(40, 350), // 31-50
    ...rep(60, 280), // 51-70
    ...rep(85, 150), // 71-100
  ];
  const b = bucketMedians(pts);
  assert.deepStrictEqual(b.map(x => x.medDl), [400, 350, 280, 150]);
  assert.deepStrictEqual(b.map(x => x.n), [3, 3, 3, 3]);
});
test('bucketMedians: empty band reports medDl null and n 0', () => {
  const b = bucketMedians(rep(20, 400)); // only the 0-30 band has data
  assert.strictEqual(b[0].medDl, 400);
  assert.strictEqual(b[1].medDl, null);
  assert.strictEqual(b[1].n, 0);
});
test('bucketMedians: band midpoints are stable (for later interpolation)', () => {
  assert.deepStrictEqual(bucketMedians([]).map(x => x.mid), [15, 40.5, 60.5, 85.5]);
});

// --- deriveCutPoints ------------------------------------------------------
test('deriveCutPoints: server that slips then falls off gets distinct check/jump', () => {
  // healthy = 400 (load 20). 51-70 -> 280 (<0.75*400=300) ; 71-100 -> 150 (<0.5*400=200)
  const pts = [...rep(20, 400), ...rep(60, 280), ...rep(85, 150)];
  const c = deriveCutPoints(pts);
  assert.strictEqual(c.healthy, 400);
  assert.strictEqual(c.anchored, true);
  assert.strictEqual(c.checkAbove, 51);
  assert.strictEqual(c.jumpAbove, 71);
});
test('deriveCutPoints: server that never slips has null check + jump', () => {
  const pts = [...rep(20, 400), ...rep(60, 390), ...rep(85, 380)];
  const c = deriveCutPoints(pts);
  assert.strictEqual(c.anchored, true);
  assert.strictEqual(c.checkAbove, null);
  assert.strictEqual(c.jumpAbove, null);
});
test('deriveCutPoints: no light-load data -> unanchored, both cut-points null', () => {
  const pts = [...rep(85, 150), ...rep(60, 200)]; // nothing at load <= 50
  const c = deriveCutPoints(pts);
  assert.strictEqual(c.healthy, null);
  assert.strictEqual(c.anchored, false);
  assert.strictEqual(c.checkAbove, null);
  assert.strictEqual(c.jumpAbove, null);
});
test('deriveCutPoints: healthy is the median across ALL light-load runs', () => {
  const pts = [...rep(20, 420), ...rep(40, 380)]; // both <= 50 load
  assert.strictEqual(deriveCutPoints(pts).healthy, 400); // median of [380,380,380,420,420,420]
});
test('deriveCutPoints: exactly 0.75*healthy does NOT trigger check (strict <)', () => {
  // 51-70 sits exactly at 300 (=0.75*400); 71-100 stays above it -> no slip detected
  const pts = [...rep(20, 400), ...rep(60, 300), ...rep(85, 320)];
  assert.strictEqual(deriveCutPoints(pts).checkAbove, null);
});
test('deriveCutPoints: exactly 0.5*healthy does NOT trigger jump (strict <)', () => {
  // 71-100 sits exactly at 200 (=0.5*400) -> not a fall-off; check still fires at 51 (250<300)
  const pts = [...rep(20, 400), ...rep(60, 250), ...rep(85, 200)];
  const c = deriveCutPoints(pts);
  assert.strictEqual(c.jumpAbove, null);
  assert.strictEqual(c.checkAbove, 51);
});

// --- buildCandidates / buildModelObject -----------------------------------
const sample = {
  FastA: srv('Miami', 300, 21, 15),
  FastB: srv('Dallas', 280, 56, 15),
  MidC: srv('Raleigh', 250, 57, 15),
  SlowFar: srv('Fremont', 8, 203, 15),  // excluded by ping
  Under: srv('Miami', 320, 22, 6),      // excluded by minRuns
};

test('buildCandidates: ranks by median download and caps at count', () => {
  const c = buildCandidates(sample, { count: 3 });
  assert.deepStrictEqual(c.map(x => x.server), ['FastA', 'FastB', 'MidC']);
});
test('buildCandidates: drops servers above the ping gate', () => {
  const names = buildCandidates(sample, { count: 10 }).map(x => x.server);
  assert.ok(!names.includes('SlowFar'));
});
test('buildCandidates: drops under-sampled servers below minRuns', () => {
  const names = buildCandidates(sample, { count: 10 }).map(x => x.server);
  assert.ok(!names.includes('Under'));
});
test('buildCandidates: each entry carries the full shape the advisor needs', () => {
  const e = buildCandidates(sample, { count: 1 })[0];
  for (const k of ['server', 'city', 'runs', 'medDownload', 'medPing', 'healthy', 'anchored', 'checkAbove', 'jumpAbove', 'curve']) {
    assert.ok(k in e, `missing key: ${k}`);
  }
  assert.strictEqual(e.curve.length, 4); // four load bands
});
test('buildModelObject: wraps candidates with meta + advisor params, passing builtAt through', () => {
  const m = buildModelObject(sample, '2026-06-06T00:00:00Z', { count: 2 });
  assert.strictEqual(m.meta.builtAt, '2026-06-06T00:00:00Z');
  assert.strictEqual(m.meta.candidateCount, 2);
  assert.strictEqual(m.candidates.length, 2);
  assert.strictEqual(m.params.minGainMbps, 75);
  assert.strictEqual(m.params.minGainPct, 30);
});

console.log(`\n${passed} tests passed`);
