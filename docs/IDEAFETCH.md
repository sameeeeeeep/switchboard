# ideafetch — the existing-brand front door (ingest a project you already have)

**Status:** design note / full spec. **Author:** thread-a handoff — "spec ideafetch completely."
**Related:** [BRAND-EXTRACTION.md](./BRAND-EXTRACTION.md) (the `sb_brand` extractor root-cause + the
three-implementations diagnosis), [BANK-MAKEOVER.md](./BANK-MAKEOVER.md) (the "define your project"
multi-select mode + Bank as the context home), [FIRST-PROJECT.md](./FIRST-PROJECT.md) (folder
ingestion, the `~/.claude/projects` picker, two-pass ingest), [CONTEXT-KINDS.md](./CONTEXT-KINDS.md)
(the `brand`/`project`/`idea`/`personal` field conventions), [CAPABILITIES.md](./CAPABILITIES.md)
(`sb_http`/`sb_brand`), [VISION.md](./VISION.md).
**Code cited (all paths repo-root-relative):**
[`packages/bank-mcp/bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs) (daemon fetch),
[`packages/bank-mcp/brand.mjs`](../packages/bank-mcp/brand.mjs) +
[`packages/bank-mcp/project.mjs`](../packages/bank-mcp/project.mjs) (pure parsers),
[`packages/sidekick/src/context/library.ts`](../packages/sidekick/src/context/library.ts) (the library),
[`examples/apps/src/store/point.js`](../examples/apps/src/store/point.js) (the store front door),
[`examples/apps/src/core/ideabrain.core.js`](../examples/apps/src/core/ideabrain.core.js) (`brief`),
[`packages/protocol/src/rpc.ts`](../packages/protocol/src/rpc.ts) (the method table).

---

## 0. TL;DR

**ideabrain reasons about a NEW idea; ideafetch GATHERS an EXISTING one.** ideabrain
([`ideabrain.core.js`](../examples/apps/src/core/ideabrain.core.js)) takes a one-line idea and
*invents* a validated thesis. ideafetch is its mirror image: for a founder who **already has** a
brand, a company, a repo, a folder of work, it *reads what actually exists* and turns it into the
one project context every wrapp grounds on. Per the founder's decisions, **brand extraction is part of
ideafetch**, **project-establishment is part of ideafetch**, and the "ideabrain logic for an existing
brand" *is* ideafetch. So this doc unifies three things that are scattered or absent today under one
front door:

1. **The readers** — website (→ the daemon `sb_brand` extractor, which fixes the CORS/guessing bug),
   git repo, local folder (+ the `~/.claude/projects` picker), arbitrary URLs, pasted text. Each
   produces a **provenance-tagged fact pool**.
2. **The "define your project" multi-select** — the user *selects and confirms what their project
   actually is* (category, audience, essence, goals), driving it themselves. Its **own state machine**,
   distinct from ideabrain's suggest-options card loop.
3. **One output** — a single `kind:"project"`/`kind:"brand"` context
   ([CONTEXT-KINDS.md](./CONTEXT-KINDS.md)) that Bank shows and `active(origin)`
   ([`library.ts:77`](../packages/sidekick/src/context/library.ts)) lends to every connected wrapp.

`grep -ri ideafetch` over the repo still returns nothing — the *name* is new, but almost every *part*
already ships and is tested. ideafetch is **wiring** (`sb_brand` + the context library + a new front
door), not a new engine. That is the whole point.

---

## 1. Positioning — ideafetch ⟷ ideabrain (two doors, one library)

The catalog already has one door for people with only an idea. ideafetch is the door for people who
already built something. They meet at the same output — a published context set active — and can chain.

| | **ideabrain** (exists) | **ideafetch** (this spec) |
|---|---|---|
| The user has | a one-line idea | a real brand / repo / folder / site |
| Core verb | **reason** — pressure-test a bet | **gather** — read what's already there |
| Truth source | web-grounded model invention (cite-or-omit) | the user's own bytes (CSS, `package.json`, catalogue) + the user's own selections |
| Failure mode | plausible-but-wrong invented facts | honest emptiness ("no colours read", "nothing here yet") |
| Headless seam today | `brief()` ([`ideabrain.core.js:66`](../examples/apps/src/core/ideabrain.core.js)) | *none yet* — this doc's build target |
| Output context kind | `kind:"idea"` | `kind:"project"` / `kind:"brand"` |
| When | "I have an idea, is it good?" | "I have a thing, make Switchboard understand it" |

They are **complementary and chainable**: ideafetch captures what IS, then hands a rich context to
ideabrain to validate a new direction — a defined project is far better `brief` input than a one-liner
(§7). The store's first-project gate already frames the ideafetch job as *"point at it and it's
yours"* ([`point.js:1-6`](../examples/apps/src/store/point.js)); this doc names it, generalizes its
inputs, and gives it the multi-select the pointer flow lacks.

**Scope note.** ideafetch **subsumes** two things currently living elsewhere: the store's
`point.js` first-project pointer flow, and the folder two-pass ingest of
[FIRST-PROJECT.md](./FIRST-PROJECT.md). Those become *ideafetch inputs*, not separate features. The
in-Bank "Establish a project" front door ([BANK-MAKEOVER.md §2.2](./BANK-MAKEOVER.md)) is
ideafetch rendered inside Bank. One engine, three surfaces (store home, Bank, God).

---

## 2. Inputs — the six readers and the fact pool

Every reader ends at the same intermediate object: a **provenance-tagged candidate-fact pool**. The
pool is what the multi-select seeds its chips from (§4), what ideabrain's `brief` grounds on (§7), and
what composes into the published context (§5). Six pointers, one pool.

```
                 ┌──────────────────── ideafetch readers ─────────────────────┐
  website  ──────►  sb_brand (daemon fetch → brand.mjs)      → brand facts     │
  git repo ──────►  sb_http + gatherRepo/buildProject        → project facts   │
  local folder ──►  storage.bind + storage.get + buildProject → project facts  │──►  FACT POOL
  URL(s) ────────►  sb_http (docs/competitor pages)          → prose + links   │    (provenance-
  pasted text ───►  model over provided text (no fetch)      → positioning cues│     tagged)
  own vault ─────►  relay.storage.list + notes               → prior decisions │
                 └────────────────────────────────────────────────────────────┘
```

### 2.1 Website → `sb_brand` (the headline reader; fixes the flakiness)

**The bug being fixed.** Today three brand-from-URL implementations exist and only one is robust
([BRAND-EXTRACTION.md §1.1](./BRAND-EXTRACTION.md)): the daemon extractor
([`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs) `gatherSite` + [`brand.mjs`](../packages/bank-mcp/brand.mjs))
reads the site's *real* HTML/CSS/`products.json` and parses bytes; the two user-facing surfaces (the
brandbrain clone route and the store's `point.js` `readSite`) run **in the browser tab**, where a
cross-origin `fetch` is CORS-blocked and silently degrades to *asking a model to recall the brand* —
invented hexes, zero products. ideafetch's website reader **must** be the daemon path.

**The capability.** ideafetch's website reader is `sb_brand`, realised over `sb_http`
([CAPABILITIES.md §A, line 126](./CAPABILITIES.md); [BRAND-EXTRACTION.md §2.1](./BRAND-EXTRACTION.md)).
It is a thin daemon wrapper that lifts the already-shipping, already-tested machinery:

- **Fetch, server-side (no CORS).** Reuse `gatherSite(u)`
  ([`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs)) verbatim: homepage HTML + up to 4 same-origin
  stylesheets + `fetchCatalog(origin)` (Shopify `/products.json?limit=250` paged to 8, with the bare
  endpoint as bot-block fallback). Because the daemon does the fetching server-to-server, CORS
  disappears and the forbidden `user-agent` header (`UA`, [`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs))
  is allowed.
- **Parse, in-tab-safe.** Feed the returned bytes to the pure parsers in
  [`brand.mjs`](../packages/bank-mcp/brand.mjs): `extractColorSignals` → `rankPalette` (weights CSS
  custom properties by name — `--brand/primary/accent/cta` strong, chrome demoted, derived ramps
  ×0.15, `theme-color` meta = 100, Shopify Dawn RGB triplets handled), `parseShopifyProducts`,
  `summarizeCatalog`, `parseMeta`, `parseSocialLinks`, then `buildBrand` → `brandToContext`. These are
  pure and unit-tested (`brand.test.mjs`) and run unchanged on daemon-returned bytes.
- **Result shape** (the new `rpc.ts` row, per [BRAND-EXTRACTION.md §2.1](./BRAND-EXTRACTION.md)):

  ```ts
  // packages/protocol/src/rpc.ts — new BYOPMethods row
  sb_brand: {
    params: { url: string; name?: string };
    result: {
      domain: string; siteName?: string; description?: string; platform?: string;
      currency?: string; ogImage?: string;
      palette: { hex: string; from: string }[];   // provenance-tagged, from served CSS
      products: { short: string; price: number|null; type: string; url?: string }[];
      category?: string; priceRange?: { min: number; max: number };
      socials: { label: string; url: string }[];
      reachable: boolean;                          // false ⇒ site couldn't be read — HONEST, never guessed
    };
  }
  ```

`reachable:false` (dead/JS-only site, bot-block) is a **first-class honest state** — ideafetch offers
the repo/folder/paste reader instead of fabricating (§6). This kills the silent `facts===null`
fallback the clone route has today.

### 2.2 Git repo → `sb_http` + `buildProject`

A public GitHub repo. The daemon fetches `README.md`, `package.json`, and (fallback) the repo landing
page via `sb_http` — the same order `point.js` `repoPrompt` uses
(`raw.githubusercontent.com/<o>/<r>/HEAD/...`, [`point.js:242`](../examples/apps/src/store/point.js)),
but server-side so it is not a model guessing over WebFetch text. Structure the bytes with
`gatherRepo`-style extraction → `buildProject` ([`project.mjs:50`](../packages/bank-mcp/project.mjs)),
which is **deterministic, no model required** for the core (README H1 → name, blockquote → summary,
`package.json` deps → `stack`, `docs/*.md` H1s, `ROADMAP.md` bullets, open `- [ ]` tasks). Output:
`kind:"project"` facts. A private repo is `reachable:false` → route to the folder reader (that repo is
probably on disk).

### 2.3 Local folder → `storage.bind` + `buildProject` (the strongest privacy story)

The founder's primary path and the product's strongest privacy claim: **no web tools at all, bytes
never leave the machine** ([FIRST-PROJECT.md §1.2](./FIRST-PROJECT.md);
[`point.js:559`](../examples/apps/src/store/point.js)). Mechanically it is a **storage bind**, not a raw
FS read:

```
NSOpenPanel / pasted path ─► relay.storage.bind(path)   (daemon path-consent — user approves the folder)
                            ─► relay.storage.list()      (keys under the bound folder)
                            ─► relay.storage.get(k)      (file bodies, read on THIS machine, no network)
```

Reuse `point.js` `readFolder` exactly: the two-consent bracket (bind **out** to the folder, then
`restoreBind` **back** to the page's sandbox the instant the bytes are in memory,
[`point.js:604-610`](../examples/apps/src/store/point.js)), `FOLDER_PRIORITY`
(`README.md`/`package.json`/`ROADMAP.md`/`CLAUDE.md` first), `pickFiles` (priority + `docs/*.md` +
top-level `*.md`, capped 14), and the 24 KB corpus cap. Marker gate: a folder is a project only if it
carries a `PROJECT_MARKERS` entry ([`project.mjs:15`](../packages/bank-mcp/project.mjs)) — *"a
screenshots folder is not a project."* No markers → honest "nothing here to read yet" (§6).

**Two-pass depth** (from [FIRST-PROJECT.md §2](./FIRST-PROJECT.md), folded in as ideafetch's folder
reader):
- **Pass A** (seconds, blocking-but-legible): deterministic `buildProject` + one cheap model reading
  → published + set active before the user looks away.
- **Pass B** (background daemon one-shot, sleeps when done, R4 device-lightness): re-reads deeper,
  republishes the **same stable id** as a *superset* (never drops `folder` or the confirmed summary).
  Progress is a glanceable "deepening… → understood — 24 files, 6 docs, 11 open tasks" pulse, not a
  screen the user watches.

### 2.4 The `~/.claude/projects` discovery picker (folder reader, high-delight)

Instead of hunting in NSOpenPanel, enumerate `~/.claude/projects/` — Claude Code stores one directory
per working folder, **dash-encoding the cwd** (`/Users/me/Documents/relay` → `-Users-me-Documents-relay`;
~70 dirs on this machine). Decode each dir name back to a path, `existsSync`/`statSync`-validate
(the naive `-`→`/` decode is lossy when a real folder name contains a hyphen — only offer candidates
that resolve cleanly), and present as one-tap pointer candidates
([FIRST-PROJECT.md §1.3](./FIRST-PROJECT.md)). **Boundary:** read only the **directory names** to
recover paths — never the session transcripts inside them; the ingested content always comes from the
real work folder via `storage.bind`, behind the same consent.

### 2.5 Arbitrary URL(s) → `sb_http` (docs, competitors, link-in-bio)

Non-storefront URLs — a docs host, a wiki, a competitor's site — read via `sb_http` server-side. A
**docs URL** folds prose summary + `links` into the project (no palette/catalogue). **Competitor
URLs** produce a real `alternatives` set for ideabrain to reason over instead of invented ones
([BANK-MAKEOVER.md §4.1](./BANK-MAKEOVER.md)). Multiple URLs may be attached to one establishment and
merge under one id (§5).

### 2.6 Pasted text → model over provided text (no fetch)

The escape hatch for everything unreachable: the user pastes their about copy, a deck, a positioning
doc. No fetch, no bind — a single model pass structures the text into positioning language, audience
cues, and goals *in the user's own words*. This is also the fallback offered whenever a fetch reader
returns `reachable:false`.

### 2.7 Widen the readers past Shopify (the secondary-fragility fixes)

Present even server-side ([BRAND-EXTRACTION.md §1.3](./BRAND-EXTRACTION.md)), address in ideafetch's
reader layer:
- **Non-Shopify catalogues** — `/products.json` is the *only* product source today
  ([`brand.mjs` `parseShopifyProducts`](../packages/bank-mcp/brand.mjs)). Add WooCommerce Store-API /
  Squarespace / sitemap / JSON-LD `Product` fallbacks so non-Shopify stores don't yield zero products.
- **About/positioning copy** — read the about/hero/meta-description for the brand's own words, not
  just colours and SKUs (feeds the essence dimension in §4).
- **JS-rendered sites** — an SPA shell gives a weak palette; flag `reachable:false` honestly and offer
  the repo/folder/paste reader rather than guessing.

### 2.8 Security invariants (all already in the code to lift)

- **SSRF guard.** `safeUrl` ([`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs)) rejects loopback,
  RFC-1918 (`PRIVATE_HOST`), `.local`/`.internal`, and non-http(s). A URL reaching this tool comes
  from a model or a paste and must **never** be a lever onto the local network. `sb_http` adds: no
  `file://`, no cloud-metadata IPs, per-origin rate/byte budgets ([CAPABILITIES.md §A](./CAPABILITIES.md)).
- **Byte/time budgets, grant-visible.** `MAX_BYTES` 4 MB + per-request timeouts already exist in
  `get()` ([`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs)); surface them in the grant.
- **Read posture.** GET-only on public pages, no credentials → runs inside the grant with no per-call
  prompt (like storage reads). The one connect prompt names it: "Read a brand's public website."
  ([CAPABILITIES.md §Model.3, posture](./CAPABILITIES.md)).
- **Folder = path-consent.** No folder read without the `storage.bind` approval the user sees; the
  `~/.claude/projects` picker still requires the bind before any file opens.
- **Origin isolation + audit.** Inherited from the capability registry for free.

---

## 3. The "define your project" multi-select — ideafetch's own interaction

The readers gather; the multi-select is where the **user asserts what their project actually is**. This
is the founder's requested inverse of ideabrain: not "the AI proposes, you pick a proposal" but "you
select from a palette of concrete facts drawn from your own material, and the AI merely structures."
It has its own logic, its own UX, and its own state machine — all distinct from ideabrain's card loop.

### 3.1 Two engines, contrasted (why this is not the card loop)

ideabrain is a **suggest-options** engine ([`ideabrain.core.js:12-14`](../examples/apps/src/core/ideabrain.core.js),
verbatim `STUDIO_SYSTEM`): *"generate OPTIONS for each piece of the brand… as structured cards they
pick from. Each option is a genuinely different direction."* One decision → model generates option
cards → user **single-picks** one → locks → next decision.

The define-your-project engine **inverts every axis** ([BANK-MAKEOVER.md §3.1](./BANK-MAKEOVER.md)):

| | ideabrain (suggest-options) | define-your-project (ideafetch) |
|---|---|---|
| Who decides content | the **model** invents each option | the **user** selects/asserts each facet |
| Interaction | **single-select** one card per decision | **multi-select** many chips per dimension |
| AI's job | **generate** genuinely-different directions | **structure & seed** — offer facets, dedupe, name gaps |
| Grounding | web-grounded invention (cite-or-omit) | the user's own material (§2 pool) + free-text add |
| Failure mode | plausible-but-wrong invented facts | empty until the user asserts (honest blank) |
| Order | sequential lock loop, template-fixed | flat, order-free selection accumulator |
| Model calls | one per decision (13–15) | **one, at Define** — to structure, never to produce |
| Output | validated `kind:"idea"` thesis | defined `kind:"project"`/`"brand"` context |

The model's role shrinks from **generator** to **structurer**. It never invents three positioning
directions for you to choose between; it lays out the **dimensions** and offers **concrete, checkable
facets seeded from what the readers found**, which you multi-select and extend. **The checkbox, not
the AI's card, is the unit of truth.**

### 3.2 The four dimensions + the seeding rule

Four dimensions, each a row of multi-selectable chips plus an always-present **"+ add your own"**:

| Dimension | Multiplicity | Seeded from (the §2 pool) |
|---|---|---|
| **CATEGORY** — what kind of thing this is | pick **1–2** (slug sanity) | brand `category`/`catalog.category`, repo `stack`, product `type`s |
| **AUDIENCE** — who it's for | pick all that apply | brand `audience` copy, about-page cues, prior vault decisions |
| **ESSENCE** — the non-negotiables that make it itself | unbounded | brand `voice`/`positioning`, hero copy, README summary |
| **GOALS** — what winning looks like right now | unbounded | `ROADMAP.md`/open tasks, synced channel action items, pasted text |

```
╭─ Define your project ──────────────────────────────────────────────╮
│  What is this project about? Check what fits — add anything missing.│
│                                                                    │
│  CATEGORY   (pick 1–2)                                             │
│   ▣ D2C brand   ▢ marketplace   ▣ press-on nails   ▢ SaaS   + add  │
│  AUDIENCE   (all that apply)                                       │
│   ▣ Gen-Z women  ▣ tier-2 India  ▢ salons  ▢ gifting   + add       │
│  ESSENCE    (the non-negotiables)                                 │
│   ▣ salon-quality in minutes  ▣ maximalist/desi  ▢ cruelty-free   │
│   ▢ "premium without the city tax"                       + add     │
│  GOALS      (your live ones)                                      │
│   ▣ hit ₹1cr/mo  ▢ 3 new SKUs by Diwali  ▢ open 5 salons  + add    │
│                                                                    │
│  seeded from: nailinit (brand) · your last 3 notes    [ Define → ] │
╰────────────────────────────────────────────────────────────────────╯
```

**Seeding ≠ suggesting** (the load-bearing distinction, [BANK-MAKEOVER.md §3.2](./BANK-MAKEOVER.md)):
- A chip is a **fact drawn from the user's own material** — "press-on nails" comes from the extracted
  catalogue `category`, "maximalist/desi" from a brand's `voice`. **Unchecking is as meaningful as
  checking.**
- The model may add a few **gap chips**, plainly marked as prompts not claims ("you haven't said who
  it's for — is it any of these?"). A gap chip is a *question*, never an asserted fact.
- **"+ add your own" is first-class**, not an escape hatch — the user's typed essence outranks any
  seeded chip (§5 merge rule 2).
- If the readers found nothing for a dimension, it starts **empty with only "+ add"** — honest blank,
  never a plausible invented fill.

### 3.3 The state machine (flat accumulator, one structuring call)

Distinct from the studio's sequential lock loop
(`brief → detectIdeaCategory → [research → thesis → plan → prove → deck]`, each stage a
generate-then-single-pick turn that cannot proceed until the prior locks). ideafetch's define engine
is a **flat, order-free selection accumulator** with a single model call at the end:

```
   ┌──────────┐  readers done   ┌────────────┐   Define    ┌─────────────┐   ┌─────────┐
   │  SEED    │ ──────────────► │ SELECTING  │ ──────────► │ STRUCTURING │─► │ DEFINED │
   └──────────┘                 └────────────┘             └─────────────┘   └─────────┘
   gather §2 pool                 ▲    │                    model clusters      │  publish +
   → chips per                    └────┘                    near-dupes, names   │  setActiveProject
   dimension                   toggle chips / add           the project;        │
   (NO model claims)           free-text, ANY               INVENTS NOTHING     ▼
                               dimension, ANY order                          re-open → SELECTING
                                                                             (current picks pre-checked)
```

- **SEED** — the readers' fact pool is fanned out into chips per dimension. Zero model claims here;
  chips are literal facts with provenance.
- **SELECTING** — all four dimensions live at once. The user toggles chips and types free-text in any
  order, any number of times. No ordering constraint, no generation step, nothing locks. This is the
  founder's *"the user selects what their project is about"* made literal.
- **STRUCTURING** — the single model call on `Define`. Its **only** jobs: cluster near-duplicate
  selections, pick a project name/slug, and flatten to the `kind:"project"`/`"brand"` shape. It is
  closer to `brief`'s one-shot `normalizeBrief` ([`ideabrain.core.js:46`](../examples/apps/src/core/ideabrain.core.js))
  than to the card loop — cheap, and structurally **cannot hallucinate a project the user didn't
  assert** (prompt: *"cluster and name; invent nothing; return the CONTEXT-KINDS JSON"*).
- **DEFINED** — publish + `setActiveProject`. Re-opening re-enters SELECTING with current selections
  pre-checked, so **"edit my project's essence" and "define my project" are one flow** — the
  multi-select *is* the editor for what Bank's hero shows ([BANK-MAKEOVER.md §3.4](./BANK-MAKEOVER.md)).

### 3.4 Where define sits relative to the readers

The readers and the multi-select compose two ways:

1. **Reader → define** (the rich path). Point at a site/repo/folder → readers fill the pool → chips
   arrive pre-seeded and pre-checked with high-confidence facts → the user prunes and adds. This is
   the "start rich" flow.
2. **Define cold** (the "just an idea, but I know it" path, [BANK-MAKEOVER.md §2.2](./BANK-MAKEOVER.md)
   "○ just an idea → define it"). No reader ran; every dimension starts at "+ add" plus any gap chips.
   The user asserts from scratch. Honest blank, not a form the AI pre-fills with guesses.

Both end at the same `project-<slug>.md` and the same publish call.

---

## 4. The whole-reading confirm (the readers' counterpart to multi-select)

The readers have their **own** confirmation UX — the "three readings, byte-identical facts" pattern
already built in `point.js` ([`point.js:8-23`, `landReadings:433`, `screenFound`, `screenConfirm`](../examples/apps/src/store/point.js)).
ideafetch keeps it verbatim; it is the doctrine that makes extraction honest:

- **Never forms-first.** After a reader runs, the user confirms *whole readings* (one ★ recommended),
  never authors a blank field. `factsStrip` renders the shared facts **once**, visibly not part of the
  choice.
- **Three readings, byte-identical facts.** The three cards differ only in *interpretation* (the lens);
  the `facts` block is extracted once and identical across all three
  ([`SHARED_RULES`, `point.js:182`](../examples/apps/src/store/point.js)). Three different "facts"
  would mean the extractor was guessing.
- **Palette honesty is verified, not trusted.** For any model-read palette, `verifyHexes`
  ([`point.js:167`](../examples/apps/src/store/point.js)) string-matches every returned hex against the
  raw bytes; zero survivors renders an honest "no colours read" note pointing at the real extractor.
  (`sb_brand` sidesteps this entirely — its palette comes from `rankPalette` over served CSS, provenance
  attached — but the verify layer stays as defense for any URL/paste reader that still routes through a
  model.)
- **Facts are removable, never typed.** A user can drop a fact that doesn't belong (`dropFact`,
  [`point.js:721`](../examples/apps/src/store/point.js)); they can't type a new one into the facts
  strip — that's what keeps facts traceable to what was actually read.

**The two confirm surfaces, side by side.** Readers → *whole-reading confirm* (extracted facts, you
confirm/prune). Define → *multi-select* (dimensions, you assert/select). A rich establishment uses
both: read the site, confirm the reading, then optionally open define to add audience/goals the site
never stated. Both write the same context.

---

## 5. Output — one context, and how inputs compose into it

The critical design choice: the six readers + the multi-select are **not** separate library entries the
user juggles. They **merge into one active `kind:"project"`/`"brand"` context** so every wrapp grounds
on one object ([FIRST-PROJECT.md §3.2](./FIRST-PROJECT.md)). The context model makes this clean because
`data` is **opaque and additive** ([CONTEXT-KINDS.md §Conventions](./CONTEXT-KINDS.md)): a field merge
under one stable id.

### 5.1 The published object

`publish` ([`library.ts:48`](../packages/sidekick/src/context/library.ts)) then `setActiveProject`
([`library.ts:83`](../packages/sidekick/src/context/library.ts) → the `*global*` key). The shape is
the CONTEXT-KINDS convention; a repo-that-also-has-a-website legitimately carries **both** project and
brand fields (superset rule), so Redline sees `folder`/`roadmap` *and* adgen sees `palette`/`products`
from the same one context, each reading only the fields it knows and defensively ignoring the rest
([CONTEXT-KINDS.md §Normalize defensively](./CONTEXT-KINDS.md)):

| Source | Pointer | Contributes to `data` |
|---|---|---|
| Folder (Pass A + B) | `storage.bind` | `summary`, `state`, `status`, `stack`, `packages`, `docs`, `files`, `roadmap`, `tasks`, **`folder`** |
| Repo | `sb_http` | same project fields; `source.kind:"github"` |
| Site (brand) | `sb_brand` | `voice`, `positioning`, `audience`, `oneLine`, `palette` (provenance), `products`/`productsRich`, `category`, `priceRange`, `domain`, `logo`, `socials` |
| Docs/other URL | `sb_http` | `links`, richer `summary` |
| Define multi-select | user selections | `category`, `audience`, `essence`(→ positioning/voice), `goals`(→ roadmap) |

### 5.2 Merge rules (write these into the composing surface)

1. **One stable id** — the folder/repo/domain slug (`slugify`,
   [`project.mjs:8`](../packages/bank-mcp/project.mjs)). Every input republishes under it →
   **update-in-place, never duplicate** ([`library.ts:49`](../packages/sidekick/src/context/library.ts)).
   `data.source` ([CONTEXT-KINDS.md §Provenance](./CONTEXT-KINDS.md)) records which pointer last wrote.
2. **Never overwrite a confirmed field with a lower-confidence one.** Deterministic/verified facts
   (folder `stack`, CSS `palette`) beat model prose; the user's inline edits and multi-select
   assertions beat both.
3. **`folder` is sticky.** Once set from the folder pointer it is never dropped by a later URL
   republish — it is the load-bearing binding `folderOf()` reads
   ([`library.ts:136`](../packages/sidekick/src/context/library.ts)) to auto-bind a wrapp's storage to
   the real directory when the project is lent.
4. **Publish a superset, not a slice.** Pass B / a later URL carries forward earlier fields and adds to
   them ([CONTEXT-KINDS.md §"Publish a superset"](./CONTEXT-KINDS.md)); consumers read the whole active
   context each time, so every wrapp sees the richer version on its next read — no migration.
5. **Provenance stays honest.** If a URL was unreachable, say so in `links`/UI — don't silently drop it.
6. **Flatten at the publish boundary.** `palette`/`products` are FLAT strings (`brandToContext`,
   [`brand.mjs:358`](../packages/bank-mcp/brand.mjs)); named swatches ride alongside as `paletteRich`.
   A nested object where a consumer expects flat renders `"[object Object]"` — the canonical bug this
   contract prevents.

### 5.3 What "established" buys — the payoff

Once active, **every connected wrapp sees it** through `active(origin)`
([`library.ts:77`](../packages/sidekick/src/context/library.ts): the app's own pick, else the global
project), and God folds it into its system prompt. One establishment, whole-shelf effect: adgen shoots
from the palette, Redline reviews the real files on disk, Bank opens the real vault — *"no blank
fields, no re-typing"* ([BRAND-EXTRACTION.md §3.3](./BRAND-EXTRACTION.md)). Bank's hero
([BANK-MAKEOVER.md §2.3](./BANK-MAKEOVER.md)) renders the four facets (understanding / brand / files /
decisions) of exactly this object.

---

## 6. All states

ideafetch is a state machine over "point → read → confirm/define → establish." Every state has an
honest rendering; none fabricate to fill a card.

| State | Trigger | What the user sees | Exit |
|---|---|---|---|
| **EMPTY / idle** | library cold; front door open | the six pointers + input + `~/.claude/projects` candidates; privacy line | pick a pointer → INGESTING, or "just an idea" → SELECTING (cold define) |
| **INGESTING / loading** | `Read it ▸` | live step log for fetch readers (`step`/`setLive`, [`point.js:355`](../examples/apps/src/store/point.js): "reading nailin.it…", "page read · 4 kb", "drafting three readings…"); blocking-but-legible; cancellable | facts land → FOUND; nothing read → ERROR |
| **PARTIAL** | reader got *some* bytes | facts strip shows what was read; empty facets say "the site doesn't say" / "no colours read"; define chips seed from what exists | confirm partial → DEFINED, or add a second reader (URL/paste) to enrich under same id |
| **LOW-CONFIDENCE** | thin copy / SPA shell / non-Shopify (weak palette, few products) | the reading is shown but flagged; `verifyHexes` may drop all hexes → "no colours read — this page can only see text, not CSS it serves" with a pointer to the real extractor | offer paste/folder reader; or accept the thin reading honestly |
| **CONFLICT / MERGE** | a second pointer, or re-read, disagrees with a confirmed field | show both values with provenance ("folder says stack: TS; site says…"); merge rules §5.2 decide precedence, user can override | resolve → republish superset under same id |
| **ERROR / unreachable** | `reachable:false`, CORS/bot-block, 404 private repo, declined bind, no markers | plain-language cause + a `transfer` to a different pointer (`blocked(...,{transfer})`, [`point.js:394,514,551,584`](../examples/apps/src/store/point.js)): "nailin.it wouldn't let your Claude read it → try the folder" | retry with another reader; the draft you already had is kept, never discarded |
| **SELECTING** (define) | reader done, or cold define | the multi-select facet board (§3.2); dimensions live, chips seeded, "+ add" | `Define →` → STRUCTURING |
| **STRUCTURING** | `Define` | one model call clustering/naming; glanceable "structuring…" | → CONFIRM/DEFINED |
| **CONFIRM** | reading picked, or define structured | editable card + facts strip; per-line `↻` re-draft from cached read (never re-fetch); name + kind pill | `Bank it` → establishing |
| **DEFINED / ready** | `publish` ok | "Project established. Every wrapp now opens pre-loaded" + the READY wrapp list ([`READY`, `point.js:109`](../examples/apps/src/store/point.js)); ★ set as my project done | done — rung complete, never nags again ([FIRST-PROJECT.md §1.1](./FIRST-PROJECT.md)) |
| **DEEPENING** (folder Pass B) | after Pass A publishes | project card shows "deepening…" → "understood — N files, M docs, K tasks" when Pass B republishes; background, no screen to watch | card just gets richer |

**Resumability.** The draft persists (`persist`/`restoreDraft`, [`point.js:323-348`](../examples/apps/src/store/point.js)):
resuming after a reload re-enters FOUND/CONFIRM with facts intact and *nothing re-fetched*. Cancelling
a re-read keeps the reading you already have (that read cost a fetch) — only a first read has nothing to
fall back to.

---

## 7. Composition with ideabrain and the Idea-OS pipeline

ideafetch is the **existing-brand entry** to the same pipeline ideabrain enters from the idea side.
They meet at the library and chain both directions.

### 7.1 ideafetch → ideabrain (validate in real context)

A defined project is far richer `brief` input than a one-liner. Widen `buildBriefPrompt`
([`ideabrain.core.js:31`](../examples/apps/src/core/ideabrain.core.js)) to take an optional
`grounding` block ([BANK-MAKEOVER.md §4.2](./BANK-MAKEOVER.md)):
- **The ideafetch pool** — if the user pointed at a site/repo first, pass the extracted
  brand/project so `brief` commits to the *real* category/audience/price band instead of inferring
  them (today `normalizeBrief` fills blanks by inference, [`ideabrain.core.js:46-58`](../examples/apps/src/core/ideabrain.core.js)).
- **The active project** — `active(origin)`/`activeProject()`
  ([`library.ts:77,84`](../packages/sidekick/src/context/library.ts)): validate *in its context* (same
  audience/market) unless told otherwise.
- **Prior decisions from the vault** — existing `kind:"idea"`/`kind:"project"` contexts, so a second
  idea builds on the first.
- **Personal card** — `kind:"personal"` ([CONTEXT-KINDS.md](./CONTEXT-KINDS.md)) for founder-why /
  geography / company.

Instruct the model to **prefer asserted facts over inference and cite which came from the pool** — the
cite-or-omit discipline the web-grounded thesis cards already use (the 🌐 cards,
[BRAND-EXTRACTION.md §4.1](./BRAND-EXTRACTION.md)).

### 7.2 ideabrain → ideafetch (the loop closes)

ideabrain's widget ends by publishing a `kind:"idea"` context and offering *set as my project*
([BRAND-EXTRACTION.md §4.2-4.4](./BRAND-EXTRACTION.md)). That validated thesis can then be *defined*
via ideafetch's multi-select (essence/audience/goals pre-seeded from the thesis) to graduate
`kind:"idea"` → `kind:"project"` once it's real — the same establishment primitive, a different
producer.

### 7.3 The Idea-OS pipeline (one library, four producers)

```
   ┌─────────────┐        ┌──────────────────────────────────────────┐
   │  ideabrain  │  new   │  the user-owned CONTEXT LIBRARY           │
   │  (reason)   │ ─idea─►│  (library.ts — publish/active/           │
   └─────────────┘        │   setActiveProject/folderOf)             │
   ┌─────────────┐  read  │                                          │   active(origin) lends
   │  ideafetch  │ ─pool─►│  kind:"idea" | "project" | "brand" |     │──► ONE context to
   │  (gather)   │ ─proj─►│           "personal"                     │    EVERY connected wrapp
   └─────────────┘        └──────────────────────────────────────────┘    (Bank hero, adgen,
   ▲ define multi-select        ▲ panel: kind:"personal"                    Redline, God, …)
   │ (assert)                   │
   └── readers: site/repo/folder/URL/paste/vault
```

ideafetch is the **gather** node; ideabrain the **reason** node; the library is the shared substrate;
`active(origin)` is the single wire that lends the result everywhere. This is the "Idea-OS": every
producer writes the same object shape, every consumer reads the one the user lent.

---

## 8. Build path (mostly wiring)

Ordered so each step unblocks the next; nothing here is a new engine
([BRAND-EXTRACTION.md §5](./BRAND-EXTRACTION.md), [BANK-MAKEOVER.md §5](./BANK-MAKEOVER.md),
[FIRST-PROJECT.md §5](./FIRST-PROJECT.md) all converge on this order):

1. **`sb_http`** ([CAPABILITIES.md §A](./CAPABILITIES.md)) — the daemon outbound proxy. Small, highest
   leverage; unblocks every in-tab fetch, not just brand. New `BYOPMethods` row in
   [`rpc.ts`](../packages/protocol/src/rpc.ts) + a capability module in the registry
   ([`packages/sidekick/src/server.ts`](../packages/sidekick/src/server.ts)); reuse `safeUrl`/`get`
   SSRF+budget logic from [`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs).
2. **`sb_brand`** over it — lift `gatherSite` + `brand.mjs` (`buildBrand`/`brandToContext`) into a
   capability handler returning the §2.1 result. Wire the store `point.js` `readSite` and the
   brandbrain clone route to it; **delete the `facts===null` guessing fallback**. *This is the fix for
   the reported flakiness.*
3. **`sb_project`** (or generic `sb_http` + in-tab `buildProject`) — the repo reader, server-side.
4. **The ideafetch front door** — the pointer surface (six readers) + the whole-reading confirm.
   Largely `point.js` generalized: add URL-list + pasted-text readers; add the `~/.claude/projects`
   picker (enumerate + decode + `existsSync`-validate). Fold in the folder two-pass
   ([FIRST-PROJECT.md §2](./FIRST-PROJECT.md)): Pass A in-tab/daemon, Pass B a `batch` daemon one-shot
   that republishes the same id as a superset and exits (R4 — no idle CPU).
5. **The define multi-select** ([BANK-MAKEOVER.md §3](./BANK-MAKEOVER.md)) — the four-dimension facet
   board + the single "structure these selections" model call (prompt: *cluster and name, invent
   nothing, return CONTEXT-KINDS JSON*). Seeds from the §2 pool; publishes `kind:"project"`; re-open
   pre-checks. No card loop.
6. **Reader widening past Shopify** (§2.7) — WooCommerce/Squarespace/sitemap/JSON-LD product
   fallbacks; about/positioning copy; honest `reachable:false` for JS-only sites.
7. **Surfaces** — the same ideafetch engine rendered in three places: the store home (`point.js`), the
   in-Bank "Establish a project" front door ([BANK-MAKEOVER.md §2.2](./BANK-MAKEOVER.md)), and a God
   skill so "set up the project I'm looking at" works in conversation
   ([FIRST-PROJECT.md §5.1](./FIRST-PROJECT.md)). All write the same `.md`/context.
8. **Richer ideabrain `brief`** (§7.1) — widen `buildBriefPrompt` to carry the ideafetch pool + prior
   decisions + active project.

**Reused unchanged:** the pure parsers ([`brand.mjs`](../packages/bank-mcp/brand.mjs),
[`project.mjs`](../packages/bank-mcp/project.mjs)) and their tests, the `.md` writers
(`brandToMarkdown`/`projectToMarkdown`), the publish path (`context.publish` + `setActiveProject`),
`folderOf`, the whole-reading confirm UX, and the `brief` workflow. The gap is the daemon capability
call and the two new front doors (readers, define) — not a new engine.

---

## 9. Privacy & device-lightness (non-negotiable)

- **Local ingestion, no upload.** The folder reader reads on this machine via `storage.bind`/`get`;
  nothing leaves the disk, the read runs on the user's own Claude through the broker, the operator
  never sees it ([FIRST-PROJECT.md §4](./FIRST-PROJECT.md)). Strongest privacy story in the product —
  preserve it exactly.
- **Consent is per-folder and visible.** No path read without the bind approval; the two-consent
  bracket + `restoreBind` shrink the window this page's own store points at the source tree to
  milliseconds. The `~/.claude/projects` picker reads only directory *names*.
- **No idle CPU.** Fetch readers are one-shots; folder Pass B is a daemon one-shot that exits; any
  re-ingest is a **routine that sleeps between fires**, never a file-watcher or poll loop
  ([FIRST-PROJECT.md §4](./FIRST-PROJECT.md); STORE-TAXONOMY R4).
- **Cheapest tier first.** Deterministic gather (free) before any model; the define engine spends
  exactly one structuring call; the readers spend zero-to-one model calls each.
- **Honest emptiness.** `reachable:false` said plainly; "no colours read" over an invented palette;
  "nothing here yet" over a junk seed. **An empty field is correct; a plausible fabrication is a lie
  that propagates into every downstream wrapp.**

## 10. Open questions

- **Multi-project folders.** `findProjects` ([`bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs)) turns
  a folder-of-repos into many projects. For *first* establishment, do we set **one** active and offer
  "seed the rest into Bank" as a follow-on? Leaning yes — one active project on first run, bulk-seed
  later ([FIRST-PROJECT.md §Open questions](./FIRST-PROJECT.md)).
- **Define before or after read.** When both a reader and define run, is define always *after* the
  read (enrich confirmed facts) or can it run *first* and let a later read fill gaps? Leaning: define
  is always post-read when a reader is used; cold-define is its own path (§3.4).
- **`sb_brand` vs `sb_http`-only.** Ship the high-level `sb_brand` (structured facts, no consumer
  re-implements the fan-out) as the headline, with `sb_http` underneath for the URL/repo readers? Both
  are complementary ([BRAND-EXTRACTION.md §2.1](./BRAND-EXTRACTION.md)); recommend both.
- **Where the base reader runs by default.** In-tab (store surface, no daemon capability needed) vs.
  daemon (so God can establish with no tab open). Both should share one implementation
  ([FIRST-PROJECT.md §Open questions](./FIRST-PROJECT.md)).
