# Guided runs — resume-from-abandoned + a no-clobber queue

Status: primitive built + tested (2026-08-19); **native queue + notify + notch-resume BUILT
(2026-08-23)** — compile-clean, live-verified plumbing; visual needs an eyeball pass. Founder also
asked for **notch feedback on session actions** ("trigger a task → see 'task captured' at the notch") —
built as the notify path below.
Founder ask: *"relaunch from abandoned step — and a way to do this via the notch, since a guide could
disappear or there could be multiple in the queue. Helps prevent collision too."*

## The problem (two failure modes, one root cause)

The guided-run handshake ([[switchboard]] skill) is **single-slot**:

- **In:** a session writes `~/.relay/guide-run.json`. The app ingests it and deletes it.
- **Out:** the app writes `~/.relay/guide-result.json` when the run ends.

With **two sessions live at once** (e.g. this session + a spun-off continuation both driving the notch)
that single slot collides:

1. **Clobbered trigger** — session B writes `guide-run.json` over session A's card before the human
   acts on A. A's card vanishes from the notch.
2. **Clobbered result** — `guide-result.json` is overwritten by whichever run ends last, so A's result
   is lost even if the human completed it. (This is the exact gotcha the [[fetch]] skill recovers from.)
3. **No resume** — if the human abandons a run (esc) with steps left, the only option is re-firing the
   *whole* run, making them redo the steps they already passed.

The one durable thing today is **`~/.relay/guide-history.jsonl`** — append-only, never clobbered. Every
run appends a record with per-step `id · text · verdict`, `runId`, `outcome`, and durable screenshot
paths. That is the substrate resume is built on.

## What's built now — the resume primitive (`scripts/guide-resume.mjs`)

Pure, unit-tested (21 assertions), and deliberately the **same computation a native Resume button
should call**:

- `parseHistory(text)` → run records from the JSONL (tolerates broken lines).
- `isResumable(run)` → true only when the human **aborted** it with a step not yet `pass`. A
  `completed` run is done — this is also what keeps single-step ask/decision cards (which complete with
  a `chosenOption`, not a `pass`) out of the resume list.
- `remainingSteps(run)` → the steps from the **first non-pass to the end** (so a mid-run abort continues
  where it stopped).
- `buildResumeRun(run, archived?)` → a fresh `guide-run.json` with only the remaining steps, titled
  `Resume: <title> (N left)`, carrying `resumeOf`/`resumedPast`. If a **full-fidelity archive** exists
  for the runId, the remaining steps regain their `hint`/`say`/`point`/`doneWhen`; otherwise they resume
  with the text the log preserved.

```bash
node scripts/guide-resume.mjs --list          # resumable (aborted) runs
node scripts/guide-resume.mjs --dry           # what the most-recent resume would do
node scripts/guide-resume.mjs --run <id>      # fire the resumed card to the notch
```

Because it reads the **durable log**, a run is resumable **even after its live result was clobbered by
another session, and even from a different (or fresh) Claude session** — which is the collision
mitigation at the file level.

## What's BUILT — the notch-native surface (CursorGuide.swift, 2026-08-23)

All three pieces below plus the session-action notify, compile-clean:

- **Archive-on-ingest** (`archiveRun`) — every ingested run is copied to `~/.relay/guide-runs/<runId>.json`
  before it's consumed, so a resume restores full step fidelity.
- **No-clobber queue** — `begin()` now ENQUEUES a run that arrives mid-run (`pendingRuns`) instead of
  `abort("superseded")`; `teardown()` drains the next via `drainQueue()`. A watched directory
  `~/.relay/guide-queue/<id>.json` lets any session drop a run without touching the single-slot
  `guide-run.json`. `model.queueDepth` exposes "+N queued".
- **Notch-native resume** — a run left in `guide-suspended.json` surfaces a tappable **"▸ Resume …"**
  toast at the notch (`offerResumeIfSuspended`), shown ~2.5s after launch (recovers a dropped/previous-
  session run — no Claude session needed). `⌥→` or a click re-enters at the stopped step
  (`resumeSuspended`).
- **Session-action notify** — the app watches `~/.relay/guide-notify.json`
  (`{text, kind, source, project, action?, actionLabel?, ttl?}`) and shows a brief notch toast
  (`showNotify` → `notifyCard`). `kind`: `captured` ✓ · `info` • · `resume` ▸. Suppressed during an
  active run (the notch belongs to the run); auto-dismisses. **The switchboard connector's
  `switchboard_add_task` now fires one** → capturing a task (via `/task` or any thread) shows
  "Task captured: …" at the notch.

### Verify (eyeball pass — the plumbing is confirmed; the pixels need a human)
- `/task something` (or any `switchboard_add_task`) → a "Task captured" toast appears at the notch and
  auto-dismisses. (Plumbing confirmed: the app consumes `guide-notify.json` and logs the notify.)
- Fire two runs within a second → both appear in turn (queue depth 2), neither knocked off.
- Abort a run midway, relaunch → the "▸ Resume" toast appears; `⌥→` re-enters at the right step.

## Original spec (for reference)

### The notch-native surface (as originally specced)

The founder's requirement is that resume works **from the notch, with no session needed** (a session can
die or be superseded). That means the logic must live where the app can invoke it. Three additive native
pieces in `CursorGuide.swift` / `RelayMenuBar.swift`:

### 1 · Full-fidelity archive on ingest (small)
When the app ingests a `guide-run.json`, before deleting it, copy it to
**`~/.relay/guide-runs/<runId>.json`** (assign a `runId` if absent). This is what lets resume restore
`point`/`say`/`doneWhen`, not just text. `guide-resume.mjs` already reads this path.

### 2 · A no-clobber QUEUE (medium — the collision fix)
Replace the single `guide-run.json` slot with a watched **directory** `~/.relay/guide-queue/`. Each
session drops `<runId>.json`; the app enqueues by mtime. No file is ever overwritten → **collision gone.**
The notch shows the active card plus a small **"+N queued"** badge; finishing/aborting the active run
pulls the next. Keep reading the legacy single `guide-run.json` too (back-compat) — treat it as a
queue drop.

### 3 · A persistent RESUME affordance (medium — the founder's ask)
On abort (esc) with remaining steps, the app writes the paused run to
**`~/.relay/guide-paused/<runId>.json`** (it has the full run in memory — full fidelity) and surfaces a
**`▸ Resume — <title> (N left)`** chip at the notch (and in the panel's activity list). Tapping it
re-enters at the first non-pass step — no Claude session involved. A paused run persists across app
restarts until resumed or dismissed. Multiple paused runs stack (newest first).

**Result:** a run can never be *stranded* — if the session that made it is gone, the human still sees
`▸ Resume` at the notch; if two sessions fire at once, both land in the queue instead of clobbering.

## Verification plan (for the native build)
- Fire two runs from two shells within a second → both appear (queue depth 2), neither lost.
- Abort a run midway → `▸ Resume (N left)` chip appears; tap → re-enters at the right step; the passed
  steps are not repeated.
- Kill the originating session, then tap Resume → still works (app-owned).
- Restart the app with a paused run present → the Resume chip is still there.
