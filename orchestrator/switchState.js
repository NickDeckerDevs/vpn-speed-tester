/*
 * switchState.js — pure state helpers for the auto-switch runner.
 *
 * Kept free of config.js / logger.js / Docker so the daily-count reset logic is
 * testable anywhere with plain `node` (like switchAdvisor.js / mediaSwitch.js).
 * switchDeciderMain.js does the I/O (read/write /data/switch-state.json) around it.
 *
 *   node orchestrator/switchState.test.js
 *
 * Changelog
 * 2026-06-07  created — Step 3: testable day-reset for the switch-count guard
 */

/**
 * Normalize a raw persisted state against `today` (an EST YYYYMMDD stamp).
 *
 * On a new EST day the switch count resets to 0, but `lastSwitchTime` carries over so
 * the cooldown still spans midnight (a switch at 23:59 must block one at 00:01).
 * Tolerates missing/corrupt raw state (null, non-object, partial) — never throws.
 */
function resolveState(raw, today) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const lastSwitchTime = s.lastSwitchTime || 0;
  if (s.day !== today) return { lastSwitchTime, day: today, count: 0 };
  return { lastSwitchTime, day: today, count: s.count || 0 };
}

module.exports = { resolveState };
