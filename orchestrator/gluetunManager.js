const Docker = require('dockerode');
const logger = require('./logger');
const httpClient = require('./httpClient');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const GLUETUN_TUNNEL_CHECK_DELAY_TIME = 6000; // ms to wait before first tunnel poll (avoids guaranteed ECONNREFUSED on startup)

let _baseGluetunInfo = null;
let _baseSpeedtestImage = null;
let _baseSpeedtestBinds = null;

async function getOrchestratorImage() {
  const orch = docker.getContainer('orchestrator');
  const info = await orch.inspect();
  logger.debug(`getOrchestratorImage: using image ${info.Config.Image}`);
  return info.Config.Image;
}

// Logs all containers (running + stopped) with name, state, and created time in EST.
async function logContainerStatus() {
  try {
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      const name = (c.Names[0] || '').replace(/^\//, '');
      const created = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true,
      }).format(new Date(c.Created * 1000));
      logger.info(`[container-status] ${name.padEnd(24)} | ${c.State.padEnd(8)} | created: ${created} EST`);
    }
  } catch (err) {
    logger.warn(`logContainerStatus: failed — ${err.message}`);
  }
}

// Logs the error, pulls container logs if containerName is given, then dumps container status.
async function logDockerError(context, err, containerName) {
  const code = err.statusCode ? ` [${err.statusCode}]` : '';
  logger.error(`${context}${code}: ${err.message}`);
  if (containerName) {
    try {
      const raw = await docker.getContainer(containerName).logs({
        stdout: true, stderr: true, tail: 20,
      });
      // Docker multiplexes stdout/stderr — strip the 8-byte header from each frame
      const text = raw.toString('utf8')
        .split('\n')
        .map(line => line.length > 8 ? line.slice(8) : line)
        .filter(Boolean)
        .join(' | ');
      if (text) logger.error(`[${containerName} logs] ${text}`);
    } catch (_) {}
  }
  await logContainerStatus();
}

const getEnv = (gluetunEnv, serverName) =>
  gluetunEnv.filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

// Polls until the container is fully gone (404). On timeout, tries force-remove then polls once more.
async function waitForContainerRemoved(containerName, timeoutMs = 15000) {
  logger.debug(`waitForContainerRemoved: waiting for ${containerName} to be removed...`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await docker.getContainer(containerName).inspect();
    } catch (err) {
      if (err.statusCode === 404) {
        logger.debug(`waitForContainerRemoved: ${containerName} confirmed gone`);
        return;
      }
      throw err;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.warn(`waitForContainerRemoved: ${containerName} still present after ${timeoutMs / 1000}s — attempting force remove`);
  await logContainerStatus();

  try {
    await docker.getContainer(containerName).remove({ force: true });
  } catch (err) {
    if (err.statusCode !== 404) logger.warn(`waitForContainerRemoved: force remove failed — ${err.message}`);
  }

  // One final poll after force-remove
  const finalDeadline = Date.now() + 5000;
  while (Date.now() < finalDeadline) {
    try {
      await docker.getContainer(containerName).inspect();
    } catch (err) {
      if (err.statusCode === 404) {
        logger.info(`waitForContainerRemoved: ${containerName} removed after force-remove`);
        return;
      }
      throw err;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error(`waitForContainerRemoved: ${containerName} still exists after force-remove`);
}

// Stops and removes a container, then confirms it is gone before returning.
async function tearDownDockerContainer(containerName) {
  logger.fn(__filename, 'tearDownDockerContainer()', { containerName });
  let dockerContainer = null;
  let containerFound = false;

  try {
    dockerContainer = docker.getContainer(containerName);
    await dockerContainer.inspect();
    containerFound = true;
  } catch (err) {
    if (err.statusCode === 404) {
      logger.debug(`tearDownDockerContainer: ${containerName} not found — nothing to tear down`);
      return;
    }
    await logDockerError(`tearDownDockerContainer: inspect ${containerName}`, err, containerName);
    throw err;
  }

  if (containerFound) {
    try {
      await dockerContainer.stop({ t: 10 });
    } catch (err) {
      if (err.statusCode !== 304 && err.statusCode !== 409) {
        await logDockerError(`tearDownDockerContainer: stop ${containerName}`, err, containerName);
        throw err;
      }
    }
    try {
      await dockerContainer.remove();
    } catch (err) {
      if (err.statusCode !== 404) {
        await logDockerError(`tearDownDockerContainer: remove ${containerName}`, err, containerName);
      }
    }
    await waitForContainerRemoved(containerName);
  }
}

// Creates and starts the gluetun container, retrying up to maxAttempts times
// while waiting for the VPN tunnel to establish after each start.
async function startGluetunTunnel(serverName, gluetunContainerInfo, newEnv, maxAttempts) {
  logger.fn(__filename, 'startGluetunTunnel()', { serverName });
  const MAX_GLUETUN_ATTEMPTS = maxAttempts || 3;
  let newGluetun = null;

  for (let attempt = 1; attempt <= MAX_GLUETUN_ATTEMPTS; attempt++) {
    if (newGluetun) {
      try { await newGluetun.remove({ force: true }); } catch (_) {}
      newGluetun = null;
    }

    logger.info(`startGluetunTunnel: attempt ${attempt}/${MAX_GLUETUN_ATTEMPTS}...`);
    try {
      newGluetun = await docker.createContainer({
        name: config.GLUETUN_CONTAINER,
        Image: gluetunContainerInfo.Config.Image,
        Env: newEnv,
        ExposedPorts: gluetunContainerInfo.Config.ExposedPorts,
        HostConfig: { ...gluetunContainerInfo.HostConfig, RestartPolicy: { Name: '' } },
      });
      await newGluetun.start();
    } catch (err) {
      await logDockerError(`startGluetunTunnel: create/start attempt ${attempt}`, err, config.GLUETUN_CONTAINER);
      throw err;
    }

    try {
      await waitForTunnel();
      break;
    } catch (err) {
      logger.warn(`startGluetunTunnel: tunnel attempt ${attempt}/${MAX_GLUETUN_ATTEMPTS} failed — ${err.message}`);
      if (attempt >= MAX_GLUETUN_ATTEMPTS) {
        throw new Error(`Tunnel failed after ${MAX_GLUETUN_ATTEMPTS} attempts for ${serverName}: ${err.message}`);
      }
      logger.info('startGluetunTunnel: retrying in 5s...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  return newGluetun;
}

// Creates, starts, and polls speedtest-runner until it is running (max 30s).
async function startSpeedtestContainer(image, binds, gluetunId, restartPolicy = { Name: '' }) {
  logger.fn(__filename, 'startSpeedtestContainer()', { image, gluetunId });
  const newSpeedtest = await docker.createContainer({
    name: config.SPEEDTEST_CONTAINER,
    Image: image,
    Entrypoint: [],
    Cmd: ['sleep', 'infinity'],
    HostConfig: {
      Binds: binds,
      NetworkMode: `container:${gluetunId}`,
      RestartPolicy: restartPolicy,
    },
  });
  await newSpeedtest.start();

  const deadline = Date.now() + 30000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const info = await newSpeedtest.inspect();
      logger.debug(`startSpeedtestContainer: attempt ${attempt} — state=${info.State.Status} running=${info.State.Running}`);
      if (info.State.Running) break;
      if (info.State.Status === 'exited' || info.State.Status === 'dead') {
        throw new Error(`speedtest-runner failed to start (status: ${info.State.Status})`);
      }
    } catch (err) {
      if (attempt >= 10) {
        await logDockerError('startSpeedtestContainer: inspect poll', err, config.SPEEDTEST_CONTAINER);
        throw err;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (Date.now() >= deadline) {
    throw new Error('speedtest-runner startup timeout after 30s');
  }

  return newSpeedtest;
}

async function captureBaseConfig() {
  try {
    _baseGluetunInfo = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
    logger.info('captureBaseConfig: gluetun base config cached');
  } catch (err) {
    logger.warn(`captureBaseConfig: gluetun inspect failed — ${err.message}`);
  }
  try {
    const si = await docker.getContainer(config.SPEEDTEST_CONTAINER).inspect();
    _baseSpeedtestImage = si.Config.Image;
    _baseSpeedtestBinds = si.HostConfig.Binds;
    logger.info('captureBaseConfig: speedtest base config cached');
  } catch (err) {
    logger.warn(`captureBaseConfig: speedtest inspect failed — ${err.message}`);
  }
}

async function switchServer(serverName) {
  logger.fn(__filename, 'switchServer()', { serverName });

  await tearDownDockerContainer(config.SPEEDTEST_CONTAINER);
  await tearDownDockerContainer(config.GLUETUN_CONTAINER);

  if (!_baseGluetunInfo) throw new Error('switchServer: captureBaseConfig() was not called before first switch');

  const newEnv = getEnv(_baseGluetunInfo.Config.Env || [], serverName);
  const newGluetun = await startGluetunTunnel(serverName, _baseGluetunInfo, newEnv);

  const image = _baseSpeedtestImage ?? await getOrchestratorImage();
  const binds = _baseSpeedtestBinds ?? [config.DATA_BIND];
  await startSpeedtestContainer(image, binds, newGluetun.id);
}

// Verifies both test containers are running after a switchServer(). Read-only — throws if either is down.
async function verifyTestContainersRunning() {
  logger.fn(__filename, 'verifyTestContainersRunning()', null);

  let gluetunOk = false;
  let speedtestOk = false;

  try {
    const info = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
    gluetunOk = info.State.Running;
  } catch (err) {
    await logDockerError('verifyTestContainersRunning: gluetun inspect', err, config.GLUETUN_CONTAINER);
  }

  try {
    const info = await docker.getContainer(config.SPEEDTEST_CONTAINER).inspect();
    speedtestOk = info.State.Running;
  } catch (err) {
    await logDockerError('verifyTestContainersRunning: speedtest inspect', err, config.SPEEDTEST_CONTAINER);
  }

  await logContainerStatus();

  if (!gluetunOk || !speedtestOk) {
    throw new Error(
      `verifyTestContainersRunning: containers not healthy — gluetun=${gluetunOk} speedtest=${speedtestOk}`
    );
  }
}

async function waitForTunnel() {
  logger.fn(__filename, 'waitForTunnel()', { timeoutMs: config.TUNNEL_TIMEOUT_MS });

  await new Promise(r => setTimeout(r, GLUETUN_TUNNEL_CHECK_DELAY_TIME));

  const deadline = Date.now() + config.TUNNEL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const elapsed = Math.round((Date.now() - (deadline - config.TUNNEL_TIMEOUT_MS)) / 1000);
    logger.debug(`waitForTunnel: attempt ${attempt} (+${elapsed}s elapsed)...`);

    try {
      const info = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
      if (!info.State.Running) {
        const detail = `exitCode=${info.State.ExitCode} status=${info.State.Status} error="${info.State.Error}"`;
        const exitErr = new Error(`gluetun-speedtest exited (${detail})`);
        await logDockerError('waitForTunnel: gluetun has exited', exitErr, config.GLUETUN_CONTAINER);
        throw exitErr;
      }
    } catch (err) {
      if (err.statusCode === 404) throw new Error('gluetun-speedtest container not found (404) during tunnel poll');
      throw err;
    }

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
      logger.debug(`waitForTunnel: gluetun status = ${data?.status}`);
    } catch (err) {
      logger.error(`[tunnel check] ${err.code ?? err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, config.TUNNEL_POLL_MS));
  }

  throw new Error(`Tunnel not established after ${config.TUNNEL_TIMEOUT_MS / 1000}s (${attempt} attempts)`);
}

async function tearDownSpeedTestingContainers() {
  logger.fn(__filename, 'tearDownSpeedTestingContainers()', null);
  await tearDownDockerContainer(config.SPEEDTEST_CONTAINER);
  await tearDownDockerContainer(config.GLUETUN_CONTAINER);
}

async function restoreBaseContainers() {
  logger.fn(__filename, 'restoreBaseContainers()', null);
  if (!_baseGluetunInfo) {
    logger.warn('restoreBaseContainers: no base config cached — skipping restore');
    return;
  }

  await tearDownDockerContainer(config.SPEEDTEST_CONTAINER);
  await tearDownDockerContainer(config.GLUETUN_CONTAINER);

  let newGluetun;
  try {
    newGluetun = await startGluetunTunnel('restore', _baseGluetunInfo, _baseGluetunInfo.Config.Env);
    logger.info('restoreBaseContainers: gluetun-speedtest started and tunnel confirmed');
  } catch (err) {
    logger.warn(`restoreBaseContainers: gluetun start failed — ${err.message}`);
    return;
  }

  try {
    const image = _baseSpeedtestImage ?? await getOrchestratorImage();
    const binds = _baseSpeedtestBinds ?? [config.DATA_BIND];
    await startSpeedtestContainer(image, binds, newGluetun.id, { Name: 'unless-stopped' });
    logger.info('restoreBaseContainers: speedtest-runner started');
  } catch (err) {
    logger.warn(`restoreBaseContainers: speedtest-runner start failed — ${err.message}`);
  }
}

module.exports = {
  switchServer,
  waitForTunnel,
  tearDownSpeedTestingContainers,
  restoreBaseContainers,
  verifyTestContainersRunning,
  captureBaseConfig,
  logContainerStatus,
};
