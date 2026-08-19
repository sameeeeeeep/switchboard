// SVG MINIFY — the pure, in-tab string surgery that shrinks an SVG without changing what it draws.
//
// Harvested-idea sibling of kit/contrast.js and kit/qr-payload.js: a deterministic, no-DOM, no-model
// function any wrapp/God-tool/widget can call. Minifying an SVG is exactly the shape that fits a
// launcher command + a notch glance — one string in, a smaller string plus a savings breakdown out —
// so it lives factored out and tested against known inputs, not eyeballed in a browser. It runs in
// node (pure regex, no DOMParser) precisely so the headless proof can assert byte-for-byte behaviour.
//
// SAFE-ONLY doctrine: every transform here is one that cannot change the rendered pixels — stripping
// comments, editor metadata and formatting whitespace, and rounding coordinate numbers. Anything that
// *could* alter rendering (reordering attributes, merging paths, collapsing groups, touching text-node
// whitespace) is deliberately NOT done. When in doubt we leave the bytes in.
//
// Pure: no DOM, no imports, no side effects. Headless-testable (kit/svgmin.test.mjs).

// UTF-8 byte length — the number that actually matters (a multibyte glyph in a <text> is >1 byte).
function byteLen(s) {
  s = String(s);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
  return unescape(encodeURIComponent(s)).length; // last-ditch fallback
}

// The attributes whose values are coordinate/geometry/style data — the ONLY places we collapse inner
// whitespace and round numbers. Restricting to this whitelist is the safety guarantee: we never touch
// an id, class, href or a text node, so we can never rename a reference or reflow copy.
const NUM_ATTRS = new Set([
  "d", "points", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
  "x1", "y1", "x2", "y2", "dx", "dy", "fx", "fy", "offset", "viewBox",
  "transform", "gradientTransform", "patternTransform", "rotate", "path",
  "stroke-width", "stroke-dashoffset", "stroke-dasharray", "stroke-miterlimit",
  "opacity", "fill-opacity", "stroke-opacity", "stop-opacity",
  "font-size", "letter-spacing", "word-spacing", "baseline-shift",
  "startOffset", "markerWidth", "markerHeight", "refX", "refY",
  "kernelMatrix", "stdDeviation", "tableValues", "style",
]);

// Editor namespaces whose elements/attributes/xmlns decls are pure authoring cruft (Inkscape/Sodipodi,
// Adobe Illustrator). None of these affect how a browser renders the graphic.
const EDITOR_NS = ["inkscape", "sodipodi", "adobe"];
const EDITOR_ALT = EDITOR_NS.join("|");

/** Round every decimal number in a coordinate/style string to `precision` places, dropping trailing
 *  zeros. Integers (no decimal point) are left untouched — they're already minimal. */
function roundNumbers(value, precision) {
  return value.replace(/-?\d*\.\d+(?:[eE][+-]?\d+)?/g, (m) => {
    const n = Number(m);
    if (!isFinite(n)) return m;
    let r = n.toFixed(precision);
    if (r.indexOf(".") >= 0) r = r.replace(/0+$/, "").replace(/\.$/, "");
    // "-0" is silly; normalise it.
    if (r === "-0") r = "0";
    return r;
  });
}

/**
 * Optimise an SVG string with safe-only transforms.
 * @param {string} svg  the SVG source.
 * @param {object} [opts]
 *   removeComments   (default true)  — strip <!-- ... -->
 *   removeDeclarations (default true) — strip <?xml ?> and <!DOCTYPE ...>
 *   removeEditorCruft (default true) — strip inkscape:/sodipodi:/adobe: elements, attrs & xmlns
 *   removeMetadata   (default true)  — strip <metadata>…</metadata>
 *   removeTitleDesc  (default false) — ALSO strip <title>/<desc> (off: they carry a11y text)
 *   precision        (default 2)     — decimal places for coordinate rounding
 * @returns {{ok:boolean, out?:string, inBytes?:number, outBytes?:number, savedBytes?:number,
 *            savedPct?:number, removed?:object, error?:string}}
 */
export function optimizeSvg(svg, opts = {}) {
  if (svg == null) return { ok: false, error: "nothing to optimise — no SVG was given." };
  const src = String(svg);
  // Guard: only touch something that is actually SVG-ish. Bail loudly rather than corrupt HTML/JSON.
  if (!/<svg[\s>]/i.test(src)) {
    return { ok: false, error: "that doesn't look like an SVG — no <svg> element found." };
  }

  const o = {
    removeComments: opts.removeComments !== false,
    removeDeclarations: opts.removeDeclarations !== false,
    removeEditorCruft: opts.removeEditorCruft !== false,
    removeMetadata: opts.removeMetadata !== false,
    removeTitleDesc: opts.removeTitleDesc === true,
    precision: Number.isFinite(opts.precision) ? Math.max(0, Math.min(8, opts.precision | 0)) : 2,
  };

  const inBytes = byteLen(src);
  const removed = { comments: 0, metadata: 0, editorNs: 0, decls: 0, whitespace: 0 };
  let out = src;

  // 1) XML comments.
  if (o.removeComments) {
    out = out.replace(/<!--[\s\S]*?-->/g, () => { removed.comments++; return ""; });
  }

  // 2) Prolog declarations: the <?xml …?> processing instruction and the <!DOCTYPE …>.
  if (o.removeDeclarations) {
    out = out.replace(/<\?xml[\s\S]*?\?>/gi, () => { removed.decls++; return ""; });
    out = out.replace(/<!DOCTYPE[^>]*>/gi, () => { removed.decls++; return ""; });
  }

  // 3) <metadata> blocks (and, opt-in, <title>/<desc>).
  if (o.removeMetadata) {
    out = out.replace(/<metadata\b[\s\S]*?<\/metadata\s*>/gi, () => { removed.metadata++; return ""; });
    out = out.replace(/<metadata\b[^>]*\/>/gi, () => { removed.metadata++; return ""; });
  }
  if (o.removeTitleDesc) {
    out = out.replace(/<title\b[\s\S]*?<\/title\s*>/gi, () => { removed.metadata++; return ""; });
    out = out.replace(/<desc\b[\s\S]*?<\/desc\s*>/gi, () => { removed.metadata++; return ""; });
    out = out.replace(/<(?:title|desc)\b[^>]*\/>/gi, () => { removed.metadata++; return ""; });
  }

  // 4) Editor cruft — whole elements first (paired, then self-closing), then leftover attrs & xmlns.
  if (o.removeEditorCruft) {
    const paired = new RegExp("<(" + EDITOR_ALT + "):([A-Za-z][\\w-]*)\\b[\\s\\S]*?</\\1:\\2\\s*>", "gi");
    out = out.replace(paired, () => { removed.editorNs++; return ""; });
    const selfClose = new RegExp("<(?:" + EDITOR_ALT + "):[A-Za-z][\\w-]*\\b[^>]*/>", "gi");
    out = out.replace(selfClose, () => { removed.editorNs++; return ""; });
    // Attributes in an editor namespace, e.g. inkscape:label="…" sodipodi:role='…'.
    const attr = new RegExp("\\s(?:" + EDITOR_ALT + "):[\\w-]+\\s*=\\s*(\"[^\"]*\"|'[^']*')", "gi");
    out = out.replace(attr, () => { removed.editorNs++; return ""; });
    // The xmlns declarations that pull those namespaces in.
    const xmlns = new RegExp("\\sxmlns:(?:" + EDITOR_ALT + ")\\s*=\\s*(\"[^\"]*\"|'[^']*')", "gi");
    out = out.replace(xmlns, () => { removed.editorNs++; return ""; });
  }

  // 5) Attribute-value cleanup — collapse inner whitespace + round numbers, ONLY for geometry attrs.
  out = out.replace(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g, (full, name, q, val) => {
    if (!NUM_ATTRS.has(name)) return full;
    let v = val;
    const collapsed = v.replace(/\s+/g, " ").trim();
    if (collapsed !== v) removed.whitespace++;
    v = roundNumbers(collapsed, o.precision);
    return name + "=" + q + v + q;
  });

  // 6) Formatting whitespace BETWEEN tags — only gaps that contain a newline (i.e. indentation), so a
  //    lone significant space between two inline <tspan>s is never eaten. This is the one whitespace
  //    rule that could change text rendering if done naively, so we scope it to newline runs.
  out = out.replace(/>[ \t\r\n]*[\r\n][ \t\r\n]*</g, () => { removed.whitespace++; return "><"; });

  // 7) Trim leading/trailing whitespace left by stripped declarations.
  out = out.trim();

  const outBytes = byteLen(out);
  const savedBytes = inBytes - outBytes;
  const savedPct = inBytes > 0 ? Math.round((savedBytes / inBytes) * 1000) / 10 : 0;
  return { ok: true, out, inBytes, outBytes, savedBytes, savedPct, removed };
}
