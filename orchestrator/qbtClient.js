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

    const body = typeof resp.data === 'string' ? resp.data.trim() : JSON.stringify(resp.data);
    logger.info(`qBittorrent login response — status: ${resp.status}, body: "${body}"`);

    const cookies = resp.headers['set-cookie'];
    logger.info(`qBittorrent login set-cookie header: ${JSON.stringify(cookies)}`);

    const sidCookie = cookies && cookies.find(c => c.startsWith('SID='));
    if (sidCookie) {
      sid = sidCookie.split(';')[0].split('=')[1];
      logger.info('qBittorrent session established');
    } else if (body === 'Ok.') {
      logger.info('qBittorrent login accepted but no SID returned — auth may be bypassed for this IP');
    } else if (body === 'Fails.') {
      loginAttempted = false;
      logger.error('qBittorrent login failed — wrong username or password (check QBT_USERNAME / QBT_PASSWORD in .env)');
    } else if (body.startsWith('Your IP address has been banned')) {
      loginAttempted = false;
      logger.error(`qBittorrent login failed — IP banned: ${body}`);
    } else {
      loginAttempted = false;
      logger.warn(`qBittorrent login unexpected response: "${body}"`);
    }
  } catch (err) {
    loginAttempted = false;
    logger.warn(`qBittorrent login attempt failed (${err.message}) — proceeding without session`);
  }
}

async function pauseAll() {
  logger.fn(__filename, 'pauseAll', null);
  logger.info('pauseAll: sending pause command to qBittorrent...');

  await login();

  const headers = qbtHeaders();
  logger.info(`pauseAll: request headers — ${JSON.stringify(headers.headers)}`);

  await httpClient.post(
    `${config.QBT_BASE_URL}/api/v2/torrents/pause`,
    'hashes=all',
    { ...headers, timeout: 30000 },
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
