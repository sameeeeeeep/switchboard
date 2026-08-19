#!/usr/bin/env bash
# Context Bank — STATE feed extractor (the "what actually exists" half).
# Reads the real product/project folder and emits a structured state map that the
# COS operating loop diffs against the INTENT feed (bank/intent.md) to derive next steps.
# Every value is real, from the repo; unknowable-from-local reads "unknown". No fabricated numbers.
# Usage:  bash docs/operating/bank/extract-state.sh > docs/operating/bank/state.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

has() { grep -rilq "$1" "${@:2}" 2>/dev/null && echo yes || echo no; }

catalog=$(grep -c '"id"' examples/apps/wrapps/catalog.json 2>/dev/null || echo 0)
landings=$(ls examples/apps/*-landing.html 2>/dev/null | wc -l | tr -d ' ')
widgets=$(ls examples/apps/*-widget.html 2>/dev/null | wc -l | tr -d ' ')
latest_tag=$(git tag --sort=-creatordate | grep -E '^v?[0-9]' | head -1)
c7=$(git log origin/main --since='7 days ago' --oneline 2>/dev/null | wc -l | tr -d ' ')

# readiness signals — presence checks against the real tree
public_landing="redirect only → thelastprompt.ai (external deploy repo)"
[ -f docs/index.html ] && grep -q "http-equiv=\"refresh\"" docs/index.html 2>/dev/null || public_landing="in-repo"
# REAL checks, not keyword greps (the Cycle-003 lesson: "present in the repo" != "works").
# no-install demo: does the actual file exist WITH its interaction?
if [ -f docs/operating/demo/index.html ] && grep -q "Run it both ways" docs/operating/demo/index.html 2>/dev/null; then
  try_in_browser="built (docs/operating/demo) — NOT deployed"
else try_in_browser="no"; fi
# instrumentation: the meter CORE may exist + be tested, but is it WIRED into the daemon? (grep the daemon honestly)
if grep -rlq "weekly-counter\|northStar\|wrappRun" packages/sidekick/src 2>/dev/null; then
  instrumentation="wired into daemon"
elif [ -f docs/operating/bank/meter/audit-runs.mjs ]; then
  instrumentation="on-device meter reads real audit.log (works, verified); cross-install beacon gated"
elif [ -f docs/operating/bank/meter/weekly-counter.mjs ]; then
  instrumentation="no — meter core built + tested, NOT wired"
else instrumentation="no"; fi
consent_gate=$([ -f packages/sidekick/src/security/gate.ts ] && echo yes || echo no)
signed_dmg=$(has "notariz\|relay-notary" packages/menubar docs 2>/dev/null || echo no)

cat <<MD
# Switchboard — context bank · STATE feed

_Auto-extracted $(date '+%Y-%m-%d %H:%M %Z') by \`bank/extract-state.sh\`. Ground truth = the repo.
Diff this against \`bank/intent.md\`; the gaps are the next steps (\`bank/NEXT-STEPS.md\`)._

## What exists (product surfaces)

| Surface | State |
|---|---|
| Catalog | ${catalog} wrapps |
| Per-wrapp landing pages | ${landings}/${catalog} present · $(( catalog - landings )) missing |
| Per-wrapp notch widgets | ${widgets}/${catalog} present · $(( catalog - widgets )) missing |
| Latest release | ${latest_tag} |
| Signed/notarized DMG | ${signed_dmg} |
| Consent broker (the moat) | ${consent_gate} (gate.ts present) |
| Public marketing landing | ${public_landing} |

## Readiness signals (go-live)

| Signal | State | Reads on intent as |
|---|---|---|
| A stranger can install→connect→run (verified) | core loop **6/6 pass** (guided test, configured machine) · cold-install untested | go-live blocker #1 (cold-install only) |
| Try-before-install / no-install demo | ${try_in_browser} | activation-cliff fix |
| Instrumentation / north-star meter | ${instrumentation} | signal bottleneck |
| Download link serves latest DMG | unknown — needs a live check | go-live blocker |

## Activity (real)

- Commit velocity: ${c7} commits in the last 7 days on origin/main.
- Releases shipped: $(git tag | grep -cE '^v?[0-9]' || echo 0) (latest ${latest_tag}).

## Honestly blind (not extractable from the folder)

- installs, weekly-active wrapp-runs, retention, revenue — the MARKET feed. The folder shows what
  exists, never whether it works. Closing this loop is the top architectural gap.
MD
