// The daemon-side brand extractor — the one function the `sb_brand` capability calls.
//
// It lifts the already-shipping, already-tested machinery verbatim: fetch server-to-server (site.mjs,
// no CORS, no forbidden-header stripping) and parse the returned bytes with the pure parser (brand.mjs,
// unit-tested in brand.test.mjs). No model is ever asked to RECALL a brand — colours come from the
// site's own CSS custom properties, products from /products.json, each fact provenance-tagged. This is
// the fix for the flaky in-tab "start from an existing brand": the tab could never fetch cross-origin.
//
// Result shape is docs/BRAND-EXTRACTION.md §2.1 (mirrored in packages/protocol rpc.ts SbBrandResult).
import { safeUrl, gatherSite } from "./site.mjs";
import { buildBrand } from "./brand.mjs";

/**
 * Read a brand's public website into provenance-tagged facts.
 * @param {{ url: string, name?: string }} params
 * @returns {Promise<import("./brand-extract.js").SbBrandResult>}
 */
export async function extractBrand({ url, name } = {}) {
  const u = safeUrl(url);
  // Not a fetchable public URL (loopback/RFC-1918/.local/bare host/bad scheme) — honest, never guessed.
  if (!u) return unreachable(url);

  const site = await gatherSite(u);
  // Dead, JS-only, or bot-blocked homepage — `reachable:false` is a FIRST-CLASS state (the UI offers
  // the repo/folder/paste reader instead of fabricating). Never fall through to a model.
  if (!site) return unreachable(u.origin);

  const b = buildBrand({ url: u.origin, html: site.html, css: site.css, productsJson: site.catalog, name });
  return {
    domain: b.domain,
    siteName: b.name || undefined,
    description: b.summary || undefined,
    platform: b.platform || undefined,
    currency: b.currency || undefined,
    ogImage: b.logo || undefined,
    // Provenance-tagged palette, straight from the served CSS (the variable it came from, else source).
    palette: (b.paletteRich || []).map((p) => ({ hex: p.hex, from: p.name || p.source || "css" })),
    products: (b.products || []).map((p) => ({ short: p.short, price: p.price ?? null, type: p.type || "", url: p.url || undefined })),
    category: b.catalog?.category || undefined,
    priceRange: b.catalog?.priceRange || undefined,
    socials: (b.links || []).filter((l) => l.label && l.label !== "site").map((l) => ({ label: l.label, url: l.url })),
    reachable: true,
  };
}

/** The honest empty reading. Every list is empty; `reachable:false` tells the caller to offer another
 *  reader (repo/folder/paste) rather than inventing hexes and SKUs. */
function unreachable(raw) {
  let domain = "";
  try { domain = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${String(raw)}`).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  return { domain, palette: [], products: [], socials: [], reachable: false };
}
