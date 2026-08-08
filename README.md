# Switchboard

**Your private AI workspace.**

Run AI apps using your own subscriptions, local models, or hybrid infrastructure. Every app shares the
same context — your data stays under your control. Install the macOS app and get instant access to a
growing ecosystem of native and web AI apps, without breaking your workflow.

> **One workspace. Every AI app. Your data stays yours.**

---

## Why Switchboard?

Today's AI is scattered across dozens of apps. Context gets lost, subscriptions are fragmented, and your
data is spread across multiple providers.

Switchboard brings everything together in one private workspace where AI apps share **context, not your
data**. The model, the tools, the context, and the files stay on your machine. Apps bring only a UI — they
never hold your API key and never see your data.

- **Bring your own AI** — your Claude subscription, a local model, or a hybrid setup.
- **Shared context, private data** — every app reads the same project context; nothing leaves your Mac
  without per-app consent.
- **One ecosystem** — native apps that ship in the box, plus a store of web apps that run on *your*
  infrastructure.

---

## Apps

### Included (native, in the box)
- **Flow** — dictation, done right. Talk and it types — anywhere on your Mac, transcribed on-device.
- **God** — your all-purpose assistant. It sees your screen and can point, type, click, and run apps for
  you, always under your consent.
- **Guru** — a guide for anything. It walks you through any task on any app step by step, adapting live to
  what's actually on your screen.

### Available in the store
- **BrandBrain** — brand strategy.
- **IdeaBrain** — product ideas.
- **Prism** — research and synthesis.
- **AdForge** — ads and campaigns.

### Coming soon
OS, Batch, Redline, Crest, Natal, Cast, Identity, Cartridge, AdPulse, Deck, Dub, and **sameep.ai** —
tools for orchestration, review, storytelling, analytics, and autonomy.

---

## Install

Switchboard is a macOS app. Download the signed, notarized `Switchboard.dmg`, drag it to Applications,
and launch it — the workspace lives in your menu bar. First run walks you through the one-time setup
(your model, permissions, first app); nothing else is required.

The Chrome extension is an optional layer-2 upgrade — it lets you run your Claude on *any* website. You
never need it to get value from the app.

---

## How it works

A local **daemon** holds your model (Claude via your subscription, or a local model) and your connected
MCP tools. Apps — native or web — request capabilities through a single consent broker: they can only
ever touch what you've granted, for as long as you've granted it.

- **The broker never holds a key** and **never sees your data** — it only routes consented calls.
- **Your project context** (a vault of `.md` files you own) is lent to apps, so they share what you're
  working on without copying it anywhere.
- **A browser extension** (optional) injects the same provider into web pages, so any site can run on your
  own model, tools, and data under per-site consent.

Isolation is structural: every app is scoped to its own sandbox and the context you explicitly lend it.

---

## For developers

Switchboard is open source. The repo is an npm-workspaces monorepo:

- `packages/protocol` — the wire types + error codes (BYOP).
- `packages/sdk` — `getRelay` / `whenRelayReady` + the connect chip.
- `packages/extension` — the MV3 browser extension.
- `packages/sidekick` — the Node daemon: WS server, consent broker, model backends, context library, storage.
- `packages/menubar` — the macOS menu-bar app (Swift) that supervises the daemon.
- `packages/bank-mcp` — an MCP server that exposes your vault to any Claude thread.
- `examples/apps` — the app store and the bundled web apps.

Run it locally:

```bash
# the daemon (prints a pairing token)
node packages/sidekick/dist/index.js

# the app store (Prism, BrandBrain, …)
cd examples/apps && node serve.mjs
```

Load `packages/extension` as an unpacked MV3 extension and paste the pairing token into the side panel.

### Security invariants (never violated)
- The broker never holds a user's API key and never sees app data in the clear.
- An app can only reach a capability the user has explicitly granted, scoped to that app's origin.
- Context and files are lent, never copied out; the user can revoke any grant at any time.

---

## License

MIT.
