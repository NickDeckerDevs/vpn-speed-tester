const axios = require('axios');
const config = require('./config');

const FORM_HEADERS = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

async function pauseAll() {
  await axios.post(`${config.QBT_BASE_URL}/api/v2/torrents/pause`, 'hashes=all', {
    ...FORM_HEADERS,
    timeout: 30000,
  });

  // Poll until qBittorrent acknowledges the pause (up to 30s)
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const resp = await axios.get(
        `${config.QBT_BASE_URL}/api/v2/torrents/info?filter=paused`,
        { timeout: 10000 }
      );
      if (Array.isArray(resp.data)) {
        console.log(`qBittorrent paused (${resp.data.length} torrents)`);
        return;
      }
    } catch {
      // qBT not responding yet
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('qBittorrent did not confirm pause within 30s');
}

async function resumeAll() {
  await axios.post(`${config.QBT_BASE_URL}/api/v2/torrents/resume`, 'hashes=all', {
    ...FORM_HEADERS,
    timeout: 30000,
  });
  console.log('qBittorrent resumed');
}

module.exports = { pauseAll, resumeAll };
