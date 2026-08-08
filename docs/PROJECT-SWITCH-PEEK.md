# Spec — Switch project from a wrapp, via a notch peek

**Status:** spec · **Owner:** go-live (native window) · relates to [`GO-LIVE.md`](GO-LIVE.md) task 8

## The interaction

> A user is inside a wrapp running in Switchboard's **native window**. They click **switch project** in the
> wrapp's Switchboard chip. A **peek appears at the notch** listing their projects. They pick one. The project
> **for THAT wrapp** changes — and only that wrapp. Do it in another wrapp and only that one changes. No
> browser, no extension.

**Per-wrapp, not global.** The common case is each wrapp working on its own project (brandbrain on Northwind,
Adwall on Aamras, at the same time). So the switch sets a **per-origin** selection for the wrapp you're in.
A **global "working on" project** still exists as the *default*: any wrapp you haven't explicitly set inherits
it (and the OS home uses it). Two levels: per-wrapp override (what the chip switches) + global fallback.

The *selection surface* is the notch (Switchboard's one always-present presence layer) — the peek names the
wrapp it's acting on, so it's clear you're setting THAT wrapp's project.

**Trigger = the wrapp's own chip** (decided). The "switch project" affordance is the wrapp's SDK connect chip
(`mountConnect`), which lives in the wrapp's content — not the native window's header chrome. The chip ships in
the house wrapp template, so every first-party wrapp has it by default. The window header does ONLY the
traffic-light inset (Issue 1); it carries no project control.

## Why it doesn't work today (the gap)

The chip's switcher already calls **`relay.context.pick()`** (`sdk/src/connect-chip.ts:290`), which sends
**`op:"pick"`** to the daemon (`sdk/src/index.ts:219`). The picker **UI** is rendered by the **Chrome
extension** as a `consent:context-pick` prompt (`extension/src/consent-view.ts:210`, `renderContextPick`).

In a native window (`GodWebWindow`) there is **no extension**, so the `op:"pick"` request has **no surface to
render** → the click does nothing. This is the observed "can't change project from here."

Separately, the menubar's *existing* project writes go through `writeGlobalContext` (`RelayMenuBar.swift:276`),
which writes `context-selection.json` **directly**. The daemon's `ContextLibrary` loads that file **once at
boot** and never re-reads it, so a direct write leaves the daemon's in-memory selection **stale** — wrapps keep
seeing the old project. Any notch-side switch MUST route through the daemon instead (see below).

## The spec

1. **Native pick → notch peek.** When an `op:"pick"` (context) request arrives from an origin with **no
   consent/extension surface** (a native-window / `native@` principal), the daemon asks the menubar to raise a
   **notch peek**: a pick-one card listing the user's projects.
   - **Reuse the existing pick-one card** — `CursorGuide`'s `options` row already renders A/B/C options with a
     ⭐recommended pre-select and click / ⌥1·2·3 to choose (`CursorGuide.swift:349,404-455`). Options = the
     project library (`listContexts` → id, name, kind; the active one marked/recommended).
2. **Pick → set THIS wrapp's project, live.** On selection, set the **per-origin** selection for the wrapp's
   origin **through the daemon** — `selectContext(origin, contextId)` (`server.ts:642`), NOT the global
   `setActiveProject`. Never a direct file write, so the daemon's in-memory selection updates immediately and
   persists. (The global `setActiveProject` stays the OS-level "working on" default only.)
3. **Wrapp updates itself.** The daemon's existing `permissionsChanged` / context-changed nudge fires; the
   chip's `refresh()` observes the new `context.active()` and calls `onProjectChange` once
   (`connect-chip.ts:231-235,288-290`). No wrapp or chip change required.

## What this reuses (almost all of it)

| Piece | Already exists |
|---|---|
| Chip "switch project" affordance | `connect-chip.ts` `.proj-row` switcher → `relay.context.pick()` |
| The `pick` seam | `sdk/index.ts:219` `op:"pick"` |
| Pick-one card at the notch | `CursorGuide` `options` (`CursorGuide.swift:404-455`) |
| Set-active, live + persisted | daemon `setActiveProject`/`selectContext` (`server.ts:668,642`) |
| Wrapp auto-refresh on change | `permissionsChanged` → chip `onProjectChange` |

**New work is only the bridge:** route a surface-less `op:"pick"` to a menubar notch peek, and wire that peek's
choice back through `setActiveProject`.

## Touchpoints

- `packages/sidekick/src/server.ts` — on `op:"pick"` from a native/surfaceless principal, request a menubar
  project peek (a new control the menubar listens for) instead of assuming an extension consent surface.
- `packages/menubar/` — a notch project peek (reuse `CursorGuide` options); on pick, call the daemon
  `setActiveProject` control action. **Retire `writeGlobalContext` in favour of the daemon call** so the notch
  and the Chrome sidebar share one live path.
- No change to `connect-chip.ts` or any wrapp.

## Out of scope (tracked separately)

- **Issue 1 — window header vs traffic lights.** `GodWebWindow` uses `.fullSizeContentView` with the web view
  as the content view, so the macOS close/minimize buttons float over the wrapp's top bar
  (`GodWebWindow.swift:132-143`). Fix = a top inset / small header strip. Independent of this spec.
- **Show ALL projects.** The notch launcher currently lists active + 3 recent
  (`NotchLauncherView.swift:233-245`); the peek should list the full library (or be searchable) so any project
  is reachable, not just recent ones.
