// Headless assertions for the time maths. No browser, no bundler:
//   node examples/apps/src/kit/timecalc.test.mjs
// Every function is deterministic (any "now" is passed in), so these are reproducible on any machine
// in any timezone — the whole point of the kit's UTC discipline.
import { fromUnix, toUnix, addToDate, diff, convertDuration, relative, humanDuration, normUnit } from "./timecalc.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

console.log("\n── unix → date (+ seconds/ms auto-detect) ───────────────");
expect(fromUnix(0).iso === "1970-01-01T00:00:00.000Z", "unix 0 → the epoch");
expect(fromUnix(1000000000).iso.startsWith("2001-09-09"), "1e9 s → 2001-09-09");
expect(fromUnix(1000000000).detectedUnit === "seconds", "10-digit value read as seconds");
expect(fromUnix(1700000000000).detectedUnit === "milliseconds", "13-digit value read as ms");
expect(fromUnix(1700000000).iso === fromUnix(1700000000000).iso, "same instant whether given s or ms");
expect(fromUnix("not a number") === null, "non-numeric → null");

console.log("\n── date → unix ──────────────────────────────────────────");
expect(toUnix("1970-01-01T00:00:00Z").seconds === 0, "epoch string → 0 s");
expect(toUnix("2001-09-09T01:46:40Z").seconds === 1000000000, "known UTC string → 1e9 s");
expect(toUnix("2024-06-01 12:00:00Z").ms === Date.parse("2024-06-01T12:00:00Z"), "space-separated form parses");
expect(toUnix("gibberish") === null, "non-date → null");

console.log("\n── date arithmetic (UTC, calendar-clamped) ──────────────");
expect(addToDate("2024-01-15T00:00:00Z", 10, "days").startsWith("2024-01-25"), "+10 days");
expect(addToDate("2024-01-15T00:00:00Z", -20, "days").startsWith("2023-12-26"), "−20 days crosses the year");
expect(addToDate("2024-01-31T00:00:00Z", 1, "month").startsWith("2024-02-29"), "Jan 31 +1mo clamps to Feb 29 (leap)");
expect(addToDate("2023-01-31T00:00:00Z", 1, "month").startsWith("2023-02-28"), "Jan 31 +1mo clamps to Feb 28 (non-leap)");
expect(addToDate("2024-03-15T00:00:00Z", 1, "year").startsWith("2025-03-15"), "+1 year");
expect(addToDate("bad", 1, "day") === null, "bad date → null");
expect(addToDate("2024-01-01T00:00:00Z", 1, "fortnight") === null, "unknown unit → null");

console.log("\n── diff between two dates ───────────────────────────────");
const d = diff("2024-01-01T00:00:00Z", "2024-01-02T06:30:00Z");
expect(Math.abs(d.hours - 30.5) < 1e-6, "30.5 hours between the two");
expect(d.days === 1.2708333333333333, "days is exact/fractional");
expect(d.human === "1d 6h 30m", "human breakdown 1d 6h 30m");
expect(d.future === true, "b after a → future:true");
expect(diff("2024-01-02T00:00:00Z", "2024-01-01T00:00:00Z").future === false, "reversed → future:false");
expect(diff("x", "2024-01-01") === null, "bad input → null");

console.log("\n── duration conversion ──────────────────────────────────");
expect(convertDuration(90, "min", "hour") === 1.5, "90 min = 1.5 hour");
expect(convertDuration(1, "day", "hour") === 24, "1 day = 24 hours");
expect(convertDuration(2, "week", "day") === 14, "2 weeks = 14 days");
expect(Number.isNaN(convertDuration(1, "day", "lightyear")), "unknown unit → NaN (not a wrong number)");
expect(normUnit("mins") === "minute" && normUnit("hrs") === "hour", "unit aliases normalise");

console.log("\n── relative + humanDuration (deterministic clock) ───────");
const now = Date.parse("2024-06-15T12:00:00Z");
expect(relative(now - 3 * 86400000, now) === "3 days ago", "3 days ago");
expect(relative(now + 2 * 3600000, now) === "in 2 hours", "in 2 hours");
expect(relative(now - 30000, now) === "just now", "under a minute → just now");
expect(humanDuration(0) === "0s", "zero span → 0s (never empty)");
expect(humanDuration(3661000) === "1h 1m 1s", "1h 1m 1s kept when there are no days");
expect(humanDuration(90061000) === "1d 1h 1m", "seconds DROPPED once a span reaches days (noise)");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
