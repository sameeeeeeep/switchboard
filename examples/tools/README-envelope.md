# The Switchboard results envelope

A third-party tool (a local MCP server) can opt into a **rich result surface** at the notch — result
cards instead of a raw text dump — by returning its `tools/call` text content as one JSON object:

```json
{
  "_switchboard": "results",
  "summary": "Web · “vision pro”",
  "text": "1. Apple Vision Pro — apple.com\n   A mixed-reality headset…\n   https://…",
  "items": [
    { "title": "Apple Vision Pro", "url": "https://…", "source": "apple.com",
      "snippet": "A mixed-reality headset…", "meta": "instant answer" }
  ]
}
```

- `summary` — one line for the card header (e.g. `Web · "vision pro"`).
- `text` — the readable fallback. **"Drop into chat" copies this**, a reasoning model reads this, and any
  non-Switchboard MCP client sees this. Keep it human-readable.
- `items[]` — what the notch renders as cards: `title` (required), `url`, `source` (host/badge),
  `snippet` (1–3 lines), `meta` (a compact right-aligned tag like `243 pts · 18 💬`).

A tool that returns plain text (no envelope) still works — the notch renders it as a text result. The
envelope is purely an opt-in upgrade. Seeds using it: `hn/server.mjs`, `websearch/server.mjs`.

The Swift side lives in `packages/menubar/GodWidgetKit.swift` (`ResultList`/`ResultCard`, the `.results`
`WidgetResult` case) and `RelayController.parseResultEnvelope` in `RelayMenuBar.swift`.
