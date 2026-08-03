# NOTCH-DESIGN.md — the design system for the Command Centre notch surface

_The notch surface is every black shape that drops from the top-centre of the screen: the **Panel**
(status dashboard + settings), **GodStatusDrop** (God's live phase), **NotchWidget** (a wrapp's
glanceable result), **AmbientCanvas** (contextual suggestions), **ConsentDrop / ActionConsentDrop /
PermissionGateCard** (trust prompts), and the **Store** modals. They share one silhouette
(`NotchDropShape`) and one palette — and today they do **not** share a type scale, a spacing grid, a
radius scale, or a button. This doc fixes that. It is the contract future notch UI is built against._

> **Status.** Written 2026-08-03 as a corrective. The founder's read — "it looks very AI-sloppy" — is
> correct and diagnosable: the surface has good bones (`NotchDropShape`, the dot-matrix language, the
> grow-from-notch motion) wrapped in undisciplined execution (five accent colours, three radius
> scales, half-point font drift, a different button on every surface). The bones stay. This doc kills
> the slop. It supersedes nothing in `NOTCH-PANEL.md` (that spec is about *states*, this is about
> *form*); where the two disagree on a number, this doc wins.

---

## 0. What "AI-sloppy" actually means here

The surface doesn't look bad because of one wrong colour. It looks templated because **nothing repeats
exactly**. The eye reads sloppiness as *entropy*: gutters that are 18 here and 16 there and 20 over
there; a card at radius 9 beside a card at radius 12 beside one at 16; a title at 26pt, its neighbour
at 21, its cousin at 20; a lime ring at 0.5 opacity next to the "same" ring at 0.35. Each decision is
individually defensible and collectively reads as *generated, not made*. The house style
(`docs/DESIGN.md`) already names the cure: **"Made, not generated. No AI-slop sameness."** The notch
surface just never had the numbers pinned. This doc pins them.

The five specific tells, each fixed in a section below:

1. **Too many accents.** Lime, `ok`-green, `cyan`, a hardcoded orange, indigo, danger-pink — six hues
   doing "accent" duty. §2.
2. **No type scale.** ~20 distinct font sizes, most on half-points (10.5, 11.5, 12.5). §3.
3. **Three spacing grids.** The kits use a clean 4pt scale; the Panel uses an 18-based ad-hoc rhythm. §4.
4. **Three radius scales + magic numbers.** `WK`, `AmbT`, and a scatter of literals (5,6,7,8,9,10,11,
   13,16,18,20,26). §5.
5. **Gratuitous glow + a different button per surface.** §5, §6, §10.

---

## 1. Core visual language (keep — these are the good bones)

**The silhouette.** `NotchDropShape` (RelayMenuBar.swift:1670) is the identity: a full-width flat top
edge that flares *in* through two concave "ears" and rounds out at the bottom, so the black body reads
as the physical notch growing downward. This is the single strongest idea in the surface. Rules:

- **Every** top-docked surface uses it. No plain `RoundedRectangle` drops. (The Store modals at
  StoreFrontView.swift:57 and RelayMenuBar.swift:4824 use an 18pt rounded rect because they're
  centre-screen modals, not notch drops — that's the one licensed exception. If a Store panel ever
  drops from the notch, it takes the shape.)
- **Ear = 14, botR = 20–24.** Standardise on **ear 14** everywhere (AmbientDot's ear 10 is the sole
  small-stub exception). Bottom radius: **20** for the Panel, **24** for content widgets — pick per
  §5's radius scale, not per-file taste.
- **Fill is pure black (`Color.page` = #000).** Non-negotiable: it's what makes the seam with the
  black menu bar invisible. Do not tint it, do not gradient it.
- **The top edge is never stroked.** Strokes are sides+bottom only (`NotchDropOutline`, :1693), at
  `Color.edge.opacity(0.5)`, and only on surfaces that float *away* from the bar enough to need an
  edge (widgets, ambient). The Panel is strokeless by design (:1652) — it's meant to *be* the notch.

**The near-black page + the single accent.** The whole surface is monochrome graphite so that the
**one lime accent** (`Color.lime` #C8F250) is the only thing that ever pulls the eye. That is the
entire colour thesis. The **indigo** (`Color.localInk` #5B8DEF) is a deliberate, rare exception —
local-only capture — chosen *because* it can never be confused with lime. Everything else that is
currently coloured is a bug against this thesis (§2).

**The dot-matrix.** `DotMatrix` (:1844) is the signature motion primitive — the operator's lamp field.
Keep it as the only "loader/liveness" idiom. Don't add spinners elsewhere (the one `ProgressView` in
`WorkingCanvas` is tolerable but should migrate to a dot-matrix row for consistency).

**Grow-from-notch motion.** `presentFromNotch` / `dismissToNotch` (:3028) — scale from 0.04 about the
top-centre so the shape unfolds from the seam. One shared pair, correct. Keep; §7 hardens it.

---

## 2. Colour — one accent, and the exceptions are counted

### 2.1 The canonical tokens (reconcile the drift)

The tokens live in the `Color` / `NSColor` extensions (RelayMenuBar.swift:164–185). Lock these; do not
introduce a colour outside this table anywhere on the notch surface.

| Token | Hex | Role | Notes |
|---|---|---|---|
| `page` | `#000000` | the notch body fill | pure black, blends the seam — never tint |
| `rail` | `#0A0A0B` | the left rail / recessed plane | the one "off-black" plane |
| `panel` | `#141416` | card / chip / control fill | the default raised surface |
| `raised` | `#1E1E21` | hover / active / secondary-button fill | one step up from `panel` |
| `edge` | `#282829` | the hairline | **the only** border colour |
| `ink` | `#E8EDF4` | primary text | never pure white |
| `inkDim` | `#9A9AA2` | secondary text, glyphs | neutral, no blue |
| `inkFaint` | `#6C6C74` | kickers, captions, metadata | |
| `lime` | `#C8F250` | **the** accent | the only hue that pulls the eye |
| `localInk` | `#5B8DEF` | local-only capture, **only** | the counted exception |
| `danger` | `#FF2D6E` | signed-out / destructive, **only** | never decorative |

**Reconcile the near-blacks.** There are three "black-ish" values in play — `page` #000, `rail`
#0A0A0B, and `PAGE_NS` #0A0C10 (the glyph, :165). That's fine *as long as it's intentional*: `page` is
the notch body, `rail` is the one recessed plane, `PAGE_NS` is the menu-bar glyph dot. Document that
these are the **only three** and never add a fourth "slightly different black."

### 2.2 The accent problem — kill the extra hues

Today the surface has **six** colours doing accent work. The thesis allows **one** (lime) plus two
*semantic* exceptions (danger, localInk). Everything below is a violation to remove:

- **`Color.ok` (#3DD68C green)** — used as the "connected" dot on the rail (:897), the CLAUDE-CODE
  signed-in tint (:1557), and — worst — as the **default accent for every widget header** and
  `NotchWidget` (`accent = .ok`, GodWidgetKit.swift:26, :319). This green is a *second accent* seen on
  nearly every widget. **Fix:** a widget/header "healthy" dot is **lime**, not green. Reserve a green
  presence dot only for the literal daemon-health lamp on the rail, if at all — better, make even that
  lime (running+signed-in) / danger (signed-out) / `inkFaint` (down), which is exactly what `OrbView`
  already does (:1743). One health language, not two.
- **`.cyan` (listening) and the hardcoded `Color(red:1,green:0.72,blue:0.3)` orange (speaking)** in
  `GodGlowView` (:1786–1788). Two more accents, one of them an un-named literal. **Fix:** God's phases
  are distinguished by the **dot-matrix pattern** (listening VU vs speaking wave vs thinking sweep),
  not by hue. Tint all phases **lime**; if one phase truly needs to stand apart, it may use `localInk`,
  never cyan/orange. Delete the literal.
- **Lime-ring opacity drift.** The "active/selected" ring is `lime.opacity(0.5)` on model chips
  (:1596), `0.4` on the context selector (:976), `0.35` on the project chip (GodWidgetKit.swift:77).
  **Fix:** one token — **active ring = `lime.opacity(0.45)`** — used everywhere.
- **"Ink on lime" is two values.** Text on a lime fill is `.rail` in some buttons (ConsentDrop Allow
  :2003, StoreView chips :2005) and `.page` in others (WKActionButton :115, StoreFront Get :130).
  **Fix:** ink-on-lime is always **`.page`** (#000). One value.

**The rule going forward:** if you are about to write a `Color(...)` literal or reach for a
system colour (`.cyan`, `.orange`) inside a notch view, stop — it's a bug. Every colour comes from
§2.1.

---

## 3. Type — a real scale, no half-points

Today there are roughly twenty distinct sizes, most fractional (hanken 10/10.5/11/11.5/12/12.5/13/14;
splMono 8/8.5/9/9.5/10/11/12; brico 14/15/16/17/19/20/21/22/26). Fractional nudging to make things fit
is the single loudest "generated" tell. Replace with a **discrete 7-step scale**. The fonts stay:
**Bricolage Grotesque** (display), **Hanken Grotesk** (body/UI), **Spline Sans Mono** (numbers/kickers),
**Doto** (the wordmark only).

| Name | Size / weight / face | Tracking | Use |
|---|---|---|---|
| `display` | Bricolage **24 / bold** | −0.01em | the one hero title per surface (Panel "Idle/Working", drop titles) |
| `title` | Bricolage **18 / bold** | −0.01em | section titles, store section heads, widget titles, hero cards |
| `heading` | Hanken **14 / semibold** | 0 | card/chip titles, list-row primary, consent headline |
| `body` | Hanken **12 / regular** | 0 | descriptions, taglines, activity lines |
| `label` | Hanken **11 / medium** | 0 | chip labels, button labels, captions |
| `kicker` | Spline Mono **9.5 / — ** | +0.14em (kerning 1.4) | the ALL-CAPS section eyebrows |
| `mono` | Spline Mono **9 / —** | +0.04em | counts, metadata, receipts, model names |

Rules:

- **Two weights of Bricolage only: bold.** Display type is bold or it's not display. No semibold
  Bricolage headings floating between `title` and `heading` (kill brico 15/16/17/19/21 → snap to 18 or
  24; the Panel hero's 26 → 24; StoreView's 21 → 24; section heads' 17/19 → `title` 18).
- **Body is 12, full stop.** No 12.5, no 11.5-for-density. If a block needs to feel denser, tighten
  *line-height/spacing* (§4), not the point size. Every `.hanken(12.5)` and `.hanken(11.5)` collapses
  to `body` (12) or `label` (11).
- **The kicker is defined once** (`Text.kicker()`, :1660) — **use it everywhere**. AmbientCanvas
  re-implements it inline (AmbientCanvas.swift:71) and `KindTag` invents splMono 8 (:21). Route both
  through `.kicker()` / `mono`.
- **`minimumScaleFactor` is a smell.** The Panel hero uses `.minimumScaleFactor(0.7)` (:905) so a long
  word shrinks. That means the type is being auto-fit instead of designed. Pick a size that fits the
  known strings ("Offline/Idle/Working/Sign in") and drop the scale factor.

Add these as `Font` helpers next to `brico/hanken/splMono` (e.g. `Font.display`, `.title`, `.heading`,
`.body`, `.label`, `.mono`) so a view **cannot** ask for `.hanken(12.5)` — the smear becomes
unspellable.

---

## 4. Spacing & rhythm — one 4pt grid, delete 18

The kits already have the right idea: `WK` (GodWidgetKit.swift:11) and `AmbT` (AmbientCanvas.swift:11)
both define a clean **4pt scale**: 4 · 8 · 12 · 16 · 20 · 24. The Panel ignores it and runs an
**18-based** ad-hoc rhythm (`.padding(18)` on the rail, content, and both columns; then 30, 14, 13, 12,
11, 9, 8, 7, 6 sprinkled through). 18 is not on the grid; it's the number that started the drift.

**The fix: promote the kit scale to a module-level token and delete every off-grid literal.**

```
enum SB {                       // Switchboard spacing — the ONE grid
  static let s1: CGFloat = 4
  static let s2: CGFloat = 8
  static let s3: CGFloat = 12
  static let s4: CGFloat = 16
  static let s5: CGFloat = 20
  static let s6: CGFloat = 24
}
```

- **Surface padding = `s5` (20).** The Panel's rail/content/column `.padding(18)` → **20**. The rail's
  `.padding(.top, 30)` → **s6 + s2 (24+8) = 32** if that gap is intentional, else `s6`. Every "18" in
  RelayMenuBar becomes 16 or 20; every "13/14" becomes 12 or 16; every "9/11" becomes 8 or 12.
- **`WK` and `AmbT` merge into `SB`.** Three enums with the same six numbers is itself a tell. One
  `SB`, imported by all three files (same module).
- **Vertical rhythm inside a section:** kicker → `s2` (8) → content → `s4` (16) → next section. The
  Panel's mix of `.padding(.bottom, 12/14/8)` between model groups (:1554, :1560, :1565, :1570)
  collapses to that rule.
- **Section gutters match.** The Store's `M.gap = 24` (`s6`) is right; make the Panel's inter-section
  spacing the same 24 so the two surfaces feel like one product.

---

## 5. Corners & strokes — one radius scale, one hairline

### Radius
Three scales exist (`WK.rSm/rMd/rLg` = 7/12/16; `AmbT` = 7/12; `StoreFrontView.M` = 16/13) plus raw
literals 5,6,8,9,10,11,18,20,26 scattered through RelayMenuBar and StoreView. Collapse to **one
four-step scale**, shared:

```
enum SBr {                      // the ONLY radii on the notch surface
  static let xs: CGFloat = 7    // small controls: ghost buttons, keycaps, chips, icon chips
  static let sm: CGFloat = 12   // cards, list rows, chip groups, context menu
  static let md: CGFloat = 16   // result media (image/gallery), hero cards, widget content
  static let lg: CGFloat = 20   // the notch bottom (botR) and the centre-screen Store modal → 20, not 18
  static let pill: CGFloat = 999
}
```

- Every control at 5/6/8/9/10/11 → **`xs` (7)**. Every card at 12/13/14/16 → **`sm` (12)** or `md` (16)
  by role (chip=sm, media=md). The economy toggle track's ad-hoc 11 (:1192) → a `pill`. The Store
  modal's 18 (:57, :4824) → **`lg` (20)** so it matches botR. `LocalCaptureBorder`'s 26 (:117) is
  full-screen chrome, outside the scale — leave it, but it's the only exception.
- **Icon-tile corner is a fixed ratio, not a per-call number.** Today it's `size*0.24` (appIcon :864),
  `size*0.26` (glyphTile :4892), fixed 13 on both 46px and 92px tiles (StoreFront), 20 on 92px
  (heroArt). Pick **one superellipse ratio — `size * 0.22`** — and apply it everywhere an app/wrapp
  icon is tiled, so a 44px tile and a 92px tile read as the same rounded-square family.

### Stroke
- **One hairline: `Color.edge`, 1px.** Good news — the surface is already ~90% there. The remaining
  drift is the *active* ring (§2.2: standardise to `lime.opacity(0.45)`) and the floating-widget edge
  (`edge.opacity(0.5)` — keep, but only on widgets/ambient that float off the bar; the Panel stays
  strokeless).
- **Never a shadow as a separator.** Borders separate; shadows are for glow only (and §5's budget
  nearly zeroes glow). The Store modal's implicit elevation is fine; no drop-shadows between cards.

### Glow — the gratuitous-glow tell
Soft lime glows are sprinkled at radii 3/6/7 with opacity 0.3–0.7: rail wordmark (:894), hero dot
(:903), model-chip dot (:1586), OrbView pill (:1736), ambient dot (:99). This is exactly the
"gratuitous glow" the founder is reacting to. **Budget: at most one glowing element per surface, and
only on a genuinely *live* element** (a breathing "Working" state). Concretely:

- Keep the glow **only** on the breathing "Working" indicator (rail hero dot while `working`, OrbView
  working pill). One token: `shadow(color: .lime.opacity(0.5), radius: 6)`.
- **Remove** the static glows: the wordmark square's shadow (it's not live), the idle model-chip dot
  glow, the ambient "watching" dot glow. A lime dot on black is already bright; it doesn't need a halo.

---

## 6. Motion

- **Entry/exit = grow-from-notch, always.** `presentFromNotch` (0.04→1 scale about top-centre, 0.24s,
  ease-out with a slight settle) / `dismissToNotch` (0.15s, ease-in). One pair, every drop. Correct
  today — don't fork it.
- **Reduce-motion is a hard contract, and it's currently half-honoured.** `DotMatrix` checks
  `accessibilityReduceMotion` (:1852) — good. But `presentFromNotch`/`dismissToNotch` and **every**
  `.repeatForever` breathe (rail hero :904, OrbView :1738, WorkingCanvas bar :287, GodGlowView
  pulse/sparkles :1828/:1807) do **not**. **Fix:** when
  `NSWorkspace.shared.accessibilityDisplayShouldReduceMotion` is true, the grow becomes a **200ms
  cross-fade** (per `NOTCH-PANEL.md` §1) and every repeating animation renders a **still mid-frame**.
  Gate them all through one `motionOK` helper.
- **Restraint budget.** One continuous animation per surface at a time (the live phase). No decorative
  motion — the sparkle trail in `GodGlowView` (:1807) is borderline; keep it *only* during an active
  God turn, never idle.
- **Durations are tokens too:** in = 240ms, out = 150ms, toggle/hover = 150ms (matches the economy
  toggle :1194 and settings flip :943 — already consistent, keep). No fourth duration.

---

## 7. Iconography

- **App/wrapp identity = the real icon; platform = the badge.** Keep the `platformBadge` system
  (:1523) — a 15px page-black circle with an `edge` stroke and an `inkDim` glyph, bottom-right of a
  44px tile. This is a genuinely good, legible pattern. Standardise the badge at **15px** and the
  overlap offset at **`(4, 4)`** everywhere (it's already consistent — protect it).
- **SF Symbols are the fallback and the metadata glyph, never the hero.** Weight discipline: metadata
  glyphs at `.system(size: X, weight: .semibold)`; don't mix `.medium` and `.semibold` at the same
  size in the same row (the Panel does — e.g. :1044 semibold vs :554 medium).
- **Category tiles keep their tint** (the `FAM`/`catTint` families) — that colour is *content*, like
  the web store's preview thumbnails, and is exempt from the single-accent rule. But a category tile
  is the **only** place non-lime colour is allowed to sit on a chrome surface, and only as a *tile
  fill behind a glyph*, never as text or a border.
- **One glyph per concept.** "Close" is `xmark` in a circle; "remove/unload" is `xmark` (no circle);
  "disconnect" is `xmark.circle.fill`. Three xmarks with three meanings is tolerable *only* if the
  container disambiguates — audit that a bare `xmark` never means two things on one surface.

---

## 8. Density

- The notch surface is a **glance** surface, not a settings app. Target: a drop is readable in <1s and
  fits without scrolling on a 13" display. The Panel is right at the edge (620pt wide, tall) — resist
  adding rows; push depth into the Store modal instead.
- **Containment, not overflow.** The existing rule is correct and should be universal: any list that
  can grow (connections :1330, tools :1611, long text :260) scrolls **inside a capped frame**, never
  stretches the drop past the screen. Codify one cap token per context (list ≈ 236, tools ≈ 208, text
  ≈ 340 today — fine, just name them).
- **Two columns max.** The Panel's models│tools split (:1025) is the maximum horizontal division; don't
  add a third column.

---

## 9. Component primitives to factor (the missing shared kit)

The deepest structural cause of the slop: **every surface reinvents its controls.** There are at least
six button implementations (`GhostButton` :2124, `WKActionButton` GodWidgetKit:107, `tabPill`
StoreFront:102, the chip pills StoreView:4856, the lime "STORE" capsule :1502, the ConsentDrop
Allow/Deny :1996) and four chip implementations. The `WK*` kit is well-built but only the widget uses
it. **Promote one control kit to the module and delete the duplicates.** Minimum set:

- **`SBButton(style: .primary | .ghost | .danger)`** — one button. Primary = lime fill, `.page` ink,
  no border; ghost = `panel` fill, `inkDim` ink, `edge` border, hover→`raised`; danger = `edge`-danger
  stroke, `danger` ink. Radius `xs`. Replaces all six.
- **`SBChip`** — capsule or `sm`-radius, `panel` fill, `edge` (or active `lime.opacity(0.45)`) border.
  Replaces model chips, category chips, tab pills, kind tags, steer chips.
- **`SBIconTile(size:)`** — real-icon-or-fallback rounded square at the fixed `size*0.22` ratio.
  Replaces `appIcon`, `glyphTile`, `iconTile`, `heroArt`.
- **`SBSection(kicker:) { }`** — the kicker → `s2` → content rhythm, so no view hand-rolls the spacing.

Once these exist, a new wrapp UI is *composed* from them and is correct by construction — which is the
whole "intentional, not templated" goal.

---

## 10. DON'Ts (the sloppy patterns, named)

1. **Don't introduce a colour outside §2.1.** No `.cyan`, no `.orange`, no `Color(red:…)` literal, no
   second green. Six accents is the #1 tell.
2. **Don't pick a font size off the scale.** No 10.5/11.5/12.5. If it doesn't fit, fix spacing, not
   size. No `minimumScaleFactor` as a crutch.
3. **Don't invent a gutter.** 18 is banned. Everything is 4·8·12·16·20·24.
4. **Don't invent a radius.** 5/6/9/10/11/13/26 are banned; snap to 7·12·16·20.
5. **Don't add a glow to a static element.** Glow is reserved for the one live "Working" indicator.
6. **Don't re-implement a button or chip.** Use the §9 kit; if it can't express what you need, extend
   the kit, don't fork it inline.
7. **Don't stroke the top edge of a notch drop.** It must vanish into the bar.
8. **Don't animate on idle, and don't skip the reduce-motion branch.** Every `.repeatForever` needs a
   still fallback.
9. **Don't let a drop grow past the screen.** Cap-and-scroll every growable list.
10. **Don't use green as "healthy."** Health is lime/danger/faint (the OrbView language), not a third
    hue.

---

## 11. Before → after (concrete, line-referenced)

| Where | Before (today) | After |
|---|---|---|
| `NotchWidget` / `WidgetHeader` accent | default `= .ok` green dot on every widget (GodWidgetKit.swift:26, :319) | lime; green retired from widgets |
| `GodGlowView` phase tints | `.cyan` listening + literal orange speaking (:1786–1788) | all lime, distinguished by dot-matrix pattern; delete the literal |
| Active ring opacity | 0.5 / 0.4 / 0.35 across chips/selectors (:1596, :976, GodWidgetKit:77) | one token `lime.opacity(0.45)` |
| Ink on lime | `.rail` vs `.page` mixed (:2003 vs :115) | always `.page` |
| Panel padding | `.padding(18)` ×4 + 30/14/13/12/… (:949, :919, :1521, :1582…) | `SB.s5 (20)` surface, 4pt grid throughout |
| Panel hero title | `brico(26)` + `minimumScaleFactor(0.7)` (:905) | `display` (24), no scale factor |
| Section titles | brico 15 / 17 / 19 / 21 (:1032, :163, :4832…) | `title` (18) everywhere |
| Body text | hanken 11.5 / 12 / 12.5 mixed | `body` (12) |
| Radii | 5/6/8/9/10/11/13/16/18/20/26 scattered | `SBr` 7·12·16·20 (+999) |
| Icon-tile corner | `size*0.24`, `*0.26`, fixed 13, 20 | one ratio `size*0.22` |
| Store modal corner | 18 (:57, :4824) | `lg` 20 (matches botR) |
| Static glows | wordmark/hero/chip/ambient dot halos (:894, :903, :1586, :99) | removed; glow only on live "Working" |
| Reduce-motion | only `DotMatrix` honours it (:1852) | `presentFromNotch`, all `.repeatForever` gated on `motionOK` |
| Kicker | re-implemented inline in AmbientCanvas (:71), `KindTag` at splMono 8 (:21) | all route through `.kicker()` / `mono` |
| Buttons | 6 implementations | one `SBButton(style:)` |

---

## 12. Highest-impact fixes, ranked

The order is chosen so the surface stops reading as templated as fast as possible — colour and type
carry the most "slop" signal per hour of work.

1. **Collapse to one accent.** Retire `ok`-green from widgets/headers (GodWidgetKit `accent` → lime),
   delete the `cyan`/orange literals in `GodGlowView`, unify the active ring to `lime.opacity(0.45)`,
   and make ink-on-lime always `.page`. *Biggest visual payoff; touches few lines.*
2. **Impose the type scale.** Add `Font.display/title/heading/body/label`, then sweep RelayMenuBar +
   StoreFrontView + StoreView replacing every ad-hoc size, killing all half-points and the
   `minimumScaleFactor`. *Kills the loudest "generated" tell.*
3. **One spacing grid + one radius scale.** Promote `WK`/`AmbT` into module-level `SB` and `SBr`,
   delete `18` and the stray radii. Merge the three enums. *Removes the entropy the eye reads as sloppy.*
4. **Zero the gratuitous glow.** Strip static halos; keep one live glow token. *Cheap, high signal.*
5. **Harden reduce-motion.** Gate the grow-from-notch and every breathe behind one `motionOK` helper
   with still fallbacks. *Correctness + polish; also an accessibility gap.*
6. **Factor the control kit (`SBButton`/`SBChip`/`SBIconTile`/`SBSection`).** The structural fix — once
   it exists, future notch UI is correct by construction. *Largest effort, longest-lived payoff; do it
   last so the tokens above are settled before the primitives bake them in.*

_Ship 1–4 first; they're a day of edits with no behavioural risk and turn the surface from "AI
default" to "made." 5–6 are the durable investment that keeps it that way._
