# Audio Journal: spec (draft, 2026-09-29)

**Summary.** Add an opt-in "ears" layer next to the screen journal. The mic feeds a tiny voice-activity detector (VAD). Only speech gets transcribed on the Mac by whisper.cpp, then labelled by speaker. The result is written as plain text into the **same** `~/.relay/journal/YYYY-MM-DD.jsonl`, so `switchboard_recall`, `memory.md` and live cards work without changes. No audio is ever saved. The layer is off by default. The default mode is "meetings only", the notch shows it is listening, and other people are told they are being transcribed. Recommended stack for an 8 GB M1: **sherpa-onnx** (Silero VAD + pyannote-segmentation-3.0 + a 3D-Speaker/CAM++ embedding) for VAD and speakers, plus the whisper.cpp + `ggml-base.en.bin` already on the machine for text. All resource numbers below are **estimates** until the Phase 0 benchmark runs.

## 1. Pipeline

```
mic (16 kHz mono, in-memory ring buffer ~30 s)
  → VAD (Silero, always on while armed; ~32 ms frames)
  → speech segment (cut at pauses; max 30 s)
  → whisper.cpp transcribe (base.en + dictionary prompt)     ┐ run on the same segment
  → speaker embedding → match "me" / named / "Speaker N"      ┘
  → journal entry {source:"audio", ...}  → buffer freed
```

**Capture.** A new `AudioJournal.swift` next to `ScreenJournal.swift` reuses the device selection and the 16 kHz mono PCM format in `DictationAudio.swift` (`DictationMicrophone`, `DictationRecorder`). Audio lives only in a RAM ring buffer. Silence is dropped frame by frame and never leaves the buffer.

**VAD.** Silero VAD runs on every frame while the layer is armed. It is the only part that is always on. whisper.cpp already includes Silero VAD (`--vad -vm ggml-silero-*.bin`; the installed `whisper-cli --help` lists these flags), but that path only works on files. Streaming needs VAD inside our process, so we use sherpa-onnx's Silero VAD through its Swift API.

**Transcription.** Each speech segment goes to whisper.cpp with the existing dictionary prompt (`readDictionaryPrompt`, same as `stt.ts`). Spawning `whisper-cli` for every segment reloads the ~148 MB model each time. Instead, keep one warm whisper instance (whisper.cpp's server via the existing `RELAY_LOCAL_STT_URL` path, or linked libwhisper) that runs **only while a session is active** and shuts down after 2 min of silence. If the CLI fallback is used, its temp WAV goes in a 0700 temp dir and is deleted as soon as the call returns. That file is the only moment audio touches disk, and it counts as "transient", not "stored".

**Diarization and identification. Options:**

| Option | Who spoke? | Fit for 8 GB M1 |
|---|---|---|
| **sherpa-onnx**: pyannote-seg-3.0 (ONNX) + 3D-Speaker / CAM++ embedding + clustering | Speaker turns **and** stable voice identity (embeddings), so "me" and named people can be matched | ~45 MB of models, C++ runtime, Swift API, no Python, not gated. **Recommended** |
| ECAPA embeddings alone (e.g. SpeechBrain) | Identity only, no overlap handling | Needs PyTorch/Python; the same idea is available inside sherpa-onnx without that stack |
| pyannote 3.1 | Best-known quality | Python + PyTorch, gated on Hugging Face (accept terms + token). Too heavy to keep resident next to everything else on 8 GB |
| whisper.cpp tinydiarize (`-tdrz`) | Marks speaker **turns** only (`[SPEAKER_TURN]`), no identity | Needs the `small.en-tdrz` model (bigger than base.en); described upstream as an experimental prototype. Could not answer "what did Priya say" |

**Why sherpa-onnx:** one small native library covers VAD, segmentation and embeddings. It adds no Python and no model gating. Identity comes from embeddings, which is what enrolment and naming need.

**Live vs. second pass.** *Live:* one embedding per speech segment (segments of 1.5 s or longer), matched by cosine similarity against enrolled voices and this session's clusters. Unknown voices become "Speaker 2", "Speaker 3" and so on. *Second pass (plugged in only):* when a session ends, run full pyannote-seg + clustering over the session's segments to fix overlaps and relabel. This means the session's segment audio stays in RAM until the pass finishes (capped, e.g. 60 min; longer sessions skip the pass). This is an open question.

**"Me" enrolment.** In a one-time notch card, the user reads ~20 s of text aloud. We store one averaged embedding (a list of numbers, not audio) in `~/.relay/voices.json` (0600). **Naming others:** after a session, a card asks "Speaker 2 said '…first line…'. Who is this?" with options *Name them / Skip / Don't remember this voice*. A name is stored as an embedding plus a label, and past lines are relabelled. A voice embedding counts as biometric-like data: it is local only, can be deleted, and is never synced.

**Journal entry: same file, same shape, plus fields:**

```json
{"t":"…","app":"Audio","bundle":"switchboard.audio","window":"Zoom call · 14:02","url":null,
 "source":"audio","session":"a-7f3c",
 "lines":["Me: let's ship Friday","Priya: I'll send the deck tonight"],
 "segs":[{"spk":"me","t":"…","text":"let's ship Friday"},{"spk":"v_12","t":"…","text":"I'll send the deck tonight"}]}
```

`lines` carries the speaker name as a prefix. Because of that, `journal.mjs` prefilter/recall and `watch.mjs` (which settles on `bundle|window`, reads `lines`, and writes `memory.md`) work **unchanged**. `segs` holds stable speaker ids for per-speaker delete and rename. Only one watch change is needed: it currently follows `journal-on`, and it must also run when `audio-on` exists. Screen-journal rules also apply to audio lines: secret masking on write, and redaction before anything reaches System 1.

## 2. Resource budget (all estimates, measure in Phase 0)

| State | CPU (M1) | RAM | Battery |
|---|---|---|---|
| Armed, silence (VAD only) | ~1–3 % of one core (est.) | ~30–60 MB (est.) | small, roughly like a voice-memo app idling (est.) |
| Speech, live transcribe + embed | bursty; whisper base.en on Metal/Neon ~0.1–0.3× real-time (est.) | +250–400 MB while the whisper instance is warm (est.; model file is 148 MB, measured) | a 1 h meeting maybe a few % extra (est.) |
| Second pass (plugged in only) | a short burst per session (est.) | +100–200 MB (est.) | n/a |

Guard rails: whisper loads only during a session and unloads after 2 min of silence. If memory pressure is warning or worse, pause transcription and keep VAD, and show the state on the notch. **Plugged-in only** is a toggle. **Meeting-only** (the default) arms capture only while a call app is using the mic (Zoom, Meet in a browser, Teams, FaceTime, Slack huddle), detected through Core Audio's "device is running somewhere" signal plus the frontmost app. Phase 0 must check the house rule (never noticeably slow the device) by running the real pipeline during a real call on this Air: Activity Monitor CPU and memory, and `powermetrics` energy.

## 3. Consent and privacy (first-class)

- **Off by default.** Turning it on happens through a notch card that explains the behaviour in one line and asks the user to pick a mode. Flag `~/.relay/audio-on`, separate from `journal-on`.
- **Modes:** *Meetings only* (default) · *This session* (on until I stop it, or for N hours) · *Places* (on only on chosen Wi-Fi networks, e.g. office; never at home unless chosen) · *Always* (needs a second confirmation card).
- **Visible indicator.** macOS shows the orange mic dot whenever the mic is in use. We cannot and must not hide it. On the notch, the lime eyes change to show "listening". Proposed: the eyes gain a small pulse under them while armed, which becomes a waveform while speech is being transcribed. Tapping it pauses audio. Screen and audio pause separately, with a long-press to pause both.
- **Never store raw audio.** Text only. RAM buffers are freed per segment. The only file is the CLI's transient temp WAV, deleted immediately.
- **Per-speaker delete.** "Forget Priya" removes her voice embedding and deletes or redacts all `segs`/`lines` spoken by her across the journal.
- **Forget the last N minutes.** This reuses `journal.forget(minutes)`, which already works on the shared file. A notch button offers 5 / 15 / 60 minutes.
- **Exclusions.** App block list (no capture while a chosen app has the mic, e.g. a therapy or telehealth app). Place exclusions (Wi-Fi). Time windows. A "private" keyword: saying "off the record" pauses for 10 min, and this is shown on the notch.
- **Retention:** the same `retentionDays` as the journal (30). A separate shorter value for audio is an option.

### Recording other people

Recording or transcribing a conversation without the other people's consent is legally restricted in many jurisdictions. Some require consent from everyone present, and rules differ for calls and in-person talk. This spec does not state what any specific law requires. **Verify locally before shipping.** Product defaults: in meetings, the first time a session starts, a card offers to post a one-line notice in the call chat ("I'm using a local transcriber; say if you'd rather I stop"). In-person modes show a reminder to announce it. Any participant's objection maps to a single action: stop, then forget this session. The onboarding card says plainly that consent is the user's responsibility.

## 4. Controls, states and reversal

| State | What the user sees | How to reverse |
|---|---|---|
| Off | no ear mark | Turn on from the notch card or `switchboard_journal` |
| Armed (VAD only) | eyes + pulse, orange dot | tap to pause · turn off |
| Transcribing | waveform under the eyes | pause · "forget last 5 min" |
| Paused (user / "off the record") | pulse dimmed, timer | tap to resume, or it auto-resumes when the timer ends |
| No mic permission | card: "Allow microphone in System Settings" with a button to that pane | grant, then it re-arms automatically |
| Mic busy / device gone (e.g. AirPods switch) | small dot + "mic unavailable" | re-arms when the device returns; follows `DictationMicrophone` choice |
| Dictation active | audio journal yields to dictation | resumes after dictation |
| Low memory | "listening paused, low memory" | auto-resume when pressure is normal |
| whisper / model missing | card: install whisper.cpp + base.en (opt-in, shows size) | install or turn off |
| sherpa models missing | transcribes without speakers ("Speaker ?") + install card | install the ~45 MB models |
| On battery (plugged-in-only mode) | "waiting for power" | plug in, or turn the toggle off |

The MCP `switchboard_journal` tool gains `audio: on|off|mode`, `forgetSpeaker`, and `renameSpeaker`.

## 5. Phased build

0. **Benchmark (1 day):** a script feeds a recorded meeting through sherpa VAD + whisper base.en + embeddings on this Air, and records CPU, RAM, energy and real-time factor. Nothing ships.
1. **Meeting-only text, no speakers:** capture, VAD, whisper, journal entries with `source:"audio"`, notch indicator, forget-N-minutes. This is the smallest useful slice: recall works over meetings.
2. **"Me" vs. "others":** enrolment card plus live embedding matching.
3. **Naming:** post-session naming cards, relabel, per-speaker delete.
4. **Second pass + modes:** plugged-in re-diarization, Places and This-session modes, consent notice in the call chat.
5. **Always mode:** only after measurements show it meets the device-lightness rule.

## 6. Open questions for the founder

1. Is "Always" in scope at all, or should the product stay at meetings plus explicit sessions (the stronger privacy story)?
2. Should the second pass keep the session's audio in RAM for up to 60 min, or should we accept live-only speaker labels?
3. Should the consent notice in the call chat be automatic, or a suggestion card every time?
4. Should audio have a shorter retention than screen text?
5. Should audio lines ever reach hosted System 1 (redacted), or should they stay local-only by default?
6. Should we include system audio (other side of a call) via ScreenCaptureKit? That shows macOS's purple indicator and doubles the speakers.

## 7. What existing products do (verified links only)

- **Granola** transcribes meeting audio from the Mac's mic and system audio with no bot. Its security page says it "doesn't store the audio from meetings" and keeps only the transcript and notes. Transcription uses third-party providers, so it is not fully local. [granola.ai/security](https://www.granola.ai/security)
- **Limitless Pendant**, a wearable, recorded conversations within mic range. Reviews say a consent mode that would detect new voices was planned but never shipped. Meta acquired Limitless (Dec 2025) and new Pendant sales stopped. These are secondary sources: [fast.io review](https://fast.io/resources/limitless-ai-review-2026/), [legendmemory.ai](https://legendmemory.ai/blogs/the-archive/limitless-pendant-discontinued-the-best-alternatives-in-2026)
- **Building blocks:** [sherpa-onnx speaker diarization](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html) · [whisper.cpp tinydiarize PR #1058](https://github.com/ggml-org/whisper.cpp/pull/1058) · [pyannote 3.1 (gated)](https://huggingface.co/pyannote/speaker-diarization-3.1) · [whisper.cpp VAD](https://github.com/ggml-org/whisper.cpp) · [macOS orange mic indicator](https://support.apple.com/en-gb/guide/mac-help/mchl50f94f8f/mac)
