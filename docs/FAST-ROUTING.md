# Fast Routing — a model-free hot path for voice → wrapp

Status: design (2026-08-03). No code yet. This spec proposes a **deterministic on-device intent
router** that resolves high-frequency, unambiguous voice commands ("open Prism", "gist this",
"add X to memory") to an action **without a model call**, and falls through to the existing
Claude routing whenever it isn't confident.

## The problem

Today every ⌃⌃ voice turn pays for a model round trip to decide *what the user meant*.

The wire, as built (`examples/god/god.mjs`):

1. Swift `spawnGod` (`packages/menubar/RelayMenuBar.swift:3835`) launches `god.mjs act "<ask>"`
   with `GOD_AUDIO=<wav>` and (for a plain ⌃⌃) `GOD_NO_SCREEN=1`.
2. `ask()` (`god.mjs:714`) transcribes the clip via `claude_transcribe` (`god.mjs:719-723`) —
   this is **already on-device** (the daemon routes it to Flow's local whisper through
   `RELAY_STT_CMD`, `packages/sidekick/src/media/stt.ts:27`).
3. `ask()` then builds a system prompt that includes `catalogBlock()` (`god.mjs:110-139`) — the
   whole store shelf + a HARD RULE telling the model to emit `[DRIVE:<id> <input>]` / `[RUN:…]`
   / `[OPEN:…]` — and calls **`claude_complete`** (`god.mjs:804`).
4. `parseAction()` (`god.mjs:183`) lifts the tag; on a `drive` the answer is handed to Swift via
   `~/.relay/god-action.json` (`god.mjs:256`) → `checkPendingAction` → `executeGodAction`
   (`RelayMenuBar.swift:3712`) → `driveWrappLive` / `driveSkillHeadless`.

Step 3 is the cost. For "open the canvas" or "gist this paragraph" the model is doing a
lookup the machine could do in microseconds against `catalog.json` + `tools.json`, which are
already sitting on disk (`~/.relay/catalog.json`, read by both `catalogBlock()` and Swift's
`readCatalog()`).

**Insight:** transcription is *not* the slow part (local whisper, warm). The **intent-resolution
model call is** (~1.5–4 s + variable network, even on the warm-cached `god-native` session). The
whole model call is skippable for the deterministic cases.

## The shape

```
⌃⌃ speak ──▶ god.mjs
                │  claude_transcribe  (local whisper — unchanged, ~0.5–1.5s)
                ▼
          transcript "open prism"
                │
        ┌───────┴────────────────────────────┐
        ▼ routeLocally() (pure JS, <5ms)      │
   confident?                                 │ not confident / risky / screen present
        │ yes                                 ▼
        ▼                              ask()  → claude_complete  (the model, as today)
   emit the SAME action contract        │
   (god-action.json drive|open,         ▼
    or speak-and-exit for memory)   parseAction → drive / run / open …
        │
        ▼
   Swift executeGodAction (unchanged) → daemon gate + audit → user's Claude
```

The fast path emits the **exact same output contract** the model path already produces, so
nothing downstream changes: a confident match writes `~/.relay/god-action.json` with
`{kind:"drive", wrapp, command, input}` (or `{kind:"open", target}`) and exits — the identical
handoff `runAction()` uses today (`god.mjs:254-258`). The daemon still gates and audits the
resulting tool call. **The fast path skips the intent model, not the broker.**

## Where it lives

**A new pure module: `examples/god/lib/router.mjs`.** Reasons:

- The routing brain already lives in `god.mjs` (JS), and JS already holds the transcript at the
  moment we need to decide. Swift stays dumb (it just executes `god-action.json`, as now).
- A pure module mirrors `lib/persona.mjs` / `lib/companion.mjs` and is unit-testable headless
  with **no daemon, no model** — the same discipline as `hands.test.mjs` (which pins
  `parseAction`). Add `examples/god/router.test.mjs`.
- **Not** a pre-transcribe Swift step: we need the transcript first, and duplicating fuzzy-match
  + the verb tables in Swift would drift from the JS grammar (the `keyComboOsa`/`executeGodAction`
  duplication between `god.mjs` and Swift is already a maintenance tax — don't add more).

Insertion point in `god.mjs`: hoist transcription out of `ask()` into a small `transcribe(reg)`
helper, call it first, then `const hit = routeLocally(transcript, catalog, table)`. If `hit` →
short-circuit (write handoff / speak one line / exit). Else → `ask()` exactly as today with the
transcript already in hand (pass it in so we don't transcribe twice).

Gate the whole thing on **no-screen turns only**: if the user grabbed a screen (`!GOD_NO_SCREEN`,
i.e. an fn-click/-drag was staged), they want vision reasoning — always fall through. Kill-switch:
`GOD_NO_FASTPATH=1`.

## The matcher (`routeLocally`)

Deterministic, layered, confidence-scored. Returns `{intent, target, command, input, score}` or
`null`.

1. **Normalize** — lowercase, strip trailing punctuation and leading filler ("um", "hey",
   "please", "can you"), collapse whitespace. Whisper-artifact fixes (e.g. "prism"↔"prison",
   "gist"↔"just") come from the compiled table's misrecognition list (below).

2. **Intent verb detection** — small closed tables:
   - `OPEN`  → {open, launch, start, go to, bring up, pull up, show me}
   - `RUN`/`DRIVE` → {run, use, do a, give me a} + the command verbs harvested from the table
     (gist/summarize, rephrase, translate, name, …).
   - `MEMORY` → {remember, note that, jot down, add … to (memory|bank|my notes), save … to bank}.

3. **Target resolution** against the compiled routing table:
   - exact `id` or `name` hit → score 1.0
   - alias / phrase hit → score 0.9
   - fuzzy (token-set ratio + Dice/Levenshtein on the residual after the verb) → score = ratio.
   - **Ambiguity guard:** compute top-2 candidates; if `score1 - score2 < MARGIN` → return `null`
     (fall through). Never guess between two close wrapps.

4. **Confidence gate:** confident iff `score1 ≥ HI` **and** `margin ≥ MARGIN` **and** (an intent
   verb was present **or** the whole transcript is a bare exact wrapp-name hit like "canvas").
   Tunable starting points: `HI = 0.82`, `MARGIN = 0.15`.

5. **Input extraction:** the residual after removing the verb + target is the `input`
   ("gist **this email**" → input "this email"; deixis like "this"/"that" stays as-is — the wrapp
   already resolves selection/clipboard). For bare "open X" there is no input.

## The offline compiler (the founder's "Claude runs a pass over offline objects")

The hot path must never call a model — so the model works **offline, in batch, over the static
catalog**, not over the live utterance. A new build step:

**`examples/apps/wrapps/build-routing.mjs`** (sits beside `build-catalog.mjs` / `build-tools.mjs`).
It reads `catalog.json` + `tools.json` and runs **one model pass** that, per wrapp + per command,
expands the terse tagline/description into a routing entry:

```json
{
  "prism": {
    "id": "prism", "name": "Prism", "intent": "drive",
    "command": "imagegen_generate",
    "phrases": ["make an image", "generate a picture", "illustrate this", "draw me"],
    "aliases": ["image gen", "picture maker"],
    "misheard": ["prison", "prisma"]
  },
  "gist": { "id": "gist", "intent": "drive", "command": "gist_run",
    "phrases": ["summarize", "tldr", "give me the gist", "sum this up"], "misheard": ["just"] }
}
```

Writes `examples/apps/wrapps/routing.json`. The menubar aggregates it into
`~/.relay/routing.json` the same way it already aggregates `~/.relay/catalog.json`, so
`router.mjs` loads a single local file (fall back to a hand-written seed derived from
`catalog.json` ids/names when the compiled file is absent).

**Recompile triggers** (never per-utterance):
- build time — whenever the catalog is rebuilt;
- **on install** of a new wrapp from the store (the catalog changed → regenerate/patch just that
  entry);
- nightly / periodic;
- **a miss-log feedback loop:** every fall-through appends `{transcript, modelChose}` to
  `~/.relay/god-route-misses.jsonl`; a periodic compile folds resolved misses back in as new
  `phrases`/`misheard`, so the table *learns* the user's phrasing without ever touching the hot
  path. This is the honest version of "the model improves routing": it improves the **table**,
  offline.

## Latency

| turn | today | fast path |
|---|---|---|
| transcribe (local whisper, warm) | ~0.5–1.5 s | ~0.5–1.5 s (unchanged) |
| **intent resolution** | **`claude_complete` ~1.5–4 s + network** | **`routeLocally` <5 ms** |
| handoff → widget | same | same |

For "open Prism" / "gist this" / "add X to memory" the perceived latency collapses to
**transcription-only** — the entire model round trip disappears. The wrapp's *own* work (a drive
that then calls the user's Claude) is unchanged; we only removed the meta-call that decided which
wrapp.

## Honesty — never mis-fire a destructive action

1. **The fast path handles only non-destructive intents:** `open`, `drive`/`run` of a read-class
   wrapp, and `add-to-memory` (an append). It **never** handles the risky verbs. Reuse the
   existing `RISKY` regex (`god.mjs:291`: send/delete/pay/publish/submit/…) — if the transcript
   trips it, force fall-through to the model + the existing consent gate. A destructive intent is
   *always* model-reasoned and *always* gated.
2. **Ambiguity falls through, never guesses** — the two-candidate margin guard (step 3) means a
   near-tie goes to the model rather than firing the wrong wrapp.
3. **The broker is untouched.** A fast-path drive still runs through `driveWrappLive` → daemon
   grant + audit. We skip the *intent model*, not consent/audit.
4. **`add-to-memory` writes, so it must be legible + undoable.** Even though it's non-outward, the
   fast path speaks back exactly what it captured ("Added to your bank: '<x>'") and supports an
   "undo that" fast-intent. **Prerequisite gap:** Bank today exposes only `bank_ask` (read;
   `examples/apps/src/bank.js:1238`) — there is **no write tool**. A deterministic memory intent
   needs a new `bank_add` (`exposeToGod`, appends to the vault) or a direct vault-file append.
   Until that lands, "add to memory" must fall through to the model.
5. **Every fast decision is as loud as a model decision.** Stamp a greppable marker via `loud()`
   (`god.mjs:95`), e.g. `⚡ fast-route → drive prism "…"`, in `god-run.log`, and surface the
   spoken line in `god-last-answer.txt` (`surfaceAnswer`, `god.mjs:101`). A wrong fire is
   greppable and feeds the miss log.

## Phased plan

- **Phase 0 — seam, no behavior change.** Hoist transcription out of `ask()` into `transcribe(reg)`
  called before the pipeline; thread the transcript into `ask()` so it isn't re-transcribed. Add
  `GOD_NO_FASTPATH` kill-switch and the `⚡`/miss-log telemetry. Ships dark.
- **Phase 1 — seed router, the 80% cases.** `lib/router.mjs` with a **hand-written seed table**
  derived from `catalog.json` (ids/names/obvious aliases) + the verb tables + fuzzy match. Wire the
  short-circuit for `OPEN`, bare exact wrapp-name, and single-command `DRIVE`/`RUN` on no-screen
  turns. Add `router.test.mjs` (mirror `hands.test.mjs`) pinning the confidence gate and the risky
  fall-through. No compiler, no model — pure win immediately.
- **Phase 2 — offline compiler.** `build-routing.mjs` → `routing.json`; menubar aggregates to
  `~/.relay/routing.json`; router prefers it, seed is the fallback. Recompile on catalog rebuild +
  on install.
- **Phase 3 — memory intent.** Add the Bank write tool (`bank_add` + vault append) and the
  `remember/add-to-memory` fast intent with confirm-echo + undo.
- **Phase 4 — feedback loop.** Miss-log → periodic recompile folds resolved misses into the table;
  surface a hit-rate count in the store dashboard.

## Files touched (map)

- `examples/god/god.mjs` — hoist `transcribe()`; call `routeLocally()`; short-circuit emitting the
  existing `god-action.json` contract; `⚡` markers. Export `routeLocally` for tests.
- `examples/god/lib/router.mjs` — **new.** Pure matcher + table loader (`~/.relay/routing.json` →
  seed fallback).
- `examples/god/router.test.mjs` — **new.** Headless unit tests.
- `examples/apps/wrapps/build-routing.mjs` — **new.** Offline compiler → `routing.json`.
- `examples/apps/src/bank.js` — **new** `bank_add` tool (Phase 3).
- `packages/menubar/RelayMenuBar.swift` — aggregate `routing.json` into `~/.relay/` alongside the
  catalog (Phase 2). **No change to `executeGodAction`** — the handoff contract is reused as-is.
