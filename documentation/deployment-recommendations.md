# NAS deployment recommendations — cross-repo standard

> **What this is.** One consolidated, decision-oriented view of how everything on the NAS
> *should* deploy, tying together the two repos that raised the question independently:
> this **`vpn-speed-tester`** repo and the **`waitress`** media-stack repo. It does not
> replace the deeper per-repo docs — it reconciles them and surfaces the decisions left to
> make. Created **2026-06-07**. **Nothing here is executed by this doc.**
>
> Source docs it consolidates:
> - `documentation/deployment-upgrade-options.md` (this repo — Option 1/2/3)
> - `/Users/impulse/repos/waitress/docs/deployment.md` (paths a/b, the `maintenance-ui` pilot)
> - `/Users/impulse/repos/waitress/docs/roadmap.md` → "Phase 2 — Deployment evolution"
> - `/Users/impulse/repos/waitress/docs/ecosystem.md` (the four-repo map)

## 1. Scope & shared environment

The homelab is **one box**, so deployment should be **one standard** with a couple of
entry points — not four bespoke flows.

| Fact | Value |
|---|---|
| Host | ASUSTOR **AS5404T**, **amd64** (Intel N5105), ADM 5.1.3 |
| Docker / Compose | **28.1.1** / **v2.35.1** |
| Management | **PortainerCE** running — the live deploy layer |
| Registry | **GHCR** reachable (code is already on GitHub) |
| Dev Mac | **arm64** (M-series) → a local `docker build` is the wrong arch; **CI must build `linux/amd64`** |
| Front door | **Caddy** (owned by `waitress`, `stacks/Caddyfile`) — one Cloudflare DNS-01 wildcard for `*.waitress.<domain>`; new services get a route here |
| Secrets | `.env` on the NAS + **Portainer stored env**; **never baked into an image** (the Caddy crash-loop came from env missing in Portainer's stored env — see [caddy-reverse-proxy/](caddy-reverse-proxy/)) |

### The four repos today (from `waitress/docs/ecosystem.md`)

| Repo | Deploys via today | Custom-built image? | Proxy route |
|---|---|---|---|
| `waitress` (media stack + Caddy) | **Portainer** (stack `media-server-v4`, `/data/compose/11/`) | only the new `maintenance-ui` | `*.waitress.<domain>` |
| `vpn-speed-tester` (this repo) | **rsync via `./vpn deploy`** (no `--delete`/excludes; orchestrator **built on the NAS**) | orchestrator | `vpn-report.waitress.<domain>` |
| `nas-photo-manager` (Immich) | code (not Portainer); **private** under personal GH | no (stock images) | `photos`/`immich.waitress.<domain>` |
| `nas-homelab-base` | **the template** (`deploy.sh`, canonical `scripts/lib.sh` + NAS helpers); **vendors the speed tester as `examples/speedtest`** | n/a (GitHub-only, not cloned here) | — |

**Mixed models** (`waitress`=Portainer, everything else=code) is the core problem. The
long-term direction in *both* roadmaps is **deploy-by-code for all of it.**

## 2. The agreed destination (both repos already point here)

```
edit code → git push → GitHub Actions builds linux/amd64 → push to GHCR
          → Portainer redeploy webhook re-pulls + redeploys
```

- **git = code, registry (GHCR) = the runnable artifact, NAS volumes = `.env` + `data/`.**
  Images are immutable and tagged `:<git-sha>` + `:latest`; rollback = point the stack at a
  previous tag.
- This repo calls it **Option 1** (`deployment-upgrade-options.md`). `waitress` calls it
  **path (b)** and explicitly says it "mirrors Option 1." **They are the same pipeline** —
  this doc just makes that one decision instead of two.
- An image deploy **doesn't rsync code at all**, which removes this repo's current
  `--delete` / `gluetun-speedtest/`-key landmines and the orphan-accumulation problem.

## 3. Two archetypes (one standard, two entry points)

Not everything needs a built image. Sort each service once:

- **A — Custom-code stacks** (have a `Dockerfile`, built from source):
  `vpn-speed-tester/orchestrator` and `waitress/maintenance-ui`.
  → **CI-built GHCR image + Portainer webhook.**
- **B — Stock-image compose stacks** (upstream images: gluetun, \*arr, jellyfin, caddy,
  immich, qbittorrent, …): the rest of the media stack + Immich.
  → **No build.** Need **config-as-code** (compose + Caddyfile + `.env.example` in git) and
  a safe redeploy (Portainer **git-backed stack** or webhook). Secrets stay in Portainer
  stored env.

The common thread across A and B: **git is the source of truth + Portainer is the redeploy
mechanism.** GHCR enters only for archetype A.

## 4. Convergence vehicle — `nas-homelab-base`

`waitress`'s roadmap ("Phase 2 — Deploy-by-code") and `ecosystem.md` already name the shared
tool: **`nas-homelab-base`** — a template repo holding `deploy.sh`, the **canonical**
`scripts/lib.sh`, and NAS helpers (`nas-exec.sh`, `nas-shell.sh`, `setup-ssh-alias.sh`). It
**already vendors the speed tester as `examples/speedtest`.**

Adopting it as the shared deploy-by-code tooling:
- ends the **duplicated NAS helpers** (this repo's `lib.sh`/`vpn`, waitress's `lib.sh`/`nas`
  — three copies of the same thing today), and
- gives every repo the same `deploy.sh` entry point instead of bespoke per-repo CLIs.

It is **not on this machine** (referenced by GitHub URL only). Wiring `deploy.sh` concretely
requires cloning it first — see §8.

## 5. Recommended sequencing (this is the "tie them together")

1. **Pilot — `maintenance-ui` (waitress).** It's the media stack's *first built-from-source
   image*, so it forces the image decision first; that makes it the natural CI pilot. Ship it
   via GHCR + Actions + a Portainer webhook and prove the whole pipeline end-to-end on one
   small service.
   - *Interim fallback if you want it live before CI exists:* build on the NAS (amd64-native)
     using an **absolute** build context — under Portainer's `/data/compose/11/`, the
     relative `../maintenance-ui` resolves to a non-existent path and fails. (Detail in
     `waitress/docs/deployment.md` §3–4.)
2. **Convert this repo's `orchestrator`** to the same image-based deploy. Swap
   `build: ./orchestrator` → `image: ghcr.io/<acct>/vpn-speedtester:<tag>`; `./vpn deploy`
   stops rsyncing code. Removes the unsafe-rsync problem entirely.
3. **Migrate the media stack (+ Immich) to deploy-by-code** on `nas-homelab-base`. Repo
   becomes the source of truth for the Portainer stack → **ends the repo↔`/data/compose/11`
   drift**.

This sequence resolves **both** standing drifts (repo↔`/data/compose/11`; rsync-without-
`--delete`) and converges all four repos on one pipeline.

## 6. Concrete artifacts each step will add (named — not created here)

- `.github/workflows/build-image.yml` in each archetype-A repo (build `linux/amd64`, push to
  GHCR, call the Portainer webhook).
- `docker-compose` edit: `build:` → `image: ghcr.io/<acct>/<name>:<tag>` (orchestrator;
  maintenance-ui).
- One-time on the NAS: a **read-scoped GHCR PAT** + `docker login ghcr.io`.
- A **Portainer stack redeploy webhook** per stack (none exists today — redeploy is manual).
- `maintenance-ui` build-context fix (absolute path) for the interim NAS-build fallback.

## 7. Open decisions (yours to make)

| Decision | Options / notes |
|---|---|
| **Registry visibility + account** | GHCR private vs public; which GitHub account/org. Note: `nas-photo-manager` is **private under the personal account** — confirm the PAT/login can reach all needed packages. |
| **Portainer mechanism** | **Git-backed stacks** (Portainer auto-pulls the repo) vs **webhook-only** (CI calls a redeploy hook). Git-backed also helps archetype B end its drift. |
| **Adopt `nas-homelab-base` now or later** | Now = consistent tooling + kills duplicated helpers up front; later = pilot first, refactor tooling after it's proven. |
| **Retire rsync / per-repo CLIs** | Once image-based, do we delete `./vpn deploy`'s rsync path and the waitress `nas` CLI in favor of `deploy.sh`? |
| **Secrets standard** | Keep `.env` + Portainer stored env, never baked (ties to waitress roadmap Phase 3 "secrets management"). |
| **Where this doc lives long-term** | It's cross-repo; the natural home is **`nas-homelab-base`**. For now it lives here and is cross-linked from waitress. |

## 8. Roadmap reconciliation

This single sequence maps onto both existing roadmaps — they're describing the same work:

- **`vpn-speed-tester`** → `documentation/roadmap-working.md`, "Next decisions" **#3
  (deployment upgrade)** = §5 step 2 here.
- **`waitress`** → `docs/roadmap.md`, **"Phase 2 — Deployment evolution"** = §5 steps 1 & 3
  here (`maintenance-ui` pilot + media-stack deploy-by-code on `nas-homelab-base`).

Suggested one-line pointers to add (offered, not yet applied): a link to this doc from each
roadmap's deployment entry. The waitress edit is in a different repo, so it's only done on
request.

## 9. Integration seam — what's still needed before execution

- **Clone `nas-homelab-base` locally** to wire `deploy.sh`/helpers concretely (it's
  GitHub-only right now).
- **Make `nas-photo-manager` reachable** from this machine's `gh` auth (private, personal
  account) so Immich can be folded into archetype B.
- **Create the Portainer API key + per-stack redeploy webhook** (none exists today).
- Decide the items in §7, then execute §5 step-by-step — **each step its own approved
  session.**

## See also
- This repo: [deployment-upgrade-options.md](deployment-upgrade-options.md) ·
  [caddy-reverse-proxy/](caddy-reverse-proxy/) · [roadmap-working.md](roadmap-working.md)
- `waitress`: `docs/deployment.md` · `docs/roadmap.md` · `docs/ecosystem.md`
