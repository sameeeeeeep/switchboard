# Onboarding — the first ten minutes

*Draft 2026-07-31. The plan for how a brand-new user goes from a downloaded DMG to "I get it."*

## North star

Steal the one thing HeyClicky's onboarding got right (the one Lenny Rachitsky called a new
favourite): **the assistant onboards you with its own core trick.** HeyClicky points an animated
cursor at the exact button and talks you through it — teach-by-pointing, zero technical setup, "a
friendly buddy that points at things."

We already have that trick and no one else in this repo's lane does: **God points** (`[POINT:x,y]`),
**follows the cursor with a glow**, and **speaks in a voice you can clone**. So the demo isn't a
slideshow — *God gives you the tour by pointing at Switchboard's own UI and narrating it.* The product
teaches the product.

Everything below reuses parts that already exist. We are wiring, not inventing.

## The journey — two acts

```
DOWNLOAD DMG → [Act I: Setup, mechanical]         → [Act II: The practice run, God-led]
               daemon up                              God points at the notch  → "press ⌃⌃"
               signed in to Claude Code               God points at the gear   → "that's Settings"
               Chrome extension added                 God demos ⌃⌥ dictation
               first wrapp / first connection         "say 'open Notes'"  (fast local action)
                                                       → you're done, and you did each thing once
```

**Act I is mechanical** — you can't use the assistant to set up the assistant, so setup is a
check-a-rung / open-the-exact-setting / verify-real-state walk. This already exists for God as a
terminal concierge ([`examples/god/lib/concierge.mjs`](../examples/god/lib/concierge.mjs)). We
generalise its grammar into Switchboard's GUI and follow the **same rung order as
[STATES.md](STATES.md)**.

**Act II is the magic** — it only starts *after* sign-in, because that's when a model exists and God
wakes up. Then the same companion becomes the tutor.

## Act I — Setup, rung by rung

Grounded in the [STATES.md](STATES.md) ladder (rung N is meaningless until N−1 holds). The menubar
app already derives most of this state (`Model.running / signedIn / apps / plist`), and already ships
notch-drop permission cards (`PermissionGateCard`, `GodPerm` = mic → accessibility → screen). We add
the *connective tissue* — a single guided surface that shows one rung at a time.

| # | Rung | Holds when | Owner surface | The "open the thing" action |
|---|------|-----------|---------------|------------------------------|
| 1 | **App installed & daemon up** | launching the DMG'd app | menubar | auto-installs the LaunchAgent on first run (already does) |
| 2 | **Signed in to Claude Code** | `~/.claude.json` has an account | menubar | open Terminal, run `claude` (mirror concierge.mjs) |
| 3 | **God's senses** (mic/a11y/screen) | TCC granted | notch-drop cards (exist) | drag-chip / Open-pane (exist) |
| 4 | **Chrome extension** | `installedHere` / a web app connects | extension + menubar | open the install page (`thelastprompt.ai/switchboard`) |
| 5 | **First wrapp / first connection** | `Model.apps > 0` | store + panel | open the store's "Start here" hero |

Quieting rule from STATES.md §3 holds: render the **first unmet rung**, never a checklist of
everything. The rest are shown dim/done, not nagging.

Note the honest boundary: the Chrome extension and Screen Recording can't be cleanly *observed* from a
native process — those rungs are user-confirmed ("inferred"), exactly as concierge.mjs marks them.

## Act II — The practice run (God-led, teach-by-pointing)

The differentiator. Once God is awake, it runs a short scripted tour. Each step: **God points at a
real element + speaks one line + waits for you to do the gesture once.** We can *detect* the gesture
really happened, so the tour advances on success, not on a "Next" button.

| Step | God points at… | God says | Advance when (real signal) |
|------|----------------|----------|-----------------------------|
| 1 | the **notch orb** | "That dot is me. Press Control-Control and I'll look at your screen." | `~/.relay/god-state` flips to `listening/thinking` |
| 2 | the **panel** | "Hover the notch to open your Switchboard — your apps, models, tools." | panel becomes visible |
| 3 | the **gear (bottom-left)** | "That's Settings — your name, my voice, economy mode." | `showSettings == true` |
| 4 | nothing (voice) | "Hold Control-Option and just talk — I'll type it wherever your cursor is." | `dictating` fires once |
| 5 | nothing (voice) | "Try me: say 'open Notes.'" | a fast local action runs (ties into the router idea) |

Every one of those signals already exists in `RelayMenuBar.swift` (`godStateTimer` reads
`~/.relay/god-state`; `showSettings`; `dictating`; `panel.isVisible`). The tour is a small state
machine over signals we already poll.

Skippable at every step ("I've got it"). Re-runnable from Settings → "Take the tour."

## What we reuse (so this is weeks, not months)

- **God's concierge grammar** — `examples/god/lib/concierge.mjs`: observe → open-the-pane → verify →
  next. Port the *order and honesty*, render as GUI.
- **The readiness ladder** — [STATES.md](STATES.md) rungs + the "one rung at a time" quieting rules.
- **Existing notch-drop permission cards** — `PermissionGateCard` / `GodPerm`. Already the best part
  of onboarding; the setup ladder just sequences them.
- **God's POINT + glow + voice** — the tour's whole engine. God already points at pixel coordinates
  and follows the cursor with a glow; pointing at *our own* chrome is the same code aimed inward.
- **Live signals** — `god-state`, `showSettings`, `dictating`, `panel.isVisible` — the tour's
  advance conditions, already polled.

## Copy principles

- Lead with the **value moment**, not the setup. First real line the user hears is God looking at
  their screen — not "grant 5 permissions."
- **Show, don't tell** — never a paragraph explaining a shortcut; God points and you press it once.
- One rung, one sentence. Honest about observed vs inferred (say what we actually checked).
- Distribution tie-in: the first wrapp we steer them to should be a recognisable win (dictation =
  "the open Wispr Flow", God = "the open HeyClicky"). Onboarding is where the distribution promise
  gets paid off.

## Build order

1. ✅ **Phase 1 — Setup ladder (GUI).** Shipped in `RelayMenuBar.swift` (`Onboard`, `setupView`,
   `rungRow`): the live rung list replaces the bare first-run popover, with the two new actions
   (`startClaudeLogin` opens Terminal + `claude`; the extension/store rungs open the hub). First run
   sets `onboard.beginSetup()`; the marker is `~/.relay/onboarded`.
2. ✅ **Phase 2 — Practice run.** Shipped as `tourStrip` + the `Onboard` step machine over the real
   signals already polled — `god-state` (⌃⌃), `showSettings` (the gear), `dictating` (⌃⌥) — each step
   auto-advances on the gesture, is skippable, and the whole tour re-runs from Settings → "Replay the
   welcome tour". Silent/legible coach-marks; works with zero AI.
   - ⏳ *Deferred flourish:* God pointing its **glow** at the notch during step 0. The tour is complete
     without it (teach-by-doing via real detection); the glow-point is the awake-only polish and rides
     the existing `GlowModel` when we wire it.
3. **Phase 3 — Fast local actions** (the router thread) so a final "open Notes" step is instant and
   free — the demo's kicker doubles as the perf feature.
4. **Phase 4 — Distribution payoff.** The "first app" rung deep-links to the store hero; the app
   READMEs (Flow, God) frame them as the open alternatives people searched for.

## Resolved decisions (was: open questions)

- **Lives in the menubar app.** Every gesture (⌃⌃, the panel, the gear, ⌃⌥) is menubar-native, so
  the whole flow is one Swift surface. The extension owns only the "extension installed" rung, which
  we *infer* (a web app connecting proves it) rather than observe.
- **Silent coach-marks always; God's voice is the awake bonus.** Act II renders as a guided strip with
  real gesture detection and works with zero AI. When God is awake it additionally points its glow at
  the notch. We never block the tour on sign-in.
- **Dedicated marker `~/.relay/onboarded`** (holds a version string), separate from `TOKEN_FILE`, so
  re-running the tour is clean and we can re-onboard on a major bump. Deleting it re-triggers.

## Completeness pass — every state, edge, and its reversibility

### The state machine
```
Onboard.phase:  hidden ──first run──▶ setup ──all core rungs met / "skip setup"──▶ tour ──last step / dismiss──▶ done
                   ▲                                                                                              │
                   └──────────────────────  Settings → "Take the tour"  ◀──────────────────────────────────────┘
```
`done` writes `~/.relay/onboarded`. `hidden` is the steady state for a returning, set-up user.

### Act I — every rung, every state

| Rung | Met (observed) | Not met → action | Reversible? | Honesty |
|------|----------------|------------------|-------------|---------|
| Daemon up | `Model.running` | **Start** (`onRestart`) — auto-installed on first run | daemon can stop → rung reverts, shown amber | observed |
| Signed in | `Model.signedIn` | **Sign in** → opens Terminal, runs `claude` | sign-out reverts it | observed (marker) |
| God's senses | `GodPerm.granted` (mic/a11y/screen) | reuse the existing notch-drop cards | revocable in System Settings | observed (TCC) |
| Extension | a web app has connected **or** user confirms | **Get the extension** → install page | — | **inferred** — labelled so |
| First app | `Model.apps > 0` | **Open the store** → the "Start here" hero | disconnecting reverts | observed |

Rules honored: **one rung at a time** (render the first unmet; the rest are dim/done, never a nag);
**strict order** (a later rung is meaningless until the earlier holds); **skip is always available**
and never bricks anything; **honest observed-vs-inferred** labelling.

### Act II — every step, its advance signal and its fallbacks

| # | Step | Advance signal (real) | If it can't fire | Skippable |
|---|------|-----------------------|------------------|-----------|
| 0 | Press ⌃⌃ | `~/.relay/god-state` → `listening/thinking` | needs mic; if ungranted, strip says so & links the senses rung | yes |
| 1 | "This is your Switchboard" | **Continue** tap (no gesture) | — | yes |
| 2 | Open Settings (the gear) | `showSettings == true` | — | yes |
| 3 | Hold ⌃⌥ to dictate | `dictating` fires once | needs mic; same fallback as step 0 | yes |
| — | Done | — | — | — |

Edges handled:
- **Panel would auto-close** mid-tour → suppressed while `phase == .tour`.
- **Opening Settings hides the dashboard** → the tour is a **top strip**, independent of which pane is
  shown, so it survives navigation and detects the gear step over the settings pane.
- **God not awake** (signed out / no permissions) → steps still advance on the raw OS gestures; the
  glow-point flourish is simply absent. The tour never requires God.
- **Every step Skippable**, and **the whole thing dismissable** (×) → marks `onboarded`, resumable
  from Settings. Re-running when already set up **skips Act I** straight to the tour.
- **Daemon dies mid-onboarding** → the daemon rung in Act I reverts to amber with **Start**; the tour
  strip's gesture steps keep working (they're OS-level, not daemon-level).

### Legibility
Progress is always visible ("Step 3 of 4", "2 of 5 set up"). Copy leads with the value moment, one
sentence per step, and states what was actually checked. Nothing here is a dead end: every screen has
a forward (do the thing), a sideways (skip), and an escape (dismiss).
