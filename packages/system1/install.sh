#!/usr/bin/env bash
# Opt-in install of the System 1 engine (OneJev via qev) into ~/.relay. Nothing runs until asked:
# serve.py starts on demand and unloads after SYSTEM1_IDLE_S idle seconds.
#   bash packages/system1/install.sh            # then the first request downloads the weights (~1.7GB for 0.8B)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${RELAY_DIR:-$HOME/.relay}"
QEV_REF="90a4584f17b42b8802da24324eb5318a45eb6e6b"   # OmniJev/OneJev, pinned

command -v uv >/dev/null || { echo "needs uv: https://docs.astral.sh/uv/" >&2; exit 1; }
[ -x "$DIR/system1-venv/bin/python" ] || uv venv --python 3.13 "$DIR/system1-venv"
VIRTUAL_ENV="$DIR/system1-venv" UV_HTTP_TIMEOUT=300 \
  uv pip install "qev @ git+https://github.com/OmniJev/OneJev@$QEV_REF" pillow torchvision
mkdir -p "$DIR/system1"
cp "$HERE/serve.py" "$DIR/system1/serve.py"
echo "System 1 installed. Start on demand: $DIR/system1-venv/bin/python $DIR/system1/serve.py"
