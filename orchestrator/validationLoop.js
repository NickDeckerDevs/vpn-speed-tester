/*
 * validationLoop.js — Self-validation loop for the switch advisor (Part 2).
 *
 * Every run: ask the advisor for a stay/switch decision, then ACTUALLY speed-test
 * both servers the decision hinged on (the current one and the best alternative),
 * and record predicted-vs-measured + whether reality agreed. Over time this is the
 * stream of model-vs-reality scores that proves (or corrects) the cheat sheet.
 *
 * This file is split so the SCORING is pure + testable (buildValidationRecord)
 * while the orchestration (switch tunnel, run speedtest) is added separately and
 * needs the live Docker stack.
 *
 * Changelog
 * 2026-06-06  created — P2-1: pure validation-record scoring (predicted vs measured)
 * 2026-06-06  P2-2: notional current-server carry-forward + tolerant state persistence
 * 2026-06-06  P2-3: runValidationOnce orchestration (dependency-injected; Docker-free here)
 * 2026-06-06  P2-6: per-run timing (total durationMs + per-server switch/run times)
 */

const fs = require('fs');
const { recommend } = require('./switchAdvisor');

/** Median of a numeric array; null for empty. (Local copy — keeps this module dep-free.) */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
const ri = x => (x == null ? null : Math.round(x));

/**
 * Build one validation record from a decision + the measured download runs on
 * both servers. Pure. Tolerant: any missing measurement degrades to null rather
 * than throwing.
 *
 *   at             : ISO timestamp string (passed in — keeps this pure)
 *   decision       : output of switchAdvisor.recommend()
 *   currentMeasured: array of measured download Mbps for the current server
 *   altMeasured    : array of measured download Mbps for the best alternative
 *
 * decisionCorrect semantics (only when both servers were measured):
 *   switch -> correct if the alternative was actually faster (measuredGap > 0)
 *   stay   -> correct if we didn't miss a faster server (measuredGap <= 0)
 */
function buildValidationRecord({ at, decision, currentMeasured = [], altMeasured = [] }) {
  const curMeasured = median(currentMeasured);
  const altMeasured_ = decision.bestAlternative ? median(altMeasured) : null;

  const current = {
    server: decision.from,
    load: decision.currentLoad,
    predicted: ri(decision.expectedCurrent),
    measured: r1(curMeasured),
  };

  const alternative = decision.bestAlternative
    ? {
        server: decision.bestAlternative.server,
        load: decision.bestAlternative.load,
        predicted: ri(decision.bestAlternative.expected),
        measured: r1(altMeasured_),
      }
    : null;

  const bothMeasured = curMeasured != null && altMeasured_ != null;
  const measuredGap = bothMeasured ? altMeasured_ - curMeasured : null; // + => alt faster in reality

  let decisionCorrect = null;
  if (measuredGap != null) {
    decisionCorrect = decision.action === 'switch' ? measuredGap > 0 : measuredGap <= 0;
  }

  return {
    at,
    zone: decision.zone,
    action: decision.action,
    current,
    alternative,
    scoring: {
      currentPredictionError: curMeasured != null && current.predicted != null ? ri(curMeasured - current.predicted) : null,
      altPredictionError: alternative && altMeasured_ != null && alternative.predicted != null ? ri(altMeasured_ - alternative.predicted) : null,
      measuredGap: ri(measuredGap),
      decisionCorrect,
    },
  };
}

/**
 * The server the loop should treat as "current" on its NEXT run. A switch
 * decision adopts the new server; anything else keeps the current one. This is
 * what makes the loop self-driving across runs.
 */
function nextCurrent(decision) {
  if (decision.action === 'switch' && decision.to) return decision.to;
  return decision.from ?? null;
}

/** Load the loop's persisted state. Missing/corrupt file -> a clean { current: null }. */
function loadState(statePath) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { current: s.current ?? null, updatedAt: s.updatedAt ?? null };
  } catch {
    return { current: null, updatedAt: null };
  }
}

/** Persist the loop's state (current server + when). */
function saveState(statePath, state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Switch the tunnel to `name` and run `n` speed tests, returning measured download
 * Mbps. Tolerant: a failed individual run is skipped (fewer samples), not fatal.
 * `switchServer` and `runSpeedtest` are injected (the real ones need Docker).
 */
async function measureServer(name, { switchServer, runSpeedtest, clock = () => Date.now() }, n) {
  const t0 = clock();
  await switchServer(name);
  const switchMs = clock() - t0;

  const runs = [];
  const runMs = [];
  for (let i = 0; i < n; i++) {
    const r0 = clock();
    try {
      const data = await runSpeedtest();
      if (data && typeof data.download === 'number') runs.push(data.download / 1e6);
    } catch {
      /* skip this run, keep going */
    }
    runMs.push(clock() - r0);
  }
  return { runs, switchMs, runMs };
}

/**
 * One pass of the validation loop: ask the advisor, then speed-test the current
 * server and the best alternative, and build the validation record. All side-
 * effecting collaborators are injected so this is testable without Docker.
 *
 *   deps = { model, currentServer, fetchStatus, switchServer, runSpeedtest,
 *            runsPerServer=2, now=()=>ISO, log=()=>{} }
 *
 * Returns { decision, record, next } where `next` is the server to carry forward.
 */
async function runValidationOnce(deps) {
  const {
    model, currentServer, fetchStatus, switchServer, runSpeedtest,
    runsPerServer = 2, now = () => new Date().toISOString(), clock = () => Date.now(), log = () => {},
  } = deps;

  const startedAt = now();
  const startMs = clock();

  let status = [];
  try {
    status = await fetchStatus();
  } catch (err) {
    log(`fetchStatus failed: ${err.message} — advisor will fail-safe`);
  }

  const decision = recommend(currentServer, status, model);
  const sdeps = { switchServer, runSpeedtest, clock };

  let currentMeasured = [];
  let altMeasured = [];
  let currentTiming = null;
  let altTiming = null;

  // Only test servers we can actually reach (we have live status for the fleet).
  if (decision.from && status.length > 0) {
    try {
      const m = await measureServer(decision.from, sdeps, runsPerServer);
      currentMeasured = m.runs;
      currentTiming = { switchMs: m.switchMs, runMs: m.runMs };
    } catch (err) { log(`measuring current ${decision.from} failed: ${err.message}`); }
  }
  if (decision.bestAlternative) {
    try {
      const m = await measureServer(decision.bestAlternative.server, sdeps, runsPerServer);
      altMeasured = m.runs;
      altTiming = { switchMs: m.switchMs, runMs: m.runMs };
    } catch (err) { log(`measuring alt ${decision.bestAlternative.server} failed: ${err.message}`); }
  }

  const finishedAt = now();
  const record = buildValidationRecord({ at: finishedAt, decision, currentMeasured, altMeasured });
  record.timing = {
    startedAt,
    finishedAt,
    durationMs: clock() - startMs,
    current: currentTiming,
    alternative: altTiming,
  };
  return { decision, record, next: nextCurrent(decision) };
}

module.exports = {
  median, buildValidationRecord, nextCurrent, loadState, saveState,
  measureServer, runValidationOnce,
};
