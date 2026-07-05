# RETIRED — test phase closed 2026-07-05

The NAS deployment of the speed tester was decommissioned on 2026-07-05:

- **Data archived:** full `data/` (371+ sessions, 602+ snapshots, logs) pulled to
  `analysis/nas-data/` on the laptop, and the whole NAS directory tarred to
  `/volume1/Docker/vpn-speed-tester-final-20260705.tar.gz` (a 2026-06-06 tarball also exists).
- **Containers removed:** `gluetun-speedtest`, `speedtest-runner`, `orchestrator`, `vpn-report`
  (+ the `vpn-speed-tester_vpn-speedtest` network). Port 9191 and subnet 172.21.0.0/24 freed.
- **What lives on:** the Phase-2 advisor/auto-switch code (`orchestrator/switchAdvisor.js`,
  `switchDecider.js`, `mediaSwitch.js`, `media-stack/switch-policy.json`, ~110 tests) is the
  planned VPN-switch brain for the media stack. Integration target:
  `NickDeckerDevs/homelab` → `stacks/media-download` (see that repo's
  `docs/2026-07-05-restructure.md`, Phase 7).

The NAS itself is now managed by the **`NickDeckerDevs/homelab`** monorepo
(five git-backed Portainer stacks). This repo is kept as the code source for the
orchestrator and the historical record of the measurement campaign.

Tag: `test-phase-complete`.
