const scheduler = require('./scheduler');

const args = process.argv.slice(2);

if (args.includes('--manual')) {
  scheduler.runSpeedTestWindow().catch(err => {
    console.error('Manual run failed:', err);
    process.exit(1);
  });
} else {
  scheduler.start();
}
