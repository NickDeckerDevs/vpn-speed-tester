if (!process.env.QBT_BASE_URL) throw new Error('QBT_BASE_URL is not set in .env');
if (!process.env.QBT_PASSWORD) throw new Error('QBT_PASSWORD is not set in .env');

module.exports = {
  AIRVPN_STATUS_URL:    'https://airvpn.org/api/status',
  GLUETUN_CONTROL_URL:  'http://gluetun-speedtest:8000/v1/vpn/status',
  SPEEDTEST_CONTAINER:  'speedtest-runner',
  QBT_BASE_URL:         process.env.QBT_BASE_URL,
  QBT_USERNAME:         process.env.QBT_USERNAME || 'admin',
  QBT_PASSWORD:         process.env.QBT_PASSWORD,
  GLUETUN_CONTAINER:    'gluetun-speedtest',
  RESULTS_PATH:         '/data/results.json',
  SNAPSHOTS_PATH:       '/data/snapshots/',
  GIT_REPO_PATH:        '/data/',
  LOGS_PATH:            '/data/logs/',
  SERVER_DATA_PATH:     '/data/server-data.json',
  RAW_RESULTS_PATH:     '/data/raw-results.json',

  CAPE_CORAL_LAT:       26.5629,
  CAPE_CORAL_LON:       -81.9495,

  TEST_WINDOW_HOURS:    2,
  TEST_START_HOUR:      3,
  RUNS_PER_SESSION:     3,
  MS_BETWEEN_RUNS:      15000,
  TUNNEL_POLL_MS:       5000,
  TUNNEL_TIMEOUT_MS:    180000,

  TIER_THRESHOLDS: {
    low:    { min: 0,  max: 30  },
    medium: { min: 31, max: 50  },
    high:   { min: 51, max: 70  },
    diablo: { min: 71, max: 100 },
  },
};
