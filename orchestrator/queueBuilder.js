function buildQueue(liveServers, results) {
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

  const allDownloads = scored
    .map(s => s.avgDownload)
    .filter(d => d != null);
  const globalMean = allDownloads.length > 0
    ? allDownloads.reduce((a, b) => a + b, 0) / allDownloads.length
    : 0;

  scored.sort((a, b) => {
    if (anyMissingCoverage) {
      if (!a.hasTierCoverage && b.hasTierCoverage) return -1;
      if (a.hasTierCoverage && !b.hasTierCoverage) return 1;
    } else {
      // Priority 4: extreme results first (highest deviation from mean)
      const devA = a.avgDownload != null ? Math.abs(a.avgDownload - globalMean) : 0;
      const devB = b.avgDownload != null ? Math.abs(b.avgDownload - globalMean) : 0;
      if (devA !== devB) return devB - devA;
    }

    if (a.totalSessions !== b.totalSessions) return a.totalSessions - b.totalSessions;

    return a.lastSessionEnd - b.lastSessionEnd;
  });

  return scored.map(s => s.server);
}

module.exports = { buildQueue };
