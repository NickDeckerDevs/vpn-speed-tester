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
 * 2026-06-07  P2.1: nextLoopState — rotate through the top-10 after N stays (coverage)
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

/**
 * Advance the loop's coverage state so we rotate through ALL top-10 servers instead
 * of parking on one. The advisor still drives switches; but when it STAYS `maxStays`
 * times in a row (it's stuck on a low-load server it likes), we step to the NEXT
 * server in the candidate order — looping — so every server gets exercised as current.
 *
 *   decision         : recommend() output
 *   prev             : { current, staysOnCurrent, cursorIndex } (partial ok)
 *   candidateServers : ordered array of the top-10 server names (model.candidates order)
 *
 * Returns the new { current, staysOnCurrent, cursorIndex }. cursorIndex always tracks
 * the index of `current`, so a forced rotation is just "the next server after this one".
 */
function nextLoopState(decision, prev = {}, candidateServers = [], maxStays = 2) {
  const servers = candidateServers;
  const N = servers.length;
  const idxOf = s => servers.indexOf(s);
  const fallbackIdx = Number.isInteger(prev.cursorIndex) ? prev.cursorIndex : 0;

  // A switch follows the advisor; sync the cursor to where we landed.
  if (decision.action === 'switch' && decision.to) {
    const ci = idxOf(decision.to);
    return { current: decision.to, staysOnCurrent: 0, cursorIndex: ci >= 0 ? ci : fallbackIdx };
  }

  // A stay: count it. Once we've stayed maxStays in a row, force-rotate to the next server.
  const stays = (prev.staysOnCurrent || 0) + 1;
  if (stays >= maxStays && N > 0) {
    const fromIdx = idxOf(decision.from);
    const baseIdx = fromIdx >= 0 ? fromIdx : fallbackIdx;
    const nextIdx = (baseIdx + 1) % N;
    return { current: servers[nextIdx], staysOnCurrent: 0, cursorIndex: nextIdx };
  }
  const ci = idxOf(decision.from);
  return { current: decision.from, staysOnCurrent: stays, cursorIndex: ci >= 0 ? ci : fallbackIdx };
}

/**
 * Load the loop's persisted state. Missing/corrupt file -> clean defaults.
 * MUST pass through the rotation fields (staysOnCurrent, cursorIndex) — dropping
 * them resets the stay counter every pass, so rotation never triggers.
 */
function loadState(statePath) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      current: s.current ?? null,
      staysOnCurrent: s.staysOnCurrent ?? 0,
      cursorIndex: Number.isInteger(s.cursorIndex) ? s.cursorIndex : 0,
      updatedAt: s.updatedAt ?? null,
    };
  } catch {
    return { current: null, staysOnCurrent: 0, cursorIndex: 0, updatedAt: null };
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
  const rawResults = [];
  const runMs = [];
  for (let i = 0; i < n; i++) {
    const r0 = clock();
    try {
      const data = await runSpeedtest();
      if (data && typeof data.download === 'number') {
        runs.push(data.download / 1e6);
        rawResults.push(data); // full speedtest-cli JSON, for canonical output
      }
    } catch {
      /* skip this run, keep going */
    }
    runMs.push(clock() - r0);
  }
  return { runs, rawResults, switchMs, runMs };
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
    runsPerServer = 2, now = () => new Date().toISOString(), clock = () => Date.now(),
    sessionStamp = () => new Date().toISOString(), log = () => {},
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
  // Raw capture for canonical output (full speedtest JSON + the live AirVPN row + session id).
  const liveRowOf = name => status.find(s => s.public_name === name) || null;
  const raw = { current: null, alternative: null };

  // Only test servers we can actually reach (we have live status for the fleet).
  if (decision.from && status.length > 0) {
    const ts = sessionStamp();
    try {
      const m = await measureServer(decision.from, sdeps, runsPerServer);
      currentMeasured = m.runs;
      currentTiming = { switchMs: m.switchMs, runMs: m.runMs };
      if (m.rawResults.length) raw.current = { server: decision.from, ts, liveRow: liveRowOf(decision.from), runs: m.rawResults };
    } catch (err) { log(`measuring current ${decision.from} failed: ${err.message}`); }
  }
  if (decision.bestAlternative) {
    const ts = sessionStamp();
    try {
      const m = await measureServer(decision.bestAlternative.server, sdeps, runsPerServer);
      altMeasured = m.runs;
      altTiming = { switchMs: m.switchMs, runMs: m.runMs };
      if (m.rawResults.length) raw.alternative = { server: decision.bestAlternative.server, ts, liveRow: liveRowOf(decision.bestAlternative.server), runs: m.rawResults };
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
  return { decision, record, next: nextCurrent(decision), raw };
}

module.exports = {
  median, buildValidationRecord, nextCurrent, nextLoopState, loadState, saveState,
  measureServer, runValidationOnce,
};
