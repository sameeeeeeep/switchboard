// BASE CONVERSION — the pure maths behind "what is this integer in another number base?".
//
// Harvested-idea sibling of kit/contrast.js: a deterministic, in-tab, no-model function that any
// wrapp/God-tool/widget can call. Base conversion is exactly the shape that fits a launcher command
// + notch glance — one value + its base in, the same value in every base out — so it lives factored
// out and tested against known reference values, not eyeballed.
//
// Everything runs on BigInt, on purpose: parseInt("18446744073709551615", 10) already rounds off
// past 2^53, so a 64-bit hex address or a crypto constant would convert WRONG. BigInt is exact for
// arbitrarily large integers, which is the whole reason a programmer reaches for a base converter.
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/base.test.mjs).

// ── the digit alphabet (bases 2…36) ─────────────────────────────────────────────────────────
// 0-9 then a-z; index in this string IS the digit's numeric value. Lowercase is canonical output.
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const MIN_BASE = 2, MAX_BASE = 36;

/** Numeric value of a single (lowercased) digit char, or -1 if it isn't a base-36 digit at all. */
function digitValue(ch) {
  const i = DIGITS.indexOf(ch);
  return i;   // -1 for anything not in 0-9a-z
}

/** True for an integer base we can actually convert to/from. Rejects non-ints, <2 and >36. */
export function isValidBase(base) {
  return Number.isInteger(base) && base >= MIN_BASE && base <= MAX_BASE;
}

// ── parse a string in a given base → bigint | null ──────────────────────────────────────────
/** Turn a human-typed number in `base` into an exact BigInt, or null if it isn't a legal value.
 *
 *  Tolerant on purpose — a base converter's input comes from copy-paste and muscle memory, so we
 *  accept the noise people actually type:
 *    · a leading '-' for negatives (kept; everything else is stripped)
 *    · the matching radix PREFIX for the common bases (0x/0X hex, 0b bin, 0o oct) — only the prefix
 *      that matches `base`, so "0b" in base-16 stays the hex number 0x0b (=11), not an empty binary.
 *    · spaces and underscores as digit-group separators ("1111_1111", "ff 00")
 *  Anything left after that must be legal digits for the base; a single illegal digit → null (we
 *  never silently drop it, because "gf" quietly becoming "f" is a wrong answer that looks right).
 *  Empty (or just "-") → null. */
export function parseIn(str, base) {
  if (str == null || !isValidBase(base)) return null;
  let s = String(str).trim().toLowerCase();
  if (!s) return null;

  // sign first, so the prefix/separator stripping below sees only the magnitude.
  let neg = false;
  if (s[0] === "-") { neg = true; s = s.slice(1); }
  else if (s[0] === "+") { s = s.slice(1); }

  // strip ONLY the prefix that matches this base (avoids "0b…"/"0x…" ambiguity across bases).
  if (base === 16 && s.startsWith("0x")) s = s.slice(2);
  else if (base === 2 && s.startsWith("0b")) s = s.slice(2);
  else if (base === 8 && s.startsWith("0o")) s = s.slice(2);

  // separators people use to group digits — meaningless to the value, so drop them.
  s = s.replace(/[\s_]/g, "");
  if (!s) return null;   // was all prefix/separators, no actual digits

  const B = BigInt(base);
  let acc = 0n;
  for (const ch of s) {
    const d = digitValue(ch);
    if (d < 0 || d >= base) return null;   // illegal digit for this base → the whole thing is invalid
    acc = acc * B + BigInt(d);
  }
  return neg ? -acc : acc;
}

// ── format a bigint into a given base → lowercase string ────────────────────────────────────
/** Render a BigInt in `base` as a lowercase string (with a leading '-' when negative). No prefix —
 *  callers add 0x/0b/0o themselves if they want it, so this stays the one canonical digit form. */
export function toBase(value, base) {
  if (typeof value !== "bigint" || !isValidBase(base)) return null;
  if (value === 0n) return "0";
  const neg = value < 0n;
  let n = neg ? -value : value;
  const B = BigInt(base);
  let out = "";
  while (n > 0n) {
    out = DIGITS[Number(n % B)] + out;   // n % B < 36, so Number() is exact here
    n = n / B;
  }
  return neg ? "-" + out : out;
}

// ── the convenience: one string → the four common bases ─────────────────────────────────────
/** Parse `str` from `fromBase`, then hand back the value in the four bases a programmer wants at a
 *  glance: decimal, hex, binary, octal (all lowercase, no prefixes). null on bad input, so the UI /
 *  God tool / widget all branch on the same falsy signal. */
export function convertAll(str, fromBase) {
  const v = parseIn(str, fromBase);
  if (v == null) return null;
  return { dec: toBase(v, 10), hex: toBase(v, 16), bin: toBase(v, 2), oct: toBase(v, 8) };
}
