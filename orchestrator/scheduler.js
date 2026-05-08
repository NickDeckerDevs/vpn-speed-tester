const cron = require('node-cron');
const logger = require('./logger');
const config = require('./config');
const { fetchUSServers } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const { switchServer, tearDownTestContainers, restoreBaseContainers, ensureSpeedtestRunner, captureBaseConfig } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { writeResults, loadResults } = require('./resultsWriter');
const { writeHourlySnapshot } = require('./snapshotWriter');
const { pauseAll, resumeAll } = require('./qbtClient');
const { appendServerData, appendRawResult } = require('./rawDataWriter');

const SECONDS_BETWEEN_RUNS = 10;

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

  logger.info('PRE-FLIGHT: complete');

  // ── Step 2: Per-server test session loop ──────────────────────
  const serversTestedThisWindow = [];
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 2;

  while (Date.now() < windowEnd.getTime()) {
    logger.info('Fetching live AirVPN status...');
    const liveServers = await fetchUSServers();

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
        const isFatal = isNamespaceError || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

        if (isFatal) {
          const reason = isNamespaceError
            ? 'Docker network namespace error'
            : `${MAX_CONSECUTIVE_FAILURES} consecutive failures`;
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
