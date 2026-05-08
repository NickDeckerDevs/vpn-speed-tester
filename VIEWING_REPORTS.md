# Viewing Speed Test Reports

Your VPN speed test data is automatically collected on the NAS at `/volume1/Docker/vpn-speed-tester/`. You can view it from your local computer using the tools provided.

## Quick Start

### View the HTML Report (Recommended)
```bash
./view-report.sh
```
This pulls the latest report from the NAS and opens it in your default browser. The report includes interactive charts and summaries.

### Alternative: View Data Commands
```bash
./view-data.sh                # Show HTML report (same as view-report.sh)
./view-data.sh summary        # Quick summary table
./view-data.sh servers        # List all tested servers  
./view-data.sh json           # Raw JSON data (pipe to jq for filtering)
./view-data.sh logs           # Show latest orchestrator logs
./view-data.sh sync           # Just sync the report without opening
./view-data.sh help           # Show all commands
```

## Examples

**Show a quick summary:**
```bash
./view-data.sh summary
```

**View data for a specific server:**
```bash
./view-data.sh json | jq '.["Aladfar"]'
```

**Get average speeds per server:**
```bash
./view-data.sh json | jq 'to_entries[] | {server: .key, city: .value.city, avg_down: (.value.tiers | to_entries | map(.value[].averages.download_mbps // 0) | map(select(. > 0)) | if length > 0 then (add / length | round) else 0 end)}'
```

**View latest test logs:**
```bash
./view-data.sh logs
```

## What Gets Synced

The scripts pull:
- **HTML Report** (`report/index.html`) — Interactive charts and dashboards
- **Raw Data** (`data/results.json`) — All speed test results in JSON format
- **Snapshots** (`data/snapshots/`) — Hourly server status snapshots

## Data Structure

Results are stored in `/data/results.json` on the NAS with this structure:
```json
{
  "ServerName": {
    "server_name": "...",
    "city": "...",
    "tiers": {
      "low": [{ session_id, runs: [...] }],
      "medium": [...],
      "high": [...],
      "diablo": [...]
    }
  }
}
```

Each session contains 3 speed test runs with download, upload, and ping measurements.

## Requirements

- `rsync` and `ssh` (usually pre-installed on macOS/Linux)
- Access to the NAS SSH (port 8322)
- Optional: `jq` for filtering JSON data

## Troubleshooting

**"Error connecting to NAS":** Check that you have SSH access to `sysop@10.1.10.254:8322`

**jq not found:** Install with `brew install jq` (macOS) or `apt install jq` (Linux)

**Report not opening:** You can manually open the report at `./report/index.html` in your browser
