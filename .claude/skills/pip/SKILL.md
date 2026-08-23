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

## On `/pip off` (turn it OFF)

`echo '{ "active": false }' > ~/.relay/pip.json` (or `rm -f ~/.relay/pip.json`). The feed clears and the
notch goes quiet. Confirm in one line. Revert to normal adhd-pm (decisions still route to the notch per
§0, but the always-on stream stops).

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
