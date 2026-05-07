# qBittorrent Authentication Debugging

Debugging guide for the `"Fails." + 403` authentication failure blocking the orchestrator pre-flight pause step.

---

## Resolution (2026-05-07)

**Root causes found and fixed:**

1. **`env_file` missing from docker-compose** — `QBT_PASSWORD` was set in `.env` on the NAS but the orchestrator service had no `env_file` directive, so the variable never reached the container. `config.js` defaulted it to `''`. Fixed by adding `env_file: .env` to the orchestrator service in `docker-compose.yml`.
2. **Repeated empty-password attempts triggered an IP ban** — `loginAttempted` was set to `true` on first failure and never reset, so the ban compounded across restarts. Fixed in [orchestrator/qbtClient.js](../orchestrator/qbtClient.js): flag now resets on every failure path.
3. **403 on the login endpoint was swallowed** — axios threw on non-2xx responses, landing in the catch block with a misleading "proceeding without session" message instead of a clear "IP banned" error. Fixed by adding `validateStatus: () => true` to the login axios call.

**Verify the fix after deploying:**
```bash
./deploy.sh --test
```
Expected log lines past the pre-flight step:
```
[INFO ] qBittorrent login response — status: 200, body: "Ok."
[INFO ] qBittorrent session established
[INFO ] pauseAll: confirmed — N torrent(s) paused (attempt 1)
```

---

## What Was Happening

The orchestrator's `login()` call returned `"Fails."` (wrong credentials — password was empty), so no session cookie was established. Every subsequent API call (pause, resume, info) then got a `403 Forbidden`.

There was also a code-level bug that made this self-reinforcing: `loginAttempted` was set to `true` on the first call and **never reset** on failure — so after one failed login, all subsequent calls within the same container lifetime skipped login entirely, guaranteeing the 403 repeated. Repeated failures can also trigger qBittorrent's IP ban (5 failed attempts → 1-hour ban by default).

---

## Phase 1 — Diagnose with curl (no redeploy needed) ✓ Complete

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

**Finding:** The Mac IP (`10.1.10.x`) is whitelisted — returns `Ok.` with no SID regardless of password. This means the Mac cannot be used to validate credentials via curl. The Docker container (`172.21.0.x`) is not whitelisted and requires real credentials.

### Step 1b — Try the actual credentials

```bash
# Replace YOUR_PASSWORD with the value from .env
curl -v -X POST http://10.1.10.254:8080/api/v2/auth/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Referer: http://10.1.10.254:8080' \
  -d 'username=admin&password=YOUR_PASSWORD' 2>&1 | grep -E 'Set-Cookie|< HTTP|Fails|Ok\.'
```

**Finding:** From the Mac this always returns `Ok.` (whitelist bypass) — cannot distinguish correct vs. wrong password from the Mac. Test from the Docker container or deploy and check logs.

### Step 1c — Verify API works with the session cookie

```bash
SID=<the-sid-value-from-above>
curl -s "http://10.1.10.254:8080/api/v2/torrents/info?filter=paused" \
  -H "Cookie: SID=$SID" | head -c 200
```

Should return a JSON array. This confirms the full auth flow works end-to-end.

---

## Phase 2 — Fix Credentials ✓ Complete

`QBT_PASSWORD` was empty in `.env`. Fixed by:

1. Logging into the qBittorrent Web UI at `http://10.1.10.254:8080` (Mac IP is whitelisted — no password needed to get in)
2. **Tools → Options → Web UI** → set a new password
3. Updated `.env` in the repo root with the new password

> **Note:** Modern qBittorrent hashes passwords with PBKDF2 — you cannot read the existing password from the config file. If you don't know the current password, reset it via the WebUI (the Mac IP whitelist lets you in without credentials).

---

## Phase 3 — Fix Code Bug: `loginAttempted` Never Resets ✓ Complete

**File:** [orchestrator/qbtClient.js](../orchestrator/qbtClient.js), lines 18–19

**Bug:** `loginAttempted` was module-level and set to `true` on the first `login()` call. It was never cleared after a failed attempt. Fixed: reset to `false` on every failure path so the next `pauseAll()` / `resumeAll()` call retries.

Fixed failure branches in the try block:
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

Fixed catch block:
```js
} catch (err) {
  loginAttempted = false;
  logger.warn(`qBittorrent login attempt failed (${err.message}) — proceeding without session`);
}
```

---

## Phase 4 — IP Subnet Whitelist (optional)

This was documented as complete but was never actually configured. Since credentials now flow correctly via `env_file`, this step is optional hardening.

If you want to remove credential dependency entirely (useful if the password changes or you want to skip auth altogether):

**Steps (qBittorrent Web UI at http://10.1.10.254:8080):**

1. **Tools → Options → Web UI**
2. Enable **"Bypass authentication for clients in whitelisted IP subnets"**
3. Add both subnets:

| Subnet | Context |
|---|---|
| `172.21.0.0/24` | Docker `vpn-test` bridge — deployed `orchestrator` container |
| `10.1.10.0/24` | NAS LAN — direct `npm run test:single` on the NAS connects via its own LAN IP |

4. Save

**Expected log output if whitelist is active:**
```
[INFO ] qBittorrent login response — status: 200, body: "Ok."
[INFO ] qBittorrent login accepted but no SID returned — auth may be bypassed for this IP
[INFO ] pauseAll: confirmed — N torrent(s) paused (attempt 1)
```
