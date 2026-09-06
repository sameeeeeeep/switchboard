# Codex in Switchboard

Switchboard can route existing wrapps through Claude Code, Codex App Server, or a local runner.
The browser contract remains `window.claude`: this is a compatibility name, not a provider restriction.
Independent native apps can also connect; see [native apps and local voice](NATIVE-AND-LOCAL.md).

## Try Brandbrain

Install the Codex CLI and sign in using `codex login`. Switchboard discovers the installed runtime
and asks it for its available models; model names are not hardcoded. Existing Codex authentication
is reused. ChatGPT sign-in uses subscription access; API-key sign-in uses API billing.

Build and run the isolated live proof:

```sh
npm run build -w @relay/sidekick
SKIP_FRONTEND=1 node examples/brandbrain-port/build.mjs
node examples/brandbrain-port/proof/run-codex.mjs
```

For a release check of the packaged daemon and real WebSocket protocol:

```sh
node --test packages/sidekick/dist/backends/codex.test.js packages/sidekick/dist/backends/routing.test.js packages/sidekick/dist/storage/find.test.js
node examples/brandbrain-port/proof/run-codex-release.mjs
```

The release proof bundles the daemon with the Mac packager's settings, starts it on an isolated
loopback port, and checks model consent, parallel apps, streaming, restart recovery, vision, and
ending a conversation. It reuses Codex sign-in, makes real model calls with synthetic inputs, and
imports no personal MCP servers. It leaves the installed app and normal Switchboard state alone.

The proof registers only Codex, uses a temporary state directory and synthetic brand data, and
exercises Brandbrain's existing warm-session shim and the gaps route in its actual compiled app bundle.
The bundle build requires the existing Brandbrain source and installed dependencies (set `BRANDBRAIN_SRC`
if it lives elsewhere); it copies the source into an isolated build directory. It also checks legacy `sonnet`
request translation, gated MCP execution, and revocation. It never reads your personal brand vault.

To prefer Codex in a development daemon:

```sh
RELAY_BACKEND=codex node packages/sidekick/dist/index.js
```

`RELAY_CODEX_MODEL` optionally selects an exact model advertised by the runtime. Without it, Codex's
catalog default is used. `RELAY_CODEX_CLI` supplies an explicit executable path; `RELAY_CODEX=0`
disables discovery. `RELAY_DIR` relocates Switchboard state for an isolated test instance.

## Model selection

- **Settings / command centre:** models come from the daemon's provider inventory. The global
  `defaultModel` in `models.json` sets the suggestion for new apps, alongside the existing deny-list.
- **Connection notch:** choose the models the app may access, then the model new conversations use.
  Mouse and keyboard approval submit the same live selection.
- **Inside an app:** the shared connection chip shows the new-conversation default. Its Change action
  reopens consent at the notch. The extension consent panel has the same default-model choice.
- **Existing conversations:** `(origin, sessionId)` pins the actual model, persisted in
  `session-models.json`. Changing defaults affects new conversations. A disabled, offline, or revoked
  pinned model produces an explicit error rather than migrating the conversation to another provider.
- **Legacy apps:** an explicit user choice translates requests such as `sonnet` before grant validation.
  Existing grants are never automatically expanded. Reconnect an existing app to grant a Codex model.

An app starts a new conversation by using a new `sessionId`, or ends one through `claude_session`
with `op: "end"`. Single-shot requests without a session use the current app default.

Apps discover provider features and their effective default through `claude_capabilities`.
BYOP 1.3 adds `modelInfo`, `defaultModel`, `sessionModelPinning`, and the `capabilitiesChanged`
event. The shared connection chip refreshes on these events; custom model pickers should
follow the [app discovery contract](MODEL-DISCOVERY.md). Bundled SDK updates require an app rebuild.

## Runtime and permissions

One supervised App Server process can host multiple independent threads. Turns for the same app
session are queued; different sessions can progress independently. Thread IDs remain daemon-owned
and are stored in `codex-sessions.json` with private file permissions. After a restart, Switchboard
resumes its recorded threads. Persona or tool-schema changes create a fresh thread so removed tools
and obsolete instructions are not retained as the active configuration.

Codex receives broker-discovered MCP schemas as dynamic tools. Calls return to Switchboard's Gate
for authorization and execution. Inherited Codex apps, plugins, hooks, shell, browser, image-reading,
and other direct execution surfaces are disabled in this runtime. User Codex configuration is not
edited. Unknown approval requests are denied. Cancellation or runtime failure while a write awaits
consent prevents that action from executing after approval arrives. The gate also rechecks current
scope after approval, so revoking access, removing a tool, or choosing read-only mode takes effect
before the pending action can execute.

## Compatibility boundaries

- Implemented against Codex CLI **0.135.0** and its generated App Server schema. Dynamic tools and
  environment selection are experimental interfaces; revalidate them when upgrading the runtime.
- Local runners currently support one-shot text completions. Warm-session requests fail explicitly
  instead of falling through to Claude.
- Claude-account-only connectors and Claude's built-in WebSearch/WebFetch do not automatically become
  Codex tools. Configure the equivalent MCP services in Switchboard. A tool-dependent request with no
  usable broker tools fails explicitly. Brandbrain's knowledge-only warm path works; parity for every
  research, media, or computer-use workflow is not implied by the live proof.
- Codex maintains conversation history. This does not guarantee permanent server-side prompt caching
  or constant latency. Usage from each turn is recorded, including cached input in total input usage.
- App Server has no equivalent per-turn `maxTokens` field in the tested schema. Switchboard checks
  its existing budgets before calls and records actual usage afterward; `maxTokens` is not a hard
  Codex generation cap.
- The checked-in Mac app bundle is not rebuilt or replaced by these source changes. Build/package the
  updated native app before expecting the new model controls in an installed copy.

Official references: [App Server](https://learn.chatgpt.com/docs/app-server),
[authentication](https://learn.chatgpt.com/docs/auth).
