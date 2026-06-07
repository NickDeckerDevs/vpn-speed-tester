# Desktop validation loop (Part 2)

Self-scoring loop for the switch advisor. **Continuously** (back-to-back, ~2 min/pass) it asks the
advisor for a stay/switch decision, then **actually speed-tests** the current server and the best
alternative through the VPN, and logs predicted-vs-measured + whether the decision was right. Runs on
the **desktop** (not the NAS, not the live media stack).

This validates the model — it never touches production.

## Architecture — runs the orchestrator the same way the NAS does

```
 docker compose -f docker-compose.desktop.yml   (Colima/Docker)
   ├─ gluetun-speedtest     WireGuard tunnel (SERVER_NAMES selects the server)
   ├─ speedtest-runner      shares gluetun's netns; speedtest-cli
   └─ orchestrator          command: node validationMain.js   (continuous loop)
        docker.sock mounted; reuses the PROVEN machinery:
        ├─ gluetunManager.switchServer / waitForTunnel   (tearDown → recreate → control-API health)
        ├─ speedTester.runSpeedtest                       (exec speedtest-cli in the runner)
        ├─ airvpnStatus.fetchUSServers                    (live busy-levels)
        └─ switchAdvisor.recommend (via runValidationOnce)
```

`validationMain.js` captures the base container config, then loops forever:
fetch → recommend → speed-test current + best-alt → append a record → carry current forward.
The pure scoring (`runValidationOnce`, scoring, state, timing) lives in `orchestrator/validationLoop.js`
and is unit-tested (`validationLoop.test.js`, mocked). The container just injects the real collaborators.

## Runtime

- **Container runtime: Colima** (`brew install colima docker docker-compose`), Apple `vz` backend.
  Start: `colima start --vm-type=vz --cpu 2 --memory 4 --disk 20`.
  `~/.docker/config.json` needs `cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins"]`
  for `docker compose` to resolve.
- **Model**: `analysis/server-model.json` is mounted read-only at `/config/server-model.json`.
- **Output** (under the gitignored `desktop-validation/data/`, mounted at `/data`):
  - `validation-log.jsonl` — one decision-scoring record per pass (predicted/measured/decision/timing)
  - `validation-state.json` — `{ current, staysOnCurrent, cursorIndex }` (drives coverage rotation)
  - `raw-results.json` + `server-data.json` — **canonical format** (same as the NAS report data), so
    `buildModel.js` and `report/index.html` can consume the desktop measurements.
  - `results.json` for the report is regenerated on demand:
    `docker exec orchestrator node rebuildResults.js` (reads the canonical files in /data).

## Coverage rotation

The advisor drives switches normally. But to exercise all 10 (not park on one low-load favorite),
after **2 consecutive STAYs** on the same server the loop force-steps to the **next** server in the
top-10 order (looping). Cold start seeds index 0. So `current` walks the whole list over time —
`validation-state.json` tracks where we are (`cursorIndex`).

## Run / manage

```sh
docker compose -f docker-compose.desktop.yml up -d --build   # start (continuous; restart: unless-stopped)
docker logs -f orchestrator                                   # watch passes live
tail -f desktop-validation/data/validation-log.jsonl          # the records
docker compose -f docker-compose.desktop.yml down            # stop everything
```

Tunables (compose `orchestrator.environment`): `VALIDATION_RUNS_PER_SERVER` (default 2),
`VALIDATION_GAP_MS` (default 5000). The gluetun control endpoint is `GLUETUN_CONTROL_URL`
(default `http://gluetun-speedtest:8000/v1/vpn/status`) — env-overridable for local vs NAS.

After a reboot, ensure Colima is up (`colima start`, or `brew services start colima`); the
`restart: unless-stopped` orchestrator resumes on its own once Docker is back.

## Reading the results

`desktop-validation/data/validation-log.jsonl` — one JSON record per pass:

```jsonc
{
  "at": "...", "zone": "jump", "action": "switch",
  "current":     { "server": "Aladfar", "load": 91, "predicted": 137, "measured": 161.3 },
  "alternative": { "server": "Volans",  "load": 50, "predicted": 287, "measured": 321.8 },
  "scoring": {
    "currentPredictionError": 24,   // measured - predicted
    "altPredictionError": 35,
    "measuredGap": 160,             // + => alternative really was faster
    "decisionCorrect": true         // switch: alt faster ; stay: didn't miss a faster one
  },
  "timing": { "durationMs": 117000, "current": {...}, "alternative": {...} }  // total + per-server switch/run ms
}
```

(First record after a fresh start is a cold-start `unknown-current`: no saved "current" server yet, so
only the alternative is measured. It self-corrects from the next pass.)

Over time: `decisionCorrect` rate = how often the advisor was right; prediction errors = how accurate
the cheat sheet is. Both feed tuning of `analysis/server-model.json` (rebuild via `node analysis/buildModel.js`).

## Staggering vs the NAS campaign (Part 3)

A VPN speed test saturates the home WAN, so the desktop loop and the NAS top-10 campaign must **never**
speed-test at the same time. Since the desktop loop now runs continuously, when the NAS campaign starts
we'll coordinate (e.g. pause the desktop loop during NAS windows, or alternate). Not an issue until
Part 3 runs.
