# Media Stack — the next chapter (staging)

This folder holds the seeds of the **media stack** project, which runs in parallel to — and is
the *reason for* — the VPN speed-tester. The speed-tester exists to harden gluetun + the
container lifecycle and to learn how to pick/switch AirVPN servers reliably; the lessons and
machinery proven here (e.g. `gluetunManager.js`, `qbtClient.js`, `logger.js`, the server-load
tiering) get translated into the media stack, where a shared gluetun tunnel fronts a set of
media services that need to check in on themselves and change servers when needed.

Work on this begins **after** the speed-tester wrap-up (NAS prune + this git reconciliation)
lands. Until then these are reference/planning artifacts, kept here so they aren't lost — they
are not wired into this repo's `docker-compose.yml`.

## Files

| File | What it is |
|------|------------|
| `media-stack-manager-handoff.md` | Design/handoff for a unified control panel over the media stack (qBittorrent, Radarr, Sonarr, Lidarr, Prowlarr, byparr, speedtest-tracker) behind a shared gluetun. Notes which speed-tester modules are reusable. **Not yet built.** |
| `2026-06-01_media-server.yaml` | Draft docker-compose for that media stack (caddy + gluetun + the media services). A template for the next project — **not** the speed-tester's compose file. |
