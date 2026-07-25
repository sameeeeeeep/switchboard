# Changes — overnight wrapp UX work

Branch `overnight/wrapp-ux-audit`. **Nothing committed, nothing pushed.** Review the diff before
keeping any of it. `examples/brandbrain-port/` was never touched.

Harness after every change below: **68/68 pass, 0 fail** (verified by a full headless runner pass).

---

## New — the shared UI kit

**`examples/apps/src/kit/ui.js`** (new, ~21KB, dependency-free ESM, `node --check` clean)

The audit's central finding was that the catalog didn't fail 34 ways — it failed **four** ways
copy-pasted 20+ times, because `optionCards()` / `steerRow()` were byte-identical copies in ~20
files rather than shared code. This is the fix that makes every other fix cheap.

Exports: `optionCards`, `escapeHatch`, `steerRow`, `researching`, `markDrafted`, `markChosen`,
`clearChoice`, `isChosen`, `isDrafted`, `chosenOption`, `STEER_CHIPS`.

Two design decisions worth knowing:

- **Adoption is near-mechanical.** It emits the exact class names the ~22 existing shells already
  style (`.opts .opt .opt.sel .rec .chip …`), and the legacy positional call signatures still work.
  So a wrapp can import it and change zero pixels, then adopt the object form incrementally.
- **The drafted/chosen split is structural, not cosmetic.** There is no code path from a drafted
  card to `.sel`. A card reaches the accent state only via `markChosen()`, which is wired to a human
  click and records `chosenBy:"human"`. `markDrafted()` never touches `chosenId`, so a redraft can't
  steal a decision.

---

## Fixed — the harness false green

**`examples/apps/harness/provider.js`**

The mock routed on `/enhanced brand content/i`, but that phrase appears in **both** aplus's
`buildDirectionsPrompt` *and* `buildStackPrompt`. The directions route shadowed the stack route, so
stage 2 got `{directions:[…]}` back, `normalizeStack()` correctly rejected it, and **aplus stage 2
was never actually exercised** — while still counting toward 68/68.

Each route now matches only text unique to its own prompt, ordered most-specific first. The mock's
comparison data was also widened to 5 rows using `true` / `false` / short-string cells, so the
check/dash/value rendering paths are genuinely exercised instead of only the string path.

This was a **test** fix, not an app fix. It removes a false green rather than adding a real one.

---

## Fixed — 4 pilot wrapps (doctrine 5: the accent must mean a human chose)

### `examples/apps/src/aplus.js`
`renderDirections()` computed
`const hot = chosenIdx >= 0 ? chosenIdx : directions.findIndex(d => d.recommended)`
and applied `.dir.hot` — lime border + lime fill. The model's pick wore the human-choice state
before anyone touched anything.

Now `hot` follows `chosenIdx` only; the model's suggestion gets a separate `drafted` class and a
neutral `recommended` tag. **Screenshot-verified:** all three direction cards now render neutral on
arrival, with only a small neutral RECOMMENDED tag.

### `examples/apps/src/cast/stages.js`, `examples/apps/src/cast/ui.js`
The worst offender in the catalog, and the one flagged by name. `autoLock()` wrote the model's pick
straight into `fnd.locks` and painted it lime with a `LOCKED ✓` badge — the stage copy even said
*"Cast locks the recommended one as options land."*

Now a lock made on autopilot is a **draft**: `drafted = !!fnd.auto[id] && !!fnd.locks[id]`,
`isSelected` excludes drafted cards so the accent never lands on a machine pick, and a new
`draftBar()` provides the single human control that converts a draft into a decision. The
alternatives stay on the board, openable and re-choosable, either way.

*Note:* cast isn't served at `/h/cast` (it uses its own `?harness` route per `serve.mjs`), so this
one is verified by code review plus its pass in the full runner, not by a direct screenshot.

### `examples/apps/src/adforge.js`
Reading an alternative **cost money and destroyed work**: card text truncated at 150 chars, and the
only click target was `pick(i)`, which wiped `state.images` and fired a paid Higgsfield render. So
comparing options — the entire point of options+recommended — was the most expensive action in the
app. Read is now split from commit.

### `examples/apps/src/adgen.js`
Six ~500px tiles made a ~2500px page, so a "wall" whose whole value is side-by-side comparison took
three screens to read. Unrendered tiles now collapse, with a `0 of 6 rendered · 1 credit each`
summary. **Screenshot-verified:** all six directions now fit roughly one screen. The honest
empty-state copy (*"not rendered yet — one click, one Higgsfield credit"*) is untouched.

---

## Honest notes

- **The pilot agents stalled and were rescued.** All four made their edits, then hung during
  verification because the harness server had died and headless Chrome waited forever. The edits
  were left unverified until I restarted the server, rebuilt, ran the full harness (68/68) and
  screenshotted them myself. The rollout workflow was hardened with a liveness check and per-call
  timeouts before being launched.
- **`examples/apps/src/home.js` and `src/store/glyphs.js` are modified but NOT by this work** — a
  concurrent Claude session is editing the store UI. They were excluded from every agent brief.
- The catalog was already winning doctrines 6 (low required input) and 7 (honest empty states). No
  fabricated metrics were found anywhere. Those were left alone.

---

## Rolled out — the remaining 30 wrapps

| | |
|---|---|
| wrapps processed | **30** |
| accent fix applied (doctrine 5) | **27** |
| escape hatch added (doctrine 4) | **24** |
| reverted | **0** |
| broken | **0** |
| unverified | **0** |

`kit/ui.js` is now imported by **21** wrapps (from 0 this morning). Every wrapp was screenshotted
and read by the agent that changed it. Three wrapps correctly **skipped** the accent fix because
they have no model-recommended slate to fix.

Two judgement calls worth reviewing, both reported rather than hidden:

- **imagegen deliberately did NOT adopt the kit.** The kit emits 14px-radius cards on lime/slate
  tokens, which would have clashed with Prism's square-cornered phosphor-terminal look. The agent
  copied the kit's *grammar* (reveal → own text → feeds back into generation) in imagegen's own
  design language instead. That is the right call — the doctrine is about behaviour, not chrome.
- **studio has a second, untouched violation.** `applyBrand()` auto-selects `brand.products[0]` and
  the chip wears full lime before any click. Same class of bug, different mechanism — it is a
  context-derived required input, not a model `recommended` slate, and it has persistence,
  photo-vs-brand precedence and orphan-restore logic hanging off it. Left alone under the surgical
  mandate. **Worth a follow-up.**

---

## Harness — the real numbers

**After all 34 wrapps were modified: `done — 67 runs`, every row pass.** Verified by screenshotting
`runner.html` and reading the rendered results table, including Redline and AdPulse.

Two corrections to earlier claims in this file's history:

1. **`examples/apps/harness/results.json` is stale** — dated 2026-07-19, six days old. It records
   64 pass / 2 fail / 2 warn (redline ×2 fail, adpulse ×2 warn). The runner only writes
   `window.__RESULTS__`; nothing persists it automatically, so that file has not tracked reality.
   Redline and AdPulse both pass today. **Do not cite results.json as current.**
2. **I nearly reported a false failure.** Grepping the runner DOM for `adpulse` returned nothing and
   I concluded the run had never completed — but the DOM renders the display name `AdPulse`, and my
   search was case-sensitive. The run had been fine all along. The reliable verification method is
   **screenshot `runner.html` with `--virtual-time-budget=300000` and read the image**, not grep.

AdPulse renders blank at `/h/adpulse` standalone even at a 60s budget, yet passes inside the runner
— its `count()` checks `#stats .stat`, and the runner drives it with different timing. Not a
regression from this work, but a real inconsistency worth understanding.

---

## Deliverables

- `examples/autopilot/AUDIT.md` — the 34-wrapp audit and the four-defects finding
- `examples/autopilot/CHANGES.md` — this file
- `examples/autopilot/YC-ANGLES.md` — three evidence-graded positioning angles + honesty ledger
- `examples/autopilot/index.html` — the autonomous-company cockpit (separate from brandbrain)
- `examples/apps/src/kit/ui.js` — the shared kit, now used by 21 wrapps
