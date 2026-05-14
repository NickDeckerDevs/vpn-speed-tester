/*
 * scheduler.js — Cron orchestrator and main test-window logic.
 *
 * Entry point for the scheduled system (invoked by main.js). Registers two
 * cron jobs: the nightly speed-test window and the hourly AirVPN snapshot.
 * runSpeedTestWindow() drives the full per-server test cycle: pause qBt,
 * pre-filter servers to gluetun-accepted candidates, loop picking servers and
 * running speedtest-cli, then resume qBt on shutdown.
 *
 * Responsibility split with gluetunManager.js:
 *   getAcceptedServers()     — raw API fetch, throws if gluetun is down (gluetunManager.js)
 *   resolveAcceptedServers() — resilient fetch + disk cache fallback (this file)
 * These are intentionally separate layers, not duplications.
 *
 * Changelog
 * 2026-05-14  Added resolveAcceptedServers() — wraps getAcceptedServers() with a
 *               disk-cache fallback so pre-filtering survives gluetun not yet being
 *               up at window start; returns null (no filtering) if neither source works
 * 2026-05-14  Added writeUnreachableReport() — writes per-window JSON diff of
 *               live AirVPN US servers vs gluetun-accepted list for debugging
 * 2026-05-14  runSpeedTestWindow() now calls resolveAcceptedServers() in pre-flight
 *               and filters liveServers to only gluetun-accepted candidates;
 *               unreachable report written once per window (unreachableLoggedThisWindow)
 * 2026-05-14  MAX_CONSECUTIVE_FAILURES moved to config.js (was local const = 2, now = 5)
 */

const cron = require('node-cron');
const fs = require('fs-extra');
const logger = require('./logger');
const config = require('./config');
const { fetchUSServers } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const { switchServer, tearDownTestContainers, restoreBaseContainers, ensureSpeedtestRunner, captureBaseConfig, getAcceptedServers } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { writeResults, loadResults } = require('./resultsWriter');
const { writeHourlySnapshot } = require('./snapshotWriter');
const { pauseAll, resumeAll } = require('./qbtClient');
const { appendServerData, appendRawResult } = require('./rawDataWriter');

const SECONDS_BETWEEN_RUNS = 10;

/**
 * Returns a Set<string> of gluetun-accepted AirVPN server names.
 *
 * Tries the live gluetun control API first and writes the result to disk as a
 * cache. Falls back to that cached file if gluetun is not yet running (common
 * at window start before switchServer() has brought it up). Returns null if
 * neither source is available — callers must treat null as "no filtering"
 * rather than "filter everything".
 *
 * See getAcceptedServers() in gluetunManager.js for the raw-fetch counterpart.
 */
async function resolveAcceptedServers() {
  try {
    const accepted = await getAcceptedServers();
    try {
      await fs.outputJson(config.ACCEPTED_SERVERS_PATH, {
        generated_at: new Date().toISOString(),
        source: 'gluetun-control-api',
        count: accepted.size,
        servers: [...accepted].sort(),
      }, { spaces: 2 });
    } catch (writeErr) {
      logger.warn(`resolveAcceptedServers: cache write failed (${writeErr.message})`);
    }
    return accepted;
  } catch (err) {
    logger.warn(`resolveAcceptedServers: live query failed (${err.message}) — falling back to cached list`);
  }

  try {
    const cached = await fs.readJson(config.ACCEPTED_SERVERS_PATH);
    if (Array.isArray(cached?.servers) && cached.servers.length > 0) {
      logger.info(`resolveAcceptedServers: using cached list (${cached.servers.length} servers, generated ${cached.generated_at})`);
      return new Set(cached.servers);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`resolveAcceptedServers: cache read failed (${err.message})`);
  }

  logger.warn('resolveAcceptedServers: no accepted-list available — proceeding without server filtering');
  return null;
}

/**
 * Writes a JSON report to UNREACHABLE_SERVERS_PATH comparing live AirVPN US
 * servers against gluetun's accepted list for this window. Written once per
 * window (gated by unreachableLoggedThisWindow in the caller) so the file
 * always reflects the most-recent window's snapshot.
 *
 * Useful for diagnosing why certain servers are never tested: if a server
 * appears in AirVPN's live API but not in gluetun's bundled list, speedtest
 * results for it would be routed outside the VPN.
 */
async function writeUnreachableReport({ windowStart, liveServers, acceptedSet }) {
  const liveNames = liveServers.map(s => s.public_name);
  const unreachable = liveNames.filter(n => !acceptedSet.has(n)).sort();
  const accepted = liveNames.filter(n => acceptedSet.has(n)).sort();

  try {
    await fs.outputJson(config.UNREACHABLE_SERVERS_PATH, {
      generated_at: new Date().toISOString(),
      window_start: windowStart.toISOString(),
      gluetun_accepted_count: acceptedSet.size,
      airvpn_us_count: liveNames.length,
      accepted_us_count: accepted.length,
      unreachable_count: unreachable.length,
      unreachable,
      accepted,
    }, { spaces: 2 });
  } catch (err) {
    logger.warn(`writeUnreachableReport: write failed (${err.message})`);
  }
  return { unreachable, accepted };
}

function getESTTimestamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

async function runSpeedTestWindow(opts = {}) {
  logger.fn(__filename, 'runSpeedTestWindow', null);

  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + config.TEST_WINDOW_HOURS * 60 * 60 * 1000);
  logger.info(`=== Speed test window START === ends at ${windowEnd.toISOString()}`);

  // ── Step 1: Pre-flight ────────────────────────────────────────
  logger.info('PRE-FLIGHT: pausing qBittorrent...');
  try {
    await pauseAll();
  } catch (err) {
    logger.warn(`PRE-FLIGHT: qBittorrent pause failed — continuing anyway (${err.message})`);
  }

  logger.info('PRE-FLIGHT: loading existing results...');
  let results = await loadResults();

  logger.info('PRE-FLIGHT: capturing base container config...');
  await captureBaseConfig();

  logger.info('PRE-FLIGHT: resolving gluetun accepted-server list...');
  const acceptedSet = await resolveAcceptedServers();

  logger.info('PRE-FLIGHT: complete');

  // ── Step 2: Per-server test session loop ──────────────────────
  const serversTestedThisWindow = [];
  let consecutiveFailures = 0;
  let unreachableLoggedThisWindow = false;

  while (Date.now() < windowEnd.getTime()) {
    logger.info('Fetching live AirVPN status...');
    const liveServersRaw = await fetchUSServers();

    let liveServers = liveServersRaw;
    if (acceptedSet) {
      liveServers = liveServersRaw.filter(s => acceptedSet.has(s.public_name));
      // Write the unreachable report only on the first iteration — the accepted
      // list doesn't change mid-window, so repeated writes would be identical noise
      if (!unreachableLoggedThisWindow) {
        const { unreachable } = await writeUnreachableReport({
          windowStart, liveServers: liveServersRaw, acceptedSet,
        });
        logger.info(
          `window filter: ${liveServers.length}/${liveServersRaw.length} US servers reachable via gluetun` +
          (unreachable.length ? ` — skipping ${unreachable.length}: ${unreachable.join(', ')}` : '')
        );
        unreachableLoggedThisWindow = true;
      }
    }

    const server = pickNextServer(liveServers, results);

    if (!server) {
      logger.info('No eligible servers — coverage complete, ending window early');
      break;
    }

    if (Date.now() >= windowEnd.getTime()) {
      logger.info('Window boundary reached — stopping before next session');
      break;
    }

    const serverName = server.public_name;
    logger.info(`\n────────────────────────────────────────────`);
    logger.info(`SESSION: ${serverName} | tier: ${server.tier} | load: ${server.currentload}% | ${server.location}`);
    logger.info(`────────────────────────────────────────────`);

    try {
      logger.info(`SESSION: switching gluetun to ${serverName}...`);
      await switchServer(serverName);

      logger.info('SESSION: verifying speedtest-runner is live...');
      await ensureSpeedtestRunner();

      const timestamp = getESTTimestamp();
      await appendServerData(timestamp, server);
      logger.info(`SESSION: saved server data with timestamp ${timestamp}`);

      // ── 3 runs ────────────────────────────────────────────────
      for (let runNum = 1; runNum <= config.RUNS_PER_SESSION; runNum++) {
        logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: running speedtest...`);

        const rawResult = await runSpeedtest();
        const key = `${timestamp}_${runNum}-${config.RUNS_PER_SESSION}`;
        await appendRawResult(key, rawResult);

        const dl = (rawResult.download / 1_000_000).toFixed(2);
        const ul = (rawResult.upload / 1_000_000).toFixed(2);
        const ping = rawResult.ping.toFixed(2);
        logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION} complete: ↓${dl} Mbps ↑${ul} Mbps ping ${ping}ms`);

        if (runNum < config.RUNS_PER_SESSION) {
          logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: waiting ${SECONDS_BETWEEN_RUNS}s before next run...`);
          await new Promise(resolve => setTimeout(resolve, SECONDS_BETWEEN_RUNS * 1000));
        }
      }

      results.push({ server_name: serverName, tier: server.tier, timestamp, run_count: config.RUNS_PER_SESSION });
      await writeResults(results);

      serversTestedThisWindow.push({ serverName, tier: server.tier });
      logger.info(`SESSION: ${serverName} complete ✓`);
      if (opts.singleRun) break;
      consecutiveFailures = 0;

    } catch (err) {
      const isTunnelFailure = err.message.includes('gluetun-speedtest exited')
        || err.message.includes('Tunnel failed after')
        || err.message.includes('gluetun-speedtest container not found');

      if (isTunnelFailure) {
        logger.warn(`SESSION SKIP [${serverName}]: tunnel issue — ${err.message}`);
      } else {
        consecutiveFailures++;
        logger.error(`SESSION ERROR [${serverName}]: ${err.message}`);

        const isNamespaceError = err.statusCode === 500 && err.message?.includes('network namespace');
        const isFatal = isNamespaceError || consecutiveFailures >= config.MAX_CONSECUTIVE_FAILURES;

        if (isFatal) {
          const reason = isNamespaceError
            ? 'Docker network namespace error'
            : `${config.MAX_CONSECUTIVE_FAILURES} consecutive failures`;
          logger.error(`FATAL: ${reason} — stopping session window`);
          break;
        }
      }
    } finally {
      await tearDownTestContainers();
    }
  }

  // ── Step 3: Shutdown ──────────────────────────────────────────
  logger.info('\n=== SHUTDOWN sequence ===');
  logger.info('SHUTDOWN: stopping test containers...');
  await tearDownTestContainers();
  logger.info('SHUTDOWN: restoring base containers...');
  await restoreBaseContainers();
  logger.info('SHUTDOWN: resuming qBittorrent...');
  await resumeAll();

  const durationMin = Math.round((Date.now() - windowStart.getTime()) / 60000);
  logger.info(`=== Speed test window END === ${serversTestedThisWindow.length} servers in ${durationMin} min`);
  for (const { serverName, tier } of serversTestedThisWindow) {
    logger.info(`  ✓ ${serverName} — ${tier}`);
  }
}

function start() {
  logger.fn(__filename, 'start', null);

  const speedSchedule = `0 ${config.TEST_START_HOUR} * * *`;
  cron.schedule(speedSchedule, () => {
    runSpeedTestWindow().catch(err => logger.error(`Speed test window unhandled error: ${err.message}`));
  });
  logger.info(`start: speed test cron registered — "${speedSchedule}" (${config.TEST_START_HOUR}:00 AM daily)`);

  cron.schedule('30 * * * *', () => {
    logger.info('Hourly snapshot cron firing...');
    writeHourlySnapshot().catch(err => logger.error(`Hourly snapshot error: ${err.message}`));
  });
  logger.info('start: snapshot cron registered — "30 * * * *" (every hour at :30 past)');
}

module.exports = { start, runSpeedTestWindow };
