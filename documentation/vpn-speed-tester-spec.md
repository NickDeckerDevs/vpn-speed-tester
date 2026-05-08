# AirVPN Speed Testing System
## Project Design Specification

**NAS:** Waitress (AS5404T) | **Stack:** Portainer CE | **Status:** Planning  
**Last Updated:** May 2026

---

> This document is the authoritative design spec for the `vpn-speed-tester` project. All decisions were finalized through iterative planning and are ready for implementation in Claude Code / VS Code.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Load Tier Definitions](#2-load-tier-definitions)
3. [System Architecture](#3-system-architecture)
4. [Data Sources](#4-data-sources)
5. [JSON Data Schema](#5-json-data-schema)
6. [Scheduling & Test Lifecycle](#6-scheduling--test-lifecycle)
7. [Orchestrator Design](#7-orchestrator-design)
8. [Docker Stack Definition](#8-docker-stack-definition)
9. [Static HTML Report](#9-static-html-report)
10. [Git Strategy](#10-git-strategy)
11. [Future Roadmap](#11-future-roadmap)
12. [Open Questions & Decisions Log](#12-open-questions--decisions-log)

---

## 1. Project Overview

This project builds an **isolated Docker stack** on the Waitress NAS that systematically tests AirVPN WireGuard server performance across all 50 US servers. Tests are stratified by real-time server load tier, run on a scheduled basis, and results are stored as structured JSON on Volume 2. A static HTML report reads that JSON at runtime (no caching) and presents comparative analytics with charting.

### 1.1 Goals

- Collect download speed, upload speed, latency, and jitter across all 50 AirVPN US servers
- Stratify results by real-time server load across four tiers (Low / Medium / High / Diablo)
- Capture full AirVPN status API metadata at the moment of every individual test run
- Build hourly server load snapshots to discover time-of-day load patterns over days/weeks
- Produce a static HTML report with per-server charts, drill-down to individual runs, and a separate hourly snapshot tab
- Lay the groundwork for future automated VPN server switching based on live load data

### 1.2 Non-Goals (This Phase)

- International server testing — US only
- Automated production Gluetun switching — designed for, not activated yet
- React / Express UI — static HTML first, migrate later
- Testing multiple IP entry points per server — always use `ip_v4_in1` only

### 1.3 Key Constraints

- NAS CPU is Intel Celeron 2GHz — orchestrator must be lightweight
- Volume 1 (SSD) is 91.9% full — all results go to Volume 2 (HDD)
- Production media stack (Gluetun, Radarr, Sonarr, qBittorrent, Jellyfin) must never be disrupted
- qBittorrent must be paused before any test activity begins and resumed as the final shutdown action

---

## 2. Load Tier Definitions

All 50 US servers are classified into four tiers based on their real-time `currentload` value from the AirVPN status API. Tier membership is evaluated fresh at the start of each test session.

| Tier | Load Range | Emoji | Description |
|------|-----------|-------|-------------|
| **Low** | 0 – 30% | 🟢 | Best-case, lightly loaded |
| **Medium** | 31 – 50% | 🟡 | Typical real-world condition |
| **High** | 51 – 70% | 🟠 | Elevated load |
| **Diablo** | 71 – 100% | 🔴 | Heavily loaded, worst-case |

### 2.1 Tier Assignment Logic

- Tier is evaluated at the **start** of each test session for that server
- The exact `currentload` at the time of **each individual run** is also stored inside the run object — load can shift between runs
- A server can accumulate sessions in multiple tiers across multiple nights — each tier is an independent array in the results
- A server at 29% gets a Low session; if it drifts to 32% during run 2, the session label does not change but run 2's snapshot captures the new load

### 2.2 Completion Criteria

- **Goal:** every server has at least one completed session in each of the four tiers
- A session = 3 individual runs back to back
- If a server already has a Low session and is currently at Low load again, take a second Low session — this reinforces pattern data and helps normalize outliers or confirm they are real
- When all four tiers are captured for a server, it is considered complete but remains eligible for additional runs

---

## 3. System Architecture

### 3.1 Stack Overview

Two entirely separate stacks. The production media stack is **never touched** during testing.

| Component | Stack | Purpose |
|-----------|-------|---------|
| Production Media Stack | Existing — unchanged | Gluetun (prod), qBittorrent, Radarr, Sonarr, Jellyfin, etc. |
| `vpn-speed-tester` | **NEW — isolated** | Test Gluetun, speedtest runner, orchestrator |
| Report server | **NEW — future phase** | Node.js / Express serving HTML + JSON |

### 3.2 New Stack Services

| Service | Image | Role | Network |
|---------|-------|------|---------|
| `gluetun-speedtest` | `qmcgaw/gluetun:v3.41.1` | Isolated VPN gateway for testing only | `vpn-speedtest` (172.21.0.0/24) |
| `speedtest-runner` | Custom image (`node:20-slim` + `speedtest-cli`) | Runs `speedtest-cli` via dockerode `exec` — shares gluetun-speedtest's network namespace so all traffic is tunneled | `vpn-speedtest` via `gluetun-speedtest` |
| `orchestrator` | Custom image (`node:20-slim`) | Coordinates full test lifecycle — pure Node.js | `vpn-speedtest` + Docker socket access |

### 3.3 Storage Layout

```
/volume1/Docker/vpn-speed-tester/        ← config on SSD
  orchestrator/                          ← state file, logs
  gluetun-test/                          ← test gluetun config

/volume2/data/vpn-speed-tests/           ← all results on HDD
  results.json                           ← main speed test results
  snapshots/                             ← hourly status snapshots
    YYYY-MM-DD-HH.json                   ← one file per hour
  report/
    index.html                           ← static HTML report (reads results.json + snapshots)
  git/                                   ← git repo root (results.json tracked here)
```

### 3.4 Network Isolation

- `gluetun-test` uses a **different AirVPN port forward** than production Gluetun — they do not conflict
- `speedtest-runner` uses `network_mode: service:gluetun-speedtest` — all traffic tunneled through test VPN; orchestrator exec's speedtest-cli inside it via dockerode so measurements go through the VPN
- `orchestrator` has Docker socket access (`/var/run/docker.sock`) for container lifecycle operations (stop/remove/create gluetun-speedtest per server, restart speedtest-runner after each switch)
- Production Gluetun and all its dependents (Radarr, Sonarr, qBittorrent, etc.) are unaffected

### 3.5 On the Four IP Addresses Per Server

Each AirVPN server exposes four entry IPs (`ip_v4_in1` through `ip_v4_in4`). These all resolve to the **same physical server** — they exist to support different port/protocol combinations and ISP blocking scenarios. For WireGuard via Gluetun, we always connect using `ip_v4_in1`. The other three IPs are stored in results for completeness but never used for connections.

---

## 4. Data Sources

### 4.1 AirVPN Status API

Public, unauthenticated, no API key required. Updates every 5 minutes per AirVPN documentation.

```
GET https://airvpn.org/api/status
```

**Fields captured and stored from each server object:**

| Field | Type | Notes |
|-------|------|-------|
| `public_name` | string | Primary key — e.g. `Aladfar` |
| `country_name` | string | Filter: `country_code === 'us'` |
| `country_code` | string | Filter value |
| `location` | string | City string — e.g. `Miami`, `Atlanta, Georgia` |
| `continent` | string | Always `America` for US servers |
| `bw` | integer | Current bandwidth in use (Mbit/s) |
| `bw_max` | integer | Server total capacity — 2000 or 20000 Mbit/s |
| `users` | integer | Connected users at snapshot time |
| `currentload` | integer | Load percentage 0–100 — used for tier classification |
| `ip_v4_in1` | string | Primary entry IP — used for WireGuard endpoint |
| `ip_v4_in2/3/4` | string | Alternate IPs — stored, never used for connection |
| `ip_v6_in1/2/3/4` | string | IPv6 entries — stored, not used (IPv6 disabled) |
| `health` | string | Skip server if not `ok` |

### 4.2 Derived / Computed Fields

Calculated and stored alongside raw API data:

| Field | Formula | Purpose |
|-------|---------|---------|
| `available_capacity_mbps` | `bw_max - bw` | Absolute headroom at time of snapshot |
| `tier` | `currentload` → tier mapping | `low` / `medium` / `high` / `diablo` |
| `speed_efficiency_ratio` | `download_mbps / available_capacity_mbps` | How much of the server's available headroom your test achieved |
| `distance_km` | Haversine(Cape Coral FL, server city coords) | Stored for analysis — not used for scheduling |

### 4.3 Speedtest Measurements (Per Run)

| Measurement | Tool | Notes |
|------------|------|-------|
| Download speed (Mbps) | `speedtest-cli` | Captured per individual run |
| Upload speed (Mbps) | `speedtest-cli` | Captured per individual run |
| Ping / latency (ms) | `speedtest-cli` | Captured per individual run |
| Jitter (ms) | `speedtest-cli` | Captured per individual run |
| Timestamp (ISO 8601 UTC) | System | Individual run timestamp, not session timestamp |

### 4.4 Reference: Cape Coral Coordinates

All distance calculations use Cape Coral, FL as the fixed origin.

```
Latitude:   26.5629° N
Longitude:  81.9495° W
```

### 4.5 Tunnel Verification — gluetun Control API

Used to confirm the WireGuard tunnel is live before each test session begins. The orchestrator polls gluetun's built-in HTTP control server, which is accessible container-to-container on the `vpn-speedtest` bridge without external DNS.

```
GET http://gluetun-speedtest:8000/v1/vpn/status
```

Returns `{"status":"starting"}` while connecting and `{"status":"running"}` once the tunnel is established. The orchestrator polls every 5 seconds up to a 60-second timeout. This replaced the former external check (`check.airservers.org`) which failed with DNS errors during the gluetun stop/remove/create cycle.

---

## 5. JSON Data Schema

### 5.1 Main Results File — `results.json`

Top-level object keyed by server `public_name`. Each server has static metadata and a `tiers` object containing arrays of sessions per tier. Sessions are arrays — multiple sessions per tier are expected and encouraged.

```json
{
  "Aladfar": {
    "server_name": "Aladfar",
    "city": "Miami",
    "country": "United States",
    "country_code": "us",
    "ip_v4_in1": "193.37.252.50",
    "ip_v4_in2": "193.37.252.52",
    "ip_v4_in3": "193.37.252.53",
    "ip_v4_in4": "193.37.252.54",
    "ip_v6_in1": "2a0d:5600:6:115:3c84:449d:745:1a2a",
    "ip_v6_in2": "2a0d:5600:6:115:74d8:c26f:ffa5:23a0",
    "ip_v6_in3": "2a0d:5600:6:115:d1c7:8be3:b81c:7f61",
    "ip_v6_in4": "2a0d:5600:6:115:9545:70e5:59c1:bad1",
    "bw_max": 2000,
    "distance_from_cape_coral_km": 187,
    "tiers": {
      "low": [
        {
          "session_id": "Aladfar-low-001",
          "session_start": "2026-05-07T03:00:00Z",
          "session_end": "2026-05-07T03:08:42Z",
          "status_at_session_start": {
            "bw": 220,
            "bw_max": 2000,
            "users": 38,
            "currentload": 11,
            "tier": "low",
            "available_capacity_mbps": 1780,
            "health": "ok"
          },
          "averages": {
            "download_mbps": 412.3,
            "upload_mbps": 198.7,
            "ping_ms": 14.2,
            "jitter_ms": 1.1,
            "speed_efficiency_ratio": 0.232
          },
          "runs": [
            {
              "run": 1,
              "timestamp": "2026-05-07T03:01:14Z",
              "download_mbps": 408.1,
              "upload_mbps": 195.2,
              "ping_ms": 14.0,
              "jitter_ms": 1.2,
              "status_snapshot": {
                "bw": 218,
                "bw_max": 2000,
                "users": 37,
                "currentload": 10,
                "available_capacity_mbps": 1782,
                "health": "ok"
              }
            },
            {
              "run": 2,
              "timestamp": "2026-05-07T03:03:44Z",
              "download_mbps": 415.6,
              "upload_mbps": 201.3,
              "ping_ms": 14.4,
              "jitter_ms": 0.9,
              "status_snapshot": {
                "bw": 224,
                "bw_max": 2000,
                "users": 39,
                "currentload": 11,
                "available_capacity_mbps": 1776,
                "health": "ok"
              }
            },
            {
              "run": 3,
              "timestamp": "2026-05-07T03:06:18Z",
              "download_mbps": 413.2,
              "upload_mbps": 199.6,
              "ping_ms": 14.2,
              "jitter_ms": 1.2,
              "status_snapshot": {
                "bw": 221,
                "bw_max": 2000,
                "users": 38,
                "currentload": 11,
                "available_capacity_mbps": 1779,
                "health": "ok"
              }
            }
          ]
        }
      ],
      "medium": [],
      "high": [],
      "diablo": []
    }
  },
  "Ascella": {}
}
```

> **Note:** `averages` is written by the aggregator after all 3 runs complete — not during the runs. Runs are written immediately and atomically as they finish.

### 5.2 Hourly Snapshot File — `snapshots/YYYY-MM-DD-HH.json`

One file per hour. Captures all 50 US servers at a point in time. Used for load pattern analysis independent of speed testing.

```json
{
  "snapshot_time": "2026-05-07T03:00:00Z",
  "us_server_count": 50,
  "us_servers": [
    {
      "server_name": "Aladfar",
      "city": "Miami",
      "bw": 220,
      "bw_max": 2000,
      "users": 38,
      "currentload": 11,
      "available_capacity_mbps": 1780,
      "tier": "low",
      "health": "ok"
    }
  ]
}
```

---

## 6. Scheduling & Test Lifecycle

### 6.1 Two Scheduled Jobs

| Job | Schedule | Approx Duration | Purpose |
|-----|----------|-----------------|---------|
| Speed Test Runner | 3:00 AM daily (configurable) | 1–2 hours | Run stratified speed tests |
| Hourly Status Snapshot | Every hour on the hour | < 30 seconds | Capture load data for pattern analysis |

### 6.2 Speed Test Runner — Full Lifecycle

#### Step 1 — Pre-flight

1. Record `window_start` timestamp
2. **Pause qBittorrent via web API — this is the FIRST action, before anything else**
3. Confirm pause acknowledged (poll status endpoint, timeout 30s)
4. Fetch AirVPN status API — filter to `country_code === 'us'` AND `health === 'ok'`
5. Classify each server into tier based on current `currentload`
6. Build prioritized test queue (see section 6.4)

#### Step 2 — Per-Server Test Session Loop

1. **Check:** is `current_time >= window_end`? If yes → jump to Step 3
2. Pick next server from queue
3. Update `gluetun-speedtest` environment: set `SERVER_NAMES` to target server's `public_name`
4. Stop, remove, and recreate `gluetun-speedtest` container via Docker SDK; restart `speedtest-runner` to re-attach to the new network namespace
5. Poll `http://gluetun-speedtest:8000/v1/vpn/status` every 5 seconds until `status === "running"`, up to 60 second timeout
6. On tunnel confirmed: fetch status API — store full response as `status_at_session_start`
7. Classify tier based on `currentload` at this moment (may differ from queue classification — use this value)
8. **Run 3 test runs in sequence:**
   - Fetch status API snapshot → store as `status_snapshot` inside this run object
   - Execute `speedtest-cli` → capture download, upload, ping, jitter, timestamp
   - Write run object immediately to `results.json` (atomic write — no buffering)
   - Wait 15 seconds before next run
9. After run 3: compute `averages` object and write to session
10. Git commit: `data: {server_name} {tier} session {n} — 3 runs complete`
11. Return to top of Step 2

#### Step 3 — Shutdown

1. Run aggregator: recalculate all session averages across full `results.json`
2. Git commit: `chore: recalculate aggregates {YYYY-MM-DD}`
3. Stop `gluetun-test` container
4. **Resume qBittorrent via web API — this is the LAST action before process exits**
5. Write completion log: servers tested, tiers captured, total duration

### 6.3 Window Boundary Behavior

> A test session that started **before** `window_end` is always allowed to complete all 3 runs. No session is interrupted mid-run. The window end check happens **only before starting a new session.**

### 6.4 Server Queue Priority Logic

1. **Priority 1:** Servers missing tier coverage in the current tier (no session yet for this tier)
2. **Priority 2:** Servers with fewer total sessions across all tiers
3. **Priority 3:** For ties, prefer servers whose last session was longest ago
4. **If no servers have missing tiers:** take additional sessions for servers with extreme results (highest or lowest averages) to normalize outliers or confirm they are real

### 6.5 qBittorrent API Calls

```
# Pause all torrents
POST http://10.1.10.254:8080/api/v2/torrents/pause
Body: hashes=all

# Resume all torrents
POST http://10.1.10.254:8080/api/v2/torrents/resume
Body: hashes=all

# Check pause status
GET http://10.1.10.254:8080/api/v2/torrents/info?filter=paused
```

---

## 7. Orchestrator Design

### 7.1 Language & Runtime

Node.js 20 in a custom Docker image based on `node:20-slim`. The orchestrator is **pure JavaScript**. The only non-JS component is the `speedtest-cli` binary (installed via pip into the same image). It is called via dockerode `exec` inside the `speedtest-runner` container — this ensures speedtest traffic routes through gluetun's VPN tunnel. You never write or read Python.

**npm dependencies (`package.json`):**
- `node-cron` — cron-style job scheduling
- `axios` — HTTP calls (status API, qBittorrent API, tunnel check)
- `dockerode` — Docker SDK for Node.js (container restart, env updates)
- `simple-git` — git commits from within the orchestrator
- `haversine` — distance calculation from Cape Coral
- `fs-extra` — enhanced file system utilities (atomic writes, `ensureDir`, etc.)

**System dependency (installed in Dockerfile, not npm):**
- `speedtest-cli` — installed via `pip3` into the image. Called as a subprocess via `child_process.spawnSync`. Orchestrator never imports or interacts with Python directly.

### 7.2 Module Structure

```
orchestrator/
  main.js                  ← entrypoint, wires up scheduler
  scheduler.js             ← registers both cron jobs via node-cron
  airvpnStatus.js          ← fetch & parse status API, compute derived fields, classify tiers
  queueBuilder.js          ← build prioritized test queue from results state + live status
  gluetunManager.js        ← restart gluetun-test via dockerode, poll tunnel health
  speedTester.js           ← shell out to speedtest-cli via child_process, parse JSON output
  resultsWriter.js         ← atomic writes to results.json, git commit wrapper via simple-git
  aggregator.js            ← recalculate all session averages across results.json
  snapshotWriter.js        ← write hourly snapshots to /volume2/data/vpn-speed-tests/snapshots/
  qbtClient.js             ← qBittorrent pause / resume via axios POST
  config.js                ← all configurable values (paths, URLs, thresholds, schedule)
  package.json             ← npm dependencies
  Dockerfile               ← node:20-slim + pip install speedtest-cli
```

### 7.3 Configuration (`config.js`)

All environment-specific values live here — no hardcoding in logic modules.

```js
module.exports = {
  AIRVPN_STATUS_URL:    'https://airvpn.org/api/status',
  GLUETUN_CONTROL_URL:  'http://gluetun-speedtest:8000/v1/vpn/status',  // internal — no DNS needed
  SPEEDTEST_CONTAINER:  'speedtest-runner',
  QBT_BASE_URL:         'http://10.1.10.254:8080',
  QBT_USERNAME:         process.env.QBT_USERNAME || 'admin',
  QBT_PASSWORD:         process.env.QBT_PASSWORD || '',
  RESULTS_PATH:         '/data/results.json',
  SNAPSHOTS_PATH:       '/data/snapshots/',
  GIT_REPO_PATH:        '/data/',
  GLUETUN_CONTAINER:    'gluetun-speedtest',
  LOGS_PATH:            '/data/logs/',

  CAPE_CORAL_LAT:       26.5629,
  CAPE_CORAL_LON:       -81.9495,

  TEST_WINDOW_HOURS:    2,
  TEST_START_HOUR:      3,
  RUNS_PER_SESSION:     3,
  MS_BETWEEN_RUNS:      15000,
  TUNNEL_POLL_MS:       5000,
  TUNNEL_TIMEOUT_MS:    60000,

  TIER_THRESHOLDS: {
    low:    { min: 0,  max: 30  },
    medium: { min: 31, max: 50  },
    high:   { min: 51, max: 70  },
    diablo: { min: 71, max: 100 },
  },
};
```

### 7.4 Gluetun Server Switching

Docker does not support updating environment variables on a running container. To switch servers, the orchestrator uses a stop → remove → create cycle via dockerode. After the new gluetun starts, `speedtest-runner` is restarted to re-attach to the new network namespace (its `network_mode: service:gluetun-speedtest` binding is tied to the container's namespace, which changes on each recreate).

```js
// Simplified — see gluetunManager.js for full implementation
async function switchServer(serverName) {
  const container = docker.getContainer('gluetun-speedtest');
  const info = await container.inspect();

  const newEnv = (info.Config.Env || [])
    .filter(e => !e.startsWith('SERVER_NAMES='))
    .concat(`SERVER_NAMES=${serverName}`);

  await container.stop({ t: 10 });
  await container.remove();

  const newContainer = await docker.createContainer({
    name: 'gluetun-speedtest',
    Image: info.Config.Image,
    Env: newEnv,
    ExposedPorts: info.Config.ExposedPorts,
    HostConfig: info.HostConfig,
  });
  await newContainer.start();

  // Re-attach speedtest-runner to new gluetun namespace
  await docker.getContainer('speedtest-runner').restart();
  await new Promise(resolve => setTimeout(resolve, 3000));
}
```

> Gluetun's `SERVER_NAMES` env var accepts AirVPN's `public_name` directly — no IP address manipulation needed.

### 7.5 Atomic Writes to `results.json`

To prevent data corruption if the orchestrator crashes mid-write, we write to a temp file first then atomically rename it:

```js
const fs = require('fs-extra');
const path = require('path');

async function writeResults(data, filePath) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.results.tmp.${Date.now()}.json`);

  await fs.writeJson(tmpPath, data, { spaces: 2 });
  await fs.move(tmpPath, filePath, { overwrite: true }); // atomic rename on Linux
}
```

### 7.6 Running `speedtest-cli` via Docker Exec

The speedtest binary is exec'd inside `speedtest-runner` (which shares gluetun's network namespace) so that all test traffic is routed through the VPN tunnel. Running it in the orchestrator process would bypass the VPN entirely.

```js
async function runSpeedtest() {
  const container = docker.getContainer('speedtest-runner');
  const exec = await container.exec({
    Cmd: ['speedtest-cli', '--json', '--secure'],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({});
  const { stdout } = await collectStream(container, stream);  // demuxStream wrapper

  const inspected = await exec.inspect();
  if (inspected.ExitCode !== 0) throw new Error(`speedtest-cli exited ${inspected.ExitCode}`);

  const data = JSON.parse(stdout.trim());
  return {
    download_mbps: parseFloat((data.download / 1_000_000).toFixed(2)),
    upload_mbps:   parseFloat((data.upload   / 1_000_000).toFixed(2)),
    ping_ms:       parseFloat(data.ping.toFixed(2)),
    jitter_ms:     parseFloat((data.server?.latency ?? 0).toFixed(2)),
  };
}
```

> `speedtest-cli` returns download/upload in bits per second — divide by 1,000,000 for Mbps.

### 7.7 `package.json`

```json
{
  "name": "vpn-speed-tester-orchestrator",
  "version": "1.0.0",
  "description": "AirVPN US server speed test orchestrator",
  "main": "main.js",
  "scripts": {
    "start": "node main.js",
    "test:single": "node main.js --manual"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "dockerode": "^4.0.0",
    "fs-extra": "^11.2.0",
    "haversine": "^1.1.1",
    "node-cron": "^3.0.3",
    "simple-git": "^3.24.0"
  }
}
```

---

## 8. Docker Stack Definition

### 8.1 docker-compose.yml (vpn-speed-tester stack)

```yaml
services:

  gluetun-speedtest:
    image: qmcgaw/gluetun:v3.41.1
    container_name: gluetun-speedtest
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      - VPN_SERVICE_PROVIDER=airvpn
      - VPN_TYPE=wireguard
      - WIREGUARD_PRIVATE_KEY=${WIREGUARD_PRIVATE_KEY}
      - WIREGUARD_PRESHARED_KEY=${WIREGUARD_PRESHARED_KEY}
      - WIREGUARD_ADDRESSES=${WIREGUARD_ADDRESSES}
      - SERVER_COUNTRIES=United States
      - SERVER_NAMES=Aladfar          # orchestrator overwrites this per test
      - DNS_SERVERS=1.1.1.1,8.8.8.8
      - DNS_IPV6=false
      - EXTRA_ROUTES=10.1.10.0/24
      - FIREWALL_LOCAL_NETWORK_ACCESS=true
      - TZ=America/New_York
    volumes:
      - /volume1/Docker/vpn-speed-tester/gluetun-speedtest:/gluetun
    networks:
      - vpn-speedtest
    restart: unless-stopped
    healthcheck:
      test: ping -c 1 -W 5 1.1.1.1 || exit 1
      interval: 30s
      timeout: 5s
      start_period: 45s
      retries: 3

  speedtest-runner:
    build:
      context: ./orchestrator      # same image as orchestrator — node:20-slim + speedtest-cli
      dockerfile: Dockerfile
    container_name: speedtest-runner
    network_mode: "service:gluetun-speedtest"
    depends_on:
      gluetun-speedtest:
        condition: service_healthy
    volumes:
      - /volume2/data/vpn-speed-tests:/data
    restart: unless-stopped

  orchestrator:
    build:
      context: ./orchestrator
      dockerfile: Dockerfile
    container_name: orchestrator
    env_file: .env
    volumes:
      - /volume1/Docker/vpn-speed-tester/orchestrator:/config
      - /volume2/data/vpn-speed-tests:/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - TZ=America/New_York
    networks:
      - vpn-speedtest
    restart: unless-stopped

networks:
  vpn-speedtest:
    driver: bridge
    ipam:
      config:
        - subnet: 172.21.0.0/24
```

### 8.2 Orchestrator Dockerfile

This is where `speedtest-cli` enters the picture. The image is Node.js-based — Python is only present as a system package to run the binary. You never touch it.

```dockerfile
FROM node:20-slim

# Install Python + pip just enough to get speedtest-cli binary
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    --no-install-recommends \
  && pip3 install speedtest-cli --break-system-packages \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "main.js"]
```

> After this Dockerfile is built, you never open it again. All your work is in the `.js` files.

### 8.3 .env File (same directory as compose)

```bash
WIREGUARD_PRIVATE_KEY=<your-airvpn-wireguard-private-key>
WIREGUARD_PRESHARED_KEY=<your-airvpn-wireguard-preshared-key>
```

> **Never commit `.env` to version control.**

---

## 9. Static HTML Report

### 9.1 Behavior

- Single `index.html` file served from `/volume2/data/vpn-speed-tests/report/`
- On every page load, fetches `../results.json` and `../snapshots/` via `fetch()` — no caching
- Two tabs in the same file:
  - **Tab 1 — Speed Test Results:** per-server comparisons, tier breakdowns, drill-down to individual runs
  - **Tab 2 — Hourly Snapshots:** load trends over time, user counts, available capacity by server and city

### 9.2 Tab 1 — Speed Test Results Views

- **Summary bar chart:** average download by server, colored by tier with legend
- **Scatter plot:** download speed vs. server load % — shows load/speed correlation
- **Scatter plot:** download speed vs. distance from Cape Coral — shows latency vs. throughput
- **City grouping:** aggregate averages per city (Miami, Atlanta, New York, etc.)
- **Server drill-down:** click any server → expand to show all sessions → click session → show individual runs with their status snapshots
- **Efficiency chart:** speed efficiency ratio per server (how much of available headroom was captured)

### 9.3 Tab 2 — Hourly Snapshot Views

- **Load heatmap:** servers (y-axis) × time of day (x-axis) → color = load tier
- **Line chart:** average US server load over time
- **City load comparison:** average load per city across the day
- **Best time to connect table:** for each server, the hour with historically lowest load

### 9.4 Charting Library

Chart.js (loaded from cdnjs) for bar, scatter, and line charts. No build step. No framework.

### 9.5 Migration Path to React / Express

The JSON schema does not change when migrating. The Express server reads the same `results.json` and snapshot files. The React frontend makes the same `fetch()` calls. Migration is a UI lift, not a data change.

---

## 10. Git Strategy

### 10.1 Repository Layout

```
/volume2/data/vpn-speed-tests/git/
  results.json          ← tracked
  snapshots/            ← tracked (all hourly files)
  report/index.html     ← tracked
  .gitignore            ← excludes logs, temp files
```

### 10.2 Commit Sequence Per Test Night

```
# Written during test session — one per completed server session
data: Aladfar low session 001 — 3 runs complete
data: Ascella diablo session 001 — 3 runs complete
data: Cursa low session 001 — 3 runs complete

# Written at shutdown after aggregator runs
chore: recalculate aggregates 2026-05-07

# Written by hourly snapshot job
snapshot: US server load 2026-05-07T03:00:00Z
snapshot: US server load 2026-05-07T04:00:00Z
```

### 10.3 Why This Order Matters

The raw run data is committed first before aggregation. If the orchestrator crashes during the aggregation step, you can revert to the last good run commit and re-run the aggregator without losing any test data.

---

## 11. Future Roadmap

### 11.1 Automated Production VPN Switching (Phase 2)

The orchestrator already has Docker socket access. The future feature would:

1. Hourly snapshot job detects current production Gluetun server load > threshold (e.g. > 70%)
2. Query snapshot data to find US server with lowest current load in preferred city list
3. Call Portainer REST API to update production stack with new `SERVER_NAMES` value
4. Portainer redeploys stack in-place, preserving all other env vars
5. Log the switch and notify via Home Assistant / Mosquitto

**Portainer API call (concept):**
```
PUT http://10.1.10.254:9000/api/stacks/{stack_id}
Authorization: Bearer {portainer_api_token}
Body: { updated compose with new SERVER_NAMES }
```

> This is designed but **not activated** in Phase 1. The data collection in this phase is what enables confident thresholds to be set.

### 11.2 Report Server (Phase 3)

Replace static HTML with a Node.js / Express server:
- Serves `index.html` (React frontend)
- `/api/results` → reads and returns `results.json`
- `/api/snapshots` → reads and returns snapshot directory listing + files
- `/api/status/live` → proxies AirVPN status API for live dashboard view
- Additional scripts and reporting endpoints added over time to the same server

### 11.3 Smart Scheduling (Phase 4)

After several weeks of hourly snapshots, use the pattern data to:
- Identify optimal test windows per server (when they're most likely in Low/Medium tiers)
- Adjust the test schedule dynamically based on historical patterns
- Build a predicted load curve per server per hour of day

---

## 12. Open Questions & Decisions Log

| # | Question | Decision | Date |
|---|----------|----------|------|
| 1 | Same server across nights vs. different servers per tier per night? | Option B — opportunistic. Whatever tier a server is in when we reach it, we take that session. Same server can be tested in multiple tiers on the same night if it crosses thresholds. | May 2026 |
| 2 | How to handle servers with no High or Diablo sessions available? | Hourly snapshot job builds pattern data over days. After enough data, adjust schedule to target windows when those servers are historically loaded. Take additional Low/Medium sessions in the meantime. | May 2026 |
| 3 | qBittorrent lifecycle during test window? | Pause FIRST before any Docker activity. Resume LAST after all test activity and stack shutdown. qBittorrent stays paused the entire window even between server switches. | May 2026 |
| 4 | Report output format? | Static HTML reading JSON via fetch() at runtime. No caching. Two tabs: speed results + hourly snapshots. Migrate to React/Express later without changing JSON schema. | May 2026 |
| 5 | How many runs per session? | 3 runs. All three documented individually. Session averages computed after all 3 complete. | May 2026 |
| 6 | Load tier thresholds? | Low 0–30, Medium 31–50, High 51–70, Diablo 71–100. | May 2026 |
| 7 | Which entry IP to use per server? | Always `ip_v4_in1`. The 4 IPs per server all point to the same physical machine — they exist for protocol/port fallback only. | May 2026 |
| 8 | Distance sorting for test queue? | Distance from Cape Coral stored for analysis but NOT used for queue ordering. Queue is load-tier and completion-coverage driven. | May 2026 |
| 9 | What if window ends mid-queue? | Soft boundary. Any session already started completes all 3 runs. Window end check only fires before starting a new session. | May 2026 |
| 10 | First runs — manual or scheduled? | Start with 1–2 manual runs to validate the stack, review output, confirm JSON shape and report rendering. Then finalize server list and activate the schedule. | May 2026 |
| 11 | Python or JavaScript for orchestrator? | JavaScript (Node.js 20). All orchestrator logic is pure JS. `speedtest-cli` is installed as a system binary via pip into the same Docker image and exec'd inside `speedtest-runner` via dockerode — traffic goes through the VPN tunnel. No Python code is written or maintained. | May 2026 |

---

*End of specification. Next step: implement in Claude Code / VS Code using this document as the source of truth.*
