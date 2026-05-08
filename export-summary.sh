#!/bin/bash

# Export a text summary of speed test results
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAS="sysop@10.1.10.254"
NAS_DIR="/volume1/Docker/vpn-speed-tester/data"
SSH="ssh -p 8322 $NAS"
OUTPUT_FILE="${1:-vpn-speed-test-summary.txt}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "⏳ Generating summary report..."

# Sync data locally first
echo "  Syncing data from NAS..."
rsync -avz -e "ssh -p 8322" --include="results.json" --exclude="*" \
  "$NAS:$NAS_DIR/" "$SCRIPT_DIR/data/" > /dev/null 2>&1

DATA=$(cat "$SCRIPT_DIR/data/results.json" 2>/dev/null)

if [ -z "$DATA" ]; then
  echo "❌ Error: Could not fetch results from NAS"
  exit 1
fi

cat > "$OUTPUT_FILE" << EOF
╔════════════════════════════════════════════════════════════╗
║              AirVPN Speed Test Summary Report               ║
╚════════════════════════════════════════════════════════════╝

Generated: $TIMESTAMP

═════════════════════════════════════════════════════════════
TESTED SERVERS SUMMARY
═════════════════════════════════════════════════════════════

EOF

echo "$DATA" | jq -r 'to_entries | sort_by(.value.tiers | to_entries | map(.value | length) | add) | reverse[] | "Server: \(.key)\nLocation: \(.value.city)\nSessions: \(.value.tiers | to_entries | map(.value | length) | add)\nTiers: low=\(.value.tiers.low | length) medium=\(.value.tiers.medium | length) high=\(.value.tiers.high | length) diablo=\(.value.tiers.diablo | length)\n"' >> "$OUTPUT_FILE" 2>/dev/null || {
  echo "Note: Install jq to see formatted summary"
  echo "$DATA" >> "$OUTPUT_FILE"
}

cat >> "$OUTPUT_FILE" << EOF

═════════════════════════════════════════════════════════════
AVERAGE SPEEDS BY SERVER
═════════════════════════════════════════════════════════════

EOF

echo "$DATA" | jq -r 'to_entries[] |
  (.value.tiers | to_entries | map(.value[] | .averages.download_mbps // 0) | map(select(. > 0)) |
    if length > 0 then
      {avg: (add / length | round), count: length}
    else
      {avg: "N/A", count: 0}
    end) as $stats |
  "\(.key) (\(.value.city)): \($stats.avg) Mbps avg (from \($stats.count) runs)"' >> "$OUTPUT_FILE" 2>/dev/null || {
  echo "Note: Install jq to see speed statistics"
}

cat >> "$OUTPUT_FILE" << EOF

═════════════════════════════════════════════════════════════
DATA FILE LOCATIONS (on NAS)
═════════════════════════════════════════════════════════════

Results JSON: /volume1/Docker/vpn-speed-tester/data/results.json
HTML Report:  /volume1/Docker/vpn-speed-tester/report/index.html
Snapshots:    /volume1/Docker/vpn-speed-tester/data/snapshots/

═════════════════════════════════════════════════════════════
Generated on $TIMESTAMP
═════════════════════════════════════════════════════════════
EOF

echo "✓ Report saved to: $OUTPUT_FILE"
echo ""
cat "$OUTPUT_FILE"
