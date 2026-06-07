# Stack cleanup checklist — shrink the VPN switch blast radius

**Status: deferred.** This is the cutover runbook for moving from
[`2026-06-01_media-server.yaml`](2026-06-01_media-server.yaml) (the "before") to
[`target-media-server.yaml`](target-media-server.yaml) (the "after"). **Do not run it yet** — we
execute this together once the switch (Phase 2) is built and proven on the desktop stand-in.

## Why

Today seven apps ride the VPN, so a switch restarts all seven. Three of them — `radarr`, `sonarr`,
`lidarr` — only ride gluetun for `localhost` convenience (so they can reach qbittorrent/prowlarr). And
`speedtest-tracker` is redundant now that this project measures the VPN line. Moving the arr apps off
the VPN and dropping speedtest-tracker shrinks every future switch to **3 apps** (`qbittorrent` +
`prowlarr` + `byparr`) — the only ones that genuinely need to be hidden.

This is a **config-side, one-time** change. It does not change the switch code (the switch discovers
whatever rides gluetun — see [hands-review.md](hands-review.md)).

## What stays on the VPN (unchanged)

`qbittorrent` (downloads must be hidden), `prowlarr` + `byparr` (query indexer sites; some block
non-VPN IPs). These keep `network_mode: "service:gluetun"` and publish through gluetun as before.

## Cutover steps

Do these in order. Each arr app must be repointed **before** it loses `localhost` access.

1. **Snapshot current settings.** In each of radarr/sonarr/lidarr, note the current qBittorrent
   download-client host and the Prowlarr connection — they're `localhost` today.

2. **Repoint radarr / sonarr / lidarr to the NAS LAN address** (they're about to leave the VPN, so
   `localhost` will no longer reach qbittorrent/prowlarr):
   - **Download client (qBittorrent):** Settings → Download Clients → qBittorrent → Host
     `localhost` → `NAS-IP`, Port `8080`. (`NAS-IP` = the NAS's LAN address, e.g. `10.1.10.254`.)
   - **Indexer manager (Prowlarr) pull:** in Prowlarr → Settings → Apps, each arr app's URL
     `http://localhost:7878|8989|8686` → `http://NAS-IP:<port>`; and the Prowlarr server URL the
     arr apps point at → `http://NAS-IP:9696`.

3. **Apply the compose** ([`target-media-server.yaml`](target-media-server.yaml)): radarr/sonarr/lidarr
   move to `media-lan` and publish their own `7878`/`8989`/`8686`; gluetun stops publishing those
   ports + `8787`; `speedtest-tracker` is removed.

4. **Firewall / routing note:** the arr apps now reach the gluetun-published qbittorrent (`8080`) and
   prowlarr (`9696`) over the LAN. gluetun already has `FIREWALL_LOCAL_NETWORK_ACCESS=true` and
   `EXTRA_ROUTES=10.1.10.0/24`, which permits LAN clients to reach its published ports — no change
   expected. If a connection is refused, confirm the LAN subnet is covered (consider
   `FIREWALL_OUTBOUND_SUBNETS` / `FIREWALL_INPUT_PORTS`) before rolling back.

5. **Verify after deploy:**
   - radarr/sonarr/lidarr UIs reachable at `NAS-IP:7878|8989|8686`.
   - Each arr app's qBittorrent download client tests green.
   - Prowlarr → Apps sync tests green for all three.
   - A test grab from each arr app actually lands in qBittorrent.
   - qbittorrent/prowlarr/byparr still egress through the VPN (check qBittorrent's public IP).

## Rollback

If an arr app can't reach qbittorrent/prowlarr after the move, revert that service block to the
`2026-06-01_media-server.yaml` form (`network_mode: "service:gluetun"` + `depends_on: gluetun`, drop
its `ports:` + `networks:`), re-add its port to gluetun, redeploy, and restore the `localhost`
settings from step 1. The change is per-service, so you can roll back one app without touching the
others.
