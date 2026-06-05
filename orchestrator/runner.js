const logger = require('./logger');
const config = require('./config');
const { fetchUSServers } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const {
  switchServer,
  tearDownSpeedTestingContainers,
  restoreBaseContainers,
  verifyTestContainersRunning,
  captureBaseConfig,
} = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { writeResults, loadResults } = require('./resultsWriter');
const { writeHourlySnapshot } = require('./snapshotWriter');
const { pauseAll, resumeAll } = require('./qbtClient');
const { appendServerData, appendRawResult } = require('./rawDataWriter');

const SECONDS_BETWEEN_RUNS = 10;

// Modes: 'window' = run until TEST_WINDOW_HOURS elapses, 'single' = one cycle, 'infinite' = run until stopped
const MODES = { WINDOW: 'window', SINGLE: 'single', INFINITE: 'infinite' };

function getESTTimestamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

async function run({ mode = MODES.WINDOW } = {}) {
  logger.fn(__filename, 'run()', { mode });

  const windowStart = new Date();
  const windowEnd = mode === MODES.WINDOW
    ? new Date(windowStart.getTime() + config.TEST_WINDOW_HOURS * 60 * 60 * 1000)
    : null;

  if (windowEnd) {
    logger.info(`=== Speed test window START === ends at ${windowEnd.toISOString()}`);
  } else {
    logger.info(`=== Speed test run START === mode: ${mode}`);
  }

  // ── Pre-flight ────────────────────────────────────────────────────
  logger.info('PRE-FLIGHT: pausing qBittorrent...');
  try {
    await pauseAll();
  } catch (err) {
    logger.warn(`PRE-FLIGHT: qBittorrent pause failed — continuing anyway (${err.message})`);
  }

  logger.info('PRE-FLIGHT: loading existing results...');
  const results = await loadResults();

  logger.info('PRE-FLIGHT: capturing base container config...');
  await captureBaseConfig();

  logger.info('PRE-FLIGHT: complete');

  // ── Main loop ─────────────────────────────────────────────────────
  const serversCompleted = [];
  let consecutiveFailures = 0;

  try {
    while (true) {
      // Window mode: stop when time runs out
      if (mode === MODES.WINDOW && Date.now() >= windowEnd.getTime()) {
        logger.info('Window boundary reached — stopping');
        break;
      }

      logger.info('Fetching live AirVPN status...');
      const liveServers = await fetchUSServers();
      let server = pickNextServer(liveServers, results);

      if (!server) {
        if (mode === MODES.INFINITE) {
          logger.info('All servers covered — resetting coverage and continuing');
          results.splice(0, results.length);
          await writeResults(results);
          server = pickNextServer(liveServers, results);
        } else {
          logger.info('No eligible servers — coverage complete, ending');
          break;
        }
      }

      if (!server) break;

      const serverName = server.public_name;
      logger.info(`\n────────────────────────────────────────────`);
      logger.info(`SESSION: ${serverName} | tier: ${server.tier} | load: ${server.currentload}% | ${server.location}`);
      logger.info(`────────────────────────────────────────────`);

      try {
        logger.info(`SESSION: switching gluetun to ${serverName}...`);
        await switchServer(serverName);

        logger.info('SESSION: verifying containers are healthy...');
        await verifyTestContainersRunning();

        const timestamp = getESTTimestamp();
        await appendServerData(timestamp, server);
        logger.info(`SESSION: saved server data with timestamp ${timestamp}`);

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
            logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: waiting ${SECONDS_BETWEEN_RUNS}s...`);
            await new Promise(resolve => setTimeout(resolve, SECONDS_BETWEEN_RUNS * 1000));
          }
        }

        results.push({ server_name: serverName, tier: server.tier, timestamp, run_count: config.RUNS_PER_SESSION });
        await writeResults(results);

        serversCompleted.push({ serverName, tier: server.tier });
        logger.info(`SESSION: ${serverName} complete ✓`);
        consecutiveFailures = 0;

        if (mode === MODES.SINGLE) break;

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
            logger.error(`FATAL: ${reason} — stopping`);
            break;
          }
        }
      } finally {
        await tearDownSpeedTestingContainers();
      }
    }
  } finally {
    // ── Shutdown ──────────────────────────────────────────────────
    logger.info('\n=== SHUTDOWN sequence ===');
    logger.info('SHUTDOWN: stopping test containers...');
    await tearDownSpeedTestingContainers();
    logger.info('SHUTDOWN: restoring base containers...');
    await restoreBaseContainers();
    logger.info('SHUTDOWN: resuming qBittorrent...');
    await resumeAll();
  }

  const durationMin = Math.round((Date.now() - windowStart.getTime()) / 60000);
  logger.info(`=== Speed test run END === ${serversCompleted.length} servers in ${durationMin} min`);
  for (const { serverName, tier } of serversCompleted) {
    logger.info(`  ✓ ${serverName} — ${tier}`);
  }
}

module.exports = { run, MODES };
