// TIME CALC — the pure date/time maths behind "what is this timestamp, and how far apart are these?".
//
// Harvested-idea sibling of kit/contrast.js and kit/qr-payload.js: deterministic, in-tab, no-model
// functions any wrapp / God-tool / widget can call. Timestamps and durations are exactly the shape
// that fits a launcher command + a notch glance — a value in, a converted value out.
//
// DETERMINISM RULE: the tested functions never call `Date.now()` / `new Date()` with no argument.
// Anything that needs "now" (relative time) takes `nowMs` IN, so the tests feed a fixed clock and the
// answer is reproducible. Parsing a caller-supplied date STRING via `new Date(str)` is fine — the
// input is provided, so the output is a pure function of it.
//
// All calendar maths runs in UTC. A local machine's timezone must never change what `addToDate` or
// `diff` returns for the same inputs, or the tests pass on one laptop and fail on another.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/timecalc.test.mjs).

// ── unit tables (everything reduces to milliseconds) ─────────────────────────────────────────
const MS = { ms: 1, second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };

// The aliases people actually type, mapped to a canonical unit key. Kept generous on purpose: a
// launcher command says "90 minutes", a UI dropdown says "min", the God tool might say "mins".
const UNIT_ALIASES = {
  ms: "ms", milli: "ms", millis: "ms", millisecond: "ms", milliseconds: "ms",
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  m: "minute", min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  d: "day", day: "day", days: "day",
  w: "week", wk: "week", week: "week", weeks: "week",
  mo: "month", mon: "month", month: "month", months: "month",
  y: "year", yr: "year", year: "year", years: "year",
};
/** Canonical unit key, or null if we don't recognise it. */
export function normUnit(u) {
  if (u == null) return null;
  return UNIT_ALIASES[String(u).trim().toLowerCase()] || null;
}

// ── unix timestamp → date ───────────────────────────────────────────────────────────────────
// A raw number is ambiguous: 1_700_000_000 is seconds (2023), 1_700_000_000_000 is milliseconds
// (also 2023). We auto-detect by magnitude: ≥ 1e12 is milliseconds, otherwise seconds. That boundary
// reads a whole-second timestamp correctly for every date up to the year ~33000, which is every date
// anyone means, while still catching the 13-digit millisecond form.
const MS_THRESHOLD = 1e12;

/** Parse a unix timestamp (seconds OR milliseconds, auto-detected) into an absolute instant.
 *  Returns { iso, ms, seconds, detectedUnit }, or null for non-numeric / out-of-range input. */
export function fromUnix(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  const detectedUnit = Math.abs(n) >= MS_THRESHOLD ? "milliseconds" : "seconds";
  const ms = Math.round(detectedUnit === "milliseconds" ? n : n * 1000);
  const iso = msToIso(ms);
  if (iso == null) return null;             // beyond ±8.64e15 ms → not a real Date
  return { iso, ms, seconds: Math.floor(ms / 1000), detectedUnit };
}

/** Parse a date STRING (ISO, "YYYY-MM-DD HH:mm:ss", or anything Date accepts) into unix time.
 *  Returns { seconds, ms }, or null when the string isn't a date. */
export function toUnix(dateStr) {
  const ms = parseToMs(dateStr);
  if (ms == null) return null;
  return { seconds: Math.floor(ms / 1000), ms };
}

// ── date arithmetic ─────────────────────────────────────────────────────────────────────────
/** date + `amount` × `unit` → the resulting instant as an ISO string (or null on bad input).
 *  Fixed units (ms…week) are exact millisecond offsets. Calendar units (month, year) step the
 *  UTC calendar and CLAMP an overflowing day — Jan 31 + 1 month is Feb 29/28, never a silent
 *  roll into March. `amount` may be negative to subtract. */
export function addToDate(dateStr, amount, unit) {
  const base = parseToMs(dateStr);
  if (base == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const u = normUnit(unit);
  if (!u) return null;

  if (u in MS) return msToIso(base + n * MS[u]);   // fixed-length units: just shift the instant

  // Calendar units — operate on UTC components so the machine timezone can't change the answer.
  const d = new Date(base);
  let y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (u === "year") y += n;
  else if (u === "month") { const t = m + n; y += Math.floor(t / 12); m = ((t % 12) + 12) % 12; }
  else return null;
  const dim = daysInMonth(y, m);
  if (day > dim) day = dim;                          // clamp: Jan 31 +1mo → Feb 29, not Mar 2
  return msToIso(Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** Difference b − a between two date strings. Returns totals in each unit (exact, may be
 *  fractional), a broken-down human string ("1d 2h 30m"), and `future` (is b after a?).
 *  null when either string isn't a date. `ms` is signed; the totals share its sign; `human`
 *  is the magnitude. */
export function diff(aStr, bStr) {
  const a = parseToMs(aStr), b = parseToMs(bStr);
  if (a == null || b == null) return null;
  const ms = b - a;
  return {
    ms,
    seconds: ms / MS.second,
    minutes: ms / MS.minute,
    hours: ms / MS.hour,
    days: ms / MS.day,
    human: humanDuration(Math.abs(ms)),
    future: ms > 0,
  };
}

// ── duration conversion ─────────────────────────────────────────────────────────────────────
/** Convert `value` from one duration unit to another (ms · s · min · hour · day · week).
 *  Returns NaN if either unit is unrecognised, so callers can show a clear error instead of a
 *  plausible-looking wrong number. */
export function convertDuration(value, fromUnit, toUnit) {
  const v = Number(value);
  const from = normUnit(fromUnit), to = normUnit(toUnit);
  if (!Number.isFinite(v) || !from || !to || !(from in MS) || !(to in MS)) return NaN;
  return (v * MS[from]) / MS[to];
}

// ── relative time ("3 days ago") — pure, because `nowMs` is passed IN ────────────────────────
/** A friendly relative phrase for `targetMs` seen from `nowMs`. Deterministic: give it a clock.
 *  "just now" inside a minute; otherwise the single largest sensible unit, "ago" / "in …". */
export function relative(targetMs, nowMs) {
  const t = Number(targetMs), now = Number(nowMs);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return "";
  const delta = t - now, abs = Math.abs(delta);
  if (abs < MS.minute) return "just now";
  const units = [
    ["year", 365 * MS.day], ["month", 30 * MS.day], ["week", MS.week],
    ["day", MS.day], ["hour", MS.hour], ["minute", MS.minute],
  ];
  for (const [name, size] of units) {
    if (abs >= size) {
      const k = Math.floor(abs / size);
      const label = `${k} ${name}${k === 1 ? "" : "s"}`;
      return delta < 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return "just now";
}

// ── shared helpers ──────────────────────────────────────────────────────────────────────────
/** Parse a caller-supplied date string to epoch ms, or null. Accepts the "YYYY-MM-DD HH:mm:ss"
 *  form (a space instead of the ISO "T") that people type, plus anything Date natively parses. */
export function parseToMs(dateStr) {
  if (dateStr == null) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  // Only rewrite the space between a date and time — never touch a leading "-" year or offsets.
  const norm = /^\d{4}-\d{2}-\d{2}\s\d/.test(s) ? s.replace(" ", "T") : s;
  const ms = Date.parse(norm);
  return Number.isNaN(ms) ? null : ms;
}

/** ms → ISO string, or null when it's outside the representable Date range (±8.64e15 ms). */
function msToIso(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Days in a given UTC year/month (month 0-11). Day 0 of the next month = last day of this one. */
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

/** A magnitude-only breakdown: the nonzero segments of "Xd Yh Zm Ws", largest-first. "0s" when
 *  the span is under a second, so the string is never empty. */
export function humanDuration(absMs) {
  const n = Math.max(0, Math.floor(Number(absMs) || 0));
  const days = Math.floor(n / MS.day);
  const hours = Math.floor((n % MS.day) / MS.hour);
  const mins = Math.floor((n % MS.hour) / MS.minute);
  const secs = Math.floor((n % MS.minute) / MS.second);
  const parts = [];
  if (days) parts.push(days + "d");
  if (hours) parts.push(hours + "h");
  if (mins) parts.push(mins + "m");
  if (secs && !days) parts.push(secs + "s");   // seconds matter for short spans, noise for long ones
  return parts.length ? parts.join(" ") : "0s";
}
