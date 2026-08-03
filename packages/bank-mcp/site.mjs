// Server-side site fetching for brand extraction — the SSRF/byte-budget guards + the fetch fan-out.
//
// The whole point of the brand extractor is that colours and products come from bytes the site
// actually served, never from a model's recollection. So the fetching lives HERE (a pure, side-
// effect-free module) and the raw text is handed to the pure parser in brand.mjs. Two consumers
// share this one implementation: the Bank connector (bank-mcp.mjs) and the daemon's `sb_brand`
// capability (packages/sidekick, via brand-extract.mjs) — a single fetching brain, no CORS, no
// forbidden-header stripping, exactly what the in-tab surfaces could never do.

// A URL reaches this tool from a model or a paste, so it must never be a lever onto the local network.
export const UA = "Mozilla/5.0 (compatible; SwitchboardBank/0.1; +https://github.com/sameeeeeeep/switchboard)";
export const MAX_BYTES = 4_000_000;
export const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|\[?::1\]?|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Reject anything that isn't a fetchable PUBLIC http(s) URL: no loopback, RFC-1918, link-local,
 *  `.local`/`.internal`, cloud-metadata, or bare hostnames. Returns a URL or null. */
export function safeUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${String(raw).trim()}`); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(h) || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return null;
  return u;
}

/** GET a page (or JSON), capped at MAX_BYTES and time-bounded. Returns null on any failure so the
 *  caller degrades to honest emptiness rather than throwing. */
export async function get(url, { timeoutMs = 20_000, json = false } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: json ? "application/json" : "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_BYTES);
    if (!json) return text;
    try { return JSON.parse(text); } catch { return null; } // a bot-block serves HTML here, not JSON
  } catch { return null; }
}

/** The full catalogue. `?limit=250` is what turns "the first 30" into everything. */
export async function fetchCatalog(origin) {
  const products = [];
  for (let page = 1; page <= 8; page++) {
    const j = await get(`${origin}/products.json?limit=250&page=${page}`, { json: true });
    const list = j && Array.isArray(j.products) ? j.products : null;
    if (!list || !list.length) break;
    products.push(...list);
    if (list.length < 250) break;
  }
  // Some storefronts bot-block the query-string form; the bare endpoint usually still answers.
  if (!products.length) {
    const j = await get(`${origin}/products.json`, { json: true });
    if (j && Array.isArray(j.products)) products.push(...j.products);
  }
  return { products };
}

/** Homepage + its same-origin stylesheets + the catalogue. Stylesheets matter for themes that don't
 *  inline their custom properties — without them the palette silently degrades to frequency guessing. */
export async function gatherSite(u) {
  const origin = u.origin;
  const html = await get(`${origin}/`);
  if (!html) return null;
  const hrefs = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)].map((m) => m[1]);
  const sheets = await Promise.all(
    hrefs.slice(0, 4).map(async (h) => {
      try {
        const abs = new URL(h, origin);
        if (abs.origin !== origin && !/(^|\.)shopify(cdn)?\.com$|cdn\.shopify\.com/.test(abs.hostname)) return "";
        return (await get(abs.href, { timeoutMs: 12_000 })) || "";
      } catch { return ""; }
    }),
  );
  return { html, css: sheets.join("\n"), catalog: await fetchCatalog(origin) };
}
