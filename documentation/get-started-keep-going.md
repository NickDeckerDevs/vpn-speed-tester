# Get Started & Keep Going

Operational guide for the VPN speed tester stack. Covers first-time setup, enabling scheduled automation, and diagnosing problems.

---

## HOW TO TEST

> **Assumes:** repo is on your Mac, `.env` is filled in, NAS is reachable at `10.1.10.254:8322`.

### Step 1 — Deploy code to the NAS

```bash
cd ~/repos/vpn-speed-tester
./deploy.sh
```

**What happens:** `deploy.sh` validates that every `.env` variable is present and not a placeholder, then `rsync`s the whole repo to `/volume1/Docker/vpn-speed-tester/` on the NAS over SSH, then runs `docker compose down` + `docker rm -f` to tear down any existing containers. It polls until they're gone, then exits. It does **not** start the stack — that's the next step.

---

### Step 2 — SSH to the NAS and start the stack

```bash
ssh -p 8322 sysop@10.1.10.254
```

Then on the NAS:

```bash
cd /volume1/Docker/vpn-speed-tester
sudo docker compose up -d --build
```

**What happens:** Docker builds the image (`node:20-slim` + Python 3 + `speedtest-cli`) and starts three containers:

- **`orchestrator`** — this is the brain. It runs `node main.js` and is what actually controls everything. In normal (non-manual) mode it registers cron jobs and waits. This is the reason we run `docker compose up`.
- **`gluetun-speedtest`** — starts a WireGuard VPN tunnel using your credentials from `.env`. It defaults to the server `Aladfar` because the compose file has `SERVER_NAMES=${SERVER_NAMES:-Aladfar}`. **This connection is immediately discarded** the moment a test run starts — the orchestrator always tears gluetun down and recreates it with a freshly chosen server. The initial Aladfar connection exists only because gluetun needs *some* server on startup.
- **`speedtest-runner`** — waits for gluetun's health check, then starts. Its only job is to have `speedtest-cli` available inside the VPN tunnel.

First build takes ~30–60 seconds. Confirm all three show `Up`:

```bash
sudo docker ps
```

`gluetun-speedtest` shows `(healthy)` after ~45 seconds once the WireGuard tunnel is established.

---

### Step 3 — Trigger a manual test

```bash
sudo docker exec orchestrator npm run test:single
```

**What happens:** Runs `node main.js --manual` inside the orchestrator. The `--manual` flag skips the cron and immediately calls `runSpeedTestWindow()`. Here is the exact sequence:

1. **Pause torrents** — logs into qBittorrent WebUI, records which torrents are actively downloading (by hash), sends stop-all. Polls until all torrents confirm stopped.

2. **Pick a server** — fetches live AirVPN status, filters to US servers with `health === 'ok'`, classifies each by load tier (`low` 0–30%, `medium` 31–50%, `high` 51–70%, `diablo` 71–100%`), then scores every server against existing results to find the one with the least coverage.

3. **Switch the tunnel** — stops and removes both `speedtest-runner` and `gluetun-speedtest`. Recreates `gluetun-speedtest` with `SERVER_NAMES=<chosen server>` injected. Waits up to 60 seconds for the tunnel to report `{"status":"running"}`. Recreates `speedtest-runner` linked to the new gluetun container's network namespace.

4. **Run 3 speed tests (strictly sequential, no overlap)**:
   - Run 1 fires → completes → results parsed → written to disk
   - 15 second wait
   - Run 2 fires → completes → results parsed → written to disk
   - 15 second wait
   - Run 3 fires → completes → results parsed → written to disk
   
   Each `speedtest-cli --json --secure` runs inside `speedtest-runner` (inside the VPN tunnel) via `docker exec`. One at a time, always.

5. **Commit results** — averages the 3 runs, writes to `/data/results.json`, runs `git add + git commit`.

6. **Resume torrents** — restores all previously-downloading torrents by hash.

Watch live from a second terminal:

```bash
sudo docker logs -f orchestrator
```

Lines to confirm a successful run:
```
[qBittorrent] all torrents paused
switchServer: container started → <ServerName>
waitForTunnel: tunnel confirmed after N attempt(s)
[SpeedTest] run 1/3 — download: XX.X Mbps
[SpeedTest] run 2/3 — download: XX.X Mbps
[SpeedTest] run 3/3 — download: XX.X Mbps
[Results] results.json written
[qBittorrent] torrents resumed
```

---

### Step 4 — Verify results on disk

```bash
ls -lh /volume1/Docker/vpn-speed-tester/data/results.json
cd /volume1/Docker/vpn-speed-tester/data && git log --oneline
```

Each successful session produces a git commit. If the log shows a recent commit, the run succeeded.

---

## Table of Contents

1. [Getting Started — First Time](#getting-started--first-time)
2. [Enabling Scheduled Automation](#enabling-scheduled-automation)
3. [How to Report Errors and Issues](#how-to-report-errors-and-issues)

---

## Getting Started — First Time

### Step 0 — Push the local repo to GitHub (do this on your Mac first)

```bash
git remote add origin https://github.com/NickDeckerDevs/vpn-speed-tester.git   # skip if already linked
git push -u origin master
```

Confirm the repo is visible on GitHub before continuing.

---

### Step 1 — Set up SSH key authentication to the NAS (one-time setup)

#### 1a. Enable SSH on Asustor ADM

1. Log into the ADM web interface at `http://10.1.10.254`
2. Go to **Settings** → **Services** → **Terminal**
3. Enable the SSH service — port is **8322**
4. Save and apply

#### 1b. Generate an SSH key pair on your Mac (if you don't already have one)

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

#### 1c. Install your public key on the NAS

In ADM go to **Account** → **SSH Keys**, paste the contents of `~/.ssh/id_ed25519.pub`, and save.

#### 1d. Test key-based login

```bash
ssh nas                                    # uses ~/.ssh/config alias → sysop@10.1.10.254:8322
ssh networkadmin@10.1.10.254 -p 8322      # alternative from any machine
```

`sysop` and `networkadmin` are equivalent for this project.

---

### Step 2 — Fill in `.env`

Copy `.env.example` to `.env` and fill in every value. See `.env.example` for where each value comes from.

```bash
cp .env.example .env
```

Required values:

| Variable | Where to find it |
|---|---|
| `WIREGUARD_PRIVATE_KEY` | AirVPN .conf → `[Interface] PrivateKey` |
| `WIREGUARD_PRESHARED_KEY` | AirVPN .conf → `[Peer] PresharedKey` |
| `WIREGUARD_ADDRESSES` | AirVPN .conf → `[Interface] Address` (e.g. `10.129.178.159/32`) |
| `QBT_USERNAME` | qBittorrent WebUI username (default: `admin`) |
| `QBT_PASSWORD` | qBittorrent WebUI password — Tools → Options → Web UI |
| `QBT_BASE_URL` | LAN URL of qBittorrent WebUI (e.g. `http://10.1.10.254:8080`) |
| `SYSOP_SSH` | NAS sudo password (used by deploy.sh for remote docker commands) |

> **Never commit `.env` to git.** It is already in `.gitignore`.

---

### Step 3 — Deploy to the NAS

Run the deploy script from your Mac. It validates `.env`, rsyncs all code and config to the NAS, tears down the old stack, and polls until all containers are confirmed gone:

```bash
cd ~/repos/vpn-speed-tester
./deploy.sh
```

The script exits with an error if any `.env` value is missing or still a placeholder. Fix it before continuing.

When `./deploy.sh` finishes you'll see:
```
Done. To bring the stack up: SSH to NAS → sudo docker compose up -d --build
```

---

### Step 4 — Create Volume 2 data directories and copy the report (one-time, on the NAS)

SSH into the NAS and run:

```bash
mkdir -p /volume1/Docker/vpn-speed-tester/data/snapshots
mkdir -p /volume1/Docker/vpn-speed-tester/data/report
mkdir -p /volume1/Docker/vpn-speed-tester/data/logs
cp /volume1/Docker/vpn-speed-tester/report/index.html /volume1/Docker/vpn-speed-tester/data/report/index.html
```

---

### Step 5 — Bring the stack up on the NAS

SSH into the NAS and run:

```bash
cd /volume1/Docker/vpn-speed-tester
sudo docker compose up -d --build
```

The first build takes ~30–60 seconds (installs Python, pip, and speedtest-cli). Confirm all three containers are running:

```bash
sudo docker ps
```

Expected — all three showing `Up`:
- `gluetun-speedtest` — shows `(healthy)` after ~45 seconds
- `speedtest-runner`
- `orchestrator`

You can also check Portainer at `http://10.1.10.254:9000`.

---

### Step 6 — Run the first manual test

```bash
sudo docker exec orchestrator npm run test:single
```

Watch logs in parallel from another terminal:

```bash
sudo docker logs -f orchestrator
```

What to confirm in the logs:

- `[qBittorrent] all torrents paused`
- `switchServer: container started → <ServerName>`
- `switchServer: speedtest-runner restarted`
- `waitForTunnel: tunnel confirmed after N attempt(s)`
- 3 speed test runs with Mbps values logged
- `results.json` written and committed
- `[qBittorrent] torrents resumed`

Verify the data file:

```bash
ls -lh /volume1/Docker/vpn-speed-tester/data/results.json
cd /volume1/Docker/vpn-speed-tester/data && git log --oneline
```

---

### Step 7 — Run the second manual test

Same command — the queue builder picks a different server/tier than run 1:

```bash
sudo docker exec orchestrator npm run test:single
```

Confirm `results.json` has two servers' worth of data, then open `report/index.html` in a browser pointed at the volume mount to confirm the bar chart renders.

---

### Step 8 — Verify snapshots

Wait for the hourly cron to fire (or restart the orchestrator near the top of the hour), then:

```bash
ls /volume1/Docker/vpn-speed-tester/data/snapshots/
cat /volume1/Docker/vpn-speed-tester/data/snapshots/index.json
```

Confirm `index.json` lists the snapshot file, and that report Tab 2 (Hourly Snapshots) renders the heatmap.

---

### Redeploying after a code change

```bash
# On your Mac — validates .env, rsyncs, tears down the old stack
./deploy.sh

# SSH to the NAS — rebuild and bring back up
ssh nas
cd /volume1/Docker/vpn-speed-tester
sudo docker compose up -d --build
```

Or use Portainer → Stacks → `vpn-speed-tester` → **Pull and redeploy**.

---

## Enabling Scheduled Automation

After 2 successful manual runs, the stack is ready to run on its own. The orchestrator already runs in scheduled mode by default (`npm run start` = `node main.js`).

### How the scheduler works

Two background jobs start automatically when the container starts:

1. **Daily speed test window** — fires at `TEST_START_HOUR` (default: 3 AM), runs for up to `TEST_WINDOW_HOURS` (default: 2 hours)
2. **Hourly load snapshot** — fires every hour on the hour

Confirm they registered by checking startup logs:

```bash
sudo docker logs orchestrator | head -30
```

Look for:
```
[INFO ] cron registered: speed test window at hour 3
[INFO ] cron registered: hourly snapshot
```

---

### Change the test window hour

Edit `TEST_START_HOUR` in `orchestrator/config.js`, then redeploy:

```bash
TEST_START_HOUR: 22,   // runs at 10 PM
```

---

### Add a second scheduled run

Edit `orchestrator/scheduler.js` — find the existing `cron.schedule()` call and add another below it:

```js
// Example: also run at noon on weekends
cron.schedule('0 12 * * 6,0', () => {
  scheduler.runSpeedTestWindow();
});
```

**Cron syntax quick reference:**
```
┌─ minute (0–59)
│  ┌─ hour (0–23)
│  │  ┌─ day of month (* = any)
│  │  │  ┌─ month (* = any)
│  │  │  │  ┌─ day of week (0=Sun … 6=Sat)
0  3  *  *  *     → every day at 3 AM
0  12 *  *  6,0   → noon on Saturday and Sunday
0  3  *  *  1,3,5 → 3 AM on Monday, Wednesday, Friday
```

Each window runs independently — if two windows overlap, the second starts anyway. Plan run times around `TEST_WINDOW_HOURS`.

---

## How to Report Errors and Issues

### Self-diagnosis

#### 1. Check container health

```bash
sudo docker ps
```

All three should show `Up`. If any shows `Exited` or `Restarting`:

```bash
sudo docker compose -f /volume1/Docker/vpn-speed-tester/docker-compose.yml logs --tail=50
```

#### 2. Tail live logs

```bash
sudo docker logs -f orchestrator
```

#### 3. Read today's log file

```bash
cat /volume1/Docker/vpn-speed-tester/data/logs/$(date +%F).log
grep -E "\[ERROR\]|\[WARN\]" /volume1/Docker/vpn-speed-tester/data/logs/$(date +%F).log
```

#### 4. Common error patterns

| What you see | Likely cause | First step |
|---|---|---|
| `ECONNREFUSED` | A service is down (qBittorrent, container) | `sudo docker ps` — which containers are running? |
| `ENOTFOUND` | External DNS unreachable | Check orchestrator's outbound network; check gluetun logs |
| `ETIMEDOUT` | Network or service overloaded | Wait a few minutes, then check again |
| `429 Rate Limited` | AirVPN or speedtest API rate limit | Reduce test frequency; wait the retry-after period |
| `Auth error (401/403)` | qBittorrent credentials wrong or missing | Check `QBT_PASSWORD` and `QBT_BASE_URL` in `.env` |
| `speedtest-cli exited 127` | speedtest-cli not found in image | Rebuild the Docker image |
| `waitForTunnel: attempt X` then timeout | gluetun tunnel never came up | Check gluetun logs; verify WireGuard keys in `.env` |
| `SESSION ERROR [server-name]` | One server test failed | Non-fatal — other servers continue |
| `gluetun-speedtest unhealthy` | Missing `WIREGUARD_ADDRESSES` or tunnel still starting | Confirm the var is set; wait 45–60s |
| `permission denied` (Docker socket) | NAS user not in docker group | Prefix command with `sudo` |

#### 5. Check data integrity

```bash
cd /volume1/Docker/vpn-speed-tester/data
git log --oneline
```

Each successful session produces a git commit. If the last commit is old, the test window may have failed before completing.

---

### What to include when escalating

1. The exact error line(s) — timestamp, level, context tag, full message
2. Date and approximate time the problem occurred
3. Output of `sudo docker ps` at the time
4. The full log file for the affected day
5. Gluetun logs if the error looks tunnel-related: `sudo docker logs gluetun-speedtest --tail=50`
6. Any recent changes — config edits, `.env` changes, new deployments
