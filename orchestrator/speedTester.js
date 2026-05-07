const Docker = require('dockerode');
const logger = require('./logger');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function runSpeedtest() {
  logger.fn(__filename, 'runSpeedtest', null);
  logger.info('runSpeedtest: running speedtest-cli --json --secure inside speedtest-runner...');

  const container = docker.getContainer(config.SPEEDTEST_CONTAINER);
  const exec = await container.exec({
    Cmd: ['speedtest-cli', '--json', '--secure'],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({});

  const { stdout, stderr } = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    container.modem.demuxStream(
      stream,
      { write: chunk => { out += chunk.toString(); } },
      { write: chunk => { err += chunk.toString(); } }
    );
    stream.on('end', () => resolve({ stdout: out, stderr: err }));
    stream.on('error', reject);
  });

  const inspected = await exec.inspect();
  if (inspected.ExitCode !== 0) {
    throw new Error(`speedtest-cli exited ${inspected.ExitCode} — stderr: ${stderr.trim()}`);
  }

  const data = JSON.parse(stdout.trim());
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
