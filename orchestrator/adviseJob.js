/*
 * adviseJob.js — Run the switch advisor once against LIVE AirVPN status and print
 * its recommendation. Recommend-only: it never touches a container.
 *
 * Self-contained: fetches the public AirVPN status with the built-in fetch (Node
 * 18+), so it avoids the config.js/logger.js chain and runs without a .env.
 *
 *   node orchestrator/adviseJob.js --current Meleph
 *   ./vpn advise --current Meleph
 *
 * Changelog
 * 2026-06-06  created — Step 6: live CLI runner for recommend()
 */

const fs = require('fs');
const path = require('path');
const { recommend, expectedBandwidth, zoneFor } = require('./switchAdvisor');

const MODEL_PATH = path.join(__dirname, '..', 'analysis', 'server-model.json');
const AIRVPN_STATUS_URL = 'https://airvpn.org/api/status';

function parseArgs(argv) {
  const out = { current: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--current') out.current = argv[++i];
  }
  return out;
}

async function fetchUsStatus() {
  const res = await fetch(AIRVPN_STATUS_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`AirVPN status HTTP ${res.status}`);
  const data = await res.json();
  return (data.servers || []).filter(s => s.country_code === 'us');
}

function printCandidateTable(model, liveByName) {
  console.log('\nOur 10 (live):');
  console.log('  server        load   expected   zone');
  for (const c of model.candidates) {
    const load = liveByName[c.server];
    if (load == null) {
      console.log(`  ${c.server.padEnd(12)}   n/a    (no live reading)`);
      continue;
    }
    const exp = Math.round(expectedBandwidth(c, load));
    console.log(`  ${c.server.padEnd(12)} ${String(load).padStart(4)}%  ${String(exp).padStart(4)} Mbps   ${zoneFor(c, load)}`);
  }
}

async function main() {
  const { current } = parseArgs(process.argv.slice(2));
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));

  let status = [];
  try {
    status = await fetchUsStatus();
    console.log(`Fetched ${status.length} healthy/total US servers from AirVPN.`);
  } catch (err) {
    console.error(`AirVPN status fetch failed: ${err.message} — advisor will fail-safe to STAY.`);
  }

  const liveByName = {};
  for (const s of status) if (s.health === 'ok') liveByName[s.public_name] = s.currentload;

  const r = recommend(current, status, model);

  printCandidateTable(model, liveByName);

  console.log('\n──────────────────────────────────────────────');
  console.log(`current : ${current || '(none specified)'}`);
  console.log(`decision: ${r.action.toUpperCase()}${r.to ? ` → ${r.to}` : ''}   [zone: ${r.zone}]`);
  console.log(`reason  : ${r.reason}`);
  if (r.bestAlternative) {
    console.log(`best alt: ${r.bestAlternative.server} @ ${r.bestAlternative.load}% (~${Math.round(r.bestAlternative.expected)} Mbps)`);
  }
  console.log('(recommend-only — no container was touched)');
}

main().catch(err => {
  console.error(`adviseJob failed: ${err.message}`);
  process.exitCode = 1;
});
