# Switchboard

**The gateway between your AI and everything you use it for.**

Switchboard is a Mac app that sits in your menu bar and brokers every call. Apps ("wrapps") run on **your**
Claude subscription or a local model. Your tools, your files, your context are *lent* to them through one
consent gate — never copied out, never handed over.

It runs **both ways**, and that's the point:

- **Wrapps use Claude.** A wrapp is just a page — no backend, no API key of its own. It asks Switchboard,
  which lends it your AI, your connected tools, and your project context.
- **Claude uses Switchboard.** A Claude Code session connects to the same gate and *runs your wrapps* —
  picking work off your board, calling a wrapp's actions, driving your apps. Your AI gets hands.

Same broker, one consent gate, on your machine.

> **Your AI, your tools, your data — patched through one board you own.**

---

## Why Switchboard?

Today's AI is scattered across dozens of apps. Context gets lost, subscriptions are fragmented, and your
data is spread across multiple providers.

Switchboard brings everything together in one private workspace where AI apps share **context, not your
data**. The model, the tools, the context, and the files stay on your machine. Apps bring only a UI — they
never hold your API key and never see your data.

---

## What it does

Switchboard lives in your **menu bar** and surfaces right at the **notch** — an ambient assistant, a
launcher, and a full private workspace, always one keystroke away and all sharing the same context.

### The assistants — always there

- **God — `⌃⌥ click`.** Your all-purpose assistant. It *sees your screen* and helps: points at the right
  thing, types, clicks, and runs apps for you — always under your consent. Talk to it, and it talks back.
- **Ask — `⌃⌃`.** Type a question across everything you're working on — projects, tasks, notes, history —
  and God answers grounded in *your own* work, not a blank slate.
- **Guru.** A live guide. It walks you through any task on any app, step by step, pointing a cursor and
  adapting to what's actually on your screen — a manual can't do that.
- **Flow — `⌃⌥ hold`.** Dictation, done right. Hold, talk, and it types — anywhere on your Mac, transcribed
  on-device.

### The notch is the interface

Decisions, approvals, and guided steps appear as **cards right at the notch** — you answer with a keystroke
(`⌥1/2/3` to pick, `⌥→` to confirm), never a context-switch. Every card shows who's asking and which project
it belongs to, so it's never a mystery prompt.

### The whiteboard — sketch straight to Claude

Open a floating board, draw the thing, hit send — no screenshots, no describing a layout in words. It's an
infinite canvas with shapes, sticky notes, connector arrows that stay bound to what they point at, and
pasted screenshots you can mark up. **Claude draws too:** it can seed the board with an editable diagram,
and a decision card can be answered by *drawing on it* rather than picking a letter. Past boards reopen from
a filmstrip — still editable, not flattened to an image.

### The notch tray

Minimise a surface — the whiteboard, a card — and it docks as a **chip at the notch** instead of vanishing.
Click the chip to bring it back exactly where it was. Hovering the notch shows what's there; a deliberate
tap opens the full panel.

### The launcher — `⌥⌥`

A spotlight for your work: jump to a project, launch an app, find a file, or ask across everything — from
anywhere, without leaving what you're doing.

### The workspace — `⌘O`

A full private workspace built over your vault. Thirteen surfaces, each a **lens on the same data** — never
a separate silo:

**Home · Tasks · Calendar · Bank** (your projects) **· Dashboard · Needs · Routines · Workflows · History ·
Graph · Dictionary · Apps · Store.**

Add a task and it lands on the calendar; finish a run and it's a receipt in History; establish a project in
Bank and every surface — and your Claude — reads the same context.

**Tasks is a real kanban** — Backlog → Todo → Doing → Blocked → Review → Done, drag to move. Paste a
scattered brain-dump and your own Claude turns it into detailed cards, bundled together, with blockers
marked between them — parked in Backlog for you to promote when you're ready.

### Claude runs your wrapps — the reverse flow

This is the half most people miss. Connect a **Claude Code** session to your workspace (one click — a *Connect
Claude Code* card appears in your notch during setup) and it can **pick up work from your board**: move a
task to Todo, then tell Claude *"pick up the next task"* — it claims the top unblocked one, does it, and
marks it done, moving the card across as it goes. It can run your apps headless and scaffold new ones the
same way. This is how **Guru and the workspace get real hands**.

### The store

Native and web apps that share your context and run on *your* AI. Install what you need, nothing you don't.

### Your vault

A project is a few `.md` files you own — essence, tasks, notes, artifacts. Every app reads the same context;
nothing is copied out, and you can revoke any grant at any time.

---

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `⌃⌥` + click | God looks at your screen and helps |
| `⌃⌥` hold | Dictate (Flow) — talk, it types at your cursor |
| `⌥V` | Re-paste your last dictation (a voice clipboard, separate from `⌘C`/`⌘V`) |
| `⌃⌃` | Ask across your work |
| `⌥⌥` | Launcher / spotlight |
| `⌘O` | Open the workspace |

On a notch card: `⌥1/2/3` pick · `⌥→` confirm · `⌥↑` back · `Esc` dismiss.

---

## Apps

### Included (native, in the box)
- **Flow** — dictation, done right. Talk and it types — anywhere on your Mac, transcribed on-device.
- **God** — your all-purpose assistant. It sees your screen and can point, type, click, and run apps for
  you, always under your consent.
- **Guru** — a guide for anything. It walks you through any task on any app step by step, adapting live to
  what's actually on your screen.

### In the store — 94 wrapps, all free

Every one runs on your own AI. A few of them:

| | | |
|---|---|---|
| **Brandbrain** — brand studio | **Ideabrain** — pressure-test an idea | **Redline** — review + edit |
| **Crest** — logos and marks | **Deck** — build the slide deck | **Autopilot** — plan your week |
| **Clone** — clone a voice | **Cut** — video timeline | **Prism** — research + synthesis |

[Browse the whole board →](https://thelastprompt.ai/apps/) · or scaffold your own with the `wrapp` skill.

---

## Bring your own AI

Switchboard runs on **your** infrastructure — your choice:

- **Your subscription** — bring your Claude and every app runs on it.
- **A local model** — keep everything on-device.
- **Hybrid** — local by default, reach for the cloud only when you opt in.

The broker never holds a key and never sees your data — it only routes the calls you've consented to.

---

## Install

Switchboard is a macOS app for Apple Silicon (macOS 13+). Download the signed, notarized
[`Switchboard.dmg`](https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg),
drag it to Applications, and launch it — the workspace lives in your menu bar. First run walks you through
the one-time setup (your model, permissions, first app).

The Chrome extension is an optional layer-2 upgrade — it lets you run your Claude on *any* website. You
never need it to get value from the app.

---

## How it works

A local **daemon** holds your model and your connected MCP tools. Apps — native or web — request
capabilities through a single **consent broker**: they can only ever touch what you've granted, for as long
as you've granted it. Your project context (a vault of `.md` files you own) is *lent* to apps, so they share
what you're working on without copying it anywhere. An optional browser extension injects the same provider
into web pages, so any site can run on your own model, tools, and data under per-site consent.

Isolation is structural: every app is scoped to its own sandbox and the context you explicitly lend it.

---

## Privacy — the five noes

- **No account** to create.
- **No data** leaves your Mac without a grant.
- **No key** resold — you bring your own.
- **No lock-in** — your vault is plain `.md` files you own.
- **No training** on your data.

---

## For developers

Switchboard is open source — an npm-workspaces monorepo:

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
