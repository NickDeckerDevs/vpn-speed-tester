const logger = require('./logger');
const httpClient = require('./httpClient');
const config = require('./config');

const FORM_HEADERS = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

async function pauseAll() {
  logger.fn(__filename, 'pauseAll', null);
  logger.info('pauseAll: sending pause command to qBittorrent...');

  await httpClient.post(
    `${config.QBT_BASE_URL}/api/v2/torrents/pause`,
    'hashes=all',
    { ...FORM_HEADERS, timeout: 30000 },
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
        { timeout: 10000 },
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

  await httpClient.post(
    `${config.QBT_BASE_URL}/api/v2/torrents/resume`,
    'hashes=all',
    { ...FORM_HEADERS, timeout: 30000 },
    'qBittorrent resume'
  );

  logger.info('resumeAll: torrents resumed');
}

module.exports = { pauseAll, resumeAll };
