// UNIT CONVERSION — the pure maths behind "how much is 5 miles in km?".
//
// Harvested-idea sibling of kit/contrast.js: a deterministic, in-tab, no-model function that any
// wrapp / God-tool / widget can call. A unit conversion is exactly the shape that fits a launcher
// command + notch glance — a value and two units in, one number out — so the tables + the convert()
// live factored out and TESTED against reference values (1 mile = 1609.344 m, 100°C = 212°F), not
// eyeballed.
//
// Design: every category converts THROUGH a single base unit. Linear units carry a `factor` (their
// size in base units); temperature carries `toBase`/`fromBase` functions because °C↔°F↔K is an
// OFFSET conversion, not a scale — 0°C is 32°F, not 0°F, so a bare factor would be wrong. `convert`
// treats both the same: value → base → target.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/unit.test.mjs).

// ── the data: categories, each a base unit + a list of units ─────────────────────────────────
// A linear unit's `factor` is HOW MANY BASE UNITS it is (1 km = 1000 m → factor 1000). `aliases`
// are what a person types to mean this unit (for the "5 miles to km" parser) — symbols, plurals and
// common spellings, NOT the tool's job to be exhaustive, just to catch what people actually write.
export const CATEGORIES = [
  {
    id: "length", label: "Length", base: "m",
    units: [
      { id: "mm", label: "Millimetre", factor: 0.001, aliases: ["mm", "millimetre", "millimeter", "millimetres", "millimeters"] },
      { id: "cm", label: "Centimetre", factor: 0.01, aliases: ["cm", "centimetre", "centimeter", "centimetres", "centimeters"] },
      { id: "m", label: "Metre", factor: 1, aliases: ["m", "metre", "meter", "metres", "meters"] },
      { id: "km", label: "Kilometre", factor: 1000, aliases: ["km", "kilometre", "kilometer", "kilometres", "kilometers", "kms"] },
      { id: "in", label: "Inch", factor: 0.0254, aliases: ["in", "inch", "inches", "\"", "″"] },
      { id: "ft", label: "Foot", factor: 0.3048, aliases: ["ft", "foot", "feet", "'", "′"] },
      { id: "yd", label: "Yard", factor: 0.9144, aliases: ["yd", "yard", "yards", "yds"] },
      { id: "mile", label: "Mile", factor: 1609.344, aliases: ["mi", "mile", "miles"] },
      { id: "nmi", label: "Nautical mile", factor: 1852, aliases: ["nmi", "nautical mile", "nautical miles", "naut mi"] },
    ],
  },
  {
    id: "mass", label: "Mass", base: "kg",
    units: [
      { id: "mg", label: "Milligram", factor: 1e-6, aliases: ["mg", "milligram", "milligrams", "milligramme", "milligrammes"] },
      { id: "g", label: "Gram", factor: 1e-3, aliases: ["g", "gram", "grams", "gramme", "grammes"] },
      { id: "kg", label: "Kilogram", factor: 1, aliases: ["kg", "kilogram", "kilograms", "kilo", "kilos", "kgs"] },
      { id: "tonne", label: "Tonne", factor: 1000, aliases: ["t", "tonne", "tonnes", "metric ton", "metric tonne"] },
      { id: "oz", label: "Ounce", factor: 0.028349523125, aliases: ["oz", "ounce", "ounces"] },
      { id: "lb", label: "Pound", factor: 0.45359237, aliases: ["lb", "lbs", "pound", "pounds"] },
      { id: "stone", label: "Stone", factor: 6.35029318, aliases: ["st", "stone", "stones"] },
    ],
  },
  {
    // Data: the 1000-vs-1024 minefield made EXPLICIT. KB/MB/GB/TB are decimal (SI, powers of 1000);
    // KiB/MiB/GiB/TiB are binary (IEC, powers of 1024). We keep them as separate units instead of a
    // toggle so a conversion can never silently pick the wrong one. Base = byte; a bit is 1/8 byte.
    id: "data", label: "Data", base: "byte",
    units: [
      { id: "bit", label: "Bit", factor: 0.125, aliases: ["bit", "bits", "b"] },
      { id: "byte", label: "Byte", factor: 1, aliases: ["byte", "bytes", "B"] },
      { id: "KB", label: "Kilobyte (1000)", factor: 1e3, aliases: ["kb", "kilobyte", "kilobytes"] },
      { id: "MB", label: "Megabyte (1000²)", factor: 1e6, aliases: ["mb", "megabyte", "megabytes"] },
      { id: "GB", label: "Gigabyte (1000³)", factor: 1e9, aliases: ["gb", "gigabyte", "gigabytes"] },
      { id: "TB", label: "Terabyte (1000⁴)", factor: 1e12, aliases: ["tb", "terabyte", "terabytes"] },
      { id: "KiB", label: "Kibibyte (1024)", factor: 1024, aliases: ["kib", "kibibyte", "kibibytes"] },
      { id: "MiB", label: "Mebibyte (1024²)", factor: 1048576, aliases: ["mib", "mebibyte", "mebibytes"] },
      { id: "GiB", label: "Gibibyte (1024³)", factor: 1073741824, aliases: ["gib", "gibibyte", "gibibytes"] },
      { id: "TiB", label: "Tebibyte (1024⁴)", factor: 1099511627776, aliases: ["tib", "tebibyte", "tebibytes"] },
    ],
  },
  {
    // Temperature is the odd one out: OFFSET conversions, not factors. Base = Celsius. Each unit maps
    // to/from Celsius with its own formula — this is why `convert` supports toBase/fromBase, not just
    // a factor. Tested at the fixed points everyone knows: freezing 0°C=32°F=273.15K, boiling 100°C.
    id: "temperature", label: "Temperature", base: "°C",
    units: [
      { id: "C", label: "Celsius", aliases: ["c", "°c", "celsius", "centigrade"], toBase: (v) => v, fromBase: (v) => v },
      { id: "F", label: "Fahrenheit", aliases: ["f", "°f", "fahrenheit"], toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
      { id: "K", label: "Kelvin", aliases: ["k", "kelvin", "kelvins"], toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    ],
  },
  {
    id: "time", label: "Time", base: "s",
    units: [
      { id: "ms", label: "Millisecond", factor: 0.001, aliases: ["ms", "millisecond", "milliseconds", "msec"] },
      { id: "s", label: "Second", factor: 1, aliases: ["s", "sec", "secs", "second", "seconds"] },
      { id: "min", label: "Minute", factor: 60, aliases: ["min", "mins", "minute", "minutes"] },
      { id: "hour", label: "Hour", factor: 3600, aliases: ["h", "hr", "hrs", "hour", "hours"] },
      { id: "day", label: "Day", factor: 86400, aliases: ["d", "day", "days"] },
      { id: "week", label: "Week", factor: 604800, aliases: ["w", "wk", "week", "weeks"] },
    ],
  },
  {
    id: "speed", label: "Speed", base: "m/s",
    units: [
      { id: "mps", label: "Metres/sec", factor: 1, aliases: ["m/s", "mps", "metres per second", "meters per second"] },
      { id: "kmh", label: "km/hour", factor: 1000 / 3600, aliases: ["km/h", "kmh", "kph", "kmph", "km/hr"] },
      { id: "mph", label: "Miles/hour", factor: 0.44704, aliases: ["mph", "mi/h", "miles per hour"] },
      { id: "knot", label: "Knot", factor: 1852 / 3600, aliases: ["kn", "kt", "kts", "knot", "knots"] },
    ],
  },
  {
    // Volume: US customary (the spec says gallon (US)); the whole family is derived from the US gallon
    // = 3.785411784 L exactly, so tsp/tbsp/cup/pint all stay internally consistent. Base = litre.
    id: "volume", label: "Volume", base: "l",
    units: [
      { id: "ml", label: "Millilitre", factor: 0.001, aliases: ["ml", "millilitre", "milliliter", "millilitres", "milliliters", "cc"] },
      { id: "l", label: "Litre", factor: 1, aliases: ["l", "litre", "liter", "litres", "liters"] },
      { id: "tsp", label: "Teaspoon (US)", factor: 0.00492892159375, aliases: ["tsp", "teaspoon", "teaspoons"] },
      { id: "tbsp", label: "Tablespoon (US)", factor: 0.01478676478125, aliases: ["tbsp", "tbs", "tablespoon", "tablespoons"] },
      { id: "cup", label: "Cup (US)", factor: 0.2365882365, aliases: ["cup", "cups"] },
      { id: "pint", label: "Pint (US)", factor: 0.473176473, aliases: ["pt", "pint", "pints"] },
      { id: "gallon", label: "Gallon (US)", factor: 3.785411784, aliases: ["gal", "gallon", "gallons"] },
    ],
  },
];

// ── lookups ──────────────────────────────────────────────────────────────────────────────────
const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** The category object for an id (or its label, case-insensitive). null if unknown. */
export function getCategory(catId) {
  if (!catId) return null;
  if (CAT_BY_ID.has(catId)) return CAT_BY_ID.get(catId);
  const s = String(catId).trim().toLowerCase();
  return CATEGORIES.find((c) => c.id === s || c.label.toLowerCase() === s) || null;
}

/** A unit object within a category, by its id. null if unknown. */
export function getUnit(cat, unitId) {
  const c = typeof cat === "string" ? getCategory(cat) : cat;
  if (!c || !unitId) return null;
  return c.units.find((u) => u.id === unitId) || null;
}

// A unit's value expressed IN the base unit, and back — the one place linear factors and temperature
// offset-functions are unified. Everything above (convert, the UI, God) goes through these two.
const toBase = (u, v) => (typeof u.toBase === "function" ? u.toBase(v) : v * u.factor);
const fromBase = (u, v) => (typeof u.fromBase === "function" ? u.fromBase(v) : v / u.factor);

/** Convert `value` from one unit to another WITHIN a category. Returns a number, or null if the
 *  category / units are unknown or the value isn't a finite number. Same-unit is the identity. */
export function convert(category, fromUnit, toUnit, value) {
  const c = getCategory(category);
  if (!c) return null;
  const from = getUnit(c, fromUnit), to = getUnit(c, toUnit);
  if (!from || !to) return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return fromBase(to, toBase(from, n));
}

// ── formatting: trim the float noise a chain of ÷ and × leaves behind ─────────────────────────
/** Turn a raw result into the string a converter shows. 1609.344000000001 → "1609.344";
 *  1073741824 → "1073741824"; tiny/huge magnitudes fall back to exponential so we neither print
 *  "0" for 0.0000001 nor a 300-digit integer. Rounds to 10 significant figures to kill the noise,
 *  which is well inside the precision anyone converting units actually needs. */
export function format(n) {
  if (n == null || !Number.isFinite(n)) return "";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 1e-4 || abs >= 1e15) {
    // toExponential noise-trim: 1.2340000e-7 → 1.234e-7
    return n.toExponential(6).replace(/\.?0+e/, "e").replace("e+", "e");
  }
  // toPrecision collapses 1609.3440000000001 back to 1609.344; parseFloat drops trailing zeros.
  return String(parseFloat(n.toPrecision(10)));
}

// ── the "5 miles to km" parser — for the God tool + launcher, one string in ───────────────────
// Build the alias index ONCE: every alias (and every unit id/label) → {catId, unitId}. Longer
// aliases are indexed too so multi-word units ("nautical mile") resolve. Lowercased for matching.
const ALIAS = new Map();
for (const c of CATEGORIES) {
  for (const u of c.units) {
    const keys = new Set([u.id.toLowerCase(), u.label.toLowerCase(), ...(u.aliases || []).map((a) => a.toLowerCase())]);
    for (const k of keys) if (!ALIAS.has(k)) ALIAS.set(k, { catId: c.id, unitId: u.id });
  }
}

/** Resolve a free-typed unit token ("miles", "km/h", "°F") to {catId, unitId}, or null. Strips the
 *  surrounding punctuation people leave on ("5km," → "km") but keeps the slashes speed units need. */
export function resolveUnit(token) {
  if (token == null) return null;
  const s = String(token).trim().toLowerCase().replace(/[.,;:]+$/, "").replace(/^[.,;:]+/, "");
  if (!s) return null;
  return ALIAS.get(s) || null;
}

/** Parse "5 miles to km", "100 c in f", "1gib to mb", "5mi->km" into {category, from, to, value}.
 *  Returns { ok:false, error } when it can't — a missing number, an unknown unit, or two units from
 *  different categories (you can't convert miles to kilograms, and saying so beats a wrong number). */
export function parseQuery(text) {
  if (!text) return { ok: false, error: "Nothing to convert — try “5 miles to km”." };
  const s = String(text).trim();
  // First number (supports decimals, leading sign, exponent). Everything after it is "<from> to <to>".
  const nm = s.match(/-?\d*\.?\d+(?:e-?\d+)?/i);
  if (!nm) return { ok: false, error: `No number found in “${s}”.` };
  const value = parseFloat(nm[0]);
  const rest = (s.slice(0, nm.index) + " " + s.slice(nm.index + nm[0].length)).trim();
  // Split the two unit tokens on the connectives people use — " to ", " in ", "->", "→", ">", "=".
  const parts = rest.split(/\s+to\s+|\s+in\s+|\s+as\s+|->|→|=>|>|=/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, error: `Say it as “<value> <from> to <to>”, e.g. “${value} m to ft”.` };
  const from = resolveUnit(parts[0]), to = resolveUnit(parts[parts.length - 1]);
  if (!from) return { ok: false, error: `Don't recognise the unit “${parts[0]}”.` };
  if (!to) return { ok: false, error: `Don't recognise the unit “${parts[parts.length - 1]}”.` };
  if (from.catId !== to.catId) {
    return { ok: false, error: `“${parts[0]}” (${from.catId}) and “${parts[parts.length - 1]}” (${to.catId}) aren't the same kind of thing.` };
  }
  return { ok: true, category: from.catId, from: from.unitId, to: to.unitId, value };
}

// A few unit ids read better as their conventional symbol in the "5 mi = 8.05 km" line; the rest
// (mm, kg, KB, GiB, …) already ARE the symbol, so this stays a short override, not a table.
const SYM = { mile: "mi", tonne: "t", mps: "m/s", kmh: "km/h", knot: "kn", gallon: "gal", pint: "pt", C: "°C", F: "°F" };

/** The short symbol a result reads out with. Used by the widget's "5 mi = 8.05 km". */
export function unitSymbol(catId, unitId) {
  const u = getUnit(catId, unitId);
  if (!u) return String(unitId || "");
  return SYM[u.id] || u.id;
}
