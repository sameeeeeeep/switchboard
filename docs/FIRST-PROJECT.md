# Set up your first project — the first-time experience

**Status:** design note. **Related:** [BRAND-EXTRACTION.md](./BRAND-EXTRACTION.md) (the sibling for
sites — brand extraction as project-establishment), [CONTEXT-KINDS.md](./CONTEXT-KINDS.md)
(`kind:"project"` shape), [STORE-TAXONOMY.md](./STORE-TAXONOMY.md) (device-lightness doctrine),
[ONBOARDING.md](./ONBOARDING.md) + [STATES.md](./STATES.md) (the readiness ladder), the context
library [`packages/sidekick/src/context/library.ts`](../packages/sidekick/src/context/library.ts),
the store's first-project pointer [`examples/apps/src/store/point.js`](../examples/apps/src/store/point.js),
and the Bank connector's deterministic extractors
[`packages/bank-mcp/bank-mcp.mjs`](../packages/bank-mcp/bank-mcp.mjs) +
[`project.mjs`](../packages/bank-mcp/project.mjs).

---

## 0. TL;DR

A brand-new user's context library is **empty**, and every wrapp on the shelf is **proactive** — it
generates *from* the active project, so with a cold library it has nothing to work from
(`point.js:3-6`). The first-time job, therefore, is not "install a wrapp." It is **establish one
project**, well, once — so the whole shelf opens pre-loaded.

The founder's flow: **point at a folder → Switchboard ingests it and builds understanding in the
background → that becomes your project's context.** This doc designs that as **two passes over one
`kind:"project"` context**:

1. **Base pass (fast, shallow, blocking-but-seconds).** A deterministic gather (README,
   `package.json`, docs, structure) + one cheap model reading. Enough to be *useful immediately* — the
   project is published and set active before the user looks away.
2. **Detailed pass (deep, richer, non-blocking).** A daemon-scheduled one-shot that reads more of the
   tree, understands the code, and **republishes the same context in place** (stable id). It sleeps
   when done — no idle CPU (STORE-TAXONOMY.md R4).

Plus **extra context inputs**: the user can attach URLs (their website, their docs) which route
through the site/brand extractor and **compose into the same one project context** every wrapp then
grounds on.

The plumbing already exists in three places; this doc's contribution is to (a) name the *two-pass*
shape, (b) place it on the readiness ladder, (c) add the **Claude-projects discovery shortcut**, and
(d) specify how folder + URL + brand facts merge into one context.

---

## 1. The first-run flow

### 1.1 Where it sits — a new rung, after "first connection"

The [STATES.md](./STATES.md) ladder ends at rung 5, *"First wrapp / first connection"*
(`Model.apps > 0`). Establishing a project is the **natural rung 6** — and the one that makes every
later wrapp non-empty. It is *not* mechanical (Act I in [ONBOARDING.md](./ONBOARDING.md)); it is the
first act of real work, so it belongs to Act II's "the product teaches the product" register: God can
literally point at the store's "Start here" hero and narrate "point me at what you're working on."

Quieting rule holds (STATES.md §3): show this **only** when the library is cold. Once one project
exists, the rung is done and never nags. The store home already gates on exactly this
(`point.js` `libraryEmpty`).

### 1.2 The pointer — point at a folder (NSOpenPanel)

The store's first-project surface (`point.js`) already ships **three pointers** — a website (→
`kind:"brand"`), a GitHub repo (→ `kind:"project"`), and **a folder on this Mac** (→ `kind:"project"`,
`TILES` at `point.js:63-79`). The folder pointer is the founder's primary path and the **strongest
privacy story in the product**: no web tools at all, and the bytes never leave the machine
(`point.js:559`).

Mechanically the folder pointer is a **storage bind**, not a raw filesystem read:

```
NSOpenPanel (native) ─┐
paste ~/Projects/x  ──┼─→ relay.storage.bind(path)   ← path-consent, user approves the folder
                       │      (point.js:570; daemon folderFor/bind, sidekick storage)
                       ▼
                 relay.storage.list()  → keys (files under the bound folder)
                 relay.storage.get(k)  → file bodies, read on THIS machine, no network
```

Two consents bracket the read (`point.js:559-560`): bind **out** to the target folder, then bind
**back** to the page's own sandbox the instant the bytes are in memory (`restoreBind`,
`point.js:610` — unwound at the *one* point the folder stops being needed, not at every exit branch).
The native app owns the NSOpenPanel; the web surface accepts a pasted path. Either way the daemon's
path-consent is the gate — **no folder is read without an explicit approval the user sees**.

### 1.3 The Claude-projects discovery shortcut (new)

The founder's phrasing — *"their Claude Code projects folder"* — has a concrete, cheap realization.
Claude Code stores one directory per working folder under **`~/.claude/projects/`**, named by
**dash-encoding the cwd** (`/Users/me/Documents/relay` → `-Users-me-Documents-relay`). On this
machine that's **70 directories** — i.e. 70 folders the user has actually run Claude Code in.

So instead of making a first-time user *hunt* in NSOpenPanel, the setup surface can **enumerate
`~/.claude/projects/`, decode each dir name back to a path, keep the ones that still exist on disk,
and offer them as one-tap pointer candidates** — "these are the folders you've been working in; point
me at one." This is discovery, not autopilot: the decoded path is a *suggestion* the user confirms
(the naive `-`→`/` decode is lossy when a real folder name contains a hyphen, so each candidate is
validated with `existsSync`/`statSync` and only offered if it resolves cleanly). It never reads a
folder's contents until the user picks it and approves the bind.

> **Boundary:** `~/.claude/projects/<slug>/` holds Claude Code's *session transcripts*, not the user's
> source. We read only the **directory names** (to recover the working-folder paths) — never the
> transcripts. The ingested content always comes from the real work folder, via `storage.bind`.

### 1.4 What gets ingested, and how understanding is built

Ingestion is **marker-based, bounded, and deterministic-first** — the exact discipline
`packages/bank-mcp` already encodes:

- **What counts as a project.** `PROJECT_MARKERS` (`project.mjs:15-19`): `.git`, `package.json`,
  `README.md`, `CLAUDE.md`, `ROADMAP.md`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Package.swift`, …
  A folder is a project if it carries one. *"A screenshots folder is not a project; seeding the vault
  with junk is worse than seeding it with nothing"* (`project.mjs:12-14`). Point at a folder-of-folders
  and `findProjects` (`bank-mcp.mjs:91`) walks it, stopping the moment a directory looks like a project
  root — so a monorepo lands as **one** project, not one per package.
- **What gets read.** `gatherRepo` (`bank-mcp.mjs:51`): the README (H1 → name, first blockquote/para →
  summary), `package.json` (name, description, version, license, deps → `stack`), `LICENSE`, `docs/*.md`
  H1 titles, monorepo `packages/`, example wrapps, `ROADMAP.md` bullets, and open `- [ ]` tasks across
  the tree (`walkMd`, bounded to 400 files). `IGNORE` skips `node_modules`, `.git`, `dist`, `build`,
  `.next`, … (`bank-mcp.mjs:37`). Byte budget `MAX_BYTES` 4 MB.
- **How it becomes understanding.** `buildProject` (`project.mjs:50`) turns those raw facts into the
  `kind:"project"` object — **no model required** for the deterministic core (*"reliable on structured
  repos… no model needed"*, `project.mjs:3-4`). The store's folder path (`point.js` `readFolder`) adds
  **one cheap model reading** on top to phrase the summary/state/next-steps as prose the user confirms.

Both routes end at the same object and the same publish call.

### 1.5 How it's stored — one `kind:"project"` context

Understanding lands as a single context published to the user-owned library
(`ContextLibrary.publish`, `library.ts:48`) and set as the global active project
(`setActiveProject`, `library.ts:83` → the `*global*` selection key). The shape is the
`kind:"project"` convention (CONTEXT-KINDS.md §`kind:"project"`):

```jsonc
{
  "id": "relay",                    // stable slug — re-ingesting UPDATES in place, never duplicates
  "name": "Switchboard",
  "kind": "project",
  "data": {
    "summary": "…", "state": "…", "status": "v0.2.9 · MIT",
    "stack": ["TypeScript","esbuild","MCP"], "packages": ["sdk","sidekick"],
    "docs": ["Vision — docs/VISION.md"], "links": [{ "label":"repo","url":"…" }],
    "roadmap": ["…"], "files": ["…"], "wrapps": ["bank","imagegen"], "tasks": ["…"],
    "folder": "/Users/you/Projects/relay",         // LOAD-BEARING — see below
    "source": { "kind":"folder", "path":"…", "readAt": 1753000000000, "by":"switchboard-home" }
  }
}
```

**`data.folder` is the keystone.** `folderOf()` (`library.ts:136`) reads it, so **lending this project
to a wrapp auto-binds that wrapp's storage to the real directory** (`point.js:768-771`). Point once,
and Redline reviews the actual page on disk, Bank opens the actual vault, Huddle talks about the actual
files — no copy, no re-upload. It is only ever set to a path the user approved through `storage.bind`.

Once active, **every connected wrapp sees it** through `active(origin)` (`library.ts:77`: the app's
own pick, else the global project), and **God folds it into its system prompt**
(`examples/god/god.mjs:766` — `"You are helping with the user's active project …"` + a 700-char slice
of `data`). One establishment, whole-shelf effect.

---

## 2. The two-pass ingestion

The founder's ask — *a base skill (fast shallow) then a more detailed second pass (background)* — maps
cleanly onto **one context, published twice**, under the same stable id so the second write is an
*update in place*, never a duplicate.

### 2.1 Pass A — the base skill (fast, cheap, shallow, immediate)

**Goal:** the user should never see a blank library. Within a couple of seconds of approving the
folder, a usable project exists and is active.

**Where it runs:** the *deterministic gather* (`gatherRepo`/`buildProject`) is pure structuring and can
run **in-tab** (the store surface) or in the daemon — it is cheap and needs no model. On top of it, a
**single model reading** phrases the prose fields and lets the user pick among three honest framings —
exactly `point.js`'s existing folder flow: read a bounded corpus (priority files first: README,
`package.json`, `ROADMAP.md`, `CLAUDE.md`, then `docs/*.md`, then top-level `*.md` — `FOLDER_PRIORITY`
`point.js:561`, `pickFiles` `point.js:627`; 24 KB cap), then one `relay.stream`/`sb.complete` call to
land three readings the user confirms (`landReadings`, `point.js:433`).

**Why this is a "base skill" and not just code:** the reading step is a **skill** in the store-taxonomy
sense — a `SKILL.md` that aims the model at "read a project folder and summarize it truthfully"
(STORE-TAXONOMY.md type 3: `components.skills`, `surfaces:["god"]`, **zero device weight** — it is
text that rides one completion). Its body carries the same doctrine `point.js` bakes into its prompt:
*absent is not invented; derive stack from real dependency names, not self-description; return `[]`
rather than fabricate a roadmap* (`point.js:255-263`). Shipping it as a skill (frontmatter + markdown,
like `examples/apps/wrapps/gist/skills/summarize.md`) means God can *wear* it (`GOD_SKILL` →
`skillBlock`, `god.mjs`) — "set up the project I'm looking at" becomes a thing God does in
conversation, not only a store screen.

**Cost/scope:** one cheap model call (`effort: "low"`, `haiku`/`sonnet`), a few files, a few KB.
Bounded and legible. On a **structured repo** (README + `CLAUDE.md` + `ROADMAP.md`, "which we anyway
maintain") the deterministic core alone is often enough — the model reading is polish, not a
dependency.

### 2.2 Pass B — the detailed pass (deep, richer, non-blocking)

**Goal:** turn the shallow reading into a genuine understanding of the project — read more of the tree,
follow the structure, understand what the code actually does, surface the real open work — **without
the user waiting and without the machine getting slow.**

**Where it runs — a daemon-scheduled one-shot, not a busy loop.** This is the load-bearing
device-lightness decision (STORE-TAXONOMY.md Part 3):

- **R1 — declared, granted, in the daemon.** The deep read is orchestration over the already-bound
  folder (the project's `data.folder`). It runs as a **workflow** (`surfaces:["batch"]`,
  STORE-TAXONOMY.md type 7) the daemon kicks *once* after Pass A publishes — not an in-tab loop the
  user has to keep a tab open for.
- **R4 — no idle background CPU.** It is a **one-shot** that runs, republishes, and **exits**. If it is
  ever promoted to *re-ingest on change*, it must be a **routine** (type 8) that **sleeps between
  fires** on a daemon timer — *"a scheduled wake, never a busy loop… a routine that would poll
  continuously is rejected."* No file-watcher hammering the disk; a periodic or on-open refresh at
  most.
- **R2/R5 — cheapest tier that does the job.** Deterministic gather first (free); the model is invoked
  only for what structure can't answer (what the code *does*, the real narrative), and at the lightest
  effort that suffices. The deep pass is `lazy` in spirit: it costs tokens only because the user
  established a project, and only once.

**What "deeper" reads (beyond Pass A's priority files):**

- Directory **structure** and entry points (top-level layout, `packages/*`, `src/` shape) — cheap,
  deterministic, already partly in `gatherRepo`.
- **More of the tree**: notable source files (not just markdown), config, test presence, the actual
  dependency graph — bounded by the same `IGNORE`/byte budgets, raised file caps.
- **What it does**: a model summary grounded in the gathered structure + a sample of real source — the
  jump from *"the README claims X"* to *"the code actually is Y"* (which `point.js`'s three-reading
  lenses already gesture at: `"What the README claims"` vs `"What the code actually is"`,
  `point.js:236-237`).
- Open work at higher fidelity — all `- [ ]` tasks, `TODO`/`FIXME` markers, `ROADMAP.md`, synced to the
  project's board (the Bank task dialect) rather than only a snapshot.

**How it lands:** `context.publish({ id: <same slug>, kind:"project", data: <enriched> })`. Same stable
id ⇒ **update in place** (`library.ts:49` — an existing id updates, a fresh one duplicates). Because
consumers read the *whole* active context each time (single-active-context, CONTEXT-KINDS.md), every
wrapp automatically sees the richer version on its next read — **no migration, no re-selection.** The
enriched write must be a **superset** (CONTEXT-KINDS.md §"Publish a superset, not a slice"): Pass B
carries forward Pass A's fields and adds to them, never drops the folder or the confirmed summary.

### 2.3 How progress is shown

Pass A is seconds and **blocking-but-legible** — the store surface already streams a live step log
(`step()`/`setLive()`, `point.js:355-367`: *"reading relay on your Claude…", "page read · 4 kb",
"drafting three readings…"*). Reuse it verbatim.

Pass B is background, so its progress is a **glanceable pulse**, not a screen the user watches — the
same posture the ideabrain widget uses (BRAND-EXTRACTION.md §4.2 State 3: filling pips, current stage
named, no transcript). Concretely: the project card (in the panel / store / notch) shows a small
*"deepening…"* state that resolves to *"understood — 24 files, 6 docs, 11 open tasks"* when Pass B
republishes. The `god-state`-style file-poll pattern (`god.mjs:64`) or the panel's existing context
refresh is enough; **no new heavy channel.** When Pass B finishes the card just… gets richer.

### 2.4 Why two passes and not one

Because the two goals **conflict**: "useful in two seconds" wants shallow-and-blocking; "genuine
understanding" wants deep-and-slow. Splitting them lets each be honest. Pass A honours *"never a blank
screen"* (the doctrine shared by brand readings and the ideabrain brief); Pass B honours *"nothing is
worse than the user's system going slow because of us"* (STORE-TAXONOMY.md Part 3). One context, two
writes, is the seam that satisfies both — and it costs nothing extra in the data model because
`publish` was always update-in-place.

---

## 3. Extra context inputs — URLs, and how it all composes

### 3.1 Let the user add URLs (website, docs)

A project is more than a folder — its public face (marketing site) and its docs (a docs host, a wiki)
carry context the repo doesn't. The first-project surface should let the user **attach one or more
URLs** to the project they're establishing.

A URL routes through the **site/brand extractor**, which is the subject of
[BRAND-EXTRACTION.md](./BRAND-EXTRACTION.md): today three implementations exist and only the
**daemon-side** one is robust (in-tab `fetch` is CORS-blocked and silently degrades to a model
*guessing* the brand). The recommended fix there — a first-class **`sb_brand`** capability (daemon
fetch of real HTML/CSS/`products.json` → deterministic parse via `brand.mjs`) — is exactly what the
URL input should call. It returns provenance-tagged facts (palette from the site's own CSS, real
catalogue), or `reachable:false` **honestly** for a dead/JS-only site (BRAND-EXTRACTION.md §2.1, §3.2).
The same doctrine governs it as the folder pointer: **confirm a reading, never author a blank field;
an empty palette is correct, three invented hexes are a lie.**

A **docs URL** (not a storefront) is the plainer case: read the page(s) via the daemon fetch and fold
the extracted summary/links into the project — no palette, no catalogue, just prose context.

### 3.2 How folder + URL + brand compose into ONE context

The critical design choice: these are **not** three separate library entries the user has to juggle.
They **merge into the single active `kind:"project"` context** so every wrapp grounds on one object.

The context model makes this clean because `data` is **opaque and additive** (CONTEXT-KINDS.md §"A
context's `data` is opaque… apps agree by convention"). The composition is a **field merge under the
same stable id**:

| Source | Pointer | Contributes to `data` |
|---|---|---|
| Folder (Pass A + B) | `storage.bind` | `summary`, `state`, `status`, `stack`, `packages`, `docs`, `files`, `roadmap`, `tasks`, **`folder`** |
| Docs / site URL | `sb_brand` / daemon fetch | `links`, richer `summary`, and the brand fields **beside** the project fields |
| Site (brand) | `sb_brand` | `voice`, `positioning`, `audience`, `palette` (provenance-tagged), `products`, `domain` |

Because CONTEXT-KINDS.md already says *"add richer shapes **beside** the flat field, never instead of
it"* and *"publish a superset,"* a project context can legitimately **carry brand fields too** — a repo
that also has a website ends up as one project whose `data` holds both the stack/roadmap **and** the
voice/palette. Downstream that means Redline (a project consumer) sees the folder and the roadmap,
*and* adgen (a brand consumer) sees the palette and products — **from the same one context the user
lent**, because each consumer reads only the fields it knows and defensively ignores the rest
(CONTEXT-KINDS.md §"Normalize defensively").

Merge rules (to write into the composing surface):

1. **One stable id** for the project (the folder/repo slug). Every input republishes under it →
   update-in-place, never duplicate (`library.ts:49`; the `source` provenance field, CONTEXT-KINDS.md
   §Provenance, records *which* pointer last wrote *which* facts).
2. **Never overwrite a confirmed field with a lower-confidence one.** Deterministic/verified facts
   (folder stack, CSS palette) beat model-prose; the user's inline edits (`point.js` `pt.edits`) beat
   both.
3. **`folder` is sticky.** Once set from the folder pointer it is never dropped by a later URL
   republish — it is the load-bearing binding (`folderOf`, `library.ts:136`).
4. **Provenance stays honest.** `data.source` reflects the primary pointer; a composed context can note
   the URL(s) folded in via `links`. If a URL was unreachable, say so — don't silently drop it.

### 3.3 The composed picture

```
┌─ Set up your first project ─────────────────────────────────────────┐
│  Point me at what you're working on:                                │
│   ● a folder on this Mac   ○ a website   ○ a GitHub repo            │
│   ↳ folders you've worked in:  [relay]  [nailinit]  [aria-world] …   │  ← ~/.claude/projects shortcut
│                                                                     │
│  + add a URL:  [ yourbrand.com ]  [ docs.yourthing.dev ]            │  ← optional extra context
└─────────────────────────────────────────────────────────────────────┘
      │ Pass A: gather + one reading  (seconds, blocking-but-legible)
      ▼
   Project published + set active  →  every wrapp opens pre-loaded
      │ Pass B: daemon one-shot deep read  (background, sleeps when done)
      │ URL(s): sb_brand → brand/docs facts merged under the same id
      ▼
   Same context, richer:  folder + stack + roadmap + voice + palette + products
   Redline reviews the real files · adgen shoots from the palette · God knows the project
```

---

## 4. Privacy & device-lightness — the non-negotiables

- **Local ingestion, no upload.** The folder is read **on this machine** through `storage.bind`/`get`;
  no network request is made and nothing leaves the disk (`point.js:16-17, 82-85`). The read runs on
  the **user's own Claude** through the broker; the operator never sees it. This is the strongest
  privacy story in the product and the first-project flow must preserve it exactly.
- **Consent is per-folder and visible.** No path is read without an approval the user sees
  (`storage.bind`, two-consent bracket, `restoreBind`). The `~/.claude/projects` shortcut reads only
  *directory names* to suggest paths — never contents, never transcripts — and still requires the bind
  approval before any file is opened.
- **No idle CPU.** Pass B is a one-shot that exits; any re-ingest is a **routine that sleeps between
  fires** (STORE-TAXONOMY.md R4). No file-watchers, no polling loops, no background inference at boot.
- **Cheapest tier first.** Deterministic gather (free) before any model; lightest model effort for what
  structure can't answer (R2/R5). Establishing a project must never load a model just to sit there.
- **Honest emptiness.** A folder with no markers → *"nothing here to read yet"* with an offer to point
  elsewhere (`point.js:584, 599`). An unreachable URL → `reachable:false`, said plainly. Never
  fabricate to fill the card.

---

## 5. Build seam & recommended order

The pieces mostly exist; this is wiring, not inventing.

1. **Base pass as a skill.** Extract the folder-reading doctrine `point.js` already encodes into a
   `SKILL.md` (`components.skills`, `surfaces:["god"]`) so God can wear it and the store surface can
   share it. Deterministic gather = lift `gatherRepo`/`buildProject` (`bank-mcp.mjs`/`project.mjs`);
   they already produce the `kind:"project"` shape.
2. **Publish + set active.** Reuse `point.js`'s publish path (`context.publish` +
   `setActiveProject`) — already correct, already sets `data.folder`.
3. **Detailed pass as a daemon one-shot.** A `batch` workflow the daemon kicks after Pass A publishes;
   it re-reads deeper off the bound folder and republishes the **same id** as a superset. Enforce R4:
   it runs once and exits (promote to a sleeping routine only if re-ingest-on-change is ever wanted).
4. **URL inputs via `sb_brand`.** Land the `sb_brand` capability (BRAND-EXTRACTION.md §2, §5) and point
   the URL field at it; merge its facts into the project context under §3.2's rules.
5. **The `~/.claude/projects` discovery shortcut.** Native: enumerate the dir, decode + `existsSync`,
   offer verified candidates alongside NSOpenPanel. Small, high-delight, no new consent model.
6. **Glanceable Pass-B progress.** Reuse the panel/notch context-refresh + a `god-state`-style poll;
   the card deepens when Pass B republishes. No new heavy channel.

## Open questions

- **Multi-project folders.** `findProjects` already turns a folder-of-repos into many projects
  (`bank-mcp.mjs:91`). For *first* project, do we establish **one** (the folder itself, or the user
  picks) and offer "seed the rest into Bank" as a follow-on, to keep the FTUX single-focus? Leaning:
  yes — one active project on first run, bulk-seed later.
- **Re-ingest trigger.** On-open refresh vs. an explicit "re-read this project" button vs. a sleeping
  routine. Start with explicit + on-open; a routine only if users ask for always-fresh.
- **Where the base skill runs by default.** In-tab (store surface, needs no daemon capability) vs.
  daemon (so God can establish a project with no tab open). Both should share the one `SKILL.md`.
