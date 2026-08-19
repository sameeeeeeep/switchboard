# Switchboard — context bank · NEXT STEPS (the intent ⊖ state delta)

_Derived, not invented: for each INTENT target (`intent.md`), compare to VERIFIED STATE (`state.md`,
with unverified flags demoted), and the gap **is** the next step. This is the honest next-steps engine
the COS loop runs. Ordered by leverage. Class: **R** = reversible (autopilot may do it) · **G** = gated
(founder trigger). Nothing here is sent/deployed without a go._

> **Verification note (the Cycle-003 lesson applied):** `state.md`'s readiness flags for the no-install
> demo and instrumentation came from keyword-greps and are **unverified** — they contradict `METRICS.md`
> (north star = unknown). So D3 and D4 are treated as **open gaps** until a real check proves otherwise.
> "Present in the repo" ≠ "works."

## The delta

| # | Intended (done bar) | Verified state | Gap = next step | Owner | Class | Trigger |
|---|---|---|---|---|---|---|
| **D1** | stranger installs→connects→runs in <3 min, human-verified | **✅ core loop 6/6 pass** (guided test 2026-08-04, configured machine) — cold-install by a true stranger still open | one cold-install test on a clean machine | Support/QA | G (human) | founder / guided-cursor |
| **D2a** | landing shows true count **76** | live landing says "20+"; source of truth = 76 | edit landing 20+→76 | Growth | G (deploy) | founder (deploy-repo access) |
| **D2b** | one clear primary CTA + working download | hero ok; download link unverified | verify DMG download serves v0.3.1; tighten CTA (2 hero variants drafted) | Growth | G | founder (quick check + deploy) |
| **D3** | no-install demo delivers the "aha" | ✅ **CORRECTION: already live** — the landing ships a scripted two-ways animation (`#live`: signup/key/$19 vs consent/run). My standalone interactive demo (docs/operating/demo/) is a spare share-asset, not a gap-filler. | none — D3 is closed | — | done | — |
| **D4** | north-star meter emits a real floored weekly-active number | ✅ **on-device meter works on REAL data** (`meter/audit-runs.mjs`: 409 runs, W31 ≥170, incl. real deployed-wrapp origins) · cross-install still blind | host the opt-in floored beacon for cross-install totals | Product/Analyst | **R done (local)**; G for beacon | founder hosts endpoint |
| **KR3** | ≥5 design-partner builders ship a wrapp | 0 / unknown | build the target list + draft outreach; stage | Growth/Sales | R to draft; G to send | autopilot drafts; founder sends |
| **D5** | one launch fired (HN + X) | assets drafted (CYCLE-001), not fired | finalize assets; hold until D1+D3+D4 done | Growth | G | founder fires |
| **store** | catalog fully surfaced | 34 wrapps no landing, 33 no widget | generate missing store surfaces (verify quality, don't mass-produce blind) | Product | R (branch) | merge gated |
| **eyes** | stars/issues visible | unknown (gh unauthed) | authenticate `gh` → real Tier-0 immediately | Analyst | — | **founder (1 min)** |

## The ranked path (what the loop should do next)

1. **D1 — verify the new-user path.** Founder-owned, blocks the one-shot launch. *Nothing else is safe to fire until a stranger's happy-path is proven.* → **founder / guided-cursor**
2. **D4 — build the north-star meter.** Closes the signal blindness; reversible build; the loop stays blind without it. → autopilot builds, founder hosts + approves.
3. **D3 — verify/build the no-install demo.** The activation-cliff fix; highest-leverage *build*. → autopilot.
4. **D2 — landing truth (76) + download check.** Cheap, high-trust; needs deploy-repo access. → founder.
5. **KR3 — design-partner list + outreach.** Real leads; drafted by autopilot, sent by founder.
6. **D5 — fire one launch.** Only after 1–4. → founder.

## Two immediate founder unblocks (minutes, not builds)
- **Authenticate `gh`** → stars/issues become real now.
- **Do the D1 verify** (or authorize guided-cursor) → unblocks the entire launch sequence.

## What autopilot can do *right now*, reversibly, without any founder input
- Build the D4 meter (local counting half) and the D3 demo on a branch (merge gated).
- Draft the KR3 target list + outreach (send gated).
- Generate missing store surfaces on a branch, *verifying quality per item* (the anti-mass-produce guard).
- Harden `extract-state.sh` so D3/D4 flags are real checks, not greps.
