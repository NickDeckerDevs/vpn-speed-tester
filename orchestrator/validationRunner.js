/*
 * validationRunner.js — HOST-side runner for the desktop validation loop (Part 2).
 *
 * Runs on the desktop (NOT in a container). Drives the desktop speed-test stack
 * (docker-compose.desktop.yml) via the `docker` CLI:
 *   - switchServer(name): recreate gluetun+runner with SERVER_NAMES=name, wait healthy
 *   - runSpeedtest(): `docker exec speedtest-runner speedtest-cli --json --secure`
 * and feeds them to the already-tested runValidationOnce(). One pass per invocation;
 * carries the notional "current" server forward via a small state file. Appends one
 * JSON line per run to analysis/validation-log.jsonl.
 *
 *   node orchestrator/validationRunner.js            # one validation pass
 *   node orchestrator/validationRunner.js --current Meleph   # force the starting server
 *
 * Changelog
 * 2026-06-06  created — P2-4c: host runner wiring real switch/speedtest via docker CLI
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { runValidationOnce, loadState, saveState } = require('./validationLoop');

const ROOT = path.join(__dirname, '..');
const COMPOSE = path.join(ROOT, 'docker-compose.desktop.yml');
const MODEL_PATH = path.join(ROOT, 'analysis', 'server-model.json');
const STATE_PATH = path.join(ROOT, 'analysis', 'validation-state.json');
const LOG_PATH = path.join(ROOT, 'analysis', 'validation-log.jsonl');
const AIRVPN_STATUS_URL = 'https://airvpn.org/api/status';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`[validate] ${m}`);

/** Run a shell command, resolve stdout (trimmed). extraEnv is merged into process.env. */
function sh(cmd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: { ...process.env, ...extraEnv }, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd}\n${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

async function waitHealthy(container, timeoutS) {
  const deadline = Date.now() + timeoutS * 1000;
  while (Date.now() < deadline) {
    let status = '';
    try { status = await sh(`docker inspect -f '{{.State.Health.Status}}' ${container}`); } catch { /* not up yet */ }
    if (status === 'healthy') return;
    await sleep(3000);
  }
  throw new Error(`${container} did not become healthy within ${timeoutS}s`);
}

async function switchServer(name) {
  log(`switching tunnel → ${name} (recreating gluetun + runner)`);
  await sh(`docker compose -f "${COMPOSE}" up -d --force-recreate gluetun-speedtest speedtest-runner`, { SERVER_NAMES: name });
  await waitHealthy('gluetun-speedtest', 180);
  log(`tunnel up on ${name}`);
}

async function runSpeedtest() {
  const out = await sh('docker exec speedtest-runner speedtest-cli --json --secure');
  return JSON.parse(out);
}

async function fetchUsStatus() {
  const res = await fetch(AIRVPN_STATUS_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AirVPN status HTTP ${res.status}`);
  const data = await res.json();
  return (data.servers || []).filter(s => s.country_code === 'us');
}

function parseCurrentFlag(argv) {
  const i = argv.indexOf('--current');
  return i >= 0 ? argv[i + 1] : null;
}

async function main() {
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
  const forced = parseCurrentFlag(process.argv.slice(2));
  const currentServer = forced ?? loadState(STATE_PATH).current;

  log(`starting validation pass — current: ${currentServer || '(none)'}`);

  const { decision, record, next } = await runValidationOnce({
    model, currentServer,
    fetchStatus: fetchUsStatus, switchServer, runSpeedtest,
    runsPerServer: 2,
    now: () => new Date().toISOString(),
    log,
  });

  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  saveState(STATE_PATH, { current: next, updatedAt: new Date().toISOString() });

  console.log('\n──────────── validation result ────────────');
  console.log(`decision : ${decision.action.toUpperCase()}${decision.to ? ` → ${decision.to}` : ''}  [zone: ${decision.zone}]`);
  console.log(`reason   : ${decision.reason}`);
  const c = record.current, a = record.alternative;
  console.log(`current  : ${c.server} @ ${c.load}%  predicted ${c.predicted} / measured ${c.measured} Mbps`);
  if (a) console.log(`alt      : ${a.server} @ ${a.load}%  predicted ${a.predicted} / measured ${a.measured} Mbps`);
  console.log(`scoring  : measuredGap ${record.scoring.measuredGap} Mbps, decisionCorrect=${record.scoring.decisionCorrect}`);
  console.log(`next run treats current = ${next}`);
  console.log(`logged → ${path.relative(ROOT, LOG_PATH)}`);
}

main().catch(err => {
  console.error(`validationRunner failed: ${err.message}`);
  process.exitCode = 1;
});
