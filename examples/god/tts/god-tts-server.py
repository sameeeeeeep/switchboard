#!/usr/bin/env python3
"""God's voice service — a tiny persistent TTS server on Apple Silicon's native form (MLX).

Same model as before (Kyutai Pocket TTS) but the MLX backend: no torch, ~373MB venv instead of
873MB, warm synthesis ~3x faster than real-time, and cloning a voice is near-instant. Loads the
model ONCE (so synthesis is warm), clones voices from ~/.relay/voices/<name>.wav, and answers:

  GET  /health           → {ok, ready, engine, voices}
  GET  /voices           → {voices: [...]}
  POST /clone {name}     → (re)clone ~/.relay/voices/<name>.wav into the in-process cache
  POST /speak {text, voice} → audio/wav

God's companion.mjs POSTs to /speak; the menu-bar Settings drop-zone drops a sample into
~/.relay/voices/ and calls /clone. On-device, no cloud, no credits. Falls back gracefully: if this
service is down, God speaks with macOS `say`.

Cloning is ~0.02s on MLX, so we DON'T persist voice states to disk (the old torch `.safetensors`
cache): we just re-clone from the `.wav` on demand and hold it in memory. One less thing to stale.

Run: <venv>/bin/python god-tts-server.py [--port 7897]
"""
import argparse, base64, io, os, re, subprocess, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import uvicorn

import mlx.core as mx
from pocket_tts_mlx import TTSModel

# --- Upstream fix (pocket-tts-mlx 0.2.1): voice cloning from an arbitrary WAV crashes because
# _encode_audio does `mx.transpose(encoded, (-1, -2))` — a mistranslation of torch's 2-arg
# `.transpose(-1, -2)`, which swaps the last two axes. MLX's transpose wants a FULL permutation,
# so on a 3-D tensor it raises. mx.swapaxes has exactly torch's 2-arg semantics. Predefined voices
# dodge this (they load precomputed states); cloning — the whole point of God — needs it. ---
def _encode_audio_swapaxes(self, audio):
    encoded = self.mimi.encode_to_latent(audio)
    latents = mx.swapaxes(encoded, -1, -2).astype(mx.float32)
    return mx.matmul(latents, self.flow_lm.speaker_proj_weight.T)


TTSModel._encode_audio = _encode_audio_swapaxes

VOICES = Path(os.path.expanduser("~/.relay/voices"))
VOICES.mkdir(parents=True, exist_ok=True)

app = FastAPI()
# The Clone wrapp (browser at http://localhost:5188) POSTs sample audio here to save+clone a voice,
# so the on-device engine needs to accept cross-origin calls from localhost. All routes are localhost-
# only (uvicorn binds 127.0.0.1), so a permissive CORS policy exposes nothing beyond this machine.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
_model = None
_states: dict = {}

# yt-dlp / ffmpeg: we shell out rather than import — no extra pip deps in the TTS venv, and the binaries
# are the ones the user already has. RESOLVE ABSOLUTE: under launchd the PATH is bare (/usr/bin:/bin),
# so a Homebrew binary is invisible by name — find it once at import, preferring the real install.
import shutil
def _bin(name: str) -> str:
    for c in (shutil.which(name), f"/opt/homebrew/bin/{name}", f"/usr/local/bin/{name}"):
        if c and Path(c).exists():
            return c
    return name   # last resort — let the call fail loudly if it's genuinely missing
FFMPEG = _bin("ffmpeg")
YTDLP = _bin("yt-dlp")
CLONE_SR = 24000   # pocket-tts clones happiest from mono 24k 16-bit — normalize every sample to it.

# Clone fidelity. pocket-tts's defaults (lsd_decode_steps=1, temp=0.7) are the FAST/rough settings:
# a single flow-matching denoise step + a high temperature. Perfect for the instant companion voice,
# but they undersell an uploaded clone — generation catches the cadence yet drifts off the speaker's
# fine timbre. For a USER CLONE we spend more denoise steps and lower the temperature so the output
# hugs the reference speaker. PRESET voices (Moira / the companion path) keep the fast defaults, so
# /speak stays snappy everywhere else. All env-overridable — tune without a code change + restart.
FAST_VOICES = {v.strip() for v in os.environ.get(
    "GOD_TTS_FAST_VOICES", "moira,kk,zoo-guy,alba").split(",") if v.strip()}
CLONE_LSD_STEPS = int(os.environ.get("GOD_TTS_CLONE_STEPS", "6"))    # 1 (fast) → 4-8 (more timbre fidelity)
CLONE_TEMP = float(os.environ.get("GOD_TTS_CLONE_TEMP", "0.45"))     # 0.7 default → lower hugs the speaker


def _slug(name: str) -> str:
    """A voice name becomes a filename (<name>.wav) AND the id every wrapp selects — keep it to the
    safe storage-key shape (see docs): lowercase alnum + dashes, never a path separator or dot-stem."""
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s[:48]


def _normalize_wav(src: Path, dst: Path, start: float = 0.0, dur: float | None = None) -> float:
    """ffmpeg any input (browser blob, yt-dlp download, any rate/codec) → mono 24k 16-bit WAV. Optional
    [start, start+dur] window. Returns the output duration in seconds. Raises on ffmpeg failure."""
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-ac", "1", "-ar", str(CLONE_SR), "-sample_fmt", "s16", str(dst)]
    subprocess.run(cmd, check=True, capture_output=True)
    info, _ = sf.read(str(dst))
    return len(info) / CLONE_SR

# MLX's Metal streams are THREAD-LOCAL: arrays and mx.eval must run on the thread that owns the
# stream. A web server dispatches each request on a different worker thread, so every MLX call has
# to be funnelled onto ONE dedicated thread — load, clone, and synth all happen here. (This is the
# standard MLX-under-a-server pattern; without it /speak fails with "no Stream(gpu, 0)".)
_gpu = ThreadPoolExecutor(max_workers=1, thread_name_prefix="god-tts-gpu")


def _on_gpu(fn, *a, **k):
    return _gpu.submit(fn, *a, **k).result()


def _model_get():
    global _model
    if _model is None:
        t0 = time.time()
        _model = TTSModel.load_model()
        print(f"[god-tts] model loaded in {time.time()-t0:.1f}s (mlx)", flush=True)
    return _model


def _voice_names():
    names = set()
    for p in VOICES.glob("*.wav"):
        if not p.stem.endswith("-full"):
            names.add(p.stem)
    return sorted(names)


def _voice_state(name: str):
    # Runs on the _gpu thread. Cached in-process; cloning from the wav is ~0.02s on MLX.
    if name in _states:
        return _states[name]
    wav = VOICES / f"{name}.wav"
    if not wav.exists():
        return None
    m = _model_get()
    t0 = time.time()
    state = m.get_state_for_audio_prompt(wav)
    print(f"[god-tts] cloned '{name}' in {time.time()-t0:.2f}s", flush=True)
    _states[name] = state
    return state


def _synth(voice: str, text: str):
    # Runs on the _gpu thread: clone (if needed) → generate → encode WAV bytes.
    state = _voice_state(voice)
    if state is None:
        return None
    m = _model_get()
    # For a user-uploaded CLONE (any voice that isn't a fast preset), spend more flow-matching steps
    # and a lower temperature so the output tracks the reference speaker's timbre instead of drifting.
    # Restore the fast defaults afterwards so Moira / the companion voice stay snappy. Safe to mutate
    # the shared model here: all synth is funnelled onto the single _gpu thread, so this is serialized.
    hq = voice not in FAST_VOICES
    prev_steps, prev_temp = m.lsd_decode_steps, m.temp
    if hq:
        m.lsd_decode_steps, m.temp = CLONE_LSD_STEPS, CLONE_TEMP
    try:
        # trim_start_ms/fade_in_ms suppress the decoder's first-frame transient (an audible click).
        audio = m.generate_audio(state, text, trim_start_ms=40, fade_in_ms=15)
    finally:
        m.lsd_decode_steps, m.temp = prev_steps, prev_temp
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio), m.sample_rate, format="WAV")
    return buf.getvalue()


class Speak(BaseModel):
    text: str
    voice: str = "moira"


class Clone(BaseModel):
    name: str


@app.get("/health")
def health():
    return {"ok": True, "ready": _model is not None, "engine": "mlx", "voices": _voice_names()}


@app.get("/voices")
def voices():
    return {"voices": _voice_names()}


@app.post("/clone")
def clone(c: Clone):
    def _do():
        _states.pop(c.name, None)          # force a fresh clone
        return _voice_state(c.name)
    state = _on_gpu(_do)
    return {"ok": state is not None, "voice": c.name}


class SaveVoice(BaseModel):
    name: str
    audio_b64: str           # base64 of an audio file (WAV/webm/whatever the browser recorded/dropped)
    start: float = 0.0       # optional trim window, in seconds, into the supplied clip
    duration: float | None = None


@app.post("/save")
def save_voice(v: SaveVoice):
    """Save a dropped/recorded/fetched clip as ~/.relay/voices/<name>.wav (normalized) and clone it into
    the warm cache. This is the write-side the Clone wrapp needs: once it lands, `claude_speak` (and the
    Echo wrapp's dropdown) can speak in this voice immediately — no restart, no cloud, no credits."""
    name = _slug(v.name)
    if not name:
        return JSONResponse({"error": "empty/invalid name"}, status_code=400)
    try:
        raw = base64.b64decode(v.audio_b64.split(",")[-1])   # tolerate a data: URL prefix
    except Exception:
        return JSONResponse({"error": "audio_b64 is not valid base64"}, status_code=400)
    if len(raw) < 1024:
        return JSONResponse({"error": "clip too short/empty"}, status_code=400)
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "in"
        src.write_bytes(raw)
        out = VOICES / f"{name}.wav"
        try:
            dur = _normalize_wav(src, out, start=v.start or 0.0, dur=v.duration)
        except subprocess.CalledProcessError as e:
            return JSONResponse({"error": "could not decode that clip", "detail": e.stderr.decode()[:200]}, status_code=400)
    if dur < 0.4:
        out.unlink(missing_ok=True)
        return JSONResponse({"error": "selected segment is too short to clone"}, status_code=400)
    state = _on_gpu(lambda: (_states.pop(name, None), _voice_state(name))[1])
    return {"ok": state is not None, "voice": name, "seconds": round(dur, 2)}


class FetchUrl(BaseModel):
    url: str
    max_seconds: int = 180   # cap what we pull so a long video doesn't become a huge payload


@app.post("/fetch")
def fetch_url(f: FetchUrl):
    """Pull audio from a link (YouTube etc.) via yt-dlp → normalized mono 24k WAV, capped to max_seconds,
    returned as base64 for the browser to load into the segment selector. Nothing is kept server-side."""
    url = (f.url or "").strip()
    if not re.match(r"^https?://", url):
        return JSONResponse({"error": "give a full http(s) link"}, status_code=400)
    cap = max(5, min(int(f.max_seconds or 180), 600))
    with tempfile.TemporaryDirectory() as td:
        dl = Path(td) / "dl.m4a"
        # Only the first `cap` seconds — --download-sections keeps long videos fast and small.
        cmd = [YTDLP, "--no-playlist", "--no-warnings", "-f", "bestaudio/best", "-x",
               "--audio-format", "wav", "--ffmpeg-location", str(Path(FFMPEG).parent),
               "--download-sections", f"*0-{cap}", "--force-keyframes-at-cuts",
               "-o", str(Path(td) / "dl.%(ext)s"), url]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            return JSONResponse({"error": "fetch timed out — try a shorter clip or a direct link"}, status_code=504)
        except subprocess.CalledProcessError as e:
            return JSONResponse({"error": "couldn't fetch that link", "detail": e.stderr.decode()[-200:]}, status_code=400)
        got = next(iter(Path(td).glob("dl.*")), None)
        if got is None:
            return JSONResponse({"error": "no audio came out of that link"}, status_code=400)
        out = Path(td) / "norm.wav"
        try:
            dur = _normalize_wav(got, out)
        except subprocess.CalledProcessError:
            return JSONResponse({"error": "couldn't decode the fetched audio"}, status_code=400)
        b64 = base64.b64encode(out.read_bytes()).decode()
    return {"ok": True, "audio_b64": b64, "sampleRate": CLONE_SR, "duration": round(dur, 2),
            "capped": dur >= cap - 0.5}


# --- Media conversion (local, ffmpeg-backed) -------------------------------------------------------
# The machine already ships ffmpeg (resolved above for TTS). Expose it as a first-class LOCAL convert
# so the Convert wrapp — and God — transcode a dropped/named file WITHOUT a cloud round-trip or an
# "online converter website". Audio + common video containers; lossy targets get a near-transparent
# default. Everything runs on the user's disk; nothing leaves the machine.
CONVERT_MAX_MB = int(os.environ.get("GOD_CONVERT_MAX_MB", "300"))   # payload guardrail

def _ffmpeg_args_for(target: str) -> list:
    """Codec/quality flags for a target extension. Lossy audio/video gets a sane near-transparent
    default; an unknown target falls through to ffmpeg's own container defaults."""
    return {
        "mp3":  ["-c:a", "libmp3lame", "-q:a", "2"],
        "m4a":  ["-c:a", "aac", "-b:a", "192k"],
        "aac":  ["-c:a", "aac", "-b:a", "192k"],
        "ogg":  ["-c:a", "libvorbis", "-q:a", "5"],
        "opus": ["-c:a", "libopus", "-b:a", "128k"],
        "wav":  ["-c:a", "pcm_s16le"],
        "flac": ["-c:a", "flac"],
        "aiff": ["-c:a", "pcm_s16be"],
        "mp4":  ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
        "mov":  ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"],
        "mkv":  ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"],
        "webm": ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus"],
    }.get(target, [])


class Convert(BaseModel):
    to: str                          # target format/extension, e.g. "mp3"
    file_b64: str | None = None      # input bytes (browser drop / queued file)
    path: str | None = None          # OR an absolute input path already on disk (God / a file the user names)
    name: str | None = None          # optional output basename (extension is added from `to`)
    ext: str | None = None           # optional source-extension hint when sending bytes


@app.post("/convert")
def convert_media(c: Convert):
    """Transcode one file to `to` with the on-device ffmpeg. Accepts browser bytes (file_b64) or an
    on-disk path. Returns the result as base64 (for a browser download) and, when given a path, also
    writes it next to the source and returns out_path. No cloud, no upload — the whole point."""
    target = re.sub(r"[^a-z0-9]", "", (c.to or "").lower())
    if not target:
        return JSONResponse({"error": "no target format"}, status_code=400)
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        if c.path:
            src = Path(os.path.expanduser(c.path))
            if not src.exists():
                return JSONResponse({"error": f"no file at {c.path}"}, status_code=400)
        elif c.file_b64:
            try:
                raw = base64.b64decode(c.file_b64.split(",")[-1])
            except Exception:
                return JSONResponse({"error": "file_b64 is not valid base64"}, status_code=400)
            if len(raw) > CONVERT_MAX_MB * 1024 * 1024:
                return JSONResponse({"error": f"file over {CONVERT_MAX_MB}MB"}, status_code=413)
            src = tdp / ("in." + (re.sub(r"[^a-z0-9]", "", (c.ext or "").lower()) or "bin"))
            src.write_bytes(raw)
        else:
            return JSONResponse({"error": "send file_b64 or a path"}, status_code=400)
        base = _slug(c.name or src.stem) or "converted"
        out = tdp / f"{base}.{target}"
        cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
               *_ffmpeg_args_for(target), str(out)]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
        except subprocess.TimeoutExpired:
            return JSONResponse({"error": "conversion timed out — try a shorter/smaller file"}, status_code=504)
        except subprocess.CalledProcessError as e:
            return JSONResponse({"error": f"couldn't convert to {target}",
                                 "detail": e.stderr.decode()[-300:]}, status_code=400)
        if not out.exists() or out.stat().st_size == 0:
            return JSONResponse({"error": "conversion produced no output"}, status_code=400)
        data = out.read_bytes()
        resp = {"ok": True, "filename": out.name, "bytes": len(data), "to": target}
        if c.path:                                   # God's on-disk flow: drop the result beside the source
            dest = src.with_name(out.name)
            dest.write_bytes(data)
            resp["out_path"] = str(dest)
        resp["out_b64"] = base64.b64encode(data).decode()
        return resp


@app.post("/speak")
def speak(s: Speak):
    text = (s.text or "").strip()
    if not text:
        return JSONResponse({"error": "empty text"}, status_code=400)
    wav = _on_gpu(_synth, s.voice, text)
    if wav is None:
        return JSONResponse({"error": f"no voice '{s.voice}'"}, status_code=404)
    _touch()   # refresh the keep-warm window from this real use
    return Response(content=wav, media_type="audio/wav")


class OpenAISpeech(BaseModel):
    input: str
    voice: str = ""
    model: str = "pocket-tts"
    response_format: str = "wav"


def _default_voice() -> str:
    # The Settings-selected clone, else the first available, else "moira".
    try:
        sel = (VOICES / "selected").read_text().strip()
        if sel:
            return sel
    except Exception:
        pass
    names = _voice_names()
    return names[0] if names else "moira"


@app.post("/v1/audio/speech")
def openai_speech(s: OpenAISpeech):
    """OpenAI-compatible route so the daemon's generic `claude_speak` (RELAY_LOCAL_TTS_URL) speaks the
    cloned voice for ANY wrapp — same contract as openedai-speech / Kokoro / Piper gateways."""
    text = (s.input or "").strip()
    if not text:
        return JSONResponse({"error": "empty input"}, status_code=400)
    voice = s.voice or _default_voice()
    wav = _on_gpu(_synth, voice, text)
    if wav is None:
        return JSONResponse({"error": f"no voice '{voice}'"}, status_code=404)
    _touch()   # refresh the keep-warm window from this real use
    return Response(content=wav, media_type="audio/wav")


def _warm():
    # Preload the model AND compile the generation kernels on the _gpu thread, so the first real
    # /speak is instant instead of eating the ~22s Metal cold-compile. Loading the model + cloning
    # the voice is NOT enough: `generate_audio` compiles its OWN kernels on first call, so we run one
    # throwaway synth here to pay that cost at boot. Then _touch() so the keep-warm loop starts
    # protecting the kernels immediately — it keys off _last_used, which starts at 0 (i.e. keep-warm
    # otherwise does nothing until the first user call, leaving that first call cold).
    try:
        names = _voice_names()
        if names:
            _on_gpu(_synth, names[0], "Warming up the voice engine.")
        else:
            _on_gpu(_model_get)
        _touch()
        print("[god-tts] warm (generation kernels compiled)", flush=True)
    except Exception as e:
        print(f"[god-tts] warmup failed: {e}", flush=True)


# ── keep-warm (Ollama-style keep_alive) ──────────────────────────────────────────────────────────
# The FIRST synth after idle is a ~22s Metal-kernel cold-compile; warm ones are ~3s. So, exactly like a
# local model's keep_alive: for KEEP_WARM_SECONDS after the LAST real /speak, run a tiny forward pass
# every 45s to keep the kernels hot. No usage for that window → we stop, and the GPU idles (no waste).
KEEP_WARM_SECONDS = int(os.environ.get("GOD_TTS_KEEP_WARM", "300"))   # 5 min from last use
_last_used = 0.0

def _touch():
    global _last_used
    _last_used = time.time()

def _keep_warm():
    while True:
        time.sleep(45)
        if _last_used and (time.time() - _last_used) < KEEP_WARM_SECONDS:
            try:
                _on_gpu(_synth, _default_voice(), "Keeping the voice engine warm.")
            except Exception as e:
                print(f"[god-tts] keep-warm skipped: {e}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("GOD_TTS_PORT", "7897")))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    threading.Thread(target=_warm, daemon=True).start()
    threading.Thread(target=_keep_warm, daemon=True).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
