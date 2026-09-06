# Native apps, web apps and local models

An app does not have to ship inside Switchboard. Web apps use the browser extension;
independent native processes use a separate loopback WebSocket and their own app token.
Both reach the same model routing, permissions, private storage and context library.

| Capability | Web app | Standalone native app |
| --- | --- | --- |
| Discover available models and permitted default | Yes | Yes |
| One-shot Claude Code, Codex or local text | Yes | Yes |
| Local transcription and speech | Yes, when configured | Yes, when configured |
| Private storage and lent context | Yes | Yes |
| Explicit connector calls | Through granted tools | Through granted tools |
| Warm sessions | Claude Code / Codex | Claude Code / Codex |
| Streaming / cancellation transport | Yes | Not implemented; omitted from native discovery |
| Model-change notifications | Yes | Yes |

Transport support and model support are separate. Ollama currently supports text
completion only: no vision, tool loop or warm sessions. Apps should check `modelInfo`
and the transport's `methods` before offering those features.

## Local text and voice

Switchboard probes Ollama's default `http://127.0.0.1:11434/v1` endpoint automatically.
Models already installed and served there appear in discovery and model selection.
`RELAY_LOCAL_OPENAI_URL` selects another compatible endpoint; `RELAY_LOCAL_OPENAI=0`
disables discovery. Switchboard does not download a model as part of discovery.

Voice is separate from the text-model picker. `capabilities.local.tts` reports a local
speech engine, and optional `capabilities.local.stt` reports a configured recognizer.
Configuration is not a guarantee that a missing binary or model file can execute;
handle request failures. The Mac launcher configures the installed local speech path;
a development daemon can use `RELAY_WHISPER_BIN` and `RELAY_WHISPER_MODEL`.

```js
const caps = await relay.capabilities();
if (caps.local?.stt) {
  // Audio captured by the app with the user's microphone permission.
  const { text } = await relay.transcribe(audioDataUrl, { language: "en" });
  const result = await relay.complete({ model: selectedModel, prompt: text });
  // Local output is optional and independent of the chosen text model.
  if (caps.local.tts) {
    const clip = await relay.speak(result.text);
    if (clip) new Audio(clip.audio).play();
  }
}
```

Transcription and speech require app permission as well as engine availability. Their
audio input/output uses inline data URLs. The SDK does not request microphone access.
Keeping transcription local does not make a subsequent Claude/Codex call local:
the transcript goes to the text provider selected for that request.

## Native connection

Enable `RELAY_NATIVE=1` for a development daemon. The separate native listener defaults
to `ws://127.0.0.1:8788`; `RELAY_NATIVE_PORT` overrides it. Send no HTTP `Origin` header:
the endpoint rejects browser-origin connections. Web pages must use the extension.

The first message from a new native app is:

```json
{"type":"requestConnect","appId":"dev.example.voicepad","name":"Voicepad","reason":"Turn dictation into a note"}
```

Switchboard presents consent outside the app. Approval returns a `registered` frame
with the per-app token and permitted models. Store the token in the OS credential
store. On reconnect send `{"type":"auth","token":"<this app's token>"}` and wait for
`auth_ok`. Never read or reuse the extension's pairing token.

An authenticated request has this shape:

```json
{"type":"request","id":"request-1","method":"claude_capabilities","params":{}}
```

Responses contain the same `id` and either `result` or `error`. Events arrive as
`{"type":"event","event":"capabilitiesChanged","payload":{...}}`; refresh discovery
on that event and on reconnect. Tokens determine the `native@<appId>` principal;
caller-supplied origins and app IDs cannot override it. Revocation invalidates the
token on an already-open socket as well as on reconnect.

Initial interactive consent grants enabled models and local voice. Connector access
requires additional scope granted through Switchboard's trusted control surface;
native `claude_permissions` reads scope but does not expand it. Initial app names
and IDs are self-declared, not OS code-signature verified.

`claude_storage` is private to the app. `claude_context` can publish an app-owned
context or request a picker to borrow another app's context. Borrowing does not
grant permission to overwrite the producer's context. Connection and folder consent
use the native menubar, with the extension as fallback. Context pickers and connector
write approvals currently require the paired extension's consent UI; the menubar does
not yet implement those cards.

## Connectors and provider boundaries

Claude Code can use runtime tools and inherited connectors. Switchboard also imports
local Claude MCP configuration. Codex currently receives Switchboard's gated MCP
tools; its account apps/connectors are not automatically inherited. A matching
connector must be configured and granted before either app transport can use it.
Local text models do not currently invoke connector tools themselves.

## Reproduce the standalone proof

Install/start Ollama with `llama3.2:1b`, install `whisper-cli` and a compatible local
Whisper model, and ensure Swift command-line tools are available. Then run:

```sh
npm run build -w @relay/protocol
npm run build -w @relay/sidekick
RELAY_WHISPER_BIN=/path/to/whisper-cli \
RELAY_WHISPER_MODEL=/path/to/ggml-base.en.bin \
node examples/native/proof/run-local.mjs
```

`SWITCHBOARD_TEST_MODEL` can select another installed Ollama model. The proof compiles
[VoicepadSmoke.swift](../examples/native/VoicepadSmoke.swift), a Foundation-only client
with no Switchboard imports. It launches an isolated packaged daemon, tests real local
text and synthetic speech, and uses a synthetic consent handler restricted to test
app identities. A headless extension client checks web interoperability, context
lending and private-data isolation. It also tests token identity, revocation and
browser-origin rejection. Reports and daemon state are private temporary files.

This is a protocol/integration check, not a signed native app installation or browser
UI test or an evaluation of a local model's writing quality. Completion checks require
the selected model, nonempty generated text and recorded output tokens; tiny models
do not reliably follow arbitrary exact-token echo instructions. It does not replace
the checked-in Mac app bundle.
