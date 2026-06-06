# Orchestrator Comparison — NAS vs `master` (origin) vs `laptop-experiment`

**Date:** 2026-06-05
**Method:** byte-level (`git hash-object`) comparison of the live NAS clone
(`nas-clone/orchestrator/`) against the committed `master` (= `origin/master`) and the
`laptop-experiment` branch, plus content greps for distinguishing features. The NAS was pulled
read-only on 2026-06-05; its last data write was 2026-06-01/02, so this reflects the build that ran
the full collection campaign.

---

## Top takeaways

1. **The NAS is a desktop-lineage build that nobody fully committed.** It runs the
   `scheduler` + `infiniteRunner` two-file architecture (not the laptop's single `runner.js`),
   `MAX_CONSECUTIVE_FAILURES = 5`, and the full server-filtering feature set. This is "the thing
   that was running so well."
2. **The NAS is *ahead* of committed `origin/master`, not behind it.** Its `config.js` (113 lines)
   contains a hardcoded `GLUETUN_ACCEPTED_AIRVPN_SERVERS` list (~33 lines) and a `rebuildResults.js`
   utility that **exist nowhere in git** — uncommitted desktop work that was deployed but never
   pushed.
3. **`origin/master` is NOT a safe redeploy source.** Its `getAcceptedServers()` is the *old
   dynamic-fetch* approach the desktop already abandoned (the NAS code comments say that path
   "requires an API key and can't be whitelisted"). The NAS replaced it with a working hardcoded
   list. Deploying `master` as-is would regress the server-filtering the running system depends on.
4. **A "laptop" file is present on the NAS but has no caller we can find.** `runner.js` on the NAS is
   byte-identical to `laptop-experiment`, and nothing in `orchestrator/`, the `vpn`/`vpn-ui` tooling,
   or the root scripts `require`s or invokes it. **That is NOT proof it is unused** — manual
   `docker exec` or the browser UI could call it in ways static analysis can't see. Treat it as
   "no caller found," not "dead," and **do not delete it.**
5. **The NAS carries a whole operational layer that exists nowhere in git** — `vpn` (a full bash CLI:
   start/stop/test/logs/rebuild/servers), `vpn-ui` (a Node browser control panel), and `vpn-ui.html`.
   These were driven **manually** while watching tests, and they invoke orchestrator code *outside*
   `require()` (e.g. `vpn` runs `node rebuildResults.js` and `node main.js --manual/--infinite`).
   Any "is X used?" question must consult this layer, not just `require()` graphs.
6. **This confirms the drift theory exactly:** the NAS is an append-only pile mixing committed
   desktop code + uncommitted desktop code + manually-driven tooling, with no single git commit
   describing it. **Assume nothing about what is or isn't used.**

---

## Per-file provenance

`= master` / `= laptop` means byte-identical. "differs" means distinct from both.

| File | vs `master` | vs `laptop` | Verdict |
|---|---|---|---|
| aggregator, airvpnStatus, Dockerfile, httpClient, logger, qbtClient, rawDataWriter, resultsWriter, snapshotWriter, speedTester, test-qbt-pause, package-lock | `= master` | `= laptop` | Stable — identical everywhere |
| package.json | `= master` | `= laptop` | Stable |
| **config.js** | differs (NAS 113 / master 68) | differs (laptop 37) | **NAS = master + uncommitted hardcoded server list** |
| **gluetunManager.js** | differs (NAS 330 / master 344) | differs (laptop 388) | Desktop lineage; **lacks laptop's hardening** |
| **scheduler.js** | differs (NAS 302 / master 298) | differs (laptop 23) | Desktop full scheduler, slightly evolved |
| **main.js** | differs (NAS 25 / master 17) | differs (laptop 22) | Desktop dispatch + `--infinite` flag |
| **queueBuilder.js** | differs (NAS 49 / master 44) | differs (laptop 44) | Slightly evolved on NAS |
| **infiniteRunner.js** | differs (NAS 88 / master 93) | absent on laptop | Desktop file, NAS version slightly older/tweaked |
| **runner.js** | absent on master | **`= laptop` (181 lines)** | **Laptop file present; no caller found (NOT proven unused — do not delete)** |
| **rebuildResults.js** | absent on master | absent on laptop | **NAS-only, not in git; actively invoked by `vpn` (`node rebuildResults.js`)** |

## What is referenced via the scheduled entry point (static trace only)

> Caveat: this traces only the scheduled `main.js` → `scheduler` chain and `require()` edges. It does
> NOT capture what the manually-driven `vpn`/`vpn-ui` layer or ad-hoc `docker exec` calls invoke.
> "Not in this chain" ≠ "unused."

Entry chain: `main.js` → `scheduler.runSpeedTestWindow()` / `scheduler.start()` →
`scheduler.js` `require('./infiniteRunner')`. So the **desktop two-file architecture is live**:

- `scheduler.js` (full ~302-line version) + `infiniteRunner.js` — the window/infinite loop.
- `gluetunManager.js` with `ensureSpeedtestRunner` / `tearDownTestContainers` (the **old** names) and
  **no** `waitForContainerRemoved` — i.e. *without* the laptop's sturdier teardown.
- `MAX_CONSECUTIVE_FAILURES = 5`.
- Server-filtering: `getAcceptedServers()` returning `new Set(config.GLUETUN_ACCEPTED_AIRVPN_SERVERS)`
  (the hardcoded list), `ACCEPTED_SERVERS_PATH`, `UNREACHABLE_SERVERS_PATH`, `GLUETUN_SERVERS_URL`.

## Uncommitted code on the NAS (lives nowhere in git)

- **`runner.js`** — byte-identical to the laptop refactor; no caller found via `require()`, the
  `vpn`/`vpn-ui` tooling, or root scripts. **Not proven unused** (manual `docker exec` / browser-UI
  paths aren't ruled out). Leave it; do not delete.
- **`rebuildResults.js`** (100 lines) — a real, **actively used** utility (the `vpn` CLI runs
  `node rebuildResults.js`), absent from `master` *and* `laptop`. Lost entirely on any laptop reset.
  **Capture before any reset.**
- **The hardcoded `GLUETUN_ACCEPTED_AIRVPN_SERVERS` list** in `config.js` — the data the live
  `getAcceptedServers()` actually filters against. Not in `master`.
- **The operational layer** — `vpn`, `vpn-ui`, `vpn-ui.html` (NAS root, not orchestrator) — a manual
  control CLI + browser panel, in git nowhere. Driven by hand while watching tests. Must be part of
  the desktop reconciliation.

## The critical divergence: `getAcceptedServers()`

This is the single most important difference, and it ties directly to the server-drift report:

- **`master` (committed):** dynamic fetch from `GLUETUN_SERVERS_URL`
  (`http://gluetun-speedtest:8000/v1/servers/airvpn`).
- **NAS (running):** hardcoded list — with an in-code comment explaining the dynamic path was
  abandoned because the control API "requires an API key and the `/v1/servers/airvpn` route can't be
  whitelisted via auth.toml."

So `master` is the *earlier, known-not-to-work* approach; the NAS is the *later, working* fix that
was never committed. **`origin/master` is behind the NAS on this feature, not ahead.** (This is also
the same hardcoded list that — per [server-drift-findings.md](server-drift-findings.md) — excludes
the 16 fastest 20 Gbps servers. So the "working" version is working but suboptimal.)

## Laptop status (corrects earlier assumption)

The earlier docs ([laptop-experiment-keepers.md](../documentation/laptop-experiment-keepers.md),
[roadmap-working.md](../documentation/roadmap-working.md)) stated "desktop/origin is the source of
truth and is what's running on the NAS." That is **not accurate**:

- The NAS is desktop-*lineage* but **ahead of origin** (uncommitted config + `rebuildResults.js`).
- Origin is **not** a faithful mirror of the NAS and is **not safely deployable** as-is.
- The laptop's improvements never ran on the NAS; only the inert `runner.js` orphan landed there.

These two docs should be corrected to say: **the running NAS build is the real source of truth, and
it is not fully represented by any git commit.**

## Recommendations

1. **Before any laptop reset or redeploy:** commit the NAS's uncommitted truth to git —
   specifically `config.js`'s hardcoded server list and `rebuildResults.js` — so origin stops being
   a misleading, non-deployable snapshot. (The full NAS orchestrator is preserved in `nas-clone/`.)
2. **Do not deploy `origin/master` to the NAS** until its `getAcceptedServers()` is reconciled with
   the NAS's working hardcoded approach — otherwise server-filtering regresses.
3. **Leave the NAS exactly as it is.** It works. No rsync, no deploy, no deletion, no "cleanup" —
   reconcile in git only, after the desktop investigation establishes the full picture. Do not assume
   `runner.js` (or anything) is safe to remove.
4. **The real win is upstream of all this:** regenerate the gluetun accepted-server list / upgrade
   gluetun so the 16 fastest servers become reachable (see the server-drift report).

---

## Method / caveats

- Comparison is byte-level via `git hash-object` against `master` and `laptop-experiment`; feature
  claims verified by grepping the NAS files directly.
- `node_modules`, gluetun runtime/key dirs, and `.env` were excluded from the clone.
- "Referenced vs not-referenced" was determined by `require()` tracing within
  `nas-clone/orchestrator/` **plus** grepping the `vpn`/`vpn-ui`/`vpn-ui.html` and root scripts —
  but NOT by runtime instrumentation. Manual `docker exec` and browser-UI invocations cannot be
  ruled out, so no file is asserted "unused." **Assume nothing about used vs unused.**
- Line counts are `wc -l`; small differences (e.g. scheduler 302 vs 298) were confirmed as real
  content differences, not whitespace.
