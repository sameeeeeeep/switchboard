// WCAG CONTRAST — the pure maths behind "is this text readable on this background?".
//
// Harvested-idea sibling of kit/qr-payload.js: a deterministic, in-tab, no-model function that any
// wrapp/God-tool/widget can call. Contrast is exactly the shape that fits a launcher command + notch
// glance — two colours in, a ratio and pass/fail verdicts out — so this lives factored out and tested
// against the WCAG reference values, not eyeballed.
//
// Refs: WCAG 2.1 SC 1.4.3 (AA), 1.4.6 (AAA), 1.4.11 (non-text / UI components).
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/contrast.test.mjs).

// ── colour parsing → {r,g,b} in 0..255, or null if unparseable ──────────────────────────────
const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** Accept the forms a designer actually types: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(),
 *  and the CSS named colours people reach for. Alpha is parsed but NOT applied — contrast over a
 *  translucent colour depends on what's behind it, which we don't know, so we compare the solid
 *  colour and say so in the UI rather than compute a misleading ratio. */
export function parseColor(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) s = NAMED[s];
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    if (!/^[0-9a-f]+$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return { r: clamp255(+m[1]), g: clamp255(+m[2]), b: clamp255(+m[3]) };
  return null;
}

/** Normalise back to #rrggbb — the one canonical form the UI shows and the swatch uses. */
export function toHex(c) {
  if (!c) return null;
  const h = (n) => clamp255(n).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

// ── luminance + ratio (the WCAG formulas, verbatim) ─────────────────────────────────────────
function channel(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** Relative luminance, 0 (black) … 1 (white). */
export function luminance(c) {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
/** Contrast ratio between two colours, 1 … 21. Order-independent. */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── the WCAG thresholds, and the verdict a designer wants ───────────────────────────────────
export const THRESHOLDS = {
  aaLarge: 3,      // AA, large text (≥18.66px bold, or ≥24px)
  aa: 4.5,         // AA, normal text
  aaaLarge: 4.5,   // AAA, large text
  aaa: 7,          // AAA, normal text
  ui: 3,           // non-text: UI components + graphical objects (1.4.11)
};

/** Round a ratio the way tools display it — 2 dp, but never round 4.499 UP to a passing 4.50. */
export function roundRatio(r) { return Math.floor(r * 100) / 100; }

/** The full verdict for a foreground/background pair. Everything the UI, the God tool and the widget
 *  render is derived from this one object. */
export function evaluate(fg, bg) {
  const a = parseColor(fg), b = parseColor(bg);
  if (!a || !b) {
    return { ok: false, error: !a ? `couldn't read the text colour "${fg}"` : `couldn't read the background "${bg}"` };
  }
  const ratio = contrastRatio(a, b);
  const r = roundRatio(ratio);
  const pass = {
    aa: r >= THRESHOLDS.aa,
    aaLarge: r >= THRESHOLDS.aaLarge,
    aaa: r >= THRESHOLDS.aaa,
    aaaLarge: r >= THRESHOLDS.aaaLarge,
    ui: r >= THRESHOLDS.ui,
  };
  return {
    ok: true,
    fg: toHex(a), bg: toHex(b), ratio: r, ratioText: `${r.toFixed(2)}:1`,
    pass,
    // A one-word headline, the way the reference tools grade it.
    grade: r >= THRESHOLDS.aaa ? "Excellent" : r >= THRESHOLDS.aa ? "Good" : r >= THRESHOLDS.aaLarge ? "Poor" : "Fail",
    // The plain-English bottom line — what you can actually use this pair for.
    summary: verdictLine(pass),
  };
}

function verdictLine(p) {
  if (p.aaa) return "Passes AA and AAA — safe for body text at any size.";
  if (p.aa) return "Passes AA for all text; AAA only for large text.";
  if (p.aaLarge) return "Only passes AA for large text (≥24px, or ≥18.7px bold).";
  return "Fails WCAG AA — too low for text; not accessible.";
}

/** Suggest a fix when a pair fails: darken (or lighten) the FOREGROUND toward black/white in small
 *  steps until it clears `target`, keeping the hue. Returns the first passing hex, or null if even
 *  pure black/white against this background can't reach the target (a near-mid-grey bg). This is the
 *  "how do I make it pass" the checker should answer instead of just saying no. */
export function suggestForeground(fg, bg, target = THRESHOLDS.aa) {
  const a = parseColor(fg), b = parseColor(bg);
  if (!a || !b) return null;
  if (contrastRatio(a, b) >= target) return toHex(a);
  // Pick the direction that CAN win: push toward whichever pole (black/white) the background is far from.
  const toward = luminance(b) > 0.5 ? 0 : 255;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = {
      r: a.r + (toward - a.r) * t,
      g: a.g + (toward - a.g) * t,
      b: a.b + (toward - a.b) * t,
    };
    const rounded = { r: clamp255(c.r), g: clamp255(c.g), b: clamp255(c.b) };
    if (contrastRatio(rounded, b) >= target) return toHex(rounded);
  }
  return null;   // even the pole doesn't clear it (mid-grey background)
}

// The CSS named colours people actually type into a contrast checker. Not the full 148 — the common
// ones — so "white"/"black"/"tomato" resolve without pulling a whole colour-name table.
const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", navy: "#000080", teal: "#008080", olive: "#808000",
  lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff",
  pink: "#ffc0cb", tomato: "#ff6347", coral: "#ff7f50", gold: "#ffd700", indigo: "#4b0082",
  slate: "#708090", crimson: "#dc143c", transparent: "#ffffff",
};
