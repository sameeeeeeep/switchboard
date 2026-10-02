#!/bin/sh
# Build helper/sb-card as a universal binary, sign it with Developer ID, notarize it, and package
# dist/switchboard-notch.zip for `claude --plugin-url`.
# Set SKIP_NOTARIZE=1 for a local build.
set -eu
cd "$(dirname "$0")"

IDENTITY="Developer ID Application: STAYOFT VENTURES PRIVATE LIMITED (55354KFTHU)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13" -o "$TMP/sb-card-$arch" helper/sb-card.swift \
    -framework AppKit -framework SwiftUI
done
lipo -create -output helper/sb-card "$TMP/sb-card-arm64" "$TMP/sb-card-x86_64"
codesign --force --options runtime --timestamp --identifier ai.thelastprompt.sb-card \
  --sign "$IDENTITY" helper/sb-card

if [ "${SKIP_NOTARIZE:-0}" != 1 ]; then
  ditto -c -k helper/sb-card "$TMP/sb-card.zip"
  xcrun notarytool submit "$TMP/sb-card.zip" --keychain-profile relay-notary --wait
fi

mkdir -p dist
rm -f dist/switchboard-notch.zip
zip -qr dist/switchboard-notch.zip .claude-plugin/plugin.json hooks helper/sb-card README.md
echo "built dist/switchboard-notch.zip"
