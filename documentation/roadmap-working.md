# Roadmap — Working Document

**Project:** AirVPN Speed Tester
**Last Updated:** 2026-06-06
**Phase 1 Status:** ✅ Complete — built, deployed, and collecting data on the NAS since 2026-05-08.

This is a living document. Update it when priorities shift or new ideas surface.

---

## Where things stand

Phase 1 succeeded. The original goal — "measure real throughput across AirVPN US servers so
production VPN selection can be informed by real data" — is effectively done. The stack has been
running on the NAS since **2026-05-08** and has collected:

- **371 completed sessions** (each = 3 back-to-back runs → ~1,100 individual tests)
- **602 hourly server-load snapshots**
- **25 days of logs**

The old VPN-tunnel blocker is **resolved** (fixed weeks ago — `waitForTunnel` warm-up against the
gluetun control API + container-exit detection treated as a skip). It is no longer a blocker. The
full blow-by-blow history of the pre-deploy bug fixes (the P0.5 / P0 / P1 checklists and the
"Session Complete 2026-05-07" work) is archived in
[`verified-completed-historical-only/`](verified-completed-historical-only/) — preserved, just no
longer front-and-center.

## Current decision

**Leave the NAS alone and let it keep collecting for ~60 more days. Revisit ≈ 2026-08-01.**
At that point decide: keep running / switch the speed tester off / move to automatic server
selection driven by the collected data.

> ⚠️ **Hold off on `./vpn deploy` until the deployment upgrade is in place.** The git reconciliation
> has now landed (local is the committed source of truth, `origin/master` in sync — see
> [this-is-my-mess/](this-is-my-mess/)), so the original "stale machine" risk is resolved. But the
> rsync deploy still has **no `--delete` and no excludes**, so a deploy now would re-push docs/cruft
> onto the freshly-pruned NAS and can't remove orphans. The durable fix is tracked in
> [deployment-upgrade-options.md](deployment-upgrade-options.md). Background on the drift this caused:
> [this-is-my-mess/laptop-experiment-keepers.md](this-is-my-mess/laptop-experiment-keepers.md).

---

## 🔴 Active priorities (2026-06-06)

1. **[RESOLVED 2026-06-06] Caddy reverse-proxy crash-loop.** The `caddy` container was stuck
   `Restarting` on `parsing caddyfile tokens for 'email': wrong argument count … at /etc/caddy/Caddyfile:2`.
   Root cause was deeper than first thought: **all three** Caddy env vars
   (`CLOUDFLARE_API_TOKEN`, `BASE_DOMAIN`, `ACME_EMAIL`) are `${...}` interpolations in the compose file
   but were **absent from Portainer's stored env**, so all three resolved empty — `email {$ACME_EMAIL}`
   collapsed to bare `email`. (Hence "worked on first publish, broke on restart": the values were never
   persisted.) **Fix:** the three vars were added to **Portainer's stored env** (durable — survives
   redeploys) and the stack redeployed; `ACME_EMAIL=nickdeckerdevs@gmail.com`. Caddy now serves all routes
   with a valid wildcard Let's Encrypt cert (`*.waitress.nickdeckerdevs.com`, valid → Aug 12 2026). Full
   write-up, route table, and runbook: [caddy-reverse-proxy/](caddy-reverse-proxy/).
   - *Note on the 9191/9192 question:* not a Caddy problem. `vpn-report → :9191` 502s **by design** — the
     vpn-speed-tester stack is intentionally off. The `:9192` "Homelab status" page is an unrelated service.
   - *Carried follow-ups (low priority):* (a) `zigbee2mqtt` route targets `:8080`, colliding with
     qbittorrent — likely should be `:8888`; (b) Immich container is live but has **no Caddy route** yet
     (repo `NickDeckerDevs/nas-photo-manager`); (c) optional friendly "service down" page for 502s /
     unmatched subdomains. All tracked in [caddy-reverse-proxy/](caddy-reverse-proxy/).

2. **Deployment upgrade — now unblocked.** The desktop/laptop reconciliation (the former blocker) has
   landed. Until the upgrade ships, the rsync deploy has no `--delete`/excludes, so the next `./vpn deploy`
   re-pushes docs/cruft to the NAS — i.e. don't deploy casually. Plan + options (leaning: GHCR + GitHub
   Actions + Portainer image-based deploy): [deployment-upgrade-options.md](deployment-upgrade-options.md).
   To be run as its **own deliberate plan**, after the Caddy issue.

---

## Next chapters

### Bring the data home
Read-only pull of the collected data from the NAS into a local `analysis/nas-data/` folder for
offline analysis — `./vpn fetch`. Does not touch the live stack. See
[`analysis/README.md`](../analysis/README.md).

### Analyze the data (open-ended)
Once local, dig in. Starting questions:
- Which server (and city) is fastest, and at what hours?
- Does a server's load % actually predict real throughput?
- Which servers are reliably good vs. flaky?
- Best time of day to connect for lowest load?

The existing report (`report/index.html`) already charts some of this.

### Deployment & repo-structure upgrade  → see "Active priorities" above
The current deploy flow (`./vpn deploy` = `rsync` **without `--delete`** and **without excludes**, run
from whichever machine, with **no git on the NAS code at all**) is the root cause of the drift documented
in [`this-is-my-mess/orchestrator-comparison.md`](this-is-my-mess/orchestrator-comparison.md). The leaning
fix is to **build our own Docker image** (GHCR + GitHub Actions building `linux/amd64` + a Portainer
redeploy webhook, reusing the Portainer already running on the ASUSTOR AS5404T), with pull-based git and
`rsync --delete` kept as lower-effort fallbacks. Full menu, verified environment, and trade-offs in
[deployment-upgrade-options.md](deployment-upgrade-options.md). **Now unblocked** — the desktop
reconciliation has landed and the real NAS code is committed; this is the active infra track (after Caddy).

### The pivot — media-stack control panel (green-lit)
Turn what this project learned into a single control panel for the whole media stack
(Jellyfin / qBittorrent / Radarr / Sonarr / …). Design captured in
[media-stack-manager-handoff.md](../media-stack/media-stack-manager-handoff.md). Core challenge: the production
stack shares **one** gluetun container across 7 services, so "switch VPN server" means recreating
gluetun *and* every attached service in the right order — reusing this repo's `gluetunManager.js`
machinery. This chapter supersedes the earlier standalone "automated production VPN switching" and
"React report frontend" ideas (now folded into the handoff doc).

---

## Considerations & Future Ideas

Tracked but not committed. Revisit as data accumulates.

| Idea | Notes |
|------|-------|
| **Smart scheduling** | Shift the test window to hours when target servers are historically low-load; build predicted load curves per server per hour. |
| **Unit tests** | `queueBuilder` priority logic, `aggregator` averages, `airvpnStatus` tier classification. |
| **Data retention** | Snapshots accumulate indefinitely. Define a max age (~90 days) + cleanup in the hourly cron. |
| **Error alerting** | Notify (Home Assistant / Mosquitto / Pushover) if a whole test window fails. |
| **Jitter/ping views** | Latency/jitter is collected but underrepresented in the report. |
| **International servers** | Architecture handles any AirVPN server by name; EU/AU could be a separate tier. |
| **Multiple entry IPs** | Currently always `ip_v4_in1`; testing the other 3 IPs could reveal WireGuard differences. |
| **Container health watchdog** | Detect a silent orchestrator (no logs for N hours mid-window) and restart/alert. |
| **Efficiency ratio in report** | `speed_efficiency_ratio` is collected but not prominently charted. |

---

*Historical detail: [`verified-completed-historical-only/`](verified-completed-historical-only/).*
