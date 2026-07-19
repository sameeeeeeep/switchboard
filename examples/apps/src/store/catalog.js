// Store catalog metadata — one entry per wrapp on the shelf. This is CATALOG data (public, the
// same for every visitor), never user data. Build-cost numbers are DEVELOPER-REPORTED until the
// creator pipeline starts printing broker-metered receipts (docs/TOKENS.md honesty law #3 — which
// is exactly why every badge carries the `dev-reported` tag instead of posing as a measurement).
// `pro` lists the pro-tier features per the Free/Pro split rubric: free = the complete core loop,
// pro = batch/automation/depth on top. `pro: null` means the wrapp is free-only today.

export const APPS = [
  // featured
  { id: "brandbrain", name: "brandbrain", href: "https://brandbrain.thelastprompt.ai/build",
    tokens: 4_800_000, updates: 61, pro: ["multi-brand portfolio", "competitor war-room refresh"] },
  { id: "ideabrain", name: "ideabrain", href: "https://brandbrain.thelastprompt.ai/build?studio=idea",
    tokens: 3_400_000, updates: 42, pro: ["multi-thesis compare", "investor-grade deck packs"] },
  { id: "bank", name: "Bank", href: "https://bank.thelastprompt.ai",
    tokens: 2_900_000, updates: 38, pro: ["recurring extractors", "cross-vault syntheses"] },

  // validate an idea (ideabrain templates — free-only presets)
  { id: "mkt", name: "Marketplace Validator", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=marketplace",
    tokens: 260_000, updates: 8, pro: null },
  { id: "capp", name: "Consumer App Planner", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=app",
    tokens: 230_000, updates: 7, pro: null },
  { id: "saas", name: "SaaS Thesis", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=saas",
    tokens: 240_000, updates: 7, pro: null },
  { id: "retail", name: "Retail Concept", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=retail",
    tokens: 210_000, updates: 6, pro: null },
  { id: "hardware", name: "Hardware Reality Check", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=hardware",
    tokens: 220_000, updates: 6, pro: null },
  { id: "feature", name: "Feature Case", href: "https://brandbrain.thelastprompt.ai/build?studio=idea&template=feature",
    tokens: 190_000, updates: 5, pro: null },

  // the founder stack
  { id: "adpulse", name: "AdPulse", href: "https://adpulse.thelastprompt.ai",
    tokens: 1_400_000, updates: 22, pro: ["scheduled post-mortems", "multi-account rollups"] },
  { id: "adforge", name: "AdForge", href: "https://adforge.thelastprompt.ai",
    tokens: 2_100_000, updates: 34, pro: ["multi-variant matrices", "competitor-reactive refresh"] },
  { id: "shelf", name: "Shelf", href: "https://shelf.thelastprompt.ai",
    tokens: 860_000, updates: 14, pro: ["reorder automation", "supplier lead-time watch"] },
  { id: "studio", name: "Studio", href: "https://studio.thelastprompt.ai",
    tokens: 940_000, updates: 16, pro: ["batch shot lists", "white-label exports"] },
  { id: "aplus", name: "A-Plus", href: "https://aplus.thelastprompt.ai",
    tokens: 1_100_000, updates: 18, pro: ["bulk listing runs", "variant A/B stacks"] },
  { id: "batch", name: "Batch", href: "https://batch.thelastprompt.ai",
    tokens: 340_000, updates: 3, pro: null },
  { id: "take", name: "Take", href: "https://take.thelastprompt.ai",
    tokens: 120_000, updates: 2, pro: null },
  { id: "identity", name: "Identity", href: "https://identity.thelastprompt.ai",
    tokens: 180_000, updates: 2, pro: null },
  { id: "reel", name: "Reel", href: "https://reel.thelastprompt.ai",
    tokens: 260_000, updates: 2, pro: ["batch reels", "brand-kit auto-scenes"] },
  { id: "marquee", name: "Marquee", href: "https://marquee.thelastprompt.ai",
    tokens: 300_000, updates: 2, pro: ["multi-page sites", "publish to a domain"] },
  { id: "huddle", name: "Huddle", href: "https://huddle.thelastprompt.ai",
    tokens: 150_000, updates: 1, pro: null },

  // after hours
  { id: "natal", name: "NATAL", href: "https://natal.thelastprompt.ai",
    tokens: 480_000, updates: 9, pro: null },
  { id: "arcana", name: "Arcana", href: "https://arcana.thelastprompt.ai",
    tokens: 390_000, updates: 7, pro: null },

  // play & make
  { id: "redline", name: "Redline", href: "https://redline.thelastprompt.ai",
    tokens: 1_700_000, updates: 26, pro: ["whole-site crawls", "scheduled re-reviews + diffs"] },
  { id: "cartridge", name: "Cartridge", href: "https://cartridge.thelastprompt.ai",
    tokens: 720_000, updates: 12, pro: null },
  { id: "cast", name: "Cast", href: "https://cast.thelastprompt.ai",
    tokens: 1_300_000, updates: 21, pro: ["multi-persona rosters", "reel batching"] },
  { id: "prism", name: "Prism", href: "https://prism.thelastprompt.ai",
    tokens: 310_000, updates: 8, pro: null },
  { id: "adgen", name: "Adwall", href: "https://adgen.thelastprompt.ai",
    tokens: 540_000, updates: 11, pro: null },
];

// PARKED — the 14 one-off wrapps, trimmed from the shelf until each has its own subdomain
// (per-origin isolation: a shared path would mean one grant + one storage partition for all of
// them). Re-shelving one = move its entry back into APPS and restore its card in index.html.
export const PARKED = [
  { id: "arcade", name: "Arcade", href: "./arcade.html",
    tokens: 185_000, updates: 3, pro: null },
  { id: "yearbook", name: "Yearbook", href: "./yearbook.html",
    tokens: 165_000, updates: 1, pro: null },
  { id: "toon", name: "Toon", href: "./toon.html",
    tokens: 176_000, updates: 1, pro: null },
  { id: "storybook", name: "Storybook", href: "./storybook.html",
    tokens: 215_000, updates: 1, pro: null },
  { id: "petrait", name: "Petrait", href: "./petrait.html",
    tokens: 142_000, updates: 1, pro: null },
  { id: "emote", name: "Emote", href: "./emote.html",
    tokens: 172_000, updates: 1, pro: null },
  { id: "inkling", name: "Inkling", href: "./inkling.html",
    tokens: 158_000, updates: 1, pro: null },
  { id: "roomify", name: "Roomify", href: "./roomify.html",
    tokens: 165_000, updates: 1, pro: null },
  { id: "thumbs", name: "Thumbs", href: "./thumbs.html",
    tokens: 165_000, updates: 1, pro: null },
  { id: "meme", name: "Meme", href: "./meme.html",
    tokens: 208_000, updates: 1, pro: null },
  { id: "roast", name: "Roast", href: "./roast.html",
    tokens: 128_000, updates: 1, pro: null },
  { id: "rizz", name: "Rizz", href: "./rizz.html",
    tokens: 128_000, updates: 1, pro: null },
  { id: "anthem", name: "Anthem", href: "./anthem.html",
    tokens: 165_000, updates: 1, pro: null },
  { id: "dreamlog", name: "Dreamlog", href: "./dreamlog.html",
    tokens: 168_000, updates: 1, pro: null },
];


export const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));

/** 2_100_000 → "2.1M", 860_000 → "860K" — badge-friendly, tabular-nums does the rest. */
export function fmtTok(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(n);
}
