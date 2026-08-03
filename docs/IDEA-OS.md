# Idea → OS — the operating system a validated business gets

**Status:** design note (strategic spec). **Author:** thread-a handoff — the founder's "we need to
think idea → OS."
**Related:** [BRAND-EXTRACTION.md](./BRAND-EXTRACTION.md) (extractor + the ideabrain widget +
project-establishment), [BANK-MAKEOVER.md](./BANK-MAKEOVER.md) (the project-context home +
define-your-project + `ideafetch`), [FIRST-PROJECT.md](./FIRST-PROJECT.md) (the two-pass
establishment), [STORE-TAXONOMY.md](./STORE-TAXONOMY.md) (the 11 item roles + device-lightness
doctrine), [STORE.md](./STORE.md) (the consumer store), [CONTEXT-KINDS.md](./CONTEXT-KINDS.md)
(`brand`/`project`/`idea`/`personal`/`persona` field conventions), [EMAIL-WRAPP.md](./EMAIL-WRAPP.md)
(Reachout + routines), the founder's YC/vision memory.
**Grounded in code:** the listing model at [`packages/protocol/src/store.ts`](../packages/protocol/src/store.ts)
(`WrappListing` = bill of materials; `resolveRequirements`/`validateListing`/`primaryAction`); the
catalog at [`examples/apps/wrapps/catalog.json`](../examples/apps/wrapps/catalog.json) (65 listings);
the context library at [`packages/sidekick/src/context/library.ts`](../packages/sidekick/src/context/library.ts)
(`publish` / `setActiveProject` / `active(origin)` / `folderOf` / the `*global*` key); ideabrain's
headless entry [`examples/apps/src/core/ideabrain.core.js`](../examples/apps/src/core/ideabrain.core.js)
(`brief`); the ingest parsers in [`packages/bank-mcp/`](../packages/bank-mcp) (`project.mjs`,
`brand.mjs`); the establishment pointer [`examples/apps/src/store/point.js`](../examples/apps/src/store/point.js);
and the external studio engine `lib/studio/spec.ts` (`StudioName`, the 7 `IDEA_TEMPLATES`,
`detectIdeaCategory`).

---

## 0. Interpretation (stated up front — flag if you'd read it differently)

The founder: *"we need to think idea → OS, like ideabrain needs to think of OS properly. Right now it's
within ideabrain but I feel it needs to be its own thing and needs a lot of thought for each sector
properly."*

**The reading this doc commits to:** once an idea is validated, the founder should receive a full
**operating system for that specific business** — a *tuned bundle of Switchboard store items* (wrapps +
skills + routines + connectors + context + a home + a daily loop) that is what you actually **run the
business with**, specialized **per sector**. Today this notion is smuggled inside ideabrain as its 7
`IDEA_TEMPLATES` (BRAND-EXTRACTION.md §4.1: general · marketplace · app · feature · retail · saas ·
hardware). Those templates already know "what kind of business is this" — but they only use that
knowledge to pick a *validation playbook*. The founder's instinct is that the same recognition should
drive a *second, bigger* output: **the kit you operate with.** So we lift it out. ideabrain stays
"**validate the bet**"; **Idea OS** becomes its own thing — "**here's the operating system to run
it**" — and ideabrain *feeds* it.

**The narrower reading I'm rejecting (and why):** "Idea OS" could mean "ideabrain should also emit an
operating *plan/roadmap* per sector" — still a document, still inside ideabrain. I reject it because (a)
the founder explicitly says it *"needs to be its own thing,"* and (b) the whole product thesis is that
Switchboard items are the unit of work (STORE.md: *"a wrapp = a capability + a skill + a UI"*). The
honest, product-consistent meaning of "OS for a business" is **the live set of items that runs it**, not
another PDF. A roadmap is a *byproduct* of the OS, not the OS.

**One-line definition.** *An Idea OS is a named, project-scoped bundle of existing store items —
assembled by sector, grounded in one context, arranged into a home and a daily loop — that turns "I
validated an idea" into "I have the machine to run the business."*

---

## 1. What an Idea OS IS — the concrete bundle a business gets

An Idea OS is **not a new app**. It is a **composition of things already in the catalog**, selected and
wired for one business. It has seven layers; every layer maps onto an object that already ships.

| # | Layer | What it is concretely | Grounded in |
|---|---|---|---|
| 1 | **The context spine** | The single active `kind:"project"` / `kind:"brand"` context every item grounds on. The OS is *scoped to one project* — `setActiveProject(id)` makes the whole bundle open pre-loaded. | `library.ts:77,83` (`active`/`setActiveProject`, `*global*`); CONTEXT-KINDS.md |
| 2 | **The home / workspace** | Bank as the OS home screen — the active-project hero + the sector's facets + the daily-loop card. The one surface you open to run the business. | BANK-MAKEOVER.md §2.3 (project-first layout); catalog `bank` |
| 3 | **Installed wrapps** | The sector's curated set of `WrappListing`s (studios + tools + agents). The "apps" of the OS. | `store.ts` `WrappListing`; `catalog.json` |
| 4 | **Skills God wears** | The `surfaces:["god"]` skills for that business's recurring jobs — so "write the caption / draft the reply / decode this error" is conversational, zero device weight. | STORE-TAXONOMY.md type 3; `store.ts` `SkillRef`; catalog `skill` category |
| 5 | **Routines** | The scheduled workflows that run the business **while you're away** and surface each outward act as a click. The OS's background daemon. | EMAIL-WRAPP.md §3; STORE-TAXONOMY.md type 8; routines registry (specced, on `claude/autopilot-autonomous`) |
| 6 | **Connectors** | The external tools wired in as gated `callTool` grants — Gmail, a commerce backend, an ad account, meetings. Declared as `requires:[{kind:"connector"}]`. | `store.ts` `Requirement`; EMAIL-WRAPP.md §0 |
| 7 | **The daily loop** | The OS's *shell*: a concrete "what runs overnight / what you approve each morning / what you make this week" narrative that ties the six layers into a rhythm. | this doc §3 per sector |

### 1.1 The mental model: a home screen + a shell, not an app pile

A desktop OS is a **home screen** (apps you can reach) plus a **shell** (the login items, cron jobs, and
daily rhythm that make it *run*). An Idea OS is exactly that for a business:

- The **home screen** is Bank's hero + the installed wrapps (layers 2–4).
- The **shell** is the routines + connectors + the daily loop (layers 5–7).
- The **kernel** is the context spine (layer 1) — the one object that grounds everything, so no wrapp
  ever asks the founder to re-describe their business.

The OS is *legible as one thing*: "this is the machine that runs Aamras," not "here are 11 apps I
installed." That framing is the product.

### 1.2 The anti-bloat covenant (why an OS isn't 20 apps of weight)

The obvious failure mode of "give them a whole OS" is **bloatware** — the exact thing
STORE-TAXONOMY.md Part 3 exists to prevent (*"nothing is worse than the user's system going slow because
of us"*). An Idea OS is only credible if it stays light. The doctrine already written for single items
governs the bundle:

- **The bundle installs faces, not engines.** A wrapp is a UI over a shared capability
  (STORE-TAXONOMY.md §0); installing ten of them does not install ten model runtimes. Models/heavy
  engines are `lazy` and load on first use (STORE-TAXONOMY.md R2), shared once at the daemon/extension
  origin (R8).
- **Routines sleep between fires** (R4) — the OS's background layer is a scheduled wake, never a busy
  loop.
- **The store shows the bundle's *summed* weight before install** (R6 `ResourceProfile`). "Install the
  DTC OS" renders one honest receipt: *N wrapps · 0 MB now · models load on use · 2 routines that sleep.*
- **Progressive, not all-at-once (§4.5).** The OS installs a *minimum viable spine* (the home + 3–4 core
  wrapps) and offers the rest as the business grows. You are never handed 20 icons on day one.

The covenant, in one line: **an Idea OS makes a business lighter to run than the SaaS stack it
replaces — or it isn't shipped.**

---

## 2. How an Idea OS is ASSEMBLED (the taxonomy + the context)

An Idea OS is **derived, not hand-authored per user**. Two inputs produce it:

1. **The sector** — from ideabrain's `detectIdeaCategory` (the 7 `IDEA_TEMPLATES`), mapped to a
   **Sector Profile** (§2.2).
2. **The established context** — from ideafetch / first-project (BANK-MAKEOVER.md §4, FIRST-PROJECT.md),
   the `kind:"project"`/`kind:"brand"` spine that binds the bundle to *this* business.

Sector selects **which items**; context makes them **pre-loaded**. The assembly is a pure function over
two data inputs and the existing catalog — no per-user authoring.

### 2.1 It composes existing listings — it does not fork the model

The one rule of STORE-TAXONOMY.md §0 holds here too: *"an item type is not a new data model — it is a
recognizable shape of {components × surfaces × requires}."* An Idea OS is the **next composition up**: a
**bundle of listings**, expressed as references to catalog ids, not a new parallel schema.

Proposed additive object (a MINOR, in the spirit of STORE-TAXONOMY.md's Appendix — *none fork the
model*):

```ts
// packages/protocol/src/store.ts — additive, composes WrappListing by id
export interface Kit {
  id: string;                       // "os-dtc", "os-saas"
  sector: SectorId;                 // maps 1:1 from detectIdeaCategory (§2.2)
  name: string;                     // "The DTC operating system"
  tagline: string;
  spineKinds: string[];             // which context kinds ground it: ["brand"] | ["project"] | …
  items: KitItem[];                 // members: catalog ids, tagged by role (core | grow)
  routines: RoutineRef[];           // the shell (EMAIL-WRAPP.md §3 shape)
  connectors: Requirement[];        // { kind:"connector", id } needs surfaced on the ladder
  home: HomeLayout;                 // the Bank hero facets + sections for this sector
  dailyLoop: string[];              // the shell narrative (§3), shown + used to seed routines
}
export interface KitItem { ref: string; role: "core" | "grow"; why: string; }
```

A `Kit` is a **meta-listing**: it never carries UI or a model of its own; it *points at* listings that
do. This keeps the modularity thesis intact — resolving a Kit's requirements is just
`resolveRequirements` (`store.ts:162`) run over the union of its members' `requires`, deduped. The
install gate, the lazy-exclusion, the readiness ladder — all reused, none reinvented.

> **Alternative encoding (no new type):** a Kit *could* be a `WrappListing` with a new
> `WrappCategory "kit"` whose `components` reference member ids. That avoids any schema addition but
> overloads `components` (which today means skills/workflows/ui, not "other wrapps"). A small dedicated
> `Kit` type is cleaner and still additive. Either is acceptable; the doc assumes the dedicated type.

### 2.2 The sector map (ideabrain's templates → Sector Profiles)

ideabrain already recognizes the sector; the Idea OS just needs the recognition, not a new classifier.
The mapping:

| ideabrain `IDEA_TEMPLATES` (`lib/studio/spec.ts`) | Idea OS Sector Profile | This doc |
|---|---|---|
| `saas`, `app`, `feature`, `hardware` | **SaaS / software** | §3.1 |
| `retail` (D2C reading) + brandbrain's whole D2C engine | **E-commerce / DTC brand** | §3.2 |
| `general` (services reading) | **Agency / services** | §3.3 |
| (creator reading of `general`/`app`) | **Creator / media** | §3.4 |
| `retail` (physical reading) | **Local / brick-and-mortar** | §3.5 |
| `marketplace` | **Marketplace** | §3.6 |

Two notes: the mapping is **many-to-one and one-to-many** (SaaS pulls three templates; `retail` splits
into DTC vs. local by a single follow-up question — "do you ship, or do people come to you?"). And it is
**extensible** — a new sector is a new `Kit` data row, never engine work (§4).

### 2.3 The context makes the bundle pre-loaded (the payoff)

Every catalog wrapp is **proactive** — it generates *from* the active context (BRAND-EXTRACTION.md §3.3:
*"adgen already knows my palette, voice, hero SKU and price band"*). So binding the spine is what turns a
pile of installed apps into an *operating system*: one `setActiveProject(id)` and **every member of the
bundle opens knowing the business.**

- A DTC OS bound to a `kind:"brand"` context → Prism themes to the palette, adgen drafts in the voice,
  A-Plus writes to the real catalogue, Shelf triages the real SKUs — *from one lend*
  (`active(origin)`, `library.ts:77`).
- A SaaS OS bound to a `kind:"project"` context with `data.folder` set → Redline reviews the real files
  on disk, Standup reads the real commits, because `folderOf` (`library.ts:136`) auto-binds each
  member's storage to that directory (CONTEXT-KINDS.md §`data.folder` is load-bearing).

This is the difference between "I installed 10 apps and now I configure each" and "I pointed at my
business once and the whole OS knows it." The context spine is the kernel; without it an Idea OS is just
a folder of shortcuts.

### 2.4 Honesty: an OS shows its gaps, it doesn't fake them

Some sector-critical jobs have **no wrapp today** (invoicing, POS, payments, native CRM, accounting).
The doctrine from BRAND-EXTRACTION.md §3.2 (*"reachable:false is honest"*) carries up to the bundle: an
Idea OS **names the missing piece** rather than pretending a generic wrapp covers it. A gap renders as a
labelled slot — *"Invoicing — no wrapp yet · [request it]"* — which is simultaneously honest UX and the
**roadmap for what to build next** (and a natural hook for the store's `＋Create` / GitHub-import door,
per the native-app-store memory). The gaps below are called out per sector, on purpose.

---

## 3. Per-sector specialization (the concrete OS bundles)

Each sector below is a concrete `Kit`, drawing **only on shipping `catalog.json` ids** (plus Reachout,
which is specced in EMAIL-WRAPP.md but not yet built — marked ⧗). Format per sector: **spine · installed
wrapps (core / grow) · skills God wears · routines · connectors · the daily loop · honest gaps.**

### 3.1 SaaS / software — "ship it and reach the first users"

- **Spine:** `kind:"project"` (repo/stack/roadmap/`folder`) + optional `kind:"brand"` for the marketing
  site. Established by pointing at the repo/folder (FIRST-PROJECT.md two-pass).
- **Core wrapps:** `ideabrain` (the thesis, already run) · `redline` (line-by-line review of the landing
  page & docs) · `marquee` (a landing page that ships to a domain) · `batch` (run one prompt across a
  list — changelogs, release notes) · `autopilot` (plans the week, makes the moves).
- **Grow wrapps:** `huddle` (working call with Claude over the real files) · `meetnotes` · `saas`
  (re-run the thesis on a pivot) · `feature` (make the case for one feature).
- **Skills God wears:** `commit` · `docstring` · `errslate` · `regex` · `shell` · `standup` · `yc` ·
  `coldemail` · `objection` · `explainthis`.
- **Routines:** `standup` (daily, from commits) · `autopilot/plan` (weekly) · ⧗ `reachout` sender (B2B
  outreach, drafts staged nightly — EMAIL-WRAPP.md §3, its exact dogfood use case).
- **Connectors:** GitHub · Gmail · (Granola/meetings, grow).
- **The daily loop:**
  ```
  overnight → reachout stages personalized outreach drafts · autopilot lays out the week
  morning   → Bank hero: project + this week's plan · standup drafted from last night's commits
              · you approve the outreach sends at the notch (draft-not-send, EMAIL-WRAPP.md §6)
  in-flow   → God wears commit/errslate/shell as you code · redline reviews the landing before ship
  weekly    → marquee refreshes the page · batch writes the release notes
  ```
- **Honest gaps:** no billing/subscription wrapp, no analytics-ingest wrapp, no in-app-support inbox.
  These are labelled slots, not faked.

### 3.2 E-commerce / DTC brand — "run the brand" (the flagship; the catalog is D2C-native)

- **Spine:** `kind:"brand"` — palette (from served CSS), voice, positioning, audience, real
  `products`/catalogue. Established by pointing at the storefront through `sb_brand` (BRAND-EXTRACTION.md
  §2–3) — *the* canonical first step.
- **Core wrapps:** `brandbrain` (the brand system + home studio) · `adpulse` (find the wasted ad spend)
  · `adforge` (draft this week's ads from the brand) · `prism` (on-brand images) · `shelf` (keep
  inventory honest).
- **Grow wrapps:** `adgen`/Adwall (a wall of variations) · `aplus` (Amazon A+ in bulk) · `studio`
  (product photography on your own models) · `reel` (short-form video) · `marquee` (a campaign landing
  page) · `cast` (personas for content).
- **Skills God wears:** `caption` · `hooks` · `titles` · `repurpose` · `nameit` · `objection` ·
  `rephrase` · `reply`.
- **Routines:** `adpulse/analyze` rollup (weekly, flags leaks) · `adforge_run` (weekly ad drafts staged)
  · `shelf_triage` (reorder/watch/dead-weight, on a cadence).
- **Connectors:** a commerce backend (Shopify — already a first-class connector shape) · a Meta ad
  account · Gmail.
- **The daily loop:**
  ```
  overnight → adpulse rolls up yesterday's spend and flags the leaks · adforge drafts this week's ads
  morning   → Bank hero: brand + sales + "3 SKUs to reorder" (shelf) · this week's ad drafts waiting
  in-flow   → Prism/studio shoot the week's creative on the palette · God wears caption/hooks for posts
  weekly    → reel + repurpose turn one shoot into every channel · aplus refreshes the Amazon page
  ```
- **Honest gaps:** no order-management / fulfilment wrapp, no customer-support inbox, no returns flow,
  no email-marketing *sender* (Reachout is B2B outbound, not consumer broadcast — an honest boundary).

### 3.3 Agency / services — "win work and deliver it, per client"

- **Spine:** one `kind:"project"` **per client** (folder-bound deliverables) + a `kind:"brand"` per
  client + the founder's `kind:"personal"` card (company/contact — CONTEXT-KINDS.md `kind:"personal"`).
  Bank's `switch ▾` (BANK-MAKEOVER.md §2.3) re-homes the whole OS to the client you're working on.
- **Core wrapps:** ⧗ `reachout` (new-business outreach) · `redline` (review client deliverables) ·
  `meetnotes` (transcript → notes + action items) · `batch` (one prompt across a client roster).
- **Grow wrapps:** `huddle` · `marquee` (client landing pages) · `brandbrain` (a brand per client) ·
  `recap` · `identity`.
- **Skills God wears:** `reply` · `coldemail` · `objection` · `recap` · `outline` · `standup` ·
  `compare` · `polish`.
- **Routines:** ⧗ `reachout` sender (pipeline warm while away) · `meetnotes` auto-run on new meeting
  transcripts (via a meetings connector) · `autopilot/plan` (weekly across clients).
- **Connectors:** Gmail · a meetings connector (Granola) · Google Drive · a tasks connector (ClickUp —
  the Bank task dialect already targets this, EMAIL-WRAPP.md context).
- **The daily loop:**
  ```
  overnight → reachout advances the new-business cadence · action items from yesterday's calls land on the board
  morning   → Bank hero switched to today's client · what's due · the pipeline
  in-flow   → meetings → meetnotes → owners/dues on the board · God wears reply/recap between calls
  per-deliverable → redline reviews before it goes to the client
  ```
- **Honest gaps:** no invoicing/billing wrapp, no contract/e-sign, no time-tracking, no proposal-builder.
  All labelled slots — the clearest "build these next" list in the catalog.

### 3.4 Creator / media — "make it, cut it, ship it everywhere"

- **Spine:** `kind:"persona"` (Cast) — the creator persona *is* the brand-shaped grounding for every
  caption and cut (CONTEXT-KINDS.md `kind:"persona"`).
- **Core wrapps:** `identity` (a visual identity from a few words) · `cast` (personas you direct) ·
  `take` (a recording script) · `cut` (transcript → captions + cut list) · `reel` (short-form video).
- **Grow wrapps:** `prism` (thumbnails/visuals) · `studio` · `marquee` (a link-in-bio / launch page).
- **Skills God wears:** `caption` · `hooks` · `titles` · `repurpose` · `outline` · `rephrase` ·
  `translate` · `spellout`.
- **Routines:** `repurpose` on a content-calendar cadence (one piece → every channel) · a
  weekly-hooks/titles batch for the upcoming slate.
- **Connectors:** a publish connector (e.g. the media/TikTok MCP shape) · Gmail · Drive.
- **The daily loop:**
  ```
  record → take gives the script · you shoot · cut turns the transcript into captions + a cut list
  dress  → prism/reel make the thumbnail and the promo cut on the persona's look
  spread → repurpose fans one piece into X / LinkedIn / IG / short-form · God wears caption/hooks/titles
  weekly → the persona keeps every caption in one voice; identity refreshes the look for a series
  ```
- **Honest gaps:** no scheduler/auto-poster (publish stays a human act by design), no
  analytics/retention wrapp, no comment-management inbox.

### 3.5 Local / brick-and-mortar — "run the shop"

- **Spine:** `kind:"brand"` (the local business) + `kind:"personal"` (address, hours, GST — the
  `notes` overflow field, CONTEXT-KINDS.md `kind:"personal"`) so every surface has the real address/hours.
- **Core wrapps:** `shelf` (inventory honesty — the single most load-bearing wrapp here) · `retail`
  (reality-check a concept/expansion) · `adforge` (local promos) · `marquee` (a simple shopfront site).
- **Grow wrapps:** `reel` · `prism` · `meetnotes` (supplier/staff) · `huddle`.
- **Skills God wears:** `reply` (customer messages) · `caption` · `hooks` · `translate`
  (multilingual local audience) · `objection`.
- **Routines:** `shelf_triage` reorder cadence · a "draft replies to new customer messages" routine
  (draft-not-send).
- **Connectors:** Gmail · a commerce/POS backend (gap, see below) · Google Business (grow).
- **The daily loop:**
  ```
  morning → Bank hero: today's takings + "reorder these" (shelf) · adforge has a local promo ready
  in-flow → God drafts replies to customer messages in your voice + address/hours from the personal card
  weekly  → retail pressure-tests the next move (a second location, a new line) before you commit
  ```
- **Honest gaps:** no POS/till integration, no reservations/bookings, no loyalty, no local-reviews
  management. The most under-served sector in today's catalog — flagged honestly, high roadmap value.

### 3.6 Marketplace — "get liquidity on both sides"

- **Spine:** `kind:"project"`/`kind:"idea"` carrying the two-sided thesis (supply plan + demand plan).
- **Core wrapps:** `mkt` (Marketplace Validator — is it worth building?) · `ideabrain` (the marketplace
  template thesis) · ⧗ `reachout` (supply-side onboarding — the *exact* risk ideabrain flags:
  BRAND-EXTRACTION.md §4.2 State 4, *"supply-side onboarding is the risk"*) · `adpulse` (demand-side
  acquisition efficiency).
- **Grow wrapps:** `batch` (outreach across a supply list) · `marquee` (a two-sided landing) ·
  `redline` · `autopilot`.
- **Skills God wears:** `coldemail` · `objection` · `compare` · `outline` · `steps` · `reply`.
- **Routines:** ⧗ `reachout` supply-onboarding sender · `adpulse` demand-side CAC rollup.
- **Connectors:** Gmail · an ad account · a payments backend (gap) · a CRM (grow).
- **The daily loop:**
  ```
  overnight → reachout onboards supply while you sleep · adpulse watches demand-side CAC
  morning   → Bank hero: the liquidity dashboard — supply added vs. demand served · both sides' health
  in-flow   → mkt keeps the liquidity thesis honest as numbers come in · God wears coldemail/objection for supply calls
  weekly    → the two-sided balance is the north-star; the OS surfaces which side is starving
  ```
- **Honest gaps:** no payments/escrow wrapp, no trust-&-safety/dispute flow, no matching-engine wrapp.
  Marketplaces need real backend — the OS is the *go-to-market* layer, and says so.

### 3.7 What's shared vs. specialized (the reuse map)

The sectors are **not** disjoint app stores — they share a common core and specialize at the edges,
which is exactly the device-lightness reuse thesis (STORE-TAXONOMY.md §0: *"many wrapps share the same
few capabilities"*):

- **Shared across all six:** `bank` (home) · `marquee` (a page) · `batch` (bulk) · the writing skills
  (`reply`/`recap`/`objection`/`rephrase`) · Gmail · the context-spine kernel.
- **The specializing axis is the spine kind + the core wrapps:** `brand`→DTC/local, `project`→SaaS,
  `persona`→creator, per-client `project`→agency, two-sided `idea`→marketplace. Change the spine and a
  handful of core members, and the same machinery is a different OS. That's why "per sector" is
  *data* (§4), not six codebases.

---

## 4. The pipeline: ideabrain (validate) → project context (establish) → the OS (run)

The three stages are three *different jobs with three different lifecycles*, which is precisely why the
OS must be its own thing rather than a fourth ideabrain tab.

```
  ┌─ VALIDATE ─────────┐   ┌─ ESTABLISH ────────────┐   ┌─ RUN ──────────────────────┐
  │ ideabrain          │   │ ideafetch + define      │   │ Idea OS (this doc)          │
  │ one line → brief   │──▶│ pointer → context spine │──▶│ sector → Kit → home + loop  │
  │ → thesis (a BET)   │   │ → setActiveProject      │   │ → run daily (a MACHINE)     │
  └────────────────────┘   └─────────────────────────┘   └─────────────────────────────┘
     lifecycle: once           lifecycle: once, re-pointable    lifecycle: daily, forever
     output: a verdict          output: the kernel context       output: a living workspace
     surface: ideabrain widget  surface: Bank establish (§2.2)    surface: Bank home + notch + routines
```

### 4.1 Stage 1 — validate (ideabrain, unchanged)

One line → `ideabrain.core.js` `brief()` (`examples/apps/src/core/ideabrain.core.js:66`) commits to a
sharp brief and **detects the category** (`detectIdeaCategory`, the 7 templates). The studio card loop
(research → thesis → plan → prove → deck) pressure-tests the bet and, on a holding verdict, publishes a
`kind:"idea"` context (`ideaToContext`, BRAND-EXTRACTION.md §4.2 State 4). **ideabrain's output for the
OS is two things: the detected `sector` and the validated `kind:"idea"` context.** Nothing about
ideabrain changes; we just *read one more thing out of it* (the category it already computed).

### 4.2 Stage 2 — establish (ideafetch + define-your-project → the spine)

The idea **graduates to a project** (the idea→project graduation from the project-context memory). This
is the establishment machinery already specced:

- **`ideafetch`** (BANK-MAKEOVER.md §4.1) gathers real material from any pointer — site (`sb_brand`),
  repo/folder (`buildProject`/`gatherRepo`, `packages/bank-mcp/project.mjs`), competitor URLs, pasted
  docs, the vault — into a provenance-tagged fact pool.
- **define-your-project** (BANK-MAKEOVER.md §3) lets the founder multi-select what the business *is*,
  seeded (never invented) from that pool, producing a `kind:"project"`/`kind:"brand"` spine.
- **`setActiveProject(id)`** (`library.ts:83`) binds it globally.

The two-pass ingestion (FIRST-PROJECT.md §2) applies: a fast shallow pass so the OS is usable in
seconds, a background deep pass that enriches the same context in place. **This is the kernel the OS
boots on.**

### 4.3 Stage 3 — fit + install the OS (the new seam)

This is the object this doc adds. Given `(sector, activeContext)`:

1. **Select the `Kit`** for the sector (§2.2) — a pure data lookup.
2. **Resolve its requirements** — `resolveRequirements` (`store.ts:162`) over the union of the members'
   `requires`, deduped, diffed against `PresentState`. Lazy models/engines are excluded from the gate
   (R2); connectors surface as ladder needs (STATES.md currency, shared per `store.ts` header).
3. **Show the bundle with its honest weight** — one `ResourceProfile` receipt (R6) and the gap slots
   (§2.4) before the Get button.
4. **One-consent install of the spine** — the home + `core` members; `grow` members are one tap away
   later (§4.5).
5. **Declare the routines** as standing grants (EMAIL-WRAPP.md §3: *"run in background… drafting for
   this project"*), each with its menubar kill-switch.
6. **Bind the context** — every installed member reads the active spine via `active(origin)`; nothing
   asks the founder to re-describe the business.

### 4.4 Stage 4 — run (Bank becomes the OS home)

Bank's project-first layout (BANK-MAKEOVER.md §2.3) *is* the OS home: the active-project hero, the
sector's facets, the installed wrapps, and a **daily-loop card** (the `dailyLoop` narrative). God
concierges on open (STORE.md interaction laws). The routines advance the business overnight; the founder
approves outward acts at the notch. The OS is now a machine that runs, not a report that was read.

### 4.5 Progressive disclosure (the OS grows with the business)

The Kit tags members `core` vs `grow` (§2.1). Day one installs the **spine + core** — the minimum that
runs the business (anti-bloat covenant §1.2). As the business matures, the OS *suggests* the next grow
member **in context** — "you're shipping a lot of ads; add Adwall for variations," "you're on your third
client; add a brand studio per client." This mirrors the store's concierge posture (STORE.md:
*"uninstalled command → God offers to install first"*) and keeps the OS honest about weight: you only
carry what you've grown into.

### 4.6 Why this is its own thing, not an ideabrain mode (the crux)

| | **ideabrain** | **Idea OS** |
|---|---|---|
| Job | Validate a **bet** | Operate a **business** |
| Lifecycle | Once (you validate, then move on) | Daily, indefinitely |
| Output | A verdict + a thesis (an `idea` context) | A living workspace (bundle + home + loop) |
| Surface | The ideabrain widget / studio | Bank home + the notch + routines |
| Failure if fused | The template's sector knowledge stays trapped as a *validation playbook*; "running the business" never gets designed | — |

The 7 `IDEA_TEMPLATES` today do double duty badly: they recognize the sector but only spend it on
validation. Splitting the two lets **ideabrain be a sharp validator** and **Idea OS be a real operating
system** — each designed for its own lifecycle. That is the founder's instinct, made concrete.

---

## 5. The build path (additive over shipping code)

Everything below composes existing objects; the genuinely new code is a **data registry + one fit
step**. Ordered so each phase leaves the tree green and is independently useful.

**Phase 0 — the sector registry (pure data, no engine).**
Encode the six Sector Profiles (§3) as `Kit` data rows, drawing **only** on shipping `catalog.json` ids
(mark ⧗ Reachout as pending). This is a JSON/TS table — no runtime. Reviewable purely as "does this
bundle make sense for this business." *Deliverable: `packages/protocol/src/kits.ts` (or
`examples/apps/wrapps/kits.json`), validated the way `validateListing` validates a listing — every
member id must exist in the catalog, every `requires` must resolve.*

**Phase 1 — the fit function.**
`fitKit(sector, activeContext) → { kit, resolved }`: look up the Kit, run `resolveRequirements`
(`store.ts:162`) over the deduped member `requires`, attach the summed `ResourceProfile`. Pure, shared,
testable headless (same posture as the `run(input, sb)` seam, WRAPPS-FOR-AGENTS.md). No UI yet.

**Phase 2 — the bundle install card.**
A store surface that renders the fitted Kit: the honest weight receipt (R6), the core/grow split, the
gap slots (§2.4), one "Install this OS" consent that installs the spine + core and declares the
routines. Reuse the store's install path and `primaryAction` (`store.ts:191`) — surface-aware, so it
never promises what it can't run.

**Phase 3 — Bank as the OS home.**
Land the project-first layout (BANK-MAKEOVER.md §2.3) with the sector's `HomeLayout` facets + the
`dailyLoop` card. The hero + `switch ▾` already re-home the whole OS to the active project.

**Phase 4 — the daily loop / shell.**
Wire the sector's routines to the existing ticks — Reachout's `tick` (EMAIL-WRAPP.md §2), Autopilot's
`tick` (routine #1), adpulse/shelf on a cadence — behind the menubar control plane
(`routines-control.json`). *Depends on the routines branch (`claude/autopilot-autonomous`) merging;
until then the loop is drafts + manual advance.*

**Phase 5 — the pipeline handoff.**
Read `sector` out of ideabrain's detected category and hand `(sector, activeContext)` to `fitKit` at the
moment a project is established (§4.3). This is the one wire that makes "validate → establish → run" a
single arc.

**Phase 6 — progressive growth + honest gaps as roadmap.**
The in-context "add a grow member" suggestion (§4.5), and the gap slots (§2.4) wired to the store's
`＋Create` / request door — turning "the OS is missing invoicing" into a build signal.

**New code total:** one data registry (six Kit rows), one pure `fitKit` function, one install card, the
Bank home layout, and one pipeline wire. Everything load-bearing — the listing model, the resolver, the
context library, the establishment flow, the routines shape, Bank — already exists and is cited above.
That is the "minimal new engine" bar this codebase holds every feature to.

---

## 6. Open questions

- **Sector ambiguity.** A business can be two sectors (a DTC brand that's also a marketplace; a SaaS
  with an agency arm). Does a founder get one OS with a merged spine, or two switchable OSes? Leaning:
  one active OS with the dominant spine, the second offered as a `switch ▾` sibling (Bank already
  switches projects). The `retail`→DTC-vs-local split (§2.2) is the first place this bites — resolve it
  with one follow-up question, not a guess.
- **Kit versioning.** When the catalog gains a wrapp that belongs in the DTC OS, do existing DTC-OS
  users get it auto-suggested (grow, §4.5) or silently added? Must be suggested, never auto-installed —
  the anti-bloat covenant (§1.2) forbids a bundle that grows behind the user's back.
- **The gap-to-wrapp loop.** Should a labelled gap (§2.4) be a first-class "request/commission a wrapp"
  action (tying into monetization / the ＋Create door), so the most-requested gaps become the build
  queue? This is where Idea OS stops being a bundle and becomes a *demand signal* for the whole store.
- **Monetization unit.** A sector Kit is a natural Pro-tier / rev-share unit (the Spotify-style model,
  memory `relay-monetization-model`) — "the DTC OS" as a thing people subscribe to. Deliberately out of
  scope here; noted so it isn't designed away.
- **Team OS.** An agency/marketplace OS is inherently multi-person. Does Team Mode (memory
  `relay-team-mode`) compose with a Kit — N people sharing one OS over one folder — for free, given it
  needs no protocol changes? Likely yes; worth proving before §3.3 ships for real teams.
