# Onboarding — the planned first-run sequence

*Refines [ONBOARDING.md](ONBOARDING.md) with the founder's 2026-08-04 direction. Same north star
("the product teaches the product"); the change is the **driver** and the **order**.*

## The corrected premise (drop the fear)

- **The DMG is notarized → there is no Gatekeeper block.** The user sees only "downloaded from the
  internet — Open." That's it. (Corrects an earlier over-weighting of the install as a scary cliff.)
- So the real work isn't the *install* — it's the **first-run onboarding**, which we own end-to-end.

## The key change: CursorGuide leads, not God

The existing doc made the guided pointing-tour **Act II**, gated on Claude sign-in ("God wakes only
once a model exists"). But the **CursorGuide chip is file-driven** (`~/.relay/guide-run.json` → a chip
that floats by the cursor). It needs **no model and no permission** to show a chip. So it can lead from
**step 1**. God's voice/pointing is an *enhancement* layered on once senses + a model exist — not a
prerequisite. One companion, present from the greeting.

**Progressive-permission rule:** never ask for a permission on step 1, and never front-load a pile of
them. Each permission is introduced **just-in-time, motivated by the thing it unlocks**, in order.

## The sequence

| # | Step | Permission? | What the user sees | Unlocks |
|---|------|-------------|--------------------|---------|
| 0 | **Install & open** | none | notarized DMG → "Open" → app opens; daemon auto-installs (already does) | the app is running |
| 1 | **Greeting** | **none** | notch shows a gentle entry; CursorGuide chip: *"Hi — I'm your Switchboard. I let you run AI apps on the Claude you already pay for, privately. 2 minutes, I'll walk you."* → **Next** | trust + orientation (tour mode, zero perms) |
| 2 | **Accessibility** | a11y | *"So I can point at things and help you hands-on, flip on Accessibility."* (reuse `PermissionGateCard`) | **upgrades the guide to teach-mode** — pointing + auto-advance for every step after |
| 3 | **Screen recording** | screen | *"So I can see your screen when you ask (⌃⌃), turn on Screen Recording."* | God's ambient/vision features |
| 4 | **Claude Code** | — (sign-in) | check `~/.claude.json`. Present → ✓. Absent → *"Let's connect your Claude"* — open Terminal, run `claude`, sign in (the one non-GUI step; mirror `concierge.mjs`). | **a model exists → God can now speak/narrate** the rest |
| 5 | **Chrome extension** | **deferred** | *not asked now.* Notch/menubar wrapps run via the daemon without it. Say so: *"We'll add the browser piece the first time you open a web app."* | (introduced just-in-time later) |
| 6 | **The demo — the payoff** | none new | the guide runs **one very cool example end-to-end** — points at the notch (*"press ⌃⌃, watch me read your screen"*), or opens a wrapp and produces a real result, or the "two ways" aha. The product teaches the product; ends on a **win**, not a checklist. | "I get it." |

## Why this order

- **Greeting before any ask** → you earn the permission by first showing what it's for.
- **a11y before screen before Claude** → each unlocks the next capability in the guide itself
  (a11y makes the guide point; screen makes vision work; Claude makes God talk). The guide visibly
  gets *more capable* as you grant, so grants feel like leveling up, not a toll booth.
- **Extension last / deferred** → it's only needed for wrapps injected into arbitrary web pages; the
  onboarding demo uses a notch wrapp that needs no extension. Don't spend trust on it early.
- **Demo last** → the whole thing builds to a real win, HeyClicky-style.

## States & edge cases (each must be handled)

- **Denies Accessibility** → guide continues in **tour mode** (chip only, no pointing); re-offer at
  the demo ("want me to point? flip this on"). Never dead-end.
- **Claude Code not installed** → the one step that leaves the guided GUI. Give a copy-paste `claude`
  command; detect completion by watching `~/.claude.json`; resume automatically.
- **Denies Screen Recording** → skip vision steps in the demo; note plainly what's off, offer later.
- **Quits mid-onboarding** → resume from the last completed rung on next open (STATES.md ladder).
- **No model yet (pre-Claude)** → guide still leads (CursorGuide needs no model); voice narration
  simply off until step 4 completes, then God can take over speaking.
- **TCC needs a relaunch** → if a permission requires restart, the guide says so and resumes post-relaunch.
- **Permission already granted** (returning/power user) → auto-skip that rung; go straight to the demo.

## What's reuse vs new

- **Reuse:** `PermissionGateCard`/`GodPerm` (mic→a11y→screen cards exist), `concierge.mjs` grammar for
  the Claude step, God's `[POINT]`+glow+voice for step 6, the CursorGuide chip + `guide-run.json`
  protocol (proven — it drove the D1 test today).
- **New (the wiring):** a single first-run `guide-run.json` sequence in **teach mode** that runs steps
  1–6 in order, with `doneWhen` predicates that detect each permission/state flip and auto-advance;
  the greeting entry point on the notch; the extension-deferral copy.

## Reconcile with ONBOARDING.md

The existing two-act split (mechanical Act I → God-led Act II after sign-in) should be updated to this
**single CursorGuide-led flow** where permissions come before Claude and God-voice is an enhancement,
not the gate. Recommend editing ONBOARDING.md's journey diagram to match (or marking this the current plan).
