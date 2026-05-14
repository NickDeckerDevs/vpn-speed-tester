#!/bin/bash
# view-report.sh — Convenience alias for "view-data.sh report".
#
# Syncs the HTML report directory from the NAS and opens report/index.html
# in the default browser. Kept as a shortcut for muscle-memory; the full
# multi-command interface lives in view-data.sh.
#
# TODO (future): the rsync + browser-open block here is near-duplicated in
# view-data.sh's sync_report()/open_report() functions. NAS connection vars
# (NAS, NAS_DIR, SSH, rsync -e string) are also duplicated across deploy.sh,
# export-summary.sh, view-data.sh, view-report.sh, and test-manual.sh.
# Extract to a shared lib.sh sourced by each script.
#
# Changelog
# 2026-05-14  Switched SSH and rsync from password-only to key-based auth (id_nas)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester"
SSH="ssh -i $HOME/.ssh/id_nas -p 8322 $NAS"
LOCAL_REPORT="$SCRIPT_DIR/report/index.html"

echo "📥 Pulling latest report from NAS..."
rsync -avz -e "ssh -i $HOME/.ssh/id_nas -p 8322" \
  --delete \
  "$NAS:$NAS_DIR/report/" \
  "$SCRIPT_DIR/report/"

echo "✓ Report synced to: $LOCAL_REPORT"

# Try to open in browser
if command -v open &> /dev/null; then
  # macOS
  open "$LOCAL_REPORT"
  echo "✓ Opened in default browser"
elif command -v xdg-open &> /dev/null; then
  # Linux
  xdg-open "$LOCAL_REPORT"
  echo "✓ Opened in default browser"
else
  echo "📄 Open this file in your browser: $LOCAL_REPORT"
fi
