const { spawnSync } = require('child_process');

function runSpeedtest() {
  const result = spawnSync('speedtest-cli', ['--json', '--secure'], {
    encoding: 'utf8',
    timeout: 120000,
  });

  if (result.status !== 0) {
    throw new Error(`speedtest-cli failed: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return {
    download_mbps: parseFloat((data.download / 1_000_000).toFixed(2)),
    upload_mbps:   parseFloat((data.upload   / 1_000_000).toFixed(2)),
    ping_ms:       parseFloat(data.ping.toFixed(2)),
    jitter_ms:     parseFloat((data.server?.latency ?? 0).toFixed(2)),
  };
}

module.exports = { runSpeedtest };
