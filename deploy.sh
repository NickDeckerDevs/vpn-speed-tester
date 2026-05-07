#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSOP_SSH=$(grep '^SYSOP_SSH=' "$SCRIPT_DIR/.env" | cut -d'=' -f2-)

RUN_TEST=false
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --test)  RUN_TEST=true ;;
    --check) CHECK_ONLY=true ;;
  esac
done

echo "Syncing to NAS..."
rsync -avz -e "ssh -p 8322" \
  --exclude='.git' \
  --exclude='node_modules' \
  ~/repos/vpn-speed-tester/ \
  sysop@10.1.10.254:/volume1/Docker/vpn-speed-tester/

echo "Taking down existing stack on NAS..."
ssh -p 8322 sysop@10.1.10.254 \
  "echo $(printf '%q' "$SYSOP_SSH") | sudo -S sh -c 'cd /volume1/Docker/vpn-speed-tester && docker compose down; docker rm -f gluetun-speedtest speedtest-runner orchestrator 2>/dev/null || true'"

echo "Rebuilding and starting stack on NAS..."
ssh -p 8322 sysop@10.1.10.254 \
  "echo $(printf '%q' "$SYSOP_SSH") | sudo -S sh -c 'cd /volume1/Docker/vpn-speed-tester && docker compose up -d --build'"

echo "Waiting for containers to settle..."
sleep 8

echo "Container status:"
ssh -p 8322 sysop@10.1.10.254 \
  "echo $(printf '%q' "$SYSOP_SSH") | sudo -S docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --format 'table {{.Names}}\t{{.Status}}'"

if [ "$RUN_TEST" = true ]; then
  echo "Waiting for gluetun-speedtest to be healthy..."
  sleep 40
  echo "Running test:single — streaming logs from NAS..."
  ssh -p 8322 sysop@10.1.10.254 \
    "echo $(printf '%q' "$SYSOP_SSH") | sudo -S docker exec orchestrator npm run test:single"
  echo "Test complete — taking stack down..."
  ssh -p 8322 sysop@10.1.10.254 \
    "echo $(printf '%q' "$SYSOP_SSH") | sudo -S sh -c 'cd /volume1/Docker/vpn-speed-tester && docker compose down'"
fi

echo "Done."
