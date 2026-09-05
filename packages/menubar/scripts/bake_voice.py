#!/usr/bin/env python3
# Bake the onboarding operator's spoken lines to bundled clips so they play INSTANTLY on first run
# (founder: "guided voice pre-loaded, it can't be generated"). Parses the exact `say` lines from
# startWelcomeTour, normalizes them EXACTLY like speakGuideLine (strip quotes, newlines->space), hashes
# with the SAME djb2 the Swift cache uses, and renders each via the local god-tts server to
# packages/menubar/onboarding-voice/<hash>.wav. build.sh bundles that dir; speakGuideLine plays it first.
import re, os, json, subprocess, sys

MENUBAR = "/Users/sameeprehlan/Documents/Projects/relay/packages/menubar"
SRC = os.path.join(MENUBAR, "RelayMenuBar.swift")
OUT = os.path.join(MENUBAR, "onboarding-voice")
VOICE = "moira"            # the default onboarding operator voice
SPEAK = "http://127.0.0.1:7897/speak"
os.makedirs(OUT, exist_ok=True)

src = open(SRC, encoding="utf-8").read()
# isolate startWelcomeTour so we only bake its lines
i = src.find("func startWelcomeTour()")
j = src.find("@objc private func replayWelcomeTour", i)
body = src[i:j] if i >= 0 and j > i else src

# every "say": "<...>" (no embedded escaped quotes in these lines)
says = re.findall(r'"say":\s*"([^"]*)"', body)
print(f"found {len(says)} say lines")

def djb2(s: str) -> str:
    h = 5381
    for b in s.encode("utf-8"):
        h = ((h * 33) ^ b) & 0xFFFFFFFFFFFFFFFF
    return format(h, "x")

made, skipped, failed = 0, 0, 0
manifest = {}
for raw in says:
    line = raw.replace('"', '').replace('\n', ' ')   # EXACT match to speakGuideLine normalization
    if not line.strip():
        continue
    hx = djb2(line)
    dst = os.path.join(OUT, f"{hx}.wav")
    manifest[hx] = line
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        skipped += 1; print(f"  = cached {hx}  {line[:48]!r}"); continue
    body_json = json.dumps({"text": line, "voice": VOICE})
    r = subprocess.run(["/usr/bin/curl", "-s", "-m", "120", "-X", "POST", SPEAK,
                        "-H", "content-type: application/json", "-d", body_json, "-o", dst],
                       capture_output=True)
    ok = r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 1000
    if ok:
        made += 1; print(f"  + baked {hx}  ({os.path.getsize(dst)} B)  {line[:48]!r}")
    else:
        failed += 1
        if os.path.exists(dst): os.remove(dst)
        print(f"  ! FAILED {hx}  rc={r.returncode}  {line[:48]!r}")

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=2, ensure_ascii=False)
print(f"done: baked {made}, cached {skipped}, failed {failed}  -> {OUT}")
sys.exit(1 if failed else 0)
