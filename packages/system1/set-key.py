#!/usr/bin/env python3
"""Save the user's OpenRouter key for hosted System 1 (TypeSafe Jev) without it touching chat or the screen.

Hidden prompt → ~/.relay/tool-secrets.json {"system1": {"OPENROUTER_API_KEY": ...}} at 0600, merged with the
existing tool secrets. Prints nothing about the key itself.
"""
import getpass
import json
import os
import urllib.error
import urllib.request

path = os.path.join(os.environ.get("RELAY_DIR", os.path.expanduser("~/.relay")), "tool-secrets.json")
key = getpass.getpass("Paste your OpenRouter key (hidden), then Enter: ").strip()
if not key.startswith("sk-or-"):
    raise SystemExit("That doesn't look like an OpenRouter key (they start with sk-or-). Nothing saved.")
# Hidden input makes a double paste invisible; collapse an exact repeat.
half = len(key) // 2
if len(key) % 2 == 0 and key[:half] == key[half:]:
    key = key[:half]
    print("You pasted it twice; kept one copy.")
# Check it with OpenRouter before saving, so a bad key never lands silently.
try:
    urllib.request.urlopen(urllib.request.Request("https://openrouter.ai/api/v1/key",
                                                  headers={"Authorization": "Bearer " + key}), timeout=15)
except urllib.error.HTTPError as e:
    raise SystemExit(f"OpenRouter rejected that key ({e.code}). Nothing saved.")
except OSError as e:
    raise SystemExit(f"Couldn't reach OpenRouter to check the key ({e}). Nothing saved.")
try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}
data.setdefault("system1", {})["OPENROUTER_API_KEY"] = key
fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(data, f)
os.replace(path + ".tmp", path)
os.chmod(path, 0o600)
print("Saved. System 1 will use hosted Jev now.")
