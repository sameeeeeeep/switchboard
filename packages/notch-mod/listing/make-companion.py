#!/usr/bin/env python3
"""Maintainer tool (not part of the plugin): build assets/companion/cat/ from the painted orange cat.

The art is the owner's own (visuals/livewall/scenes/art/sprites/cats/orange). Every frame is drawn
onto the same transparent canvas (2x pixels) with the cat's feet on the ground line, so the card
only swaps pictures and never positions anything.

    python3 listing/make-companion.py [path/to/cats/orange]
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    '~/Documents/Projects/visuals/livewall/scenes/art/sprites/cats/orange')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'companion', 'cat')
S = 2                      # pixels per point
W, H = 120, 60             # canvas, points; its left 48 pt sit behind the card's right edge
EDGE = 48                  # the card's right edge, in canvas points
GROUND = H - 3             # feet line, points (the canvas bottom is the card's bottom)
SIT_H = 46                 # sitting height, points

k_ss = SIT_H / 233         # stand-sit strip: its last frame is the sitting pose (233 px tall)
k_jump = 0.9 * 347 * k_ss / 294   # jump strip: crouch about as long as the standing cat
k_sleep = SIT_H / 265      # sit-sleep strip: its first frame is the sitting pose (265 px tall)

# name, source, scale, centre x (canvas points), lift (points above the ground)
FRAMES = [
    ('intro-01.png', 't/jump-1.png', k_jump, EDGE + 14 - 294 * k_jump / 2, 0),   # crouched, peeking out
    ('intro-02.png', 't/jump-2.png', k_jump, EDGE + 4, 3),
    ('intro-03.png', 't/jump-3.png', k_jump, EDGE + 18, 12),
    ('intro-04.png', 't/jump-4.png', k_jump, EDGE + 30, 5),
    ('intro-05.png', 't/jump-5.png', k_jump, EDGE + 32, 0),
    ('intro-06.png', 't/stand-sit-1.png', k_ss, EDGE + 30, 0),
    ('intro-07.png', 't/stand-sit-2.png', k_ss, EDGE + 29, 0),
    ('intro-08.png', 't/stand-sit-3.png', k_ss, EDGE + 27, 0),
    ('intro-09.png', 't/stand-sit-4.png', k_ss, EDGE + 25, 0),
    ('sit.png', 't/stand-sit-5.png', k_ss, EDGE + 24, 0),
    ('settle-1.png', 't/sit-sleep-2.png', k_sleep, EDGE + 26, 0),             # turns to the card
    ('settle-2.png', 't/sit-sleep-3.png', k_sleep, EDGE + 28, 0),             # lies down, drowsy
]


def shadow(canvas, cx, w, lift):
    """A soft contact shadow on the ground, fainter and smaller while the cat is in the air."""
    fade = max(0.35, 1 - lift / 16)
    layer = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rw, rh = w * 0.36 * fade * S, 2.2 * S
    d.ellipse([cx * S - rw, GROUND * S - rh, cx * S + rw, GROUND * S + rh], fill=(0, 0, 0, int(70 * fade)))
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(2.2 * S)))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, src, k, cx, lift in FRAMES:
        im = Image.open(os.path.join(SRC, src)).convert('RGBA')
        im = im.crop(im.getbbox())
        w, h = im.width * k, im.height * k
        sprite = im.resize((round(w * S), round(h * S)), Image.LANCZOS)
        canvas = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
        shadow(canvas, cx, w, lift)
        x, y = round((cx - w / 2) * S), round((GROUND - lift - h) * S)
        assert x >= 0 and x + sprite.width <= canvas.width and y >= 0, (name, x, y)
        canvas.alpha_composite(sprite, (x, y))
        canvas.save(os.path.join(OUT, name), optimize=True)
    seq = {
        'about': 'Orange cat, painted by the plugin author. Frames share one canvas; feet on the ground line.',
        'canvas': [W, H], 'overlap': EDGE,
        'intro': {'delay_ms': 180, 'frames': [['intro-01.png', 130]] +
                  [['intro-%02d.png' % i, 60] for i in range(2, 6)] +
                  [['intro-%02d.png' % i, 70] for i in range(6, 10)]},
        'idle': 'sit.png',
        'settle': {'after_s': 20, 'frames': [['settle-1.png', 240], ['settle-2.png', 0]]},
    }
    with open(os.path.join(OUT, 'sequence.json'), 'w') as f:
        json.dump(seq, f, indent=2)
        f.write('\n')
    print('wrote', len(FRAMES), 'frames to', os.path.normpath(OUT))


main()
