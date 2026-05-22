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

---

# Project-specific guidance

## What this is

Node.js orchestrator that systematically speed-tests every healthy AirVPN US WireGuard server, stratified by live load tier, so production VPN selection can later be informed by real throughput data. The stack runs on a Synology NAS (`sysop@10.1.10.254:8322`) in Docker, isolated from the production media stack (Gluetun/qBittorrent/Radarr/Sonarr/Jellyfin) which must never be disrupted.

## Common commands

All `.sh` scripts run from the Mac, not the NAS — they SSH in.

| Command | What it does |
|---|---|
| `./deploy.sh` | Validate `.env` → rsync repo to NAS → tear down old stack → `docker compose up -d --build` → verify. End-to-end deploy. |
| `./deploy.sh --check` | Show live container status on NAS, no deploy. |
| `./deployAndTestOne.sh` | Deploy, then `docker exec orchestrator npm run test:single` and stream output. Fastest end-to-end smoke. |
| `./view-report.sh` | rsync `report/` back from NAS and open in browser. |
| `npm run start` | (inside `orchestrator/`) Scheduled mode — cron-driven. Default container CMD. |
| `npm run test:single` | One full session (switch → 3 runs → write → teardown), then exit. |
| `npm run test:infinite` | Loop forever; when coverage is reached, wipe `results.json` and start over. |

There is no test suite, no linter, no build step. Verification is observational: run `test:single` and read `data/logs/<date>.log` on the NAS.

## Architecture

### Four containers ([docker-compose.yml](docker-compose.yml))

1. **`gluetun-speedtest`** — VPN tunnel; ephemeral, recreated for every server switch (gluetun does not support changing `SERVER_NAMES` on a running container).
2. **`speedtest-runner`** — `sleep infinity` container that shares gluetun's network namespace (`network_mode: service:gluetun-speedtest`). The orchestrator `docker exec`s `speedtest-cli` into it.
3. **`orchestrator`** — long-lived `node:20-slim` container; mounts the host Docker socket so it can recreate the other two.
4. **`report-server`** — nginx serving `/data/` on `:9191` (static HTML in `report/index.html` fetches `results.json` / `snapshots/index.json` at runtime).

### Orchestrator flow ([runner.js](orchestrator/runner.js))

Three modes via `main.js` flags: `WINDOW` (default, scheduled — runs until `TEST_WINDOW_HOURS` elapses), `SINGLE`, `INFINITE`.

```
pre-flight: pauseAll() qBittorrent  (try/catch — never aborts on qBT failure)
            loadResults()
            captureBaseConfig()      ← snapshots gluetun + speedtest container specs
loop:
  fetchUSServers()                   ← AirVPN status API → tier-classify by currentload
  pickNextServer()                   ← prefers missing tier coverage, then fewest sessions, then oldest
  switchServer(name)                 ← teardown speedtest → teardown gluetun → createContainer(gluetun w/ new SERVER_NAMES) → waitForTunnel → createContainer(speedtest)
  verifyTestContainersRunning()
  appendServerData(timestamp, server)
  for runNum in 1..RUNS_PER_SESSION (3):
    runSpeedtest()                   ← docker exec speedtest-cli --json --secure
    appendRawResult(key, raw)
  results.push({server_name, tier, timestamp, run_count}); writeResults()
  tearDownSpeedTestingContainers()   ← in finally{}; runs even on session error
shutdown (finally):
  tearDownSpeedTestingContainers()
  restoreBaseContainers()            ← re-creates gluetun + speedtest from the captured config
  resumeAll() qBittorrent            ← only previously-downloading torrents get setForceStart
```

[scheduler.js](orchestrator/scheduler.js) registers two crons: speed-test window at `0 ${TEST_START_HOUR} * * *` (3 AM daily) and snapshot at `30 * * * *` (every hour at :30 — intentionally staggered off :00 to survive orchestrator restarts).

### Container ↔ host path translation

[config.js](orchestrator/config.js) paths use the **container** mount point `/data/` (e.g. `RESULTS_PATH: '/data/results.json'`). On the NAS, that maps to `/volume1/Docker/vpn-speed-tester/data/`. The bind is defined once in `docker-compose.yml` and exported as `config.DATA_BIND` so `gluetunManager` can recreate `speedtest-runner` with the same mount.

### Data layout (mounted at `/data/` in containers)

- `results.json` — flat array of completed sessions `{server_name, tier, timestamp, run_count}`. Coverage tracker used by `queueBuilder`.
- `raw-results.json` — keyed by `${timestamp}_${runNum}-${total}`, full speedtest-cli JSON.
- `server-data.json` — keyed by timestamp, the AirVPN status row snapshotted at session start.
- `snapshots/YYYY-MM-DD-HH.json` + `snapshots/index.json` (manifest so the static report can enumerate without a directory-listing server).
- `logs/YYYY-MM-DD.log` — appended by `logger.js` on every log call (also stdout).

`resultsWriter.writeResults` is atomic (tmp → move). Both `resultsWriter` and `snapshotWriter` commit to a git repo rooted at `/data/` (`GIT_REPO_PATH`); `ensureGitRepo()` initializes on first use.

## Things that will trip you up

- **Gluetun cycle is stop → remove → create → start, every switch.** Do not try to update env on a running container; gluetun won't pick it up. See [gluetunManager.js](orchestrator/gluetunManager.js) `switchServer()`.
- **`waitForTunnel` polls `http://gluetun-speedtest:8000/v1/vpn/status`** with a 6 s warm-up sleep before the first poll (otherwise the first attempt always logs ECONNREFUSED). Container exit during polling is detected via `inspect()` and surfaced as `gluetun-speedtest exited (...)`, which `runner.js` treats as a *skip*, not a session failure.
- **`speedtest-runner` shares gluetun's netns**, so it must be recreated *after* gluetun comes up. If gluetun dies mid-run, the runner becomes a zombie attached to a dead namespace — `verifyTestContainersRunning()` is the guard.
- **Consecutive-failure circuit breaker:** non-tunnel errors increment `consecutiveFailures`; at `MAX_CONSECUTIVE_FAILURES` (3) or any `network namespace` 500, the whole window aborts. Tunnel failures don't count.
- **qBittorrent (v5.x) uses `stop`/`start`, not `pause`/`resume`,** and filter=`stopped`, not `paused`. Pause is best-effort (wrapped in try/catch in `runner.js`) so a qBT outage never blocks a test window. On resume, only the hashes snapshotted as `downloading` get `setForceStart=true` — completed/seeding torrents are left alone.
- **`captureBaseConfig()` must run before the first `switchServer()`** to capture gluetun/speedtest specs for later re-creation. `runner.js` calls it in pre-flight; new entry points must too.
- **`runSpeedtest()` is async; you must `await` it.** A historical bug wrote null speed data because the Promise was stored verbatim.
- **Don't add Python.** `speedtest-cli` is installed via pip into the Docker image but is only ever invoked via `docker exec`. All orchestration code is Node.

## Conventions

- `logger.fn(__filename, 'fnName', argsObj)` at the top of every non-trivial function — the log file is the primary debugging surface.
- `logger.info`/`warn`/`error` go to stdout *and* `/data/logs/<date>.log`. `logger.debug` is gated by `LOG_LEVEL=debug` env var.
- No tests, no types, no lint. CommonJS (`require`, `module.exports`) throughout — do not introduce ESM.