# Press go — run the loop live against Switchboard's context bank

The grounding diff is [grounding-bank.patch](grounding-bank.patch). It makes the daemon runner ground
every draft on the **context bank** (`intent.md` + `state.md`) instead of just the company name — the
intent⊖state feed the loop should reason over. Verified: applies cleanly to
`packages/sidekick/src/autopilot/runner.ts` on `claude/autopilot-autonomous`, braces balanced. Not
`tsc`-checked here (needs the branch project) — do that on apply.

## Steps

1. **Apply the patch** on the autopilot branch (where the daemon builds):
   ```bash
   git switch claude/autopilot-autonomous
   git apply docs/operating-spec/grounding-bank.patch   # (copy the patch over if needed)
   pnpm -C packages/sidekick tsc --noEmit                # confirm it type-checks
   ```

2. **Put the bank where the daemon can read it** (survives worktree cleanup). Copy the three bank
   files to a stable dir and point the env var at it:
   ```bash
   mkdir -p ~/.relay/bank/switchboard
   cp docs/operating/bank/intent.md docs/operating/bank/state.md ~/.relay/bank/switchboard/
   export SWITCHBOARD_BANK_DIR=~/.relay/bank/switchboard
   ```
   Refresh `state.md` any time by re-running `docs/operating/bank/extract-state.sh`.

3. **Start the daemon** on your Mac with your Claude connected (your quota), the autopilot origin
   granted. `AutopilotRunner.tick()` is already registered (60s interval) — see
   [STEP2-RUN-THE-LOOP.md](STEP2-RUN-THE-LOOP.md).

4. **Seed one company + flip autopilot on** (the authorizing act). In the autopilot wrapp: seed
   `Switchboard` (kind `wrapp`), then turn autopilot ON. That sets `co.auto.on = true`; the runner
   takes over.

## What you'll see (how you know it ran)

- `co.log[]` fills with drafted beats (product/site/social/outreach), each `staged`, never sent.
- The drafts are now **grounded in the bank** — they'll reason about the 76-vs-"20+" gap, the
  activation cliff, builders-first ICP, etc., because `grounding()` is feeding them `intent.md` +
  `state.md`.
- Budget is guarded twice (venture `spent>=budget` + the daemon completion gate); outbound is
  fail-closed at the consent gate.

## The honest boundary (unchanged)

The loop **drafts** autonomously and **sends nothing** — every post/email/deploy/charge stages for
your approval. This is the first end-to-end run against a live venture (the one thing never done);
watch the first few ticks before leaving it unattended.
