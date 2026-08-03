# PANEL-REDESIGN.md — the sleek Panel + notch drops, and how the dot-matrix becomes the brand

_Companion to [`NOTCH-DESIGN.md`](./NOTCH-DESIGN.md) (the token law) and [`NOTCH-PANEL.md`](./NOTCH-PANEL.md)
(the state machine). Those two say what the numbers are; this doc shows the **made** result and maps it
back to the `RelayMenuBar.swift` views the main thread edits. Two mockups accompany it:_

- **[`panel-redesign.html`](./panel-redesign.html)** — the open Panel (rail + content), state-reactive.
- **[`notch-drops-redesign.html`](./notch-drops-redesign.html)** — God pill, result widget, ambient canvas.

Open either in a browser; toggle the Panel's `daemon state` control to watch the surface breathe. Both
are self-contained (no network), port the real `DotMatrix.brightness` function to canvas, and honor
`prefers-reduced-motion` (still mid-frames), exactly as the Swift primitive does.

---

## 1. The thesis: the dot-matrix is the brand, not a theme

Switchboard is a telephone operator's switchboard; `DotMatrix` (`RelayMenuBar.swift:1870`) is literally
the operator's **lamp field** — a grid of dots whose per-dot brightness is a function of `(col, row, time)`
with four patterns (`listening` VU · `thinking` sweep · `speaking` wave · `working` ripple). Today it only
appears inside God's phase pills. The redesign makes that field the connective tissue of the whole surface,
so the brand *breathes through* the panel instead of being wallpapered on. Five uses, all restrained, all
keeping content fully legible:

| # | Where | Pattern | Restraint rule |
|---|---|---|---|
| **A. Living background** | behind the entire Panel body | `working`, ~0.05 opacity, slow | speeds up when `model.working`, tints `danger` when signed-out; never above content contrast |
| **B. Hero liveness beacon** | replaces the single hero dot in the rail | `thinking` (idle) → `working` (busy) → `listening`/danger (signed-out) | the one "live" element per surface; carries the phase without a second hue |
| **C. Structural divider** | the apps ↔ models/tools divider | static dot-row | exactly **one** divider is dotted; the rest stay hairlines so it reads as intentional, not busy |
| **D. Tile hover ripple** | each connected-app tile | `working`, dark dots, on hover only | pure hover affordance; invisible at rest |
| **E. Drop liveness** | God pill / widget header / ambient "watching" | phase-specific | same primitive, one per drop |

The discipline that keeps this from being noise: **the field is always either very faint (texture) or
very small (a beacon/indicator), never both loud and large.** A lamp field at 5% opacity behind black is
atmosphere; a 7×5 field beside the title is a status light. Neither competes with a chip label.

---

## 2. What the Panel mockup shows (and the token fixes it bakes in)

The layout is the real one: **left rail** (identity · the moment · context · daemon) + **right content**
(connected apps, then a models│tools split). Every `NOTCH-DESIGN.md` fix from the "before" column is
applied:

- **One accent.** Lime only. The connected-model dot, the loaded-Ollama chip ring, the STORE capsule,
  the hero — all lime. No `ok`-green, no cyan/orange. The signed-out state is the one sanctioned `danger`
  exception; local-only "watching" is the one `localInk` exception.
- **One type scale.** `display` 24 (hero) · `title` 18 · `heading` 14 · `body` 12 · `label` 11 ·
  `kicker` Spline-mono 9.5 (+0.14em) · `mono` 9. No half-points, no `minimumScaleFactor`.
- **One 4pt grid.** Surface padding 20; section padding 16/20; kicker→8→content→16 rhythm. No `18`.
- **One radius scale.** chips/context `sm` 12 or control `xs` 7; icon tiles at the fixed `size*0.22`
  ratio (44px tile → 10px corner); the notch bottom `lg` 20.
- **Glow budget zero at idle.** No static halos. The only glow token appears on the breathing "Working"
  hero beacon.
- **The NotchDropShape silhouette** is reproduced as a CSS `clip-path` (concave ears, ear 14, botR 20),
  so the mockup drops from a menu-bar seam exactly like the Swift shape.

Content shown is faithful to `struct Panel`: hero `Idle/Working/Sign in`, the "God ran a completion · 2m
ago" activity line, the CONTEXT picker (lime active ring), CONNECTED APPS with real wrapp names + platform
badges + the STORE capsule, MODELS (Claude Code: Opus 4.8 / Sonnet / Haiku, then Ollama locals with sizes
and a loaded-lime chip), TOOLS (per-connector rows with tool counts + a total), and the DAEMON control
cluster (pairing · logs · restart · stop · settings · power).

---

## 3. The notch drops mockup

Three surfaces, one clip, one language — proving the tokens compose:

1. **God pill = `GodStatusDrop`.** Phase label in `display`/lime + the lamp field carrying the phase
   (`thinking` shown; tap the lamp to cycle listening/speaking/working). Below: the staged **reference
   chips** (a screenshot thumbnail + a `brief.md` doc chip, each removable) and the **switch-mid-run
   project chip**. Phase is disambiguated by *pattern*, never colour — the fix for the cyan/orange literals.
2. **Result widget = `NotchWidget`.** kicker · `title` · result media at `md` (16) radius · one lime
   **primary** button + ghost Copy + a drag-out affordance. A single header lamp is the only liveness. A
   faint `working` field grains the media (texture use A, scoped to content).
3. **Ambient canvas = `AmbientCanvas`.** kicker `THIS TAB` + a slow `working` "watching · local" lamp +
   a suggestion stack (wrapp icon tile · name · sub · ↗). `localInk`/local-only honesty is stated inline.

---

## 4. Mapping to `RelayMenuBar.swift` (what the main thread changes)

Everything here is a **presentation** change against existing views; no protocol or daemon change.

| Mockup element | Swift view / line | Change |
|---|---|---|
| Living background field (use A) | `Panel.body` (`:1659`), add a layer behind `content`/`rail` inside the `NotchDropShape` clip (`:1677`) | new `DotMatrix`-backed background view (a big, faint `working` field); drive `pattern`/`speed`/`accent` off `model.working` + `signedOut` |
| Hero beacon (use B) | rail hero dot `:922`–`:925` | replace the single `Circle` + its repeatForever glow with a small `DotMatrix(pattern:accent:)` (7×5); pattern = `thinking` idle / `working` busy / `listening`+`danger` signed-out. Removes the static glow (`:924`) |
| Hero title | `:926` | `brico(26).minimumScaleFactor(0.7)` → `Font.display` (24), drop the scale factor; `heroColor` already lime/danger/ink |
| Dotted divider (use C) | the apps↔split divider `:1045` | swap that one `Rectangle().fill(.edge)` for a dot-row (a 1px `DotMatrix` still-frame or a dotted overlay); keep the others as hairlines |
| App-tile hover ripple (use D) | `appTile` `:1557` | add an `onHover` state that fades in a small dark `DotMatrix` behind the icon glyph; icon corner `size*0.24` (`:880`) → **`size*0.22`** |
| STORE capsule | `appsRow` `:1527`–`:1536` | already lime-on-12%-lime; keep — it's the reference for the token |
| Model chips | `modelChip` `:1609` | radius 9 → `sm` (12); loaded ring `lime.opacity(0.5)` → **`0.45`**; loaded dot glow `:1611` is the one tolerated live glow |
| Provider headers | `:1580`–`:1594` | Claude-Code tint `ok`-green → the health should read lime when signed-in (per §2.2); keep `danger` when signed out |
| Tools list | `toolsColumn` `:1626` | already correct (capped scroll `maxHeight:208`); only tokens (radius/spacing) shift |
| Context picker | `contextSelector` `:984` | active ring `lime.opacity(0.4)` → **`0.45`**; radius 9 → `xs`/`sm` per §5 |
| Daemon controls | rail `:946`–`:967` via `GhostButton` (`:2150`) | route through the future `SBButton(style:.ghost)`; visually unchanged |
| God pill lamp / phase colour | `GodStatusDrop` (`:1955`) + `GodGlowView.tint` (`:1810`) | all phases lime; delete the `.cyan` (`:1811`) and the `Color(red:1,green:0.72,blue:0.3)` literal (`:1813`); phase carried by `DotMatrix.Pattern` only |
| Widget/ambient accents | `GodWidgetKit` `accent = .ok` (`:26,:319`), `AmbientCanvas` inline kicker (`:71`) | accent → lime; route kicker through `Text.kicker()` (`:1685`) |
| Reduce-motion | `DotMatrix` already gates (`:1878/:1912`); the new background/beacon inherit it | ensure every added field uses the same `accessibilityReduceMotion` still-frame branch |

The mockups deliberately match the **6-step highest-impact order** in `NOTCH-DESIGN.md §12`: they are
what "collapse to one accent + impose the type/space/radius scales + zero the glow + one live field per
surface" looks like when it's done. The dot-matrix uses (A–E) are the *creative* layer on top of that
cleanup — cheap to add once `DotMatrix` is already the sanctioned liveness primitive.

---

## 5. Notes for the build

- **The background field must never cost legibility.** Cap it at ~5% opacity and keep it behind the
  `rail`/`content` fills (the rail is `#0A0A0B`, not transparent, so the field only shows in the true-black
  gutters and the content plane — which is the intended "atmosphere in the seams" effect).
- **One live field per surface.** The background counts as texture, not "live"; the *beacon* is the live
  element. Don't also animate a second thing on the Panel.
- **Dotted divider is a one-off.** If every divider becomes dots, it's noise again. Exactly one (apps↔split).
- **Fonts:** the mockups name `Bricolage Grotesque` / `Hanken Grotesk` / `Spline Sans Mono` with
  `Space Grotesk`/`Inter`/system-mono fallbacks — on a machine without those installed the fallbacks read
  correctly; the Swift app ships the real faces.
