#!/bin/sh
# Shared launcher for GUI hosts, whose PATH often omits the user's Node installation.
set -eu
connector_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${SWITCHBOARD_NODE:-}" ]; then
  node_bin=$SWITCHBOARD_NODE
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
elif [ -x /Applications/Switchboard.app/Contents/Resources/node ]; then
  node_bin=/Applications/Switchboard.app/Contents/Resources/node
else
  echo 'Switchboard needs Node 20+ or the installed Switchboard app. Set SWITCHBOARD_NODE to its executable.' >&2
  exit 1
fi
exec "$node_bin" "$connector_dir/switchboard-mcp.mjs" mcp "$@"
