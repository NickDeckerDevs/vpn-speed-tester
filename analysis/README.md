# Analysis

Local workspace for analyzing the speed-test data collected on the NAS. Pull the data with:

```sh
./vpn fetch              # data files + snapshots/
./vpn fetch --with-logs  # also pull logs/ (~54 MB)
```

This pulls **read-only** into `nas-data/` (git-ignored — see [.gitignore](../.gitignore)). The live
NAS stack is never modified. As of 2026-06-05 there are ~371 sessions and ~602 hourly snapshots.

> ✅ **"Bring the data home" verified complete 2026-06-07.** Local `nas-data/` is intact —
> 371 sessions, 604 snapshots, window 2026-05-08 → 2026-06-02. It's ~5 days stale; refresh
> any time with `./vpn fetch`.

## What you get (file shapes)

Cross-reference the "Data layout" section of [CLAUDE.md](../CLAUDE.md) for the source of truth.

| File | Shape |
|---|---|
| `results.json` | Flat array of completed sessions: `{ server_name, tier, timestamp, run_count }`. The coverage tracker — one entry per session. |
| `raw-results.json` | Keyed by `${timestamp}_${runNum}-${total}`; full `speedtest-cli --json` output per individual run (download/upload bits/s, ping, server, etc.). |
| `server-data.json` | Keyed by `timestamp`; the AirVPN status row snapshotted at session start (includes `currentload`, city/country, IPs). Join to `results.json` on `timestamp`. |
| `snapshots/YYYY-MM-DD-HH.json` | Hourly snapshot of every US AirVPN server's live load. `snapshots/index.json` is the manifest listing them. |
| `accepted-servers.json` / `unreachable-servers.json` | Server-filtering memory (reachable/good vs. skipped). Origin-only feature — may be absent if pulled from a build without it. |
| `logs/YYYY-MM-DD.log` | Per-day append log (only with `--with-logs`). |

## Starting questions (open-ended)

- Which server (and which city) is fastest, and at what hours?
- Does a server's `currentload %` actually predict real throughput, or not? (join `server-data.json`
  load to `raw-results.json` download speed by timestamp)
- Which servers are reliably good vs. flaky? (variance across a server's runs)
- Best time of day to connect for the lowest load? (aggregate `snapshots/` by hour-of-day)

No tooling commitment yet — the existing report (`report/index.html`) already charts some of this.
