// Pure-logic tests for the Bank connector's brand extractor. Run: node brand.test.mjs
//
// These lock in the behaviour that the old model-guessed path got wrong. The fixtures are trimmed
// from real served markup (a Shopify Dawn-derived theme), because the failures that mattered —
// RGB-triplet custom properties, badge colours outranking the palette, "[object Object]" swatches —
// only show up against markup shaped like the real thing.
import assert from "node:assert/strict";
import {
  normalizeColor, isNeutral, colorDistance, rgbToHsl,
  extractColorSignals, rankPalette, extractPalette,
  parseMeta, parseSocialLinks, shortTitle, parseShopifyProducts, summarizeCatalog,
  buildBrand, brandToContext, brandToMarkdown, decodeEntities,
} from "./brand.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("  ✓", name); };
const top = (text, k = 5) => extractPalette(text, { max: k }).palette;

// ---- colour primitives ----

test("normalizeColor handles #rgb, #rrggbb, #rrggbbaa, rgb() and rgba()", () => {
  assert.equal(normalizeColor("#FFF"), "#ffffff");
  assert.equal(normalizeColor("#108474"), "#108474");
  assert.equal(normalizeColor("#108474ff"), "#108474");
  assert.equal(normalizeColor("rgb(196, 48, 28)"), "#c4301c");
  assert.equal(normalizeColor("rgba(196,48,28,0.5)"), "#c4301c");
  assert.equal(normalizeColor("notacolour"), null);
  assert.equal(normalizeColor(""), null);
});

test("isNeutral separates chrome from brand colour", () => {
  for (const c of ["#ffffff", "#000000", "#666666", "#cfcfcf"]) assert.equal(isNeutral(c), true, c);
  for (const c of ["#108474", "#c4301c", "#fed716", "#feb2c8"]) assert.equal(isNeutral(c), false, c);
});

test("rgbToHsl reports saturation for a mid-tone", () => {
  const { s, l } = rgbToHsl({ r: 16, g: 132, b: 116 });
  assert.ok(s > 0.7 && l > 0.2 && l < 0.4);
});

test("colorDistance collapses a shade ramp but keeps distinct colours apart", () => {
  assert.ok(colorDistance("#687c84", "#687c83") < 30);
  assert.ok(colorDistance("#108474", "#00584b") > 30);
});

// ---- signal extraction ----

test("Dawn-style RGB triplet custom properties are extracted (the default Shopify convention)", () => {
  const css = "--color-primary: 196,48,28; --color-button: 255,224,147;";
  const hexes = extractColorSignals(css).map((s) => s.hex);
  assert.ok(hexes.includes("#c4301c"), "missed --color-primary triplet");
  assert.ok(hexes.includes("#ffe093"), "missed --color-button triplet");
});

test("an out-of-range triplet is not mistaken for a colour", () => {
  assert.deepEqual(extractColorSignals("--grid-cols: 900,12,4;").map((s) => s.hex), []);
});

test("theme-color outranks everything else on the page", () => {
  const html = `<meta name="theme-color" content="#00584b"><style>${"a{color:#c4301c}".repeat(30)}</style>`;
  assert.equal(extractColorSignals(html)[0].hex, "#00584b");
});

test("a merchant-declared brand colour setting is a top-tier signal", () => {
  const html = `<script>{"judgeme_brand_color":"#108474"}</script><style>${".x{color:#c4301c}".repeat(10)}</style>`;
  const sig = extractColorSignals(html).find((s) => s.hex === "#108474");
  assert.equal(sig.source, "brand-setting");
  assert.equal(extractColorSignals(html)[0].hex, "#108474");
});

test("a text/ink role never outranks the real palette, even though it says 'button'", () => {
  // The regression: --color-button-text is the ink ON the button, not the brand colour.
  const css = "--color-button-text: 7,40,53; --color-primary: 196,48,28;";
  assert.equal(top(css)[0], "#c4301c");
});

test("badge and shade-ramp variables stay out of the palette", () => {
  const css = [
    "--color-badge-new: #64b7a6;", "--color-badge-coming-soon: #8d55cb;",
    "--color-foreground-lighten-19: #36515b;", "--color-primary: 196,48,28;",
  ].join("");
  assert.equal(top(css)[0], "#c4301c");
});

test("repetition is evidence but cannot swamp a stronger signal (diminishing returns)", () => {
  const css = `--color-primary: 196,48,28;${"--color-foreground-lighten-60: #5b767d;".repeat(60)}`;
  assert.equal(top(css)[0], "#c4301c");
});

test("near-duplicate shades collapse to one palette entry", () => {
  // Saturated near-twins, so this exercises dedupe rather than the neutral filter.
  const css = "--color-primary:#c4301c;--color-accent:#c5311d;--color-cta:#c33020;--color-button:#108474;";
  const p = top(css);
  assert.equal(p.filter((h) => colorDistance(h, "#c4301c") < 30).length, 1);
  assert.ok(p.includes("#108474"));
});

test("low-saturation theme greys are treated as chrome, not brand", () => {
  // #687c84 & friends are a Shopify shade ramp — they must not reach the palette when real colour exists.
  const css = "--color-foreground:#687c84;--color-subtext:#687c83;--color-primary:#c4301c;";
  assert.deepEqual(top(css), ["#c4301c"]);
});

test("a monochrome brand falls back to neutrals rather than returning an empty palette", () => {
  const p = top("--color-primary:#000000;--color-button:#ffffff;");
  assert.ok(p.length > 0);
  assert.ok(p.includes("#000000") || p.includes("#ffffff"));
});

test("rankPalette respects max and returns flat strings", () => {
  const sig = extractColorSignals("--a-primary:#c4301c;--b-primary:#fc3f75;--c-primary:#ffe093;");
  const out = rankPalette(sig, { max: 2 });
  assert.equal(out.length, 2);
  assert.ok(out.every((s) => typeof s.hex === "string"));
});

test("every palette entry carries its provenance", () => {
  const { rich } = extractPalette("--color-primary: 196,48,28;");
  assert.equal(rich[0].hex, "#c4301c");
  assert.equal(rich[0].source, "css-var");
  assert.equal(rich[0].name, "--color-primary");
});

// ---- page metadata ----

test("parseMeta reads the served identity and detects Shopify", () => {
  const html = `<title>nailinit | press-ons</title>
    <meta property="og:site_name" content="nailinit">
    <meta name="description" content="India&#39;s #1 press-ons">
    <meta property="og:image" content="https://nailin.it/cdn/shop/files/logo.png">
    <script>var x = {"currency":"INR"}</script>`;
  const m = parseMeta(html);
  assert.equal(m.siteName, "nailinit");
  assert.equal(m.description, "India's #1 press-ons");
  assert.equal(m.currency, "INR");
  assert.equal(m.platform, "shopify");
});

test("an empty theme-color does not become a colour (the nailin.it case)", () => {
  assert.equal(parseMeta('<meta name="theme-color" content="">').themeColor, "");
});

test("decodeEntities handles named and numeric entities", () => {
  assert.equal(decodeEntities("Ben &amp; Jerry&#39;s &#x2014; yes"), "Ben & Jerry's — yes");
});

test("parseSocialLinks dedupes by network and drops query strings", () => {
  const html = `<a href="https://instagram.com/nailinittt?hl=en">ig</a>
                <a href="https://www.instagram.com/nailinittt">ig2</a>
                <a href="https://example.com/blog">no</a>`;
  const links = parseSocialLinks(html);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0], { label: "instagram", url: "https://instagram.com/nailinittt" });
});

// ---- catalogue ----

test("shortTitle takes the human name out of an SEO-stuffed title", () => {
  assert.equal(shortTitle("Berry Bomb | Reusable Press-On Nails | 24 pcs | Almond"), "Berry Bomb");
  assert.equal(shortTitle("Gold Drip"), "Gold Drip");
});

const CATALOG = {
  products: [
    { title: "Berry Bomb | Press-On Nails | 24 pcs", handle: "berry-bomb", product_type: "Press-On Nails",
      tags: ["almond"], body_html: "<p>Ombre <b>berry</b> nails</p>",
      variants: [{ price: "449.00", available: true }], images: [{ src: "https://cdn/berry.jpg" }] },
    { title: "Gold Drip", handle: "gold-drip", product_type: "Press-On Nails", tags: "gold, luxe",
      variants: [{ price: "599.00", available: false }], images: [] },
    { title: "" }, // malformed rows are skipped, never rendered as blanks
  ],
};

test("parseShopifyProducts normalises the live catalogue", () => {
  const p = parseShopifyProducts(CATALOG, { origin: "https://nailin.it" });
  assert.equal(p.length, 2);
  assert.equal(p[0].short, "Berry Bomb");
  assert.equal(p[0].price, 449);
  assert.equal(p[0].url, "https://nailin.it/products/berry-bomb");
  assert.equal(p[0].blurb, "Ombre berry nails");
  assert.equal(p[0].available, true);
  assert.equal(p[1].available, false);
  assert.deepEqual(p[1].tags, ["gold", "luxe"]); // string tags split as well as array tags
});

test("parseShopifyProducts tolerates junk instead of throwing", () => {
  assert.deepEqual(parseShopifyProducts(null), []);
  assert.deepEqual(parseShopifyProducts({ products: "nope" }), []);
});

test("summarizeCatalog derives category and price band from the products themselves", () => {
  const s = summarizeCatalog(parseShopifyProducts(CATALOG), "INR");
  assert.equal(s.count, 2);
  assert.equal(s.category, "Press-On Nails");
  assert.deepEqual(s.priceRange, { min: 449, max: 599 });
  assert.equal(s.priceLabel, "INR 449–INR 599");
});

// ---- assembly + the published contract ----

const HTML = `<title>nailinit</title><meta property="og:site_name" content="nailinit">
  <meta name="description" content="Press-ons, delivered">
  <a href="https://instagram.com/nailinittt">ig</a>
  <style>:root{--color-primary: 196,48,28;--color-button: 255,224,147;--color-button-text: 7,40,53;}</style>
  <script>{"currency":"INR"}</script>`;

test("buildBrand assembles real colours and a real catalogue", () => {
  const b = buildBrand({ url: "https://nailin.it", html: HTML, productsJson: CATALOG });
  assert.equal(b.slug, "nailinit");
  assert.equal(b.domain, "nailin.it");
  assert.equal(b.currency, "INR");
  assert.equal(b.products.length, 2);
  assert.equal(b.catalog.category, "Press-On Nails");
  assert.equal(b.palette[0], "#c4301c");
  assert.ok(b.links.some((l) => l.label === "instagram"));
});

test("buildBrand falls back to the hostname and never invents a palette", () => {
  const b = buildBrand({ url: "https://example.com", html: "<html></html>" });
  assert.equal(b.name, "example.com");
  assert.deepEqual(b.palette, []);
  assert.deepEqual(b.products, []);
  assert.equal(b.summary, "");
});

test("brandToContext publishes FLAT palette + products (the docs/CONTEXT-KINDS contract)", () => {
  // The canonical bug this contract exists to prevent: swatch objects stringify to "[object Object]"
  // in every consumer that does el.style.background = c or palette.join(", ").
  const ctx = brandToContext(buildBrand({ url: "https://nailin.it", html: HTML, productsJson: CATALOG }));
  assert.equal(ctx.kind, "brand");
  assert.equal(ctx.id, "nailinit");
  assert.ok(ctx.data.palette.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c)));
  assert.ok(ctx.data.products.every((p) => typeof p === "string"));
  assert.equal(ctx.data.palette.join(", ").includes("[object Object]"), false);
  assert.deepEqual(ctx.data.products, ["Berry Bomb", "Gold Drip"]);
  // the structured forms ride ALONGSIDE, never instead of
  assert.equal(ctx.data.paletteRich[0].hex, "#c4301c");
  assert.equal(ctx.data.productsRich[0].title, "Berry Bomb | Press-On Nails | 24 pcs");
});

test("brandToContext keeps a stable id so re-extracting updates in place", () => {
  const once = brandToContext(buildBrand({ url: "https://nailin.it", html: HTML }));
  const twice = brandToContext(buildBrand({ url: "https://nailin.it", html: HTML }));
  assert.equal(once.id, twice.id);
});

test("brandToMarkdown renders a card with cited colours and real products", () => {
  const md = brandToMarkdown(buildBrand({ url: "https://nailin.it", html: HTML, productsJson: CATALOG }));
  assert.match(md, /^# nailinit\n/);
  assert.match(md, /> Press-ons, delivered/);
  assert.match(md, /\*\*catalogue:\*\* 2 products · INR 449–INR 599/);
  assert.match(md, /## Palette\n- `#c4301c` — --color-primary/);
  assert.match(md, /## Products\n- Berry Bomb — INR 449/);
  assert.match(md, /extracted from nailin\.it/);
});

test("brandToMarkdown omits sections it has no facts for", () => {
  const md = brandToMarkdown(buildBrand({ url: "https://example.com", html: "<html></html>" }));
  assert.equal(md.includes("## Palette"), false);
  assert.equal(md.includes("## Products"), false);
});

console.log(`\n${n} tests passed`);
