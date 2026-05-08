const cron = require('node-cron');
const logger = require('./logger');
const config = require('./config');
const { fetchUSServers, classifyTier } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const { switchServer, stopGluetun } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { writeResults, loadResults, commitResults, ensureGitRepo } = require('./resultsWriter');
const { recalculateAll, calculateAverages } = require('./aggregator');
const { writeHourlySnapshot } = require('./snapshotWriter');
const { pauseAll, resumeAll } = require('./qbtClient');

async function runSpeedTestWindow() {
  logger.fn(__filename, 'runSpeedTestWindow', null);

  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + config.TEST_WINDOW_HOURS * 60 * 60 * 1000);
  logger.info(`=== Speed test window START === ends at ${windowEnd.toISOString()}`);

  await ensureGitRepo();

  // ── Step 1: Pre-flight ────────────────────────────────────────
  logger.info('PRE-FLIGHT: pausing qBittorrent...');
  try {
    await pauseAll();
  } catch (err) {
    logger.warn(`PRE-FLIGHT: qBittorrent pause failed — continuing anyway (${err.message})`);
  }

  logger.info('PRE-FLIGHT: loading existing results...');
  let results = await loadResults();
  logger.info('PRE-FLIGHT: complete');

  // ── Step 2: Per-server test session loop ──────────────────────
  const serversTestedThisWindow = [];

  while (Date.now() < windowEnd.getTime()) {
    logger.info('Fetching live AirVPN status...');
    const liveServers = await fetchUSServers();

    results = await loadResults();
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

      logger.info('SESSION: re-fetching status for session-start snapshot...');
      const freshServers = await fetchUSServers();
      const freshServer = freshServers.find(s => s.public_name === serverName) || server;
      const sessionTier = classifyTier(freshServer.currentload);
      const sessionStart = new Date().toISOString();

      logger.info(`SESSION: tier confirmed as "${sessionTier}" (load: ${freshServer.currentload}%)`);

      if (!results[serverName]) {
        logger.info(`SESSION: first time seeing ${serverName} — initializing result entry`);
        results[serverName] = {
          server_name: serverName,
          city: freshServer.location,
          country: freshServer.country_name,
          country_code: freshServer.country_code,
          ip_v4_in1: freshServer.ip_v4_in1,
          ip_v4_in2: freshServer.ip_v4_in2 || null,
          ip_v4_in3: freshServer.ip_v4_in3 || null,
          ip_v4_in4: freshServer.ip_v4_in4 || null,
          ip_v6_in1: freshServer.ip_v6_in1 || null,
          ip_v6_in2: freshServer.ip_v6_in2 || null,
          ip_v6_in3: freshServer.ip_v6_in3 || null,
          ip_v6_in4: freshServer.ip_v6_in4 || null,
          bw_max: freshServer.bw_max,
          distance_from_cape_coral_km: freshServer.distance_km,
          tiers: { low: [], medium: [], high: [], diablo: [] },
        };
      }

      const tierSessions = results[serverName].tiers[sessionTier];
      const sessionNum = String(tierSessions.length + 1).padStart(3, '0');
      const sessionId = `${serverName}-${sessionTier}-${sessionNum}`;
      logger.info(`SESSION: id=${sessionId}`);

      const session = {
        session_id: sessionId,
        session_start: sessionStart,
        session_end: null,
        status_at_session_start: {
          bw: freshServer.bw,
          bw_max: freshServer.bw_max,
          users: freshServer.users,
          currentload: freshServer.currentload,
          tier: sessionTier,
          available_capacity_mbps: freshServer.available_capacity_mbps,
          health: freshServer.health,
        },
        averages: null,
        runs: [],
      };

      // ── 3 runs ────────────────────────────────────────────────
      for (let runNum = 1; runNum <= config.RUNS_PER_SESSION; runNum++) {
        logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: fetching status snapshot...`);
        const runServers = await fetchUSServers();
        const runServer = runServers.find(s => s.public_name === serverName) || freshServer;

        const statusSnapshot = {
          bw: runServer.bw,
          bw_max: runServer.bw_max,
          users: runServer.users,
          currentload: runServer.currentload,
          available_capacity_mbps: runServer.available_capacity_mbps,
          health: runServer.health,
        };
        logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: server load now ${runServer.currentload}% — running speedtest...`);

        const speedResult = runSpeedtest();

        const run = {
          run: runNum,
          timestamp: new Date().toISOString(),
          download_mbps: speedResult.download_mbps,
          upload_mbps: speedResult.upload_mbps,
          ping_ms: speedResult.ping_ms,
          jitter_ms: speedResult.jitter_ms,
          status_snapshot: statusSnapshot,
        };

        session.runs.push(run);

        // Atomic write after every run
        const existingIdx = results[serverName].tiers[sessionTier]
          .findIndex(s => s.session_id === sessionId);
        if (existingIdx >= 0) {
          results[serverName].tiers[sessionTier][existingIdx] = session;
        } else {
          results[serverName].tiers[sessionTier].push(session);
        }
        await writeResults(results);
        logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: written to results.json`);

        if (runNum < config.RUNS_PER_SESSION) {
          logger.info(`RUN ${runNum}/${config.RUNS_PER_SESSION}: waiting ${config.MS_BETWEEN_RUNS / 1000}s before next run...`);
          await new Promise(resolve => setTimeout(resolve, config.MS_BETWEEN_RUNS));
        }
      }

      // ── Finalize session ──────────────────────────────────────
      session.averages = calculateAverages(session.runs);
      session.session_end = new Date().toISOString();

      const finalIdx = results[serverName].tiers[sessionTier]
        .findIndex(s => s.session_id === sessionId);
      if (finalIdx >= 0) {
        results[serverName].tiers[sessionTier][finalIdx] = session;
      } else {
        results[serverName].tiers[sessionTier].push(session);
      }
      await writeResults(results);

      const finalSessionNum = String(
        results[serverName].tiers[sessionTier].length
      ).padStart(3, '0');
      const commitMsg = `data: ${serverName} ${sessionTier} session ${finalSessionNum} — 3 runs complete`;
      await commitResults(commitMsg);

      serversTestedThisWindow.push({ serverName, tier: sessionTier });
      logger.info(`SESSION: ${serverName} complete ✓`);

    } catch (err) {
      logger.error(`SESSION ERROR [${serverName}]: ${err.message}`);
    }
  }

  // ── Step 3: Shutdown ──────────────────────────────────────────
  logger.info('\n=== SHUTDOWN sequence ===');

  logger.info('SHUTDOWN: recalculating all session averages...');
  results = await loadResults();
  const aggregated = recalculateAll(results);
  await writeResults(aggregated);

  const today = new Date().toISOString().slice(0, 10);
  await commitResults(`chore: recalculate aggregates ${today}`);

  logger.info('SHUTDOWN: stopping gluetun-speedtest...');
  await stopGluetun();

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

  cron.schedule('0 * * * *', () => {
    writeHourlySnapshot().catch(err => logger.error(`Hourly snapshot error: ${err.message}`));
  });
  logger.info('start: snapshot cron registered — "0 * * * *" (every hour on the hour)');
}

module.exports = { start, runSpeedTestWindow };
