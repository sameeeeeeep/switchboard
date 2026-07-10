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

Produced by the brandbrain port (`examples/brandbrain-port/src/bootstrap.js` → `brandToContext`)
and any brand-minting wrapp (import-from-URL extractors, naming/voice wrapps). Consumed by Prism
(`imagegen.js`), persona/Cast (`persona.js`, `cast/spec.js`), adgen.

```jsonc
{
  "id": "aamras",                    // stable — the producer's own brand id
  "name": "Aamras",                  // display name; consumers fall back to data.name
  "kind": "brand",
  "data": {
    "voice": "Warm, maximalist, unapologetically desi",   // one line; consumers fall back voice → vibe → positioning
    "positioning": "Indian maximalist home fragrance for gen z",
    "audience": "Gen z who want to mask smoke smell and relax",
    "palette": ["#8B1A1A", "#F4A000", "#0D0D0D"],          // FLAT CSS color strings — see below
    "paletteRich": [                                        // optional; named swatches, when known
      { "name": "Haveli maroon", "hex": "#8B1A1A" },
      { "name": "Saffron pulse", "hex": "#F4A000" }
    ],
    "products": ["Shot-glass candle", "Reed diffusers"],    // strings; consumers fall back products → range
    "styles": ["packshot", "lifestyle"]                     // optional; image-style suggestions for generators
  }
}
```

**`palette` is flat CSS color strings — never swatch objects.** Every shipping consumer applies
entries directly (`el.style.background = c`) or joins them into prompts (`palette.join(", ")`):
`imagegen.js:84,108`, `persona.js:65`, `cast/spec.js:194,200`. brandbrain's *internal* locked
identity palette is `[{ name, hex }]`; published raw, each swatch stringifies to
`"[object Object]"` — broken chips in Prism and garbage in generation prompts. Producers must
flatten at the publish boundary (`flattenPalette` in the port's `bootstrap.js`) and may carry the
named swatches as `paletteRich`. The headless proof
(`examples/brandbrain-port/proof/run-context-demo.mjs`) asserts this shape.

---

## `kind: "persona"`

Produced by Cast (`examples/apps/src/persona.js` — the locked account foundation). The persona *is*
the brand-shaped grounding for content generation; it reuses the `brand` field conventions above
(`voice`, `palette` flat, `positioning`) plus Cast's locked stage picks. See `cast/spec.js` for the
card fields (`palette` on an *option card* is `[{name, hex}]` — that's Cast's internal card schema,
not the published context shape).

---

## Other kinds in the shared union

`task`, `person`, `event`, `decision`, `note`, `asset` are named in the vision
([VISION.md](./VISION.md) §1.2) but have no shipping producer/consumer pair yet, so their `data`
conventions are not pinned here. **Before shipping the first producer of a kind, add its shape to
this file** — the first publisher sets the de facto schema for everyone after it.
