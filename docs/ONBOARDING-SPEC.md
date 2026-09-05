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

---

## 11 · The complete experience — founder-guided (2026-08-31)

Built live, beat by beat, with the founder. This is THE first thing a user ever experiences: it must be
super comprehensive and it must WOW. Captured in the founder's own words, enriched as we go. Supersedes
the earlier beat lists where they conflict.

### Frame 0 — the ignition (the birth, before any card)
The instant Switchboard first opens, the user's **ENTIRE SCREEN is overlaid** with the dot-matrix field:
hundreds of lamps blinking on/off, scattered and alive. The blinking then **organizes** — the dots migrate
and settle until they **form the Switchboard logo (the 2×2 lamp cluster) + the name SWITCHBOARD** (Doto,
lime). A full-screen dot-matrix title reveal. The operator announces itself — takes over the whole machine
for a moment — before it says a word. (founder verbatim: "their entire screen overlaid with dot matrix
blinking dots that start to form the switchboard logo with name")

**Transition (DECIDED — founder):** once the dots form the logo, they are **inhaled straight up into the
notch** — the full-screen field collapses and streams upward into the top-center, and that IS how the
operator takes its home. The first moment doubles as orientation: the user's eyes are pulled to the notch,
which is where everything lives from then on. Wow + "where to look" are the same beat.

_Still open (minor, resolve later):_ whether the name is spoken in God's voice as it forms; a dot-matrix
power-on sound vs. pure-visual.

### Frame 1 — the greeting, then God-voice-guided setup (step form)
Right after the logo is inhaled into the notch: the **orb pulses awake and says "hello" in God's voice**,
and the notch greets them (a "hello" state, the way it shows "listening"). From here **God's VOICE is the
guide** through the whole setup — not silent text cards; the operator talks you through it.

**Principle — constant wow + a reason for everything.** At EVERY point the user is wowed by things
**actively opening for them** to try or to grant, and God **tells them WHY each one is needed** (never a
bare permission prompt). Setup is never a static checklist — the operator is doing things in front of them.

**Order is deliberate — step form, one at a time:**
1. **Accessibility FIRST** — the hand that points and types. God explains why, opens the real pane, waits
   for the grant, celebrates it.
2. **Mic SECOND** — so that, once granted, the user can **speak back** to God. The sequence is designed so
   the moment mic is on, the conversation becomes two-way. God prompts them to say something and hears it.
3. …(subsequent senses/steps continue the same way — each opens, each explained, each a small wow).

(founder verbatim: "the orb pulses awake and says hello in god's voice, and the notch like it says
listening says hello, and god's voice guides through the setup … at each point the user needs to be wowed
with things constantly opening for them to try or grant permissions and they are told why each one is
needed … in step form so accessibility first then mic for user to speak back")

### Parallel workstream (not onboarding, founder-flagged): God must stop saying "no access"
God currently refuses almost everything ("it doesn't have access"). Make God **launcher-like** — route a
request to the wrapp that handles it and act, instead of refusing. Pinned to a subagent; fix tracked
separately from the onboarding build.

### Frame 2 — speak into the launcher → a wrapp opens (the first win)
After Accessibility + Mic, God opens the **launcher (⌥⌥)** and has the user **dictate their request straight
into the launcher field** — using the very mic + dictation they just granted. That spoken goal is **routed
to the wrapp that handles it, which opens and runs** (launcher-style routing). (founder: "launcher, and
dictation into the launcher itself and that should open up the wrapp")

Why this is the payoff beat: it **chains everything just set up into one wow** — the hand (Accessibility) +
the voice (Mic) + dictation + the launcher + wrapp-routing all fire together, and the reward is a **real
app appearing and doing work because they SPOKE**. No typing, no hunting. The first win is earned by the
setup, not bolted on after it.

**The seeded example (DECIDED — founder):** God gives them a vivid idea to narrate into the launcher —
e.g. *"imagine a brand for healthy prebiotic soda but with bold Indian flavours."* The user SPEAKS that
idea; the launcher hears it and **surfaces Brand Brain as the suggestion** (the routing is VISIBLE — the
user sees their vague spoken idea understood and matched to the right app); opening it launches **Brand
Brain preloaded with that idea**, which immediately generates names, a palette, a tagline. The wow: they
spoke a half-formed idea out loud and a real brand studio spun it into something in seconds. (founder:
"brandbrain with a preloaded example … the user narrates an idea into the launcher … and it gives the
suggestion of brandbrain that opens it")

Two micro-beats worth keeping distinct: (1) the launcher SHOWS Brand Brain as the match (teaches routing),
then (2) it OPENS, preloaded + running. Don't skip (1) — seeing the match land is half the magic.

**Dependency:** this needs launcher→wrapp routing from a natural-language goal — the SAME capability the
God "no access → route to a wrapp" fix is building. The onboarding's first win and the God fix share one
routing engine. Build them to the same seam.

### Frame 3 — the hand-off (the ending — DECIDED, founder approved)
After the first win (Brand Brain has spun up their soda brand), God **hands them the keys and recedes into
the notch**: "this is yours now — press ⌃⌃ any time." The full-screen experience collapses back up into the
notch, leaving them with an operator living in the corner, not an app they just finished configuring. The
last feeling is ownership + "I know how to use this," because they just DID all of it.

### The two governing principles (founder, restated — hold these above every beat)
1. **Experience + understand.** The user must EXPERIENCE each thing and come away knowing HOW to use it —
   every beat is "watch it, then do it yourself," never told-not-shown.
2. **Wow, really.** Each beat has to land as a genuine wow, not a functional step. If a beat isn't
   wowing, it's not done.

### Cross-cutting A — Skip onboarding (escape hatch)
Once the ignition dots fade / inhale, a **"Skip onboarding"** control appears **top-right** and persists
through the whole flow. Reversible at any moment — the user is never trapped. (founder: "after the dots
fade away we should show a skip onboarding or something up the top right")

### Cross-cutting B — the card MOVES notch → on-screen to avoid the clash (the real placement fix)
When a beat opens a competing surface (the launcher, a wrapp window, the orb…), the guide card must **not**
sit at the notch fighting it. It **animates OUT of the notch to an on-screen position** (to the side, out
of the way) so the user sees BOTH — the guidance AND the thing they're using — without overlap. This
REPLACES the old "collapse to a pill" behavior for these beats: the card stays READABLE beside the surface,
it just relocates. (founder: "show the card move from notch to on screen when we show the user launcher etc
cause otherwise it clashes"). Build note: this is the notch→side placement, triggered by a beat that owns a
surface — extend `yieldsTo` to MOVE-and-stay rather than collapse.

### Frame 2 — REVISED (founder 2026-08-31): the launcher IS the dictation surface, not a notepad
DROP the scratch notepad from onboarding. Instead, walk the user through the **shortcuts ONE BY ONE**, using
**dictation INTO THE LAUNCHER**, and **God TELLS them exactly what to say** each time. (founder: "instead of
notepad make user try our different shortcuts one by one with dictation in the launcher and tell them what
they should say")

Shape (each shortcut its own guided try, with a told prompt):
- **⌥⌥ launcher** — "Press option-option — this is your launcher."
- **⌃⌥ dictation, into the launcher** — "Now hold control-option and say: <a told phrase>." The words land in
  the launcher's field (that path already works — pasteText inserts into the LauncherPanel field). They SEE
  their spoken words appear, then the launcher routes/opens the matching wrapp.
- **⌃⌃ God** — "Press control-control and ask out loud: <a told phrase>."
- Each is TOLD (God says the exact phrase to speak), so it's never a blank prompt. The first-win idea
  (prebiotic-soda brand → Brand Brain) becomes the told launcher phrase.

Supersedes the "dummy text field" — the field to talk into is the LAUNCHER'S own field.

### Requirement — God's onboarding voice must be PRE-CACHED, not generated live (founder 2026-08-31)
The onboarding `say` lines are known ahead of time. Pre-generate their audio (god-tts /speak) and CACHE it,
then play the cached clip during onboarding — no live TTS generation lag mid-flow. (founder: "the god voice
should be pre cached, it cant be generated"). Warm/pre-generate on first-run setup (or at build), keyed on
the line text; speakGuideLine plays the cached file when present.

---

## 12 · Build-status ledger (2026-09-05) — what's wired, what remains

The §11 experience was almost entirely BUILT, but the ignition was **orphaned from first launch** — it only
played off a manual `touch ~/.relay/ignite` (the watcher deletes the file after firing), so it showed once
and never again; first run silently ran the old setup-ladder panel instead. This pass wires it up.

### Fixed this pass
- **Ignition fires on first run.** `applicationDidFinishLaunching` now calls
  `IgnitionController.shared.present(chainTour: true)` when `!readOnboarded()` — the dot-matrix reveal →
  inhale-into-notch → chains to the god-voiced welcome tour. (`RelayMenuBar.swift`, first-run block.)
- **Re-onboard actually works.** The trigger is gated on `!readOnboarded()` (the `~/.relay/onboarded`
  marker), NOT `TOKEN_FILE` — so deleting the marker genuinely re-onboards (fixes §6 "Re-onboard" row).
- **Marker written at real completion, not tour start.** `startWelcomeTour` no longer writes `onboarded`
  up front; the tour payload carries `marksOnboarded:true` and `CursorGuide.onFinish` writes it when the
  tour **ends** (completed OR left). A hard-quit mid-tour never reaches `onFinish`, so onboarding replays —
  §7 resumability, and the direct cause of "seen once, never again" for anyone who bailed mid-tour.
- **Skip marks onboarded.** The ignition's top-right "Skip onboarding" writes the marker (the tour marks on
  finish, but skip short-circuits before the tour) — otherwise the full-screen ignition re-fired every launch.
- **First-win gate de-risked (803df56).** `wrapp-opened` now fires from `showWrappWidget` (the launcher's
  path) as well as `openWrappWindow`, so beat 3b completes whatever surface the launcher routes the wrapp to
  — the user can't get trapped on the gated step because the wrapp opened as a widget rather than a window.

### To replay / reset (testing)
- Replay the whole first-run experience: `rm ~/.relay/onboarded` and relaunch Switchboard.
- Ignition only (visual): `touch ~/.relay/ignite`. Tour only: `touch ~/.relay/replay-tour` (or the menu's
  "Replay the welcome tour").

### COMPLETION LOOP (started 2026-09-05, founder /loop "bring this to completion — wow, sound effects, pre-loaded voice, properly open things, custom card not generic notch")
Constraints: wow · sound effects · guided voice PRE-LOADED · properly open real things · CUSTOM card (not the generic notch).
- [x] **Custom operator card** — bespoke `onboardingCard` in CursorGuide, activated by `style:"onboarding"` on the
  tour run. Dot-matrix `.speaking` beacon + operator line in Doto + taught-keys caps + switchboard-lamp progress;
  no Note/Unmute/Close chrome. Same engine/panel/click-through. VERIFIED rendering on screen. (`CursorGuide.swift`
  `onboardingCard`, model `.style`; `RelayMenuBar.swift` payload `style:"onboarding"`.)
- [x] **Sound effects** — 3 procedurally-synthesized on-brand wavs in `packages/menubar/sounds/` (auto-bundled):
  `ignition-poweron` (fires in IgnitionOverlay.present), `lamp-tick` (per beat), `connect-chime` (win/sign-off).
  `SBSound` helper in IgnitionOverlay; gated to onboarding via `CursorGuide.onboardingActive`. VERIFIED: ignition
  full-screen dot-matrix + power-on confirmed on screen. (External ElevenLabs SFX API was erroring → local synth.)
- [x] **Pre-loaded voice** — copy LOCKED (founder approved 2026-09-05). All 12 `say` lines pre-rendered (voice
  'moira') → `packages/menubar/onboarding-voice/<lineHash>.wav`, bundled by build.sh + package-dmg.sh. speakGuideLine
  now checks the bundled clip FIRST (before the no-selected-voice fallback — the fresh-machine state), so the guided
  voice plays instantly with NO generation and NO server on first run. `RelayMenuBar.lineHash` (djb2) matches the
  bake script (scripts/bake_voice.py). Regenerate clips if any `say` line changes. (Was: warm-at-tour-start = live lag.)
- [x] **Ignition robustness (CRITICAL FIX)** — the ignition could get STUCK as a full-screen black overlay: its
  SwiftUI `TimelineView(.animation)` stalls when the panel is occluded OR the display sleeps, so `onDone` never
  fired → no teardown, no tour chain (guide-runs stayed stale). FIX: a wall-clock `Timer` failsafe in
  `IgnitionController.present` always calls `dismiss` (idempotent), and `dismiss` now writes the `replay-tour`
  chain SYNCHRONOUSLY (not in the fade's completion, which the display-asleep state skips). No more black-screen.
- [ ] **Properly open things** — audit each beat's onStepEnter opens its REAL target (accessibility pane, mic prompt,
  launcher, Brand Brain preloaded). Depends on launcher NL-routing for the first win (THE remaining epic — the
  same routing engine as the God "no access → route to a wrapp" fix; needs founder direction, out of polish scope).
- [ ] **Wow arc end-to-end** — ignition → wake → senses → first win → hand-off, verified on a real first run.
- Deploy note: build.sh signs Developer ID when the Apple timestamp server is up; when it's DOWN it falls back to
  ad-hoc (resets TCC) — re-sign with `codesign --force --deep --options runtime --timestamp=none --entitlements
  Relay.entitlements --sign "Developer ID Application: STAYOFT VENTURES PRIVATE LIMITED (55354KFTHU)" Switchboard.app`.

### Still open (deeper — NOT in this pass)
- **Launcher NL-routing is the real dependency for the wow.** Beat 3b's payoff — speak "a brand for healthy
  prebiotic soda with bold Indian flavours" → the launcher SHOWS Brand Brain as the match → opens it
  preloaded — needs launcher goal→wrapp routing (the same engine as the God "no access → route to a wrapp"
  fix, §11 parallel workstream). If routing doesn't surface a match, no wrapp opens and the gate waits (the
  user can still `esc` out — not trapped, but not the wow). This is the keystone remaining build.
- **Notch→side card MOVE** (§11 Cross-cutting B) is currently `parkAside`/`unpark` on the three surface-
  owning beats (open-launcher / say-into-launcher / try-god) — verify it reads as a *move*, not a hide.
- **Frame 3 hand-off** ("this is yours now" — God recedes into the notch) is the `done` step's copy only;
  the visual recede-into-notch is not built.
- **Dead code to remove** (superseded, still present): `DictationScratch.swift`; the old 4-step
  `Onboard.tourCount` state machine coexisting with the 7-beat `startWelcomeTour` spine; `docs/ONBOARDING.md`
  still describes the dead tour.
- **Ignition is silent** — §11 Frame 0 leaves "power-on sound vs. pure-visual" open; the remembered "sound
  effects" are God's TTS + system sounds during the tour, not the ignition itself.
