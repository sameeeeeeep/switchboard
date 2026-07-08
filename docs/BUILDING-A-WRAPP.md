# Building a Wrapp

**A wrapp is a web app that borrows the user's own AI, storage, and data through Switchboard —
instead of provisioning and paying for a backend itself.** The user stays in control of every
resource; your app asks, a broker on their machine gates the request, and you get results back —
never their keys.

This guide is the **consumer contract**: everything you need to build against Switchboard, and the
promises the platform makes back to you. You don't need to understand the extension, the daemon, or
the consent internals — only the surface below.

> **Ships today vs. roadmap.** Everything in [The capability surface](#the-capability-surface) is
> live at wire protocol **BYOP `1.0.0`**. Sections marked **🔜 Roadmap** (the `switchboard.json`
> manifest, `http`/`db`/`secrets`/`exec` capabilities) are designed in
> [CAPABILITIES.md](./CAPABILITIES.md) but not yet implemented. Build against what ships; the
> roadmap items are additive and won't break your code.

---

## The mental model

Three moving parts, and you only ever talk to the first one:

```
  your wrapp  ──asks──▶  Switchboard (broker on the user's machine)  ──▶  the user's AI / files / creds
   (untrusted)          gates every request, asks the user when needed        (never exposed to you)
```

1. **The provider** — a single object Switchboard injects into your page. You send it typed
   requests ("complete this prompt", "read my store"). Think `window.ethereum`, but for AI.
2. **The scope** — an up-front list of what your app wants (which models, which tools). The user
   approves, **narrows**, or denies it once, at connect time.
3. **Consent** — reads inside your granted scope just work; anything that writes, spends, or is
   irreversible makes the user click to approve, **every time**. You can't turn that off, and you
   shouldn't want to — it's why users trust wrapps.

**Always code against `@relay/sdk`, never `window.claude` directly.** The SDK is the stable surface;
the raw global is an implementation detail (today it's `window.claude`, a neutral alias lands later)
and coding to the SDK means that rename never touches you.

---

## Quickstart (5 minutes)

### 1. Add the SDK

```bash
npm install @relay/sdk
```

Or drop the bundle in a `<script type="module">` — a wrapp is just a static page.

### 2. Get the client, degrade gracefully if Switchboard isn't installed

```js
import { getRelay, whenRelayReady } from "@relay/sdk";

const relay = await whenRelayReady();   // waits briefly for the extension to inject
if (!("connect" in relay)) {
  // { installed: false, installUrl } — show a "Get Switchboard" link and stop.
  location.href = relay.installUrl;
}
```

### 3. Drop in the connect chip (the one standard affordance)

```js
import { mountConnect } from "@relay/sdk";

mountConnect(document.querySelector("#connect"), {
  scope: { models: ["claude-haiku-4-5"], reason: "Draft replies in your voice" },
  onConnect: (relay) => boot(relay),   // fires once the user approves
});
```

The chip renders the canonical **"Connect Switchboard"** button, runs the consent flow, and — once
connected — becomes a **"Hi {name} · {project}"** pill. It looks identical on every wrapp on
purpose: that sameness is what makes users trust the connect step. You can't restyle it, and you
don't need to build your own.

### 4. Use the user's AI

```js
async function boot(relay) {
  const { text } = await relay.complete({
    prompt: "Write a two-line thank-you note.",
    model: "claude-haiku-4-5",
  });
  document.querySelector("#out").textContent = text;
}
```

That's a complete wrapp: no API key, no server, no bill. The inference ran on the user's connected
Claude.

---

## Connecting

Before any capability call, the user's origin must have a **grant**. You request one with a
`ScopeRequest` — either via the connect chip (recommended) or directly:

```js
const grant = await relay.connect({
  models: ["claude-haiku-4-5", "claude-sonnet-5"],  // model ids you might use
  tools:  ["WebSearch"],                            // tool names you might call
  budgets: { maxCallsPerMin: 20 },                  // optional; you can ask for less headroom
  reason: "Summarize pages you're reading",         // shown in the consent popup
});
```

What you get back is the **granted** scope — which may be **smaller than you asked for**. The user
can approve three of your four tools, or one of two models. Two rules follow from this, and they are
the contract:

- **Exact-match, default-deny.** If you call a model or tool that isn't in the grant, the request is
  denied — full stop. Declare exactly what you use. (The classic bug: asking for `sonnet` but
  calling `claude-haiku-4-5`. The strings must match what you actually invoke.)
- **Handle partial grants.** Read `grant.models` / `grant.tools` and adapt. Never assume you got
  everything you requested.

```js
const grant = await relay.connect({ models: ["claude-sonnet-5", "claude-haiku-4-5"] });
const model = grant.models.includes("claude-sonnet-5") ? "claude-sonnet-5" : grant.models[0];
```

`connect()` triggers the consent popup only on the **first** call for an origin; a returning user
with a persisted grant connects silently (and the connect chip's `onConnect` fires on load).

---

## The capability surface

Everything below is reachable from the `relay` client. This is the whole of BYOP `1.0.0`.

| What you want | How | Consent |
|---|---|---|
| **Feature-detect** what's available | `relay.capabilities()` | none — always allowed |
| **One-shot completion** | `relay.complete(params)` | within grant |
| **Streamed completion** | `for await (const d of relay.stream(params))` | within grant |
| **Agentic completion** (model uses tools) | `relay.complete({ ..., agentic: true })` | reads auto, writes prompt |
| **List / call a tool** directly | `relay.listTools()` · `relay.callTool(name, args)` | reads auto, writes prompt |
| **Private local storage** | `relay.storage.get/set/list/delete` | reads/writes free; `bind` prompts |
| **Bind storage to a real folder** | `relay.storage.bind(path)` | always prompts (shows the path) |
| **Shared cross-app context** | `relay.context.publish/active/pick` | user picks in the panel |
| **Local text-to-speech** | `relay.speak(text)` | within grant; on-device, no credits |
| **Who the user is** | `relay.identity()` | public display name only |

### Inference — `complete` and `stream`

```js
// One-shot
const { text, usage, stopReason } = await relay.complete({
  prompt: "Rewrite this as a haiku:\n" + input,
  system: MY_APP_PERSONA,     // your app's system prompt (can't widen your granted scope)
  model:  "claude-haiku-4-5",
  maxTokens: 300,
});

// Streaming — an async iterator of deltas
for await (const d of relay.stream({ prompt })) {
  if (d.type === "text")    append(d.text);
  if (d.type === "sources") cite(d.urls);
  if (d.type === "done")    finish(d.result);
}
```

Pass `messages: [{ role, content }, …]` instead of `prompt` for multi-turn. Attach reference images
via `attachments`. For a long sequence of calls in one conversation, pass a stable `sessionId` to
reuse a warm thread.

### Agentic completions and tools

Set `agentic: true` and the model may call tools from your granted set mid-reasoning. Each tool call
is gated for you automatically: **reads run silently within scope, writes pop a consent the user must
click.** You don't implement the gate — you just get the resolved result.

```js
const res = await relay.complete({
  prompt: "Find the top 3 results for 'BYOP protocol' and summarize.",
  tools:  undefined,          // uses your granted tools
  agentic: true,
});
// res.toolCalls: what ran and how each was resolved
```

Or drive a tool yourself with `relay.callTool("WebSearch", { query })`.

### Storage — your app's private disk

A per-app key/value store, isolated to your origin — no other wrapp can read it. Reads and writes to
your private sandbox need no prompt (it's your own drawer). Values are opaque strings; store JSON.

```js
await relay.storage.set("workspace", JSON.stringify(state));
const raw = await relay.storage.get("workspace");     // string | null

// Let the user point your store at a REAL folder they own (one consent, shows the path):
await relay.storage.bind("~/Documents/Projects/brandbrain/.data");
// existing files in that folder now appear as records — zero migration
```

### Context — portable, cross-app knowledge

Publish a reusable context (a brand, a persona, a project); read the one the **user chose** to lend
your app. Your app never sees the user's whole library — only what they picked for you in the panel.

```js
await relay.context.publish({ name: "Aamras", kind: "brand", data: brandKit });
const active = await relay.context.active();   // the context the user loaded for you, or null
const picked = await relay.context.pick();     // opens the picker; returns their choice
```

### Local TTS — `speak`

Synthesized on-device (local engine or the OS voice). No cloud, no connector, no credits. Returns a
playable `data:` URL, or `null` if the user has no local TTS.

```js
const clip = await relay.speak("hey, it's Maya");
if (clip) new Audio(clip.audio).play();
```

### Identity

```js
const me = await relay.identity();   // { name, avatar? } | null
greeting.textContent = me ? `Hi ${me.name}` : "Welcome";
```

---

## The rules you must respect

These aren't restrictions the platform *hopes* you follow — they're enforced out-of-band by the
broker, and knowing them keeps your app from mysteriously failing:

- **Exact-match grants.** Call only the models/tools you were granted. Anything else → `SCOPE_EXCEEDED`.
- **Writes always prompt.** Any tool the daemon classifies as a write (send, purchase, delete, mutate)
  triggers a per-action consent the user must click. You cannot suppress it. Design flows that expect
  a human beat there — and handle `CONSENT_DENIED` gracefully.
- **Budgets are real.** Every origin has token/day and call/minute ceilings. Over them →
  `BUDGET_EXCEEDED`. Don't hammer; batch and back off.
- **Secrets never reach your page.** You get results, never the user's API key or connector
  credentials. (When credential-injected HTTP lands — 🔜 — the token is set daemon-side; your page
  still never sees it.)
- **You're isolated to your origin.** Your storage, your context, your grant are keyed to your
  origin by the browser — you can't reach another app's data, and it can't reach yours.

---

## Error handling

Requests reject with a typed error. Branch on `code`, not `message`:

```js
import { BYOPErrorCode } from "@relay/sdk";

try {
  await relay.complete({ prompt, model: "claude-sonnet-5" });
} catch (err) {
  switch (err.code) {
    case BYOPErrorCode.USER_REJECTED:   /* 4001 — user declined connect/consent */ break;
    case BYOPErrorCode.UNAUTHORIZED:    /* 4100 — not connected; call connect()  */ break;
    case BYOPErrorCode.SCOPE_EXCEEDED:  /* 4110 — model/tool not in your grant   */ break;
    case BYOPErrorCode.CONSENT_DENIED:  /* 4120 — user said no to a write        */ break;
    case BYOPErrorCode.BUDGET_EXCEEDED: /* 4290 — rate/token ceiling hit         */ break;
    case BYOPErrorCode.PROVIDER_UNAVAILABLE: /* 4900 — Switchboard not reachable */ break;
    default: /* BACKEND_ERROR 4500, INVALID_PARAMS -32602, … */ ;
  }
}
```

| Code | Name | Meaning | What to do |
|---|---|---|---|
| 4001 | `USER_REJECTED` | User declined connect or a consent | Show a soft "connect to continue" state |
| 4100 | `UNAUTHORIZED` | No grant for this origin/method | Call `connect()` first |
| 4110 | `SCOPE_EXCEEDED` | Model/tool outside the grant | Fall back to a granted one, or re-request scope |
| 4120 | `CONSENT_DENIED` | User denied a per-action write | Treat as a normal "not now"; don't retry-loop |
| 4290 | `BUDGET_EXCEEDED` | Token/day or call/min ceiling | Back off; tell the user their budget's spent |
| 4200 | `UNSUPPORTED_METHOD` | Method not on this provider | Feature-detect via `capabilities()` |
| 4900 | `PROVIDER_UNAVAILABLE` | Daemon not installed/running | Show the install path |
| 4500 | `BACKEND_ERROR` | Model/tool failed (non-policy) | Retry or surface the failure |

---

## Feature detection & graceful degradation

Never assume. Two checks cover almost everything:

```js
// 1. Is Switchboard even here?
const relay = await whenRelayReady();
if (!("connect" in relay)) return showInstall(relay.installUrl);

// 2. Does this user's setup have what you need?
const caps = await relay.capabilities();
if (!caps.models.includes("claude-sonnet-5")) useModel("claude-haiku-4-5");
if (!caps.local?.tts) hideVoiceButton();
if (!caps.agentic)    disableToolFeatures();
```

`capabilities()` needs no permission and tells you the wire `version`, available `models`,
online `backends`, whether `agentic` is supported, the user's public `user` identity, and `local`
engines (TTS today). Degrade to a working experience for every missing piece.

---

## 🔜 Roadmap: the manifest and backend capabilities

Today you declare scope imperatively in `connect()`. The
[capabilities spec](./CAPABILITIES.md) adds a **`switchboard.json` manifest** you ship with your
wrapp, plus new backend capabilities — a database, credential-injected outbound HTTP, scoped
secrets, sandboxed compute — each independently granted and revocable, same consent model as above:

```json
{
  "reason": "Sync your store and draft campaigns",
  "models": ["claude-haiku-4-5"],
  "tools": ["WebSearch"],
  "storage": { "defaultFolder": "~/…/.data" },
  "http":    { "hosts": ["api.shopify.com", "api.klaviyo.com"] },
  "db":      { "name": "app" },
  "secrets": ["shopify_token"]
}
```

When these land, your wrapp gets a real backend — a Postgres-shaped DB, API calls made with the
**user's** credentials (the token stays daemon-side), background jobs — **without ever provisioning
or paying for infrastructure.** Same rules: exact-match, narrowable, per-origin, audited. Nothing
here breaks the `1.0.0` surface; it's all additive.

---

## The versioning promise

BYOP is versioned like a protocol, not a library. You build against a **stable contract**:

- **MINOR bumps are additive** — new methods, new capabilities, new fields. Your code keeps working.
- **MAJOR bumps** are the only ones that change an existing method's shape, and they're rare and
  announced.
- **Feature-detect** with `capabilities().version` and `.methods` rather than sniffing versions by
  hand.

That's the whole point of it being a protocol and not just "our SDK": learn it once, and your wrapp
keeps running as Switchboard evolves underneath it — and stays portable across where it runs
(a tab today, a sandbox tomorrow) because it speaks the contract, not the wiring.

---

## Ship checklist

- [ ] Code against `@relay/sdk` (`getRelay` / `whenRelayReady`), not `window.claude`.
- [ ] Handle the **not-installed** path (`installUrl`).
- [ ] Mount the standard **connect chip**; don't roll your own connect button.
- [ ] Request the **minimum** scope you need, with a clear `reason`.
- [ ] Read the **returned grant** and handle partial approval.
- [ ] Call only the models/tools you declared (**exact-match**).
- [ ] Handle every relevant **error code**, especially `CONSENT_DENIED` and `BUDGET_EXCEEDED`.
- [ ] **Feature-detect** models, `agentic`, and `local` engines before using them.
- [ ] Never expect to see a secret. You get results.

---

*Reference retrofit: [`examples/apps/`](../examples/apps/) — brandbrain and friends are real wrapps
built on exactly this surface. Protocol source of truth:
[`packages/protocol/src/rpc.ts`](../packages/protocol/src/rpc.ts).*
