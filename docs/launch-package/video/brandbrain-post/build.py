# Brandbrain post video (2026-09-23): the post's own lines as cards around real footage.
# Steps 1-4 from brandbrain-six-steps-proper.mp4, then the new parallel launch-kit run (STEP 5),
# recorded headless via CDP screencast. 1080x1080, 24fps. No em dashes anywhere on screen.
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess, sys, glob, os
HERE = Path(__file__).resolve().parent; OUT = HERE / "parts"; OUT.mkdir(exist_ok=True)
ROOT = Path("/Users/sameeprehlan/Documents/Projects/relay")
STEPS = ROOT / "docs/launch-package/media/brandbrain-six-steps-proper.mp4"
REC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "rec-frames"
FF = "/opt/homebrew/bin/ffmpeg"; W = H = 1080; FPS = 24
BG = "#090e0c"; FG = "#eeeede"; L = "#C8F250"; M = "#9aa58f"

def font(n, dot=False):
    f = ImageFont.truetype(str(ROOT / "landing/public/fonts/Doto.ttf") if dot else "/System/Library/Fonts/Supplemental/Arial.ttf", n)
    if dot:
        try: f.set_variation_by_axes([100, 900])
        except Exception: pass
    return f

def frame():
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
    for x in range(3):
        for y in range(3): d.ellipse((54 + x*11, 47 + y*11, 59 + x*11, 52 + y*11), fill=L)
    d.text((100, 45), "BRANDBRAIN", font=font(22, True), fill=FG)
    return im, d

def wrap(d, text, f, maxw):
    out, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw: cur = t
        else: out.append(cur); cur = w
    return out + [cur]

def card(name, big, small=None, dur=2.6, size=80):
    """big: list of (text, colour) lines in Doto; small: one Arial sentence under it."""
    p = OUT / f"{name}.mp4"
    proc = subprocess.Popen([FF, "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{W}x{H}",
                             "-framerate", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                             "-pix_fmt", "yuv420p", str(p)], stdin=subprocess.PIPE)
    gap = int(size * 1.25); sf = font(36)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    smalls = wrap(probe, small, sf, 960) if small else []
    block = len(big) * gap + (40 + len(smalls) * 50 if smalls else 0)
    y0 = (H - block) // 2
    for n in range(int(dur * FPS)):
        t = n / FPS; im, d = frame()
        off = int(26 * (1 - min(t / .45, 1)) ** 3)
        y = y0 + off
        for s, c in big:
            d.text((54, y), s, font=font(size, True), fill=c); y += gap
        if smalls and t > .35:
            y += 40
            for s in smalls: d.text((58, y), s, font=sf, fill=M); y += 50
        proc.stdin.write(im.tobytes())
    proc.stdin.close(); proc.wait(); return p

def run(args): subprocess.run([FF, "-v", "error", "-y"] + args, check=True)
ENC = ["-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS)]
# footage sits full-width in the square, between the mark and the footer
FIT = f"scale=1080:-2:flags=lanczos,pad=1080:1080:0:(1080-ih)/2:color={BG}"

def chrome_overlay():
    im, d = frame(); im = im.convert("RGBA")
    # punch out the footage window so the mark + footer ride over the clip
    ImageDraw.Draw(im).rectangle((0, (H - 675) // 2, W, (H + 675) // 2), fill=(0, 0, 0, 0))
    p = OUT / "chrome.png"; im.save(p); return p

SRC = Path("/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay/d784ea06-4164-4bd1-bb93-34504a3d7775/scratchpad")
BAND_Y = (H + 675) // 2  # the band under the footage

def chrome_overlay(line=None, key="plain"):
    im, d = frame(); im = im.convert("RGBA")
    ImageDraw.Draw(im).rectangle((0, (H - 675) // 2, W, BAND_Y), fill=(0, 0, 0, 0))
    if line:
        f = font(46, True); size = 46
        while d.textlength(line, font=f) > W - 108: size -= 2; f = font(size, True)
        ImageDraw.Draw(im).text((54, BAND_Y + 58), line, font=f, fill=L)
    p = OUT / f"chrome-{key}.png"; im.save(p); return p

# steps 1-4, re-recorded 2026-09-23 at a readable pace (real timing from each frames.json)
CAP = Path("/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay/07f2e814-137f-41ee-b909-f61d5d45cd40/scratchpad/steps")
STEPS4 = [("s1", "TYPE ONE LINE"), ("s2", "IT READS THE MARKET"), ("s3", "PICK FROM REAL OPTIONS"), ("s4", "GET THE DECK")]

def frames_clip(dirp, key, hold=0.8):
    import json
    fr = json.load(open(dirp / "frames.json"))
    lst = OUT / f"{key}.txt"
    with open(lst, "w") as fh:
        for i, f in enumerate(fr):
            dur = (fr[i + 1]["ts"] - f["ts"]) if i + 1 < len(fr) else hold
            fh.write(f"file '{dirp / f['name']}'\nduration {max(dur, 0.001):.4f}\n")
        fh.write(f"file '{dirp / fr[-1]['name']}'\n")
    return lst

def step_clips():
    out = []
    for key, line in STEPS4:
        lst = frames_clip(CAP / f"frames-{key}", key)
        p = OUT / f"{key}.mp4"; ov = chrome_overlay(line, key)
        run(["-f", "concat", "-safe", "0", "-i", str(lst), "-i", str(ov), "-filter_complex",
             f"[0:v]scale=1280:800:flags=lanczos,fps={FPS},{FIT}[v];[v][1:v]overlay=0:0", *ENC, str(p)])
        out.append(p)
    return out

def pill(num, label):
    """The STEP pill, matched to the six-steps cut (drawn at 1280-wide scale)."""
    f = font(46, True); probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lw = int(probe.textlength(num, font=f)) + 48; rw = int(probe.textlength(label, font=f)) + 60
    im = Image.new("RGBA", (lw + rw + 4, 84), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle((0, 2, lw + rw + 2, 82), fill=(10, 16, 12, 235), outline=(200, 242, 80, 120), width=2)
    d.rectangle((0, 2, lw, 82), fill=L)
    d.text((24, 14), num, font=f, fill=BG); d.text((lw + 30, 14), label, font=f, fill=FG)
    p = OUT / "pill5.png"; im.save(p); return p

def rec_clip():
    """The real parallel run: first beats real-time, the render wait compressed, the payoff held."""
    frames = sorted(glob.glob(str(REC / "*.jpg")))
    ts = [int(os.path.basename(f)[:-4]) / 1000 for f in frames]
    end = ts[-1] + 1.0
    def seg(a, b, speed):  # frames in [a,b) with their real durations / speed
        items = []
        for i, (f, t) in enumerate(zip(frames, ts)):
            nxt = ts[i + 1] if i + 1 < len(ts) else end
            s, e = max(t, a), min(nxt, b)
            if e > s: items.append((f, (e - s) / speed))
        return items
    click = ts[0] + 2.5; done = end - 6.5
    items = seg(0, click + 4, 1) + seg(click + 4, done, max((done - click - 4) / 10.0, 1)) + seg(done, end, 1)
    lst = OUT / "rec.txt"
    with open(lst, "w") as fh:
        for f, dur in items: fh.write(f"file '{f}'\nduration {dur:.4f}\n")
        fh.write(f"file '{items[-1][0]}'\n")
    raw = OUT / "rec-raw.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(lst), "-vf", "scale=1280:800:flags=lanczos,fps=24", *ENC, str(raw)])
    p = OUT / "rec.mp4"; ov = chrome_overlay("MOODBOARD, ASSETS AT ONCE", "rec")
    run(["-i", str(raw), "-i", str(ov), "-filter_complex", f"[0:v]{FIT}[b];[b][1:v]overlay=0:0", *ENC, str(p)])
    return p

def cta_hold(src, dur=5.0):
    """Hold the finished kit and put the ask in the band under the footage, not on a slide."""
    im = Image.new("RGBA", (W, H - BAND_Y), BG); d = ImageDraw.Draw(im)
    d.text((54, 28), "HAVE AN IDEA YOU WANT TO TRY OUT?", font=font(38, True), fill=FG)
    d.text((54, 86), "COMMENT \"BRAND\" AND I'LL SEND YOU THE LINK.", font=font(36, True), fill=L)
    band = OUT / "cta-band.png"; im.save(band)
    p = OUT / "cta.mp4"
    run(["-sseof", "-0.2", "-i", str(src), "-i", str(band), "-filter_complex",
         f"[0:v]trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={dur}[v];[v][1:v]overlay=0:{BAND_Y}", *ENC, "-t", str(dur), str(p)])
    return p

if __name__ == "__main__":
    rec = rec_clip()
    parts = [*step_clips(), rec, cta_hold(rec)]
    lst = OUT / "concat.txt"; lst.write_text("".join(f"file '{p}'\n" for p in parts))
    final = HERE / "brandbrain-post.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(lst), *ENC, "-movflags", "+faststart", str(final)])
    print(final)
