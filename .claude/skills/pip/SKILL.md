---
name: pip
description: Enter PIP mode — the notch becomes the whole interface. A persistent, deterministic live feed of what every thread is doing streams at the notch, and EVERY decision/question/handback routes through the notch as a guru card, so the user never has to open the Claude app. Streaming is free (no model); only decisions cost a card. Use when the user types "/pip", "pip mode", "stream to the notch", "I don't want to open the app", "keep me posted at the notch", or wants ambient, always-on visibility of their threads with hands-free decision-making.
---

# /pip — the notch is the whole interface

`/pip` turns Switchboard's notch into the **complete surface** for a work session: the user watches a
live stream of what their threads are doing and answers the occasional decision — all at the notch,
**never opening the Claude app.** It is [[adhd-pm]]'s operator loop, made ambient and always-on.

Two layers, deliberately split so the always-on part is **free** (the user's hard constraint —
docs/PM-NOTCH-OPERATOR.md):

- **STREAM (deterministic, no model, always-on):** every PM event is a plain file write the notch
  renders in a rolling feed — `captured · picked · decided · spec · thread`. Watching all threads costs
  nothing.
- **GURU (model, on-demand):** every decision / question / handback is a notch card, exactly like
  [[guru]] — but now for the WHOLE session, not one reply. The user answers at the notch; nothing gets
  buried in chat.

## On `/pip` (turn it ON)

1. **Check the app is up** (`pgrep -f "MacOS/Relay"`). If down, tell the user to launch Switchboard —
   PIP mode is the notch; it needs the app. Don't fake it.
2. **Turn on the feed:** `echo '{ "active": true }' > ~/.relay/pip.json`. The notch immediately shows the
   persistent `PIP · LIVE STREAM` card. Fire one opening event so it isn't empty:
   `node scripts/pm-notch.mjs thread "<what this session is>" --source "Claude Code · <thread>"`.
3. **Adopt PIP behaviour for the rest of the session** (this is the mode — hold it until `/pip off`):
   - **Stream every move.** On each PM event, fire one — **prefer the `switchboard_notch` connector tool**
     (`{ kind, text, source, project }` — works from ANY folder), falling back to
     `node scripts/pm-notch.mjs <kind> "<one line>"` when the connector isn't wired. Kinds: `thread` when
     you start on something, `picked` when you pull a card, `captured` when you board one, `spec` when you
     tidy the board, `decided` when a fork resolves. Deterministic, so do it liberally.
   - **Always route decisions through the notch** (the [[guru]] guarantee, permanent): ANY fork,
     approval, or "which of these?" is raised as a notch `ask`/`teach` card via the [[switchboard]] skill
     — options + a spoken `say` + one ⭐recommended — and you read the pick back from
     `~/.relay/guide-result.json`. NEVER end a turn with a decision sitting in chat. Chat is only the
     written record; the notch is where the user is.
   - **Curate, don't dump** (adhd-pm §6): board writes dedupe → file under the right epic → one clean
     line. The user is watching the stream, not reading walls.
   - The chat reply becomes a terse log line; the notch carries the interaction.

## Handback — the turn NEVER ends silently (this is the point of PIP)

PIP is worthless if, when you finish, the user has to open the app to see you're done and to reply. So
in PIP mode the **handback closes at the notch**, always:

1. **Never end a turn with just a chat message.** Before handing back, raise an **"over to you"** notch
   card via the [[switchboard]] skill — a one-line status of what you just did + what's next, with quick
   options (e.g. `keep going · that's it · [something else]`) AND the `⌥↓` freeform so the user can just
   *type their next instruction at the notch*. Speak it (`say`) so they hear it land.
   **Always include a `🔀 Handoff this thread` option** that runs [[handoff]] (commit+push + reconcile the
   board + queue the next). When a lot has accumulated — uncommitted changes, many events streamed, a
   natural stopping point — make **Handoff the ⭐recommended** pick, so the user closes the thread cleanly
   and moves on with one tap. Check `git status` before the card to decide whether to recommend it.
2. **Poll for the response** (`~/.relay/guide-result.json`) — read BOTH `chosenOption` and the typed
   `feedback.note`. A typed note IS the next instruction: **continue the work from it in this same turn.**
   The conversation continues *through the notch* — the user never opens the app.
3. **Loop.** Do the thing, stream the events, then raise the next "over to you" card. Keep the loop going
   until the user picks `that's it` / says stop, or stops responding.
4. **If the poll times out** (the user stepped away), the card + the durable log (`guide-history.jsonl`)
   hold the state — recover their answer next time with [[fetch]]. Don't declare done; you're waiting.

This is the difference between PIP being a read-only ticker and being a real hands-free loop: progress
streams out, and every "your move" comes back in — all at the notch.

## At the notch — dismiss + per-thread filter (two one-tap controls on the feed)

The feed card carries its own controls, so the user steers it without touching the terminal:

- **Dismiss (✕, top-right):** hides the whole feed. It writes `~/.relay/pip.json` `active:false` (the same
  as `/pip off`), so it's **reversible** — `/pip` brings it back. Use this when the user says "close the
  feed" / "hide it" but keeps working.
- **Thread filter (the colour dots):** with two or more threads streaming, a row of per-thread colour dots
  appears under the PIP badge (plus an "all" dot). Tapping a thread's dot filters the feed to **only that
  source**; tapping it again — or the "all" dot — clears back to every thread. If the selected thread has
  gone quiet (nothing left in the rolling buffer) the card shows **THREAD QUIET · waiting for <thread>**
  and keeps the filter pinned, so its next event surfaces there. Deterministic — no model, no cost.

## On `/pip off` (turn it OFF)

`echo '{ "active": false }' > ~/.relay/pip.json` (or `rm -f ~/.relay/pip.json`), or just tap the feed's
**✕** at the notch — both write `active:false`. The feed clears and the notch goes quiet. Confirm in one
line. Revert to normal adhd-pm (decisions still route to the notch per §0, but the always-on stream stops).

## Rules

- **The stream is free; keep it flowing.** Every meaningful move fires an event — that's the whole point
  (the user is watching threads, not asking for status). It's a file write, never a model call.
- **Every decision is a card, no exceptions.** In PIP mode there is no "just answer in chat" — the user
  isn't looking at chat. If a run gets clobbered, recover the answer with [[fetch]] (the durable log).
- **Deterministic ≠ silent.** The user must always be able to see what happened: the stream shows it, the
  board records it. No silent action.
- **Secrets rule holds** ([[switchboard]]): never place a credential on the notch or ask the user to type
  one into it.
- Multiple threads can stream at once — each `--source` gets its own colour dot in the feed, so the user
  tells them apart. This is the "PIP tabs on my threads" view.
