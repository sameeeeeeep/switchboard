# Icon System — "Instruments on the board"

The canonical spec for Switchboard's icon + banner design language. This is the
single source the whole catalog is batch-generated from, so 30-plus different
wrapps read as **one family** the moment they land on the shelf.

Read this before generating any icon or banner. The two prompt templates in §4
are copy-verbatim; the per-wrapp `{OBJECT}` table in §5 is the batch worklist.

---

## 1. The point of view — and why it's ownable

Every app store today looks the same: a **flat rounded-tile with a thin glyph**
in the brand accent, a soft gradient, maybe a drop shadow. It's the default the
tools hand you, which is exactly why it signals nothing. Put thirty of them on a
shelf and they read as thirty strangers who happened to buy the same template.

Switchboard is a **switchboard** — a physical board of instruments you patch
together. So the icons are literally that: each wrapp is **a machined
industrial-hardware object** — graphite anodized aluminium and soft-touch
charcoal polymer, bead-blasted microtexture, precise chamfers — **photographed
like a premium product**, floating a few millimetres above an unseen surface on
near-black. Not a picture *of* a tool. The tool itself, as an object you could
pick up.

Why it's ownable:

- **It's a system, not a style.** The look isn't a filter you could copy in an
  afternoon; it's a *locked rig* (§2). The camera, the material, and the light
  never move. That constancy is the moat — it's what makes thirty unrelated
  objects obviously belong to one board. A competitor can ape one icon; they
  can't ape the family discipline without rebuilding the whole rig.
- **Category is told by form, not colour** (§3). Everyone else colour-codes
  categories, which collapses the instant you go greyscale or a colour-blind
  user arrives. We tell category by the **archetype of the object** — a grille
  vs. a dial vs. a gauge. Colour carries exactly one bit of meaning instead.
- **One lime light = "this is alive."** Exactly one lime (`#C8F250`) element per
  icon — the object's single live/functional light. Everything else is
  greyscale metal. It's the same lime as the chip, the on-dot, the "powers-on"
  motion. The shelf reads as a rack of instruments each with one indicator lit.

The promise to a viewer: *these are precision instruments, and they're all the
same make.*

---

## 2. The locked system (do not vary these)

These five things are **constant across every icon and every banner**. They are
the family. If a prompt or a regeneration drifts on any of them, it's wrong.

### 2.1 Camera — LOCKED three-quarter hero

- A **fixed three-quarter product-hero angle**: camera **~35° above** the object
  and **~20° to the side**. Same on every icon, forever.
- The object sits **centred** and **floats just above an unseen surface** (a
  hair of contact shadow below it, no visible tabletop, no horizon line).
- Slight, consistent perspective — a real lens, not an orthographic render.
- Never a flat-on, top-down, or straight-elevation view. Never a different angle
  "because this object looks better another way." The angle is the family.

### 2.2 Material — machined industrial hardware

- **Graphite anodized aluminium** (the metal body) + **soft-touch charcoal
  polymer** (grips, buttons, cable jackets).
- **Bead-blasted microtexture** on the metal — matte, fine grain, not glossy,
  not mirror-chrome.
- **Precise chamfers** on every edge; tight panel seams; the tolerances of a
  premium instrument, not a toy.
- Greyscale throughout. No brand colours baked into the body. The metal reads
  charcoal-to-gunmetal against the near-black ground.

### 2.3 Lighting — constant studio key

- A **soft key from upper-left**, gentle fill, one crisp specular highlight
  along a top chamfer. Same lighting on every object.
- **Near-black ground: `#0A0C10`.** Not pure black — a deep blue-charcoal so the
  object separates and the lime bounce reads.
- Shallow, believable contact shadow directly beneath the floating object.
- Studio-clean. No environment reflections telling a different story per icon.

### 2.4 The lime rule — EXACTLY ONE

- **Exactly one lime (`#C8F250`) element per icon.** No more, no less.
- It is the object's single **"live / functional" light** — a ring, a seam, a
  button, or a cable, depending on the category archetype (§3).
- It **casts a faint lime bounce** onto the adjacent metal and into the contact
  shadow. That bounce is the tell that the light is real and emissive.
- **Everything else is greyscale metal.** No secondary accent, no second colour,
  no lime-tinted body panels. One light, alive; the rest, inert hardware.

### 2.5 Ground & framing

- Background is always `#0A0C10`, edge to edge, no vignette gimmick beyond the
  natural studio falloff.
- **No text, no wordmark, no label baked into the icon.** (Wordmarks live in the
  layout, never in the pixels — see §4.2 / §6.)
- Object occupies the centre ~70% of the frame with quiet margin, so it survives
  down to 128px.

---

## 3. Category → form archetype

Category is legible **from the shape of the object**, before colour, before
text. Five archetypes map to the five functional families. The **lime element**
is fixed per archetype — that's how the single live-light also encodes what the
instrument *does*.

| Category | What it means | Object archetype | The single lime element |
|---|---|---|---|
| **Capture** | takes something in (voice, screen, a moment) | **perforated acoustic grille** — a mic / recorder puck, machined perforations | lime **live-ring** around the grille (the "recording" light) |
| **Make / Create** | produces an artifact (image, page, video, copy) | **control deck** *or* **work-surface slab** — a console panel or a flat machined work-plate | lime **edge-lit seam** along the deck / slab edge |
| **Structure / Think** | organizes, connects, reasons over knowledge | **modular chip-blocks** joined by a **patch cable** | the **glowing lime patch cable** linking the blocks |
| **Drive / Automate** | runs, schedules, triggers, repeats | **rotary dial / switch** — a machined knob or toggle | lime **indicator ring** on the dial (the set position) |
| **Analyze** | reads, scores, validates, reports | **gauge / readout face** — a meter or segmented display | **one lit lime segment** on the readout |

Within **Make / Create** you may alternate **control deck** and **work-surface
slab** to keep neighbours distinct — both carry the same lime edge-lit seam, so
they still read as one archetype.

---

## 4. The prompt templates (copy verbatim)

Engine: **Higgsfield `nano_banana_pro`**, render at **2K**, then export
512 / 256 / 128 (§6). Fill the `{SLOTS}` from the table in §5. Do not edit the
constant clauses — they *are* the locked system.

### 4.1 ICON template

```
A single {OBJECT}, centered, floating a few millimetres above an unseen surface,
three-quarter hero product shot — camera ~35° above and ~20° to the side.
{FORM DETAIL}. Machined industrial hardware: graphite anodized aluminium and
soft-touch charcoal polymer, bead-blasted matte microtexture, precise chamfers,
tight panel seams. Soft studio key light from upper-left, one crisp specular
highlight along a top chamfer, shallow contact shadow beneath. EXACTLY ONE lime
element — {LIME ELEMENT}, colour #C8F250 — the object's single live/functional
light, emissive, casting a faint lime bounce onto the adjacent metal; everything
else is greyscale metal, no other colour. Near-black background #0A0C10. Premium
product photography, physically based materials, redshift/octane render quality,
sharp focus, high detail. NO text, NO logo, NO wordmark, NO label.
```

### 4.2 BANNER template

Hero object in focus **off-centre-right**; the rest of the family trails **left**
into shallow-depth-of-field blur, joined by the **lime patch cable**, on a dark
switchboard surface. The **left third is deliberately empty** for the wordmark,
which is added in layout — never baked in. Render **16:9**, and a **21:9** crop.

```
Cinematic product banner on a dark machined switchboard surface. Hero object: a
{OBJECT} in sharp focus, positioned off-centre to the RIGHT, floating just above
the surface, three-quarter hero angle — camera ~35° above and ~20° to the side.
{FORM DETAIL}. Behind and to the LEFT, a family of similar machined instruments
recedes into shallow depth-of-field blur, all connected by a single glowing lime
patch cable (#C8F250) snaking between them. All objects: graphite anodized
aluminium and soft-touch charcoal polymer, bead-blasted matte microtexture,
precise chamfers. Soft studio key from upper-left. EXACTLY ONE lime accent per
object — {LIME ELEMENT} on the hero, colour #C8F250 — emissive, casting faint
lime bounce; everything else greyscale metal. Near-black background #0A0C10, the
LEFT THIRD of the frame kept empty and uncluttered for a wordmark. Premium
product photography, redshift/octane render quality, sharp focus on the hero,
creamy bokeh on the trailing family. NO text, NO logo, NO wordmark.
```

---

## 5. Per-wrapp `{OBJECT}` table — the batch worklist

One row per wrapp across the full catalog (shelved + parked + the new
flagships). `{FORM DETAIL}` and `{LIME ELEMENT}` follow the category archetype
(§3); the objects are varied so neighbours stay distinct. Wrapp ids and taglines
are from `examples/apps/src/store/catalog.js`.

### 5.0 New flagships

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `dictation` | Capture | a machined handheld dictation mic with a perforated acoustic grille head | lime live-ring around the grille |
| `meeting-notes` | Capture | a round conference-table mic puck, perforated grille top | lime live-ring around the puck rim |
| `canvas` | Make / Create | a flat machined drawing-tablet work-surface slab with a docked stylus | lime edge-lit seam down the slab's active edge |
| `video-editor` | Make / Create | a compact editing control deck with a jog wheel and a scrub bar | lime edge-lit seam along the scrub bar |

### 5.1 Featured

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `brandbrain` | Structure / Think | four modular chip-blocks arranged as a small brain-bank, patch-cabled together | glowing lime patch cable linking the blocks |
| `ideabrain` | Structure / Think | three chip-blocks fanning from a central hub block, patch-cabled | glowing lime patch cable from the hub |
| `bank` | Structure / Think | a stacked memory-bank module — machined drawers/cartridges with a patch port | glowing lime patch cable into the port |

### 5.2 Validate an idea (ideabrain templates — all Analyze readouts)

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `mkt` | Analyze | a round analog gauge with a single needle (marketplace meter) | one lit lime segment on the dial arc |
| `capp` | Analyze | a bar-graph readout panel with five stepped segments | one lit lime segment in the bar |
| `saas` | Analyze | a split-flap segment readout face (thesis meter) | one lit lime segment on the flap row |
| `retail` | Analyze | a twin-needle dual gauge cluster | one lit lime segment on the outer ring |
| `hardware` | Analyze | a rugged bezel gauge with a protective chamfered ring (reality-check meter) | one lit lime segment at the redline mark |
| `feature` | Analyze | a slim single-segment LED readout strip | the one lit lime segment |

### 5.3 The founder stack

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `adpulse` | Analyze | an oscilloscope-style readout face with a waveform track | one lit lime segment on the trace |
| `adforge` | Make / Create | a control deck with faders and a stamping-anvil work-plate | lime edge-lit seam along the deck edge |
| `shelf` | Drive / Automate | a machined rotary reorder dial with detent notches | lime indicator ring at the set position |
| `studio` | Make / Create | a work-surface slab with a docked shot-list card and a light bar | lime edge-lit seam down the slab edge |
| `aplus` | Make / Create | a work-surface slab laid out as a listing plate with slots | lime edge-lit seam along the plate edge |
| `batch` | Drive / Automate | a multi-position rotary batch selector switch | lime indicator ring on the selector |
| `take` | Capture | a small clapper-style capture puck with a perforated grille face | lime live-ring around the grille |
| `identity` | Make / Create | a machined identity name-plate work-surface slab | lime edge-lit seam along the plate edge |
| `reel` | Make / Create | a control deck with a film-reel spool and transport buttons | lime edge-lit seam under the transport row |
| `marquee` | Make / Create | a work-surface slab framed like a landing-page plate | lime edge-lit seam along the top edge |
| `huddle` | Structure / Think | three small agenda chip-blocks patch-cabled in a row | glowing lime patch cable between them |

### 5.4 After hours

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `natal` | Analyze | a circular ephemeris dial with concentric machined rings | one lit lime segment on the outer ring |
| `arcana` | Structure / Think | three card-shaped chip-blocks joined by a patch cable | glowing lime patch cable between the cards |

### 5.5 Play & make

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `redline` | Analyze | an audit meter face with a redline scale and single needle | one lit lime segment near the redline |
| `cartridge` | Make / Create | a machined game cartridge with a label window and edge connector | lime edge-lit seam along the connector slot |
| `cast` | Structure / Think | a persona patch-bay: four small chip-blocks on a rail, cabled | glowing lime patch cable across the rail |
| `prism` | Make / Create | a machined optical prism / beam-splitter block on a mount | lime edge-lit seam where the beam exits |
| `adgen` (Adwall) | Make / Create | a work-surface slab tiled as a wall of small ad plates | lime edge-lit seam along the wall's base rail |

### 5.6 Parked (re-shelve as each gets its own subdomain)

| id | Category | `{OBJECT}` | `{LIME ELEMENT}` |
|---|---|---|---|
| `arcade` | Make / Create | a mini arcade control deck with a joystick and two buttons | lime edge-lit seam under the button row |
| `yearbook` | Make / Create | a bound-plate work-surface slab like a machined book cover | lime edge-lit seam along the spine edge |
| `toon` | Make / Create | a work-surface slab with a cartoon-frame cutout | lime edge-lit seam along the frame edge |
| `storybook` | Make / Create | a work-surface slab shaped as a slim machined book | lime edge-lit seam along the page edge |
| `petrait` | Make / Create | a work-surface slab framed as a portrait plate | lime edge-lit seam around the frame edge |
| `emote` | Make / Create | a compact deck with a grid of soft-touch emote keys | lime edge-lit seam under the key grid |
| `inkling` | Make / Create | a machined stylus/pen docked on a small work-slab | lime edge-lit seam at the nib channel |
| `roomify` | Make / Create | a work-surface slab as a floor-plan plate with insets | lime edge-lit seam along the plan edge |
| `thumbs` | Make / Create | a work-surface slab tiled as three thumbnail plates | lime edge-lit seam along the strip edge |
| `meme` | Make / Create | a work-surface slab framed as a caption plate | lime edge-lit seam along the caption bar |
| `echo` | Capture | a small round speaker/mic puck with a perforated grille | lime live-ring around the grille |
| `roast` | Capture | a stage-style mic puck with a perforated grille head | lime live-ring around the grille |
| `rizz` | Make / Create | a slim work-surface slab framed as a line-card | lime edge-lit seam along the card edge |
| `anthem` | Make / Create | a synth-module control deck with sliders and a keybed strip | lime edge-lit seam along the keybed edge |
| `dreamlog` | Structure / Think | a stacked log-module of chip-blocks with a patch port | glowing lime patch cable into the port |

> When new wrapps ship (via `/wrapp`), add a row here first — pick the category,
> then the archetype writes the `{FORM DETAIL}` and `{LIME ELEMENT}` for you.

---

## 6. Motion, delivery, and wiring

### 6.1 Motion rules

- **In the grid: NEVER animated.** Every icon on the shelf is a static PNG.
  Thirty looping objects is noise; the board is calm hardware at rest.
- **On open — "powers on" (~300ms).** When a wrapp opens, its lime element
  animates on: the live-ring / seam / cable / segment fades and blooms up to
  full `#C8F250`, **synced to the grow-from-notch** motion (matches the
  every-notch-drop-grows-from-the-notch behaviour). One instrument lighting up
  as it leaves the rack.
- **Hero banner — a slow ambient loop.** A **6–10s light sweep** travels across
  the metal, and the **lime patch cable "breathes"** (gentle emissive pulse).
  Slow enough to feel alive, never busy.
- **Respect `prefers-reduced-motion`.** Both the on-open power-on and the banner
  loop must fall back to their static end-state (lime fully on, no sweep, no
  breathing) when the viewer prefers reduced motion.

### 6.2 Delivery sizes

- Render each icon at **2K** via `nano_banana_pro`, then export **512 / 256 /
  128** PNG. 512 is the source-of-truth; 256/128 are downscales that must still
  hold the object + the single lime light legibly.
- Banner: **16:9** master + a **21:9** crop, left third kept clear for the
  wordmark (added in layout).

### 6.3 Wiring note — icons aren't shown yet

`SBListing` (in `packages/menubar/RelayMenuBar.swift`, ~line 3680) already
carries an `icon: String?` field, **but nothing reads it.** The store's
`glyphTile(_:_:)` (~line 3868) renders `catGlyph(l.category)` — an SF Symbol
keyed to the wrapp's *category* — on a category-tinted rounded rectangle. So
even once these PNGs exist, the shelf will keep showing generic SF Symbols until
`glyphTile` is taught to load `l.icon` (cached like the favicon path in
`IconView` / `IconStore`) and fall back to the category glyph only when the icon
is missing. Batch-generating the art is step one; **wiring `SBListing.icon` into
`glyphTile` (and any store surface that renders a tile) is the step that makes it
visible.**
