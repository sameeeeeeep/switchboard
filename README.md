# Relay — MetaMask, but for AI

A local **sidekick** holds your Claude Code model access (or any local model) and your connected
MCP tools. A browser **extension** injects a standard provider — `window.claude` — into every web
page, so **any website can use the visitor's own model and tools** without ever holding an API key,
seeing a credential, or paying for inference. Every sensitive action is brokered through an
explicit, scoped, per-origin consent UI. Think `window.ethereum` / EIP-1193, where the asset is
"your Claude + your tools."

> **The consent broker is the product** — the plumbing is commodity. Security design leads here.

## Why

- **Economic inversion** — the site runs on the *visitor's* model/compute, not the operator's bill.
- **Capability inheritance** — the site instantly gets every MCP tool the visitor already connected;
  it integrates and OAuths nothing.
- **Data locality** — credentials + data stay on the user's machine; only prompts reach the model.
- **Developer wedge** — "add BYO-Claude in 5 lines" (see `examples/demo-site`).

Beyond Claude, the sidekick's backend layer routes **any local model** (Ollama/LM Studio/…) through
the same surface — the foundation for a "wrapper app store" where one subscription unlocks many apps
that all run on the user's own compute.

## Packages

| Package | What it is |
|---|---|
| [`@relay/protocol`](packages/protocol) | BYOP-1 wire contract (types) shared by all three below — the design-in-code |
| [`@relay/sidekick`](packages/sidekick) | The daemon: model backends + MCP tools + **the out-of-band permission gate** + audit |
| [`@relay/extension`](packages/extension) | MV3 extension: injects `window.claude`, is the **origin oracle**, holds the pairing token, hosts consent UI |
| [`@relay/sdk`](packages/sdk) | The 5-line developer wrapper with an install fallback |
| [`spec/BYOP-1.md`](spec/BYOP-1.md) | The adoptable provider standard |
| [`examples/demo-site`](examples/demo-site) | "This site runs on your Claude" |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the trust chain, the gate, and how a request flows.

## Status

All packages compile; the **security spine is real and proven end-to-end** by spikes under
`packages/sidekick/spike/`:

- Gated agentic loop — the Agent SDK's `canUseTool`, in-process, routed to the gate. Fires for every
  tool (MCP + builtins), blocks on human consent, enforces deny for MCP tools.
- Real MCP client — connects the user's servers from `~/.relay/mcp.json`, discovers + classifies +
  invokes, and feeds the agentic loop.
- Full daemon round-trip — pairing, `claude_connect` consent, `listGrants`, a gated read call, a
  consent-denied write — all through the running server.
- Consent + control UI — connect-scope + per-action write windows, grant list, audit, revoke, kill.

Honest gaps (see [ARCHITECTURE.md](ARCHITECTURE.md)): the local-model tool loop, MV3 worker eviction
during an open prompt (fail-closed for now), and the consent UI is daemon-side-proven but not yet
exercised in a live loaded extension.

## Dev

```bash
npm install
npm run build

# Optional: connect your MCP tools (Gmail, Shopify, filesystem, …) so sites can use them.
# Create ~/.relay/mcp.json:
#   { "servers": { "filesystem": { "command": "npx",
#       "args": ["-y","@modelcontextprotocol/server-filesystem","/Users/you/docs"] } } }

# Terminal 1 — the sidekick. Prints a pairing token.
npm run sidekick

# Load packages/extension as an unpacked MV3 extension; paste the pairing token into the popup.

# Terminal 2 — the demo site.
npm run demo   # http://localhost:5173
```

## Security invariants (never violate)

1. The extension is the **origin oracle** — origin comes from the browser, never the page.
2. The daemon is the **only** enforcement point — never the model.
3. Reads pre-approve within scope; **writes prompt every time**, non-bypassable.
4. Tool danger class is **default-deny**, decided by daemon policy.
5. Secrets never cross to the page — results only.
6. Everything is audited; per-origin revoke + a global kill switch.
