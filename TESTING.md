# Testing Relay

Two ways to try it: a **runnable harness** (no browser needed — for quickly seeing apps connect and
work), and the **full browser walk** (the real extension). Automated spikes already prove the daemon
+ gate + MCP + consent round-trip (`packages/sidekick/spike/*.mjs`).

## Quick: try example apps without the extension

```bash
npm run try-apps
```

Spawns the real daemon with a demo MCP server and runs three example "apps" through a headless
stand-in for the extension (the `examples/harness/` dev-extension — same WS + pairing token + origin
stamping the real extension uses):

- **chat.example** — pure completion on your Claude (connect + stream).
- **notes.example** — agentic: reads a note via an MCP tool (auto-approved read).
- **outbox.example** — agentic write: one send you approve at consent, one you deny (blocked).

You'll see real model output, the gate approving reads, and per-action write consent — the same
flow the browser gives you, minus loading the extension. (Requires `claude` signed in locally.)

### The "full AI + connectors" one: an ad generator

```bash
npm run try-adgen                 # or: npm run try-adgen -- https://your-brand.com
```

URL in → the model uses **real WebFetch** to read the site → extracts the brand → calls a
Higgsfield **image-generation** tool 3× (each a per-action write consent) → returns ad images. It
uses a **mock** Higgsfield MCP (`examples/harness/mock-higgsfield.mjs`) that returns real
placeholder image URLs; point `~/.relay/mcp.json` at the real Higgsfield connector and the same app
makes real ads — nothing else changes. This is the whole thesis in one run: the site borrows your
Claude *and* your connector, and spends nothing itself.

The apps also exist as real pages under `examples/apps/` — **chat**, **assistant**, and
**ad generator** — for the browser walk below (`npm run apps`, port 5174).

---

# The full browser walk

The last mile — the real extension in a real browser.

## 0. Build everything

```bash
npm install
npm run build      # ordered: protocol → sidekick → sdk → extension → demo
```

## 1. (Optional) connect MCP tools

To test tool calls, give the sidekick at least one MCP server. Create `~/.relay/mcp.json`:

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/Documents"]
    }
  }
}
```

Without this, completions still work; there are just no tools to grant.

## 2. Start the sidekick

```bash
npm run sidekick
```

It prints a **pairing token** and the backends online, e.g.:

```
[relay] sidekick listening on ws://127.0.0.1:8787 (paired-only)
[relay] pairing token (paste into the extension): abc123…
[relay] backends online: claude-code
```

Copy the token. (Requires you to be signed into Claude Code locally — `claude` on your PATH.)

## 3. Load the extension

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select `packages/extension/`.
4. The Relay icon appears in the toolbar. Click it → the popup shows **not paired**.
5. Paste the pairing token → **Pair**. Status flips to **paired**.

## 4. Start the demo site

```bash
npm run demo        # serves http://127.0.0.1:5173
```

Open http://127.0.0.1:5173.

## 5. Walk the flow

| Step | Do | Expect |
|---|---|---|
| Connect | Click **Connect Relay** | A **consent window** opens showing the origin, models, and any tools (with read/write badges) + budgets. Approve. |
| Grant visible | Open the Relay popup | The origin is listed with its models/tools/budget; a **Revoke** button. |
| Complete | Click **Ask (streamed)** | The answer streams into the page — running on *your* local Claude. No API key was sent. |
| Audit | Open the popup | The request + connect show in the audit log; **Export** downloads it. |
| Revoke / kill | Click **Revoke** on the origin, or the **kill switch** | The site can no longer call; kill also drops the pairing token. |

### To exercise a write-consent (needs a write-capable MCP tool granted)

An agentic completion (`stream({ prompt, agentic: true })`) that proposes a **write** tool (e.g.
`filesystem` write) triggers a **per-action consent window** every time, showing the exact args.
Deny it and the model is told it was blocked — the action never runs. This is the core security
property; it's proven headlessly in `e2e-daemon-spike.mjs` and this is its visible form.

## What each layer proves

- **Page → SDK → provider detection** — verified headlessly (the demo shows the graceful
  "not installed" fallback when the extension is absent).
- **Extension inject + bridge + origin stamping** — this manual walk (a real page gets a working
  `window.claude`, and the daemon sees the browser-verified origin).
- **Daemon gate + consent + MCP** — proven by the spikes and re-exercised here via the UI.

## Troubleshooting

- **"sidekick not reachable"** in the page → the daemon isn't running, or the token is stale.
  Re-pair with the current token from the sidekick's output.
- **Consent window doesn't open** → check the extension's service-worker console
  (`chrome://extensions` → Relay → *Inspect views: service worker*).
- **No tools in the consent window** → `~/.relay/mcp.json` is empty or a server failed to start
  (see the sidekick log line `[mcp] connected N/M servers`).
- **Completion errors** → confirm `claude` runs locally (`claude -p "hi"`).
