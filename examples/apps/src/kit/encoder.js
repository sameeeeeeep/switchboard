// ENCODER — the pure text-transform maths behind "encode/decode this a few standard ways".
//
// Harvested-idea sibling of kit/contrast.js and kit/qr-payload.js: deterministic, in-tab, no-model
// functions any wrapp/God-tool/widget can call. Each transform is exactly the shape that fits a
// launcher command + a notch glance — text in, text out — so it lives factored out and tested against
// KNOWN reference vectors (base64 round-trips, the FIPS SHA test vectors), not eyeballed.
//
// Pure: no DOM, no imports, no network. Uses only platform built-ins that exist in BOTH a browser tab
// and node ≥18 — TextEncoder/TextDecoder, btoa/atob, and globalThis.crypto.subtle for the hashes.
// Headless-testable (kit/encoder.test.mjs).

// ── Base64 (UTF-8 safe) ──────────────────────────────────────────────────────────────────────
// The classic btoa(str) breaks on anything outside Latin-1 (emoji, accents throw / mangle). The fix
// is to go through the BYTES: TextEncoder → UTF-8 bytes → a binary string → btoa. Decoding reverses
// it. This is why a naïve base64 tool corrupts "é" and "👋"; we round-trip them exactly.

/** Encode any string to Base64. `urlSafe` swaps +/ for -_ and drops '=' padding (RFC 4648 §5),
 *  the variant that survives inside a URL or filename. */
export function toBase64(str, { urlSafe = false } = {}) {
  const bytes = new TextEncoder().encode(String(str));
  // Chunk the byte→binary-string step: String.fromCharCode(...bytes) blows the call stack on large
  // inputs (spread arg limit), so walk it in 32KB windows instead.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  let b64 = btoa(bin);
  if (urlSafe) b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64;
}

/** Decode Base64 (standard OR url-safe — we normalise) back to a string. Throws a plain, human Error
 *  on anything that isn't valid Base64, so the UI can say "that isn't valid" instead of silently
 *  emitting mojibake. (Decision: THROW, not return null — every caller here wants the message.) */
export function fromBase64(str) {
  let s = String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;                       // url-safe form dropped its '=' — put it back
  if (pad) s += "=".repeat(4 - pad);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("that isn't valid Base64 — check for stray characters.");
  let bin;
  try { bin = atob(s); } catch { throw new Error("that isn't valid Base64 — check for stray characters."); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Non-fatal decode: arbitrary bytes that aren't clean UTF-8 come back with U+FFFD rather than
  // throwing, which is the friendlier answer when someone pastes a base64 of raw binary.
  return new TextDecoder().decode(bytes);
}

// ── URL component encoding ───────────────────────────────────────────────────────────────────
// Thin wrappers over the platform primitives, named to match the tab. decodeURIComponent THROWS a
// URIError on a malformed percent-sequence ("%", "%zz") — we re-throw a plainer message.
export function urlEncode(str) { return encodeURIComponent(String(str)); }
export function urlDecode(str) {
  try { return decodeURIComponent(String(str)); }
  catch { throw new Error("that isn't valid percent-encoding — a stray % or a bad %XX sequence."); }
}

// ── HTML entities ────────────────────────────────────────────────────────────────────────────
// escape the five characters that break out of HTML text/attribute context. `&` MUST go first on
// escape (so we don't double-escape our own output) and LAST on unescape (same reason, reversed).
const ESC = [
  [/&/g, "&amp;"], [/</g, "&lt;"], [/>/g, "&gt;"], [/"/g, "&quot;"], [/'/g, "&#39;"],
];
export function htmlEscape(str) {
  let s = String(str);
  for (const [re, ent] of ESC) s = s.replace(re, ent);
  return s;
}
/** Reverse htmlEscape, and — as a bonus — decode any numeric character reference (&#169; / &#xA9;)
 *  and the &apos; alias, since real-world HTML uses them. Named refs beyond these six are NOT decoded
 *  (that needs the full 250-name table); we stay honest about that in the UI rather than half-do it. */
export function htmlUnescape(str) {
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
const cp = (n) => { try { return String.fromCodePoint(n); } catch { return ""; } };

// ── Hashes (one-way, encode only) ────────────────────────────────────────────────────────────
// crypto.subtle.digest is async and returns an ArrayBuffer; we render it as lowercase hex, the form
// every checksum tool prints. Same API in the browser and in node ≥18 via globalThis.crypto.
export const HASH_ALGOS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const ALGO_ALIAS = { "sha1": "SHA-1", "sha-1": "SHA-1", "sha256": "SHA-256", "sha-256": "SHA-256",
  "sha384": "SHA-384", "sha-384": "SHA-384", "sha512": "SHA-512", "sha-512": "SHA-512" };
function normalizeAlgo(algo) {
  const a = ALGO_ALIAS[String(algo).toLowerCase().trim()];
  if (!a) throw new Error(`unknown hash '${algo}' — use one of ${HASH_ALGOS.join(", ")}.`);
  return a;
}
/** SHA-1/256/384/512 of a string, as lowercase hex. Async — crypto.subtle is Promise-based. */
export async function hash(str, algo = "SHA-256") {
  const a = normalizeAlgo(algo);
  const subtle = (globalThis.crypto && globalThis.crypto.subtle);
  if (!subtle) throw new Error("this environment has no Web Crypto — can't hash here.");
  const buf = await subtle.digest(a, new TextEncoder().encode(String(str)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── the mode table + one orchestrator ────────────────────────────────────────────────────────
// One place that says what the tabs ARE, so the UI, the God tool and the widget can't drift. `oneWay`
// hashes have no decode; `urlSafe` is a Base64-only knob.
export const MODES = [
  { id: "base64", label: "Base64", oneWay: false, urlSafe: true },
  { id: "url",    label: "URL",    oneWay: false, urlSafe: false },
  { id: "html",   label: "HTML",   oneWay: false, urlSafe: false },
  { id: "hash",   label: "Hash",   oneWay: true,  urlSafe: false },
];

/** The single pipeline every surface calls: run one mode over `text`. Returns a plain, JSON-safe
 *  `{ ok, output }` or `{ ok:false, error }` — it NEVER throws, so the UI/God/widget can render an
 *  error state instead of crashing. Async because hashing is (the sync modes just resolve instantly). */
export async function convert(mode, text, opts = {}) {
  const { decode = false, urlSafe = false, algo = "SHA-256" } = opts;
  const t = String(text ?? "");
  try {
    switch (mode) {
      case "base64": return { ok: true, output: decode ? fromBase64(t) : toBase64(t, { urlSafe }) };
      case "url":    return { ok: true, output: decode ? urlDecode(t) : urlEncode(t) };
      case "html":   return { ok: true, output: decode ? htmlUnescape(t) : htmlEscape(t) };
      case "hash":   return { ok: true, output: await hash(t, algo) };
      default:       return { ok: false, error: `unknown mode '${mode}'.` };
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
