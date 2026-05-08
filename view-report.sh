#!/bin/bash

# Sync report from NAS and open in default browser
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester"
SSH="ssh -p 8322 $NAS"
LOCAL_REPORT="$SCRIPT_DIR/report/index.html"

echo "📥 Pulling latest report from NAS..."
rsync -avz -e "ssh -p 8322" \
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
