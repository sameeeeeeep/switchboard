# Spec: WebMCP × Switchboard — the symmetric half

**Status:** draft / design — no implementation yet.
**Author:** design note, July 2026.
**Related:** [WRAPPS-FOR-AGENTS.md](./WRAPPS-FOR-AGENTS.md) (the `actions` manifest this converges
with), [SECURITY-AND-BINDINGS.md](./SECURITY-AND-BINDINGS.md), the gate
[`packages/sidekick/src/security/`](../packages/sidekick/src/security/), the MCP registry
[`packages/sidekick/src/mcp/`](../packages/sidekick/src/mcp/), the injector
[`packages/extension/src/inject.ts`](../packages/extension/src/inject.ts).

## Status of the standard (verified 2026-07-15)

- **Spec:** W3C **Web Machine Learning Community Group** draft, last published **June 24, 2026** —
  *not* standards-track yet. Editors from Microsoft + Google. Surface is
  `navigator.modelContext.registerTool()` (the earlier `window.agent` shape is deprecated).
- **Chrome:** public **origin trial, Chrome 149–156** (opened June 2026); local testing via
  `chrome://flags` → Experimental Web Platform features.
- **Consumers:** **Gemini in Chrome already calls WebMCP tools on-page.** No *external / cross-site*
  agent (Claude, Operator, Perplexity…) consumes them yet. Edge unconfirmed; Firefox/Safari engaged,
  uncommitted.

Re-verify before building — origin-trial APIs move.

## Why this is Switchboard's shape

Switchboard today is one arrow: the **page consumes the user's AI** (model, tools, context, storage)
through `window.claude` — page as *client*, daemon as the consent-gated *server*. WebMCP is the
reverse arrow: the **page exposes its own tools** — page as *server*. In the wallet analogy, WebMCP
is the page's ABI; Switchboard is the signer. Both arrows terminate in the same place we already
built: the origin oracle, the default-deny classifier, out-of-band consent clicks, budgets, audit.

The open first-mover slot, precisely: Gemini-in-Chrome consumes page tools *inside Google's browser,
with Google's agent*. Nobody ships a **user-owned agent that consumes any page's tools, in any
browser, under the user's own consent gate**. That consumer is ~a transport away from what the
daemon already is.

## Direction 1 — EXPOSE (cheap, do first)

Wrapps are pages. The SDK registers each wrapp's declared actions as WebMCP tools:

```ts
// in @relay/sdk — called by mountConnect() or explicitly
if (navigator.modelContext) {
  for (const a of manifest.actions) {
    navigator.modelContext.registerTool({
      name: `${manifest.name}_${a.name}`,
      description: a.summary,
      inputSchema: a.input,
      execute: (input) => runAction(a, input),   // the same run(input, sb) from WRAPPS-FOR-AGENTS
    });
  }
}
```

- **Convergence:** ONE `actions` declaration (from [WRAPPS-FOR-AGENTS.md](./WRAPPS-FOR-AGENTS.md))
  now renders three ways: the DOM UI, the daemon's headless `wrapp__*` MCP tools, and WebMCP tools
  in-browser.
- **Payoff today, not someday:** Gemini-in-Chrome users can drive Bank/AdPulse/Redline through the
  page immediately during the origin trial. Distribution hedge: when other browser agents land, every
  wrapp is pre-integrated.
- **Note:** the action still runs on the *visitor's* Switchboard (`sb.*` under their grant). A
  browser agent invoking the tool cannot widen scope — the gate doesn't know or care who clicked.

## Direction 2 — CONSUME (the big one)

Bridge tools a page registers into the daemon's gated loop as `mcp__web_<host>__<tool>`.

**Transport** (all pieces exist, one new message type):

1. A page-world script observes registrations (feature-detect `navigator.modelContext`; wrap
   `registerTool` — same MAIN-world pattern as `inject.ts`).
2. Content script forwards `{tool, schema}` upward; **background stamps the browser-verified origin
   + tabId** (origin oracle — the page's claim is ignored).
3. Daemon registers a dynamic per-tab MCP server in the existing registry
   (`mcp/index.ts::sdkServersFor` already composes per-origin server sets).
4. A loop tool-call round-trips *daemon → WS → background → that tab's content script → page
   `execute()` → result back*. Precedent already in the codebase: the daemon pushes
   `type:"prompt"` to the extension and awaits replies; this is the same shape (`type:"tabcall"`),
   plus the heartbeat/self-healing-port work (2026-07-15) that made daemon→tab delivery reliable.

**Security posture — falls out of the doctrine, but two rules must be explicit:**

- **There are no read page-tools.** For connector MCP tools, reads auto-approve within a grant. Page
  tools never get that: the *arguments* flow into untrusted page code, so every call is an
  exfiltration surface regardless of what the tool claims to do. Every page-tool call is
  **write-class → per-action consent click**, period. (The default-deny classifier in
  `security/permissions.ts` already treats unknown tools as dangerous; page tools are permanently
  "unknown-class".) A later per-origin relaxation ("trust this site's tools this session") is a
  panel-only grant, never an app request.
- **Results are hostile input.** A page tool's return is a prompt-injection vector into the loop.
  The core invariant already answers it — nothing in model context can widen scope; writes still
  need a human click — plus: cap result size, and audit every call (`origin, tool, args-hash,
  outcome`).
- **Scoping: wrapp loops do NOT see page tools.** A wrapp's agentic run sees its granted connectors
  only. Page tools enter a loop exclusively via **panel-initiated "act on this tab"** sessions — the
  principled return of TabSidekick: instead of scraping the DOM, the page *declares* its tools, and
  the user's click starts the session.
- **The CWS-permissions answer is `activeTab`.** v0.1.2 deliberately narrowed host permissions for
  Chrome Web Store review; consuming arbitrary pages' tools seems to want them back. It doesn't:
  "act on this tab" is a user gesture, and **`activeTab` grants exactly that tab, exactly then** —
  inject the observer bridge on demand. Consent doctrine and store policy point at the same
  mechanism. Broad host permissions stay out of the manifest.

## Direction 3 — POLYFILL (the wallet move, again)

On browsers without the origin trial, `inject.ts` can install a `navigator.modelContext` surface
itself (feature-detect first — never clobber a native implementation). Sites' registrations then
work wherever Switchboard is installed, before browsers ship their own consumer — exactly how
`window.claude` predates any native provider. This also makes Direction 2 browser-independent: our
consumer reads the polyfilled registry the same as the native one.

## Rollout

1. **Expose** — SDK-only, small; instant Gemini-in-Chrome interop for every wrapp. Ship with the
   `actions` manifest from WRAPPS-FOR-AGENTS (they're one feature).
2. **Polyfill** — small, `inject.ts`; makes wrapp-to-wrapp and cross-browser behavior uniform.
3. **Consume** — the `tabcall` transport + dynamic per-tab MCP server + "act on this tab" panel
   entry (activeTab). The one real build. Gate work: none new — wire calls through
   `gate.gateToolCall` as write-class.

## Open questions

- **Tab lifetime:** page tools die on navigation/close mid-session — surface as a clean tool error
  into the loop (never a hang; the stream-lifecycle logging shows it).
- **Schema trust:** tool `inputSchema` comes from the page; treat as rendering hints only, never as
  validation the gate relies on.
- **Discovery UX:** does the panel show "this tab offers 4 tools" ambiently (nice, but ambient
  content-script cost), or only after "act on this tab" (cheaper, quieter)? Lean: only after.
- **Origin-trial churn:** the CG draft is pre-standard; pin the observed API shape behind one
  adapter module so a rename (`window.agent` → `navigator.modelContext` already happened once)
  touches one file.
