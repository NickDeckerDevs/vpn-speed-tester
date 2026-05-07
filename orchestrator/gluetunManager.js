const Docker = require('dockerode');
const logger = require('./logger');
const httpClient = require('./httpClient');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function switchServer(serverName) {
  logger.fn(__filename, 'switchServer', { serverName });

  const container = docker.getContainer(config.GLUETUN_CONTAINER);

  logger.info(`switchServer: inspecting ${config.GLUETUN_CONTAINER}...`);
  const info = await container.inspect();

  const newEnv = (info.Config.Env || [])
    .filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

  logger.info(`switchServer: stopping ${config.GLUETUN_CONTAINER}...`);
  try {
    await container.stop({ t: 10 });
    logger.info('switchServer: container stopped');
  } catch (err) {
    if (err.statusCode === 304 || err.statusCode === 409) {
      logger.debug('switchServer: container was already stopped');
    } else {
      throw err;
    }
  }

  logger.info('switchServer: removing old container...');
  await container.remove();
  logger.info('switchServer: container removed');

  logger.info(`switchServer: creating new container with SERVER_NAMES=${serverName}...`);
  const newContainer = await docker.createContainer({
    name: config.GLUETUN_CONTAINER,
    Image: info.Config.Image,
    Env: newEnv,
    ExposedPorts: info.Config.ExposedPorts,
    HostConfig: info.HostConfig,
  });

  await newContainer.start();
  logger.info(`switchServer: container started → ${serverName}`);

  logger.info('switchServer: restarting speedtest-runner to attach to new gluetun namespace...');
  const speedtestContainer = docker.getContainer(config.SPEEDTEST_CONTAINER);
  await speedtestContainer.restart();
  logger.info('switchServer: speedtest-runner restarted');
  await new Promise(resolve => setTimeout(resolve, 3000));
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
