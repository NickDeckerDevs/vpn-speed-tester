# Named services — live route table

Snapshot: **2026-06-06**. Source: live `/volume1/Docker/caddy/Caddyfile` on the NAS
(byte-identical to `waitress/stacks/Caddyfile` on this date). "Reachable" was probed from
the LAN via `curl -I https://<host>.waitress.nickdeckerdevs.com`.

All URLs are `https://<subdomain>.waitress.nickdeckerdevs.com` (wildcard cert, LAN-only).

| Subdomain | Caddy backend | Behind gluetun VPN? | Probe result | Notes |
|-----------|---------------|---------------------|--------------|-------|
| `jellyfin` | `jellyfin:8096` (docker DNS) | no | 302 ✅ | redirect to web UI = healthy |
| `sonarr` | `host.docker.internal:8989` | **yes** | 401 ✅ | auth challenge = healthy |
| `radarr` | `host.docker.internal:7878` | **yes** | 302 ✅ | |
| `lidarr` | `host.docker.internal:8686` | **yes** | 302 ✅ | |
| `prowlarr` | `host.docker.internal:9696` | **yes** | 302 ✅ | |
| `qbittorrent` | `host.docker.internal:8080` | **yes** | 200 ✅ | |
| `speedtest` | `host.docker.internal:8787` | **yes** | 302 ✅ | speedtest-tracker (separate from this repo) |
| `byparr` | `host.docker.internal:8191` | **yes** | 301 ✅ | FlareSolverr replacement |
| `filebrowser` | `filebrowser:80` (docker DNS) | no | 200 ✅ | |
| `homeassistant` | `host.docker.internal:8123` | no (host net) | 200 ✅ | |
| `zigbee2mqtt` | `host.docker.internal:8080` | no | 200 ⚠️ | **SUSPECTED WRONG PORT** — see below |
| `portainer` | `host.docker.internal:19900` | no | 200 ✅ | |
| `nas` | `host.docker.internal:8000` | no | 200 ✅ | ASUSTOR ADM portal (lighttpd) |
| `photos` | `host.docker.internal:2283` (immich_server) | no | 200 ✅ | Immich photo library (repo `NickDeckerDevs/nas-photo-manager`). Added 2026-06-06. Bare `/` **302-redirects to `/photos`** (the photos view); all other paths (`/api`, assets, `/auth`) proxy straight through so the SPA works. |
| `vpn-report` | `host.docker.internal:9191` | no | 502 ⏸️ | **Intentionally down** — the vpn-speed-tester stack is off on purpose. Route is harmless while idle. |

### Not yet routed
| Desired subdomain | Service | Status |
|-------------------|---------|--------|
| `immich` (alias) | Immich | Only `photos` is routed. `immich.waitress…` still returns Caddy's empty-200 default. Add an alias block (or fold the host into `@photos`) if you want both names. |

> **Empty-200 caveat:** because the site block `*.waitress.{$BASE_DOMAIN}` has only
> `handle` matchers and **no fallback handler**, *any* unmatched subdomain (including
> typos and `immich`/`photos` today) returns **HTTP 200 with a 0-byte body** from Caddy
> itself. A 200 only means "real backend" for hosts that have a route. Use body size /
> non-200 redirects to tell real services apart. (See the 502/unmatched fallback idea in
> the runbook.)

## ⚠️ Known issue — `zigbee2mqtt` port collision

The route is `zigbee2mqtt → host.docker.internal:8080`, but `:8080` is already
qbittorrent's published port (and zigbee2mqtt is defined on **8888** in
`media-stack.yml`). So `zigbee2mqtt.waitress…` almost certainly proxies to **qbittorrent**,
not zigbee2mqtt. Its 200 is misleading. **Fix:** change the backend to the correct
zigbee2mqtt host port (likely `:8888`) in the Caddyfile and reload. Verify the actual
published port first (`docker ps | grep zigbee`). Not yet fixed — flagged only.

## gluetun reachability note

Services marked "behind gluetun" run with `network_mode: service:gluetun`, so they have
**no own network namespace** — Caddy can't reach them by container name. They're proxied
via `host.docker.internal:<port>`, which works **only because gluetun publishes those
ports on the host**. If you add a new VPN-bound service and its route 502s, the usual
cause is a missing port publication on the **gluetun** service. (See runbook.)
