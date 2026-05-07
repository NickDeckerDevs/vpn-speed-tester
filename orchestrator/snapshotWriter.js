const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const { fetchUSServers } = require('./airvpnStatus');
const logger = require('./logger');
const config = require('./config');

const git = simpleGit(config.GIT_REPO_PATH);

async function updateSnapshotIndex(filename) {
  logger.fn(__filename, 'updateSnapshotIndex', { filename });
  const indexPath = path.join(config.SNAPSHOTS_PATH, 'index.json');
  let index = [];
  try {
    index = await fs.readJson(indexPath);
  } catch {
    logger.debug('updateSnapshotIndex: no existing index — creating new one');
  }
  if (!index.includes(filename)) {
    index.push(filename);
    await fs.writeJson(indexPath, index, { spaces: 2 });
    logger.info(`updateSnapshotIndex: index now has ${index.length} entries`);
  } else {
    logger.debug(`updateSnapshotIndex: ${filename} already in index`);
  }
}

async function writeHourlySnapshot() {
  logger.fn(__filename, 'writeHourlySnapshot', null);

  const now = new Date();
  const servers = await fetchUSServers();

  const snapshot = {
    snapshot_time: now.toISOString(),
    us_server_count: servers.length,
    us_servers: servers.map(s => ({
      server_name: s.public_name,
      city: s.location,
      bw: s.bw,
      bw_max: s.bw_max,
      users: s.users,
      currentload: s.currentload,
      available_capacity_mbps: s.available_capacity_mbps,
      tier: s.tier,
      health: s.health,
    })),
  };

  const dateStr = now.toISOString().slice(0, 13).replace('T', '-');
  const filename = `${dateStr}.json`;
  const filePath = path.join(config.SNAPSHOTS_PATH, filename);

  await fs.ensureDir(config.SNAPSHOTS_PATH);
  await fs.writeJson(filePath, snapshot, { spaces: 2 });
  logger.info(`writeHourlySnapshot: wrote ${filename} (${servers.length} servers)`);

  await updateSnapshotIndex(filename);

  const indexPath = path.join(config.SNAPSHOTS_PATH, 'index.json');
  await git.add([filePath, indexPath]);
  await git.commit(`snapshot: US server load ${now.toISOString()}`, { '--allow-empty': null });
  logger.info(`writeHourlySnapshot: committed snapshot to git`);
}

module.exports = { writeHourlySnapshot };
