# Guided Cursor — Card Full Spec

The complete spec for the guided-cursor card: principles, anatomy, the Switchboard **dot-matrix** language, every step variant, **every state**, **edge cases**, UI sharpness (exact tokens), and motion. Green = built; ⏳ = phase-2.

Runtime: `packages/menubar/CursorGuide.swift` (`GuideCaptionView`). Snapshot harness: `SnapshotGuide.preview.swift`.

---

## 1. Principles

1. **The card is docked, the ring points.** The card sits bottom-center and never chases the pointer (cursor-following was irritating and made controls unhittable). The **ring** is the only thing that follows/points — and only on steps that declare a target.
2. **Auto-first.** Most steps self-advance via local sensing (`doneWhen`: pasted / on-screen text / element appears / field value / app frontmost). Keys are the manual fallback.
3. **Zones are opt-in.** A step turns on only the zones it needs; the card grows to fit. A plain step is 3 zones; a rich step is more.
4. **One motion language = the dot-matrix.** Every "the machine is doing/sensing something" moment uses the Switchboard `DotMatrix`, never a generic spinner. It is the brand's heartbeat and it ties the guide to the notch/God.
5. **Discipline in the frame, color in the signal.** Chrome is graphite (`panel`/`edge`/`ink`); **lime** = action/active/sensing, **indigo** = local/project (options), **danger** = failure only.

---

## 2. UI sharpness — exact tokens (no ad-hoc values)

- **Spacing** — the 4pt grid `SB`: s1 4 · s2 8 · s3 12 · s4 16 · s5 20 · s6 24. Card padding = s3. Inter-zone gap = 9.
- **Radius** — `SBr`: xs 7 · sm 12 · md 16 · pill 999. Card = sm. Keycaps = xs. Pills/AUTO = pill.
- **Card width** 320; grows vertically only (never truncates). Max height = screen − 120; beyond that the instruction scrolls inside, header + action bar pinned.
- **Type** — instruction `Bricolage 15/600`; hint `Hanken 11.5`; title/kickers/keycaps `Spline Mono 8.5–10`; auto-status `Hanken 10.5`.
- **Color** — `#0A0C10` page · `#12151C` panel · `#232A34` edge · `#EAF0F7` ink · lime `#C8F250` · indigo `#5B4FE8` · danger `#FF2D6E`. Card border = lime @ 30–45%. Shadow = `black 45% · r12 · y6`.
- **Hairlines** 1px `edge`. **Segment bar** 4px pills, filled ≤ current step.
- **Docking** bottom-center, 54pt above the bottom edge. **Multi-monitor**: docks on the screen that holds the *target* (or the cursor if no target); ring coords are mapped in that screen's space.

---

## 3. The dot-matrix language (Switchboard styling)

`DotMatrix(pattern:accent:cols:rows:)` — patterns `listening · thinking · speaking · working`; reduce-motion → a still dot field. Where it appears in the guide:

| Moment | Pattern | Accent |
|---|---|---|
| **Sensing** (`doneWhen` armed — "watching…") | `working` | lime |
| **Thinking** (options being generated / God computing a variant) | `thinking` | indigo |
| **Applying** a chosen variant live | `working` | indigo |
| **Loading media** (image/GIF fetch) | `working` | lime |
| **Voiceover speaking** the step | `speaking` | lime |
| **Feedback: listening** to a spoken note (⌥↓ + voice) | `listening` | lime |

Rendered small (cols 5 · rows 3 · dot 2 · gap 2) inline in the header (replacing the single pulse dot) and in the auto-status line. AUTO pill sits beside it. **Never** a generic spinner anywhere in the guide.

---

## 4. Anatomy (7 zones)

1. **Header rail** — segment progress · title · AUTO pill + **dot-matrix**(working) when sensing · voice icon · `⌥.` collapse hint.
2. **Instruction** — Bricolage, never truncated.
3. **Hint** — dim where/why (optional).
4. **Media** ⏳ — image or looping GIF (optional).
5. **Options** ⏳ — A/B/C live variants + approve (optional; indigo).
6. **Auto-status** — the sensing line with the dot-matrix; hidden on manual steps.
7. **Action bar** — two rows of `⌥` keycaps: row1 `⌥→ Next · ⌥↑ Back`; row2 `⌥↓ Feedback · ⌥M Mute · esc Close`. (Test mode: `⌥→ Pass · ⌥← Fail`.)

---

## 5. Step variants

| Variant | Zones | Ring | Advance |
|---|---|---|---|
| **Plain** (read/think) | 1·2·3·7 | no | `⌥→` |
| **Pointing** | 1·2·3·6·7 | yes, on target | `doneWhen` sense → auto; `⌥→` fallback |
| **Media** ⏳ | 1·2·(3)·4·7 | optional | `⌥→` (or sense) |
| **Options** ⏳ | 1·2·5·(6)·7 | optional | `⌥1/2/3` preview live → `⌥→` **Approve** |
| **Summary** | ✓ line + close | no | `esc`; `⌥↑` review steps |

---

## 6. Every state (the completeness pass)

**Lifecycle**
- **First-run / permissions missing** — the guide needs Accessibility (float + keys) and, for OCR sensing, Screen Recording. If **Accessibility/Input-Monitoring** is off: the card still renders, but a top strip shows *"Keys need Accessibility — open Settings"* and it falls to **manual-tap-only via the visible affordance**; steps with a sensor show *"auto-advance needs Screen Recording"* and become manual. Never silently dead.
- **Arming** — guide received, resolving step 1 (and, in teach, capturing the one screenshot for point-mapping): header dot-matrix `working`, instruction area shows a 1-line skeleton for ≤400ms.
- **Waiting (manual)** — no sensor: no AUTO tag, no auto-status line; user presses `⌥→`.
- **Sensing** — `doneWhen` armed: AUTO pill + dot-matrix(working) + "watching…".
- **Advancing** — a ✓/→ flash badge (0.35s) then the next step.
- **Summary** — completed: ✓ + one-line recap + step count/time.
- **Aborted** — `esc`: card fades; result written with remaining steps = skipped.

**Rich-zone states** ⏳
- **Options: generating** — dot-matrix(thinking, indigo) + "drafting options…".
- **Options: applying** — the picked variant applies to the real work: dot-matrix(working, indigo) + "applying A…".
- **Options: apply failed** — danger hairline + "couldn't apply — try another or skip (⌥→)"; never blocks the run.
- **Media: loading** — dot-matrix(working) in the media box.
- **Media: failed** — a static fallback (the instruction alone) + a small "preview unavailable"; the step still works.

**System edges**
- **doneWhen timeout** — sensor hasn't fired within `timeoutMs`: the auto-status quietly switches to *"press ⌥→ when done"* (drops to manual-only; already built).
- **Offline / no-model** — a step that needs God while backends are offline: shown as manual with *"AI is offline — do this yourself, then ⌥→"*.
- **Concurrent guide** — a second `guide_run` while one is active is **refused** (single on-screen cursor); the caller gets a clear error (built, daemon side).
- **Empty / malformed** — a run with 0 valid steps is ignored with a logged reason; never a blank card.
- **Reduce-motion** — ring stops pulsing (still ring), dot-matrix falls to a still field.

---

## 7. Edge cases (layout & interaction)

- **Card ⟷ target collision** — if the step's target sits in the **bottom band** (where the docked card lives), the card **flips to dock top-center** so it never covers the thing it's pointing at. (New: implement a `dockEdge` derived from target.y.)
- **Card taller than screen** — instruction scrolls inside a clamped body; header + action bar pinned.
- **Many options** — cap visible variants at **3** (A/B/C); more than 3 → horizontal scroll strip, `log` that the rest are hidden (no silent truncation).
- **Long instruction** — grows the card (no clamp), up to the max-height rule, then scrolls.
- **Multi-monitor** — dock + ring resolve on the target's screen; if the cursor is elsewhere, the ring is where the target is, not the cursor.
- **Paste on a non-paste step** — ⌘V is observed but ignored (only a `pasted` doneWhen consumes it); the paste still lands in the app.
- **Missing permission mid-run** — if a monitor drops, keys stop; the visible affordance + `esc` still work; a one-line "keys paused — re-grant Accessibility" appears.
- **Duplicate/stale trigger** — `guide-run.json` is deleted on pickup; a stale file from a crash is cleared at next run start.

---

## 8. Reversibility · legibility · order

- **Reversible** — `⌥↑` Back re-opens the previous step (clears its verdict + feedback so re-answering overwrites). A guide is always escapable (`esc`).
- **Legible** — never a raw id: steps show their human text; an inferred/uncertain thing is marked, never guessed. Screenshots are copied to a durable path (not a `/tmp` id).
- **Order & prominence** — segment bar shows position; primary action (Next/Approve) is the only lime keycap; destructive/close is plain.
- **Durable** — each run (verdicts, **the A/B/C choices**, notes, durable screenshots) appends to `~/.relay/guide-history.jsonl`; readable by any Claude thread (`guide_history`).

---

## 9. Motion

- Ring pulse `easeInOut 0.8s repeatForever` (still if reduce-motion).
- Collapse/expand `easeOut 0.16s`.
- Advance flash `0.35s`.
- Dot-matrix speed: 1.0× idle-sensing, ~2.4× while applying/working.

---

## 10. Build status

**Built + self-tested:** docked card, ring (points, only on target steps), segment bar, AUTO + auto-status line, Bricolage instruction (uncut), two-row `⌥` action bar, `⌥.` collapse↔pill, paste→auto-advance, doneWhen timeout→manual, durable history + screenshots, `guide_history` connector method.

**⏳ Phase-2 to build (this spec):** Media zone · live A/B/C Options+approve · the **dot-matrix** swap for the sensing/working indicators (currently a single pulse dot) · the **dock-edge flip** (top vs bottom by target) · permission-missing strip · options/media loading+failure states.
