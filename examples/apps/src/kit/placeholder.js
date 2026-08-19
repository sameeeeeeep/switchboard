// PLACEHOLDER PLANNING — the pure maths behind "what size, colour and label is this filler image?".
//
// Harvested-idea sibling of kit/contrast.js and kit/qr-payload.js: a deterministic, in-tab, no-model
// function that any wrapp/God-tool/widget can call. Turning the loose sizes a designer types — "800x600",
// "hd", "16:9@400", a bare "640" — into a clean { w, h, bg, fg, label } is exactly the shape that fits a
// launcher command + a <canvas> draw, so it lives factored out and tested against known cases, not
// eyeballed in the DOM. The drawing (canvas fill + centred text) stays in the wrapp; this is the plan only.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/placeholder.test.mjs).

// ── bounds + named presets a person actually types ─────────────────────────────────────────
const MIN = 1, MAX = 5000;
const clampDim = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)));

/** The size shorthands worth memorising — a name resolves to a canonical WxH. */
export const PRESETS = {
  hd:     { w: 1280, h: 720 },
  fhd:    { w: 1920, h: 1080 },
  square: { w: 512,  h: 512 },
  og:     { w: 1200, h: 630 },   // Open Graph / social share card
  avatar: { w: 256,  h: 256 },
};

// ── size parsing → { w, h } in device pixels, or null if unparseable ────────────────────────
/** Accept the forms a designer actually types:
 *   "800x600" / "800×600" / "1920 x 1080"  → literal width×height
 *   "640"                                   → a square
 *   "16:9@400" / "16:9 x 400"               → an aspect ratio at a base WIDTH (h derived from ratio)
 *   "hd" / "fhd" / "square" / "og" / "avatar" → a named preset
 * Numbers are rounded; the caller clamps to sane bounds. */
export function parseSize(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  if (PRESETS[s]) return { ...PRESETS[s] };

  // aspect ratio at a base width — the colon is what tells it apart from a plain "800x600".
  let m = s.match(/^(\d+)\s*:\s*(\d+)\s*(?:@|x|×)\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const rW = +m[1], rH = +m[2], base = +m[3];
    if (rW <= 0 || rH <= 0 || base <= 0) return null;
    return { w: Math.round(base), h: Math.round((base * rH) / rW) };
  }

  // literal width × height
  m = s.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  if (m) return { w: Math.round(+m[1]), h: Math.round(+m[2]) };

  // a single number → a square
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) { const n = Math.round(+m[1]); return { w: n, h: n }; }

  return null;
}

// ── colour parsing → {r,g,b} in 0..255, or null (a trimmed cousin of contrast.js's parser) ───
// The CSS named colours people reach for when they want a coloured filler. Same short list as
// contrast.js — the common ones, not the full 148. Declared before parseColor so module-init callers
// (DEFAULT_BG below) don't hit the const's temporal dead zone.
const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", navy: "#000080", teal: "#008080", olive: "#808000",
  lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff",
  pink: "#ffc0cb", tomato: "#ff6347", coral: "#ff7f50", gold: "#ffd700", indigo: "#4b0082",
  slate: "#708090", crimson: "#dc143c", transparent: "#ffffff",
};
const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
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
export function toHex(c) {
  if (!c) return null;
  const h = (n) => clamp255(n).toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}

// A tiny inline luminance (WCAG relative luminance) — copied rather than imported so this kit stays
// standalone. Only used to auto-pick black vs white text; not the full contrast machinery.
function channel(v) { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
export function luminance(c) { return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b); }

// ── format normalisation ────────────────────────────────────────────────────────────────────
function normFormat(f) {
  const s = String(f || "").trim().toLowerCase();
  if (s === "jpg" || s === "jpeg") return "jpeg";
  if (s === "webp") return "webp";
  return "png";
}

const DEFAULT_BG = parseColor("#cccccc");   // classic neutral-grey filler

/** The one plan: a loose spec (+ optional bg / label / format) → the exact image to draw. Everything
 *  downstream — the <canvas> draw, the God tool, the widget — renders from this one object.
 *  Accepts a bare size string OR an object { spec|size, bg, label|text, format }. */
export function planPlaceholder(input) {
  let specStr, bgIn, labelIn, formatIn;
  if (typeof input === "string") {
    specStr = input;
  } else if (input && typeof input === "object") {
    specStr = input.spec ?? input.size ?? "";
    bgIn = input.bg; labelIn = input.label ?? input.text; formatIn = input.format;
  } else {
    specStr = "";
  }

  const dims = parseSize(specStr);
  if (!dims) {
    return { ok: false, error: `couldn't read a size from "${String(specStr).trim()}" — try "800x600", "640", "16:9@400", or a preset like "hd".` };
  }

  const w = clampDim(dims.w), h = clampDim(dims.h);
  const bgColor = parseColor(bgIn) || DEFAULT_BG;
  const bg = toHex(bgColor);
  // Auto-pick the legible text colour: black on a light background, white on a dark one.
  const fg = luminance(bgColor) > 0.5 ? "#000000" : "#ffffff";
  const label = (labelIn != null && String(labelIn).trim()) ? String(labelIn) : `${w}×${h}`;
  const format = normFormat(formatIn);

  return { ok: true, w, h, bg, fg, label, format };
}
