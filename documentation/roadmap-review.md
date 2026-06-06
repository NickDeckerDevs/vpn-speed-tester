# Roadmap Refresh & Next-Chapter Plan

> **This is a planning document only.** Nothing here has been executed — no commits, no stashing,
> no deploys, no code changes, no NAS changes. Its companion is `roadmap-review.html` (open it in a
> browser for the interactive version). Take your time; the decisions are listed at the end.

---

## Part 1 — Where things actually stand (plain English)

**The speed tester worked, and it's been quietly doing its job for almost a month.**
It's been running on the NAS since May 8 and has collected a real pile of data:

- **371 completed speed-test sessions** (each = 3 back-to-back runs, so ~1,100 individual tests)
- **602 hourly snapshots** of how loaded every US AirVPN server was, hour by hour
- **25 days of logs**

So the original goal — "measure real throughput across AirVPN servers so we can pick good ones" —
is basically **done**. You have plenty of data.

**There are two copies of the code, and they drifted apart.** This is the confusing part, now
explained:

- **The desktop copy** is the *real* one. You've been committing to GitHub and deploying to the
  NAS *from your desktop*. It has extra features (notably "server filtering" — it remembers which
  servers are reachable/good and skips bad ones). This is what's running and producing the data.
- **This laptop copy** is a *side experiment*. You started a refactor here, couldn't find it later
  (because it was never the version you were deploying), and that's the uncommitted work sitting on
  this machine right now. It has some genuinely nice improvements, but it's missing the desktop's
  server-filtering and was never deployed.

**The roadmap document is badly out of date.** It still says the project is blocked on a
VPN-tunnel bug — a bug that was fixed weeks ago. Anyone reading it would think nothing works, when
in reality everything works and has for a month.

**Your decision so far:** leave the NAS alone and let it keep collecting for ~60 more days
(revisit around **Aug 1, 2026**), then decide whether to switch the speed tester off and move to
manual/automatic server selection using the data.

---

## Part 2 — What this plan sets out to do (plain English)

Six pieces, in order. The first is just bookkeeping; the big one is the last.

1. **Save the good ideas from the laptop experiment** so they aren't lost when we eventually reset
   this laptop to match the real (desktop) code.
2. **Pick the desktop/GitHub version as the official one** going forward (just deciding it — no
   code surgery yet).
3. **Rewrite the roadmap** so it tells the truth: project succeeded, data collected, here's what's
   next.
4. **Bring the data home** — a small script that copies the collected data from the NAS down to
   this laptop so it can be looked at.
5. **Analyze the data** — open-ended, later. We'll list starting ideas, not commit to any.
6. **The pivot: a control panel for your whole media server** — the big next chapter.

The actual *deliverable of this session* is the interactive HTML page (`roadmap-review.html`) plus
this document. We are not building any of the six pieces yet.

---

## Part 3 — The pieces, explained

### Piece 1 — Save the good ideas from the laptop experiment  *(Proposed)*

**Plain English:** Before we ever reset this laptop back to the real code, write down the three
improvements made here so they can be re-added on top of the real version later. Don't throw the
baby out with the bathwater.

**The three keepers:**

1. **One run-function instead of two.** The real code has two separate files for "run once" vs.
   "run forever." The laptop merged them into a single cleaner piece with a simple "mode" switch.
2. **Sturdier container handling.** When swapping VPN servers the tool destroys and recreates
   Docker containers. The laptop added a step that *waits and confirms the old container is fully
   gone* before making the new one — preventing "name already in use" crashes — and logs failures
   more clearly.
3. **Cleaner command flags.** Tidier `--single` / `--infinite` startup options.

**Technical detail:**
- Keeper 1: laptop's `orchestrator/runner.js` (`run({ mode })`, `MODES` =
  WINDOW/SINGLE/INFINITE) replaces the desktop's `infiniteRunner.js` +
  `scheduler.runSpeedTestWindow()`.
- Keeper 2: laptop's `gluetunManager.js` adds `waitForContainerRemoved()`,
  `tearDownDockerContainer()`, `logContainerStatus()`, `logDockerError()`; renames
  `ensureSpeedtestRunner → verifyTestContainersRunning` and
  `tearDownTestContainers → tearDownSpeedTestingContainers`.
- Keeper 3: laptop's `main.js` flag dispatch.
- **Must NOT lose from the desktop version when porting:** server-filtering
  (`accepted-servers.json` / `unreachable-servers.json`, `getAcceptedServers()` in
  `gluetunManager.js`, the `ACCEPTED_SERVERS_PATH` / `UNREACHABLE_SERVERS_PATH` config keys),
  `rebuildResults.js`, `GLUETUN_SERVERS_URL`, and `MAX_CONSECUTIVE_FAILURES: 5` (laptop has 3).

> This piece is just a written note. No code changes now.

### Piece 2 — Make the desktop/GitHub version the official one  *(Deferred / your call)*

**Plain English:** Going forward, the desktop/GitHub copy is the source of truth. The plan to
reset this laptop to match it (set the experiment aside, pull the real code) is documented here but
**deliberately not done** — you wanted time to decide. When ready it's a two-command operation, and
the keepers from Piece 1 are safely written down.

**Technical detail (for later, not now):** the laptop is on a diverged branch (5 local commits vs
11 on origin). The eventual reset is `git stash` (or branch the experiment) → `git pull`. Because
`deploy.sh` syncs with `rsync` and **no `--delete`**, deploying from the wrong machine leaves orphan
files behind and could regress server-filtering — which is exactly how the drift happened.
**Until the laptop is reset, do not run `deploy.sh` from this laptop.**

### Piece 3 — Rewrite the roadmap to tell the truth  *(Proposed)*

**Plain English:** Replace the stale roadmap with one that says: Phase 1 is complete, here's the
data we have, here's the decision to let it run ~60 more days, and here are the next chapters
(Pieces 4–6). Keep the old blow-by-blow bug history in the existing "historical" folder so nothing
is erased — just no longer front-and-center.

**Technical detail:** rewrite `documentation/roadmap-working.md`; collapse the resolved
P0.5/P0/P1 sections into a one-line pointer to `verified-completed-historical-only/`; record the
~60-day revisit (≈2026-08-01).

### Piece 4 — Bring the data home  *(Proposed)*

**Plain English:** A small script you run from the laptop that copies the collected data (results,
snapshots, raw numbers) down from the NAS into a folder here, so it can be analyzed without
touching the live system. Logs are big (~54 MB) so they're optional, behind a flag.

**Technical detail:** new `fetch-nas-data.sh`, modeled on `deployAndTestOne.sh` (reads `SYSOP_SSH`
from `.env`, `ssh -p 8322`). Read-only pull of
`/volume1/Docker/vpn-speed-tester/data/{results.json, raw-results.json, server-data.json,
snapshots/, accepted-servers.json, unreachable-servers.json}` into `analysis/nas-data/`; logs
behind `--with-logs`. Add `analysis/nas-data/` to `.gitignore`. Add `analysis/README.md` describing
each file's shape and seeding analysis ideas.

### Piece 5 — Analyze the data (open-ended, later)  *(Deferred / your call)*

**Plain English:** Once the data is local, dig into it. You don't know yet exactly what you want to
learn — that's fine. Some natural starting questions:

- Which server (and which city) is fastest, and at what hours?
- Does a server's "load %" actually predict real speed, or not?
- Which servers are reliably good vs. flaky?
- Best time of day to connect for the lowest load?

**Technical detail:** no tooling commitment yet; the existing report already charts some of this
(`report/index.html`). Exploratory — fleshed out after Piece 4.

### Piece 6 — The big pivot: a control panel for your whole media server  *(Deferred / your call)*

**Plain English:** Turn what this project learned into a **single control panel for your entire
media stack** (the Jellyfin / qBittorrent / Radarr / Sonarr setup in
`documentation/2026-06-01_media-server.yaml`). A web page on the NAS where you can:

- **See the logs** from a browser (no SSH needed).
- **Switch the VPN to a faster server** — using the speed data we collected — and have everything
  come back up cleanly.
- **Shut the stack down and bring it back up** with a button.
- **Let family request movies/shows** to download.

And do it **without constantly rebuilding Docker**: mount this project's code as a folder the NAS
reads directly, so you tweak code and it just picks it up — only rebuilding the image in rare cases.

**How it would work (plain English):**
- A small always-on "manager" service joins the media stack. It can talk to Docker (to
  restart/recreate containers) and to qBittorrent/Radarr/Sonarr (to control them and add requests).
- A simple web page is the front door. Logs already get written to a data folder, so showing them
  is mostly serving that folder. The existing reverse proxy (`caddy`) can give it a clean URL.
- Server-switching reuses the exact machinery this project already built.

**The one big technical catch (important):** in the media stack, **one VPN container is shared by
everything** (qBittorrent, Radarr, Sonarr, Lidarr, Prowlarr, Byparr, Speedtest-tracker all route
through it). So "switch the VPN server" isn't a one-container operation like it was in the speed
tester — it means **recreating the VPN container *and* every service attached to it, in the right
order.** That's the main thing the manager has to get right.

**What gets reused from this repo (technical):**
- `orchestrator/gluetunManager.js` — the destroy/recreate/wait-for-tunnel cycle.
- `orchestrator/qbtClient.js` — qBittorrent control (note the v5 `stop`/`start` quirk).
- `orchestrator/logger.js`, `orchestrator/httpClient.js` — logging + HTTP error handling.
- `report-server` nginx pattern + `report/index.html` — serving a UI + the data folder.
- `deploy.sh` rsync pattern — but **add `--delete`** for the manager to avoid the orphan-file
  problem that caused the current drift.

**Server-selection tie-in (technical):** the production VPN is configured by *city/country*; to pin
a specific tested-fast server we set `SERVER_NAMES` (same trick the speed tester uses) chosen from
the data collected in Pieces 4–5.

**Other next-step ideas to capture:**
- Health/watchdog for the arr stack (alert if something silently dies).
- Disk-space alerts and automated file cleanup/moves.
- Phone/Home-Assistant notifications on a VPN switch or a failure.
- Off-the-shelf request UIs (Overseerr/Jellyseerr) vs. a lightweight custom one — note the
  trade-off rather than deciding now.

> Piece 6 becomes a handoff document (`documentation/media-stack-manager-handoff.md`) when you
> decide to build it — not built in this session.

---

## Decisions waiting on you

- **Piece 2:** when (and whether) to reset this laptop to the desktop/GitHub version.
- **Piece 5:** what questions you actually want the data to answer.
- **Piece 6:** green-light the media-stack control panel — and the off-the-shelf-vs-custom call for
  family download requests.
- **Around Aug 1, 2026:** keep the speed tester running, switch it off, or move to automatic server
  selection.

---

> **Post-review addition (2026-06-06):** deployment-model upgrades (build-our-own-image vs
> pull-based git vs rsync `--delete`) are catalogued in
> [deployment-upgrade-options.md](deployment-upgrade-options.md). Living detail is tracked in
> [roadmap-working.md](roadmap-working.md); this review remains a point-in-time snapshot.

---

*Status: nothing executed. Companion file: `roadmap-review.html` (interactive). Source plan:
`~/.claude/plans/i-think-we-have-compressed-creek.md`.*
