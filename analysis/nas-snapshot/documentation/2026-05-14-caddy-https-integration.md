# Caddy HTTPS integration — what changed outside this repo (2026-05-14)

> Heads up: this work happened in the **`waitress`** repo. **No files in *this* repo were modified.** This doc exists so an agent working here knows what's running on the NAS and what (if anything) this project might want to adapt.

## TL;DR

The NAS now has a Caddy reverse proxy in front of all docker services, with automatic wildcard Let's Encrypt certs for `*.waitress.nickdeckerdevs.com`. As a side effect, **the `vpn-report` container is now also reachable at:**

```
https://vpn-report.waitress.nickdeckerdevs.com
```

— with a trusted cert, no port number, on the LAN only (no internet exposure).

The old way still works: `http://10.1.10.254:9191`. Caddy just adds a clean named URL alongside it.

---

## How the proxy reaches `vpn-report`

Caddy lives in the **`media-server-v4`** Portainer stack (separate from this `vpn-speed-tester` stack). It reaches `vpn-report` via the **published host port**, not via the docker network:

```
Caddy (container, on media-lan network)
  → host.docker.internal:9191    (the host's published port)
  → nginx in vpn-report:80
```

This is why nothing here had to change. As long as `vpn-report`'s compose keeps publishing `9191:80` on its `vpn-speedtest` bridge network, the proxy route works. If you ever *remove* the host port publication and try to consolidate everything onto internal networks, you'll need to attach Caddy to `vpn-speedtest` (see "Optional future improvements" below).

Current `vpn-report` definition (unchanged, for reference):

```yaml
report-server:
  image: nginx:alpine
  container_name: vpn-report
  ports:
    - "9191:80"
  volumes:
    - /volume1/Docker/vpn-speed-tester/data:/usr/share/nginx/html:ro
  networks:
    - vpn-speedtest
```

---

## Caddyfile entry (in the `waitress` repo, not here)

For context — this is what was added in `waitress/stacks/Caddyfile`:

```caddy
@vpnreport host vpn-report.waitress.{$BASE_DOMAIN}
handle @vpnreport {
    reverse_proxy host.docker.internal:9191
}
```

The wildcard cert `*.waitress.nickdeckerdevs.com` covers this hostname automatically — no per-service cert config needed.

---

## What changed *on the NAS* (file-system level, not in any repo)

For agent awareness, these were modified outside any repo:

| Path | Change |
|------|--------|
| `/volume1/Docker/PortainerCE/data/compose/11/docker-compose.yml` | Added `caddy` service to the `media-server-v4` stack |
| `/volume1/Docker/PortainerCE/data/compose/11/stack.env` | Appended `CLOUDFLARE_API_TOKEN`, `BASE_DOMAIN`, `ACME_EMAIL` |
| `/volume1/Docker/homeassistant/configuration.yaml` | Added `http: trusted_proxies` block (HA-specific; doesn't affect this project) |
| `/volume1/Docker/caddy/` | New directory: `Caddyfile`, `data/` (certs), `config/` |
| Cloudflare zone `nickdeckerdevs.com` | Deleted 19 legacy Bluehost records; created `A *.waitress → 10.1.10.254` (DNS-only, gray cloud) |

Backups of the modified Portainer files exist at `*.bak.<timestamp>` alongside the originals.

---

## DNS — exposure model

To rule out any confusion that this exposes services to the internet:

1. Public Cloudflare DNS resolves `*.waitress.nickdeckerdevs.com` to the **private IP** `10.1.10.254`. Public-facing, but unreachable from outside the LAN.
2. Let's Encrypt verifies domain ownership via **DNS-01 challenge** (TXT record), never connects to the NAS. No HTTP-01, no port 80/443 open to the world.
3. Caddy listens on the NAS only. **No router port-forwards. No Cloudflare Tunnel.**

If we ever want true remote access, that's a separate, deliberate step (Tailscale or Cloudflare Tunnel).

---

## Optional future improvements *this* repo could make

None are required. Listed in order of how much they'd actually help:

1. **Document the new URL.** Add `https://vpn-report.waitress.nickdeckerdevs.com` to this project's README / `documentation/front-end-reporting.md` so future viewers don't default to the IP. Likely the biggest win.
2. **Drop the `9191:80` publication if/when Caddy joins the `vpn-speedtest` network.** Currently the port is exposed on the host both because `view-report.sh` may use `localhost:9191` and because Caddy needs it. If we add Caddy as an external attachment to `vpn-speedtest`, the host port can be removed entirely. Not worth doing until a need arises.
3. **Add Caddy as an `external: true` network reference here.** If we want this stack to *require* Caddy be running to come up, declare the network in compose. Not recommended — adds coupling between stacks for no real benefit.
4. **Use a non-root nginx with a directory index.** Currently `https://vpn-report.waitress.nickdeckerdevs.com/` returns 403 (no `index.html`). If you want a browsable listing, add `autoindex on;` to the nginx config. Cosmetic.

---

## What user still needs to do manually

(Carried over from the parent setup — listed here so the agent has full context.)

1. **Cloudflare dashboard cleanup:** delete any Page Rule / Redirect Rule that forwards `nickdeckerdevs.com` → `deckerdevs.com`. The API token used for the rest of the work didn't have scope to do this. Dashboard → Zone → Rules → Overview *and* Rules → Page Rules.
2. **Browser-test the ADM portal at `https://nas.waitress.nickdeckerdevs.com`.** Curl returns 200 but the JS-heavy login flow wasn't smoke-tested in a real browser. If sessions break or it redirects out of the proxy, the fix is to add header rewrites to Caddy.

---

## Files in *this* repo touched: zero

Verified — only this single doc was created. No compose, code, config, or env changes. The vpn-speed-tester stack's runtime behavior is identical to before.
