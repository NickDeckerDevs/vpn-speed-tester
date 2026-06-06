/*
 * rebuildResults.js — One-shot recovery: rebuild results.json from raw-results.json
 * and server-data.json.
 *
 * Run manually inside the orchestrator container:
 *   docker exec orchestrator node rebuildResults.js
 * or via:
 *   ./vpn rebuild
 *
 * Backs up the existing results.json to results.json.bak-{epoch} before writing.
 * Merges reconstructed sessions with any existing entries (existing wins on
 * timestamp collision), then sorts ascending by timestamp.
 */

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const config = require('./config');
const { writeResults } = require('./resultsWriter');

async function loadJsonOr(pathStr, fallback) {
  try {
    return await fs.readJson(pathStr);
  } catch {
    return fallback;
  }
}

async function rebuild() {
  logger.fn(__filename, 'rebuild', null);

  const raw = await loadJsonOr(config.RAW_RESULTS_PATH, {});
  const serverData = await loadJsonOr(config.SERVER_DATA_PATH, {});
  const existing = await loadJsonOr(config.RESULTS_PATH, []);

  const rawKeys = Object.keys(raw);
  logger.info(`rebuild: raw-results has ${rawKeys.length} run entries; server-data has ${Object.keys(serverData).length} sessions; results.json has ${Array.isArray(existing) ? existing.length : 0} entries`);

  // Group raw keys by leading timestamp (format: {timestamp}_{runNum}-{total})
  const runCounts = new Map();
  for (const key of rawKeys) {
    const timestamp = key.split('_')[0];
    runCounts.set(timestamp, (runCounts.get(timestamp) || 0) + 1);
  }

  const reconstructed = [];
  const missingServerData = [];
  for (const [timestamp, runCount] of runCounts) {
    const server = serverData[timestamp];
    if (!server) {
      missingServerData.push(timestamp);
      continue;
    }
    reconstructed.push({
      server_name: server.public_name,
      tier:        server.tier,
      timestamp,
      run_count:   runCount,
    });
  }

  if (missingServerData.length > 0) {
    logger.warn(`rebuild: ${missingServerData.length} timestamps in raw-results have no server-data entry — skipping: ${missingServerData.slice(0, 5).join(', ')}${missingServerData.length > 5 ? '...' : ''}`);
  }

  // Merge: existing entries take precedence (they may have been hand-corrected,
  // or carry fields the rebuild logic doesn't reproduce).
  const byTimestamp = new Map();
  for (const r of reconstructed) byTimestamp.set(r.timestamp, r);
  if (Array.isArray(existing)) {
    for (const e of existing) {
      if (e && e.timestamp) byTimestamp.set(e.timestamp, e);
    }
  }

  const merged = [...byTimestamp.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );

  // Back up the current file before writeResults overwrites it.
  const backupPath = `${config.RESULTS_PATH}.bak-${Date.now()}`;
  if (await fs.pathExists(config.RESULTS_PATH)) {
    await fs.copy(config.RESULTS_PATH, backupPath);
    logger.info(`rebuild: backed up existing ${path.basename(config.RESULTS_PATH)} to ${path.basename(backupPath)}`);
  } else {
    logger.info('rebuild: no existing results.json to back up');
  }

  await writeResults(merged);
  logger.info(`rebuild: complete — wrote ${merged.length} sessions (reconstructed ${reconstructed.length}, preserved ${Array.isArray(existing) ? existing.length : 0})`);
}

if (require.main === module) {
  rebuild().catch(err => {
    logger.error(`rebuildResults: failed — ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { rebuild };
