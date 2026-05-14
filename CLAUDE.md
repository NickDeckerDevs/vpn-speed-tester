# CLAUDE.md

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js orchestrator that runs nightly speed tests against AirVPN US WireGuard servers from a Synology NAS. It cycles a single `gluetun` container through each server, runs `speedtest-cli` from a sibling container sharing gluetun's network namespace, and writes results to JSON files served by an nginx report container.

Live target: Synology NAS at `sysop@10.1.10.254:8322`, files at `/volume1/Docker/vpn-speed-tester/`, HTML report at `http://10.1.10.254:9191`. There is **no local dev loop** — the orchestrator must run on the NAS because it talks to the local docker socket, the gluetun control API, and a LAN qBittorrent instance.

## Commands

All workflows go through these shell scripts at the repo root (run from your laptop):

- `./deploy.sh` — rsync repo to NAS, `docker compose down`, `up -d --build`. Reads `.env` and validates required vars. **This is the only way to "run" the code.**
- `./deploy.sh --check` — show live container status on the NAS, no deploy.
- `./view-data.sh [report|summary|servers|json|logs|sync]` — pull report/data from NAS. `report` (default) opens `report/index.html` in browser.
- `./view-report.sh` — shortcut for `view-data.sh report`.
- `./export-summary.sh` — generate a summary export.

Inside the orchestrator container (rarely needed directly — `docker exec orchestrator ...`):
- `npm start` — scheduled cron mode (the default Docker CMD).
- `npm run test:single` — `node main.js --manual`, runs one speed-test window immediately and exits.
- `npm run test:infinite` — `node infiniteRunner.js`, loops servers continuously (resets coverage when all tiers are filled).

There are **no unit tests and no linter** configured. `orchestrator/test-qbt-pause.js` is a one-off probe script, not a test suite.

## Architecture

Four containers defined in [docker-compose.yml](docker-compose.yml), all on the `vpn-speedtest` bridge network:

1. **`gluetun-speedtest`** — qmcgaw/gluetun WireGuard tunnel. `SERVER_NAMES` env is the *only* knob that selects which AirVPN server; the orchestrator rewrites this env and recreates the container on every server switch.
2. **`speedtest-runner`** — node-slim image with `speedtest-cli`. Started with `network_mode: service:gluetun-speedtest` so its traffic egresses through the VPN. The compose file starts it with `sleep infinity` as a placeholder; the orchestrator destroys and recreates it pinned to the *current* gluetun container ID after each switch.
3. **`orchestrator`** — same image as speedtest-runner, but runs `node main.js`. Mounts `/var/run/docker.sock` to drive the other two containers via dockerode. **Not on the VPN network** — it stays on the bridge so it can hit the gluetun control API at `http://gluetun-speedtest:8000` and the qBittorrent WebUI at `QBT_BASE_URL` (LAN).
4. **`vpn-report`** — nginx serving `/volume1/Docker/vpn-speed-tester/data` as static files on port 9191. The single-file SPA is [report/index.html](report/index.html); it `fetch`es `results.json`, `raw-results.json`, `server-data.json` from the same origin.

### Core control flow

[orchestrator/scheduler.js](orchestrator/scheduler.js) is the entry point logic. `runSpeedTestWindow()` runs daily at `TEST_START_HOUR` (3 AM) for `TEST_WINDOW_HOURS` (2 hours):

1. Pause qBittorrent ([qbtClient.js](orchestrator/qbtClient.js)) so it isn't competing for bandwidth.
2. Loop until window expires or coverage is complete:
   - Fetch live AirVPN US server list from `https://airvpn.org/api/status` ([airvpnStatus.js](orchestrator/airvpnStatus.js)) — also classifies each server into `low`/`medium`/`high`/`diablo` by current load (thresholds in [config.js](orchestrator/config.js)).
   - Pick a server via [queueBuilder.js](orchestrator/queueBuilder.js): prefer servers missing coverage in their current tier, then fewest total sessions, then oldest last-tested.
   - `switchServer(name)` ([gluetunManager.js](orchestrator/gluetunManager.js)): tear down speedtest-runner → tear down gluetun → recreate gluetun with new `SERVER_NAMES` → poll gluetun control API until tunnel is up (`waitForTunnel`, up to 3 retries) → recreate speedtest-runner with `NetworkMode: container:<new-gluetun-id>`.
   - Run `speedtest-cli --json --secure` inside speedtest-runner three times, 15 s apart ([speedTester.js](orchestrator/speedTester.js)).
   - Append raw output to `raw-results.json` and `server-data.json` ([rawDataWriter.js](orchestrator/rawDataWriter.js)); aggregated `results.json` is recomputed by [aggregator.js](orchestrator/aggregator.js) / [resultsWriter.js](orchestrator/resultsWriter.js).
3. Stop gluetun + speedtest-runner; resume qBittorrent.

Also registered: `cron.schedule('30 * * * *', writeHourlySnapshot)` ([snapshotWriter.js](orchestrator/snapshotWriter.js)) to capture AirVPN status hourly into `data/snapshots/`.

### Failure handling subtleties

- **Tunnel failures** (`gluetun-speedtest exited`, `Tunnel failed after N attempts`, container 404) are treated as *transient*: log a SESSION SKIP and continue to the next server. They do **not** increment `consecutiveFailures`.
- **Other errors** increment `consecutiveFailures`. After 2, or on a `network namespace` 500 from the docker socket, the whole window aborts via `break`.
- Tunnel polling: `waitForTunnel` inspects the gluetun container first — if it has exited, fail fast rather than waiting for the 180 s HTTP timeout.

### Data files (on NAS at `/volume1/Docker/vpn-speed-tester/data/`)

- `results.json` — aggregated, per-server, per-tier sessions with averages. This is what the report renders.
- `raw-results.json` — every individual `speedtest-cli` JSON keyed by `{timestamp}_{run}-{total}`.
- `server-data.json` — AirVPN status snapshot at the moment each session began.
- `snapshots/` — hourly AirVPN status dumps.
- `logs/YYYY-MM-DD.log` — daily orchestrator logs ([logger.js](orchestrator/logger.js)).

## Env vars (`.env`)

Required — `deploy.sh` validates these and refuses to deploy if any are missing or contain a `<placeholder>`:

- `WIREGUARD_PRIVATE_KEY`, `WIREGUARD_PRESHARED_KEY`, `WIREGUARD_ADDRESSES` — from AirVPN config generator.
- `QBT_BASE_URL`, `QBT_USERNAME`, `QBT_PASSWORD` — LAN qBittorrent WebUI, used to pause/resume around the test window.
- `SYSOP_SSH` — NAS sudo password, piped into `sudo -S` over SSH by `deploy.sh`.

Secrets with `$` in them must be single-quoted in `.env`. See [memory/feedback_env_password_quoting](../../../.claude/projects/-Users-impulse-repos-live-apps-NAS-vpn-speed-tester-vpn-speed-tester/memory/feedback_env_password_quoting.md) — past pain point.

## Conventions worth knowing

- **Timestamps in session IDs are EST (`America/New_York`)** formatted `YYYYMMDDHHMMSS`. This is intentional and matched by the report; don't switch to UTC.
- All log lines route through `logger.fn(__filename, 'name', args)` at the start of every meaningful function — this is how the daily log files become traceable. Mirror the pattern in new functions.
- `gluetunManager.js` is the only module that should ever talk to docker for container lifecycle. Other modules that need to exec (`speedTester.js`) only use `docker.exec` against the existing speedtest-runner.
- The report is a single hand-written HTML file — no build step. Edit [report/index.html](report/index.html) directly, then `./deploy.sh` rsyncs it to `data/report/` on the NAS where nginx serves it.
- Pre-existing inline comments containing log snippets (e.g. top of [speedTester.js](orchestrator/speedTester.js)) document past incidents — leave them unless you're fixing the underlying issue they describe.

## Reference docs

Deeper specs live in [documentation/](documentation/): `vpn-speed-tester-spec.md` (full spec), `front-end-reporting.md` (report internals), `project-files.md`, `roadmap-working.md`, `get-started-keep-going.md`. Read these before large changes.
