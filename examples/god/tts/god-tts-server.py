#!/usr/bin/env python3
"""
God's voice service — a tiny persistent Pocket TTS server. Loads the model ONCE (so synthesis is
fast and warm), clones voices from ~/.relay/voices/<name>.wav (caching <name>.safetensors), and
answers:

  GET  /health           → {ok, ready, voices}
  GET  /voices           → {voices: [...]}
  POST /clone {name}     → (re)clone ~/.relay/voices/<name>.wav
  POST /speak {text, voice} → audio/wav

God's companion.mjs POSTs to /speak; the menu-bar Settings drop-zone drops a sample into
~/.relay/voices/ and calls /clone. On-device, no cloud, no credits. Falls back gracefully: if this
service is down, God speaks with macOS `say`.

Run: <venv>/bin/python god-tts-server.py [--port 7897]
"""
import argparse, io, os, threading, time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
import uvicorn

VOICES = Path(os.path.expanduser("~/.relay/voices"))
VOICES.mkdir(parents=True, exist_ok=True)

app = FastAPI()
_model = None
_states: dict = {}
_lock = threading.Lock()
_loading = threading.Event()


def _model_get():
    global _model
    if _model is None:
        from pocket_tts import TTSModel
        t0 = time.time()
        _model = TTSModel.load_model()
        print(f"[god-tts] model loaded in {time.time()-t0:.1f}s", flush=True)
    return _model


def _voice_names():
    names = set()
    for p in VOICES.glob("*.safetensors"):
        names.add(p.stem)
    for p in VOICES.glob("*.wav"):
        if not p.stem.endswith("-full"):
            names.add(p.stem)
    return sorted(names)


def _voice_state(name: str):
    from pocket_tts import export_model_state
    with _lock:
        if name in _states:
            return _states[name]
        st = VOICES / f"{name}.safetensors"
        wav = VOICES / f"{name}.wav"
        m = _model_get()
        if st.exists():
            state = m.get_state_for_audio_prompt(str(st))
        elif wav.exists():
            t0 = time.time()
            state = m.get_state_for_audio_prompt(str(wav))
            print(f"[god-tts] cloned '{name}' in {time.time()-t0:.1f}s", flush=True)
            try:
                export_model_state(state, str(st))
            except Exception as e:
                print(f"[god-tts] export skipped: {e}", flush=True)
        else:
            return None
        _states[name] = state
        return state


class Speak(BaseModel):
    text: str
    voice: str = "moira"


class Clone(BaseModel):
    name: str


@app.get("/health")
def health():
    return {"ok": True, "ready": _model is not None, "voices": _voice_names()}


@app.get("/voices")
def voices():
    return {"voices": _voice_names()}


@app.post("/clone")
def clone(c: Clone):
    with _lock:
        _states.pop(c.name, None)          # force a fresh clone
        st = VOICES / f"{c.name}.safetensors"
        if st.exists():
            try: st.unlink()
            except Exception: pass
    state = _voice_state(c.name)
    return {"ok": state is not None, "voice": c.name}


@app.post("/speak")
def speak(s: Speak):
    text = (s.text or "").strip()
    if not text:
        return JSONResponse({"error": "empty text"}, status_code=400)
    state = _voice_state(s.voice)
    if state is None:
        return JSONResponse({"error": f"no voice '{s.voice}'"}, status_code=404)
    m = _model_get()
    audio = m.generate_audio(state, text)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio), m.sample_rate, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")


def _warm():
    # Preload the model (and the first voice) in the background so the first /speak is instant.
    try:
        names = _voice_names()
        if names:
            _voice_state(names[0])
        else:
            _model_get()
        print("[god-tts] warm", flush=True)
    except Exception as e:
        print(f"[god-tts] warmup failed: {e}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("GOD_TTS_PORT", "7897")))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    threading.Thread(target=_warm, daemon=True).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
