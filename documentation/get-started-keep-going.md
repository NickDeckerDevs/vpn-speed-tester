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
git remote add origin <your-github-repo-url>   # skip if already linked
git push -u origin main
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

### Step 2 — Clone the repository onto the NAS

```bash
ssh nas  # or: ssh networkadmin@10.1.10.254 -p 8322 from desktop
cd /volume1/Docker/
git clone <your-github-repo-url> vpn-speed-tester
cd vpn-speed-tester
```

---

### Step 3 — Configure WireGuard credentials

The stack needs two WireGuard keys from your AirVPN account.

**Get the keys from AirVPN:**
1. Log into `airvpn.org` → **Client Area** → **Config Generator**
2. Select WireGuard, choose a US server, and download the config file
3. Open the `.conf` file — you need `PrivateKey` and `PresharedKey`

**Set up the `.env` file on the NAS:**
```bash
# From inside /volume1/Docker/vpn-speed-tester
cp .env.example .env
nano .env
```

Fill in the two values:
```
WIREGUARD_PRIVATE_KEY=<your-private-key>
WIREGUARD_PRESHARED_KEY=<your-preshared-key>
```

> **Never commit `.env` to git.** It is already in `.gitignore`.

---

### Step 4 — Deploy the Docker stack via Portainer

Portainer is the confirmed deployment method for this NAS. The docker-compose CLI may also work, but has not been verified.

1. Open Portainer in your browser: `http://10.1.10.254:9000`
2. Go to **Stacks** → **Add stack**
3. Name the stack: `vpn-speed-tester`
4. Under **Build method**, select **Repository**
5. Enter:
   - Repository URL: your GitHub repo URL
   - Branch: `main`
   - Compose file path: `docker-compose.yml`
6. Scroll down to **Environment variables** and add both keys:
   - `WIREGUARD_PRIVATE_KEY` = your private key
   - `WIREGUARD_PRESHARED_KEY` = your preshared key
7. Click **Deploy the stack**

**Verify all three containers are running** in the Portainer container list:
- `gluetun-test` — Up
- `orchestrator` — Up
- `speedtest-runner` — Up

---

### Step 5 — Run the first manual test

A manual test triggers one full speed test window immediately (no waiting for the scheduler).

```bash
# From the NAS terminal (SSH in first)
docker exec orchestrator npm run test:single
```

Watch the logs in real-time in a second terminal:
```bash
docker logs -f orchestrator
```

What you'll see:
- Orchestrator pauses qBittorrent
- Fetches current AirVPN server status
- Connects to a server via gluetun, waits for the VPN tunnel
- Runs 3 speed tests on that server
- Writes results to `results.json` and commits to git
- Resumes qBittorrent when done

The test window runs until `TEST_WINDOW_HOURS` (default: 2 hours) elapses or you stop it.

---

### Step 6 — Run the second manual test

Same command. The queue builder picks up where it left off, prioritizing servers and tiers with the least coverage so far.

```bash
docker exec orchestrator npm run test:single
```

---

### Step 7 — Verify results were written

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
| `[context] ECONNREFUSED` | A service is down (qBittorrent, container) | `docker ps` — which containers are running? |
| `[context] ENOTFOUND — DNS failure` | VPN tunnel is not up | Check gluetun container logs |
| `[context] ETIMEDOUT` | Network or service is overloaded | Wait a few minutes, then check again |
| `[context] 429 Rate Limited — retry-after: Xs` | AirVPN or speedtest API rate limit hit | Reduce test frequency; wait the retry-after period |
| `[context] Auth error (401/403)` | Credentials are wrong or expired | Verify `.env` WireGuard keys; check qBittorrent auth settings |
| `runSpeedtest: speedtest-cli exited 127` | speedtest-cli not found in container | Rebuild the Docker image |
| `waitForTunnel: attempt X (+Ys elapsed)...` then timeout | VPN tunnel never established | Check gluetun logs, verify WireGuard keys in `.env` |
| `SESSION ERROR [server-name]: ...` | One server test failed | Non-fatal — other servers continue; note which server failed |

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
   docker logs gluetun-test --tail=50
   ```

6. **Any recent changes** — config edits, container restarts, `.env` changes, new deployments

> **Note — Automatic Switching:** Once automatic server switching is implemented, error categories will expand. In particular, container recreation failures from the `gluetunManager` will become more frequent during long test windows. Revisit and extend this section after that phase is complete.
