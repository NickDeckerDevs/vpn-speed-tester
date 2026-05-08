# Roadmap — Working Document

**Project:** AirVPN Speed Tester  
**Last Updated:** May 2026  
**Phase 1 Status:** Complete — scaffold built, all pre-flight bugs fixed, deploy flow hardened, docs current

This is a living document. Check items off as they're completed. Update it when priorities shift or new ideas surface.

---

## Session Complete — 2026-05-07

All planned pre-deploy work is done:

- `deploy.sh` — validates all 7 `.env` vars before syncing; polls until containers are gone after teardown; `--test` flag removed ✅
- `orchestrator/config.js` — `QBT_BASE_URL` fallback removed; startup guard throws on missing `QBT_BASE_URL` or `QBT_PASSWORD` ✅
- `.env.example` — `SYSOP_SSH` documented; `QBT_BASE_URL` has real example format; all vars have inline comments ✅
- `documentation/verified-completed-historical-only/` — `fix-queue-and-startup-logic.md`, `qbittorrent-auth-debug.md`, `initial-build-report.md` archived ✅
- `documentation/get-started-keep-going.md` — rewritten: correct deploy flow, no `--test` references, no stale callout boxes ✅

**Confirmed runtime flow:**
```
./deploy.sh          → validate .env → rsync → tear down → poll until containers gone → Done
(NAS manually)       → sudo docker compose up -d --build
orchestrator starts  → node main.js → scheduler.start() → cron registered
3 AM cron fires      → runSpeedTestWindow() → pick server → switchServer() → 3 runs → commit
manual test          → sudo docker exec orchestrator npm run test:single
```

**Next action: push to GitHub, then run the first manual test on the NAS.**

---

## Current State

All Phase 1 work is done and three pre-flight bugs have been fixed:
- All 13 orchestrator modules built and wired together
- Docker stack (`docker-compose.yml`) defined with `gluetun-speedtest`, `speedtest-runner`, `orchestrator`
- Static HTML report built (`report/index.html`) — two tabs, all charts
- Logging (`logger.js`) and HTTP error handling (`httpClient.js`) integrated
- `get-started-keep-going.md` written with setup and troubleshooting guide

**Bugs fixed (2026-05-07):**
- `waitForTunnel()` now polls `http://gluetun-speedtest:8000/v1/vpn/status` (gluetun control API) instead of `check.airservers.org` — the external DNS lookup failed during gluetun's stop/remove/create cycle
- `runSpeedtest()` now exec's `speedtest-cli` inside `speedtest-runner` via dockerode — it was previously running in the orchestrator process, bypassing the VPN entirely
- `switchServer()` now restarts `speedtest-runner` after recreating `gluetun-speedtest` — the shared network namespace must be re-attached after each container recreation
- `deploy.sh` now does `docker compose down` + force-removes orphaned containers before every rebuild, preventing name conflicts caused by the orchestrator's dynamic container recreation
- Added `DNS_IPV6=false` to `gluetun-speedtest` environment, matching the production stack

**What hasn't happened yet:** the stack has never completed a full run on the NAS. No real test data exists. That's P0.

---

## P0 — Deploy & Validate

> Nothing else matters until the stack runs end-to-end on the NAS with real data.

### Repository Setup
- [ ] Push local repo to GitHub (`git push -u origin master`)
- [ ] Confirm repo is visible on GitHub before touching the NAS

### NAS — One-Time Setup
- [x] Enable SSH on ADM: Settings → Services → Terminal (port 8322)
- [x] Generate SSH key pair on Mac if not already present (`ssh-keygen -t ed25519`)
- [x] Install public key on NAS via ADM → Services → Terminal → SSH Keys
- [x] Confirm passwordless SSH

**SSH quick reference:**
- Laptop: `ssh nas` (alias in `~/.ssh/config` → sysop@10.1.10.254:8322 using `~/.ssh/id_rsa_asustor`)
- Desktop: `ssh networkadmin@10.1.10.254 -p 8322`
- `sysop` and `networkadmin` are equivalent for this project's purposes.

### NAS — Sync & Deploy

- [ ] Run `./deploy.sh` from your Mac — validates `.env`, rsyncs code, tears down old stack, polls until containers are gone
- [ ] Create required data directories on the NAS (one-time, Volume 2 — separate from repo on Volume 1):
  ```bash
  ssh nas
  mkdir -p /volume2/data/vpn-speed-tests/snapshots
  mkdir -p /volume2/data/vpn-speed-tests/report
  mkdir -p /volume2/data/vpn-speed-tests/logs
  cp /volume1/Docker/vpn-speed-tester/report/index.html /volume2/data/vpn-speed-tests/report/index.html
  ```
- [ ] SSH into the NAS and bring the stack up:
  ```bash
  cd /volume1/Docker/vpn-speed-tester
  sudo docker compose up -d --build
  ```
- [ ] Confirm all 3 containers show `Up`:
  ```bash
  sudo docker ps
  ```
  Expected: `gluetun-speedtest`, `speedtest-runner`, `orchestrator` all `Up`
- [ ] (Optional) View the stack in Portainer at `http://10.1.10.254:9000`

### First Manual Test Run
- [ ] Run: `sudo docker exec orchestrator npm run test:single`
- [ ] Watch logs in parallel: `sudo docker logs -f orchestrator`
- [ ] Confirm qBittorrent paused (log line: `[qBittorrent] all torrents paused`)
- [ ] Confirm gluetun-speedtest switches to a server (log: `switchServer: container started → Aladfar`)
- [ ] Confirm speedtest-runner restarted (log: `switchServer: speedtest-runner restarted`)
- [ ] Confirm tunnel comes up (log: `waitForTunnel: tunnel confirmed after N attempt(s)`)
- [ ] Confirm 3 speed test runs complete with Mbps values logged
- [ ] Confirm `results.json` written: `ls -lh /volume2/data/vpn-speed-tests/results.json`
- [ ] Confirm git commit: `cd /volume2/data/vpn-speed-tests && git log --oneline`
- [ ] Confirm qBittorrent resumed (log: `[qBittorrent] torrents resumed`)

### Second Manual Test Run
- [ ] Run `sudo docker exec orchestrator npm run test:single` again
- [ ] Confirm queue builder picks a different server/tier than run 1
- [ ] Confirm `results.json` has two servers' worth of data
- [ ] Open `report/index.html` in browser pointed at volume mount — confirm bar chart renders

### Snapshot Verification
- [ ] Wait for the hourly cron to fire (or restart orchestrator near the top of the hour)
- [ ] Confirm snapshot file: `ls /volume2/data/vpn-speed-tests/snapshots/`
- [ ] Confirm `snapshots/index.json` exists and lists the snapshot file
- [ ] Confirm report Tab 2 (Hourly Snapshots) loads and renders the heatmap

---

## P1 — Activate Automation

> After 2 successful manual runs pass cleanly, enable the nightly scheduler.

- [ ] The orchestrator already runs in scheduled mode by default (`npm run start` = `node main.js` without `--manual`)
- [ ] Confirm startup logs show cron registrations:
  - `[INFO ] cron registered: speed test window at hour 3`
  - `[INFO ] cron registered: hourly snapshot`
- [ ] Let the 3 AM cron run unattended — review logs the next morning
- [ ] Check: `grep -E "\[ERROR\]|\[WARN\]" /volume2/data/vpn-speed-tests/logs/$(date +%F).log`
- [ ] After 3–5 nights: review tier coverage across servers (check report bar chart)
- [ ] After 1 week: decide if `TEST_WINDOW_HOURS` needs to increase to cover more servers per night

### Optional Schedule Adjustments
- [ ] Change `TEST_START_HOUR` in `orchestrator/config.js` if 3 AM is inconvenient
- [ ] Add a weekend midday run in `orchestrator/scheduler.js` if coverage is building too slowly:
  ```js
  cron.schedule('0 12 * * 6,0', () => { scheduler.runSpeedTestWindow(); });
  ```
- [ ] Redeploy via Portainer after any config or code change (Pull and redeploy)

---

## P2 — Automated Production VPN Switching

> Requires 2–4 weeks of snapshot data to set confident load thresholds. Do not start until snapshot data is available.

**Goal:** When the production Gluetun server load exceeds a threshold, the hourly snapshot job automatically switches it to a better server via the Portainer API.

- [ ] Analyze snapshot data — which servers are consistently Low/Medium? Which cities are reliable?
- [ ] Define the load threshold for triggering a switch (starting point: `currentload > 70`)
- [ ] Define preferred city list for replacement candidates (closest, historically lowest load)
- [ ] Build `orchestrator/portainerClient.js`:
  - `GET /api/stacks` — find the production stack ID
  - `GET /api/stacks/{id}` — read current env vars
  - `PUT /api/stacks/{id}` — update `SERVER_NAMES`, redeploy in-place
  - Portainer API token stored in `.env` as `PORTAINER_API_TOKEN`
- [ ] Wire into `snapshotWriter.js`: after each hourly snapshot, check production server load vs. threshold
- [ ] Query snapshot history to select best replacement server (lowest recent load in preferred cities)
- [ ] **Dry run first:** log the would-be switch but don't call Portainer API — let it run for 2–3 days
- [ ] Review dry-run logs — confirm switch decisions look reasonable
- [ ] Enable live switching — add `ENABLE_AUTO_SWITCH=true` to `.env` as a gate
- [ ] Monitor first few live switches in logs and confirm production traffic behaves correctly
- [ ] Optional: Home Assistant / Mosquitto push notification on switch event

---

## P3 — Report Server & React Frontend

> JSON schema does not change. This is a UI lift — same data, better interface.

**Goal:** Replace the single static `index.html` with a Node.js/Express server and React frontend so the report can be served on the LAN, support live data refresh, and grow new features without file size limits.

- [ ] Design the service structure (fourth container in `docker-compose.yml` or extend orchestrator)
- [ ] Add `express` to `package.json` (or create a separate `report-server/` directory)
- [ ] Build Express endpoints:
  - `GET /api/results` — reads and returns `results.json`
  - `GET /api/snapshots` — returns `index.json` manifest + individual snapshot files
  - `GET /api/status/live` — proxies AirVPN status API for a live server load view
- [ ] Migrate HTML/CSS/Chart.js code from `report/index.html` into React components
- [ ] Expose on port 8081 (or another unused port) for LAN browser access
- [ ] Add new service to `docker-compose.yml`
- [ ] Update `get-started-keep-going.md` with new access URL and any new deploy steps

---

## Considerations & Future Ideas

Items worth tracking but not committed to. Revisit as data accumulates and priorities clarify.

| Idea | Notes |
|------|-------|
| **Smart scheduling (Phase 4)** | After several weeks of snapshots, dynamically shift test window to hours when target servers are historically low-load. Build predicted load curves per server per hour of day. |
| **Unit tests** | Add `npm test` with Jest. Priority candidates: `queueBuilder` priority logic, `aggregator` average calculation, `airvpnStatus` tier classification. |
| **Data retention policy** | Snapshots accumulate indefinitely. Define a max age (e.g., 90 days) and add a cleanup task to the hourly cron. |
| **Error alerting** | Push a notification (Home Assistant, email, Pushover) if an entire test window fails — not just a session, but the whole run exits without completing. |
| **Jitter/ping visualizations** | The report bar chart focuses on download speed. Latency and jitter data is collected but underrepresented. Add scatter plots or a ranking view by ping. |
| **International servers** | The spec excludes these for Phase 1, but the architecture handles any AirVPN server by name. Could enable EU or AU servers as a separate test tier. |
| **Multiple entry IPs per server** | Currently always uses `ip_v4_in1`. All 4 IPs hit the same physical box, but testing the others could reveal if one performs better for WireGuard. |
| **Container health watchdog** | Add a watchdog that detects if the orchestrator goes silent (no log output for N hours during a window) and restarts it or sends an alert. |
| **Efficiency ratio in report** | `speed_efficiency_ratio` is collected but not prominently charted. Useful for finding servers that underperform relative to their available headroom. |

---

*Update this file as work progresses. Cross off items, move ideas up when they become committed, and add new ones as they surface.*
