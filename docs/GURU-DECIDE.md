# Guru Decide — rich visual decisions in the presence layer (spec)

**Status:** spec · Tier 1 (static) prototyped · relates to [`GURU-LIVE.md`](GURU-LIVE.md),
[`GUIDE-CARD-SPEC.md`](GUIDE-CARD-SPEC.md), [`PRESENCE.md`](PRESENCE.md), the switchboard connector, and
[`WEBMCP.md`](WEBMCP.md). Memory: `relay-guru-orchestration`.

## The shift — terse A/B/C → decisions you can *see*

Today a guru decision card is text + up to three labelled option chips (`optionsRow`, CursorGuide zone 5).
That's fine for "yes/no" but weak for a real fork where the *shape* of each option is the whole point
(a layout, a flow, a wireframe, a diff). The founder's ask: **guru should help me decide faster and more
comprehensively — with diagrams and wireframes, rendered right in the card.**

The insight that makes it cheap: **it's all HTML.** The `visualize` decision boards, wireframe mockups, and
diagrams are self-contained HTML/SVG. The app already renders HTML natively. So guru-decide = get that HTML
into the guru card, and route the card's picks back through the channel guru already reads.

## Two tiers

### Tier 1 — static board (PROTOTYPED)
- Path: self-contained board HTML → `HtmlCapability.render(html:width:height:)` (offscreen WKWebView →
  **PNG snapshot**) → the guru card's media zone.
- Change shipped for the prototype: `GuideMedia.tall` + a fit/420pt render in `GuideMediaView`
  (the zone was a 96pt fill-thumbnail — too small for a board). `guide-run.json` step carries
  `media: { src: "<png>", tall: true }`.
- Picks: come through the **existing** option row (`⌥1/2/3` + `⌥→`) or chat — the image itself is inert.
- Good for: a board the human *reads* then picks from. Zero live-webview risk. This is what a `god.mjs`
  decide-generator can emit today with no further native work.

### Tier 2 — live board (the real thing)
- A **live WKWebView zone** in the guru card (not a snapshot), so the board is interactive and clicks fire
  picks directly. This is also the seam that later hosts a whole **wrapp** as an in-card thinking tool.

## Tier 2 architecture

1. **A new media kind — `html` (live).** Extend `GuideMedia` with an `html` variant (inline HTML string or a
   file/URL) distinct from `image`. `parseMedia` already accepts `{src|url|path}`; add `{html:"…"}` /
   `{kind:"html"}`.
2. **`GuideHtmlZone` — a WKWebView view** (sibling to `GuideMediaView`). Loads the self-contained doc via
   `loadHTMLString(_:baseURL:)`. Reuses the `HtmlCapability` WKWebView setup (config, nav delegate) but keeps
   it **on-screen and interactive** instead of snapshotting.
3. **The click→pick bridge.** Inject a tiny JS shim so the page can call back:
   `window.guru = { pick(id){ webkit.messageHandlers.guru.postMessage({pick:id}) } }`.
   A `WKScriptMessageHandler` on the Swift side receives `{pick}` and routes it through the **existing pick
   path** — i.e. it maps to `handleAdvance` / writes `guide-result.json { chosenOption: id }` (the same file
   `god.mjs waitForGuideStep` reads). So `sendPrompt('F1a')` in a visualize board ≈ `window.guru.pick('F1a')`
   here — one adapter, and every board the model already knows how to author just works.
4. **Sizing.** The page reports its content height (`document.body.scrollHeight` via the shim on load); the
   Swift zone sets its frame height (capped, then internal scroll). The card grows to fit like any zone.
5. **Offline + theme.** The notch WKWebView runs under a tight/offline CSP, so:
   - **Bundle fonts** (system font stack + a bundled Tabler subset) — never CDN. The generator must emit
     self-contained CSS.
   - **Inject the guru palette** — pass the card's dark tokens (notch surface, lime accent, ink levels) into
     the doc as CSS variables so the board matches the card instead of the host's light theme. One injected
     `<style>` prelude, generated from the same palette `GodGlowView`/`CursorGuide` use.
6. **Safety.** The in-card webview is **display + pick only** — no navigation, no arbitrary JS reach into the
   daemon. It can *emit a pick*; it cannot *act*. (Acting is the wrapp case below, which carries its own
   per-action consent via the connector — unchanged.)

## The generator — `god.mjs` decide

A single entry the guru loop (or a `god.mjs decide`/`guide` step) calls with a structured decision:

```
decide({
  title: "Launch decisions",
  forks: [
    { id: "F1", q: "Launcher app-grid", options: [
        { id: "F1a", label: "Delete + fix copy", wireframe: <spec|svg|html>, recommended: true, note: "…" },
        { id: "F1b", label: "Re-integrate", wireframe: …, note: "…" } ] },
    …
  ]
})
```

→ emits the self-contained board HTML (dark palette prelude + the `window.guru.pick` shim) and writes a
`guide-run.json` whose media is that HTML (Tier 2) or its PNG (Tier 1), plus a mirrored `options` array so the
`⌥1/2/3` path is always a fallback. The model authors the wireframes the same way it authors a `visualize`
board — this spec just gives that output a home in the card and a wire back for the pick.

## The bigger picture — a wrapp as an in-card thinking tool

Tier 2's live WKWebView zone is the same primitive that lets guru **reason with a wrapp instead of from a
blank prompt** (the orchestration vision, `relay-guru-orchestration`):

- logo decision → guru opens **Crest** in the card for real style directions;
- landing-page decision → guru opens **Redline**, which **converses with Claude** rather than waiting for the
  human to finish.

That means a wrapp becomes startable **three ways, not one human click**:
1. **headless** (the switchboard connector / actions-layer `run(input, sb)`),
2. **via God** (`[DRIVE:<wrapp>]` — already exists),
3. **via Claude / guru** (embedded in the card, driven by the loop) ← new, this seam.

Plus the **auxiliary "open a tab"** action (show references / a form) — a native background-safe
`launch_app(urls)` / AX approach (the pattern the Cua/Clicky recon documented), gated the same as any guru
action: reversible → do it, irreversible → hand to the human.

## Build slices
1. **Tier 1 static board** — `GuideMedia.tall` + PNG board. **[prototyped]**
2. **Tier 2 live zone + pick bridge** — `GuideHtmlZone` (WKWebView) + `WKScriptMessageHandler` → `guide-result.json`.
3. **`god.mjs decide` generator** — structured decision → self-contained board HTML (palette prelude + shim) + mirrored options.
4. **Wrapp-in-card** — host a connector-backed wrapp in the live zone; wrapp↔Claude conversation; per-action consent unchanged.
5. **Open-a-tab auxiliary action** — native background-safe URL/window, gated by reversibility.

## Open questions
- Card max height before internal scroll on small notches (Tier 2 sizing).
- Whether the live zone should ever be keyboard-focusable (steals ⌥-chords) or stay pointer-only so guru
  keys keep working — lean pointer-only + `⌥1/2/3` fallback always live.
- One bundled font subset vs system-only for the board prelude.
