#!/bin/bash
# package-dmg.sh — one command to a distributable Flow DMG.
#
#   ./examples/flow/mac/package-dmg.sh
#
# What ships: Flow.app carrying its WHOLE Switchboard runtime in Resources — a copied node binary,
# an esbuild single-file bundle of the sidekick daemon, the agent SDK's Anthropic-signed native
# `claude` CLI beside it, and Flow's whisper STT adapter. Flow.app finds all of it bundle-relative
# (FlowConfig.load's fallback), so it needs no dev checkout. It DOES still need two host tools on
# PATH — `whisper` (pip install openai-whisper) and `ffmpeg` — since those aren't ours to bundle;
# both are documented prerequisites.
#
# Mirrors packages/menubar/package-dmg.sh: ad-hoc by default, Developer ID + notarization when a
# "$NOTARY_PROFILE" keychain profile exists. Never --deep (it would destroy the Anthropic + Node
# signatures on the nested binaries). Stages a SEPARATE bundle; never touches your dev Flow.app.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"           # examples/flow/mac
ROOT="$(cd "$HERE/../../.." && pwd)"            # repo root
STAGE="$HERE/build/dmg-staging/Flow.app"
RES="$STAGE/Contents/Resources"
NOTARY_PROFILE="${NOTARY_PROFILE:-relay-notary}"
PB=/usr/libexec/PlistBuddy

say() { echo "[flow-dmg] $*"; }
die() { echo "[flow-dmg] ERROR: $*" >&2; exit 1; }

# Resolve deps via node's own upward module search (robust in a plain checkout AND a git worktree,
# where the shared install lives in the parent repo rather than $ROOT/node_modules).
ESBUILD="$(cd "$ROOT" && node -e "process.stdout.write(require.resolve('esbuild/package.json').replace(/package\.json$/,'bin/esbuild'))" 2>/dev/null || true)"
SDK_NATIVE_DIR="$(cd "$ROOT" && node -e "process.stdout.write(require('path').dirname(require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/package.json')))" 2>/dev/null || true)"
[ -n "$ESBUILD" ] && [ -f "$ESBUILD" ] || die "esbuild not found — run npm install first"
[ -n "$SDK_NATIVE_DIR" ] && [ -d "$SDK_NATIVE_DIR" ] || die "agent-sdk native package missing — run npm install first"

# ---------- 1. build + bundle the daemon (single self-contained ESM file) ----------
say "building @relay/sidekick…"
(cd "$ROOT" && npm run build -w @relay/sidekick >/dev/null)
[ -f "$ROOT/packages/sidekick/dist/index.js" ] || die "sidekick dist missing after build"

rm -rf "$HERE/build/dmg-staging"
mkdir -p "$STAGE/Contents/MacOS" "$RES/daemon"

say "bundling daemon (esbuild, single ESM file)…"
"$ESBUILD" "$ROOT/packages/sidekick/dist/index.js" \
  --bundle --platform=node --format=esm --target=node18 \
  --external:bufferutil --external:utf-8-validate \
  --banner:js="import { createRequire as __req } from 'node:module'; const require = __req(import.meta.url);" \
  --outfile="$RES/daemon/sidekick.mjs" --log-level=warning

# ---------- 2. the SDK native claude CLI, verbatim (Anthropic-signed; do not touch) ----------
mkdir -p "$RES/daemon/node_modules/@anthropic-ai"
cp -R "$SDK_NATIVE_DIR" "$RES/daemon/node_modules/@anthropic-ai/"

# ---------- 3. the node runtime + Flow's whisper adapter ----------
NODE_BIN="$(command -v node)"
file "$NODE_BIN" | grep -q "arm64" || die "node at $NODE_BIN is not arm64 — this package targets Apple Silicon"
cp "$NODE_BIN" "$RES/node"; chmod 755 "$RES/node"
cp "$ROOT/examples/flow/whisper-stt.mjs" "$RES/whisper-stt.mjs"

# ---------- 4. compile Flow.app + Info.plist ----------
say "compiling Flow.swift…"
swiftc -O -o "$STAGE/Contents/MacOS/Flow" "$HERE/Flow.swift" \
  -framework AppKit -framework SwiftUI -framework AVFoundation
cp "$HERE/Info.plist" "$STAGE/Contents/Info.plist"
printf 'APPL????' > "$STAGE/Contents/PkgInfo"
VERSION="$($PB -c 'Print CFBundleShortVersionString' "$STAGE/Contents/Info.plist")"

# ---------- 5. sign — WITHOUT --deep (preserve Anthropic/Node signatures on nested bins) ----------
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')" || true
if [ -n "${IDENTITY:-}" ]; then
  say "signing with: $IDENTITY (hardened runtime)"
  # node needs its JIT entitlements re-applied (codesign drops them); the menubar's node.entitlements
  # is the canonical set — reuse it.
  codesign --force --options runtime --timestamp \
    --entitlements "$ROOT/packages/menubar/node.entitlements" --sign "$IDENTITY" "$RES/node"
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$STAGE"
else
  say "signing ad-hoc (no Developer ID identity in keychain)"
  codesign --force --sign - "$RES/node"
  codesign --force --sign - "$STAGE"
fi
codesign -v "$STAGE" || die "app signature verify failed"

# ---------- 6. smoke test the bundled daemon (isolated state + port; never ~/.relay) ----------
if [ "${FLOW_SKIP_SMOKE:-0}" != "1" ]; then
  SMOKE_DIR="$(mktemp -d)"; SMOKE_LOG="$SMOKE_DIR/boot.log"
  say "smoke test: booting bundled daemon on port 18795…"
  RELAY_DIR="$SMOKE_DIR/state" RELAY_PORT=18795 RELAY_NATIVE=1 RELAY_NATIVE_PORT=18796 RELAY_IMPORT_CLAUDE=0 \
    "$RES/node" "$RES/daemon/sidekick.mjs" >"$SMOKE_LOG" 2>&1 &
  SMOKE_PID=$!; OK=0
  for _ in $(seq 1 40); do
    grep -q "native.*listening" "$SMOKE_LOG" 2>/dev/null && { OK=1; break; }
    kill -0 "$SMOKE_PID" 2>/dev/null || break; sleep 0.5
  done
  kill "$SMOKE_PID" 2>/dev/null || true; wait "$SMOKE_PID" 2>/dev/null || true
  if [ "$OK" = "1" ]; then say "smoke test PASSED: bundled daemon booted with the native listener"
  else sed 's/^/[daemon] /' "$SMOKE_LOG" >&2 || true; rm -rf "$SMOKE_DIR"; die "smoke test failed (log above)"; fi
  rm -rf "$SMOKE_DIR"
else say "smoke test skipped (FLOW_SKIP_SMOKE=1)"; fi

# ---------- 7. notarize the app + staple (only with Developer ID + notary profile) ----------
if [ -n "${IDENTITY:-}" ] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  say "notarizing the app…"
  ditto -c -k --keepParent "$STAGE" "$HERE/build/Flow.zip"
  xcrun notarytool submit "$HERE/build/Flow.zip" --keychain-profile "$NOTARY_PROFILE" --wait || die "app notarization failed"
  xcrun stapler staple "$STAGE" || die "stapling the app failed"
  say "app notarized + stapled"
else
  say "note: app not notarized (needs Developer ID + '$NOTARY_PROFILE' profile) — fine for local use."
fi

# ---------- 8. the DMG ----------
DMG="$HERE/build/Flow-$VERSION.dmg"
DMG_SRC="$HERE/build/dmg-src"; rm -rf "$DMG_SRC"; mkdir -p "$DMG_SRC"
cp -R "$STAGE" "$DMG_SRC/Flow.app"
ln -s /Applications "$DMG_SRC/Applications"
rm -f "$DMG"
say "building $DMG…"
hdiutil create -volname "Flow $VERSION" -srcfolder "$DMG_SRC" -ov -format UDZO "$DMG" -quiet
if [ -n "${IDENTITY:-}" ]; then codesign --force --timestamp --sign "$IDENTITY" "$DMG" || die "DMG signing failed"; fi
if [ -n "${IDENTITY:-}" ] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait || die "DMG notarization failed"
  xcrun stapler staple "$DMG" || die "stapling the DMG failed"
  say "DMG notarized + stapled"
fi
rm -rf "$DMG_SRC"
say "done → $DMG"
say "prerequisites on the target Mac:  brew install ffmpeg  ·  pip install openai-whisper"
