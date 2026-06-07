# Media-stack VPN switch — "the hands"

The ability to put the media stack's VPN (gluetun) on a different server: tear down the tunnel,
recreate it on a new AirVPN server, and restart exactly the apps that ride its network. Built on the
speed-tester's proven machinery. Background and the original analysis: [hands-review.md](hands-review.md).

## Next steps (start here)

1. **Test the switch on the desktop stand-in.** Bring it up and exercise it manually:
   ```
   docker compose -f docker-compose.mediaswitch.desktop.yml up -d --build
   ./vpn media-switch <SERVER_NAME>     # e.g. ./vpn media-switch Aladfar
   ```
   Confirm: the placeholder riders (`ms-qbittorrent`/`ms-prowlarr`/`ms-byparr`) re-attach to the NEW
   gluetun (`docker inspect <rider> --format '{{.HostConfig.NetworkMode}}'` shows the new container id),
   the tunnel comes up, `ms-jellyfin` (independent) is untouched, and no orphaned/name-conflicting
   containers are left behind.
2. **Run the stack cleanup on the real NAS** ([stack-cleanup-checklist.md](stack-cleanup-checklist.md))
   — move radarr/sonarr/lidarr off the VPN, drop speedtest-tracker — using the target compose
   ([target-media-server.yaml](target-media-server.yaml)). Do this together; it touches the live stack.
3. ~~Wire the advisor to decide *when* to switch~~ **DONE** — the brain→decider→hands chain is
   built (see "Auto-switch" below). `./vpn auto-switch` runs one decider tick on the stand-in.
   Remaining before this is trusted in production: **set the guardrails from data** (see
   [Guardrails (TODO before go-live)](#guardrails-todo-before-go-live)).
4. **Web UI / family-requests** parts of the media-stack manager — still out of scope (see the
   [handoff](media-stack-manager-handoff.md)).

## How a switch works

gluetun only reads which server to use **at startup**, so a switch must **destroy and recreate** the
VPN container. Every app sharing its network (`network_mode: "service:gluetun"`) loses its connection
when gluetun goes away and must be restarted to re-attach. That's a hard Docker rule — the reason a
"switch" is more than a one-container operation.

The switch **discovers** which apps currently ride gluetun and restarts exactly those — it does **not**
hardcode a list. So once the stack cleanup moves the arr apps off the VPN, the switch automatically
does less work (3 apps instead of 7) with **no code change**.

## The sequence (`switchMediaServer`)

Implemented in [`orchestrator/mediaSwitch.js`](../orchestrator/mediaSwitch.js) (pure, dependency-injected)
and wired in [`orchestrator/mediaSwitchMain.js`](../orchestrator/mediaSwitchMain.js):

1. **Pause qBittorrent** gracefully (so a download isn't killed mid-write).
2. **Discover + stop the riders** (clean stop + remove).
3. **Recreate gluetun** on the new server (swap `SERVER_NAMES`, start, retry).
4. **Wait for the tunnel** to confirm up.
5. **Recreate each rider**, re-pinned to the new gluetun container id.
6. **Resume qBittorrent** — in a `finally`, so it runs even if a rider fails to come back.

## Hazards encoded (learned the hard way in the desktop validation work)

- **Stop the riders BEFORE recreating gluetun** — they share its netns. Killing gluetun first orphans them.
- **Clean stop + remove, never a "force recreate"** — force-recreate left orphaned, name-conflicting containers.
- **Never let two things recreate containers at once** — the switch is a single sequential pass.
- **Riders carry no ports/hostname on recreate** — a container sharing another's netns can't own ports
  (gluetun publishes them); Docker rejects them. `riderCreateSpec` only re-pins `NetworkMode`.

## Auto-switch — the brain→decider→hands chain

The manual switch (above) is now also driven automatically. Three pure layers, each its own module
and test, connected by a thin runner:

1. **Brain** — [`orchestrator/switchAdvisor.js`](../orchestrator/switchAdvisor.js) `recommend()`:
   given the live AirVPN loads + the learned model, returns stay/switch + which server.
2. **Decider (NEW)** — [`orchestrator/switchDecider.js`](../orchestrator/switchDecider.js) `decide()`:
   gates the recommendation through the **operational policy** ([`switch-policy.json`](switch-policy.json))
   — `enabled`, `dryRun`, `cooldownSec`, `maxSwitchesPerDay`. Returns `{ act, wouldAct, reason }`.
3. **Hands** — [`orchestrator/mediaSwitch.js`](../orchestrator/mediaSwitch.js) `switchMediaServer()`:
   performs the switch (the sequence above).

Runner: [`orchestrator/switchDeciderMain.js`](../orchestrator/switchDeciderMain.js) ticks on
`policy.cron`, reading `switch-policy.json` **fresh each tick** (edit + push changes behavior with no
rebuild). The current server is read live from the gluetun container's `SERVER_NAMES` env (single
source of truth). Each tick appends to `/data/switch-decisions.jsonl`; `/data/switch-state.json` holds
`lastSwitchTime` + today's count. Run one tick manually: `./vpn auto-switch [--current X]`.

**Why policy lives in its own file:** the advisor's *learned* params live in
`analysis/server-model.json`, which `buildModel.js` **regenerates** — so operational knobs there would
be erased on rebuild. `switch-policy.json` is hand-edited and never touched by the model build.

### Guardrails (TODO before go-live)

The shipped [`switch-policy.json`](switch-policy.json) is **intentionally loose** — `cooldownSec: 60`,
`maxSwitchesPerDay: null` (unlimited) — so this phase **observes** how often the advisor actually wants
to switch rather than throttling it. There is **no AirVPN/gluetun ToS limit** on switch frequency (the
documented AirVPN cap is on *simultaneous connections*); the only real cost of switching is **our own
stack's disruption** (each switch drops qBittorrent/prowlarr/byparr mid-work).

**Before relying on auto-switch in production:** set real `cooldownSec` / `maxSwitchesPerDay` derived
from the accumulated `/data/switch-decisions.jsonl` — i.e. measure switch frequency and the per-switch
download cost from actual runs, then pick guardrails from that data, not a guess. The decider already
enforces both (tests cover the blocking paths); they're just dialed open for now.

## Reuse map — what powers the switch

| Concern | Reused from |
|---|---|
| Tunnel teardown / env swap / recreate / health-wait | [`orchestrator/gluetunManager.js`](../orchestrator/gluetunManager.js) — `tearDown`, `getEnv`, `startGluetunTunnel`, `waitForTunnel` |
| Graceful qBittorrent pause/resume | [`orchestrator/qbtClient.js`](../orchestrator/qbtClient.js) — `pauseAll`, `resumeAll` |
| Container names / control URL (env-overridable) | [`orchestrator/config.js`](../orchestrator/config.js) — `GLUETUN_CONTAINER`, `GLUETUN_CONTROL_URL` |
| Switch ordering + rider discovery (NEW) | [`orchestrator/mediaSwitch.js`](../orchestrator/mediaSwitch.js) — `discoverRiders`, `switchMediaServer` |

Tests: [`orchestrator/mediaSwitch.test.js`](../orchestrator/mediaSwitch.test.js) (16, `node:assert`, no Docker)
cover discovery filtering, stop-order, the new-id re-pin, and the fail-safe resume.

## Files in this feature

- [target-media-server.yaml](target-media-server.yaml) — the cleaned-up media compose ("after"; design only, not deployed).
- [stack-cleanup-checklist.md](stack-cleanup-checklist.md) — the deferred cutover runbook for the real NAS.
- [`docker-compose.mediaswitch.desktop.yml`](../docker-compose.mediaswitch.desktop.yml) — desktop stand-in stack.
- `orchestrator/mediaSwitch.js` · `mediaSwitchMain.js` · `mediaSwitch.test.js` — the switch (hands).
- `orchestrator/switchDecider.js` · `switchDecider.test.js` — the policy gate (decider, 11 tests).
- `orchestrator/switchState.js` · `switchState.test.js` — pure daily-count day-reset (6 tests).
- `orchestrator/switchDeciderMain.js` — the auto-switch runner (brain→decider→hands); I/O glue
  (cron/fetch/Docker) verified via `./vpn auto-switch`, not unit-tested.
- [`switch-policy.json`](switch-policy.json) — operational policy (hand-edited, pushable).
- `./vpn media-switch <server>` — manual trigger against the stand-in.
- `./vpn auto-switch [--current X]` — one auto-switch decider tick against the stand-in.
