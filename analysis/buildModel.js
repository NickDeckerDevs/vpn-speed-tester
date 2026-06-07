/*
 * buildModel.js — Build the server "cheat sheet" (server-model.json) from the
 * collected speed-test data in analysis/nas-data/.
 *
 * For the 10 best nearby servers it records a load->speed curve plus two
 * per-server cut-points (check-point / jump-point) that the switch advisor
 * (orchestrator/switchAdvisor.js) uses to decide stay-vs-switch.
 *
 * Self-contained on purpose: no config.js (throws without QBT_* env) and no
 * logger.js (writes to /data/logs, absent off-NAS) so it runs + tests anywhere.
 *
 *   node analysis/buildModel.js                                  # NAS model -> server-model.json
 *   node analysis/buildModel.js --data <dir> --out <path> --all  # e.g. desktop-calibrated model
 *   node analysis/buildModel.test.js                             # run the unit tests
 *
 * Changelog
 * 2026-06-06  created — Step 1: join raw-results<->server-data + bits->Mbps + median
 * 2026-06-06  Step 2 — per-server load->speed curve (bucket medians) + cut-point derivation
 * 2026-06-06  Step 3 — candidate selection + assemble/write server-model.json
 * 2026-06-07  v2 — hour-of-day curve (per server, sparse 0-23) + --data/--out/--all params
 */

const fs = require('fs');
const path = require('path');

// Load bands used for the per-server curve and cut-points. A server is fastest
// while lightly loaded, holds in the middle bands, then falls off a cliff once
// it gets busy — these buckets capture that shape.
const LOAD_BUCKETS = [
  { lo: 0,  hi: 30 },
  { lo: 31, hi: 50 },
  { lo: 51, hi: 70 },
  { lo: 71, hi: 100 },
];

// A server's cut-points are anchored to its "healthy" speed, defined as its
// median download while lightly-to-moderately loaded (<= this load).
const HEALTHY_LOAD_MAX = 50;
// check-point fires once a bucket's median drops below this fraction of healthy
// (server is slipping — start looking for something better).
const CHECK_FRACTION = 0.75;
// jump-point fires once a bucket's median drops below this fraction of healthy
// (server has clearly fallen off — switch regardless).
const JUMP_FRACTION = 0.5;

/** Median of a numeric array. Returns null for an empty array. */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Convert bits/second (speedtest-cli's unit) to megabits/second. */
function toMbps(bitsPerSec) {
  return bitsPerSec / 1e6;
}

/**
 * Join individual runs to the server load at the moment their session started.
 *
 * raw:        keyed by `${timestamp}_${run}-${total}` -> { download (bits/s), ping, ... }
 * serverData: keyed by `${timestamp}` -> { public_name, currentload, location, ... }
 *
 * Returns: { [serverName]: { city, points: [{ load, dl (Mbps), ping, hour }] } }
 * `hour` is the EST hour-of-day (0-23) parsed from the session timestamp.
 * Runs whose timestamp has no server-data entry, or whose download is not a
 * finite number >= 0, are skipped.
 */
function joinRunsToLoad(raw, serverData) {
  const byServer = {};
  for (const key of Object.keys(raw)) {
    const timestamp = key.split('_')[0];
    const meta = serverData[timestamp];
    if (!meta) continue;

    // Validate the raw bits/s before converting: null/undefined coerce to 0 in
    // arithmetic, which would masquerade as a legitimate 0 Mbps reading.
    const rawDl = raw[key].download;
    if (typeof rawDl !== 'number' || !Number.isFinite(rawDl) || rawDl < 0) continue;
    const dl = toMbps(rawDl);

    // EST hour-of-day from the YYYYMMDDHHMMSS session id. The legacy clock encodes
    // midnight as hour "24" (see CLAUDE.md conventions) — map it to 0.
    const hour = (parseInt(timestamp.slice(8, 10), 10) || 0) % 24;

    const name = meta.public_name;
    if (!byServer[name]) byServer[name] = { city: meta.location, points: [] };
    byServer[name].points.push({ load: meta.currentload, dl, ping: raw[key].ping, hour });
  }
  return byServer;
}

/**
 * Median download in each load band for one server's points.
 * Returns: [{ lo, hi, mid, n, medDl }] — medDl is null for an empty bucket.
 * `mid` is the band's midpoint, used later to interpolate the load->speed curve.
 */
function bucketMedians(points) {
  return LOAD_BUCKETS.map(({ lo, hi }) => {
    const inBand = points.filter(p => p.load >= lo && p.load <= hi);
    return {
      lo,
      hi,
      mid: (lo + hi) / 2,
      n: inBand.length,
      medDl: median(inBand.map(p => p.dl)),
    };
  });
}

/**
 * Derive a server's two per-server cut-points from its points.
 *
 * Returns: { healthy, anchored, checkAbove, jumpAbove }
 *   healthy    — median download while <= HEALTHY_LOAD_MAX loaded (null if none)
 *   anchored   — true if we had any <= HEALTHY_LOAD_MAX runs to anchor `healthy`
 *   checkAbove — lowest band-floor load where the median first drops below
 *                CHECK_FRACTION of healthy (null = never observed to slip)
 *   jumpAbove  — same, for JUMP_FRACTION (null = never observed to fall off)
 *
 * When unanchored (no light-load data) we can't trust the curve, so both
 * cut-points are null and `anchored` is false — the advisor handles that case.
 */
function deriveCutPoints(points) {
  const healthyPts = points.filter(p => p.load <= HEALTHY_LOAD_MAX).map(p => p.dl);
  const healthy = median(healthyPts);
  if (healthy == null) {
    return { healthy: null, anchored: false, checkAbove: null, jumpAbove: null };
  }

  const buckets = bucketMedians(points);
  const firstBelow = fraction => {
    const hit = buckets.find(b => b.medDl != null && b.medDl < fraction * healthy);
    return hit ? hit.lo : null;
  };

  return {
    healthy,
    anchored: true,
    checkAbove: firstBelow(CHECK_FRACTION),
    jumpAbove: firstBelow(JUMP_FRACTION),
  };
}

/**
 * Per-hour load->speed curve for one server (the hour-of-day map dimension).
 * Returns: { [hour]: [{ lo, hi, mid, n, medDl }] } — only hours that have data
 * are present (sparse). Each hour reuses the same load-band buckets. This is
 * additive: the load-only `curve` stays the primary signal; the hour-aware
 * advisor lookup falls back to it whenever an (hour, band) cell is empty.
 */
function hourlyCurve(points) {
  const byHour = {};
  for (let h = 0; h < 24; h++) {
    const hp = points.filter(p => p.hour === h);
    if (hp.length === 0) continue;
    byHour[h] = bucketMedians(hp);
  }
  return byHour;
}

// Candidate-selection defaults. We keep the nearby, well-sampled, fast servers
// and let the bad/far ones fall away on rank. Tunable as more data lands.
const SELECTION = {
  count: 10,        // keep the top N servers
  maxPingMs: 90,    // drop far POPs (Fremont/far Chicago) — keeps Miami/Dallas/Raleigh/Denver
  minRuns: 12,      // require enough samples to trust the numbers (drops under-sampled servers)
};

// Advisor knobs, co-located with the model so they are tunable + traceable.
const ADVISOR_PARAMS = {
  minGainMbps: 75,  // a switch must gain at least this many Mbps...
  minGainPct: 30,   // ...AND this percent, or we don't bother (a switch costs downtime)
};

const round = x => (x == null ? null : Math.round(x));

/**
 * Build the ranked candidate list from joined per-server points.
 * Pure + testable. opts overrides SELECTION.
 */
function buildCandidates(byServer, opts = {}) {
  const { count, maxPingMs, minRuns } = { ...SELECTION, ...opts };

  const entries = Object.entries(byServer).map(([server, { city, points }]) => {
    const cut = deriveCutPoints(points);
    return {
      server,
      city,
      runs: points.length,
      medDownload: round(median(points.map(p => p.dl))),
      medPing: round(median(points.map(p => p.ping))),
      healthy: round(cut.healthy),
      anchored: cut.anchored,
      checkAbove: cut.checkAbove,
      jumpAbove: cut.jumpAbove,
      curve: bucketMedians(points).map(b => ({ lo: b.lo, hi: b.hi, mid: b.mid, n: b.n, medDl: round(b.medDl) })),
      hourly: Object.fromEntries(
        Object.entries(hourlyCurve(points)).map(([h, buckets]) => [
          h,
          buckets.map(b => ({ lo: b.lo, hi: b.hi, mid: b.mid, n: b.n, medDl: round(b.medDl) })),
        ])
      ),
    };
  });

  return entries
    .filter(e => e.runs >= minRuns && e.medPing != null && e.medPing <= maxPingMs)
    .sort((a, b) => b.medDownload - a.medDownload)
    .slice(0, count);
}

/** Assemble the full model object. builtAt is passed in so this stays pure. */
function buildModelObject(byServer, builtAt, opts = {}) {
  const candidates = buildCandidates(byServer, opts);
  return {
    meta: {
      builtAt,
      totalServers: Object.keys(byServer).length,
      candidateCount: candidates.length,
      selection: { ...SELECTION, ...opts },
      healthyLoadMax: HEALTHY_LOAD_MAX,
      checkFraction: CHECK_FRACTION,
      jumpFraction: JUMP_FRACTION,
    },
    params: { ...ADVISOR_PARAMS },
    candidates,
  };
}

const DEFAULT_DATA_DIR = path.join(__dirname, 'nas-data');
const DEFAULT_MODEL_PATH = path.join(__dirname, 'server-model.json');

/** Parse `--data <dir>` / `--out <path>` (defaults: nas-data -> server-model.json). */
function parseArgs(argv) {
  const a = { data: DEFAULT_DATA_DIR, out: DEFAULT_MODEL_PATH, opts: {} };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data') a.data = path.resolve(argv[++i]);
    else if (argv[i] === '--out') a.out = path.resolve(argv[++i]);
    else if (argv[i] === '--all') a.opts = { count: 50, minRuns: 1 }; // review build: include every sampled server
  }
  return a;
}

/** Read the data files, build the model, write it. */
function main() {
  const { data, out, opts } = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(fs.readFileSync(path.join(data, 'raw-results.json'), 'utf8'));
  const serverData = JSON.parse(fs.readFileSync(path.join(data, 'server-data.json'), 'utf8'));

  const byServer = joinRunsToLoad(raw, serverData);
  const model = buildModelObject(byServer, new Date().toISOString(), opts);

  fs.writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), out)} — ${model.candidates.length} candidates from ${model.meta.totalServers} servers:`);
  for (const c of model.candidates) {
    const flag = c.anchored ? '' : ' (unanchored)';
    console.log(`  ${c.server.padEnd(12)} ${String(c.city).padEnd(22)} medDL ${String(c.medDownload).padStart(3)}  ping ${String(c.medPing).padStart(3)}  check@${c.checkAbove ?? '-'} jump@${c.jumpAbove ?? '-'}${flag}`);
  }
}

module.exports = {
  median,
  toMbps,
  joinRunsToLoad,
  LOAD_BUCKETS,
  HEALTHY_LOAD_MAX,
  CHECK_FRACTION,
  JUMP_FRACTION,
  bucketMedians,
  hourlyCurve,
  deriveCutPoints,
  SELECTION,
  ADVISOR_PARAMS,
  buildCandidates,
  buildModelObject,
};

if (require.main === module) main();
