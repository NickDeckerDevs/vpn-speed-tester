/*
 * modelReport.js — Read-only review of a DESKTOP-calibrated model vs the live NAS
 * model, plus a counterfactual replay of recorded decisions. Build review tool;
 * it never touches the running loop or the live server-model.json.
 *
 * Builds the desktop model in-memory from desktop-validation/data/ (reusing
 * buildModel), loads the live analysis/server-model.json, and the validation log,
 * then prints:
 *   1. bias      — desktop vs NAS predicted speed per server (the vantage gap)
 *   2. coverage  — server × (hour × load-band) filled cells (data-collection progress)
 *   3. replay    — re-run each recorded decision under each model, scored against the
 *                  speeds we actually measured: does recalibration decide better?
 *
 *   node analysis/modelReport.js [dataDir]      # default: desktop-validation/data
 *   ./vpn model-report
 *   node analysis/modelReport.test.js
 *
 * Changelog
 * 2026-06-07  created — desktop-vs-NAS model review + counterfactual decision replay
 */

const fs = require('fs');
const path = require('path');
const { joinRunsToLoad, buildModelObject } = require('./buildModel');
const { recommend, expectedBandwidth } = require('../orchestrator/switchAdvisor');
const { buildValidationRecord } = require('../orchestrator/validationLoop');

const round = x => (x == null ? null : Math.round(x));
const SAMPLE_LOADS = [20, 50, 80];

const byName = model => Object.fromEntries((model.candidates || []).map(c => [c.server, c]));

/**
 * Per-server desktop-vs-NAS comparison: median download + expected speed at sample
 * loads under each model, and the delta (desktop − NAS). Pure.
 */
function biasTable(desktopModel, nasModel) {
  const nas = byName(nasModel);
  return desktopModel.candidates.map(d => {
    const n = nas[d.server];
    const row = { server: d.server, runs: d.runs, medDesktop: d.medDownload, medNas: n ? n.medDownload : null, atLoad: {} };
    for (const load of SAMPLE_LOADS) {
      const ed = round(expectedBandwidth(d, load));
      const en = n ? round(expectedBandwidth(n, load)) : null;
      row.atLoad[load] = { desktop: ed, nas: en, delta: ed != null && en != null ? ed - en : null };
    }
    return row;
  });
}

/**
 * Per-server hour×load-band coverage: how many of the 24×(bands) cells have data.
 * Doubles as the data-collection progress view. Pure.
 */
function coverageTally(desktopModel, bands = 4) {
  const totalCells = 24 * bands;
  return desktopModel.candidates.map(c => {
    let filled = 0;
    const hours = Object.keys(c.hourly || {});
    for (const h of hours) for (const b of c.hourly[h]) if (b.medDl != null && b.n > 0) filled++;
    return { server: c.server, runs: c.runs, hoursWithData: hours.length, filledCells: filled, totalCells };
  });
}

/**
 * Counterfactual replay: for each scored record, reconstruct the 2-server fleet the
 * decision hinged on, re-run recommend() under `model`, and score the decision against
 * the speeds actually measured. Returns { scored, correct, pct, skipped }. Pure.
 */
function replayTally(records, model) {
  const cand = byName(model);
  let scored = 0, correct = 0, skipped = 0;
  for (const r of records) {
    if (!r.current || !r.alternative || r.current.measured == null || r.alternative.measured == null) continue;
    const cur = r.current.server, alt = r.alternative.server;
    if (!cand[cur] || !cand[alt]) { skipped++; continue; } // model doesn't know one of them
    const fleet = [
      { public_name: cur, currentload: r.current.load, health: 'ok' },
      { public_name: alt, currentload: r.alternative.load, health: 'ok' },
    ];
    const decision = recommend(cur, fleet, model);
    const rec = buildValidationRecord({ at: 'replay', decision, currentMeasured: [r.current.measured], altMeasured: [r.alternative.measured] });
    if (rec.scoring.decisionCorrect == null) { skipped++; continue; }
    scored++;
    if (rec.scoring.decisionCorrect) correct++;
  }
  return { scored, correct, pct: scored ? Math.round((100 * correct) / scored) : null, skipped };
}

// ── presentation ────────────────────────────────────────────────────────────
function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function buildDesktopModel(dataDir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'raw-results.json'), 'utf8'));
  const sd = JSON.parse(fs.readFileSync(path.join(dataDir, 'server-data.json'), 'utf8'));
  return buildModelObject(joinRunsToLoad(raw, sd), new Date().toISOString(), { count: 50, minRuns: 1 });
}

function main() {
  const dataDir = process.argv[2] || path.join(__dirname, '..', 'desktop-validation', 'data');
  const desktop = buildDesktopModel(dataDir);
  const nas = JSON.parse(fs.readFileSync(path.join(__dirname, 'server-model.json'), 'utf8'));
  const records = readJsonl(path.join(dataDir, 'validation-log.jsonl'));

  console.log(`\n══ MODEL REVIEW ══  desktop data: ${dataDir}`);
  console.log(`desktop servers: ${desktop.candidates.length}  |  validation records: ${records.length}`);

  console.log('\nDESKTOP vs NAS predicted download (Mbps) — delta = desktop − NAS:');
  console.log('  server        runs  medDL(d/n)    @20 d/n(Δ)      @50 d/n(Δ)      @80 d/n(Δ)');
  for (const r of biasTable(desktop, nas)) {
    const a = l => `${r.atLoad[l].desktop ?? '-'}/${r.atLoad[l].nas ?? '-'}(${r.atLoad[l].delta == null ? '-' : (r.atLoad[l].delta >= 0 ? '+' : '') + r.atLoad[l].delta})`;
    console.log(`  ${r.server.padEnd(12)} ${String(r.runs).padStart(4)}  ${String(r.medDesktop).padStart(3)}/${String(r.medNas ?? '-').padStart(3)}     ${a(20).padEnd(14)} ${a(50).padEnd(14)} ${a(80)}`);
  }

  console.log('\nHOUR×LOAD COVERAGE (filled cells of 96, + hours seen) — data-collection progress:');
  for (const c of coverageTally(desktop)) {
    console.log(`  ${c.server.padEnd(12)} runs ${String(c.runs).padStart(4)}  cells ${String(c.filledCells).padStart(2)}/${c.totalCells}  hours ${c.hoursWithData}/24`);
  }

  const rNas = replayTally(records, nas);
  const rDesk = replayTally(records, desktop);
  console.log('\nCOUNTERFACTUAL DECISION REPLAY (scored vs the speeds we measured):');
  console.log(`  NAS model     : ${rNas.correct}/${rNas.scored} correct (${rNas.pct ?? '-'}%)   [${rNas.skipped} skipped]`);
  console.log(`  DESKTOP model : ${rDesk.correct}/${rDesk.scored} correct (${rDesk.pct ?? '-'}%)   [${rDesk.skipped} skipped]`);
  console.log(`  → recalibration ${rDesk.pct != null && rNas.pct != null ? (rDesk.pct - rNas.pct >= 0 ? 'improves' : 'worsens') + ` decisions by ${Math.abs(rDesk.pct - rNas.pct)} pts` : 'comparison n/a'} (same situations).`);
  console.log('\n(review-only — the live loop + server-model.json are untouched)');
}

module.exports = { biasTable, coverageTally, replayTally };

if (require.main === module) main();
