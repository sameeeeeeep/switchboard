/** Provenance-tagged brand facts read server-side from a public website. Matches
 *  docs/BRAND-EXTRACTION.md §2.1 and packages/protocol rpc.ts `SbBrandResult`. */
export interface SbBrandResult {
  domain: string;
  siteName?: string;
  description?: string;
  platform?: string;
  currency?: string;
  ogImage?: string;
  /** Each colour records the CSS variable / source it came from. */
  palette: { hex: string; from: string }[];
  products: { short: string; price: number | null; type: string; url?: string }[];
  category?: string;
  priceRange?: { min: number; max: number };
  socials: { label: string; url: string }[];
  /** false ⇒ the site couldn't be read (dead / JS-only / bot-block / non-public URL) — HONEST,
   *  never guessed. The caller offers a different reader instead of fabricating. */
  reachable: boolean;
}

export interface SbBrandParams {
  url: string;
  name?: string;
}

/** Read a brand's public website into provenance-tagged facts. Server-to-server fetch (no CORS),
 *  deterministic parse (no model recall). */
export function extractBrand(params: SbBrandParams): Promise<SbBrandResult>;
