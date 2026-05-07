module.exports = {
  AIRVPN_STATUS_URL:    'https://airvpn.org/api/status',
  TUNNEL_CHECK_URL:     'https://check.airservers.org/api/',
  QBT_BASE_URL:         'http://10.1.10.254:8080',
  RESULTS_PATH:         '/data/results.json',
  SNAPSHOTS_PATH:       '/data/snapshots/',
  GIT_REPO_PATH:        '/data/',
  GLUETUN_CONTAINER:    'gluetun-test',
  LOGS_PATH:            '/data/logs/',

  CAPE_CORAL_LAT:       26.5629,
  CAPE_CORAL_LON:       -81.9495,

  TEST_WINDOW_HOURS:    2,
  TEST_START_HOUR:      3,
  RUNS_PER_SESSION:     3,
  MS_BETWEEN_RUNS:      15000,
  TUNNEL_POLL_MS:       5000,
  TUNNEL_TIMEOUT_MS:    60000,

  TIER_THRESHOLDS: {
    low:    { min: 0,  max: 30  },
    medium: { min: 31, max: 50  },
    high:   { min: 51, max: 70  },
    diablo: { min: 71, max: 100 },
  },
};
