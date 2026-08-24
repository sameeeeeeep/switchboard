---
name: handoff
description: Clean thread handoff. On /handoff, make the current thread end SAFELY and pass the baton — nothing stranded. Two tracks run in parallel — (A) commit + push everything in the thread, and (B) reconcile the board (mark done what's done, update statuses, re-queue/arrange, and surface + hand off the next task) — streaming each step to the notch. Use when the user types "/handoff", "hand off", "wrap this thread", "clean handoff", "close out and queue the next", or any point they want the current thread safely closed and the next one teed up.
---

# /handoff — close the thread clean, queue the next

`/handoff` ends a thread the way an operator hands off a shift: **no work stranded, the board
reconciled, the next task ready.** It is the executable form of [[adhd-pm]]'s "the ledger is sacrosanct
— reconcile before every handoff." Two tracks run **in parallel** (git and the board are independent):

Stream every step — the user is watching the notch, not the chat (`switchboard_notch` connector tool,
or `node scripts/pm-notch.mjs <kind> "<line>"`). Fire a `thread` at the start, `spec`/`decided` as each
track lands, so the handoff is *visible*.

## Track A — commit + push everything (nothing stranded)
1. `git status` in the current worktree. Uncommitted changes → commit them on the thread's branch with a
   clear, specific message (never `git add -A` blindly — review what's staged; leave build artifacts /
   `dist` out). Surface real conflicts or ambiguous changes instead of forcing.
   Stream: `notch spec "committing N files: <what>"`.
2. Push the branch (`git push`). If a PR is open, note it; if the work is complete and none is open,
   open one (base `main`). Never force-push on a handoff.
3. Confirm: working tree clean + branch pushed (+ PR link). Stream: `notch decided "thread pushed — <branch/PR>"`.

## Track B — reconcile the board + queue the next (in parallel with A)
1. `switchboard_list_tasks` — read the *real* board (don't trust memory of it).
2. **Mark the truth.** `switchboard_complete_task` (or move → done) for what this thread actually
   finished; update any in-progress card's status to match reality.
   Stream: `notch spec "board: N done, M updated"`.
3. **Re-queue / arrange.** Dedupe near-duplicates, group by epic, order by priority/status, park stale
   ideas to backlog — the board stays a readable spec, not a dump (adhd-pm §6 CURATE rule).
4. **Hand off the next.** Pick the top released card (`switchboard_next_task`), state it, and fire it to
   the notch as the baton: `notch thread "next: <task>"`.

## Finish — the baton at the notch + a chip that continues
Fire a one-line handoff summary event (what was committed/pushed + what's next). Then **drop a
continuation CHIP** (`spawn_task`) so the work actually CONTINUES: a self-contained prompt that tells a
fresh thread which card to pick up next, to run [[adhd-pm]] and turn on [[pip]], and includes the context
it needs to act without this conversation. That chip is the baton — one click starts the next thread
already streaming to the notch. Include the shipped-this-session summary + the exact next task + where
the code/app/connector live.

In **PIP mode**, also end with an **"over to you"** card (the next task + quick options + ⌥↓, carrying the
🔀 Handoff option) so the user can steer from the notch. Otherwise, a plain notch ack + a terse chat log line.

## Rules
- **Parallel by default** — kick off the commit/push and the board reconcile concurrently (background one),
  then join. The two don't depend on each other.
- **Never force-push, never fabricate a commit.** Real conflicts / ambiguous diffs get surfaced, not buried.
- **The board is the ledger** — reconcile it to reality *before* handing off, so the next thread inherits
  truth, not a stale mirror.
- **Stream liberally** — a handoff the user can't see at the notch defeats the point; each step fires an event.
- **Secrets rule holds** — never commit or echo a credential.
