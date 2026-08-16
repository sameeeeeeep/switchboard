// Headless assertions for the unit-conversion maths. No browser, no bundler:
//   node examples/apps/src/kit/unit.test.mjs
// Every conversion is checked against a KNOWN reference value (NIST / definitional exact values),
// because a converter that's "about right" quietly ships wrong grocery, storage and travel numbers.
import { CATEGORIES, convert, format, parseQuery, getCategory, getUnit, resolveUnit, unitSymbol } from "./unit.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const near = (got, want, eps, what) => expect(got != null && Math.abs(got - want) <= eps, `${what} (got ${got}, want ~${want})`);

console.log("\n── shape: every category has a base unit that maps to itself 1:1 ─────");
for (const c of CATEGORIES) {
  const base = c.units.find((u) => (u.factor === 1) || (u.id === "C"));
  expect(!!base, `${c.id} has an identity base unit`);
  // round-trip: A→B→A returns the original for a couple of arbitrary units
  const [a, b] = [c.units[0], c.units[c.units.length - 1]];
  const there = convert(c.id, a.id, b.id, 3);
  const back = convert(c.id, b.id, a.id, there);
  near(back, 3, 1e-9, `${c.id}: ${a.id}→${b.id}→${a.id} round-trips`);
}

console.log("\n── length (1 mile = 1609.344 m, exact) ──────────────────────────────");
near(convert("length", "mile", "m", 1), 1609.344, 1e-9, "1 mile = 1609.344 m");
near(convert("length", "m", "mile", 1609.344), 1, 1e-9, "1609.344 m = 1 mile (inverse)");
near(convert("length", "in", "cm", 1), 2.54, 1e-9, "1 in = 2.54 cm");
near(convert("length", "km", "mm", 1), 1_000_000, 1e-6, "1 km = 1,000,000 mm");
near(convert("length", "nmi", "m", 1), 1852, 1e-9, "1 nautical mile = 1852 m");
near(convert("length", "ft", "in", 1), 12, 1e-9, "1 ft = 12 in");

console.log("\n── mass (1 kg = 2.2046226 lb) ───────────────────────────────────────");
near(convert("mass", "kg", "lb", 1), 2.2046226, 1e-6, "1 kg ≈ 2.2046226 lb");
near(convert("mass", "lb", "oz", 1), 16, 1e-9, "1 lb = 16 oz");
near(convert("mass", "stone", "lb", 1), 14, 1e-6, "1 stone = 14 lb");
near(convert("mass", "tonne", "kg", 1), 1000, 1e-9, "1 tonne = 1000 kg");
near(convert("mass", "g", "mg", 1), 1000, 1e-9, "1 g = 1000 mg");

console.log("\n── data: 1000 vs 1024 kept honest ───────────────────────────────────");
near(convert("data", "GiB", "byte", 1), 1073741824, 1e-3, "1 GiB = 1073741824 bytes (binary)");
near(convert("data", "GB", "byte", 1), 1e9, 1e-3, "1 GB = 1,000,000,000 bytes (decimal)");
near(convert("data", "byte", "bit", 1), 8, 1e-12, "1 byte = 8 bits");
near(convert("data", "KiB", "byte", 1), 1024, 1e-12, "1 KiB = 1024 bytes");
near(convert("data", "MB", "KB", 1), 1000, 1e-9, "1 MB = 1000 KB (decimal)");
expect(convert("data", "GiB", "byte", 1) !== convert("data", "GB", "byte", 1), "GiB and GB are NOT the same size");

console.log("\n── temperature: OFFSET conversions at the fixed points ──────────────");
near(convert("temperature", "C", "F", 100), 212, 1e-9, "100°C = 212°F (boiling)");
near(convert("temperature", "C", "K", 100), 373.15, 1e-9, "100°C = 373.15 K (boiling)");
near(convert("temperature", "C", "F", 0), 32, 1e-9, "0°C = 32°F (freezing)");
near(convert("temperature", "C", "K", 0), 273.15, 1e-9, "0°C = 273.15 K (freezing)");
near(convert("temperature", "F", "C", 32), 0, 1e-9, "32°F = 0°C (inverse)");
near(convert("temperature", "F", "C", -40), -40, 1e-9, "-40°F = -40°C (where the scales cross)");
near(convert("temperature", "K", "C", 0), -273.15, 1e-9, "0 K = -273.15°C (absolute zero)");
// The offset trap: a bare factor would give 100°C→180°F. Prove we DON'T do that.
expect(convert("temperature", "C", "F", 100) !== 180, "not treating temperature as a bare factor");

console.log("\n── time + speed ─────────────────────────────────────────────────────");
near(convert("time", "hour", "s", 1), 3600, 1e-9, "1 hour = 3600 s");
near(convert("time", "week", "day", 1), 7, 1e-9, "1 week = 7 days");
near(convert("time", "s", "ms", 1), 1000, 1e-9, "1 s = 1000 ms");
near(convert("speed", "mph", "kmh", 60), 96.56064, 1e-4, "60 mph ≈ 96.56 km/h");
near(convert("speed", "kmh", "mps", 3.6), 1, 1e-9, "3.6 km/h = 1 m/s");
near(convert("speed", "knot", "mps", 1), 0.5144444444, 1e-6, "1 knot ≈ 0.5144 m/s");

console.log("\n── volume (US) ──────────────────────────────────────────────────────");
near(convert("volume", "gallon", "l", 1), 3.785411784, 1e-9, "1 US gallon = 3.785411784 L");
near(convert("volume", "l", "ml", 1), 1000, 1e-9, "1 L = 1000 ml");
near(convert("volume", "tbsp", "tsp", 1), 3, 1e-9, "1 tbsp = 3 tsp");
near(convert("volume", "cup", "tbsp", 1), 16, 1e-6, "1 cup = 16 tbsp (US)");

console.log("\n── format: trims float noise, survives extremes ─────────────────────");
expect(format(convert("length", "mile", "m", 1)) === "1609.344", "1 mile formats to '1609.344' not '1609.3440000001'");
expect(format(convert("data", "GiB", "byte", 1)) === "1073741824", "1 GiB formats to the exact integer");
expect(format(0) === "0", "0 → '0'");
expect(format(1) === "1", "1 → '1'");
expect(format(null) === "" && format(NaN) === "" && format(Infinity) === "", "non-finite → '' (never 'NaN')");
expect(/e/.test(format(0.00000001)), "very small → exponential, not '0'");

console.log("\n── convert: bad input is null, never a throw or a wrong number ───────");
expect(convert("nope", "m", "ft", 1) === null, "unknown category → null");
expect(convert("length", "m", "kg", 1) === null, "unknown target unit → null");
expect(convert("length", "m", "ft", "abc") === null, "non-numeric value → null");
expect(convert("length", "m", "ft", "") === null, "empty value → null");
expect(convert("length", "m", "m", 5) === 5, "same unit is the identity");
expect(getCategory("Length") === getCategory("length"), "category by label matches by id");
expect(getUnit("length", "ft").label === "Foot", "getUnit resolves by id");

console.log("\n── parseQuery: “5 miles to km” and friends ──────────────────────────");
const q1 = parseQuery("5 miles to km");
expect(q1.ok && q1.category === "length" && q1.from === "mile" && q1.to === "km" && q1.value === 5, "'5 miles to km' parses");
near(convert(q1.category, q1.from, q1.to, q1.value), 8.04672, 1e-5, "5 miles = 8.04672 km end-to-end");
const q2 = parseQuery("100 c in f");
expect(q2.ok && q2.category === "temperature" && q2.from === "C" && q2.to === "F", "'100 c in f' parses to temperature");
const q3 = parseQuery("1gib to mb");
expect(q3.ok && q3.from === "GiB" && q3.to === "MB", "'1gib to mb' parses (no spaces, mixed case)");
const q4 = parseQuery("60 mph -> km/h");
expect(q4.ok && q4.from === "mph" && q4.to === "kmh", "'60 mph -> km/h' parses arrow + slash unit");
expect(parseQuery("5 miles to kg").ok === false, "cross-category (miles→kg) → ok:false, not a wrong number");
expect(parseQuery("miles to km").ok === false, "no number → ok:false");
expect(parseQuery("5 florps to km").ok === false, "unknown unit → ok:false");
expect(parseQuery("").ok === false && parseQuery(null).ok === false, "empty/null → ok:false, no throw");
expect(resolveUnit("MILES").unitId === "mile" && resolveUnit(" km, ").unitId === "km", "resolveUnit is case/punctuation tolerant");
expect(unitSymbol("length", "mile") === "mi" && unitSymbol("temperature", "C") === "°C", "unitSymbol gives conventional symbols");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
