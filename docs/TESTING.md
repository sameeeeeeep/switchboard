# Morning test plan — what's live in Switchboard.app

The app is built, signed, and running (`packages/menubar/Switchboard.app`). Everything below is wired into *this* binary. Prereqs the loop leaves running: the daemon (:8787) and — for skills/live-drive — the dev server (`cd examples/apps && node serve.mjs`, :5188). If a live drive says "isn't signed in," run `claude` in Terminal once (daemon-side auth) — God now says that out loud instead of dying silent.

## Click-through (each maps to a commit)

1. **Notch widget system** — right-click the menu-bar icon → **Widget previews (samples)** → each of image / text / cards / gallery / working. Each grows *from the notch*; click outside collapses it back. The **project chip** sits in every widget header (switch it → persists to `context-selection.json`). Buttons: **Copy** (flashes "Copied"), **Regenerate**, **Steer** chips, **drag** the image out to Finder.
2. **God drives a wrapp — LIVE** — right-click → **Drive a wrapp (LIVE — real Claude)**. Notch shows a working widget → **Show the wrapp** flips to the window (notch shrinks to the running pill) → click away before it finishes → the roast arrives as a **notch notification**. Result renders by shape (text/cards/image), never raw JSON.
3. **HTML capability** — copy any text, right-click → **Diagram from clipboard (LIVE)** → your Claude writes HTML → it renders as an image in the notch → drag it out. Sub-minute, free.
4. **From-notch motion** — open the panel / any consent drop / God status: they unfold from the notch seam and fold back.
5. **Collapsible Settings** — panel → gear → 7 accordion rows, current value shown collapsed, one open at a time.
6. **Store** — panel → store: the **featured front page** first (hero cards + "Apps we love" + "New skills" with real hardware icons + Get), **See All** → the classic grid. 42 listings, real icons on every tile.
7. **Skills** — store → any of the 12 skills (Gist, Rephrase, Explain This, Translate, Polish, Extract, Reply, Unjargon, Name It, Action Items, Snap Answer, Recap). Or serve + open `localhost:5188/gist.html`, paste text, run — it's a granted origin, runs on your real Claude.
8. **Capture scope** — right-click → **What God sees** → Drag a region / Whole screen (checkmarked to current) — flips `~/.relay/god-region`.
9. **Concierge on open** — launching any wrapp flashes its name + tagline at the notch (no silent open).
10. **⌃⌃ voice** — the silent-death bug is fixed: God always speaks or writes `~/.relay/god-last-answer.txt` and logs a loud reason to `god-run.log`; it never dies mute. Try region-select + a question. Say *"gist this"* / *"make me ad concepts"* — God can emit `[DRIVE:<wrapp> <input>]` and the widget takes over (consent Allow).

## Verified automatically (not just claimed)
- **Harness: 92/92 green** — 68 legacy wrapp runs (zero regression) + 24 skill runs.
- **Swift: 0 errors** across all 6 files (`main` · RelayMenuBar · GodWidgetKit · GodWebWindow · StoreFront · HtmlCapability); app builds + signs.
- **Live drive proven** on real Claude earlier (roast, 2318 chars); gist/reply driven live in-harness.

## Needs YOUR call / a live pass (honestly deferred, not skipped)
- **yc composer page** — staged at `~/Documents/Projects/the-last-prompt/`; say "push it" to go live (it's your public site).
- **Orb-hover capture palette** — the *capability* ships via the right-click menu; the hover-reveal variant changes a core interaction and needs a real mouse to tune (docs/GOD-HANDS.md).
- **Cast follow-ups #2/#3** (widen cold open; carry momentum across stage boundaries) — #1 confirm-fatigue is fixed; these change run behavior and want your eyes.
- **Flagships** (meeting-notes, canvas, video-editor) + **video-to-AI** (external port, needs sb_exec) — specced (docs/STORE.md), not built; heavy/multi-session.
- **Ambient mode** — spec-only per your steer.
