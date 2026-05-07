const cron = require('node-cron');
const config = require('./config');
const { fetchUSServers, classifyTier } = require('./airvpnStatus');
const { buildQueue } = require('./queueBuilder');
const { switchServer, waitForTunnel, stopGluetun } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { writeResults, loadResults, commitResults, ensureGitRepo } = require('./resultsWriter');
const { recalculateAll, calculateAverages } = require('./aggregator');
const { writeHourlySnapshot } = require('./snapshotWriter');
const { pauseAll, resumeAll } = require('./qbtClient');

async function runSpeedTestWindow() {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + config.TEST_WINDOW_HOURS * 60 * 60 * 1000);

  console.log(`[${windowStart.toISOString()}] Speed test window started. Ends at ${windowEnd.toISOString()}`);

  await ensureGitRepo();

  // Step 1: Pre-flight
  await pauseAll();

  const liveServers = await fetchUSServers();
  console.log(`Found ${liveServers.length} healthy US servers`);

  let results = await loadResults();
  const queue = buildQueue(liveServers, results);

  // Step 2: Per-server test session loop
  const serversTestedThisWindow = [];

  for (const server of queue) {
    if (Date.now() >= windowEnd.getTime()) {
      console.log('Test window ended before next session — stopping');
      break;
    }

    const serverName = server.public_name;
    console.log(`\n--- Testing: ${serverName} (${server.tier} tier, load: ${server.currentload}%) ---`);

    try {
      await switchServer(serverName);
      await waitForTunnel();

      // Re-fetch status for accurate session-start snapshot
      const freshServers = await fetchUSServers();
      const freshServer = freshServers.find(s => s.public_name === serverName) || server;
      const sessionTier = classifyTier(freshServer.currentload);
      const sessionStart = new Date().toISOString();

      if (!results[serverName]) {
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

      // Run 3 speed tests in sequence
      for (let runNum = 1; runNum <= config.RUNS_PER_SESSION; runNum++) {
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

        // Write immediately after each run (atomic)
        const existingIdx = results[serverName].tiers[sessionTier]
          .findIndex(s => s.session_id === sessionId);
        if (existingIdx >= 0) {
          results[serverName].tiers[sessionTier][existingIdx] = session;
        } else {
          results[serverName].tiers[sessionTier].push(session);
        }
        await writeResults(results);

        console.log(
          `  Run ${runNum}/${config.RUNS_PER_SESSION}: ` +
          `${speedResult.download_mbps} Mbps ↓  ${speedResult.upload_mbps} Mbps ↑  ` +
          `${speedResult.ping_ms}ms ping`
        );

        if (runNum < config.RUNS_PER_SESSION) {
          await new Promise(resolve => setTimeout(resolve, config.MS_BETWEEN_RUNS));
        }
      }

      // Finalize session with averages
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
      await commitResults(
        `data: ${serverName} ${sessionTier} session ${finalSessionNum} — 3 runs complete`
      );

      serversTestedThisWindow.push({ serverName, tier: sessionTier });

    } catch (err) {
      console.error(`Error testing ${serverName}:`, err.message);
    }
  }

  // Step 3: Shutdown
  console.log('\n--- Shutdown sequence ---');

  results = await loadResults();
  const aggregated = recalculateAll(results);
  await writeResults(aggregated);

  const today = new Date().toISOString().slice(0, 10);
  await commitResults(`chore: recalculate aggregates ${today}`);

  await stopGluetun();
  await resumeAll();

  const durationMin = Math.round((Date.now() - windowStart.getTime()) / 60000);
  console.log(
    `\nWindow complete: ${serversTestedThisWindow.length} servers tested in ${durationMin} minutes`
  );
  for (const { serverName, tier } of serversTestedThisWindow) {
    console.log(`  ${serverName}: ${tier}`);
  }
}

function start() {
  const schedule = `0 ${config.TEST_START_HOUR} * * *`;

  cron.schedule(schedule, () => {
    runSpeedTestWindow().catch(err => console.error('Speed test window error:', err));
  });

  cron.schedule('0 * * * *', () => {
    writeHourlySnapshot().catch(err => console.error('Snapshot error:', err));
  });

  console.log(
    `Scheduler started. Speed tests at ${config.TEST_START_HOUR}:00 AM daily, snapshots every hour.`
  );
}

module.exports = { start, runSpeedTestWindow };
