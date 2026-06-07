# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Rule 5 — Use the model only for judgment calls
Use Claude for: classification, drafting, summarization, extraction from unstructured text.
Do NOT use Claude for: routing, retries, status-code handling, deterministic transforms.
If a status code already answers the question, plain code answers the question.

## Rule 6 — Token budgets are not advisory
Per-task budget: 4,000 tokens.
Per-session budget: 30,000 tokens.
If a task is approaching budget, summarize and start fresh. Do not push through.
Surfacing the breach > silently overrunning.

## Rule 7 — Surface conflicts, don't average them
If two existing patterns in the codebase contradict, don't blend them.
Pick one (the more recent / more tested), explain why, and flag the other for cleanup.
"Average" code that satisfies both rules is the worst code.

## Rule 8 — Read before you write
Before adding code in a file, read the file's exports, the immediate caller, and any obvious shared utilities.
If you don't understand why existing code is structured the way it is, ask before adding to it.
"Looks orthogonal to me" is the most dangerous phrase in this codebase.

## Rule 9 — Tests verify intent, not just behavior
Every test must encode WHY the behavior matters, not just WHAT it does.
A test like `expect(getUserName()).toBe('John')` is worthless if the function takes a hardcoded ID.
If you can't write a test that would fail when business logic changes, the function is wrong.

## Rule 10 — Checkpoint after every significant step
After completing each step in a multi-step task: summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back to me.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
If the codebase uses snake_case and you'd prefer camelCase: snake_case.
If the codebase uses class-based components and you'd prefer hooks: class-based.
Disagreement is a separate conversation. Inside the codebase, conformance > taste.
If you genuinely think the convention is harmful, surface it. Don't fork it silently.

## Rule 12 — Fail loud
If you can't be sure something worked, say so explicitly.
"Migration completed" is wrong if 30 records were skipped silently.
"Tests pass" is wrong if you skipped any.
"Feature works" is wrong if you didn't verify the edge case I asked about.
Default to surfacing uncertainty, not hiding it.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js orchestrator that runs nightly speed tests against AirVPN US WireGuard servers from an ASUSTOR AS5404T NAS running ADM 5.1.3. It cycles a single `gluetun` container through each server, runs `speedtest-cli` from a sibling container sharing gluetun's network namespace, and writes results to JSON files served by an nginx report container.

Live target: ASUSTOR NAS at `sysop@10.1.10.254:8322`, files at `/volume1/Docker/vpn-speed-tester/`, HTML report at `http://10.1.10.254:9191`. There is **no local dev loop** — the orchestrator must run on the NAS because it talks to the local docker socket, the gluetun control API, and a LAN qBittorrent instance.

## Commands

All workflows go through the single `./vpn` CLI at the repo root (run from your laptop). It sources shared NAS/SSH constants from `lib.sh`. See `./vpn help` for the full table.

- `./vpn deploy` — rsync repo to NAS, `docker compose down`, `up -d --build`. Reads `.env` and validates required vars. **This is the only way to "run" the code.**
- `./vpn deploy --check` (or `./vpn check`) — show live container status on the NAS, no deploy.
- `./vpn report` — rsync `report/index.html` from the NAS and open it in the browser. `./vpn local` syncs NAS data to `.local-staging/` and serves it on :9191.
- `./vpn test` — trigger one manual speed-test window now (`docker exec orchestrator node main.js --manual`). `./vpn test --infinite` loops servers continuously.
- `./vpn logs` / `./vpn servers` — tail today's log / list the gluetun-accepted server names.
- `./vpn rebuild` — reconstruct `results.json` from raw data (`node rebuildResults.js`).
- `./vpn fetch` — read-only pull of NAS data into `analysis/nas-data/` for offline analysis (`--with-logs` also pulls logs).
- `./vpn advise [--current X]` — run the load-aware **switch advisor** once against live AirVPN status; prints a stay/switch recommendation (recommend-only, touches nothing). Runs locally; no `.env` needed.
- `./vpn dashboard` — read-only summary of the desktop validation loop (decision accuracy, per-server prediction bias, coverage, live load→speed curves).

A browser control panel over this CLI is available locally via `./vpn-ui` (serves `vpn-ui.html` on 127.0.0.1:9192).

Inside the orchestrator container (rarely needed directly — `docker exec orchestrator ...`):
- `npm start` — scheduled cron mode (the default Docker CMD).
- `npm run test:single` — `node main.js --manual`, runs one speed-test window immediately and exits.
- `npm run test:infinite` — `node main.js --infinite`, loops servers continuously (resets coverage when all tiers are filled).

No linter is configured. The legacy NAS modules have no tests, but the Phase-2 advisor/validation
modules do: plain `node:assert` files run directly (`node orchestrator/switchAdvisor.test.js`,
`orchestrator/validationLoop.test.js`, `analysis/buildModel.test.js`, `analysis/validationReport.test.js`
— ~75 tests). `orchestrator/test-qbt-pause.js` is a one-off probe script, not a test suite.

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
   - Run `speedtest-cli --json --secure` inside speedtest-runner three times, 10 s apart ([speedTester.js](orchestrator/speedTester.js)).
   - Append raw output to `raw-results.json` and `server-data.json` ([rawDataWriter.js](orchestrator/rawDataWriter.js)); aggregated `results.json` is recomputed by [aggregator.js](orchestrator/aggregator.js) / [resultsWriter.js](orchestrator/resultsWriter.js).
3. Stop gluetun + speedtest-runner; resume qBittorrent.

Also registered: `cron.schedule('30 * * * *', writeHourlySnapshot)` ([snapshotWriter.js](orchestrator/snapshotWriter.js)) to capture AirVPN status hourly into `data/snapshots/`.

### Failure handling subtleties

- **Tunnel failures** (`gluetun-speedtest exited`, `Tunnel failed after N attempts`, container 404) are treated as *transient*: log a SESSION SKIP and continue to the next server. They do **not** increment `consecutiveFailures`.
- **Other errors** increment `consecutiveFailures`. After 5 (`MAX_CONSECUTIVE_FAILURES`), or on a `network namespace` 500 from the docker socket, the whole window aborts via `break`.
- Tunnel polling: `waitForTunnel` inspects the gluetun container first — if it has exited, fail fast rather than waiting for the 180 s HTTP timeout.

### Data files (on NAS at `/volume1/Docker/vpn-speed-tester/data/`)

- `results.json` — flat array of session records (`{ server_name, tier, timestamp, run_count }`). This is what the report renders.
- `raw-results.json` — every individual `speedtest-cli` JSON keyed by `{timestamp}_{run}-{total}`.
- `server-data.json` — AirVPN status snapshot at the moment each session began.
- `snapshots/` — hourly AirVPN status dumps.
- `logs/YYYY-MM-DD.log` — daily orchestrator logs ([logger.js](orchestrator/logger.js)).

### Phase 2 — switch advisor + desktop validation loop (branch `feat/switch-advisor`)

A load-aware **switch advisor** decides stay-vs-switch for the media-stack VPN, recommend-only:
- [orchestrator/switchAdvisor.js](orchestrator/switchAdvisor.js) — pure `expectedBandwidth()` + `recommend()` (three zones: stay / check-for-better / must-jump; fail-safe to stay). Consumes the "cheat sheet" [analysis/server-model.json](analysis/server-model.json), built by [analysis/buildModel.js](analysis/buildModel.js) from `analysis/nas-data/`.
- [orchestrator/adviseJob.js](orchestrator/adviseJob.js) — the `./vpn advise` runner (Node `fetch`; no config/.env dependency).

A continuous **self-validation loop** grades the advisor against real speed tests, on a **Colima desktop runtime** (not the NAS): [docker-compose.desktop.yml](docker-compose.desktop.yml) runs an `orchestrator` container executing [orchestrator/validationMain.js](orchestrator/validationMain.js), which **reuses** `gluetunManager.switchServer`/`waitForTunnel` + `speedTester.runSpeedtest`. Pure loop logic + scoring + top-10 coverage rotation live in [orchestrator/validationLoop.js](orchestrator/validationLoop.js); [orchestrator/estTime.js](orchestrator/estTime.js) is the shared EST-timestamp helper (also used by scheduler.js). Each pass writes the decision log (`validation-log.jsonl`) **and** canonical `raw-results.json`/`server-data.json` into the desktop `/data`, so `buildModel.js` + the report can consume the desktop measurements. `./vpn dashboard` ([analysis/validationReport.js](analysis/validationReport.js)) summarizes it. Full design: [documentation/desktop-validation-loop.md](documentation/desktop-validation-loop.md). `config.js` `GLUETUN_CONTROL_URL`/`GLUETUN_SERVERS_URL`/container names are env-overridable for this local-vs-NAS reuse.

## Env vars (`.env`)

Required — `./vpn deploy` validates these and refuses to deploy if any are missing or contain a `<placeholder>`:

- `WIREGUARD_PRIVATE_KEY`, `WIREGUARD_PRESHARED_KEY`, `WIREGUARD_ADDRESSES` — from AirVPN config generator.
- `QBT_BASE_URL`, `QBT_USERNAME`, `QBT_PASSWORD` — LAN qBittorrent WebUI, used to pause/resume around the test window.
- `SYSOP_SSH` — NAS sudo password, piped into `sudo -S` over SSH by `./vpn deploy`.

Secrets with `$` in them must be single-quoted in `.env`. See [memory/feedback_env_password_quoting](../../../.claude/projects/-Users-impulse-repos-live-apps-NAS-vpn-speed-tester-vpn-speed-tester/memory/feedback_env_password_quoting.md) — past pain point.

## Conventions worth knowing

- **Timestamps in session IDs are EST (`America/New_York`)** formatted `YYYYMMDDHHMMSS`. This is intentional and matched by the report; don't switch to UTC.
- All log lines route through `logger.fn(__filename, 'name', args)` at the start of every meaningful function — this is how the daily log files become traceable. Mirror the pattern in new functions.
- `gluetunManager.js` is the only module that should ever talk to docker for container lifecycle. Other modules that need to exec (`speedTester.js`) only use `docker.exec` against the existing speedtest-runner.
- The report is a single hand-written HTML file — no build step. Edit [report/index.html](report/index.html) directly, then `./vpn deploy` rsyncs it to the NAS where nginx serves it.
- Pre-existing inline comments containing log snippets (e.g. top of [speedTester.js](orchestrator/speedTester.js)) document past incidents — leave them unless you're fixing the underlying issue they describe.

## Reference docs

Deeper specs live in [documentation/](documentation/): `vpn-speed-tester-spec.md` (full spec), `front-end-reporting.md` (report internals), `project-files.md`, `roadmap-working.md`, `get-started-keep-going.md`. Read these before large changes.

Two more folders worth knowing:
- [documentation/this-is-my-mess/](documentation/this-is-my-mess/) — the laptop/desktop/NAS git-divergence investigation (handoff, findings, byte-comparison, salvage notes). See its `README.md` for the story.
- [media-stack/](media-stack/) — seeds for the parallel/next project this speed-tester was built to serve (the media-stack control panel). Not wired into this repo's stack.
