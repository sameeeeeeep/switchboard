# @relay/switchboard-mcp — run & set up Switchboard wrapps from Claude Code

The **reverse arrow**. Switchboard's normal direction is a web page consuming the user's Claude
(`window.claude`). This is the mirror: an MCP server that lets **Claude Code (or any MCP client) run
a wrapp's orchestration headless**, on the user's own Claude, under the same per-origin consent — and
**scaffold a new wrapp** into a project. It's a second client of the broker that already exists
(`packages/sidekick`), not a new engine. See [`docs/WRAPPS-FOR-AGENTS.md`](../../docs/WRAPPS-FOR-AGENTS.md).

## Install

```
claude mcp add switchboard -- node /abs/path/packages/switchboard-mcp/switchboard-mcp.mjs mcp
```

Then, from a Claude Code session:

- *"analyze this Meta export with AdPulse"* → calls `wrapp__adpulse__analyze`
- *"make a Switchboard wrapp that turns a URL into three ad hooks"* → calls `switchboard_scaffold_wrapp`

## Tools

| tool | what |
|---|---|
| `wrapp__adpulse__analyze` | Diagnose a Meta Ads Manager CSV export → account-health score, wins, leaks (with monthly burn), scale/keep/fix/kill per campaign, prioritized actions. Runs on the user's own Claude. |
| `switchboard_scaffold_wrapp` | Create a new wrapp in a project folder from the house template (`skills/build-a-wrapp/assets/starter`). Files only — no AI, no network. |

One tool per wrapp **action** is advertised, namespaced `wrapp__<wrapp>__<action>`. The action's
declaration lives with the wrapp (its `manifest` + a pure `run(input, sb)`), so **one definition
renders three ways**: the DOM UI, these headless MCP tools, and (later) WebMCP page-tools.

## How a call flows

1. Resolve the tool to its wrapp **origin** (the authoritative isolation key — the agent's claim is
   never trusted; same origin oracle as the browser path).
2. **Pre-flight the grant** (`claude_permissions`). If the wrapp isn't authorized, return a clear
   error telling the user to Connect it once in Switchboard. Fail-closed.
3. Run the wrapp's pure `run(input, sb)` with an `sb` bound to that origin — on the user's Claude,
   through the daemon's existing gated loop. Budgets, audit, per-origin isolation all inherited.

## The moat is intact

Consent is a human click the model can never satisfy. This connector **never auto-approves** a
consent prompt — the pilot action is non-agentic (no tools), so an in-scope call raises zero prompts;
if a stray prompt arrives it is left for the browser extension's durable queue, never answered here.
The proper consent surface for the pure-CLI path is the **menubar tray** (WRAPPS-FOR-AGENTS §3), which
is future work; until it lands, authorize a wrapp once in the browser and this connector reuses that
grant.

## Running in daemon mode (real Claude)

Daemon mode needs two things on the machine:

1. **A running, signed-in daemon.** The daemon's `claude-code` backend must be able to authenticate
   to Claude. Sign-in lives in the macOS keychain (`Claude Code-credentials`) / `~/.claude`; a
   background daemon can only use it if that credential is present AND readable by the daemon binary.
   If a completion returns *"Claude Code isn't signed in on this Mac"*, that's the backend failing to
   auth — fix it by running `claude` in a normal Terminal and completing login, then restart the
   daemon (the menubar app) so it picks up fresh, readable credentials. (Note: a Claude **Code
   agent session** authenticates via ephemeral injected env vars that no daemon inherits — so the CLI
   working in-session does not by itself mean the daemon can auth.)
2. **A grant for the wrapp's origin.** The connector fail-closes on an ungranted origin. Authorize the
   wrapp once in the browser (Connect Switchboard), or use the dev override below during local dev.

**Dev origin override — `SWITCHBOARD_ORIGIN_<WRAPP>`.** A wrapp's manifest origin is its real deployed
identity and the grant key. Before it's deployed/connected you can point it at a localhost origin you
have already granted (e.g. the apps dev server), reusing that human-approved grant:

```
SWITCHBOARD_ORIGIN_ADPULSE=http://localhost:5174 SWITCHBOARD_SB=daemon switchboard mcp
```

This does NOT bypass consent — an ungranted override still fails closed; it only reuses a grant a
human already approved.

## sb modes — `SWITCHBOARD_SB`

- `auto` (default): use the daemon if `~/.relay/pairing-token` exists and `ws://127.0.0.1:8787`
  (override `RELAY_WS` / `RELAY_PORT`) accepts an authenticated socket; otherwise **mock**.
- `daemon`: require the daemon; error loudly if unreachable (never silently mock).
- `mock`: the harness responder (`mock-sb.mjs`) — structurally-valid canned results, for tests/demos
  with no daemon. Results are always labeled `mode: "mock"` so a caller is never fooled.

```
npm test    # drives the server with a real MCP client over stdio (mock sb), asserts a real diagnosis
```

## Adding a wrapp to the agent tool store

1. Split the wrapp's orchestration out of its DOM into a pure `run(input, sb)` + a `manifest`
   (see `examples/apps/src/core/adpulse.core.js` — the DOM wrapp imports the same core, so there's
   one definition, not a fork).
2. Import the manifest in [`registry.mjs`](./registry.mjs). Discovery is opt-in: only listed
   manifests are exposed.

## Files

- `switchboard-mcp.mjs` — the stdio MCP server (tools + scaffold + mode selection).
- `registry.mjs` — the wrapp manifests to expose.
- `daemon-client.mjs` — the authenticated WS bridge to the daemon (`sb` over the wire, fail-closed).
- `mock-sb.mjs` — the offline responder (harness parity).
- `scaffold.mjs` — copy-the-template wrapp generator.
- `switchboard-mcp.test.mjs` — end-to-end MCP-client test.
