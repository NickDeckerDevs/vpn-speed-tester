#!/bin/bash
# deploy.sh — Deploy the VPN speed-tester stack to the Synology NAS.
#
# Run from your laptop. Rsyncs the repo to the NAS, tears down the existing
# Docker stack, waits for containers to stop, then brings everything back up
# with "docker compose up -d --build". Use --check to show container status
# without deploying.
#
# Requires ~/.ssh/id_nas to exist and its pubkey to be in sysop@10.1.10.254's
# authorized_keys. SYSOP_SSH (sudo password) is still needed for docker commands
# because the sysop user is not in the docker group on this NAS.
#
# Changelog
# 2026-05-14  Switched SSH and rsync from password-only to key-based auth (id_nas)
# 2026-05-14  Added ~/.ssh/id_nas existence check with actionable error message
#               (prevents silent interactive-prompt hang in non-terminal contexts)
# 2026-05-14  Extracted NAS vars and get_env_var() to lib.sh
# 2026-05-14  Added vpn-report to container status checks
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ── Load .env and validate required vars ──────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

WIREGUARD_PRIVATE_KEY=$(get_env_var WIREGUARD_PRIVATE_KEY)
WIREGUARD_PRESHARED_KEY=$(get_env_var WIREGUARD_PRESHARED_KEY)
WIREGUARD_ADDRESSES=$(get_env_var WIREGUARD_ADDRESSES)
QBT_USERNAME=$(get_env_var QBT_USERNAME)
QBT_PASSWORD=$(get_env_var QBT_PASSWORD)
QBT_BASE_URL=$(get_env_var QBT_BASE_URL)
SYSOP_SSH=$(get_env_var SYSOP_SSH)

MISSING=()
for var in WIREGUARD_PRIVATE_KEY WIREGUARD_PRESHARED_KEY WIREGUARD_ADDRESSES QBT_USERNAME QBT_PASSWORD QBT_BASE_URL SYSOP_SSH; do
  val="${!var}"
  if [ -z "$val" ] || [[ "$val" == *"<"* ]]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: missing or placeholder values in .env:"
  for v in "${MISSING[@]}"; do echo "  $v"; done
  exit 1
fi

# Fail fast if the key is missing — without it SSH would fall back to a
# password prompt, which hangs in non-interactive shells (cron, CI, etc.)
if [ ! -f "$HOME/.ssh/id_nas" ]; then
  echo "ERROR: ~/.ssh/id_nas not found. Generate a key and add the pubkey to sysop@10.1.10.254:~/.ssh/authorized_keys, or copy id_nas from another machine."
  exit 1
fi

SUDO="echo $(printf '%q' "$SYSOP_SSH") | sudo -S"

CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
  esac
done

# ── --check: show live container status and exit ──────────────────────────────
if [ "$CHECK_ONLY" = true ]; then
  echo "Container status on NAS:"
  $SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --filter 'name=vpn-report' --format 'table {{.Names}}\t{{.Status}}'"
  exit 0
fi

# ── Step 1: Sync ──────────────────────────────────────────────────────────────
echo "Syncing to NAS..."
rsync -avz -e "$RSYNC_SSH" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.local-staging' \
  "$(dirname "$0")/" \
  $NAS:$NAS_DIR/

# ── Step 1.5: Ensure data directories exist and sync report ────────────────
echo "Ensuring data directories on NAS..."
$SSH "$SUDO mkdir -p $NAS_DIR/data/snapshots $NAS_DIR/data/report $NAS_DIR/data/logs"

echo "Syncing report to NAS..."
rsync -avz -e "$RSYNC_SSH" \
  $SCRIPT_DIR/report/ \
  $NAS:$NAS_DIR/data/report/

# ── Step 2: Take down existing stack ─────────────────────────────────────────
echo "Taking down existing stack on NAS..."
$SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose down; docker rm -f gluetun-speedtest speedtest-runner orchestrator 2>/dev/null || true'"

# ── Step 3: Poll until all containers are gone ────────────────────────────────
echo "Waiting for containers to stop..."
ELAPSED=0
POLL_INTERVAL=3
TIMEOUT=30
while [ $ELAPSED -lt $TIMEOUT ]; do
  RUNNING=$($SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --format '{{.Names}}'" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$RUNNING" ]; then
    echo "All containers stopped."
    break
  fi
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "WARNING: containers may still be running after ${TIMEOUT}s — check manually."
fi

# ── Step 4: Bring up the stack ───────────────────────────────────────────────
echo "Bringing up the stack..."
$SSH "$SUDO sh -c 'cd $NAS_DIR && docker compose up -d --build'"

# ── Step 5: Verify stack is up ───────────────────────────────────────────────
echo "Verifying stack..."
sleep 3
CONTAINERS=$($SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --filter 'name=vpn-report' --format 'table {{.Names}}\t{{.Status}}'")

if [ -z "$CONTAINERS" ]; then
  echo "ERROR: containers did not start. Check NAS logs with: ./deploy.sh --check"
  exit 1
fi

echo "Stack is up:"
echo "$CONTAINERS"
echo ""
echo "✓ Deployment complete! Crons are active and ready to run."
