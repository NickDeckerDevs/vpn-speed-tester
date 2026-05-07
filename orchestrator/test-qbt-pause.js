#!/usr/bin/env node
// One-shot test: pause all qBittorrent torrents, confirm, then resume.
// Run from the orchestrator/ directory:
//   node test-qbt-pause.js           (pause + resume)
//   node test-qbt-pause.js --pause   (pause only, leave paused)

const { pauseAll, resumeAll } = require('./qbtClient');

const pauseOnly = process.argv.includes('--pause');

(async () => {
  try {
    console.log('>> pauseAll...');
    await pauseAll();
    console.log('>> pauseAll succeeded');

    if (!pauseOnly) {
      console.log('>> resumeAll...');
      await resumeAll();
      console.log('>> resumeAll succeeded');
    } else {
      console.log('>> --pause flag set — leaving torrents stopped');
    }
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})();
