# Guru Live — closed-loop guidance (spec)

**Status:** spec · relates to [`ONBOARDING.md`](ONBOARDING.md), the `god.mjs guide` generator (single-shot v1), CursorGuide.

## The shift — open-loop → closed-loop

**Today (open-loop):** Claude writes all N steps up front, *blind*, hands over a static list; the user follows;
feedback returns in one batch at the end. It's a printed manual.

**This (closed-loop):** Claude looks at the *actual* screen, decides the **one** next step, watches the user
do it (auto-detected), then **looks again** and decides the next. Eyes at every step — someone over your
shoulder, not a manual. The guide stops being a plan and becomes a conversation with the screen.

Why it matters: it handles what a static script can't — an unexpected dialog, the user clicking the wrong
thing, an app that looks different than assumed, an error popping up. And it needs **zero pre-authoring** —
guru can walk someone through *anything on any app* because it's deciding from what it sees, not from a script.

## The loop

```
  ┌────────────────────────────────────────────────────────┐
  │  capture screen (downscaled)                            │
  │        │                                                │
  │        ▼                                                │
  │  DECIDE NEXT  ── goal + steps-done + THIS screen ──▶    │
  │        │        one of: NEXT-STEP · DONE · REDIRECT     │
  │        ▼                                                │
  │  render ONE guru card (point + instruction, + copy)     │
  │        │                                                │
  │        ▼                                                │
  │  await doneWhen  (AX/OCR auto-detect the user did it)   │
  │        │            └─ or timeout → re-see, re-word     │
  │        ▼                                                │
  │  recapture ──────────────────────────────▲ (loop)       │
  └────────────────────────────────────────────────────────┘
        exits on: model says DONE · max-steps cap · user Esc
```

## What's REUSED (the hard half is already built)
- **CursorGuide** renders the card *and* auto-detects step completion via `doneWhen` (AX first, Vision OCR
  fallback). So the system already knows "the user did step N" without asking.
- **`claude_session`** — warm, stateful completion threads (goal + history stay resident + cached).
- **`god.mjs`** vision loop + the **single-shot generator** (`god.mjs guide`, v1) — the per-turn "screenshot →
  points" half.

## What's NEW (the missing ~20%)
1. **A driver that outlives one completion.** `god.mjs` is one-shot per turn today; live guidance needs a
   persistent loop (a daemon routine, or a long-lived god process) that runs capture→decide→render→await→repeat.
2. **Per-step feedback.** Each `doneWhen` firing feeds the next turn (instead of the batch return).
3. **The decide-next prompt.** "Goal + steps done + THIS screenshot → the ONE next step (with a `[POINT]`),
   or `DONE`, or `REDIRECT` (the screen isn't where we expected — get back on track)."

## Control-flow decisions (the real substance of the spec)
1. **When to re-capture:** on `doneWhen` fire (step done). Plus on a **timeout** (user stuck N seconds → re-see;
   maybe re-word the same step or offer a hint).
2. **When to stop:** the model emits `DONE`; OR a **max-steps cap** (safety, e.g. 25); OR the user aborts (Esc).
3. **Off-track handling (the killer feature):** if the current screen isn't what the last step anticipated, the
   model returns `REDIRECT` with a corrective step — it *saw* the user go the wrong way and course-corrects.
4. **Latency:** each step is one vision round-trip (~1–3s). Show a subtle "looking…" shimmer on the card while
   re-seeing so it never feels frozen.
5. **Safety = guidance, not automation.** Guru only **points + instructs + pre-copies**; the *human* clicks.
   It never auto-acts. (Auto-acting is God's separate, per-action-consented `[RUN]` path — not this.)

## Token / cost model
| | Static v1 | Live | Hybrid (default) |
|---|---|---|---|
| Screenshots | 1 | N (one per step) | few (only on divergence) |
| Model calls | 1 | N | N (small, cached) |
| Standing context (goal, instructions, history) | — | **cached** (prompt caching) | **cached** |
| Adaptivity | none | full | full |

The standing context behaves like a **cached preset** — cheap after turn 1. The only *fresh* per-step cost is
**one downscaled screenshot + a short decision.** Keep the screenshot small (downscale/crop to the active
window). **Hybrid** plans 2–3 steps ahead and re-captures ONLY when `doneWhen` fails / the screen diverges — so
the common case is ≈ static cost, and you pay for vision exactly when something surprising happens (which is
when you want eyes). Net: bounded and tunable, not free.

## Modes
- **Live** — re-see every step. Max adaptivity, N screenshots.
- **Hybrid** (recommended default) — plan a few ahead, reverify on surprise. Nearly static cost, still adaptive.
- Both share the same renderer + `doneWhen` detection; the mode only changes *when the driver re-captures*.

## Auto mode — same loop, guru moves the hands (guide → assist → autopilot)

Guru-live subsumes God: God's single `[POINT]` is the one-step case of this loop. Add **hands** and the
same loop becomes an actuator. What varies across the spectrum is only *how much guru does vs. hands to you*,
and the **consent gate is the dividing line**: reversible/safe → guru does it; irreversible/decision (send,
delete, pay, submit, purchase, confirm) → hand it to the human.

- **Execution reuses God's existing hands** — the loop decides an ACTION (`CLICK x,y` / `TYPE text`) instead of
  a card, and executes via `god-action.json` → native `executeGodAction` (`RelayMenuBar.swift:5206` — clicks
  via `cliclick` using `shotW/shotH` px→screen mapping) — then re-sees. No new execution engine.
- **Consent model** = session-level opt-in (`--auto`) + per-action reversibility. Safe steps run directly;
  GATE steps still raise the existing Allow card. Mirrors autopilot's full-auto-per-company + gate-the-sends.
- **Runaway safety**: the loop is capped (max steps), Esc always aborts, and every step is visible.

### The visual grammar — ring ↔ dot
The mark encodes WHO is acting, so the user always knows the mode at a glance:
- **Guide:** a **ring** at the target — "your turn, click here." It waits.
- **Auto:** a **dot** — guru's cursor travels to each point and taps (a click-ripple). The user *watches* it
  work; the moving dot is the trust/transparency surface (see every action, Esc to grab the wheel).
- **At a gate:** the dot **reverts to a ring + card** ("your call — Send?") — handing the wheel back exactly
  at the decision. So the ring↔dot switch literally expresses the guide↔auto handoff, per step.

## Build shape
- Extend the `god.mjs guide` generator into a **driver loop** (or a daemon routine `guru-live`) holding a warm
  `claude_session`; each iteration writes a **single-step** `guide-run.json` and waits for its `doneWhen` /
  result, then recaptures. CursorGuide already renders + detects — the loop just feeds it one step at a time.
- The launcher "Guide me" entry (other thread) triggers it with the user's goal.
