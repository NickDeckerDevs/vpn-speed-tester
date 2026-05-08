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
    const timeout = setTimeout(() => {
      reject(new Error('speedtest-cli timeout after 600s'));
    }, 600000);
    container.modem.demuxStream(
      stream,
      { write: chunk => { out += chunk.toString(); } },
      { write: chunk => { err += chunk.toString(); } }
    );
    stream.on('end', () => {
      clearTimeout(timeout);
      resolve({ stdout: out, stderr: err });
    });
    stream.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const inspected = await exec.inspect();
  if (inspected.ExitCode === 137) {
    logger.warn('runSpeedtest: speedtest-cli was killed (exit 137) — likely during container teardown');
  } else if (inspected.ExitCode !== 0) {
    throw new Error(`speedtest-cli exited ${inspected.ExitCode} — stderr: ${stderr.trim()}`);
  }

  let data;
  try {
    data = JSON.parse(stdout.trim());
  } catch (err) {
    if (inspected.ExitCode === 137) {
      logger.warn('runSpeedtest: incomplete JSON output due to kill signal — skipping partial result');
      throw new Error('speedtest-cli killed before output was complete');
    }
    throw err;
  }
  logger.dump('DATA', data);

  const download_mbps = parseFloat((data.download / 1_000_000).toFixed(2));
  const upload_mbps = parseFloat((data.upload / 1_000_000).toFixed(2));
  const ping_ms = parseFloat(data.ping.toFixed(2));

  logger.info(
    `runSpeedtest: ↓${download_mbps} Mbps  ↑${upload_mbps} Mbps  ` +
    `ping ${ping_ms}ms`
  );

  return data;
}

module.exports = { runSpeedtest };
