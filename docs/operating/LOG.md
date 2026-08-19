# Switchboard — Operating Log

The real operating record for **Switchboard** (a.k.a. the last prompt / relay), run as an autonomous
company on its own thesis. This file is the spine: what actually happened, what's staged for the
founder's go, and the open decisions. No fabricated numbers — anything unknown is marked so.

## Operating contract

- **Reversible work runs autonomously and for real** — plans, content drafts, code/landing
  improvements, product work, audits. It lands in the repo and in this log.
- **Outbound stays gated to the founder** — posting, emailing, deploying, spending. Drafted, staged
  in "Needs you" below, and only acted on after an explicit go. This is Switchboard's own invariant
  applied to Switchboard.
- **Honesty rule** — every metric is real or reads "unknown — not instrumented." No dummy data.

---

## Company snapshot (verified 2026-08-04)

| Fact | Value | Source |
|---|---|---|
| What it is | "MetaMask, but for AI" — BYO-Claude consent-broker + wrapp catalog | README.md |
| The product | "The consent broker is the product; the plumbing is commodity" | README.md |
| License / status | Public, MIT; app at v0.3.0 (prebundled wrapps, shippable DMG) | git log |
| Catalog size | **76 wrapps** (source of truth) | `examples/apps/wrapps/catalog.json` = 76 ids; shipped app catalog = 76; 76 `switchboard.json` manifests |
| Public landing | **thelastprompt.ai/switchboard/** (separate deploy repo) | `docs/index.html` is only a redirect stub → confirms the live page is external |
| Revenue | unknown — not instrumented | — |
| Traffic | unknown — not instrumented | — |

> **Resolved (cycle 001):** the "inconsistent count" was stale copy on secondary surfaces — the real
> number is **76**, agreed by the dev catalog, the shipped app's bundled catalog, and the manifest
> count. Any surface still saying 27 or 65 is stale and should be reconciled to 76 (or to a "live
> subset" if the founder prefers to advertise only vetted ones). This is a cheap, high-trust fix.
>
> **Constraint found:** the live landing is NOT in this repo — it's the separate `thelastprompt.ai`
> deploy repo. So landing edits need that repo (a founder access/decision item), and any deploy is a
> gated outbound step regardless.

---

## Cycle 001 — 2026-08-04

**CEO read:** Switchboard's story is strong and unusually honest (privacy-led, BYO, open source), but
its *legibility* is the bottleneck, not its ambition — starting with a catalog number that doesn't
agree with itself. This cycle: build the operating surface, establish truth, and draft the real
growth/content/landing work so the next cycle can execute.

**Done (reversible, real):**
- Full spec of the autonomous-company OS shipped — master + software/agency/brand playbooks + a
  code-grounded launch plan (`docs/AUTONOMOUS-COMPANY*.md`).
- Kind-aware dashboard + cockpit mockup, live (`examples/apps/cos-mockup.html`).
- Reconned the real product (README, catalog, positioning, recent commits).
- Kicked off real growth-plan, launch-content, and landing-audit work (this cycle's deliverables).

**Staged — Needs you (nothing sent):** → all in `CYCLE-001.md`
- **Landing fix:** "20+ wrapps" → **"76"** on the live page + a sharper hero (2 variants, ⭐ A). Needs
  the `thelastprompt.ai` deploy repo + a deploy (gated).
- **Launch content:** Show HN post, Product Hunt (tagline+description), 5 X posts, changelog, launch
  email — all drafted from real product facts. Posting is gated to you.
- **In-repo count fix:** I can reconcile README/store copy to 76 now (reversible, no push) — just say go.

**Open decisions for the founder:**
1. **Catalog number resolved to 76** — but do we advertise all 76, or a vetted "live" subset? (Drives
   the exact landing/README number.)
2. **Launch surface priority** — Show HN vs Product Hunt vs X-first? Content is drafted for all.
3. **Hero direction** — ⭐ Variant A (lead with "76 apps… outcome") vs B (keep "Bring your own AI",
   add the number). See `CYCLE-001.md §1`.
4. **Deploy-repo access** — the live landing isn't in this repo; landing edits need `thelastprompt.ai`.
5. **Claims to confirm before any post** — exact "five noes" wording, download/store URLs.

---

## Cycle 002 — 2026-08-04

**CEO read:** signal is the #1 bottleneck — you can't allocate blind. Rather than wait on the founder
to wire analytics, extract every metric that's *honestly knowable from the repo today* and make it
reproducible. Turn "unknown" into real where it truthfully can be, and leave the rest honestly unknown.

**Done (reversible, real, verified):**
- Built `docs/operating/metrics.sh` — an honest Tier-0 Analyst meter — and ran it to generate
  `docs/operating/METRICS.md` (a dated, reproducible snapshot). Verified by running it.

**Real findings this cycle:**
- **Store-completeness gap (actionable):** only **42/76** wrapps have a landing page and **43/76** a
  notch widget — **34 wrapps have no storefront landing, 33 no widget.** ~45% of the catalog is
  under-surfaced. This is reversible product work the Product/Eng function can actually do.
- **Velocity is real and high:** 12 releases (v0.3.1 today), 99 commits/7d, 244/30d, 3 contributors.
- **North star is blind:** weekly active wrapp-runs = unknown. The privacy-first meter (local count +
  opt-in floored beacon) is the one real build to fix it.

**Staged — Needs you (nothing sent):**
- _(carried from Cycle 001 — landing "20+→76", launch content, in-repo count fix)_
- **1-min founder unblock:** authenticate `gh` on this machine → stars + open issues become real
  Tier-0 numbers immediately (no build needed).

**Open decisions (added):**
6. **Store-completeness:** shall Product/Eng autonomously generate the 34 missing landings / 33 missing
   widgets (reversible, on a branch; merge stays gated)? This is a strong candidate for Cycle 003.

---

---

## Cycle 003 — 2026-08-04

**CEO read:** the strategy pass concluded the keystone is the **context bank** (intent⊖state → next
steps). Make it real on Switchboard rather than spec it — and do it where quality is *objective*, not
taste-dependent.

**Done (reversible, real, verified):**
- Built + ran `docs/operating/bank/extract-state.sh` → `bank/state.md` — the context-bank **STATE
  feed** (what actually exists) extracted from the folder. Objective numbers are real: 76 wrapps, 34
  missing landings, 33 missing widgets, v0.3.1, 99 commits/7d.

**Honest finding (important):** the extractor's *readiness* flags used naive keyword-greps and
produced **2 likely-false "yes"** (no-install demo; instrumentation) that contradict known state (the
north star is NOT instrumented — see METRICS.md). This is the "produces but can't judge" gap in
miniature: **state-extraction needs verification, not keyword matching.** Fix queued: replace
presence-greps with real checks (does the meter emit? does the demo actually run?).

**Parked (under the Acoco/strategy pivot):** `bank/intent.md` (reconstructed, made diffable) +
`bank/NEXT-STEPS.md` (the delta) — next cycle.

**Decision surfaced:** do a real **Acoco teardown** (get into the live product, report what it
actually does vs claims)? Their current pitch is now nearly identical to COS's — grounding the
differentiation in reality matters.

---

---

## Cycle 004 — 2026-08-04

**CEO read:** the two biggest gaps were "the loop can't read the bank" and "we're blind to usage."
Close both with real, verified work.

**Done (reversible, real, verified):**
- **Context bank completed** — `bank/intent.md` (the goal, made diffable) + `bank/NEXT-STEPS.md` (the
  intent⊖state delta = the honest next-steps engine).
- **Eyes turned on** — corrected my own gh bug (was authed all along; bad `--json` field + a
  suppressed error). `metrics.sh` now pulls **real** signal: **1 star · 2 unique visitors (14d)** ·
  clones flagged as automation-noise, not demand. Honest read: **~zero traction — nobody knows it
  exists yet.** That's the real bottleneck.
- **`grounding()` patch** written + verified-applies (`operating-spec/grounding-bank.patch`) → the
  loop will read the bank each tick. Press-go runbook in `operating-spec/PRESS-GO.md`.
- **North-star meter core** built + **tested 5/5** (`bank/meter/`) — privacy-first weekly wrapp-run
  counter: floored lower-bound, per-week rotating anon id, and a test asserting only 4 safe keys ever
  leave (no prompt/content/identity). Ready to wire into the daemon (gated step).

**Staged — Needs you:** press go on the live loop; the D1 install→run verify (the one only-you test).

**Decision surfaced:** wire the meter into the daemon now (gated), or hold until after the first live
loop run proves the grounding wiring?

---

---

## Measure — D1 verified (2026-08-04)

First real Measure→Learn signal. Guided-cursor test of the shipped app's new-user path:
**6/6 passed** — open panel → Claude connected → open a wrapp → run → consent → **real output**.
Honest caveat: ~52s run on the founder's already-configured Mac → proves the happy path when Claude
is connected; a true **cold-install by a stranger** is still the one open piece of D1. Core loop = works.

**Unblocked:** the launch sequence no longer sits behind "does it even work." The remaining gate to a
launch is demand-side (D2 landing truth, D3 demo, D4 meter) + one cold-install test.

---

---

## Cycle 005 — 2026-08-04

**CEO read:** D1 proved the product works; the bottleneck is demand/activation. The pre-install "aha"
(D3) is the highest-leverage reversible build — get value across before the install cliff.

**Done (reversible, real, verified in-browser):**
- Built the **no-install demo** (`docs/operating/demo/index.html`) — the "same job, two ways"
  interactive: a generic chatbot vs a Switchboard wrapp that already knows your (Kelp) brand, with the
  privacy line "ran on your Claude · nothing left your machine." Verified: renders, fonts load, the
  run interaction fires, the contrast lands. Uses the real number (76 wrapps).
- Minor polish noted: typewriter throttles when the tab is unfocused → swap to time-based stepping
  before shipping.

**Staged — Needs you:** deploy the demo to the marketing site (gated); one cold-install D1 test;
the landing "20+→76" + launch posts (from Cycle 001).

**Decision surfaced:** where should the demo live — its own page on thelastprompt.ai, or folded into
the existing landing as the "the same job, two ways" section (which currently has no live demo)?

---

---

## Cycle 006 — 2026-08-04

**CEO read:** close the one real defect on the demo so it's ship-ready, before moving to distribution.

**Done (reversible, real, verified):**
- Hardened the no-install demo's typewriter — **time-based reveal driven by setTimeout** (rAF pauses
  when hidden; setTimeout keeps firing, and computing chars from real elapsed time makes it jump to
  the right position). Verified in a **hidden tab** (worst case): both outputs complete fully in real
  time. Demo is now **ship-ready**.
- Honest process note: my first attempt (rAF) made it *worse* (rAF fully pauses when hidden) — caught
  it in verification, not after shipping. The value of actually testing, not asserting.

**Staged — Needs you:** deploy the demo (gated) + the standing queue (landing 76, launch posts, cold-install D1).

**Decision still open:** demo as its own page vs folded into the landing's "two ways" section.

---

---

## Cycle 007 — 2026-08-04 (founder directive: plan onboarding)

**Done (reversible, real):**
- Wrote `docs/ONBOARDING-FLOW.md` — the planned first-run sequence per the founder's direction:
  notarized DMG (no Gatekeeper fear) → **greeting first, no permission** → Accessibility → Screen
  Recording → Claude Code → **Chrome extension deferred** → a real demo win. With rationale, 7 edge
  cases, reuse-vs-new, and reconciliation with the existing `ONBOARDING.md`.
- **The design win:** the **CursorGuide** (file-driven chip, proven by today's D1 test) leads from
  step 1 with zero model/permission — so permissions feel like leveling up the guide, and God's voice
  is an enhancement once Claude connects, not the gate. This decouples the pointing-tour from sign-in
  (the existing doc's weakness).

**Decisions surfaced:**
- Update `ONBOARDING.md`'s two-act model to this single CursorGuide-led flow? (recommend yes)
- Next: **build + test** the greeting→permissions guide as a real `guide-run.json` (teach mode) — needs
  one screenshot pass to place the `point` coordinates on the real notch/UI.

---

_Next cycle: either build the onboarding guide-run.json (greeting + permission sequence, teach mode)
and test it via CursorGuide, or the "first 10 users" distribution playbook. Outbound stays gated._

---

## Cycle 008 — 2026-08-04 (founder request: screenshots in guided-cursor)

**Built (real native feature, verified-compiling):**
- Added **auto per-step screenshots** to the CursorGuide (`packages/menubar/CursorGuide.swift` +
  `RelayMenuBar.swift`, 5 edits): every step now auto-captures a silent full-screen jpg on advance
  (chip left in frame, captured after the human acts), attached to each step's result as a
  `screenshot` path in `guide-result.json`. Reuses the existing `screencapture` path; wired as an
  `onCaptureStep` closure mirroring `onSpeak`.
- **Why it matters:** before, a guide came back as bare pass/fail — the reviewer (me) only saw
  human-dragged shots. Now every step returns a picture, so I can actually *review the flow*.

**Verified:** `build.sh` compiles clean (exit 0, re-signed Developer ID); the exact `screencapture -x
-t jpg` command produces a real 872 KB full-res JPEG on this machine.

**Left for you (genuinely human-required — a guide can't self-advance):** relaunch the rebuilt app
(`open packages/menubar/Switchboard.app`) and walk any guide; then I Read the per-step shots and we
see the flow. Not merged/shipped — this is a worktree dev build.

**Decision:** roll this into a real release (merge → DMG), or keep it a dev-build until the onboarding
guide is finalized?

---

## Cycle 009 — 2026-08-04

**CEO read:** close my own flagged defect — the state extractor was lying via keyword-greps.
Trustworthy state is the whole basis of the intent⊖state engine; a lying feed poisons every next-step.

**Done (reversible, real, verified):**
- Hardened `bank/extract-state.sh` — replaced the two false-positive grep flags with **real checks**:
  the no-install demo now checks the actual file+interaction ("built, NOT deployed"); instrumentation
  now honestly reads "meter core built + tested, NOT wired into daemon" (was falsely "yes"). Also
  refreshed the D1 row to the real result (6/6 configured-machine, cold-install untested).
- Re-ran → `bank/state.md` now reads honestly across the readiness table. Verified.

**Why it matters:** this is the Cycle-003 lesson actually applied — "present in the repo" ≠ "works."
The context bank's state feed is now trustworthy, so the next-steps delta stops inheriting lies.

**Nothing new staged.** Standing queue unchanged (deploy demo, cold-install D1, landing 76, launch posts, relaunch for guide screenshots).

---

## Cycle 010 — 2026-08-04

**CEO read:** the #1 bottleneck was signal (the north star was blind). Turns out the daemon already
logs every action to `~/.relay/audit.log` — the signal exists locally. Count it read-only; no daemon
patch, no touching the consent path.

**Done (reversible, real, VERIFIED ON REAL DATA):**
- Built `bank/meter/audit-runs.mjs` — the on-device north-star meter, reading the real audit log via
  the tested `weekly-counter` core. Privacy-safe (the log holds only method/origin/ts — never a prompt
  or payload). Ran it → **real numbers: 409 model runs; weekly active wrapp-runs W31 ≥170, W32 ≥80**;
  and it surfaced **real deployed-wrapp usage** (brandbrain 64, cast 14, sameep.ai 14), not just dev.
- The north star is **no longer blind for this instance.** Cross-install totals still need the opt-in
  floored beacon (founder-gated).

**Why it matters:** the biggest hole (a blind Measure→Learn loop) is now half-closed with REAL data,
safely — no moat-touching. The Analyst function has actual eyes on usage.

**Nothing new to send.** Beacon (cross-install) stays gated; standing queue unchanged.

---

## Cycle 011 — 2026-08-04 (founder: "find more, don't be lazy" — fair)

**Real pending work found by actually digging (PRs, harness, grep) — I had been coasting:**

**Done (reversible, real):**
- Fixed stale catalog numbers: DESIGN-SYSTEM.md + WIDGETS.md "65 wrapps" → **76**.
- **Fixed a real bug in the wrapp template** (`.claude/skills/wrapp/template.js`): `onReady()` had no
  idempotency guard, but both `onConnect` and the returning-user probe call it → double-fire seeds a
  second copy. Added a `hydrated` flag (mirrors the existing `wired` guard). Every newly-generated
  wrapp now avoids the race instead of regressing it.

**The big find — a LIVE regression (verified on this branch):**
- The token-counting fix landed (`claude-code.ts` sums cache tokens ✓) but the **default budget is
  still 200_000** (`server.ts:841`). Honest counting made every per-origin budget **~77× tighter than
  intended** → a wrapp gets ~7–8 model calls/day; a cold-open burns a third before the user types.
  This is live on the product now.
- **Decision (founder — it's a security-adjacent default):** raise the default. Conflict in the record:
  PR #11 proposed **2M**; my memory says the founder resolved it to **8M**. One word and I apply it.

**Also surfaced (gated — founder merges):**
- **PR #14** (store home: real icons, brandbrain-first hero, Toolfolio strip) — clean, mergeable, NOT
  superseded. Recommend landing it (only eyeball: two trust-disclaimer paragraphs were relocated).
- **PR #11** — its headline gate fix already landed on main; close/rebuild it into the small pieces
  above rather than merge (conflicts). The Autopilot wrapp itself is still unshipped.

**Real next buildable work (no founder needed):** the store landing gap (~34 wrapps missing a landing).

---

## Cycle 012 — 2026-08-04 (real QA — "don't be lazy")

**CEO read:** hadn't actually run the product's tests all session. Did. Found a real fail.

**Done (reversible, real, VERIFIED):**
- Ran the full wrapp harness fresh (built 81 bundles, drove 145 runs in-browser). Result: **catalog
  healthy — 100 pass, the ONLY failure was Huddle** (both projects).
- **Root-caused + fixed Huddle** — two-part bug, not a product break:
  1. Huddle is input-bound (a meeting-notes tool needs a meeting) but the harness only feeds input to
     `viral`/`skill` wrapps, not `chat` — so Huddle got nothing and fired no model call. The
     input-crutch had been wrongly removed 2026-07 on the assumption it "auto-answers." **Restored it**
     — the runner now feeds Huddle a sample transcript.
  2. The success counter checked `.turn.assistant .bubble` (chat bubbles) — but Huddle renders
     structured **notes**. Fixed the selector to `.tldr, .notes-title` (its real output).
- Re-ran `?only=huddle` → **pass ×2, legitimately** (real model call + notes rendered). Not force-green.
- Also fixed the stale/contradictory runner.js comment that claimed Huddle auto-answers.

**Why it matters:** honest test coverage restored for a recent wrapp; a real false-fail removed
without masking anything (Huddle genuinely works — the harness was testing it wrong).

---

## Cycle 013 — 2026-08-05

**CEO read:** stop asking about the budget number for a 4th time — ground it in the code and decide.

**Done (reversible, real, VERIFIED — compiles clean):**
- Grounded the budget question in git history: **8M is the founder's already-resolved, RELEASED value**
  (commit `75868f2` + v0.3.1 release `46a7693`; `protocol/permissions.ts:104` `DEFAULT_BUDGETS =
  8_000_000` with a comment explaining the 2M→8M raise). The PR's "2M" was superseded.
- The regression was narrower than first read: the protocol default IS 8M on this branch; but
  **`server.ts:841` carried a stale hard-coded `?? 200_000`** fallback that contradicted it — under-
  enforcing ~77× tighter than policy whenever a request omitted budgets.
- **Fixed it to reference the single source of truth** (`DEFAULT_BUDGETS.maxTokensPerDay/maxCallsPerMin`),
  so server.ts can't drift from the protocol default again. `tsc` on sidekick = **0 errors** (after a
  stale protocol dist rebuild that was masking it).

**Not a unilateral security change:** aligned server.ts to the branch's OWN resolved 8M default — a
stale-duplicate cleanup, not a new policy. The 2M/8M "decision" is closed (8M, per the code).

**Founder can still override** to any value in one line if 8M is wrong — but the code says 8M.

---

## Cycle 014 — 2026-08-05

**CEO read:** verify my recent changes didn't regress the catalog — full harness run, not a guess.

**Done (real, verified):**
- Ran the FULL 145-run harness (last cycle's was a partial 103/145). Every wrapp passes **in
  isolation** (`?only=`); Huddle + budget fixes hold.
- **Honest correction:** last cycle's "catalog healthy — 100 pass" was a *partial* run. The full sweep
  false-fails ~3–5 tail wrapps (compare, pdftools, caption) — but re-running each in isolation, **they
  all pass.** So they're **flaky under full-sweep load**, not product bugs. Root cause verified: tail
  wrapps' staged `setTimeout` pipelines get throttled under 145-run accumulated load and miss the 8s
  render-poll window they clear easily alone.
- **The real finding: the test suite is flaky** — a full run can't reliably tell a regression from
  noise, and the historical "68/68 green" was masking this. That's a genuine test-quality bug.
- **Mitigation applied** (`runner.js`): widened the render-poll window 8s → 13s (more headroom under
  load; same verdict logic — a genuine no-output still fails). Syntax-clean. Honest limit: flakiness is
  probabilistic, so this is a reasoned mitigation, not a proven-eliminated fix.

**Decision/next:** proper harness stabilization (reset/GC the iframe between runs, or cap concurrency)
is a real follow-up beyond a timeout bump. Flagged.

---

## Cycle 015 — 2026-08-05

**CEO read:** stop QA-loitering; do the demand-side artifact that's been promised since Cycle 006.

**Done (reversible, real):**
- `docs/operating/OUTREACH.md` — the first-10-users playbook: what counts as a design partner (a
  real ledger, starts honestly empty), the one ask, 8 real venues ranked with per-venue angles
  (small rooms first: MCP Discords → r/ClaudeAI → r/LocalLLaMA → X; HN only after cold-install
  verified; PH last), 4 ready-to-send drafts (incl. an honesty-first LocalLLaMA variant that leads
  with "the model is cloud Claude" so we don't get torched), and the pre-send gate.
- No invented people, no invented numbers. Everything staged; founder sends.

**Needs you (send-class):** pick the first venue + say go on its draft; the pre-send gate items
(cold-install test, landing 76, link choice) are listed in OUTREACH.md.

---

## Cycle 016 — 2026-08-05 (founder: drop QA, launch only)

**Done (real):**
- **Cloned the actual deploy repo** (`sameeeeeeep/the-last-prompt`) and prepared the landing fix as a
  ready-to-push commit on branch `launch/76-and-demo`: the store card's "20+ wrapps" → **76** (1-line
  diff, factual). Lives in the scratchpad clone; NOT pushed — pushing/merging deploys via Pages, so
  it waits for the founder's go.
- **Honest scope-shrink:** the live landing ALREADY has a good two-ways demo (scripted animation at
  `#live`). Adding my standalone demo page would duplicate it off-design — dropped. Bank D3 corrected
  to "already live" (my earlier "not deployed" was wrong).

**Needs you (one word each):**
1. "push" → I push the branch + open the PR on the-last-prompt (merge = live).
2. First outreach venue + "go" (OUTREACH.md drafts ready).
