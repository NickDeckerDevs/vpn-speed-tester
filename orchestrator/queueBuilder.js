const logger = require('./logger');

function pickNextServer(liveServers, results) {
  logger.fn(__filename, 'pickNextServer', {
    liveServerCount: liveServers.length,
    resultsServerCount: Object.keys(results).length,
  });

  const scored = liveServers.map(server => {
    const name = server.public_name;
    const serverData = results[name];
    const currentTier = server.tier;

    let hasTierCoverage = false;
    let totalSessions = 0;
    let lastSessionEnd = 0;
    const downloadAverages = [];

    if (serverData && serverData.tiers) {
      const tierArr = serverData.tiers[currentTier] || [];
      hasTierCoverage = tierArr.length > 0;

      for (const sessions of Object.values(serverData.tiers)) {
        for (const session of sessions) {
          totalSessions++;
          if (session.session_end) {
            const t = new Date(session.session_end).getTime();
            if (t > lastSessionEnd) lastSessionEnd = t;
          }
          if (session.averages?.download_mbps != null) {
            downloadAverages.push(session.averages.download_mbps);
          }
        }
      }
    }

    const avgDownload = downloadAverages.length > 0
      ? downloadAverages.reduce((a, b) => a + b, 0) / downloadAverages.length
      : null;

    return { server, hasTierCoverage, totalSessions, lastSessionEnd, avgDownload };
  });

  const anyMissingCoverage = scored.some(s => !s.hasTierCoverage);

  if (!anyMissingCoverage) {
    logger.info('pickNextServer: all servers have current-tier coverage — coverage complete');
    return null;
  }

  const allDownloads = scored.map(s => s.avgDownload).filter(d => d != null);
  const globalMean = allDownloads.length > 0
    ? allDownloads.reduce((a, b) => a + b, 0) / allDownloads.length
    : 0;

  logger.info(`pickNextServer: anyMissingCoverage=true, globalMeanDownload=${globalMean.toFixed(1)} Mbps`);

  scored.sort((a, b) => {
    if (!a.hasTierCoverage && b.hasTierCoverage) return -1;
    if (a.hasTierCoverage && !b.hasTierCoverage) return 1;

    if (a.totalSessions !== b.totalSessions) return a.totalSessions - b.totalSessions;

    return a.lastSessionEnd - b.lastSessionEnd;
  });

  const best = scored[0].server;
  logger.info(`pickNextServer: selected ${best.public_name} (tier: ${best.tier}, load: ${best.currentload}%)`);
  return best;
}

module.exports = { pickNextServer };
