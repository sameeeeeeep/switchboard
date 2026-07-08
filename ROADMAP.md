# Switchboard — Roadmap

**Switchboard** = MetaMask, but for AI. A local **sidekick** daemon holds your Claude + connected
tools; a browser **extension** injects `window.claude` into every page so any website can run on the
visitor's own model + tools, under per-origin consent you control. Apps can run **airgapped** (no
network egress) so a stranger's app can't exfiltrate your data — the basis for a "wrapper app store."

> The repo is currently named/scoped `relay` / `@relay/*`; the product name is **Switchboard**.
> The injected provider stays `window.claude` (names the asset). Package rename is on the backlog.

---

## Built & proven

- **Daemon** (`packages/sidekick`): gated **agentic loop** via the Agent SDK's in-process
  `canUseTool` (proven; not PreToolUse hooks). Out-of-band gate: per-origin allowlist, budgets
  (tokens/day, calls/min), default-deny tool classifier, audit log, kill switch. Loopback WS +
  pairing token. Error-resilient (survives dropped connections). Runs as a macOS **LaunchAgent**
  (`npm run daemon:install`, auto-start + KeepAlive).
- **MCP + connectors**: auto-imports the user's existing `~/.claude.json` MCP servers. **claude.ai
  connectors (Higgsfield, Shopify, …) are inherited automatically** by the daemon's SDK — *no bridge
  needed* (proven: real Higgsfield image gen end-to-end). Whole-connector **wildcard grants**
  (`mcp__claude_ai_X__*`); each concrete call still classified/consented.
- **Extension** (MV3, `packages/extension`): injects `window.claude` (web-accessible script — the
  reliable wallet pattern), is the **origin oracle**, holds the pairing token. **Side panel**
  (brandbrain design) with pairing, per-site budget meters, activity feed, **per-site trust modes
  (Ask / Trust / Read-only)**, and **inline consent — no separate window** (select-all, only the
  requested scope).
- **Completions**: `system` prompt ✓, streaming, agentic tool use, per-action write consent.
  Reference/media upload via the relay-native `relay__put_blob` primitive (proven image-to-image).
- **Menu-bar app** (`packages/menubar`, Swift): status + copy token + start/stop; tints by state.
- **Airgapped runner** (`examples/runner`): sandboxed iframe + strict CSP (`connect-src 'none'`) +
  postMessage provider bridge + live "airgap monitor". Proven: an app generates on your model AND
  all exfiltration attempts (fetch/beacon/image) are blocked.
- **Adapter** (`examples/adapter`, future `@switchboard/adapter`): a fetch-router that runs an app's
  Web-standard `/api/*` routes client-side, + a drop-in `lib/claude` shim backed by `window.claude`.
  **Proven on brandbrain's ACTUAL `app/api/studio/gaps/route.ts`** — ran unchanged, real scored
  openings, model via the broker, no server.
- **App Store** (`examples/apps`): brandbrain (demo card), Prism (airgapped image gen), Ad
  generator, Tool assistant, Chat. Provider SDK: `@relay/sdk`. Spec: `spec/BYOP-1.md`.
- **`claude_context` primitive** (`packages/sidekick/src/context`): the shared, cross-app CONTEXT
  layer — the third BYO pillar (inference + backend + **context**). An app `publish`es a whole,
  opaque context (e.g. a brand); another app reads it ONLY via `active` — the one context the user
  **selected** for that origin in the panel (selection = consent, set out of band via the
  `selectContext` control action). Apps can't enumerate the library (`list` returns only their own);
  the whole-library view is panel-only (`listContexts`). Per-origin, revocable. Proven cross-origin
  (`spike/context-spike.mjs`, 9/9): brandbrain publishes "Aamras" → ad-gen gets null until lent →
  whole context after selection → third origin stays null → clearable. SDK: `relay.context.*`.
  Library at `~/.relay/contexts.json` + `~/.relay/context-selection.json`.
- **`claude_session` primitive** (`packages/sidekick/src/session`): warm, stateful completion threads —
  one long-lived `claude -p --input-format stream-json` process per (origin, sessionId), turns queued
  sequentially, recycled every 6 turns, idle-swept. Read-only by construction (`--strict-mcp-config` +
  only the origin's granted web reads — never a write tool). Gated like a completion (grant + model
  scope + budget per turn). This is the daemon port of brandbrain's proven warm-session model
  (`lib/claude-session.ts` / `scripts/sidekick.mjs`), replacing the first port's stateless
  one-shot-per-card (which cold-started every card and flooded the machine with concurrent processes —
  the cause of brandbrain's Studio stalling/slowness). Proven (`spike/session-spike.mjs`, 6/6): 3
  sequential turns on one warm thread, all valid cards, later turns ~40% faster than the cold first.
  The pool caps live warm processes across all apps×projects (LRU idle-eviction; eviction is free since
  context is re-sent inline) so a whole ecosystem stays at a handful of processes.
- **Projects (scoping unit) + consumer side panel** (`packages/extension`): a *project* is the unit a
  brand is an instance of. A global "working on" project (`setActiveProject`) is lent to every connected
  app by default (`context.active` falls back to it), while a per-app pick still overrides. The side
  panel was rebuilt from a logs dashboard into a consumer surface: **Working on** (the active project in
  its own brand palette) · **Connectors** (friendly capability tiles derived from grants — Higgsfield,
  Shopify, Web…) · **Apps** (clean rows; token meters, tool names, trust mode, disconnect tucked inside a
  per-app expander) · a **bottom-sheet project switcher** · Activity + kill switch moved into a `⋯` menu.
  The panel is also the **wrapp launcher** (a store grid → open any app in a new tab, + "open any URL";
  connected apps get a live dot) — `chrome.tabs.create`, static registry for now.
- **Source-backed contexts (Sheets → JSON)** (`packages/sidekick/src/context/resolver.ts`): a context
  can carry `source: { kind: "csv"|"gsheet", url }`. On read, if the cache is stale (5-min TTL), the
  daemon fetches the CSV directly (Node fetch; **SSRF-guarded** — public http(s) only, no localhost/
  private) and parses it (RFC4180: quoted commas + embedded newlines) into `{ columns, rows }`. **Zero
  new infra** — a published Google Sheet IS the database; the user's spreadsheet becomes live shared
  context, selected + lent like any project. Panel: "Connect a Google Sheet" (paste published CSV URL)
  → appears in the switcher badged `live · N rows`. Proven (`spike/context-source-spike.mjs`, 13/13) +
  a live fetch of a real 50-row public CSV. Read-only v1; write-back is a later gated write.
- **`claude_storage` primitive** (`packages/sidekick/src/storage`): per-origin, on-disk key/value
  store gated like everything else. Auto-assigns a private sandbox (`~/.relay/storage/<origin>/`)
  with no prompt; `bind` points an origin at a real user folder behind a one-time path-consent.
  Structural isolation (path derived from the authoritative origin), traversal-safe keys, keys map
  1:1 to `<key>.json` so an existing project folder's files appear as records with **zero
  migration**. Proven headless (`spike/storage-spike.mjs`, 23/23) and end-to-end through the live
  daemon + adapter shim (`examples/adapter/proof/run-storage.mjs`, 10/10 — brandbrain's real
  `.data/workspace.json` read + written through `window.claude`). SDK: `relay.storage.*`. Adapter
  drop-in for `workspace-store.ts`: `examples/adapter/claude_storage.mjs`.

---

## Next up

### 1. brandbrain — full port (the immediate pickup)
Turn the *real* `~/Documents/Projects/brandbrain` into the store's brandbrain (today's store card is
a one-route demo). It's a **port, not a rewrite** — assessed portable: 7 pages (client shells, no
SSR data), 32 Web-standard routes, **no server secrets**, and it already has `scripts/sidekick.mjs`
+ client `fs:false` fallbacks.
- **1a.** Bundle brandbrain's real frontend (pages + Studio/OS components) as a standalone client app.
  *Hard part:* Next.js App Router is server-coupled — needs a careful static export or a custom
  client bundle + router.
- **1b.** Auto-collect all 32 route handlers into the adapter's fetch-router (dispatch `/api/*` locally).
- **1c.** ✅ Swap two libs: `lib/claude.ts` → the `window.claude` shim (done earlier);
  `lib/server/workspace-store.ts` → `claude_storage` (**done** — `examples/adapter/claude_storage.mjs`
  is the drop-in, proven binding brandbrain's real `.data`). The bundled port (1a/1b) just imports it.
- **1d.** Serve as the store's brandbrain; run it in the airgapped runner.

### 2. ✅ `claude_storage` primitive — DONE (see Built & proven)
Per-origin local store + user-picked **project folder** (`bind`), auto-assigned sandbox otherwise.
Replaces `workspace-store.ts`. Isolated per origin, writes blocked in readonly mode, `bind` behind a
path-consent. New BYOP method `claude_storage` (get/set/list/delete/bind/info). The store card
(`examples/apps/brandbrain.html`) now surfaces the bound folder + existing brands.

### B. Panel launcher / wrapp store — near-term
Make the side panel the hub (MetaMask's dApp browser). A **Wrapps** view: a curated grid from a static
registry JSON (name, icon, url) — click to open in a new tab, Switchboard already there to connect —
plus "open any URL" quick-launch and a "recently used" row from the grants list. `chrome.tabs.create`
to open; listing ≠ endorsement (per-origin consent still gates; untrusted wrapps run in the airgap
runner). Nearly free; makes the whole thing feel like a product.

### 3. Structured output on completions
`jsonSchema` param (the Agent SDK supports `--json-schema`). `system` is already done. brandbrain
uses `extractJson` on text today, so this is a robustness upgrade, not a blocker.

### 4. Media through the broker
Deliver generated media (images/video) as **data-URIs / bytes** through the broker so airgapped apps
can render them under `img-src data:` (external image loads are blocked in the sandbox).

### 5. Rename `@relay/*` → `@switchboard/*`
Product name. `window.claude` stays. Mechanical but touches every package + import.

### 6. Menu-bar app polish
`SMAppService` login-item registration (auto-start the app itself); richer color states
(idle / in-use / approval-waiting — needs the app to query daemon state).

### 7. Distribution
Signed + notarized `.dmg` (installs `Relay.app` + LaunchAgent + login item) and Chrome Web Store
listing. Needs an Apple Developer ID (the one un-fakeable last mile).

### 8. "Sign in with Switchboard" (identity)
`claude_connect` = sign-in + authorize. A relay-native identity key that signs site challenges
(passwordless login, MetaMask-style), and/or identity-via-connected-account. New method
`claude_signIn` / `claude_identity`, gated like everything else.

### 9. Data-egress hardening (beyond the airgap)
Return-preview for sensitive tool reads ("this site is about to receive: [your calendar]");
field-level scoping (grant calendar but only free/busy).

### 10. Local-model backend (the "any local model" half)
`local-openai` backend (Ollama / LM Studio via `/v1/chat/completions`) behind the same provider
surface. Foundation stubbed in `packages/sidekick/src/backends/local-openai.ts`.

---

## Key decisions (context for a fresh thread)
- Provider global stays `window.claude`; product = Switchboard.
- Gate is **out-of-band**; the model is never the security boundary. `canUseTool` in-process (the
  CLI's `--permission-prompt-tool` was removed; PreToolUse hooks don't enforce deny for MCP tools).
- claude.ai connectors are **inherited** by the daemon's SDK — no bridge. Wildcard grants for whole
  connectors.
- Airgap: CSP `connect-src 'none'` + postMessage bridge. Apps must be **frontend-only** (single-user,
  generative). Multi-user / shared-state backends don't fit the airgap.
- App adoption = swap what `@/lib/claude` resolves to (the adapter). Minimal change.
- Design language = brandbrain's tokens (ink `#0A0C10`, lime `#C8F250`, Bricolage/Hanken/Spline).
  Switchboard's own surfaces use it; third-party apps keep their own identity.
