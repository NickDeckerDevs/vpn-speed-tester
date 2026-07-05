> **⚠️ SUPERSEDED 2026-07-05** — test phase closed; the NAS is now managed by the `NickDeckerDevs/homelab` monorepo. See `RETIRED.md` and homelab `docs/2026-07-05-restructure.md`.

# What's next — June 2026 handoff

A snapshot of the open options so the next session can pick up cleanly. Source of truth
remains [roadmap-working.md](roadmap-working.md); this is the short, decision-oriented view.

## Where we are

- **Phase 1 is done.** The speed tester has run on the NAS since 2026-05-08: ~371 sessions,
  602 hourly snapshots, 25 days of logs. The original tunnel blocker is long resolved.
- **Standing decision:** leave the NAS collecting for ~60 more days, **revisit ≈ 2026-08-01**,
  then decide keep / stop / move to data-driven auto server-selection.
- **⚠️ Do not `./vpn deploy`** until the deployment upgrade lands — the rsync has no
  `--delete`/excludes and would re-push cruft onto the freshly-pruned NAS.

## 2026-06-07 — Phase 2 built (switch advisor + self-validation loop)

Big session. Built the load-aware **switch advisor** (recommend-only) + a **continuous self-validation
loop** on a Colima desktop runtime that grades the advisor against real speed tests. Highlights:
- `orchestrator/switchAdvisor.js` + `analysis/server-model.json` (the "cheat sheet") → `./vpn advise`.
- Validation loop runs in an orchestrator container (`docker-compose.desktop.yml` → `validationMain.js`),
  reusing `gluetunManager`/`speedTester`; rotates through the top-10; writes canonical data + a
  decision log. `./vpn dashboard` summarizes it. Full design: [desktop-validation-loop.md](desktop-validation-loop.md).
- ~75 tests, branch `feat/switch-advisor` (not yet merged). Loop is gathering balanced data (~2-week horizon).

**The live decision list now lives at the top of [roadmap-working.md](roadmap-working.md) ("Next
decisions").** This handoff is the short mirror.

## What we did earlier (2026-06-06)

- **Fixed the Caddy crash-loop.** Root cause: all three Caddy env vars
  (`CLOUDFLARE_API_TOKEN` / `BASE_DOMAIN` / `ACME_EMAIL`) were missing from **Portainer's
  stored env**, so the `email {$ACME_EMAIL}` directive collapsed. Fixed by adding them to
  Portainer's stored env (durable). Valid wildcard cert restored.
- **Named Immich.** Added `photos.waitress.nickdeckerdevs.com` (+ `immich.` alias) →
  `host.docker.internal:2283`, with bare `/` 302-redirecting to `/photos`. Immich phone app
  connects over the trusted HTTPS URL.
- **Removed the broken `zigbee2mqtt` route** (was colliding with qBittorrent on `:8080`).
- New reference docs: [caddy-reverse-proxy/](caddy-reverse-proxy/) (overview, live route
  table, add-a-service runbook, dated live-state snapshot).
- **Cross-repo note:** the Caddyfile edits also live in the separate `waitress` repo
  (`/Users/impulse/repos/waitress/stacks/Caddyfile`) — commit there too so repo == NAS.

## Options, by priority

### 1. Deployment & repo-structure upgrade  *(top active infra track)*
The deploy flow (`rsync` with no `--delete`/excludes, no git on the NAS code) is the root
cause of the past drift. Now **unblocked** (reconciliation landed). Leaning fix: **build our
own Docker image** → GHCR + GitHub Actions (`linux/amd64`) + a Portainer redeploy webhook,
with pull-based git / `rsync --delete` as fallbacks. Full menu:
[deployment-upgrade-options.md](deployment-upgrade-options.md). Should be its own deliberate plan.

### 2. Caddy / reverse-proxy follow-ups  *(low priority)*
- **Remote access** so Immich (and the rest) work off Wi-Fi — Tailscale or Cloudflare Tunnel.
  Currently LAN-only by design.
- **Friendly "service is down" page** for 502s / unmatched subdomains (`handle_errors` +
  catch-all). Sketch in [caddy-reverse-proxy/add-a-service-runbook.md](caddy-reverse-proxy/add-a-service-runbook.md).
- Optional `immich` exact-host tidy-ups; everything else is healthy.

### 3. Bring the data home + analyze
Read-only `./vpn fetch` pulls NAS data into `analysis/nas-data/` for offline analysis (does
not touch the live stack). Then dig into: fastest server/city by hour, does load% predict
throughput, which servers are reliably good, best time-of-day to connect. See
[../analysis/README.md](../analysis/README.md).

### 4. The pivot — media-stack control panel  *(green-lit)*
One control panel for the whole media stack, reusing this repo's `gluetunManager.js`. Core
challenge: production shares **one** gluetun across 7 services, so "switch server" means
recreating gluetun + every attached service in order. Design:
[media-stack-manager-handoff.md](../media-stack/media-stack-manager-handoff.md).

### 5. Considerations (parked)
Smart scheduling · unit tests (`queueBuilder`/`aggregator`/`airvpnStatus`) · data retention
(~90-day cleanup) · error alerting · jitter/ping views · international servers · multiple
entry IPs · container health watchdog · efficiency-ratio charting.

## Suggested next pick

See **"Next decisions"** at the top of [roadmap-working.md](roadmap-working.md) — that's the live menu.
In short, the strongest candidates now are: **let the validation loop gather a few days then revisit the
stay-zone policy**, **rebuild a desktop-calibrated model** (the NAS model is biased for this vantage), or
commit to **the deployment upgrade** (independent, unblocks the NAS Part-3 campaign + production).
