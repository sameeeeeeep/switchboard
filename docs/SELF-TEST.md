# SELF-TEST — how the agent verifies its own work without the human

Switchboard is a menubar (`LSUIElement`) app whose UI lives in the notch: God's status
drop, the ambient helper canvas, notch widgets, consent drops, the store. Historically the
agent built these and then handed the human a "press ⌃⌃ and tell me what you see" task. This
doc is the playbook for cutting the human out of the loop wherever honestly possible.

**One-line rule:** verify **frontend/layout** with headless snapshots (no live app), verify
**logic/flow** with file-triggers + log tails, and only fall back to the human for the three
things that are genuinely un-automatable: real Claude auth, live mic, and one-time OS grants.

---

## The blocker, verified: can computer-use drive the live notch?

**Verdict: no — and it is not worth trying to fix. Route around it instead.**

- The worktree app is `LSUIElement = true` (Info.plist) with `bundle id com.relay.menubar`.
  Accessory apps have no Dock tile / menu-bar app entry, so the accessibility **app
  resolver that `computer-use request_access` enumerates never lists it** — you cannot grant
  or target it by name.
- Every notch surface is a **borderless, non-activating, `.popUpMenu`-level** `NotchPanel`
  with `collectionBehavior = [.canJoinAllSpaces, .transient, .fullScreenAuxiliary]`
  (see `presentConsentDrop`, `showGodStatus`). These panels expose almost no standard AX
  window, so even AppleScript `System Events` UI-scripting can see the process but not
  reliably click the drop's buttons.

Workarounds evaluated:

| Attempt | Result |
|---|---|
| Install a **signed build to `/Applications`** (non-worktree path) | **Does not help.** Signing/location has no bearing on enumeration — it's still `LSUIElement`, still a transient panel. |
| Flip **`LSUIElement` → false** / change activation policy | Would make the *process* enumerable, but (a) it needs a rebuild — **main-thread owns `build.sh`** — and (b) the transient non-activating panels still resist AX clicking. Changes the shipping product for a test convenience. Not recommended. |
| **`osascript` / AppleScript UI scripting** | Can enumerate the background process, but the borderless non-activating panels have no addressable buttons. Dead end for driving. |

**The thing that DOES work: screen *recording* ≠ accessibility.** `screencapture` is a
separate TCC permission that grabs whatever pixels are on screen — including the notch
panel — with **no accessibility grant and no enumeration**. So the agent can always *see*
the live notch; it just can't *click* it. And it rarely needs to click, because the surfaces
can be summoned by file/flow triggers (below) and rendered headlessly (below).

---

## The toolbox, ranked by leverage

### 1. Headless SwiftUI snapshots — the biggest win (BUILD-NOW, prototype shipped)

Render **any** notch surface to a PNG with `ImageRenderer`, no live app, no grant, no ⌃⌃.
This is the repo's established `*.preview.swift` pattern (`GodWidgetKit.preview.swift`,
`StoreFront.preview.swift`, `AmbientCanvas.preview.swift`, `HtmlCapability.preview.swift`).

**Prototype:** `packages/menubar/SnapshotSuite.preview.swift` (new, this thread). Run:

```bash
cd packages/menubar
swiftc -parse-as-library SnapshotSuite.preview.swift -o /tmp/snapsuite && /tmp/snapsuite
```

It prints one `wrote <path>` per PNG and renders: `GodStatusDrop` at 0/1/3 reference chips,
the Listening/Speaking phases, the dashed drop-zone twin (idle + hot), and `AmbientCanvas`
(three + one). The agent then **Reads the PNG** to eyeball the layout.

- **Verifies:** exact layout, spacing, truncation, dot-matrix, colors, notch silhouette,
  chip stacking, dark-mode look, "does N chips overflow the pill" — deterministically.
- **Cannot verify:** live animation timing (a snapshot freezes one frame), real drag
  hit-testing, panel positioning against the physical notch, actual data wiring.
- **Honest limit:** the preview carries a **verbatim copy** of the structs it renders (same
  as every other `*.preview.swift`). If you change `GodStatusDrop`/`AmbientCanvas` in
  `RelayMenuBar.swift`, re-sync the copy or the snapshot lies. Keep the copies thin.

### 2. Runtime observability via the `~/.relay` files (BUILD-NOW, works today)

The app and daemon are a **file-driven state machine** — you don't need the GUI to read state:

| File | What it tells you |
|---|---|
| `~/.relay/god-state` | current phase: `idle` / `listening` / `thinking` / `speaking` (the notch mirrors this) |
| `~/.relay/god-run.log` | God's live stdout/stderr for the current turn (spawnGod pipes here) |
| `~/.relay/god-last-answer.txt` | what God last said |
| `~/.relay/god-hotkey.log` | append-only ground-truth of the ⌃⌃/⌃⌥ hotkey path (`AXIsProcessTrusted`, tap creation) — `godLog()` writes here |
| `~/.relay/god-action.json` / `god-run.json` / `god-consent.json` | the consent handshake in flight |
| `~/.relay/context-selection.json`, `catalog.json`, `grants.json`, `status.json` | project selection, installed wrapps, permission grants, daemon status |
| `~/.relay/audit.log`, `sidekick.log` | every gated call / daemon activity |

Tail after triggering a flow:

```bash
tail -f ~/.relay/god-run.log        # watch a God turn unfold
cat  ~/.relay/god-state             # snapshot the phase
```

**On `os_log` / the `macos-app-logs` skill:** assessed — **low value here**. `RelayMenuBar.swift`
uses **neither `os_log` nor `print`**; it logs to the `~/.relay/*.log` files above. So
`log stream --predicate 'process == "Switchboard"'` returns almost nothing. Prefer the file
tails. (If you add Swift logging for a specific hunt, use `Logger(...).info(..., privacy:
.public)` so the skill's `log stream` can see it — but the file-tail is the house pattern.)

### 3. Programmatic flow triggers (PARTLY today, one high-value hook NEEDS-MAIN-THREAD)

Some flows are already file-triggered and the agent can drive them today:

- **Consent handshake:** while a God run waits, write `~/.relay/god-consent.json`
  `{"allow":true}` to approve without clicking the drop.
- **Dev-drive routing:** `~/.relay/dev-drive` (empty flag) makes wrapp drives hit
  `localhost:5188/<tool>.html` instead of the deployed subdomain — pair with the harness (#5).
- **Region/economy/voice flags:** `~/.relay/god-region`, `~/.relay/economy`,
  `~/.relay/voices/selected` flip behavior via a one-line file write.

**The gap:** there is **no always-on trigger to summon a given LIVE notch surface**. The
`god-state` poll (`godStateTimer`) only runs *during* an active God turn, so writing
`god-state` from outside does nothing. Summoning the ambient canvas or a notch widget still
needs a real ⌃⌃ / real ambient detection = the human. **Proposed hook is specced below.**

### 4. Screen capture / recording (BUILD-NOW, works today, no grant beyond screen-recording)

- Still of the notch strip: `screencapture -x -R<x>,<y>,<w>,<h> /tmp/notch.png` then Read it.
  (Full screen: `screencapture -x /tmp/full.png`.) The notch sits top-center at
  `screen.frame.midX`, growing down from `maxY`.
- Video of an animated flow: `screencapture -v -V5 /tmp/clip.mov` (5s), then use the
  `capabilities` skill to analyze frames. This is the only way to check **live** dot-matrix
  animation / fade-in timing that a snapshot can't show.
- Works on the live notch **without** accessibility — this is the route-around for "see what
  the human sees." Requires the one-time Screen Recording grant (see limits).

### 5. Wrapp / page frontend testing — the harness (BUILD-NOW, works today)

`examples/apps/harness/` injects a **mock `window.claude`** before each wrapp's module and
auto-boots it headlessly against two seed projects (`switchboard` | `nailinit`):

```bash
cd examples/apps/harness && node serve.mjs      # :5188
# open /                     → grid of all wrapps × both projects
# open /h/<wrapp>?project=ID → one wrapp, provider injected, project lent
# node runner.mjs / report.mjs → headless pass/fail across the catalog
```

- **Verifies:** a wrapp's frontend pipeline — does it fire a model call, render stage-1
  output, handle the SDK contract — with zero real Claude. `runner.js` grades each
  (`made N call(s) but no stage-1 output` etc.).
- **Cannot verify:** the real broker/consent path, real model quality, the native notch shell
  around the wrapp.

### 6. God end-to-end from the CLI (BUILD-NOW for reasoning, auth-gated for the model)

`examples/god/god.mjs` has clean test seams (all env-driven):

| Env | Effect |
|---|---|
| `GOD_DRYRUN=1` | actions become `[dry-run] would …` — **no side effects**, so you can inspect *what God chose to do* |
| `GOD_IMAGE=<path>` / `GOD_IMAGES=<nl-list>` | look at a saved screenshot instead of the live screen — the canned-vision seam |
| `GOD_AUDIO=<path>` | feed a pre-recorded clip instead of the live mic |
| `GOD_MUTE=1` | skip TTS |
| `GOD_NO_SCREEN=1` | voice-only turn | 
| `GOD_SKILL=<md>` / `GOD_POINT=x,y` / `GOD_SESSION=<id>` | wear a skill inline / seed a click point / fresh session |

```bash
cd examples/god
GOD_DRYRUN=1 GOD_MUTE=1 GOD_NO_SCREEN=1 node god.mjs act "summarize my day"
```

- **Verifies:** God's action selection, tool routing, consent-gating, the run.log shape —
  end-to-end plumbing.
- **Honest limit:** `GOD_DRYRUN` stubs **side-effects, not the model call.** A real turn
  still needs Claude auth. So CLI God proves *routing/plumbing*, not model output, unless the
  human's Claude session is live.

---

## Decision tree — "to verify X, do Y"

- **Layout / spacing / colors / how a notch surface *looks* (any chip count, any phase)**
  → snapshot it: add/extend a case in `SnapshotSuite.preview.swift`, `swiftc … && run`, Read the PNG. (#1)
- **A wrapp's page logic / SDK contract**
  → `node serve.mjs` in `examples/apps/harness`, hit `/h/<wrapp>`, or run `runner.mjs`. (#5)
- **God's reasoning / which action/tool it picks / consent gating**
  → `GOD_DRYRUN=1 … node god.mjs act "…"`, read `god-run.log`. (#6, #2)
- **Did a flow reach the right phase / write the right state**
  → `cat ~/.relay/god-state`, `tail ~/.relay/god-run.log`, inspect `god-action.json` / `audit.log`. (#2)
- **Live animation timing / real fade-in / physical notch placement**
  → summon the surface (real ⌃⌃ *or* the proposed debug hook), then `screencapture -v`. (#4, #3)
- **Approve an in-flight consent without clicking**
  → write `~/.relay/god-consent.json` `{"allow":true}`. (#3)
- **A hotkey path / whether AX is trusted**
  → `tail ~/.relay/god-hotkey.log`. (#2)

## What still genuinely needs the human (be honest, don't fake these)

1. **Real Claude auth / a live model turn** — dry-run proves routing, not output.
2. **Live microphone** — real ⌃⌃ voice capture (use `GOD_AUDIO` with a canned clip instead).
3. **One-time OS grants** — Accessibility (no programmatic API), Screen Recording, Mic. Once
   granted, they persist; but the *first* grant is a human click. (Ad-hoc re-signing churns
   TCC — see the notarization notes.)
4. **Clicking a live transient notch panel** — the `LSUIElement` blocker above. Summon +
   screencapture instead of drive.

---

## Top 3 changes that most increase agent self-sufficiency

1. **Grow `SnapshotSuite.preview.swift` into the canonical surface gallery** — *(BUILD-NOW)*.
   Add every notch surface (notch widgets per `WidgetResult` case, `ConsentDrop`,
   `PermissionGateCard`, `StoreFront`, `AmbientDot`, `LocalCaptureBorder`) and a
   `snapshot.sh` that compiles+runs and drops PNGs in a known dir. One command → the whole
   frontend, deterministically, every time. Already proven this thread for the core surfaces.

2. **A debug surface-trigger watcher** — *(NEEDS-MAIN-THREAD-HOOK; spec below)*. Turns "ask
   the human to press ⌃⌃ so I can see the ambient canvas" into a file-write + `screencapture`.
   This is the single missing primitive that would let the agent drive the **live** shell.

   **Exact change (for the main thread), in `RelayController`:**
   - In `applicationDidFinishLaunching(_:)` (RelayMenuBar.swift ~L2680), behind a debug flag
     `~/.relay/dev-drive` (already exists) or a new `~/.relay/debug-surface-enabled`, start an
     always-on 0.3s `Timer` that reads `~/.relay/debug-surface.json` and, when present,
     removes it and dispatches on `json["surface"]`:
     - `"ambient"` → `showAmbientCanvas(context:suggestions:)` decoded from the JSON;
     - `"god"` → `showGodStatus(label:accent:pattern:)` (map a `phase` string);
     - `"widget"` → `showNotchWidget(WidgetSpec(...))` decoded from the JSON;
     - `"consent"` → `presentConsentDrop(...)`.
   - Guard the whole thing so it is a **no-op in a release build** (compile-time `#if DEBUG`
     or the flag-file gate) — it must never ship as a way to spoof consent.
   - Then the agent: writes `debug-surface.json` → waits 300ms → `screencapture -x -R…` →
     Reads the PNG. The live shell becomes scriptable without ⌃⌃, mic, or accessibility.

3. **Route `god.mjs` for a one-command headless reasoning check + a `screencapture` helper
   script** — *(BUILD-NOW)*. A tiny `scripts/god-dryrun.sh` wrapping the `GOD_DRYRUN=1
   GOD_MUTE=1 GOD_NO_SCREEN=1 GOD_IMAGE=<canned> node god.mjs act "…"` recipe + a
   `scripts/grab-notch.sh` computing the notch rect and calling `screencapture`. Codifies #2
   and #4 of the toolbox so they're one call, not a remembered incantation.
