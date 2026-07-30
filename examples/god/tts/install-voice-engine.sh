#!/usr/bin/env bash
# Install God's voice-cloning engine ON DEMAND — the "Enable voice cloning" capability.
#
# The base app stays lean (~110MB DMG). This pulls the ~373MB MLX engine (Kyutai Pocket TTS on
# Apple Silicon, no torch) only when the user opts in, and wires it as a persistent LaunchAgent
# (com.relay.godtts on :7897) that God's companion.mjs speaks through. Idempotent: re-running
# rebuilds the venv and reloads the service. Same script installs on a fresh Mac (distribution).
#
# Requires: Apple Silicon + a Python 3.10–3.13 (MLX ships wheels there; 3.14 is skipped).
# Voice CLONING also needs Hugging Face access to the gated kyutai/pocket-tts weights:
#   hf auth login   (then accept the terms at https://huggingface.co/kyutai/pocket-tts)
set -euo pipefail

RELAY="${RELAY_HOME:-$HOME/.relay}"
VENV="$RELAY/tts-venv"
TTS_DIR="$RELAY/tts"
PORT="${GOD_TTS_PORT:-7897}"
LABEL="com.relay.godtts"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$RELAY/god-tts.log"

say() { printf '\033[36m[voice]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[voice] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -m)" = "arm64" ] || die "Apple Silicon required (MLX is Metal-only)."

# --- pick a Python MLX has wheels for (3.13 → 3.10; NOT 3.14) ---
PY=""
for cand in python3.13 python3.12 python3.11 python3.10; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$(command -v "$cand")"; break; fi
done
[ -n "$PY" ] || die "Need Python 3.10–3.13 (try: brew install python@3.13)."
say "using $($PY --version) at $PY"

mkdir -p "$RELAY" "$TTS_DIR" "$HOME/Library/LaunchAgents"

# --- (re)build the MLX venv ---
say "building MLX venv at $VENV (this replaces any old torch venv)…"
rm -rf "$VENV"
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
say "installing pocket-tts-mlx + server deps (~373MB)…"
"$VENV/bin/pip" install --quiet pocket-tts-mlx soundfile fastapi uvicorn

# --- drop the server where the LaunchAgent runs it ---
cp "$SRC_DIR/god-tts-server.py" "$TTS_DIR/god-tts-server.py"
say "installed server → $TTS_DIR/god-tts-server.py"

# --- write + (re)load the LaunchAgent ---
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$VENV/bin/python</string><string>$TTS_DIR/god-tts-server.py</string><string>--port</string><string>$PORT</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string><key>HF_HUB_DISABLE_TELEMETRY</key><string>1</string></dict>
</dict></plist>
PLISTEOF

GUI="gui/$(id -u)"
# bootout is ASYNC — bootstrapping before teardown finishes fails with "error 5". Wait for the
# job to actually disappear, then bootstrap (retry a couple times to cover the race).
launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
for _ in $(seq 1 20); do launchctl print "$GUI/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
for attempt in 1 2 3; do
  if launchctl bootstrap "$GUI" "$PLIST" 2>/dev/null; then break; fi
  [ "$attempt" = 3 ] && die "could not bootstrap $LABEL (launchctl bootstrap failed)"
  sleep 1
done
launchctl kickstart -k "$GUI/$LABEL" 2>/dev/null || true
say "LaunchAgent $LABEL loaded (:$PORT)"

# --- wait for the model to warm (first run also downloads ~434MB of weights) ---
say "warming the model (first run downloads weights)…"
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ready":true'; then
    say "ready ✓  $(curl -fsS "http://127.0.0.1:$PORT/health")"
    exit 0
  fi
  sleep 2
done
die "service did not become ready — see $LOG"
