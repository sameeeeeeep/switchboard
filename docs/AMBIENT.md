# Ambient mode — strictly-local awareness → a contextual helper

Ambient mode notices what you're doing and, when a project or wrapp can help, grows a small **helper
canvas** from the notch with 1–3 contextual actions. The entire sensing path is **local** — the privacy
posture is the product, not a footnote.

## The privacy contract (non-negotiable)

- **No network. No cloud. No model. No screenshots** in the sensing/relevance path.
- Detection uses only what macOS already exposes to the OS, on-device:
  - `NSWorkspace` — the frontmost app + bundle id (needs **no** permission).
  - **Accessibility** (which the signed menubar app already holds) — the focused window title, whether a
    text field is focused, and a **best-effort browser URL read from the AX tree** (no AppleScript).
- The relevance matcher is **rules-based** (case-insensitive contains / token overlap) — no inference, no
  embeddings, no LLM. It can only ever suggest a wrapp/skill **id that is actually installed** (honesty
  guard); it cannot invent a destination.
- Nothing is persisted, transmitted, or logged off-box. A signal is produced in-process, matched locally,
  and handed to the UI. Nothing leaves the Mac until **you** pick a suggestion — and then only that
  action's payload goes through the normal consent-brokered path.
- **Off by default**, flag-gated (`~/.relay/ambient-on`), toggle in the menu-bar right-click menu.

## The sensing ladder (cheapest first, screenshot last)

1. **App detect** — `NSWorkspace.frontmostApplication`, zero grant. Classifies bundle id → kind
   (browser / editor / finder / mail / terminal / document / other).
2. **AX layer** — window title, focused-form detection, and best-effort browser URL via a bounded AX-tree
   walk (BFS capped at 400 nodes → cheap). Chrome/Safari/Arc populate the URL; Firefox is least reliable
   (degrades to nil). *Later, opt-in:* exact URLs via per-browser AppleScript automation (one Automation
   prompt each) — not built yet, per the "AX-first, AppleScript later" call.
3. **Screenshot** — a genuine last resort, expected to be **rare, and ALWAYS indicated**: a full-screen
   border in a **distinct indigo** (`#5B8DEF`, `Color.localInk`) — never the lime ⌃⌃ capture flash — with a
   "local only · never left your Mac" caption chip (`LocalCaptureBorder`). Ambient v1 takes **no**
   screenshots; the indicator is built and ready for when a suggestion needs pixels AX can't provide.

## The surface

- **Now:** a notch **drop** (`AmbientCanvas`) — same silhouette/tokens as God's pills, ≤3 suggestion rows
  (icon tile + title + kind tag + subtitle + chevron), a dismiss ✕. Grows vertically inside a fixed narrow
  width so it always reads as an extended notch, never a wide banner.
- **Idle:** `AmbientDot` — a calm "watching" presence when ambient is on but nothing is surfaced.
- **Later:** a side rail (user to specify).

### Interaction laws
- **Never fights God:** while a God pill / turn / dictation owns the notch, ambient defers; `setGlow`
  pulls the canvas down the moment God takes over.
- **Never noise:** no relevant match → shows nothing. Same card already up → not re-presented.
- **Dismiss = hush:** a manual ✕ suppresses ambient for 2 minutes.
- **Never a dead end:** picking a suggestion launches the wrapp/skill via the normal `launchWrapp` path.

## Code map
- `packages/menubar/AmbientSensor.swift` — types (`AmbientSignal`, `AmbientSuggestion`, `AmbientAppKind`),
  the `AmbientSensor` (event-driven on `didActivateApplicationNotification` + `sampleNow()`), and the local
  `suggestions(for:catalog:projects:)` matcher.
- `packages/menubar/AmbientCanvas.swift` — `AmbientCanvas`, `AmbientDot`, `LocalCaptureBorder`.
- `packages/menubar/RelayMenuBar.swift` — the controller: `startAmbientIfEnabled` / `toggleAmbient` /
  `handleAmbientSignal` / `showAmbientCanvas` / `pickAmbient`, and the menu toggle.

## Rules shipped (starting set — extend freely)
- Browser on a social host (linkedin/x/instagram/…) → a caption/repurpose wrapp.
- PDF / document viewer → a summarize/convert wrapp.
- Focused compose/reply field in mail → a reply/polish skill.
- A window title / host carrying a project's keyword → that project's best-matching wrapp.

## Not built yet
- AppleScript exact-URL layer (opt-in).
- The side-rail surface.
- Any ambient screenshot (the indicator is ready; the trigger is deliberately absent in v1).
- Dispatching the AX URL walk off the main thread if window trees get large.
