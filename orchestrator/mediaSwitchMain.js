/*
 * mediaSwitchMain.js — runnable entry for the media-stack VPN switch.
 *
 * Wires the pure orchestration in mediaSwitch.js to real Docker + qBittorrent,
 * reusing the proven primitives from gluetunManager.js (tearDown / getEnv /
 * startGluetunTunnel / waitForTunnel) and qbtClient.js (pauseAll / resumeAll).
 *
 * Runs INSIDE an orchestrator container that has the docker socket mounted and sits
 * on the same network as gluetun (like validationMain.js). Manual trigger only —
 * the operator names the server:  node mediaSwitchMain.js <SERVER_NAME>
 * (driven from the laptop via `./vpn media-switch <server>`).
 *
 * Env (set by docker-compose.mediaswitch.desktop.yml):
 *   GLUETUN_CONTAINER       — the VPN container name (e.g. "gluetun")
 *   GLUETUN_CONTROL_URL     — its control-API status endpoint
 *   MEDIA_SWITCH_SKIP_QBT   — "true" on the placeholder stand-in (no real qBittorrent)
 *
 * Changelog
 * 2026-06-07  created — Phase 2 of the media-stack VPN switch plan
 */

const Docker = require('dockerode');
const gluetun = require('./gluetunManager');
const qbt = require('./qbtClient');
const config = require('./config');
const logger = require('./logger');
const { switchMediaServer, riderCreateSpec } = require('./mediaSwitch');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const SKIP_QBT = process.env.MEDIA_SWITCH_SKIP_QBT === 'true';

// Every container, shaped for discoverRiders(): { name, networkMode, info }.
async function inspectAll() {
  logger.fn(__filename, 'inspectAll', null);
  const list = await docker.listContainers({ all: true });
  const out = [];
  for (const c of list) {
    try {
      const info = await docker.getContainer(c.Id).inspect();
      out.push({
        name: (info.Name || '').replace(/^\//, ''),
        networkMode: info.HostConfig.NetworkMode,
        info,
      });
    } catch (err) {
      logger.warn(`inspectAll: inspect ${c.Id} failed — ${err.message}`);
    }
  }
  return out;
}

// Reuse the gluetun primitives: capture base config, tear down, recreate on the new
// SERVER_NAMES, and return the new container id (riders re-pin to it).
async function recreateGluetun(serverName) {
  logger.fn(__filename, 'recreateGluetun', { serverName });
  const base = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
  await gluetun.tearDown(serverName, config.GLUETUN_CONTAINER, true);
  const newEnv = gluetun.getEnv(base.Config.Env || [], serverName);
  const newGluetun = await gluetun.startGluetunTunnel(serverName, base, newEnv);
  return newGluetun.id;
}

async function recreateRider(info, newGluetunId) {
  const spec = riderCreateSpec(info, newGluetunId);
  const c = await docker.createContainer(spec);
  await c.start();
}

/**
 * Build the dependency object switchMediaServer() needs, wiring the pure switch to
 * real Docker + gluetunManager + qBittorrent. Shared by the one-shot CLI here and by
 * switchDeciderMain.js's loop so both perform switches identically.
 *
 * gluetunRef : { id, name } of the CURRENT gluetun container (fetch fresh per switch —
 *              it's used for rider discovery against that container's netns).
 */
function buildSwitchDeps(gluetunRef, { skipQbt = SKIP_QBT } = {}) {
  return {
    pauseQbt:  skipQbt ? async () => logger.info('mediaSwitch: skip qBittorrent pause (stand-in)')  : qbt.pauseAll,
    resumeQbt: skipQbt ? async () => logger.info('mediaSwitch: skip qBittorrent resume (stand-in)') : qbt.resumeAll,
    inspectAll,
    gluetun: gluetunRef,
    stopContainer: name => gluetun.tearDown(null, name, true),
    recreateGluetun,
    waitForTunnel: gluetun.waitForTunnel,
    recreateRider,
    log: msg => logger.info(`mediaSwitch: ${msg}`),
  };
}

async function main() {
  const serverName = process.argv[2];
  if (!serverName) {
    console.error('Usage: node mediaSwitchMain.js <SERVER_NAME>');
    process.exit(1);
  }

  logger.info(`mediaSwitchMain: switching ${config.GLUETUN_CONTAINER} → ${serverName} (skipQbt=${SKIP_QBT})`);

  // Current gluetun, used for rider discovery (riders ride this container's netns).
  const gInfo = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
  const gluetunRef = { id: gInfo.Id, name: config.GLUETUN_CONTAINER };

  await switchMediaServer(serverName, buildSwitchDeps(gluetunRef));

  logger.info(`mediaSwitchMain: switch to ${serverName} complete`);
}

// Only run the one-shot switch when invoked directly; switchDeciderMain.js requires
// this module to reuse buildSwitchDeps + the docker helpers without triggering a switch.
if (require.main === module) {
  main().catch(err => {
    logger.error(`mediaSwitchMain: fatal — ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildSwitchDeps, inspectAll, recreateGluetun, recreateRider, docker };
