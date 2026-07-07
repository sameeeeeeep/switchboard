# Architecture

## The trust chain

```
  page JS   ──postMessage──▶  content script  ──runtime.port──▶  background worker  ──WS + token──▶  sidekick daemon
(untrusted)                  (ISOLATED world)                   (ORIGIN ORACLE,                    (ENFORCEMENT BOUNDARY;
     ▲                                                           holds pairing token)               owns key + MCP creds)
     │                                                                                                       │
     └───────────────────────── window.claude (MAIN world, no secrets) ◀────────────── events / responses ──┘
```

- **The page never touches the daemon.** It only has `window.claude`, which postMessages to the
  content script. The daemon's loopback port is guarded by a pairing token the page never holds and
  by an Origin-header check that rejects web pages reaching localhost directly.
- **The background worker is the origin oracle.** It derives each request's origin from
  `port.sender` (the browser's truth), stamps it on the `RequestEnvelope`, and forwards it. A page
  cannot forge its origin because it never supplies one the daemon trusts.
- **The daemon is the enforcement boundary.** Allowlists, tool classification, budgets, and
  per-action consent are checked here, out of band. The model runs *inside* the daemon and is
  handed a hard capability set; it can propose, never widen.

## The gate (packages/sidekick/src/security/gate.ts)

Every sensitive action — a page-initiated `claude_callTool` *and* a model-proposed tool call inside
the gated agentic loop — funnels through `Gate.gateToolCall`, fail-closed at each step:

1. origin has a grant?            → else `UNAUTHORIZED`
2. tool in the origin allowlist?  → else `SCOPE_EXCEEDED`
3. rate budget ok?                → else `BUDGET_EXCEEDED`
4. class (default-deny): read → auto-approve · write → **per-action user consent** → else `CONSENT_DENIED`
5. execute directly against the MCP server (creds never leave), audit, return.

Because step 4's write consent requires a human click pushed to the extension popup, no prompt
injection can satisfy it — the model cannot click the button.

## Request flow (a streamed, agentic completion)

1. Page calls `relay.stream({ prompt, agentic: true })` → `claude_stream`.
2. Background stamps the verified origin → daemon.
3. Daemon `assertCompletionAllowed` (model in scope, rate + token budget).
4. Backend runs with `--allowed-tools = grant.tools` (hard capability set). Text deltas stream back
   as `delta` events keyed by `streamId`.
5. When the model proposes a tool, the backend routes it through `ctx.gateToolCall` → the gate. A
   read auto-approves; a write pushes a consent prompt to the popup and blocks until the user
   clicks. The result (or denial) goes back to the model as a tool result — never bypassing.
6. On completion the daemon reconciles token usage against the budget and emits `done`.

## Model backends (the app-store foundation)

`BackendRegistry` routes a model id to a `ModelBackend`:
- **`claude-code`** — the user's local `claude` CLI (their sign-in/subscription; no shared API key).
- **`local-openai`** — Ollama/LM Studio/llama.cpp via `/v1/chat/completions`.

The provider surface is identical regardless of backend — this is what lets one broker route "any
local model or a Claude subscription," and is the seam a future entitlement/"app store" layer plugs
into (metered per origin via the same budget ledger).

## How the agentic gate actually binds (verified)

The gated agentic loop runs the `@anthropic-ai/claude-agent-sdk` `query()` **in-process in the
daemon** and wires its `canUseTool(toolName, input) → {behavior:'allow'|'deny'}` straight into
`Gate.authorize`. Proven end-to-end by `packages/sidekick/spike/*.mjs`:

- `gate-spike.mjs` — `canUseTool` fires out-of-band for every proposed tool (MCP + builtins), is
  async (blocks on a human consent click), and enforces deny for MCP tools.
- `mcp-spike.mjs` — the real `McpRegistry` connects a real stdio MCP server, discovers + classifies
  its tools, and invokes one.
- `integration-spike.mjs` — the real backend through the real `Gate`: granted read runs, granted
  write is consent-denied, ungranted tool is allowlist-blocked.
- `e2e-daemon-spike.mjs` — drives the running daemon over its WS like the extension would: pairing,
  a full `claude_connect` consent round-trip, `listGrants`, a gated read call, a consent-denied write.

`--permission-prompt-tool` was removed in CLI 2.1.201; PreToolUse hooks were rejected because their
`deny` isn't enforced for MCP tools (gh #33106). `bypassPermissions` is never used (it would skip
`canUseTool`), and tools are never pre-approved via `allowedTools` (that would skip the gate).

## What's real vs stubbed

**Real:** protocol types; origin stamping; grant store (persisted, narrowing-only); budget ledger;
default-deny classifier; the gate (authorize + execute paths); audit log; the Claude Code backend
via the Agent SDK + `canUseTool`; **the MCP client** (`mcp/registry.ts` — connects the user's
servers from `~/.relay/mcp.json`, discovers/classifies/invokes, and feeds the SDK agentic loop);
**the consent UI** (connect-scope + per-action write windows) and the daemon **control channel**
(list grants, audit, revoke, kill); the SDK + provider.

**Stubbed / honest gaps:** the local-model tool loop (`backends/local-openai.ts`); MV3 worker
eviction during an open consent prompt (fail-closed to a denial for now — a durable prompt queue is
future work); the consent/control UI is proven on the daemon side headlessly but not yet in a live
loaded extension; classification pins are in-memory (not persisted).

## Secondary form factor: relay mode

The reference transport already prototypes an outbound "relay" mode where a *hosted* app forwards a
job to the user's sidekick over HTTP (pairing token, session affinity via a single sidekick). It is
noted, not led: the primary form factor is the pure client-side extension. The same daemon serves
both.
```
