const { spawnSync } = require('child_process');
const logger = require('./logger');

function runSpeedtest() {
  logger.fn(__filename, 'runSpeedtest', null);
  logger.info('runSpeedtest: running speedtest-cli --json --secure...');

  const result = spawnSync('speedtest-cli', ['--json', '--secure'], {
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status !== 0) {
    logger.error(`runSpeedtest: speedtest-cli exited ${result.status} — stderr: ${result.stderr}`);
    throw new Error(`speedtest-cli failed: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  const parsed = {
    download_mbps: parseFloat((data.download / 1_000_000).toFixed(2)),
    upload_mbps:   parseFloat((data.upload   / 1_000_000).toFixed(2)),
    ping_ms:       parseFloat(data.ping.toFixed(2)),
    jitter_ms:     parseFloat((data.server?.latency ?? 0).toFixed(2)),
  };

  logger.info(
    `runSpeedtest: ↓${parsed.download_mbps} Mbps  ↑${parsed.upload_mbps} Mbps  ` +
    `ping ${parsed.ping_ms}ms  jitter ${parsed.jitter_ms}ms`
  );

  return parsed;
}

module.exports = { runSpeedtest };
