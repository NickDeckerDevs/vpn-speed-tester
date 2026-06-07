# Hands review — what a VPN switch takes down (and what should be on the VPN)

A plain-English review, before building "the hands" (the ability to put the media stack's VPN on a
different server). Source: [`2026-06-01_media-server.yaml`](2026-06-01_media-server.yaml).

## How a VPN switch actually works

To put gluetun on a different server, you can't just nudge it — **the VPN container has to be
destroyed and recreated** (it only reads which server to use when it starts up).

Seven apps are configured to **share the VPN container's network connection**
(`network_mode: "service:gluetun"` in the YAML). They don't have their own network — they ride on
gluetun's. So when the VPN container is destroyed and recreated, that shared connection disappears,
and **every app riding on it has to be restarted too** so it can re-attach to the new VPN container.

That's a hard Docker rule, not a preference. It's the whole reason a "switch" is more than a
one-container operation.

## The two groups

**On the VPN → must be stopped and restarted on every switch:**

| App | What it is |
|---|---|
| `qbittorrent` | The torrent downloader |
| `prowlarr` | Searches torrent/usenet indexer sites |
| `byparr` | Helps prowlarr get past Cloudflare on those indexer sites |
| `radarr` | Movie library manager |
| `sonarr` | TV library manager |
| `lidarr` | Music library manager |
| `speedtest-tracker` | Periodically measures the (VPN) internet speed |

**Independent → keep running, untouched by a switch:**

| App | Why it's safe |
|---|---|
| `jellyfin` | **Movie/TV playback — NOT on the VPN.** Anyone watching is *not* interrupted by a switch. |
| `caddy` | Reverse proxy; just briefly re-proxies the apps as they come back |
| `homeassistant` | Home automation (own `network_mode: host`) |
| `mosquitto` | MQTT broker for Home Assistant |
| `zigbee2mqtt` | Zigbee bridge |
| `filebrowser` | File manager UI |

The headline: a switch blips the **download/indexer apps**, not the **things people actually watch or
use day-to-day**. That makes a switch lower-stakes than "restart 7 containers" sounds.

## Does each VPN app truly *need* the VPN?

Only one is non-negotiable. The rest are a spectrum:

- **qbittorrent — yes, essential.** Its downloads must go through the VPN to stay hidden. This is the
  entire reason the VPN exists in this stack.
- **prowlarr / byparr — probably.** They query torrent indexer sites; routing that through the VPN is
  good for privacy, and some indexers block non-VPN / datacenter addresses. Reasonable to keep on.
- **radarr / sonarr / lidarr — not really.** These are library *managers*. Their own traffic is mostly
  public metadata lookups (movie/TV/music info). They're on the VPN mainly so they can reach
  qbittorrent and prowlarr at "localhost" (because everything shares one network). They could live on
  the regular LAN instead.
- **speedtest-tracker — no real need.** It's there to measure the VPN line. Arguably redundant now that
  this project has its own speed tester. Optional.

## Are we thinking about it the wrong way? Partly — yes.

The "seven apps must restart" blast radius is a **design choice**, not a requirement. It's big only
because everything was placed on the VPN for convenience (so they can all talk to each other at
"localhost").

We *could* shrink it — move `radarr` / `sonarr` / `lidarr` (and maybe `speedtest-tracker`) **off** the
VPN — so a switch only disturbs `qbittorrent` + `prowlarr` + `byparr`. The cost: those apps currently
find qbittorrent/prowlarr at "localhost"; off the VPN they'd need to point at the NAS's address
instead (a settings change inside each app, plus publishing their ports off gluetun).

**This is a separate "stack cleanup" decision — not part of building the switch.** Recorded here so we
don't forget it's on the table.

## What the switch itself should do (the recommended approach — deferred build)

**Don't hardcode the seven.** The switch should **look at whatever apps are currently riding the VPN
and restart exactly those.** Then if we later move some off the VPN, the switch automatically does less
work — no code change needed.

The sequence (reuses the speed tester's proven machinery — `orchestrator/gluetunManager.js` for the
recreate + tunnel wait, `orchestrator/qbtClient.js` for the graceful qBittorrent pause):

1. **Gracefully pause qBittorrent** so a download isn't killed mid-write.
2. **Stop the apps riding the VPN** (the discovered set).
3. **Recreate the VPN container** on the new server.
4. **Wait until the tunnel is confirmed up.**
5. **Start the apps back**, re-attached to the new VPN container.
6. **Resume qBittorrent.**

Hazards already learned (the hard way) in the desktop validation work, which apply directly here:
stop the apps **before** the VPN container; do a **clean stop/recreate** (not a "force recreate," which
left orphaned, name-conflicting containers); and never let two things recreate containers at the same
time.

**Build + test it on a stand-in stack on the desktop first** (a VPN container + a few placeholder apps
with different names/ports), never the real NAS. Driven **manually** at first (you name the server);
wiring the advisor to *decide* when to switch comes later, once its policy is settled and it has data
from the NAS's own vantage point.

---

*Out of scope for the switch build: touching the real NAS stack, auto-deciding when to switch, moving
apps off the VPN, and the web-UI / family-requests parts of the media-stack manager.*
