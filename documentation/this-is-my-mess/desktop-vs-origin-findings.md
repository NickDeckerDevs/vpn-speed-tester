# Desktop ↔ Origin ↔ NAS — Findings

**Session:** 2026-06-06 (desktop machine). Fulfills the deliverable requested in
`desktop-investigation-handoff.md`.
**Mandate honored:** read-only. No NAS writes, no deploy/rsync/sync, no commits, no merge/checkout/
reset. The uncommitted working tree was backed up to `../vpn-speed-tester.backup-20260606`
(byte-verified) before anything else ran. `git fetch origin --prune` was run (refs-only; working tree
and local `master` confirmed unchanged afterward — still 21 entries, still at `9f6162c`).

Grading: **confirmed** = byte-identical / direct evidence · **inferred** = strong indirect signs ·
**unknown** = could not determine.

---

## 1. Top takeaways

- **This desktop IS the source of the NAS-running code.** Its working tree is byte-identical to the
  frozen NAS snapshot (`origin/master:analysis/nas-snapshot/`) for *every* orchestrator module and the
  operational layer — **except two files** (the control-panel UI, where the desktop is *newer*).
  **(confirmed)**
- The contested pieces from the handoff are all here and all match the NAS: hardcoded
  `GLUETUN_ACCEPTED_AIRVPN_SERVERS` in `config.js`, hardcoded `getAcceptedServers()`,
  `rebuildResults.js`, `vpn`, `lib.sh`, `MAX_CONSECUTIVE_FAILURES = 5`. **(confirmed)**
- **Desktop is *ahead* of the NAS by one feature:** `vpn-ui` + `vpn-ui.html` add a "Restart UI"
  button / `POST /api/restart` endpoint (hot-restart of the control panel) that the NAS snapshot
  lacks. This work exists **on the desktop only** — not on the NAS, not in any commit. **(confirmed)**
- **The NAS is the desktop's code PLUS leftovers the user is mid-way through removing.** The desktop
  deliberately deleted the old shell scripts + `runner.js`/`infiniteRunner.js` because they're unused;
  the NAS still carries them only because deploys never used `--delete`. **Per the user, the next
  planned step is to remove them from the NAS too, for a cleaner install.** Nothing invokes them in
  the current lineage. **(confirmed — stated intent, not stale accident)**
- **This clone's `origin/master` was stale.** Before the fetch it equalled local `HEAD` (`9f6162c`).
  After the fetch it is `48825ca`, two commits ahead, carrying the laptop's entire `analysis/`
  investigation (incl. the `nas-snapshot/`) and a rewritten `documentation/`. The "wildly different"
  master you saw on GitHub is that push. **(confirmed)**
- `origin/laptop-experiment` is a *separate* lineage (single `runner.js`, dynamic-fetch
  `getAcceptedServers`, `MAX_CONSECUTIVE_FAILURES = 3`, no hardcoded list). It is **not** what runs on
  the NAS. **(confirmed)**
- Nothing here is lost or at risk: the uncommitted tree is captured twice (filesystem backup + this
  doc's hash record). **(confirmed)**

---

## 2. Provenance map (per contested piece)

| Piece | On desktop? | vs NAS-snapshot | vs origin/master | vs laptop-experiment |
|---|---|---|---|---|
| `config.js` (hardcoded ~249-server list) | yes | **identical** | differs (master has no list) | differs (never had it) |
| `gluetunManager.js` — hardcoded `getAcceptedServers()` | yes | **identical** | differs (master = dynamic fetch) | differs (no such fn) |
| `MAX_CONSECUTIVE_FAILURES` | `5` | **= 5** | = 5 | = 3 |
| `rebuildResults.js` (used by `vpn:300`) | yes | **identical** | absent on master | absent on laptop |
| `vpn` (CLI) | yes | **identical** | absent | absent |
| `lib.sh`, `README.md` | yes | **identical** | absent | absent |
| `vpn-ui` | yes | **DIFFERS — desktop newer** (+`/api/restart`) | absent | absent |
| `vpn-ui.html` | yes | **DIFFERS — desktop newer** (+"Restart UI" button) | absent | absent |
| all other `orchestrator/*.js`, `report/index.html`, `docker-compose.yml` | yes | **identical** | varies | varies |

**Origin lineage:** `origin/master@48825ca` = the laptop's analysis deliverables + frozen NAS snapshot
+ rewritten docs (it does **not** contain the live operational code as tracked files — that lives only
in the `analysis/nas-snapshot/` reference copy). `origin/laptop-experiment` = the abandoned/parallel
refactor.

---

## 3. Desktop-only work (exists on neither the NAS nor any commit)

- **`vpn-ui` / `vpn-ui.html` "Restart UI" feature** — the only desktop-only *code*. ~19 lines each:
  a `POST /api/restart` handler that re-spawns the control-panel server detached, plus a button that
  POSTs then polls `/api/commands` until the server is back, then reloads. Self-contained; touches
  nothing else.
- `.claude/settings.json`, `.claude/settings.local.json` — local harness config (intentionally
  excluded from the snapshot).
- `.local-staging/` — git-ignored local mirror of NAS data (logs/results/snapshots, 2026-05-08…14).
  Data artifact, not code.

## 4. NAS-snapshot files the desktop dropped (don't assume safe — graded)

Present on the NAS snapshot, absent from the desktop working tree:

- Root scripts: `deploy.sh`, `deployAndTestOne.sh`, `export-summary.sh`, `removed-deploy-test.sh`,
  `sync-local.sh`, `test-manual.sh`, `view-data.sh`, `view-report.sh`, `package-lock.json`.
- `orchestrator/runner.js`, `orchestrator/infiniteRunner.js`.
- Top-level duplicates of three historical docs (the desktop keeps these under
  `documentation/verified-completed-historical-only/`).

**Assessment (confirmed intent):** the user removed these on the desktop **on purpose** — they're
unused, superseded by the desktop's consolidation (the `vpn` CLI replaced the individual shell
scripts; `package.json` runs `node main.js --infinite`, not `runner.js`/`infiniteRunner.js`). Grep
confirms `vpn`/`vpn-ui`/`docker-compose`/`main.js` invoke **none** of them (only `rebuildResults.js`,
which is present and kept). So these are not "stale accidents" to preserve — they were pending cleanup.
**→ DONE 2026-06-06: removed from the live NAS (full backup taken first), and the scope was broadened
to remove *all* docs/`.md` from the NAS. See §7 for the execution record.**

## 5. Gaps / unknowns

- **Live-NAS re-verification not performed.** Findings are against the 2026-06-05 `nas-snapshot`, not
  a fresh read of the live NAS. If the NAS changed since 2026-06-05, the two UI files (or others)
  could have drifted again. *To close: read-only SSH `cat`/`hash` of `config.js`, `vpn-ui`,
  `vpn-ui.html` on the NAS and compare to disk.* **→ Partially closed 2026-06-06:** a full live
  read-only inventory of the NAS deploy dir was performed during the prune (§7); the live tree matched
  expectations (and the doc-copy hashes were compared three ways before deletion).
- Whether the desktop's "Restart UI" feature was ever *intended* for the NAS or was a local-only
  convenience is **unknown** (no commit message / note exists — it was never committed).

---

## 6. Proposed reconciliation — ✅ EXECUTED 2026-06-06

> **Status update:** what was proposed below was carried out. Items 1 & 3 happened as the
> git reconciliation (local committed as source of truth, then `origin/master` merged in — docs
> quarantined into `documentation/this-is-my-mess/`, media-stack staged). Item 2 (NAS leftover
> removal) was executed as the prune in **§7**. Item 4 (`laptop-experiment`) remains parked.

The original low-risk path (kept for the record):

1. **Capture the live code on a branch off the current desktop tree** (which == NAS + the newer UI):
   `git switch -c nas-truth` → stage the working tree (the modifications, the deletions, and the
   untracked `vpn`/`vpn-ui`/`vpn-ui.html`/`rebuildResults.js`/`lib.sh`/`README.md`) → commit. This
   makes git finally contain the running system, with the desktop's UI improvement included.
2. **NAS-only leftovers** (`runner.js`, `infiniteRunner.js`, old scripts) — already removed on the
   desktop on purpose; don't re-add them to the branch. **Separately, the user plans to remove them
   from the NAS** for a cleaner install — a deliberate, read-write NAS action to schedule on its own,
   ideally `rm`-by-explicit-path (never a `--delete` rsync) after confirming nothing exec's them.
3. **Integrate the laptop's `analysis/` + docs** from `origin/master@48825ca` separately (merge or
   cherry-pick) once the truth branch exists, so the investigation artifacts and the real code live
   in one history.
4. **`origin/laptop-experiment`** stays a parked alternative; evaluate adopting its dynamic-fetch
   server filtering as a *future* change, reconciled to the NAS deliberately.

**The NAS is never modified by any of the above.** All of it is local git history only.

---

## 7. NAS prune — EXECUTED 2026-06-06

Carried out live after the NAS returned from a system update, step-by-step, with a full backup as a
hard gate. Scope was **broadened per the user**: no docs/`.md` belong on the NAS — keep only what
deploys, runs, and serves the report.

**Backup (taken before any deletion):** `sudo tar` of the *entire* deploy dir incl. `data/` →
`/volume1/Docker/vpn-speed-tester-backup-20260606.tar.gz` (9.6 MB, 4053 entries), verified and pulled
to the desktop as a repo sibling (`../vpn-speed-tester-backup-20260606.tar.gz`, gzip-checked, 4053
entries). Fully recoverable.

**Removed** (explicit-path `rm` — no globs, no `--delete`, no rsync):
- Root scripts (`deploy.sh`, `deployAndTestOne.sh`, `export-summary.sh`, `removed-deploy-test.sh`,
  `sync-local.sh`, `test-manual.sh`, `view-data.sh`, `view-report.sh`) + root `package-lock.json`.
- `orchestrator/runner.js`, `orchestrator/infiniteRunner.js`.
- **All Markdown/docs:** `CLAUDE.md`, `README.md`, `VIEWING_REPORTS.md`, and the whole `documentation/`
  tree (the three top-level historical docs *and* their `verified-completed-historical-only/` copies).
  (Hash check first: only `fix-queue-and-startup-logic.md` matched byte-for-byte; the other two
  top-level copies were stale older drafts whose current versions live in the subfolder + git — all
  captured in the backup regardless.)
- Cruft: `.claude/` (harness config), root `report/` (passenger copy; the *served* report is
  `data/report/`), and placeholder `logs/` + `snapshots/` (each only an empty `ignorethis.md`).
- gluetun artifacts: `gluetun/` (May-14 `auth.toml`) and `gluetun-test/` (May-7 leftover) — neither
  mounted by `docker-compose.yml`.

**Kept (verified present after):** `data/` (results, served `data/report/`, `data/logs/` [26],
`data/snapshots/` [604]); **`gluetun-speedtest/`** — the live mount, `auth/` + the **Jun-2
`servers.json`**, untouched; `orchestrator/` code incl. `rebuildResults.js`; `docker-compose.yml`;
`.env`/`.env.example`/`.gitignore`; and the laptop tooling (`vpn`/`vpn-ui`/`vpn-ui.html`/`lib.sh`).

**Stack unaffected:** file-level only. `docker ps -a` afterward showed identical container state
(`orchestrator` Up; `gluetun-speedtest`/`speedtest-runner` Exited-between-windows, normal) — the running
system was not disturbed, exactly as expected with the baked image.

**Deploy left untouched (deliberate).** Until the image-based deploy upgrade lands, the next
`./vpn deploy` will re-push docs/cruft (the rsync still has no excludes). Accepted for now; the durable
fix belongs to the deploy-upgrade plan — see [deployment-upgrade-options.md](../deployment-upgrade-options.md).

**Bonus (same session):** live-tested `./vpn fetch` (the data pull folded out of `fetch-nas-data.sh`)
and fixed a real bug — it used `bash -c`, but the NAS is busybox (no `bash`); switched to `sh -c`.
`./vpn fetch` now pulls results/raw/server-data/accepted/unreachable + snapshots into
`analysis/nas-data/` (609 files).
