# Deployment Upgrade Options

**Purpose:** a reference menu for moving the speed-tester (and later the media stack) off the current
janky deploy flow. **Option 1 (build our own Docker image) is the leaning recommendation;** the
others are kept here as viable paths to dig into later. Nothing here is executed yet — this is a
decision document.

> **Sequencing:** do not act on any of this until the desktop reconciliation lands and the *real*
> NAS code is committed to git (see `documentation/this-is-my-mess/desktop-investigation-handoff.md` and
> `documentation/this-is-my-mess/orchestrator-comparison.md`). We don't restructure or re-platform code we don't yet
> fully trust.

---

## Verified environment (checked on the box 2026-06-06 — not assumed)

| Thing | Reality |
|---|---|
| NAS | **ASUSTOR AS5404T**, ADM 5.1.3 — *not* Synology (the project `CLAUDE.md` is wrong on this) |
| CPU | **x86_64 / amd64** (Intel Celeron N5105) — standard arch, no ARM complications |
| Docker | **28.1.1** |
| Compose | **v2.35.1** (full `docker compose` v2) |
| Portainer | **PortainerCE running** (`portainer/portainer-ce:latest`, up 4 weeks) — the live management layer |
| Dev Mac | **arm64 (Apple M2 Pro)** — building images locally would cross-compile to amd64 |

**The cross-arch point matters:** the Mac is arm64, the NAS is amd64. A plain `docker build` on the
Mac produces an arm64 image that won't run (natively) on the NAS — you'd need
`docker buildx build --platform linux/amd64`. **GitHub Actions runners are amd64**, so CI builds the
right architecture with zero fuss. This is a concrete reason to prefer CI builds over local builds.

Sources: [ASUSTOR — Using a NAS with Docker](https://www.asustor.com/solution/what_is_docker) ·
[ASUSTOR App Central — Portainer CE](https://www.asustor.com/en/app_central/app_detail?id=1189&type=) ·
[GitHub Docs — Working with the Container registry (GHCR)](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

---

## Why upgrade (the problem today)

- **The NAS code directory has no `.git` at all** — only `data/` is version-controlled. The running
  code is literally not under version control.
- **`deploy.sh` = `rsync` without `--delete`**, run from whichever machine the user is on. That means
  (a) deleted files never leave the NAS (orphans accumulate), and (b) the "current" code is whatever
  was last synced from some machine — no single source of truth.
- **Result:** the "Frankenstein NAS" — committed desktop code + uncommitted desktop code + a stray
  laptop file, with no commit describing it. No immutability, no rollback, no reproducibility.

The fix in one sentence: **make a versioned artifact the source of truth, and make the NAS pull it
rather than receive a file dump.**

---

## Option 1 — Build our own Docker image ⭐ (recommended)

### Model
```
edit code → git push  →  CI builds an immutable image  →  push to registry  →  NAS pulls + runs it
```
Two clean sources of truth: **git = code**, **registry = runnable artifact**. **Data** is a NAS
volume, never inside the image. The image (e.g. `ghcr.io/<you>/vpn-speedtester:<git-sha>`) is the
same bytes forever — so "which machine / which files" can't happen.

### Pieces (chosen for this environment)
| Piece | Choice | Why |
|---|---|---|
| Registry | **GHCR** (GitHub Container Registry) | Free, code already on GitHub, private-capable |
| Builder | **GitHub Actions** (amd64 runners) | Builds `linux/amd64` natively → sidesteps the arm64-Mac cross-build |
| Last mile | **Portainer stack + redeploy webhook** | Portainer is already running; GUI + rollback; no SSH/rsync |

### Day-in-the-life
1. Edit `orchestrator/` code → `git commit && git push` (**from any machine — it stops mattering**).
2. GitHub Actions builds the image, tags it `:<git-sha>` and `:latest`, pushes to GHCR.
3. CI calls the **Portainer stack webhook**.
4. Portainer re-pulls the image and redeploys the stack. Done — no rsync, ever.
   Rollback = point the stack at a previous tag.

### Concrete changes from today
- `docker-compose.yml`: the orchestrator service switches from `build: ./orchestrator` to
  `image: ghcr.io/<you>/vpn-speedtester:latest`.
- One-time **`docker login ghcr.io`** on the NAS (a read-scoped PAT) so it can pull.
- **`.env` stays on the NAS** — WireGuard keys / qBT password are never baked into the image.
- **Data stays a bind-mount** (`/volume1/Docker/vpn-speed-tester/data:/data`).
- A minimal `.github/workflows/` build-and-push workflow is added.

### Why it fits *here* specifically
- The arm64→amd64 cross-build problem disappears (CI is amd64).
- Reuses the **already-running Portainer** instead of adding moving parts.
- Lines up with the old **P2 idea** (drive `SERVER_NAMES` via the Portainer API) and the future
  `vpn-ui` control panel — Portainer becomes the single control point.

### Compatibility note
The orchestrator recreating `gluetun-speedtest` on every server switch is **unaffected** — `gluetun`
stays a public image (`qmcgaw/gluetun`); only *our* orchestrator image is built and pushed.

### Trade-offs / effort
Needs initial setup: a GHCR token, an Actions workflow, and a Portainer stack. The edit→live loop is
slightly longer for a one-line change (build+push+redeploy vs edit-in-place) — negligible for a
system that runs unattended for weeks. Biggest wins: immutability, real rollbacks, zero rsync,
machine-independence, and CI can lint/test before publishing.

---

## Option 2 — Pull-based git on the NAS (good interim step)

The NAS holds a **git clone**; deploy = SSH in and run `git pull && docker compose up -d --build`
(optionally wrapped in a one-button script or the `vpn` CLI).

- **Pros:** git becomes the single source of truth; fully machine-agnostic; the lowest-effort way to
  *end the drift* without standing up a registry/CI.
- **Cons:** the NAS still **builds** the image itself (slower, depends on build deps being present);
  artifacts aren't immutable; rollback is "git checkout an older commit + rebuild," not a tag swap.
- **When:** a solid stepping stone if image-based feels like too much up front — and it's directly
  upgradeable to Option 1 later (same git, just add CI + registry).

---

## Option 3 — rsync `--delete` (stopgap only)

Keep the current push model but add `--delete` so orphan files are removed on each sync.

- **Pros:** smallest possible change; kills the orphan-accumulation half of the problem.
- **Cons:** git still isn't authoritative; you can still push stale code from the wrong machine; no
  immutability, no rollback. It treats a symptom, not the cause.
- **When:** only as a short-term safety patch if we keep rsync at all. Not a destination.

---

## Last-mile sub-options (for Option 1)

How the NAS actually gets told to run the new image:

| Mechanism | Fit | Note |
|---|---|---|
| **Portainer stack + webhook** ⭐ | Best | Uses running Portainer; GUI visibility + one-click rollback; no SSH |
| SSH + `docker compose pull && up -d` | Fine | Simplest mentally; back to a little SSH scripting |
| Watchtower | Meh | Auto-polls registry and swaps containers; an extra service that can **race** with the orchestrator recreating `gluetun-speedtest` |

---

## Related: repo structure (deferred — decide later)

Not deciding layout yet. The one insight that matters for now: **with image-based deploy, the
`Dockerfile` build context decides what ships — not which files sit next to each other.** So folder
layout becomes a matter of *your* sanity, not deploy correctness, and can be reorganized later
without risk. Options to revisit:

- **Monorepo, zoned** (`orchestrator/` app + `ops/` workstation tools + `deploy/` + `docs/`).
- **Flat + git** (minimal: just put the code under git with a tight `.gitignore`).
- **Multi-repo** (separate app / ops / data repos — most separation, most overhead).

---

## Data handling

`data/` is append-only results/snapshots/logs (~78 MB, growing) and already has its own `data/.git`.
Keep it **its own repo** or just **back it up** (periodic read-only pull). **Never** inside the code
image and never in the code repo.

---

## Decision status

- **Leaning:** Option 1 (build our own image: GHCR + GitHub Actions + Portainer webhook).
- **Retained for later:** Options 2 and 3, and the repo-structure choice.
- **Blocked on:** the desktop reconciliation + committing the real NAS code first. See
  [media-stack-manager-handoff.md](../media-stack/media-stack-manager-handoff.md) (the future control panel that
  this deploy model also serves) and [roadmap-working.md](roadmap-working.md).
