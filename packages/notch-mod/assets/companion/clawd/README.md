# Clawd companion: placeholder (art pending the owner's decision)

**Status: no art here on purpose.** `/notch companion clawd` is a hidden option (not in the README or
the directory listing). With this folder holding no `sequence.json`, the card shows no companion, so
the option is a safe no-op until a decision is made.

Why it's empty: Clawd is Anthropic's character. Whether Ask Notch ships a Clawd companion in its
Claude directory submission is the owner's call (trademark and review risk), so no Clawd artwork has
been copied from anywhere into this repo. `build.sh` and `publish.sh` leave this folder out of the
published plugin.

## To fill the slot (only after the decision)

Use the same contract as `../cat/` (see `listing/make-companion.py`, which builds it):

- `sequence.json`: `canvas` `[w, h]` in points; `overlap` (points of the canvas that sit behind the
  card's right edge); `intro` `{ delay_ms, frames: [[file, ms], ...] }` played when the card appears;
  `idle` (file shown while waiting); `settle` `{ after_s, frames }` played once after `after_s`.
- Frames: transparent PNGs at 2× the canvas size, all the same size, feet on the canvas's ground line,
  so the card only swaps pictures. File names: letters, digits, `.`, `-`, `_`, ending in `.png`.
- Keep the folder small (the cat is about 220 KB).

Then remove the `-x 'assets/companion/clawd/*'` exclusion in `build.sh`, the matching `rm` in
`publish.sh`, and document `/notch companion clawd` in the README and listing.
