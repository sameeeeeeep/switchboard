# FEEDBACK CAPTURE — a screenshot + note on a guide step, without leaving the run

Companion to [GUIDED-TESTING.md](./GUIDED-TESTING.md). That doc closes the "Claude can't click
the notch, so it waits on the human" gap: Claude scripts steps, the human taps **fn→ / fn←**
(pass/fail), and the run writes a machine-readable `~/.relay/guide-result.json`. This doc adds the
**qualitative** half the founder asked for:

> On a **FAIL** (or a dedicated feedback key), let the human **(1) fn-drag a screenshot of a
> region** and **(2) type or dictate a note in the notch**. The `{screenshot, note}` attaches to
> that step's result in `~/.relay/guide-result.json`.

A `fail` verdict tells Claude *that* something broke; feedback tells it *what* and *where*. This is
the difference between a red mark and an actionable bug report — captured in the same five-second
reflex the pass/fail signal already is.

Grounded in `packages/menubar/CursorGuide.swift` (the guide engine) and
`packages/menubar/RelayMenuBar.swift` (the notch + capture + dictation primitives). Exact hooks are
in [AGENT-C-snippets.md](../scratchpad/AGENT-C-snippets.md) — this doc is the design.

---

## 0. What already exists (we're wiring three primitives, not inventing)

Every piece the feature needs already ships. Feedback capture is the **composition** of them.

| Existing primitive | Where | Reused for |
|---|---|---|
| **Guide FAIL path** — `onKey` case `115`/`123`+fn → `handleAdvance(fail:true)` → `record("fail")` → `advance()` | `CursorGuide.swift` L583–584, L356–366, L378–383 | The **trigger**: a fail is the natural moment to enter feedback capture. |
| **Per-step result writer** — `writeResult` builds `stepDicts` (`id`,`text`,`verdict`,`notedAt`) → `guide-result.json` | `CursorGuide.swift` L430–451 | Where `feedback:{screenshot,note}` **attaches**. |
| **fn-drag region capture** — 60 fps free-read poll → `RegionSelectView` rubber-band → `RegionPick.region` → `screencapture -R` | `RelayMenuBar.swift` `installCaptureGestureMonitors` L4782, `ensureRegionOverlay` L4926, `RegionSelectView.captureRect()` L2748, `captureShot` L4683 | The **screenshot**. Note: the shipping copy is God-coupled (`godRefs`, `shareScreenThisTurn`, `confirmCaptureInNotch`) — feedback needs a lean sibling (see §5, Risk 1). |
| **Key-capable notch panel** — `LauncherPanel` (a `canBecomeKey` `NSPanel`) hosts a SwiftUI `TextField`, presented from the notch, focused via `makeKeyAndOrderFront` | `RelayMenuBar.swift` `LauncherPanel` L2716, `showLauncher` L3900–3913 | The **anchored TYPE input**. There is **no text field in the notch today** (`GodStatusDrop` L2272 is display-only) — this is the primitive that makes typing-in-the-notch possible. |
| **Dictation → whisper** — `startDictation`/`stopDictationAndPaste` (raw on-device transcript), currently ends in `pasteText(text)` | `RelayMenuBar.swift` L4367 / L4399, paste at L4413 | The **DICTATE input**. `⌃⌥` stays live during a guide (the `isActive` guard was deliberately kept out of `onFlags`, see the comment L4318–4320), so the transcript just needs re-routing to the note instead of the cursor. |
| **Notch drop shape + tokens + `presentFromNotch`** — `NotchDropShape`, `Color.page/lime`, `Font.hanken`, `notchTopBleed`, `presentFromNotch` | `GodStatusDrop` L2272–2307, `presentFromNotch` L3606 | The feedback input **looks like a notch drop** — one visual language. |

The guide's signals are **fn+arrow keys** (`CursorGuide.onKey`), and dictation is **⌃⌥** — two
disjoint input channels. That is exactly why feedback capture can layer on cleanly: the screenshot
gesture (fn-drag, a mouse poll) and the note (⌃⌥ dictation / typing) never collide with the guide's
pass/fail keys.

---

## 1. The trigger — recommendation: **FAIL auto-offers, plus a dedicated key on any step**

Two entry points, because they answer two different needs:

| Entry | Gesture | Why |
|---|---|---|
| **On FAIL (primary)** | `fn←` records `fail`, then **instead of advancing** enters feedback-capture for that step. | A fail is precisely when "what broke?" matters. Piggy-backing on the existing gesture means **zero new muscle memory** for the common case. It is **fully escapable** — `esc` with nothing staged just advances (= today's behavior), so "fail with no feedback" costs nothing. |
| **Dedicated feedback key (any step)** | **`fn↓`** (PageDown `keyCode 121`, or `↓`+fn `125`) opens feedback for the **current** step without changing its verdict. | So a **pass** can also carry a note ("worked, but the animation stutters") and praise/observations aren't lost. `fn↓` is free — the guide only uses `fn← fn→ fn↑` + `esc` (`onKey` L579–588). |

**Why not a FAIL-only trigger:** the founder said "FAIL *or* a dedicated feedback key" — feedback
is valuable on any verdict, and a fail that the user wants to pass-with-caveat shouldn't be the only
way to leave a note. **Why not feedback-key-only:** it adds a step to the most important case (a
fail) where the note is most wanted. Offering on fail + a universal key covers both cheaply.

The keycap hint on the caption chip gains one entry in feedback-eligible states: `fn↓ note`.

---

## 2. The flow

```
                         guide step is showing (test mode)
                                     │
              ┌──────────────────────┼───────────────────────┐
        fn← (Fail)               fn↓ (Note)               fn→ (Pass)
              │                      │                        │
     record verdict=fail      keep current verdict        record pass
              │                      │                     advance ──▶ next step
              └───────────┬──────────┘
                          ▼
              ┌───────────────────────────────┐
              │   FEEDBACK-CAPTURE mode        │  CursorGuide.capturingFeedback = true
              │   (attached to step idx)       │  fires onFeedbackBegin(stepId) → RelayMenuBar
              └───────────────────────────────┘
                          │
        RelayMenuBar raises, in parallel:
          • armFeedbackRegionCapture()  ── fn-drag anywhere ─▶ screencapture -R ─▶ jpg
          • feedback notch input panel  ── TextField (key)   ─▶ typed note
          • ⌃⌥ dictation re-routed      ── whisper transcript ─▶ appended to note
                          │
        each artifact pushed back into CursorGuide:
          attachFeedbackScreenshot(path)   attachFeedbackNote(text)
                          │
              ┌───────────┴───────────┐
          ↵ / fn→ (Save)          esc (Discard)
              │                       │
        commitFeedback()         cancelFeedback()
        results[idx].feedback =  drop staged shot+note
          {screenshot,note}      (verdict is KEPT)
              │                       │
        onFeedbackEnd() ── RelayMenuBar tears down capture UI ──┘
                          │
                     advance ──▶ next step
```

The guide **pauses on the step** during capture — the cursor caption stays put, the notch shows the
input. Nothing is written to disk until `commitFeedback`; the on-disk `guide-result.json` is only
produced at run end (`finish` L409), with a crash-safe `test-progress.json` flushed per verdict as
today (L469).

---

## 3. All states

| State | What the user did | Result on the step | UI |
|---|---|---|---|
| **fail, no feedback** | `fn←` then `esc` (or `fn←` then immediately `fn→` with nothing staged) | `verdict:"fail"`, **no `feedback` key** | capture UI flashes up, dismisses; identical to today's bare fail |
| **fail, screenshot only** | `fn←`, fn-drag a region, `↵` | `verdict:"fail"`, `feedback:{screenshot:"<jpg>"}` (no `note`) | screenshot chip in the notch, empty note field |
| **fail, note only** | `fn←`, type or dictate, `↵` | `verdict:"fail"`, `feedback:{note:"<text>"}` (no `screenshot`) | note field filled, no chip |
| **fail, both** | `fn←`, fn-drag, type/dictate, `↵` | `verdict:"fail"`, `feedback:{screenshot,note}` | chip + note both shown |
| **pass with a note** | `fn↓`, type/dictate, `↵` | `verdict:"pass"` (unchanged), `feedback:{note}` | feedback opens without touching verdict |
| **screenshot capture denied** | fn-drag but Screen-Recording ungranted → no jpg on disk | `screenshot` omitted; `note` (if any) still saved | soft "couldn't grab — note still saved" |
| **abort mid-feedback** | `esc` while capturing | staged shot+note **discarded**; the **verdict is kept**; guide advances | capture UI tears down; guide continues |
| **abort the whole run** | while capturing, the run is superseded / app quits | `commitFeedback` never runs → step has verdict but no `feedback`; partial `guide-result.json` still written by `finish("aborted")` (L401) | — |
| **back after feedback** | `fn↑` returns to a prior step | that step's `verdict` **and** `feedback` are cleared (extend `goBack` L368) so re-answering overwrites cleanly | — |

**Reversibility.** Feedback lives only in `results[idx].feedback` in memory until `finish`. `esc`
discards the in-progress capture; `fn↑` (Back) clears a committed step's feedback along with its
verdict. Nothing is irreversible until the run ends and the file is written atomically (`writeAtomic`
L475, temp-write + rename).

---

## 4. The result-file addition

The **only** schema change is a new optional `feedback` object on each step in the `results` array
of `~/.relay/guide-result.json` (and its `test-result.json` twin). Everything else is unchanged.

**Today** — `writeResult` per-step dict (`CursorGuide.swift` L432–439):

```jsonc
{ "id": "open-store", "text": "Press ⌃⌃…", "verdict": "fail", "notedAt": "2026-08-03T18:22:31Z" }
```

**With feedback** — `feedback` is emitted **only when present** (a bare fail stays four-field, so
existing readers are unaffected):

```jsonc
{
  "id": "open-store",
  "text": "Press ⌃⌃, then click the store glyph in the notch.",
  "verdict": "fail",
  "notedAt": "2026-08-03T18:22:31Z",
  "feedback": {
    "screenshot": "/var/folders/…/guide-feedback-6f2c….jpg",   // absolute path to the fn-drag jpg; omitted if none
    "note": "store modal dropped but the top-left card had no icon"  // typed + dictated text; omitted if empty
  }
}
```

- Both sub-fields are **optional and independent** — `{screenshot}`, `{note}`, or both. The
  `feedback` object is absent entirely when neither exists.
- `screenshot` is an **absolute path** to a jpg in `NSTemporaryDirectory()` (same store as God's
  grabs, `captureShot` L4683). Claude reads the file directly; it survives until the temp dir is
  reaped, which is long enough for the calling agent to pick it up right after the run.
- `note` is the **raw** transcript/typed text (typed and dictated text concatenated), no model
  cleanup — matching the dictation gesture's raw-text contract (`pasteText` comment L4417).

The `test-result.txt` human twin (L453) gains a feedback line under a step that has one:

```
Store modal from the notch — 1 passed · 1 failed · 0 skipped
  ✓ open-store
  ✗ card-hover — store modal dropped but the top-left card had no icon  [+shot]
```

---

## 5. Architecture — who owns what, and the two seams

`CursorGuide.swift` must not reach into `RelayMenuBar.swift` and vice-versa (they are separate,
deliberately decoupled files — `CursorGuide` "touches nothing in RelayMenuBar.swift", header L19).
They are in the **same target**, so the clean seam is **CursorGuide exposes hooks + attach methods;
RelayMenuBar wires them once at launch** (it already calls `CursorGuide.shared.install()` at
`RelayMenuBar.swift` L3304).

```
   CursorGuide (owns: guide state, verdicts, result file, the feedback DATA)
        │  var onFeedbackBegin: ((stepId) -> Void)?        ← RelayMenuBar sets these once
        │  var onFeedbackEnd:   (() -> Void)?
        │  func attachFeedbackScreenshot(_ path:)          ← RelayMenuBar calls these
        │  func attachFeedbackNote(_ text:)
        │  func commitFeedback() / cancelFeedback()
        ▼
   RelayMenuBar (owns: fn-drag capture UI, the notch input panel, dictation)
        • onFeedbackBegin → armFeedbackRegionCapture() + showFeedbackNote()
        • fn-drag jpg     → CursorGuide.shared.attachFeedbackScreenshot(path)
        • ↵ in field      → CursorGuide.shared.attachFeedbackNote(text) + .commitFeedback()
        • esc in field    → CursorGuide.shared.cancelFeedback()
        • ⌃⌥ transcript   → (if capturingFeedback) attachFeedbackNote(text) instead of pasteText
```

**During feedback capture, the notch input panel is the key window and owns `↵`/`esc`;
`CursorGuide.onKey` no-ops while `capturingFeedback` (guard at its top).** This gives a single key
owner and avoids the double-fire seam below.

### The two integration risks (call these out — they're where this bites)

**Risk 1 — the fn-drag capture is God-coupled; feedback needs a lean sibling, not a reuse.**
`installCaptureGestureMonitors` (L4782) is not a neutral "grab a region" primitive: on commit it
calls `confirmCaptureInNotch` (L4833), which mutates `godRefs`, honors `shareScreenThisTurn`, plays
the Morse tick, and re-renders the God status pill. Calling it during a guide would stage a God
reference and try to paint the God pill mid-guide. The **underlying** pieces are clean and reusable
— `ensureRegionOverlay` (L4926), `RegionSelectView.captureRect()` (L2748), `captureShot(.region,to:)`
(L4683) — so feedback needs a **~40-line lean copy** of just the poll+commit that ends in
`completion(jpgPath)` instead of `confirmCaptureInNotch`. Snippet §B.1 provides it. (Honest: this is
the one place a primitive doesn't cleanly exist as a callable — it exists as entangled code.)

**Risk 2 — the notch has no text input today; the TYPE surface is genuinely new (but modeled).**
`GodStatusDrop` (L2272) is a display-only SwiftUI view — there is **no** editable field in the
notch. The **only** key-capable notch panel that exists is `LauncherPanel` (L2716), used for the ⌥⌥
launcher's search field. So "the notch becomes an input field" = a **new** small SwiftUI view
(`FeedbackNoteDrop`) hosted in a **new** `LauncherPanel`, presented via `presentFromNotch`. It's
modeled 1:1 on `showLauncher` (L3900–3913) so it inherits the focus + dismiss recipe, but it is new
code, not a reuse. Snippet §B.2. Also note: `startDictation` guards `!godRunning, !godListening`
(L4368) — both false during a guide, so ⌃⌥ dictation works, but the feedback panel taking key focus
must not itself set `godListening`; it doesn't (it's just a `LauncherPanel`).

A secondary seam: the ⌃⌥ dictation transcript re-route lives in `stopDictationAndPaste` (L4413).
The single-line guard there (`if CursorGuide.shared.capturingFeedback { … return }`) must sit
**before** `pasteText` so a dictated note never leaks to the focused app. Because the feedback panel
is `nonactivating`, the user's real app keeps focus for `pasteText` in the non-feedback case — so
getting this guard right is what stops a note being pasted into their editor.

---

## 6. Build order (each independently useful)

1. **`GuideResult.feedback` + the `writeResult` addition (§4).** Pure data — the file gains the
   field the moment anything sets it. Snippet §A.1–A.2.
2. **The feedback state machine in `CursorGuide` (§2): `capturingFeedback`, `beginFeedback`,
   `attach*`, `commit/cancelFeedback`, the `onKey` guard, and `fn↓` entry.** Snippet §A.3–A.5. At
   this point a bring-up path (RelayMenuBar calling `attachFeedbackNote("x")` then `commitFeedback()`)
   already produces the file field end-to-end.
3. **RelayMenuBar glue: `armFeedbackRegionCapture` (§B.1), `FeedbackNoteDrop` + `showFeedbackNote`
   (§B.2), the `onFeedbackBegin/End` wiring (§B.3), and the `stopDictationAndPaste` re-route
   (§B.4).** This lights up fn-drag + type + dictate for real.

After #3: **a fail (or `fn↓`) → fn-drag a region + type/say a note → it rides that step's result to
Claude.** Pieces 1–2 make the data real; piece 3 makes the gesture real.
