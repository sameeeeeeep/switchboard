# Wrapp UX audit — 2026-07-25

34 wrapps audited against the doctrine, each from a real headless screenshot plus a source read.
Harness at the time: **68/68 pass, 0 fail** — nothing is broken. Every finding below is a UX
finding, not a bug.

## The headline

> The catalog did not fail 34 different ways. It failed **four** ways, copy-pasted 20+ times.

There is no shared UI kit, so the same four defects were duplicated by hand across the catalog:

| # | Defect | Spread | Doctrine broken |
|---|--------|--------|-----------------|
| 1 | `optionCards()` / `steerRow()` byte-identical copies | ~20 files | — (root cause) |
| 2 | `.opt.sel { border-color: var(--accent) }` identical line | ~22 shells | 5 — accent marks a machine decision |
| 3 | `selectedId = recommended` set at boot | ~18 wrapps | 5 — auto-gen LOCKS instead of DRAFTS |
| 4 | escape hatch ("none of these") | **1 of 34** (`bank.js` only) | 4 — human can't override the slate |
| 5 | resizable detail pane | **0 of 34** | 2 — no adjustable shape |

Fixing these centrally turns every downstream fix from ~20 edits into 1. `examples/apps/src/kit/`
already exists (capture/livestore/recorder/speaker), so `kit/ui.js` is the natural home.

**Correction to the first-pass synthesis:** it claimed *zero* occurrences of "none of these".
There is exactly one — `examples/apps/src/bank.js` — which makes it the reference implementation
to generalise rather than a thing to invent.

## What the catalog gets RIGHT

Doctrine 6 (low input) and 7 (honest empty states) are broadly **won**. Most wrapps boot
pre-filled from the lent project with zero required input, and the empty states are genuinely
honest — `adgen` literally reads *"not rendered yet — one click, one Higgsfield credit"* and its
footer explains each render asks consent "because it spends your credits". No fabricated metrics
were found in any audited file. That is the acoco trap avoided, catalog-wide.

## Worst offenders

**cast** — the purest doctrine-5 violation. `cast/stages.js:327` `autoLock()` writes the model's
pick straight into `fnd.locks`, paints it in the lime brand accent with a `LOCKED ✓` badge, and
overwrites the alternatives. The stage copy says it out loud: *"Cast locks the recommended one as
options land."* Scores 2/5 on real artifacts.

**adforge** — reading an alternative **costs money and destroys work**. Card text truncates at 150
chars and the only click target is `pick(i)`, which wipes `state.images` and fires a paid
Higgsfield render. Comparing options — the entire point of options+recommended — is the most
expensive action in the app.

**aplus** — one line, `aplus.js:926`:
`const hot = chosenIdx >= 0 ? chosenIdx : directions.findIndex((d) => d.recommended)`
applies `.dir.hot` (lime border + lime fill), so the model's pick wears the human-choice state
before anyone touches anything.

**adgen** — six ~500px tiles make a ~2500px page, so a "wall" whose whole value is side-by-side
comparison takes three screens to read.

## A real harness bug (false green)

`examples/apps/harness/provider.js:324` routes on `/enhanced brand content/i`. `aplus`'s
`buildStackPrompt()` contains that exact phrase, so the stack prompt is shadowed by the directions
route and returns `{directions:[…]}`, which `normalizeStack()` correctly rejects. **aplus stage 2
never renders under test** — it is counted in the 68/68 without being exercised. Fix the mock
route, not the app.

## Ranked fixes

1. **Extract `kit/ui.js`** — shared optionCards / steerRow / escapeHatch + an explicit
   DRAFTED-vs-LOCKED state. Unblocks everything below. *(in progress)*
2. **Accent = a human chose** — drafted state neutral, locked state accented. ~18 wrapps.
3. **Escape hatch everywhere** — generalise `bank.js`'s "none of these". 33 wrapps.
4. **Split read from commit** — never let comparing options cost money or destroy work (`adforge`).
5. **Resizable detail pane** — the adjustable-shape doctrine; 0 wrapps have one today.
6. **Fix the harness `enhanced brand content` route collision** — removes a false green.
