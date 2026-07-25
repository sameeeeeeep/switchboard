# Overnight brief — wrapp UX re-understanding

Branch: `overnight/wrapp-ux-audit`. Working dir for NEW work: `examples/autopilot/`.

## Hard boundaries (do not violate)

- **Never touch `examples/brandbrain-port/`.** brandbrain works; it is not in scope. The new
  autonomous-company app is a SEPARATE app, not a brandbrain mode.
- **Never touch these shared files** — a concurrent Claude session is editing them:
  `examples/apps/index.html`, `examples/apps/src/home.js`, `examples/apps/src/store/glyphs.js`,
  `examples/demo-site/*`, `docs/yc-application-composer.html`.
- **Do not commit, push, or open PRs.** Leave changes in the working tree for review.
- Write findings/docs under `examples/autopilot/`. Only edit an individual wrapp's own
  `examples/apps/src/<id>.js` / `<id>.html` when applying a specific, verified UX fix.
- Never fabricate metrics, orders, or performance numbers in any UI. Honest empty states
  ("not connected") beat invented dashboards. This is the core anti-pattern we are avoiding.

## Ground truth established 2026-07-25

- **41 wrapps** in `examples/apps/src/store/catalog.js`.
- **Harness: 68/68 PASS, 0 fail** (34 wrapps x 2 projects). Functionally green.
  So the overnight work is **UX, not bug-fixing** — do not invent breakage that isn't there.
- Re-run the harness:
  ```
  npm run build -w @relay/example-apps
  node examples/apps/harness/serve.mjs &         # port 5188
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
    --no-sandbox --virtual-time-budget=240000 --dump-dom \
    http://localhost:5188/runner.html > /tmp/runner_dom.html
  grep -oE '>(pass|fail)<' /tmp/runner_dom.html | sort | uniq -c
  ```
  Screenshot any single wrapp: `--screenshot=x.png "http://localhost:5188/h/<id>?project=switchboard"`

## The UX thesis to apply

From the founder, watching the acoco ad and reacting to two mock passes. The target pattern is
**both** passes fused, not either/or:

1. **At-a-glance cockpit** — see the whole thing in one go, multi-column, state legible without
   drilling. Nothing important buried more than one click deep.
2. **Adjustable shape** — panes split in and are drag-resizable (the Claude Code preview-pane
   pattern), not fixed columns. The user controls the ratio; close it and the main surface takes
   the window.
3. **Real, clickable artifacts** — every "locked"/"done" line opens the actual thing (the real
   name, the real ad, the real copy) plus the alternatives passed on. Never opaque text ticking by.
4. **Options + recommended, always** — the AI proposes a slate of genuinely distinct approaches,
   one marked RECOMMENDED, plus a "none of these — say what you'd do instead" escape. The human
   curates by choosing. Never single-answer autopilot.
5. **Accent colour means a human chose.** Auto-generation may draft, never lock.
6. **Autonomous ≠ opaque.** "If it were truly autonomous it would require nothing" — so measure
   every wrapp by: how many required inputs, how many clicks to first real output, how much is
   pre-filled vs blank-box.

Reference: `examples/autopilot/index.html` (the built mock — ledger / feed / drag-resizable
preview pane, Firstlight example brand).

## Workstreams

### A. Per-wrapp UX audit (41 wrapps)
For each: first-run clarity, required inputs, clicks-to-first-output, blank-box vs pre-filled,
burial depth, options+recommended present?, artifact clickability, honest empty states.
Score each 1-5 and propose the single highest-leverage fix. Record in `AUDIT.md`.

### B. Apply the top fixes
Only fixes that are (a) verified against a real screenshot, (b) inside that wrapp's own files,
(c) re-verified by the harness afterwards. Log every change in `CHANGES.md`.

### C. YC positioning
Three angles the founder named — develop each honestly, note what's true today vs aspirational:
- **Skins** — wrapps as skins over one broker/runtime.
- **Private corporate apps** — Team Mode (already shipped, flag-gated) as the wedge for
  on-prem/private deployments where data never leaves the org.
- **Cloud + tokens** — the token economy (`docs/TOKENS.md`) and hosted relay.
Write to `YC-ANGLES.md`. Do not overclaim; mark unbuilt things as unbuilt.

## State — update this every iteration

- [x] Ground truth: 41 wrapps catalogued, harness 68/68 green, branch created
- [x] Autopilot app rebuilt as the 4-column COCKPIT + drag-resizable preview pane
      (`examples/autopilot/index.html`) — this is the reference UI pattern for the catalog
- [x] A: audit pass over 34 harness-covered wrapps → `AUDIT.md`
- [ ] B: apply + verify top fixes  ← IN PROGRESS
      - [ ] `examples/apps/src/kit/ui.js` (shared atoms: optionCards / steerRow / escapeHatch
            / explicit DRAFTED-vs-LOCKED)
      - [ ] pilot on cast, aplus, adforge, adgen (each screenshot-verified)
      - [ ] re-run harness, expect 68/68 still
      - [ ] then roll the accent + escape-hatch fixes across the remaining wrapps
- [ ] B2: fix the harness false-green — `provider.js:324` `/enhanced brand content/i` shadows
      aplus's stack prompt, so aplus stage 2 is never exercised
- [ ] C: YC angles written (`YC-ANGLES.md`) — skins / private corporate via Team Mode / cloud+tokens

## Key finding (drives everything in B)

The catalog failed **four** ways copy-pasted 20+ times, not 34 bespoke ways. Central fixes only —
one edit in `kit/ui.js` beats 20 edits across wrapps. Full detail in `AUDIT.md`.

Doctrines 6 (low input) and 7 (honest empty states) are already broadly WON — do not "fix" those.
The gaps are doctrines 2 (adjustable shape: 0/34), 4 (escape hatch: 1/34), 5 (accent marks a
machine decision: ~18/34).

## Staged and ready

`/private/tmp/.../scratchpad/rollout.mjs` — the catalog-wide rollout of Fix 1 (accent follows the
human, not the model's `recommended`) and Fix 2 (the `bank.js` escape hatch, generalised), in 10
verified batches covering the 30 wrapps not in the pilot. **Fire it only once the pilot has proven
the pattern and the harness is still green.** Run with:
`Workflow({scriptPath: ".../scratchpad/rollout.mjs"})`

## Definition of done (all of it)

1. `kit/ui.js` exists and the 4 pilot wrapps are fixed + screenshot-verified
2. Harness re-run — still 68/68 (or the delta explained honestly in CHANGES.md)
3. Rollout applied across the remaining 30, with reverts reported rather than hidden
4. `provider.js` route collision fixed — aplus stage 2 genuinely exercised
5. `YC-ANGLES.md` written with an explicit honesty ledger
6. `CHANGES.md` lists every file touched, so the morning diff is reviewable

## Lesson learned — why the first pilot failed

All 4 pilot agents STALLED (180s no-progress × 6 retries) because they fired headless Chrome at a
harness server that had died, and hung forever. Their edits had already landed but were left
unverified. **Any agent that screenshots MUST**: (a) curl the server first and restart it if dead,
(b) put an explicit timeout on every Bash tool call (macOS has no `timeout` binary), (c) give up
after 2 failures, revert, and move on. This is baked into the rollout brief.

Also: the `/private/tmp/.../scratchpad/` dir does NOT survive a session restart. Workflow scripts
now auto-persist under `~/.claude/projects/.../workflows/scripts/` — use those paths to resume.

**Last iteration:** 2026-07-25 ~03:xx — kit landed; pilot rescued & verified (68/68); harness
false-green fixed; rollout + YC angles relaunched; CHANGES.md written.
**Next up:** when the rollout lands → full harness re-run → fold results into CHANGES.md → confirm
YC-ANGLES.md written. Then the work is done.
