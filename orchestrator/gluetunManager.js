const Docker = require('dockerode');
const axios = require('axios');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function switchServer(serverName) {
  const container = docker.getContainer(config.GLUETUN_CONTAINER);
  const info = await container.inspect();

  const newEnv = (info.Config.Env || [])
    .filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

  try {
    await container.stop({ t: 10 });
  } catch (err) {
    // 304 = already stopped; anything else is real
    if (err.statusCode !== 304 && err.statusCode !== 409) throw err;
  }

  await container.remove();

  const newContainer = await docker.createContainer({
    name: config.GLUETUN_CONTAINER,
    Image: info.Config.Image,
    Env: newEnv,
    ExposedPorts: info.Config.ExposedPorts,
    HostConfig: info.HostConfig,
  });

  await newContainer.start();
}

async function waitForTunnel() {
  const deadline = Date.now() + config.TUNNEL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await axios.get(config.TUNNEL_CHECK_URL, {
        timeout: config.TUNNEL_POLL_MS,
      });
      if (response.status === 200 && response.data) return response.data;
    } catch {
      // Not connected yet — keep polling
    }
    await new Promise(resolve => setTimeout(resolve, config.TUNNEL_POLL_MS));
  }

  throw new Error(`Tunnel not established after ${config.TUNNEL_TIMEOUT_MS / 1000}s`);
}

async function stopGluetun() {
  const container = docker.getContainer(config.GLUETUN_CONTAINER);
  try {
    await container.stop({ t: 10 });
  } catch {
    // Already stopped
  }
}

module.exports = { switchServer, waitForTunnel, stopGluetun };
