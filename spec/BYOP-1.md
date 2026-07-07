# BYOP-1: The Bring-Your-Own-Provider Interface

**Status:** Draft · **Version:** 1.0.0 · **Style:** EIP-1193

A standard JavaScript provider, injected as `window.claude`, that lets any web page use the
**visitor's own** model and connected tools — without the page holding an API key, seeing any
credential, or paying for inference. The asset is "your Claude + your tools." Think
`window.ethereum`, where the wallet is your model.

This document is the contract third parties build against. The reference implementation is the
**relay** sidekick daemon + browser extension, but any provider that implements this interface is
BYOP-1 compliant.

---

## 1. Provider object

```ts
interface ClaudeProvider {
  readonly version: string;      // BYOP semver, e.g. "1.0.0"
  readonly isRelay: boolean;     // reference-impl marker; feature-detect via capabilities instead
  request<M>(args: { method: M; params?: Params<M> }): Promise<Result<M>>;
  on(event: string, handler: (payload: unknown) => void): void;
  removeListener(event: string, handler: (payload: unknown) => void): void;
}
```

- Injected into the **MAIN world** at `document_start`, frozen, non-configurable.
- On injection the provider dispatches `window` event `claude#initialized` so late listeners can
  detect it without polling.
- The provider holds **no secrets** and makes **no network calls**; it only relays to the broker.

## 2. Methods

All calls go through `request({ method, params })` and return a Promise.

| Method | Params | Result | Consent |
|---|---|---|---|
| `claude_capabilities` | — | `Capabilities` | none |
| `claude_connect` | `ScopeRequest?` | `OriginGrant` | popup, once |
| `claude_disconnect` | — | `{ ok: true }` | none |
| `claude_complete` | `CompletionParams` | `CompletionResult` | scope + budget |
| `claude_stream` | `CompletionParams` | `{ streamId }` | scope + budget |
| `claude_cancel` | `{ streamId }` | `{ ok: true }` | none |
| `claude_listTools` | — | `{ tools: ToolDescriptor[] }` | scope |
| `claude_callTool` | `ToolCallRequest` | `ToolCallResult` | read: in-scope · write: **per-action** |
| `claude_permissions` | `{ request?: ScopeRequest }?` | `OriginGrant \| null` | change → popup |

`claude_connect` is the analog of `eth_requestAccounts`: a site must connect and be approved once.
The returned grant may be **narrower** than requested — never wider.

## 3. Events

Delivered via `on(event, handler)`:

| Event | Payload | Meaning |
|---|---|---|
| `connect` | `OriginGrant` | origin approved |
| `disconnect` | `{ reason }` | revoked / kill-switch / expired |
| `permissionsChanged` | `OriginGrant` | scope changed |
| `delta` | `{ streamId } & StreamDelta` | streaming output for an in-flight `claude_stream` |

`StreamDelta` is one of: `text`, `tool_proposed`, `tool_result`, `sources`, `done`, `error`.

## 4. Capability discovery

```ts
interface Capabilities {
  version: string;         // BYOP version
  methods: string[];       // supported method names
  models: string[];        // model ids routable right now (across all backends)
  backends: string[];      // e.g. ["claude-code", "ollama"]
  agentic: boolean;        // whether the gated agentic loop is available
}
```

Sites MUST feature-detect via `claude_capabilities` rather than the `isRelay` marker, so
alternative BYOP-1 providers interoperate.

## 5. Permission model (normative)

A compliant provider MUST enforce all of the following **out of band from the model** — no prompt
and no model output may widen scope:

1. **Per-origin grants.** Permissions key on the **browser-verified** origin. The origin MUST be
   derived by the trusted layer (extension/agent), never accepted from page-supplied data.
2. **Granular scopes.** A grant names allowed model(s), allowed tools (each with an access class),
   and budgets (max tokens/day, max calls/min). A request outside scope is rejected.
3. **Two consent tiers.** *Read* tools are pre-approvable within scope. *Write / irreversible /
   money-moving* tools require a **per-action** user consent for **every** invocation, showing the
   origin, the tool, and the exact arguments.
4. **Default-deny classification.** Tool danger class is decided by the provider's policy, not by
   the model or the page. An unclassified tool MUST be treated as *write*.
5. **Untrusted prompts.** Page-supplied prompts are untrusted. In-prompt instructions about
   permissions/tools MUST be ignored.
6. **No credential exposure.** The page receives tool *results* only. API keys and MCP credentials
   MUST never cross to the page.
7. **Auditability + control.** Every request, tool call, and consent decision is logged per origin
   and exportable; per-origin revoke and a global kill switch MUST be available.

## 6. Errors

`request` rejects with an error carrying a numeric `code`:

| Code | Name | Meaning |
|---|---|---|
| 4001 | USER_REJECTED | user declined connect/consent |
| 4100 | UNAUTHORIZED | origin not connected |
| 4110 | SCOPE_EXCEEDED | model/tool not granted |
| 4120 | CONSENT_DENIED | per-action write denied |
| 4290 | BUDGET_EXCEEDED | token/rate ceiling hit |
| 4200 | UNSUPPORTED_METHOD | unknown method |
| -32602 | INVALID_PARAMS | bad params |
| 4900 | PROVIDER_UNAVAILABLE | no provider/sidekick installed |
| 4500 | BACKEND_ERROR | model/tool failed (non-policy) |

## 7. Versioning

BYOP is semver'd independently of any implementation. MINOR bumps add backward-compatible
methods/events; MAJOR bumps change existing signatures. Providers advertise their version via
`provider.version` and `claude_capabilities`.

## 8. Non-goals (v1)

- Non-Claude/MCP provider abstractions are *architecturally* accommodated (the broker may route to
  local models) but are not part of the v1 wire surface beyond `capabilities.backends`.
- Payment/entitlement negotiation (the "app store" layer) is out of scope for BYOP-1.
