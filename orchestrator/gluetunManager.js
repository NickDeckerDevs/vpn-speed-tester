/*
 * gluetunManager.js — Docker container lifecycle and VPN tunnel management.
 *
 * Sole module allowed to create, start, stop, or remove Docker containers.
 * Manages two containers: gluetun-speedtest (WireGuard tunnel) and
 * speedtest-runner (shares gluetun's network namespace). All other modules
 * that need to exec inside a container (e.g. speedTester.js) call
 * docker.exec() directly — they do NOT use this module for that.
 *
 * Responsibility split with scheduler.js:
 *   getAcceptedServers()  — raw fetch from gluetun control API (this file)
 *   resolveAcceptedServers() — resilient fetch with disk cache (scheduler.js)
 * Keep these separate; scheduler owns the fallback/caching concern.
 *
 * Changelog
 * 2026-05-14  Added getAcceptedServers() — queries gluetun's /v1/servers/airvpn
 *               endpoint to return a Set<string> of server public_names that this
 *               gluetun binary will accept; used by scheduler.js to pre-filter
 *               the AirVPN US server list before picking a test candidate
 */

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

function processCatchError(err, context = '', ignoreError = true) {
  const code = err.statusCode ? ` [${err.statusCode}]` : '';
  logger.error(`${context}${code}: ${err.message}`);
  if (!ignoreError) throw err;
}

const getEnv = (gluetunEnv, serverName) =>
  gluetunEnv.filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

// Stops and removes a container. If skipEnvRebuild=false, also computes updated
// SERVER_NAMES env for the gluetun container so the caller can recreate it.
// Returns { containerInfo, newEnv }.
async function tearDown(serverName, dockerContainerName, skipEnvRebuild) {
  logger.fn(__filename, 'tearDown()', { serverName, dockerContainerName });
  let dockerContainer = null;
  let containerInfo = null;
  let newEnv;

  try {
    dockerContainer = docker.getContainer(dockerContainerName);
    containerInfo = await dockerContainer.inspect();
    if (!skipEnvRebuild) {
      newEnv = getEnv(containerInfo.Config.Env || [], serverName);
    }
  } catch (err) {
    if (err.statusCode !== 404) processCatchError(err, `tearDown: inspect ${dockerContainerName}`, false);
  }

  if (containerInfo) {
    try {
      await dockerContainer.stop({ t: 10 });
    } catch (err) {
      if (err.statusCode !== 304 && err.statusCode !== 409) {
        processCatchError(err, `tearDown: stop ${dockerContainerName}`, false);
      }
    }
    try {
      await dockerContainer.remove();
    } catch (err) {
      processCatchError(err, `tearDown: remove ${dockerContainerName}`, true);
    }
  }

  return { containerInfo, newEnv };
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
      processCatchError(err, `startGluetunTunnel: create/start attempt ${attempt}`, false);
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
      if (attempt >= 10) processCatchError(err, 'startSpeedtestContainer: inspect poll', false);
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

  await tearDown(serverName, config.SPEEDTEST_CONTAINER, true);
  await tearDown(serverName, config.GLUETUN_CONTAINER, true);

  if (!_baseGluetunInfo) throw new Error('switchServer: captureBaseConfig() was not called before first switch');

  const newEnv = getEnv(_baseGluetunInfo.Config.Env || [], serverName);
  const newGluetun = await startGluetunTunnel(serverName, _baseGluetunInfo, newEnv);

  const image = _baseSpeedtestImage ?? await getOrchestratorImage();
  const binds = _baseSpeedtestBinds ?? ['/volume1/Docker/vpn-speed-tester/data:/data'];
  await startSpeedtestContainer(image, binds, newGluetun.id);
}

async function ensureSpeedtestRunner() {
  logger.fn(__filename, 'ensureSpeedtestRunner()', null);
  const speedtestC = docker.getContainer(config.SPEEDTEST_CONTAINER);

  try {
    const info = await speedtestC.inspect();
    if (info.State.Running) return;
    logger.warn(`ensureSpeedtestRunner: container not running — state: ${JSON.stringify(info.State)}`);
    await speedtestC.remove({ force: true });
  } catch (err) {
    if (err.statusCode !== 404) processCatchError(err, 'ensureSpeedtestRunner: inspect', false);
  }

  const gluetunC = docker.getContainer(config.GLUETUN_CONTAINER);
  let gluetunInfo;
  try {
    gluetunInfo = await gluetunC.inspect();
  } catch (err) {
    processCatchError(err, 'ensureSpeedtestRunner: gluetun inspect', false);
  }

  if (!gluetunInfo.State.Running) {
    throw new Error(`Cannot rebuild speedtest-runner: gluetun-speedtest not running (state: ${gluetunInfo.State.Status})`);
  }

  const image = await getOrchestratorImage();
  await startSpeedtestContainer(image, ['/volume1/Docker/vpn-speed-tester/data:/data'], gluetunInfo.Id);
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
        logger.error(`waitForTunnel: gluetun-speedtest has exited — ${detail}`);
        throw new Error(`gluetun-speedtest exited (${detail})`);
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

async function tearDownTestContainers() {
  logger.fn(__filename, 'tearDownTestContainers()', null);
  await tearDown(null, config.SPEEDTEST_CONTAINER, true);
  await tearDown(null, config.GLUETUN_CONTAINER, true);
}

/**
 * Returns a Set<string> of AirVPN server public_names that this gluetun
 * binary will accept. Pulls live from gluetun's /v1/servers/airvpn endpoint.
 *
 * Throws if gluetun is not running (connection refused) or if the API returns
 * an empty list (which would incorrectly filter out all candidates).
 * Callers that need resilience against gluetun being offline should use
 * resolveAcceptedServers() in scheduler.js instead — it adds a disk cache
 * fallback and a safe null return when neither source is available.
 */
async function getAcceptedServers() {
  logger.fn(__filename, 'getAcceptedServers()', null);
  const data = await httpClient.get(
    config.GLUETUN_SERVERS_URL,
    { timeout: 10000 },
    'gluetun servers/airvpn'
  );
  const list = Array.isArray(data) ? data : (data?.servers || []);
  const names = new Set();
  for (const entry of list) {
    const name = entry?.server_name || entry?.name;
    if (name) names.add(name);
  }
  if (names.size === 0) throw new Error('gluetun returned no AirVPN server names');
  return names;
}

async function restoreBaseContainers() {
  logger.fn(__filename, 'restoreBaseContainers()', null);
  if (!_baseGluetunInfo) {
    logger.warn('restoreBaseContainers: no base config cached — skipping restore');
    return;
  }
  let newGluetun;
  try {
    newGluetun = await docker.createContainer({
      name: config.GLUETUN_CONTAINER,
      Image: _baseGluetunInfo.Config.Image,
      Env: _baseGluetunInfo.Config.Env,
      ExposedPorts: _baseGluetunInfo.Config.ExposedPorts,
      HostConfig: _baseGluetunInfo.HostConfig,
    });
    await newGluetun.start();
    logger.info('restoreBaseContainers: gluetun-speedtest started');
  } catch (err) {
    logger.warn(`restoreBaseContainers: gluetun recreate failed — ${err.message}`);
    return;
  }
  await new Promise(r => setTimeout(r, 2000));
  try {
    const image = _baseSpeedtestImage ?? await getOrchestratorImage();
    const binds = _baseSpeedtestBinds ?? ['/volume1/Docker/vpn-speed-tester/data:/data'];
    await startSpeedtestContainer(image, binds, newGluetun.id, { Name: 'unless-stopped' });
    logger.info('restoreBaseContainers: speedtest-runner started');
  } catch (err) {
    logger.warn(`restoreBaseContainers: speedtest-runner recreate failed — ${err.message}`);
  }
}

module.exports = { switchServer, waitForTunnel, tearDownTestContainers, restoreBaseContainers, ensureSpeedtestRunner, captureBaseConfig, getAcceptedServers };
