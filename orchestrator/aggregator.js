const logger = require('./logger');

function calculateAverages(runs) {
  logger.fn(__filename, 'calculateAverages', { runCount: runs?.length });

  if (!runs || runs.length === 0) {
    logger.warn('calculateAverages: no runs provided — returning null');
    return null;
  }

  const count = runs.length;
  const sums = runs.reduce(
    (acc, run) => ({
      download_mbps: acc.download_mbps + run.download_mbps,
      upload_mbps:   acc.upload_mbps   + run.upload_mbps,
      ping_ms:       acc.ping_ms       + run.ping_ms,
      jitter_ms:     acc.jitter_ms     + run.jitter_ms,
    }),
    { download_mbps: 0, upload_mbps: 0, ping_ms: 0, jitter_ms: 0 }
  );

  const avgDownload = parseFloat((sums.download_mbps / count).toFixed(2));
  const avgUpload   = parseFloat((sums.upload_mbps   / count).toFixed(2));
  const avgPing     = parseFloat((sums.ping_ms       / count).toFixed(2));
  const avgJitter   = parseFloat((sums.jitter_ms     / count).toFixed(2));

  const lastRun = runs[runs.length - 1];
  const available = lastRun?.status_snapshot?.available_capacity_mbps;
  const speedEfficiencyRatio = available
    ? parseFloat((avgDownload / available).toFixed(3))
    : null;

  logger.info(
    `calculateAverages: ↓${avgDownload} Mbps  ↑${avgUpload} Mbps  ` +
    `ping ${avgPing}ms  efficiency ${speedEfficiencyRatio ?? 'n/a'}`
  );

  return {
    download_mbps: avgDownload,
    upload_mbps:   avgUpload,
    ping_ms:       avgPing,
    jitter_ms:     avgJitter,
    speed_efficiency_ratio: speedEfficiencyRatio,
  };
}

function recalculateAll(results) {
  const serverCount = Object.keys(results).length;
  logger.fn(__filename, 'recalculateAll', { serverCount });

  const updated = JSON.parse(JSON.stringify(results));
  let sessionCount = 0;

  for (const server of Object.values(updated)) {
    if (!server.tiers) continue;
    for (const sessions of Object.values(server.tiers)) {
      for (const session of sessions) {
        if (session.runs && session.runs.length > 0) {
          session.averages = calculateAverages(session.runs);
          sessionCount++;
        }
      }
    }
  }

  logger.info(`recalculateAll: recalculated ${sessionCount} sessions across ${serverCount} servers`);
  return updated;
}

module.exports = { recalculateAll, calculateAverages };
