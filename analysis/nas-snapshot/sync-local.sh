#!/bin/bash
# sync-local.sh — Pull NAS data and serve the report locally for development.
#
# Creates .local-staging/ with the directory structure report/index.html expects,
# syncs live data from the NAS, and starts a Python HTTP server on port 9191 so
# all fetch() paths resolve correctly. Use this instead of view-report.sh when
# you need real data or want to test report changes without a full deploy cycle.
#
# .local-staging/ is gitignored — NAS data is never committed.
#
# Usage:
#   ./sync-local.sh          # sync data from NAS, start server, open browser
#   ./sync-local.sh --sync   # sync only (no server)
#   ./sync-local.sh --serve  # start server + open browser (data already synced)
#
# Report URL: http://localhost:9191/report/
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

STAGING="$SCRIPT_DIR/.local-staging"
PORT=9191

DO_SYNC=true
DO_SERVE=true
case "${1:-}" in
  --sync)  DO_SERVE=false ;;
  --serve) DO_SYNC=false ;;
esac

# ── Sync ──────────────────────────────────────────────────────────────────────
if [ "$DO_SYNC" = true ]; then
  if [ ! -f "$HOME/.ssh/id_nas" ]; then
    echo "ERROR: ~/.ssh/id_nas not found"
    exit 1
  fi

  echo "Setting up local staging at $STAGING ..."
  mkdir -p "$STAGING/snapshots" "$STAGING/logs" "$STAGING/report"

  # Symlink report HTML so edits to report/index.html are reflected immediately
  REPORT_LINK="$STAGING/report/index.html"
  if [ ! -L "$REPORT_LINK" ]; then
    ln -sf "$SCRIPT_DIR/report/index.html" "$REPORT_LINK"
    echo "  Linked report/index.html"
  fi

  # Data files live as siblings of report/ on the NAS nginx root, not under a
  # data/ subdir — mirror that layout so fetch('../results.json') etc. resolves
  echo "Syncing data files from NAS..."
  for f in results.json raw-results.json server-data.json; do
    rsync -az -e "$RSYNC_SSH" "$NAS:$NAS_DIR/data/$f" "$STAGING/$f" \
      && echo "  $f" \
      || echo "  (skipped $f — not yet on NAS)"
  done

  echo "Syncing snapshots..."
  rsync -az -e "$RSYNC_SSH" --delete "$NAS:$NAS_DIR/data/snapshots/" "$STAGING/snapshots/" \
    && echo "  snapshots/" \
    || echo "  (skipped snapshots — not yet on NAS)"

  echo "Syncing logs..."
  rsync -az -e "$RSYNC_SSH" --delete "$NAS:$NAS_DIR/data/logs/" "$STAGING/logs/" \
    && echo "  logs/" \
    || echo "  (skipped logs — not yet on NAS)"

  echo "Sync complete."
fi

# ── Serve ─────────────────────────────────────────────────────────────────────
if [ "$DO_SERVE" = true ]; then
  if lsof -ti tcp:$PORT &>/dev/null; then
    echo "Port $PORT already in use — assuming server is running."
  else
    python3 -m http.server $PORT --directory "$STAGING" &>/dev/null &
    echo "Server started on http://localhost:$PORT (PID $!)"
    sleep 0.5
  fi

  URL="http://localhost:$PORT/report/"
  if command -v open &>/dev/null; then
    open "$URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$URL"
  else
    echo "Open in browser: $URL"
  fi
fi
