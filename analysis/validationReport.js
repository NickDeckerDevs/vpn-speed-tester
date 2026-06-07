/*
 * validationReport.js — Read-only dashboard over the validation loop's output.
 *
 * Summarizes desktop-validation/data/:
 *   - validation-log.jsonl  → decision accuracy (overall, by action, by zone, by
 *                             current-server), prediction bias, coverage, recent trend
 *   - raw-results.json + server-data.json → live per-server load→speed curve +
 *                             cut-points (reusing buildModel), i.e. the cheat sheet
 *                             as it looks from the freshly-gathered desktop data.
 *
 * Re-run any time to watch the data mature:
 *   node analysis/validationReport.js [dataDir]   (default: desktop-validation/data)
 *   node analysis/validationReport.test.js         (unit tests for the aggregator)
 *
 * Changelog
 * 2026-06-07  created — live dashboard for the validation loop
 */

const fs = require('fs');
const path = require('path');
const { median, joinRunsToLoad, bucketMedians, deriveCutPoints } = require('./buildModel');

/** Group scored records by a key, tallying n / correct / median current-prediction-error. */
function tally(scored, keyFn) {
  const m = {};
  for (const r of scored) {
    const k = keyFn(r);
    if (k == null) continue;
    (m[k] ||= { n: 0, correct: 0, _pe: [] });
    m[k].n++;
    if (r.scoring.decisionCorrect) m[k].correct++;
    if (typeof r.scoring.currentPredictionError === 'number') m[k]._pe.push(r.scoring.currentPredictionError);
  }
  for (const k of Object.keys(m)) {
    m[k].correctPct = m[k].n ? Math.round((100 * m[k].correct) / m[k].n) : null;
    m[k].medPredErr = median(m[k]._pe);
    delete m[k]._pe;
  }
  return m;
}

/** Count occurrences of a field across ALL records (not just scored). */
function countBy(records, fn) {
  const m = {};
  for (const r of records) { const k = fn(r); if (k != null) m[k] = (m[k] || 0) + 1; }
  return m;
}

/**
 * Pure aggregator over the decision records (array of validation-log.jsonl objects).
 * Returns the dashboard numbers; no I/O.
 */
function summarizeLog(records, recentWindow = 50) {
  const scored = records.filter(r => r && r.scoring && r.scoring.decisionCorrect !== null);
  const correct = scored.filter(r => r.scoring.decisionCorrect).length;
  const recent = scored.slice(-recentWindow);
  const recentCorrect = recent.filter(r => r.scoring.decisionCorrect).length;

  return {
    passes: records.length,
    span: {
      first: records[0]?.at ?? null,
      last: records[records.length - 1]?.at ?? null,
    },
    scored: scored.length,
    correct,
    correctPct: scored.length ? Math.round((100 * correct) / scored.length) : null,
    byAction: tally(scored, r => r.action),
    byZone: tally(scored, r => r.zone),
    byCurrentServer: tally(scored, r => r.current && r.current.server),
    coverageCurrent: countBy(records, r => r.current && r.current.server),
    coverageAlt: countBy(records, r => r.alternative && r.alternative.server),
    recent: {
      window: recent.length,
      correctPct: recent.length ? Math.round((100 * recentCorrect) / recent.length) : null,
    },
  };
}

// ── presentation ────────────────────────────────────────────────────────────
function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function readJsonOr(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
const pct = v => (v == null ? '  -' : `${String(v).padStart(3)}%`);
const num = (v, w = 4) => (v == null ? '-'.padStart(w) : String(Math.round(v)).padStart(w));

function main() {
  const dataDir = process.argv[2] || path.join(__dirname, '..', 'desktop-validation', 'data');
  const log = readJsonl(path.join(dataDir, 'validation-log.jsonl'));
  const s = summarizeLog(log);
  const hrs = s.span.first && s.span.last ? ((Date.parse(s.span.last) - Date.parse(s.span.first)) / 3.6e6) : 0;

  console.log(`\n══ VALIDATION DASHBOARD ══  (${dataDir})`);
  console.log(`passes: ${s.passes}  |  span: ${hrs.toFixed(1)}h  |  scored: ${s.scored}`);
  console.log(`\nDECISION ACCURACY: ${pct(s.correctPct)} correct overall  (recent ${s.recent.window}: ${pct(s.recent.correctPct)})`);
  console.log('  by action:');
  for (const [k, v] of Object.entries(s.byAction)) console.log(`    ${k.padEnd(7)} n=${String(v.n).padStart(4)}  ${pct(v.correctPct)} correct`);
  console.log('  by zone:');
  for (const [k, v] of Object.entries(s.byZone)) console.log(`    ${k.padEnd(15)} n=${String(v.n).padStart(4)}  ${pct(v.correctPct)} correct`);

  console.log('\nPER CURRENT-SERVER  (scored passes where it was current):');
  console.log('  server        n   correct   medPredErr(meas-pred)');
  for (const [k, v] of Object.entries(s.byCurrentServer).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(12)} ${String(v.n).padStart(3)}   ${pct(v.correctPct)}     ${num(v.medPredErr, 5)} Mbps`);
  }

  // Coverage + live curve from canonical data
  const raw = readJsonOr(path.join(dataDir, 'raw-results.json'), {});
  const sd = readJsonOr(path.join(dataDir, 'server-data.json'), {});
  const byServer = joinRunsToLoad(raw, sd);
  console.log('\nLIVE LOAD→SPEED (from desktop canonical data, medDL Mbps by load band):');
  console.log('  server        runs  <=30  31-50  51-70  71-100   check@ jump@');
  const rows = Object.entries(byServer).sort((a, b) => b[1].points.length - a[1].points.length);
  for (const [name, sv] of rows) {
    const b = bucketMedians(sv.points);
    const c = deriveCutPoints(sv.points);
    const cells = b.map(x => num(x.medDl, 5)).join(' ');
    console.log(`  ${name.padEnd(12)} ${String(sv.points.length).padStart(4)}  ${cells}   ${String(c.checkAbove ?? '-').padStart(4)} ${String(c.jumpAbove ?? '-').padStart(4)}`);
  }
  const zero = ['Leo','Aladfar','Meleph','Volans','Ascella','Scutum','Polis','Giausar','Helvetios','Chertan'].filter(x => !byServer[x]);
  if (zero.length) console.log(`  (no data yet: ${zero.join(', ')})`);
}

module.exports = { summarizeLog, tally, countBy };

if (require.main === module) main();
