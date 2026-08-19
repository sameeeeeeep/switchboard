# Switchboard — metrics snapshot

_Generated 2026-08-04 17:22 IST by `docs/operating/metrics.sh`. Honest Tier-0: real numbers
from the repo; everything else marked "unknown — not instrumented." No fabricated numbers._

## Product (real — from the repo)

| Metric | Value | Source |
|---|---|---|
| Catalog size | **76** wrapps | catalog.json ids (= 76 manifests) |
| Wrapps with a landing page | 42 / 76 | `*-landing.html` |
| Wrapps with a notch widget | 43 / 76 | `*-widget.html` |
| Store-surface gap | 34 missing a landing · 33 missing a widget | derived |
| Releases shipped | 12 (latest v0.3.1) | git tags |
| Commit velocity | 99 / 7d · 244 / 30d | git log (origin/main) |
| Active contributors (30d) | 3 | git log |

## Traction — real GitHub signal (the market feed, now ON)

| Metric | Value | Read |
|---|---|---|
| GitHub stars | 1 | real |
| Forks / watchers | 0 / 0 | real |
| Open issues | 0 | real |
| Unique repo visitors (14d) | 2 | **real human reach** — the honest demand proxy |
| Unique cloners (14d) | 165 | ⚠ automation-heavy (clones ≫ human views) — NOT demand |

## Still blind (needs a build or the founder)

| Metric | Value | Unblock |
|---|---|---|
| Installs / downloads | unknown — not instrumented | a distribution analytics property (founder) |
| Weekly active wrapp-runs (north star) | unknown — not instrumented | the one real build: local count + opt-in floored beacon |
| Activation / retention | unknown — not instrumented | derived once the meter is live |
| Revenue | not connected | Paddle + entity (founder) |

_The north star is currently blind. Standing up its meter is the highest-priority Analyst move —
see docs/operating-spec/FUNCTION-SUPPORT-ANALYST.md for the privacy-first plan._
