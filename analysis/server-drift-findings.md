# Server Reachability Drift — Findings

_Generated 2026-06-05 from local NAS clone at `/Users/inbound/repos/vpn-speed-tester/nas-clone/`. No SSH performed; all data read from the local clone._

## Top takeaways

1. **The gluetun gap is real and structural: 16 of 46 live AirVPN US servers (35%) are unreachable** because they are absent from gluetun's bundled AirVPN server list. The orchestrator can only test 30 of the 46.
2. **The unreachable 16 are exactly the high-value servers.** Every unreachable server is a **20 Gbps (`bw_max: 20000`) low-load** node. Every *reachable* server is a 2 Gbps (`bw_max: 2000`) node (plus one 6 Gbps, Polis). We are systematically excluding the fastest, least-congested US servers from the speed study — the opposite of what the project wants.
3. **The lists themselves are stable, not drifting.** As of the most recent window (`2026-06-02T07:00Z`) the split is 30 accepted / 16 unreachable, and the gluetun accepted universe is a fixed 249 names. Membership is determined by a **hardcoded list in `config.js`** (`GLUETUN_ACCEPTED_AIRVPN_SERVERS`), not a live fetch — so it cannot drift on its own; it only changes when gluetun is upgraded and the list is manually regenerated.
4. **Code/data mismatch worth flagging:** `accepted-servers.json` is labeled `"source": "gluetun-control-api"`, but the live `getAcceptedServers()` in `gluetunManager.js` actually returns the **hardcoded** `config.GLUETUN_ACCEPTED_AIRVPN_SERVERS`. The dynamic control-API fetch (`GLUETUN_SERVERS_URL = /v1/servers/airvpn`) is defined in config but **not used** by the running filter (the function is a `TEMPORARY` stub per its own docstring). So the `"source"` label is misleading.

## 1. Current contents of the two memory files

### `data/accepted-servers.json`
- `generated_at`: `2026-06-02T07:00:00.566Z`
- `source`: `"gluetun-control-api"` (see caveat #4 above — actually the hardcoded list)
- `count`: **249** — this is the full gluetun-accepted universe (all regions, not US-only), a flat array of server names (no per-server timestamps or reasons). Matches `config.GLUETUN_ACCEPTED_AIRVPN_SERVERS` verbatim.

### `data/unreachable-servers.json`
- `generated_at`: `2026-06-02T07:00:02.770Z`, `window_start`: `2026-06-02T07:00:00.507Z`
- Structure: a per-window report with counts plus two name arrays. No timestamps or free-text reasons per server — the implicit reason is "live AirVPN US server not present in gluetun's accepted list."
- `gluetun_accepted_count`: 249 · `airvpn_us_count`: 46 · `accepted_us_count`: 30 · `unreachable_count`: 16

**Unreachable (16):** Dziban, Guniibuu, Khambalia, Maia, Meridiana, Muliphein, Paikauhale, Revati, Sadalmelik, Sadalsuud, Sarin, Sheratan, Torcular, Unukalhai, Unurgunite, Xamidimura

**Accepted US (30):** Aladfar, Aquila, Ascella, Bunda, Chamaeleon, Chertan, Elkurud, Equuleus, Fang, Giausar, Helvetios, Hercules, Imai, Kruger, Leo, Libra, Meleph, Mensa, Musca, Pegasus, Polis, Praecipua, Ran, Sculptor, Scutum, Sneden, Superba, Ursa, Volans, Vulpecula

## 2. Drift over time

`data/.git` exists and is a full (non-shallow) repo. The git *binary* was not runnable in this environment (Bash disabled), so timeline was reconstructed from `data/.git/logs/HEAD` (the reflog), which records every commit.

- **Collection period:** continuous operation from **2026-05-08T03:00Z** (initial commit: "Aladfar diablo session 001") through **2026-06-02T07:30Z** (latest snapshot), ~25 days. Snapshots committed hourly at :30; speed-test sessions committed as "data: `<Server>` `<tier>` session NNN".
- **When the memory files appeared:** `config.js` changelog dates `ACCEPTED_SERVERS_PATH` / `UNREACHABLE_SERVERS_PATH` / `GLUETUN_SERVERS_URL` to **2026-05-14** — so these two files have only existed for the back half of the collection period.
- **Did servers move between accepted and unreachable?** Cannot diff individual historical revisions without the git binary. However: because the accepted set is sourced from a **hardcoded constant** (not a live probe), the accepted/unreachable partition is *deterministic given a fixed AirVPN US server set*. A server can only "move" if AirVPN adds/removes it from the US fleet, or gluetun is upgraded. There is no evidence of a gluetun upgrade in the period (the hardcoded list is unchanged in `config.js`). So the split is effectively **static at 30/16** for the whole time these files have existed, modulo AirVPN adding/retiring US servers.
- **Grow/shrink:** The accepted universe is pinned at 249. The US split is pinned at 30 accepted / 16 unreachable in the current file. No drift signal.

_Caveat: this section is inferred from the reflog + code, not from per-revision `git diff` output (binary unavailable). If the AirVPN US fleet changed size mid-period, older `unreachable-servers.json` revisions could show different counts — re-run `git -C nas-clone/data log -p -- unreachable-servers.json` when git is available to confirm._

## 3. The gluetun gap (quantified)

Universe of live AirVPN US servers from snapshot `2026-06-02-07.json` (`us_server_count: 46`) compared against gluetun's 249-name accepted list:

| | Count | bw_max |
|---|---|---|
| Live AirVPN US servers | 46 | mixed |
| Reachable (in gluetun list) | 30 | 29× 2000, 1× 6000 (Polis) |
| **Unreachable (gluetun gap)** | **16** | **16× 20000** |

**The gap is 16 servers = 34.8% of the US fleet, and it is not random.** Sorting the 46 servers by `bw_max`:
- All sixteen 20 Gbps servers → **unreachable** (Dziban, Guniibuu, Khambalia, Maia, Meridiana, Muliphein, Paikauhale, Revati, Sadalmelik, Sadalsuud, Sarin, Sheratan, Torcular, Unukalhai, Unurgunite, Xamidimura).
- All of these also run **low load** (16–33%, mostly "low" tier) with 13–17 Gbps of available capacity — i.e. the best-performing candidates.
- The reachable 30 are nearly all 2 Gbps boxes, many already saturated (several at 90%+ load / "diablo" tier).

Interpretation: AirVPN added a newer generation of 20 Gbps US servers (spread across Miami, Phoenix, LA, NYC, Chicago, Denver, SJC); gluetun's bundled server list predates them and so cannot route to any of them.

**Why I could not fetch gluetun's live list to double-check:** `GLUETUN_SERVERS_URL` is `http://gluetun-speedtest:8000/v1/servers/airvpn` — an in-cluster hostname only resolvable on the NAS docker network, not fetchable from here. The authoritative comparison list used by the running code is the hardcoded `config.GLUETUN_ACCEPTED_AIRVPN_SERVERS` (249 names), which I verified does **not** contain any of the 16 unreachable names and **does** contain all 30 accepted names. So the gap figure is exact for the current code, independent of the control API.

## 4. Conclusions & recommendations

- **Stable, not drifting.** The accepted/unreachable partition is deterministic off a hardcoded list and shows no sign of changing within the collection window. The "drift" risk here is not the file contents wobbling — it's that the hardcoded list **silently goes stale** as AirVPN adds servers, with no alert.
- **We are missing the most important servers.** The 16 excluded servers are precisely the high-bandwidth, low-load nodes the project most wants to characterize. The current dataset is biased toward congested 2 Gbps boxes. This materially undermines the project's stated goal (informing production VPN selection by real throughput).
- **Recommendations:**
  1. **Upgrade gluetun and regenerate the list.** Per the `config.js` TODO, bump the gluetun image and re-extract `GLUETUN_ACCEPTED_AIRVPN_SERVERS` from its startup error (or wire up the deferred `/v1/servers/airvpn` fetch). A current gluetun almost certainly includes these 16 servers.
  2. **Make `getAcceptedServers()` actually use the control API** (it already has a URL and an async signature reserved for exactly this) so the accepted set tracks gluetun automatically and `accepted-servers.json`'s `"source": "gluetun-control-api"` label becomes truthful.
  3. **Alert on gap growth.** Have the window log a warning when `unreachable_count` rises or when a newly-seen US server lands in the unreachable bucket, so staleness surfaces instead of silently biasing the data.

## Method / caveats

- All figures read directly from local files: `accepted-servers.json`, `unreachable-servers.json`, `snapshots/2026-06-02-07.json` (latest), `snapshots/index.json`, and code in `orchestrator/{config.js,gluetunManager.js,airvpnStatus.js,queueBuilder.js}`.
- **Bash was disabled in this environment**, so `jq`/`node`/`python3`/`git` could not be run. Counts (249, 46, 30, 16) are taken from the files' own self-reported fields and corroborated by manually reading the enumerated arrays; the 20 Gbps↔unreachable correlation was verified by reading every server entry in the latest snapshot.
- Git history was read from `data/.git/logs/HEAD` (reflog) rather than `git log`/`git diff`. Per-revision diffs of the two memory files were therefore **not** obtained; section 2's "no drift" conclusion is inferred from the deterministic (hardcoded-list) design plus a stable config, not from diffing historical file revisions. To confirm rigorously, run when git is available:
  `git -C nas-clone/data log -p -- accepted-servers.json unreachable-servers.json`
- gluetun's live `/v1/servers/airvpn` endpoint is only reachable on the NAS docker network and was not fetched; the comparison uses the hardcoded list the running code actually filters against.
- Snapshot used is a single point in time (2026-06-02); the AirVPN US fleet size (46) may have varied earlier in the period.
