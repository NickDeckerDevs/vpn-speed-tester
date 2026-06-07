/*
 * mediaSwitch.js — "the hands": put the media stack's VPN (gluetun) on a different
 * server, restarting exactly the apps that ride gluetun's network namespace.
 *
 * Pure logic + a dependency-injected orchestrator (like validationLoop.js), so the
 * decision/ordering can be unit-tested without Docker. The runnable wiring lives in
 * mediaSwitchMain.js; the proven Docker primitives are reused from gluetunManager.js
 * (tearDown / getEnv / startGluetunTunnel / waitForTunnel) and qbtClient.js.
 *
 * Why discover-and-restart instead of a hardcoded list: a switch must restart
 * whatever currently shares gluetun's netns. If the stack-cleanup later moves some
 * apps off the VPN, this code does less work with no change (see media-stack/).
 *
 * Hazards encoded here (learned in the desktop validation work):
 *   - stop the riders BEFORE recreating gluetun (they share its netns),
 *   - clean stop+remove (never a "force recreate", which orphaned name-conflicting
 *     containers), and
 *   - never let two things recreate containers at once (single sequential pass).
 */

// At runtime, compose's `network_mode: "service:gluetun"` is resolved by Docker to
// `container:<gluetun-id>`. Accept both that and the by-name forms so discovery works
// whether the riders were started by compose or recreated by us.
function isRider(networkMode, gluetun) {
  if (!networkMode) return false;
  const { id, name } = gluetun;
  return (id && networkMode === `container:${id}`)
    || (name && (networkMode === `container:${name}` || networkMode === `service:${name}`));
}

// inspected: [{ name, networkMode, info }]  (info = the docker inspect result, captured
// BEFORE teardown so we can recreate faithfully). gluetun: { id, name } of the current
// VPN container. Returns the subset riding gluetun's network namespace.
function discoverRiders(inspected, gluetun) {
  return inspected.filter(c => isRider(c.networkMode, gluetun));
}

// Build the dockerode createContainer spec to bring a rider back, re-pinned to the NEW
// gluetun container. We deliberately do NOT carry Hostname/ExposedPorts/PortBindings:
// a container sharing another's netns owns none of those (gluetun publishes the ports),
// and Docker rejects them on a `container:`-mode container.
function riderCreateSpec(info, newGluetunId) {
  return {
    name: (info.Name || '').replace(/^\//, ''),
    Image: info.Config.Image,
    Env: info.Config.Env,
    Labels: info.Config.Labels,
    Entrypoint: info.Config.Entrypoint,
    Cmd: info.Config.Cmd,
    HostConfig: {
      ...info.HostConfig,
      NetworkMode: `container:${newGluetunId}`,
    },
  };
}

/*
 * switchMediaServer(serverName, deps) — the recommended hands-review sequence:
 *   1. pause qBittorrent gracefully   2. stop the discovered riders
 *   3. recreate gluetun on serverName 4. wait for the tunnel
 *   5. recreate the riders re-attached 6. resume qBittorrent (fail-safe: always).
 *
 * deps (all injected so this is testable without Docker):
 *   pauseQbt()                       — graceful qBittorrent pause
 *   resumeQbt()                      — resume (called in finally; must tolerate failure)
 *   inspectAll() -> [{name,networkMode,info}]  — every container, for discovery
 *   gluetun: { id, name }            — the current VPN container
 *   stopContainer(name)              — clean stop + remove
 *   recreateGluetun(serverName) -> newGluetunId
 *   waitForTunnel()                  — resolves once the tunnel is confirmed up
 *   recreateRider(info, newGluetunId)
 *   log(msg)                         — optional progress sink
 */
async function switchMediaServer(serverName, deps) {
  const {
    pauseQbt, resumeQbt, inspectAll, gluetun,
    stopContainer, recreateGluetun, waitForTunnel, recreateRider,
    log = () => {},
  } = deps;

  log(`switch → ${serverName}`);
  await pauseQbt();

  try {
    const riders = discoverRiders(await inspectAll(), gluetun);
    log(`riders riding ${gluetun.name}: ${riders.map(r => r.name).join(', ') || '(none)'}`);

    // Stop riders BEFORE gluetun — they share its netns.
    for (const r of riders) {
      log(`stop ${r.name}`);
      await stopContainer(r.name);
    }

    const newGluetunId = await recreateGluetun(serverName);
    log(`gluetun recreated as ${newGluetunId} — waiting for tunnel...`);
    await waitForTunnel();
    log('tunnel up');

    for (const r of riders) {
      log(`recreate ${r.name} → container:${newGluetunId}`);
      await recreateRider(r.info, newGluetunId);
    }
  } finally {
    // Always resume qBittorrent, even if a rider failed to come back.
    await resumeQbt();
  }
}

module.exports = { isRider, discoverRiders, riderCreateSpec, switchMediaServer };
