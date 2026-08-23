// Headless assertions for the safe-only SVG minifier. No browser, no bundler:
//   node examples/apps/src/kit/svgmin.test.mjs
// Every check pins a KNOWN transform on a KNOWN input, because "the file got smaller" is exactly how a
// too-aggressive rule ships an SVG that no longer draws what it drew.
import { optimizeSvg } from "./svgmin.js";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

console.log("\n── guard ────────────────────────────────────────────────");
expect(optimizeSvg("just some text").ok === false, "non-SVG input → ok:false");
expect(optimizeSvg("").ok === false, "empty string → ok:false");
expect(optimizeSvg(null).ok === false, "null → ok:false, never throws");
expect("error" in optimizeSvg("{}") && optimizeSvg("{}").ok === false, "JSON-ish input → ok:false with an error");

console.log("\n── comment removal ──────────────────────────────────────");
{
  const r = optimizeSvg('<svg><!-- a designer note --><rect x="1" y="1"/></svg>');
  expect(r.ok && !r.out.includes("<!--"), "XML comment stripped");
  expect(r.removed.comments === 1, "comment count = 1");
  expect(r.out.includes("<rect"), "the real element survives");
}

console.log("\n── declaration removal ──────────────────────────────────");
{
  const r = optimizeSvg('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg><rect/></svg>');
  expect(r.ok && !/<\?xml/i.test(r.out), "<?xml ?> prolog stripped");
  expect(!/<!DOCTYPE/i.test(r.out), "<!DOCTYPE> stripped");
  expect(r.removed.decls === 2, "decl count = 2");
  const keep = optimizeSvg('<?xml version="1.0"?><svg><rect/></svg>', { removeDeclarations: false });
  expect(/<\?xml/i.test(keep.out), "removeDeclarations:false keeps the prolog");
}

console.log("\n── metadata + title/desc ────────────────────────────────");
{
  const r = optimizeSvg('<svg><metadata><rdf>junk</rdf></metadata><rect/></svg>');
  expect(r.ok && !/<metadata/i.test(r.out), "<metadata> block stripped");
  expect(r.removed.metadata === 1, "metadata count = 1");
  const kept = optimizeSvg('<svg><title>Logo</title><desc>brand mark</desc><rect/></svg>');
  expect(/<title>/.test(kept.out) && /<desc>/.test(kept.out), "title/desc KEPT by default (a11y)");
  const dropped = optimizeSvg('<svg><title>Logo</title><desc>brand mark</desc><rect/></svg>', { removeTitleDesc: true });
  expect(!/<title>/.test(dropped.out) && !/<desc>/.test(dropped.out), "title/desc dropped with the flag");
}

console.log("\n── editor-namespace cruft ───────────────────────────────");
{
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://inkscape" xmlns:sodipodi="http://sodipodi">'
    + '<sodipodi:namedview id="nv" inkscape:zoom="1.5"/>'
    + '<rect inkscape:label="layer1" x="1" y="1"/></svg>';
  const r = optimizeSvg(dirty);
  expect(r.ok && !/sodipodi:/i.test(r.out), "sodipodi element + attrs gone");
  expect(!/inkscape:/i.test(r.out), "inkscape attrs + xmlns gone");
  expect(r.removed.editorNs >= 3, "editorNs count reflects multiple removals");
  expect(/xmlns="http:\/\/www.w3.org\/2000\/svg"/.test(r.out), "the real SVG xmlns is preserved");
  expect(/<rect[^>]*x="1"/.test(r.out), "the rect (minus editor attr) survives");
}

console.log("\n── whitespace collapse ──────────────────────────────────");
{
  const r = optimizeSvg('<svg>\n    <g>\n        <rect x="1" y="1"/>\n    </g>\n</svg>');
  expect(r.ok && !/>\s*\n\s*</.test(r.out), "indentation between tags collapsed");
  expect(r.removed.whitespace > 0, "whitespace count > 0");
  // a lone significant space between inline tspans must NOT be eaten
  const inline = optimizeSvg('<svg><text><tspan>hello</tspan> <tspan>world</tspan></text></svg>');
  expect(inline.out.includes("</tspan> <tspan>"), "significant inline space between tspans preserved");
  // inner run of whitespace in a path collapses to single spaces
  const path = optimizeSvg('<svg><path d="M   0    0   L   10   10"/></svg>');
  expect(/d="M 0 0 L 10 10"/.test(path.out), "runs of whitespace inside a path attr collapsed");
}

console.log("\n── number rounding ──────────────────────────────────────");
{
  const r = optimizeSvg('<svg><path d="M0.123456 0.999 L10.5 10.00"/></svg>', { precision: 2 });
  expect(/M0.12 1 L10.5 10/.test(r.out), "coords rounded to 2dp, trailing zeros dropped");
  const p1 = optimizeSvg('<svg><rect x="1.23456" width="9.87654"/></svg>', { precision: 1 });
  expect(/x="1.2"/.test(p1.out) && /width="9.9"/.test(p1.out), "precision:1 honoured");
  // numbers in TEXT CONTENT must be untouched
  const txt = optimizeSvg('<svg><text x="1.23456">Price: 3.14159 USD</text></svg>');
  expect(txt.out.includes("Price: 3.14159 USD"), "numbers in text content are NOT rounded");
  expect(/x="1.23"/.test(txt.out), "but the x coordinate attr IS rounded");
}

console.log("\n── byte savings + pct ───────────────────────────────────");
{
  const dirty = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">\n'
    + '  <!-- exported from an editor -->\n  <metadata><rdf/></metadata>\n'
    + '  <path d="M0.100000 0.200000 L10.000000 10.000000"/>\n</svg>';
  const r = optimizeSvg(dirty);
  expect(r.savedBytes > 0, "savedBytes > 0 on a cruft-heavy input");
  expect(r.savedPct > 0 && r.savedPct <= 100, "savedPct is a sane percentage");
  expect(r.outBytes === Buffer.byteLength(r.out, "utf8"), "outBytes matches a UTF-8 byte count");
  expect(r.inBytes - r.outBytes === r.savedBytes, "inBytes - outBytes === savedBytes (arithmetic holds)");
}

console.log("\n── idempotence + round-trip safety ──────────────────────");
{
  const dirty = '<?xml version="1.0"?>\n<svg xmlns:inkscape="http://inkscape">\n  <!-- c -->\n  <metadata><x/></metadata>\n  <path inkscape:label="l" d="M0.123456 0.999   L10.500 10"/>\n</svg>';
  const once = optimizeSvg(dirty);
  const twice = optimizeSvg(once.out);
  expect(once.out === twice.out, "optimising twice === optimising once (idempotent)");
  expect(twice.savedBytes === 0, "second pass saves nothing (already minimal)");
  // a minimal valid svg round-trips without corruption
  const min = optimizeSvg("<svg><rect/></svg>");
  expect(min.ok && min.out.includes("<svg") && min.out.includes("<rect"), "minimal <svg><rect/></svg> round-trips intact");
  const uc = optimizeSvg('<svg><text x="1.5">café ☕ 日本</text></svg>');
  expect(uc.out.includes("café ☕ 日本"), "multibyte text content preserved byte-for-byte");
}

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
