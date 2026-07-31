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
import argparse, io, os, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI
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
_model = None
_states: dict = {}

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
    # trim_start_ms/fade_in_ms suppress the decoder's first-frame transient (an audible click).
    audio = m.generate_audio(state, text, trim_start_ms=40, fade_in_ms=15)
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
    # Preload the model (and the first voice) on the _gpu thread so the first /speak is instant.
    try:
        names = _voice_names()
        _on_gpu(_voice_state, names[0]) if names else _on_gpu(_model_get)
        print("[god-tts] warm", flush=True)
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
                _on_gpu(_synth, _default_voice(), "warm")
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
