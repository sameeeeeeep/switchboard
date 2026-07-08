---
name: build-a-wrapp
description: >-
  Scaffold a "wrapp" — a web app that runs on the user's OWN AI, storage, and data through
  Switchboard (the local consent broker), via @relay/sdk, with no API key, no backend, and no
  inference bill. Use this whenever the user wants to build, scaffold, prototype, or port a small
  AI web app that should borrow the user's own Claude / local model instead of provisioning its own
  — phrasings like "make a wrapp", "build a Switchboard/Relay app", "an app that uses my own
  Claude without an API key", "an app that runs on the user's inference", "port this app to
  Switchboard", or any lightweight AI app where you'd otherwise reach for an API key + server. Also
  trigger when working in the relay repo and adding a new example app. Produces a working wrapp
  (standard connect chip + minimal correct scope + streaming + error handling) against the BYOP
  protocol. Prefer this over wiring an app to a raw provider global or a cloud API by hand.
---

# Build a Wrapp

A **wrapp** is a web app that doesn't own a backend. It borrows the user's own AI, storage, tools,
and data from **Switchboard** — a consent broker running on the user's machine — through the
`@relay/sdk` client. The user approves a scope once; every request is gated by the broker; the app
gets results, never keys. No API key, no server, no per-call bill for the app.

Your job with this skill: turn "make me an app that does X" into a **correct, working wrapp**. Most
of the value here is getting the *contract* right — the handful of rules below are what an app gets
wrong when it's written without them, and each failure is silent or confusing at runtime.

## The one thing to internalize

You are not calling an AI API. You are asking a **broker** on the user's machine, and the broker
answers to the *user*, not to your app. So: request the least you need, declare exactly what you'll
call, and design every write to pause for a human click. Build with that grain, not against it.

## Workflow

1. **Pin the job and the capabilities.** Say in one sentence what the wrapp does, then map it to the
   capability surface in [`references/api.md`](references/api.md). Most wrapps need only *inference*
   (`complete`/`stream`). Add `storage` if it must remember things, `context` if it should use the
   user's portable knowledge (a brand, a persona), `speak` for local TTS, `tools`/`agentic` only if
   the model genuinely needs to act. Pick the **minimum**.

2. **Scaffold from the template.** Copy [`assets/starter/`](assets/starter/) — it's a complete,
   buildable wrapp (index.html + app.js + esbuild). If you're **inside the relay repo**, prefer the
   faster path: add a `src/<name>.js` entry to `examples/apps/build.mjs` and a `<name>.html`, reusing
   the workspace `@relay/sdk`. Read [`references/api.md`](references/api.md) before wiring calls.

3. **Wire the capability, following the rules below.** Keep the integration tiny — the SDK does the
   work. Look at `examples/apps/src/chat.js` (streaming) and `examples/apps/src/brandbrain.js`
   (storage + context) for real reference retrofits.

4. **Set the exact scope.** In `mountConnect({ scope })` and `connect()`, declare precisely the
   model ids and tool names the code actually calls — see rule 3.

5. **Build and verify.** `npm run build` (esbuild). If previewable, run it and confirm the connect
   chip renders and a completion returns. Don't hand a wrapp back unbuilt.

6. **Run the ship checklist** at the bottom.

## The rules (this is the skill)

These are enforced out-of-band by the broker. Ignore one and the wrapp fails at runtime in a way
that's hard to debug from the app side — so build them in from the start.

1. **Talk to `@relay/sdk`, never the raw global.** Use `getRelay()` / `whenRelayReady()` and the
   `Relay` client. `window.claude` is an implementation detail (a neutral alias lands later); coding
   to the SDK means the rename never touches the wrapp.

2. **Always handle "not installed."** `whenRelayReady()` returns either a `Relay` or
   `{ installed: false, installUrl }`. Guard with `if (!("connect" in r))` and route the user to
   `installUrl`. A wrapp that assumes Switchboard is present is broken for most first-time visitors.

3. **Declare exactly what you call — exact-match, default-deny.** The scope you request lists model
   ids and tool names. If the code calls a model or tool that isn't in the granted scope, the broker
   denies it — full stop. The single most common bug is a mismatch: requesting `"claude-sonnet-5"`
   but calling `"claude-haiku-4-5"` (or omitting the model and getting a default outside scope). Make
   the string you request and the string you pass to `complete({ model })` **identical**, or omit
   `model` everywhere and let the default ride.

4. **Read the granted scope; handle partial approval.** `connect()` returns the *granted* scope,
   which may be **smaller** than requested (the user can narrow it). Read `grant.models` /
   `grant.tools` and adapt — never assume you got everything.

5. **Writes always prompt; design for the pause.** Any tool the broker classifies as a write
   (send, buy, delete, mutate) makes the user click to approve, every time — the app can't suppress
   it. Expect a human beat there, and handle `CONSENT_DENIED` (4120) as a calm "not now," not a retry
   loop.

6. **Feature-detect before you lean on something.** Call `relay.capabilities()` and check `models`,
   `agentic`, and `local?.tts` before using them. Degrade to a working experience when a piece is
   missing — the user's setup varies.

7. **Use the standard connect chip; don't roll your own.** `mountConnect(el, { scope, onConnect })`
   renders the one canonical "Connect Switchboard" affordance. Its sameness across every wrapp is
   what makes users trust the connect step — a custom button throws that away. The chip is identity
   only; connectors/budgets/trust live in the side panel.

8. **Never expect to see a secret.** The user's API key and connector credentials stay broker-side.
   The wrapp gets results. Don't write code that reaches for a token; there isn't one to reach for.

9. **Prefer free/local capabilities.** The whole point is zero cost and max privacy to the app:
   `storage` (private, on-device) and `speak` (local TTS, no credits) beat reaching for the cloud.
   Request the smallest budget you need — headroom you don't use is scope you shouldn't hold.

10. **Get streaming and warm sessions right — this is the #1 port bug.** `claude_stream` does NOT
    return an iterator or a ReadableStream. It resolves to `{ streamId }` and the provider then
    **emits `delta` events** (`on("delta", d)`, filtered by `d.streamId`: `{type:"text",text}` … then
    `{type:"done"|"error"}`). `claude_complete` resolves to `{ text }`. Assuming a returned stream
    silently emits nothing. Prefer the SDK's `r.stream()` (async iterator) which does this plumbing;
    if you must use the raw global (common when porting), wire the `streamId` + `on("delta")` pattern
    by hand. A **chat UI that re-sends full history each turn needs no session**; use `sessionId`
    (warm thread) only for long serial generation. Full contract in
    [`references/api.md`](references/api.md) → "Streaming — the raw contract" and "Warm sessions".

## Error handling

Requests reject with a typed error; branch on `err.code` (from `BYOPErrorCode`), never the message.
The full table is in [`references/api.md`](references/api.md); the ones to always handle:
`USER_REJECTED` (4001), `SCOPE_EXCEEDED` (4110), `CONSENT_DENIED` (4120), `BUDGET_EXCEEDED` (4290),
`PROVIDER_UNAVAILABLE` (4900).

## Ship checklist

- [ ] Uses `@relay/sdk` (`getRelay`/`whenRelayReady`), not `window.claude`.
- [ ] Handles the not-installed path (`installUrl`).
- [ ] Mounts the standard connect chip.
- [ ] Requests the **minimum** scope, with a clear human-readable `reason`.
- [ ] Every `model`/tool string it calls is in the declared scope (exact-match).
- [ ] Reads the returned grant; tolerates partial approval.
- [ ] Handles `CONSENT_DENIED` and `BUDGET_EXCEEDED` gracefully.
- [ ] Feature-detects models / `agentic` / local TTS before use.
- [ ] Builds cleanly and returns a completion when run.
