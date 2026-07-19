# Context Kinds

**A context's `data` is opaque to the platform — apps agree on its shape by convention, not lock.**
This document *is* that convention: the de facto field shapes for each `kind`, written down so a
producer wrapp and a consumer wrapp that have never heard of each other still interoperate. Nothing
here is enforced by the broker; violating it doesn't error, it just renders wrong on the other side
(the palette bug below is the canonical example of why this file exists).

> **Ground rules first** (see [VISION.md](./VISION.md) §1.2–1.3): apps can never enumerate the
> library; a consumer reads exactly the one context the user lent it (`active`/`pick`). `kind` is a
> free-form string tag; the kinds below are the shared union every wrapp should prefer before
> inventing its own.

---

## Conventions for every kind

- **Stable `id`** — re-publishing with the same `id` updates in place; a fresh id every publish
  duplicates the library. Derive the id from the object (brand id, task id), never `Date.now()`.
- **Publish a superset, not a slice.** Consumption is single-active-context: the consumer gets one
  object and nothing else. A producer that only knows one field (a naming wrapp, say) should carry
  forward the fields it inherited (positioning, audience, palette) so its published object is still
  usable by every downstream consumer alone.
- **Strings and arrays of strings by default.** Consumers defensively `String()` unknown values —
  a nested object in a field consumers expect flat renders as `"[object Object]"`. When a richer
  shape is genuinely needed, add it *beside* the flat field under a new name (see `paletteRich`),
  never instead of it.
- **Normalize defensively when consuming.** There is no schema validation; treat every field as
  possibly missing or misshapen (see `normalizeBrand` in `examples/apps/src/imagegen.js` for the
  reference pattern).

---

## `kind: "personal"`

Produced by the **side panel only** (the "Your details" card — `publishedBy: "panel"`); never by an
app. The founder's own contact card: the stable facts (name, phone, email, address, company) that
apps otherwise make users retype. Consumed like any context — an app receives it ONLY when the user
lends it; contact info never flows implicitly.

```jsonc
{
  "id": "…",
  "name": "Sameep",              // display = the person's name
  "kind": "personal",
  "data": {
    "fullName": "Sameep Rehlan", // all flat strings; absent = unknown (never invent)
    "phone": "+91 …",
    "email": "sameep@…",
    "company": "nailinit",
    "address": "…",
    "notes": "GSTIN …, support hours 10–6 IST"  // free-form overflow (GST, hours, whatever apps may need)
  }
}
```

Consumers: fill "seller contact" blocks (A-Plus brand story, storefront footers, ad CTAs that need a
business address), sign-offs in outreach drafts, invoice headers. Same defensive-normalization rules
as every kind.

---

## `kind: "brand"`

Produced by the brandbrain port (`examples/brandbrain-port/src/bootstrap.js` → `brandToContext`), by the
**Bank connector's brand extractor** (`packages/bank-mcp` → `bank_extract_brand`, which reads a live
site's served CSS and its `/products.json` catalogue and structures them deterministically — see
`brand.mjs`), by the **store home's first-project setup** (`examples/apps/src/store/point.js` — the
"point at a website" pointer, which reads the site through the user's own Claude via WebFetch), and
any other brand-minting wrapp (naming/voice wrapps). Consumed by Prism
(`imagegen.js`), persona/Cast (`persona.js`, `cast/spec.js`), adgen, and Bank (which renders each
`brand-<slug>.md` in the vault as a card, §04).

```jsonc
{
  "id": "aamras",                    // stable — the producer's own brand id
  "name": "Aamras",                  // display name; consumers fall back to data.name
  "kind": "brand",
  "data": {
    "oneLine": "Indian maximalist home fragrance, made in small batches.", // the brand in ONE sentence, as it would introduce itself
    "voice": "Warm, maximalist, unapologetically desi",   // one line; consumers fall back voice → vibe → positioning
    "positioning": "Indian maximalist home fragrance for gen z",
    "audience": "Gen z who want to mask smoke smell and relax",
    "palette": ["#8B1A1A", "#F4A000", "#0D0D0D"],          // FLAT CSS color strings — see below
    "paletteRich": [                                        // optional; named swatches, when known
      { "name": "Haveli maroon", "hex": "#8B1A1A" },
      { "name": "Saffron pulse", "hex": "#F4A000" }
    ],
    "products": ["Shot-glass candle", "Reed diffusers"],    // strings; consumers fall back products → range
    "productsRich": [                                       // optional; the real catalogue, when extracted
      { "title": "Berry Bomb | Press-On Nails | 24 pcs", "price": 449, "url": "https://…", "image": "https://…" }
    ],
    "category": "Press-On Nails",                           // optional; the catalogue's dominant product type
    "priceRange": "INR 449–INR 999",                        // optional; FLAT display string, not {min,max}
    "domain": "nailin.it",                                  // optional; the brand's site host
    "logo": "https://…/logo.png",                           // optional; og:image
    "styles": ["packshot", "lifestyle"],                    // optional; image-style suggestions for generators
    "source": {                                             // optional; WHERE this came from — see "Provenance" below
      "kind": "site", "url": "https://nailin.it",
      "readAt": 1753000000000, "by": "switchboard-home"
    }
  }
}
```

**Extracted brands carry provenance.** `bank_extract_brand` parses `palette` from the CSS the site
actually serves (custom properties — including Shopify's Dawn-style `--color-primary: 196,48,28`
triplets — plus `theme-color` and merchant-declared `*brand_color*` settings), and `products` from the
live `/products.json`. It never asks a model what a brand looks like: a model handed a summarised page
rendering cannot see CSS, so it invents hexes and drops the catalogue — the exact failure this
extractor exists to end. `paletteRich[].name` therefore holds the *declaring CSS variable*
(`--color-primary`), which is why a swatch can be traced back to the bytes it came from.

**`palette` is flat CSS color strings — never swatch objects.** Every shipping consumer applies
entries directly (`el.style.background = c`) or joins them into prompts (`palette.join(", ")`):
`imagegen.js:84,108`, `persona.js:65`, `cast/spec.js:194,200`. brandbrain's *internal* locked
identity palette is `[{ name, hex }]`; published raw, each swatch stringifies to
`"[object Object]"` — broken chips in Prism and garbage in generation prompts. Producers must
flatten at the publish boundary (`flattenPalette` in the port's `bootstrap.js`) and may carry the
named swatches as `paletteRich`. The headless proof
(`examples/brandbrain-port/proof/run-context-demo.mjs`) asserts this shape.

**A model-read palette must be VERIFIED, not trusted.** The store home's site pointer reads through
WebFetch, which puts it in exactly the failure mode described above. It handles that in three layers,
and any future model-based extractor must do the same: (1) the prompt demands only colour values that
appear *verbatim* in the text the model was given, and forbids approximating a colour from a
description of one; (2) every returned hex is string-matched against the raw fetch result before it
can reach the UI, and anything that isn't literally present is dropped; (3) zero survivors publishes
`palette: []` and says so in plain words. An empty palette is correct. Three plausible invented hexes
are a lie that propagates into every ad prompt downstream.

---

## `kind: "persona"`

Produced by Cast (`examples/apps/src/persona.js` — the locked account foundation). The persona *is*
the brand-shaped grounding for content generation; it reuses the `brand` field conventions above
(`voice`, `palette` flat, `positioning`) plus Cast's locked stage picks. See `cast/spec.js` for the
card fields (`palette` on an *option card* is `[{name, hex}]` — that's Cast's internal card schema,
not the published context shape).

---

## `kind: "project"`

A unit of *work* — a repo, a product, an initiative — as portable context. Produced by the **Bank
connector's extractor** (`packages/bank-mcp` → `bank_extract_project`, which reads a repo's README,
`package.json`, `docs/`, `ROADMAP.md`, sub-packages and open `- [ ]` tasks and structures them
deterministically), by the **store home's first-project setup** (`examples/apps/src/store/point.js` —
both the GitHub-repo pointer and the local-folder pointer land here), and by any wrapp that wants to
describe itself. Consumed by **Bank** (renders each
as a project card, §03 — the cross-project viewer) and by any wrapp that wants a project's context in
one place. Its open tasks are synced separately onto the Bank board (see the `## <list>` task dialect
in `packages/bank-mcp/tasks.mjs`), so `data.tasks` here is a snapshot, not the live board.

> **Naming note:** the side panel already uses "project" for *the default context lent to apps this
> session* (`sidepanel.ts`). That's the **scoping** sense; this `kind:"project"` is the **work-unit**
> sense. Same word, two roles — don't conflate the panel's active-project selector with a project context.

```jsonc
{
  "id": "switchboard",             // stable slug — re-extracting updates in place, never duplicates
  "name": "Switchboard",           // display name; from the README H1 (before an em-dash tagline)
  "kind": "project",
  "data": {
    "summary": "BYO-Claude broker — a local sidekick brokers your model + tools to any site.", // one line
    "state": "v1.0.0 shipped; the economics layer is still simulated.",  // ONE line on where it is RIGHT NOW
    "status": "v1.0.0 · MIT",      // flat string; version (omitted when 0.0.0) · license
    "stack": ["TypeScript", "esbuild", "MCP"],           // flat strings; cheap honest markers
    "links": [{ "label": "repo", "url": "https://…" }],  // {label,url}; repo/homepage + README links
    "roadmap": ["Ship the board", "Extract projects"],   // flat strings — bullets from ROADMAP.md
    "docs": ["Vision Spec — docs/VISION.md"],            // flat strings — docs/*.md H1s
    "packages": ["sdk", "sidekick"],                     // monorepo package names (flat strings)
    "files": ["packages/sdk/src/index.ts — the developer-facing SDK"], // notable paths, flat strings
    "wrapps": ["bank", "imagegen"],                      // example/app wrapp names (flat strings)
    "tasks": ["Wire the connector into the daemon"],     // snapshot of open tasks (board is the source of truth)
    "folder": "/Users/you/Projects/switchboard",         // LOAD-BEARING — see below
    "source": {                                          // optional; see "Provenance" below
      "kind": "folder", "path": "/Users/you/Projects/switchboard",
      "readAt": 1753000000000, "by": "switchboard-home"
    }
  }
}
```

**`roadmap` is the canonical name for next steps.** Bank renders `## Roadmap` from it. A producer
that calls the same list `nextSteps` is invisible to every existing consumer — flatten to `roadmap`
at the publish boundary.

**`data.folder` is load-bearing, not decorative.** `folderOf()` in
`packages/sidekick/src/context/library.ts` reads it, so LENDING a project that carries a folder
auto-binds the consuming app's storage to that real directory. Point once and Redline reviews the
actual page on disk, Bank opens the actual vault, Huddle talks about the actual files — no copy, no
re-upload. Only set it to a path the user explicitly approved through `storage.bind`.

Same defensive-normalization rules as every kind: all fields optional, `String()`/array-guard on
consume. A wrapp describing *itself* publishes the same shape (its own name/summary/links), which is
how "every wrapp as a project" lands in one viewer.

---

## Provenance — `data.source`

Any extracted context may carry `source`, a flat record of where its facts came from. It is
advisory metadata, never a fact about the thing itself, so consumers ignore it safely.

```jsonc
"source": {
  "kind": "site" | "github" | "folder",  // which pointer produced this
  "url":  "https://nailin.it",           // for site/github
  "path": "/Users/you/Projects/thing",   // for folder
  "readAt": 1753000000000,               // epoch ms of the read
  "by": "switchboard-home"               // the producer that wrote it
}
```

Why it exists: a context is re-pointable. Re-reading the same site or folder republishes under the
same stable id (domain slug / repo slug / folder basename slug) and **updates in place** — the
library must never fill with duplicates of one site. `source` is what makes "when was this last
read, and from what?" answerable at all.

---

## Other kinds in the shared union

`task`, `person`, `event`, `decision`, `note`, `asset` are named in the vision
([VISION.md](./VISION.md) §1.2) but have no shipping producer/consumer pair yet, so their `data`
conventions are not pinned here. **Before shipping the first producer of a kind, add its shape to
this file** — the first publisher sets the de facto schema for everyone after it.
