// SEAM SHIM · deterministic site read. Replaces brandbrain's `@/lib/extract` (server-side fetch of
// the brand's homepage/CSS/catalogue) for the BROWSER port, where the same code is CORS-dead: a
// cross-origin fetch of nailin.it (or any brand site) is blocked by the browser, so `readBrandSite`
// silently returned null on every clone/import and the "fetch website" entry ran blind — no real
// palette, no real catalogue, model recall only.
//
// The daemon already holds the server-side twin of this extractor (`sb_brand`, backed by
// @relay/bank-mcp/brand-extract.mjs — the module lib/extract.ts is itself a port of). So here the
// read is one provider call: same parser, same provenance discipline, no CORS. The pure helpers the
// clone route also imports (factsForPrompt, colorDistance) are reproduced verbatim from lib/extract.
import { getProvider, whenProvider } from "../../adapter/claude.mjs";

const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

/** Verbatim from brandbrain lib/extract.ts — used by the clone route to reconcile palettes. */
export function colorDistance(a, b) {
  const x = rgb(a), y = rgb(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}

/** sb_brand's SbBrandResult → brandbrain's BrandFacts. The shapes are siblings (both descend from
 *  bank-mcp's extractor); products carry less detail over the wire (no title/handle/image), so the
 *  short name stands in for the title — factsForPrompt and the clone response only use short/price/type. */
function toBrandFacts(r) {
  if (!r || r.reachable === false) return null;
  return {
    domain: r.domain,
    siteName: r.siteName || undefined,
    description: r.description || undefined,
    currency: r.currency || undefined,
    platform: r.platform || undefined,
    ogImage: r.ogImage || undefined,
    palette: Array.isArray(r.palette) ? r.palette : [],
    products: (Array.isArray(r.products) ? r.products : []).map((p) => ({
      title: p.short,
      short: p.short,
      handle: "",
      type: p.type || "",
      price: typeof p.price === "number" ? p.price : null,
      available: true,
      url: p.url || undefined,
    })),
    category: r.category || undefined,
    priceRange: r.priceRange || undefined,
    socials: Array.isArray(r.socials) ? r.socials : [],
  };
}

/** Read a brand off its live site via the daemon (no CORS). Null when there's no provider yet or the
 *  site is honestly unreachable — the clone route already handles null with its model fallback. */
export async function readBrandSite(rawUrl) {
  const provider = getProvider() || (await whenProvider());
  if (!provider) return null;
  try {
    const r = await provider.request({ method: "sb_brand", params: { url: String(rawUrl || "") } });
    return toBrandFacts(r);
  } catch {
    return null;
  }
}

/** Verbatim from brandbrain lib/extract.ts — the observed facts rendered as prompt ground truth. */
export function factsForPrompt(f) {
  const lines = [];
  lines.push(`OBSERVED FACTS — read directly from ${f.domain} just now. These are ground truth: use them exactly, do not replace them with your own recollection of this brand.`);
  if (f.siteName) lines.push(`- Site name: ${f.siteName}`);
  if (f.description) lines.push(`- Site description: ${f.description}`);
  if (f.platform) lines.push(`- Platform: ${f.platform}`);
  if (f.palette.length) {
    lines.push(`- REAL brand colours, parsed from the site's served CSS (use EXACTLY these hexes, in this order; your only job is to give each a colour name):`);
    for (const p of f.palette) lines.push(`    ${p.hex}  (declared as ${p.from})`);
  } else {
    lines.push(`- No brand colours could be parsed from the served CSS. Return an EMPTY palette rather than guessing.`);
  }
  if (f.products.length) {
    const cur = f.currency ? `${f.currency} ` : "";
    lines.push(`- REAL catalogue: ${f.products.length} products${f.category ? ` · category "${f.category}"` : ""}${f.priceRange ? ` · prices ${cur}${f.priceRange.min}–${cur}${f.priceRange.max}` : ""}. Build "range", "format" and "pricing" from THESE, never from invented SKUs:`);
    for (const p of f.products.slice(0, 40)) lines.push(`    ${p.short}${p.price != null ? ` — ${cur}${p.price}` : ""}${p.type ? ` [${p.type}]` : ""}`);
    if (f.products.length > 40) lines.push(`    …and ${f.products.length - 40} more`);
  } else {
    lines.push(`- No public catalogue was reachable. Do not invent SKUs or prices; omit them instead.`);
  }
  if (f.socials.length) lines.push(`- Socials: ${f.socials.map((s) => s.url).join(", ")}`);
  return lines.join("\n");
}
