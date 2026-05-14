const logger = require('./logger');

function pickNextServer(liveServers, results) {
  logger.fn(__filename, 'pickNextServer', {
    liveServerCount: liveServers.length,
    resultsSessionCount: results.length,
  });

  const scored = liveServers.map(server => {
    const name = server.public_name;
    const currentTier = server.tier;

    const tierSessions = results.filter(s => s.server_name === name && s.tier === currentTier);
    const hasTierCoverage = tierSessions.length > 0;
    const totalSessions = results.filter(s => s.server_name === name).length;
    const lastTimestamp = tierSessions.length > 0
      ? Math.max(...tierSessions.map(s => parseInt(s.timestamp, 10)))
      : 0;

    return { server, hasTierCoverage, totalSessions, lastTimestamp };
  });

  const anyMissingCoverage = scored.some(s => !s.hasTierCoverage);

  if (!anyMissingCoverage) {
    logger.info('pickNextServer: all servers have current-tier coverage — coverage complete');
    return null;
  }

  logger.info('pickNextServer: anyMissingCoverage=true');

  scored.sort((a, b) => {
    if (!a.hasTierCoverage && b.hasTierCoverage) return -1;
    if (a.hasTierCoverage && !b.hasTierCoverage) return 1;
    if (a.totalSessions !== b.totalSessions) return a.totalSessions - b.totalSessions;
    return a.lastTimestamp - b.lastTimestamp;
  });

  const best = scored[0].server;
  logger.info(`pickNextServer: selected ${best.public_name} (tier: ${best.tier}, load: ${best.currentload}%)`);
  return best;
}

module.exports = { pickNextServer };
