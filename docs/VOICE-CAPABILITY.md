# Extra voices as an installable capability (not a Settings button)

**Status:** design — decision captured, not yet built. Supersedes the "wire an *Enable
voice cloning* button into `voiceSection`" idea.

## Why this reframe

Baseline TTS already works on any Mac: `claude_speak` falls back to macOS `say`
(`packages/sidekick/src/media/speech.ts` → `viaSay`). "Additional voices" means **cloning**
through the MLX engine (`pocket-tts-mlx`) on `:7897`.

Two things are broken for a new user today:

1. **The installer is unwired.** `examples/god/tts/install-voice-engine.sh` builds the
   `~/.relay/tts-venv`, installs `pocket-tts-mlx`, and boots the `com.relay.godtts`
   LaunchAgent — but nothing in the app runs it. No button, no menu item, no CLI trigger.
2. **The drop-zone lies.** `dropVoices()` in `packages/menubar/RelayMenuBar.swift` `POST`s
   `/clone` to `:7897` with no error handling, then toasts "Voice ready" and selects the
   voice **even when the engine isn't installed** → the user silently gets `say` back.

The instinct was to add an "Enable extra voices" button in Settings. The better model —
and the one we're committing to — is that **extra voices are a capability a wrapp declares
and the store *fills***, exactly like `sb_db`/`sb_http`. `sb_speak` is already in the
capability enum (`packages/protocol/src/store.ts`). Voice cloning is just the first real
capability *provider*, surfaced through the same NEEDS → fill flow the store already draws.

This keeps Settings for *preference* (which voice God speaks in) and moves *provisioning*
(stand up the engine) to the capability layer where it belongs. It's the honest test of the
"a wrapp = a string of capabilities" doctrine: pick a capability, the platform installs its
provider, every wrapp that needs it now resolves.

## Shape

- **A capability provider `voice-cloning`** = the `pocket-tts-mlx` engine on `:7897`.
  Backs the `sb_speak` / cloned-voice need. Install action = `install-voice-engine.sh`;
  health = a probe of `:7897/voices`.
- **States, surfaced honestly** (this is the whole point):
  `not-installed → installing (streamed progress) → needs-weights → ready → error`.
  The gated-weights step (`hf auth login` + accept `kyutai/pocket-tts` terms) becomes an
  explicit rung with a copy-paste command, not a silent terminal prerequisite.
- **The store's NEEDS section becomes fillable.** Today `storePresent()` hard-codes
  `caps: []` ("fill drawer is Phase 2"). A wrapp declaring `sb_speak` (non-lazy) shows an
  unmet need whose primary action installs this provider. This is the first concrete reason
  to build the Phase-2 fill drawer, and voice-cloning is its pilot provider.
- **Settings `voiceSection` degrades to preference only.** The drop-zone must first probe
  `:7897`; if the capability isn't present it offers to add it (deep-link into the store's
  fill flow) instead of pretending the clone worked. Once present, dropping a sample clones
  and selects as it does now — but with real success/failure, not an unconditional toast.

## Fix regardless of the capability work (small, do-now-safe)

Even before the fill drawer exists, `dropVoices()` should **probe `:7897` and surface
failure** rather than toast "Voice ready" on a no-op. That closes the actively-misleading
bug independently of the larger reframe.

## Open questions

- Is `voice-cloning` its own store listing (a "capability wrapp") or an invisible provider
  a listing's NEEDS resolves to? Leaning: a provider with a thin listing so it's browsable
  and installable on its own, and also auto-offered when a wrapp needs it.
- Where does the install run — daemon-side (so it's headless + reusable) or menubar-side
  (it already shells out to `ffmpeg`/`curl`)? Leaning daemon, exposed as a capability RPC.
- Does `claude_speak` route through this provider for *all* wrapps once installed (set
  `RELAY_LOCAL_TTS_URL=http://127.0.0.1:7897` implicitly), closing the `docs/GOD.md` "Next"?

See also: `docs/CAPABILITIES.md`, `docs/GOD.md`, `docs/STORE-REDESIGN.md`.
