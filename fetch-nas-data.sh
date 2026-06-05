#!/bin/bash
#
# fetch-nas-data.sh — Read-only pull of collected speed-test data from the NAS.
#
# Copies results / snapshots / raw numbers from the live NAS down into
# analysis/nas-data/ so the data can be analyzed locally WITHOUT touching the
# running stack. This script never writes to the NAS, never runs docker, and
# never deploys — it only reads.
#
# Usage:
#   ./fetch-nas-data.sh              # pull data files + snapshots/
#   ./fetch-nas-data.sh --with-logs  # also pull logs/ (~54 MB)
#
# Modeled on deployAndTestOne.sh: reads SYSOP_SSH (sudo password) from .env and
# SSHes in on port 8322. Docker writes the data as root, so reading it needs
# sudo on the remote — we stream each path out via `sudo tar` over SSH.
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
REMOTE_DATA="/volume1/Docker/vpn-speed-tester/data"
LOCAL_DEST="$SCRIPT_DIR/analysis/nas-data"

WITH_LOGS=false
if [ "$1" == "--with-logs" ]; then
  WITH_LOGS=true
fi

# ── Load sudo password from .env ──────────────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

SYSOP_SSH=$(grep "^SYSOP_SSH=" "$ENV_FILE" | cut -d'=' -f2- | tr -d "'\"")
if [ -z "$SYSOP_SSH" ]; then
  echo "ERROR: SYSOP_SSH not set in .env"
  exit 1
fi

SSH="ssh -p 8322 $NAS"
SUDO="echo $(printf '%q' "$SYSOP_SSH") | sudo -S"

mkdir -p "$LOCAL_DEST"

# Files/dirs to pull (relative to REMOTE_DATA). Missing ones are skipped quietly.
PATHS=(
  results.json
  raw-results.json
  server-data.json
  accepted-servers.json
  unreachable-servers.json
  snapshots
)
if [ "$WITH_LOGS" == "true" ]; then
  PATHS+=(logs)
fi

# Stream only the paths that exist on the NAS, as a single tar, into LOCAL_DEST.
echo "Pulling NAS data → $LOCAL_DEST"
[ "$WITH_LOGS" == "true" ] && echo "(including logs/ — this is large)"

EXISTING=$($SSH "$SUDO bash -c $(printf '%q' "cd '$REMOTE_DATA' && for p in ${PATHS[*]}; do [ -e \"\$p\" ] && echo \"\$p\"; done")" 2>/dev/null)

if [ -z "$EXISTING" ]; then
  echo "ERROR: no data files found at $REMOTE_DATA"
  exit 1
fi

echo "Found:"
echo "$EXISTING" | sed 's/^/  - /'

# shellcheck disable=SC2086
$SSH "$SUDO tar -C '$REMOTE_DATA' -czf - $(echo $EXISTING)" 2>/dev/null | tar -xzf - -C "$LOCAL_DEST"

echo ""
echo "Done. Local copy:"
du -sh "$LOCAL_DEST" 2>/dev/null | sed 's/^/  /'
echo "The live NAS stack was not modified (read-only pull)."
