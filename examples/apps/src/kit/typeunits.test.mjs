// Headless assertions for the type-unit maths. node examples/apps/src/kit/typeunits.test.mjs
import { pxrem, pxToBoth, typo, typoAll, lineHeight, suggestLineHeight, TYPO_UNITS } from "./typeunits.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const near = (a, b, eps, what) => expect(Math.abs(a - b) <= eps, `${what} (got ${a}, want ~${b})`);

console.log("\n── px ↔ rem ↔ em ────────────────────────────────────────");
expect(pxrem(16, "px", "rem", 16) === 1, "16px = 1rem at base 16");
expect(pxrem(24, "px", "rem", 16) === 1.5, "24px = 1.5rem");
expect(pxrem(1.5, "rem", "px", 16) === 24, "1.5rem = 24px");
expect(pxrem(2, "rem", "px", 10) === 20, "2rem = 20px at base 10");
expect(pxrem(1, "em", "px", 16) === 16, "1em = 16px at base 16");
{ const b = pxToBoth(20, 16); expect(b.rem === 1.25 && b.em === 1.25, "20px → 1.25rem/em"); }
expect(pxrem("nope", "px", "rem") === null, "bad value → null");

console.log("\n── typographic units ───────────────────────────────────");
near(typo(1, "in", "px"), 96, 1e-6, "1in = 96px (CSS reference)");
near(typo(72, "pt", "in"), 1, 1e-6, "72pt = 1in");
near(typo(1, "pc", "pt"), 12, 1e-6, "1pc = 12pt");
near(typo(1, "pt", "px"), 1.3333, 1e-3, "1pt ≈ 1.333px");
near(typo(25.4, "mm", "cm"), 2.54, 1e-6, "25.4mm = 2.54cm");
near(typo(1, "cicero", "didot"), 12, 1e-2, "1 cicero ≈ 12 Didot points");
expect(typo(1, "pt", "furlong") === null, "unknown unit → null");
{ const all = typoAll(12, "pt"); near(all.px, 16, 0.01, "12pt → 16px in typoAll"); expect(TYPO_UNITS.includes("cicero"), "TYPO_UNITS lists cicero"); }

console.log("\n── line height ──────────────────────────────────────────");
{ const lh = lineHeight(16, 1.5); expect(lh.px === 24 && lh.verdict.includes("comfortable"), "16px × 1.5 = 24px, comfortable"); }
expect(lineHeight(16, 1.0).verdict.includes("tight"), "ratio 1.0 → tight");
expect(lineHeight(16, 2.5).verdict.includes("very loose"), "ratio 2.5 → very loose");
expect(suggestLineHeight(20).px === 30, "suggest for 20px → 30px (×1.5)");
expect(lineHeight("x", 1.5) === null, "bad font size → null");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
