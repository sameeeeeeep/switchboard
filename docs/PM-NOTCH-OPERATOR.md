# adhd-pm as a live, notch-routed operator

Status: spec (2026-08-23). Founder ask: *"we made the notch interactive with feedback via /task — need
that with EVERYTHING in adhd-pm mode: picking up tasks, regular convs, starting a new thread. Route it
all through the board/notch so the spec keeps getting updated and it FEELS like the PM is working
visibly, in tandem with the notch. When adding a task, add it so it makes sense — check what's already
there and arrange it properly."*

## The thesis

Today the notch reacts to exactly ONE PM action — `/task` fires a "Task captured" ack (the
`guide-notify.json` watcher, [[GUIDE-QUEUE-RESUME]]). Everything else in adhd-pm mode happens *silently
in chat*: tasks get appended (often as walls, not clean cards), picked up with no visible signal, the
board slowly rots into a dump.

The ask is to make adhd-pm a **visible operator**: every meaningful PM event both (a) **surfaces at the
notch** as it happens, and (b) **curates the board** — deduped, filed under the right epic, written as
one clean line, the whole thing kept coherent as a living spec. The board is the spec; the notch is the
operator working it where the founder can see, in tandem.

This is not a new subsystem — it's the notch-notify substrate (already shipped) applied to the whole PM
loop, plus a board that curates instead of appends.

## The split that makes it cheap: deterministic STREAM vs on-demand DECISION

Founder constraint (2026-08-24): the always-on part *cannot* burn credits or touch performance — it must
be **deterministic**, unlike the notch option cards (which reason with a model). This isn't a tradeoff;
the architecture already separates the two layers:

- **The STREAM (deterministic, free, always-on).** Every PM event is a plain `guide-notify.json` /
  event-log file write — *no model, no cost, no perf hit*. The notch renders it. This is the ambient
  layer: a rolling feed of what every thread is doing.
- **The DECISION (model, on-demand).** An option/ask card is raised only when a real decision or question
  needs the human — the expensive layer, and only when needed.

So "keep a tab on all my threads" costs nothing; "answer this fork" costs a card, only when it happens.

### PIP mode — a persistent multi-thread feed
A toggleable notch surface that shows the **rolling event stream across threads** (not a 3s toast that
vanishes) — "picture-in-picture tabs on my threads." The founder keeps it up to *watch* the operators
work; decisions still interrupt as cards when needed. Fed by the same deterministic event writes; renders
the last N events (per-thread coloured, like the guide card's per-thread dot). Zero model in the loop.

### Feedback when the HUMAN acts on the notch (today: none)
Picking an option / advancing a card gives no on-notch confirmation — it just closes. Every human notch
action must leave an immediate deterministic ack ("✓ Got it — running with <choice>") so the founder
*feels* the notch registered them, not just Claude's events.

## Two mechanisms

### 1 · Notch presence on EVERY pm event (not just /task)

A single thin helper any Claude thread calls, `pm-notch <kind> "<text>"`, which writes
`~/.relay/guide-notify.json` (the app already renders + auto-dismisses it). The adhd-pm loop fires it on
each event so the founder *sees* the operator move:

| Event | notch kind | example |
|---|---|---|
| task captured | `captured` | ✓ Captured → board · "clean up the toast UI" |
| task picked up | `picked` | ▸ Working · "seed launcher keywords" |
| decision raised | (existing ask card) | the guru/ask card at the notch |
| decision resolved | `decided` | ✓ Decided · "harvest contrast first" |
| board curated | `spec` | ⟳ Board tidied · 3 merged, 2 refiled |
| new thread started | `thread` | ◆ New thread · "notch-operator spec" |

`kind` maps to the notch card's kicker + accent (already in `notifyCard`: captured/resume/info; add
`picked`/`decided`/`spec`/`thread`). Suppressed during an active guided run (the notch belongs to the
run); auto-dismisses otherwise.

**Where it lives:** a `pm-notch` script under the connector/skills so it's callable from any thread; the
connector's task tools (`switchboard_add_task` already fires; extend `move_task`/`complete_task`) fire it
automatically, and the adhd-pm skill fires the conversational ones (decided/thread/spec).

### 2 · The board CURATES, not appends (the "not a dump" rule)

Adding a task becomes a curation step, not an append:

1. **Read the board first.** Near-duplicate of an existing card → merge into it (append a note/subtask),
   don't add a second. This kills the drift the founder flagged.
2. **File it right.** Infer the epic/list from content + the epics already in use
   (third-party-tools · notch-surfaces · nonai-tools · launcher-routing · landing-treg · capture · …).
   New theme → a new named epic, not the Inbox junk drawer.
3. **Write it clean.** One imperative line of intent + a tight *why* + at most a couple of spec lines —
   never the wall of detail dumps we've been producing (the earlier "feels like a dump" fix, made the
   default).
4. **Keep it coherent.** A periodic *arrange pass* (`switchboard_arrange_board`, or a skill step): merge
   dupes, regroup by epic, order by status/priority, drop stale-done — then fire a `spec` notch ack so
   the tidy is *felt*, and the board stays a readable spec.

## Where the change actually lands

- **adhd-pm skill** (`~/.claude/skills/adhd-pm/SKILL.md`) — the operating protocol gains: "in adhd-pm
  mode, every capture/pickup/decision/thread fires `pm-notch`, and every board write curates (dedupe →
  file → clean) rather than appends." This is the behavioral core.
- **`pm-notch` helper** — a tiny script writing `guide-notify.json`, callable from any thread.
- **connector task tools** — `switchboard_add_task` dedupes + files + fires notch (extend from the
  fire-only it does today); `move_task`/`complete_task` fire notch; add `switchboard_arrange_board`.
- **native `notifyCard`** — add the `picked`/`decided`/`spec`/`thread` kinds (kicker + accent).

## First slice (proposed)

The most-felt, lowest-risk start: **the notch-presence half.** Wire `pm-notch` + the new kinds so that
capture / pickup / decision-resolved / thread-start all light the notch — the founder immediately *sees*
adhd-pm working in tandem. The board-curation half (dedupe + arrange pass) is slice 2, since it's where
the real intelligence (and risk of wrongly merging) lives and deserves its own care.

## States / edges to honour
- App down → `pm-notch` is a silent no-op (never blocks the thread).
- Guided run active → presence acks suppressed (already handled).
- Curation must be **reversible + legible**: a merge leaves a trail (what was merged), never a silent
  delete; the founder can always see what the operator did to the board.
- Don't spam: rapid adds coalesce (last-wins within a tick, as today) so N quick captures ≠ N toasts.
