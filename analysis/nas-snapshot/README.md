# VPN Speed Tester

Node orchestrator that runs nightly speed tests against AirVPN US WireGuard servers from a Synology NAS. Cycles a single `gluetun` container through each server, runs `speedtest-cli` from a sibling container sharing gluetun's network namespace, and writes results to JSON files served by an nginx report container.

There is no local dev loop for the orchestrator — it must run on the NAS because it talks to the local docker socket, gluetun's control API, and a LAN qBittorrent instance. You drive everything from your laptop via the `./vpn` script.

## Live target

| Thing | Where |
|---|---|
| NAS SSH | `sysop@10.1.10.254:8322` |
| Stack files | `/volume1/Docker/vpn-speed-tester/` |
| Data files | `/volume1/Docker/vpn-speed-tester/data/` |
| Report | http://10.1.10.254:9191 |

## One command, many actions

Everything runs through `./vpn <subcommand>`:

| Command | What it does |
|---|---|
| `./vpn deploy` | rsync repo to NAS, `docker compose down`, `up -d --build` |
| `./vpn deploy --check` | container status only, no deploy |
| `./vpn test` | run one manual speed-test window (`main.js --manual`) |
| `./vpn test --infinite` | loop all servers continuously (`main.js --infinite`) |
| `./vpn logs` | tail today's orchestrator log from the NAS |
| `./vpn servers` | list the AirVPN server names gluetun will accept |
| `./vpn check` | status of all four containers on the NAS |
| `./vpn report` | rsync the report HTML from NAS and open it (file://) |
| `./vpn local` | sync NAS data to `.local-staging/` and serve on :9191 |
| `./vpn local --sync` | sync only |
| `./vpn local --serve` | serve only |
| `./vpn help` | show the table |

### First-time setup

1. Copy `.env.example` (or hand-roll) into `.env`. Required keys:
   - `WIREGUARD_PRIVATE_KEY`, `WIREGUARD_PRESHARED_KEY`, `WIREGUARD_ADDRESSES` — from AirVPN's config generator.
   - `QBT_BASE_URL`, `QBT_USERNAME`, `QBT_PASSWORD` — the LAN qBittorrent WebUI; paused during the test window.
   - `SYSOP_SSH` — NAS sudo password.

   **Secrets containing `$` must be single-quoted** in `.env` so they pass through every shell hop literally.

2. Generate an SSH key for the NAS and install the pubkey on `sysop@10.1.10.254`:
   ```
   ssh-keygen -t ed25519 -f ~/.ssh/id_nas
   ssh-copy-id -i ~/.ssh/id_nas -p 8322 sysop@10.1.10.254
   ```

3. Deploy and smoke-test:
   ```
   ./vpn deploy
   ./vpn check
   ./vpn test           # one speed-test session
   ./vpn report         # see the result
   ```

## What gets deployed

Four containers on the `vpn-speedtest` bridge network:

- **`gluetun-speedtest`** — qmcgaw/gluetun WireGuard tunnel. The orchestrator rewrites `SERVER_NAMES` and recreates this container on every server switch.
- **`speedtest-runner`** — node-slim with `speedtest-cli`, attached to gluetun's network namespace so all traffic egresses through the VPN.
- **`orchestrator`** — drives the other two via the docker socket; stays on the bridge so it can hit gluetun's control API and qBittorrent.
- **`vpn-report`** — nginx serving `data/` on port 9191.

For the deeper architecture (control flow, failure handling, conventions), see [CLAUDE.md](CLAUDE.md) and [`documentation/`](documentation/).

## Where data lives

Under `/volume1/Docker/vpn-speed-tester/data/` on the NAS (served by `vpn-report` at port 9191):

- `results.json` — flat array of session records, one per server-test window. The report renders from this.
- `raw-results.json` — every individual `speedtest-cli` JSON, keyed by `{timestamp}_{run}-{total}`.
- `server-data.json` — AirVPN status snapshot at the moment each session began.
- `accepted-servers.json` — cache of gluetun's accepted AirVPN server names. Used to filter the queue when gluetun is briefly unreachable.
- `snapshots/YYYYMMDDHH.json` — hourly AirVPN status dumps.
- `logs/YYYY-MM-DD.log` — daily orchestrator logs.

## Troubleshooting

**`SESSION SKIP: tunnel issue — gluetun-speedtest exited` for every server.**
The queue is probably picking servers gluetun's bundled config doesn't support. Check:
```
./vpn servers
```
If that returns server names, gluetun's API is healthy. If `./vpn test` still skips, look in the log for `resolveAcceptedServers: ... falling back to cached list` or `proceeding without server filtering` — that means the disk cache at `data/accepted-servers.json` is missing or empty. Run `./vpn test` once; the first successful in-window fetch populates the cache for subsequent runs.

**`getAcceptedServers` errors with `container not found` or `not running`.**
The accepted-server fetch runs via `docker exec` into the gluetun container (gluetun's auth middleware doesn't whitelist the `/v1/servers/airvpn` route, so cross-container HTTP isn't an option). If gluetun-speedtest is exited or missing, `./vpn check` will show it, and the fix is to recreate the base stack with `./vpn deploy`.

**qBittorrent doesn't pause / resume around the window.**
Check `QBT_BASE_URL`, `QBT_USERNAME`, `QBT_PASSWORD` in `.env`. Any `$` in the password must be single-quoted.

**SSH hangs forever after `./vpn deploy`.**
`~/.ssh/id_nas` is missing or the pubkey isn't in the NAS's `authorized_keys`. The script falls back to a password prompt which can't read in non-interactive shells.

## Pointers

- [CLAUDE.md](CLAUDE.md) — working agreements when editing code in this repo.
- [`documentation/`](documentation/) — full specs (`vpn-speed-tester-spec.md`, `front-end-reporting.md`, `project-files.md`, `roadmap-working.md`).
