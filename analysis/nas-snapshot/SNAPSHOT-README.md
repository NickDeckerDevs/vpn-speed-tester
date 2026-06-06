# NAS Snapshot — read-only reference (2026-06-05)

This directory is a **frozen, read-only copy of the code on the live NAS** as of 2026-06-05,
captured for comparison only. It is the deterministic reference the desktop investigation diffs
against (see `../desktop-investigation-handoff.md`).

## What this is / isn't

- **Is:** the NAS's actual on-disk code — `orchestrator/*.js` (including the uncommitted
  `rebuildResults.js` and the hardcoded-list `config.js`), the operational layer (`vpn`, `vpn-ui`,
  `vpn-ui.html`), and the root scripts/docs that were on the NAS.
- **Is NOT:** a deployable tree, and **NOT asserted to be complete or canonical.** The NAS is an
  append-only pile (deploys never used `--delete`), so some files here may be stale leftovers and
  some "truth" may live only on the desktop. **Assume nothing.**

## Excluded from the snapshot

- `data/` (79 MB of results/snapshots/logs — pulled separately, git-ignored under `nas-clone/`)
- `node_modules/`, the gluetun runtime/key dirs, `.env`, `.claude/`

## Hard rules

- This is reference material. **Nothing here gets deployed back. The NAS is never modified.**
- Do not conclude any file is "unused" or "safe to delete" from this snapshot alone — manual
  `docker exec` and the `vpn`/`vpn-ui` browser panel invoke code outside `require()` graphs.
