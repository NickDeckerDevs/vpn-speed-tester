# Live NAS state — 2026-06-06 (post crash-loop fix)

Verbatim capture for future drift comparison. No secrets are in these files (the token
comes from env at runtime).

## `/volume1/Docker/caddy/Caddyfile` (live)

Byte-identical to `waitress/stacks/Caddyfile` on this date — **no repo↔NAS drift.**

```caddy
{
	email {$ACME_EMAIL}
}

# Single wildcard cert covers every subdomain below.
# Cert SAN: *.waitress.{$BASE_DOMAIN}  (e.g. *.waitress.nickdeckerdevs.com)
*.waitress.{$BASE_DOMAIN} {
	tls {
		dns cloudflare {$CLOUDFLARE_API_TOKEN}
	}

	@jellyfin host jellyfin.waitress.{$BASE_DOMAIN}
	handle @jellyfin { reverse_proxy jellyfin:8096 }

	@sonarr host sonarr.waitress.{$BASE_DOMAIN}
	handle @sonarr { reverse_proxy host.docker.internal:8989 }

	@radarr host radarr.waitress.{$BASE_DOMAIN}
	handle @radarr { reverse_proxy host.docker.internal:7878 }

	@lidarr host lidarr.waitress.{$BASE_DOMAIN}
	handle @lidarr { reverse_proxy host.docker.internal:8686 }

	@prowlarr host prowlarr.waitress.{$BASE_DOMAIN}
	handle @prowlarr { reverse_proxy host.docker.internal:9696 }

	@qbittorrent host qbittorrent.waitress.{$BASE_DOMAIN}
	handle @qbittorrent { reverse_proxy host.docker.internal:8080 }

	@speedtest host speedtest.waitress.{$BASE_DOMAIN}
	handle @speedtest { reverse_proxy host.docker.internal:8787 }

	@byparr host byparr.waitress.{$BASE_DOMAIN}
	handle @byparr { reverse_proxy host.docker.internal:8191 }

	@filebrowser host filebrowser.waitress.{$BASE_DOMAIN}
	handle @filebrowser { reverse_proxy filebrowser:80 }

	@homeassistant host homeassistant.waitress.{$BASE_DOMAIN}
	handle @homeassistant { reverse_proxy host.docker.internal:8123 }

	@zigbee host zigbee2mqtt.waitress.{$BASE_DOMAIN}
	handle @zigbee { reverse_proxy host.docker.internal:8080 }   # ⚠️ collides with qbittorrent:8080

	@portainer host portainer.waitress.{$BASE_DOMAIN}
	handle @portainer { reverse_proxy host.docker.internal:19900 }

	@nas host nas.waitress.{$BASE_DOMAIN}
	handle @nas { reverse_proxy host.docker.internal:8000 }

	@vpnreport host vpn-report.waitress.{$BASE_DOMAIN}
	handle @vpnreport { reverse_proxy host.docker.internal:9191 }

	# added 2026-06-06 — Immich; bare / redirects to /photos, rest proxies through
	@photos host photos.waitress.{$BASE_DOMAIN}
	handle @photos {
		@photosroot path /
		redir @photosroot /photos
		reverse_proxy host.docker.internal:2283
	}
}
```
(condensed `handle { … }` to one line for readability; live file has them multi-line.)

## ⚠️ Operational gotcha — editing the bind-mounted Caddyfile

The Caddyfile is a **single-file bind mount**. When updating it on the NAS, write **in
place** so the inode is preserved and the container sees the change:
```bash
sudo sh -c 'cat /tmp/Caddyfile.new > /volume1/Docker/caddy/Caddyfile'   # ✅ preserves inode
```
A `sudo cp` can swap the inode, leaving the container bound to the old file — Caddy then
reports `config is unchanged` on reload. If that happens, `docker restart caddy` re-binds
the mount. After a clean in-place write, `docker exec caddy caddy reload --config
/etc/caddy/Caddyfile` is enough (no restart, no full redeploy). This bit us once on
2026-06-06 adding the `photos` route.

## `caddy:` env wiring — compose/11/docker-compose.yml

```yaml
environment:
  - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}   # interpolated — needs Portainer stored env
  - BASE_DOMAIN=${BASE_DOMAIN}                      # interpolated
  - ACME_EMAIL=${ACME_EMAIL}                        # interpolated
volumes:
  - /volume1/Docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
  - /volume1/Docker/caddy/data:/data
  - /volume1/Docker/caddy/config:/config
```

## Wildcard cert (observed)
- `subject = CN=*.waitress.nickdeckerdevs.com`
- `issuer  = Let's Encrypt E8`
- valid `May 14 2026 → Aug 12 2026` (auto-renews via DNS-01)

## stack.env reality
`/volume1/Docker/PortainerCE/data/compose/11/stack.env` contains only
`WIREGUARD_PRIVATE_KEY`, `WIREGUARD_PRESHARED_KEY`, `SPEEDTEST_APP_KEY`. The three Caddy
vars are **not** here — they come from Portainer's stored env (regenerated into the
running container at redeploy). Confirmed identical to its May 14 `.bak`, so they were
never persisted in this file.

## Reconciliation status (vs `waitress` repo)
- `Caddyfile` — **identical** to `waitress/stacks/Caddyfile`. ✅ No action.
- `media-stack.yml` (6.7k repo) vs NAS `docker-compose.yml` (6707 B) — same size; spot-diff
  if you reopen the repo, but no evidence of drift.
- `waitress/.env` (laptop, gitignored) — updated by user 2026-06-06 with all 10 keys
  incl. `ACME_EMAIL=nickdeckerdevs@gmail.com`. This is the local secret home.
- **Conclusion:** repo and NAS are aligned for Caddy. The only gap was Portainer stored
  env (now fixed). No repo sync needed.
