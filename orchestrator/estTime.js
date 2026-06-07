/*
 * estTime.js — Session timestamp helper (EST, YYYYMMDDHHMMSS).
 *
 * Extracted from scheduler.js so both the NAS window and the desktop validation
 * loop mint session IDs identically. EST is intentional and matched by the report
 * (see CLAUDE.md "Conventions"); do not switch to UTC.
 *
 * Changelog
 * 2026-06-07  extracted from scheduler.js for reuse by validationMain.js
 */

function getESTTimestamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

module.exports = { getESTTimestamp };
