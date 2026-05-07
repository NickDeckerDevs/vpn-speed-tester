#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSOP_SSH=$(grep '^SYSOP_SSH=' "$SCRIPT_DIR/.env" | cut -d'=' -f2-)

RUN_TEST=false
if [ "$1" = "--test" ]; then
  RUN_TEST=true
fi

echo "Syncing to NAS..."
rsync -avz -e "ssh -p 8322" \
  --exclude='.git' \
  --exclude='node_modules' \
  ~/repos/vpn-speed-tester/ \
  sysop@10.1.10.254:/volume1/Docker/vpn-speed-tester/

echo "Rebuilding and restarting stack on NAS..."
ssh -p 8322 sysop@10.1.10.254 \
  "echo $(printf '%q' "$SYSOP_SSH") | sudo -S sh -c 'cd /volume1/Docker/vpn-speed-tester && docker compose up -d --build'"

if [ "$RUN_TEST" = true ]; then
  echo "Waiting for orchestrator to be ready..."
  sleep 15
  echo "Running test:single — streaming logs from NAS..."
  ssh -p 8322 sysop@10.1.10.254 \
    "echo $(printf '%q' "$SYSOP_SSH") | sudo -S docker exec orchestrator npm run test:single"
fi

echo "Done."
