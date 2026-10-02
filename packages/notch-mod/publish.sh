#!/bin/sh
# Mirror this plugin to its own small repo, github.com/sameeeeeeep/switchboard-notch, and release it.
#
# The source of truth stays here. The small repo exists so `/plugin install ... --marketplace
# sameeeeeeep/switchboard-notch` clones ~1 MB instead of the whole switchboard repo, which can pass
# Claude Code's 120 s clone limit on slow connections.
#
#   ./build.sh && ./publish.sh          # bump .claude-plugin/plugin.json "version" first
set -eu
cd "$(dirname "$0")"

REPO=sameeeeeeep/switchboard-notch
VERSION=$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

[ -f dist/switchboard-notch.zip ] || { echo "run ./build.sh first" >&2; exit 1; }

gh repo clone "$REPO" "$TMP/repo" -- -q
cd "$TMP/repo"
git rm -rq --ignore-unmatch . >/dev/null
cd - >/dev/null

# Plugin files, plus a marketplace file so the repo is its own marketplace.
cp -R .claude-plugin hooks helper tests README.md build.sh publish.sh .gitignore "$TMP/repo/"
rm -rf "$TMP/repo/.claude-plugin/types"
cp ../../LICENSE "$TMP/repo/LICENSE"
cat > "$TMP/repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "switchboard-notch",
  "description": "Claude's questions as a native card at the Mac notch.",
  "owner": { "name": "sameeeeeeep", "url": "https://github.com/sameeeeeeep/switchboard" },
  "plugins": [
    {
      "name": "switchboard-notch",
      "source": "./",
      "description": "Claude's questions drop from your Mac's notch as a native card. A Claude Code mod (v2.1.287+, macOS 13+)."
    }
  ]
}
EOF

cd "$TMP/repo"
claude plugin validate --strict . >/dev/null
git add -A
if git diff --cached --quiet; then
  echo "no changes to publish"
else
  git commit -qm "switchboard-notch $VERSION (mirrored from sameeeeeeep/switchboard packages/notch-mod)"
  git push -q origin HEAD:main
fi
cd - >/dev/null

if gh release view "v$VERSION" -R "$REPO" >/dev/null 2>&1; then
  gh release upload "v$VERSION" dist/switchboard-notch.zip -R "$REPO" --clobber
else
  gh release create "v$VERSION" dist/switchboard-notch.zip -R "$REPO" --title "Switchboard Notch $VERSION" \
    --notes "Try for one session: \`claude --plugin-url https://github.com/$REPO/releases/download/v$VERSION/switchboard-notch.zip\`

Keep it, in Claude Code: \`/plugin install switchboard-notch --marketplace $REPO\`"
fi
echo "published $REPO v$VERSION"
