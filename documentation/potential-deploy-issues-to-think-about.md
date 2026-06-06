# Potential Deploy Issues to Think About

**Written:** 2026-06-06. **Status:** advisory — nothing here is implemented yet.
**Companion:** [desktop-vs-origin-findings.md](desktop-vs-origin-findings.md) (how we learned the
desktop == NAS source of truth).

---

## How we got here (the why)

We were reconciling a messy git situation: the live NAS runs code that exists in no commit, and this
desktop turned out to be the source of that code. During cleanup we want to **remove files we no
longer use** — old root shell scripts (`deploy.sh`, `test-manual.sh`, `view-report.sh`,
`view-data.sh`, `sync-local.sh`, `export-summary.sh`, `deployAndTestOne.sh`, `removed-deploy-test.sh`)
and the superseded `orchestrator/runner.js` + `orchestrator/infiniteRunner.js` (the orchestrator now
runs `node main.js --infinite`; the `vpn` CLI replaced the loose scripts).

These are already deleted on the desktop. They still exist on the NAS only because **deploys never
used `rsync --delete`** — every deploy is purely additive, so the NAS is an append-only pile of
current code + every file we ever stopped using.

**The goal:** start using `rsync --delete` so the NAS becomes a clean mirror of the repo (stale code
gets removed automatically).

**The fear (and it's a real past scar):** the user previously tried `--delete` and it **wiped the
report data**. That's why deploy was deliberately left without `--delete`. The question this doc
answers: *can we delete stale code without nuking the data the speed-tester generates?*

**Answer: yes — but only if every non-repo directory under the deploy root is excluded.** Two of them
exist, and missing either is how you lose data (or break the tunnel).

---

## Why `--delete` deleted the reports before

`rsync --delete` makes the destination an exact mirror of the source: any file on the NAS that isn't
in the local repo (and isn't excluded) gets **deleted**. The deploy syncs the *entire repo root* onto
the *entire stack directory*:

```
rsync $SCRIPT_DIR/  →  sysop@10.1.10.254:/volume1/Docker/vpn-speed-tester/
```

The generated data lives **inside that destination tree** (`data/`), but **not** in the local repo.
So a `--delete` with no `data/` exclude saw "NAS has `data/`, source doesn't → delete it," and wiped
results/snapshots/reports. The data was collateral damage of mirroring, not a bug in `--delete`.

The current `vpn deploy` ([vpn:103-114](../vpn#L103-L114)) already guards against this with
`--exclude='data/'` — but it does **not** use `--delete` at all, so stale code never gets cleaned.

---

## The map: what lives under the deploy root `/volume1/Docker/vpn-speed-tester/`

From [docker-compose.yml](../docker-compose.yml) bind mounts + [lib.sh](../lib.sh) (`NAS_DIR`):

| Path on NAS (under deploy root) | In local repo? | What it is | `--delete` risk |
|---|---|---|---|
| `orchestrator/`, `report/`, `docker-compose.yml`, `vpn*`, etc. | yes | the code we deploy | **intended** — stale files here *should* be removed |
| `data/` | no | results, raw runs, snapshots, logs, **and the served report** (`data/report/`). Mounted into all containers; nginx serves it. | **DATA LOSS** if not excluded |
| `gluetun-speedtest/` | no | gluetun runtime + **WireGuard keys** | **TUNNEL BREAKS** if not excluded |
| `node_modules/` | no | installed deps | rebuild churn if not excluded |
| `.env` | no (git-ignored) | secrets the stack needs | currently synced (not excluded); fine as long as local `.env` exists |

The first row is the *point* of `--delete`. Every other row must be protected.

---

## The two landmines

1. **`data/` — the one that already bit us.** Holds every result, snapshot, log, and the live report
   HTML (`data/report/`). Already excluded in deploy. An excluded directory (trailing slash,
   `--exclude='data/'`) is also **protected from `--delete`** — its whole subtree is left untouched.
   *Do not add `--delete-excluded`*, which would override that protection.

2. **`gluetun-speedtest/` — the one not yet handled.** WireGuard keys + gluetun runtime state. It is
   **not in the repo** and **not currently excluded**. The moment you add `--delete` without also
   excluding it, the next deploy deletes your keys and the tunnel dies. The snapshot README lists
   "the gluetun runtime/key dirs" among the things that exist on the NAS but not in code — this is
   that directory.

---

## Safe recipe (proposed, not yet implemented)

1. On the **main code rsync** ([vpn:107-114](../vpn#L107-L114)) add `--delete` **and**
   `--exclude='gluetun-speedtest/'`, keeping the existing excludes. The separate
   `report/ → data/report/` rsync stays **without** `--delete`.

   ```sh
   rsync -avz --delete -e "$RSYNC_SSH" \
     --exclude='.git' \
     --exclude='node_modules' \
     --exclude='.local-staging' \
     --exclude='data/' \
     --exclude='gluetun-speedtest/' \
     "$SCRIPT_DIR/" \
     "$NAS:$NAS_DIR/"
   ```

2. **Always dry-run first.** `-n` previews the exact deletion list without changing anything:

   ```sh
   rsync -avzn --delete -e "$RSYNC_SSH" \
     --exclude='.git' --exclude='node_modules' --exclude='.local-staging' \
     --exclude='data/' --exclude='gluetun-speedtest/' \
     "$SCRIPT_DIR/" "$NAS:$NAS_DIR/"
   ```

   Confirm every `deleting …` line is a stale **code** file (`deploy.sh`, `runner.js`,
   `infiniteRunner.js`, the old `*.sh`) and that **nothing** under `data/` or `gluetun-speedtest/`
   appears. Only then drop the `-n`.

3. Consider gating `--delete` behind a flag (e.g. `./vpn deploy --prune`) so the everyday deploy stays
   additive and destructive cleanup is an explicit, deliberate choice.

---

## Open questions / things to still verify

- **Is `.env` better excluded?** It's currently synced from the laptop. With `--delete` that's fine
  *if* the local `.env` is always present and current. If the NAS `.env` is ever the source of truth,
  exclude it so a deploy can't clobber/remove it. **(decide before enabling `--delete`)**
- **Are there other non-repo dirs under `NAS_DIR`?** The dry-run is the authoritative check — it lists
  everything `--delete` would remove. Treat anything surprising as a new landmine, not noise.
- **Order of operations for cleanup:** removing the stale files from the NAS can be done two ways —
  (a) `rm`-by-explicit-path over SSH (surgical, no rsync risk), or (b) the `--delete` deploy above.
  (a) is safer for a one-time purge; (b) keeps the NAS clean on every future deploy. They're not
  mutually exclusive.
