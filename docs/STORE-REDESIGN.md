# Store redesign — brief for a fresh thread

_Status: **direction agreed, not built.** Wireframes exist and are signed off; `examples/apps/index.html` has NOT been rebuilt against them. Written 2026-07-26 after three rejected design passes, so read "What already failed" before proposing anything._

The job: replace the wrapp store's flat 27-card grid with a store that shows **category-wise** and **helps a visitor find what's relevant to them**. Founder's words: _"showing 27 wrapps doesn't make sense."_

---

## The agreed direction

**Option 3 ("Curate") rebuilt around a horizontal pack of USES.** Wireframe, both states, is the source of truth:

```
docs/store-wireframes/store-v3.html        ← THE AGREED DESIGN (State A cold, State B returning)
docs/store-wireframes/store-v2.html        ← the five-register system, still valid
docs/store-wireframes/store-options.html   ← the three-option comparison that got us here
docs/store-wireframes/wireframes.html      ← full-page layout comparison of the three options
docs/store-wireframes/type-directions.html ← the type exploration (all three rejected; see below)
```

Open them with `python3 -m http.server 5199 --directory docs/store-wireframes`, then
`open http://localhost:5199/store-v3.html`. Every file has a **light/dark toggle** top-right.

They are self-contained HTML with no build step and no dependencies beyond two Google Fonts.
Keep them until the real page ships, then delete the directory — they are a design record, not code.

### The one structural idea

**The unit is a USE, not an app.** The centrepiece is one horizontal band where a stranger reads jobs across — _"Draft this week's ads"_, _"Find the spend that's being wasted"_, _"Mark up my landing page like a doc"_ — with the app name as small print underneath.

Each use card carries three things, and the third is the important one:

| | |
|---|---|
| The job | in the words you'd say out loud |
| The app | small, secondary — glyph + name |
| **The precondition** | `about 3 min` · `paste an export` · `needs a URL` · `upload one photo` |

The precondition answers "what does it cost me to start?", which for a tool that borrows your context is the actual blocker. It's also a *fact*, not a quality claim — which matters because we have no ratings or installs and never will.

The returning state re-cuts the **same** pack as "Next for {brand}", ordered by what's banked and filtered to things not opened yet. One component, both states.

---

## Non-negotiables carried from the reference research

**21 destinations, not 27.** Six catalogue entries (`mkt`, `capp`, `saas`, `retail`, `hardware`, `feature`) are the same ideabrain URL with `?template=`. Present them as **one card with six doors**. As eight equal cards they inflate the wall and teach the visitor the catalogue is padded. At 21 the whole vocabulary fits above the fold.

**Categories are jobs, not shelves.** Replace the eight nouns in `examples/apps/src/store/taxonomy.js` ("Brand & content", "Creative", "Viral", "Play & make", "After hours") with six job groups:

1. Work out if it's worth building — 3
2. Name it and design it — 4
3. Get it in front of people — 5
4. Sell the thing — 3
5. Run the week — 3
6. After hours — 3

**Rule: any group returning fewer than three doesn't ship.** Shopify names categories after the merchant's job; ours name our shelf.

**Rows, not posters. No iframes.** Setapp ships 366 apps and Raycast 1,500+ with zero screenshots — 44px glyph, name 18/600, one verb-first line, one meta atom. `docs/DESIGN.md` calls the scaled iframe "the store's signature element"; it is the most expensive thing on the page and communicates less than six words. **This contradicts DESIGN.md and DESIGN.md should be updated.**

**One type scale, and it is the fix for "hierarchy is missing."** The current page declares **18 distinct pixel sizes, 12 of them between 11 and 17px**, with 39 of 46 weight declarations at 600/700. Replace with Setapp's six steps and the 2× cliff:

```
12 / 14 / 16 / 18   inside an item — nothing between these and the next step
36                  section titles
46                  page title
weights: 400 body · 500 meta · 600 names + section titles · 700 page title only
tracking: +0.2px under 16px · 0 at 16–18 · no more than -0.01em at 36/46
```

The typeface was never the problem. Space Grotesk → Switzer → Archivo all failed because the *scale* is the disease.

**Five section registers.** Each surface encodes what you do there — this is what stops a heavy page reading as one undifferentiated wall, and it was the founder's own diagnosis ("different sections need their own visual break"):

| Register | Surface | Means |
|---|---|---|
| ACT | solid ink slab, soft gradient, inverted input | you type or press — **once per screen** |
| MAP | tinted panel, ruled cells, edge-to-edge | you choose a direction |
| STORY | full-bleed colour, editorial | you read a hand-made pick |
| SCAN | plain, hairlines only | you skim — deliberately the quietest |
| YOURS | warm tint + amber left edge | only ever about the user's own stuff |

The YOURS register is load-bearing: personalisation is visually inseparable from the privacy line inside it, so the claim is demonstrated by the surface rather than asserted in a trust section.

---

## Relevance: what we actually have

**The engine already exists.** `buildRecs()` and `buildActions()` in `examples/apps/src/home.js` already map `context.list()` kind-counts to wrapps with a stated reason ("because you banked Aamras") and produce actions carrying real names. **The failure is placement, not logic** — it currently sits in a section called "Recommended" far down the page. It belongs at the top of the returning state.

Three rules on top, from VS Code's `@recommended`:
- Always state the why, inline, in the user's own nouns.
- Put the privacy line at the point of personalisation: _"Worked out on this page from names only — nothing was sent anywhere."_
- Let them dismiss one.

**Never fabricate relevance.** No "Trending", no "Top rated", no install counts — no accounts, no telemetry, and token badges are dev-reported by our own honesty law (`docs/TOKENS.md`).

**Three states, not two.** Cold anonymous · connected-with-library · **connected-but-EMPTY-library**. The third is the conversion event and is already built — `examples/apps/src/store/point.js`. On an empty library, the pointer flow takes the position recommendations occupy on a full one. Do not show recommendations to an empty shelf.

**A blocker worth knowing before you start:** a catalogue entry is only `{ id, name, href, tokens, updates, pro }`. Category comes from a separate hardcoded map and **tags live in the HTML as `data-tags`, not in the catalogue**. There is no field for job, required input, or output kind. The use-pack needs that data model first — it is the real first task, not the layout.

---

## Open decisions — do not guess

1. **Light or dark.** The research says light (Mobbin's warning: silent near-monochrome chrome works because thirty colourful screenshots fill the viewport; a stripped neutral page with low-contrast cards "reads as empty and unfinished"). `docs/DESIGN.md` locks dark. The wireframes have a working toggle — decide by looking.
2. **The art blocks are placeholders.** The use cards and kits want **real output** — the ad it wrote, the marked-up page, the deck. Tinted gradients are standing in. This is the biggest remaining lift and it is asset work, not CSS.
3. **The `/all` surface.** `8 of 21 shown →` implies a full pack view that hasn't been designed. It should probably be uses rather than apps.
4. **The more radical version.** Packs could replace the page entirely — grouped horizontal packs per situation, no vertical shelf at all. Suits 21 items better than 21 rows. Founder was offered this and chose to bank the current version first.

---

## What already failed (read this before proposing)

Three passes were rejected. The reasons are specific and worth not repeating:

1. **The switchboard metaphor rendered literally.** A rack patch-bay SVG, "Number, please", "Operator, patch me through", sections named "The toll" / "Placing a call". Verdict: _"we don't have to literally show a diagram like this."_ **The telephone metaphor is for understanding the positioning, never for the page to wear.** See `relay-switchboard-thesis` in memory.
2. **Re-theming instead of composing.** Invented a parallel component vocabulary (`.pbay`, `.walls`, `.tariff`, `.toll-free`, `.teamwrap`) alongside the existing one. Verdict: _"we have a base theme we should build on top always."_ New CSS should be modifiers on base classes.
3. **Clever copy.** "Cheaper to be wrong here than in code", kit names like "Running ads alone" that presume what the reader does. Verdict: _"not a fan of the copy."_ Write plainly; name the situation, not the person.

---

## Also true

- `examples/apps/src/kit/ui.js` is new on main and imported by 21 wrapps, after an audit found **18 byte-identical copies** of `optionCards`. Whatever the store renders, **import those helpers — do not become the 19th copy.**
- Landed already on `main` via PR #7 and still valid: saturated per-app icon tiles (`glyphs.js`), counts rendering from `APPS`, empty categories hidden, stale `chat` id removed from `RECENTLY_ADDED`, `.projs` auto-fit.
- The hero/pitch markup currently in `examples/apps/index.html` is **the rejected direction**. It was committed for diffing, not because it is right. Expect to delete most of it.
- 88 HTML files load fonts from Google Fonts + Fontshare CDNs — awkward on a page whose claim is privacy. Separate task, already filed.

---

## Reference board

| | For | Go look at |
|---|---|---|
| [Mobbin](https://mobbin.com/explore/mobile/flows) | IA + visual | `/explore/mobile/flows` — heading + chips + counts, no hero at all |
| [Setapp](https://setapp.com/marketplace) | IA + visual | Type a noun in search — it returns **task phrases**, not products |
| [Raycast Store](https://www.raycast.com/store) | IA + visual | One extension row; the verb-first sentence grammar |
| VS Code `@recommended` | IA | Workspace vs inferred split — always says why, lets you dismiss |
| Apple App Store, Today tab | IA + visual | At low N, curation **is** the architecture |
| [GPT Store](https://chatgpt.com/gpts) | ⚠️ cautionary | Category nouns + popularity ≠ routing |
| [Vercel Templates](https://vercel.com/templates) | ⚠️ negative | Facets that return one item read as a bug |
| [Shopify Apps](https://apps.shopify.com/) | IA | Categories named after the merchant's job |
