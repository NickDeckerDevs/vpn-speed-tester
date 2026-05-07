Root

.gitignore, .env.example, docker-compose.yml
orchestrator/

Dockerfile — node:20-slim + speedtest-cli via pip
package.json — axios, dockerode, fs-extra, haversine, node-cron, simple-git
config.js — all env-specific values; paths use /data/ (container mount point for Volume 2)
main.js — entrypoint; --manual flag runs one window immediately
scheduler.js — both cron jobs + the full Step 1/2/3 orchestration loop
airvpnStatus.js — fetches US servers, classifies tiers, computes distance via haversine + city coords lookup table
queueBuilder.js — all 4 priority rules including extreme-outlier re-testing when all tiers are covered
gluetunManager.js — stop → remove → createContainer cycle (env vars can't be updated on a live container via Docker API)
speedTester.js — spawnSync to speedtest-cli --json
resultsWriter.js — atomic tmp-file rename write + simple-git commits
aggregator.js — recalculates all session averages from runs
snapshotWriter.js — writes hourly snapshots + maintains snapshots/index.json manifest
qbtClient.js — pause/resume with confirmation poll
report/index.html — single-file static report with two tabs, all Chart.js charts, server drill-down to individual runs, heatmap, best-time-to-connect table. Fetches data at runtime with no caching.

One note on gluetunManager: The spec's container.update({ Env: [...] }) pattern doesn't actually work in the Docker API — env vars are immutable after container creation. The implementation uses stop → remove → createContainer instead, which achieves the same result. Worth knowing before your first manual run.