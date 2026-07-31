# God's Hands — driving wrapps from the notch

Status: building. The core (native webview drives a real wrapp on the user's real Claude) is **proven end-to-end** (2026-07-31); this spec captures the model + the decisions that shape the rest of the build.

## The thesis

A wrapp is a browser app — a scope + an orchestration + a UI. Giving God the ability to *use* a wrapp should **not** mean re-implementing each wrapp's logic as a headless function (heavy, lossy, invisible). Instead:

> **God hosts the wrapp in a surface it controls and drives the wrapp's REAL UI — so the user watches it happen.**

The per-wrapp cost is flat: a wrapp declares its God-callable actions once (`exposeToGod`), and it works no matter how complex the wrapp is inside. This is why it scales to brandbrain the same as roast.

## Architecture (built)

```
God (native)                     the wrapp (a web page)
   │  drive(tool, input)            ▲   window.__god.call(tool,input)  ← kit/webmcp.js
   ▼                                │
GodWebWindow (WKWebView) ──shim──> window.claude  ──postMessage──▶ WKScriptMessageHandler
   │                                                                     │
   │  the page can't open the daemon socket (browser-Origin rejected)    │
   └──────────── GodDaemonBridge (loopback WS, pairing token) ───────────┘
                        │ requests tagged with the wrapp's origin
                        ▼
                  the daemon ── gate + audit ──▶ the user's own Claude
```

- **`examples/apps/src/kit/webmcp.js`** — `exposeToGod(tools)`: one declaration → `navigator.modelContext.registerTool` (WebMCP standard) **and** `window.__god` ({list, call}) for the native host. Both call the same `execute`, which reuses the wrapp's own pipeline.
- **`packages/menubar/GodWebWindow.swift`** — the floating webview; injects the bridged `window.claude`, relays over `GodDaemonBridge`, exposes `listTools()` / `drive(tool:input:)`.
- Proof: God drove `roast_run` in a native WKWebView on a granted origin → a real 2318-char roast from the user's Claude, rendered live.

## The five decisions

### 1. Consent is one-time — adding a hand IS the grant
No per-action notch drop for reads. **Adding a wrapp to God (the store "give God this" toggle / install) is the consent**, granted once. God then runs that wrapp's actions freely (wildcard grant model), every call still classified + audited by the daemon. The notch confirm is reserved ONLY for genuinely destructive / outward-facing actions (send, pay, publish, delete) — the same bar as `ActionConsentDrop` today. Installing a hand ≈ installing a wrapp: a single, deliberate human act.

### 2. God is a helping hand, not a result-dump — voice-first
God does not print walls of text for the user to read. It **narrates and converses by voice** over the running wrapp: "running Prism on that selection… here's a first pass — want it warmer, or drop it somewhere?" The webview shows the work; God talks you through it and takes your next instruction by voice. Read-everything is the exception, not the default. (Lives in `examples/god/god.mjs` + `lib/companion.mjs`; the webview drive returns a compact result God summarizes aloud, not reads verbatim.)

### 3. All wrapps expose their actions
A pass across the catalog adds one `exposeToGod` declaration per wrapp (its primary one-go action, reusing its own pipeline; the context-first race guard where needed — see roast). Inert until a host drives it, so it's safe to land ahead of the integration. (In progress via background agents.)

### 4. Two surfaces: the full window AND the notch canvas — the canvas is a WIDGET
- **Floating window** (`GodWebWindow`) — the full wrapp UI, for anything substantial.
- **Notch canvas = a widget for a wrapp** (iOS/macOS widget sense). The notch is the OS-provided **frame** (one uniform `NotchDropShape` container + tokens); each wrapp provides a glanceable, interactive **subset** of itself (the one result + a couple of actions); **tap to open the full app** (the "Open in <wrapp>" escalation is a widget deep-link). It is **generic over the whole catalog**, not Prism-only — ads (adgen/adforge), a landing-page edit (marquee/redline), a video cut (reel/take), a chart (natal), a roast, a song (anthem)…
  - **Size classes = the result-type taxonomy.** Like small/medium/large widgets: `text` = small, `image` = medium, `gallery`/`html-page`/`video` = large. Each wrapp's God-tool output maps to a renderer: `image · gallery · cards · text · document · structured · html-page · audio`.
  - **The component system = the widget kit** — shared chrome (header · result renderer · action row with drag-out + open-full) that every wrapp's widget conforms to, so 33 widgets read as one system. Built on the existing house atoms/tokens (no duplication).
  - **Flagship flow:** invoke God → select a screen region → "make an illustrative image from this" → Prism runs **in the notch** → the image appears → **drag it out** (`NSItemProvider`, pattern at RelayMenuBar.swift:2034) or **open the full app** to tweak. Reuses the existing region-select capture + `captureShot`.
  - v1 = native result renderers; v2 = an inline `WKWebView` (reuse `GodWebWindow`'s shim+bridge in the notch clip) for widgets that need the live wrapp UI.

### 5. Everything emanates from the notch
No surface fades in at a random position. Panels, the store modal, consent drops, the notch canvas — all **grow out of the notch anchor** on appear and **collapse back into it** on dismiss. A shared `presentFromNotch` / `dismissToNotch` motion (scale+offset anchored at the notch origin) applied to every transient surface, matching the existing panel grammar.

## The drive state machine (built 2026-08-01)

ONE drive session, TWO surfaces, never both:
- **notch** — the widget is the surface (working state + PROJECT chip); the wrapp window loads offscreen. "Show the wrapp" flips to window mode.
- **window** — the wrapp is the surface; the notch collapses to the small running pill. On completion the result routes by where the user IS: window frontmost → the wrapp already shows it (pill flashes "done"); user elsewhere or window closed → the result **drops from the notch like a notification**. Closing the window mid-run falls back to the notch surface.

The **project chip** rides every widget header: a context-dependent command ("make me an ad") is only right if the right project is lent, so the selector lives at the moment of command — it reads/writes the same global default as the panel picker (`context-selection.json`).

## Build status & remaining

| Piece | State |
|---|---|
| `kit/webmcp.js` page-tool layer | ✅ built, proven (roast) |
| `GodWebWindow` native bridge | ✅ built, proven on real Claude; **not yet compiled into the app** (`build.sh` lists only `RelayMenuBar.swift`) |
| Rescued `switchboard-mcp` connector + cores | ✅ committed (headless "fast/invisible" lane) |
| All-wrapps `exposeToGod` pass (#3) | ⏳ in progress |
| Compile `GodWebWindow` into the app + a trigger (#1 one-time consent) | ▢ next |
| Voice helping-hand narration (#2) | ▢ next (god.mjs + companion) |
| Notch canvas widget + drag-out (#4) | ▢ next |
| From-the-notch motion (#5) | ▢ next |
| Prism through the same bridge (the visual demo) | ▢ next |

## Non-negotiables (the moat holds)
Same daemon, same per-origin grants, same audit. The webview is a rendering surface, not a new trust surface. The bridge authenticates with the pairing token and tags every request with the wrapp's authoritative origin — never the page's claim.
