#!/bin/bash
# Build Relay.app (the menu-bar app). Requires the Xcode command-line tools (swiftc).
set -e
cd "$(dirname "$0")"

echo "[menubar] compiling…"
mkdir -p build
swiftc -O -o build/Relay RelayMenuBar.swift -framework AppKit -framework SwiftUI

APP="Switchboard.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp build/Relay "$APP/Contents/MacOS/Relay"
cp Info.plist "$APP/Contents/Info.plist"

# The wrapp-store catalog — ingested from every wrapp's switchboard.json (build-catalog.mjs). Bundle
# the committed copy so a packaged app opens the store even before the daemon refreshes ~/.relay/catalog.json.
CATALOG="../../examples/apps/wrapps/catalog.json"
if [ -f "$CATALOG" ]; then
  mkdir -p "$APP/Contents/Resources"
  cp "$CATALOG" "$APP/Contents/Resources/catalog.json"
  echo "[menubar] bundled wrapp catalog ($(node -e "console.log(require('./$CATALOG').count)" 2>/dev/null || echo '?') listings)"
fi

# House fonts (Bricolage / Hanken / Spline) — bundled if present so the panel renders in brand type;
# the app falls back to the system font when the fonts/ dir is empty.
if compgen -G "fonts/*.ttf" >/dev/null 2>&1 || compgen -G "fonts/*.otf" >/dev/null 2>&1; then
  mkdir -p "$APP/Contents/Resources/fonts"
  cp fonts/*.ttf fonts/*.otf "$APP/Contents/Resources/fonts/" 2>/dev/null || true
  echo "[menubar] bundled house fonts"
fi

# Sign with a stable Developer ID so TCC grants (Accessibility, Screen Recording, Microphone, and the
# Documents/Desktop folder prompts) PERSIST across rebuilds. An ad-hoc signature (`--sign -`) changes
# every build, so macOS treated each rebuild as a brand-new app and every grant reset — the root cause
# of "it keeps re-asking" and "Accessibility never detects the grant". Falls back to ad-hoc when the
# cert isn't on this machine, so the build still works elsewhere.
IDENTITY="Developer ID Application: STAYOFT VENTURES PRIVATE LIMITED (55354KFTHU)"
ENTS="Relay.entitlements"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "55354KFTHU"; then
  if codesign --force --deep --options runtime --entitlements "$ENTS" --sign "$IDENTITY" "$APP"; then
    echo "[menubar] signed with Developer ID — TCC grants will persist across rebuilds"
  else
    echo "[menubar] Developer ID signing failed — falling back to ad-hoc (grants will reset)"
    codesign --force --deep --sign - "$APP"
  fi
else
  echo "[menubar] Developer ID cert not found — ad-hoc signing (grants reset each rebuild)"
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
fi

echo "[menubar] built $(pwd)/$APP"
echo "[menubar] open it with:  open packages/menubar/Switchboard.app"
