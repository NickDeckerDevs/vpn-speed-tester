# Initial Build Report
## AirVPN Speed Tester — Phase 1 Scaffold

**Date:** May 2026  
**Status:** Scaffold complete, ready for first manual test run

---

## What Was Built

A fully isolated Docker stack that systematically tests all 50 AirVPN US WireGuard servers, stratifies results by real-time server load tier, stores structured JSON results, and renders a static HTML report. The production media stack (Gluetun, qBittorrent, Radarr, Sonarr, Jellyfin) is never touched.

---

## File Inventory

### Root
| File | Description |
|------|-------------|
| `docker-compose.yml` | Defines the three-service test stack: gluetun-test, speedtest-runner, orchestrator |
| `.env.example` | WireGuard credential placeholders — copy to `.env`, never commit |
| `.gitignore` | Excludes `.env`, `node_modules`, temp files |

### `orchestrator/`
| File | Description |
|------|-------------|
| `Dockerfile` | `node:20-slim` + `speedtest-cli` via `pip3` — Node runs the show, Python is only a runtime host for the binary |
| `package.json` | npm deps: `axios`, `dockerode`, `fs-extra`, `haversine`, `node-cron`, `simple-git` |
| `config.js` | All environment-specific values in one place — paths use `/data/` (container mount of Volume 2), never hardcoded in logic modules |
| `main.js` | Entry point — `--manual` flag triggers one immediate test window; default starts the cron scheduler |
| `scheduler.js` | Both cron registrations (3 AM speed test, hourly snapshot) and the full Step 1/2/3 test window orchestration loop |
| `airvpnStatus.js` | Fetches AirVPN status API, filters to US/healthy servers, classifies tiers, computes derived fields (available capacity, tier, haversine distance from Cape Coral) |
| `queueBuilder.js` | Prioritizes test queue: missing tier coverage → fewest total sessions → oldest last session → extreme outlier re-testing |
| `gluetunManager.js` | Switches gluetun-test to a new server (stop → remove → recreate container with updated `SERVER_NAMES`), polls tunnel health endpoint |
| `speedTester.js` | Shells out to `speedtest-cli --json --secure` via `spawnSync`, converts bits/s to Mbps |
| `resultsWriter.js` | Atomic write to `results.json` (tmp file → rename), git add + commit via `simple-git` |
| `aggregator.js` | Recalculates all session averages from raw run data after session completes and at window shutdown |
| `snapshotWriter.js` | Writes hourly `YYYY-MM-DD-HH.json` snapshots + maintains `snapshots/index.json` manifest for the report |
| `qbtClient.js` | Pauses and resumes all qBittorrent torrents via its web API, with poll confirmation on pause |

### `report/`
| File | Description |
|------|-------------|
| `index.html` | Single-file static report — fetches `../results.json` and `../snapshots/index.json` at runtime via `fetch()`, no build step. Two tabs: Speed Test Results (bar chart, scatter plots, efficiency chart, city table, server drill-down) and Hourly Snapshots (heatmap, load timeline, city comparison, best-time-to-connect table). Chart.js via cdnjs CDN. |

---

## Key Implementation Decisions

### gluetun Server Switching
The spec showed `container.update({ Env: [...] })` but Docker's API does not support updating environment variables on a live container — they are immutable after creation. The implementation uses **stop → remove → `docker.createContainer` with updated env → start**. This preserves all `HostConfig` settings (capabilities, devices, volumes, network) from the previous container's inspect payload.

### Atomic Writes to `results.json`
Every run is written immediately after it completes (no buffering). To prevent corruption if the process crashes mid-write, results are written to a temp file (`.results.tmp.{timestamp}.json`) and then atomically renamed over the destination using `fs.move` (which is `rename` on Linux — a single syscall).

### Snapshot Index Manifest
Static HTML cannot list directory contents via `fetch()`. `snapshotWriter.js` maintains `snapshots/index.json` — an ordered array of snapshot filenames — updated after every write. The report fetches this index first, then loads individual files in parallel.

### Container Path Convention
`config.js` uses `/data/` paths, not the raw NAS volume paths. Volume 2 (`/volume2/data/vpn-speed-tests`) is mounted into the orchestrator container at `/data/`. This keeps the config values clean and the logic portable.

### qBittorrent Lifecycle
qBittorrent is paused as the **absolute first action** before any Docker or test activity, and resumed as the **absolute last action** after gluetun-test is stopped. It stays paused for the entire test window — even between server switches — to prevent torrent bandwidth from contaminating speed measurements.

### Git Strategy
Results are committed per-session (`data: {server} {tier} session NNN — 3 runs complete`) so that if the aggregator crashes during shutdown, raw run data is already versioned and recoverable. Aggregate recalculation is a separate commit at shutdown (`chore: recalculate aggregates YYYY-MM-DD`).

---

## Storage Layout (on NAS)

```
/volume1/Docker/vpn-speed-tester/   ← SSD (config only — SSD is 91.9% full)
  gluetun-test/                      ← gluetun config volume
  orchestrator/                      ← state, logs

/volume2/data/vpn-speed-tests/       ← HDD (all data)
  results.json                       ← live speed test results
  snapshots/
    index.json                       ← manifest for report
    YYYY-MM-DD-HH.json               ← one per hour
  report/
    index.html                       ← static report
  logs/
    YYYY-MM-DD.log                   ← daily orchestrator logs
```

---

## Next Steps

1. **Manual validation run** — `npm run test:single` on the NAS. Confirm gluetun switches correctly, speedtest-cli runs through the tunnel, `results.json` is written with correct schema, and git commits appear.
2. **Add logging** — reusable `logger.js` (file + console, daily rotation) and `httpClient.js` (axios wrapper with standardized error handling) wired into all modules.
3. **Activate cron schedule** — once 1–2 manual runs pass, enable the 3 AM job.
4. **Serve the report** — open `report/index.html` directly in browser pointed at the `/data/report/` volume mount, or add a simple static server to the stack.

---

## Phase 2 Roadmap (not yet built)

- Automated production VPN switching when load exceeds threshold (Portainer API, already designed)
- Node.js / Express report server replacing static HTML
- Smart scheduling based on hourly snapshot pattern data
