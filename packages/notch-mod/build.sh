#!/bin/sh
# Package dist/ask-notch.zip for `claude --plugin-url`. Nothing is compiled or signed: the card is
# helper/card.js, run by macOS's own /usr/bin/osascript.
set -eu
cd "$(dirname "$0")"

claude plugin validate "$PWD" >/dev/null
mkdir -p dist
rm -f dist/ask-notch.zip
# Leave out macOS/Windows system files (the directory's validator blocks them) and the Clawd companion
# slot, which holds no art until the owner decides (assets/companion/clawd/README.md).
zip -qr dist/ask-notch.zip .claude-plugin/plugin.json hooks helper skills assets README.md \
  -x '*.DS_Store' -x '*Thumbs.db' -x '*desktop.ini' -x '__MACOSX/*' -x 'assets/companion/clawd/*'
echo "built dist/ask-notch.zip ($(du -h dist/ask-notch.zip | cut -f1))"
