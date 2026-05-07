const logger = require('./logger');
const scheduler = require('./scheduler');

const args = process.argv.slice(2);
const isManual = args.includes('--manual');

logger.info(`vpn-speed-tester orchestrator starting — mode: ${isManual ? 'MANUAL' : 'SCHEDULED'}`);

if (isManual) {
  logger.info('Manual run: triggering one speed test window immediately');
  scheduler.runSpeedTestWindow().catch(err => {
    logger.error(`Manual run failed: ${err.message}`);
    process.exit(1);
  });
} else {
  scheduler.start();
}
