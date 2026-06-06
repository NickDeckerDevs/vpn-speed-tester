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
which is present and kept). **The user's stated next step is to remove them from the NAS as well**, to
get a cleaner install. So these are not "stale accidents" to preserve — they are pending cleanup. (The
NAS removal is a separate, deliberate action to be done with care; this session does not touch the
NAS.)

## 5. Gaps / unknowns

- **Live-NAS re-verification not performed.** Findings are against the 2026-06-05 `nas-snapshot`, not
  a fresh read of the live NAS. If the NAS changed since 2026-06-05, the two UI files (or others)
  could have drifted again. *To close: read-only SSH `cat`/`hash` of `config.js`, `vpn-ui`,
  `vpn-ui.html` on the NAS and compare to disk.* **(unknown until checked)**
- Whether the desktop's "Restart UI" feature was ever *intended* for the NAS or was a local-only
  convenience is **unknown** (no commit message / note exists — it was never committed).

---

## 6. Proposed reconciliation — NOT executed (for your approval later)

Goal restated by you: *preserve now, decide later.* Preservation is done (backup + this record).
When you choose to reconcile git to reality, the low-risk path:

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
