#!/bin/bash
# test-manual.sh — Manual smoke-test utility for the orchestrator.
#
# Fires one speed-test window inside the running orchestrator container
# without waiting for the 03:00 cron. NOT part of the scheduled system —
# use this during development or to verify a deploy is working.
#
# Usage:
#   ./test-manual.sh            # run manual window, stream stdout live
#   ./test-manual.sh --logs     # tail today's log file from NAS
#   ./test-manual.sh --servers  # show gluetun's accepted AirVPN server list
#   ./test-manual.sh --check    # show all four container statuses
#
# Changelog
# 2026-05-14  Extracted NAS vars and get_env_var() to lib.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ── Load .env ──────────────────────────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

SYSOP_SSH=$(get_env_var SYSOP_SSH)
if [ -z "$SYSOP_SSH" ] || [[ "$SYSOP_SSH" == *"<"* ]]; then
  echo "ERROR: SYSOP_SSH missing or placeholder in .env"
  exit 1
fi

SUDO="echo $(printf '%q' "$SYSOP_SSH") | sudo -S"

MODE="${1:-run}"

case "$MODE" in
  run|--run|"")
    echo "▶ Triggering one manual speed-test window on the NAS..."
    echo "  (this runs inside the orchestrator container; output streams below)"
    echo "  Use Ctrl+C to detach — the window will keep running on the NAS."
    echo ""
    $SSH "$SUDO docker exec orchestrator node main.js --manual"
    ;;

  --logs|logs)
    DATE=$(date '+%Y-%m-%d')
    echo "▶ Tailing $NAS_DIR/data/logs/$DATE.log on the NAS (Ctrl+C to stop)"
    $SSH "tail -f $NAS_DIR/data/logs/$DATE.log"
    ;;

  --servers|servers)
    echo "▶ Querying gluetun's accepted AirVPN server list..."
    # Python used here instead of jq because the gluetun API response contains
    # duplicate server_name entries; Python's set() deduplicates in one step
    # whereas jq requires a more verbose unique_by() workaround
    $SSH "$SUDO docker exec gluetun-speedtest wget -qO- http://localhost:8000/v1/servers/airvpn" \
      | python3 -c "
import json, sys
data = json.load(sys.stdin)
servers = data if isinstance(data, list) else data.get('servers', [])
names = sorted(set(s.get('server_name') or s.get('name') for s in servers if (s.get('server_name') or s.get('name'))))
print(f'gluetun accepts {len(names)} AirVPN server names:')
print('  ' + ', '.join(names))
"
    ;;

  --check|check)
    echo "▶ Container status on NAS:"
    $SSH "$SUDO docker ps --filter 'name=gluetun-speedtest' --filter 'name=speedtest-runner' --filter 'name=orchestrator' --filter 'name=vpn-report' --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}'"
    ;;

  -h|--help|help)
    sed -n '2,9p' "$0"
    ;;

  *)
    echo "Unknown mode: $MODE"
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
