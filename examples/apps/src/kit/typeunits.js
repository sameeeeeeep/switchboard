// TYPE UNITS — the pure maths behind "convert this type measurement", covering the two conversions
// designers actually reach for: CSS px↔rem↔em (relative to a root size), and the print/typographic
// units (pt, pc, in, mm, cm) that share the 96dpi CSS reference. Plus a line-height helper.
//
// Harvested-idea sibling of kit/unit.js, but type-specific: rem/em depend on a BASE font size, which a
// generic unit converter has no concept of. Pure + tested (kit/typeunits.test.mjs).

const round = (n, p = 4) => { const f = 10 ** p; return Math.round(n * f) / f; };

// ── px ↔ rem ↔ em (relative to a root px size, default 16) ───────────────────────────────────
/** Convert `value` in `from` (px|rem|em) to `to`, given the root font-size in px. em is treated as
 *  relative to the same base here (the common "1em = root" assumption a converter makes; nested em
 *  context isn't knowable from a bare number). */
export function pxrem(value, from, to, basePx = 16) {
  const v = Number(value), base = Number(basePx) || 16;
  if (!Number.isFinite(v)) return null;
  const px = from === "px" ? v : v * base;        // rem/em → px
  if (to === "px") return round(px, 4);
  return round(px / base, 5);                      // px → rem/em
}
/** Both relative forms at once for a px value (what the UI shows). */
export function pxToBoth(px, basePx = 16) {
  const v = Number(px), base = Number(basePx) || 16;
  if (!Number.isFinite(v)) return null;
  return { rem: round(v / base, 5), em: round(v / base, 5) };
}

// ── typographic / print units (all via inches; CSS reference is 96px = 1in) ───────────────────
// Factor = how many INCHES one of this unit is. pt = 1/72in, pc = 12pt, px = 1/96in (CSS).
const PER_INCH = {
  px: 1 / 96, pt: 1 / 72, pc: 1 / 6, in: 1, mm: 1 / 25.4, cm: 1 / 2.54,
  // Traditional typography: the Didot point and the cicero (12 Didot pts). 1 Didot pt ≈ 0.01483in.
  didot: 0.0148303, cicero: 0.177963,
};
export const TYPO_UNITS = Object.keys(PER_INCH);

/** Convert between any two typographic units. Returns null on unknown units / bad value. */
export function typo(value, from, to) {
  const v = Number(value);
  if (!Number.isFinite(v) || !(from in PER_INCH) || !(to in PER_INCH)) return null;
  const inches = v * PER_INCH[from];
  return round(inches / PER_INCH[to], 5);
}
/** A whole row: one value in every typographic unit at once. */
export function typoAll(value, from) {
  if (!(from in PER_INCH)) return null;
  const out = {};
  for (const u of TYPO_UNITS) out[u] = typo(value, from, u);
  return out;
}

// ── line-height helper ────────────────────────────────────────────────────────────────────────
/** Given a font size (px) and a unitless line-height ratio, return the computed line-height in px,
 *  and a readable-range verdict (WCAG/typography guidance favours ~1.4–1.6 for body). */
export function lineHeight(fontPx, ratio) {
  const f = Number(fontPx), r = Number(ratio);
  if (!Number.isFinite(f) || !Number.isFinite(r)) return null;
  const px = round(f * r, 2);
  const verdict = r < 1.2 ? "tight — hard to read as body text"
    : r <= 1.6 ? "comfortable for body text"
    : r <= 2 ? "loose — good for short lines / large type"
    : "very loose";
  return { px, ratio: round(r, 3), verdict };
}
/** Suggest a body line-height in px for a font size (the ~1.5 rule of thumb). */
export function suggestLineHeight(fontPx) {
  const f = Number(fontPx);
  if (!Number.isFinite(f)) return null;
  return { ratio: 1.5, px: round(f * 1.5, 2) };
}
