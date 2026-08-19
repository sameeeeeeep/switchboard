// FAVICON — the pure, in-tab logic behind "one image → a full set of site/app icons".
//
// Harvested-idea sibling of kit/contrast.js and kit/qr-payload.js: a deterministic, no-model, no-DOM
// function any wrapp/God-tool/widget can call. The genuinely-new piece here is the ICO CONTAINER
// PACKER — the one bit of real byte-wrangling. Everything else (resizing a bitmap onto N canvases,
// encoding PNGs) is browser <canvas> work the wrapp does; this file just knows the .ico wire format,
// so it can be tested headlessly against the spec instead of eyeballed.
//
// Pure: no DOM, no imports, no side effects — only Uint8Array/DataView. Headless-testable
// (kit/favicon.test.mjs).

// ── the default size set — factored out so it's tested and overridable ──────────────────────
// 16/32/48 are the classic favicon sizes (and the three we pack into the multi-size .ico); 64 is a
// crisp tab/retina step; 180 is apple-touch-icon; 192 + 512 are the PWA manifest icons. A wrapp can
// override, but this is the sane default a launcher command gets with no arguments.
const DEFAULT_SIZES = [16, 32, 48, 64, 180, 192, 512];

/** The default favicon size set (px). `opts.extra` appends, `opts.only` replaces — both deduped and
 *  sorted ascending so downstream previews and the .ico entries stay in a stable order. */
export function faviconSizes(opts = {}) {
  let sizes = Array.isArray(opts.only) && opts.only.length ? opts.only.slice() : DEFAULT_SIZES.slice();
  if (Array.isArray(opts.extra)) sizes = sizes.concat(opts.extra);
  const seen = new Set();
  const out = [];
  for (const s of sizes) {
    const n = Math.round(Number(s));
    // Cap at 512 — the largest PWA icon anyone ships. (The .ico entries only use ≤48; the width/height
    // BYTE in buildIco separately encodes ≥256 as 0, per the format.)
    if (Number.isFinite(n) && n >= 1 && n <= 512 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out.sort((a, b) => a - b);
}

// ── ICO layout constants (the wire format, so the packer reads like the spec) ────────────────
const ICONDIR_SIZE = 6;      // reserved(2) + type(2) + count(2)
const ICONDIRENTRY_SIZE = 16; // width + height + colors + reserved + planes(2) + bitcount(2) + bytes(4) + offset(4)

/** Total header bytes (ICONDIR + n entries) for `n` images — i.e. the offset of the FIRST image. */
export function headerByteLength(n) {
  return ICONDIR_SIZE + ICONDIRENTRY_SIZE * n;
}

/** Byte offset to the image data for entry `i`, given the ordered PNG lengths. The first image sits
 *  right after the directory; each subsequent image follows the previous blob. */
export function pngByteOffset(pngLengths, i) {
  let off = headerByteLength(pngLengths.length);
  for (let k = 0; k < i; k++) off += pngLengths[k];
  return off;
}

/**
 * Pack an array of PNG-encoded icons into a single multi-size .ico byte buffer.
 *
 * Modern .ico containers may embed PNG data DIRECTLY (rather than the legacy BMP/DIB payload) — that
 * is exactly what we do: the ICONDIRENTRY carries the byte-size of, and absolute offset to, each
 * unmodified PNG blob, and the PNGs are concatenated after the directory. Windows Vista+ and every
 * modern browser read this.
 *
 * @param {{ size:number, png:Uint8Array }[]} images  each `png` is a complete PNG byte array.
 * @returns {Uint8Array} the .ico file bytes.
 */
export function buildIco(images) {
  const list = (Array.isArray(images) ? images : []).filter((im) => im && im.png && im.png.length);
  if (!list.length) throw new Error("buildIco: need at least one { size, png } image");
  const n = list.length;
  const pngLengths = list.map((im) => im.png.length);

  const total = headerByteLength(n) + pngLengths.reduce((a, b) => a + b, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);

  // ICONDIR — reserved=0, type=1 (icon; 2 would be cursor), count=n. All multi-byte fields LE.
  dv.setUint16(0, 0, true);   // reserved
  dv.setUint16(2, 1, true);   // type = icon
  dv.setUint16(4, n, true);   // image count

  // ICONDIRENTRY × n, then the PNG blobs. Offsets are absolute from the start of the file.
  let entryPos = ICONDIR_SIZE;
  let dataPos = headerByteLength(n);
  for (let i = 0; i < n; i++) {
    const { size, png } = list[i];
    const dim = Math.round(Number(size)) || png.length; // a real caller always passes size
    // width/height are one byte each; 256 is encoded as 0. Anything >256 is clamped to 0 (=256).
    const wh = dim >= 256 ? 0 : dim;
    dv.setUint8(entryPos + 0, wh);        // width  (0 ⇒ 256)
    dv.setUint8(entryPos + 1, wh);        // height (0 ⇒ 256)
    dv.setUint8(entryPos + 2, 0);         // color palette count (0 = no palette / true-color)
    dv.setUint8(entryPos + 3, 0);         // reserved
    dv.setUint16(entryPos + 4, 1, true);  // color planes
    dv.setUint16(entryPos + 6, 32, true); // bits per pixel
    dv.setUint32(entryPos + 8, png.length, true);  // size of the PNG blob, in bytes
    dv.setUint32(entryPos + 12, dataPos, true);    // absolute offset to the PNG blob

    buf.set(png, dataPos);
    entryPos += ICONDIRENTRY_SIZE;
    dataPos += png.length;
  }
  return buf;
}
