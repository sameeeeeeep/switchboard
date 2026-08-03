# GUIDED TESTING — Claude scripts the test, the human is just the hands

Companion to [SELF-TEST.md](./SELF-TEST.md). That doc covers everything the agent can verify
**without** the human — headless snapshots, `~/.relay` file tails, dry-run God, the wrapp
harness. This doc closes the one gap that document ends on:

> **The blocker:** Claude can't click the live notch GUI (`LSUIElement` + transient
> non-activating panels resist accessibility — SELF-TEST §"The blocker"). So the last mile of
> every notch change is still *"please press ⌃⌃ and tell me what you saw."* That hand-off is
> unstructured, high-effort, and its result comes back as prose Claude has to re-parse.

**Guided Testing turns that into a loop with a machine-readable contract:**

1. Claude writes an **ordered test script** to `~/.relay/test-run.json`.
2. The app enters **testing mode**: it floats **step 1's instruction next to the cursor**
   (reusing the existing glow-follow overlay) and shows progress (`3 / 8`).
3. The human does the step, then signals **PASS / FAIL / SKIP** — by a **⌃⌥ combo** or by
   **voice** (reusing the whisper path). The float advances to the next step.
4. On completion the app writes `~/.relay/test-result.json` — per-step verdict + optional note
   + captured state — which **Claude reads directly**. No copy-paste. A human-readable summary
   is also surfaced (toast + `test-result.txt`).

The payoff: *"please test this"* becomes a structured, low-effort loop. The human never types a
report; they tap or talk. Claude gets back a graded, state-stamped result it can act on.

---

## 0. What already exists (this is 80% built — we're wiring, not inventing)

Grounded in `packages/menubar/RelayMenuBar.swift`. Every piece below already ships:

| Existing primitive | Where | What Guided Testing reuses it for |
|---|---|---|
| **Glow-follow overlay** — `GlowModel` (`state`, `cursor`, `target`), `GodGlowView`, the borderless screen-saver-level `glow` `NotchPanel` | `GlowState` L1865, `GodGlowView` L1875, `installGlow` L4281 | The floating cursor guide. It **already renders near the cursor** and **already polls the mouse at 30 fps** with no AX grant. |
| **`glowCursorTimer` / `updateGlowCursor`** — 30 fps `NSEvent.mouseLocation` poll → overlay top-left coords | L4299–4327 | Makes the step label ride the pointer. **This is the crux: it works without Accessibility or Input-Monitoring** (it's a free read), which is exactly why the glow can follow the cursor when clicks can't drive the panel. |
| **`captionFor(_:)`** — a per-state cursor caption string (currently returns text but the pill was removed as noise, L1935) | L1895 | Re-enable as an **opt-in** label — this is where the step instruction renders. |
| **`setGlow(_:)`** — the single choke-point that shows/hides the overlay + starts tracking | L4305 | Enter/exit a new `.guiding` visual state. |
| **`onFlags(_:)`** — the one passive `.flagsChanged` monitor; already multiplexes ⌃⌃ summon vs ⌃⌥ talk-hold via `chordFlags`/`modFlag` | L3629 | Add a **test-mode branch** for ⌃⌥ tap = PASS etc. No new monitor, no new grant. |
| **Dictation → whisper path** — `startDictation`/`stopDictationAndPaste`, `whisperCliPath`, `whisperModelPath` (raw on-device transcript) | L3667–3703 | The **voice** verdict: hold the talk chord, say "fail, the button didn't animate" → transcribe → parse verb + note. |
| **`~/.relay` file-driven state machine** + `godStateTimer` 0.25s poll pattern + `readJSON` | god-state poll L3985, `readJSON` reader | The `test-run.json` watcher and `test-result.json` writer are the **same pattern** as `god-state` / `god-consent.json`. |
| **`toast(_:)`** | L4649 | The human-readable end-of-run summary. |
| **`NotchPanel` + `showGodStatus`** | L3341+ | Optional: a compact "Testing 3/8" notch drop alongside the cursor float. |

The gesture monitor is **passive `NSEvent` modifier watching** (L3617–3624) — *not* a
`CGEventTap` — so pass/fail signaling inherits the same "just works, no Input-Monitoring grant"
property that makes ⌃⌃ reliable. The glow overlay is `ignoresMouseEvents = true`
(L4289) — the guide floats over whatever the human is clicking and **never intercepts the
click**, which is essential: the human must be able to actually operate the notch under the label.

---

## 1. The floating cursor guide (a reusable primitive)

A small label that rides the pointer showing the current instruction. **Reuse the glow overlay
verbatim** — extend `GodGlowView` to render a text chip anchored to `m.cursor`.

### 1.1 The label
Positioned like the existing sparkles (`.position(x: m.cursor.x + dx, y: m.cursor.y + dy)`,
L1922) but offset **below-right** of the pointer (e.g. `+18, +22`) so it doesn't sit under the
hotspot the human needs to click. Contents:

```
┌─────────────────────────────────┐
│ ⌁ 3/8  Open the store from the   │   ← instruction (GlowModel.caption)
│        notch, then click a card  │
│        ⌃⌥ pass · hold+say · esc  │   ← hint line (dim), only in testing mode
└─────────────────────────────────┘
```

- Lime accent to match the one-accent rule (NOTCH-DESIGN §2.2); frosted/dark chip like the
  notch drops. `.allowsHitTesting(false)` stays (the whole overlay already sets it, L1938).
- **Clamp to screen:** if `cursor.x + width` overflows `screen.maxX`, flip the label to the
  **left** of the pointer; same for vertical. (The overlay panel spans the full screen frame,
  L4292, so there's room — just mirror the offset.)
- Honors reduce-motion: no pulsing; a still chip.

### 1.2 Model additions
Extend `GlowModel` (L1867) with the guide's payload — additive, doesn't disturb God's use:

```swift
enum GlowState { case idle, armed, listening, thinking, finishing, speaking, pointing, guiding }  // + guiding
final class GlowModel: ObservableObject {
    @Published var state: GlowState = .idle
    @Published var cursor: CGPoint = .zero
    @Published var target: CGPoint? = nil
    @Published var caption: String? = nil     // NEW: text riding the cursor (nil = none)
    @Published var progress: String? = nil    // NEW: "3/8" chip; nil hides it
    @Published var hint: Bool = false         // NEW: show the "⌃⌥ pass · …" affordance line
}
```

`GodGlowView` renders the caption chip whenever `m.caption != nil` — so the primitive is
**not testing-specific**. `captionFor(state)` (L1895) becomes the *fallback* when `caption`
is nil, preserving today's behavior.

### 1.3 Why it's reusable beyond testing (call this out — it's the real leverage)
A cursor-anchored, no-grant, click-through instruction chip is a general **"show me how"**
primitive. Same code path serves:
- **Onboarding tours** — the Act II teach-by-doing steps (`Onboard`, L798) could float the next
  gesture by the cursor instead of only living in the panel.
- **Ambient hints** — "try ⌃⌃ here" nudges.
- **God pointing** — the existing `.pointing`/`target` marker (L1927) could carry a "here"
  caption for free.

Build it as `GlowModel.caption`, not `TestRunner.stepLabel`, so all four callers share it.

---

## 2. The test-script contract (how Claude initiates a run)

Claude writes an ordered script. The app's watcher picks it up and enters testing mode.

**`~/.relay/test-run.json`** (Claude writes; app consumes then deletes):

```jsonc
{
  "id": "store-notch-2026-08-03",        // run id, echoed into the result
  "title": "Store modal from the notch", // shown in the summary
  "steps": [
    {
      "id": "open-store",
      "instruction": "Press ⌃⌃, then click the store glyph in the notch.",
      "expect": "The store modal drops from the notch."       // what PASS means (shown dim, optional)
    },
    {
      "id": "card-hover",
      "instruction": "Hover a wrapp card.",
      "expect": "The card lifts and its accent lights.",
      "capture": ["god-state", "catalog.json"]    // optional: snapshot these ~/.relay files at this step (see §4)
    },
    { "id": "scroll", "instruction": "Scroll to the bottom of the grid.", "expect": "No blank gap; footer visible." }
  ]
}
```

- `instruction` is the **only** required field per step. `expect` is shown as a dim second line
  (helps the human judge) and is echoed into the result so Claude knows what each verdict was
  *about*.
- `capture` (optional, per step) lists `~/.relay` files to snapshot into that step's result —
  the machine-readable "state change" evidence. Defaults to `["god-state"]`.
- Validated read (house rule, cf. `readShortcutCfg` L775): a malformed script → **no-op + one
  toast** ("test-run.json malformed, ignored"), never a wedged mode.

**Lifecycle:** the app renames/deletes `test-run.json` on pickup (like `god-consent.json`),
so re-writing the file starts a fresh run and a stale file can't re-trigger.

The app **enters testing mode**: `setGlow(.guiding)`, load step 0, set
`glowModel.caption = steps[0].instruction`, `glowModel.progress = "1/N"`, `hint = true`.

---

## 3. Per-step PASS / FAIL / SKIP signaling

Two input paths, both **reusing existing monitors** — the human picks whichever is natural.

### 3.1 The ⌃⌥ combo grammar (fast, silent)
Route these through the **existing** `onFlags(_:)` (L3629) behind a `testRunner.active` guard,
**before** the dictation/summon branches so testing mode owns the chord cleanly:

| Signal | Gesture | Rationale |
|---|---|---|
| **PASS** | **⌃⌥ quick tap** (talk chord pressed & released < ~400 ms, no hold) | The natural "yes, next" beat; distinct from the dictation **hold**. |
| **FAIL** | **⌃⌥ hold** then release *without speaking* (held > ~600 ms, empty transcript) **OR** double-tap ⌃⌥ | A hold that produces no words = a deliberate reject. |
| **FAIL + note / any verdict + note** | **⌃⌥ hold and SPEAK** → whisper transcript parsed | See 3.2 — the hold is *already* the dictation gesture; we just repurpose its transcript. |
| **SKIP** | **⌃⇧ tap** (or voice "skip") | A separate modifier so it never reads as pass. |
| **ABORT** | **Esc** (via a scoped local key monitor while guiding) or voice "stop testing" | Ends the run, writes a partial result (§4). |

Implementation shape (in `onFlags`, additive branch):

```swift
if testRunner.active {
    let talk = chordFlags(cfg.talk)              // ⌃⌥ by default — reuse the SAME binding
    let m = flags.intersection([.control,.option,.command,.shift])
    // measure press→release duration to split TAP (pass) from HOLD (voice/fail),
    // mirroring the summonWasDown edge-detect already in this method.
    …
    return                                        // testing mode consumes the chord; don't fall to summon/dictation
}
```

Because it sits on the **same passive modifier monitor**, it needs **no new permission** and
can't collide with God (the `return` short-circuits summon/dictation while a run is active).

### 3.2 The voice path (reuse whisper — the elegant bit)
The talk-chord **hold is already the dictation gesture** (`startDictation` →
`stopDictationAndPaste`, L3667/3687), which records and runs whisper on-device. In testing mode,
**don't paste** the transcript — hand it to the `TestRunner` instead:

- Parse the leading verb: `pass` / `ok` / `good` → PASS · `fail` / `no` / `broken` → FAIL ·
  `skip` → SKIP · `stop` / `abort` → ABORT.
- The **remainder of the transcript becomes the step note** ("fail, the card didn't animate on
  hover" → FAIL + note `"the card didn't animate on hover"`).
- No verb recognized → treat as a note on the current step and **re-prompt** ("didn't catch
  pass/fail — tap ⌃⌥ or say pass/fail"), don't advance.

This means the human can *talk their way through the whole test*, which is the lowest-effort
mode and captures rich notes Claude can act on — all on the whisper path that already exists.

### 3.3 Advance + progress
On any accepted verdict: append to results, capture the step's `capture` files (§4), then
`glowModel.caption = steps[i+1].instruction`, `glowModel.progress = "\(i+2)/N"`. A short lime
flash on the chip (✓/✗) confirms the signal landed. On the last step → §4 completion.

---

## 4. The summary (machine-readable + human-readable)

On completion (or abort), write both:

**`~/.relay/test-result.json`** — what Claude reads:

```jsonc
{
  "id": "store-notch-2026-08-03",
  "title": "Store modal from the notch",
  "startedAt": "2026-08-03T18:22:04Z",
  "finishedAt": "2026-08-03T18:23:41Z",
  "outcome": "completed",              // completed | aborted
  "passed": 2, "failed": 1, "skipped": 0, "total": 3,
  "steps": [
    { "id": "open-store", "verdict": "pass", "instruction": "Press ⌃⌃…", "expect": "The store modal drops…",
      "note": "", "at": "2026-08-03T18:22:31Z", "state": { "god-state": "idle" } },
    { "id": "card-hover", "verdict": "fail", "expect": "The card lifts and its accent lights.",
      "note": "no lift, accent didn't change", "at": "…",
      "state": { "god-state": "idle", "catalog.json": "…snapshot or sha…" } },
    { "id": "scroll", "verdict": "pass", "note": "", "at": "…", "state": { "god-state": "idle" } }
  ]
}
```

- **`note`** carries the voice remainder — the qualitative signal Claude most needs.
- **`state`** is the per-step `capture` snapshot: the value of each requested `~/.relay` file at
  verdict time (small files inlined; large ones by sha + path). This is the "state changes"
  the founder asked for — Claude sees not just pass/fail but *what the app's state was*.
- Written atomically (temp + rename) so Claude never reads a half-written file.

**`~/.relay/test-result.txt`** — human-readable twin (also `toast`ed):

```
Store modal from the notch — 2 passed · 1 failed · 0 skipped
  ✓ open-store
  ✗ card-hover — no lift, accent didn't change
  ✓ scroll
```

**All states covered:**

| State | Behavior |
|---|---|
| **mid-run** | `test-run.json` consumed; `.guiding` overlay up; each verdict appended in memory; a `test-progress.json` (`{i, total, verdicts:[…]}`) is flushed each step so a crash/tail still shows progress. |
| **skip** | verdict `"skip"`; advances; counted separately. |
| **abort** (Esc / "stop") | stop immediately; write result with `outcome:"aborted"`, remaining steps `verdict:"unrun"`; overlay → `setGlow(.idle)`. |
| **done** | all steps verdicted → write result + txt + toast; `setGlow(.idle)`; clear `caption/progress`. |
| **re-entry** | a new `test-run.json` while a run is active → finish-abort the current, start the new (last-writer-wins, like the daemon's sync). |
| **God collision** | while `testRunner.active`, ⌃⌃ summon and ⌃⌥ dictation are suppressed (the `return` in §3.1). A truly needed God turn = abort the test first. |

---

## 5. Testing wrapp vs native mode — recommendation

**Recommendation: a NATIVE mode driven by the `~/.relay` files. Not a wrapp.** Reasons:

1. **The whole job is native-shell verification.** The gap is that Claude can't see/verify the
   *notch and cursor* — surfaces that live in `RelayMenuBar.swift`, not in a web wrapp. A wrapp
   runs in a webview and can't float a label by the OS cursor, read `NSEvent.mouseLocation`, or
   watch the global ⌃⌥ monitor. The capability **must** be native.
2. **It reuses three things already native and already grant-free:** the glow overlay + its
   30 fps cursor poll, the passive modifier monitor, and the whisper dictation path. A wrapp
   would have to reinvent all three and couldn't get the cursor-follow at all.
3. **The contract is already the house pattern.** `test-run.json` in / `test-result.json` out is
   the exact shape of `god-action.json` / `god-consent.json` / `god-state`. Claude drives it
   with a `Write` + a poll — no new transport, no consent broker, no webview.
4. **It stays out of the shipping surface.** Gate the watcher behind a flag file
   (`~/.relay/testing-enabled`) or `#if DEBUG`, same discipline SELF-TEST §"Top 3" prescribes
   for the debug-surface hook — so guided testing can never be summoned to spoof a real user
   flow in a release build.

(If a **human-facing** "test my wrapp" product is ever wanted, that's a separate wrapp on top —
but the agent-facing loop that closes *this* gap is native.)

This also composes with SELF-TEST's proposed **debug-surface watcher**: Claude can *summon* a
surface via `debug-surface.json`, then *script a human check* of it via `test-run.json` — the
two watchers are siblings and could even share one 0.3s timer.

---

## 6. Exact native hooks for the main thread (spec, not implementation)

All in `RelayMenuBar.swift`. Additive; nothing here changes God's existing paths.

### 6.1 `GlowModel` + `GodGlowView` — the label (see §1.2)
- Add `caption`, `progress`, `hint` to `GlowModel` (L1867). Add `.guiding` to `GlowState` (L1865).
- In `GodGlowView.body` (L1906), after the sparkles block, add a caption chip that renders when
  `m.caption != nil`, anchored at `m.cursor + offset` with the screen-edge clamp from §1.1, plus
  a small `m.progress` badge and the dim `hint` affordance line. Keep `.allowsHitTesting(false)`.
- `setGlow(.guiding)` (extend L4305): shows the overlay + `startGlowTracking()` exactly as the
  spoken phases do — the cursor poll (`glowCursorTimer`, L4321) already does the follow, so the
  label rides the pointer with **zero** new tracking code.

### 6.2 `TestRunner` — the controller (new, ~120 lines)
A `@MainActor final class TestRunner: ObservableObject` owned by `RelayController`:

```swift
struct TestStep { let id: String; let instruction: String; let expect: String?
                  let capture: [String] }
struct StepResult { let id: String; var verdict: String; let expect: String?
                    var note: String; var at: Date; var state: [String:String] }

@MainActor final class TestRunner: ObservableObject {
    @Published private(set) var active = false
    private var steps: [TestStep] = []; private var i = 0; private var results: [StepResult] = []
    private var startedAt = Date()
    func start(_ json: [String:Any]) { … load, active = true, i = 0, startedAt = now }
    func verdict(_ v: String, note: String = "") { … capture(); append; advance-or-finish }
    func abort() { … outcome:"aborted"; write; active = false }
    private func advance() { … push next caption/progress into glowModel, or finish() }
    private func finish(_ outcome: String) { writeResult(outcome); active = false; setGlow(.idle) }
    private func capture(_ files: [String]) -> [String:String] { read each ~/.relay/<f> }
}
```

`start` sets `glowModel.caption/progress/hint` and calls `setGlow(.guiding)`; `finish`/`abort`
clear them and `setGlow(.idle)`, plus write `test-result.json` + `test-result.txt` + `toast`.

### 6.3 The watcher — pick up `test-run.json`
Mirror the `godStateTimer` pattern (L3985) but **always-on while enabled**. In
`applicationDidFinishLaunching` (near `installGlow`/`installHotKey`), behind
`~/.relay/testing-enabled` (or `#if DEBUG`), start a 0.3 s `Timer` that reads
`~/.relay/test-run.json`; on presence → validate, **delete the file**, `testRunner.start(json)`.
(Reuse `readJSON`; same guard discipline as SELF-TEST §"Top 3" #2 — no-op in release.)

### 6.4 Pass/fail binding — extend `onFlags`
In `onFlags(_:)` (L3629), add the `if testRunner.active { … }` branch from §3.1 **before** the
dictation/summon logic. Reuse `chordFlags(cfg.talk)`/`modFlag`; add tap-vs-hold timing (mirror
the `summonWasDown` edge-detect already there). Scope an `Esc` local key monitor while guiding
for ABORT. **Route the whisper transcript** (§3.2): in `stopDictationAndPaste` (L3687), if
`testRunner.active`, send the transcript to `testRunner.verdict(parsedVerb, note: remainder)`
instead of `pasteText`.

### 6.5 The result writer
In `TestRunner.finish`/`abort`: build the JSON (§4), write atomically to
`~/.relay/test-result.json` (temp + `FileManager.replaceItem`), write the `.txt` twin, and
`toast(summaryLine)`. Flush `test-progress.json` each `verdict()` for crash-safety.

**Nothing above touches `GodGlowView`'s spoken-phase behavior, the God run loop, or the
consent broker.** The overlay gains an optional label; the monitor gains a guarded branch; two
files (`test-run.json` in, `test-result.json` out) join the existing `~/.relay` contract.

---

## The 3 highest-leverage pieces to build first

Ordered so each is independently useful and the loop closes after #3:

1. **`GlowModel.caption` + the `GodGlowView` label chip (§1, §6.1).** *The keystone.* It's the
   one genuinely new UI, it's small (a chip anchored to the cursor the overlay already tracks),
   and it's the **reusable primitive** that also pays off in onboarding tours, "show me how,"
   and God pointing. Ship this alone and you already have a scriptable floating guide.

2. **`TestRunner` + the `test-run.json` watcher + `test-result.json` writer (§6.2–6.3, §6.5).**
   *The machine-readable contract.* Even before any gesture binding, Claude can `Write` a
   script, the app floats the steps, and — driven initially by a temporary `test-signal.json`
   file (Claude/human writes `{"verdict":"pass"}`) for bring-up — it produces the graded result
   Claude reads. This is what actually eliminates the copy-paste hand-off.

3. **The ⌃⌥ pass/fail + voice binding in `onFlags`/`stopDictationAndPaste` (§3, §6.4).** *The
   human-effort collapse.* Reusing the passive modifier monitor (no new grant) and the whisper
   path, the human now taps or talks instead of typing a report. This is the difference between
   "test this" being a chore and being a five-second reflex.

Together: **Claude scripts the test → the human is just the hands → the result comes back
machine-readable.** Pieces 1–2 make it *work*; piece 3 makes it *effortless*.
