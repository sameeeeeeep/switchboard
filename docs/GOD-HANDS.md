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

### 4. Two surfaces: the full window AND the notch canvas
- **Floating window** (`GodWebWindow`) — the full wrapp UI, for anything substantial.
- **Notch canvas** — a lightweight expanded-notch area where a *small* feature runs inline. Target flow: invoke God → select a screen region → "make an illustrative image from this" → Prism runs **in the notch** → the image appears there → **drag it out** to drop anywhere, or **open the full modal** to tweak further. The notch canvas hosts either a compact inline webview or a native result view; escalates to the full window on demand. (Reuses the existing region-select capture; drag-out via `NSItemProvider`/`NSDraggingSource`.)

### 5. Everything emanates from the notch
No surface fades in at a random position. Panels, the store modal, consent drops, the notch canvas — all **grow out of the notch anchor** on appear and **collapse back into it** on dismiss. A shared `presentFromNotch` / `dismissToNotch` motion (scale+offset anchored at the notch origin) applied to every transient surface, matching the existing panel grammar.

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
