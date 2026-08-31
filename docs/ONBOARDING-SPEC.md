# Onboarding Spec — Switchboard First Run

Status: **DRAFT for approval** (2026-08-27). Written after the founder ran the real tour and it was
"all over the place, clashing with the launcher, so many tiny issues not thought through, no examples
to try, nothing opened to try a text box on, not comprehensive, not specced fully." This spec exists so
none of that ships again — every step is designed, every surface conflict is resolved, every "try it"
sets the user up with a real thing and a real example.

Grounding: the current tour is `startWelcomeTour()` in `packages/menubar/RelayMenuBar.swift:6521-6632`
(a flat list of 12 narrated steps). This spec replaces it.

---

## 1 · What's wrong today (each mapped to a fix below)

| Founder's words | Root cause in code | Fixed by |
|---|---|---|
| "clashing with launcher" | `key-launcher`/`key-summon` (6559,6572) tell you to open the launcher/orb **while the guide card is on screen** — two overlays fight | §4 One-surface-at-a-time: the guide auto-yields while a practiced surface is open |
| "nothing opened to try text box on" | `key-dictation` (6566) says "hold in any text field" but opens **no field** | §5 Every practice step OPENS its target (a real scratch field for dictation) |
| "no examples given to try" | `first-wrapp`/`first-tool` (6590,6595) say "give it a rough idea" / "try QR" with **no sample and nothing opened** | §5 Every try-it seeds a real EXAMPLE and opens the app on it |
| "all over the place" | 12 steps incl. whiteboard, background jobs, economy, re-paste crammed into first run | §3 A tight 6-beat spine; everything else moves to "There's more" / Settings |
| "not thought through / not comprehensive" | ad-hoc appends, no per-step setup/success/fallback, no state matrix | §5 per-step table + §6 state matrix + §7 edges |
| the sign-in cliff | `sign-in` (6552) points at a raw Terminal with no check `claude` exists | §5 Step 1 guarded sign-in |

---

## 2 · Principles (non-negotiable)

1. **Show the value before the setup.** First paint is the promise + one CTA, never "0 of 5 set up."
2. **One surface owns the screen at a time.** The guide, the launcher, the orb, and a wrapp window are
   all overlays; never two at full presence. The guide yields, then resumes (§4).
3. **Set up, THEN practice — with a real example.** A step that asks the user to *do* something first
   OPENS the thing to do it in and SEEDS a concrete example. No "go find X and try it."
4. **Do, don't narrate.** Prefer a real action with a real result over a sentence describing a feature.
5. **No dead-ends.** Every step has a fallback; every failure says what went wrong and the next move.
6. **Skippable, resumable, replayable.** Nothing is marked done until it's actually done; abandoning
   mid-tour resumes where you left off.
7. **Adaptive but honest.** Skip met steps for a returning user, but always offer "see the whole thing."
8. **Tight.** First-run is ≤ 7 beats. Secondary features are a separate, opt-in "There's more."

---

## 3 · The spine (first run = 7 beats, in order)

```
0  Welcome         value-first promise + one CTA
1  Connect Claude  guarded backend choice (never a raw terminal)
2  Senses          only the ungranted permissions, in context
3  Summon (⌃⌃)     press it → the orb answers            [practice, surface-owned]
4  Say something   OPEN a scratch field → dictate into it [practice, real target + example]
5  First win       OPEN a wrapp on a SEEDED example → one click to the payoff
6  You're all set  real completion + "there's more" pointer
```

Cut from first run (were in the 12-step tour): whiteboard, background-jobs, economy-mode, ⌥V re-paste,
"first project" chip, QR. These become an optional **"There's more" (5 x 15s cards)** reachable from the
done step and the menu — never blocking the first win. Economy is a Settings default, not a first-run gate.

The **launcher (⌥⌥)** is taught in beat 5 *by using it to open the first win*, not as its own abstract
"here's your home" step — so it's introduced doing real work, and there's no separate clashing step.

---

## 4 · The surface-conflict rules (the "clashing with launcher" fix)

The clash is architectural: the CursorGuide card and the launcher/orb are both overlays. Rules:

- **R1 — Mutual exclusion.** At most one of {guide card, launcher, orb-listening, wrapp window} is at
  full presence. When a practiced surface opens, the guide card **auto-collapses to its pill** (the
  existing ⌥. collapse) and re-expands when that surface closes.
- **R2 — Practice steps are surface-aware.** A step whose `doneWhen` is opening a surface (summon,
  launcher) declares `yieldsTo: "<surface>"`. The runtime collapses the guide the moment that surface
  appears, and the step auto-advances on the surface's open/close event (it already fires `summon` /
  `launcher` events — reuse them).
- **R3 — The launcher suppresses the tour, not vice-versa.** While the launcher is open the guide never
  draws over it; when the launcher closes the guide resumes at the next step. No competing hotkeys: the
  guide's own ⌥→ / ⌥. keys are disabled while a yielded surface is frontmost (so ⌥ presses go to that
  surface).
- **R4 — Anchoring.** A guide card that points at a real element (a permission card, the scratch field)
  anchors to that element's frame; it must never overlap the element it points at (today it can).
- **R5 — One notch owner.** The tour, PIP feed, and God status all want the notch. During onboarding the
  tour owns it; PIP/status queue behind and resume after `done`.

---

## 5 · Per-step spec (purpose · SETUP opens · EXAMPLE · user DOES · SUCCESS · FALLBACK · COPY)

**Beat 0 — Welcome.**
- Purpose: the promise, not a chore list. Setup: the panel (value-first layout). Example: n/a.
- User does: reads, clicks **Set me up →**. Success: advance. Fallback: × dismisses (resumable).
- Copy: "Your apps, running on your own Claude — nothing leaves this Mac. Press ⌃⌃ anytime." + the five noes.

**Beat 1 — Connect Claude (guarded).**
- Setup: three cards — Claude Code (probe `which claude` / a version call; show Detected ✓ or Not found),
  Cloud (OpenRouter key), On-this-Mac (Ollama). Example: n/a.
- User does: pick one. If Claude Code + signed-out → an **in-panel "Waiting for sign-in… → Signed in ✓"**
  that flips on `model.signedIn` (poll), NOT a bare Terminal. If Claude Code **not found** → show
  "Install Claude Code" (link) + "or use Cloud / On-this-Mac" — never a `command not found` dead-end.
- Success: a live backend (`model.running && model.signedIn`, or a cloud/local backend reachable).
- Fallback: "Skip — I'll connect later" leaves the app usable for non-AI tools; the dashboard keeps a
  visible "Connect your Claude" CTA. Copy: "Runs on YOUR Claude — no key, no bill."

**Beat 2 — Senses (in-context perms).** KEEP today's strength (only ungranted perms as notch cards).
- Setup: surface the real Grant cards (existing `refreshPermissionGate`). Example: n/a.
- User does: Grant each (or skip). Success: `p.granted` per card; the step advances as each flips.
- Fallback: "Skip" — features that need a sense re-ask in context later (already how it works). Copy:
  mic = "the ear", accessibility = "the hand that types", screen = "the eyes — only when you ask".

**Beat 3 — Summon (⌃⌃).** `yieldsTo: "orb"` (R2).
- Setup: nothing else open; the guide card sits at the cursor. Example: a suggested thing to say
  ("try: 'what can you do?'"). User does: press ⌃⌃, speak. Success: `event:summon` (auto-advance);
  guide collapses while the orb listens (R1), re-expands after. Fallback: a "press it for me" affordance
  that triggers the summon so the user sees it even if the gesture misfires. Copy: "Tap ⌃⌃ and ask."

**Beat 4 — Say something (dictation) — THE FIX for "nothing to try".**
- Setup: **OPEN a real, focused scratch text field** — a small "Scratch — dictate here" window (or a
  focused multiline field inside the guide card) so the words have somewhere to land. Pre-focus it.
- Example: placeholder + spoken prompt "Try holding ⌃⌥ and saying: remind me to call the plumber."
- User does: hold ⌃⌥, speak, release. Success: `event:dictation` AND the scratch field is non-empty
  (`field-non-empty`). Show the transcript appear live. Fallback: if Accessibility is off, the copy-and-
  ⌘V path (already shipped) — the step explains it. Copy: "Hold ⌃⌥ and talk — watch it land here ↓."

**Beat 5 — First win — THE FIX for "no examples / narrates".**
- Setup: **OPEN a wrapp natively on a SEEDED example** (native open is fixed now — route via
  preferredSurface). Default: open **Convert Media** with a bundled sample `.m4a` already loaded, or
  **ideabrain** with a sample idea pre-filled, or **Clone** with a bundled 6s sample clip pre-loaded —
  ONE of these, chosen so the user's only action is a single click to the payoff.
- Example: the seeded file/idea IS the example. User does: click the one primary button (Convert /
  Generate). Success: a real result appears (audio plays / text renders). This is the launcher's real
  debut — beat 5 opens it via ⌥⌥ → the seeded wrapp, so the launcher is learned doing real work.
- Fallback: if the backend/voice-engine isn't set up, offer the non-AI instant win (a local convert)
  so there's ALWAYS a payoff. Copy: "Here's one ready to go — press [Convert] and listen."

**Beat 6 — You're all set (the missing completion moment).**
- Setup: a real completion card (today's `doneView` is dead code — wire a live one). Example: n/a.
- User does: read the recap; optional "There's more" opens the 5 secondary cards. Success: **mark
  ONBOARDED_FILE HERE (not before)** so an abandoned tour stays resumable. Copy: recap of what's set +
  "Press ⌃⌃ anytime." + the Connect-Claude nudge if still unconnected.

---

## 6 · State matrix (every first-run must handle)

| State | Behavior |
|---|---|
| Brand-new (nothing set) | Full 7-beat spine |
| Returning / fully set up | Skip met beats; offer "see the whole tour" (don't show a 2-step stub silently) |
| No backend / signed out | Beat 1 guarded; app still usable for non-AI tools; persistent Connect CTA |
| `claude` CLI not installed | Beat 1 offers Install link + Cloud/Ollama — never a terminal error |
| Permission denied / partial | Beat 2 per-card; features re-ask in context; never block the win |
| Offline | Skip cloud; steer to on-device (Ollama, non-AI tools); honest "you're offline" note |
| Voice engine not installed | Beats 3-5 that need :7897 offer the one-tap install (shipped 0.3.10); else route to a non-voice win |
| Abandoned mid-tour | Not marked onboarded → resumes at the last incomplete beat next open |
| Re-onboard (delete `onboarded`) | Panel **auto-opens** (fix the TOKEN_FILE-vs-onboarded gate, RelayMenuBar:4654-4655) |
| Tiny screen / multi-display | Guide + panel + scratch field fit; anchor to the active display |

---

## 7 · Reversibility · order · edges

- **Reversible:** every beat skippable; nothing destructive; economy is a toggle, not a commitment.
- **Resumable:** onboarded marker written only at beat 6; a `~/.relay/onboard-progress` cursor records the
  last completed beat so a re-open resumes, not restarts.
- **Order/idempotency:** beats are ordered; re-running (replay-tour) is safe and re-seeds examples fresh.
- **Edges named:** gesture misfires (offer "do it for me"); Accessibility-off dictation (copy+⌘V path);
  backend drops mid-tour (re-surface Connect); the scratch field losing focus (re-focus on step enter);
  the launcher opened by the user out of order (R3 handles it — no clash); two notch owners (R5).

---

## 8 · Reuse (don't rebuild)

CursorGuide floating tour + `guide-run.json` protocol · notch permission cards (`refreshPermissionGate`)
· `seedExampleProject` · the shipped native-open (preferredSurface) for beat 5 · the 0.3.10 voice-engine
installer · the switchboard/teach `doneWhen` predicates (`field-non-empty`, `field-focused`, events).

---

## 9 · Ordered build tasks (after approval)

- [ ] O1  Rip out the 12-step tour; scaffold the 7-beat spine with a per-beat struct (setup/example/success/fallback)
- [ ] O2  §4 surface-conflict runtime: `yieldsTo` + auto-collapse/resume + hotkey suppression while yielded (fixes the launcher clash)
- [ ] O3  Beat 4: the scratch "dictate here" field (open + focus + `field-non-empty` success) — the "something to try" fix
- [ ] O4  Beat 5: open a wrapp natively on a SEEDED example (bundle a sample .m4a / prefilled idea) → one-click payoff, with a non-AI fallback win
- [ ] O5  Beat 1: guarded sign-in (probe `claude`; Install/Cloud/Ollama; in-panel waiting→signed state)
- [ ] O6  Beat 0 value-first first paint + Beat 6 real completion (wire the dead `doneView`) + move onboarded-marker to beat 6
- [ ] O7  State matrix (§6): returning/offline/no-backend/voice-missing/re-onboard-auto-open
- [ ] O8  "There's more" appendix (whiteboard/background/economy/⌥V/QR as 5 opt-in cards) + fix ONBOARDING.md (it mislabels the dead tour as shipped)
- [ ] O9  Instrument: log the beat each user drops at (so "strong" is measurable)

Recommended first slice once approved: **O1 + O2 + O3 + O4** — the spine + the two fixes the founder hit
hardest (no launcher clash, real things to try). O5/O6 next, O7-O9 to finish.

---

## 10 · Founder direction v2 (2026-08-31) — the refinements that supersede the earlier placement/copy

These sharpen §3–§5 into the real build. Where they conflict with earlier beats, THESE win.

1. **A real tour THROUGH the app's parts.** Onboarding walks the user across the actual surfaces —
   notch, launcher, store, a wrapp, dictation, the board — not a slideshow. Each part is visited live.

2. **Cards live at the NOTCH, then slide to the SIDE — NEVER at the cursor.** Kill `placement:"cursor"`
   for onboarding. The guide card emerges from the notch and docks to the side of the screen (out of the
   way of what it's pointing at). The CursorGuide placement model must add/prefer a "side" placement for
   onboarding; the cursor-riding card is explicitly rejected.

3. **ACTIVELY INITIALIZE each demo — don't narrate, set it up and let them DO it.** Every part is
   demonstrated by the app actually spinning it up for the user, in real surfaces:
   - **Notch option-selection** — raise a REAL presence/`ask` card at the notch and have them pick, so
     they learn the notch-decision surface by using it.
   - **Guided testing** — run a REAL guided step (the teach/`doneWhen` loop) they complete.
   - **A wrapp** — actually open one, seeded, so they run it for real (not "go open X").
   - The pattern: the operator initializes the thing, the user experiences it by doing.

4. **Dictation demo = a real native window with a text field.** When teaching dictation, OPEN a native
   window containing a focused TEXT FIELD, and have the user dictate INTO it — so the words visibly land
   in a real field. (Supersedes §5 Beat 4's "scratch field" idea → make it a real native window.)

### First build slice (proposed)
- **S1** CursorGuide: add a "side" placement (dock the card to the screen edge from the notch); route
  onboarding steps to it; remove cursor placement from the tour.
- **S2** The dictation demo: a native window with a focused text field + a step that has the user dictate
  into it (reuse the now-working ⌃⌥/⌃ pipeline; success = field non-empty).
- **S3** One actively-initialized notch demo: raise a real `ask` option card during the tour and read the pick.
- Then broaden to the full part-by-part tour (store, wrapp, board) using the same "initialize + let them do" pattern.
