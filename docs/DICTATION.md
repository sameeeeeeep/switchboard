# Dictation is a wrapp, not a feature

**Status:** Stage 1 ships today; Stage 2 is a capability refactor; Stage 3 is the
Wispr-grade product. Flow is now a real store listing
(`examples/apps/wrapps/flow/switchboard.json`, native UI kind, appId
`ai.thelastprompt.flow`) — you *install* dictation from the store like any other wrapp.

## Why this framing

Wispr Flow is a whole company built on one loop: hold a key → speak → clean text at your
cursor. We already ship that loop in pieces — but as hardcoded app behavior, not as a
thing a user chose. Making Flow a listing does three jobs at once:

1. **Doctrine.** A wrapp = capabilities + a prompt. Dictation is the purest case: one
   capability chain (mic → STT → polish → paste) and one cleanup prompt. If dictation
   can't be expressed as a wrapp, the capability layer is wrong.
2. **Honesty.** A listing declares `requires` (`daemon` + the native app) and the store's
   resolver shows what's missing — instead of a gesture that silently exists or doesn't.
3. **The native-app-store mold.** Flow is the second native listing shape after God: a
   `.app` that talks to the daemon as a least-privilege principal
   (`native@ai.thelastprompt.flow`), never holding a key of its own.

## Stage 1 — what already ships

- **The gesture.** Hold the talk chord (default ⌃⌥, rebindable via
  `~/.relay/shortcuts.json`) → record → whisper.cpp on-device → raw transcript pasted at
  the cursor. Lives in `packages/menubar/RelayMenuBar.swift`
  (`startDictation` / `stopDictationAndPaste`, ~line 2963). No God, no LLM cleanup — and
  it fails loud when whisper.cpp or a ggml model is missing.
- **The full pipeline, proven.** `examples/flow/flow.mjs` runs mic →
  `claude_transcribe` (local whisper via the daemon) → `claude_complete` cleanup on
  *your own* Claude or a local ≥3B model (tiny models hallucinate rewrites — see
  `pickCleanupModel`) → paste. It registers once, then runs on a per-app token only.
  `examples/flow/mac/Flow.swift` is the native shell.

The gap between the two IS the roadmap: the menubar gesture is raw-transcript-only; the
cleanup lane exists but only in the Flow client.

## Stage 2 — transcribe + polish as a shared capability

The daemon already exposes STT to every principal: `claude_transcribe` in
`packages/sidekick/src/server.ts` (~line 329) → `localSTT` in
`packages/sidekick/src/media/stt.ts`, with three backends (an OpenAI-shape local server
via `RELAY_LOCAL_STT_URL`, a whisper CLI via `RELAY_WHISPER_BIN`, and the generic
`RELAY_STT_CMD` escape hatch). Audio arrives as an inline data: URL and never leaves the
machine; every call is audited.

Stage 2 = stop duplicating:

- The menubar gesture calls `claude_transcribe` instead of shelling whisper itself, so
  the MediaRegistry's auto-detection is the one place STT is found.
- **Polish becomes a rung, not an app.** The cleanup prompt (`CLEANUP_SYSTEM` in
  `flow.mjs`) + model-pick policy move behind one daemon lane — `transcribe+polish` —
  that any wrapp can request like `sb_speak`. Same consent gate, same audit line.
- One shared **dictionary** (names, jargon, casing) applied at the polish step, stored in
  the `.md` storage dialect so it's user-ownable and vault-syncable.

## Stage 3 — Wispr-grade: the Flow sidebar

The installed Flow app grows from a gesture into a workspace. Sidebar:

| Section | What it is | Built on |
|---|---|---|
| **Dictation** | the live surface: hold-to-talk, per-app tone targets, history of pastes | Stage-2 lane + audit log |
| **Insights** | words/day, WPM vs typing, top apps dictated into — honest, local-only stats | daemon audit records |
| **Dictionary** | proper nouns, jargon, forced spellings fed to polish | shared dictionary `.md` |
| **Snippets** | say "sign off" → your signature block expands | storage dialect files |
| **Style** | per-destination voice (Slack-casual vs doc-formal), learned from edits | per-wrapp `taste.md` pattern |
| **Transforms** | one-shot rewrites of the last utterance: "make it a bullet list", "translate" | `claude_complete` on the polished text |
| **Scratchpad** | dictate without a target app; text accumulates, then send anywhere | paste primitive, deferred |

Everything above is composition — no new privileged surface. The only new consent Flow
ever needs is the mic (native, at the OS layer) and the per-app token it already has.
That's the moat restated: Wispr runs your voice through their cloud; Flow runs it through
*nothing* — whisper on your Mac, cleanup on your own Claude, and a store listing you can
read.
