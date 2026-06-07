/*
 * switchDeciderMain.js — the auto-switch runtime: connect the brain to the hands.
 *
 * Each tick: read policy fresh → fetch live AirVPN status → read the CURRENT server
 * from the running gluetun container's SERVER_NAMES env (single source of truth) →
 * switchAdvisor.recommend() → switchDecider.decide() → if it says act, perform the
 * switch via mediaSwitchMain.buildSwitchDeps + mediaSwitch.switchMediaServer.
 *
 * Runs INSIDE the media orchestrator container (docker socket mounted, same network
 * as gluetun), like mediaSwitchMain.js / validationMain.js.
 *
 *   node switchDeciderMain.js            # cron loop (reads policy.cron)
 *   node switchDeciderMain.js --once     # single tick then exit (./vpn auto-switch --once)
 *   node switchDeciderMain.js --once --current Aladfar   # override current server
 *
 * Env:
 *   MODEL_PATH    — server-model.json (default /config/server-model.json, like validationMain)
 *   POLICY_PATH   — switch-policy.json (default /config/switch-policy.json)
 *   GLUETUN_CONTAINER / GLUETUN_CONTROL_URL — from config.js (env-overridable)
 *
 * State (/data, so it survives restarts and feeds guardrail tuning later):
 *   switch-state.json     — { lastSwitchTime, day, count }
 *   switch-decisions.jsonl — one record per tick (the data we'll set real guardrails from)
 *
 * Changelog
 * 2026-06-07  created — Step 3: wire the advisor's decision to switchMediaServer()
 */

const fs = require('fs');
const cron = require('node-cron');
const logger = require('./logger');
const config = require('./config');
const { recommend } = require('./switchAdvisor');
const { decide } = require('./switchDecider');
const { switchMediaServer } = require('./mediaSwitch');
const { buildSwitchDeps, docker } = require('./mediaSwitchMain');
const { getESTTimestamp } = require('./estTime');
const { resolveState } = require('./switchState');

const MODEL_PATH = process.env.MODEL_PATH || '/config/server-model.json';
const POLICY_PATH = process.env.POLICY_PATH || '/config/switch-policy.json';
const STATE_PATH = '/data/switch-state.json';
const LOG_PATH = '/data/switch-decisions.jsonl';
const AIRVPN_STATUS_URL = 'https://airvpn.org/api/status';

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

// EST day stamp (YYYYMMDD) so the daily count resets on the local calendar, matching
// the rest of the project's EST convention.
function estDay() {
  return getESTTimestamp().slice(0, 8);
}

function loadState() {
  return resolveState(readJson(STATE_PATH, null), estDay());
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchUsStatus() {
  const res = await fetch(AIRVPN_STATUS_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AirVPN status HTTP ${res.status}`);
  const data = await res.json();
  return (data.servers || []).filter(s => s.country_code === 'us');
}

// Current server = the running gluetun container's SERVER_NAMES env. Single source of
// truth — can't drift from reality the way a separate state file could.
async function currentServerFromGluetun() {
  const info = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
  const row = (info.Config.Env || []).find(e => e.startsWith('SERVER_NAMES='));
  return row ? row.slice('SERVER_NAMES='.length) : null;
}

async function tick({ currentOverride } = {}) {
  const policy = readJson(POLICY_PATH);
  const model = readJson(MODEL_PATH);
  const state = loadState();

  let status = [];
  try {
    status = await fetchUsStatus();
  } catch (err) {
    logger.warn(`switchDecider: AirVPN status fetch failed — ${err.message} (advisor will fail-safe to STAY)`);
  }

  const current = currentOverride || await currentServerFromGluetun();
  const rec = recommend(current, status, model);
  const now = Date.now();
  const d = decide({
    recommendation: rec, policy, now,
    lastSwitchTime: state.lastSwitchTime, switchesToday: state.count,
  });

  const record = {
    ts: getESTTimestamp(), current, action: rec.action, to: rec.to, zone: rec.zone,
    advisorReason: rec.reason, decided: d, switchesToday: state.count,
  };

  logger.info(`switchDecider: current=${current} → ${rec.action}${rec.to ? ` ${rec.to}` : ''} [${rec.zone}] | gate: ${d.act ? 'ACT' : 'hold'} (${d.reason})`);

  if (d.act) {
    const gInfo = await docker.getContainer(config.GLUETUN_CONTAINER).inspect();
    const gluetunRef = { id: gInfo.Id, name: config.GLUETUN_CONTAINER };
    await switchMediaServer(rec.to, buildSwitchDeps(gluetunRef));
    const next = { lastSwitchTime: now, day: estDay(), count: state.count + 1 };
    saveState(next);
    record.switched = true;
    logger.info(`switchDecider: switched → ${rec.to} (count today: ${next.count})`);
  }

  try { fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n'); } catch (err) { logger.warn(`switchDecider: log append failed — ${err.message}`); }
  return record;
}

async function main() {
  const argv = process.argv.slice(2);
  const once = argv.includes('--once');
  const ci = argv.indexOf('--current');
  const currentOverride = ci >= 0 ? argv[ci + 1] : null;

  if (once) {
    await tick({ currentOverride });
    return;
  }

  const policy = readJson(POLICY_PATH);
  const schedule = policy.cron || '*/15 * * * *';
  logger.info(`switchDeciderMain: registering auto-switch cron "${schedule}" (dryRun=${policy.dryRun}, enabled=${policy.enabled})`);
  cron.schedule(schedule, () => {
    tick().catch(err => logger.error(`switchDecider tick failed — ${err.message}`));
  });
}

if (require.main === module) {
  main().catch(err => {
    logger.error(`switchDeciderMain: fatal — ${err.message}`);
    process.exitCode = 1;
  });
}
