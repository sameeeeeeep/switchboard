// Pure brand-structuring for the Bank connector's extractor — the sibling of project.mjs. NO I/O:
// the caller fetches the raw artefacts (homepage HTML, stylesheets, /products.json) and hands the
// text here; this turns them into a `brand` context object and the `brand-<slug>.md` card Bank
// renders. Deterministic, so it's fully testable — and, more importantly, HONEST.
//
// Why this exists: the old path asked a model to "return the brand's REAL hex values from the site"
// while handing it only a summarised text rendering of the page. A model cannot see CSS, so it
// guessed — nailin.it came back with invented colours and no products at all. Everything below is
// parsed from bytes the site actually served. The model's only job downstream is to NAME what we
// found, never to supply it.
//
// The output shape is the `kind: "brand"` convention in docs/CONTEXT-KINDS.md — note especially that
// `palette` and `products` are FLAT strings (consumers do `el.style.background = c` and
// `palette.join(", ")`); the structured forms ride alongside as `paletteRich` / `productsRich`.

import { slugify } from "./project.mjs";

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// colour primitives
// ---------------------------------------------------------------------------

/** Any CSS colour literal → "#rrggbb", or null. Handles #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(). */
export function normalizeColor(raw) {
  const s = String(raw || "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (h.length === 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; // #rgba → drop alpha
    if (h.length === 6) return `#${h}`;
    if (h.length === 8) return `#${h.slice(0, 6)}`;                           // #rrggbbaa → drop alpha
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => clamp(Math.round(parseFloat(v)), 0, 255));
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

export const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/** HSL, so we can tell brand colour from chrome (grey/near-white/near-black). */
export function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4) / 6;
  return { h, s, l };
}

/** Chrome, not brand: greys, near-white, near-black. Kept as a separate step so a genuinely
 *  monochrome brand can fall back to them rather than ending up with an empty palette. */
export function isNeutral(hex, { satMin = 0.15, lightMax = 0.96, lightMin = 0.05 } = {}) {
  const { s, l } = rgbToHsl(hexToRgb(hex));
  return s < satMin || l > lightMax || l < lightMin;
}

/** Plain RGB euclidean distance — enough to collapse a theme's near-identical shade ramps
 *  (#687c84 / #687c83 / #687979) without merging genuinely distinct brand colours. */
export function colorDistance(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}

// A variable/property named for the brand outranks one named for a derived shade or a bit of UI
// furniture. This is what stops "--color-foreground-lighten-60" (repeated in every scheme block) from
// outvoting "--color-primary" purely on repetition, and keeps "--color-badge-new" out of the palette.
const STRONG_NAME = /\b(brand|primary|accent|logo|button|cta|highlight|theme|main)\b/;
const CHROME_NAME = /\b(background|foreground|surface|text|body|header|footer|page|input|card|field|subtext|heading)\b/;
const DERIVED_NAME =
  /(lighten|darken|shade|tint|alpha|opacity|shadow|overlay|border|muted|disabled|placeholder|hover|inverse|contrast|badge|soldout|sale|progress|bubble|bar|star|rating)/;

// "--color-button-text" is the ink ON the button, not the brand colour — the text/foreground ROLE has
// to beat the strong "button" token, or every theme's body copy ranks above its actual palette.
const TEXT_ROLE = /(^|[-_])(text|ink|foreground|heading)([-_]|$)/;

function nameWeight(name) {
  const n = String(name || "").toLowerCase();
  let w = TEXT_ROLE.test(n) ? 6 : STRONG_NAME.test(n) ? 60 : CHROME_NAME.test(n) ? 8 : 16;
  if (DERIVED_NAME.test(n)) w *= 0.15; // a derived ramp step is evidence of a colour, not the colour
  return w;
}

// Repetition is evidence, but a value repeated in 45 inline scheme blocks is not 45× the brand that a
// single explicit declaration is. Diminishing returns keeps a loud theme from drowning a clear signal.
const withRepeat = (base, count) => base * (1 + Math.log10(count));

/**
 * Every colour the served bytes actually contain, weighted by how much the source implies "brand".
 * Occurrences are counted per (hex, source, name) first, then weighted — so the ranking reflects how
 * a colour is USED, not merely how often it appears.
 */
export function extractColorSignals(text) {
  const src = String(text || "");
  const occ = new Map(); // `${hex}|${source}|${name}` → { hex, source, name, base, count }
  const bump = (raw, base, source, name = "") => {
    const hex = normalizeColor(raw);
    if (!hex || base <= 0) return;
    const key = `${hex}|${source}|${name}`;
    const cur = occ.get(key) || { hex, source, name, base, count: 0 };
    cur.count++;
    occ.set(key, cur);
  };

  // 1. <meta name="theme-color"> — the one place a site declares its colour outright.
  for (const m of src.matchAll(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']*)["']/gi)) {
    bump(m[1], 100, "theme-color", "theme-color");
  }
  // 2. A merchant explicitly configuring "my brand colour" in an app/theme setting is the single best
  //    signal on the page — it is a human declaring intent, not a stylesheet incidentally using a value.
  for (const m of src.matchAll(/["']([\w.-]*brand[\w.-]*colou?r[\w.-]*)["']\s*:\s*["'](#[0-9a-fA-F]{3,8})["']/gi)) {
    bump(m[2], 80, "brand-setting", m[1]);
  }
  // 3. CSS custom properties, hex form.
  for (const m of src.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]{5,60}\))/g)) {
    bump(m[2], nameWeight(m[1]), "css-var", `--${m[1]}`);
  }
  // 4. CSS custom properties, Dawn-style RGB triplets (`--color-primary: 196,48,28`) — the DEFAULT
  //    Shopify convention, consumed as rgba(var(--color-primary),1). Missing these misses the palette.
  for (const m of src.matchAll(/--([\w-]+)\s*:\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?=[;}"'\s])/g)) {
    const [r, g, b] = [m[2], m[3], m[4]].map(Number);
    if (r > 255 || g > 255 || b > 255) continue;
    bump(`rgb(${r},${g},${b})`, nameWeight(m[1]), "css-var", `--${m[1]}`);
  }
  // 5. Ordinary colour declarations.
  for (const m of src.matchAll(/(?:^|[;{\s"'])(background-color|background|color|fill|stroke|border-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]{5,60}\))/gi)) {
    bump(m[2], nameWeight(m[1]) / 2, "css-decl", m[1].toLowerCase());
  }
  // 6. Inline SVG (logos are frequently inlined).
  for (const m of src.matchAll(/\b(?:fill|stop-color|stroke)=["'](#[0-9a-fA-F]{3,8})["']/gi)) {
    bump(m[1], 20, "svg", "svg");
  }
  // 7. Bare frequency — the weakest vote, but it separates a one-off from a house colour.
  for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b/g)) bump(m[0], 1, "frequency");

  // Aggregate per colour, remembering the strongest single reason we believe in it (its provenance).
  const acc = new Map();
  for (const o of occ.values()) {
    const w = withRepeat(o.base, o.count);
    const cur = acc.get(o.hex) || { hex: o.hex, weight: 0, best: -1, source: o.source, name: o.name };
    cur.weight += w;
    if (o.base > cur.best) { cur.best = o.base; cur.source = o.source; cur.name = o.name; }
    acc.set(o.hex, cur);
  }
  return [...acc.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Signals → the brand palette. Drops chrome, collapses near-duplicate shades, keeps the strongest
 * representative of each distinct colour. Falls back to neutrals only if that would otherwise be empty
 * (a genuinely black-and-white brand still deserves its real colours).
 */
export function rankPalette(signals, { max = 5, minDistance = 30 } = {}) {
  const pick = (list) => {
    const out = [];
    for (const s of list) {
      if (out.length >= max) break;
      if (out.some((o) => colorDistance(o.hex, s.hex) < minDistance)) continue;
      out.push(s);
    }
    return out;
  };
  const branded = pick(signals.filter((s) => !isNeutral(s.hex)));
  return branded.length ? branded : pick(signals);
}

/** Convenience: raw served text → { palette (flat strings), rich ([{name?, hex, source}]) }. */
export function extractPalette(text, opts = {}) {
  const ranked = rankPalette(extractColorSignals(text), opts);
  return {
    palette: ranked.map((s) => s.hex),
    rich: ranked.map((s) => ({ hex: s.hex, source: s.source, ...(s.name ? { name: s.name } : {}) })),
  };
}

// ---------------------------------------------------------------------------
// page metadata
// ---------------------------------------------------------------------------

const metaRe = (attr, val) =>
  new RegExp(`<meta[^>]+(?:${attr})=["']${val}["'][^>]*content=["']([^"']*)["']`, "i");
const metaReRev = (attr, val) =>
  new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:${attr})=["']${val}["']`, "i");

function meta(html, val, attr = "property|name") {
  const a = metaRe(attr, val).exec(html) || metaReRev(attr, val).exec(html);
  return a ? oneLine(decodeEntities(a[1])) : "";
}

/** Enough HTML entity handling for titles and descriptions — not a full parser, deliberately. */
export function decodeEntities(s) {
  return String(s || "")
    .replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
      const t = e.toLowerCase();
      if (t === "amp") return "&";
      if (t === "lt") return "<";
      if (t === "gt") return ">";
      if (t === "quot") return '"';
      if (t === "apos" || t === "#39") return "'";
      if (t === "nbsp") return " ";
      if (t.startsWith("#x")) return String.fromCodePoint(parseInt(t.slice(2), 16));
      if (t.startsWith("#")) return String.fromCodePoint(parseInt(t.slice(1), 10));
      return m;
    });
}

/** The real, served identity of the page. Every field is absent rather than guessed. */
export function parseMeta(html) {
  const src = String(html || "");
  const titleTag = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(src);
  const currency =
    meta(src, "og:price:currency") ||
    (/["']?(?:currency|shopCurrency)["']?\s*:\s*["']([A-Z]{3})["']/.exec(src) || [])[1] ||
    "";
  return {
    siteName: meta(src, "og:site_name"),
    title: oneLine(decodeEntities(titleTag ? titleTag[1] : "")),
    description: meta(src, "og:description") || meta(src, "description"),
    ogImage: meta(src, "og:image:secure_url") || meta(src, "og:image"),
    themeColor: normalizeColor(meta(src, "theme-color")) || "",
    currency,
    platform: /cdn\.shopify\.com|Shopify\.theme|\/cdn\/shop\//.test(src) ? "shopify" : "",
  };
}

const SOCIAL = /^https?:\/\/(?:www\.)?(instagram|facebook|tiktok|youtube|twitter|x|linkedin|pinterest)\.com\/[^\s"'<>]+/i;

/** Real outbound social/profile links, deduped by network. Evidence, not inference. */
export function parseSocialLinks(html) {
  const seen = new Map();
  for (const m of String(html || "").matchAll(/href=["'](https?:\/\/[^"'\s]+)["']/gi)) {
    const s = SOCIAL.exec(m[1]);
    if (!s) continue;
    const net = s[1].toLowerCase();
    if (!seen.has(net)) seen.set(net, { label: net, url: m[1].split("?")[0] });
  }
  return [...seen.values()].slice(0, 6);
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

const stripHtml = (s) => oneLine(decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")));

/** "Berry Bomb | Reusable Press-On Nails | 24 pcs | Almond" → "Berry Bomb". Merchandising titles are
 *  keyword-stuffed for SEO; the leading segment is the name a human (or a prompt) actually wants. */
export function shortTitle(title) {
  const t = oneLine(title);
  const head = t.split(/\s*[|–—]\s*/)[0];
  return (head && head.length >= 2 ? head : t).slice(0, 80);
}

/**
 * Shopify /products.json → normalised products. This is the single highest-leverage fix: one
 * unauthenticated GET returns the whole catalogue the old extractor hallucinated around.
 */
export function parseShopifyProducts(json, { origin = "" } = {}) {
  const list = Array.isArray(json) ? json : Array.isArray(json && json.products) ? json.products : [];
  const out = [];
  for (const p of list) {
    if (!p || !p.title) continue;
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const prices = variants.map((v) => parseFloat(v && v.price)).filter((n) => Number.isFinite(n));
    const images = Array.isArray(p.images) ? p.images : [];
    out.push({
      title: oneLine(p.title),
      short: shortTitle(p.title),
      handle: String(p.handle || ""),
      type: oneLine(p.product_type || ""),
      tags: (Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",")).map(oneLine).filter(Boolean).slice(0, 8),
      price: prices.length ? Math.min(...prices) : null,
      available: variants.some((v) => v && v.available !== false),
      image: (images[0] && (images[0].src || images[0])) || "",
      url: origin && p.handle ? `${origin.replace(/\/$/, "")}/products/${p.handle}` : "",
      blurb: stripHtml(p.body_html).slice(0, 180),
    });
  }
  return out;
}

/** The catalogue's own summary — category and price band come from the products, not from a guess. */
export function summarizeCatalog(products, currency = "") {
  const prices = products.map((p) => p.price).filter((n) => Number.isFinite(n));
  const types = new Map();
  for (const p of products) if (p.type) types.set(p.type, (types.get(p.type) || 0) + 1);
  const ranked = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const money = (n) => `${currency ? `${currency} ` : ""}${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return {
    count: products.length,
    category: ranked[0] || "",
    types: ranked.slice(0, 6),
    priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    priceLabel: prices.length
      ? Math.min(...prices) === Math.max(...prices)
        ? money(Math.min(...prices))
        : `${money(Math.min(...prices))}–${money(Math.max(...prices))}`
      : "",
  };
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Build the structured brand from gathered artefacts. `html` should be the homepage plus any
 * stylesheets the caller fetched (concatenated); `productsJson` the raw /products.json payload.
 */
export function buildBrand(input = {}) {
  const { url = "", html = "", css = "", productsJson = null, name: nameHint, maxProducts = 60 } = input;
  const host = hostOf(url);
  const m = parseMeta(html);
  const { palette, rich } = extractPalette(`${html}\n${css}`);
  const products = parseShopifyProducts(productsJson, { origin: originOf(url) }).slice(0, maxProducts);
  const catalog = summarizeCatalog(products, m.currency);
  const name = oneLine(nameHint || m.siteName || titleBrand(m.title) || host || "Brand");

  return {
    slug: slugify(name),
    name,
    url: url || (host ? `https://${host}` : ""),
    domain: host,
    summary: m.description || "",
    platform: m.platform,
    currency: m.currency,
    logo: m.ogImage,
    palette,
    paletteRich: rich,
    products,
    catalog,
    links: [...(url ? [{ label: "site", url }] : []), ...parseSocialLinks(html)].slice(0, 7),
    fetchedAt: new Date().toISOString(),
  };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const originOf = (u) => { try { return new URL(u).origin; } catch { return ""; } };
// "nailinit — press-on nails, delivered" / "Shop | nailinit" → the brand-ish part of a <title>.
const titleBrand = (t) => oneLine(String(t || "").split(/\s*[|–—:]\s*/)[0]);

/**
 * The portable `kind: "brand"` context (docs/CONTEXT-KINDS.md). `palette` and `products` are FLAT
 * strings because every shipping consumer applies them directly — publishing swatch objects here is
 * the canonical bug this contract exists to prevent. Structured forms ride alongside.
 */
export function brandToContext(b) {
  const flatProducts = [...new Set(b.products.map((p) => p.short).filter(Boolean))].slice(0, 24);
  return {
    id: b.slug,
    name: b.name,
    kind: "brand",
    data: {
      positioning: b.summary,
      palette: b.palette,
      ...(b.paletteRich.length ? { paletteRich: b.paletteRich.map(({ hex, name }) => ({ hex, ...(name ? { name } : {}) })) } : {}),
      products: flatProducts,
      ...(b.products.length ? { productsRich: b.products.map((p) => ({ title: p.title, price: p.price, url: p.url, image: p.image })) } : {}),
      ...(b.catalog.category ? { category: b.catalog.category } : {}),
      ...(b.catalog.priceLabel ? { priceRange: b.catalog.priceLabel } : {}),
      ...(b.domain ? { domain: b.domain } : {}),
      ...(b.logo ? { logo: b.logo } : {}),
    },
  };
}

const bullets = (a) => a.map((x) => `- ${x}`).join("\n");

/** Render `brand-<slug>.md` — the file Bank shows as a brand card, and Obsidian shows as a note. */
export function brandToMarkdown(b) {
  const sec = (title, body) => (body && body.trim() ? `\n## ${title}\n${body}\n` : "");
  const metaRows = [
    b.domain && `- **site:** ${b.url}`,
    b.catalog.count && `- **catalogue:** ${b.catalog.count} product${b.catalog.count === 1 ? "" : "s"}${b.catalog.priceLabel ? ` · ${b.catalog.priceLabel}` : ""}`,
    b.catalog.category && `- **category:** ${b.catalog.category}`,
    b.platform && `- **platform:** ${b.platform}`,
    ...b.links.filter((l) => l.label !== "site").map((l) => `- **${l.label}:** ${l.url}`),
  ].filter(Boolean).join("\n");

  const palette = b.paletteRich
    .map((p) => `- \`${p.hex}\`${p.name ? ` — ${p.name}` : ""} _(${p.source})_`)
    .join("\n");
  const products = b.products.slice(0, 30)
    .map((p) => `- ${p.short}${p.price != null ? ` — ${b.currency ? `${b.currency} ` : ""}${p.price}` : ""}`)
    .join("\n");

  return (
    `# ${b.name}\n\n` +
    (b.summary ? `> ${b.summary}\n\n` : "") +
    (metaRows ? `${metaRows}\n` : "") +
    sec("Palette", palette) +
    sec("Products", products) +
    (b.products.length > 30 ? `\n_…and ${b.products.length - 30} more._\n` : "") +
    `\n<!-- extracted from ${b.domain || b.url} on ${b.fetchedAt.slice(0, 10)} — colours parsed from served CSS, products from the live catalogue -->\n`
  );
}
