// Headless assertions for the colour conversions. No browser, no bundler:
//   node examples/apps/src/kit/color.test.mjs
// Known values for the simple spaces; round-trips (within tolerance) for OKLCH, whose float path
// can't be exact but must not drift.
import { parse, toHex, toRgb, toHsl, toHsv, toOklch, allNotations,
         rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, rgbToOklch, oklchToRgb } from "./color.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const near = (a, b, eps, what) => expect(Math.abs(a - b) <= eps, `${what} (got ${a}, want ~${b})`);

console.log("\n── parse ────────────────────────────────────────────────");
expect(toHex(parse("#f00")) === "#ff0000", "#f00 → #ff0000");
expect(toHex(parse("rgb(255,0,0)")) === "#ff0000", "rgb() → #ff0000");
expect(toHex(parse("hsl(120, 100%, 50%)")) === "#00ff00", "hsl(120,100,50) → green");
expect(toHex(parse("hsv(240, 100%, 100%)")) === "#0000ff", "hsv(240,100,100) → blue");
expect(toHex(parse("tomato")) === "#ff6347", "named 'tomato'");
expect(parse("#1234") != null && parse("#1234").a < 1, "#rgba parses alpha");
expect(parse("not a colour") === null, "garbage → null");
expect(parse("") === null, "empty → null");

console.log("\n── HSL round-trip + known ───────────────────────────────");
{ const h = rgbToHsl(255, 0, 0); near(h.h, 0, 0.5, "red hue 0"); near(h.s, 100, 0.5, "red sat 100"); near(h.l, 50, 0.5, "red light 50"); }
{ const c = hslToRgb(120, 100, 50); expect(Math.round(c.r) === 0 && Math.round(c.g) === 255 && Math.round(c.b) === 0, "hsl(120,100,50) → 0,255,0"); }
{ const c = parse("#3a7bd5"); const back = parse(toHsl(c)); expect(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1 && Math.abs(back.b - c.b) <= 1, "#3a7bd5 → hsl → back within 1"); }

console.log("\n── HSV round-trip ───────────────────────────────────────");
{ const v = rgbToHsv(255, 0, 0); near(v.s, 100, 0.5, "red hsv sat 100"); near(v.v, 100, 0.5, "red hsv val 100"); }
{ const c = parse("#808000"); const back = hsvToRgb(...Object.values(rgbToHsv(c.r, c.g, c.b))); expect(Math.abs(back.r - c.r) <= 1 && Math.abs(back.g - c.g) <= 1, "#808000 hsv round-trips"); }

console.log("\n── OKLCH (Ottosson) ─────────────────────────────────────");
{ const w = rgbToOklch(255, 255, 255); near(w.L, 1, 0.002, "white L≈1"); near(w.C, 0, 0.002, "white C≈0"); }
{ const k = rgbToOklch(0, 0, 0); near(k.L, 0, 0.002, "black L≈0"); }
// round-trip several colours through OKLCH and back to sRGB
for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#3a7bd5", "#c8f250", "#808080"]) {
  const c = parse(hex); const { L, C, H } = rgbToOklch(c.r, c.g, c.b); const back = oklchToRgb(L, C, H);
  const ok = Math.abs(back.r - c.r) <= 1.5 && Math.abs(back.g - c.g) <= 1.5 && Math.abs(back.b - c.b) <= 1.5;
  expect(ok, `${hex} → oklch → sRGB within 1.5`);
}
expect(parse(toOklch(parse("#c8f250"))) != null, "our own oklch() output re-parses");

console.log("\n── allNotations ─────────────────────────────────────────");
{ const n = allNotations(parse("#ff6347"));
  expect(n.hex === "#ff6347" && n.rgb.startsWith("rgb(") && n.hsl.startsWith("hsl(") && n.oklch.startsWith("oklch("),
         "every notation present and well-formed"); }

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
