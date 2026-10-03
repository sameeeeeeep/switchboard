#!/bin/sh
# Real-window checks for helper/card.js (macOS). The card opens off every display, and clicks and
# keys are posted to the card's own event queue only, so nothing reaches the app you're using.
#   sh tests/card-selftest.sh
cd "$(dirname "$0")/.."
fail=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
check() {
  out=$(/usr/bin/osascript -l JavaScript tests/card-selftest.js helper/card.js "$1" 2>"$tmp")
  err=$(cat "$tmp")
  case "$out" in
    "$2") echo "ok   $1 → $out" ;;
    *) echo "FAIL $1 → $out (wanted $2)"; echo "$err"; fail=1 ;;
  esac
  # Without a click the card must never become the key window or the active app.
  if [ "$1" = no-click-no-key ]; then
    case "$err" in *"key=true"*|*"active=true"*|*"became-key"*) echo "FAIL $1 took the keyboard: $err"; fail=1 ;; esac
  fi
}
check click-row '{"answer":"Tabs","index":1}'
check click-card-then-digit '{"answer":"Single page","index":2}'
check click-card-then-return '{"answer":"Sidebar","index":0}'
check click-card-then-down-return '{"answer":"Tabs","index":1}'
check click-card-then-esc '{"cancelled":true,"reason":"esc"}'
check type-in-box '{"answer":"2 apples","typed":true}'
check no-click-no-key '{"cancelled":true,"reason":"timeout"}'
check timeout '{"cancelled":true,"reason":"timeout"}'
exit $fail
