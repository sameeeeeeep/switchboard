#!/bin/sh
# Mirror this plugin to its own small repo, github.com/sameeeeeeep/switchboard-plugin.
#
# The source of truth stays here. The small repo exists so `/plugin install switchboard
# --marketplace sameeeeeeep/switchboard-plugin` clones ~2 MB instead of the whole switchboard repo
# (~600 MB on disk), which can pass Claude Code's 120 s clone limit on slow connections.
# The marketplace keeps the name `switchboard`, so the plugin id stays `switchboard@switchboard`.
#
#   node plugin/connector/build.mjs && plugin/publish.sh     # bump .claude-plugin/plugin.json first
set -eu
cd "$(dirname "$0")"

REPO=sameeeeeeep/switchboard-plugin
VERSION=$(python3 -c 'import json; print(json.load(open(".claude-plugin/plugin.json"))["version"])')
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

gh repo clone "$REPO" "$TMP/repo" -- -q
(cd "$TMP/repo" && git rm -rq --ignore-unmatch . >/dev/null)

# Tracked files only, so local caches (__pycache__, etc.) never ship.
git ls-files -z . | (cd "$TMP/repo" && xargs -0 -I{} sh -c 'mkdir -p "$(dirname "{}")"')
git ls-files -z . | xargs -0 -I{} cp -p "{}" "$TMP/repo/{}"
cp ../LICENSE "$TMP/repo/LICENSE"

cat > "$TMP/repo/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "switchboard",
  "description": "Switchboard for Claude Code: the operator connector and skills for the Switchboard Mac app.",
  "owner": { "name": "sameeeeeeep", "url": "https://github.com/sameeeeeeep/switchboard" },
  "plugins": [
    {
      "name": "switchboard",
      "source": "./",
      "description": "One Switchboard connector and operator skills for Claude Code and Codex: tasks, notch, whiteboard, PIP, and wrapps."
    }
  ]
}
EOF

# Lead the mirrored README with the install that applies to this repo.
{
  cat <<'EOF'
# Switchboard plugin for Claude Code

Mirror of [`plugin/`](https://github.com/sameeeeeeep/switchboard/tree/main/plugin) in the
Switchboard repo, published here so installing it downloads ~2 MB instead of the whole repo.
Edit the source there, not here.

Install, in Claude Code:

```text
/plugin install switchboard --marketplace sameeeeeeep/switchboard-plugin
```

The visible surfaces (notch, whiteboard, PIP) need the [Switchboard Mac app](https://thelastprompt.ai/switchboard).

---

EOF
  cat README.md
} > "$TMP/repo/README.md"

cd "$TMP/repo"
claude plugin validate --strict . >/dev/null
git add -A
if git diff --cached --quiet; then
  echo "no changes to publish"
else
  git commit -qm "switchboard plugin $VERSION (mirrored from sameeeeeeep/switchboard plugin/)"
  git push -q origin HEAD:main
fi
echo "published $REPO ($VERSION)"
