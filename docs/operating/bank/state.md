# Switchboard — context bank · STATE feed

_Auto-extracted 2026-08-04 23:12 IST by `bank/extract-state.sh`. Ground truth = the repo.
Diff this against `bank/intent.md`; the gaps are the next steps (`bank/NEXT-STEPS.md`)._

## What exists (product surfaces)

| Surface | State |
|---|---|
| Catalog | 76 wrapps |
| Per-wrapp landing pages | 42/76 present · 34 missing |
| Per-wrapp notch widgets | 43/76 present · 33 missing |
| Latest release | v0.3.1 |
| Signed/notarized DMG | yes |
| Consent broker (the moat) | yes (gate.ts present) |
| Public marketing landing | redirect only → thelastprompt.ai (external deploy repo) |

## Readiness signals (go-live)

| Signal | State | Reads on intent as |
|---|---|---|
| A stranger can install→connect→run (verified) | core loop **6/6 pass** (guided test, configured machine) · cold-install untested | go-live blocker #1 (cold-install only) |
| Try-before-install / no-install demo | built (docs/operating/demo) — NOT deployed | activation-cliff fix |
| Instrumentation / north-star meter | on-device meter reads real audit.log (works, verified); cross-install beacon gated | signal bottleneck |
| Download link serves latest DMG | unknown — needs a live check | go-live blocker |

## Activity (real)

- Commit velocity: 99 commits in the last 7 days on origin/main.
- Releases shipped: 12 (latest v0.3.1).

## Honestly blind (not extractable from the folder)

- installs, weekly-active wrapp-runs, retention, revenue — the MARKET feed. The folder shows what
  exists, never whether it works. Closing this loop is the top architectural gap.
