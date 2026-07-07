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
- **1c.** Swap two libs: `lib/claude.ts` → the `window.claude` shim; `lib/server/workspace-store.ts`
  → `claude_storage`.
- **1d.** Serve as the store's brandbrain; run it in the airgapped runner.

### 2. `claude_storage` primitive (brandbrain persistence + stateful apps)
Per-origin local store + user-picked **project folder** (`bindFolder`). Replaces
`workspace-store.ts` (`.data/workspace.json`). Isolated per origin (an app can only touch its own
folder), writes gated by the site's mode. This is the "self-contained backend": local logic + a
local, user-owned folder. New BYOP method `claude_storage` (get/set/list/delete/bindFolder).

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
