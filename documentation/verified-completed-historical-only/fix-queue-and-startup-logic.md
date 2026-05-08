# VPN Speed Tester — Fix Plan & Debug Analysis

**Date:** 2026-05-07  
**Status:** First manual test run failing — stack never completes a single session  
**Blocker:** `speedtest-runner` cannot rejoin gluetun's network namespace after container recreation

---

## Table of Contents

1. [What the Logs Say](#1-what-the-logs-say)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Design Issue: The 48-Server Queue](#3-design-issue-the-48-server-queue)
4. [The Correct Flow](#4-the-correct-flow)
5. [Fix Plan — Three Changes](#5-fix-plan--three-changes)
6. [What Stays the Same](#6-what-stays-the-same)
7. [Implementation Order](#7-implementation-order)

---

## 1. What the Logs Say

Every session attempt fails with the same error immediately after `switchServer` recreates `gluetun-speedtest`:

```
[INFO ] switchServer: container started → Aladfar
[INFO ] switchServer: restarting speedtest-runner to attach to new gluetun namespace...
[ERROR] SESSION ERROR [Aladfar]: (HTTP code 500) server error - Cannot restart container
        speedtest-runner: joining network namespace of container:
        No such container: 9475c07e4d5e5093c96fcd5c7234dc70a8b4f965192e2cc5a8182ccfb716f428
```

This repeats for every server in the queue — Aladfar, Aquila, Ascella, Bunda, Chamaeleon — all fail instantly with the same 500 error. The stack races through all 48 queued servers in seconds without running a single speed test.

---

## 2. Root Cause Analysis

### Bug 1 — `speedtest-runner` holds a stale namespace reference (the blocker)

`speedtest-runner` is configured with `network_mode: service:gluetun-speedtest`. When Docker creates `speedtest-runner`, it resolves that service reference to the **internal container ID** of whichever `gluetun-speedtest` is running at that moment — a long hash like `9475c07e4d...`.

When `switchServer()` stops, removes, and recreates `gluetun-speedtest`, the new container gets a **new internal ID**. But `speedtest-runner` still holds the old hash baked into its network namespace reference from when it was created. That old container ID no longer exists.

**The `restart` command doesn't fix this.** Restarting a container does not re-evaluate `network_mode` — it just starts the existing container definition again, which still points at the dead namespace.

The only fix is to **stop and remove `speedtest-runner`**, then **recreate it fresh** after the new `gluetun-speedtest` is running. A new container creation is the only point at which Docker resolves `service:gluetun-speedtest` to the current live container ID.

### Bug 2 — AirVPN status is fetched once, upfront, for all 48 servers

The log shows:

```
[INFO ] PRE-FLIGHT: complete — 48 servers queued
```

The entire queue is built from a single AirVPN API fetch at the start of the run. By the time the orchestrator reaches server 5, 10, or 30, server loads have shifted. The tier assigned at queue-build time may no longer reflect reality.

The spec is explicit on this point:

> "Tier is evaluated at the **start** of each test session for that server"

A pre-baked queue of 48 violates this. Server load can shift significantly over the course of a multi-hour test window.

---

## 3. Design Issue: The 48-Server Queue

Beyond the bugs, the fundamental queue architecture is wrong for the stated goals.

**Current behavior:** Fetch status once → sort all 48 servers → loop through the entire list.

**What the spec calls for:** Real-time, one-server-at-a-time decision-making. Each server selection is a fresh decision based on current data.

The pre-built queue approach means:
- Load tiers assigned at queue time are stale by the time tests run
- A server queued as "Low" at 8 PM might be "Diablo" at 9 PM when we reach it
- Coverage gaps identified at queue-build time may already be filled by the time we loop back
- There is no opportunity to respond to what's happening right now

The 48-server queue is also what caused the log to show the orchestrator racing through all 48 servers in seconds — each one failing instantly and moving to the next, with no brake on the loop.

---

## 4. The Correct Flow

Per the original spec and design intent, the flow for each server switch should be:

```
runSpeedTestWindow():
  while (windowOpen):

    1. Fetch AirVPN status API → classify all servers RIGHT NOW
    2. Pick the single best next server (queueBuilder returns ONE server)
       Priority: missing tier coverage → fewest sessions → oldest → outlier
    3. If no server qualifies → break (all coverage goals met)

    4. Tear down speedtest-runner (stop → remove)
    5. Tear down gluetun-speedtest (stop → remove)
    6. Create + start new gluetun-speedtest with SERVER_NAMES=<chosen server>
    7. Poll http://gluetun-speedtest:8000/v1/vpn/status until "running"
    8. Create + start new speedtest-runner (fresh, namespace resolves to new gluetun)
    9. Run 3 speed tests (exec'd inside speedtest-runner via dockerode)
   10. Write results.json, git commit

  After loop:
    11. docker compose down (clean teardown)
    12. Resume qBittorrent
```

The key changes from current behavior:
- AirVPN status is fetched **before each server**, not once upfront
- `queueBuilder` picks **one server** per call, not a pre-sorted list
- `speedtest-runner` is **stopped, removed, and recreated** — not restarted
- Teardown order: runner first, then gluetun; startup order: gluetun first, then runner

---

## 5. Fix Plan — Three Changes

### Change 1: Fix `gluetunManager.js` — `switchServer()`

Current broken behavior:
```
stop gluetun → remove gluetun → create new gluetun → restart speedtest-runner ← FAILS
```

Required behavior:
```
stop speedtest-runner
remove speedtest-runner
stop gluetun-speedtest
remove gluetun-speedtest
create + start new gluetun-speedtest (SERVER_NAMES=serverName)
wait for tunnel health (poll /v1/vpn/status)
create + start new speedtest-runner (fresh namespace resolution)
```

For the speedtest-runner recreation, use the same inspect-and-recreate pattern already used for gluetun — pull the previous container's `HostConfig` as the base, override only what needs to change (nothing, in speedtest-runner's case — just let Docker re-resolve the `network_mode` reference fresh).

**This is the single most critical fix.** Everything else is blocked behind this.

---

### Change 2: Fix `scheduler.js` — per-iteration status fetch

Current broken behavior:
```js
const queue = await buildQueue(await fetchAirVPNStatus());  // once, 48 servers
for (const server of queue) {
  await runSession(server);  // stale tier data
}
```

Required behavior:
```js
while (windowOpen()) {
  const status = await fetchAirVPNStatus();          // fresh every iteration
  const server = await pickNextServer(status, results); // one server
  if (!server) break;
  await runSession(server, status);
}
```

`pickNextServer` applies the same priority logic currently in `queueBuilder` — missing tier coverage first, then fewest sessions, then oldest last session, then outlier re-test — but it returns a single server object rather than a sorted list.

---

### Change 3: Update `queueBuilder.js` — return one server, not a list

Current interface (approximate):
```js
buildQueue(status) → [ ...48 sorted servers ]
```

Required interface:
```js
pickNextServer(status, existingResults) → server | null
```

The priority logic stays identical. The only change is the return value — one server or null (meaning coverage is complete or no eligible servers exist right now).

`null` is the signal to end the test window gracefully.

---

## 6. What Stays the Same

None of the following needs to change:

| Component | Status |
|-----------|--------|
| `qbtClient.js` — auth fixes (env_file, loginAttempted reset, 403 handling) | ✅ Keep |
| `qbtClient.js` — v5.x endpoint renames (stop/start, filter=stopped) | ✅ Keep |
| `qbtClient.js` — force-start scoped to previously-downloading torrents | ✅ Keep |
| `waitForTunnel()` — polls internal gluetun API, not external DNS | ✅ Keep |
| `speedTester.js` — exec'd inside speedtest-runner via dockerode | ✅ Keep |
| `resultsWriter.js` — atomic write + git commit per session | ✅ Keep |
| `snapshotWriter.js` — hourly snapshots + index.json manifest | ✅ Keep |
| `airvpnStatus.js` — tier classification, derived fields | ✅ Keep |
| `aggregator.js` — session averages recalculated at shutdown | ✅ Keep |
| JSON schema and `results.json` structure | ✅ Keep |
| Static HTML report (`report/index.html`) | ✅ Keep |
| `deploy.sh` rsync + compose down/up logic | ✅ Keep |
| Tier definitions (Low/Medium/High/Diablo) | ✅ Keep |
| 3 runs per session | ✅ Keep |
| qBittorrent paused first, resumed last | ✅ Keep |

---

## 7. Implementation Order

Work through these in sequence. Don't move to the next until the current one passes.

### Step 1 — Fix `gluetunManager.js` switchServer (BLOCKER)

Fix the stop/remove/recreate sequence to handle both containers. Verify by watching logs — you should see:

```
[INFO ] switchServer: stopping speedtest-runner...
[INFO ] switchServer: removing speedtest-runner...
[INFO ] switchServer: stopping gluetun-speedtest...
[INFO ] switchServer: removing gluetun-speedtest...
[INFO ] switchServer: creating new gluetun-speedtest → Aladfar
[INFO ] switchServer: container started → Aladfar
[INFO ] waitForTunnel: attempt 1...
[INFO ] waitForTunnel: tunnel confirmed after N attempt(s)
[INFO ] switchServer: creating new speedtest-runner...
[INFO ] switchServer: speedtest-runner ready
```

### Step 2 — Fix `scheduler.js` loop

Replace the pre-built queue with the fetch-per-iteration loop. Verify by watching the second server switch — confirm a new AirVPN status fetch appears in the logs before `switchServer` fires for server 2.

### Step 3 — Fix `queueBuilder.js` interface

Update to return one server. Verify by running two manual sessions back-to-back and confirming the second picks a different server with fresh load data.

### Step 4 — First successful end-to-end run

A complete successful run looks like:

```
[INFO ] PRE-FLIGHT: qBittorrent paused
[INFO ] Fetching AirVPN status...
[INFO ] SESSION: Bunda | tier: low | load: 23% | San Jose
[INFO ] switchServer: [full teardown + recreate sequence]
[INFO ] waitForTunnel: tunnel confirmed
[INFO ] run 1/3: 187.3 Mbps down / 42.1 Mbps up / 18ms
[INFO ] run 2/3: 191.0 Mbps down / 41.8 Mbps up / 17ms
[INFO ] run 3/3: 188.7 Mbps down / 40.9 Mbps up / 19ms
[INFO ] resultsWriter: results.json written
[INFO ] git: committed — data: Bunda low session 001 — 3 runs complete
[INFO ] POST-FLIGHT: qBittorrent resumed
```

Once you see that, the P0 milestone is cleared and automation can be enabled.

---

## Appendix: Previous Fixes Already Applied

These bugs were found and fixed before the first test run attempt. Documented here for completeness.

| Fix | File | What was wrong | What was changed |
|-----|------|----------------|-----------------|
| `waitForTunnel` polling target | `gluetunManager.js` | Was polling `check.airservers.org` — external DNS fails during gluetun's stop/remove/create cycle | Now polls `http://gluetun-speedtest:8000/v1/vpn/status` (gluetun internal control API) |
| speedtest-cli execution context | `speedTester.js` | Was running `speedtest-cli` in the orchestrator process — bypasses the VPN tunnel entirely | Now exec'd inside `speedtest-runner` via dockerode — traffic goes through VPN |
| qBittorrent `env_file` missing | `docker-compose.yml` | `QBT_PASSWORD` set in `.env` but orchestrator service had no `env_file` directive — password never reached the container, defaulted to empty string | Added `env_file: .env` to orchestrator service |
| `loginAttempted` never resets | `qbtClient.js` | Flag set `true` on first failure and never cleared — every subsequent call in the same container lifetime skipped login, guaranteeing repeated 403s | Flag now resets to `false` on every failure path |
| 403 swallowed in catch block | `qbtClient.js` | axios threw on non-2xx responses, landing in catch with misleading "proceeding without session" message | Added `validateStatus: () => true` to login call so all responses are handled explicitly |
| qBittorrent v5.x endpoint renames | `qbtClient.js` | v5.0.0 renamed `pause→stop`, `resume→start`, `filter=paused→filter=stopped` | All three endpoints updated |
| Force-start scope too broad | `qbtClient.js` | `resumeAll()` force-started all torrents including completed seeders | Now snapshots downloading-only hashes before pause, force-starts only those on resume |
| `deploy.sh` orphaned containers | `deploy.sh` | Orchestrator's dynamic container recreation caused name conflicts on rebuild | `deploy.sh` now does `docker compose down` + force-removes orphaned containers by name before every rebuild |
| `DNS_IPV6=false` missing | `docker-compose.yml` | Not set in test gluetun, matching production stack | Added to `gluetun-speedtest` environment |

---