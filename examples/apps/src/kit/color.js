// COLOR — the pure conversions behind "give me this colour in every notation".
//
// Harvested-idea sibling of kit/contrast.js: deterministic, in-tab, no-model colour maths. HEX · RGB ·
// HSL · HSV · OKLCH, parsed in and formatted out, with round-trips the test pins. OKLab/OKLCH use
// Björn Ottosson's published matrices (the modern perceptual space CSS Color 4 adopted) — not eyeballed.
//
// Everything routes through one interchange type: `{ r, g, b }` in 0..255 (+ optional `a` 0..1). Pure:
// no DOM, no imports, no side effects. Headless-testable (kit/color.test.mjs).

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const mod = (n, m) => ((n % m) + m) % m;

// ── parse: accept HEX / rgb() / hsl() / hsv() / oklch() / a name → {r,g,b,a} ─────────────────
export function parse(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) s = NAMED[s];

  if (s[0] === "#") return fromHex(s);
  let m;
  if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
    const p = splitParts(m[1]);
    if (p.length < 3) return null;
    return { r: clamp(+p[0], 0, 255), g: clamp(+p[1], 0, 255), b: clamp(+p[2], 0, 255), a: p[3] != null ? clamp(+p[3], 0, 1) : 1 };
  }
  if ((m = s.match(/^hsla?\(([^)]+)\)$/))) {
    const p = splitParts(m[1]);
    if (p.length < 3) return null;
    return hslToRgb(+p[0], pct(p[1]), pct(p[2]), p[3] != null ? +p[3] : 1);
  }
  if ((m = s.match(/^hsva?\(([^)]+)\)$/)) || (m = s.match(/^hsba?\(([^)]+)\)$/))) {
    const p = splitParts(m[1]);
    if (p.length < 3) return null;
    return hsvToRgb(+p[0], pct(p[1]), pct(p[2]), p[3] != null ? +p[3] : 1);
  }
  if ((m = s.match(/^oklch\(([^)]+)\)$/))) {
    const p = splitParts(m[1]);
    if (p.length < 3) return null;
    return oklchToRgb(pct01(p[0]), +p[1], +p[2], p[3] != null ? +p[3] : 1);
  }
  return null;
}
function splitParts(inner) { return inner.split(/[\s,/]+/).map((x) => x.trim()).filter(Boolean); }
const pct = (x) => (String(x).includes("%") ? parseFloat(x) : parseFloat(x));           // hsl s/l are % numbers
const pct01 = (x) => (String(x).includes("%") ? parseFloat(x) / 100 : parseFloat(x));   // oklch L is 0..1 or 0..100%

function fromHex(s) {
  let h = s.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if ((h.length !== 6 && h.length !== 8) || !/^[0-9a-f]+$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
           a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}

// ── format: {r,g,b,a} → each notation string ─────────────────────────────────────────────────
const h2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
export function toHex(c, withAlpha = false) {
  const base = "#" + h2(c.r) + h2(c.g) + h2(c.b);
  return withAlpha && c.a != null && c.a < 1 ? base + h2(c.a * 255) : base;
}
export function toRgb(c) {
  return c.a != null && c.a < 1
    ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${round(c.a, 2)})`
    : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}
export function toHsl(c) {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  return c.a != null && c.a < 1
    ? `hsla(${round(h)}, ${round(s)}%, ${round(l)}%, ${round(c.a, 2)})`
    : `hsl(${round(h)}, ${round(s)}%, ${round(l)}%)`;
}
export function toHsv(c) {
  const { h, s, v } = rgbToHsv(c.r, c.g, c.b);
  return `hsv(${round(h)}, ${round(s)}%, ${round(v)}%)`;
}
export function toOklch(c) {
  const { L, C, H } = rgbToOklch(c.r, c.g, c.b);
  return `oklch(${round(L, 3)} ${round(C, 3)} ${round(H, 1)})`;
}
/** Every notation at once — what the converter renders. */
export function allNotations(c) {
  return { hex: toHex(c), hexa: toHex(c, true), rgb: toRgb(c), hsl: toHsl(c), hsv: toHsv(c), oklch: toOklch(c) };
}

// ── HSL ──────────────────────────────────────────────────────────────────────────────────────
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}
export function hslToRgb(h, s, l, a = 1) {
  h = mod(h, 360); s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

// ── HSV / HSB ──────────────────────────────────────────────────────────────────────────────────
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: (max === 0 ? 0 : d / max) * 100, v: max * 100 };
}
export function hsvToRgb(h, s, v, a = 1) {
  h = mod(h, 360); s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

// ── OKLab / OKLCH (Ottosson) ─────────────────────────────────────────────────────────────────
const srgbToLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const linToSrgb = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch(r, g, b) {
  const lr = srgbToLin(r), lg = srgbToLin(g), lb = srgbToLin(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.hypot(A, B);
  let H = Math.atan2(B, A) * 180 / Math.PI; if (H < 0) H += 360;
  return { L, C, H };
}
export function oklchToRgb(L, C, H, a = 1) {
  const hr = H * Math.PI / 180;
  const A = C * Math.cos(hr), B = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return { r: clamp(linToSrgb(lr), 0, 255), g: clamp(linToSrgb(lg), 0, 255), b: clamp(linToSrgb(lb), 0, 255), a };
}

// The common CSS names people paste into a converter (same short list as the contrast kit).
const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", navy: "#000080", teal: "#008080", olive: "#808000",
  lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff",
  pink: "#ffc0cb", tomato: "#ff6347", coral: "#ff7f50", gold: "#ffd700", indigo: "#4b0082",
  slate: "#708090", crimson: "#dc143c", rebeccapurple: "#663399",
};
