/*
 * config.js — Central configuration for the VPN speed-tester orchestrator.
 *
 * Single source of truth for all constants: API endpoints, container names,
 * data file paths, timing parameters, and speed-tier thresholds. Validates
 * required environment variables at require()-time so any missing secrets
 * surface immediately on container start rather than at first use.
 *
 * Changelog
 * 2026-05-14  Added GLUETUN_SERVERS_URL — gluetun control-API endpoint that
 *               returns its bundled AirVPN server list; used by getAcceptedServers()
 *               in gluetunManager.js to filter out servers gluetun cannot route
 * 2026-05-14  Added ACCEPTED_SERVERS_PATH — on-disk cache for the last successful
 *               getAcceptedServers() response; used as fallback when gluetun is
 *               not yet running at window start
 * 2026-05-14  Added UNREACHABLE_SERVERS_PATH — per-window report of AirVPN US
 *               servers that are live but not in gluetun's accepted list
 * 2026-05-14  Promoted MAX_CONSECUTIVE_FAILURES from hardcoded local in
 *               scheduler.js (was 2) to this config (now 5); centralises the
 *               threshold so it can be tuned without hunting through logic code
 */

if (!process.env.QBT_BASE_URL) throw new Error('QBT_BASE_URL is not set in .env');
if (!process.env.QBT_PASSWORD) throw new Error('QBT_PASSWORD is not set in .env');

module.exports = {
  AIRVPN_STATUS_URL:    'https://airvpn.org/api/status',
  GLUETUN_CONTROL_URL:  'http://gluetun-speedtest:8000/v1/vpn/status',
  // Gluetun's bundled server list — used to pre-filter candidates to only
  // servers this gluetun binary will actually accept a connection to
  GLUETUN_SERVERS_URL:  'http://gluetun-speedtest:8000/v1/servers/airvpn',
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
  // Cache of last-known gluetun-accepted server names; read as fallback when
  // gluetun is not running at window start
  ACCEPTED_SERVERS_PATH:    '/data/accepted-servers.json',
  // Written once per test window; lists live AirVPN servers skipped because
  // gluetun's bundled list does not include them
  UNREACHABLE_SERVERS_PATH: '/data/unreachable-servers.json',

  CAPE_CORAL_LAT:       26.5629,
  CAPE_CORAL_LON:       -81.9495,

  TEST_WINDOW_HOURS:    2,
  TEST_START_HOUR:      3,
  RUNS_PER_SESSION:     3,
  TUNNEL_POLL_MS:       5000,
  TUNNEL_TIMEOUT_MS:    180000,
  // Stop the test window after this many back-to-back non-tunnel errors;
  // tunnel failures (gluetun exited, 404) are skipped without incrementing
  MAX_CONSECUTIVE_FAILURES: 5,

  TIER_THRESHOLDS: {
    low:    { min: 0,  max: 30  },
    medium: { min: 31, max: 50  },
    high:   { min: 51, max: 70  },
    diablo: { min: 71, max: 100 },
  },
};
