#!/bin/bash
# view-report.sh — Sync the HTML report from the NAS and open it in a browser.
#
# NOTE: Opens as a file:// URL, which means fetch() calls in index.html will
# fail due to browser security restrictions. Use sync-local.sh to serve the
# report via a local HTTP server with real NAS data for proper local testing.
#
# Changelog
# 2026-05-14  Switched SSH and rsync from password-only to key-based auth (id_nas)
# 2026-05-14  Extracted NAS vars to lib.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
LOCAL_REPORT="$SCRIPT_DIR/report/index.html"

echo "Pulling latest report from NAS..."
rsync -avz -e "$RSYNC_SSH" \
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
