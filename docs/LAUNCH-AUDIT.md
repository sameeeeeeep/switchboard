# Launch audit — ledger (2026-09-05, wrapped mid-loop for handoff)

The running launch-readiness audit. What was checked, what was fixed, what's pending. Pick up here.

## Fixed & shipped (pushed to main unless noted)

- **Store — anti-sell removed.** The "What's next · not built yet — Your files, given a face" section
  is gone from `examples/apps/index.html` (never "not built yet" on a store page). `7f740d6`
- **Store — insider placeholder.** What's-next bar: "…ads for Aamras" → "…ads for my brand". `7f740d6`
- **Onboarding — senses order.** Accessibility → Mic → Screen (spec §11: the hand first, then the ear so
  the user can speak back). `7f740d6`
- **Onboarding — "Your first wrapp: God's cat" beat (beat 4).** The cat is switched on as the tour
  starts, so it's on screen by the beat; the beat names it, shows drag/right-click, points at
  Settings › Wrapps as where wrapps are added/removed. `7f740d6`
- **Interactive cat** (drag, right-click menu, standoff from the cursor, throw + bounce) `f2fd992`;
  **removable WRAPPS list** (Notch/God/Flow/cat toggles) `3d877e0`; **direction + landing doc** `49480f8`.

## Committed locally, NOT built, NOT pushed — verify first (`803df56`)

- `openWrappWindow` now emits a `"wrapp-opened"` guide event (the one choke point every wrapp open
  passes through), and onboarding beat 3b (dictate into the launcher) gates its success on
  `wrapp-opened` instead of `dictation` — so the first win = Brand Brain actually opened.
- Needs: `packages/menubar/build.sh` → Developer-ID re-sign (build.sh can fall back to AD-HOC when the
  timestamp server is down — that RESETS TCC grants; re-sign with `--timestamp=none` if needed) →
  deploy → `git push`. Reject = `git reset --hard origin/main` (nothing else is in that commit).

## Store — the 95-wrapp classification (facts)

- **41 local wrapps are real** (call the AI via `window.claude` or the shared kit/SDK).
- **23 local wrapps have no AI wiring — and most are meant to** (on-device utilities: convert, resize,
  qr, barcode, favicon, palette, contrast, encoder, svgmin, textdiff, timecalc, typeunits, unit,
  wordcount, metatags, pdftools, emboss, color, placeholder, base, canvas, huddle, clone). Honest, not
  broken. Worth a look: huddle, canvas, base (are they finished demos?); clone talks to :7897 directly.
- **Remote subdomains (HTTP-verified):** 18/20 live. **DOWN: `prism` and `ideafetch`** → must be
  badged "under development" or fixed. All 6 brandbrain studio variants (capp/feature/hardware/mkt/
  retail/saas → `brandbrain…/build?stud…`) resolve 200.
- **`autopilot`**: in the catalog with skills, but **no launchable `components.ui`** (it lives in
  `examples/autopilot`) — the store can't open it; needs a `ui` or a status.
- **`hn`, `websearch`**: tool-only (`surfaces:["tool"]`, no UI) — must never render as launchable.
- The store grid is **static HTML (32 `a.card[data-app]`, a curated subset)**, not rendered from the
  95-entry catalog; `#hero-count` renders from the in-page `APPS.length` (the "27" in HTML is only the
  SSR default) — honest for what's shown. There is **no status/badge mechanism yet**.

## Onboarding — spec vs built

- Built = the 7-beat spine (ignition grid → inhale → welcome → card-home → connect → senses → ⌥⌥ →
  dictate-into-launcher → ⌃⌃ → first-wrapp → done). Ignition + Skip + God-voice pre-cache all present.
- Still open: the **hand-off** (spec Frame 3: God recedes into the notch, "this is yours now") is text
  only; **custom cards + second-order effects** (skip/deny/re-onboard/offline states per spec §6–§7)
  need a pass; verify the `wrapp-opened` gate end-to-end on a real first run.

## Landing — critical finding

The **live page is newer than the branch source** the memories point at. Live `thelastprompt.ai/
switchboard` = h1 "The operator for your AI setup", sections diff/setup/power/apps/how/private/devs/
pricing/faq, "94 wrapps. All free.", "God, Guru — your AI, hands-free." The stale
`docs/landing-redesign.html` copy was deleted. **Edit the live source in
`~/Documents/Projects/the-last-prompt/switchboard/`** (clean checkout, `main...origin/main`), per the
improvements in `docs/DIRECTION-AND-LANDING.md` §5 (assembly hero, real Team Mode captures, God's cat
as the charm beat, the WRAPPS list as proof, founders+agencies band).

## Pending (not started)

1. "Under development" badge mechanism in the store (a `.dev` chip + `data-status`) → apply to prism,
   ideafetch; give autopilot a UI or a status; hide hn/websearch from the launchable grid.
2. Content plan + first 3 posts + a launch video script (`docs/LAUNCH-CONTENT.md`) — from shipped facts.
3. Landing v2 in the live repo (§5 of the direction doc), then deploy (`git push` in the-last-prompt).
4. Build/verify/deploy `803df56`; the onboarding second-order pass; the hand-off beat.
5. Board reminder (due today): *post about the interactive God's cat.*
