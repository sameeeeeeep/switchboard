# Launcher routing — typed intent + dropped files, with no model

**Status:** built + verified (2026-08-16). Companion to [FAST-ROUTING.md](./FAST-ROUTING.md) (the voice
hot-path, still design-only) and [NONAI-WIDGETS.md](./NONAI-WIDGETS.md) (the tool slate this routes to).

The ⌥⌥ launcher has to answer two questions on every keystroke and every drag, deterministically, in
microseconds, with **no model call**:

1. the user **typed** something → which apps/tools do they mean?
2. the user **dropped** a file → which tools can actually take it?

Both answers live in `packages/menubar/LauncherRouting.swift` (`enum SBRoute`) — a pure Foundation module
with no AppKit/SwiftUI and no app-module types, so it compiles and unit-tests headless:

```bash
cd packages/menubar && swiftc -parse-as-library LauncherRouting.swift LauncherRouting.test.swift -o /tmp/rt && /tmp/rt
```

## What it replaced

| | Before | After |
|---|---|---|
| Typed query → apps | `name.contains(q) \|\| tagline.contains(q)` — a raw substring test | `SBRoute.score` — weighted tokens over name · **keywords** · tagline · what's-inside · command descriptions |
| Typed query → third-party tools | its own separate flat token-count scorer | the same `SBRoute.score` |
| Dropped file → tools | a hardcoded 7-id allowlist, **no notion of file type** | `SBRoute.kind` (extension → kind) + `SBRoute.accepts` (manifest-declared) |
| Spotlight rendering | `spotAll` counted a Tools group the view never rendered — ↑↓ could select an invisible row | one `spotGroups` array; both the render and the selection index derive from it |

The load-bearing failure: **"make this image smaller" matched nothing**, because no listing anywhere
contains the word "smaller". Substring search only works if you already know what the tool is called —
which is exactly what a launcher is supposed to save you from.

## The two new manifest fields

Both optional, both on `WrappListing` (`packages/protocol/src/store.ts`) and `SBListing`
(`RelayMenuBar.swift`), so every existing catalog still decodes unchanged.

```jsonc
{
  "id": "resize",
  "name": "Resize",
  "category": "tool",
  // the synonyms a name and tagline can't carry — how a TYPED sentence reaches this tool
  // without naming it. Weighted just under the name itself, so this is the single
  // highest-leverage field for discovery.
  "keywords": ["smaller", "shrink", "compress", "downsize", "scale down", "image size",
               "reduce file size", "webp", "jpeg", "png", "optimise image"],
  // which DROPPED files this listing can take
  "accepts": ["image"]
}
```

`accepts` understands four spellings, so a manifest can be written the obvious way:

| Spelling | Example | Means |
|---|---|---|
| bare kind | `"image"` | any file classified as an image |
| glob | `"image/*"` | same |
| extension | `".pdf"` / `"pdf"` | the kind that extension belongs to |
| wildcard | `"*"` / `"any"` | everything |

Kinds: `image · pdf · data · text · audio · video · archive · font · code · other`. A file is classified
by **extension only** — synchronous, allocation-free, never touches disk, so it can run on every
drag-hover frame. An unrecognised extension degrades to `other`, which no tool claims exclusively.

**A declared `accepts` REPLACES the built-in default table — it does not merge with it.** The default
table (`SBRoute.defaultAccepts`) is the original founder allowlist with the missing half (the kind)
attached, and exists only so today's wrapps route correctly before their manifests are edited:

```
god → everything   pdftools → pdf   convert → data,text   palette/prism/resize → image   qr → text,data
```

## Scoring

`SBRoute.score(query, fields) -> Int`, 0 = no match (the caller drops the row).

| Signal | Weight |
|---|---|
| whole query == name or id | +100 |
| name/id starts with the whole query | +40 |
| a token hits the **name** | +12 each |
| a token hits a **keyword** (either direction, stem-aware) | +10 each |
| a token hits the **tagline** | +4 each |
| a token hits **inside** / command descriptions | +2 each |

Stopwords ("find me a", "how do I") are dropped before scoring, so a filler word can't rank every
listing. A crude stemmer bridges the plural/gerund forms of tool vocabulary ("images"→"image",
"resizing"→"resiz") — it is not a real stemmer and doesn't pretend to be.

Typing a tool's actual name always wins outright; that's what the +100/+40 short-circuit protects.

## The two surfaces it drives

**Typed** → the spotlight groups, in order: *For this file · Projects · Apps · Tools · Files · Recent ·
Go to · Actions*.

**Dropped, nothing typed** → the drop leads with a **`FOR THIS <KIND>`** rail of every app that accepts
that kind, and every non-accepting tile in the APPS rail dims back. Nothing accepts it → an honest line
that names the one thing that always can:

> No app here takes a video. Ask below and God will work on it directly.

## Verification

- **40/40 headless assertions** (`LauncherRouting.test.swift`) — intent sentences that name no tool,
  stemmed forms, exact-name precedence, gibberish and all-stopword queries scoring zero, every file
  kind, the accepts spellings, and the "a declared list excludes the rest" rule.
- **App compiles**, 0 errors (`swiftc` over the full `build.sh` source list).
- **Catalog round-trips**: `build-catalog.mjs` → 79 listings, 6 carrying `keywords`/`accepts`, validated
  and written to `~/.relay/catalog.json`.
- **Snapshots** (`LauncherSnap.preview.swift` → `/tmp/launcher-snaps/`), each rendered from the **real**
  `SBRoute` rather than hand-written result strings: `launcher-file-image` · `launcher-file-pdf` ·
  `launcher-file-csv` · `launcher-file-unknown` (the honest empty state) · `launcher-ask-smaller` ·
  `launcher-ask-merge` · `launcher-ask-miss`.

## Why this matters more the more tools there are

Substring search degrades as the shelf grows; a keyword index improves. That is the precondition for
importing a large non-AI tool slate (see [NONAI-WIDGETS.md](./NONAI-WIDGETS.md) and the delphitools
survey below) — 70 tools you can't find are worse than 7 you can.

### Appendix — delphitools survey (2026-08-16)

[github.com/1612elphi/delphitools](https://github.com/1612elphi/delphitools) · **MIT** · 71 tools, all
browser-only, no logins, no backend. Directly overlaps the NONAI-WIDGETS slate (QR, palette-from-image,
SVG optimise, favicon, image convert/split/clip, PDF preflight, imposition, unit/colour/typography
converters, regex tester, text diff, base converter, encoders).

Facts that decide the port question:

- **`next.config.ts` sets `output: "export"`** — it is already a fully static site. No Node process, no
  server, no idle cost. That removes the device-lightness objection to hosting a build of it locally.
- **One React component per tool** (`components/tools/<id>.tsx`) over **framework-free logic in `lib/`**
  (`colour-notation.ts`, `paper-sizes.ts` 15 KB, `imposition.ts` 24 KB, `palette-strategies.ts` 28 KB,
  `zine-folds.ts`, `shavian/`). The logic is the reusable half; the UI is Tailwind + shadcn and would
  have to be rewritten to be on-brand regardless.
- **`lib/tools.ts`** is a clean registry (id · name · description · category) — a ready-made seed for
  `keywords`, whichever port route is chosen.
- Heavy deps are confined to specific tools (`@huggingface/transformers` for background removal,
  `pdfjs-dist`, `fabric`, `mafs`, ProseMirror), and Next's per-route code-splitting keeps them off the
  tools that don't use them.
