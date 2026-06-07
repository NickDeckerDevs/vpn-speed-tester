# Roadmap — Working Document

**Project:** AirVPN Speed Tester
**Last Updated:** 2026-06-07
**Status:** Phase 1 ✅ complete (data collected) · Phase 2 🔵 in progress (advisor ✅ + self-validation loop 🔵 + auto-switch "hands" ✅ on desktop)

This is a living document. **Next decisions are at the top.** Update it when priorities shift.

---

## 🔵 Next decisions — what's awaiting a call

Pick one of these to take into its own plan. Each notes what it's waiting on.

1. **Stay-zone policy** — keep the advisor's "below check-point → don't even compare" rule, or add a
   *compare-for-better* rule (look even in the stay zone, switch only for a big margin)?
   *Waiting on:* a few days of **balanced** validation data. Early signal: stays score ~78% wrong, but
   that's skewed by the loop having been stuck on Volans — rotation now fixed. Inspect with `./vpn dashboard`.

2. **Desktop-calibrated model** — rebuild `analysis/buildModel.js` from the **desktop** canonical data
   (and add hour-of-day buckets — the north-star map). *Why now:* the NAS-built `server-model.json` is
   biased for the desktop vantage (dashboard shows it over-predicts Volans/Scutum, under-predicts Polis).

3. **Deployment upgrade** — GHCR image + GitHub Actions + Portainer redeploy webhook, so `./vpn deploy`
   is safe again (it currently has no `--delete`/excludes). Independent of the loop; unblocks #4 and
   eventually shipping the switcher to production. Menu: [deployment-upgrade-options.md](deployment-upgrade-options.md).

4. **Part 3 — NAS top-10 enrichment campaign** — many runs on just the 10 servers across all load bands.
   *Waiting on:* the deploy upgrade (#3) **and** staggering vs the always-on desktop loop (shared home WAN —
   never speed-test on both at once).

5. ~~**The "hands"**~~ **BUILT (desktop, 2026-06-07).** The media-stack VPN switch + the
   brain→decider→hands auto-switch chain are implemented and proven on the desktop stand-in
   (`./vpn media-switch`, `./vpn auto-switch`). It discovers riders dynamically (1→N, no hardcoded
   list). Design + status: [../media-stack/vpn-switch.md](../media-stack/vpn-switch.md). *Remaining before
   production:* (a) **set real guardrails** (`cooldownSec`/`maxSwitchesPerDay`) from accumulated
   `switch-decisions.jsonl` data — shipped loose to measure; (b) the **live NAS stack cleanup**
   ([../media-stack/stack-cleanup-checklist.md](../media-stack/stack-cleanup-checklist.md)) — move arr
   apps off the VPN; (c) the deploy upgrade (#3) to ship it.

6. **Housekeeping** — push/merge the `feat/switch-advisor` branch (Phase 2 + auto-switch, ~110 tests, not yet on master).

---

## Where things stand

**Phase 1 (done).** The speed tester ran on the NAS since 2026-05-08 — **371 sessions**, 602 hourly
snapshots, 25 days of logs. Data pulled home via `./vpn fetch` and analyzed
([analysis/data-analysis-findings.md](../analysis/data-analysis-findings.md)). The original tunnel
blocker is long resolved.

**Phase 2 (this session, 2026-06-07).** Built the load-aware **switch advisor** (recommend-only) and a
**continuous self-validation loop** that grades it against real speed tests:

- **The brain** — `orchestrator/switchAdvisor.js` + `analysis/server-model.json` (the "cheat sheet":
  per-server load→speed curve + two cut-points). `./vpn advise` runs it live. Three zones:
  stay / check-for-better / must-jump; fail-safe to stay.
- **The validation loop** — runs continuously inside an **orchestrator container on a Colima desktop
  runtime** (`docker-compose.desktop.yml` → `orchestrator/validationMain.js`), reusing the proven
  `gluetunManager.switchServer`/`waitForTunnel` + `speedTester.runSpeedtest`. Each pass: decide →
  speed-test current + best-alt → score predicted-vs-measured → rotate through the top-10 for coverage.
- **Canonical output** — speedtests also written in the NAS report format (`raw-results.json`/
  `server-data.json`) so `buildModel.js` + the report can consume the desktop data.
- **Dashboard** — `./vpn dashboard` summarizes accuracy, per-server prediction bias, coverage, and the
  live load→speed curves. Full design: [desktop-validation-loop.md](desktop-validation-loop.md).
- ~110 tests, branch `feat/switch-advisor`. The loop is **gathering balanced data now** (rotating all 10).

## Current standing decision

Leave the NAS collecting and **revisit ≈ 2026-08-01** (keep / stop / move to data-driven auto-selection).
Separately, the desktop validation loop needs **~2 weeks** of continuous running to build a trustworthy
load→speed map (binding constraint is calendar coverage of day/night + weekday/weekend, not sample count).

> ⚠️ **Hold off on `./vpn deploy` until the deployment upgrade (decision #3) lands.** The rsync deploy
> has no `--delete` and no excludes, so a deploy now re-pushes docs/cruft onto the freshly-pruned NAS.
> Git reconciliation has landed (local == committed source of truth); this is the remaining gap. See
> [deployment-upgrade-options.md](deployment-upgrade-options.md).

---

## The arc to automatic switching

The through-line connecting the chapters: **brain ✅ → validate (now) → map → hands ✅ → tune+ship.**

- **Brain** (done) — the recommend-only advisor.
- **Validate** (now) — the desktop loop scores the advisor against reality and gathers balanced data.
- **Map** (next) — a desktop-calibrated load→speed table per server (ideally per hour-of-day). Once
  mapped, a production switch needs no live speedtest: cheap AirVPN load check → map lookup → decision.
- **Hands** (built, desktop) — `mediaSwitch.switchMediaServer` tears down + recreates gluetun and
  re-pins exactly the riders that share its netns (1→N, discovered). The advisor is wired to it through
  a policy-gated decider (`switchDecider` + `switchDeciderMain`, `./vpn auto-switch`). This is the
  **media-stack control panel** pivot, superseding the earlier standalone "automated production VPN
  switching" idea. Status: [../media-stack/vpn-switch.md](../media-stack/vpn-switch.md).
- **Tune + ship** (next for the switcher) — set guardrails from logged `switch-decisions.jsonl`, run the
  live NAS stack cleanup, then deploy. Gated by the deployment upgrade.

Cross-cutting: the **deployment upgrade** (make deploys safe + image-based) underpins shipping any of
this to the NAS/production.

---

## Considerations & Future Ideas

Tracked but not committed. Revisit as data accumulates.

| Idea | Notes |
|------|-------|
| **Smart scheduling** | Shift the test window to hours when target servers are historically low-load; predicted load curves per server per hour (overlaps with the "map" above). |
| **Unit tests (legacy modules)** | `queueBuilder` priority, `aggregator` averages, `airvpnStatus` tiers. (The advisor/validation/auto-switch modules already have ~110 tests.) |
| **Data retention** | Snapshots + validation logs accumulate indefinitely. Define a max age (~90 days) + cleanup. |
| **Error alerting** | Notify (Home Assistant / Mosquitto / Pushover) if a whole test window or the validation loop fails. |
| **Jitter/ping views** | Latency/jitter collected but underrepresented in the report. |
| **International servers** | Architecture handles any AirVPN server by name; EU/AU could be a separate tier. |
| **Multiple entry IPs** | Currently always `ip_v4_in1`; testing the other 3 could reveal WireGuard differences. |
| **Container health watchdog** | Detect a silent orchestrator (no logs for N hours) and restart/alert. |
| **Efficiency ratio in report** | `speed_efficiency_ratio` is collected but not prominently charted. |

---

## Historical pointers

- [`verified-completed-historical-only/`](verified-completed-historical-only/) — Phase 0/1 build + bug-fix history.
- [`this-is-my-mess/`](this-is-my-mess/) — the laptop/desktop/NAS git-divergence reconciliation (resolved).
- [`../analysis/nas-snapshot/`](../analysis/nas-snapshot/) — **frozen, read-only** byte-copy of the NAS code as of 2026-06-05 (audit reference; never deployed back, never edited).
