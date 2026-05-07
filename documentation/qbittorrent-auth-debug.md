# qBittorrent Authentication Debugging

Debugging guide for the `"Fails." + 403` authentication failure blocking the orchestrator pre-flight pause step.

---

## What's Happening

The orchestrator's `login()` call returns `"Fails."` (wrong credentials), so no session cookie is established. Every subsequent API call (pause, resume, info) then gets a `403 Forbidden`.

There's also a code-level bug that makes this self-reinforcing: `loginAttempted` is set to `true` on the first call and **never reset** on failure — so after one failed login, all subsequent calls within the same container lifetime skip login entirely, guaranteeing the 403 repeats. Repeated failures can also trigger qBittorrent's IP ban (5 failed attempts → 1-hour ban by default).

---

## Phase 1 — Diagnose with curl (no redeploy needed)

All curl commands run from the **Mac terminal** — qBittorrent is at `http://10.1.10.254:8080` on the LAN.

### Step 1a — Check if IP is already banned

```bash
curl -s -X POST http://10.1.10.254:8080/api/v2/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: http://10.1.10.254:8080' \
  -d 'username=admin&password=test'
```

**Interpret the response:**

| Response body | Meaning |
|---|---|
| `Fails.` | Auth is enabled, wrong password — credentials issue |
| `Your IP address has been banned for X minutes.` | IP is banned — wait or restart qBittorrent to clear |
| `Ok.` (no `Set-Cookie`) | Auth bypassed for this IP (whitelist active) — no password needed |
| `Ok.` (with `Set-Cookie: SID=...`) | Login succeeded — correct password |

If banned, restart the qBittorrent container or WebUI to clear the ban immediately, then re-test.

### Step 1b — Try the actual credentials

```bash
# Replace YOUR_PASSWORD with the value from .env
curl -v -X POST http://10.1.10.254:8080/api/v2/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: http://10.1.10.254:8080' \
  -d 'username=admin&password=YOUR_PASSWORD' 2>&1 | grep -E 'Set-Cookie|< HTTP|Fails|Ok\.'
```

If this returns `Ok.` with a `SID` cookie, the credentials are correct and the issue is purely the code bug (Phase 3).

### Step 1c — Verify API works with the session cookie

```bash
SID=<the-sid-value-from-above>
curl -s "http://10.1.10.254:8080/api/v2/torrents/info?filter=paused" \
  -H "Cookie: SID=$SID" | head -c 200
```

Should return a JSON array. This confirms the full auth flow works end-to-end.

---

## Phase 2 — Fix Credentials

If Step 1b returns `Fails.`, the password in `.env` doesn't match qBittorrent.

1. Log into the qBittorrent Web UI at `http://10.1.10.254:8080` in a browser to confirm/reset the password
2. Update `.env` in the repo root:
   ```
   QBT_PASSWORD=the-correct-password
   ```
3. Redeploy via rsync + `docker compose restart orchestrator` (see get-started-keep-going.md Step 2)

---

## Phase 3 — Fix Code Bug: `loginAttempted` Never Resets

**File:** `orchestrator/qbtClient.js`, lines 18–19

**Bug:** `loginAttempted` is module-level and set to `true` on the first `login()` call. It is never cleared after a failed attempt. Fix: reset it to `false` on any failure path so the next `pauseAll()` / `resumeAll()` call retries.

**In the try block**, replace the failure branches:
```js
} else if (body === 'Fails.') {
  loginAttempted = false;
  logger.error('qBittorrent login failed — wrong username or password (check QBT_USERNAME / QBT_PASSWORD in .env)');
} else if (body.startsWith('Your IP address has been banned')) {
  loginAttempted = false;
  logger.error(`qBittorrent login failed — IP banned: ${body}`);
} else {
  loginAttempted = false;
  logger.warn(`qBittorrent login unexpected response: "${body}"`);
}
```

**In the catch block:**
```js
} catch (err) {
  loginAttempted = false;
  logger.warn(`qBittorrent login attempt failed (${err.message}) — proceeding without session`);
}
```

---

## Phase 4 — Optional Long-Term Fix: IP Subnet Whitelist

To remove credential dependency entirely for the orchestrator, add the Docker bridge network to qBittorrent's bypass list:

1. qBittorrent Web UI → **Tools → Options → Web UI**
2. Enable "Bypass authentication for clients in whitelisted IP subnets"
3. Add `172.21.0.0/24` (the `vpn-test` Docker bridge network)

The login response will return `Ok.` without a SID — the existing code already handles this case correctly (`qbtClient.js` lines 39-40).

---

## Verification

After fixing credentials and deploying the code fix, run:

```bash
docker exec orchestrator npm run test:single
```

Expected log lines past the pre-flight step:
```
[INFO ] qBittorrent login response — status: 200, body: "Ok."
[INFO ] qBittorrent session established
[INFO ] pauseAll: confirmed — N torrent(s) paused (attempt 1)
```
