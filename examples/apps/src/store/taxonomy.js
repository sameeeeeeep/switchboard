// Store taxonomy — the category spine of the directory. CATALOG-adjacent design data (fixed, keyed
// by catalog id), never user data. The sidebar renders one row per category with a tinted glyph +
// a right-aligned count computed at runtime from APPS; landing pages read their accent from the
// category family so a wrapp's colour matches where it lives in the store.
import { FAM, G } from "./glyphs.js";

// Sidebar order (top to bottom). Seven rows: the six founder labels + a catalog-backed
// "Validate an idea" row, because the six ideabrain template presets form a real, already-sectioned
// group. Every assignment below is defensible from the wrapp's own source + its store section.
export const CATEGORIES = [
  "Brand & content",
  "Validate an idea",
  "Ads & growth",
  "Creative",
  "Commerce",
  "Viral",
  "Play & make",
  "After hours",
];

// id → category. Covers all 42 catalog ids (order matches the grid sections in index.html).
export const CATEGORY_OF = {
  brandbrain: "Brand & content", bank: "Brand & content", redline: "Brand & content",
  marquee: "Brand & content", chat: "Brand & content",

  ideabrain: "Validate an idea", mkt: "Validate an idea", capp: "Validate an idea",
  saas: "Validate an idea", retail: "Validate an idea", hardware: "Validate an idea",
  feature: "Validate an idea",

  adpulse: "Ads & growth", adforge: "Ads & growth", adgen: "Ads & growth",
  aplus: "Ads & growth", batch: "Ads & growth",

  identity: "Creative", prism: "Creative", reel: "Creative", cast: "Creative",

  studio: "Commerce", shelf: "Commerce",

  // the viral drop — dupes of the AI tools people keep sharing, each on the /wrapp template
  arcade: "Viral", yearbook: "Viral", toon: "Viral", storybook: "Viral",
  petrait: "Viral", emote: "Viral", inkling: "Viral", roomify: "Viral",
  thumbs: "Viral", meme: "Viral", roast: "Viral", rizz: "Viral",
  anthem: "Viral", dreamlog: "Viral",

  take: "Play & make", cartridge: "Play & make", huddle: "Play & make",

  natal: "After hours", arcana: "After hours",
};

// Category chrome: which family tint + glyph shape the sidebar row and the landing accent use.
export const CAT_META = {
  "Brand & content": { fam: "green", glyph: G.layers },
  "Validate an idea": { fam: "blue", glyph: G.bulb },
  "Ads & growth": { fam: "gold", glyph: G.chart },
  "Creative": { fam: "pink", glyph: G.camera },
  "Commerce": { fam: "gold", glyph: G.box },
  "Viral": { fam: "pink", glyph: G.flame },
  "Play & make": { fam: "violet", glyph: G.play },
  "After hours": { fam: "violet", glyph: G.moon },
};

// A one-line descriptor per category — used on the sidebar tooltip and section subheads.
export const CATEGORY_BLURB = {
  "Brand & content": "brand systems, the knowledge bank, copy review",
  "Validate an idea": "ideabrain, opened to your kind of idea",
  "Ads & growth": "analyse, generate, and post the growth work",
  "Creative": "personas, images, reels — on your own models",
  "Commerce": "inventory and product photography",
  "Viral": "dupes of the tools people can't stop sharing",
  "Play & make": "record, build, and get on a call",
  "After hours": "the fun ones",
};

export const categoryOf = (id) => CATEGORY_OF[id] || "Brand & content";

/** The FAM object ({ ink, soft, light }) for a category — the landing accent for any wrapp in it. */
export const categoryFam = (cat) => FAM[(CAT_META[cat] || {}).fam] || FAM.teal;

/** Inline SVG markup for a category's chrome glyph (stroke:currentColor). */
export function categoryGlyphSvg(cat) {
  const glyph = (CAT_META[cat] || {}).glyph || G.layers;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
}

/** { category: count } over a list of catalog apps. */
export function categoryCounts(apps) {
  const c = {};
  for (const a of apps) { const k = categoryOf(a.id); c[k] = (c[k] || 0) + 1; }
  return c;
}
