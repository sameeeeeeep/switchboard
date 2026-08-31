#!/bin/bash
# package-dmg.sh — one command from repo root to a distributable Relay DMG.
#
#   ./packages/menubar/package-dmg.sh
#
# What ships: Relay.app carrying its WHOLE runtime in Resources — a copied node binary,
# a single-file esbuild bundle of the sidekick daemon, and the agent SDK's Anthropic-signed
# native `claude` CLI beside it. The app itself writes the LaunchAgent pointing into its own
# bundle (see RelayMenuBar.swift). Nothing here touches the dev flow: build.sh still produces
# packages/menubar/Relay.app for local hacking; this script stages a SEPARATE bundle under
# build/dmg-staging/ and never modifies the (possibly running) Relay.app.
#
# Signing: ad-hoc by default (no Apple Developer identity on this machine). If a
# "Developer ID Application" identity is in the keychain, it is used automatically with
# --options runtime + --timestamp so the same script carries us into notarization later.
# Never --deep: it would re-sign (and destroy) the valid Anthropic signature on the claude
# CLI and the Node.js signature on the node binary.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"          # packages/menubar
ROOT="$(cd "$HERE/../.." && pwd)"              # repo root
STAGE="$HERE/build/dmg-staging/Switchboard.app"
RES="$STAGE/Contents/Resources"
ICON_SRC="$ROOT/packages/extension/icons"
PB=/usr/libexec/PlistBuddy

say() { echo "[package-dmg] $*"; }
die() { echo "[package-dmg] ERROR: $*" >&2; exit 1; }

# Resolve deps via node's own upward module search — robust in a plain checkout AND a git worktree,
# where the shared install lives in the parent repo rather than $ROOT/node_modules.
ESBUILD="$(cd "$ROOT" && node -e "process.stdout.write(require.resolve('esbuild/package.json').replace(/package\.json$/,'bin/esbuild'))" 2>/dev/null || true)"
# The native package exposes its package.json; the JS SDK hides it behind an exports map, so derive
# the JS SDK dir as its sibling under @anthropic-ai/ rather than resolving it directly.
SDK_NATIVE_DIR="$(cd "$ROOT" && node -e "process.stdout.write(require('path').dirname(require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json')))" 2>/dev/null || true)"
SDK_DIR="$(cd "$(dirname "$SDK_NATIVE_DIR")" 2>/dev/null && pwd)/claude-agent-sdk"
[ -n "$ESBUILD" ] && [ -f "$ESBUILD" ] || die "esbuild not found — run npm install first"
[ -n "$SDK_NATIVE_DIR" ] && [ -d "$SDK_NATIVE_DIR" ] || die "agent-sdk native package missing — run npm install first"
[ -f "$SDK_DIR/package.json" ] || die "agent-sdk JS package not found at $SDK_DIR"

# ---------- 1. build the daemon (tsc -> packages/sidekick/dist) ----------
# @relay/sidekick imports types from @relay/protocol's BUILT dist, so protocol must be built first —
# a stale protocol dist makes sidekick's tsc fail (e.g. a method missing from BYOPMethods) and, with
# `set -e`, kills the whole DMG. Build it up front so a fresh checkout (or a drifted dist) just works.
say "building @relay/protocol…"
(cd "$ROOT" && npm run build -w @relay/protocol >/dev/null)
say "building @relay/sidekick…"
(cd "$ROOT" && npm run build -w @relay/sidekick >/dev/null)
[ -f "$ROOT/packages/sidekick/dist/index.js" ] || die "sidekick dist missing after build"

# ---------- 2. version guard: the JS sdk and its native CLI package must agree ----------
SDK_VER="$(node -p "require('$SDK_DIR/package.json').version")"
NATIVE_VER="$(node -p "require('$SDK_NATIVE_DIR/package.json').version")"
[ "$SDK_VER" = "$NATIVE_VER" ] || die "agent-sdk version skew: sdk=$SDK_VER native=$NATIVE_VER — refusing to ship a CLI the bundle won't match"
say "agent-sdk $SDK_VER (js + native CLI agree)"

# ---------- 3. stage a FRESH bundle (idempotent; never the live Relay.app) ----------
rm -rf "$HERE/build/dmg-staging"
mkdir -p "$STAGE/Contents/MacOS" "$RES/daemon"

# ---------- 4. single-file daemon bundle ----------
# The --banner is MANDATORY: cross-spawn (CJS, inside @modelcontextprotocol/sdk's stdio
# transport) does dynamic require()s that esbuild's ESM output can't satisfy without a
# real createRequire shim — without it the daemon crashes on boot.
say "bundling daemon (esbuild, single ESM file)…"
"$ESBUILD" "$ROOT/packages/sidekick/dist/index.js" \
  --bundle --platform=node --format=esm --target=node18 \
  --external:bufferutil --external:utf-8-validate \
  --banner:js="import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);" \
  --outfile="$RES/daemon/sidekick.mjs" \
  --log-level=warning

# ---------- 4b. the Switchboard connector (Claude Code MCP) ----------
# One ESM file so the onboarding "Connect Claude Code" step has a real path: it lets a Claude Code
# session read the project board (pick up tasks) + run wrapps. Same createRequire banner as the daemon
# (the MCP stdio transport does dynamic require()s). Runs on the bundled Resources/node.
say "bundling Switchboard connector (esbuild, single ESM file)…"
mkdir -p "$RES/connector"
"$ESBUILD" "$ROOT/packages/switchboard-mcp/switchboard-mcp.mjs" \
  --bundle --platform=node --format=esm --target=node18 \
  --external:bufferutil --external:utf-8-validate \
  --banner:js="import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);" \
  --outfile="$RES/connector/switchboard.mjs" \
  --log-level=warning

# ---------- 5. the SDK's native claude CLI, verbatim, beside the bundle ----------
# sdk.mjs resolves it via createRequire(import.meta.url).resolve(
#   "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude") — i.e. relative to sidekick.mjs,
# so a sibling node_modules copy is exactly where it looks. Anthropic-signed; do not touch.
say "shipping agent-sdk native CLI ($NATIVE_VER)…"
mkdir -p "$RES/daemon/node_modules/@anthropic-ai"
cp -R "$SDK_NATIVE_DIR" "$RES/daemon/node_modules/@anthropic-ai/"

# ---------- 6. the node runtime, verbatim ----------
NODE_BIN="$(command -v node)"
file "$NODE_BIN" | grep -q "arm64" || die "node at $NODE_BIN is not arm64 — this package targets Apple Silicon"
cp "$NODE_BIN" "$RES/node"
chmod 755 "$RES/node"
NODE_VER="$("$RES/node" --version)"
{ echo "node $NODE_VER (arm64)"; echo "agent-sdk $SDK_VER"; echo "built $(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$RES/daemon/RUNTIME"
say "runtime: node $NODE_VER"

# ---------- 6b. God client (examples/god) + its ws dep — so ⌃⌥ runs the loop from the INSTALLED app ----------
say "staging God client…"
mkdir -p "$RES/god"
cp "$ROOT/examples/god/god.mjs" "$RES/god/god.mjs"
cp -R "$ROOT/examples/god/lib" "$RES/god/lib"
cp -R "$ROOT/examples/god/personas" "$RES/god/personas"
# The video2ai extraction pipeline — the ⌥⌥ launcher's "Extract video" shells out to this (Node builtins
# only; it calls yt-dlp + the capabilities.video2ai CLI on PATH at runtime). Bundled so it runs installed.
cp "$ROOT/examples/god/video2ai-pipeline.mjs" "$RES/god/video2ai-pipeline.mjs"
# Flow's whisper STT adapter — the menubar daemon's RELAY_STT_CMD points here so God can hear you
# (OpenAI `whisper --model tiny`, on-device, Homebrew PATH prepended inside the adapter).
cp "$ROOT/examples/flow/whisper-stt.mjs" "$RES/god/whisper-stt.mjs"
# The VOICE ENGINE installer + server (Clone / Convert / God's voice all speak through :7897). These
# two files are TINY (~60KB) — the heavy ~800MB (MLX venv + pocket-tts weights) is pulled ON DEMAND by
# the installer only when the user opts in (installVoiceEngine in the app), so the DMG stays lean.
# Without this, a fresh install has no way to set the engine up and those features never work.
mkdir -p "$RES/god/tts"
cp "$ROOT/examples/god/tts/install-voice-engine.sh" "$RES/god/tts/install-voice-engine.sh"
cp "$ROOT/examples/god/tts/god-tts-server.py" "$RES/god/tts/god-tts-server.py"
say "bundled voice-engine installer ($(du -sh "$RES/god/tts" | cut -f1) — heavy engine installs on demand)"
WS_DIR="$(cd "$ROOT" && node -e "process.stdout.write(require('path').dirname(require.resolve('ws/package.json')))" 2>/dev/null || true)"
[ -n "$WS_DIR" ] && [ -d "$WS_DIR" ] || die "ws package not found — run npm install first"
mkdir -p "$RES/god/node_modules/ws"
cp -R "$WS_DIR/." "$RES/god/node_modules/ws/"
say "God client staged (+ ws)"

# ---------- 6c. bundle whisper.cpp so Flow's dictation works with ZERO user setup ----------
# Without a bundled engine, Flow's STT needs the user to `brew install whisper-cpp` + fetch a model —
# a dealbreaker on a fresh install. We ship a SELF-CONTAINED whisper-cli (static, CPU-only, no Metal
# metallib to carry) + the tiny English model in Resources/stt; RelayMenuBar points RELAY_WHISPER_BIN/
# MODEL at them (and prefers them over Homebrew). Best-effort + CACHED under build/whisper-cache: if the
# toolchain is missing or a download fails, warn and continue — Flow just degrades to the prior
# "install whisper" behaviour, never blocking the release.
STT_OUT="$RES/stt"; mkdir -p "$STT_OUT"
STT_CACHE="$HERE/build/whisper-cache"; mkdir -p "$STT_CACHE"
WHISPER_TAG="${RELAY_WHISPER_TAG:-v1.7.4}"
STT_MODEL="ggml-tiny.en.bin"   # ~75MB; swap to ggml-base.en.bin for better accuracy at ~142MB
STT_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${STT_MODEL}"

if [ ! -f "$STT_CACHE/$STT_MODEL" ]; then
  say "fetching whisper model ($STT_MODEL)…"
  if curl -fL --retry 2 "$STT_MODEL_URL" -o "$STT_CACHE/$STT_MODEL.tmp" 2>/dev/null; then
    mv "$STT_CACHE/$STT_MODEL.tmp" "$STT_CACHE/$STT_MODEL"
  else
    rm -f "$STT_CACHE/$STT_MODEL.tmp"; say "⚠︎ whisper model download failed — Flow will need a user-installed model"
  fi
fi

if [ ! -x "$STT_CACHE/whisper-cli" ]; then
  if command -v cmake >/dev/null && command -v git >/dev/null; then
    say "building whisper.cpp $WHISPER_TAG (self-contained, CPU)…"
    WSRC="$STT_CACHE/src"; rm -rf "$WSRC"
    if git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggerganov/whisper.cpp "$WSRC" >/dev/null 2>&1 \
       && cmake -S "$WSRC" -B "$WSRC/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF >/dev/null 2>&1 \
       && cmake --build "$WSRC/build" --target whisper-cli -j >/dev/null 2>&1 \
       && [ -x "$WSRC/build/bin/whisper-cli" ]; then
      cp "$WSRC/build/bin/whisper-cli" "$STT_CACHE/whisper-cli"; say "whisper-cli built"
    else
      say "⚠︎ whisper.cpp build failed — Flow will need a user-installed whisper"
    fi
  else
    say "⚠︎ cmake/git not found — skipping bundled STT (Flow will need a user-installed whisper)"
  fi
fi

if [ -x "$STT_CACHE/whisper-cli" ] && [ -f "$STT_CACHE/$STT_MODEL" ]; then
  cp "$STT_CACHE/whisper-cli" "$STT_OUT/whisper-cli"; chmod +x "$STT_OUT/whisper-cli"
  cp "$STT_CACHE/$STT_MODEL" "$STT_OUT/$STT_MODEL"
  say "bundled whisper.cpp STT — Flow dictation works out of the box ($(du -sh "$STT_OUT" | cut -f1))"
else
  rmdir "$STT_OUT" 2>/dev/null || true
  say "⚠︎ bundled STT incomplete — Flow falls back to a user-installed whisper"
fi

# ---------- 7. compile the menubar app + Info.plist ----------
say "compiling the menu-bar app (all Swift files)…"
# Source list + frameworks are DERIVED FROM build.sh — never duplicated here. This script used to carry its
# own hardcoded list, which silently drifted: WhiteboardPanel.swift (the whiteboard), NotchTray.swift and
# LauncherRouting.swift were added to build.sh but not here, so the release build failed with
# "cannot find 'WhiteboardController' in scope" while the dev build was fine. Parsing the one true list keeps
# a new .swift file from ever being missing from a release again.
SWIFT_ARGS="$(sed -n 's|^swiftc -O -o build/Relay \(.*\)$|\1|p' "$HERE/build.sh")"
[ -n "$SWIFT_ARGS" ] || die "could not read the swiftc source list from build.sh (did its swiftc line change?)"
# shellcheck disable=SC2086
( cd "$HERE" && swiftc -O -o "$STAGE/Contents/MacOS/Relay" $SWIFT_ARGS )

# House fonts (optional; the panel falls back to the system font if the dir is empty).
if ls "$HERE"/fonts/*.ttf >/dev/null 2>&1 || ls "$HERE"/fonts/*.otf >/dev/null 2>&1; then
  mkdir -p "$RES/fonts"
  cp "$HERE"/fonts/*.ttf "$RES/fonts/" 2>/dev/null || true   # copy each kind independently — a
  cp "$HERE"/fonts/*.otf "$RES/fonts/" 2>/dev/null || true   # missing glob must not skip the others
  say "bundled house fonts ($(ls "$RES/fonts" | tr '\n' ' '))"
fi

# ---------- 7b. bundle the store surface (match build.sh) — catalog + wrapp icons + skill bodies ----------
CATALOG="$ROOT/examples/apps/wrapps/catalog.json"
[ -f "$CATALOG" ] && cp "$CATALOG" "$RES/catalog.json" && say "bundled catalog ($(node -e "console.log(require('$CATALOG').count)" 2>/dev/null || echo '?') listings)"
if compgen -G "$HERE/icons/*.png" >/dev/null 2>&1; then
  mkdir -p "$RES/icons"; cp "$HERE"/icons/*.png "$RES/icons/" 2>/dev/null || true
  say "bundled wrapp icons ($(ls "$HERE"/icons/*.png | wc -l | tr -d ' ') PNGs)"
fi
if compgen -G "$ROOT/examples/apps/wrapps/*/skills/*.md" >/dev/null 2>&1; then
  n=0; for f in "$ROOT"/examples/apps/wrapps/*/skills/*.md; do
    w="$(basename "$(dirname "$(dirname "$f")")")"; mkdir -p "$RES/skills/$w"; cp "$f" "$RES/skills/$w/" && n=$((n+1))
  done; say "bundled skill bodies ($n md files)"
fi

# ---------- 7c. bundle the WEBAPPS — examples/apps served locally on :5188 by the app (serve.mjs), so the
#              ⌥⌥ launcher's widgets + wrapp pages work with NO dev server (RelayMenuBar.startBundledWebServer). ----------
say "bundling webapps (examples/apps)…"
mkdir -p "$RES/webapps"
rsync -a --delete \
  --exclude 'node_modules' --exclude '.git' --exclude '*.map' --exclude 'harness' \
  "$ROOT/examples/apps/" "$RES/webapps/"
[ -f "$RES/webapps/serve.mjs" ] || die "webapps bundle missing serve.mjs"
say "webapps bundled ($(du -sh "$RES/webapps" | cut -f1), $(ls "$RES/webapps"/*-widget.html 2>/dev/null | wc -l | tr -d ' ') widgets)"

cp "$HERE/Info.plist" "$STAGE/Contents/Info.plist"
printf 'APPL????' > "$STAGE/Contents/PkgInfo"
VERSION="$($PB -c 'Print CFBundleShortVersionString' "$STAGE/Contents/Info.plist")"

# ---------- 8. app icon (best effort — reuse the extension's mark) ----------
if [ -f "$ICON_SRC/icon128.png" ] && command -v iconutil >/dev/null; then
  ICONSET="$HERE/build/dmg-staging/Relay.iconset"
  rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  cp "$ICON_SRC/icon16.png"  "$ICONSET/icon_16x16.png"     2>/dev/null || true
  cp "$ICON_SRC/icon32.png"  "$ICONSET/icon_16x16@2x.png"  2>/dev/null || true
  cp "$ICON_SRC/icon32.png"  "$ICONSET/icon_32x32.png"     2>/dev/null || true
  sips -z 64 64 "$ICON_SRC/icon128.png" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1 || true
  cp "$ICON_SRC/icon128.png" "$ICONSET/icon_128x128.png"
  if iconutil -c icns "$ICONSET" -o "$RES/Relay.icns" 2>/dev/null; then
    $PB -c 'Add :CFBundleIconFile string Relay' "$STAGE/Contents/Info.plist" 2>/dev/null \
      || $PB -c 'Set :CFBundleIconFile Relay' "$STAGE/Contents/Info.plist"
    say "icon: Relay.icns from extension icon128"
  else
    say "icon: iconutil failed — shipping without an icns (non-fatal)"
  fi
  rm -rf "$ICONSET"
fi

# ---------- 8c. strip ABSOLUTE symlinks — Gatekeeper rejects a bundle containing a symlink whose target
# is an absolute path (it "escapes" the bundle) with "damaged and can't be opened". The
# @anthropic-ai/claude-agent-sdk-darwin-arm64 npm package ships a spurious self-referential absolute
# symlink (claude-agent-sdk-darwin-arm64 -> /Applications/Switchboard.app/…) that is NOT in its
# package.json `files` and is unused (the daemon calls the real `claude` binary directly). cp -R drags
# it into the bundle. Strip every absolute symlink so the signature validates on any install path.
STRIPPED=0
while IFS= read -r l; do
  case "$(readlink "$l")" in /*) rm -f "$l"; STRIPPED=$((STRIPPED+1));; esac
done < <(find "$STAGE" -type l)
[ "$STRIPPED" -gt 0 ] && say "stripped $STRIPPED absolute symlink(s) from the bundle (Gatekeeper: no escaping links)"

# ---------- 9. sign — WITHOUT --deep (preserve Anthropic/Node signatures on nested bins) ----------
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')" || true
if [ -n "${IDENTITY:-}" ]; then
  say "signing with: $IDENTITY (hardened runtime)"
  # notarization needs hardened runtime on every executable we own; re-sign node with our
  # identity (nvm's node lacks hardened runtime). Anthropic's claude already has it — leave it.
  # node.entitlements is REQUIRED here: codesign drops entitlements unless they are passed
  # back in, and a node without allow-jit cannot boot V8 at all (step 10 catches it).
  codesign --force --options runtime --timestamp \
    --entitlements "$HERE/node.entitlements" --sign "$IDENTITY" "$RES/node"
  # our bundled whisper.cpp CLI (if present) — hardened runtime, no special entitlements (pure compute).
  [ -f "$RES/stt/whisper-cli" ] && codesign --force --options runtime --timestamp --sign "$IDENTITY" "$RES/stt/whisper-cli"
  # Relay.entitlements gives the APP itself mic (audio-input) + automation (apple-events) so the
  # hardened runtime never blocks God's ear/hands, and so the app is the microphone client TCC lists.
  codesign --force --options runtime --timestamp \
    --entitlements "$HERE/Relay.entitlements" --sign "$IDENTITY" "$STAGE"
else
  say "signing ad-hoc (no Developer ID identity in keychain)"
  [ -f "$RES/stt/whisper-cli" ] && codesign --force --sign - "$RES/stt/whisper-cli"
  codesign --force --sign - "$STAGE"
fi
codesign -v "$STAGE" || die "app signature verify failed"
codesign -v "$RES/node" || die "node signature verify failed"
codesign -v "$RES/daemon/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" \
  || die "claude CLI signature verify failed (was --deep used somewhere?)"
say "signatures verified: app, node, claude CLI"

# ---------- 10. smoke test the staged payload (isolated state dir + port; never ~/.relay) ----------
if [ "${RELAY_SKIP_SMOKE:-0}" != "1" ]; then
  SMOKE_DIR="$(mktemp -d)"
  SMOKE_PORT="${RELAY_SMOKE_PORT:-18787}"
  SMOKE_LOG="$SMOKE_DIR/boot.log"
  say "smoke test: booting staged daemon on port $SMOKE_PORT (state in $SMOKE_DIR)…"
  RELAY_DIR="$SMOKE_DIR/state" RELAY_PORT="$SMOKE_PORT" RELAY_IMPORT_CLAUDE=0 \
    "$RES/node" "$RES/daemon/sidekick.mjs" >"$SMOKE_LOG" 2>&1 &
  SMOKE_PID=$!
  OK=0
  for _ in $(seq 1 40); do
    if grep -q "backends online" "$SMOKE_LOG" 2>/dev/null; then OK=1; break; fi
    kill -0 "$SMOKE_PID" 2>/dev/null || break
    sleep 0.5
  done
  kill "$SMOKE_PID" 2>/dev/null || true
  wait "$SMOKE_PID" 2>/dev/null || true
  if [ "$OK" = "1" ] && grep -q "pairing token" "$SMOKE_LOG"; then
    say "smoke test PASSED: pairing token issued, $(grep -o 'backends online.*' "$SMOKE_LOG" | head -1)"
  else
    sed 's/^/[daemon] /' "$SMOKE_LOG" >&2 || true
    rm -rf "$SMOKE_DIR"
    die "smoke test failed — staged daemon did not boot (log above)"
  fi
  rm -rf "$SMOKE_DIR"
else
  say "smoke test skipped (RELAY_SKIP_SMOKE=1)"
fi

# ---------- 11. notarize the APP and staple the ticket INTO the bundle ----------
# Order matters. Notarizing only the DMG registers the app's cdhash with Apple, but an app
# with no ticket of its own must reach Apple's servers on first launch — offline users get
# "Relay.app is damaged and can't be opened", Gatekeeper's spectacularly misleading way of
# saying "I couldn't ask". Stapling here, before the app is copied into the DMG, makes the
# first launch work with no network at all.
NOTARY_PROFILE="${RELAY_NOTARY_PROFILE:-relay-notary}"
NOTARIZE=0
# SKIP_NOTARIZE=1 → fast local iteration builds (signed Developer ID, right-click→Open to run). Real
# releases leave it unset so the profile drives notarization.
if [ -z "${SKIP_NOTARIZE:-}" ] && [ -n "${IDENTITY:-}" ] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  NOTARIZE=1
fi

notarize_submit() {  # $1 = path to submit (.zip or .dmg)
  xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait \
    || die "notarization failed for $(basename "$1") — inspect with: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE"
}

if [ "$NOTARIZE" = "1" ]; then
  say "notarizing Relay.app with profile '$NOTARY_PROFILE' (a few minutes)…"
  ZIP_DIR="$(mktemp -d)"
  # ditto, not zip: plain `zip` mangles bundle symlinks and drops the signature.
  ditto -c -k --keepParent "$STAGE" "$ZIP_DIR/Relay.app.zip"
  notarize_submit "$ZIP_DIR/Relay.app.zip"
  rm -rf "$ZIP_DIR"
  xcrun stapler staple "$STAGE" || die "stapling the app failed"
  say "app notarized + stapled (first launch works offline)"
  # GATEKEEPER GATE (only meaningful once notarized+stapled): codesign -v does NOT catch a bundle-policy
  # failure like an escaping/absolute symlink — only spctl's exec assessment does. Without this the app
  # signs + notarizes "fine" yet opens as "damaged and can't be opened" on a real /Applications install.
  spctl -a -t exec -vv "$STAGE" 2>&1 | grep -q "accepted" \
    || die "Gatekeeper rejected the notarized app (spctl -t exec) — it would open as 'damaged'. Look for absolute/escaping symlinks in the bundle."
  say "Gatekeeper: app accepted (spctl exec) — will NOT open as 'damaged'"
fi

# ---------- 12. the DMG — built from the stapled app, then signed itself ----------
DMG="$HERE/build/Switchboard-$VERSION.dmg"
VOL="Switchboard $VERSION"
rm -f "$DMG"
say "creating DMG…"
# Try to bake a STYLED install window (dot-matrix background + drag-to-Applications arrow) via Finder.
# It needs a Mac session that can write to /Volumes AND drive Finder (Automation) — an automated/headless
# build can do neither, so this is best-effort and falls back to a plain (still valid) DMG. Run
# package-dmg in your own Terminal (grant Automation once) to get the styled window in a release.
build_styled_dmg() {
  local SZ_MB RW MNT rc=0
  SZ_MB=$(du -sm "$STAGE" | cut -f1); RW="$(mktemp -u).dmg"; MNT="/Volumes/$VOL"
  [ -f "$HERE/dmg-background.png" ] || return 1
  hdiutil detach "$MNT" -force -quiet 2>/dev/null || true
  hdiutil create -volname "$VOL" -fs HFS+ -format UDRW -size "$((SZ_MB + 140))m" -ov "$RW" -quiet || return 1
  hdiutil attach "$RW" -owners off -quiet || { rm -f "$RW"; return 1; }
  if ! cp -R "$STAGE" "$MNT/" 2>/dev/null; then hdiutil detach "$MNT" -force -quiet 2>/dev/null; rm -f "$RW"; return 1; fi
  ln -s /Applications "$MNT/Applications" 2>/dev/null
  mkdir -p "$MNT/.background" 2>/dev/null && cp "$HERE/dmg-background.png" "$MNT/.background/bg.png" 2>/dev/null
  osascript >/dev/null 2>&1 <<APPLESCRIPT || say "  (Finder styling skipped — DMG still valid; grant Automation for the styled window)"
tell application "Finder"
  tell disk "$VOL"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {360, 120, 1020, 560}
    set vo to the icon view options of container window
    set arrangement of vo to not arranged
    set icon size of vo to 96
    set text size of vo to 12
    set background picture of vo to file ".background:bg.png"
    set position of item "Switchboard.app" of container window to {170, 210}
    set position of item "Applications" of container window to {490, 210}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT
  sync
  hdiutil detach "$MNT" -quiet 2>/dev/null || hdiutil detach "$MNT" -force -quiet
  hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$DMG" -ov -quiet || rc=1
  rm -f "$RW"; return $rc
}
if build_styled_dmg && [ -f "$DMG" ]; then
  say "styled install window baked (dot-matrix background + drag arrow)"
else
  say "styled build unavailable in this environment — plain DMG (run package-dmg in a Mac Terminal for the styled window)"
  DMG_SRC="$(mktemp -d)"; cp -R "$STAGE" "$DMG_SRC/"; ln -s /Applications "$DMG_SRC/Applications"
  hdiutil create -volname "$VOL" -srcfolder "$DMG_SRC" -ov -format UDZO "$DMG" -quiet; rm -rf "$DMG_SRC"
fi

# hdiutil emits an UNSIGNED disk image. Without this the DMG itself fails Gatekeeper with
# "no usable signature" even when the app inside it is perfectly notarized.
if [ -n "${IDENTITY:-}" ]; then
  say "signing the DMG…"
  codesign --force --timestamp --sign "$IDENTITY" "$DMG" || die "DMG signing failed"
fi

# ---------- 13. notarize + staple the DMG (the app inside already carries its own ticket) ----------
if [ "$NOTARIZE" = "1" ]; then
  say "notarizing the DMG…"
  notarize_submit "$DMG"
  xcrun stapler staple "$DMG" || die "stapling the DMG failed"
  xcrun stapler validate "$DMG" || die "staple validation failed"
  spctl -a -t open --context context:primary-signature -v "$DMG" \
    || die "Gatekeeper rejected the finished DMG"
  say "Gatekeeper: DMG accepted (notarized Developer ID)"
elif [ -n "${IDENTITY:-}" ]; then
  say "note: signed with Developer ID but NOT notarized — no notarytool profile '$NOTARY_PROFILE'."
  say "      one-time: xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <email> --team-id <TEAMID>"
fi

SIZE="$(du -h "$DMG" | cut -f1 | tr -d ' ')"
say "done: $DMG ($SIZE)"
say "payload: node $NODE_VER + sidekick bundle + claude CLI $SDK_VER (arm64, macOS 13+)"
if [ -z "${IDENTITY:-}" ]; then
  say "note: ad-hoc signed — users must use System Settings > Privacy & Security > Open Anyway."
  say "      see docs/DAEMON-DISTRIBUTION.md for the notarization path."
fi
