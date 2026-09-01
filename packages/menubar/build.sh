#!/bin/bash
# Build Relay.app (the menu-bar app). Requires the Xcode command-line tools (swiftc).
set -e
cd "$(dirname "$0")"

echo "[menubar] compiling…"
mkdir -p build
swiftc -O -o build/Relay main.swift RelayMenuBar.swift CursorGuide.swift TeamSection.swift TeamCursorsOverlay.swift IgnitionOverlay.swift DictationScratch.swift WhiteboardPanel.swift NotchTray.swift NotchLauncherView.swift LauncherRouting.swift GodWidgetKit.swift GodWebWindow.swift StoreFrontView.swift HtmlCapability.swift SkillRunner.swift AmbientSensor.swift AmbientCanvas.swift OSShellView.swift OSSurfaceWorkspace.swift OSSurfaceAutomate.swift OSSurfaceKnowledge.swift OSSurfaceDo.swift -framework AppKit -framework SwiftUI -framework WebKit -framework ApplicationServices -framework CoreServices

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

# The floating whiteboard's page — the SAME whiteboard.html the V1 serves on :8902, bundled so the
# native WhiteboardPanel (WhiteboardPanel.swift) loads it offline from Bundle.main. The one file works both
# ways: served → fetch('/send'); embedded → window.webkit.messageHandlers.whiteboard. Skipped if absent.
WHITEBOARD="../../examples/whiteboard/whiteboard.html"
if [ -f "$WHITEBOARD" ]; then
  mkdir -p "$APP/Contents/Resources"
  cp "$WHITEBOARD" "$APP/Contents/Resources/whiteboard.html"
  echo "[menubar] bundled whiteboard.html (native floating board)"
fi

# The WEBAPPS — examples/apps served locally on :5188 by the app (serve.mjs) so the ⌥⌥ launcher widgets
# and every localhost wrapp page (crest, brandbrain, …) resolve with NO dev server. This mirrors
# package-dmg.sh §7c; without it a dev build deployed over /Applications ships an EMPTY webapps dir and
# every :5188 wrapp 404s ("not found" opening a wrapp from the store). Skipped if the source is absent.
WEBAPPS="../../examples/apps"
if [ -d "$WEBAPPS" ]; then
  mkdir -p "$APP/Contents/Resources/webapps"
  rsync -a --delete --exclude 'node_modules' --exclude '.git' --exclude '*.map' --exclude 'harness' \
    "$WEBAPPS/" "$APP/Contents/Resources/webapps/"
  echo "[menubar] bundled webapps (examples/apps → :5188 serve.mjs)"
fi

# The node runtime serve.mjs (and the connector) run on. package-dmg.sh signs it with node.entitlements;
# here we just copy it so a build deployed over /Applications carries its own runtime instead of stripping
# the DMG's. Without this the bundled :5188 server can't launch and every localhost wrapp 404s. The deploy
# step is responsible for (re)signing Resources/node. Copied only when a system node is on PATH.
if NODE_BIN="$(command -v node)"; then
  cp "$NODE_BIN" "$APP/Contents/Resources/node" && chmod 755 "$APP/Contents/Resources/node"
  echo "[menubar] bundled node runtime ($("$APP/Contents/Resources/node" --version 2>/dev/null))"
fi

# The GOD CLIENT (examples/god) + its one external dep (ws) — mirrors package-dmg.sh §6b. Without this a
# build deployed over /Applications can't LOCATE God at all: godClientPath()'s dev fallback resolves
# relative to the .app's location (→ /examples/god/god.mjs from /Applications), so ⌃⌃/⌃⌥ do nothing. Bundle
# the tree so God runs from the installed app.
GOD_SRC="../../examples/god"
if [ -d "$GOD_SRC" ]; then
  mkdir -p "$APP/Contents/Resources/god"
  cp "$GOD_SRC/god.mjs" "$APP/Contents/Resources/god/god.mjs"
  cp -R "$GOD_SRC/lib" "$APP/Contents/Resources/god/lib"
  [ -d "$GOD_SRC/personas" ] && cp -R "$GOD_SRC/personas" "$APP/Contents/Resources/god/personas"
  [ -f "$GOD_SRC/video2ai-pipeline.mjs" ] && cp "$GOD_SRC/video2ai-pipeline.mjs" "$APP/Contents/Resources/god/video2ai-pipeline.mjs"
  [ -f "../../examples/flow/whisper-stt.mjs" ] && cp "../../examples/flow/whisper-stt.mjs" "$APP/Contents/Resources/god/whisper-stt.mjs"
  if [ -d "$GOD_SRC/tts" ]; then
    mkdir -p "$APP/Contents/Resources/god/tts"
    cp "$GOD_SRC/tts/install-voice-engine.sh" "$APP/Contents/Resources/god/tts/" 2>/dev/null || true
    cp "$GOD_SRC/tts/god-tts-server.py" "$APP/Contents/Resources/god/tts/" 2>/dev/null || true
  fi
  WS_DIR="$(cd ../.. && node -e "process.stdout.write(require('path').dirname(require.resolve('ws/package.json')))" 2>/dev/null || true)"
  if [ -n "$WS_DIR" ] && [ -d "$WS_DIR" ]; then
    mkdir -p "$APP/Contents/Resources/god/node_modules/ws"
    cp -R "$WS_DIR/." "$APP/Contents/Resources/god/node_modules/ws/"
  fi
  echo "[menubar] bundled God client (examples/god + ws)"
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
