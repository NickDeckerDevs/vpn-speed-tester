const logger = require('./logger');
const scheduler = require('./scheduler');
const { run, MODES } = require('./runner');

const args = process.argv.slice(2);

if (args.includes('--single')) {
  logger.info('vpn-speed-tester orchestrator starting — mode: SINGLE');
  run({ mode: MODES.SINGLE }).catch(err => {
    logger.error(`Single run failed: ${err.message}`);
    process.exit(1);
  });
} else if (args.includes('--infinite')) {
  logger.info('vpn-speed-tester orchestrator starting — mode: INFINITE');
  run({ mode: MODES.INFINITE }).catch(err => {
    logger.error(`Infinite run failed: ${err.message}`);
    process.exit(1);
  });
} else {
  logger.info('vpn-speed-tester orchestrator starting — mode: SCHEDULED');
  scheduler.start();
}
