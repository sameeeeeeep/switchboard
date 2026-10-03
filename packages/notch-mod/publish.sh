#!/bin/sh
# Mirror this plugin to its own small repo, github.com/sameeeeeeep/ask-notch, and release it.
# (Create the empty repo first: gh repo create sameeeeeeep/ask-notch --public)
#
# The source of truth stays here. The small repo exists so `/plugin install ... --marketplace
# sameeeeeeep/ask-notch` clones ~1 MB instead of the whole switchboard repo, which can pass
# Claude Code's 120 s clone limit on slow connections.
#
#   ./build.sh && ./publish.sh          # bump .claude-plugin/plugin.json "version" first
set -eu
cd "$(dirname "$0")"

REPO=sameeeeeeep/ask-notch
VERSION=$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

[ -f dist/ask-notch.zip ] || { echo "run ./build.sh first" >&2; exit 1; }

gh repo clone "$REPO" "$TMP/repo" -- -q
cd "$TMP/repo"
git rm -rq --ignore-unmatch . >/dev/null
cd - >/dev/null

# Plugin files, plus a marketplace file so the repo is its own marketplace.
# build.sh, publish.sh and listing/ stay here: they are the maintainer's release tools.
cp -R .claude-plugin hooks helper assets README.md .gitignore "$TMP/repo/"
mkdir -p "$TMP/repo/tests" && cp tests/notch.test.ts "$TMP/repo/tests/"   # the real-window self-test stays here (maintainer tool)
rm -rf "$TMP/repo/.claude-plugin/types"
rm -rf "$TMP/repo/assets/companion/clawd"   # placeholder slot, no art until the owner decides
# The directory's validator blocks macOS/Windows system files anywhere in the plugin folder.
find "$TMP/repo" \( -name .DS_Store -o -name Thumbs.db -o -name desktop.ini -o -name __MACOSX \) -prune -exec rm -rf {} +
cp ../../LICENSE "$TMP/repo/LICENSE"
cat > "$TMP/repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "ask-notch",
  "description": "Claude's questions as a card at the Mac notch.",
  "owner": { "name": "sameeeeeeep", "url": "https://github.com/sameeeeeeep/switchboard" },
  "plugins": [
    {
      "name": "ask-notch",
      "source": "./",
      "description": "Claude's questions drop from your Mac's notch as a card. A Claude Code mod (v2.1.287+, macOS 13+)."
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
  git commit -qm "ask-notch $VERSION (mirrored from sameeeeeeep/switchboard packages/notch-mod)"
  git push -q origin HEAD:main
fi
cd - >/dev/null

if gh release view "v$VERSION" -R "$REPO" >/dev/null 2>&1; then
  gh release upload "v$VERSION" dist/ask-notch.zip -R "$REPO" --clobber
else
  gh release create "v$VERSION" dist/ask-notch.zip -R "$REPO" --title "Ask Notch $VERSION" \
    --notes "Try for one session: \`claude --plugin-url https://github.com/$REPO/releases/latest/download/ask-notch.zip\`

Keep it, in Claude Code: \`/plugin install ask-notch --marketplace $REPO\`"
fi
echo "published $REPO v$VERSION"
