/*
 * validationMain.js — Continuous self-validation loop (Part 2), runs INSIDE the
 * orchestrator container on the desktop (docker-compose.desktop.yml).
 *
 * Reuses the SAME proven machinery as the real speed tester:
 *   - gluetunManager.switchServer / waitForTunnel / captureBaseConfig  (tunnel up/down + health)
 *   - speedTester.runSpeedtest                                          (speedtest-cli in the runner)
 *   - airvpnStatus.fetchUSServers                                       (live busy-levels)
 *   - switchAdvisor.recommend (via validationLoop.runValidationOnce)    (the decision)
 *
 * Each pass: advisor decision → speed-test current + best-alt → score predicted-vs-measured →
 * append a record → carry the notional current forward. Loops back-to-back (passes are ~2 min),
 * never touching the live media stack. Recommend-only: it switches its OWN throwaway test tunnel
 * purely to measure.
 *
 * Changelog
 * 2026-06-06  created — Part 2 (revised): continuous in-container validation via gluetunManager
 */

const fs = require('fs');
const gluetun = require('./gluetunManager');
const { runSpeedtest } = require('./speedTester');
const { fetchUSServers } = require('./airvpnStatus');
const { runValidationOnce, nextLoopState, loadState, saveState } = require('./validationLoop');
const { appendServerData, appendRawResult } = require('./rawDataWriter');
const { getESTTimestamp } = require('./estTime');
const logger = require('./logger');

const MODEL_PATH = process.env.MODEL_PATH || '/config/server-model.json';
const STATE_PATH = '/data/validation-state.json';
const LOG_PATH = '/data/validation-log.jsonl';
const RUNS_PER_SERVER = parseInt(process.env.VALIDATION_RUNS_PER_SERVER || '2', 10);
const GAP_MS = parseInt(process.env.VALIDATION_GAP_MS || '5000', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Write each measured server's speedtests in the canonical format (same shape the
// report + buildModel.js read): server-data.json keyed by session timestamp, and
// raw-results.json keyed `${ts}_${run}-${total}`. Writes into the desktop /data.
async function writeCanonical(raw) {
  for (const part of [raw.current, raw.alternative]) {
    if (!part || !part.runs || !part.runs.length || !part.liveRow) continue;
    await appendServerData(part.ts, part.liveRow);
    const total = part.runs.length;
    for (let i = 0; i < total; i++) {
      await appendRawResult(`${part.ts}_${i + 1}-${total}`, part.runs[i]);
    }
  }
}

// captureBaseConfig() must succeed before the first switchServer() (which tears
// down before checking for the base). Retry until gluetun + runner are inspectable.
async function waitForBaseConfig(maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i++) {
    if (await gluetun.captureBaseConfig()) return;
    logger.info(`waitForBaseConfig: stack not ready yet (attempt ${i}/${maxAttempts})`);
    await sleep(2000);
  }
  throw new Error('waitForBaseConfig: gluetun base config never captured — is the stack up?');
}

async function onePass() {
  logger.fn(__filename, 'onePass', null);
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
  const servers = model.candidates.map(c => c.server);
  const state = loadState(STATE_PATH);
  // Cold start: begin at index 0 of the top-10 (seeds a real server, not null).
  const currentServer = state.current || servers[0];

  const { decision, record, raw } = await runValidationOnce({
    model,
    currentServer,
    fetchStatus: fetchUSServers,
    switchServer: gluetun.switchServer,
    runSpeedtest,
    runsPerServer: RUNS_PER_SERVER,
    now: () => new Date().toISOString(),
    sessionStamp: getESTTimestamp,
    log: msg => logger.info(`validation: ${msg}`),
  });

  // Persist BOTH: the decision-scoring record (validation-log.jsonl) and the raw
  // speedtests in canonical format (so report/index.html + buildModel can use them).
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  await writeCanonical(raw);

  // Rotate through all 10 for coverage: advisor drives switches; after 2 stays,
  // force-step to the next server in the list so we don't park on one.
  const newState = nextLoopState(decision, state, servers);
  saveState(STATE_PATH, { ...newState, updatedAt: new Date().toISOString() });
  const next = newState.current;

  const c = record.current, a = record.alternative;
  const secs = Math.round((record.timing.durationMs || 0) / 1000);
  logger.info(
    `validation RESULT: ${decision.action.toUpperCase()}${decision.to ? ' → ' + decision.to : ''} [${decision.zone}] | ` +
    `${c.server}@${c.load}% pred ${c.predicted}/meas ${c.measured}` +
    (a ? ` | alt ${a.server}@${a.load}% pred ${a.predicted}/meas ${a.measured}` : '') +
    ` | gap ${record.scoring.measuredGap} correct=${record.scoring.decisionCorrect} | ${secs}s | next=${next}`
  );
}

async function main() {
  logger.info(`validationMain: starting — model ${MODEL_PATH}, runsPerServer ${RUNS_PER_SERVER}, gap ${GAP_MS}ms`);
  await waitForBaseConfig();

  // Continuous: passes are ~2 min, so loop back-to-back to gather data fast.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await onePass();
    } catch (err) {
      logger.error(`validationMain: pass failed — ${err.message}`);
    }
    await sleep(GAP_MS);
  }
}

main().catch(err => {
  logger.error(`validationMain: fatal — ${err.message}`);
  process.exitCode = 1;
});
