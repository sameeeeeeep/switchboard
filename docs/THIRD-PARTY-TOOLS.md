# Third-party tools — run tools you didn't build, keys local

Switchboard runs the wrapps we make. It can **also drive tools other people built** — a Gmail tool, a Stripe tool, a maps tool — even when they have no UI of their own. They run **headless**, through God, at the notch.

**The moat, stated plainly:** a third-party tool is a **local MCP server** the user configures. Its credentials live in `~/.relay/mcp.json` (0600, beside the pairing token) and **never leave the daemon** — the daemon connects the server locally and only ever hands back the tool's *result*. There is **no hosted proxy** (no treg, no "OpenRouter for tools"): we don't broker your keys, see your traffic, or take a cut. That's the opposite of the aggregator model, and it's the whole point.

## Anatomy

A third-party tool is **one MCP server + one catalog listing**.

**1 · The MCP server** — an entry in `~/.relay/mcp.json` (the Agent-SDK `mcpServers` shape; stdio or http):

```jsonc
{
  "servers": {
    "hn": { "command": "npx", "args": ["-y", "mcp-hn"] },              // no-auth, stdio
    "stripe": { "url": "https://mcp.stripe.com", "headers": { "authorization": "Bearer sk_live_…" } }
  }
}
```

Credentials (`env`, `headers`, tokens) stay in this file. The daemon (`mcp/config.ts` → `mcp/registry.ts`) connects the server locally and exposes its tools via `claude_listTools`.

**2 · The catalog listing** — a `category: "tool"` entry, tagged third-party, that binds to the server:

```jsonc
{
  "id": "hn",
  "name": "Hacker News",
  "tagline": "Top stories & threads, on demand.",
  "category": "tool",
  "provenance": "third-party",        // → a trust badge in the store AND on the consent card
  "mcp": { "server": "hn", "tools": ["get_stories", "get_story_info"] },
  "components": {},                   // no UI — it runs headless
  "surfaces": ["notch"],
  "requires": [{ "kind": "daemon" }]
}
```

First-party wrapps live in the repo catalog; **third-party tools install into `~/.relay/catalog.json`** (merged, like "Add local wrapp") — they're the user's, not ours to ship.

## How it runs (the button-presser)

```
"God, what's trending on HN?"                        (or ⌥⌥ search: "hacker news top")
        │  God resolves it to the `hn` tool listing → [DRIVE:hn get_stories]
        ▼
RelayController.driveThirdPartyTool(listing, mcp)     ← the new headless runner
        │  GodDaemonBridge.claude_callTool({ name: "get_stories", arguments: {…} })
        ▼
daemon Gate.gateToolCall(origin "tool://hn", call)    ← allowlist + write-consent + audit
        │   · not granted?  → SCOPE_EXCEEDED → "Grant Hacker News first" (the notch consent card)
        │   · write-class?  → per-action consent at the notch
        │   · ok            → the daemon calls the LOCAL MCP server, keys never leave
        ▼
result → a notch widget → "Drop into chat" copies it for the next chat
```

The runner (`RelayMenuBar.swift`) picks the tool (`command` if it's one the binding lists, else the first bound tool), sprays the user's text across common arg keys, calls through the gate, flattens the MCP `content[]` result to text, and lands it in the notch. Read tools auto-approve; **write tools hit the consent gate**; a not-yet-granted tool routes to the grant card.

## States (Gate A)

empty (no tools installed → "Add a tool") · credential not set (→ a notch card to paste it, stored 0600) · running (notch spinner) · success (result widget) · huge/no result (scroll + "drop into chat") · MCP server offline (clear error) · not in allowlist (SCOPE_EXCEEDED → grant card) · write-class (consent gate) · offline · uninstalled tool God picked (→ offer to add) · stale binding (server/tool gone → error + re-map).

## Discovery — searchable by intent

Tools surface by **what you want**, not just by exact id: typing an intent ("get trending tiktok reels", "hacker news top") in the ⌥⌥ launcher or God's ⌃⌃ ask matches the query against each tool listing's name + description + its `tools[]` descriptions, and offers the matches as pickable options.

## What the daemon already proves

The local tool-execution path — `claude_callTool` → gate (allowlist + write-consent + audit) → a local MCP server's tool → result, credentials never leaving — is exercised end-to-end by `examples/harness/run-apps.mjs` (an isolated daemon + `spike/test-mcp-server.mjs`: a read tool auto-approved, a write tool consent-gated). `driveThirdPartyTool` is the native front door onto that same proven path.

## Not treg

treg ("OpenRouter for agent tools") is a hosted proxy that holds your credentials server-side and bills prepaid credit. It's the architectural inverse of this design. We use registries like it (or the MCP registry) **only as catalog seed lists to mirror** — the execution, and the keys, stay on your machine.

## Status / follow-ups

- **Built:** the listing type (`provenance` + `mcp` on `SBListing`), the headless runner (`driveThirdPartyTool`), and the drive routing.
- **Next (board epic `third-party-tools`):** the credential-setup card, "Add a tool" install (seed from the MCP registry), the consent-card third-party label, uninstall/revoke, intent search, and one real seed tool driven live end-to-end.
