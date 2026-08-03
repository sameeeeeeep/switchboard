# The local voice stack — STT + TTS today, and the FTUX gap

**Status:** research / design. Captures (A) how local voice installs and runs today, the
first-run gaps, and a proposed consumer-grade FTUX; and (B) an evaluation of Collabora
**WhisperSpeech** as a TTS contender. No code changed to produce this.

Companion to `docs/VOICE-CAPABILITY.md` (the capability-layer reframe), `docs/DICTATION.md`
(Flow as a wrapp), and `docs/GOD.md`.

---

## A. Current state

### The engines we actually use

| Lane | Engine today | Where |
|---|---|---|
| **STT (fast)** | **whisper.cpp** (`whisper-cli`/`whisper-cpp`) + a ggml `.bin` model | `packages/sidekick/src/media/stt.ts` → `viaWhisperCli`; detected in `RelayMenuBar.swift` L90-96 |
| **STT (fallback)** | **openai-whisper** Python CLI, `--model tiny`, via the bundled adapter | `examples/flow/whisper-stt.mjs`, wired as `RELAY_STT_CMD` in `RelayMenuBar.swift` L83-85 |
| **STT (BYO)** | OpenAI-shape local server (`RELAY_LOCAL_STT_URL`) | `stt.ts` → `viaServer` |
| **TTS (cloned)** | **Kyutai Pocket-TTS on MLX** (`pocket-tts-mlx`), persistent LaunchAgent `com.relay.godtts` on `:7897` | `examples/god/tts/god-tts-server.py`; `speech.ts` → `viaGod` |
| **TTS (BYO)** | OpenAI-shape local server (`RELAY_LOCAL_TTS_URL`) — Kokoro/Piper/openedai-speech | `speech.ts` → `viaServer` |
| **TTS (universal fallback)** | macOS **`say`** → WAVE | `speech.ts` → `viaSay` |

The daemon exposes both to every principal via `claude_transcribe` / `claude_speak`
(`packages/sidekick/src/server.ts` L275-345), audited, no per-call consent. `sttAvailable()`
and `ttsAvailable()` gate them.

**How selection works.** STT is a strict env-var precedence: `RELAY_LOCAL_STT_URL` →
`RELAY_WHISPER_BIN` → `RELAY_STT_CMD` (`localSTT`). TTS tries cloned-voice → local server →
`say` (`localTTS`). Cloned voices are a filesystem fact: any `~/.relay/voices/<name>.wav`
(minus `-full`) is a voice; `~/.relay/voices/selected` picks the default.

### What ships in the DMG (and what does NOT)

- **Bundled:** the daemon, `god/whisper-stt.mjs` (adapter only — `package-dmg.sh` L91-93),
  the bundled Node, and `say` (OS). The base DMG is deliberately lean (~110 MB).
- **NOT bundled / not auto-installed:** whisper.cpp, any ggml model, `openai-whisper`,
  `ffmpeg`, and the entire Pocket-TTS MLX engine (~373 MB venv + ~434 MB weights).

### What first-run actually is for a non-technical user

**STT (God's ear / ⌃⌥ dictation):**
- The plist always sets `RELAY_STT_CMD` → `whisper-stt.mjs`, so `sttAvailable()` returns
  **true even on a fresh Mac**. But that adapter shells the `whisper` binary
  (`openai-whisper`), which **is not installed** → the call fails at runtime, not at the
  gate. STT looks available and then errors.
- The fast path (`whisper.cpp` + ggml model) is **auto-detected on fixed paths only**
  (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.relay/models/*.bin`) at plist-write time. A
  fresh Mac has neither.
- The ⌃⌥ dictation gesture fails **loud but terminal**: `startDictation()` (L3524-3527)
  toasts *"Dictation needs whisper.cpp — brew install whisper-cpp + a ggml model in
  ~/.relay/models"*. Honest, but it hands a non-technical user a Homebrew command and a
  manual model download. There is **no in-app installer**.

**TTS (God's voice):**
- `say` always works, so God can always speak in a generic macOS voice with zero setup.
- **Cloned voices are effectively unreachable for a normal user.** The installer
  `examples/god/tts/install-voice-engine.sh` exists and is complete (builds the MLX venv,
  installs `pocket-tts-mlx`, writes + boots the LaunchAgent, warms the model) — but
  **nothing in the app ever runs it.** No button, no menu item, no store action. Confirmed:
  the only references to `install-voice-engine.sh` are in docs.
- So the Settings drop-zone (`dropVoices`, L2558) writes the `.wav`, POSTs `/clone` to
  `:7897`, gets connection-refused, and now (post-fix) correctly deletes the phantom `.wav`
  and toasts *"Voice cloning isn't set up — the voice engine (:7897) isn't running"*
  (`voiceEngineHint`, L2607). Honest, but a **dead end** — the toast names the problem and
  offers no way to fix it. Voice cloning also silently requires `hf auth login` + accepting
  the gated `kyutai/pocket-tts` terms, a pure-terminal prerequisite.

**Net:** the base voice experience (say + a loud "install whisper" toast) works and is
honest, but **every upgrade path — fast STT, and any cloned voice — requires a terminal**,
and the one polished installer we have is unwired.

### The gaps, precisely

1. **No in-app installer for anything.** whisper.cpp, the ggml model, and the MLX TTS
   engine all require the user to open a terminal. `install-voice-engine.sh` is written and
   unused.
2. **STT gate lies.** `RELAY_STT_CMD` makes `sttAvailable()` true when the underlying
   `whisper` binary is absent; the failure is deferred to synth time.
3. **No cost/size disclosure.** Nothing tells the user a voice engine is ~373 MB + ~434 MB
   of weights, or that fast STT needs a model download.
4. **Gated-weights step is invisible.** `hf auth login` + license acceptance is a silent
   terminal prerequisite for cloning.
5. **The capability isn't surfaced.** `sb_speak` is in the enum
   (`packages/protocol/src/store.ts` L54) but the store's NEEDS/fill drawer is unbuilt
   (`caps: []`), so nothing offers to provision voice from the UI.

### Proposed consumer-grade FTUX (no terminal, opt-in, honest about cost)

Frame both installs as **one capability the platform provisions**, per `VOICE-CAPABILITY.md`
— but make it real with a daemon-side installer and honest states.

- **Move the installers behind a daemon RPC.** Wrap `install-voice-engine.sh` (TTS) and a
  parallel `install-stt.sh` (fetch a static `whisper-cli` + a `base.en` ggml model into
  `~/.relay/models`) as `capability.install` verbs with **streamed progress**. No shelling
  out from the user; the menubar just calls the daemon and renders the stream.
- **One "Voice" card in Settings with truthful states**, mirroring the states ladder:
  `not-installed → downloading (N MB, live progress) → needs-weights (one-tap HF sign-in +
  license accept, not a copy-paste command) → warming → ready → error`. Show the size
  (**"Fast dictation — 150 MB"**, **"Your own voice — ~800 MB"**) *before* the download so
  cost is opt-in and informed.
- **Fix the STT gate.** `sttAvailable()` should probe that the `RELAY_STT_CMD` binary
  actually resolves (or that whisper.cpp is present), so "available" means "will work." The
  dictation toast becomes **"Install fast dictation (150 MB)"** with a button, not a brew
  command.
- **Drop-zone becomes progressive.** If `:7897` isn't up, `dropVoices` offers **"Set up
  voice cloning"** (runs the streamed install) instead of only reporting the engine is
  missing — then proceeds with the clone it already does.
- **Keep `say` as the always-there zero-setup voice** so nothing is ever fully blocked; the
  installs are pure upgrades.
- **Gate the weights step honestly** as its own rung with an in-app HF auth handoff, not a
  hidden prerequisite.

The whole point: today the honest failure messages are dead ends. Making each one a **button
that runs a streamed, size-disclosed, daemon-side install** turns the existing (already
correct) engines into a one-tap consumer flow, and makes voice the pilot provider for the
store's Phase-2 fill drawer.

---

## B. WhisperSpeech as a TTS contender

**What it is.** Collabora + LAION's open TTS "built by inverting Whisper": Whisper encoder →
semantic tokens → an EnCodec (Meta) acoustic layer → Vocos vocoder, with one-shot voice
cloning. Aims to be "Stable Diffusion for speech."

| Dimension | WhisperSpeech | Finding |
|---|---|---|
| **License (code)** | Apache-2.0 / MIT | Clean. |
| **License (weights)** | trained on "properly licensed data"; project *claims* commercial safety — **but the pipeline depends on Meta's EnCodec**, whose original weights ship CC-BY-NC (non-commercial). | ⚠️ A real caveat to verify before any commercial ship — arguably *worse* legal footing than our current gated-but-permitted Kyutai weights. |
| **Model size** | multi-model stack: a Whisper (small/medium) encoder + T2S & S2A transformers + EnCodec + Vocos | Heavier footprint than a single MLX model; no single quoted size, but clearly > our 373 MB engine once all stages load. |
| **Apple-Silicon feasibility** | **No official MLX / CoreML / Metal path.** PyTorch (CUDA/MPS/CPU). | ✗ The headline number (12× real-time) is on an **RTX 4090**, a discrete GPU. On M-series it runs via MPS/CPU with no purpose-built kernels. |
| **Latency (cold/warm)** | 12× RT on a 4090; unquantified on Mac. Cold start loads 3–4 models. | On Apple Silicon expect **near or below real-time and a heavy cold start** — the opposite of what we need. |
| **Quality** | Good, natural; well-regarded for an open model. | Comparable class to Pocket-TTS; not a decisive win. |
| **Voice cloning** | Yes — one-shot from a short reference clip. | Matches what we already have. |
| **Maturity** | 4.6k stars; **last meaningful release ~June 2024**, effectively dormant ~2 years; promised multilingual never fully landed. | ✗ Maintenance risk; stale. |

### What we run today, for comparison
**Kyutai Pocket-TTS on MLX** (`pocket-tts-mlx`): Metal-native, ~373 MB venv, warm synth
~3× real-time, clone ~0.02 s, with an Ollama-style keep-warm loop (`GOD_TTS_KEEP_WARM`,
`god-tts-server.py` L196-214). Its one wart is a ~22 s first-synth Metal cold-compile,
already mitigated by keep-warm. Plus `say` as the universal fallback.

### Recommendation: **SKIP** (do not replace; not worth complementing)

Tied to our constraints:

1. **"Never slow the user's device."** WhisperSpeech has **no native Apple-Silicon path**;
   its speed story is a discrete NVIDIA GPU. On a MacBook it would be a torch/MPS multi-model
   load — heavier and likely slower than the Metal-native engine we already run. This is the
   single disqualifying fact.
2. **Warm keep-alive.** Our win comes from one MLX model held warm on a dedicated Metal
   thread. WhisperSpeech's 3–4-stage torch pipeline is a worse fit for a cheap keep-warm loop.
3. **No new capability.** Its headline feature — one-shot cloning — is exactly what
   Pocket-TTS already gives us, with no latency or footprint advantage on our hardware.
4. **Legal.** The EnCodec dependency is a non-commercial gray area; adopting it *adds* license
   risk rather than removing the Kyutai gating.
5. **Maturity.** Dormant since mid-2024; multilingual never shipped.

**The only scenario to reconsider:** a CPU-only / Intel-Mac (non-Metal) cloning path, where
MLX can't run at all. Even then it's marginal — `say` covers zero-setup TTS everywhere, and
the BYO `RELAY_LOCAL_TTS_URL` lane already accepts any OpenAI-shape server (Kokoro/Piper) for
users who want cross-platform local TTS. WhisperSpeech doesn't earn a slot over those.

If we ever want a *better* clone on Apple Silicon, the productive direction is another
**MLX-native** TTS (the `mlx-audio` ecosystem, e.g. Kokoro-on-MLX) behind the same `:7897`
contract — not a torch pipeline optimized for a 4090.

### Sources
- https://github.com/WhisperSpeech/WhisperSpeech
- https://huggingface.co/collabora/whisperspeech
- https://snyk.io/advisor/python/whisperspeech (last-release dating)
- https://github.com/Blaizzy/mlx-audio (MLX-native TTS alternative)
