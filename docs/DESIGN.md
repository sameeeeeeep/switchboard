# Switchboard Wrapp Store — DESIGN.md

_The design system for the wrapp-store homepage (Home + Explore + Work). Warm, editorial, readable-first. Locked 2026-07-17. Every store surface inherits these tokens. The extension/broker panel is a **separate, dark** system — do not apply these there._

## Principles

1. **Readable before clever.** A daily driver you open every morning should feel like morning, not a terminal. Warmth, air, and one confident type voice beat density.
2. **Hero, then substance.** Each surface states the one thing up top (greeting + the single command input + what's-next), then the real content sits below. No wall of equal panels.
3. **Alive, not static.** The hero breathes with real preview cards (your next task, what just shipped, your brand) — the interface shows its own state.
4. **The dock is the launcher.** Wrapps live in a floating dock, summonable from anywhere.
5. **Calm home, louder discovery.** Home stays quiet and focused; Explore raises saturation (vibrant category tiles on the same cream ground) for record-store energy — same system, higher volume.
6. **The accent wears the brand.** Switchboard's own accent is the green; the active brand tints the warmth (Aamras → gold). Switch brand, the warmth shifts.

## Color tokens

Warm neutrals — the ground everything sits on:
```
--cream:      #EFECE4   /* page */
--cream-2:    #EDEAE1   /* below-hero band / recessed */
--card:       #FBFAF6   /* cards, inputs */
--card-2:     #F5F2EA   /* nested / hover */
--ink:        #1C1B17   /* primary text (warm near-black) */
--ink-2:      #565146   /* secondary text */
--faint:      #8C8676   /* muted / captions */
--line:       #E6E1D5   /* hairline */
--line-2:     #DAD3C4   /* stronger border / hover */
```
Switchboard accent (identity — links, "on your own Claude", small highlights):
```
--green:      #5E8B23
--green-soft: #E9F0DB
```
Primary action — the dark pill:
```
--pill:       #1C1B17   /* button bg */   text: #F3F0E8
```
Brand-adaptive (driven by the active context's palette; Aamras shown):
```
--brand:      #B4802A   --brand-soft: #F2E8D2
```
Semantic status (task/artifact state — distinct from the accent):
```
--ok:     #4E8A3A  (live / done)     --draft:  #B4802A  (draft / needs you)
--review: #3A6EA5  (in review)        --idle:   #8C8676  (not started)
```
Category tints (wrapp tiles — soft bg + saturated ink from the same family):
```
ads/founder   bg #F2E8D2  ink #B4802A
build         bg #E9F0DB  ink #5E8B23
studio/photo  bg #F0E7F1  ink #B54A78
review/doc    bg #E7F0F6  ink #3A6EA5
chat/make     bg #E7F1EC  ink #2E8B6A
```

## Type

- **Family:** a clean grotesk. System stack now: `"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. (Candidate to license later: Inter Tight / Hanken Grotesk / Geist — pick one before public launch.)
- **Two-ish weights that matter:** 800 hero, 700 section titles, 600 card titles/labels, 500 emphasis, 400 body. Avoid a soup of weights.
- **Scale:** hero `clamp(38px, 6vw, 60px)` / -0.03em, section `20px`/700, card title `15px`/600, body `15–16px`/1.55, small `12–13px`. Never below 12px.
- **Case:** sentence case everywhere except tiny mono-ish eyebrows (which may be uppercase with letter-spacing).

## Shape, depth, motion

- **Radius:** cards `16–18px`, controls/inputs `12px`, tiles `12px`, pills/chips `999px`. Never rounded on a single-sided border.
- **Shadow (warm, soft, barely there):** `0 1px 2px rgba(40,34,20,.04), 0 6px 20px -12px rgba(40,34,20,.14)`. No hard/neutral shadows, no glow.
- **Motion:** restrained — hover lifts on the dock (`translateY(-4px)`), gentle fades on load. Respect `prefers-reduced-motion`. No parallax circus.

## Components (canonical)

- **Pill button** — `--pill` bg, `#F3F0E8` text, radius 12, `600`. Ghost variant: transparent + `1px --line-2` border, `--ink` text.
- **Composer** — the hero input: `--card` bg, `1px --line-2`, radius 18, soft shadow, big placeholder, dark "Go →" pill on the right.
- **Card** — `--card`, `1px --line`, radius 16, soft shadow, `14–16px` padding.
- **Live card** (hero rail) — a card with an uppercase micro-label, a row `[icon] [title + status] [action]`.
- **Task row** — `[category tile] [title + status·wrapp·source] [do pill]`. Status is a colored dot + word.
- **Eyebrow** — green-soft pill, `600 12px`, uppercase, letter-spacing .04em.
- **Chip** — `--card`, `1px --line`, radius 999, `13px --ink-2`.
- **Wrapp dock** — fixed, bottom-center, frosted (`rgba(251,250,246,.9)` + blur), `1px --line-2`, radius 20, big soft shadow; 44px rounded-tile icons + a dashed "+" to explore.

## The boundary

The store homepage is warm. The **Switchboard extension panel** (connect, consent, connectors, revoke) stays its own **dark** system — it's broker chrome, and looking different from the store is correct. Wrapps themselves keep their own skins; the store only styles the shell around them.
