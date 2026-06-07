/*
 * mediaSwitch.test.js — pure-logic tests for the media-stack VPN switch.
 * Run: node orchestrator/mediaSwitch.test.js
 *
 * No Docker, no config.js, no logger.js: every side effect is injected and we assert
 * on the recorded call order. Each test encodes WHY the behavior matters.
 */

const assert = require('node:assert');
const { isRider, discoverRiders, riderCreateSpec, switchMediaServer } = require('./mediaSwitch');

let passed = 0;
const asyncQueue = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}
// Register async tests; they run (in order) from the main() runner at the bottom.
function asyncTest(name, fn) {
  asyncQueue.push(async () => {
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      throw err;
    }
  });
}

const GLUETUN = { id: 'abc123', name: 'gluetun' };

// ── isRider ───────────────────────────────────────────────────────────────────
// WHY: a switch must catch riders whether started by compose (service:/container:name)
// or recreated by us (container:<id>). Missing a form would orphan an app on the OLD tunnel.
test('isRider matches container:<id>', () => {
  assert.strictEqual(isRider('container:abc123', GLUETUN), true);
});
test('isRider matches container:<name>', () => {
  assert.strictEqual(isRider('container:gluetun', GLUETUN), true);
});
test('isRider matches service:<name> (compose form)', () => {
  assert.strictEqual(isRider('service:gluetun', GLUETUN), true);
});
test('isRider rejects an independent bridge container', () => {
  assert.strictEqual(isRider('media-lan', GLUETUN), false);
});
test('isRider rejects host networking (homeassistant)', () => {
  assert.strictEqual(isRider('host', GLUETUN), false);
});
test('isRider rejects a different container netns', () => {
  assert.strictEqual(isRider('container:other999', GLUETUN), false);
});
test('isRider rejects empty/undefined networkMode', () => {
  assert.strictEqual(isRider(undefined, GLUETUN), false);
  assert.strictEqual(isRider('', GLUETUN), false);
});

// ── discoverRiders ──────────────────────────────────────────────────────────────
// WHY: after cleanup only qbittorrent/prowlarr/byparr ride the VPN; jellyfin/caddy must
// NEVER be restarted by a switch. This is the safety boundary of the whole feature.
test('discoverRiders keeps only VPN riders, drops independents', () => {
  const inspected = [
    { name: 'qbittorrent', networkMode: 'service:gluetun' },
    { name: 'prowlarr', networkMode: 'container:abc123' },
    { name: 'byparr', networkMode: 'service:gluetun' },
    { name: 'jellyfin', networkMode: 'media-lan' },
    { name: 'homeassistant', networkMode: 'host' },
    { name: 'caddy', networkMode: 'media-lan' },
  ];
  const riders = discoverRiders(inspected, GLUETUN).map(r => r.name);
  assert.deepStrictEqual(riders, ['qbittorrent', 'prowlarr', 'byparr']);
});
test('discoverRiders returns empty when nothing rides gluetun', () => {
  const inspected = [{ name: 'jellyfin', networkMode: 'media-lan' }];
  assert.deepStrictEqual(discoverRiders(inspected, GLUETUN), []);
});

// ── riderCreateSpec ──────────────────────────────────────────────────────────────
// WHY: a rider must come back pinned to the NEW gluetun id (not the dead one), and must
// NOT carry ports/hostname (Docker rejects those on a netns-sharing container).
test('riderCreateSpec re-pins NetworkMode to the new gluetun id', () => {
  const info = {
    Name: '/qbittorrent',
    Config: { Image: 'qbit:1', Env: ['A=1'], Cmd: ['run'], Entrypoint: null, Labels: {} },
    HostConfig: { NetworkMode: 'container:OLD', Binds: ['/c:/config'] },
  };
  const spec = riderCreateSpec(info, 'NEW999');
  assert.strictEqual(spec.HostConfig.NetworkMode, 'container:NEW999');
  assert.strictEqual(spec.name, 'qbittorrent'); // leading slash stripped
  assert.strictEqual(spec.Image, 'qbit:1');
  assert.deepStrictEqual(spec.HostConfig.Binds, ['/c:/config']); // volumes preserved
  assert.ok(!('Hostname' in spec)); // not carried — would break a container:-mode container
  assert.ok(!('ExposedPorts' in spec));
});

// ── switchMediaServer orchestration ─────────────────────────────────────────────
function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    pauseQbt: async () => calls.push('pauseQbt'),
    resumeQbt: async () => calls.push('resumeQbt'),
    inspectAll: async () => [
      { name: 'qbittorrent', networkMode: 'service:gluetun', info: { Name: '/qbittorrent' } },
      { name: 'prowlarr', networkMode: 'service:gluetun', info: { Name: '/prowlarr' } },
      { name: 'jellyfin', networkMode: 'media-lan', info: { Name: '/jellyfin' } },
    ],
    gluetun: GLUETUN,
    stopContainer: async name => calls.push(`stop:${name}`),
    recreateGluetun: async server => { calls.push(`recreateGluetun:${server}`); return 'NEWID'; },
    waitForTunnel: async () => calls.push('waitForTunnel'),
    recreateRider: async info => calls.push(`recreate:${(info.Name || '').replace(/^\//, '')}`),
    log: () => {},
    ...overrides,
  };
  return { deps, calls };
}

asyncTest('switchMediaServer runs the full sequence in the correct order', async () => {
  const { deps, calls } = makeDeps();
  await switchMediaServer('Aladfar', deps);
  assert.deepStrictEqual(calls, [
    'pauseQbt',
    'stop:qbittorrent',
    'stop:prowlarr',
    'recreateGluetun:Aladfar',
    'waitForTunnel',
    'recreate:qbittorrent',
    'recreate:prowlarr',
    'resumeQbt',
  ]);
  // jellyfin (independent) is never touched.
  assert.ok(!calls.some(c => c.includes('jellyfin')));
});

asyncTest('switchMediaServer stops ALL riders before recreating gluetun (netns hazard)', async () => {
  const { deps, calls } = makeDeps();
  await switchMediaServer('Aladfar', deps);
  const lastStop = calls.lastIndexOf('stop:prowlarr');
  const recreateIdx = calls.indexOf('recreateGluetun:Aladfar');
  assert.ok(lastStop < recreateIdx, 'every rider must be stopped before gluetun is recreated');
});

asyncTest('switchMediaServer waits for the tunnel BEFORE recreating riders', async () => {
  const { deps, calls } = makeDeps();
  await switchMediaServer('Aladfar', deps);
  const tunnelIdx = calls.indexOf('waitForTunnel');
  const firstRecreate = calls.findIndex(c => c.startsWith('recreate:'));
  assert.ok(tunnelIdx < firstRecreate, 'riders must only re-attach after the tunnel is up');
});

asyncTest('switchMediaServer resumes qBittorrent even if a rider fails to come back', async () => {
  const { deps, calls } = makeDeps({
    recreateRider: async () => { calls.push('recreate-FAIL'); throw new Error('boom'); },
  });
  await assert.rejects(() => switchMediaServer('Aladfar', deps), /boom/);
  assert.strictEqual(calls[calls.length - 1], 'resumeQbt', 'resume must still run (fail-safe)');
});

asyncTest('switchMediaServer resumes qBittorrent even if gluetun recreate fails', async () => {
  const { deps, calls } = makeDeps({
    recreateGluetun: async () => { throw new Error('tunnel dead'); },
  });
  await assert.rejects(() => switchMediaServer('Aladfar', deps), /tunnel dead/);
  assert.ok(calls.includes('resumeQbt'), 'resume must still run after a gluetun failure');
});

asyncTest('switchMediaServer with no riders still recreates gluetun and resumes', async () => {
  const { deps, calls } = makeDeps({
    inspectAll: async () => [{ name: 'jellyfin', networkMode: 'media-lan', info: { Name: '/jellyfin' } }],
  });
  await switchMediaServer('Aladfar', deps);
  assert.deepStrictEqual(calls, ['pauseQbt', 'recreateGluetun:Aladfar', 'waitForTunnel', 'resumeQbt']);
});

(async () => {
  for (const run of asyncQueue) await run();
  console.log(`\nmediaSwitch.test.js — ${passed} tests passed`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
