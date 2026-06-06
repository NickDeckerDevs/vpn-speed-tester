# Runbook — add (or fix) a named service

Goal: make a running container reachable at `https://<name>.waitress.nickdeckerdevs.com`.

**No DNS work is ever needed** — the wildcard `*.waitress` already resolves. This is only
a Caddyfile edit + reload.

## Steps

1. **Pick the subdomain.** e.g. `immich` → `immich.waitress.nickdeckerdevs.com`. The
   wildcard cert already covers it.

2. **Make sure Caddy can reach the backend.** Caddy runs on the `media-lan` network. Two ways:
   - **Same docker network** → target the container name, e.g. `reverse_proxy jellyfin:8096`.
     Works when the service is attached to a network Caddy shares.
   - **Published host port** → target `host.docker.internal:<port>`. Use this for
     services on other networks or `network_mode: host`.
   - **Service behind gluetun** (`network_mode: service:gluetun`): it has no own
     namespace, so it must publish its port **on the gluetun service**, then Caddy
     reaches it via `host.docker.internal:<port>`. If the route 502s, the port isn't
     published on gluetun — fix that first.

3. **Confirm the real port** before writing the route:
   `sudo docker ps | grep <service>` → read the `->` host port. (Don't trust docs — this
   is exactly how the `zigbee2mqtt → :8080` collision with qbittorrent happened.)

4. **Add the block** to `/volume1/Docker/caddy/Caddyfile` (NAS), inside the
   `*.waitress.{$BASE_DOMAIN} { … }` site block, matching the existing style:
   ```caddy
   @immich host immich.waitress.{$BASE_DOMAIN}
   handle @immich {
       reverse_proxy host.docker.internal:2283   # confirm Immich's actual published port
   }
   ```
   Keep the mirror copy `waitress/stacks/Caddyfile` in sync (see reconciliation note in
   README — repo and NAS were identical as of 2026-06-06; don't let them drift).

5. **Reload Caddy (no full redeploy):**
   ```bash
   sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
   If reload isn't available, `sudo docker restart caddy`. A full Portainer stack redeploy
   is **not** needed for a Caddyfile change (the file is bind-mounted).

6. **Verify:** `curl -I https://immich.waitress.nickdeckerdevs.com`. A redirect/200
   **with a non-empty body** (or an auth challenge) = success. A **0-byte 200** means the
   route didn't match (still hitting the wildcard default) — re-check the `@name host`
   line. A 502 means the backend is unreachable — re-check the port / gluetun publication.

## Editing env vars (token / domain / email) — different surface

Those are **not** in the Caddyfile. They live in **Portainer → stack `media-server-v4` →
Environment variables** (the durable source of truth) and locally in
`/Users/impulse/repos/waitress/.env`. Change them in Portainer and redeploy the stack
(this cycles all services in the stack). See README "Where the secrets live."

---

## Future idea (low priority) — friendly "service is down" page for 502s / unmatched hosts

Today a down backend returns a raw **502**, and unmatched subdomains return an empty
**200**. Nicer: serve a small static "this service is currently unavailable" HTML page in
both cases. In Caddy this is roughly:

```caddy
# inside the *.waitress site block, after the named handles:
handle {                      # catch-all for unmatched subdomains
    root * /srv/maintenance
    rewrite * /down.html
    file_server
}
handle_errors {               # catch backend errors (e.g. 502 from a down service)
    root * /srv/maintenance
    rewrite * /down.html
    file_server
}
```

Requires mounting a `down.html` into the caddy container (e.g.
`/volume1/Docker/caddy/maintenance:/srv/maintenance:ro`). **Not implemented** — parked
low on the priority list per the 2026-06-06 request. Note the trade-off: a catch-all
`handle` removes the current empty-200 behavior, so re-test existing routes after adding it.
