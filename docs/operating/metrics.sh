#!/usr/bin/env bash
# Switchboard — honest Tier-0 metrics (Analyst function, free tier).
# Every number here is derived from the real repo. Anything not truthfully knowable
# from local data is printed as "unknown — not instrumented". No fabricated numbers.
# Usage:  bash docs/operating/metrics.sh > docs/operating/METRICS.md
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

catalog=$(grep -c '"id"' examples/apps/wrapps/catalog.json 2>/dev/null || echo 0)
manifests=$(find examples -name switchboard.json 2>/dev/null | wc -l | tr -d ' ')
landings=$(ls examples/apps/*-landing.html 2>/dev/null | wc -l | tr -d ' ')
widgets=$(ls examples/apps/*-widget.html 2>/dev/null | wc -l | tr -d ' ')
c7=$(git log origin/main --since='7 days ago' --oneline 2>/dev/null | wc -l | tr -d ' ')
c30=$(git log origin/main --since='30 days ago' --oneline 2>/dev/null | wc -l | tr -d ' ')
contrib=$(git log origin/main --since='30 days ago' --format='%an' 2>/dev/null | sort -u | wc -l | tr -d ' ')
latest_tag=$(git tag --sort=-creatordate | grep -E '^v?[0-9]' | head -1)
rel_count=$(git tag | grep -cE '^v?[0-9]' || echo 0)

# Real GitHub signal. Repo = origin remote (sameeeeeeep/switchboard). Valid fields only.
repo="sameeeeeeep/switchboard"
gq() { gh repo view "$repo" --json "$1" -q ".$1" 2>/dev/null || echo "unknown"; }
stars=$(gq stargazerCount); forks=$(gq forkCount)
watch=$(gh repo view "$repo" --json watchers -q .watchers.totalCount 2>/dev/null || echo "unknown")
issues=$(gh issue list -R "$repo" --state open --limit 200 2>/dev/null | wc -l | tr -d ' ')
uviews=$(gh api "repos/$repo/traffic/views" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["uniques"])' 2>/dev/null || echo "unknown")
uclones=$(gh api "repos/$repo/traffic/clones" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["uniques"])' 2>/dev/null || echo "unknown")

cat <<MD
# Switchboard — metrics snapshot

_Generated $(date '+%Y-%m-%d %H:%M %Z') by \`docs/operating/metrics.sh\`. Honest Tier-0: real numbers
from the repo; everything else marked "unknown — not instrumented." No fabricated numbers._

## Product (real — from the repo)

| Metric | Value | Source |
|---|---|---|
| Catalog size | **${catalog}** wrapps | catalog.json ids (= ${manifests} manifests) |
| Wrapps with a landing page | ${landings} / ${catalog} | \`*-landing.html\` |
| Wrapps with a notch widget | ${widgets} / ${catalog} | \`*-widget.html\` |
| Store-surface gap | $(( catalog - landings )) missing a landing · $(( catalog - widgets )) missing a widget | derived |
| Releases shipped | ${rel_count} (latest ${latest_tag}) | git tags |
| Commit velocity | ${c7} / 7d · ${c30} / 30d | git log (origin/main) |
| Active contributors (30d) | ${contrib} | git log |

## Traction — real GitHub signal (the market feed, now ON)

| Metric | Value | Read |
|---|---|---|
| GitHub stars | ${stars} | real |
| Forks / watchers | ${forks} / ${watch} | real |
| Open issues | ${issues} | real |
| Unique repo visitors (14d) | ${uviews} | **real human reach** — the honest demand proxy |
| Unique cloners (14d) | ${uclones} | ⚠ automation-heavy (clones ≫ human views) — NOT demand |

## Still blind (needs a build or the founder)

| Metric | Value | Unblock |
|---|---|---|
| Installs / downloads | unknown — not instrumented | a distribution analytics property (founder) |
| Weekly active wrapp-runs (north star) | unknown — not instrumented | the one real build: local count + opt-in floored beacon |
| Activation / retention | unknown — not instrumented | derived once the meter is live |
| Revenue | not connected | Paddle + entity (founder) |

_The north star is currently blind. Standing up its meter is the highest-priority Analyst move —
see docs/operating-spec/FUNCTION-SUPPORT-ANALYST.md for the privacy-first plan._
MD
