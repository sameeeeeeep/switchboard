# Brand extraction — root-cause + a first-class capability

**Status:** design note. **Author:** thread-a handoff investigation.
**Related:** [CAPABILITIES.md](./CAPABILITIES.md), [CONTEXT-KINDS.md](./CONTEXT-KINDS.md),
[NOTCH-PANEL.md](./NOTCH-PANEL.md), the Bank connector
[`packages/bank-mcp/brand.mjs`](../packages/bank-mcp/brand.mjs) +
[`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs), the context library
[`packages/sidekick/src/context/library.ts`](../packages/sidekick/src/context/library.ts).

---

## 0. TL;DR

"Start from an existing brand" fails because the *robust* extractor and the *user-facing surfaces*
run in different places. The deterministic extractor (fetch the site's real HTML/CSS/`products.json`,
parse colours + catalogue off the bytes) only works **server-side**. The two surfaces users actually
touch — the ported brandbrain clone flow and the store's first-project setup — run **in the browser
tab**, where cross-origin `fetch` is CORS-blocked, so they silently fall back to *asking a model to
recall the brand*. That fallback is exactly the guessing bug the extractor was built to kill:
invented hexes, zero products.

The fix is not another reimplementation. It is to promote brand extraction to a **first-class
Switchboard capability** (`sb_brand` / realised over `sb_http`) that runs in the daemon — one
extraction brain, called from every surface — and to make "extract a brand from a URL" the canonical
**first step of establishing a project**.

---

## 1. Root cause of the flakiness

### 1.1 There are THREE brand-from-URL implementations, and only one is robust

| # | Call site | Path | Where it runs | Robust? |
|---|---|---|---|---|
| 1 | **Bank connector** — `bank_extract_brand` (`packages/bank-mcp/bank-mcp.mjs:304`, fetch in `gatherSite` L161, parse in `brand.mjs`) | Deterministic: fetch HTML + same-origin CSS + `/products.json`, parse bytes; the model only *names* what was found | **Daemon (Node)** | ✅ yes |
| 2 | **brandbrain clone** — `app/api/studio/clone/route.ts:101` → `lib/extract.ts` `readBrandSite` | Same deterministic algorithm, TS port | `runtime="nodejs"` **but bundled to run IN-TAB in the Switchboard port** | ❌ CORS-blocked |
| 3 | **Store first-project** — `examples/apps/src/store/point.js:212` | Hands the model `WebFetch` and asks it to read the brand; prompt + hex string-match as mitigation | In-tab (model's tool) | ❌ guessing path |

`lib/extract.ts` and `brand.mjs` are explicitly documented as the same "extraction brain" kept in
sync (`lib/extract.ts:11-13`). The algorithm is genuinely good: it weights CSS custom properties by
name (`--brand/primary/accent/cta` strong, `--background/text` chrome, `theme-color` meta = 100),
drops neutrals, collapses near-duplicate shades, and pulls the whole Shopify catalogue via
`products.json?limit=250`. When it runs server-side it works.

### 1.2 Why in-tab kills it

The Switchboard port does **not** run brandbrain's route handlers on a server. Per
[`examples/brandbrain-port/build.mjs`](../examples/brandbrain-port/build.mjs) the 32 route handlers
are bundled for a **client fetch-router** (`examples/adapter/router.mjs`): `fetch("/api/…")` is
intercepted and dispatched to the handler *in the browser*. So inside `readBrandSite`,
`fetch("https://someseller.com/")` is a **cross-origin browser fetch**. Consequences:

- **CORS.** A brand's homepage/CSS almost never sends `Access-Control-Allow-Origin`, so the fetch
  throws. `get()` catches it and returns `null` → `readBrandSite` returns `null` → `facts` is null.
- **Forbidden headers.** The extractor sets a `user-agent` header (`extract.ts:207`, `get()` L226);
  browsers silently drop it — a lesser issue, but a sign the code assumes a server runtime.
- **The silent fallback IS the bug.** With `facts === null` the clone route still runs the model with
  `allowedTools:["WebSearch","WebFetch"]` (`clone/route.ts:132`) and prompts it to *"fetch that page…
  colours must be the brand's REAL hex values"* (L106-130). A model handed `WebFetch`'s summarised
  text rendering can't see CSS, so it invents hexes and SKUs — the exact failure `extract.ts:1-9`
  documents. It only surfaces as an error when fewer than 3 decision cards survive
  (`clone/route.ts:194`), so most of the time it "succeeds" with fabricated output. That reads to the
  user as *flaky*: sometimes the model happens to know the brand, usually it doesn't.

Store `point.js` never even attempts the deterministic path — it is the model-`WebFetch` path by
design, with prompt discipline as the only guardrail.

### 1.3 Secondary fragility (present even server-side)

- **Shopify-centric catalogue.** Products come only from `/products.json` (`extract.ts:238`). Non-
  Shopify stores (WooCommerce, custom, Squarespace, big DTC on headless stacks) yield **zero
  products**, so `range`/`format`/`pricing` fall back to the model.
- **SPA / JS-rendered homepages.** The fetch gets the pre-hydration HTML shell. React/Next storefronts
  that inject content and inline styles client-side expose little parseable CSS → weak palette.
- **Tailwind/atomic CSS.** Compiled utility CSS has no semantic `--brand-*` custom properties, so
  `nameWeight` can't distinguish brand from chrome; palette degrades to frequency counting.
- **No timeout budget legible to the user.** `readBrandSite` fans out up to 6 catalogue pages + 4
  stylesheets with 8–15s timeouts each; a slow origin can burn most of the 210s clone budget before
  the model even starts.

---

## 2. Proposed capability: `sb_brand` (brand extraction)

### 2.1 Does it deserve to be its own capability? — Yes.

Per [CAPABILITIES.md](./CAPABILITIES.md) a capability is a self-contained daemon module with five
parts (methods, consent scope, posture, origin isolation, audit). Brand extraction qualifies and,
more importantly, has **three independent consumers already** (Bank, brandbrain, store home) plus
future ones (naming/voice wrapps, Prism, Cast). Today each reimplements or degrades. A capability
collapses them to one call.

There are two ways to land it; they are complementary:

**Option A — realise it over `sb_http` (the proxy already designed in CAPABILITIES.md §A).**
`sb_http` is a daemon-side outbound fetch with an origin-scoped host allowlist. If the daemon does the
fetching, CORS disappears (server-to-server), forbidden headers are allowed, and the existing pure
parsers (`brand.mjs`) run **in-tab unchanged** on the returned bytes. This is the minimal-new-surface
route: ship `sb_http`, point the fetch adapter at it, delete the in-tab `fetch` assumption.

**Option B — a dedicated `sb_brand` capability (recommended as the headline surface).** A single
high-level method that returns *structured facts*, so no consumer re-implements the fan-out or the
parser. It wraps the same daemon fetch + `brand.mjs` that `bank_extract_brand` already runs.

```ts
// packages/protocol/src/rpc.ts — new row in the BYOPMethods table
sb_brand: {
  params: { url: string; name?: string };
  result: {
    domain: string; siteName?: string; description?: string; platform?: string;
    currency?: string; ogImage?: string;
    palette: { hex: string; from: string }[];            // provenance-tagged, from served CSS
    products: { short: string; price: number|null; type: string; url?: string }[];
    category?: string; priceRange?: { min: number; max: number };
    socials: { label: string; url: string }[];
    reachable: boolean;                                   // false ⇒ site couldn't be read (honest)
  };
}
```

### 2.2 Capability module shape (the CAPABILITIES.md registry)

```ts
const brandCapability: Capability = {
  methods: ["sb_brand"],
  scopeKey: "brand",                                 // manifest: "brand": { } (presence = opt-in)
  describeScope: () => [{ label: "Read a brand's public website", detail: "colours, catalogue, meta" }],
  posture: () => "read",                             // GET-only public pages ⇒ read, no per-call prompt
  handle: async ({ params }) => {
    const u = safeOrigin(params.url);                // SSRF guard: reuse point.js/extract.ts checks
    if (!u) return { reachable: false, /* … */ };
    const { html, css, catalog } = await gatherSite(u);   // lift verbatim from bank-mcp.mjs:161
    return buildBrand({ html, css, productsJson: catalog, url: u.href, name: params.name }); // brand.mjs
  },
};
```

**Security invariants (all already present in the code to lift):**
- **SSRF guard.** `safeOrigin`/`safeUrl` (`extract.ts:209`, `bank-mcp.mjs:118`) already reject
  loopback, RFC-1918, `.local`/`.internal`, and non-http(s). Keep it — a URL reaching this tool comes
  from a model or a paste and must never be a lever onto the local network.
- **Byte/time budgets.** 4 MB cap + per-request timeouts already exist; make them grant-visible.
- **Read posture.** Only GET on public pages, no credentials → runs inside the grant with no per-call
  prompt (like storage reads). The *first* connect prompt names it: "Read a brand's public website."
- **Origin isolation + audit.** Inherited from the registry for free.

### 2.3 One brain, three consumers (the payoff)

`brand.mjs` stays the single deterministic parser (it already holds the unit tests,
`packages/bank-mcp/brand.test.mjs`). After this lands:

- **Bank** keeps calling its own fetch+parse (or switches to `sb_brand` — same result).
- **brandbrain clone** replaces `readBrandSite` with `window.switchboard.brand({ url })`; the model
  step keeps its job (name swatches, frame positioning) but is never again asked to *supply* facts.
  The `facts === null` fallback prompt (`clone/route.ts:128`) is deleted — no more silent guessing.
- **Store `point.js`** replaces the `WebFetch` model call in `runSite` with `sb_brand`; the "three
  readings share byte-identical facts" doctrine (its L10-12) becomes *true by construction* instead of
  aspirational.

Deprecate `lib/extract.ts` (the third copy) once the clone route calls the capability.

---

## 3. Brand extraction as project-establishment

### 3.1 The founder's insight, mapped to the existing machinery

"Extract an existing brand really well" should be **step one of establishing a project** — it front-
loads the context every downstream wrapp needs. The plumbing for this already exists:

- The **context library** (`packages/sidekick/src/context/library.ts`) is the user-owned shared layer.
  A producer `publish()`es a whole context; a consumer reads the **one** the user selected.
- **`setActiveProject(contextId)`** (L83) sets the GLOBAL "working on" pick (`*global*` key). `active(origin)`
  (L77) lends that one context to **every** connected app at once (a per-app pick can override).
- **`kind` conventions** ([CONTEXT-KINDS.md](./CONTEXT-KINDS.md)): `kind:"brand"` carries
  voice/positioning/palette/products; `kind:"project"` carries a repo/folder and `data.folder` is
  **load-bearing** — `folderOf()` (library.ts:136) lets the Broker bind an app's storage to that folder
  when the project is lent.
- The store home already frames this as **"point at it and it's yours"** (`point.js`) — one pointer
  (site / GitHub repo / local folder) → one banked context.

So project-establishment = **pointer → extracted context → published → set as active project.** The
only change is routing the *site* pointer through `sb_brand` instead of the model.

### 3.2 The flow

```
┌─ Establish a project ───────────────────────────────────────────┐
│  Point Switchboard at what you already have:                     │
│   ○ a website   ○ a GitHub repo   ○ a folder on this Mac         │
│                                                                  │
│  [ yourbrand.com                                    ]  → Read it │
└──────────────────────────────────────────────────────────────────┘
        │ sb_brand({ url })            (daemon fetch — no CORS, no guessing)
        ▼
┌─ What we read from yourbrand.com ───────────────────────────────┐
│  ● ● ● ●  4 colours, from the site's own CSS (--brand-primary…)  │  ← provenance shown
│  Shopify · 37 products · £12–£48 · category "fragrance"          │
│  @instagram  @tiktok                                             │
│                                                                  │
│  Three readings (facts identical — only the framing differs):   │
│   ★ Reading A  ·  Reading B  ·  Reading C     → [ Confirm ]      │
└──────────────────────────────────────────────────────────────────┘
        │ publish(kind:"brand") + setActiveProject(id)
        ▼
   Project established. Every wrapp now opens pre-loaded:
   adgen shoots from the palette, redline answers in the voice,
   Prism themes to the hexes — no blank fields, no re-typing.
```

Key doctrine (already written into `point.js:8-23`, now honest because the extractor is real):
- **Never forms-first.** The user confirms *whole readings*, never authors a blank field.
- **Three readings, byte-identical facts.** Guaranteed because facts come from the parser, not a
  model. If the palette is empty, say "no colours read" — never show three plausible invented hexes.
- **Reachable === false is honest.** A dead/JS-only site returns `reachable:false`; the UI offers the
  repo/folder pointer or an about/shop-page retry rather than fabricating.

### 3.3 Why this reduces later effort (the whole point)

Every catalog wrapp is *proactive* — connect it and it generates FROM the active project. A cold
library means proactive wrapps have nothing to work from (`point.js:3-6`). Establishing the project
once, well, is the difference between "adgen asks me to describe my brand again" and "adgen already
knows my palette, voice, hero SKU and price band." One good extraction pays down onboarding cost for
the whole shelf.

---

## 4. The "I have an idea" widget (ideabrain)

### 4.1 What ideabrain is

ideabrain is a sibling **studio** inside the same brandbrain engine (`StudioName = "brand" | "launch"
| "idea"`, `lib/studio/spec.ts:340`). Same card-based decision loop, different subject: it walks
**research → thesis → plan → prove → deck → reach-outs** for a startup thesis instead of a brand's
identity. It is a **family keyed by category** — a 46-task idea pool + 7 `IDEA_TEMPLATES` (general,
marketplace, app, feature, retail, saas, hardware); `detectIdeaCategory(text)` picks the playbook from
the one-line idea, and each template is an ordered subset (13–15 decisions). Thesis cards: `problem`,
`who` (beachhead), `insight`, `founderwhy`, `whynow`🌐, `alternatives`🌐, `comps` (the analogy). 13
fact-assertion cards are `web:true` (cite-or-omit grounding); the rest reason over a web-grounded
research canvas.

The **headless entry** already exists: `ideabrain/brief` — a single web-free model call, one-line idea
→ a sharp structured brief (`examples/apps/src/core/ideabrain.core.js` `brief()`, mirrored verbatim
from the studio's `/api/studio/brief` route). This is the seam the widget stands on: it is fast,
pure, and already a Switchboard workflow (`examples/apps/wrapps/ideabrain/switchboard.json` →
`"workflows":["ideabrain/brief"]`).

### 4.2 Widget design — "one line in the notch, a validated project out"

The widget lives in the notch panel ([NOTCH-PANEL.md](./NOTCH-PANEL.md)) — black, drops from the
notch, glanceable. It is a **long-running project rendered as a progress card**, not a chat. The heavy
studio (research → deck) stays in the web app; the widget is the *front door and the pulse*.

**State 1 — the prompt (idle).** One field, nothing else.
```
╭───────────────────────────── notch ─────────────────────────────╮
│  💡 I have an idea…                                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ a marketplace to buy billboard slots by the minute         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                          [ Pressure-test it → ]  │
╰──────────────────────────────────────────────────────────────────╯
```

**State 2 — instant read (≈2s, the `brief` call).** Before any long research, the widget commits to a
reading so the user sees momentum immediately — the same "never a blank screen" doctrine as brand
readings. Category is detected live.
```
│  💡  marketplace · programmatic OOH                             │
│  “Airbnb for billboard minutes.”                                │
│  Beachhead: indie D2C brands · Why-now: DSP APIs opened 2024    │
│  This maps to 14 decisions →           [ Validate ]  [ Tweak ]  │
```

**State 3 — validating (glanceable progress).** The studio runs research → thesis → plan → prove in
the background (batch/headless). The widget shows a compact ladder — the six stages as filling pips,
current stage named, grounded cards marked 🌐. This is the "working" posture of the notch (a breathing
glyph), scoped to one project.
```
│  💡  Billboard minutes · validating                             │
│  ●●●●○○   thesis ✓ · market ✓ · plan ✓ · prove ◐               │
│  Now: pressure-testing the riskiest assumption 🌐               │
│  ▸ 4 real alternatives found · 2 VCs already writing this space │
```

**State 4 — validated (the payoff, glanceable verdict).** A one-line verdict + the three artefacts the
studio produces, each a one-tap open. The thesis is now a **published `kind:"idea"` context** (via the
port's `ideaToContext`, bootstrap.js) — so it becomes an active project like an extracted brand.
```
│  💡  Billboard minutes — thesis holds ✓                         │
│  Wedge is real; supply-side onboarding is the risk.             │
│  [ Open deck ]   [ 6 people to reach out to ]   [ Full brief ] │
│  ★ set as my project — every wrapp now knows this idea          │
```

### 4.3 Why this shape

- **One line in, validated project out** — the widget never shows a form. Idea → `brief` → detected
  category → the category's real decisions. Mirrors the brand pointer's "point at it and it's yours."
- **Glanceable, not conversational.** The notch shows a *pulse* (stage pips, current step, live
  grounding counts), not a transcript. You glance, you see where validation stands, you get back to
  work. Depth lives one tap away in the web studio.
- **Honest grounding is visible.** 🌐 marks the cards pulled from live web (cite-or-omit); the verdict
  states the *risk*, not just the upside — ideabrain's whole point is pressure-testing, so the widget's
  headline is a verdict a founder can act on, never hype.
- **It ends in a project, not a report.** State 4 publishes `kind:"idea"` and offers *set as my
  project*, closing the loop with §3: the validated thesis becomes the active context every downstream
  wrapp (deck export, reach-out drafting, a landing-page wrapp) reads. Same establishment primitive,
  different producer.
- **Cheap to build.** `brief` is already a headless workflow; the studio already runs card-by-card and
  already publishes `kind:"idea"` contexts on connect. The widget is a **notch renderer over existing
  actions** plus a progress channel — no new engine.

### 4.4 Build seam

1. Notch widget surface that calls the `ideabrain/brief` workflow for State 2 (instant), then kicks
   the studio's stage loop headless (batch surface is already declared) for States 3–4.
2. A progress channel: the studio emits stage-complete events → the widget's pips. (Reuse the
   `onTool`/step callback shape `point.js:498` already uses for live status.)
3. On completion, `context.publish(ideaToContext(project))` (exists) + a "set as my project" action →
   `setActiveProject(id)` (library.ts:83).

---

## 5. Recommended order

1. **`sb_http`** (CAPABILITIES.md §A) — unblocks every in-tab fetch, not just brand. Small, high
   leverage.
2. **`sb_brand`** over it — the headline capability; wire the brandbrain clone route + store `point.js`
   to it; delete the `facts===null` guessing fallback. *This is the fix for the reported flakiness.*
3. **Project-establishment** — make the site pointer use `sb_brand`; keep the "three readings" UI.
4. **ideabrain widget** — notch renderer over `brief` + the stage loop, ending in a published
   `kind:"idea"` project.
