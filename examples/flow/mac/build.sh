#!/bin/bash
# Build Flow.app (the native Wispr-style dictation client). Requires Xcode command-line tools.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../../.. && pwd)"
NODE="$(command -v node)"

echo "[flow] ensuring the daemon is built…"
( cd "$REPO" && npm run -w @relay/sidekick build >/dev/null )

echo "[flow] compiling Flow.swift…"
mkdir -p build
swiftc -O -o build/Flow Flow.swift \
  -framework AppKit -framework SwiftUI -framework AVFoundation

APP="Flow.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp build/Flow "$APP/Contents/MacOS/Flow"
cp Info.plist "$APP/Contents/Info.plist"

# Ad-hoc codesign so Gatekeeper launches a locally-built app (real notarization: package-dmg.sh).
codesign --force --deep --sign - "$APP" 2>/dev/null || true

# Wire the app to THIS checkout: the daemon it launches + the local whisper STT adapter.
mkdir -p "$HOME/.flow"
cat > "$HOME/.flow/config.json" <<EOF
{
  "node": "$NODE",
  "daemon": "$REPO/packages/sidekick/dist/index.js",
  "sttCmd": "$NODE $REPO/examples/flow/whisper-stt.mjs",
  "localOpenAIUrl": "http://127.0.0.1:11434/v1",
  "cleanupModel": ""
}
EOF

echo "[flow] built $(pwd)/$APP"
echo "[flow] config → $HOME/.flow/config.json"
echo "[flow] run it:  open $(pwd)/$APP"
echo "[flow] first launch will ask for Microphone + Accessibility — grant both, then double-tap ⌃."
