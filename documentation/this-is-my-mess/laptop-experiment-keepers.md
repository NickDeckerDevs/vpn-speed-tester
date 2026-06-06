# Laptop Experiment — Keepers

**Purpose:** This laptop holds an undeployed refactor that diverged from the deployed
desktop/GitHub version (`origin/master`). The desktop/origin copy is the source of truth (it has
**server-filtering**, which the laptop lacks, and is what's actually running on the NAS). Before
the laptop is reset to match origin, this note records the three improvements made here so they can
be **re-ported on top of origin later**. The experiment itself is preserved on the
`laptop-experiment` branch — this note is the human-readable map of what's worth salvaging.

> Status when written (2026-06-05): laptop was ahead 5 / behind 11 vs `origin/master`.
> Diff scope: `orchestrator/` — 174 insertions, 524 deletions across config, gluetunManager,
> infiniteRunner (deleted), main, package.json, scheduler.

## The three keepers

### 1. One run-function instead of two
The laptop replaced origin's `infiniteRunner.js` (93 lines) + `scheduler.runSpeedTestWindow()`
(~280 lines of scheduler logic) with a single `orchestrator/runner.js`:

- `MODES = { WINDOW: 'window', SINGLE: 'single', INFINITE: 'infinite' }`
- `async function run({ mode = MODES.WINDOW } = {})` — one loop, mode switch controls
  window-end / single-break / infinite-restart behavior.
- `module.exports = { run, MODES }`.

On origin, scheduler.js carried the window loop; here scheduler.js is reduced to cron registration
only (diff shows it dropping from ~281 lines to a thin wrapper).

### 2. Sturdier container handling
Laptop `gluetunManager.js` (the biggest diff — 264 lines reworked) adds:

- `waitForContainerRemoved()` — waits and confirms the old container is fully gone before creating
  the new one, preventing "name already in use" crashes on server switch.
- `tearDownDockerContainer()` — shared teardown helper.
- `logContainerStatus()` / `logDockerError()` — clearer failure logging.
- Renames: `ensureSpeedtestRunner → verifyTestContainersRunning`,
  `tearDownTestContainers → tearDownSpeedTestingContainers`.

### 3. Cleaner command flags
Laptop `main.js` (19-line diff) tidies the startup dispatch into `--single` / `--infinite`
(mapping to `run({ mode })`).

## Must NOT lose from origin when porting

The laptop is **missing** these — do not let the port regress them:

- **Server-filtering:** `accepted-servers.json` / `unreachable-servers.json`,
  `getAcceptedServers()` in `gluetunManager.js`, and config keys `ACCEPTED_SERVERS_PATH` /
  `UNREACHABLE_SERVERS_PATH`. (Laptop trimmed config.js by 37 lines — these are part of what went.)
- **`rebuildResults.js`** (origin-only utility).
- **`GLUETUN_SERVERS_URL`** config.
- **`MAX_CONSECUTIVE_FAILURES`** — origin uses **5**; laptop set it to **3**. Keep origin's 5.

## How to recover the actual code

The full experiment lives on the `laptop-experiment` branch. To review the real diffs:

```sh
git diff master..laptop-experiment -- orchestrator/runner.js \
  orchestrator/gluetunManager.js orchestrator/main.js orchestrator/scheduler.js \
  orchestrator/config.js
```

(`orchestrator/runner.js` is new on that branch; `infiniteRunner.js` is deleted there.)
