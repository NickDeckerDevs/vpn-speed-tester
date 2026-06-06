# This Is My Mess — the laptop/desktop/NAS git divergence

> A short, honest record of how the git history got tangled in late May / early June 2026,
> how it was untangled, and what each document in this folder is. Quarantined here so the
> rest of `documentation/` stays about *running the project*, not about the kerfuffle.

## What happened (the short version)

The VPN speed-tester runs on the NAS, deployed by `rsync` from a laptop — and `rsync` was
**never run with `--delete`**, and the NAS has **no git**. So "what's deployed" slowly drifted
away from "what's committed," across **three** copies of the code that stopped agreeing:

- **Desktop working tree** — the real source of the code running on the NAS (the `./vpn` CLI
  consolidation, the hardcoded gluetun accepted-server list, `rebuildResults.js`, `main.js
  --infinite`, the flattened report paths). None of it was committed for a while.
- **`origin/master`** — had been pushed with the *investigation* deliverables (this `analysis/`
  tree + the frozen `nas-snapshot/`) and refreshed roadmap docs, but **not** the live
  operational code as tracked files.
- **`origin/laptop-experiment`** — a parallel refactor (single `runner.js`, dynamic
  `getAcceptedServers`, `MAX_CONSECUTIVE_FAILURES = 3`) that is **not** what runs on the NAS.

A read-only investigation (handoff → findings below) byte-compared all three and concluded:
**the desktop is the source of the NAS-running code.** We then committed the desktop tree as
the source of truth (7 themed commits), and on 2026-06-06 **merged `origin/master` into local
`master` with local as truth** — integrating the investigation/roadmap docs without letting any
operational code regress (verified against the `pre-origin-merge-20260606` tag).

The remaining loose end is a separate, deliberate **NAS prune** of leftover files the deploys
never deleted (tracked elsewhere; paused while the NAS is mid-update).

## The documents in this folder

| File | What it is |
|------|------------|
| `desktop-investigation-handoff.md` | The brief that kicked off the investigation — a strict **read-only** mandate (don't touch the NAS), with instructions to byte-compare desktop vs NAS-snapshot vs origin and grade every claim confirmed/inferred/unknown. |
| `desktop-vs-origin-findings.md` | The investigation **deliverable** — the three-way provenance map, what's desktop-only (the `vpn-ui` "Restart UI" feature), and the proposed (not-yet-executed) reconciliation. The primary "here's what's actually going on" document. |
| `orchestrator-comparison.md` | Byte-level comparison of the orchestrator modules across NAS ↔ `master` ↔ `laptop-experiment`, quantifying exactly what drifted (hardcoded list, `rebuildResults.js`, `runner.js`). |
| `server-drift-findings.md` | Analysis of the gluetun gap — the hardcoded accepted-server list excludes ~16 of the fastest (20 Gbps) AirVPN US servers; explains why the list is what it is and what it costs. |
| `laptop-experiment-keepers.md` | A salvage checklist: which ideas from the abandoned `laptop-experiment` branch are worth re-porting later, and which origin/desktop behaviors must **not** regress when doing so. |

## Where related material lives (not in this folder)

- **`analysis/nas-snapshot/`** — the frozen, read-only byte-for-byte copy of the NAS code the
  findings are based on (kept in `analysis/` as the deterministic reference).
- **`analysis/README.md`, `analysis/data-analysis-findings.md`** — the *data* products (real
  speed results), which are operational, not part of "the mess."
- **`documentation/roadmap-review.md` / `.html`, `roadmap-working.md`, `deployment-upgrade-options.md`,
  `potential-deploy-issues-to-think-about.md`** — forward-looking planning that came out of this
  episode but is about *next steps*, so it stays in `documentation/`.
- **`origin/laptop-experiment`** — left parked as a branch; not merged.
