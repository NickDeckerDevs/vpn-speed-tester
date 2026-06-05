const cron = require('node-cron');
const logger = require('./logger');
const config = require('./config');
const { run, MODES } = require('./runner');
const { writeHourlySnapshot } = require('./snapshotWriter');

function start() {
  logger.fn(__filename, 'start', null);

  const speedSchedule = `0 ${config.TEST_START_HOUR} * * *`;
  cron.schedule(speedSchedule, () => {
    run({ mode: MODES.WINDOW }).catch(err => logger.error(`Speed test window unhandled error: ${err.message}`));
  });
  logger.info(`start: speed test cron registered — "${speedSchedule}" (${config.TEST_START_HOUR}:00 AM daily)`);

  cron.schedule('30 * * * *', () => {
    logger.info('Hourly snapshot cron firing...');
    writeHourlySnapshot().catch(err => logger.error(`Hourly snapshot error: ${err.message}`));
  });
  logger.info('start: snapshot cron registered — "30 * * * *" (every hour at :30 past)');
}

module.exports = { start };
