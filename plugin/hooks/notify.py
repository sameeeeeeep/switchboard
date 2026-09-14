#!/usr/bin/env python3
"""Shared local attention adapter. No model calls and no permission decisions."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def agent_name(event):
    return 'Codex' if event.get('model') or event.get('turn_id') or os.getenv('PLUGIN_ROOT') else 'Claude Code'


def atomic_json(path, value):
    fd, tmp = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main(event):
    if subprocess.run(['pgrep', '-f', 'MacOS/Relay'], stdout=subprocess.DEVNULL).returncode:
        return
    agent = agent_name(event)
    directory = Path(os.getenv('RELAY_DIR', str(Path.home() / '.relay')))
    directory.mkdir(parents=True, exist_ok=True)
    sid = str(event.get('session_id') or '')
    kind = event.get('hook_event_name') or 'Notification'
    message = (event.get('message') or event.get('title') or
               (f'{agent} needs permission in its app' if kind == 'PermissionRequest' else f'{agent} needs your attention'))
    key = hashlib.sha256(json.dumps([agent, sid, event.get('turn_id'), kind, message]).encode()).hexdigest()
    # An old manual registration and the plugin can briefly coexist during migration.
    # Deduplicate only near-identical events, not a later request with the same message.
    stamp = directory / 'agent-notify-stamp.json'
    import time
    try:
        old = json.loads(stamp.read_text())
        if old.get('key') == key and time.time() - old.get('at', 0) < 3:
            return
    except (OSError, ValueError):
        pass
    atomic_json(stamp, {'key': key, 'at': time.time()})
    # Use a toast: it never replaces an unanswered guide and cannot approve the host prompt.
    atomic_json(directory / 'guide-notify.json', {
        'text': str(message)[:240], 'kind': 'info',
        'source': agent + (' · #' + sid[:8] if sid else ''),
        'project': Path(event.get('cwd') or os.getcwd()).name, 'ttl': 5,
    })


if __name__ == '__main__':
    try:
        main(json.load(sys.stdin))
    except Exception:
        pass
