const logger = require('./logger');
const { fetchUSServers } = require('./airvpnStatus');
const { pickNextServer } = require('./queueBuilder');
const { switchServer, stopGluetun } = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { loadResults } = require('./resultsWriter');
const { appendServerData, appendRawResult } = require('./rawDataWriter');
const { pauseAll, resumeAll } = require('./qbtClient');

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
    Object.keys(results).forEach(k => {
      results[k].tiers = { low: [], medium: [], high: [], diablo: [] };
    });
    server = pickNextServer(liveServers, results);
  }

  if (!server) return null;

  const serverName = server.public_name;
  logger.info(`CYCLE: ${serverName} | ${server.tier} | ${server.currentload}% | ${server.location}`);

  await switchServer(serverName);
  const timestamp = getESTTimestamp();
  await appendServerData(timestamp, server);

  for (let i = 1; i <= 3; i++) {
    const raw = await runSpeedtest();
    await appendRawResult(`${timestamp}_${i}-3`, raw);
    const dl = (raw.download / 1_000_000).toFixed(2);
    const ul = (raw.upload / 1_000_000).toFixed(2);
    logger.info(`RUN ${i}/3: ↓${dl} Mbps ↑${ul} Mbps`);
    if (i < 3) await new Promise(r => setTimeout(r, 15000));
  }

  if (!results[serverName]) {
    results[serverName] = { tiers: { low: [], medium: [], high: [], diablo: [] } };
  }
  results[serverName].tiers[server.tier].push({ session_id: timestamp });
  return serverName;
}

(async () => {
  await pauseAll();
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
    await stopGluetun();
    await resumeAll();
  }

  logger.info('=== test:infinite END ===');
})();
