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
const { runValidationOnce, loadState, saveState } = require('./validationLoop');
const logger = require('./logger');

const MODEL_PATH = process.env.MODEL_PATH || '/config/server-model.json';
const STATE_PATH = '/data/validation-state.json';
const LOG_PATH = '/data/validation-log.jsonl';
const RUNS_PER_SERVER = parseInt(process.env.VALIDATION_RUNS_PER_SERVER || '2', 10);
const GAP_MS = parseInt(process.env.VALIDATION_GAP_MS || '5000', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  const state = loadState(STATE_PATH);

  const { decision, record, next } = await runValidationOnce({
    model,
    currentServer: state.current,
    fetchStatus: fetchUSServers,
    switchServer: gluetun.switchServer,
    runSpeedtest,
    runsPerServer: RUNS_PER_SERVER,
    now: () => new Date().toISOString(),
    log: msg => logger.info(`validation: ${msg}`),
  });

  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  saveState(STATE_PATH, { current: next, updatedAt: new Date().toISOString() });

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
