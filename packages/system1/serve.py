#!/usr/bin/env python3
"""Switchboard System 1 engine: a local TypeSafe-compatible /v1/systemone server that unloads when idle.

Wraps `qev serve` (OneJev, https://github.com/OmniJev/OneJev) so the model only occupies RAM while something is
asking: it starts on demand (switchboard_decide, the notch stop hook) and exits after SYSTEM1_IDLE_S seconds with
no request. Device-lightness rule: a store capability must never slow the machine while unused.

Env: SYSTEM1_MODEL (default onejev-0.8b), SYSTEM1_PORT (8017), SYSTEM1_IDLE_S (600), SYSTEM1_DEVICE (mps|cpu).
Writes ~/.relay/system1.json {url, model, pid, startedAt} while alive so clients can find it.
"""
import json
import os
import sys
import threading
import time

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import qev.server as server  # noqa: E402

RELAY = os.environ.get("RELAY_DIR", os.path.expanduser("~/.relay"))
STATE = os.path.join(RELAY, "system1.json")
MODEL = os.environ.get("SYSTEM1_MODEL", "onejev-0.8b")
PORT = int(os.environ.get("SYSTEM1_PORT", "8017"))
IDLE = int(os.environ.get("SYSTEM1_IDLE_S", "600"))
last = [None]  # idle clock starts once the server is up; a slow cold start must not be reaped

_create_app = server.create_app


def create_app(*args, **kwargs):
    app = _create_app(*args, **kwargs)

    @app.middleware("http")
    async def touch(request, call_next):
        last[0] = time.time()
        try:
            return await call_next(request)
        finally:
            last[0] = time.time()

    @app.on_event("startup")
    async def announce():
        last[0] = time.time()
        tmp = STATE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"url": f"http://127.0.0.1:{PORT}", "model": MODEL, "pid": os.getpid(),
                       "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S")}, f)
        os.replace(tmp, STATE)

    return app


server.create_app = create_app  # qev.cli imports create_app at call time, so the patch takes


def reaper():
    while True:
        time.sleep(15)
        if last[0] is not None and time.time() - last[0] > IDLE:
            try:
                with open(STATE) as f:
                    if json.load(f).get("pid") == os.getpid():
                        os.unlink(STATE)
            except Exception:
                pass
            os._exit(0)


def main():
    import torch

    device = os.environ.get("SYSTEM1_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
    threading.Thread(target=reaper, daemon=True).start()
    sys.argv = ["qev", "serve", "--model", MODEL, "--name", MODEL, "--device", device, "--dtype", "bfloat16",
                "--head-dtype", "float32", "--fork-mode", "sequential", "--no-cuda-graphs", "--no-gpu-preprocess",
                "--host", "127.0.0.1", "--port", str(PORT)]
    from qev.cli import main as qev_main

    qev_main()


if __name__ == "__main__":
    main()
