/*
6/6/2026 - nick decker | Refactor
ADDED
- --infinite CLI flag and INFINITE mode branch — calls scheduler.runSpeedTestWindow({ infinite: true }); replaces the standalone infiniteRunner.js entry point

CHANGED
- startup mode label is now three-way (MANUAL (single) / INFINITE / SCHEDULED) for clearer log output
*/

const logger = require('./logger');
const scheduler = require('./scheduler');

const args = process.argv.slice(2);
const isManual = args.includes('--manual');
const isInfinite = args.includes('--infinite');

const mode = isManual ? 'MANUAL (single)' : isInfinite ? 'INFINITE' : 'SCHEDULED';
logger.info(`vpn-speed-tester orchestrator starting — mode: ${mode}`);

if (isManual) {
  logger.info('Manual run: triggering one speed test window immediately');
  scheduler.runSpeedTestWindow({ singleRun: true }).catch(err => {
    logger.error(`Manual run failed: ${err.message}`);
    process.exit(1);
  });
} else if (isInfinite) {
  logger.info('Infinite run: looping all servers continuously, resetting coverage when complete');
  scheduler.runSpeedTestWindow({ infinite: true }).catch(err => {
    logger.error(`Infinite run failed: ${err.message}`);
    process.exit(1);
  });
} else {
  scheduler.start();
}
