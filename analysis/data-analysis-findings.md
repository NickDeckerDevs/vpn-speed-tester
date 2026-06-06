# AirVPN US WireGuard Speed-Test Data Analysis

Data window: **2026-05-08 → 2026-06-01** (snapshots run through 2026-06-02).
Sources: `nas-clone/data/{results.json, raw-results.json, server-data.json, snapshots/}`.
Sessions: **371** (each = 3 back-to-back runs) → **1,110 individual runs**, all with valid download data. **31 distinct servers** across **8 cities**.

All download/upload figures are **Mbps** (raw bits/s ÷ 1e6). Ping in ms.

---

## Top takeaways

- **Miami is the sweet spot.** Miami servers deliver ~260 Mbps median at **22 ms** ping — by far the lowest latency, which strongly implies the test client sits in/near Florida. The single fastest individual servers are **Leo (Dallas, 333 Mbps median)** and **Aladfar (Miami, 308)**, but Miami wins on the latency-adjusted balance.
- **Fast does not mean stable.** Every top server has a high coefficient of variation (CV 35–60%). The most *consistent* of the fast group is **Volans (Dallas)** — 283 Mbps median, CV 35%. Treat single-session numbers as noisy; you need multiple sessions per server.
- **Avoid the West Coast and Atlanta.** Fremont (7.5 Mbps, 203 ms ping), San Jose (57 Mbps), and Atlanta (24 Mbps) are consistently poor from this vantage point — almost certainly a distance/routing penalty, not server quality.
- **Load predicts throughput — but only within a city.** Pooled across all servers, load↔download correlation is a weak **r = −0.31**. Within a single city (geography held constant) it jumps to **r ≈ −0.63 (Miami) / −0.68 (Dallas)**. Load is a genuinely useful predictor once you stop letting geography confound it.
- **Throughput falls off a cliff above 75% load.** Median download by load bucket: 25–50% → **245 Mbps**, 50–75% → **181**, 75–100% → **80**. The 0–25% bucket is noisy/low-n (75 runs, dragged by far-city servers).
- **Lowest server load is ~06–12 UTC** (≈42–46% fleet-wide) vs ~50–57% in the 00–03 and 18–23 UTC peaks. This pattern is stable day to day.
- **Test timing should change.** The cron fires at 3 AM local; in the snapshot data 03 UTC is actually near a *load peak*. Shifting the window toward ~08–11 UTC would sample lower-load conditions.
- **Data is clean.** Zero null downloads (the historical missing-`await` bug is not present here). Only 5 of 1,110 runs are near-zero failures, and only 6 of 371 sessions have <3 runs.

---

## 1. Fastest servers (top ranked by median download)

| # | Server | City | Sessions | Runs | Med DL | Mean DL | SD | CV% | Min | Max | Med UL | Med Ping |
|---|--------|------|---------:|-----:|-------:|--------:|---:|----:|----:|----:|-------:|---------:|
| 1 | Leo | Dallas, TX | 12 | 36 | **333.0** | 300.9 | 124.4 | 41.3 | 52 | 509 | 112 | 55.5 |
| 2 | Aladfar | Miami | 12 | 36 | **308.3** | 265.4 | 130.8 | 49.3 | 38 | 490 | 225 | 21.2 |
| 3 | Sadachbia | Denver, CO | 3 | 9 | **305.8** | 358.4 | 171.1 | 47.7 | 146 | 573 | 118 | 69.3 |
| 4 | Meleph | Miami | 14 | 39 | 301.3 | 293.0 | 126.0 | 43.0 | 50 | 526 | 207 | 21.3 |
| 5 | Volans | Dallas, TX | 12 | 36 | 282.8 | 275.7 | 96.0 | **34.8** | 95 | 455 | 105 | 55.9 |
| 6 | Ascella | Miami | 12 | 36 | 271.0 | 291.5 | 136.7 | 46.9 | 92 | 671 | 238 | 21.1 |
| 7 | Scutum | Dallas, TX | 11 | 33 | 269.3 | 237.5 | 87.6 | 36.9 | 51 | 348 | 114 | 57.7 |
| 8 | Polis | Raleigh, NC | 13 | 39 | 266.6 | 253.6 | 89.8 | 35.4 | 62 | 499 | 118 | 57.4 |
| 9 | Giausar | Miami | 13 | 39 | 242.7 | 237.2 | 101.3 | 42.7 | 66 | 460 | 211 | 24.2 |
| 10 | Helvetios | Dallas, TX | 12 | 36 | 226.2 | 219.2 | 101.5 | 46.3 | 49 | 486 | 93 | 57.2 |

Notes:
- **Sadachbia (Denver)** posts the highest *mean* (358) but only has 3 sessions/9 runs — under-sampled, treat as provisional.
- **Upload** is highest on Miami servers (Ascella 238, Aladfar 225, Giausar 211 Mbps) — Miami is the upload champion as well as low-latency.
- **Ping** cleanly clusters by city: Miami ~21–24 ms, Dallas ~55–59 ms, Raleigh ~57, Denver ~69, Chicago ~75, Atlanta ~70, San Jose ~90, Fremont ~203.

Overall fleet: median download **127 Mbps**, mean **158**, range 0 → 671.

### Worst servers (bottom 8 by median)

| Server | City | Sessions | Med DL | CV% |
|--------|------|---------:|-------:|----:|
| Musca | Atlanta, GA | 13 | 3.8 | 146.8 |
| Aquila | Fremont, CA | 12 | 7.5 | 81.3 |
| Hercules | Atlanta, GA | 11 | 17.1 | 67.9 |
| Fang | Chicago, IL | 14 | 23.6 | 174.7 |
| Sculptor | Atlanta, GA | 12 | 25.9 | 44.1 |
| Libra | Atlanta, GA | 12 | 29.0 | 143.4 |
| Ursa | Atlanta, GA | 13 | 33.2 | 112.6 |
| Imai | San Jose, CA | 11 | 52.7 | 111.3 |

Atlanta dominates the bottom — 5 of the worst 8. These are also the flakiest (CV > 100%).

### By city (median across all runs)

| City | Runs | Med DL | Med Ping |
|------|-----:|-------:|---------:|
| Denver, CO | 9 | 305.8 | 69.3 |
| Raleigh, NC | 39 | 266.6 | 57.4 |
| Miami | 224 | 260.7 | **22.2** |
| Dallas, TX | 362 | 198.7 | 59.4 |
| Chicago, IL | 189 | 101.5 | 75.1 |
| San Jose, CA | 69 | 56.6 | 89.9 |
| Atlanta, GA | 182 | 23.9 | 70.0 |
| Fremont, CA | 36 | 7.5 | 203.4 |

**Recommendation:** for production, prefer **Miami** (best latency + strong throughput + best upload). Use Dallas/Raleigh as secondary. Hard-avoid Atlanta and the two California POPs from this vantage point.

---

## 2. Consistency: fast AND consistent vs fast but flaky

Coefficient of variation (CV = SD/mean) across each server's runs. Lower = steadier.

| Server | City | Med DL | CV% | Verdict |
|--------|------|-------:|----:|---------|
| Volans | Dallas, TX | 282.8 | 34.8 | **Fastest of the steady group** |
| Polis | Raleigh, NC | 266.6 | 35.4 | Steady |
| Scutum | Dallas, TX | 269.3 | 36.9 | Steady |
| Leo | Dallas, TX | 333.0 | 41.3 | Fast, moderately variable |
| Giausar | Miami | 242.7 | 42.7 | Moderate |
| Meleph | Miami | 301.3 | 43.0 | Fast, moderate |
| Helvetios | Dallas, TX | 226.2 | 46.3 | Moderate |
| Ascella | Miami | 271.0 | 46.9 | Fast but swingy |
| Sadachbia | Denver, CO | 305.8 | 47.7 | Fast but swingy (low-n) |
| Aladfar | Miami | 308.3 | 49.3 | **Fast but flaky** (38–490) |
| Chertan | Miami | 223.2 | 59.9 | Flaky (one ~0 run) |

**Conclusion:** No top server is "tight." Even the best swing 2–10×. If you want predictable throughput, **Volans / Polis / Scutum** (CV ~35%) are the safer picks; **Leo and Meleph** give the best *expected* speed if you can tolerate variance. **Aladfar** has the highest ceiling among Miami but the widest spread — good median, risky single-pull. This variance is exactly why 3 runs/session and many sessions/server matter; never rank a server on one session.

---

## 3. Does load predict throughput?

`currentload` is the AirVPN-reported load % at session start (from `server-data.json`, joined on timestamp).

| Pearson r | n | Interpretation |
|-----------|--:|----------------|
| **−0.31** | 1,110 runs (pooled) | Weak negative |
| **−0.33** | 374 session means | Weak negative |
| **−0.63** | Miami-only runs | Moderate–strong |
| **−0.68** | Dallas-only runs | Moderate–strong |

Median download by load bucket (pooled):

| Load bucket | n | Median DL | Mean DL |
|-------------|--:|----------:|--------:|
| 0–25% | 75 | 128.9 | 195.0 |
| 25–50% | 245 | **245.2** | 215.0 |
| 50–75% | 344 | 181.3 | 177.5 |
| 75–100% | 446 | **80.2** | 106.5 |

**Conclusion: load IS a useful predictor, but geography is a confounder.** Pooled, load looks weak (−0.31) because a low-load Fremont server is still slow (distance) while a high-load Miami server is still fast (proximity) — the two effects fight each other. **Once you hold city constant, load explains ~40–46% of the variance in throughput (r ≈ −0.63 to −0.68).** Practically: above 75% load, expect throughput to roughly halve. The odd 0–25% bucket (lower median than 25–50%) is small-n and skewed by far-city servers that happened to be lightly loaded — don't over-read it.

**Recommendation for production selection:** filter to nearby cities first (Miami/Dallas/Raleigh), *then* pick the lowest-load server within that set. Don't rank purely on global load.

---

## 4. Best time of day

Two angles. **Use the snapshot data (every server, every hour) for the load question** — it's unconfounded. The measured-speed-by-hour is confounded by *which* servers were tested when.

### Fleet load by hour (UTC) — from hourly snapshots

Representative full days (per-snapshot average load across all ~48 US servers):

| Hour UTC | May 8 | May 20 |
|---------:|------:|-------:|
| 00 | – | 54.4 |
| 03 | 48.2 | 53.9 |
| 06 | 42.8 | 43.5 |
| 09 | **39.6** | 46.5 |
| 11 | **38.1** | **42.3** |
| 12 | 40.3 | 44.3 |
| 15 | 45.4 | 44.6 |
| 18 | 48.3 | 51.2 |
| 21 | 48.2 | 51.2 |
| 23 | 47.0 | 47.9 |

**Lowest fleet load sits in the ~06–12 UTC trough (~40–45%); peaks are 00–03 and 18–23 UTC (~50–57%).** The shape is stable across days. (Aggregating all 603 snapshots in one pass was blocked by the sandbox's argument-list limit; the per-day cross-checks above are consistent and sufficient to establish the pattern — see caveats.)

### Measured download by hour (UTC, session start) — confounded

| Hour | n | Median DL |
|-----:|--:|----------:|
| 03 | 93 | **318.0** |
| 06 | 33 | 156.3 |
| 09 | 81 | 51.6 |
| 10 | 87 | 103.2 |
| 11 | 51 | 178.1 |
| 17 | 50 | 96.2 |
| 20 | 69 | 79.6 |
| 21 | 178 | 107.0 |
| 22 | 186 | 151.5 |
| 23 | 186 | 111.5 |

Hour 03 looks fastest here, but this is **not** a clean time-of-day signal — the 3 AM scheduled window tends to test the high-coverage (often nearby/fast) servers, so the hour and the server set are tangled. Do not conclude "3 AM is fastest" from this table.

**Conclusion:** For lowest *load*, connect in the **06–12 UTC** window. The measured-speed table can't override this because of the server-mix confound, but it doesn't contradict it either (06 and 11 are respectable). See recommendation in §6 about moving the test window.

---

## 5. Coverage

- **31 distinct servers**, **8 cities**, **371 sessions**, **1,110 runs**.
- Tier coverage (AirVPN load tier at session start): diablo **177**, high **84**, medium **60**, low **50** sessions. The collection is **heavily skewed toward "diablo" (highest-load) tier** — consistent with the queue builder preferring to hit busy servers, but it under-samples low-load conditions.
- Per-server sampling is mostly 11–14 sessions (33–42 runs) — solid. **Exception: Sadachbia (Denver) has only 3 sessions** and Denver as a city only 9 runs total → its rank-3 standing is under-powered.
- Cities are unevenly sampled: Dallas (362 runs) and Miami (224) dominate; Denver (9) and Fremont (36) are thin.
- 6 of 371 sessions completed <3 runs (2 sessions = 1 run, 4 = 2 runs). 5 runs across the dataset are near-zero (failed speedtests retained in data).

**Gaps:** Denver under-sampled; low-load tier under-sampled; only one snapshot exists for 2026-05-08 hour 03 onward partial first day (21 vs 24 snapshots) and the run is missing pre-03:30. No west-coast redundancy beyond 2 POPs.

---

## 6. Other findings, surprises, and recommendations

- **The test client is almost certainly in Florida.** Miami's 22 ms ping vs everything else ≥55 ms is the giveaway. This means the whole dataset measures throughput *to a Florida vantage point*, which is fine if production traffic also originates there — but the West-Coast "bad servers" may be perfectly good for a West-Coast client. Document the vantage point; don't generalize these rankings to other origins.
- **Move the test window off 3 AM local.** The scheduler fires at `0 3 * * *`, but in UTC snapshot terms 03 UTC is near a *load peak*, not a trough. If the goal is to characterize servers under *typical* or *favorable* load, sampling the 06–12 UTC trough (or spreading across hours) would be more representative. Right now the 3 AM bias plus the diablo-tier preference means you're over-measuring busy-server conditions.
- **Stratify reporting by city, not just by global tier.** Because geography dominates the pooled correlation, all downstream selection logic should be "nearest cities → then lowest load," and analysis tables should always hold city constant.
- **Variance is the real story.** With CVs of 35–60% even on the best servers, a single 3-run session is a weak estimate. Going forward, report **median ± CV** and require ≥5 sessions before trusting a server's rank. Consider increasing runs/session or sessions/server for the borderline-fast servers (Leo, Aladfar, Meleph) to tighten the estimate.
- **The 5 near-zero runs and the 0-Mbps min on Chertan** indicate occasional speedtest failures that still get written. They inflate CV and drag means. Recommend flagging runs < ~5 Mbps as suspect and excluding them from the "speed" estimate (but keeping them as a reliability signal — a server that *sometimes* returns ~0 is itself a yellow flag).
- **Upload is decoupled from download geography-wise.** Miami's upload (200–240 Mbps) far exceeds Dallas (~100). If upload matters for the production workload (it's a torrent box — seeding does), Miami is even more clearly the right default.
- **Recommended default server set:** primary **Miami (Meleph / Aladfar / Giausar)**; throughput-max **Leo (Dallas)**; consistency-priority **Volans (Dallas) / Polis (Raleigh)**. Re-pick within that set by live load.

---

## Method / caveats

- **Tooling:** all aggregation done with `jq` over the local JSON files. (The sandbox blocked `python3`/`node` script execution and blocked shell glob expansion / very long argument lists, so the 603 hourly snapshots could not be aggregated in a single pass; hour-of-day load is established from representative full-day cross-sections — May 8 and May 20 — which agree, plus the measured-speed-by-hour table from the raw runs. The server/city/load/correlation results use the complete dataset.)
- **Joins:** raw runs → sessions via the `${timestamp}` prefix of the raw key; sessions → AirVPN status row via the same timestamp into `server-data.json`. Server name taken from `results.json` (falling back to `server-data.public_name`); city = `server-data.location`. All 1,110 runs joined successfully (0 sessions missing from raw).
- **Units:** download/upload converted bits/s → Mbps (÷1e6). Ping in ms as reported.
- **Statistics:** median = standard middle value; mean = arithmetic; SD = sample stdev (n−1); CV = SD/mean×100; Pearson r computed directly. Correlations computed at both per-run (n=1,110) and per-session-mean (n=374) granularity.
- **Hour field:** `timestamp[8:10]` yields the stored hour; note some session timestamps carry hour "24" (32 sessions), i.e. the source clock encodes midnight as 24 and these appear to be **local NAS time, not UTC**, whereas snapshot `snapshot_time` is ISO-8601 UTC. The measured-speed-by-hour table therefore is **not** directly comparable hour-for-hour with the snapshot-load table; they answer related but differently-clocked questions. This is the main reason §4 leans on the snapshot data for the load conclusion.
- **Data quality:** 0 null downloads; 5 near-zero (<1 Mbps) failed runs retained; 6 of 371 sessions have <3 runs. Tier distribution skewed toward diablo (highest load). Denver and the 0–25% load bucket are small-n; treat their figures as provisional.
- **Vantage point:** inferred Florida client (Miami 22 ms ping). Rankings are origin-specific and should not be assumed to hold for other client locations.
