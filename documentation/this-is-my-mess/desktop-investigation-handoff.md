# Desktop Investigation — Handoff Brief

**For:** a fresh Claude Code chat running on the **desktop** machine.
**From:** the laptop session, 2026-06-05.
**Why you're reading this:** we need to find out what the *desktop* actually has, because the live
NAS is running code that exists in no git commit — and the desktop is the prime suspect for where it
came from.

---

## ⛔ READ THIS FIRST — ASSUME NOTHING

This investigation is **read-only and non-destructive**. The NAS "works really well right now" and
**must not be touched or broken**.

Hard rules:

1. **No rsync. No deploy. No sync. Nothing on the NAS changes — period.** All NAS access (if any) is
   read-only (SSH read / `tar`-to-stdout). Prefer working from git + the committed snapshot; only
   touch the NAS read-only if you truly must.
2. **Never declare a file "unused," "dead," or "safe to delete."** We already made that mistake: the
   laptop comparison called `runner.js` and `rebuildResults.js` orphans — but the NAS `vpn` CLI runs
   `node rebuildResults.js` (vpn:300), so it is clearly *used*, just via manual/UI invocation that
   `require()`-tracing can't see. Absence of a caller in the code graph is **not** proof of disuse.
3. **The NAS is not assumed complete. The desktop is not assumed a superset.** Either may hold things
   the other lacks. Report what you find; don't paper over gaps.
4. **Grade every claim:** mark each finding **confirmed** (byte-identical / direct evidence),
   **inferred** (likely from indirect signs), or **unknown**. Do not present inferences as facts.
5. **Make no changes to reconcile anything yet.** Your job is to *establish the picture*. Committing
   the real source tree comes later, deliberately, once we know what the desktop holds.

---

## TL;DR context (what the laptop found)

The NAS runs a **desktop-lineage** build that is **ahead of committed `origin/master`** and is not
captured by any commit. Specifically, the NAS has, living nowhere in git:

- A **hardcoded `GLUETUN_ACCEPTED_AIRVPN_SERVERS` list** inside `orchestrator/config.js` (~33 lines).
- `orchestrator/rebuildResults.js` (a real, vpn-invoked maintenance utility).
- A **hardcoded `getAcceptedServers()`** (returns `new Set(config.GLUETUN_ACCEPTED_AIRVPN_SERVERS)`).
  Committed `origin/master` instead has an *older, abandoned* dynamic-fetch version — so deploying
  origin to the NAS would **regress** server-filtering. (Don't do that.)
- An **operational layer** with no git presence: `vpn` (bash CLI: start/stop/test/logs/rebuild/
  servers), `vpn-ui` (Node browser control panel), `vpn-ui.html`. The user drove these by hand while
  watching tests during the day.

Full detail: `analysis/orchestrator-comparison.md`. Related findings:
`analysis/server-drift-findings.md` (the hardcoded list excludes the 16 fastest 20 Gbps servers) and
`analysis/data-analysis-findings.md` (speed results).

## What's in git for you to pull

```sh
git fetch origin
git log --oneline -5 origin/master          # has the docs + analysis/ deliverables
git branch -a                                # expect origin/laptop-experiment
```

- `origin/master` carries: the `analysis/` reports above, **`analysis/nas-snapshot/`** (a frozen,
  read-only copy of the NAS code minus its 79 MB `data/` — your deterministic reference), and the
  rewritten `documentation/`.
- `origin/laptop-experiment` carries the laptop's orchestrator refactor (single `runner.js`, sturdier
  `gluetunManager.js`, gutted `scheduler.js`, `MAX_CONSECUTIVE_FAILURES = 3`).

Read `analysis/orchestrator-comparison.md` and `analysis/nas-snapshot/SNAPSHOT-README.md` before
diffing.

## Step-by-step investigation (read-only; report, don't act)

### 1. Inventory the desktop's local repo
```sh
git status                       # uncommitted/untracked work — the whole point
git stash list                   # stashed weekend work?
git branch -a                    # local branches the NAS/origin never saw
git log --oneline @{u}..         # local commits not pushed to origin
git reflog -30                   # recently-abandoned work
git ls-files --others --exclude-standard   # untracked files (esp. orchestrator/, vpn*)
```
Pay special attention to anything under `orchestrator/` and any `vpn`, `vpn-ui`, `vpn-ui.html`,
`*.sh`.

### 2. Three-way byte comparison
Compare each desktop file against the NAS snapshot, `origin/master`, and `origin/laptop-experiment`.
Byte-equality via `git hash-object` (works on any file, tracked or not):
```sh
for f in orchestrator/*.js vpn vpn-ui vpn-ui.html; do
  d=$(git hash-object "$f" 2>/dev/null)
  n=$(git hash-object "analysis/nas-snapshot/$f" 2>/dev/null)
  m=$(git rev-parse "origin/master:$f" 2>/dev/null)
  l=$(git rev-parse "origin/laptop-experiment:$f" 2>/dev/null)
  echo "$f  desktop=$d  nas=$n  master=$m  laptop=$l"
done
```
For files that differ, run an actual `diff` against the NAS snapshot to see *what* differs.

### 3. Targeted questions (answer with evidence + grade)
- Does desktop `orchestrator/config.js` contain the hardcoded `GLUETUN_ACCEPTED_AIRVPN_SERVERS` list?
  Is it identical to the NAS's, or a different/newer version?
- Is desktop `getAcceptedServers()` the **hardcoded** or the **dynamic-fetch** version?
- Does `orchestrator/rebuildResults.js` exist on the desktop? Same bytes as the NAS?
- What is `MAX_CONSECUTIVE_FAILURES` on the desktop (NAS=5, laptop=3)?
- Does the desktop have `vpn` / `vpn-ui` / `vpn-ui.html`? Do they differ from the NAS snapshot
  (newer features? unfinished work the NAS never received?)?
- Are there desktop files (orchestrator modules, scripts, UI) that exist on **neither** the NAS nor
  git — i.e. work that was never deployed anywhere?

### 4. The "is X used?" discipline
For any usage question, check **all** of: `require()` graphs, the `vpn` and `vpn-ui` source, every
root `*.sh`, and `docker-compose.yml`/`Dockerfile`. Then still note that manual `docker exec` and the
browser UI can invoke things you can't see statically. **Never conclude "unused."**

## Your deliverable

Write `analysis/desktop-findings.md`, then commit and push it (`git push origin <branch>`) so the
laptop side can read it. It should contain:

1. **Top takeaways** (5–8 bullets), each graded confirmed / inferred / unknown.
2. **Provenance map:** for each piece of the NAS's uncommitted code (hardcoded list,
   `rebuildResults.js`, hardcoded `getAcceptedServers`, `vpn`/`vpn-ui`/`vpn-ui.html`), state where it
   originated and whether the desktop's copy matches the NAS, is newer, or is older.
3. **Desktop-only work:** anything the desktop has that neither the NAS nor git contains.
4. **Gaps/unknowns:** what you could NOT determine, and why.
5. **A proposed (not executed) reconciliation:** what *would* need to be committed to make git reflect
   the real running system — framed as a recommendation for the user to approve, with the NAS left
   untouched.

## Guardrails (restated)
- **No rsync, no deploy, no sync, no deletion, no cleanup. The NAS is read-only and stays exactly as
  it is.** Reconcile in git only, later, with explicit approval.
