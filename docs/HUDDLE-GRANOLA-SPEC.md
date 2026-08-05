# Huddle — Granola-depth product spec (rebuild)

Status: **decision-ready spec, spec-first before rebuild.** Huddle is currently `hidden: true` (unlisted / shallow) in `examples/apps/src/store/catalog.js:57`. This document defines the rebuild to Granola depth and the exact step to re-list it.

How to answer: where a real product choice exists, options are laid out `a/b/c` with a ⭐ recommended pick and a one-line rationale. Reply `1a 2b 3⭐…` and the build follows.

---

## 0. Honest assessment of the current Huddle

Read: `examples/apps/src/huddle.js`, `examples/apps/huddle.html`, `examples/apps/huddle-widget.html`.

**What it already does well (keep it):**
- Two input doors — paste transcript OR drop audio (locally transcribed via `claude_transcribe`). The plumbing is real and matches the house idiom (`rawProvider()` → `p.request({ method: "claude_transcribe" })`).
- One structuring stage → clean JSON `{ title, tl_dr, decisions[], action_items[{who,what}], topics[{heading,notes[]}] }`, streamed, defensively normalized (`normalizeNotes`).
- A skimmable render: TL;DR block, decisions list, action-items checklist with owner chips + persisted done-state, collapsible per-topic notes.
- Markdown copy/export, steer chips, `× new`, God tool (`huddle_notes`), notch widget, in-tab test hook.
- Carried OS context read (`readOsContext`), seeds the paste box.

**Where it is shallow (the reason it was unlisted):**
1. **No "open questions" section.** Granola's value is partly in surfacing what was raised-but-unresolved. Huddle drops it; the sibling `meetnotes` wrapp actually *has* it. Huddle is the richer shell missing the one section that reads as "this tool was paying attention."
2. **No owner legibility / no inferred-owner honesty.** Owners are a flat `who` string with `"Unassigned"` fallback, but there is no marking of *inferred* vs *stated* owners. This is the exact honesty seam `dub.js` builds for speakers ("inferred, not audio-diarized") and Huddle has no equivalent — an owner Claude guessed looks identical to one the transcript named.
3. **Notes are ephemeral — no saved-note library.** `state.run` holds exactly ONE run; starting `× new` or a re-run destroys the prior note. There is no "many" state, no history, no re-open. Granola is a *notebook*; Huddle is a one-shot.
4. **No Bank export.** Copy/`.md` download only. A finished note cannot become a vault artifact, so it can't feed the rest of the Switchboard graph.
5. **No output-style choice.** One fixed structuring prompt. No exec-summary / detailed / action-only options — the house doctrine wants options+one-recommended and Huddle offers none pre-run (only post-run steer chips).
6. **Audio boundary is stated in one buried line** ("Live meeting capture isn't here yet…") but the *transcription* honesty (no timestamps, no diarization, text-only) is invisible in the output. A pasted `Priya:`/`Marco:` transcript keeps speakers; an audio file collapses to one undifferentiated wall and the user is never told why.
7. **Duplicate-with-`meetnotes` confusion.** `examples/apps/src/meetnotes.js` ("Meeting Notes", category `tool`, browser-only, markdown sections incl. Open questions) overlaps ~80% with Huddle. Two meeting-notes wrapps is a positioning bug. (Also: `wrapps/gen-manifests.mjs:52` gives Huddle the tagline *"Get everyone on the same call, fast."* — that describes a Slack-style video huddle, NOT a notes tool. Stale/wrong copy to fix in the rebuild.)

The rebuild is **additive on the good bones**, closing 1–7.

---

## 1. Core value + the one-liner

**Huddle turns any meeting into clean, skimmable notes on your own Claude — a TL;DR, the decisions, action items with owners, per-topic notes, and the open questions — private, one-click, and kept.**

- **Who:** founders, PMs, and operators who run back-to-back meetings and need the *decisions and owners* out fast, without a bot joining the call or a transcript leaving the machine.
- **The one job it nails:** paste a transcript (or drop a recording) → get a decision-ready note you can skim in 15 seconds, correct in one nudge, and file into your Bank.
- **The wedge vs Granola:** Granola listens to your system audio in the cloud. Huddle is **private + BYO-Claude** — the operator holds no key, pays for no inference, never sees the meeting; audio is transcribed on-device. That honesty *is* the product, so the spec never pretends to a capability the daemon lacks (§9).

**Positioning decision — Huddle vs meetnotes:**

| | option | rationale |
|---|---|---|
| **1a ⭐** | **Consolidate: Huddle absorbs meetnotes; retire/redirect `meetnotes`.** | One meeting-notes product, not two. Huddle is the superset (audio + topics + checklist + saved notes); fold in meetnotes' "Open questions" and ship one thing. Fixes the confusion and the shelf clutter. |
| 1b | Keep both — meetnotes as the "lite, text-only, browser-only" tier. | Two tiles competing for the same intent; splits token history and reviews; violates "one job." |
| 1c | Rebuild under a new name (e.g. keep "Huddle" for a future live-call product, ship notes as "Meetnotes"). | Throws away Huddle's icon/history/subdomain (`huddle.thelastprompt.ai`) for a naming purity nobody asked for. |

---

## 2. Inputs

Single primary input surface, two doors, honest about each door's fidelity.

### 2a. Pasted transcript (PRIMARY)
The highest-fidelity input: if it carries `Name:` speaker labels, Huddle keeps them (real speakers, no guessing). This is the door most meetings arrive through (Zoom/Meet/Otter export, Slack huddle transcript, hand-typed notes). Cap ~16k chars into the model (existing `slice(0, 16000)`); for longer, **chunk-and-merge** (§9 defers this — v1 truncates with a visible "transcript trimmed to fit" note rather than silently dropping the tail).

### 2b. Uploaded audio — with an honest capability boundary
Reuse the existing local path: `fileToDataUrl` → `claude_transcribe` (whisper/STT on the daemon; audio never uploaded). **The boundary, stated plainly (mirroring `dub.js`):**
- `claude_transcribe` returns **`{ text, backend }` — text only. No timestamps. No speaker labels. No diarizer.**
- So an audio file yields a *flat* transcript. Huddle must NOT pretend it knows who-spoke-when from audio.

**The inferred-speaker seam (borrowed from `dub.js`):** when the transcript has no `Name:` labels (i.e. it came from audio, or an unlabeled paste), Huddle *may* infer speakers/owners from conversational cues, but it **marks them inferred** — the same provenance line `dub.js` renders (`"Speakers inferred from the transcript — Claude's best guess, not audio diarization"`). One function, swappable: the day the daemon grows a real `claude_diarize` verb, feature-detect it (exactly `dub.js`'s `tryRealDiarizer` pattern: check `capabilities().methods.includes("claude_diarize")`) and the inference path is skipped with nothing else changing.

Empty-STT error stays honest and actionable (current copy: *"Local transcription needs a whisper/STT backend on the daemon (RELAY_LOCAL_STT_URL, RELAY_WHISPER_BIN, or RELAY_STT_CMD)."*).

### 2c. Live system-audio capture — KNOWN GAP, called out, not faked
Recording a live call needs system-audio the browser can't reach and a daemon capture verb that does not exist. **v1 does not claim it.** The empty-state keeps the honest line (current: *"Live meeting capture isn't here yet — recording a call needs system-audio the browser can't reach. Paste a transcript or upload a file for now."*). This is the natural v2/daemon upgrade (§9).

### 2d. Carried OS context
`readOsContext()` — when the Switchboard OS launches Huddle AT an artifact (open at a meeting item), seed the paste box / show an "Opened from Switchboard OS · <title>" chip (already wired; keep and extend so a Bank *transcript artifact* opened at Huddle prefills its body, not just its title — see §7).

**Input decision — how much to accept at once:**

| | option | rationale |
|---|---|---|
| **2⭐** | **Paste (primary, big box, focused) + audio drop (secondary) + OS-carried, all three on one surface.** | Matches current shape + house "single input" doctrine; paste is where meetings actually arrive. |
| 2b | Audio-first (drop zone primary, paste secondary). | Audio has the worst fidelity (no diarization) — leading with the weakest door. |
| 2c | Add a "record mic in-tab" door now (MediaRecorder). | Mic ≠ the *call's* audio (you'd capture only yourself); half a feature that reads as the live-capture gap being solved when it isn't. Defer. |

---

## 3. The output structure (Granola-style)

One structuring stage streams ONE JSON object. Exact shape (extends the current one with `open_questions` + owner provenance + `stated_speakers`):

```json
{
  "title": "<short meeting title>",
  "tl_dr": "<2–3 sentence summary of what happened and what was decided>",
  "decisions": ["<a decision that was actually made>"],
  "action_items": [
    { "who": "<owner name or 'Unassigned'>", "owner_source": "stated|inferred|unassigned", "what": "<the concrete task>", "due": "<when, or ''>" }
  ],
  "open_questions": ["<something raised but left unresolved>"],
  "topics": [ { "heading": "<topic discussed>", "notes": ["<a bullet of substance>"] } ],
  "speakers_source": "stated|inferred"
}
```

**The sections, in render order (prominence top→bottom):**

1. **Title** — short meeting title. Derived; falls back to "Meeting notes."
2. **TL;DR** — 2–3 sentences: what happened + what was decided. The single most-glanced element (accent left-border block, as today). *This is the "read it in 15s" payload.*
3. **Decisions** — only decisions *actually made* ("we cut email verification for launch"). Never invented. If none: render an honest "No decisions recorded" rather than an empty section (rule 7). (meetnotes writes "None stated" — adopt that honesty.)
4. **Action items** — checkbox list, owner chip + task (+ due where stated). **Owner legibility (new):** `owner_source` marks each — `stated` (transcript named them) shows a solid chip; `inferred` shows a dashed/marked chip ("guessed"); `unassigned` shows a neutral "Unassigned". Never let a guessed owner look like a named one (the §2b honesty seam, applied at the owner grain). Persisted done-state stays.
5. **Open questions (NEW)** — raised-but-unresolved items. The section that makes Huddle read as "it was paying attention," and the one thing meetnotes had that Huddle lacked. Omit the section entirely if empty (don't fabricate tension).
6. **Notes by topic** — collapsible per-topic bullets, in the order topics came up. Substance only.

**Derivation rules (in the prompt, hardened from current):** only what is in the transcript — never invent decisions, owners, tasks, dues, or questions. `owner_source: "stated"` ONLY when the transcript explicitly assigns; otherwise `inferred` (a plausible guess) or `unassigned`. Keep bullets tight. Order topics as they arose.

---

## 4. The interaction model

- **Single primary input** → **auto-advancing** one-stage pipeline (paste-and-go / drop-and-go). No multi-step wizard.
- **Options + exactly one recommended — the output style, chosen BEFORE run** (closes shallowness #5). Present as `optionCards` from `./kit/ui.js` with the drafted-vs-chosen discipline (`markDrafted`/`markChosen` — a style is *drafted* as recommended, only a human click *chooses* it; never auto-lock the accent):

  **Output-style options:**

  | | option | what it does | rationale |
  |---|---|---|---|
  | **4⭐** | **Balanced (recommended)** | TL;DR + decisions + action items + open questions + topics. The full Granola note. | The default meeting note; what most people mean by "notes." |
  | 4b | Exec summary | TL;DR + decisions + top 3 action items only; topics collapsed/omitted. | For forwarding up; the "what do I need to know" cut. |
  | 4c | Action-only | Action items (with owners/dues) + decisions; no prose. | For the doer who wants the checklist, nothing else. |
  | 4d | Detailed | Everything + longer per-topic notes + verbatim-ish key quotes. | For the note-of-record / someone who missed the meeting. |

  Implementation: the style is a prefix directive on the same structuring prompt (not four code paths) — one recommended, escape hatch via steer for anything off-menu.

- **Live streaming** — the existing `raw-live` peek while the model writes; status line "reading the meeting… / writing the notes…". Keep.
- **Editable / re-runnable** — steer chips (`shorter`, `more detail`, `just decisions`, `group by owner`, `sharper owners`) + free-text steer via `steerRow`. Re-run applies accumulated steers. **Add:** inline-edit an action item's owner/text and check-off state persists (already have checkboxes; add owner correction — clicking an `inferred` chip lets you confirm/rename it, which flips it to `stated`, teaching the note the truth. This is the `escapeHatch` reveal→prefilled→act grammar from `kit/ui.js`).
- **Export** — Copy as markdown (have it), download `.md` (have it), **and Save to Bank (new, §7).**

---

## 5. Whole-spec completeness (every state)

Per the memory rule "whole spec" = reversibility, legibility, order, all states, edges.

**States:**
- **No-model / not-connected** → connect steps + a visibly-labeled SAMPLE transcript (have it). Never dead.
- **Not-installed** → "Install Switchboard" step variant (have it, `notInstalled`).
- **Empty / first-run (connected, no notes yet)** → the input surface: focused paste box + audio drop + the live-capture-gap honesty line + the output-style option cards (drafted-recommended = Balanced). If a Bank context is lent, show the "scoped to your project" chip.
- **One (a single saved note)** → the note view (title, TL;DR, decisions, actions, open questions, topics) + steer row.
- **Many (NEW — a notes library)** → a left/top list of saved notes (title + date + source icon 🎙/¶), newest first; selecting one opens it; the current run is just the top of the list. This is the Granola *notebook*. See the "saved notes" decision below.
- **Loading (audio)** → "transcribing on your device…" status (have it).
- **Streaming (structuring)** → scan bar + raw peek (have it).
- **Error** → red error line + "try again" that re-runs without losing input (have it). Distinct copy for: STT-missing, model-timeout, unstructurable-JSON, empty-transcript.
- **Partial input** → transcript present but audio-transcription returned thin text → structure what exists, but surface a "short transcript — notes may be sparse" caption rather than a confident-looking empty note.
- **No local STT backend** → the actionable env-var error (have it), plus: still allow paste (the audio door failing must not block the paste door).

**Reversibility:**
- **Clear / × new** — starts a fresh input WITHOUT destroying saved notes (today it nulls the only run — the bug the "many" state fixes).
- **Re-run / steer** — non-destructive; keeps the transcript, replaces the notes; prior version recoverable via an "undo steer" (at minimum, the transcript is never lost).
- **Delete a saved note** — explicit, from the library, with the note title in the confirm ("Delete 'Q3 board update'?"). Delete is per-note and reversible-until-confirmed; hard-delete of storage is fine (it's the user's own origin storage) but must be an intentional click, never a side effect of `× new`.

**Legibility (never a raw id):**
- Notes are titled by their generated `title`, dated, and source-tagged (pasted transcript vs 🎙 filename) — never shown by `uid()`.
- **Speakers/owners:** stated ones plain; **inferred ones visibly marked** ("guessed"); unassigned owners say "Unassigned," never blank. The `speakers_source`/`owner_source` provenance is rendered, not hidden — the honesty line from §2b/§3.
- The active output style is labeled on the note ("exec summary").

**Order & prominence:** TL;DR first (the glance), then decisions (the "what changed"), then action items (the "who does what"), then open questions, then topics (the depth, collapsed). In the library, newest-first.

**Saved-notes decision:**

| | option | rationale |
|---|---|---|
| **5a ⭐** | **Keep a list of saved notes in origin storage (`huddle-notes` = array), current run = the head; add a compact library rail.** | Makes Huddle a notebook not a one-shot (the #1 depth gap). Pure `relay.storage` — no daemon needed. Bounded (e.g. last 50) to stay light. |
| 5b | Single-run only (status quo), rely on Bank export for persistence. | Forces a round-trip to Bank to keep anything; every `× new` is a small data loss; not what "meeting notes" implies. |
| 5c | Full Bank-backed history (every note is a vault artifact, no local list). | Couples the core loop to a bound vault; breaks the "works before you connect a Bank" free tier. Do 5a for the working set, 5c's export as the durable home (§7). |

---

## 6. The God / WebMCP tool

Keep the single action, extend the schema for style + surface the provenance. (Reuse `exposeToGod` from `./kit/webmcp.js`; the `execute` drives the same `startFromText`/`startFromAudio` pipeline so God's webview watches it happen.)

```
name: "huddle_notes"
description: "Turn a meeting into clean notes: a TL;DR, decisions, action items with owners
             (marked stated vs inferred), open questions, and per-topic notes. Pass a transcript,
             or an audio file as a data:audio/… URL (transcribed locally, text-only — no
             diarization). Optionally pick a style. Writes the notes live on the page and returns them."
inputSchema: {
  transcript: "string — the meeting transcript or rough notes. Provide this OR audio.",
  audio:      "string — a recording as a data:audio/… URL, transcribed locally on the device. Provide this OR transcript.",
  style:      "string — one of 'balanced' (default) | 'exec' | 'action' | 'detailed'."
}
returns: { notes, markdown, transcript, speakers_source, style }
```

- **When-to-use** (the description does the routing): "turn a meeting/transcript/recording into notes / decisions / action items / who-owns-what / open questions."
- Retains the busy-wait + 3-attempt retry pattern (have it). Returns `speakers_source`/owner provenance so God never overstates who owns what (the `dub.js` `note: "inferred…"` discipline).

**Notch widget (`exposeWidget`):** keep the cards glance (decisions + action items). Add: owner chips reflect provenance; if speakers were inferred, the caption says so ("…owners inferred"). Honest prompt state when no input/no connection (have it).

---

## 7. Bank integration

A finished note becomes a first-class **artifact in the vault**, so it feeds the rest of the graph (search, cross-wrapp reference, tasks).

- **Trigger:** a "Save to Bank" action in the run bar (next to copy / export), enabled once `notes` exist. If a Bank context is lent (`brand`/active context present), save into it; if none, prompt to bind one (the Bank connector flow) — never silently no-op.
- **Artifact kind:** `kind: "meeting-note"` (or reuse the generic `note`/`artifact` kind if the vault schema prefers — confirm against `docs/CONTEXT-KINDS.md`; the memory index notes artifacts as a cross-wrapp object). Body = the same `notesToMarkdown(notes)` output (so the vault stores the readable `.md`, matching Bank's `.md` storage dialect).
- **Provenance (required):** the artifact carries `source: "huddle"`, the input source (`pasted` / `audio:<filename>`), `speakers_source`, the style used, and a timestamp — so a note in the vault is legible about *how* it was made and *how much to trust* its owners. Action items may additionally emit as vault to-dos (the Bank tasks connector, `@huddle` tag) if that surface is wired — **defer to v1.1**; v1 saves the note artifact.
- **Reversibility:** saving to Bank does not delete the local note (5a keeps it); the two are independent. Re-saving updates the same artifact (idempotent by note id) rather than spawning duplicates.

| | option | rationale |
|---|---|---|
| **7a ⭐** | **One-click "Save to Bank" → a `meeting-note` markdown artifact with full provenance; action-items-as-tasks deferred to v1.1.** | Ships the durable home for notes now; keeps scope tight; provenance keeps the vault honest. |
| 7b | Auto-save every note to Bank on completion. | Requires a bound vault to use Huddle at all; breaks the pre-Bank free loop; noisy. |
| 7c | Full two-way sync (edit in Bank ↔ edit in Huddle). | Real product, wrong phase; build the one-way export first. |

---

## 8. Build plan

**Reuse-first — lean on existing kit, do not re-derive:**
- `@relay/sdk` `whenRelayReady`/`mountConnect` — the connect chip + returning-user probe (copy the byte-identical plumbing block, as every wrapp does).
- `./kit/ui.js` — `optionCards` (output-style slate, with `markDrafted`/`markChosen`), `steerRow`, `escapeHatch` (owner correction), `researching`.
- `./kit/webmcp.js` — `exposeToGod` + `exposeWidget`.
- `./os/os-context.js` — `readOsContext`.
- The `dub.js` **inferred-vs-real seam** (`tryRealDiarizer`/`inferSpeakers` shape) — adapt for speaker/owner provenance, feature-detecting a future `claude_diarize`.
- The `deck.js`/`meetnotes.js` structuring idiom (`streamText` → `parseJson` → defensive `normalize`).
- Existing `huddle.js` `normalizeNotes`, `notesToMarkdown`, `transcribeAudio`, render atoms — extend, don't rewrite.

**Files to write / rewrite:**

| file | change |
|---|---|
| `examples/apps/src/huddle.js` | **Rewrite the APP LOGIC block** (keep the template plumbing byte-identical): add `open_questions` to the JSON shape + `normalizeNotes` + `notesToMarkdown` + render; add `owner_source`/`speakers_source` provenance + the inferred seam; add the pre-run output-style `optionCards`; add the **saved-notes library** (`huddle-notes` array in storage, list rail, delete-with-confirm, non-destructive `× new`); add **Save to Bank**; extend `huddle_notes` God tool schema (`style`) + return provenance; fix the OS-context prefill to hydrate a transcript artifact's body. |
| `examples/apps/huddle.html` | Add CSS for: output-style option cards (reuse `.opt` classes — mostly free via kit), the open-questions section (mirror `.decisions` styling with a distinct mark), the notes-library rail, inferred-owner/`speaker` provenance chip (dashed/marked), Save-to-Bank button. House tokens already correct (`#0A0C10/#12151C`, lime `#C8F250`, Bricolage/Hanken/Spline) — no design-system drift. |
| `examples/apps/huddle-widget.html` | Add `open_questions` to the widget's structure prompt + render; reflect owner provenance in the chips + caption. Self-contained provider bridge stays. |
| `examples/apps/wrapps/huddle/switchboard.json` | No structural change needed (surfaces browser+notch, requires daemon). Update tagline if consolidating with meetnotes. Confirm `huddle_notes` tool block matches the new schema in `examples/apps/wrapps/catalog.json`. |
| `examples/apps/wrapps/catalog.json` (huddle block, ~L228) | Update the `huddle_notes` `inputSchema`/description to add `style` + the provenance note. |
| `examples/apps/wrapps/gen-manifests.mjs:52` | **Fix the wrong tagline** `"Get everyone on the same call, fast."` → a notes tagline, e.g. `"Any meeting → the decisions, owners and open questions."` |

**Pipeline stages (runtime):**
1. **Input** → paste text (primary) OR audio→`claude_transcribe` (local, text-only) OR OS-carried artifact body.
2. **(seam) Speaker/owner provenance** → if `Name:` labels present, `stated`; else infer + mark `inferred`; feature-detect a future real diarizer.
3. **Structure** → one streamed completion → `{ title, tl_dr, decisions, action_items(+owner_source,due), open_questions, topics, speakers_source }`, style-prefixed.
4. **Render** → TL;DR → decisions → actions(checklist, provenance chips) → open questions → topics(collapsible). Live raw peek while streaming.
5. **Persist** → append/update in `huddle-notes` (bounded); done-state + steers persist.
6. **Export** → copy `.md` / download `.md` / **Save to Bank** (`meeting-note` artifact, provenance).

**THE RE-LIST STEP (do this last, after self-test passes):**
1. **`examples/apps/src/store/catalog.js:57`** — remove `hidden: true` from the `huddle` entry. The `APPS = ALL_APPS.filter((a) => !a.hidden)` export (L81) drops it back onto every tile, count, and category automatically. Bump `updates` (currently `1`).
2. Confirm there is **no** other listing gate holding it back: the store `hidden` flag is the active one (`examples/apps/wrapps/catalog.json` currently has **no** `hidden` field on huddle, despite the store comment; verify and, if a `hidden` mirror is added there later, clear it too).
3. If **consolidating (1a)**: mark `meetnotes` retired — leave it out of `ALL_APPS`/store (it already isn't listed there) and, if desired, redirect its route to Huddle; keep the source for reference or delete after confirming no catalog reference points at it.
4. Rebuild bundles (`build.mjs` already has the `huddle` entry point) and run the headless harness (`__huddleTest.mockNotes` + `normalizeNotes`/`notesToMarkdown`/`widgetTextFrom`) — extend the test hook to cover `open_questions` + owner provenance + the saved-notes list before flipping the flag.

---

## 9. Honest risks & gaps

- **Audio = flat transcript (the core boundary).** `claude_transcribe` is text-only: no timestamps, no diarization. Owners/speakers from an audio file are *inferred*, and Huddle says so. Risk: users expect Granola-grade "who said what" from a recording. Mitigation: the provenance line + leading with paste (highest fidelity). **Not faked.**
- **Live system-audio capture does not exist.** Needs a daemon capture verb + system-audio access the browser lacks. v1 states the gap; it's the marquee v2/daemon upgrade.
- **Real diarization needs the daemon it doesn't have.** The `claude_diarize` seam is feature-detected and inert today. When the daemon grows pyannote/whisperX, Huddle upgrades transparently (the `dub.js` proof).
- **Long transcripts truncate.** v1 caps ~16k chars with a visible "trimmed" note; chunk-and-merge (map-reduce over segments) is deferred. Risk: a 2-hour transcript loses its tail — call it out in-product, don't silently drop.
- **Structuring is one model call → JSON.** Malformed JSON is handled (`parseJson` + `normalizeNotes` floor), but a genuinely messy transcript can yield thin notes. The "short transcript — notes may be sparse" caption + steer keep it honest rather than confidently-empty.
- **Owner inference can be wrong.** Marked `inferred`, correctable in one click (which flips it to `stated`). The danger is an unmarked guess reading as fact — the provenance chip is the guard, and it's non-optional.
- **Bank save needs a bound vault.** Free/core loop works without Bank (local `huddle-notes`); Save-to-Bank prompts to bind rather than failing silently. Action-items-as-vault-tasks deferred to v1.1.
- **meetnotes duplication** must be resolved (decision 1) or the shelf ships two meeting-notes tools — a positioning regression, not a rebuild win.

**What v1 defers:** live capture, real diarization, chunk-and-merge for long transcripts, action-items→Bank-tasks, two-way Bank sync, multi-meeting synthesis ("what did we decide across these three standups").

---

## Decision checklist (answer `1a 2⭐ …`)

1. Positioning vs meetnotes — **1a ⭐** consolidate / 1b two tiers / 1c rename
2. Input shape — **2⭐** paste-primary+audio+OS / 2b audio-first / 2c add mic-record
3. Output style default — **4⭐** Balanced recommended (+ exec/action/detailed) / (or name a different default)
4. Saved notes — **5a ⭐** local library + run head / 5b single-run / 5c full Bank-backed
5. Bank export — **7a ⭐** one-click note artifact, tasks deferred / 7b auto-save / 7c two-way sync
