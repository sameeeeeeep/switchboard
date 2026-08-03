# Peek into the session

Status: **design only** (2026-08-03). No code yet. This specs an opt-in expansion of the notch phase
pill — from a one-word status ("Thinking", "Almost done…") into a live, glanceable **stream of what
God is actually doing**: reading the screen, driving a wrapp, calling a tool, forming its answer.

The founder's note that started this:

> "works, but tell me — if the user selects, should they see more into it? Like we stream what's
> happening — it's like a peek into the session."

The answer is yes, and the shape is: **the pill stays minimal; the peek is opt-in.** Most of the time
you want the calm three-word drop. When you're curious — or when it's taking a while, or you're about
to be asked to approve something — you open it and watch.

---

## 1. Where this lives today (so the peek doesn't reinvent anything)

The pill is `GodStatusDrop` — `packages/menubar/RelayMenuBar.swift:1930`. It's a `NotchDropShape`
container holding a label + a `DotMatrix` waveform, plus (conditionally) a project chip and staged
reference chips. It is hosted in `godStatusPanel` and shown by `showGodStatus(_:accent:pattern:)`
(`RelayMenuBar.swift:4169`), which is fed by `updateGodStatusDrop(_ s: GlowState)`
(`RelayMenuBar.swift:4159`):

| GlowState | label | accent | pattern |
|---|---|---|---|
| `.listening` | "Listening" | cyan | `.listening` |
| `.thinking` | "Thinking" | lime | `.thinking` |
| `.finishing` | "Almost done…" | lime | `.thinking` |
| `.speaking` | "Speaking" | orange | `.speaking` |
| else | *(hidden)* | — | — |

`GlowState` is defined at `RelayMenuBar.swift:1760`; `DotMatrix.Pattern` at `:1846`.

The phase comes from a single tiny file. `god.mjs` publishes its phase with `godState(s)`
(`examples/god/god.mjs:64`) into `~/.relay/god-state`; the app polls it every 0.25 s via a `Timer` set
up in `spawnGod` (`RelayMenuBar.swift:3838`) → `readGodState()` (`RelayMenuBar.swift:4063`). One word
in, one drop out. That's the whole current surface — deliberately thin.

There is a **second, separate** status surface: the drive state machine (`showDriveWorking` /
`driveToWindow` / `driveFinished`, `RelayMenuBar.swift:3208`–`3299`), which shows "God is driving
<wrapp>…" as a `NotchWidget` when a wrapp run is the deliverable. The peek must cover **both** the
voice/vision loop (`god-state`) and the drive loop (the widget), because from the user's point of view
it's one session.

The peek reuses the notch grammar wholesale: same `NotchDropShape`, same `presentFromNotch` /
`dismissToNotch` grow-from-the-notch motion (`RelayMenuBar.swift:3029`, `:3044`), same tokens. It is
**the same drop, taller** — not a new window.

---

## 2. The interaction — minimal by default, expands on intent

### The gesture
- **Collapsed (default):** exactly today's `GodStatusDrop`. Nothing changes for the user who doesn't
  care.
- **Expand:** a **click** on the pill toggles it open. (Hover is already overloaded — hovering the orb
  opens the full panel, `openFromOrb`, `RelayMenuBar.swift:3397` — so the peek is **click to open,
  click again / click-away to close**, not hover. A short hover-intent delay can be added later behind
  the same live-UX caveat that gates the "what God sees" palette in `docs/GOD-HANDS.md §Capture
  scope`.)
- **Collapse:** click the pill again, click outside it, or the run ends. When a run ends while the peek
  is open, it does **not** yank shut mid-thought — it holds the final feed for ~2 s (the same courtesy
  as `driveFinished`'s "done" flash) then collapses with the phase drop.
- **Sticky preference:** remember the last open/closed choice in `~/.relay/peek-open` (a flag file, same
  idiom as `~/.relay/ambient-on`, `RelayMenuBar.swift:4237`). If you like watching, every run opens
  expanded; if you don't, it never bothers you. This is the whole "opt in" — a one-time choice that
  persists, not a per-run decision.

### The shape when open
The drop keeps its top row (label + waveform + project chip) and **grows a scrolling feed below it**: a
reverse-or-forward chronological list of short lines, newest pinned in view, capped (~8 visible, older
scroll). Each line is one event with a small leading glyph:

```
┌───────────  (notch)  ───────────┐
│  Thinking            ▍▍▍▍·· lime │   ← unchanged pill row
│  ── project: Switchboard ──────  │
│  👁  read your screen (1440×900) │
│  🧠  choosing the right tool…    │   ← streamed partial (Phase 2)
│  🛠  gist — summarising…         │
│  ✓  done · 2318 chars            │
└──────────────────────────────────┘
```

- One uniform row style (mono caption, `splMono`/`hanken` per the existing chips), no per-event
  chrome. It reads as one system, like the widget kit in `GOD-HANDS.md §4`.
- The feed is **append-mostly**: a `tool_proposed` line updates in place to `tool_result` when it
  resolves (so it doesn't double-print). Partial reasoning text overwrites the previous partial on the
  same "🧠" line rather than stacking.
- The final answer (from `god-last-answer.txt`) lands as the last line — the peek is also where a
  *silent* God becomes legible (that file exists precisely so "even a mute God is legible",
  `god.mjs:86`).

### What it never becomes
Not a transcript viewer, not a log tail with timestamps, not a debugger. It's a **calm progress
narration** — the same register as God's voice, in text. If it can't be said in a short human line, it
doesn't belong in the peek.

---

## 3. The data source — what we can stream today vs. what needs a channel

### 3a. Available on disk **today** (zero new plumbing)
All of these are already written every run and already in `~/.relay`:

| Source | Written by | Content | Granularity |
|---|---|---|---|
| `god-state` | `god.mjs:64` `godState()` | one word: listening/thinking/finishing/speaking/consent/idle | coarse phase |
| `god-run.log` | god.mjs **stderr**, wired by the app (`RelayMenuBar.swift:3899`) | `[god]` log lines + `✦/✖` markers | line-per-step |
| `god-last-answer.txt` | `god.mjs:101` `surfaceAnswer()` | the final spoken/answer text | final only |
| `god-action.json` / `god-run.json` | `god.mjs:256`, `:978` | the proposed action + its `describe` string | on consent |
| staged refs (`godRefs`) | app-side (fn-grabs, drops) | screenshots + files this turn | in-memory |
| drive widget line | `showDriveWorking` (`:3208`) | "Running <tool> on your Claude…" | drive only |

The **run-log line vocabulary already emitted** by `god.mjs`'s `log()` is genuinely narratable — e.g.
`captured N screens (primary WxH)` (`:743`), `asking <model> as <persona> (vision)` (`:803`),
`project: <name>` (`:801`), `runnable tools: N` (`:782`), `skill loaded` (`:796`),
`file attached (pdf text): <name>` (`:642`), `awaiting consent: <describe>` (`:959`), and the closing
`✦ run complete` / `✖ …` markers (`:95` `loud()`). A Phase-1 peek can render a **live tail of
`god-run.log`**, mapped through a small allowlist of friendly rewrites, and be genuinely useful with
**no changes to god.mjs at all**.

**What today's data CANNOT show:** the model's forming answer (partial reasoning/output), and
individual tool calls *as they happen*. Why: `god.mjs`'s `ask()` calls **`claude_complete`**
(`god.mjs:804`) — the one-shot method whose deltas the daemon explicitly **discards**
(`server.ts:1020`, `emit: (_d) => { /* one-shot: deltas discarded */ }`). So the whole model turn is a
single black-box await; the pill sits on "Thinking" for its full duration with nothing underneath.

### 3b. The richer channel **already exists in the daemon** (just unused by God)
The daemon implements a full streaming path — `claude_stream` (`server.ts:287`, `startStream` at
`:1045`) — that emits `StreamDelta` events over the socket as `{type:"event", event:"delta", …}`
(`server.ts:1057`). The delta taxonomy (`packages/protocol/src/completion.ts:62`) is exactly what a
peek wants:

```
StreamDelta =
  | { type: "text"; text: string }                 // assistant text as it forms
  | { type: "tool_proposed"; call }                // "God wants to run <tool>"
  | { type: "tool_result"; call; result }          // …and here's what came back
  | { type: "sources"; urls }                      // URLs it fetched/searched
  | { type: "done"; result }
  | { type: "error"; error }
```

The Claude Code backend already emits these: `text` per assistant block
(`backends/claude-code.ts:228`), `tool_proposed` at `:175`, `tool_result` at `:181`/`:238`. **The
capability is built; God just doesn't subscribe to it** because it uses the one-shot method.

### 3c. Lightest mechanism to get 3b into the peek: a **peek journal file**, tailed on demand
The app ↔ god.mjs channel is *already entirely files polled at 0.25 s* (`god-state`,
`god-action.json`, `god-consent.json`). Introducing a socket for the peek would add a new
lifecycle/trust surface for a short-lived child process the app already owns the stdout of. So keep the
grammar:

> **`god.mjs` appends one JSON line per progress event to `~/.relay/god-peek.jsonl`; the app tails it
> ONLY while the peek is expanded.**

- Append-only JSONL, keyed by a per-run `runId` (so a stale run's tail can't bleed into a new one — the
  same generation guard the drive already uses, `driveGeneration`, `:3149`). god.mjs writes `runId` on
  its first line; the app ignores lines whose `runId` ≠ the current run.
- Line shape mirrors `StreamDelta` verbatim plus a `kind` for the today-sources
  (`{runId, t, kind:"phase"|"log"|"text"|"tool"|"done"|"error", …}`), so Phase 1 and Phase 2 write the
  same file and the renderer is one switch.
- **Tail only while expanded.** Collapsed peek = the app reads nothing but `god-state` (today's
  behaviour). Opening the peek starts a lightweight tail (seek-to-end, read appended bytes on the
  existing 0.25 s poll, or bump to ~10 Hz *only while open*); closing it stops. Device-light by
  construction — see §5.
- **god.mjs flips `ask()` from `claude_complete` to `claude_stream`** and, in the delta callback,
  (a) appends each delta to the journal and (b) still accumulates the final text exactly as today. The
  final `[DRIVE:]`/`[RUN:]` parse (`god.mjs:184`) is unchanged — it runs on the accumulated text after
  `done`. This is the one real code change and it's additive; a build that can't stream falls back to
  `claude_complete` and the peek degrades to Phase-1 (phase + run-log tail).

Rejected alternatives: **socket** (new trust/lifecycle surface, no reuse of the file idiom);
**parsing god-run.log for everything** (works for step lines, but the model's forming text isn't in the
log and shouldn't be jammed into stderr); **broadening `god-state`** (it's a phase, not a feed —
overloading it would fight the 0.25 s dedupe in `showGodStatus`, `:4182`).

---

## 4. All states — what the peek shows in each

The peek is a function of the run's phase. Collapsed, each is today's pill. Expanded:

| State | Pill (collapsed) | Peek feed (expanded) |
|---|---|---|
| **Idle** | *(hidden; orb only)* | Peek can't be opened — there's no session. (Optional: last run's final answer as a dim "last:" line for ~a few seconds after `.idle`, since `god-last-answer.txt` persists.) |
| **Listening** | "Listening" (cyan) | "🎙 listening…" + the staged refs as they're added (screenshots/files chips), + the capture scope ("whole screen" / "region"). No model text yet. Refs already render here (`showGodStatus` `showRefs`, `:4175`). |
| **Thinking** | "Thinking" (lime) | The narration turns on: `👁 read your screen (WxH)` · `📁 file attached: <name>` · `project: <name>` · `🧠 <forming answer…>` (Phase-2 partial text, overwriting in place) · `🛠 <tool> — proposed/…running` for any `tool_proposed`. This is the state the founder cares about most — the long black box today. |
| **Driving a wrapp** | (drive uses its own widget/pill; peek overlays the same feed) | `🛠 driving <wrapp> · <tool>` with the working line from `showDriveWorking` (`:3209`), then the result shape when `driveFinished` fires. "Open the wrapp" stays the escalation. The peek is the *why-is-this-taking-90s* window (`:3163`). |
| **Awaiting consent** | "Thinking" (lime) — God is paused | The **top** line becomes the ask: `⏸ waiting for you — <describe>` (from `god-action.json`/`god-run.json`'s `describe`, `:256`/`:978`). The peek explains *what* the consent drop is for and *why* it paused; the actual Allow/Deny stays the existing `ConsentDrop`/run-consent surface (`:1970`, `showRunConsent`). Peek never becomes an approval control — it only narrates. |
| **Finishing** | "Almost done…" (lime) | `🗣 composing the voice…` — honest about the TTS-synthesis wait (a cloned voice is 3–20 s, `god.mjs:919`). The final answer text is already in the feed by now (arrived on `done`). |
| **Speaking** | "Speaking" (orange) | The final answer line stays pinned; a subtle "speaking" affordance. This is the natural read-along. |
| **Done** | *(collapses after ~2 s)* | `✓ done · <n> chars` (or the drive result shape). Holds briefly if the peek is open, then collapses with the drop. |
| **Error** | (drop shows the failure reply — God speaks the reason, `god.mjs:879`) | `✖ <reason>` pulled from the `loud()` marker + `god-last-answer.txt`. The peek is where the silent-death fix (`god.mjs:82`) becomes *visible*, not just audible. "Open panel" escalation as today. |

Edge/robustness (states-completeness, per the memory note):
- **Superseded run** (project switch mid-turn re-runs, `:4199`; a new ask supersedes, `:3148`): the
  `runId` guard drops the old tail; the feed clears to the new run. No two runs interleave.
- **Peek open when run ends:** hold-then-collapse, never a hard cut.
- **Peek open, journal missing / Phase-1 build:** fall back to the `god-run.log` tail; if even that's
  empty, show just the phase — the peek is always at least as informative as the pill.
- **Reduce motion:** the feed appends without the waveform re-animating (already guarded by the
  re-render dedupe, `:4170`).

---

## 5. Device-light + privacy

**It's the user's own session.** The peek captures nothing new — no screen recording, no extra model
calls, no network. Everything it shows is already produced by the run and already written to
`~/.relay` (the user's home). The peek is a *reader*, never a *sensor*. This is the important privacy
line and it holds trivially because we're reusing files god.mjs already writes.

Device-light guarantees:
- **Zero cost while collapsed.** Collapsed = exactly today: poll one word from `god-state`. No tail, no
  journal reads. The default experience is unchanged, including battery.
- **Bounded cost while expanded.** Tailing is a seek-to-end + read-appended-bytes on the file, on the
  poll already running; only *while open* may it tick faster (~10 Hz) for a live feel. The journal is
  append-only and **capped** (rotate/truncate per run, e.g. last ~200 lines) so it can't grow
  unbounded.
- **No new process, no socket, no daemon change.** god.mjs already runs; the daemon's stream already
  exists. Phase 2 is one method swap inside god.mjs, not new infrastructure.
- **Journal is ephemeral + local.** `~/.relay/god-peek.jsonl` is same-origin with the other god files
  (600-ish perms idiom, cf. `TOKEN_FILE` at `god.mjs:402`), truncated per run, never synced, never left
  around as a transcript. Screenshots/files stay as the existing `godRefs` on disk and clear when the
  turn goes idle (`clearGodRefs`, `:3908`) — the peek only shows the *chips*, not new copies.
- **Untrusted-text discipline unchanged.** Screen/file text is untrusted data (`god.mjs:143` PROTOCOL);
  the peek renders god.mjs's *own* narration and the model's answer, not raw screen scrapes — it never
  re-surfaces untrusted content as if it were God's.

---

## 6. Build path

Phased so **Phase 1 ships value with no god.mjs change**, and Phase 2 lights up the part the founder
actually asked for.

### Phase 0 — the expandable drop (pure SwiftUI, no data change)
1. Add `GodPeekDrop` next to `GodStatusDrop` (`RelayMenuBar.swift:1930`): same top row, plus a
   `ScrollView` feed of `PeekLine` rows. New `@State` `peekExpanded` on the controller.
2. Click-to-toggle on `godStatusPanel`: a local mouse-down inside the pill flips `peekExpanded`;
   re-run `showGodStatus` so the panel re-sizes and re-anchors (the size/anchor math already exists,
   `:4215`). Persist to `~/.relay/peek-open`.
3. Collapse on click-away (reuse the `notchWidgetMonitor` pattern, `:3093`) and on `.idle` with the
   hold-then-collapse courtesy.
   → *Ships: a pill you can open/close. Feed shows phase transitions only.*

### Phase 1 — narrate from data already on disk
4. Tail `god-run.log` while expanded; map its `[god]` lines through a small friendly-rewrite allowlist
   into `PeekLine`s. Show staged refs (already available), the drive working line
   (`showDriveWorking`), the consent `describe`, and `god-last-answer.txt` as the final line.
   → *Ships: a real peek — every step god.mjs already logs, narrated live. No god.mjs change.*

### Phase 2 — the live model stream (the "peek into the session" proper)
5. In `god.mjs` `ask()` (`examples/god/god.mjs:804`): switch `claude_complete` → `claude_stream`,
   subscribe to `delta` events, accumulate text as today, and **append each delta** (+ a `runId`
   header line) to `~/.relay/god-peek.jsonl`. Keep the one-shot path as a fallback when streaming is
   unavailable.
6. In the app, when expanded, tail `god-peek.jsonl` (runId-guarded) and render `text` (forming
   answer, overwrite-in-place), `tool_proposed`→`tool_result` (in-place upgrade), `sources`, `done`,
   `error`.
   → *Ships: partial reasoning/output + tool calls streaming under the pill.*

### Phase 3 — polish
7. Sticky-open default from `~/.relay/peek-open`; reduce-motion; feed cap/rotation; the optional
   post-run "last:" ghost line in idle; a hover-intent open behind a live-UX pass (same caveat as
   `GOD-HANDS.md §Capture scope`).

### Non-negotiables carried over
- The pill stays minimal collapsed — the peek is **strictly additive** and opt-in.
- The moat holds: no new trust surface. The daemon stream is already gated/audited; the journal is a
  local read-only mirror; consent stays in the existing consent drop (the peek narrates, never
  approves).
- Everything emanates from the notch (`GOD-HANDS.md §5`): the peek grows and collapses via
  `presentFromNotch` / `dismissToNotch`, one shape, one motion.

---

## Appendix — exact anchors

- Pill view: `packages/menubar/RelayMenuBar.swift:1930` (`GodStatusDrop`)
- Phase → pill: `RelayMenuBar.swift:4159` (`updateGodStatusDrop`), `:4169` (`showGodStatus`), dedupe `:4182`
- Phase read/poll: `RelayMenuBar.swift:4063` (`readGodState`), timer `:3838`; `.consent` → `:4071`
- Drive machine: `RelayMenuBar.swift:3208` (`showDriveWorking`), `:3218` (`driveToWindow`), `:3265` (`driveFinished`)
- Notch motion: `RelayMenuBar.swift:3029` (`presentFromNotch`), `:3044` (`dismissToNotch`)
- Notch widget (drive surface): `RelayMenuBar.swift:3062` (`showNotchWidget`)
- god phase writer: `examples/god/god.mjs:64` (`godState`); phases at `:744`, `:883`, `:922`, `:924`, `:980`
- god run-log / answer: `god.mjs:87` (`RUN_LOG`), `:95` (`loud`), `:101` (`surfaceAnswer`); app wires stderr `RelayMenuBar.swift:3899`
- god model call (one-shot, discards deltas): `god.mjs:804` (`claude_complete`); discard site `packages/sidekick/src/server.ts:1020`
- daemon stream (unused by God, ready): `server.ts:287` / `:1045` (`startStream`), emit `:1057`
- delta taxonomy: `packages/protocol/src/completion.ts:62` (`StreamDelta`)
- backend delta emits: `packages/sidekick/src/backends/claude-code.ts:228` (text), `:175` (tool_proposed), `:181`/`:238` (tool_result)
- flag-file idiom precedent: `RelayMenuBar.swift:4237` (`ambient-on`); token perms `god.mjs:402`
