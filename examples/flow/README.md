# Flow — dictation, the Wispr-Flow way, as a *native* Switchboard app

Hold a key, talk, and clean text lands at your cursor. The twist: **Flow ships no AI.** It's a thin
shell that borrows *your* machine's intelligence through the Switchboard daemon — proving the
"beyond web apps" path. No browser, no API key, no bundled model.

```
  mic  ──▶  daemon claude_transcribe  ──▶  daemon claude_complete  ──▶  your cursor
           (local whisper, on-device)      (local model if present,      (paste)
                                            else your own Claude)
```

**100% on-device (optional):** cleanup — stripping *um/uh* and fixing punctuation — is pure text,
so it runs on a small LOCAL model when one is available. Install [Ollama](https://ollama.com) and
pull a tiny model (`ollama pull llama3.2:1b` or `qwen2.5:0.5b`); Flow auto-picks it and the pill
reads "on-device." With no local model it falls back to your Claude, and if that's unavailable it
ships the raw transcript — dictation never fails. Point `cleanupModel` in `~/.flow/config.json` at a
specific model to pin it.

Flow authenticates as its own least-privilege principal, `native@ai.thelastprompt.flow`, over the
daemon's **native listener** (a per-app token, never the browser's pairing key). It can only ever
act as itself.

## What it demonstrates

- A **local app talks straight to the daemon** — the extension/browser is not involved.
- Speech-to-text runs **on-device** (`whisper`), reached via the gated `claude_transcribe` verb.
- The "Flow magic" — stripping *um / uh / you know* into clean prose — runs on **your own Claude**
  via `claude_complete`, gated by the same broker as every web wrapp.
- The app holds **no key and no model**; setup grants it a scoped, revocable identity.

## Requirements (all local, no cloud)

| Need | Install |
|------|---------|
| `ffmpeg` (mic capture) | `brew install ffmpeg` |
| `whisper` (on-device STT) | `pip install openai-whisper` |
| macOS `say`, `osascript`, `pbcopy` | built in |

Build the daemon once: `npm run -w @relay/sidekick build`.

## Run it

```bash
# No mic needed — macOS `say` generates rambly speech, runs the whole pipeline, prints before/after:
node examples/flow/flow.mjs demo "um so I think we should uh ship on friday you know"

# The real thing — push-to-talk mic, pastes cleaned text at your cursor:
node examples/flow/flow.mjs run
```

`run` is push-to-talk: ENTER to start recording, speak, ENTER to stop. The cleaned text is copied to
your clipboard and auto-pasted into the frontmost app (grant your terminal **Accessibility** for the
auto-paste; otherwise it's on the clipboard to ⌘V yourself).

## How it's wired

- **Setup (once):** `flow.mjs` reads the daemon's pairing token and calls the `registerNativeApp`
  control action — the native equivalent of the connect-consent. That mints Flow's per-app token
  (saved 0600 in `~/.flow/token.json`) and a grant for the local capabilities + your online models.
- **Every run after:** Flow uses only its per-app token on the native socket. Least privilege.
- **STT backend:** the daemon runs whatever `RELAY_STT_CMD` points at; Flow points it at
  [`whisper-stt.mjs`](whisper-stt.mjs) (audio path in → transcript out). Swap in Apple's Speech
  framework or a whisper.cpp server by changing that one env var — nothing else moves.

For a self-contained demo, Flow manages its **own** daemon instance (private `~/.flow/relay`, ports
8795/8796) so it never touches your real `~/.relay`. In production it would attach to the menubar
daemon once that ships STT configuration.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `FLOW_MIC` | `:0` | avfoundation audio device (`ffmpeg -f avfoundation -list_devices true -i ""` to list) |
| `FLOW_WHISPER_MODEL` | `tiny` | whisper model (`tiny`/`base`/`small`…) |
| `FLOW_PORT` / `FLOW_NATIVE_PORT` | `8795` / `8796` | Flow's private daemon ports |
| `FLOW_HOME` | `~/.flow` | Flow's state (token + private daemon dir) |
