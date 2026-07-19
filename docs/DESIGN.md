# Switchboard Wrapp Store — DESIGN.md

_The design system for the wrapp-store homepage + wrapp detail/landing pages. **Dark, near-monochrome, directory-shaped.** Locked 2026-07-18. Canonical source of the live values: the `:root` block in `examples/apps/index.html` — this doc explains the intent; that block is the implementation._

> **History / status.** A warm cream "editorial getmd" system was explored on 2026-07-17 and **superseded** on 2026-07-18: the founder anchored the store on a dark tool-directory reference ("I want it exactly like the reference"). The warm exploration is dead for the store — do not resurrect it. The **extension side panel** remains its own separate dark system (`packages/extension/`), and individual **wrapps keep their own skins**; this doc governs the store shell and the `{id}-landing.html` detail pages only.

## Principles

1. **The chrome is restrained; the previews carry the colour.** The page is near-black and near-monochrome so the 42 live landing-page preview thumbnails are the only real colour. Never add decorative gradients or neon — anything that competes with a preview is wrong.
2. **Directory first.** A left sidebar (nav + your brands + categories with counts), a sticky top bar (tabs, search, filters, "Showing N"), and a scrolling main column. Browsing is the primary act.
3. **Editorial, not furniture.** Every view — including the *connected* one — leads with a real typographic statement and sub-paragraph, then sections with a kicker→title→sub rhythm and generous air. No chip-soup rows, no generic metric-tile bands. (This is exactly the note that killed v1 of the connected view.)
4. **Honesty is a design constraint.** Never fabricate numbers on the real connected path; the taskOS band shows a "coming" state. Build-cost badges are labelled dev-reported, plan/wallet are labelled SIMULATED, plays are illustrative. See `docs/TOKENS.md`.
5. **Made, not generated.** Characterful display type, tight tracking, real scale contrast, hairline borders doing the separating. No AI-slop sameness.

## Tokens (intent — live values in `index.html :root`)

**Surfaces** — near-black page, sidebar a hair darker, cards a hair lighter:
`--bg:#0A0A0B` · `--panel:#0C0C0E` (sidebar/topbar) · `--card:#131315` · `--card-2:#191A1D` (hover/active) · `--thumb-bg:#0E0E10` (behind a lazy-loading preview)

**Hairlines** — borders separate, not shadows: `--line:#232327` · `--line-2:#2C2C31`

**Ink** — off-white, never pure `#fff`: `--ink:#F4F4F2` · `--ink-2:#A2A2A8` · `--faint:#6C6C74` · `--faintest:#48484F`

**The one accent** — a solid near-white pill for primary actions: `--accent:#EDEDEA` on `--accent-ink:#0A0A0B` (aliases `--pill`/`--pill-ink`), `--accent-hover:#FFFFFF`

**Semantics — used sparingly, as a glyph or a dot, never as a fill:** `--verify:#4C8DF6` (the verified check, the only blue) · `--ok:#54B487` (live dots, "on your own Claude") · `--sim:#C8A24B` + `--sim-bg` (SIMULATED labels)

**Category colour** stays in the `glyphs.js` `FAM` families (soft tinted tile + ink glyph) — those tiles and the previews are the intended pop. Do not dark-ify them.

## Type

- `--font-display` **Space Grotesk** — display statements and section titles only. Tight: `letter-spacing:-.03em`, weight 700.
- `--font-sans` **Inter** — everything else.
- `--font-mono` — counts, build-cost receipts, `⌘K` hints; always `tabular-nums`.
- Scale: hero `clamp(30px,4vw,46px)`; section title 17–19px; body 14px; kicker `10.5px` uppercase `.14em` in `--faint`.

## Shape & depth

Radii are deliberately varied, not rounded-everything: `--r:14` cards · `--r-sm:10` controls · `--r-xs:7` · `--r-lg:20` · `--r-thumb:12` previews · `--r-pill:999`.
One restrained shadow (`--shadow`) that is mostly a 1px ring + a barely-there drop; borders do the separating.

## Canonical components

- **Sidebar rows** — `.nav-row` (glyph + label, `.active` = `--card-2`), `.cat-row` (tinted category glyph + label + right-aligned mono `.cat-count`), `.brand-row` (brand monogram + name, personalized from `context.list()`).
- **Preview thumbnail** — a clipped, fixed-aspect `.thumb` containing a 1440×900 same-origin iframe of `./{id}-landing.html`, CSS-scaled and `pointer-events:none`, mounted lazily via IntersectionObserver. This is the store's signature element.
- **Wrapp card** — preview thumbnail, then glyph + name + `--verify` check + category tag + mono build-cost receipt.
- **Featured split-hero** — left: glyph, name, description, category, near-white Open pill, build-cost; right: a live preview. Carousel dots.
- **Recently-added row** — glyph + name + one-line category. **Icons are required on this list** (explicit founder ask).
- **Wrapp detail page** (`{id}-landing.html`) — slim top bar (← All wrapps · mark · "Open on your Claude" pill → the real app URL), the page's own hero, a facts strip (category · dev-reported build cost · runs-on-your-own-Claude), and a Free/Pro block drawn only from `catalog.js` `pro` (never invented). Must stay handsome **as a scaled thumbnail** — the top bar stays slim and the hero stays the anchor.
- **Wrapp dock** — floating, frosted, bottom-centre launcher.

## The two states

Both must be equally designed — this is the standing bar:
- **Disconnected** — the editorial hero ("A home for your work, and the apps that move it forward."), the four-step "The way" stepper, Editor's picks. Clean catalog, zero personal chrome, no fake data.
- **Connected** — a display statement composed from *real* state, a sub-paragraph naming the actual brands and what's in flight, one primary CTA inside the hero, then projects / review / library — carrying the disconnected view's rhythm and air.
