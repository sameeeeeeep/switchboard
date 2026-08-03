# Bank makeover — the project-context home, and how a project gets DEFINED

**Status:** design note. **Author:** thread-a handoff — "how do we SHOW a user's project context."
**Related:** [BRAND-EXTRACTION.md](./BRAND-EXTRACTION.md) (the extractor root-cause + the ideabrain
widget + project-establishment already sketched), [CONTEXT-KINDS.md](./CONTEXT-KINDS.md) (the
`brand`/`project`/`idea`/`personal` field conventions), [CAPABILITIES.md](./CAPABILITIES.md)
(`sb_http`/`sb_brand`), [NOTCH-PANEL.md](./NOTCH-PANEL.md), [VISION.md](./VISION.md).
**Code touched:** [`examples/apps/src/bank.js`](../examples/apps/src/bank.js),
[`examples/apps/bank.html`](../examples/apps/bank.html),
[`packages/bank-mcp/`](../packages/bank-mcp) (`bank-mcp.mjs`, `project.mjs`, `brand.mjs`, `tasks.mjs`),
[`packages/sidekick/src/context/library.ts`](../packages/sidekick/src/context/library.ts),
[`examples/apps/src/core/ideabrain.core.js`](../examples/apps/src/core/ideabrain.core.js),
`examples/apps/src/store/point.js`, the external studio engine `lib/studio/spec.ts`.

---

## 0. TL;DR

The question "how do we **show** a user's project context" has one honest home: **Bank**. Bank
already renders projects, brands, tasks and notes side by side from a `.md` vault the user owns — so
the *viewer* exists. What's missing is that Bank **produces nothing**: every rich card it shows
(`project-*.md`, `brand-*.md`) is minted **elsewhere** — by the Bank MCP connector running in a
separate Claude thread, or published by another wrapp. Inside the Bank tab you can only create a plain
note or a task. So Bank is a beautiful shelf with no way to *put your project on it* from the shelf
itself.

This doc proposes three things, in one arc:

1. **Bank makeover** — turn Bank from a passive viewer into the place a project is **established,
   shown, browsed and edited**. Add an "Establish a project" front door that runs the daemon-side
   extractor in-app (via `sb_brand`/`sb_http`), and reorganize the seven flat sections into a
   **project-first** layout grounded in the same `.md`-vault storage that already exists.
2. **A new "define your project" ideabrain mode** — its **own logic**, distinct from today's
   suggest-options engine. Today ideabrain *generates AI options and the user picks one*. The new
   mode inverts that: it lays out the **dimensions** of a project (category, audience, essence, goals)
   and the user **multi-selects** what their project actually is — the user drives, the tool
   structures. This is how context gets *defined*, and its output is exactly what Bank *shows*.
3. **More context in ideabrain + ideafetch** — spec `ideafetch` (the ingest sibling that doesn't
   exist yet) and enumerate the extra facts each should gather/carry so a project starts rich instead
   of blank.

---

## 1. Why Bank "runs nothing today" — the diagnosis

Bank's own code tells the story. Trace what actually *creates* a card:

| What Bank SHOWS | Who PRODUCES it | Where that runs |
|---|---|---|
| **Projects** (`renderProjects`, `bank.js:485`; `project-<slug>.md`) | `bank_extract_project` / `bank_extract_projects` (`bank-mcp.mjs:239,263`) **or** a wrapp's `context.publish` | **A separate Claude thread / Claude Code session** running the MCP server — never the Bank tab |
| **Brands** (`renderBrands`, `bank.js:596`; `brand-<slug>.md`) | `bank_extract_brand` (`bank-mcp.mjs:303`) **or** brandbrain | The MCP server (daemon-side `gatherSite`, `bank-mcp.mjs:161`) — never the Bank tab |
| **The shelf** (`renderShelf`, `bank.js:698`) | Other wrapps / the side panel's "Your details" card | Elsewhere; Bank only lists `relay.context.list()` |
| **Board tasks** (`renderBoard`, `bank.js:724`) | Quick-add (`addTask`, `bank.js:813`), channel sync, or the connector's `bank_add_task` | Partly in-app — the one thing Bank *does* author |
| **Notes** (`renderNotes`, `bank.js:842`) | `bankIt` (`bank.js:301`) — the capture box | In-app — the other thing Bank authors |

So the two things Bank can create on its own are **a plain note** and **a task line**. Everything that
makes context *rich* — a project's stack/roadmap/docs, a brand's real palette and catalogue — is
extracted by a **Node MCP server the user has to wire into some other Claude** (`claude mcp add bank
-- node …/bank-mcp.mjs --vault ~/SwitchboardBrain`, `bank-mcp.mjs:10`). The Bank *web app* has no path
to that machinery.

**Why it can't just do it in-tab.** The robust extractor is deterministic *because* it reads the bytes
the site served (CSS custom properties → palette, `/products.json` → catalogue; `brand.mjs`). That
fetch is cross-origin, and in a browser tab it is **CORS-blocked** — the exact root cause documented
in [BRAND-EXTRACTION.md §1.2](./BRAND-EXTRACTION.md). So even if Bank grew a "point at your site"
button today, it would degrade to *asking a model to recall the brand* (invented hexes, zero
products). The daemon is the only place the read works.

**The consequence.** Bank is proactive on the edges — it auto-streams a daily brief
(`maybeBrief`, `bank.js:357`) and pulls to-dos from channels/projects (`maybeAutoSync`, `bank.js:1124`).
But the **central act** — "tell me what your project is, richly, and hold it" — happens *outside* Bank,
which is why it feels like it "runs nothing." The home surface for project context can display context
it did not gather and cannot itself gather. **The makeover closes that gap: give Bank the daemon
capability call and a first-class establish flow, so the shelf can be filled from the shelf.**

---

## 2. Bank makeover — the project-context home

### 2.1 What Bank should BE

> **Bank is where a project lives: the one surface that knows what you're working on, shows it whole,
> and lets you point-and-establish it, browse it, and edit it — all as plain `.md` you own.**

Three jobs, in priority order:

1. **Establish** — turn a pointer (a website, a repo, a folder, a one-line idea) into a rich,
   structured project **from inside Bank**, using the daemon extractor. Today this is the missing job.
2. **Show** — display the active project first and whole (understanding, brand, files, decisions,
   open work), with every other project one glance away. Bank already half-does this (`renderProjects`,
   `renderBrands`), but flat and undifferentiated — no notion of *the* project you're on.
3. **Edit** — the context is `.md` the user owns; editing is direct, reversible, and round-trips to
   Obsidian. Bank already does inline note edit (`bank.js:864`) and task toggle (`bank.js:829`); extend
   it to the project/brand cards, which are read-only today.

Nothing here breaks the storage model. It **is** the `.md` vault: `project-<slug>.md`,
`brand-<slug>.md`, `tasks.md`, and `n-*.md` notes in a folder the user binds (`renderVault`,
`bank.js:251`; an Obsidian vault works as-is). Everything below writes that same dialect.

### 2.2 The one new thing: "Establish a project" (Bank runs the extractor)

A new section at the **top** of Bank (above today's `01 bank it`), the front door BRAND-EXTRACTION.md
§3 designed but which currently only lives in the store's `point.js`:

```
╭─ Establish a project ──────────────────────────────────────────────╮
│  Point Bank at what you already have — it reads it, you confirm.    │
│   ○ a website    ○ a GitHub repo    ○ a folder on this Mac          │
│   ○ just an idea  (→ define it, §3)                                 │
│  [ yourbrand.com                                    ]   → Read it   │
╰────────────────────────────────────────────────────────────────────╯
        │
        ├─ website → sb_brand({url})        (daemon fetch: no CORS, real palette+catalogue)
        ├─ repo    → sb_project({repo})      (or the MCP extractor's buildProject over sb_http)
        ├─ folder  → storage.bind + local project read (buildProject, project.mjs)
        └─ idea    → the "define your project" multi-select  (§3)
        ▼
   "What we read from yourbrand.com" — provenance shown, whole readings confirmed (never a form)
        ▼
   Writes brand-<slug>.md / project-<slug>.md into the vault  →  the card appears in §Projects/§Brands
        ▼
   Offers ★ "set as my project" → setActiveProject(id)  (library.ts:83) → every wrapp opens pre-loaded
```

**What to build vs. what exists:**
- **Broken/absent today:** Bank has *no* extractor entry point. The robust one is daemon-only and
  reached solely through the MCP connector in another thread.
- **Build:** land **`sb_brand`** (and a sibling **`sb_project`**, or a generic **`sb_http`** the
  in-tab `buildProject`/`brand.mjs` parsers run over) per [BRAND-EXTRACTION.md §2](./BRAND-EXTRACTION.md).
  Then Bank calls `relay.brand({url})` / `relay.http(...)` instead of a CORS-doomed `fetch`. The
  parsers (`brand.mjs`, `project.mjs`) are **already pure and tested** (`brand.test.mjs`,
  `project.test.mjs`) — they run in-tab unchanged on daemon-returned bytes.
- **Reuse:** the `.md` writers (`brandToMarkdown`, `projectToMarkdown`) and the publish bridges Bank
  already has (`publishProject`/`publishBrand`, `bank.js:555,674`). The extractor's output is the same
  file the connector writes, so the connector and the in-app flow stay one storage dialect (the
  explicit design goal in `bank-mcp.mjs:5-8`).
- **Reuse the doctrine:** "three readings, byte-identical facts; never forms-first; `reachable:false`
  is honest" (BRAND-EXTRACTION.md §3.2). It's already written into `point.js:8-23` — Bank inherits it.

This single addition is what turns "runs nothing" into "the place you start."

### 2.3 The layout: project-first, not seven flat sections

Today's sections are a flat stack (`bank.html:190-261`): brief · `01 bank it` · `02 shelf` ·
`03 projects` · `04 brands` · `05 tasks` · `06 brain` · `07 ask`. Every project and brand renders at
the same weight; there is no "the thing I'm working on."

Reorganize around **the active project** (the `*global*` selection, `library.ts:83,116`):

```
┌─ NOW — the active project ─────────────────────────────────────────┐   ← new: the hero
│  ● Aamras          [brand · press-on nails]        ⌂ ~/vault/…      │
│  "Indian maximalist home fragrance, small batches."                │
│  ▸ understanding   ▸ brand (palette+catalogue)  ▸ files  ▸ decisions│   ← the four facets, §2.4
│  4 open tasks · brief ready · last read 2d ago      [ switch ▾ ]    │
└────────────────────────────────────────────────────────────────────┘
  today's brief …            (maybeBrief — now scoped to the active project's corpus)
  01 · establish / bank it   (the front door §2.2, then the capture box)
  02 · everything else       (the shelf — other projects/brands/data as switchable chips)
  03 · tasks                 (the board — active project's lists first)
  04 · the brain             (notes; filterable by [[project]])
  05 · ask the bank
```

- **The hero is the answer to "show me my project context."** One card, the active project, its four
  facets inline (§2.4). This is the SHOW deliverable — glanceable, whole, honest about provenance and
  freshness (`source.readAt`, CONTEXT-KINDS §Provenance).
- **`switch ▾`** re-uses `setActiveProject` — picking a different project re-homes the hero and, if the
  project carries `data.folder` (load-bearing, `folderOf`, `library.ts:136`), re-binds storage so the
  brief/board/notes all follow. One selection scopes the whole surface, exactly as `active(origin)`
  already lends one context to every app (`library.ts:77`).
- **The rest stays** — the shelf, board, brain, ask are unchanged in behavior; they just sort
  "active-project-first." No storage change, no new file types.

### 2.4 The four facets of a shown project (what "context" concretely is)

A project card should render four things, all already present as `.md`/context fields:

| Facet | Source today | Rendered from |
|---|---|---|
| **Understanding** | `data.summary` / `> summary` line + the `idea` decisions | `project-*.md` blockquote; `kind:"idea"` `problem`/`insight`/`solution` (bootstrap `ideaToContext:55`) |
| **Brand** | palette (from served CSS) + catalogue | `brand-*.md` `## Palette`/`## Products` (`parseSwatch`, `bank.js:589`) |
| **Files** | `data.folder` + `data.files`/`packages`/`docs` | CONTEXT-KINDS `project` fields; `folder` binds the vault |
| **Decisions** | the locked playbook + open tasks | `idea` `data.decisions`; board tasks under the project's list |

The makeover's job is to **compose these four into one card**, not invent new data. Where a facet is
empty, that's the CTA: no brand → "point at your site"; no understanding → "define your project" (§3);
no files → "bind a folder." Blank facets are the establish flow's entry points, never dead space.

### 2.5 Browse & edit (grounding in the `.md` vault)

- **Browse:** the shelf (`renderShelf`) and `[[wikilinks]]` (`bank.js:894`) already cross-link
  everything; keep them, and let a project chip filter the brain and board to that project (reusing
  `filterLink`). The `.md` graph *is* the browse model — Obsidian-parity for free.
- **Edit:** promote the project/brand cards from read-only to inline-editable, reusing the note editor
  (`bank.js:864`) since a card is just a `.md` file. Editing a swatch or a roadmap bullet rewrites the
  `project-*.md`/`brand-*.md` line, round-trips to Obsidian, and re-renders — same optimistic-write +
  revert-on-fail pattern as `toggleTask` (`bank.js:829`).
- **Re-establish:** a "re-read" button re-runs the extractor and updates in place (stable slug id →
  `updates in place`, CONTEXT-KINDS §Provenance). `source.readAt` shows staleness on the hero.

---

## 3. The "define your project" ideabrain mode — its own logic

### 3.1 The two engines, contrasted

Today's ideabrain is a **suggest-options** engine. Its system prompt is explicit
(`ideabrain.core.js:12-14`, verbatim from the studio):

> "…generate **OPTIONS** for each piece of the brand — name, positioning, audience, voice… as
> structured **cards they pick from**. Each option is a genuinely different direction."

The loop: one-line idea → `brief` expands it (`buildBriefPrompt`, `ideabrain.core.js:31`) →
`detectIdeaCategory(text)` picks a template (a 13–15 decision subset of the 46-task pool,
BRAND-EXTRACTION.md §4.1) → for **each** decision the model **generates option cards** → the user
**picks one** → it locks → the next decision builds on the locks. **The AI proposes; the user selects
among AI inventions.** Great for *exploration when you don't know yet*.

The founder wants the **inverse** for *defining a project you already understand*:

> A **define-your-project** mode where the user **multi-selects what their project is actually about**
> — truly selecting their own project's essence — instead of being fed suggestions.

Here the AI's role shrinks from **generator** to **structurer**. It does not invent three positioning
directions for you to choose between; it lays out the **dimensions** of a project and offers a
**palette of concrete, checkable facets** (seeded from what you already own — see §4) that you
**multi-select and extend**. You assert; the tool organizes your assertions into a `kind:"project"`
(or `kind:"idea"`) context.

| | **ideabrain (today): suggest-options** | **define-your-project (new): multi-select** |
|---|---|---|
| Who decides the content | The **model** invents each option | The **user** selects/asserts each facet |
| Interaction | **Single-select** one card per decision | **Multi-select** many chips per dimension |
| AI's job | **Generate** genuinely-different directions | **Structure & seed** — offer facets, dedupe, name gaps |
| Grounding | Web-grounded invention (cite-or-omit) | The user's own material (§4 pool) + free-text add |
| Failure mode | Plausible-but-wrong invented facts | Empty until the user asserts (honest blank) |
| Output | A validated *thesis* (a bet) | A defined *project* (a description of what IS) |
| When to use | "I have an idea, is it good?" | "I know my project, capture it richly" |
| Ends in | `kind:"idea"` context (bootstrap `ideaToContext:55`) | `kind:"project"`/`kind:"brand"` context (CONTEXT-KINDS) |

They are **complementary and can chain**: define-your-project captures what IS; ideabrain
pressure-tests a bet about what COULD be. A user can define a project, then hand it to ideabrain to
validate a new direction — the defined context is richer input than a one-liner.

### 3.2 The interaction — a multi-select facet board

Four **dimensions**, each a row of **multi-selectable chips** plus an always-present "+ add your own."
Chips are **seeded** (never invented as claims) from the user's material (§4): their brands, repos,
the site just read, prior decisions in the vault. The user checks what's true, unchecks what isn't,
types what's missing. No blank form; no single-answer coercion.

```
╭─ Define your project ──────────────────────────────────────────────╮
│  What is this project about? Check what fits — add anything missing.│
│                                                                    │
│  CATEGORY          (pick 1–2 — what kind of thing this is)         │
│   ▣ D2C brand   ▢ marketplace   ▣ press-on nails   ▢ SaaS   + add  │
│                                                                    │
│  AUDIENCE          (who it's for — pick all that apply)            │
│   ▣ Gen-Z women  ▣ tier-2 India  ▢ salons  ▢ gifting   + add       │
│                                                                    │
│  ESSENCE           (what makes it itself — the non-negotiables)    │
│   ▣ salon-quality in minutes  ▣ maximalist/desi  ▢ cruelty-free    │
│   ▢ "premium without the city tax"                       + add     │
│                                                                    │
│  GOALS             (what winning looks like — pick your live ones) │
│   ▣ hit ₹1cr/mo  ▢ 3 new SKUs by Diwali  ▢ open 5 salons  + add    │
│                                                                    │
│  seeded from: nailinit (brand) · your last 3 notes    [ Define → ] │
╰────────────────────────────────────────────────────────────────────╯
        │  the model STRUCTURES the selections (dedupe, cluster, name the project) — never invents facts
        ▼
   Writes project-<slug>.md  →  publishes kind:"project"  →  ★ set as my project
```

- **Multi-select is the core primitive.** Every dimension accepts many picks (category caps at 1–2 for
  slug sanity; the rest are unbounded). This is the founder's "the user selects what their project is
  about" made literal — the checkbox, not the AI's card, is the unit of truth.
- **Seeding ≠ suggesting.** The suggest-options engine offers *directions to adopt*. Here, a chip is a
  *fact drawn from your own material* — "press-on nails" comes from the extracted catalogue category,
  "maximalist/desi" from a brand's `voice`. Unchecking is as meaningful as checking. The model may add
  a few **gap chips** ("you haven't said who it's for — is it any of these?") but these are prompts to
  the user, plainly marked, not claims.
- **"+ add your own" is first-class**, not an escape hatch — the user's typed essence outranks any
  seeded chip.

### 3.3 The state machine (distinct from the card loop)

The suggest-options engine is a **sequential lock loop**: decision → generate options → single-pick →
lock → next decision, order fixed by the template. The define-your-project engine is a **flat,
order-free selection accumulator**:

```
SEED ──────────► SELECTING ──(Define)──► STRUCTURING ──► DEFINED ──► (publish + setActiveProject)
  │                  ▲  │                     │              │
  gather §4 pool     └──┘  (edit any          model clusters revisit any dimension anytime;
  → chips per        toggle chips /           + names the    re-open re-enters SELECTING with
  dimension          add free-text,           project; NO    current selections pre-checked
  (no model claims)  any dimension,           new facts
                     any order)               invented
```

Contrast the studio loop's shape (external `lib/studio/spec.ts`, the `StudioName="idea"` family):
`brief → detectIdeaCategory → [research → thesis → plan → prove → deck]`, each stage a
generate-then-single-pick turn that **cannot proceed** until the prior locks. Define-your-project has
**no ordering constraint and no generation step**: all four dimensions are live at once, selections
accumulate, and the single model call happens **once at `Define`** — purely to *structure* (cluster
near-duplicates, pick a project name/slug, flatten to the `kind:"project"` shape), never to *produce
content*. It is closer to `brief`'s one-shot normalize (`normalizeBrief`, `ideabrain.core.js:46`) than
to the card loop — which is why it's cheap and why it can't hallucinate a project you didn't assert.

### 3.4 This is how context is both DEFINED and SHOWN

The output of define-your-project is a `project-<slug>.md` in the vault — **the exact file Bank's hero
renders** (§2.4). Define once, and the four dimensions map straight onto the four facets:
category+essence → **understanding**, a linked brand → **brand**, `data.folder` → **files**,
goals+tasks → **decisions**. Definition and display are the same object viewed from two sides — the
multi-select *is* the editor for what the hero *shows*, closing the loop with §2. Re-opening the mode
pre-checks the current selections, so "edit my project's essence" and "define my project" are one flow.

### 3.5 Where it lives / build seam

- **Surface:** a mode of the ideabrain studio (`?studio=idea` today; add `?mode=define`) **and** the
  in-Bank "just an idea → define it" branch of the establish front door (§2.2). Both write the same
  `.md`.
- **Reuse:** `context.publish` + `setActiveProject` (already the ideabrain widget's ending,
  BRAND-EXTRACTION.md §4.4); the `.md` writer `projectToMarkdown` (`project.mjs:80`); the seeding pool
  from §4.
- **New:** the multi-select board component and the single "structure these selections" model call
  (one prompt: "cluster and name; invent nothing; return the `kind:"project"` JSON of CONTEXT-KINDS").
  No new engine, no card loop — a flat form over existing publish plumbing.

---

## 4. More context in ideabrain + ideafetch

Both engines start too thin. ideabrain's `brief` today gets **one line + optional market**
(`buildBriefPrompt`, `ideabrain.core.js:31-41`) and *infers the rest*. And **`ideafetch` does not
exist yet** — it's the ingest sibling the ecosystem needs but hasn't named. Define both richer.

### 4.1 `ideafetch` — the ingest sibling (spec it, because it's absent today)

**What it is:** ideabrain *reasons*; **ideafetch *gathers*.** Given any pointer, ideafetch fetches
real material and structures it into a **candidate-fact pool** — the grounding that ideabrain reasons
over and that define-your-project draws its seed chips from (§3.2). It is the daemon-side reader that
makes "start rich" possible.

**Confirmed absent:** `grep -ri ideafetch` over the repo returns nothing. The *pieces* exist and are
scattered — this proposal unifies them under one name:

| Pointer | Existing machinery to reuse | Gives |
|---|---|---|
| **Website** | `sb_brand` / `gatherSite` (`bank-mcp.mjs:161`) + `brand.mjs` | palette (served CSS), full catalogue, category, currency, socials, og:image |
| **GitHub repo / folder** | `buildProject` + `gatherRepo` (`bank-mcp.mjs:51`, `project.mjs`) | summary, stack, roadmap, docs, packages, open tasks, `folder` |
| **Competitor URLs** | `sb_http` (BRAND-EXTRACTION §2, Option A) | comparables — a real `alternatives` set instead of invented ones |
| **Pasted text / uploaded docs** | model over provided text (no fetch) | positioning language, audience cues, goals in the user's own words |
| **The user's own vault** | `relay.storage.list` + notes (`bank.js:193`) | prior decisions, existing brands/projects to link, not re-ask |
| **Channels** (gmail/granola) | the sync discover→consent→pull (`bank.js:1043-1078`) | live to-dos, meeting action items as candidate goals |

**More context to gather (beyond today's Shopify-only read):**
- **Non-Shopify catalogues** — `/products.json` is the *only* product source today
  (BRAND-EXTRACTION §1.3); add WooCommerce/Squarespace/sitemap/JSON-LD `Product` fallbacks so
  non-Shopify stores don't yield zero products.
- **About/positioning copy** — read the about/hero/meta-description for the brand's own words, not
  just colors and SKUs.
- **Social handles + link-in-bio** — already partially parsed; carry them as `socials`.
- **JS-rendered sites** — flag `reachable:false` honestly (SPA shells give weak palettes,
  BRAND-EXTRACTION §1.3) and offer the repo/folder/paste pointer instead of guessing.

**Output shape:** a provenance-tagged fact pool (mirroring `sb_brand`'s result, BRAND-EXTRACTION §2.1)
that feeds three consumers — define-your-project's chips, ideabrain's `brief`/research grounding, and
Bank's establish flow — from **one daemon read**. Every fact carries `source` (CONTEXT-KINDS
§Provenance) so downstream can show "read from yourbrand.com, 2d ago" and never present a guess as a
fact.

### 4.2 More context in ideabrain

`brief` should accept and carry, beyond `{idea, market}`:
- **The ideafetch pool** — if the user pointed at a site/repo first, pass the extracted brand/project
  as grounding so `brief` commits to the *real* category/audience/price band instead of inferring them
  (today `normalizeBrief` fills blanks by inference, `ideabrain.core.js:46-58`).
- **Prior decisions from the vault** — the user's existing `kind:"idea"`/`kind:"project"` contexts and
  linked notes, so a second idea builds on the first rather than starting cold (the studio already
  "remembers decisions locked earlier," `ideabrain.core.js:17` — extend that memory across sessions
  via the vault).
- **The active project** — `active(origin)`/`activeProject()` (`library.ts:77,84`): if a project is
  set, ideabrain validates *in its context* (same audience, same market) unless told otherwise.
- **Personal card** — `kind:"personal"` (CONTEXT-KINDS) for founder-why / geography / company, so
  `founderwhy` and market default from real facts.

Concretely: widen `buildBriefPrompt` to take an optional `grounding` block (extracted facts + linked
prior decisions) and instruct the model to **prefer asserted facts over inference, and cite which
came from the pool** — the same cite-or-omit discipline the web-grounded thesis cards already use
(BRAND-EXTRACTION §4.1, the 🌐 cards). Richer input, fewer invented specifics, a brief a founder
recognizes as *theirs* on first read.

---

## 5. Recommended order

1. **`sb_http` → `sb_brand`/`sb_project`** ([BRAND-EXTRACTION §2](./BRAND-EXTRACTION.md), §5) — the
   daemon fetch that unblocks in-tab extraction. Prerequisite for everything Bank-side.
2. **Bank "Establish a project" front door** (§2.2) — Bank calls the capability; writes the same
   `project-*.md`/`brand-*.md` the connector writes. *This is what makes Bank "run something."*
3. **`ideafetch`** (§4.1) — unify the scattered readers into one provenance-tagged ingest, widen it
   past Shopify. Feeds Bank's establish flow, define-your-project, and ideabrain alike.
4. **Define-your-project mode** (§3) — the multi-select facet board + one structuring call, seeded by
   ideafetch, ending in a published `kind:"project"` that Bank's hero shows.
5. **Bank project-first layout** (§2.3–2.5) — the active-project hero + four facets + editable cards.
6. **Richer ideabrain `brief`** (§4.2) — carry the ideafetch pool + prior decisions + active project.

Everything above is **additive over shipping code**: the parsers, the `.md` dialect, the publish
bridges, `setActiveProject`, and the ideabrain `brief` workflow already exist and are tested. The gap
is the daemon capability call and the two new front doors (establish, define) — not a new engine.
