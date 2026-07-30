# Switchboard notch panel — full spec

The menu-bar popover becomes a **notch app**: a black, horizontally-laid-out panel that **drops from
the notch** (top-center of the main display) with the DynamicIsland/NotchNook aesthetic — squared top
edge hugging the notch, rounded bottom, a short slide-down. This spec runs the completeness pass
(reversibility · legibility · order · every state · edges) so it's built for living-with, not the demo.

---

## 1. Presentation model

- **Trigger:** clicking the menu-bar glyph (kept — it's the discoverable handle and the working
  indicator). The panel animates **down from the notch**, not from under the glyph.
- **Anchor:** `screen.main`. x = centered on the notch if the display has one
  (`safeAreaInsets.top > menuBarHeight` / `screen.auxiliaryTopLeftArea`), else screen horizontal
  center. y = top, flush under the menu bar so the top edge blends into the notch/black menu bar.
- **Shape:** top-left/top-right radius = the notch corner radius (or 0 on non-notch); bottom-left/
  bottom-right radius = 20. Fill pure black (#000) so it reads as the notch growing downward.
- **Animation:** appear = height grows from 0 + fade (200ms ease-out); dismiss = reverse (150ms).
  Respect `NSWorkspace.accessibilityDisplayShouldReduceMotion` → cross-fade only, no grow.
- **Dismiss:** click-outside (global monitor, as today), `Esc`, or clicking the glyph again.
- **Level/behaviour:** `.statusBar` level, `[.canJoinAllSpaces, .transient]`, non-activating — same
  as today, so it floats over full-screen apps and every Space.

### Notch vs. non-notch (edge)
- **Notched display:** center on the notch; top corners match the notch radius; the top ~notch-height
  strip is pure black so the panel and notch are one shape.
- **No notch:** center on screen; top corners squared; drops from the menu bar. Still reads as a
  "drops from the top" panel — no notch cutout is drawn.
- **External / multiple displays:** anchor to the display that owns the menu bar the glyph was clicked
  on (`statusItem.button?.window?.screen`), falling back to `.main`. Never draw off-screen; clamp x.

---

## 2. Connected-app platform badge (top-right of each tile)

Every app tile carries a **small corner badge** (bottom-right of the 44px icon) naming the surface it
speaks from — so web vs Mac vs iPhone is legible at a glance, not inferred from the icon.

| Principal            | Kind     | Badge glyph            | Meaning                         |
|----------------------|----------|------------------------|---------------------------------|
| `https://…`          | `web`    | `globe`                | a web wrapp (browser)           |
| `native@<appId>`     | `mac`    | `laptopcomputer`       | a native macOS app              |
| `bridge@<device>/…`  | `iphone` | `iphone`               | a paired iPhone (phone bridge)  |
| `tabsidekick@<host>` | `tab`    | `square.on.square.dashed` | a TabSidekick tab helper     |

- Badge = a ~14px circle, page-black fill + 1px edge stroke, glyph in `ink-dim`. Sits at the icon's
  bottom-right, slightly overlapping (like an app-badge). Always shown (not hover-only) — the whole
  point is at-a-glance legibility.
- The icon itself is the app's **real** icon (Mac: `.app` bundle icon; iPhone: the bridged origin's
  favicon or a phone-tile; web: the wrapp's store icon → favicon → globe). Badge is the *platform*,
  icon is the *identity*.

---

## 3. State matrix (every state designed, not just many+success)

### Daemon lifecycle (drives the rail hero + glyph)
| State        | Glyph      | Rail hero                    | Right content                          |
|--------------|------------|------------------------------|----------------------------------------|
| offline      | slate mark | "Offline" · "the daemon is stopped" | offline hint + `start` in rail  |
| starting     | slate→lime | "Starting…"                  | offline hint (until first reachable poll)|
| on / idle    | lime       | "Idle" · last activity line  | apps · models · tools                  |
| working      | breathing  | "Working" · who-for          | apps · models · tools                  |
| signed-out   | **red**    | "Sign in" · one-line fix     | apps + models(cloud greyed, red note)  |
| update-ready | lime       | (unchanged)                  | top banner "newer daemon shipped" + `update` |
| dev-plist    | lime       | (unchanged)                  | top banner "managed by a dev install" + `take over` |
| stale-plist  | lime       | (unchanged)                  | top banner "points at a missing install" + `repair` |
| translocated | slate      | "Offline" · "move to /Applications, reopen" | offline hint            |

### Connected apps
- **empty** (running, 0 grants): "No apps yet — open a wrapp and it'll ask to connect."
- **one / many**: horizontal icon row, **active-first** (most-recent activity), TabSidekick helpers
  always last. Each tile: real icon + platform badge + name caption.
- **overflow** (row wider than the pane): horizontal scroll (no wrap); the row never pushes the panel
  wide. A subtle right-edge fade hints there's more.
- **native (mac/iphone)**: shows the disconnect **×** on the tile (reversibility). Web/tab: no × (web
  is re-granted per connect; tab helpers are ephemeral).
- **disconnecting**: confirm alert → on confirm the tile drops on next refresh; optimistic remove is
  fine but re-reads `grants.json` as source of truth.

### Models (one unified section)
- **cloud signed-in**: Opus/Sonnet/Haiku available (normal). **signed-out**: greyed + "CLAUDE CODE ·
  SIGNED OUT" in red; the rail hero already carries the fix.
- **ollama running + models**: all installed shown; **loaded** highlighted (lime, RAM/idle/×),
  **idle** greyed. **running + none installed**: "No local models — pull one with `ollama pull`."
  **not running**: "OLLAMA · NOT RUNNING", no chips. **query in-flight** (first open): show last known
  / empty, never a spinner blocking the panel.
- **unload in-flight**: tapping × POSTs keep_alive:0 then refreshes; the chip greys within ~1s. If the
  unload fails the model reappears loaded next poll (honest).
- **loaded count**: header "N loaded · X.X GB" only when N>0.

### Tools (connectors)
- **empty / warming** (no `status.json` yet): "Warming up…" (the daemon writes every 30s).
- **ok**: brand icon + name + tool count. **not-ok** (0 tools / unreachable): dimmed, count hidden.
- **many**: vertical list; if it exceeds the pane height, the tools column scrolls independently.

### Loading / first-run
- **first-run** (no token file): panel auto-presents once (as today), teaching where it lives; the
  rail shows `pairing` prominently.
- **favicon/icon loading**: tiles show the SF-Symbol fallback until the real icon lands, then cross-
  fade in. Never a flash of empty box.
- **first poll**: glyph starts slate; rail "Offline" until the first reachable result (~1.6s).

### Error / offline / denied
- **daemon unreachable**: offline state (above); controls offer `start`.
- **ollama error/timeout**: treated as "not running" (fail quiet, never a red error in the panel).
- **icon fetch fail**: keep the fallback glyph; the origin is marked failed so we don't re-hammer it.
- **consent prompt mid-open**: a native/iphone "Allow this app?" `NSAlert` still fires over the panel
  (the panel is transient and yields to the modal); after approve, the panel's next refresh shows the
  new app active-first.
- **concurrent**: two displays / rapid re-open — the panel re-anchors to the current screen each open;
  only one instance is ever visible.

---

## 4. Reversibility (every add has its remove)
- connect app → **disconnect ×** on native/iphone tiles (confirmed).
- load model → **unload ×** on the chip.
- start daemon → **stop**. install/repair/take-over → each explicit + confirmed.
- The panel never performs a destructive action silently; the glyph never shows a green "on" over a
  daemon that can't actually run a call (signed-out ⇒ red).

---

## 5. Build notes
- Reuse the existing horizontal rail/content layout; only the **window presentation** (position, shape,
  animation) and the **platform badge** + `AppKind {web, mac, iphone, tab}` change.
- `classify()` gains `bridge@ → .iphone`; `native@ → .mac`. `readApps()` sets `platform` per row.
- Notch geometry from `NSScreen.safeAreaInsets` / `auxiliaryTopLeftArea`; corner radius from the notch
  or a constant. No private API.
- Not runtime-verifiable here (GUI/notch/animation need a real run) — ships to the user to feel.
