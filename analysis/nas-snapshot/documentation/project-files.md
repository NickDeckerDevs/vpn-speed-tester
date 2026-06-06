# VPN Speed Tester — Project Files Reference

This document maps every file in the vpn-speed-tester repository to its role, deployment path, and lifecycle. It clarifies which files are local-only (dev), server-only (runtime), or bidirectional (synced).

---

## Repository Layout

### Root Directory — Configuration & Deployment
| File | Role | Deploy | Notes |
|---|---|---|---|
| `.env` | Secrets (WireGuard keys, qBittorrent creds, SSH password) | **Excluded** | Never committed; loaded by docker-compose; rsync excludes it |
| `.env.example` | Template for `.env` | Synced | Tracked in git; users copy and populate with real secrets |
| `.gitignore` | Git excludes | Tracked | Excludes `.env`, `node_modules/`, `*.log`, `.results.tmp.*.json`, `.claude/` |
| `docker-compose.yml` | Entire test stack definition | Synced | Three services: `gluetun-speedtest`, `speedtest-runner`, `orchestrator`, + `report-server` (nginx) |
| `.claude/settings.local.json` | Claude Code editor config | Excluded | User-specific; not part of the deployed project |

### Deployment & Operations Scripts
| File | Role | How It's Used | Target |
|---|---|---|---|
| `deploy.sh` | Validate → rsync → teardown → **bring up stack** (fully automated) | Run locally: `./deploy.sh` | Syncs repo to NAS; tears down old containers; automatically starts new stack; verifies health |
| `deploy.sh --check` | Show live container status | `./deploy.sh --check` | SSH into NAS and runs docker ps |
| `view-report.sh` | Pull report HTML from NAS → open browser | `./view-report.sh` | Fetches latest HTML report back to local |
| `view-data.sh` | Multi-command data viewer (summary/json/logs/servers) | `./view-data.sh [command]` | Reads data from NAS via SSH |
| `export-summary.sh` | Generate plaintext speed report | `./export-summary.sh [output.txt]` | Reads results.json from NAS, formats as text |

### Orchestrator — Core Application
**Location:** `orchestrator/` (local) → `/app/` in Docker container → code loaded from Docker image  
**Config volume:** `/volume1/Docker/vpn-speed-tester/orchestrator:/config` in Docker (mounted but not used for code)

| File | Role | Called By | Purpose |
|---|---|---|---|
| `main.js` | Entrypoint | `CMD ["node", "main.js"]` in Dockerfile | Checks `--manual` flag; calls `scheduler.start()` (scheduled) or `scheduler.runSpeedTestWindow()` (manual) |
| `scheduler.js` | Orchestration loop | `main.js` | Registers cron jobs; runs speed test session loop; manages qBittorrent pause/resume; calls aggregator on shutdown |
| `config.js` | All constants & env vars | All modules | Paths, URLs, thresholds, schedule times, tier definitions |
| `airvpnStatus.js` | Fetch & parse AirVPN status API | `scheduler.js`, `queueBuilder.js` | Fetches 50 US servers; classifies tiers; computes distance from Cape Coral |
| `queueBuilder.js` | Score & sort servers for testing | `scheduler.js` | Pure logic: picks next server based on tier coverage, session count, last run time |
| `gluetunManager.js` | Docker container lifecycle | `scheduler.js` | Stop/remove/create `gluetun-speedtest`; switch server; poll tunnel health via HTTP |
| `speedTester.js` | Run speedtest-cli | `scheduler.js` | Execs `speedtest-cli` inside `speedtest-runner` container via Docker socket; parses JSON |
| `resultsWriter.js` | I/O for results.json | `scheduler.js` | Atomic write (tmp → move); git commit wrapper; ensure git repo exists |
| `snapshotWriter.js` | Hourly status snapshots | `scheduler.js` (cron) | Writes `/data/snapshots/YYYY-MM-DD-HH.json`; updates index; commits to git |
| `aggregator.js` | Session average calculations | `scheduler.js` | Pure math: averages download/upload/ping/jitter; computes efficiency ratio |
| `qbtClient.js` | qBittorrent pause/resume | `scheduler.js` | HTTP API calls to 10.1.10.254:8080; logs in, pauses, confirms, resumes |
| `logger.js` | Structured logging | All modules | Writes to stdout + `/data/logs/YYYY-MM-DD.log`; `logger.fn()`, `.info()`, `.debug()`, `.warn()`, `.error()` |
| `httpClient.js` | HTTP fetch wrapper | `airvpnStatus.js`, `qbtClient.js` | Timeout handling; error context |
| `Dockerfile` | Container image | Built by `docker-compose build` | `node:20-slim` + Python 3 + pip; installs `speedtest-cli`; copies orchestrator code |
| `package.json` | npm dependencies | `npm install` in Dockerfile | axios, dockerode, fs-extra, haversine, node-cron, simple-git |
| `package-lock.json` | Dependency lock (if present) | `npm ci` in Dockerfile | **Note:** orchestrator is the only place with a lock file; root-level lock files deleted |

### Data Directory — Runtime Results & Reports
**Location:** `data/` (local) → `/volume1/Docker/vpn-speed-tester/data/` on NAS  
**Mounted in Docker:** all containers read/write to `/data` which maps to NAS data directory

| File/Dir | Role | Written By | Access |
|---|---|---|---|
| `results.json` | Main speed test results | `orchestrator` | Read by report HTML; git-tracked; ~12 KB at project start |
| `snapshots/` | Hourly server load snapshots | `orchestrator` (cron @:30) | `YYYY-MM-DD-HH.json` per hour; used for load pattern analysis; git-tracked |
| `snapshots/index.json` | List of all snapshot files | `orchestrator` | Updated on each hourly snapshot write; git-tracked |
| `logs/YYYY-MM-DD.log` | Daily orchestrator logs | `logger.js` | Appended by all orchestrator instances; **not git-tracked** (in `.gitignore`) |
| `.git/` | Git repository | `resultsWriter.js` (git commands) | Tracks `results.json`, snapshots, report HTML; initialized by `ensureGitRepo()` |

### Static Report — HTML Viewer
**Location:** `report/` (local) → `/volume1/Docker/vpn-speed-tester/data/report/` on NAS  
**Served by:** nginx container at `http://10.1.10.254:9191/report/index.html`

| File | Role | Updated By | Served From |
|---|---|---|---|
| `report/index.html` | Single-page report application | `deploy.sh` (rsync) | `/volume1/Docker/vpn-speed-tester/data/report/index.html` |

**Report behavior:** fetches `../results.json` and `../snapshots/` at page load (no caching); renders tabs: Speed Test Results, Hourly Snapshots. Charts use Chart.js (CDN).

### Documentation
| File | Audience | Content |
|---|---|---|
| `documentation/vpn-speed-tester-spec.md` | Designers/implementers | Complete system specification: goals, architecture, JSON schema, scheduling, orchestrator design, stack definition, report layout, git strategy, roadmap, decisions log |
| `documentation/roadmap-working.md` | Project manager | Phase 1 status (complete), P0 next action, known issues fixed |
| `documentation/get-started-keep-going.md` | Operators | How to: run deploy.sh, ssh into NAS, docker compose up, check logs, troubleshoot |
| `documentation/project-files.md` | Developers | This file; file inventory and roles |
| `documentation/verified-completed-historical-only/` | Reference | Historical bug fixes and learnings (queue logic, qBittorrent auth, build report) |

---

## Deployment Flow

### 1. Development (Local Machine)
- Edit files in `orchestrator/`, `report/`, `documentation/`
- Update `.env` with secrets (never committed)
- Populate `docker-compose.yml` with environment variables

### 2. Deploy (Run Locally — Fully Automated)
```bash
./deploy.sh
```
**Actions:**
1. Validate 7 required `.env` vars
2. Rsync entire repo (excluding `.git`, `node_modules/`, `.env`) to NAS at `/volume1/Docker/vpn-speed-tester/`
3. Create data directories on NAS (`snapshots/`, `logs/`, `report/`)
4. Rsync `report/` HTML to NAS data directory
5. Tear down existing containers
6. Poll until all three containers are confirmed gone
7. **Automatically bring up the new stack** with `docker compose up -d --build` (no manual SSH required)
8. Verify all containers are running and healthy
9. Report success to console

Containers start automatically:
- `gluetun-speedtest` — WireGuard tunnel to AirVPN (isolated VPN stack)
- `speedtest-runner` — Node environment with speedtest-cli binary, runs on gluetun's network
- `orchestrator` — Node process running `main.js` in SCHEDULED mode (crons registered)
- `report-server` — nginx serving `/data/` as webroot at port 9191

### 4. Runtime
- **3:00 AM daily:** speed test cron fires → `runSpeedTestWindow()` → tests 5–20 servers → writes results.json + commits
- **Every hour @ :30:** snapshot cron fires → `writeHourlySnapshot()` → writes `YYYY-MM-DD-HH.json` + commits
- **Manual testing:** SSH to orchestrator container, run `npm run test:single` to trigger one speed test immediately
- **Log viewing:** `tail -f /volume1/Docker/vpn-speed-tester/data/logs/$(date +%Y-%m-%d).log`
- **Report viewing:** Open browser, go to `http://10.1.10.254:9191/report/index.html`

### 5. Data Sync
- Local `data/` contains only `results.json` (git-tracked)
- NAS `/volume1/Docker/vpn-speed-tester/data/` contains the live data (git repo at `/data/`, results + snapshots tracked)
- Report is in NAS data directory and served by nginx
- To pull latest results locally: `view-data.sh json` or `export-summary.sh`

---

## Key Design Decisions

1. **Single git repo at `/data/`:** results.json, snapshots, and report HTML are version-controlled on the NAS; git is NOT initialized locally
2. **Staggered crons:** Speed test at 3:00 AM (`0 3 * * *`), snapshots at :30 past every hour (`30 * * * *`) — avoids lock contention
3. **Atomic writes:** results.json written to temp file first, then renamed — prevents partial writes if process crashes
4. **Docker socket access:** orchestrator can manage gluetun/speedtest-runner containers via `/var/run/docker.sock` binding
5. **Isolated VPN stack:** test gluetun is separate from production Gluetun; neither affects the other
6. **No Python code:** speedtest-cli is a binary installed via pip in Dockerfile; orchestrator is pure JavaScript; Docker execs the binary inside the VPN namespace

---

## Cleanup & Maintenance

### On Local Machine
- **`.env`**: Keep safe; regenerate if credentials are rotated
- **`node_modules/`**: Ignored by rsync; not synced to NAS
- **Logs**: Only on NAS; local `.log` files are ignored
- **Orphaned files**: Removed in May 2026 cleanup (removed-deploy-test.sh, root snapshots/, root logs/, root package-lock.json)

### On NAS
- **`.results.tmp.*.json`**: Leftover temp files from crashed writes; safe to delete manually
- **Logs older than 30 days**: Can be archived/deleted to save space
- **Git history**: Full history kept for audit trail; can be pruned if space is critical

---

## Troubleshooting

| Issue | File to Check | Action |
|---|---|---|
| Stack won't start | `docker-compose.yml` | Verify volume paths; check `.env` vars |
| Orchestrator crashes | `/volume1/Docker/vpn-speed-tester/data/logs/YYYY-MM-DD.log` | Search for `[ERROR]` or `FATAL` |
| Speed data is null | `orchestrator/scheduler.js:132` | Confirm `await runSpeedtest()` is present |
| Report shows no data | `orchestrator/resultsWriter.js` | Check `writeResults()` JSON output in logs |
| Snapshots not written | `orchestrator/snapshotWriter.js` | Confirm `ensureGitRepo()` is called; check cron timing |
| Distance calculations wrong | `orchestrator/airvpnStatus.js` | Verify city names match `CITY_COORDS` table |

---

*Last updated: May 2026. This document is the source of truth for project file organization.*
