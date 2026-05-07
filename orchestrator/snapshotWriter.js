const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const { fetchUSServers } = require('./airvpnStatus');
const config = require('./config');

const git = simpleGit(config.GIT_REPO_PATH);

async function updateSnapshotIndex(filename) {
  const indexPath = path.join(config.SNAPSHOTS_PATH, 'index.json');
  let index = [];
  try {
    index = await fs.readJson(indexPath);
  } catch {
    // First snapshot — start fresh
  }
  if (!index.includes(filename)) {
    index.push(filename);
    await fs.writeJson(indexPath, index, { spaces: 2 });
  }
}

async function writeHourlySnapshot() {
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

  // YYYY-MM-DD-HH
  const dateStr = now.toISOString().slice(0, 13).replace('T', '-');
  const filename = `${dateStr}.json`;
  const filePath = path.join(config.SNAPSHOTS_PATH, filename);

  await fs.ensureDir(config.SNAPSHOTS_PATH);
  await fs.writeJson(filePath, snapshot, { spaces: 2 });
  await updateSnapshotIndex(filename);

  await git.add([filePath, path.join(config.SNAPSHOTS_PATH, 'index.json')]);
  await git.commit(`snapshot: US server load ${now.toISOString()}`, { '--allow-empty': null });

  console.log(`Snapshot written: ${filename} (${servers.length} servers)`);
}

module.exports = { writeHourlySnapshot };
