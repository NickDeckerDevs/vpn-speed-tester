#!/usr/bin/env node
// One-shot test: pause all qBittorrent torrents, confirm, then resume.
// Run from the orchestrator/ directory:
//   node test-qbt-pause.js           (pause + resume)
//   node test-qbt-pause.js --pause   (pause only, leave paused)

const { pauseAll, resumeAll } = require('./qbtClient');
const logger = require('./logger');

const pauseOnly = process.argv.includes('--pause');


(async () => {
  logger.fn(__filename, 'async()', null);
  try {
    logger.info('>> pauseAll...');
    await pauseAll();
    logger.info('>> pauseAll succeeded');

    if (!pauseOnly) {
      logger.info('>> resumeAll...');
      await resumeAll();
      logger.info('>> resumeAll succeeded');
    } else {
      logger.info('>> --pause flag set — leaving torrents stopped');
    }
  } catch (err) {
    logger.warn('FAILED:', err.message);
    process.exit(1);
  }
})();
