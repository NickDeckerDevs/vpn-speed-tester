const axios = require('axios');
const logger = require('./logger');
const httpClient = require('./httpClient');
const config = require('./config');

let sid = null;
let loginAttempted = false;

function qbtHeaders() {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': config.QBT_BASE_URL,
  };
  if (sid) headers['Cookie'] = `SID=${sid}`;
  return { headers };
}

async function login() {
  if (loginAttempted) return;
  loginAttempted = true;

  try {
    const resp = await axios.post(
      `${config.QBT_BASE_URL}/api/v2/auth/login`,
      `username=${encodeURIComponent(config.QBT_USERNAME)}&password=${encodeURIComponent(config.QBT_PASSWORD)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': config.QBT_BASE_URL }, timeout: 10000 }
    );

    const cookies = resp.headers['set-cookie'];
    const sidCookie = cookies && cookies.find(c => c.startsWith('SID='));
    if (sidCookie) {
      sid = sidCookie.split(';')[0].split('=')[1];
      logger.info('qBittorrent session established');
    } else {
      logger.info('qBittorrent auth is disabled — proceeding without session cookie');
    }
  } catch (err) {
    logger.warn(`qBittorrent login attempt failed (${err.message}) — proceeding without session`);
  }
}

async function pauseAll() {
  logger.fn(__filename, 'pauseAll', null);
  logger.info('pauseAll: sending pause command to qBittorrent...');

  await login();

  await httpClient.post(
    `${config.QBT_BASE_URL}/api/v2/torrents/pause`,
    'hashes=all',
    { ...qbtHeaders(), timeout: 30000 },
    'qBittorrent pause'
  );

  logger.info('pauseAll: pause command accepted — polling for confirmation...');

  const deadline = Date.now() + 30000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const data = await httpClient.get(
        `${config.QBT_BASE_URL}/api/v2/torrents/info?filter=paused`,
        { headers: qbtHeaders().headers, timeout: 10000 },
        'qBittorrent pause status'
      );
      if (Array.isArray(data)) {
        logger.info(`pauseAll: confirmed — ${data.length} torrent(s) paused (attempt ${attempt})`);
        return;
      }
    } catch (err) {
      logger.warn(`pauseAll: poll attempt ${attempt} failed — ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('qBittorrent did not confirm pause within 30s');
}

async function resumeAll() {
  logger.fn(__filename, 'resumeAll', null);
  logger.info('resumeAll: sending resume command to qBittorrent...');

  await login();

  await httpClient.post(
    `${config.QBT_BASE_URL}/api/v2/torrents/resume`,
    'hashes=all',
    { ...qbtHeaders(), timeout: 30000 },
    'qBittorrent resume'
  );

  logger.info('resumeAll: torrents resumed');
}

module.exports = { pauseAll, resumeAll };
