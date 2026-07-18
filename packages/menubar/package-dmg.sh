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
STAGE="$HERE/build/dmg-staging/Relay.app"
RES="$STAGE/Contents/Resources"
ESBUILD="$ROOT/node_modules/.bin/esbuild"
SDK_DIR="$ROOT/node_modules/@anthropic-ai/claude-agent-sdk"
SDK_NATIVE_DIR="$ROOT/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64"
ICON_SRC="$ROOT/packages/extension/icons"
PB=/usr/libexec/PlistBuddy

say() { echo "[package-dmg] $*"; }
die() { echo "[package-dmg] ERROR: $*" >&2; exit 1; }

[ -x "$ESBUILD" ] || die "esbuild not found at $ESBUILD — run npm install first"
[ -d "$SDK_NATIVE_DIR" ] || die "agent-sdk native package missing — run npm install first"

# ---------- 1. build the daemon (tsc -> packages/sidekick/dist) ----------
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

# ---------- 7. compile the menubar app + Info.plist ----------
say "compiling RelayMenuBar.swift…"
swiftc -O -o "$STAGE/Contents/MacOS/Relay" "$HERE/RelayMenuBar.swift" -framework AppKit -framework SwiftUI
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

# ---------- 9. sign — WITHOUT --deep (preserve Anthropic/Node signatures on nested bins) ----------
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application[^"]*"' | head -1 | tr -d '"')" || true
if [ -n "${IDENTITY:-}" ]; then
  say "signing with: $IDENTITY (hardened runtime)"
  # notarization needs hardened runtime on every executable we own; re-sign node with our
  # identity (nvm's node lacks hardened runtime). Anthropic's claude already has it — leave it.
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$RES/node"
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$STAGE"
else
  say "signing ad-hoc (no Developer ID identity in keychain)"
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

# ---------- 11. the DMG ----------
DMG="$HERE/build/Relay-$VERSION.dmg"
DMG_SRC="$(mktemp -d)"
cp -R "$STAGE" "$DMG_SRC/"
ln -s /Applications "$DMG_SRC/Applications"
say "creating DMG…"
hdiutil create -volname "Relay $VERSION" -srcfolder "$DMG_SRC" -ov -format UDZO "$DMG" -quiet
rm -rf "$DMG_SRC"

SIZE="$(du -h "$DMG" | cut -f1 | tr -d ' ')"
say "done: $DMG ($SIZE)"
say "payload: node $NODE_VER + sidekick bundle + claude CLI $SDK_VER (arm64, macOS 13+)"
if [ -z "${IDENTITY:-}" ]; then
  say "note: ad-hoc signed — users must use System Settings > Privacy & Security > Open Anyway."
  say "      see docs/DAEMON-DISTRIBUTION.md for the notarization path."
fi

# ---------- 12. notarize + staple (automatic when signed with a Developer ID and a notarytool ----------
# keychain profile exists; one-time setup: xcrun notarytool store-credentials relay-notary …)
NOTARY_PROFILE="${RELAY_NOTARY_PROFILE:-relay-notary}"
if [ -n "${IDENTITY:-}" ] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  say "notarizing with keychain profile '$NOTARY_PROFILE' (this takes a few minutes)…"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait \
    || die "notarization failed — inspect with: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE"
  xcrun stapler staple "$DMG" || die "stapling failed"
  xcrun stapler validate "$DMG" || die "staple validation failed"
  say "notarized + stapled: Gatekeeper will open this DMG without warnings (verify: spctl -a -t open --context context:primary-signature '$DMG')"
elif [ -n "${IDENTITY:-}" ]; then
  say "note: signed with Developer ID but NOT notarized — no notarytool profile '$NOTARY_PROFILE'."
  say "      one-time: xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <email> --team-id <TEAMID> --password <app-specific-pw>"
fi
