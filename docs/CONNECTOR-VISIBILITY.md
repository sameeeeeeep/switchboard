# Spec — Connector-driven wrapp runs must be visible in the browser

**Status:** proposed (2026-07-28). Carried forward from the landing-redesign session, where we dogfooded
the Redline wrapp via the Switchboard MCP connector and noticed the gap.

## Problem

A wrapp has two doors to the same brain:

1. **Browser door** — the user opens the wrapp (e.g. `redline.thelastprompt.ai`), its UI renders, it calls
   `window.claude` → daemon → the user's Claude. Fully visible.
2. **Connector door** — an agent (Claude Code) calls a `mcp__switchboard__wrapp__<id>__<action>` tool. The
   daemon runs the wrapp's **headless action** (`run(input, sb)`) directly on the user's Claude and returns
   JSON to the agent. Response carries `"mode": "daemon"`. **No tab is opened; nothing surfaces to the user.**

Verified: `packages/sidekick/src/mcp/` has no `openTab`, no panel notification, and no activity emit for
connector-driven runs. So an agent can run any *authorized* wrapp on the user's Claude and the user gets
**zero visibility** unless they read the agent transcript.

This is a **trust** problem, not just UX. The product's core promise is "consent is the interface." Today:
Redline (or any wrapp) is authorized **once** with a human Connect, and after that the connector can invoke
it silently, forever, with no window into it. The headless door needs a window.

## Goals

1. Every connector-driven wrapp run **surfaces in the side panel** as an activity line, within ~1s.
2. The user can **click the line to open the wrapp** with that run's input + result loaded — the same output
   they'd have seen through the browser door.
3. No regression: agents still get their JSON headlessly; the connector stays fast.

## Design

### 1. Activity event (daemon)
Where the daemon executes a connector action (the `run(input, sb)` seam / `packages/sidekick/src/mcp/`),
emit an activity record on completion (and optionally on start):
```
{ id, wrapp, action, origin, driver: "connector", model, startedAt, ms, ok,
  summary,            // one line, e.g. "5 findings · 4 lockable"
  resultRef }         // key into a short-lived daemon-side result cache (for open-in-wrapp)
```
Persist the last N (e.g. 50) in memory; optional on-disk ring for history.

### 2. Panel surfacing (extension)
`packages/extension/src/sidepanel.ts` already has the "line of life" activity grammar and a health/refresh
channel (see [[relay-connect-chip]]). Add an activity feed line:

> ● **Claude Code ran** `redline · audit` — 5 findings · just now →

- Driver label ("Claude Code" / "an agent" / connector name), wrapp · action, one-line summary, relative time.
- Keep it to the panel's single-line-of-life idiom (see [[relay-design-system]]) — a feed, not a wall; collapse
  bursts (agent loops fire many calls) into "ran redline ×6".

### 3. Open-in-wrapp
Clicking the line opens the wrapp's origin with the run loaded. Reuse the existing deep-link handoff the store
entries use (`?run=<resultRef>` + `sessionStorage["sb:run"]`, mirrors the `?studio=…` / `sb:idea` pattern in
[[relay-public-launch]]). The wrapp reads the ref on load and renders that result in its real UI.

### 4. Consent posture (decide before build)
- **Reads** (e.g. `audit`) — a **post-hoc visible record** in the panel is enough.
- **Writes** (`respond` that edits a file, any gated write) — should at minimum be recorded, and probably
  **toast-approve when the panel is closed** (reuse [[relay-panel-surfaces]]). The one-time Connect authorizes
  the wrapp; per-run visibility (and per-write approval) is the trust layer. This is the real crux — align it
  with the security model ([[relay-security-model]]) before shipping.

## Plumbing map
- Daemon action runner + emit: `packages/sidekick/src/mcp/` (registry.ts is "the ONLY place tools execute" —
  the natural emit point) + the wrapp actions layer `run(input, sb)`.
- Panel feed + open-in-wrapp: `packages/extension/src/sidepanel.ts` (subscribe to activity; render line; deep-link).
- Result cache for handoff: daemon-side, keyed by `resultRef`, short TTL.

## Open questions
- Result-cache storage + TTL (memory vs disk); size caps for large results.
- Should the activity log persist across daemon restarts (history view) or just show recent?
- Privacy/noise: agent loops can fire many calls — dedupe/summarize, and decide what the summary line may reveal.
- Does WebMCP ([[relay-WebMCP-spec]] / `docs/WEBMCP.md`) share this surfacing path? It should — same "an agent
  drove my wrapp" event.

## Acceptance
- Run a connector wrapp action → the panel shows an activity line within ~1s with driver + wrapp + action + summary.
- Click it → the wrapp opens with that result rendered in its UI.
- A gated **write** driven by the connector is at least recorded, and (decision pending) toast-approved when the
  panel is closed.
- Headless connector behavior for agents is unchanged (still returns JSON, still fast).
