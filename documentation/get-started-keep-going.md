# Get Started & Keep Going

Operational guide for the VPN speed tester stack. Covers first-time setup, enabling scheduled automation, and diagnosing problems.

---

## Table of Contents

1. [Getting Started — First Time](#getting-started--first-time)
2. [Getting Started to Automate Testing](#getting-started-to-automate-testing)
3. [How to Report Errors and Issues](#how-to-report-errors-and-issues)

---

## Getting Started — First Time

This section walks through everything needed to get the stack running and execute two manual speed test runs.

### Step 0 — Push the local repo to GitHub (do this on your Mac first)

Before touching the NAS, the repo needs to be on GitHub so it can be cloned remotely.

```bash
# From the project root on your Mac
git remote add origin https://github.com/NickDeckerDevs/vpn-speed-tester.git   # skip if already linked
git push -u origin master
```

Confirm the repo is visible on GitHub before continuing.

---

### Step 1 — Set up SSH key authentication to the NAS (one-time setup)

Key-based auth avoids typing a password every time you SSH in.

#### 1a. Enable SSH on Asustor ADM

1. Log into the ADM web interface at `http://10.1.10.254`
2. Go to **Settings** → **Services** → **Terminal**
3. Enable the SSH service — port is **8322** (not the default 22)
4. Save and apply

#### 1b. Generate an SSH key pair on your Mac (if you don't already have one)

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
# Accept the default path (~/.ssh/id_ed25519) and set a passphrase if you like
```

#### 1c. Install your public key on the NAS

Option A — via ADM (no password auth needed):
1. In ADM go to your **Account** settings → **SSH Keys** (or **Authorized Keys**)
2. Paste the contents of `~/.ssh/id_ed25519.pub` into the field and save

Option B — via terminal (requires password auth to be temporarily enabled):
```bash
ssh-copy-id networkadmin@10.1.10.254
```

#### 1d. Test key-based login

```bash
# From laptop (uses ~/.ssh/config alias → sysop@10.1.10.254:8322)
ssh nas

# From desktop or any machine without the alias
ssh networkadmin@10.1.10.254 -p 8322
```

`sysop` and `networkadmin` are equivalent for this project.

---

### Step 2 — Sync the repository to the NAS

Use the deploy script from your Mac — it handles rsync and rebuild in one command:

```bash
cd ~/repos/vpn-speed-tester
./deploy.sh
```

This rsyncs all code and config (including `.env`) to the NAS, then rebuilds and restarts the Docker stack. To push any local changes to the NAS, just run it again.

> **What it does internally:** rsync with `--exclude='.git'` and `--exclude='node_modules'`, then `docker compose down` followed by `docker compose up -d --build` on the NAS via SSH. The down step also force-removes any orphaned containers by name (`gluetun-speedtest`, `speedtest-runner`, `orchestrator`) before the rebuild, since the orchestrator recreates `gluetun-speedtest` dynamically and those containers lose their compose labels.

---

### Step 3 — Verify `.env` is on the NAS

The `rsync` in Step 2 copies `.env` automatically (it lives in the repo root locally). Confirm it arrived:

```bash
ssh nas ls /volume1/Docker/vpn-speed-tester/.env
```

**Required `.env` values** — make sure all five are present before deploying:

| Variable | Where to find it |
|---|---|
| `WIREGUARD_PRIVATE_KEY` | AirVPN config file → `[Interface] PrivateKey` |
| `WIREGUARD_PRESHARED_KEY` | AirVPN config file → `[Peer] PresharedKey` |
| `WIREGUARD_ADDRESSES` | AirVPN config file → `[Interface] Address` (e.g. `10.129.178.159/32`) |
| `QBT_USERNAME` | qBittorrent WebUI username (default: `admin`) |
| `QBT_PASSWORD` | qBittorrent WebUI password — set/reset via Tools → Options → Web UI |

`WIREGUARD_ADDRESSES` is required by gluetun for AirVPN WireGuard — the container will fail to connect without it.

`QBT_PASSWORD` must not be empty — the orchestrator authenticates from a Docker bridge IP (`172.21.0.x`) that is not on the qBittorrent LAN whitelist, so real credentials are required.

> **Never commit `.env` to git.** It is already in `.gitignore`.

---

### Step 4 — Create Volume 2 data directories and copy the report

The containers write all data to `/volume2/data/vpn-speed-tests/`. These directories don't exist yet on Volume 2 (separate from the cloned repo on Volume 1).

SSH into the NAS and run:
```bash
mkdir -p /volume2/data/vpn-speed-tests/snapshots
mkdir -p /volume2/data/vpn-speed-tests/report
mkdir -p /volume2/data/vpn-speed-tests/logs

cp /volume1/Docker/vpn-speed-tester/report/index.html /volume2/data/vpn-speed-tests/report/index.html
```

---

### Step 5 — Deploy the Docker stack

Run the deploy script from your Mac. It rsyncs the code (Step 2) and rebuilds the stack in one shot:

```bash
cd ~/repos/vpn-speed-tester
./deploy.sh
```

The first build takes ~30–60 seconds — it installs Python, pip, and speedtest-cli inside the image.

**Verify all three containers are running** (SSH into the NAS, or check Portainer at `http://10.1.10.254:9000`):
```bash
ssh nas
sudo docker ps
```

Expected — all three showing `Up`:
- `gluetun-speedtest` — shows `(healthy)` after ~45 seconds
- `speedtest-runner`
- `orchestrator`

---

---

> **Session checkpoint (2026-05-07):** Steps 1–5 are complete. The full qBittorrent auth and API chain is working end-to-end — see [documentation/qbittorrent-auth-debug.md](qbittorrent-auth-debug.md) for the complete resolution history. Key fixes: `env_file` added to docker-compose so credentials reach the container; v5.x API endpoint renames applied (`pause→stop`, `resume→start`, `filter=paused→filter=stopped`); force-start on resume scoped to only previously-downloading torrents.
>
> **Session checkpoint (2026-05-07, continued):** Three additional bugs found and fixed before first test run. (1) `waitForTunnel()` was polling `check.airservers.org` — an external URL that DNS-fails when gluetun is cycling. Fixed: now polls gluetun's internal control API at `http://gluetun-speedtest:8000/v1/vpn/status`, no DNS needed. (2) `runSpeedtest()` was running `speedtest-cli` directly in the orchestrator process (bypassing the VPN tunnel entirely). Fixed: now uses dockerode `exec` inside `speedtest-runner`, which shares gluetun's network namespace. (3) `speedtest-runner` loses its shared network namespace when gluetun is removed and recreated — fixed by restarting speedtest-runner inside `switchServer()` after the new gluetun starts. Also: `deploy.sh` updated to `docker compose down` before every rebuild, preventing orphaned container conflicts.
>
> Next session starts at Step 6.

---

### Step 6 — Run the first manual test

Use `./deploy.sh --test` from your Mac — it syncs, takes the stack down, rebuilds fresh, waits 40 seconds for `gluetun-speedtest` to become healthy, then triggers the test. When the test finishes, **the stack is automatically torn down**:

```bash
cd ~/repos/vpn-speed-tester
./deploy.sh --test
```

Or if the stack is already deployed and you just want to run the test without a rebuild:
```bash
ssh nas
sudo docker exec orchestrator npm run test:single
```

What you'll see:
- Orchestrator pauses qBittorrent
- Fetches current AirVPN server status
- Switches gluetun to a server (stop/remove/create cycle), restarts speedtest-runner to attach to new namespace
- Polls `http://gluetun-speedtest:8000/v1/vpn/status` until gluetun reports `"running"`
- Runs 3 speed tests on that server (exec'd inside speedtest-runner, traffic goes through VPN)
- Writes results to `results.json` and commits to git
- Resumes qBittorrent when done

The test window runs until `TEST_WINDOW_HOURS` (default: 2 hours) elapses or you stop it.

---

### Step 7 — Run the second manual test

Same as Step 6 — the queue builder picks up where it left off, prioritizing servers with the least coverage.

```bash
ssh nas
sudo docker exec orchestrator npm run test:single
```

---

### Step 8 — Verify results were written

```bash
# Check the results file exists
ls -lh /volume2/data/vpn-speed-tests/results.json

# Check git history of committed results
cd /volume2/data/vpn-speed-tests
git log --oneline
```

You should see commits like:
```
a1b2c3d data: Aladfar low session 001 — 3 runs complete
e4f5g6h chore: recalculate aggregates 2026-05-07
```

> **Note — Automatic Switching:** The `gluetunManager` currently cycles the VPN by stopping and recreating the gluetun container for each server. When automatic server switching is implemented this step may change. Revisit this section once that phase is complete.

---

## Getting Started to Automate Testing

This section covers enabling the scheduler, setting up a daily run, and adjusting or adding additional scheduled runs.

### How the scheduler works

The orchestrator runs two background jobs when started in scheduled mode (`npm run start`):

1. **Daily speed test window** — runs once per day at a configured hour, tests servers for up to 2 hours
2. **Hourly load snapshot** — runs every hour on the hour, captures load data for all 50 US servers

Both jobs start automatically when the container starts (Portainer keeps it running).

Key config values live in `orchestrator/config.js`:

| Key | Default | What it controls |
|---|---|---|
| `TEST_START_HOUR` | `3` | Hour (0–23) the daily test window starts |
| `TEST_WINDOW_HOURS` | `2` | How long the test window stays open |
| `RUNS_PER_SESSION` | `3` | Speed test runs per server session |

---

### Set up 1 run per day at a specific time

1. SSH into the NAS and open the config file:
   ```bash
   ssh nas  # or: ssh networkadmin@10.1.10.254 -p 8322
   nano /volume1/Docker/vpn-speed-tester/orchestrator/config.js
   ```

2. Change `TEST_START_HOUR` to your desired hour (24-hour format):
   ```js
   TEST_START_HOUR: 22,   // runs at 10 PM
   ```

3. Rebuild and redeploy via Portainer:
   - **Stacks** → `vpn-speed-tester` → **Pull and redeploy** (or stop/start the stack)

4. Confirm the schedule in the startup logs:
   ```bash
   docker logs orchestrator | head -30
   ```
   Look for a line like:
   ```
   [INFO ] cron registered: speed test window at hour 22
   ```

---

### Modify the schedule to change the time

Same process as above — edit `TEST_START_HOUR` in `orchestrator/config.js`, then redeploy. No other files need changing for a simple time shift.

---

### Add more runs on specific days of the week

Adding a second scheduled run (e.g., a weekend midday run in addition to the nightly run) requires editing the cron string directly in `orchestrator/scheduler.js`.

**Cron syntax quick reference:**
```
┌─ minute (0-59)
│  ┌─ hour (0-23)
│  │  ┌─ day of month (1-31, or * for any)
│  │  │  ┌─ month (1-12, or * for any)
│  │  │  │  ┌─ day of week (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)
│  │  │  │  │
0  3  *  *  *     → every day at 3 AM
0  12 *  *  6,0   → noon on Saturday and Sunday
0  3  *  *  1,3,5 → 3 AM on Monday, Wednesday, Friday
```

**How to add a run:**

1. Open `orchestrator/scheduler.js`:
   ```bash
   nano /volume1/Docker/vpn-speed-tester/orchestrator/scheduler.js
   ```

2. Find the existing speed test cron registration (around line 209). It looks like:
   ```js
   cron.schedule(`0 ${config.TEST_START_HOUR} * * *`, () => {
     scheduler.runSpeedTestWindow();
   });
   ```

3. Add a second `cron.schedule()` call below it for the additional run:
   ```js
   // Example: also run at noon on weekends
   cron.schedule('0 12 * * 6,0', () => {
     scheduler.runSpeedTestWindow();
   });
   ```

4. Redeploy via Portainer (stop/start or pull and redeploy)

5. Confirm both schedules appear in the startup logs

**Important:** Each scheduled window runs independently. If two windows overlap (one is still running when the next one would start), the second will begin anyway — qBittorrent will be paused/resumed for each. Plan run times to avoid overlap based on `TEST_WINDOW_HOURS`.

> **Note — Automatic Switching:** When the automatic server switching phase is implemented, the scheduler may be extended to support a continuous rotation mode. The `TEST_WINDOW_HOURS` config and how multiple scheduled runs interact will likely need to be reviewed and this section updated.

---

## How to Report Errors and Issues

Start by diagnosing yourself, then escalate with the right context attached.

### Self-diagnosis

#### 1. Check container health

```bash
docker ps
```

All three containers should show `Up`. If any shows `Exited` or `Restarting`:
```bash
docker-compose -f /volume1/Docker/vpn-speed-tester/docker-compose.yml logs --tail=50
```

#### 2. Find today's log file

Logs are written to a daily rotating file:
```
/volume2/data/vpn-speed-tests/logs/YYYY-MM-DD.log
```

Tail live (from SSH):
```bash
docker logs -f orchestrator
```

Read the file directly:
```bash
cat /volume2/data/vpn-speed-tests/logs/$(date +%F).log
```

#### 3. Filter for errors and warnings

```bash
grep -E "\[ERROR\]|\[WARN\]" /volume2/data/vpn-speed-tests/logs/$(date +%F).log
```

Errors are prefixed with a `[context]` tag that identifies where in the code the error occurred (e.g., `[qBittorrent pause]`, `[tunnel check]`, `[AirVPN status API]`). Use this to narrow down the cause quickly.

#### 4. Common error patterns

| What you see in the log | Likely cause | First step |
|---|---|---|
| `[context] ECONNREFUSED` | A service is down (qBittorrent, container) | `sudo docker ps` — which containers are running? |
| `[context] ENOTFOUND — DNS failure` | External DNS unreachable (not a tunnel check — those now use gluetun's internal API) | Check orchestrator's outbound network; check gluetun logs |
| `[context] ETIMEDOUT` | Network or service is overloaded | Wait a few minutes, then check again |
| `[context] 429 Rate Limited — retry-after: Xs` | AirVPN or speedtest API rate limit hit | Reduce test frequency; wait the retry-after period |
| `[context] Auth error (401/403)` | qBittorrent credentials wrong or empty | Check `QBT_PASSWORD` in `.env` — see [qbittorrent-auth-debug.md](qbittorrent-auth-debug.md) |
| `runSpeedtest: speedtest-cli exited 127` | speedtest-cli not found in container | Rebuild the Docker image |
| `waitForTunnel: attempt X (+Ys elapsed)...` then timeout | gluetun never reported `"running"` — tunnel not established | Check gluetun logs (`docker logs gluetun-speedtest`), verify WireGuard keys in `.env` |
| `SESSION ERROR [server-name]: ...` | One server test failed | Non-fatal — other servers continue; note which server failed |
| `gluetun-speedtest` shows `unhealthy` or exits at startup | Missing `WIREGUARD_ADDRESSES` in `.env`, or health checks firing before tunnel is up | Confirm `WIREGUARD_ADDRESSES=x.x.x.x/32` is set in `.env`; if present, wait 45–60 seconds for the tunnel to establish |
| `permission denied while trying to connect to the Docker daemon socket` | NAS user not in docker group | Prefix command with `sudo` |

#### 5. Check data integrity

If you're unsure whether results were saved correctly:
```bash
cd /volume2/data/vpn-speed-tests
git log --oneline
```

Each successful session produces a git commit. If the last commit is old, the test window may have failed before completing. The raw run data from completed runs is still versioned even if the session didn't fully close out.

---

### Escalating — What to include

When reporting an issue, gather the following before reaching out:

1. **The exact error line(s)** from the log, including:
   - The timestamp: `[2026-05-07T03:12:44.821Z]`
   - The level: `[ERROR]` or `[WARN]`
   - The context tag: e.g., `[qBittorrent pause]`
   - The full error message

2. **The date and approximate time** the problem occurred

3. **Container status at the time** — output of:
   ```bash
   docker ps
   ```

4. **The full log file for the affected day** — attach or paste the relevant section:
   ```bash
   # Copy to a file you can attach
   cp /volume2/data/vpn-speed-tests/logs/YYYY-MM-DD.log ~/Desktop/
   ```

5. **Gluetun logs** (if the error looks tunnel-related):
   ```bash
   docker logs gluetun-speedtest --tail=50
   ```

6. **Any recent changes** — config edits, container restarts, `.env` changes, new deployments

> **Note — Automatic Switching:** Once automatic server switching is implemented, error categories will expand. In particular, container recreation failures from the `gluetunManager` will become more frequent during long test windows. Revisit and extend this section after that phase is complete.
