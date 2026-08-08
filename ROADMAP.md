# Switchboard — Roadmap

**Switchboard** = your private AI workspace. A local **sidekick** daemon holds your Claude + connected
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
- **Team Mode** (`packages/sidekick/src/team`, opt-in, OFF by default): N people, N Claudes, ONE
  shared folder. Host/join with a sealed invite code (every daemon↔daemon frame AES-256-GCM +
  AAD-sequenced; silent knock-first handshake, authorship binding, connection caps), file-level
  LWW sync with tombstones + presence, panel Team section, wrapps update live via the existing
  `permissionsChanged` re-read path. **Git backing**: the team folder is optionally a repo —
  debounced attributed auto-commits, pull/merge/push with the member's own git auth, so teams
  sync through the GitHub they already have when apart (repo access = revocable membership).
  **Cross-network relay** (`packages/relay`, a Cloudflare Worker + Durable Object): host + members
  dial OUT to a dumb store-and-forward that moves only sealed frames (holds no key, stores nothing —
  a mailman, not a landlord); the invite carries the relay URL so a joiner still pastes one code.
  MIT, self-hostable. **Team-ready wrapps for free** via `kit/livestore.js` (`collection()` +
  `mountLive()`, shipped in the wrapp template as doctrine gate 7; Redline/CUT migrated as flagship).
  Visible default join folder (`~/Switchboard Teams/<team>`) + per-member presence colours.
  Zero protocol/SDK changes; consent broker untouched. Proven headless: `npm run try-team` +
  `try-team-git` + `try-team-relay`; 68-cell wrapp harness green. Design + threat model:
  `docs/TEAMMODE.md`.
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

### 0. Autopilot → a real wrapp (prototype landed, SDK not wired)

`examples/autopilot/` holds a **working decision engine** with no model behind it. The state
machine, locking, downstream ripple, persistence and token accounting are real; the option copy is
seeded. Open `examples/autopilot/index.html` directly — no build step.

**Why it is a separate wrapp, not a brandbrain mode.** Three verbs:
*ideabrain* asks **should this exist** (ends in a thesis + deck), *brandbrain* asks **what is it**
(ends in `brand.json`), *autopilot* **runs it** — never terminates, N companies at once. brandbrain
already contains the cockpit (its OS / `command-centre` has the runbook and auto/approve/manual
modes) but buries it behind a 20-decision wizard. Autopilot is that cockpit promoted to the front
door, generalised past D2C, plus a portfolio and a token model. It should **consume** brandbrain,
not duplicate it: brandbrain publishes `kind: "brand"` via `brandToContext`
(`docs/CONTEXT-KINDS.md`), autopilot reads it with `context.active()`.

- **0a.** Port to the house template (`.claude/skills/wrapp/template.{html,js}`) — copy, don't
  retype; the plumbing encodes the stream contract, timeouts, context sync and storage.
  `id: "autopilot"`, `usesContext: "single"`, `scope.contextKinds: ["brand"]`.
- **0b.** Wire real generation: replace the seeded `buildOptions()` in `src/engine.js` with
  `askJson()` calls. The engine's decision/lock/ripple layer needs no change — that is the whole
  point of having built it first.
- **0c.** Inherit rather than re-ask. When a brand is lent, voice / palette / positioning come from
  the context and render as **inherited** (viewable, not re-decidable). Autopilot's own decisions
  are the operating ones: ad angle, next move, channel. With no brand lent, one line seeds a
  company and voice becomes a real decision again.
- **0d.** Cold open: on connect with a lent brand, draft the operating slate with zero input.
- **0e.** Tokens as the funding unit. Tokens are the **only honest number** on the surface —
  revenue needs a connected store, so it says "not connected" rather than drawing a fake chart.
  Ties into `docs/TOKENS.md`; a token budget is capacity to work, not a subscription.
- **0f.** Storage must satisfy the team-ready gate: companies are a `collection(relay, …)`
  (one company = one file) via `kit/livestore.js`, never one growing JSON blob.
- **0g.** Then: build entry, catalog entry, store card, harness coverage.

Known gaps in the prototype: zero SDK calls; only two seeded company kinds (d2c, saas); the
"+ New company" button opens the token pane instead of seeding a company.

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
Make the side panel the hub (an app browser). A **Wrapps** view: a curated grid from a static
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
(passwordless login), and/or identity-via-connected-account. New method
`claude_signIn` / `claude_identity`, gated like everything else.

### 9. Data-egress hardening (beyond the airgap)
Return-preview for sensitive tool reads ("this site is about to receive: [your calendar]");
field-level scoping (grant calendar but only free/busy).

### 10. Local-model backend (the "any local model" half)
`local-openai` backend (Ollama / LM Studio via `/v1/chat/completions`) behind the same provider
surface. Foundation stubbed in `packages/sidekick/src/backends/local-openai.ts`.

### 11. Store redesign — the use-pack (**direction agreed, ready to build**)
Replace the flat 27-card grid in `examples/apps/index.html` with a store that shows category-wise and
routes a stranger to what's relevant. **Full brief: [`docs/STORE-REDESIGN.md`](docs/STORE-REDESIGN.md)
— read it before touching the page; three design passes were rejected and the reasons are recorded
there.** Signed-off wireframes (both states) are in `docs/store-wireframes/store-v3.html`.

The shape, in one paragraph: the unit becomes a **use, not an app** — a horizontal pack of concrete
jobs ("Draft this week's ads", "Find the spend that's being wasted") with the app as small print and a
**precondition** as the third atom (`needs a URL`, `paste an export`), because for a tool that borrows
your context the real blocker is what it costs you to start. Around it: five section *registers*
(ACT / MAP / STORY / SCAN / YOURS), each surface encoding what you do there.

Sequenced, because the first item is a data-model change and not a layout change:
1. **Catalogue metadata.** An entry is only `{id,name,href,tokens,updates,pro}` and tags live in HTML
   as `data-tags`. Add job, required input, and output kind — the pack cannot be honest without it.
2. **Taxonomy → jobs.** Six job groups replace the eight shelf-nouns in `src/store/taxonomy.js`; any
   group with fewer than three wrapps doesn't ship.
3. **21, not 27.** ideabrain's six `?template=` entries collapse into one card with six doors.
4. **Type scale.** Six steps with the 2× cliff (12/14/16/18 → 36 → 46), three weights. This — not the
   typeface — is what "hierarchy is missing" actually was: 18 sizes today, 12 of them in a 6px band.
5. **Retire the live-iframe thumbnails** for rows + real output stills. Contradicts `docs/DESIGN.md`,
   which needs updating alongside.
6. **Move `buildRecs()`/`buildActions()` to the top** of the returning state — the relevance engine
   already works; its placement is the bug.

Open decisions flagged in the brief: light vs dark (research says light, DESIGN.md locks dark),
and real output stills to replace the placeholder art. Reuse `examples/apps/src/kit/ui.js` — it is
already imported by 21 wrapps and exists because 18 byte-identical copies were found.

### 12. God — the native, screen-aware assistant (**client landed; eye shipped**)
God is the ambient assistant that sees your screen, hears you, and points a cursor-companion at any
app — supported wrapp or not. Built as a native client of the daemon, the sibling of Flow:
`hotkey → screencapture → claude_complete(+vision, +persona) → [POINT:x,y:label] overlay + voice`.

- **Vision-in — DONE.** `claude-code.ts`'s `toSdkPrompt()` now sends screenshots as real image
  content blocks (were connector-upload-only, never model vision). Proven pixel-accurate
  (`spike/god-eye-spike.mjs`: read a code that lives only in pixels; `[POINT]` 1px off center).
- **Client — DONE (`examples/god/`).** Persona-modular: the cursor / voice / characteristic that
  accompany you live in swappable `personas/*.json` (drop one in `~/.god/personas` to add a God).
  Verified end-to-end (daemon spawn → native register → vision → `[POINT]` → companion); same
  screen, different persona = genuinely different behaviour.
- **Ships INSIDE the notch bundle — the first-party built-in concierge, not a store install.**
  `Relay.app` already carries node + daemon + claude CLI; God adds native hotkey + ScreenCaptureKit
  + overlay `NSWindow`. Pre-installed by construction. First-party principal → token auto-mints on
  first run with NO connect-consent (it *is* the app), **but every write still hits the gate.**
- **Why couple it — God is the platform's legibility layer:** (1) **setup concierge** — sees you're
  signed-out / missing-extension / ungranted and points at the button (attacks the install-journey
  drop-off); (2) **runs wrapps** via the Switchboard connector (NL front door to the catalogue);
  (3) **discovery** — "there's a wrapp for that / here's the open-source alternative"; (4)
  **anywhere** — how Switchboard escapes the walled web-wrapp set and leaves the browser.
- **Next:** migrate hotkey+capture+overlay into the menu-bar app (Swift); the consent-gated *hands*
  (`AXPress`/CGEvent/type) route through the gate, never macOS Accessibility's one-time firehose;
  then the native-app-store catalog + launch lifecycle (God is the mold third-party native apps copy).

### 13. Codex backend (BYO-Codex) — **coming soon**
A `CodexBackend implements ModelBackend` shelling the `codex` CLI, a sibling to `ClaudeCodeBackend`,
so apps can run on an OpenAI/Codex subscription the way they run on Claude or Ollama today (register
in `backends/registry.ts`). Two tiers: **model-only** (OpenAI-compatible completions + `image_url`
vision blocks in `local-openai.ts` → e.g. God on GPT-4o) is small; **agentic Codex** is gated on
wiring the consent gate into Codex's loop (the "gate lives with the loop" constraint — `claude-code`
is trusted because the SDK's `canUseTool` fires out-of-band per tool). The closed reference apps are Codex-first
(entire `Codex*` runtime), so this is the parity path once the interpose is proven.

---

## Key decisions (context for a fresh thread)
- **Store design (2026-07-26):** the unit on the store home is a **use, not an app**. Categories are
  **jobs, not shelves**. The catalogue is **21 destinations, not 27** (ideabrain's six `?template=`
  entries are one card with six doors). The telephone/switchboard framing is **positioning only —
  never rendered literally** as page furniture. Full brief + rejected passes:
  [`docs/STORE-REDESIGN.md`](docs/STORE-REDESIGN.md).
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
