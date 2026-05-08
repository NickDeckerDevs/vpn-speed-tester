# Front-End Reporting & Log Viewer Documentation

## Overview

The AirVPN Speed Test Report (`report/index.html`) is a comprehensive, interactive dashboard for visualizing VPN speed test results and monitoring system logs. It provides real-time insights into server performance, load distribution, and historical trends through charts, tables, and heatmaps.

The dashboard is served via nginx on `http://10.1.10.254:9191` and provides three main sections:
1. **Speed Tests** - Performance metrics and server comparisons
2. **Hourly Snapshots** - Historical server load patterns
3. **Logs** - Real-time application logging with watch mode

---

## Architecture

### Stack
- **Framework**: Vanilla JavaScript (no external dependencies except Chart.js)
- **Styling**: CSS Grid, CSS custom properties, dark theme (slate/blue palette)
- **Charts**: [Chart.js 4.4.1](https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js)
- **Data Format**: JSON (results.json, snapshots/index.json, daily .log files)
- **Deployment**: Served by nginx container, data synced to NAS during deployment

### Data Flow
```
Speed Test Runner → JSON Results → Nginx Server → Browser
                                 ↓
                         report/index.html
                         (loads & renders)
```

The dashboard loads data on initialization and updates dynamically when users interact with the UI.

---

## Tab 1: Speed Tests

### Purpose
Analyze individual speed test sessions and compare performance across servers.

### Key Metrics
- **Download Speed (Mbps)**: Primary performance indicator
- **Upload Speed (Mbps)**: Secondary performance metric
- **Ping (ms)**: Latency to server
- **Jitter (ms)**: Ping variance (stability)
- **Speed Efficiency Ratio**: Download achieved ÷ available server headroom (relative performance metric)

### Tiering System
Tests are classified by server load at time of testing:
- **Low (0–30%)**: Green (#4ade80) — ideal conditions
- **Medium (31–50%)**: Yellow (#facc15) — moderate load
- **High (51–70%)**: Orange (#fb923c) — elevated load
- **Diablo (71–100%)**: Red (#f87171) — extreme load

Sessions are stored in `results.json` under each server, grouped by tier. This allows analysis of performance under different load conditions.

### Sections & Visualizations

#### 1. Average Download Speed by Server (Bar Chart)
```
chart-download-bar
├─ Data: servers sorted by avg download speed (descending)
├─ Color: tier-based (shows dominant tier for each server)
└─ Purpose: Quick overview of best/worst performing servers
```

#### 2. Download Speed vs. Server Load (Scatter Plot)
```
chart-scatter-load
├─ X-axis: Server load % (from snapshot at session start)
├─ Y-axis: Download speed (Mbps)
├─ Points: One per session, colored by tier
├─ Tooltip: Shows server name, speed, and load %
└─ Purpose: Identify correlation between load and performance
```

#### 3. Download Speed vs. Distance (Scatter Plot)
```
chart-scatter-distance
├─ X-axis: Distance from Cape Coral, FL (km)
├─ Y-axis: Download speed (Mbps)
├─ Points: One per server, colored by dominant tier
├─ Tooltip: Shows server name, speed, and distance
└─ Purpose: Analyze geographic latency vs. performance
```

#### 4. Speed Efficiency Ratio (Bar Chart)
```
chart-efficiency
├─ Data: servers with valid efficiency ratios, sorted descending
├─ Metric: (actual download) ÷ (available headroom) = relative performance
├─ Color: Tier-based
└─ Purpose: Which servers deliver best value relative to available capacity
```

#### 5. City Averages (Table)
```
Columns: City | Servers | Avg DL | Avg UL | Avg Ping | Avg Jitter | Sessions
├─ Aggregates: All sessions from all servers in a city
├─ Sorted by: Average download speed (descending)
└─ Purpose: City-level performance insights
```

#### 6. Server Drill-Down (Collapsible Details)
```
<details> structure:
├─ Summary: Server name, city, avg download, session count
├─ Tier sections: Grouped by load tier (low/medium/high/diablo)
├─ Session details:
│  ├─ Tier badge, session ID, start time
│  ├─ Averages: DL/UL/Ping/Jitter
│  └─ Per-run breakdown: Each individual speed test within session
└─ Purpose: Deep dive into server performance history
```

---

## Tab 2: Hourly Snapshots

### Purpose
Track server load patterns over time to identify peak usage hours and optimal connection times.

### Data Source
Snapshots are captured periodically (defined in main cron job) and stored as `snapshots/YYYYMMDD-HHMM.json` files. An index file (`snapshots/index.json`) lists all available snapshots.

Each snapshot contains:
```json
{
  "snapshot_time": "2026-05-07T14:30:00Z",
  "us_servers": [
    { "server_name": "...", "city": "...", "currentload": 45 },
    ...
  ]
}
```

### Sections & Visualizations

#### 1. Server Load Heatmap (Hour of Day)
```
heatmap-grid
├─ Rows: Server names
├─ Columns: UTC hours (00-23)
├─ Cells: Color intensity = average load at that hour
│  ├─ Color scale (alpha intensity based on load %):
│  │  ├─ 0–30%: Green (low)
│  │  ├─ 31–50%: Yellow (medium)
│  │  ├─ 51–70%: Orange (high)
│  │  └─ 71–100%: Red (Diablo)
│  └─ Title: Shows average load % and sample count
├─ Aggregation: All snapshots grouped by server and UTC hour
└─ Purpose: Identify peak load hours and best times to connect
```

#### 2. Average US Server Load Over Time (Line Chart)
```
chart-load-timeline
├─ X-axis: Snapshot timestamp (recent 7 days)
├─ Y-axis: Average load % (0–100)
├─ Data: Mean load across all US servers per snapshot
├─ Styling: Blue line with filled area under curve
└─ Purpose: Trend analysis — identify overall system load patterns
```

#### 3. Average Load by City Over Time (Multi-line Chart)
```
chart-city-load
├─ Lines: One per city (up to 8 top cities)
├─ X-axis: Snapshot timestamp
├─ Y-axis: Average load % (0–100)
├─ Data: Per-city load averages over time
├─ Colors: Distinct palette (8 colors) per city
└─ Purpose: Compare load patterns across cities
```

#### 4. Best Time to Connect (Table)
```
Columns: Server | City | Best Hour (UTC) | Avg Load at Best Hour | Tier
├─ Data: For each server, finds the UTC hour with lowest average load
├─ Tier: Calculated from best-hour load (low/medium/high/diablo)
├─ Sorted by: Best-hour load (ascending) — best connections first
└─ Purpose: Actionable recommendation for optimal connection time
```

---

## Tab 3: Logs

### Purpose
Monitor application activity in real-time and troubleshoot issues.

### Log Source
Logs are stored as daily files: `logs/YYYY-MM-DD.log` (UTC date)

Each log line is JSON formatted and written by the main application.

### Features

#### Refresh
- **Action**: Loads the latest 200 lines from today's log file
- **Function**: `refreshLog()`
- **Stops**: Any active watch session
- **Status**: Updates with refresh timestamp

#### Watch Mode (5 min)
- **Trigger**: Click "Watch 5 min" to start monitoring
- **Behavior**:
  - Polls log file every 10 seconds
  - Appends new lines to the display
  - Auto-scrolls to bottom
  - Updates countdown timer (5:00 → 0:00)
  - Auto-stops after 5 minutes or when user clicks "Stop Watching"
- **Function**: `toggleWatch()` / `startWatch()` / `stopWatch()`
- **State Tracking**: `seenLineCount` tracks last known line count to detect new lines

#### Log Status
Shows current mode:
- `"Last refreshed at <UTC timestamp>"`
- `"Watching — <remaining time>"`
- `"Stopped watching at <UTC timestamp>"`
- `"Error: <message>"` (if fetch fails)

#### Display
- **Font**: Monaco/Menlo monospace
- **Height**: 600px with vertical scroll
- **Content**: Last 200 lines on refresh, cumulative during watch
- **Styling**: Dark background (#0d1117) with light text (#c9d1d9)
- **Word-wrap**: Enabled for long lines

---

## JavaScript Code Organization

### Constants
```javascript
TIER_COLORS      // Hex colors per tier: #4ade80, #facc15, #fb923c, #f87171
TIER_BG          // RGBA backgrounds for chart fills
TIERS            // Array: ['low', 'medium', 'high', 'diablo']
CHART_DEFAULTS   // Chart.js default config (colors, fonts, tooltips)
```

### State Management
```javascript
results           // Object: { server_id: { tiers: {...}, ...} }
snapshots         // Array: Chronologically sorted snapshot objects
charts            // Object: { chart_id: Chart instance }
watchInterval     // Setinterval ID for log polling
watchTimeout      // Timeout ID for 5-min cutoff
seenLineCount     // Last seen line count (tracks new logs)
logsTabInitialized // Flag to lazy-load logs on first tab click
```

### Function Categories

#### Tab & Navigation
- `showTab(id)` — Switch active tab, lazy-load logs
- `refreshLog()` / `toggleWatch()` / `startWatch()` / `stopWatch()` — Log control

#### Data Loading
- `loadData()` — Fetch results.json and snapshot index
- `getLogUrl()` — Generate today's log file path

#### Data Helpers
- `allSessions(serverData)` — Flatten all sessions across tiers
- `serverOverallAvg(serverData)` — Compute server-wide averages
- `dominantTier(serverData)` — Find the tier with most sessions
- `fmt1()`, `fmt2()`, `fmt3()` — Format numbers to 1, 2, 3 decimals
- `tierPill(tier)` — Generate HTML badge for tier

#### Chart Rendering
- `makeChart(id, config)` — Create/replace Chart.js instance
- `renderDownloadBar()` — Tab 1, section 1
- `renderScatterLoad()` — Tab 1, section 2a
- `renderScatterDistance()` — Tab 1, section 2b
- `renderEfficiency()` — Tab 1, section 3
- `renderCityTable()` — Tab 1, section 4
- `renderDrilldown()` — Tab 1, section 5
- `renderHeatmap()` — Tab 2, section 1
- `renderLoadTimeline()` — Tab 2, section 2
- `renderCityLoad()` — Tab 2, section 3
- `renderBestTimeTable()` — Tab 2, section 4

#### Status & Lifecycle
- `updateStatus()` — Update header bar with server/session/snapshot counts
- `init()` — Bootstrap: load data, render all sections

### Event Lifecycle
```
Page Load
  ↓
init()
  ├─ loadData() — fetch results.json, snapshots
  ├─ updateStatus() — show counts in header
  ├─ renderDownloadBar(), renderScatterLoad(), ... (tab 1)
  ├─ renderHeatmap(), renderLoadTimeline(), ... (tab 2)
  └─ (Logs tab: lazy-loaded on first click)

User clicks tab
  ↓
showTab(id)
  └─ If logs tab & not initialized: refreshLog() → fetch log file
```

---

## Data Structure Details

### results.json
```json
{
  "server_id_1": {
    "server_name": "NYC-01",
    "city": "New York",
    "distance_from_cape_coral_km": 1234,
    "tiers": {
      "low": [
        {
          "session_id": "uuid",
          "session_start": "2026-05-07T10:30:00Z",
          "status_at_session_start": { "currentload": 25 },
          "averages": {
            "download_mbps": 450.5,
            "upload_mbps": 50.2,
            "ping_ms": 25.3,
            "jitter_ms": 1.2,
            "speed_efficiency_ratio": 0.92
          },
          "runs": [
            {
              "run": 1,
              "download_mbps": 450.5,
              "upload_mbps": 50.2,
              "ping_ms": 25.3,
              "jitter_ms": 1.2,
              "status_snapshot": { "currentload": 25 }
            },
            ...
          ]
        },
        ...
      ],
      "medium": [...],
      "high": [...],
      "diablo": [...]
    }
  },
  ...
}
```

### snapshots/index.json
```json
["20260507-1030.json", "20260507-1040.json", ...]
```

### snapshots/YYYYMMDD-HHMM.json
```json
{
  "snapshot_time": "2026-05-07T10:30:00Z",
  "us_servers": [
    {
      "server_name": "NYC-01",
      "city": "New York",
      "currentload": 35
    },
    ...
  ]
}
```

### logs/YYYY-MM-DD.log
```
{"timestamp":"2026-05-07T10:30:45.123Z","level":"INFO","message":"Speed test started","server":"NYC-01"}
{"timestamp":"2026-05-07T10:31:30.456Z","level":"INFO","message":"Speed test completed","server":"NYC-01","download_mbps":450.5}
...
```

---

## Performance Considerations

### Data Loading
- **Results**: Single file (cumulative), all data loaded once at startup
- **Snapshots**: Index file lists all snapshots; loads last 7 days (168 snapshots) using `Promise.allSettled()` for fault tolerance
- **Logs**: On-demand per-day file, 200-line window displayed, 10-second poll interval during watch

### Chart Management
- Charts are destroyed and recreated on re-render (via `makeChart()`)
- Chart.js instances stored in `charts` object to prevent memory leaks
- No auto-refresh; data is static after initial load

### Rendering
- Tab 1 (Speed Tests): All charts rendered at startup
- Tab 2 (Snapshots): All charts rendered at startup
- Tab 3 (Logs): Lazy-loaded on first tab click to improve initial load time

---

## Styling & Theme

### Color Palette
- **Primary**: `#3b82f6` (blue) — active elements, highlights
- **Background**: `#0f1117` (near-black) — main background
- **Card BG**: `#1a1d2e` (dark slate) — cards, sections
- **Border**: `#2d3748` (medium slate) — dividers, borders
- **Text Primary**: `#e2e8f0` (light slate) — body text
- **Text Secondary**: `#94a3b8` (medium light) — secondary labels
- **Text Muted**: `#64748b` (muted slate) — quiet text, axes
- **Tier Colors**: Green/Yellow/Orange/Red (as above)

### Layout
- **Grid**: CSS Grid for responsive charts (1fr 1fr on desktop, 1fr on mobile < 900px)
- **Sticky Header**: Navigation always visible
- **Max Width**: 1400px centered content
- **Heatmap**: Custom table layout using CSS display properties

---

## Troubleshooting

### No Data Appears
1. Check that `results.json` exists and is valid JSON
2. Verify `snapshots/index.json` exists
3. Check browser console for fetch errors
4. Ensure nginx is serving files with correct CORS headers (if cross-origin)

### Charts Not Rendering
1. Check that Chart.js CDN is reachable (browser console → Network tab)
2. Ensure data is loaded: check `results` and `snapshots` in console
3. Verify data structure matches expected format

### Logs Tab Shows Error
1. Verify `logs/` directory exists
2. Ensure today's log file (`logs/YYYY-MM-DD.log`) exists
3. Check that log file is world-readable (nginx user can read it)
4. Verify path construction in `getLogUrl()` matches actual file location

### Watch Mode Stops Unexpectedly
1. Check browser console for fetch errors
2. Verify log file is being written to (tail the log file manually)
3. Confirm 5-minute timeout hasn't elapsed
4. Check that poll interval (10 seconds) isn't too frequent for your system

---

## Future Enhancements

- **Auto-refresh**: Periodically reload results.json and snapshots
- **Date Range Filter**: Select custom date ranges for analysis
- **Export**: Download data as CSV or PDF reports
- **Alerts**: Highlight degraded performance (low tier sessions)
- **Comparison**: Compare performance across two date ranges
- **Dark/Light Mode Toggle**: User-selectable theme
- **Mobile Optimization**: Better layout for small screens
- **WebSocket Logs**: Real-time log streaming instead of polling

---

## Maintenance

### When Deploying
1. Update `report/index.html` with any new visualizations
2. Ensure `data/` directory is served by nginx (contains results.json, snapshots/)
3. Ensure `logs/` directory is served and readable by nginx
4. Verify Chart.js CDN is accessible from network

### When Modifying Data Format
1. Update data helpers: `serverOverallAvg()`, `allSessions()`, etc.
2. Update chart render functions to match new structure
3. Update data structure documentation in this file
4. Test with sample JSON files before deploying
