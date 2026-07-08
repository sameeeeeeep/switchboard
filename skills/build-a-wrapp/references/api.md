# BYOP capability surface (reference)

The contract a wrapp codes against, via the `@relay/sdk` `Relay` client. This is BYOP **1.0.0**.
Source of truth: `packages/protocol/src/rpc.ts`. Everything here ships today; the manifest +
backend capabilities at the bottom are roadmap.

## Getting the client

```js
import { getRelay, whenRelayReady, mountConnect, BYOPErrorCode } from "@relay/sdk";

const r = await whenRelayReady();          // waits briefly for the extension to inject
if (!("connect" in r)) location.href = r.installUrl;   // { installed:false, installUrl }
```

`getRelay()` is the poll-free synchronous version; `whenRelayReady(timeoutMs=3000)` waits for a slow
inject. Both return `Relay | { installed:false, installUrl }`.

## Connecting

```js
const grant = await r.connect({
  models: ["claude-haiku-4-5"],   // exact model ids you will pass to complete/stream
  tools:  ["WebSearch"],          // exact tool names you will call
  budgets: { maxCallsPerMin: 20 },// optional; request less, never assume more
  reason: "Draft replies in your voice",   // shown in the consent popup
});
// grant: { origin, mode, models[], tools[{name,access}], budgets, ... } — MAY be narrowed.
```

Consent prompts only on first connect for an origin; returning users connect silently. Read
`grant.models` / `grant.tools` and adapt to partial approval.

## Method surface (via the `Relay` client)

| Client call | Wire method | Notes |
|---|---|---|
| `r.capabilities()` | `claude_capabilities` | No permission. `{ version, models[], backends[], agentic, user?, local? }` |
| `r.connect(scope?)` | `claude_connect` | Returns the granted `OriginGrant` |
| `r.disconnect()` | `claude_disconnect` | Per-tab only; grant persists (revoke is panel-only) |
| `r.permissions()` | `claude_permissions` | Current grant or `null` |
| `r.complete(params)` | `claude_complete` | One-shot; returns `{ text, usage, stopReason, toolCalls? }` |
| `r.stream(params)` | `claude_stream` | Async iterator of `StreamDelta` |
| `r.listTools()` | `claude_listTools` | Tools this origin may see |
| `r.callTool(name, args)` | `claude_callTool` | Reads run in scope; writes prompt |
| `r.storage.*` | `claude_storage` | Private per-origin KV; `bind` prompts for a path |
| `r.context.*` | `claude_context` | Shared cross-app context; user picks in panel |
| `r.speak(text, {voice?})` | `claude_speak` | Local TTS → playable `data:` URL, or `null` |
| `r.identity()` | (via capabilities) | `{ name, avatar? }` or `null` |

## Inference

```js
const { text, usage, stopReason } = await r.complete({
  prompt: "…",                 // or messages: [{role, content}, …]
  system: MY_PERSONA,          // app system prompt; can't widen scope
  model:  "claude-haiku-4-5",  // must be in grant; omit for the origin default
  maxTokens: 300,
  effort: "low",               // low | medium | high (backends that support it)
  agentic: true,               // model may call granted tools; reads auto, writes prompt
  sessionId: "thread-1",       // warm multi-turn thread
});
```

Streaming deltas (`StreamDelta`): `{type:"text",text}`, `{type:"tool_proposed",call}`,
`{type:"tool_result",call,result}`, `{type:"sources",urls}`, `{type:"done",result}`,
`{type:"error",error}`.

```js
for await (const d of r.stream({ prompt })) {
  if (d.type === "text")    append(d.text);
  if (d.type === "sources") cite(d.urls);
  if (d.type === "error")   fail(d.error.message);
}
```

Attach reference images via `attachments: [{ handle, filename, contentType, dataUrl }]`.

### Streaming — the raw contract (matters when PORTING)

`r.stream()` above is the SDK sugar (a clean async iterator). If you're **porting an app** that
talks to the raw `window.claude.request` directly (no SDK on the page), the wire contract is
**event-based, not a returned stream** — get this wrong and streaming silently emits nothing:

```js
// claude_stream RESOLVES to { streamId } — NOT an iterator, NOT a ReadableStream.
const { streamId } = await window.claude.request({ method: "claude_stream", params });
// The provider then EMITS `delta` events; filter by streamId (many streams can be live):
const onDelta = (d) => {
  if (!d || d.streamId !== streamId) return;
  if (d.type === "text")  append(d.text);          // 1..N text deltas (may arrive buffered as one)
  if (d.type === "sources") cite(d.urls);
  if (d.type === "done" || d.type === "error") window.claude.removeListener("delta", onDelta);
};
window.claude.on("delta", onDelta);
```

`claude_complete` resolves to `{ text }`. **The #1 port bug** is assuming `claude_stream` returns an
iterable and reading nothing — always wire the `streamId` + `on("delta")` pattern. (When you can,
prefer the SDK's `r.stream()`, which does this plumbing for you.)

### Warm sessions (multi-turn threads)

Two ways to keep a warm, stateful thread instead of re-sending everything each turn:

- **`sessionId` on `complete`/`stream`** — pass a stable id and the daemon threads a warm process for
  it (no cold start per turn, turns queued in order). Simplest for a chat/card loop.
  ```js
  await r.complete({ prompt: turn, sessionId: "brand-42" });
  ```
- **`claude_session`** (raw) — an explicit warm thread: `{ op:"send", sessionId, prompt, system, effort }`
  returns `{ text }`; `{ op:"end", sessionId }` frees it. Sessions run **read-only**, recycle after a
  handful of turns (context is re-sent inline, so recycling is free), and have a per-turn timeout — so
  don't rely on the transcript for correctness; re-send anything the turn must know.

Note: a **chat UI that already re-sends full history each call is correct WITHOUT a session** — use
`sessionId` only when you want the daemon to hold the thread (e.g. long serial card generation).

## Storage (private, on-device)

```js
await r.storage.set("workspace", JSON.stringify(state));  // opaque string; store JSON
const raw   = await r.storage.get("workspace");           // string | null
const keys  = await r.storage.list();
await r.storage.delete("workspace");
const info  = await r.storage.info();                     // { folder, autoAssigned, count }
await r.storage.bind("~/Documents/Projects/x/.data");     // prompts; existing files become records
```

Reads/writes to the auto-assigned sandbox need no prompt. `bind` (pointing at a real folder) always
prompts and shows the path. Keys are constrained to `[A-Za-z0-9._-]`.

## Context (portable cross-app knowledge)

```js
await r.context.publish({ name: "Aamras", kind: "brand", data: brandKit });
const active = await r.context.active();   // the context the user lent this app, or null
const picked = await r.context.pick();     // opens the picker; returns their choice
```

The app never enumerates the user's library — only the one the user selected in the panel.

## Local TTS & identity

```js
const clip = await r.speak("hey, it's Maya");   // { audio: dataUrl, backend, voice } | null
if (clip) new Audio(clip.audio).play();

const me = await r.identity();                   // { name, avatar? } | null
```

## Error codes (`BYOPErrorCode`)

| Code | Name | Meaning | Handle by |
|---|---|---|---|
| 4001 | `USER_REJECTED` | Declined connect/consent | Soft "connect to continue" state |
| 4100 | `UNAUTHORIZED` | No grant for this origin | Call `connect()` first |
| 4110 | `SCOPE_EXCEEDED` | Model/tool outside grant | Fall back to a granted one |
| 4120 | `CONSENT_DENIED` | User denied a write | Treat as "not now"; no retry loop |
| 4290 | `BUDGET_EXCEEDED` | Token/day or call/min ceiling | Back off; tell the user |
| 4200 | `UNSUPPORTED_METHOD` | Method absent | Feature-detect via `capabilities()` |
| 4900 | `PROVIDER_UNAVAILABLE` | Daemon unreachable | Show install path |
| 4500 | `BACKEND_ERROR` | Model/tool failed (non-policy) | Retry or surface |
| -32602 | `INVALID_PARAMS` | Bad params | Fix the call |

```js
try { await r.complete({ prompt, model }); }
catch (err) {
  if (err.code === BYOPErrorCode.SCOPE_EXCEEDED) useGrantedModel();
  else if (err.code === BYOPErrorCode.CONSENT_DENIED) softStop();
  // …
}
```

## Feature detection

```js
const caps = await r.capabilities();
if (!caps.models.includes("claude-sonnet-5")) useModel("claude-haiku-4-5");
if (!caps.agentic)    disableToolFeatures();
if (!caps.local?.tts) hideVoiceButton();
```

## The connect chip

```js
import { mountConnect } from "@relay/sdk";
mountConnect(document.querySelector("#connect"), {
  scope: { models: ["claude-haiku-4-5"], reason: "…" },
  onConnect: (relay) => boot(relay),      // fires on approve, and on load for returning users
  onDisconnect: () => teardown(),
  onProjectChange: (project) => reload(project),
});
```

States: not-installed → "Get Switchboard"; connected → "Hi {name} · {project}" pill. Rendered in a
shadow root; don't restyle it. It carries identity only — send users to the side panel for the rest.

## 🔜 Roadmap (designed, not shipped — see docs/CAPABILITIES.md)

A `switchboard.json` manifest declaring scope, plus backend capabilities: `http` (outbound calls
with the user's injected credentials — token never reaches the page), `db` (per-origin SQLite),
`secrets`, `exec` (sandboxed compute). Same consent model: exact-match, narrowable, per-origin,
audited. Additive to 1.0.0 — nothing here breaks the surface above.
