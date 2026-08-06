# Routines — the Run layer

**One job:** *let the daemon keep doing a thing for you while every tab is closed — visibly, revocably,
and without ever crossing the send line.* Routines are the temporal half of "a wrapp's backend is a
capability the daemon provides." They are what makes "God runs your life" and "run it like an autonomous
company" more than a cockpit you click: the **clock that executes**.

This is the layer that was missing from `main` — the cockpit (Autopilot) decided, God had hands, but
nothing advanced on its own because there was no scheduler. This is that scheduler.

## The model

A wrapp registers a **routine**: an `id`, a schedule (`intervalMs`), a **tier**, and a `tick()` the
daemon calls on that interval. The daemon owns the clock and the execution; the wrapp owns only the
declaration. Autopilot is **routine #1** (daemon tier): while switched on it drafts the active company's
next moves every 30 minutes.

**A routine never sends on its own.** Every outward action it would produce (a post, an email, a
publish, a charge, a PR merge) stays an **approve-class move** through the per-action consent gate — a
human tap no headless loop can forge. A routine automates the *reversible* work up to that line and
stages the rest. Autopilot's `tick()` only ever writes a *drafted* plan; the cockpit gates every move.

## The two tiers

| | **Daemon tier** (built) | **Claude-Code tier** (next) |
|---|---|---|
| Runs on | the daemon itself | a Claude Code agent, spun up per run |
| Capability | a gated first-party `complete()` — draft/derive, storage, connector `callTool` | a full agent: multi-step reasoning, tools, **editing real code**, browsing |
| Weight | cheap, always-on, one draft per tick | heavy, launched per run, torn down after |
| Trust | small grant ("drafts while I sleep") | large grant ("builds while I sleep") |

Most routines are light — draft, decide, advance — and belong on the daemon tier. The escalation from
"drafts while I sleep" to "builds while I sleep" *is* the safety gradient. Autopilot is the daemon-tier
reference; the Claude-Code tier (a routine that edits your repo and opens a draft PR) is the named next
rung — not yet wired.

## The control plane — the menubar / OS surfaces

Background work happens when every tab is closed, so the wrapp UI doesn't exist in that moment — the
**menubar is the only surface present**. Two files, so neither side clobbers the other:

- `~/.relay/routines.json` — **STATUS**, written by the daemon each sweep. The OS **Routines** and
  **Dashboard** surfaces read it: which routines are active, per tier, and the **tokens spent while you
  were away**. Shape: `{ updatedAt, globalPaused, routines: [{ id, title, tier, active, lastRunAt,
  runs, tokens }] }`.
- `~/.relay/routines-control.json` — **CONTROL**, written by the menubar's master switch, read by the
  daemon each tick: `{ off?: bool (global kill switch), routines?: { <id>: { off?: bool } } }`.

The **shipped default is `{ off: true }`** — dormant. Nothing runs in the background until you flip the
switch in the OS Routines surface. Background autonomy must be *seen* (the spend meter) and *stoppable*
(the switch), never a hidden env flag — this retires the old `RELAY_AUTOPILOT` env var.

## Consent

Registering a routine is a distinct standing grant — "run in the background, on my Claude, doing X,
until I say stop" — not implied by a normal per-session connect. Two invariants hold under it:

- **Gated, audited completions.** A routine never owns a backend; `Broker.routineDraft()` runs the
  default backend attributed to the synthetic principal `routine@<id>` and records to the same audit
  trail every other act lands in — so background model spend is visible and honest (real usage tokens,
  never a fake number).
- **The send line never moves.** No tier may send, publish, or charge unattended, regardless of tier.
  A Claude-Code routine may *write* a PR; a human still *merges* it.

## Reference implementation (what's landed)

- `packages/sidekick/src/routines/registry.ts` — `RoutineRegistry`: a 15s master heartbeat; each routine
  fires only on its own `intervalMs`; writes `routines.json`; reads `routines-control.json` every sweep
  so a pause shows up within one heartbeat.
- `packages/sidekick/src/routines/autopilot.ts` — routine #1: reads the active company
  (`contexts.json` + the `*global*` selection), drafts today's 3 highest-leverage moves via
  `broker.routineDraft`, writes `~/.relay/storage/https_sameep.ai/autopilot-plan.json` (status
  `drafted`), returns real usage tokens. Draft only — never acts.
- `packages/sidekick/src/server.ts` — `routineDraft(routineId, prompt)`: the first-party, non-agentic,
  audited draft path (no tools, no page, no consent card — it can only produce text a human approves).
- `packages/sidekick/src/index.ts` — constructs the registry after `broker.start()`, registers
  autopilot, calls `.start()`. Dormant while the control file says `off`.

## Not yet wired (the next rungs)

- The Claude-Code tier (a routine that edits code / opens a draft PR).
- Per-routine menubar controls beyond the global switch (the OS Routines surface has the master switch;
  per-routine pause is supported in the control file but has no per-row button yet).
- Autopilot executing the *reversible* prep moves via God's hands (currently it only drafts; the
  cockpit is where a human turns a drafted move into an executed one).
