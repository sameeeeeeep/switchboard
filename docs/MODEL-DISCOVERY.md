# Model discovery for apps

Switchboard routes the existing `window.claude` API to Claude Code, Codex, and supported
local models. Apps do not need a second transport or a provider API key.

**Existing apps:** an explicit user selection can translate a legacy request such as
`sonnet` to Codex. An existing Claude-only grant does not gain Codex permission
automatically; the user reconnects the app and approves its model access.

**Apps with their own model picker or feature controls:** read the live catalog and
subscribe to changes. Do not infer tool, vision, or session support from model names.

## Discover and react

BYOP `1.3.0` adds optional fields to `relay.capabilities()`:

| Field | Meaning |
| --- | --- |
| `models` | Enabled, available model IDs; retained for older apps |
| `modelInfo` | Each model's backend, vision/tool/warm-session support, and tool source |
| `defaultModel` | This app's effective model when a new request omits `model`; absent when none is usable |
| `sessionModelPinning` | Existing conversation IDs keep their starting model |
| `local.stt` | A local speech recognizer is configured; optional on older daemons |
| `local.tts` | A local speech engine is available |

The catalog is availability, not authorization. Filter it by the model IDs in
`relay.permissions().models` before offering already-approved choices.

```js
async function refreshModels() {
  const [capabilities, grant] = await Promise.all([
    relay.capabilities(),
    relay.permissions(),
  ]);
  const granted = new Set(grant?.models ?? []);
  const available = (capabilities.modelInfo ?? []).filter(m => granted.has(m.id));
  // Drive your model picker and feature controls from these values.
  updateModelUI({
    available,
    defaultModel: capabilities.defaultModel,
    pinnedConversations: capabilities.sessionModelPinning === true,
  });
}

relay.on("connect", refreshModels);
relay.on("permissionsChanged", refreshModels);
relay.on("capabilitiesChanged", refreshModels);
relay.on("health", refreshModels);
await refreshModels();
```

`capabilitiesChanged` invalidates the catalog when global model preferences, runtime
availability, or provider sign-in changes. Native settings changes are detected within
about one second; provider health changes follow the daemon's 30-second status poll.
Per-app defaults also emit `permissionsChanged` to that origin. Refresh on reconnect
because events are not a durable queue.

Older daemons omit these new fields. Keep their existing `models` flow and treat missing
feature metadata as unknown; do not advertise unsupported features based on a guess.
Claude aliases such as `sonnet` also exist alongside full model IDs, so an app should
request and retain the exact IDs returned by the broker.

## Let the user choose

The shared `mountConnect` chip offers **New conversations → Change…**. It reopens
connection consent, preserves the current choice, and refreshes when models change.
Apps with custom controls can reopen `relay.connect(...)` with the desired model scope;
Switchboard presents consent. Discovering a new model never grants it silently.

Omit `model` to use the user's default. Keep one `sessionId` for each conversation.
Changing the default affects new conversation IDs; an existing conversation keeps its
model. Display `CompletionResult.model` (or the streaming `done.result.model`) as the
model that actually ran. Disabling that model pauses the conversation; it does not
move its history to another provider.

## Tools and rollout

Codex advertises `toolSource: "broker-mcp"`. Claude Code advertises `"claude-code"`
because it can also expose runtime tools and inherited connectors. Local text runners
advertise no tools or warm sessions. A model supporting tools does not mean a particular
connector is configured or granted; check the actual tool scope too.

Rebuild apps that bundle `@relay/sdk` to ship the updated connection chip and event type.
Existing deployed bundles are not remotely rewritten. App owners with custom model
controls adopt this discovery contract and republish their apps. No provider-specific
announcement or prompt injection is required at runtime.

See [Codex integration](CODEX.md) for setup and remaining compatibility boundaries.

Local voice is independent of the text model. Check `local.stt` before offering
`relay.transcribe(audioDataUrl)` and `local.tts` before local speech output. Native
clients use the same discovery fields but must also inspect `methods`: their separate
transport does not yet implement streaming or cancellation. See
[native and local integration](NATIVE-AND-LOCAL.md) for the standalone client and proof.
