// BARCODE ENCODERS — the bit-exact half of a 1D barcode, kept pure and separate from the drawing.
//
// A barcode LOOKS like "just some stripes", but a scanner is unforgiving: one wrong parity bit, one
// miscounted check digit, one code-set switch in the wrong place, and the label reads as a different
// number — or won't read at all. There is no "looks about right" here. That is exactly why the
// encoding lives in this one module with a headless test (barcode.test.mjs) that pins every table and
// checksum to a KNOWN published value, instead of being eyeballed inline against a rendered image.
//
// Pure: no DOM, no imports, no network, no side effects. Deterministic in → out.
//
// Output contract — encodeBarcode(type, data) returns:
//   { ok:true, type, modules, widthUnits, quiet:{left,right}, text }
//   { ok:false, error }
// `modules` is a RUN-LENGTH array: widths in modules of alternating bar/space runs, ALWAYS starting
// with a bar (modules[0]=bar, modules[1]=space, …). A run-length array is chosen over a flat 0/1 array
// because it is what a renderer actually wants (draw bar of width w, skip space of width w) and because
// the symbology specs themselves are stated as element widths. `widthUnits` = sum(modules) = the width
// of the ENCODED REGION in modules, EXCLUDING the quiet zones. `quiet` gives the quiet-zone widths (in
// modules) the renderer must leave blank on each side. `text` is the human-readable string to draw
// under the bars (for EAN-13 that is the full 13 digits including the computed check digit).

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// EAN-13
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// 95-module symbol (excluding quiet zones): start-guard 101 (3) + 6 left digits ×7 (42) +
// centre-guard 01010 (5) + 6 right digits ×7 (42) + end-guard 101 (3) = 95.
//
// The FIRST of the 13 digits is not drawn as bars of its own — it is encoded implicitly by the PARITY
// PATTERN (which of the L- / G-codes) used for the six LEFT digits. The six right digits always use
// the R-code. These three tables are the universal EAN/UPC tables.

// L-code (odd parity) — left digits, "odd" set.
const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
// R-code — right digits. R(d) is the bitwise COMPLEMENT of L(d).
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
// G-code (even parity) — left digits, "even" set. G(d) is R(d) reversed (== L(d) complemented then reversed).
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];

// First digit → parity pattern for the six left digits. O = odd (use L-code), E = even (use G-code).
const EAN_PARITY = ["OOOOOO","OOEOEE","OOEEOE","OOEEEO","OEOOEE","OEEOOE","OEEEOO","OEOEOE","OEOEEO","OEEOEO"];

/** EAN-13 check digit over the first 12 digits. Per spec: weight the digits 1,3,1,3,… so that the
 *  digit immediately left of the check position gets weight 3 (i.e. from the right, odd positions ×1,
 *  even positions ×3). With 1-indexing from the LEFT that is: odd index ×1, even index ×3. */
export function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += (i % 2 === 0) ? d : d * 3;   // index 0 (1st) ×1, index 1 (2nd) ×3, …
  }
  return (10 - (sum % 10)) % 10;
}

function encodeEan13(raw) {
  const data = String(raw ?? "").trim();
  if (!/^\d+$/.test(data)) return { ok: false, error: "EAN-13 needs digits only." };
  if (data.length !== 12 && data.length !== 13) return { ok: false, error: "EAN-13 needs 12 or 13 digits." };

  let digits;
  if (data.length === 12) {
    digits = data + String(ean13CheckDigit(data));
  } else {
    const want = ean13CheckDigit(data.slice(0, 12));
    if (want !== data.charCodeAt(12) - 48) {
      return { ok: false, error: `Check digit should be ${want}, not ${data[12]}.` };
    }
    digits = data;
  }

  const first = digits.charCodeAt(0) - 48;
  const parity = EAN_PARITY[first];
  let bits = "101";                                    // start guard
  for (let i = 0; i < 6; i++) {                         // left group = digits 2..7 (index 1..6)
    const d = digits.charCodeAt(i + 1) - 48;
    bits += (parity[i] === "O") ? EAN_L[d] : EAN_G[d];
  }
  bits += "01010";                                     // centre guard
  for (let i = 0; i < 6; i++) {                         // right group = digits 8..13 (index 7..12)
    bits += EAN_R[digits.charCodeAt(i + 7) - 48];
  }
  bits += "101";                                       // end guard

  const modules = bitsToRuns(bits);                    // starts with a bar (guard begins with 1)
  return {
    ok: true, type: "ean13",
    modules, widthUnits: bits.length,                  // 95
    quiet: { left: 11, right: 7 },                     // EAN quiet zones (modules)
    text: digits,
  };
}

/** Turn a "1010…" bit string (1 = bar, must start with 1) into alternating run-length widths. */
function bitsToRuns(bits) {
  const runs = [];
  let cur = bits[0], len = 0;
  for (const b of bits) { if (b === cur) len++; else { runs.push(len); cur = b; len = 1; } }
  runs.push(len);
  return runs;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CODE 128
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// 107 patterns: values 0–105 are 11-module symbols (3 bars + 3 spaces, given as 6 element widths);
// value 106 is the 13-module STOP (7 elements — note the trailing 2-module bar). Every symbol begins
// with a bar and (for 0–105) ends with a space, so concatenating the width strings keeps the whole
// code a clean alternating bar/space run-length sequence that starts and ends on a bar.
const C128 = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213", // 0-9
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132", // 10-19
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211", // 20-29
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313", // 30-39
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331", // 40-49
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111", // 50-59
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214", // 60-69
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111", // 70-79
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141", // 80-89
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141", // 90-99
  "114131","311141","411131","211412","211214","211232","2331112",                            // 100-106
];
const START_A = 103, START_B = 104, START_C = 105, STOP = 106, CODE_A = 101, CODE_B = 100, CODE_C = 99;

const isDigit = (c) => c >= 48 && c <= 57;
function digitsAhead(codes, i) { let n = 0; while (i + n < codes.length && isDigit(codes[i + n])) n++; return n; }

/** Choose Start A only when the first "deciding" character is a control char (<32); otherwise B.
 *  (Lowercase / {|}~ exist only in set B, so a printable-leading string always starts in B.) */
function startNeedsA(codes) {
  for (const c of codes) { if (c < 32) return true; if (c > 95) return false; }
  return false;
}

/** Value of a single character in code set A or B. */
function valInSet(set, c) {
  if (set === "B") return c - 32;                       // 32..127 → 0..95
  // set A: 32..95 → 0..63 ; control 0..31 → 64..95
  return (c < 32) ? c + 64 : c - 32;
}

/** ASCII string → the list of Code-128 symbol VALUES (Start … data … , NO checksum/stop yet).
 *  Auto-picks the start set; uses Code C for runs of ≥4 digits (and for all-digit even input). */
function code128Values(str) {
  const codes = [];
  for (const ch of str) codes.push(ch.charCodeAt(0));
  const n = codes.length;
  const vals = [];

  const lead = digitsAhead(codes, 0);
  let set;                                              // "A" | "B" | "C"
  if (lead === n && n >= 2 && n % 2 === 0) { set = "C"; vals.push(START_C); }
  else if (lead >= 4) { set = "C"; vals.push(START_C); }
  else if (startNeedsA(codes)) { set = "A"; vals.push(START_A); }
  else { set = "B"; vals.push(START_B); }

  let i = 0;
  while (i < n) {
    if (set === "C") {
      if (digitsAhead(codes, i) >= 2) {                 // consume a digit pair
        vals.push((codes[i] - 48) * 10 + (codes[i + 1] - 48)); i += 2; continue;
      }
      // <2 digits left → leave Code C
      if (codes[i] < 32) { vals.push(CODE_A); set = "A"; } else { vals.push(CODE_B); set = "B"; }
      continue;
    }
    // set A or B: switch INTO C on a run of ≥4 digits (Code C then drains the pairs and switches back)
    if (digitsAhead(codes, i) >= 4) { vals.push(CODE_C); set = "C"; continue; }
    const c = codes[i];
    if (set === "B" && c < 32) { vals.push(CODE_A); set = "A"; continue; }   // need control char → A
    if (set === "A" && c > 95) { vals.push(CODE_B); set = "B"; continue; }   // need lowercase/etc → B
    vals.push(valInSet(set, c)); i++;
  }
  return vals;
}

/** Code-128 mod-103 checksum: (startValue + Σ position×value) mod 103, position 1 for the first data
 *  value after the start. `vals[0]` is the start value (weight 1); each later value has weight = index. */
export function code128Checksum(vals) {
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += k * vals[k];
  return sum % 103;
}

function encodeCode128(raw) {
  const str = String(raw ?? "");
  if (str.length === 0) return { ok: false, error: "Nothing to encode." };
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return { ok: false, error: "Code 128 encodes ASCII only." };
  }
  const vals = code128Values(str);
  const check = code128Checksum(vals);
  const symbols = [...vals, check, STOP];

  const modules = [];
  for (const v of symbols) for (const ch of C128[v]) modules.push(ch.charCodeAt(0) - 48);
  return {
    ok: true, type: "code128",
    modules, widthUnits: modules.reduce((a, b) => a + b, 0),
    quiet: { left: 10, right: 10 },                    // ≥10 modules each side per spec
    text: str,
    // exposed for the test's cross-checks — cheap, and keeps the assertions honest.
    _symbols: symbols, _check: check,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// public entry
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const BARCODE_TYPES = [
  { id: "code128", label: "Code 128", hint: "any text or number", placeholder: "SWITCHBOARD" },
  { id: "ean13",   label: "EAN-13",   hint: "12 or 13 digit product code", placeholder: "590123412345" },
];

/** Encode `data` as `type` ("code128" | "ean13"). Never throws — bad input returns {ok:false,error}. */
export function encodeBarcode(type, data) {
  switch (type) {
    case "ean13": return encodeEan13(data);
    case "code128": return encodeCode128(data);
    default: return { ok: false, error: `Unknown barcode type: ${type}` };
  }
}
