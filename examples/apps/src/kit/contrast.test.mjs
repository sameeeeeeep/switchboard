// Headless assertions for the WCAG contrast maths. No browser, no bundler:
//   node examples/apps/src/kit/contrast.test.mjs
// Every ratio is checked against a KNOWN reference value (WebAIM / the WCAG spec examples), because
// "looks about right" is exactly how an off-by-a-linearisation-step bug ships an inaccessible verdict.
import { parseColor, toHex, luminance, contrastRatio, evaluate, roundRatio, suggestForeground, THRESHOLDS } from "./contrast.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };
const near = (got, want, eps, what) => expect(Math.abs(got - want) <= eps, `${what} (got ${got}, want ~${want})`);

console.log("\n── parsing ──────────────────────────────────────────────");
expect(toHex(parseColor("#fff")) === "#ffffff", "#fff → #ffffff");
expect(toHex(parseColor("#FFF")) === "#ffffff", "uppercase #FFF");
expect(toHex(parseColor("#1a2b3c")) === "#1a2b3c", "#rrggbb round-trips");
expect(toHex(parseColor("#11223344")) === "#112233", "#rrggbbaa drops alpha to solid");
expect(toHex(parseColor("rgb(255, 0, 0)")) === "#ff0000", "rgb()");
expect(toHex(parseColor("rgba(0,128,0,0.5)")) === "#008000", "rgba() drops alpha");
expect(toHex(parseColor("white")) === "#ffffff", "named 'white'");
expect(toHex(parseColor("Tomato")) === "#ff6347", "named 'Tomato' case-insensitive");
expect(parseColor("not-a-colour") === null, "garbage → null");
expect(parseColor("#12345") === null, "5-digit hex → null");
expect(parseColor("") === null, "empty → null");

console.log("\n── luminance + ratio (reference values) ─────────────────");
near(luminance(parseColor("#000")), 0, 0.0001, "black luminance = 0");
near(luminance(parseColor("#fff")), 1, 0.0001, "white luminance = 1");
near(contrastRatio(parseColor("#000"), parseColor("#fff")), 21, 0.01, "black on white = 21:1 (the max)");
near(contrastRatio(parseColor("#fff"), parseColor("#fff")), 1, 0.01, "white on white = 1:1");
// WebAIM reference: #777 on #fff = 4.48:1 (the classic 'just fails AA' grey)
near(contrastRatio(parseColor("#777777"), parseColor("#ffffff")), 4.48, 0.02, "#777 on #fff ≈ 4.48:1");
// WebAIM reference: #767676 on #fff = 4.54:1 (the smallest grey that PASSES AA)
near(contrastRatio(parseColor("#767676"), parseColor("#ffffff")), 4.54, 0.02, "#767676 on #fff ≈ 4.54:1");
// order-independence
expect(contrastRatio(parseColor("#123"), parseColor("#eee")) === contrastRatio(parseColor("#eee"), parseColor("#123")),
       "ratio is order-independent");

console.log("\n── verdicts + the boundary ──────────────────────────────");
expect(roundRatio(4.499) === 4.49, "4.499 rounds DOWN to 4.49 (never fake a pass)");
const black = evaluate("#000", "#fff");
expect(black.grade === "Excellent" && black.pass.aa && black.pass.aaa, "black/white = Excellent, passes everything");
const grey777 = evaluate("#777", "#fff");
expect(!grey777.pass.aa && grey777.pass.aaLarge, "#777/#fff fails AA-normal, passes AA-large");
const light = evaluate("#aaaaaa", "#ffffff");
expect(!light.pass.aa && !light.pass.aaLarge, "#aaa/#fff fails everything for text");
expect(light.pass.ui === (light.ratio >= THRESHOLDS.ui), "UI-component verdict tracks the 3:1 threshold");
expect(evaluate("nope", "#fff").ok === false, "bad input → ok:false with an error, never throws");
expect(evaluate("#000", "#fff").ratioText === "21.00:1", "ratioText is formatted 2dp");

console.log("\n── suggest a passing foreground ─────────────────────────");
const s1 = suggestForeground("#999999", "#ffffff", THRESHOLDS.aa);
expect(s1 !== null && contrastRatio(parseColor(s1), parseColor("#fff")) >= THRESHOLDS.aa,
       `#999 on #fff → darker ${s1} that passes AA`);
const s2 = suggestForeground("#000", "#fff", THRESHOLDS.aa);
expect(s2 === "#000000", "an already-passing pair suggests itself unchanged");
// A mid-grey background: even pure black or white can't hit 7:1 → honest null, not a lie.
expect(suggestForeground("#808080", "#808080", THRESHOLDS.aaa) === null,
       "impossible target (mid-grey bg, AAA) → null, not a false suggestion");
const s3 = suggestForeground("#eeeeee", "#000000", THRESHOLDS.aa);
expect(s3 !== null && contrastRatio(parseColor(s3), parseColor("#000")) >= THRESHOLDS.aa,
       `light text on black stays light (${s3}) — pushes toward white, not black`);

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
