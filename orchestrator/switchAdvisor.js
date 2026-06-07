/*
 * switchAdvisor.js — The "brain": decide stay-vs-switch for the media-stack VPN.
 *
 * Pure + side-effect-free so it's unit-testable and importable by the future
 * media-stack manager. It consumes the cheat sheet (analysis/server-model.json)
 * plus the live AirVPN busy-levels and returns a recommendation. It does NOT
 * touch any container — callers act (or, for now, just log) on its output.
 *
 * No config.js / logger.js imports on purpose (run + test anywhere).
 *
 *   node orchestrator/switchAdvisor.test.js   # unit tests
 *
 * Changelog
 * 2026-06-06  created — Step 4: expectedBandwidth(entry, liveLoad) curve interpolation
 * 2026-06-06  Step 5 — recommend(): three-zone stay/check/jump decision + fail-safe
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Expected download (Mbps) for a candidate at a given live load, by interpolating
 * its per-load-band curve. We never extrapolate past the observed range — below
 * the first sampled band we return its best, above the last we return its worst.
 *
 * entry: a candidate from server-model.json (has `curve`, optional `hourly`, `medDownload`).
 * If `hour` (0-23) is given AND the entry has a populated curve for that hour, the
 * hour-specific curve is used; otherwise it falls back to the load-only `curve`
 * (and finally `medDownload`). This keeps the sparse 24-hour map safe to consult.
 * Returns a number, or null if the entry has no usable data at all.
 */
function interpolateCurve(buckets, liveLoad) {
  const pts = (buckets || [])
    .filter(b => b.medDl != null && b.n > 0)
    .map(b => ({ x: b.mid, y: b.medDl }));

  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0].y;

  const load = clamp(liveLoad, 0, 100);
  if (load <= pts[0].x) return pts[0].y;                 // clamp low — don't extrapolate up
  if (load >= pts[pts.length - 1].x) return pts[pts.length - 1].y; // clamp high

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (load >= a.x && load <= b.x) {
      return a.y + (b.y - a.y) * (load - a.x) / (b.x - a.x);
    }
  }
  return pts[pts.length - 1].y; // unreachable, but safe
}

function expectedBandwidth(entry, liveLoad, hour) {
  // Hour-aware: use the per-hour curve only for the SPECIFIC load band the load
  // falls in. If that (hour, band) cell is empty we fall back to the load-only
  // curve rather than clamp across the hour's other bands (which would hide a
  // known high-load cliff the load-only curve does capture).
  if (hour != null && entry.hourly && entry.hourly[hour]) {
    const load = clamp(liveLoad, 0, 100);
    const cell = entry.hourly[hour].find(b => load >= b.lo && load <= b.hi);
    if (cell && cell.medDl != null && cell.n > 0) return cell.medDl;
  }
  // Fall back to the load-only curve, then to the overall median.
  const loadOnly = interpolateCurve(entry.curve, liveLoad);
  return loadOnly != null ? loadOnly : (entry.medDownload ?? null);
}

const DEFAULT_PARAMS = { minGainMbps: 75, minGainPct: 30 };

/** Index live AirVPN status by server name, keeping only healthy, numeric-load rows. */
function liveLoadByName(liveServers) {
  const map = {};
  for (const s of liveServers || []) {
    if (s && s.health === 'ok' && typeof s.currentload === 'number') {
      map[s.public_name] = s.currentload;
    }
  }
  return map;
}

/** Which zone is `load` in for a candidate, given its per-server cut-points. */
function zoneFor(entry, load) {
  if (!entry.anchored) return 'unanchored';
  if (entry.jumpAbove != null && load >= entry.jumpAbove) return 'jump';
  if (entry.checkAbove != null && load >= entry.checkAbove) return 'check';
  return 'stay';
}

/**
 * Decide stay-vs-switch for the media-stack VPN.
 *
 * currentServerName : the server we're notionally connected to
 * liveServers       : array of live AirVPN status rows (public_name, currentload, health)
 * model             : the cheat sheet (server-model.json: { params, candidates })
 * opts              : optional param overrides ({ minGainMbps, minGainPct })
 *
 * Returns a recommendation object (never throws on bad/empty input — fail-safe to STAY).
 * Always includes `bestAlternative` (top viable candidate by expected speed) so the
 * validation loop can speed-test it even when the decision is STAY.
 */
function recommend(currentServerName, liveServers, model, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(model.params || {}), ...opts };
  const candidates = (model && model.candidates) || [];

  const base = {
    action: 'stay', from: currentServerName, to: null, zone: null,
    reason: '', currentLoad: null, expectedCurrent: null,
    bestAlternative: null, gainMbps: null, gainPct: null,
  };

  if (!liveServers || liveServers.length === 0) {
    return { ...base, zone: 'no-live-data', reason: 'no live server data — staying (fail-safe)' };
  }

  const liveLoad = liveLoadByName(liveServers);

  // Viable alternatives: candidates with a healthy live reading, excluding current.
  const alternatives = candidates
    .filter(c => c.server !== currentServerName && c.server in liveLoad)
    .map(c => ({ server: c.server, load: liveLoad[c.server], expected: expectedBandwidth(c, liveLoad[c.server]) }))
    .filter(a => a.expected != null)
    .sort((a, b) => b.expected - a.expected);
  const bestAlt = alternatives[0] || null;
  const withAlt = { ...base, bestAlternative: bestAlt };

  const currentEntry = candidates.find(c => c.server === currentServerName);

  // Current server isn't on our known-good list → move to a known-good one if we have any.
  if (!currentEntry) {
    if (!bestAlt) return { ...withAlt, zone: 'unknown-current', reason: 'current server not in model and no viable alternative — staying' };
    return { ...withAlt, action: 'switch', to: bestAlt.server, zone: 'unknown-current',
      expectedBest: bestAlt.expected,
      reason: `current server "${currentServerName}" not in model — switching to known-good ${bestAlt.server}` };
  }

  // We know the server but have no live load for it → can't assess its zone.
  if (!(currentServerName in liveLoad)) {
    return { ...withAlt, zone: 'no-current-live', reason: `no live load for current server ${currentServerName} — staying (fail-safe)` };
  }

  const currentLoad = liveLoad[currentServerName];
  const expectedCurrent = expectedBandwidth(currentEntry, currentLoad);
  const zone = zoneFor(currentEntry, currentLoad);
  const ctx = { ...withAlt, zone, currentLoad, expectedCurrent };

  if (zone === 'stay' || zone === 'unanchored') {
    const why = zone === 'unanchored' ? 'current server unanchored (curve untrusted)' : 'below check-point';
    return { ...ctx, reason: `${why} — staying on ${currentServerName} (~${Math.round(expectedCurrent)} Mbps @ ${currentLoad}%)` };
  }

  if (!bestAlt) {
    return { ...ctx, reason: `${zone}-zone but no viable alternative — staying on ${currentServerName}` };
  }

  const gainMbps = bestAlt.expected - expectedCurrent;
  const gainPct = expectedCurrent > 0 ? (gainMbps / expectedCurrent) * 100 : Infinity;
  const ctx2 = { ...ctx, expectedBest: bestAlt.expected, gainMbps, gainPct };

  if (zone === 'jump') {
    // Must leave — but only if something is actually better (else everything's saturated).
    if (gainMbps > 0) {
      return { ...ctx2, action: 'switch', to: bestAlt.server,
        reason: `${currentServerName} past jump-point @ ${currentLoad}% (~${Math.round(expectedCurrent)} Mbps) — switching to ${bestAlt.server} (~${Math.round(bestAlt.expected)} Mbps @ ${bestAlt.load}%)` };
    }
    return { ...ctx2, reason: `${currentServerName} past jump-point but nothing better available — staying` };
  }

  // check zone: switch only for a clear win (must clear BOTH margins).
  if (gainMbps >= params.minGainMbps && gainPct >= params.minGainPct) {
    return { ...ctx2, action: 'switch', to: bestAlt.server,
      reason: `${currentServerName} slipping @ ${currentLoad}% (~${Math.round(expectedCurrent)} Mbps) — ${bestAlt.server} clearly better (+${Math.round(gainMbps)} Mbps / +${Math.round(gainPct)}%)` };
  }
  return { ...ctx2, reason: `${currentServerName} slipping but best alternative only +${Math.round(gainMbps)} Mbps / +${Math.round(gainPct)}% — under threshold, staying` };
}

module.exports = { expectedBandwidth, recommend, zoneFor, liveLoadByName, DEFAULT_PARAMS };
