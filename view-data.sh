#!/bin/bash
# view-data.sh — Multi-command utility to inspect VPN speed-test results.
#
# Subcommands: report (default, opens HTML in browser), summary, json, servers,
# logs, sync, help. The "report" subcommand is functionally identical to
# view-report.sh — that script is kept as a convenience alias.
#
# TODO (future): sync_report() and the browser-open logic here are near-duplicated
# in view-report.sh. NAS connection vars (NAS, NAS_DIR, SSH, rsync -e string) are
# also duplicated across deploy.sh, export-summary.sh, view-data.sh, view-report.sh,
# and test-manual.sh. Extract to a shared lib.sh sourced by each script.
#
# Changelog
# 2026-05-14  Switched SSH and rsync from password-only to key-based auth (id_nas)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester/data"
SSH="ssh -i $HOME/.ssh/id_nas -p 8322 $NAS"

show_usage() {
  cat << 'EOF'
Usage: ./view-data.sh [COMMAND]

Commands:
  report      Pull and open HTML report in browser (default)
  summary     Show a quick summary of all test results
  json        Show raw results.json data
  servers     List all servers tested with counts
  logs        Show the latest orchestrator logs (last 50 lines)
  sync        Just sync the report without opening
  help        Show this help message

Examples:
  ./view-data.sh report                    # Open report in browser
  ./view-data.sh summary                   # Show test summary
  ./view-data.sh json | jq '.["Aladfar"]'  # View data for specific server

EOF
}

sync_report() {
  echo "📥 Pulling latest report from NAS..."
  rsync -avz -e "ssh -i $HOME/.ssh/id_nas -p 8322" \
    --delete \
    "$NAS:${NAS_DIR%/data}/report/" \
    "$SCRIPT_DIR/report/" > /dev/null 2>&1
  echo "✓ Report synced"
}

open_report() {
  sync_report
  LOCAL_REPORT="$SCRIPT_DIR/report/index.html"
  if command -v open &> /dev/null; then
    open "$LOCAL_REPORT"
    echo "✓ Opened: $LOCAL_REPORT"
  elif command -v xdg-open &> /dev/null; then
    xdg-open "$LOCAL_REPORT"
    echo "✓ Opened: $LOCAL_REPORT"
  else
    echo "📄 Open this file in your browser: $LOCAL_REPORT"
  fi
}

show_summary() {
  echo "📊 Speed Test Summary"
  echo "===================="
  $SSH "cat $NAS_DIR/results.json 2>/dev/null" 2>/dev/null | jq 'to_entries | map({server: .key, sessions: (.value.tiers | to_entries | map(.value | length) | add)}) | sort_by(.sessions) | reverse' 2>/dev/null || echo "No results yet"
}

show_servers() {
  echo "🌐 Tested Servers"
  echo "================="
  $SSH "cat $NAS_DIR/results.json 2>/dev/null" 2>/dev/null | jq -r 'to_entries[] | "\(.key) (\(.value.city)): \(.value.tiers | to_entries | map(.value | length) | add) sessions"' 2>/dev/null | sort || echo "No results yet"
}

show_json() {
  echo "Fetching results.json from NAS..."
  $SSH "cat $NAS_DIR/results.json 2>/dev/null" 2>/dev/null || echo "Error: Could not fetch results.json from NAS"
}

show_logs() {
  echo "📋 Recent Orchestrator Logs (last 50 lines)"
  echo "=========================================="
  $SSH "tail -50 $NAS_DIR/logs/\$(date +%Y-%m-%d).log 2>/dev/null" 2>/dev/null || echo "No logs yet"
}

COMMAND="${1:-report}"

case "$COMMAND" in
  report)   open_report ;;
  summary)  show_summary ;;
  servers)  show_servers ;;
  json)     show_json ;;
  logs)     show_logs ;;
  sync)     sync_report ;;
  help|-h)  show_usage ;;
  *)        echo "Unknown command: $COMMAND"; echo; show_usage; exit 1 ;;
esac
