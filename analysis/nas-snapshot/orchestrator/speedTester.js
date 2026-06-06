const Docker = require('dockerode');
const logger = require('./logger');
const config = require('./config');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function runSpeedtest() {
  logger.fn(__filename, 'runSpeedtest', null);

  // WE AREN'T VERIFYING THE GLUTEN CONTAINER IS RUNNING. BECAUSE whiule this was happening
  // there was no gluetun
  /*
────────────────────────────────────────────
[2026-05-08T05:16:09.290Z] [INFO ] SESSION: Chertan | tier: diablo | load: 86% | Miami
[2026-05-08T05:16:09.290Z] [INFO ] ────────────────────────────────────────────
[2026-05-08T05:16:09.290Z] [INFO ] SESSION: switching gluetun to Chertan...
[2026-05-08T05:16:09.290Z] [INFO ] starting gluetunManager.js-switchServer | args: {"serverName":"Chertan"}
[2026-05-08T05:16:09.296Z] [INFO ] switchServer: stopping speedtest-runner (state: running)...
[2026-05-08T05:16:19.669Z] [INFO ] switchServer: removing speedtest-runner...
[2026-05-08T05:16:19.687Z] [INFO ] switchServer: speedtest-runner removed
[2026-05-08T05:16:19.687Z] [INFO ] switchServer: stopping gluetun-speedtest...
[2026-05-08T05:16:19.976Z] [INFO ] switchServer: removing gluetun-speedtest...
[2026-05-08T05:16:19.996Z] [INFO ] switchServer: gluetun-speedtest removed
[2026-05-08T05:16:19.996Z] [INFO ] switchServer: creating new gluetun-speedtest → Chertan...
[2026-05-08T05:16:20.430Z] [INFO ] switchServer: container started → Chertan
[2026-05-08T05:16:20.431Z] [INFO ] starting gluetunManager.js-waitForTunnel | args: {"timeoutMs":180000}
[2026-05-08T05:16:20.437Z] [ERROR] [tunnel check] ECONNREFUSED — is the service running?
[2026-05-08T05:16:25.441Z] [INFO ] waitForTunnel: tunnel confirmed after 2 attempt(s)
[2026-05-08T05:16:25.442Z] [INFO ] switchServer: creating new speedtest-runner (image: vpn-speed-tester-speedtest-runner)...
[2026-05-08T05:16:25.705Z] [INFO ] switchServer: speedtest-runner ready
[2026-05-08T05:16:25.705Z] [INFO ] SESSION: verifying speedtest-runner is live...
[2026-05-08T05:16:25.706Z] [INFO ] starting gluetunManager.js-ensureSpeedtestRunner | args: none
[2026-05-08T05:16:25.708Z] [INFO ] ensureSpeedtestRunner: state=running running=true pid=30314
[2026-05-08T05:16:25.741Z] [INFO ] starting rawDataWriter.js-appendServerData | args: {"timestamp":"20260508011625"}
[2026-05-08T05:16:25.745Z] [INFO ] appendServerData: saved server "Chertan" with timestamp 20260508011625
[2026-05-08T05:16:25.745Z] [INFO ] SESSION: saved server data with timestamp 20260508011625
[2026-05-08T05:16:25.745Z] [INFO ] RUN 1/3: running speedtest...
[2026-05-08T05:16:25.746Z] [INFO ] starting speedTester.js-runSpeedtest | args: none
[2026-05-08T05:16:25.747Z] [INFO ] runSpeedtest: container state=running running=true pid=30314
[2026-05-08T05:16:25.747Z] [INFO ] runSpeedtest: running speedtest-cli --json --secure inside speedtest-runner...
[2026-05-08T05:17:18.200Z] [INFO ] runSpeedtest: speedtest-cli exit code 0
[2026-05-08T05:17:18.200Z] [INFO ] =====[ DATA ]=====
[2026-05-08T05:17:18.200Z] [INFO ] {"download":329258191.54916435,"upload":82246287.3700621,"ping":29.286,"server":{"url":"http://miami.fl.speedtest.frontier.com:8080/speedtest/upload.php","lat":"25.7878","lon":"-80.2242","name":"Miami, FL","country":"United States","cc":"US","sponsor":"Frontier","id":"14237","host":"miami.fl.speedtest.frontier.com:8080","d":21.59962841506205,"latency":29.286},"timestamp":"2026-05-08T05:16:30.290381Z","bytes_sent":147873792,"bytes_received":408623000,"share":null,"client":{"ip":"193.37.252.167","lat":"25.9092","lon":"-80.3927","isp":"M247 Europe","isprating":"3.7","rating":"0","ispdlavg":"0","ispulavg":"0","loggedin":"0","country":"US"}}
[2026-05-08T05:17:18.200Z] [INFO ] =====[ DATA ]=====
[2026-05-08T05:17:18.200Z] [INFO ] runSpeedtest: ↓329.26 Mbps  ↑82.25 Mbps  ping 29.29ms
[2026-05-08T05:17:18.201Z] [INFO ] starting rawDataWriter.js-appendRawResult | args: {"key":"20260508011625_1-3"}
[2026-05-08T05:17:18.204Z] [INFO ] appendRawResult: saved result for key 20260508011625_1-3
[2026-05-08T05:17:18.204Z] [INFO ] RUN 1/3 complete: ↓329.26 Mbps ↑82.25 Mbps ping 29.29ms
[2026-05-08T05:17:18.204Z] [INFO ] RUN 1/3: waiting 15s before next run...
[2026-05-08T05:17:33.214Z] [INFO ] RUN 2/3: running speedtest...
[2026-05-08T05:17:33.214Z] [INFO ] starting speedTester.js-runSpeedtest | args: none
[2026-05-08T05:17:33.218Z] [INFO ] runSpeedtest: container state=running running=true pid=30314
[2026-05-08T05:17:33.218Z] [INFO ] runSpeedtest: running speedtest-cli --json --secure inside speedtest-runner...
[2026-05-08T05:17:59.668Z] [INFO ] runSpeedtest: speedtest-cli exit code 0
[2026-05-08T05:17:59.668Z] [INFO ] =====[ DATA ]=====
[2026-05-08T05:17:59.668Z] [INFO ] {"download":381287606.00944763,"upload":46590417.38186523,"ping":18.242,"server":{"url":"http://stosat-bspr-01.sys.comcast.net:8080/speedtest/upload.php","lat":"26.3548","lon":"-81.7387","name":"Bonita Springs, FL","country":"United States","cc":"US","sponsor":"Comcast","id":"8087","host":"stosat-bspr-01.sys.comcast.net:8080","d":143.21278682485342,"latency":18.242},"timestamp":"2026-05-08T05:17:33.793847Z","bytes_sent":81608704,"bytes_received":409373932,"share":null,"client":{"ip":"193.37.252.167","lat":"25.9092","lon":"-80.3927","isp":"M247 Europe","isprating":"3.7","rating":"0","ispdlavg":"0","ispulavg":"0","loggedin":"0","country":"US"}}
[2026-05-08T05:17:59.669Z] [INFO ] =====[ DATA ]=====
[2026-05-08T05:17:59.669Z] [INFO ] runSpeedtest: ↓381.29 Mbps  ↑46.59 Mbps  ping 18.24ms
[2026-05-08T05:17:59.669Z] [INFO ] starting rawDataWriter.js-appendRawResult | args: {"key":"20260508011625_2-3"}
[2026-05-08T05:17:59.672Z] [INFO ] appendRawResult: saved result for key 20260508011625_2-3
[2026-05-08T05:17:59.672Z] [INFO ] RUN 2/3 complete: ↓381.29 Mbps ↑46.59 Mbps ping 18.24ms
[2026-05-08T05:17:59.672Z] [INFO ] RUN 2/3: waiting 15s before next run...
[2026-05-08T05:18:14.680Z] [INFO ] RUN 3/3: running speedtest...
[2026-05-08T05:18:14.680Z] [INFO ] starting speedTester.js-runSpeedtest | args: none
[2026-05-08T05:18:14.683Z] [INFO ] runSpeedtest: container state=running running=true pid=30314
[2026-05-08T05:18:14.683Z] [INFO ] runSpeedtest: running speedtest-cli --json --secure inside speedtest-runner...
  */
  const container = docker.getContainer(config.SPEEDTEST_CONTAINER);

  // Pre-flight: verify container exists and is running before attempting exec
  try {
    const info = await container.inspect();
    logger.info(`runSpeedtest: container state=${info.State.Status} running=${info.State.Running} pid=${info.State.Pid}`);
    if (!info.State.Running) {
      logger.error(`runSpeedtest: container not running — full state: ${JSON.stringify(info.State)}`);
      throw new Error(`speedtest-runner not running (state: ${info.State.Status}) — call ensureSpeedtestRunner() before running`);
    }
  } catch (err) {
    if (err.statusCode === 404) {
      logger.error('runSpeedtest: container not found (404) — was it removed? Check gluetun lifecycle logs.');
      throw new Error('speedtest-runner container is missing (404) — needs ensureSpeedtestRunner()');
    }
    logger.error(`runSpeedtest: container inspect failed — ${err.message} (statusCode: ${err.statusCode ?? 'n/a'})`);
    throw err;
  }

  logger.info('runSpeedtest: running speedtest-cli --json --secure inside speedtest-runner...');

  const exec = await container.exec({
    Cmd: ['speedtest-cli', '--json', '--secure'],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({});

  const startMs = Date.now();
  const { stdout, stderr } = await new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timeout = setTimeout(() => {
      reject(new Error('speedtest-cli timeout after 600s'));
    }, 600000);
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      let phase;
      if (elapsed < 2)       phase = 'connecting / selecting server';
      else if (elapsed < 12) phase = `download test (~${elapsed}s elapsed)`;
      else                   phase = `upload test (~${elapsed}s elapsed)`;
      logger.info(`speedtest: ${phase}...`);
    }, 4500);
    container.modem.demuxStream(
      stream,
      { write: chunk => { out += chunk.toString(); } },
      { write: chunk => { err += chunk.toString(); } }
    );
    stream.on('end', () => {
      clearInterval(progressInterval);
      clearTimeout(timeout);
      resolve({ stdout: out, stderr: err });
    });
    stream.on('error', err => {
      clearInterval(progressInterval);
      clearTimeout(timeout);
      reject(err);
    });
  });

  const inspected = await exec.inspect();
  logger.info(`runSpeedtest: speedtest-cli exit code ${inspected.ExitCode}`);
  if (stderr.trim()) {
    logger.warn(`runSpeedtest: stderr:\n${stderr.trim()}`);
  }

  if (inspected.ExitCode === 137) {
    logger.warn('runSpeedtest: speedtest-cli was killed (exit 137) — likely during container teardown');
  } else if (inspected.ExitCode !== 0) {
    logger.error(`runSpeedtest: speedtest-cli failed — exit ${inspected.ExitCode} | stderr: ${stderr.trim()} | stdout: ${stdout.trim().slice(0, 300)}`);
    throw new Error(`speedtest-cli exited ${inspected.ExitCode} — ${stderr.trim()}`);
  }

  let data;
  try {
    data = JSON.parse(stdout.trim());
  } catch (err) {
    if (inspected.ExitCode === 137) {
      logger.warn('runSpeedtest: incomplete JSON output due to kill signal — skipping partial result');
      throw new Error('speedtest-cli killed before output was complete');
    }
    logger.error(`runSpeedtest: JSON parse failed — raw stdout: ${stdout.trim().slice(0, 300)}`);
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
