# Desktop validation loop (Part 2)

Self-scoring loop for the switch advisor. Every hour it asks the advisor for a
stay/switch decision, then **actually speed-tests** the current server and the best
alternative through the VPN, and logs predicted-vs-measured + whether the decision
was right. Runs on the **desktop** (not the NAS, not in the live media stack).

This is for validating the model — it never touches production.

## Architecture

```
 cron (LaunchAgent, hourly :15)
   └─ desktop-validation/run-validation.sh   (sets PATH, ensures colima/stack up)
        └─ node orchestrator/validationRunner.js   (HOST side)
             ├─ fetch AirVPN status  (public API)
             ├─ recommend()          (orchestrator/switchAdvisor.js + analysis/server-model.json)
             ├─ switchServer(name)   → docker compose -f docker-compose.desktop.yml
             │                          up -d --force-recreate gluetun + runner; wait healthy
             ├─ runSpeedtest()       → docker exec speedtest-runner speedtest-cli --json --secure
             ├─ append record        → analysis/validation-log.jsonl
             └─ carry current fwd    → analysis/validation-state.json
```

The pure logic (`runValidationOnce`, scoring, state) lives in
`orchestrator/validationLoop.js` and is unit-tested (`validationLoop.test.js`,
mocked Docker). The runner just supplies the real docker-backed collaborators.

## Runtime

- **Container runtime: Colima** (`brew install colima docker docker-compose`),
  Apple `vz` backend. Start: `colima start --vm-type=vz --cpu 2 --memory 4 --disk 20`.
  `~/.docker/config.json` has `cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins"]`
  so `docker compose` resolves.
- **Stack: `docker-compose.desktop.yml`** — gluetun-speedtest + speedtest-runner only.
  WIREGUARD_* come from `.env`. Bring up: `docker compose -f docker-compose.desktop.yml up -d`.

## Run it manually

```sh
node orchestrator/validationRunner.js                 # one pass (uses saved current)
node orchestrator/validationRunner.js --current Volans # force the starting server
```

## The schedule (LaunchAgent)

`~/Library/LaunchAgents/com.nickdecker.vpn-validation.plist` → runs
`desktop-validation/run-validation.sh` at **HH:15 every hour** (offset from the top
of the hour, where a future NAS campaign would sit — see staggering below).

```sh
# load / unload
launchctl bootstrap   gui/$(id -u) ~/Library/LaunchAgents/com.nickdecker.vpn-validation.plist
launchctl bootout     gui/$(id -u)/com.nickdecker.vpn-validation
# run now (don't wait for the hour) / inspect
launchctl kickstart   gui/$(id -u)/com.nickdecker.vpn-validation
launchctl print       gui/$(id -u)/com.nickdecker.vpn-validation
# console log of scheduled runs
tail -f desktop-validation/validation-run.log
```

The wrapper self-heals: if `docker info` fails (e.g. after reboot) it runs
`colima start` first. For Colima to survive reboot without that wait, optionally:
`brew services start colima`.

## Staggering vs the NAS campaign (Part 3)

A VPN speed test saturates the home WAN, so the desktop loop and the NAS top-10
campaign must **never** speed-test at the same time. The desktop loop runs at
**:15**; schedule the NAS campaign off that window (e.g. top of the hour). Each
pass is ~5 min (2 tunnel switches + 4 speedtests).

## Reading the results

`analysis/validation-log.jsonl` — one JSON record per pass:

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
  }
}
```

Over time: `decisionCorrect` rate = how often the advisor was right; the prediction
errors = how accurate the cheat sheet's expected speeds are. Both feed back into
tuning `analysis/server-model.json` (rebuild via `node analysis/buildModel.js`).
