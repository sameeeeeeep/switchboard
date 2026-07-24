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

# Ad-hoc codesign so Gatekeeper is happy launching a locally-built app.
codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo "[menubar] built $(pwd)/$APP"
echo "[menubar] open it with:  open packages/menubar/Switchboard.app"
