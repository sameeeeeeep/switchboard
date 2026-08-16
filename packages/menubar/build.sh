#!/bin/bash
# Build Relay.app (the menu-bar app). Requires the Xcode command-line tools (swiftc).
set -e
cd "$(dirname "$0")"

echo "[menubar] compiling…"
mkdir -p build
swiftc -O -o build/Relay main.swift RelayMenuBar.swift CursorGuide.swift NotchLauncherView.swift LauncherRouting.swift GodWidgetKit.swift GodWebWindow.swift StoreFrontView.swift HtmlCapability.swift SkillRunner.swift AmbientSensor.swift AmbientCanvas.swift OSShellView.swift OSSurfaceWorkspace.swift OSSurfaceAutomate.swift OSSurfaceKnowledge.swift OSSurfaceDo.swift -framework AppKit -framework SwiftUI -framework WebKit -framework ApplicationServices -framework CoreServices

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

# Wrapp icons — the "Instruments on the board" art (docs/ICON-SYSTEM.md), one PNG per listing id.
# Bundled if present so glyphTile can show real hardware icons; the store falls back to the
# category SF Symbol when an icon is missing, so an empty icons/ dir is fine.
if compgen -G "icons/*.png" >/dev/null 2>&1; then
  mkdir -p "$APP/Contents/Resources/icons"
  cp icons/*.png "$APP/Contents/Resources/icons/" 2>/dev/null || true
  echo "[menubar] bundled wrapp icons ($(ls icons/*.png | wc -l | tr -d ' ') PNGs)"
fi

# Skill bodies — the "wear this skill" content behind a listing's components.skills refs
# (e.g. "yc/register" → wrapps/yc/skills/register.md). Bundled flat as Resources/skills/<wrapp>/<name>.md
# so the god surface can load the real instructions into God's context (docs/GOD-HANDS.md). A listing
# with no skill files still works — the god surface falls back to the wrapp's page.
WRAPPS_DIR="../../examples/apps/wrapps"
if compgen -G "$WRAPPS_DIR/*/skills/*.md" >/dev/null 2>&1; then
  n=0
  for f in "$WRAPPS_DIR"/*/skills/*.md; do
    wrapp="$(basename "$(dirname "$(dirname "$f")")")"
    dest="$APP/Contents/Resources/skills/$wrapp"
    mkdir -p "$dest"
    cp "$f" "$dest/" && n=$((n+1))
  done
  echo "[menubar] bundled skill bodies ($n md files)"
fi

# House fonts (Bricolage / Hanken / Spline) — bundled if present so the panel renders in brand type;
# the app falls back to the system font when the fonts/ dir is empty.
if compgen -G "fonts/*.ttf" >/dev/null 2>&1 || compgen -G "fonts/*.otf" >/dev/null 2>&1; then
  mkdir -p "$APP/Contents/Resources/fonts"
  cp fonts/*.ttf fonts/*.otf "$APP/Contents/Resources/fonts/" 2>/dev/null || true
  echo "[menubar] bundled house fonts"
fi

# The Switchboard connector — bundled as ONE ESM file so the onboarding "Connect Claude Code" step has a
# real path to hand the user: `claude mcp add switchboard -- <node> <this> mcp`. That connector lets a
# Claude Code session read this project's board (pick up tasks moved to Todo) and run its wrapps. Mirrors
# the daemon bundle (createRequire banner — the MCP stdio transport does dynamic require()s). Skipped if
# esbuild isn't present; a dev build then points the command at the repo source instead.
ESBUILD="../../node_modules/.bin/esbuild"
if [ -x "$ESBUILD" ]; then
  mkdir -p "$APP/Contents/Resources/connector"
  if "$ESBUILD" ../switchboard-mcp/switchboard-mcp.mjs \
      --bundle --platform=node --format=esm --target=node18 \
      --external:bufferutil --external:utf-8-validate \
      --banner:js="import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);" \
      --outfile="$APP/Contents/Resources/connector/switchboard.mjs" \
      --log-level=warning; then
    echo "[menubar] bundled Switchboard connector (Claude Code MCP: task board + wrapps)"
  fi
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
