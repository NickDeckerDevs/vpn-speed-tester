#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"

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

# ── Step 1: Deploy ────────────────────────────────────────────────────────────
echo "Deploying..."
"$SCRIPT_DIR/deploy.sh"

# ── Step 2: Run a single test cycle inside the orchestrator container ─────────
echo ""
echo "Running single test cycle (npm run test:single)..."
echo "Output will stream below. Press Ctrl+C to abort."
echo "────────────────────────────────────────────────────────────"
$SSH "$SUDO docker exec orchestrator npm run test:single"
