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
 * 2026-06-06  Added GLUETUN_ACCEPTED_AIRVPN_SERVERS — hardcoded list of server
 *               names gluetun v3.41.1 will accept, extracted verbatim from gluetun's
 *               own startup error. getAcceptedServers() now returns this instead of
 *               fetching the control API, so pre-filtering no longer depends on gluetun
 *               being up at window start (GLUETUN_SERVERS_URL/ACCEPTED_SERVERS_PATH are
 *               now only exercised by the live `./vpn servers` path). See the inline
 *               TODO below for regenerating the list on gluetun upgrade.
 */

if (!process.env.QBT_BASE_URL) throw new Error('QBT_BASE_URL is not set in .env');
if (!process.env.QBT_PASSWORD) throw new Error('QBT_PASSWORD is not set in .env');

// TEMPORARY: hardcoded list of AirVPN server names that gluetun v3.41.1's
// bundled config will actually accept. Extracted verbatim from gluetun's own
// startup error ("the choices available: ...") when given an unsupported
// SERVER_NAMES value. Used to pre-filter the AirVPN status API's server list
// so the queue never picks a server gluetun would reject (e.g. Dziban).
//
// TODO: replace with a dynamic fetch once we have a working path to gluetun's
// server list (HTTP control API requires an API key and the /v1/servers/airvpn
// route can't be whitelisted via auth.toml; the file at /gluetun/servers.json
// inside the container is another option). For now: when gluetun is upgraded,
// regenerate this list by running with an invalid SERVER_NAMES once and
// copying the names out of the error message.
const GLUETUN_ACCEPTED_AIRVPN_SERVERS = [
  'Achernar','Achird','Adhara','Agena','Ain','Ainalrami','Aladfar','Alamak','Alathfar',
  'Albaldah','Albali','Alchiba','Alcyone','Alderamin','Algieba','Algorab','Alhena',
  'Aljanah','Alkurhah','Alnitak','Alphard','Alphecca','Alpheratz','Alphirk','Alrai',
  'Alrami','Alruba','Alsephina','Alshain','Alshat','Alterf','Aludra','Alula','Alwaid',
  'Alya','Alzirr','Ancha','Andromeda','Angetenar','Anser','Apus','Aquila','Arion',
  'Arkab','Ascella','Asellus','Aspidiske','Asterion','Asterope','Atik','Atria','Auriga',
  'Avior','Azmidiske','Baiten','Beemim','Benetnasch','Betelgeuse','Bharani','Biham',
  'Bootes','Bunda','Caelum','Camelopardalis','Canis','Capella','Caph','Capricornus',
  'Carinae','Castor','Celaeno','Cephei','Cepheus','Chalawan','Chamaeleon','Chara',
  'Chertan','Chort','Chow','Circinus','Columba','Comae','Copernicus','Crater','Cujam',
  'Cygnus','Dalim','Delphinus','Denebola','Diadema','Diphda','Dorado','Dubhe','Edasich',
  'Elkurud','Elnath','Eltanin','Enif','Equuleus','Eridanus','Fang','Fawaris','Felis',
  'Fleed','Fomalhaut','Fulu','Garnet','Gemini','Geminorum','Gianfar','Giausar','Gienah',
  'Ginan','Gorgonea','Groombridge','Grus','Haedus','Hamal','Hassaleh','Helvetios',
  'Hercules','Horologium','Hyadum','Hydra','Hydrus','Iklil','Imai','Indus','Intercrus',
  'Iskandar','Jabbah','Kajam','Kitalpha','Kitel','Kocab','Kruger','Lacaille','Lacerta',
  'Larawag','Leo','Lesath','Libra','Lich','Luhman','Lupus','Luyten','Maasym','Markab',
  'Marsic','Matar','Mebsuta','Meissa','Mekbuda','Meleph','Melnick','Menkab','Menkalinan',
  'Menkent','Mensa','Merga','Mesarthim','Metallah','Minchir','Mintaka','Mirach','Miram',
  'Mirfak','Mirzam','Muhlifain','Muphrid','Musca','Muscida','Musica','Nahn','Naos','Nash',
  'Nashira','Norma','Okab','Ophiuchus','Orbitar','Orion','Pegasus','Phact','Phaet',
  'Phoenix','Piautos','Pisces','Pleione','Polis','Praecipua','Pyxis','Ran','Regulus',
  'Ross','Rotanev','Rukbat','Saclateni','Sadachbia','Sadalbari','Sadr','Saiph','Salm',
  'Sargas','Schedir','Sculptor','Scuti','Scutum','Sextans','Sham','Sharatan','Sheliak',
  'Sirrah','Situla','Sneden','Struve','Sualocin','Subra','Suhail','Superba','Taiyi',
  'Talitha','Taphao','Tarazed','Taurus','Teegarden','Tegmen','Tejat','Telescopium',
  'Tiaki','Tianguan','Tianyi','Titawin','Triangulum','Tucana','Turais','Tyl','Ukdah',
  'Ursa','Veritate','Virgo','Volans','Vulpecula','Wazn','Westerlund','Wurren','Xuange',
  'Zibal','Zuben',
];

module.exports = {
  GLUETUN_ACCEPTED_AIRVPN_SERVERS,
  AIRVPN_STATUS_URL:    'https://airvpn.org/api/status',
  // Env-overridable so the desktop validation run can point at a different gluetun
  // control endpoint than the NAS if ever needed (default works in-network on both).
  GLUETUN_CONTROL_URL:  process.env.GLUETUN_CONTROL_URL || 'http://gluetun-speedtest:8000/v1/vpn/status',
  // Gluetun's bundled server list — used to pre-filter candidates to only
  // servers this gluetun binary will actually accept a connection to
  GLUETUN_SERVERS_URL:  process.env.GLUETUN_SERVERS_URL || 'http://gluetun-speedtest:8000/v1/servers/airvpn',
  SPEEDTEST_CONTAINER:  process.env.SPEEDTEST_CONTAINER || 'speedtest-runner',
  QBT_BASE_URL:         process.env.QBT_BASE_URL,
  QBT_USERNAME:         process.env.QBT_USERNAME || 'admin',
  QBT_PASSWORD:         process.env.QBT_PASSWORD,
  GLUETUN_CONTAINER:    process.env.GLUETUN_CONTAINER || 'gluetun-speedtest',
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
