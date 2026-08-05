#!/usr/bin/env python3
"""Claude Code → Switchboard notch. A hook script: reads the Claude Code event JSON on stdin and raises a
presence card at the user's notch (via ~/.relay/guide-run.json) instead of a silent terminal prompt — the
"Claude needs you" moment shows up on-screen. Register it on the Notification event in ~/.claude/settings.json:

    "hooks": { "Notification": [ { "matcher": "",
      "hooks": [ { "type": "command", "command": "python3 ~/.relay/hooks/cc-notify.py" } ] } ] }

Non-fatal by design: any error exits 0 so it never blocks Claude Code."""
import sys, json, os

def main():
    try:
        raw = sys.stdin.read()
        ev = json.loads(raw) if raw.strip() else {}
    except Exception:
        ev = {}
    msg = (ev.get("message") or ev.get("title") or "Claude Code needs your attention").strip()
    cwd = ev.get("cwd") or os.getcwd()
    proj = os.path.basename(cwd.rstrip("/")) or "—"
    run = {
        "mode": "teach", "title": "Claude Code",
        "source": "Claude Code", "project": proj,
        "steps": [{
            "id": "cc-notif", "text": msg, "placement": "notch",
            "hint": "⌥→ dismiss · switch back to your terminal to continue",
        }],
    }
    d = os.path.expanduser("~/.relay")
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "guide-run.json.tmp")
    dst = os.path.join(d, "guide-run.json")
    with open(tmp, "w") as f:
        f.write(json.dumps(run))
    os.replace(tmp, dst)   # atomic

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass   # never block Claude Code
    sys.exit(0)
