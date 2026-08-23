// Headless assertions for the placeholder planning maths. No browser, no bundler:
//   node examples/apps/src/kit/placeholder.test.mjs
// Every case is checked against a KNOWN expected value — "looks about right" is how an off-by-a-parse
// bug ships a 12×34 image when the user typed 1234.
import { planPlaceholder, parseSize, parseColor, luminance, PRESETS } from "./placeholder.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

console.log("\n── literal sizes ────────────────────────────────────────");
let p = planPlaceholder("800x600");
expect(p.ok && p.w === 800 && p.h === 600, "'800x600' → 800×600");
p = planPlaceholder("800×600");
expect(p.ok && p.w === 800 && p.h === 600, "unicode × separator → 800×600");
p = planPlaceholder("1920 x 1080");
expect(p.ok && p.w === 1920 && p.h === 1080, "spaces around x → 1920×1080");
p = planPlaceholder("640");
expect(p.ok && p.w === 640 && p.h === 640, "single number → square 640×640");

console.log("\n── aspect-ratio specs (base = width) ────────────────────");
p = planPlaceholder("16:9@400");
expect(p.ok && p.w === 400 && p.h === 225, "'16:9@400' → 400×225 (400*9/16=225)");
p = planPlaceholder("16:9 x 400");
expect(p.ok && p.w === 400 && p.h === 225, "'16:9 x 400' same as @400");
p = planPlaceholder("4:3@800");
expect(p.ok && p.w === 800 && p.h === 600, "'4:3@800' → 800×600");
p = planPlaceholder("1:1@300");
expect(p.ok && p.w === 300 && p.h === 300, "'1:1@300' → 300×300");

console.log("\n── named presets ────────────────────────────────────────");
expect(planPlaceholder("hd").w === 1280 && planPlaceholder("hd").h === 720, "'hd' → 1280×720");
expect(planPlaceholder("fhd").w === 1920 && planPlaceholder("fhd").h === 1080, "'fhd' → 1920×1080");
expect(planPlaceholder("square").w === 512 && planPlaceholder("square").h === 512, "'square' → 512×512");
expect(planPlaceholder("og").w === 1200 && planPlaceholder("og").h === 630, "'og' → 1200×630");
expect(planPlaceholder("avatar").w === 256 && planPlaceholder("avatar").h === 256, "'avatar' → 256×256");
expect(planPlaceholder("HD").w === 1280, "preset is case-insensitive");
expect(Object.keys(PRESETS).length === 5, "exactly the 5 named presets are exported");

console.log("\n── bounds clamping (1..5000) ────────────────────────────");
p = planPlaceholder("9000x9000");
expect(p.ok && p.w === 5000 && p.h === 5000, "oversize clamps to 5000×5000");
p = planPlaceholder("0");
expect(p.ok && p.w === 1 && p.h === 1, "zero clamps up to 1×1");
p = planPlaceholder("6000x100");
expect(p.ok && p.w === 5000 && p.h === 100, "only the out-of-range side is clamped");

console.log("\n── auto-contrast foreground ─────────────────────────────");
expect(planPlaceholder({ spec: "100", bg: "#111111" }).fg === "#ffffff", "white text on a dark bg");
expect(planPlaceholder({ spec: "100", bg: "#eeeeee" }).fg === "#000000", "black text on a light bg");
expect(planPlaceholder({ spec: "100", bg: "black" }).fg === "#ffffff", "named 'black' bg → white text");
expect(planPlaceholder({ spec: "100", bg: "white" }).fg === "#000000", "named 'white' bg → black text");
expect(planPlaceholder("512").fg === "#000000" && planPlaceholder("512").bg === "#cccccc", "default bg is light grey → black text");

console.log("\n── labels + format + colour ─────────────────────────────");
expect(planPlaceholder("800x600").label === "800×600", "default label is the dimensions");
expect(planPlaceholder({ spec: "800x600", label: "Hero" }).label === "Hero", "explicit label wins");
expect(planPlaceholder({ spec: "512", text: "Alt" }).label === "Alt", "'text' alias sets the label");
expect(planPlaceholder("512").format === "png", "default format is png");
expect(planPlaceholder({ spec: "512", format: "jpg" }).format === "jpeg", "'jpg' normalises to 'jpeg'");
expect(planPlaceholder({ spec: "512", format: "WEBP" }).format === "webp", "'WEBP' → 'webp'");
expect(planPlaceholder({ spec: "512", bg: "tomato" }).bg === "#ff6347", "named bg colour resolves to hex");
expect(planPlaceholder({ spec: "512", bg: "not-a-colour" }).bg === "#cccccc", "unparseable bg falls back to default grey");

console.log("\n── bad input → error, never throws ──────────────────────");
expect(planPlaceholder("banana").ok === false, "garbage spec → ok:false");
expect(typeof planPlaceholder("banana").error === "string", "…with a helpful error string");
expect(planPlaceholder("").ok === false, "empty spec → ok:false");
expect(planPlaceholder(null).ok === false, "null → ok:false, no throw");
expect(planPlaceholder({}).ok === false, "empty object → ok:false");
expect(parseSize("nope") === null, "parseSize returns null for junk");

console.log("\n── the underlying helpers ───────────────────────────────");
expect(luminance(parseColor("#000")) < 0.01, "black luminance ≈ 0");
expect(luminance(parseColor("#fff")) > 0.99, "white luminance ≈ 1");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
