const logger = require('./logger');
const { fetchUSServers } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const { switchServer, tearDownTestContainers, restoreBaseContainers, captureBaseConfig } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { loadResults, writeResults } = require('./resultsWriter');
const { appendServerData, appendRawResult } = require('./rawDataWriter');
const { pauseAll, resumeAll } = require('./qbtClient');

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

async function runCycle(results) {
  const liveServers = await fetchUSServers();
  let server = pickNextServer(liveServers, results);

  if (!server) {
    logger.info('All servers covered — resetting coverage and restarting cycle');
    results.splice(0, results.length);
    await writeResults(results);
    server = pickNextServer(liveServers, results);
  }

  if (!server) return null;

  const serverName = server.public_name;
  logger.info(`CYCLE: ${serverName} | ${server.tier} | ${server.currentload}% | ${server.location}`);

  try {
    await switchServer(serverName);
    const timestamp = getESTTimestamp();
    await appendServerData(timestamp, server);

    for (let i = 1; i <= 3; i++) {
      const raw = await runSpeedtest();
      await appendRawResult(`${timestamp}_${i}-3`, raw);
      const dl = (raw.download / 1_000_000).toFixed(2);
      const ul = (raw.upload / 1_000_000).toFixed(2);
      logger.info(`RUN ${i}/3: ↓${dl} Mbps ↑${ul} Mbps`);
      if (i < 3) await new Promise(r => setTimeout(r, SECONDS_BETWEEN_RUNS * 1000));
    }

    results.push({ server_name: serverName, tier: server.tier, timestamp, run_count: 3 });
    await writeResults(results);
    return serverName;
  } finally {
    await tearDownTestContainers();
  }
}

(async () => {
  await pauseAll();
  await captureBaseConfig();
  const results = await loadResults();
  let consecutiveFailures = 0;
  logger.info('=== test:infinite START ===');

  try {
    while (true) {
      try {
        await runCycle(results);
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        logger.error(`CYCLE ERROR: ${err.message}`);
        if (consecutiveFailures >= 3) {
          logger.error('3 consecutive failures — stopping infinite runner');
          break;
        }
      }
    }
  } finally {
    await tearDownTestContainers();
    await restoreBaseContainers();
    await resumeAll();
  }

  logger.info('=== test:infinite END ===');
})();
