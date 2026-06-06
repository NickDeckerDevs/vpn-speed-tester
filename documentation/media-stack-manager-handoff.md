# Media-Stack Manager — Design / Handoff

**Status:** Green-lit (2026-06-05) as the next chapter after the AirVPN Speed Tester. This is a
design/handoff document — nothing here is built yet.

## Goal

A single control panel for the whole media stack (defined in
[`2026-06-01_media-server.yaml`](2026-06-01_media-server.yaml)): a web page on the NAS where you can

- **See the logs** from a browser (no SSH).
- **Switch the VPN to a faster server** — using the throughput data this project collected — and
  have everything come back up cleanly.
- **Shut the stack down and bring it back up** with a button.
- **Let family request movies/shows** to download.

…and do it **without constantly rebuilding Docker**: mount the manager's code as a folder the NAS
reads directly, so code tweaks are picked up without an image rebuild (rare cases aside).

## The core catch — one shared VPN container (the hard part)

In the production stack, **one `gluetun` container backs 7 services**, all via
`network_mode: "service:gluetun"` with `depends_on: gluetun`:

`qbittorrent`, `radarr`, `sonarr`, `lidarr`, `prowlarr`, `byparr`, `speedtest-tracker`.

`gluetun` also publishes *their* ports on its own `ports:` list (8080 qbt, 7878 radarr, 8989 sonarr,
8686 lidarr, 9696 prowlarr, 8191 byparr, 8787 speedtest-tracker) because the attached containers
have no network of their own. **Consequence:** switching the VPN server is **not** a one-container
op like it was in the speed tester (where gluetun-speedtest had a single attached runner). Here it
means:

1. Stop the 7 attached services (they share gluetun's netns; they go zombie if gluetun dies first).
2. Stop → remove → recreate `gluetun` with the new `SERVER_NAMES` (gluetun does **not** pick up env
   changes on a running container — same constraint the speed tester hit).
3. Wait for the tunnel to come up (gluetun control API / healthcheck `ping 1.1.1.1`).
4. Recreate the 7 attached services **after** gluetun is up, so they re-attach to the live netns.

Getting this order right is the manager's central job and the riskiest part of the build.

## What gets reused from this repo

- **`orchestrator/gluetunManager.js`** — the destroy/recreate/wait-for-tunnel cycle, including the
  laptop keepers (`waitForContainerRemoved()` to avoid "name already in use", clearer Docker error
  logging — see [laptop-experiment-keepers.md](laptop-experiment-keepers.md)). Generalize from
  "1 attached runner" to "N attached services."
- **`orchestrator/qbtClient.js`** — qBittorrent control. Note the **v5 `stop`/`start` quirk** (not
  `pause`/`resume`; filter `stopped` not `paused`) and that only previously-`downloading` torrents
  get force-started on resume.
- **`orchestrator/logger.js`** + **`orchestrator/httpClient.js`** — logging + HTTP error handling.
- **`report-server` nginx pattern + `report/index.html`** — serving a UI plus the data folder. Logs
  already get written to a data folder, so showing them in-browser is mostly serving that folder.

## Infra already present (lean on it)

- **`caddy`** (`slothcroissant/caddy-cloudflaredns`) — reverse proxy; give the manager a clean URL
  via the existing `Caddyfile`.
- **`homeassistant` + `mosquitto`** — notification tie-in (push on a VPN switch or a failure).
- **`gluetun` healthcheck** (`ping -c1 1.1.1.1`, 45s start period) — a ready-made tunnel-up signal.

## Server-selection tie-in

Production VPN is currently pinned by city (`SERVER_CITIES="Miami, Atlanta, New York"`). To pin a
specific *tested-fast* server, set `SERVER_NAMES` (same trick the speed tester uses), chosen from
the data collected in the analysis chapter (`analysis/`).

## Deploy fix (do not repeat the drift)

The manager's deploy **must** use `rsync --delete`. The speed tester's `deploy.sh` rsyncs **without**
`--delete`, which left orphan files and is exactly how the desktop/laptop drift happened. The
no-rebuild dev loop (mount code as a directory the container reads) reduces deploys, but when you do
sync, sync cleanly.

## How it hangs together (plain English)

- A small always-on **manager** service joins the media stack. It talks to Docker (via the mounted
  host socket, as the orchestrator already does) to restart/recreate containers, and to
  qBittorrent/Radarr/Sonarr to control them and add requests.
- A simple **web page** is the front door, behind `caddy`. Logs are served from the data folder;
  controls POST to the manager.
- **Server-switching** reuses the speed tester's machinery, generalized to the shared-gluetun case.

## Open product call to record (decide later, not now)

- **Family download requests:** off-the-shelf request UI (**Overseerr / Jellyseerr**, integrates
  natively with Radarr/Sonarr/Jellyfin) vs. a **lightweight custom** page. Trade-off: off-the-shelf
  is batteries-included but another service to run; custom is minimal but you build/maintain it.

## Also capture (next-step ideas)

- Health/watchdog for the arr stack (alert if something silently dies).
- Disk-space alerts and automated cleanup/moves.
- Phone / Home-Assistant notifications on a VPN switch or failure.
- Live log viewing in the browser (no SSH).
- No-rebuild dev loop: code mounted as a folder gluetun/nginx read directly; image rebuild only in
  rare cases.

---

*Supersedes the earlier standalone "P2 — automated production VPN switching" and "P3 — React report
frontend" ideas from the old roadmap; both are folded in here.*
