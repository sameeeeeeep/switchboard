# Spec: wrapps as agent tools — running Switchboard from `claude`

**Status:** draft / design — no implementation yet.
**Author:** design note (session: Redline + agent-usable wrapps).
**Related:** [ARCHITECTURE.md](../ARCHITECTURE.md), [CAPABILITIES.md](./CAPABILITIES.md),
[BUILDING-A-WRAPP.md](./BUILDING-A-WRAPP.md), the broker
[`packages/sidekick/src/server.ts`](../packages/sidekick/src/server.ts), the SDK
[`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts).

## The insight

A wrapp is not really "a web page." A web page is how a *human* reaches it. What a wrapp actually
**is** is three things bound together:

1. a **scope** — the models, tools, context kinds, and (soon) capabilities it needs, declared for
   consent;
2. an **orchestration** — the prompts + tool choreography that turn an input into a result (adpulse's
   "discover the connector → pull read-only → extract JSON"; Redline's "given this element + comment,
   return a `{find, replace}` edit"; brandbrain's research→thesis→deck run);
3. a **UI** — the surface a person uses to trigger (2) under (1).

The browser only supplies #3. Everything of value — the scope and the orchestration — already runs
through the **daemon**, which is *already an agent host*: it holds the user's model + MCP tools,
composes them per origin, and runs a **gated agentic loop** (`server.ts` → `buildMcpServers` +
`allowedTools`, one grant per origin, every mutating tool click-gated). The extension's
`window.claude` is just one client of that broker.

So "run Switchboard via `claude`" is not a new engine — it's **a second client of the broker that
already exists.** The only missing piece is *packaging*: a way for an agent (Claude Code, Claude
Desktop, any MCP client) to invoke a wrapp's **orchestration** headlessly, without its DOM, under the
same consent.

## What "an AI uses a wrapp" means

Two directions, both valuable:

- **Agent → wrapp.** `claude` calls `redline.review(page)` or `adpulse.analyze(export)` as a tool.
  The daemon runs that wrapp's orchestration on the *user's own* model + tools + context, and returns
  structured output. The agent composes wrapps the way it composes any tool: "read my Meta export
  with AdPulse, then draft three AdForge concepts for the worst-performing set."
- **Wrapp store → agent tool store.** The catalog the human browses becomes the tool catalog an agent
  browses. Installing a wrapp = the agent gains a capability, billed through the same usage rev-share.

Both keep the moat: the credential/model never leaves the daemon; consent is still a human click
(just surfaced out-of-band — see below); per-origin isolation and audit are unchanged.

## The packaging: an `actions` manifest + a `switchboard` MCP server

### 1. A wrapp declares headless **actions** (additive to its scope)

Today a wrapp requests a `ScopeRequest`. Add an optional `actions` array — named, typed entry points
that name the orchestration, independent of any DOM:

```jsonc
// switchboard.json  (or exported from the wrapp bundle)
{
  "name": "redline",
  "origin": "https://redline.thelastprompt.ai",
  "scope": { "models": ["sonnet"], "tools": ["mcp__claude_ai_Higgsfield__*"] },
  "actions": [
    {
      "name": "review",
      "summary": "Review a page's copy and design; return anchored suggestions.",
      "input":  { "page": "string (path or url)", "focus": "string?" },
      "output": { "suggestions": "array<{selector, note, proposal}>" },
      "run": "review.js#review"      // pure orchestration fn: (input, sb) => output
    }
  ]
}
```

The `run` target is the **orchestration split out from the UI** — a plain async function
`(input, sb) => output` where `sb` is the same SDK surface (`sb.stream`, `sb.callTool`,
`sb.context`, `sb.storage`). Wrapps refactor the valuable middle out of their click handlers into
these functions; the DOM handler and the action call the *same* function. (Redline is already close:
`actCopy`/`actDiagram` are almost pure given a comment + source.)

### 2. The daemon hosts a `switchboard` MCP server

The daemon already depends on `@modelcontextprotocol/sdk` and hosts MCP servers *into* the agentic
loop. Add the mirror: a **stdio MCP server the daemon exposes outward**, so any MCP client registers
it once:

```
claude mcp add switchboard -- switchboard mcp     # thin CLI → connects to the running daemon
```

It advertises one tool per installed action, namespaced to prevent collisions:

```
wrapp__redline__review      wrapp__adpulse__analyze      wrapp__brandbrain__validate_idea
```

Calling `wrapp__redline__review` →
1. daemon resolves the action to its wrapp **origin** (the authoritative isolation key — same origin
   oracle as the browser path; the agent's claim is not trusted);
2. checks the grant for that origin covers the action's scope; if not, **prompts out-of-band** (§3);
3. runs the orchestration `run(input, sb)` through the **existing gated loop** — mutating tools still
   click-gate, budgets still apply, every call still appends to `~/.relay/audit.log`;
4. returns the typed `output` as the tool result.

No new trust surface: it's the browser broker with an MCP transport bolted where the WebSocket is.

### 3. Consent without a browser chip

The human-click invariant is the moat, so it cannot become an agent-satisfiable auto-approve. The
daemon already ships a **menubar app** (`packages/menubar`) and a side panel. First time an agent
invokes an action whose scope isn't granted, the daemon raises the **same consent prompt out-of-band**
— a menubar notification / panel row: *"Claude wants to run redline.review — lend it sonnet +
Higgsfield?"* The human approves once; the grant persists per origin exactly like a browser connect.
Per-call gating (a mutating tool inside the run) surfaces the same way. Fail-closed on timeout.

This is the identical posture as folder-bind's path-consent — a click the model can never fake, just
relocated from the page to the tray.

## Why this is the right shape

- **One definition, two clients.** The wrapp author writes the orchestration once; it renders as UI
  and exposes as an agent tool. No fork, no second codebase.
- **The broker is unchanged.** Origin oracle, exact-match grants, gated loop, audit, budgets, rev-share
  — all inherited. The MCP server is a transport, not a new engine.
- **Composability is the payoff.** Agents chain wrapps (`brandbrain → studio → adforge`) on the user's
  own stack, headless, in a script or a Claude Code session — the "backend run locally" thesis, now
  drivable by AI, not just by a person at a tab.

## Smallest first step (pilot)

Ship one action end-to-end before generalizing:

1. Pick a wrapp whose orchestration is already near-pure — **AdPulse `analyze`** (input: an export or
   a connector; output: JSON findings) or **Redline `review`**.
2. Split that one function out of the UI into a `run(input, sb)` (the UI keeps calling it).
3. Add a minimal `switchboard mcp` stdio server in the daemon exposing just `wrapp__<name>__<action>`,
   routing through the existing per-origin loop, with the menubar consent prompt for the grant.
4. `claude mcp add switchboard`, then from Claude Code: *"analyze this Meta export with AdPulse."*

If that round-trips under real consent + audit, the manifest `actions` schema and the rest of the
catalog follow mechanically.

## Open questions

- **Action purity.** How much of a wrapp's value survives without the DOM? Some wrapps are genuinely
  interactive (Redline's click-to-anchor). Likely a spectrum: expose the *composable* actions
  (`review a page`, `analyze an export`), keep the *interactive* parts browser-only — the manifest
  simply omits what doesn't make sense headless.
- **Streaming vs. one-shot.** MCP tool results are one-shot; long agentic runs want progress. Emit
  progress as MCP notifications, or return a handle the agent polls?
- **Nested consent fatigue.** An agent chaining five wrapps could raise five tray prompts. Batch the
  grant at "install"/first-use per wrapp, keep per-call gating only for mutations.
- **Identity of the caller.** The browser path knows the origin from the extension. For the MCP path
  the "origin" is the wrapp being invoked — but do we also record *which* agent/session drove it, for
  audit and rev-share attribution?
- **Discovery.** Does the agent see all installed wrapps' actions, or only ones the user pre-enabled
  for agent use (a per-wrapp "allow headless" toggle in the panel)? Default to opt-in.
