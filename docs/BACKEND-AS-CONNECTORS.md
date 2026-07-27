# Doctrine: backend-as-connector, platform-as-broker

**Status:** design doctrine — supersedes the "new daemon methods" framing of [CAPABILITIES.md](./CAPABILITIES.md).
**Related:** [WEBMCP.md](./WEBMCP.md), the connector [packages/switchboard-mcp/](../packages/switchboard-mcp/), the gate [packages/sidekick/src/security/](../packages/sidekick/src/security/), [PORTING-AND-DEPLOY.md](./PORTING-AND-DEPLOY.md).

## The rule

**A wrapp is a frontend. Everything behind it is a connector. Switchboard brokers; it is not in the path.**

A wrapp that needs a "backend" — to charge money, persist to a real database, call an API with the
user's credentials, deploy something, run bespoke server logic — does **not** ship a server and does
**not** route through Switchboard. It reaches that capability the one way it reaches everything: a
`callTool` to an MCP **connector**, gated by the daemon's per-action consent and written to the audit
log. The wrapp stays static (HTML/JS/CSS on Pages, running on the visitor's own Claude). The backend
is a connector next to it.

This is not a new subsystem. It is the mechanism already shipping — the same path `claude_callTool`
takes for Gmail today, generalized to *all* backend needs.

## What this dissolves

[CAPABILITIES.md](./CAPABILITIES.md) proposed `sb_http` / `sb_db` / `sb_secrets` / `sb_exec` as **new
first-class daemon methods to build**. Under this doctrine, most of that evaporates:

| CAPABILITIES.md method | Becomes |
|---|---|
| `sb_http` (outbound API with creds) | the target API's **connector** (its MCP server) |
| `sb_db` (a real database) | a **DB connector** (Postgres/SQLite/Turso MCP) |
| `sb_secrets` (credential vault) | **gone** — each connector carries its own auth in the daemon's MCP config; the wrapp never sees a key |
| `sb_exec` (sandboxed compute) | a **sandbox connector**, or the one genuine edge case (see below) |

`claude_storage` stays as the built-in kv (it already ships); a richer store is just a DB connector.
So the "self-contained backend" the README promised is delivered by **wiring**, not by growing the
trusted core.

## The three flavors of connector

1. **Shared rails** — one audited connector everyone reuses: Gmail (drafting, wired), **payments/MoR**
   (see below), Pages-deploy (`deploy-wrapp.mjs`). Sensitive rails belong here — one reviewed Paddle
   connector, not a payment connector shipped by every wrapp.
2. **Third-party** — the vendor's own MCP (Shopify, Stripe, any API the daemon can broker).
3. **The wrapp's own** — a companion MCP the wrapp author ships for bespoke logic (e.g. an
   `autopilot-ops` connector for venture routing). The wrapp package = **static frontend + optional
   connector(s)**; installing the wrapp registers its connector.

## Payments = Merchant-of-Record via a connector (don't become a payments company)

Switchboard must **not** become the legal seller of record. **Paddle** and **Lemon Squeezy** already
*are* merchants of record as a service. So "we're the MoR" is delivered by a **Paddle/Lemon Squeezy
connector**: the user's Paddle account is the merchant; the connector brokers checkout, tax, and
payouts; Switchboard never touches money or takes on merchant liability. The Merchant-of-Record card
in the autopilot cockpit is this connector's UI, not a payments backend we run.

## The one honest trade: local vs. remote connectors

- **Local connector** (runs in/next to the daemon, stdio — like `switchboard-mcp` itself): nothing
  leaves the user's machine. The BYO / vendor-never-sees-your-data promise holds fully.
- **Remote connector** (the dev hosts an HTTP/SSE MCP): data flows to *that dev's* server to do its
  job. Still consent-gated, isolated per origin, and audited — but "the vendor never sees your data"
  becomes "*this wrapp's own backend* sees what you hand it."

This distinction must be **surfaced at grant time**, never hidden. It's the honest edge of the model,
not a hole in it — the gate still governs every call either way.

## The one thing that is NOT a connector

Everything a wrapp reaches **out** to is a connector. The thing that makes a wrapp **autonomous** —
the worker/scheduler that runs its loop *while you sleep* — is a daemon **runner** (see the autopilot
runner scaffold, `packages/sidekick/src/autopilot/runner.ts`). It **calls** the wrapp; it isn't called
by it. Outbound = connector; the loop that drives it = the runner. Keep that boundary clean.

## Already the pattern

- `packages/switchboard-mcp/` **is** a wrapp-backend-as-connector: a stdio MCP that runs wrapps
  headless on the user's Claude. `adpulse`, `autopilot__slate` et al. are backends exposed as tools.
- [WEBMCP.md](./WEBMCP.md) is the mirror half: a wrapp exposing its *own* actions as page-tools.

So this doctrine isn't a pivot — it's naming what the connector + WebMCP direction already is, and
retiring the "build new daemon capabilities" plan in favor of it.

## Why this is the *stronger* position

The platform never becomes a data processor, a host, or a payments entity. It stays the **thin trusted
wire** (broker) + the **trust layer** (consent, per-origin isolation, audit) + the **store**. "Not
everything runs through us" is the point: it's what keeps the privacy-led positioning true even for a
wrapp that takes money and runs a real business. The wire is the product; the backend is just more wire.

## What it means for autopilot

Autopilot stays **frontend-only**. Its backend = shared connectors (Paddle to charge, Gmail to reach,
Pages to deploy) + optionally its own `autopilot-ops` connector for bespoke routing + the daemon runner
for autonomy. It is not "the first wrapp with a backend" — it's the first wrapp that **wires several
connectors**, all through the `callTool` + per-action-consent path already proven with Gmail.
