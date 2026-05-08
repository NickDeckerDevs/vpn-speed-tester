const Docker = require('dockerode');
const logger = require('./logger');
const httpClient = require('./httpClient');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function switchServer(serverName) {
  logger.fn(__filename, 'switchServer', { serverName });

  // ── Step 1: Tear down speedtest-runner first ──────────────────
  // Must stop/remove so Docker can re-resolve network_mode to the new gluetun container ID.
  // A restart() reuses the stale container ID baked in at creation time and always fails.
  const speedtestC = docker.getContainer(config.SPEEDTEST_CONTAINER);
  let speedtestInfo = null;
  try {
    speedtestInfo = await speedtestC.inspect();
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    logger.debug('switchServer: speedtest-runner not found, skipping teardown');
  }

  if (speedtestInfo) {
    logger.info(`switchServer: stopping ${config.SPEEDTEST_CONTAINER}...`);
    try {
      await speedtestC.stop({ t: 10 });
    } catch (err) {
      if (err.statusCode !== 304 && err.statusCode !== 409) throw err;
    }
    logger.info(`switchServer: removing ${config.SPEEDTEST_CONTAINER}...`);
    await speedtestC.remove();
    logger.info('switchServer: speedtest-runner removed');
  }

  // ── Step 2: Tear down gluetun-speedtest ───────────────────────
  const gluetunC = docker.getContainer(config.GLUETUN_CONTAINER);
  logger.info(`switchServer: stopping ${config.GLUETUN_CONTAINER}...`);
  const gluetunInfo = await gluetunC.inspect();

  const newEnv = (gluetunInfo.Config.Env || [])
    .filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

  try {
    await gluetunC.stop({ t: 10 });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 409) throw err;
  }
  logger.info(`switchServer: removing ${config.GLUETUN_CONTAINER}...`);
  await gluetunC.remove();
  logger.info('switchServer: gluetun-speedtest removed');

  // ── Step 3: Create + start new gluetun-speedtest ─────────────
  logger.info(`switchServer: creating new gluetun-speedtest → ${serverName}...`);
  const newGluetun = await docker.createContainer({
    name: config.GLUETUN_CONTAINER,
    Image: gluetunInfo.Config.Image,
    Env: newEnv,
    ExposedPorts: gluetunInfo.Config.ExposedPorts,
    HostConfig: gluetunInfo.HostConfig,
  });
  await newGluetun.start();
  logger.info(`switchServer: container started → ${serverName}`);

  // ── Step 4: Wait for tunnel before attaching speedtest-runner ─
  await waitForTunnel();

  // ── Step 5: Recreate speedtest-runner (fresh namespace resolution) ─
  if (speedtestInfo) {
    logger.info('switchServer: creating new speedtest-runner...');
    const newSpeedtest = await docker.createContainer({
      name: config.SPEEDTEST_CONTAINER,
      Image: speedtestInfo.Config.Image,
      Env: speedtestInfo.Config.Env,
      ExposedPorts: speedtestInfo.Config.ExposedPorts,
      HostConfig: speedtestInfo.HostConfig,
    });
    await newSpeedtest.start();
    logger.info('switchServer: speedtest-runner ready');
  }
}

async function waitForTunnel() {
  logger.fn(__filename, 'waitForTunnel', { timeoutMs: config.TUNNEL_TIMEOUT_MS });

  const deadline = Date.now() + config.TUNNEL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const elapsed = Math.round((config.TUNNEL_TIMEOUT_MS - (deadline - Date.now())) / 1000);
    logger.debug(`waitForTunnel: attempt ${attempt} (+${elapsed}s elapsed)...`);

    try {
      const data = await httpClient.get(
        config.GLUETUN_CONTROL_URL,
        { timeout: config.TUNNEL_POLL_MS },
        'tunnel check'
      );
      if (data && data.status === 'running') {
        logger.info(`waitForTunnel: tunnel confirmed after ${attempt} attempt(s)`);
        return data;
      }
      logger.debug(`waitForTunnel: gluetun status = ${data && data.status}`);
    } catch (err) {
      logger.debug(`waitForTunnel: not ready (${err.message.replace(/^\[tunnel check\] /, '')})`);
    }

    await new Promise(resolve => setTimeout(resolve, config.TUNNEL_POLL_MS));
  }

  throw new Error(`Tunnel not established after ${config.TUNNEL_TIMEOUT_MS / 1000}s (${attempt} attempts)`);
}

async function stopGluetun() {
  logger.fn(__filename, 'stopGluetun', null);
  const container = docker.getContainer(config.GLUETUN_CONTAINER);
  try {
    await container.stop({ t: 10 });
    logger.info('stopGluetun: container stopped');
  } catch (err) {
    logger.warn(`stopGluetun: stop failed (already stopped?) — ${err.message}`);
  }
}

module.exports = { switchServer, waitForTunnel, stopGluetun };
