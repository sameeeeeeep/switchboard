# Crest — brief in, brand kit out

**Status:** full spec, decision-ready. Crest is a guided **starter brand-identity studio** — the
express, self-serve subset of brandbrain focused on one job: *turn a plain-language brief into a usable
logo system and a well-designed starter brand kit,* iterating with the user at every step. It runs on the
visitor's own Claude (text/strategy + SVG wireframes) and Higgsfield (image renders), device-light, in-tab.

> **The promise:** a founder, community lead, or volunteer types a paragraph about their brand and walks
> out with 3 strategic logo directions, 4 rendered marks per pick they can steer, refined lockups, and a
> handoff-ready brand-kit PDF — in one guided session, without an agency.

Design doctrine (shared with every wrapp): **context-first · single input to start · options with exactly
one recommended · the user steers at every step · nothing finalizes without a pick · house design system ·
device-light.** Crest's spine is "propose → recommend → you choose → refine," repeated at each stage.

---

## 1. The guided flow

One auto-advancing pipeline; each stage renders options the user can accept, tweak, regenerate, or reject.

```
 BRIEF ─▶ (optional) SHARPEN ─▶ STRATEGY ─▶ 3 DIRECTIONS ─▶ pick ─▶ TYPE×STYLE ─▶ 4 MARKS ─▶ pick
   │                                                                                            │
   ▼                                                                                            ▼
 well-designed BRAND-KIT PDF  ◀─────────  brand kit assembly  ◀─────────  REFINE (lockups) ◀────┘
```

| # | Stage | What it produces | The steering |
|---|-------|------------------|--------------|
| 1 | **Brief** | free text: name + what it is / who for / any vibe. One field, Go. | — |
| 2 | **Sharpen** (optional, skippable) | ≤5 high-value questions (§6.1); the user answers or skips → Crest states its assumptions and proceeds. | skip / answer inline |
| 3 | **Strategy read** | short: name interpretation + the single strongest strategic territory (not a 100-page strategy). | "shift the territory" re-run |
| 4 | **3 directions** | 3 genuinely different concepts (typography-led · symbol/monogram-led · community/expressive-led), each fully specced (§4.3). One **recommended**. | pick one · combine two · "another set" · edit any field |
| 5 | **Type × Style** | within the chosen direction, the user confirms/adjusts the **logo TYPE** (§3) and **STYLE dimension** (§4) — anchored in famous logos, with instant SVG example cues. | pick type · pick style · defaults recommended |
| 6 | **4 marks** | 4 concrete marks for the pick, each shown two ways: a live **SVG wireframe** + a **Higgsfield render**. | per mark: ♥keep · ↻regen · "more like this" · overall: 4 more · change type/style · "tell me what to change" |
| 7 | **Refine** | the chosen mark expanded into the working **lockup set**: primary horizontal · compact/stacked · avatar/monogram · wordmark-only · 1-color · light + dark. | regen any lockup · nudge |
| 8 | **Brand kit** | assemble everything into a designed, multi-page **brand-kit PDF** (§5) — logos, palettes, type, usage, do/don'ts, applications, voice, taglines, one-pager. | edit sections · re-export |

Nothing is auto-final: the user confirms the direction (stage 4), the mark (stage 6), and the kit (stage 8).
Every generative step offers options + a recommendation and lets the user tweak or regenerate.

### 1.1 Inputs, constraints & the "avoid" list (structural — threaded through every generation)

A brand brief is not just "who you are" — it's also "what you're NOT" and "what must be preserved." These
are first-class inputs, captured up front and **threaded into every strategy/direction/mark prompt** as
positive requirements + negative constraints. Missing any of these is how a generator drifts into cliché.

| Input | What it captures | How it's used |
|---|---|---|
| **Brief** | name · what it is · who it's for · any vibe | seeds everything |
| **Rebrand continuity** (optional) | "this replaces <old name>; **preserve** <spirit/equity>, **leave behind** <what no longer fits>" | keeps the warmth/equity while allowing a genuinely fresh mark; the model is told NOT to just restyle the old identity |
| **Brand qualities** | a set of adjectives the identity must *feel* (e.g. contemporary · welcoming · credible-not-institutional · energetic-not-loud · flexible) — captured/expanded in the foundation, not just a 3-word personality | tunes tone, type, color, and the recommendation |
| **AVOID list** (the anti-brief) | clichés, symbols, colors, and *registers* to steer away from — e.g. "no literal flag mashups, no globes/handshakes, no stereotypical motifs, don't feel like a government body or a consulting firm, don't be unreadable or too intricate to work as an avatar" | injected as **hard negative constraints** into every image prompt + a validation pass that flags a direction if it drifts toward an avoided trope |
| **Audience & ambition** | primary audiences · geographic reach (one city → global) · professional↔community balance · tagline/descriptor need | from the ≤5 sharpen questions (§6.1); shapes strategy + whether a descriptor is proposed |

The AVOID list is the structural piece most identity tools miss: without it, "cross-cultural community" reliably
produces flags, globes, and handshakes. Crest makes "what to avoid" an explicit, enforced input.

---

## 2. Logo TYPE taxonomy (comprehensive, anchored in familiar logos)

The classic structural taxonomy, each anchored to logos the user already knows (anchors are **text labels
only** — never reproduce the real trademark; the example cue is a generic original SVG we draw). Recommend
one per brief, but expose all.

| Type | What it is | Familiar anchor (text ref) | Best when |
|---|---|---|---|
| **Wordmark / logotype** | the name itself, styled | Google · Coca-Cola · FedEx | a distinctive, readable name worth featuring |
| **Lettermark / monogram** | initials only | IBM · HBO · McDonald's (M) · CNN | a long name that shortens well |
| **Pictorial / brand mark** | a literal recognizable object | Apple · Target · Twitter bird | a concrete concept, memorable at avatar size |
| **Abstract mark** | a non-literal geometric symbol | Nike · Pepsi · Chase · Adidas ball | meaning conveyed by form/motion, not an object |
| **Combination mark** | symbol + wordmark together | Lacoste · Burger King · Doritos | flexibility: use together or split the mark out |
| **Emblem / crest / badge** | name+symbol locked in a contained shape | Starbucks · Harley · BMW · Warner Bros | heritage, authority, community/club feel |
| **Mascot / character** | an illustrated persona | KFC (Colonel) · Michelin · Pringles · Mailchimp | warmth, storytelling, approachability |
| **Negative-space mark** | meaning hidden in the counterform | FedEx arrow · WWF panda · NBC peacock | a clever, memorable "aha" |
| **Dynamic / systemic mark** | a flexible mark that adapts across contexts | MIT Media Lab · Google (dynamic) · a container that reflows | a brand that spans many activities/sub-brands |

(For a community "Club" brief, **emblem/crest**, **combination**, and **monogram** usually score highest —
but Crest derives the recommendation from the strategy read, never a hardcode.)

---

## 3. STYLE / RENDER dimension taxonomy (comprehensive)

Style is orthogonal to type — it's *how the mark is rendered*. Crest treats style as a few small sub-axes
the user composes, each with an instant SVG cue and (where it helps) a familiar anchor.

**3.1 Form / rendering** (the primary axis)

| Style | Feel | Anchor |
|---|---|---|
| Flat / minimal | modern, clean, scalable | Airbnb, Slack |
| Monoline / line | light, contemporary, friendly | Airbnb icon, many app icons |
| Solid / bold fill | confident, high-contrast, avatar-safe | Apple, Target |
| Geometric | precise, systemic | Adidas, Chase |
| Gradient / mesh | vibrant, digital, energetic | Instagram, Firefox |
| 3D / dimensional | premium, playful-tech | modern app icons |
| Isometric | technical, product-y | dev/tooling brands |
| Illustrative / detailed | crafted, characterful | Lacoste, craft brands |
| Hand-drawn / organic | human, warm, artisanal | indie/food brands |
| Pixel / bitmap | retro-digital, gaming | 8-bit brands |
| Textured / stamp / letterpress | heritage, tactile | coffee, spirits |
| Duotone / two-tone | economical, print-safe | editorial brands |
| Monochrome / 1-color | timeless, most versatile | required for the 1-color test |
| Neon / glow | nightlife, energetic | events |
| Retro / vintage / heritage | trust, nostalgia | badges, clubs |
| Cut-out / paper / collage | craft, community, warm | cultural orgs |
| Kinetic / motion-ready | digital-native, systemic | dynamic brands |

**3.2 Color approach:** monochrome · duotone · limited (2–3) · full-color · gradient · muted/earthy · vibrant.
**3.3 Typographic character** (for wordmark/combination): geometric sans · humanist sans · rounded sans ·
serif · slab · display · mono · custom lettering. **3.4 Composition:** horizontal lockup · stacked ·
enclosed/badge · symmetric · asymmetric.

**3.5 The powerful idea — type × style "recipes."** The same *type* reads completely differently by *style*,
and anchoring the pair teaches the user fast:

| Recipe (type × style) | Reads like |
|---|---|
| Pictorial × **solid** | Apple |
| Pictorial × **illustrative** | Lacoste |
| Abstract × **gradient** | Instagram |
| Abstract × **geometric** | Chase |
| Emblem × **heritage/textured** | Harley-Davidson |
| Mascot × **illustrative** | KFC |
| Wordmark × **geometric sans** | Google |
| Monogram × **serif** | Louis Vuitton |
| Combination × **flat** | Burger King (rebrand) |

Crest surfaces a curated shelf of recipes (recommended one highlighted) so a non-designer picks a *look*,
not a jargon term — while the two axes stay editable underneath for anyone who wants control.

**Trademark safety (invariant):** brand names are recognizable **reference labels only**; every on-card
example cue is a generic, original mini-mark Crest draws; every Higgsfield prompt describes the type/style
generically ("a solid pictorial mark," never "the Apple logo").

---

## 4. The 3 directions — what each carries

Per the brief's ask, the three directions must be *meaningfully* different (typography-led · symbol-led ·
community-led), not variations. Each direction card carries:

1. concept name · 2. central idea & symbolism · 3. structure (type from §2) · 4. what it looks like ·
5. recommended typography (free/accessible fonts + fallbacks) · 6. color palette (hex) · 7. why it fits ·
8. risks/weaknesses · 9. a polished, ready-to-run image-generation prompt. Crest **recommends the strongest**
with a one-line why, then **waits for the user to pick or combine** — never finalizing first.

---

## 5. The starter brand kit (the output)

**Output formats:** logos as **PNG/SVG** (transparent), the kit as a **designed multi-page PDF** (primary),
with a PPT export option (reusing Deck's pptxgenjs path) as a fast-follow. The PDF is built from **designed
HTML pages** (full CSS control, real fonts, the generated marks) → exported client-side — so it looks
crafted, not a form dump.

**Output mode — a SHAREABLE interactive kit-chooser (the "do the work once, share the choosing" idea).**
Beyond the flat PDF, Crest can export a **single self-contained HTML file** that packages *all the options
already generated* (the mark set, palette variants, type pairings, lockups) and lets the RECIPIENT — a
co-founder, a client, the community — **browse, pick their favorites, and download the finalized kit
themselves.** The generator did the expensive work once (Claude + Higgsfield); the *choosing* becomes a
delightful, shareable artifact. Key properties: fully offline/self-contained (all assets inlined as data
URIs — no server, no re-generation), **limited strictly to what was already generated** (the recipient
composes from the option set, never triggers new gen), and it emits the same designed PDF/kit on "download."
It's the collaborative-decision surface — one link, they choose, they leave with the kit. (Build phase P3.)

Contents (each a designed page/section):

1. **Logo suite** — primary · secondary/lockup · icon/avatar · wordmark-only.
2. **Backgrounds** — light and dark versions; the **1-color** version (the small-size/one-color test).
3. **Color** — primary + secondary palettes with **HEX · RGB · CMYK (labeled approximations, §7) · usage**.
4. **Typography** — display/brand font · body font · optional accent · fallbacks; all **free/Google fonts**
   by default; sample settings (headline/body/caption).
5. **Clear-space & minimum size** — spacing rules + the smallest safe size.
6. **Misuse** — a "don't" grid (stretch, recolor, low contrast, busy background, rotate, add effects).
7. **Applications / visual language** — mini-mockups (not just described) across the real surface set:
   **Instagram/LinkedIn avatar** (the 1-color, small-size proof) · **WhatsApp/community graphic** ·
   **newsletter banner** · **event poster** · **website hero** · **presentation/deck slide** ·
   **name badge / simple merch** · **partnership/sponsor lockup** — and it must hold up in **both digital
   and basic print** (so the core mark never depends on gradients or fine detail; those live only in the
   supporting system).
8. **Brand voice** — a short, usable summary (3–4 traits + one do/don't line).
9. **Taglines** — 3 options, with an explicit "works fine without one."
10. **One-page summary** — the hand-to-a-designer/volunteer sheet: mark, palette, type, one rule each.

The kit must survive real use: recognizable in one color and at avatar size; no dependence on gradients or
fine detail for the core mark (those live in the *supporting* system, per the brief).

---

## 6. Steering & the intake questions

**6.1 The ≤5 sharpening questions** (asked once, up front, all skippable):
primary audiences · geographic ambition (one city → global) · professional↔community energy balance ·
whether the name needs a descriptor or tagline · strongly liked/disliked styles or brands. If unanswered,
Crest states sensible assumptions and proceeds (never blocks).

**6.2 The steering model** (everywhere): each generative step = *N options + one recommended + tweak/regen/
reject + a free-text "change this"*. The user is never handed a finished thing to accept-or-restart; they
compose the identity choice by choice. This is the whole UX thesis — a non-designer gets agency without
needing the vocabulary.

---

## 7. Architecture

| Concern | How | Reuse |
|---|---|---|
| Connect / stream / consent | the standard wrapp plumbing (regex.js template, `whenRelayReady`, the stream contract) | every wrapp |
| Strategy · directions · kit copy | `window.claude` streamed structured JSON per stage | brandbrain/adforge pattern |
| SVG wireframe marks | Claude streams inline SVG → `sanitizeSvg` → render live (instant, free, editable) | template helper |
| Rendered logo images | **Higgsfield** via the exact `genImage` wire in `imagegen.js` (`relay.stream({prompt, agentic:true})` → image URL); scope grants `mcp__claude_ai_Higgsfield__*` | Prism/imagegen |
| Instant style/type example cues | generic original inline SVGs (no gen, no network) | new, small |
| Brand-kit PDF | designed HTML pages → client-side export (print/html2pdf); PPT via pptxgenjs later | Deck (pptx) |
| Device-lightness | all in-tab; image/PDF gen are **on-demand**, nothing idles ([[relay-device-lightness]]) | hard rule |

Same-origin note: Crest runs at `localhost:5188/crest.html`, an origin already granted Higgsfield (trust
mode) from prior work — so image gen works in a demo with no new setup.

**Honesty / edge cases:** CMYK is shown as a **labeled approximation** (true CMYK needs a color-managed
tool). Fonts default to **free/Google** so the kit is genuinely usable. The 1-color/small-size test is a
first-class kit page, not an afterthought. Trademark anchors are text-only (§3.5). Image gen for 4 marks
runs in parallel with per-tile spinners; a failed tile shows a retry, never a fake.

---

## 8. Build plan / phasing

Ship demo-able first, then flesh out — same wrapp, additive.

- **P1 (demo now):** brief → strategy → 3 rich directions (recommend + pick) → type×style pickers → 4 marks
  (SVG wireframe + Higgsfield) → steer. This is the "logo story" a user can watch and drive today.
- **P2 (fold in):** the ≤5 intake questions · refine → the lockup set (horizontal/stacked/avatar/wordmark/
  1-color/light+dark) · the designed brand-kit **PDF** (§5).
- **P3 (polish):** PPT export · application mini-mockups · a saved "brand" object (so a kit can be reopened
  and iterated) · optional hand-off to brandbrain for the deep version.

**Definition of done (P1+P2):** a stranger types a paragraph and leaves with a picked, steered logo and a
crafted brand-kit PDF, having made every meaningful choice themselves — no agency, no jargon, no dead ends.
