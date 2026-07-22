// Two seeded "projects" (Switchboard, NailInit) the wrapp test-harness lends to every wrapp.
//
// Each project is really a small BUNDLE of contexts — a brand, a persona, a personal card, and a
// project (work-unit) — all derived from the same company, so that whichever KIND a given wrapp
// filters for (brand-consumers, Cast/persona, NATAL/personal, Bank/project) finds a real match.
// `context.active()` returns the BRAND facet (the common case); `context.list()` returns metadata
// for all facets; `context.use(id)` / `pick()` resolve any of them in full. Field shapes follow
// docs/CONTEXT-KINDS.md exactly (flat `palette` strings, `products` as strings, etc.) so the same
// data a wrapp would get from the real broker is what it gets here.
//
// Deliberately CONTRASTING: Switchboard is a B2B developer-tool / AI-infra marketplace; NailInit is a
// B2C physical-product beauty DTC brand. Running every wrapp against both is the point — the report
// shows how each wrapp reshapes itself to a technical vs. a consumer brand.

const now = Date.now();

// ————————————————————————————————————————————————————————————————————————————————————————————
// SWITCHBOARD — the product itself (dogfooding): an app store where apps run on the visitor's Claude.
// ————————————————————————————————————————————————————————————————————————————————————————————
const SWITCHBOARD = {
  id: "switchboard",
  label: "Switchboard",
  blurb: "B2B developer-tool / AI marketplace (the product itself)",
  brand: {
    id: "switchboard", name: "Switchboard", kind: "brand", publishedBy: "harness", updatedAt: now,
    data: {
      voice: "Technical, candid, anti-hype — talks to builders like peers, never markets at them.",
      positioning: "The app store where every app runs on the visitor's own Claude and connectors — developers ship the wrapper, users bring the compute.",
      audience: "Indie developers, technical founders, and small agencies who already pay for Claude and want to ship AI apps without paying for inference.",
      palette: ["#0B0B0F", "#5B8CFF", "#E8E8F0", "#FF7A45"],
      paletteRich: [
        { name: "Ink", hex: "#0B0B0F" },
        { name: "Relay blue", hex: "#5B8CFF" },
        { name: "Signal", hex: "#E8E8F0" },
        { name: "Consent orange", hex: "#FF7A45" },
      ],
      products: ["Switchboard Pro subscription", "Relay SDK", "Browser extension + local daemon", "The wrapp App Store"],
      range: ["Switchboard Pro subscription", "Relay SDK", "Browser extension + local daemon"],
      styles: ["product-ui", "developer", "dark-mode", "diagram"],
      keywords: ["BYO-compute", "local-first", "consent broker", "MCP", "no API keys"],
      tagline: "Bring your own Claude.",
      url: "https://thelastprompt.ai/switchboard/",
    },
  },
  personal: {
    id: "switchboard-me", name: "Sameep", kind: "personal", publishedBy: "panel", updatedAt: now,
    data: {
      fullName: "Sameep Rehlan", email: "sameep@stayoften.com", company: "Switchboard",
      role: "Founder / maintainer",
      notes: "Open source, MIT-licensed. Support via GitHub issues. No cloud account required to run it.",
    },
  },
  persona: {
    id: "switchboard-persona", name: "The Builder", kind: "persona", publishedBy: "harness", updatedAt: now,
    data: {
      voice: "Technical, candid, anti-hype — talks to builders like peers.",
      positioning: "A developer advocate who ships real code on camera and refuses to hand-wave.",
      niche: "developer tools & local-first AI",
      audience: "Devs who want to build AI apps without paying for inference.",
      palette: ["#0B0B0F", "#5B8CFF", "#E8E8F0"],
      inspirations: ["fireship", "theo"],
    },
  },
  project: {
    id: "switchboard-repo", name: "Switchboard", kind: "project", publishedBy: "harness", updatedAt: now,
    data: {
      summary: "BYO-Claude broker — a local sidekick brokers your model + tools to any site, per-origin and consent-gated.",
      status: "v0.1.3 · MIT",
      stack: ["TypeScript", "esbuild", "MCP", "Chrome MV3", "Swift (menubar)"],
      packages: ["sdk", "sidekick", "protocol", "extension", "menubar", "bank-mcp"],
      wrapps: ["bank", "imagegen", "adgen", "cast", "redline", "shelf", "studio"],
      roadmap: ["Ship the wrapp store dashboard", "Local-model backends (Ollama)", "WebMCP two-way tools"],
      docs: ["Design — docs/DESIGN.md", "Capabilities — docs/CAPABILITIES.md", "Tokens — docs/TOKENS.md"],
      links: [{ label: "repo", url: "https://github.com/sameeeeeeep/switchboard" }],
      tasks: ["Wire the Bank connector into the daemon", "Rev-share metering receipts"],
    },
  },
  // The one FILE on disk in the bound folder — a real landing page for page-reviewing wrapps
  // (Redline audits it; Huddle lists it as a project file). Deliberately imperfect: a vague hero,
  // a weak CTA, an <img> with no alt, and a nav link to nowhere — so an audit has real findings
  // to pin rather than inventing praise. See provider.js storageOp().
  // Restructured for CUT: five tall top-level blocks with distinct backdrops and section ids, an
  // <img> mid-page, and the canned audit's exact slop sentences planted as REAL copy — so audit
  // findings finally ANCHOR (pins + timeline chips + validated pre-seeded fixes), the ⧖ entrance
  // chips have boundaries to sit on, the media element block appears, and entrance edits can be
  // real `<section id="…"` attribute rewrites. Audit-bait kept: dead "#" nav link, alt-less img,
  // weak "Learn more" CTA.
  page: {
    key: "index.html",
    html: [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<title>Switchboard</title>',
      '<style>header,section{min-height:420px;padding:48px 24px}footer{min-height:200px;padding:40px 24px}h1{font-size:40px}</style>',
      '</head><body style="margin:0;font-family:system-ui,sans-serif">',
      '<nav><a href="/">Switchboard</a><a href="/docs">Docs</a><a href="#">Pricing</a></nav>',
      '<header id="s-hero" style="background:#0b0d10;color:#e8edf4">',
      '<h1>The future of AI apps is here</h1>',
      '<p>We seamless your workflow with next-gen synergy.</p>',
      '<p>Switchboard is a platform for the next generation of intelligent applications.</p>',
      '<a href="/signup">Learn more</a></header>',
      '<section id="s-product" style="background:#101623;color:#dfe6f2">',
      '<h2>One connection, every app</h2>',
      '<p>We unleash your workflow with next-gen synergy.</p>',
      '<img src="/hero.png" width="640" height="360"></section>',
      '<section id="s-features" style="background:#0d1117;color:#d7dee8">',
      '<h2>Features</h2>',
      '<p>We empower your workflow with next-gen synergy.</p>',
      '<ul><li>Runs on your own Claude</li><li>No API keys</li><li>Per-origin consent</li></ul></section>',
      '<section id="s-pricing" style="background:#131a26;color:#e2e8f0">',
      '<h2>Pricing</h2>',
      '<p>We elevate your workflow with next-gen synergy.</p>',
      '<a href="#">Start free</a></section>',
      '<footer id="s-footer" style="background:#08090c;color:#9aa4b5">',
      '<p>We game-changing your workflow with next-gen synergy.</p>',
      '<p>MIT licensed. Built by Sameep.</p></footer>',
      '</body></html>',
    ].join("\n"),
  },
};

// ————————————————————————————————————————————————————————————————————————————————————————————
// NAILINIT — a B2C press-on nails & at-home nail-care DTC brand (contrasting consumer product).
// ————————————————————————————————————————————————————————————————————————————————————————————
const NAILINIT = {
  id: "nailinit",
  label: "NailInit",
  blurb: "B2C beauty DTC — press-on nails & at-home nail-care",
  brand: {
    id: "nailinit", name: "NailInit", kind: "brand", publishedBy: "harness", updatedAt: now,
    data: {
      voice: "Playful, warm, a little bold — hype-girl energy without the cringe.",
      positioning: "Salon-quality press-on nails and at-home nail-care kits — designed in-house, shipped direct, no appointment and no two-hour wait.",
      audience: "Gen-Z and millennial women who love a fresh manicure but not the salon price or the wait.",
      palette: ["#F7C9D9", "#C0446B", "#F4ECE2", "#2B2B2B", "#C7CBD1"],
      paletteRich: [
        { name: "Blush", hex: "#F7C9D9" },
        { name: "Magenta pop", hex: "#C0446B" },
        { name: "Cream", hex: "#F4ECE2" },
        { name: "Ink", hex: "#2B2B2B" },
        { name: "Chrome", hex: "#C7CBD1" },
      ],
      products: ["Press-on nail sets", "Brush-on nail glue", "Cuticle oil pen", "At-home starter kit", "Chrome powder", "Nail prep kit"],
      range: ["Press-on nail sets", "Brush-on nail glue", "Cuticle oil pen", "At-home starter kit", "Chrome powder"],
      styles: ["packshot", "lifestyle", "hand-model", "flatlay"],
      keywords: ["press-ons", "at-home mani", "reusable", "10-minute", "salon-quality"],
      tagline: "Your nails, done in ten.",
      url: "https://nailinit.example",
      // richer commerce fields some wrapps (Shelf, A-Plus) reach for; ignored by brand-normalizers.
      inventory: [
        { sku: "PO-ALMOND-01", name: "Almond blush press-ons", stock: 42, reorderAt: 20, moq: 500, leadDays: 28, cost: 1.9, price: 14 },
        { sku: "GLUE-BR-02", name: "Brush-on nail glue 5ml", stock: 8, reorderAt: 30, moq: 1000, leadDays: 21, cost: 0.4, price: 6 },
        { sku: "OIL-PEN-01", name: "Cuticle oil pen", stock: 120, reorderAt: 40, moq: 1000, leadDays: 24, cost: 0.7, price: 9 },
        { sku: "KIT-START-01", name: "At-home starter kit", stock: 15, reorderAt: 25, moq: 300, leadDays: 30, cost: 3.4, price: 29 },
        { sku: "CHROME-PWD-03", name: "Chrome powder — mirror", stock: 3, reorderAt: 15, moq: 500, leadDays: 26, cost: 0.9, price: 11 },
      ],
      vendors: [
        { name: "Yiwu Meili Cosmetics", product: "press-on sets", moq: 500, unit: 1.9, leadDays: 28, terms: "30% deposit, 70% before ship" },
        { name: "Guangzhou NailPro", product: "glue & oil", moq: 1000, unit: 0.5, leadDays: 21, terms: "T/T, net 0" },
      ],
    },
  },
  personal: {
    id: "nailinit-me", name: "Sameep", kind: "personal", publishedBy: "panel", updatedAt: now,
    data: {
      fullName: "Sameep Rehlan", email: "sameep@stayoften.com", phone: "+91 98xxxxxx21",
      company: "NailInit", address: "Unit 4, Andheri East, Mumbai 400069, India",
      notes: "GSTIN 27ABCDE1234F1Z5. Support hours 10–6 IST. Ships across India + US.",
    },
  },
  persona: {
    id: "nailinit-persona", name: "Mia", kind: "persona", publishedBy: "harness", updatedAt: now,
    data: {
      voice: "Playful, warm, trend-aware — like your friend who always has the best nails.",
      positioning: "A beauty creator who does 10-minute at-home manis to camera and tags the exact kit.",
      niche: "at-home nails & beauty hacks",
      audience: "Women 18–34 who want salon nails without the salon.",
      palette: ["#F7C9D9", "#C0446B", "#F4ECE2"],
      inspirations: ["@nailsbymei", "@thehotmess"],
    },
  },
  project: {
    id: "nailinit-biz", name: "NailInit", kind: "project", publishedBy: "harness", updatedAt: now,
    data: {
      summary: "Press-on nails & at-home nail-care DTC brand; in-house design, Alibaba-sourced, Shopify storefront.",
      status: "live",
      stack: ["Shopify", "Alibaba sourcing", "Meta ads", "Klaviyo"],
      roadmap: ["Restock chrome sets", "Shoot the spring collection", "Launch a subscription refill"],
      tasks: ["Reorder brush-on glue (stock low)", "New A+ content for the starter kit"],
      links: [{ label: "store", url: "https://nailinit.example" }],
    },
  },
  // See the note on SWITCHBOARD.page — same role, consumer-brand voice, same planted flaws.
  page: {
    key: "index.html",
    html: [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<title>NailInit</title></head><body>',
      '<nav><a href="/">NailInit</a><a href="/shop">Shop</a><a href="#">About</a></nav>',
      '<header><h1>Nails, reimagined</h1>',
      '<p>Discover our range of premium press-on nails and at-home care essentials.</p>',
      '<a href="/shop">Learn more</a></header>',
      '<img src="/hands.jpg">',
      '<section><h2>Why NailInit</h2><ul>',
      '<li>Salon quality</li><li>Ten minutes</li><li>Reusable sets</li>',
      '</ul></section>',
      '<footer><p>Ships across India and the US.</p></footer>',
      '</body></html>',
    ].join("\n"),
  },
};

export const PROJECTS = { switchboard: SWITCHBOARD, nailinit: NAILINIT };
export const PROJECT_IDS = Object.keys(PROJECTS);
