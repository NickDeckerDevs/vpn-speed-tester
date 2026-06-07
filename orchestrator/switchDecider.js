/*
 * switchDecider.js — The "nervous system": gate the advisor's recommendation through
 * operational policy and decide whether to actually act.
 *
 * Pure + side-effect-free (like switchAdvisor.js and mediaSwitch.js), so it's unit-
 * testable and reusable. It takes a recommendation (from switchAdvisor.recommend),
 * the operational policy (from media-stack/switch-policy.json), the current time, and
 * the last-switch state, and returns whether the switch should happen now.
 *
 * No config.js / logger.js imports on purpose (run + test anywhere).
 *
 *   node orchestrator/switchDecider.test.js   # unit tests
 *
 * Policy knobs (switch-policy.json):
 *   enabled            — master on/off
 *   dryRun             — compute everything but never act (wouldAct true, act false)
 *   cooldownSec        — min seconds between switches; 0/absent = no cooldown
 *   maxSwitchesPerDay  — daily cap; null/absent = unlimited
 *
 * Changelog
 * 2026-06-07  created — Step 3: gate recommend() through operational policy
 */

/**
 * Decide whether to act on a recommendation right now.
 *
 * args:
 *   recommendation : output of switchAdvisor.recommend() (has .action, .to)
 *   policy         : parsed switch-policy.json
 *   now            : current time in ms (Date.now())
 *   lastSwitchTime : ms timestamp of the last performed switch, or null/0 if none
 *   switchesToday  : count of switches already performed today
 *
 * Returns { act, wouldAct, reason }:
 *   wouldAct — the advisor wants to switch (ignores all guards) — for honest logging
 *   act      — we should actually perform the switch now (all guards cleared)
 *   reason   — why we are / aren't acting
 *
 * Never throws — fail-safe to act:false on any malformed input.
 */
function decide({ recommendation, policy, now, lastSwitchTime, switchesToday } = {}) {
  const rec = recommendation || {};
  const pol = policy || {};
  const wouldAct = rec.action === 'switch' && !!rec.to;

  if (!wouldAct) {
    return { act: false, wouldAct: false, reason: `advisor says ${rec.action || 'stay'} — nothing to act on` };
  }

  if (pol.enabled === false) {
    return { act: false, wouldAct, reason: 'disabled (policy.enabled=false)' };
  }

  if (pol.dryRun === true) {
    return { act: false, wouldAct, reason: `dryRun — would switch to ${rec.to}` };
  }

  // Cooldown: 0/absent means no cooldown.
  const cooldownSec = pol.cooldownSec || 0;
  if (cooldownSec > 0 && lastSwitchTime) {
    const elapsedSec = (now - lastSwitchTime) / 1000;
    const leftSec = Math.ceil(cooldownSec - elapsedSec);
    if (leftSec > 0) {
      return { act: false, wouldAct, reason: `cooldown: ${leftSec}s left` };
    }
  }

  // Daily cap: null/absent means unlimited.
  const cap = pol.maxSwitchesPerDay;
  if (cap != null && (switchesToday || 0) >= cap) {
    return { act: false, wouldAct, reason: `daily cap ${cap} reached` };
  }

  return { act: true, wouldAct, reason: `switching to ${rec.to}` };
}

module.exports = { decide };
