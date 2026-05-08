#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester"
SSH="ssh -p 8322 $NAS"

# ── Load .env and validate required vars ──────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

get_env_var() {
  grep "^$1=" "$ENV_FILE" | cut -d'=' -f2- | tr -d "'\""
}

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
  $SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --format 'table {{.Names}}\t{{.Status}}'"
  exit 0
fi

# ── Step 1: Sync ──────────────────────────────────────────────────────────────
echo "Syncing to NAS..."
rsync -avz -e "ssh -p 8322" \
  --exclude='.git' \
  --exclude='node_modules' \
  ~/repos/vpn-speed-tester/ \
  $NAS:$NAS_DIR/

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

echo "Done. To bring the stack up: SSH to NAS → sudo docker compose up -d --build"
