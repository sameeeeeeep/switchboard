#!/usr/bin/env python3
# Stop-hook guard: if the Switchboard app is running and my LAST assistant message contains a
# decision/approval/question for the user, but I did NOT raise a notch card this turn, BLOCK the stop
# and remind me to route it through the switchboard presence layer. Structural enforcement of the
# adhd-pm rule "decisions go to the notch" — so it doesn't depend on remembering. Conservative: only
# fires on clear decision phrasing; passes silently otherwise. Never blocks twice (stop_hook_active).
import sys, os, json, re, time, glob

def out(obj): print(json.dumps(obj)); sys.exit(0)

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # never break the turn on a parse error

if payload.get("stop_hook_active"):     # already blocked once this stop — don't loop
    sys.exit(0)

# app must be up (no notch → nothing to enforce)
if os.system("pgrep -f 'MacOS/Relay' >/dev/null 2>&1") != 0:
    sys.exit(0)

# was a notch card raised recently (this turn)? guide-run.json (consumed) / result / history mtime < 6 min
relay = os.path.expanduser("~/.relay")
now = time.time()
def fresh(p, win=360):
    try: return (now - os.path.getmtime(p)) < win
    except OSError: return False
if fresh(relay + "/guide-run.json") or fresh(relay + "/guide-result.json") or fresh(relay + "/guide-history.jsonl"):
    sys.exit(0)  # a card was raised — good, let the stop through

# PIP MODE: the handback ALWAYS closes at the notch (docs/PM-NOTCH-OPERATOR.md). If /pip is on and no
# card was raised this turn, block regardless of phrasing — the user is watching the notch, not the app.
def pip_active():
    try:
        with open(relay + "/pip.json") as f: return bool(json.load(f).get("active"))
    except Exception: return False
if pip_active():
    out({
        "decision": "block",
        "reason": ("/pip mode is ON and this turn is ending without a notch card. In PIP mode the handback "
                   "closes at the notch, never in chat: raise an 'over to you' card via the `switchboard` "
                   "skill (a one-line status + quick options + \u2325\u2193 freeform + a spoken `say`), poll "
                   "~/.relay/guide-result.json, and CONTINUE from the user's answer. They are watching the "
                   "notch, not the app. (The user can type /pip off to leave PIP mode.)")
    })

# read the last assistant message text from the transcript
tp = payload.get("transcript_path", "")
text = ""
try:
    with open(os.path.expanduser(tp)) as f:
        lines = f.readlines()
    for ln in reversed(lines):
        try: o = json.loads(ln)
        except Exception: continue
        if o.get("type") == "assistant" or o.get("message", {}).get("role") == "assistant":
            c = o.get("message", {}).get("content", o.get("content"))
            if isinstance(c, list):
                text = " ".join(seg.get("text","") for seg in c if isinstance(seg, dict))
            elif isinstance(c, str):
                text = c
            if text.strip(): break
except Exception:
    sys.exit(0)

if "?" not in text:
    sys.exit(0)

# clear decision cues (conservative — avoid firing on rhetorical questions)
cues = [
    r"\bwant me to\b", r"\bshould i\b", r"\bdo you want\b", r"\bwhich (one|option|do you|would)\b",
    r"\bor (batch|hold|wait|should)\b", r"\bprefer\b", r"\breply\s+[`\"']?\d*[a-d]\b",
    r"^\s*[a-d]\)\s", r"\bpick (one|a|which)\b", r"⭐", r"\brecommend(ed|)\b.*\?",
    r"\b(rebuild|relaunch|restart)\b.*\?", r"\bnow[, ]+or\b",
]
if any(re.search(p, text, re.I | re.M) for p in cues):
    out({
        "decision": "block",
        "reason": ("A decision/approval for the user is in your last message, the Switchboard app is up, "
                   "and no notch card was raised this turn. Per the adhd-pm skill (§0 pre-handback gate), "
                   "route it through the notch: use the `switchboard` skill to write ~/.relay/guide-run.json "
                   "with options + a spoken `say` + ⭐recommended, then read the pick back. Chat is only the "
                   "written record. If your message truly has no decision, add a brief non-decision note and stop again.")
    })
sys.exit(0)
