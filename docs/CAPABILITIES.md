# Spec: modular backend capabilities

**Status:** draft / design — no implementation yet.
**Author:** design note from the brandbrain-port work.
**Related:** [PORTING-AND-DEPLOY.md](./PORTING-AND-DEPLOY.md), [ARCHITECTURE.md](../ARCHITECTURE.md),
the provider method table [`packages/protocol/src/rpc.ts`](../packages/protocol/src/rpc.ts), the broker
[`packages/sidekick/src/server.ts`](../packages/sidekick/src/server.ts), the store
[`packages/sidekick/src/storage/store.ts`](../packages/sidekick/src/storage/store.ts).

## Motivation

Today an app lends the visitor's **inference** (`claude_complete`), **storage** (`claude_storage`),
**tools** (`claude_callTool`), and **context** (`claude_context`) — all through one consented
provider. A ported app's "backend" (its route handlers) runs **in the tab**, with only those
primitives behind it. That covers a lot, but a real backend often needs more: a database, outbound
API calls with the user's own credentials, secrets, background jobs, sandboxed compute.

**The idea:** make the backend a *modular set of capabilities the Switchboard daemon provides* —
exactly the way it already provides `window.claude`. An app requests the capabilities it needs; each
is individually consented, per-origin isolated, and audited. The daemon stays the trusted core; the
app never provisions or pays for any of it. This extends the economic inversion from inference to the
whole backend, and makes the third pillar the README already names ("a backend, run locally") first-
class.

Crucially, **this is not a new subsystem** — it's more rows in a table that already exists. The
provider is a typed, versioned method bus (EIP-1193 style); storage and context prove non-model
capabilities already work this way.

## Naming (resolve first — it shapes the API)

Everything is `claude_*` / `window.claude` because the provider deliberately mirrors `window.ethereum`
— one recognizable global apps feature-detect. That made sense when the only asset was Claude. It's
now a misnomer: the bus carries storage, context, tools, local TTS — and, per this spec, a backend —
none of which are Claude. Recommendation:

- Introduce **`window.switchboard`** as the canonical provider; keep **`window.claude` as an alias**
  (back-compat, and it stays the natural handle for *inference* specifically).
- Namespace capabilities as sub-APIs over the same `request()` bus:
  `window.switchboard.model`, `.storage`, `.http`, `.db`, `.secrets`, `.exec`, `.context`.
- Method strings can stay `claude_*` on the wire for one more MINOR, then migrate to `sb_*` with
  aliases. Protocol is already versioned ([`version.ts`](../packages/protocol/src/version.ts)) — do it
  as additive bumps.

This spec uses `sb_*` for new methods and keeps existing `claude_*` names where they already ship.

## Model: what a "capability" is

Each capability is a self-contained module with five parts. Storage is the reference implementation of
all five — copy its shape.

1. **Method(s)** — typed entries in the `BYOPMethods` table (params → result). One `request()`
   entrypoint, shared signatures across SDK / extension bridge / daemon.
2. **Consent scope** — a field the app adds to its `ScopeRequest`, describing exactly what it wants
   (which hosts, which db, which secrets). Grantable, narrowable, revocable per origin.
3. **Consent posture** — which ops are reads (run within grant, no prompt), which are writes (gated),
   which *always* prompt (a human click the model can never satisfy). Folder-bind's path-consent is
   the template.
4. **Origin isolation** — every call carries the daemon's **authoritative origin** (the origin oracle;
   the page's claim is ignored). State is partitioned by origin *structurally*, like the store's
   `folderFor(origin)` — one origin's ops can never resolve into another's data.
5. **Audit events** — every call appends to `~/.relay/audit.log` with origin, method, decision.

### Capability registry (daemon)

Capabilities become **pluggable modules** behind a thin registry, so the trusted core stays a small
router + consent enforcer and adding a capability never touches it:

```ts
interface Capability {
  methods: string[];                              // wire methods it owns
  scopeKey: string;                               // its field in ScopeRequest, e.g. "http"
  describeScope(req): ConsentLine[];              // human-readable consent rows for the prompt
  posture(method, params): "read" | "write" | "prompt";
  handle(ctx: { origin, params, grant, consent }): Promise<result>;
}
```

The broker: verify origin → look up capability by method → check grant covers `scopeKey` → apply
posture (prompt if needed, fail-closed) → `handle` → audit. Exactly today's flow for `claude_storage`,
generalized.

## Where does app *code* run?

Two distinct meanings of "backend"; keep them separate because their security cost differs by orders
of magnitude.

- **Backend capabilities (primitives).** The daemon serves them. Safe: fixed, audited surface. This is
  the whole of this spec except `sb_exec`.
- **Backend code (the app's own logic).** Runs **in the tab** today (bundled route handlers). **Keep
  it there by default** — it keeps the daemon's trusted computing base small (primitives, not arbitrary
  third-party code). Only when an app genuinely needs server-only / long-running / native execution do
  you reach for `sb_exec`, which runs it in the airgapped sandbox as an explicit, prompted grant.

For most "needs a backend" apps, **in-tab logic + `sb_db` + `sb_http` + storage covers it** without
ever running app code in the daemon. That's the 80/20 and the recommended default.

## Consent scope extension

`ScopeRequest` gains optional per-capability fields; the connect prompt renders a row per capability.
Example manifest (`switchboard.json`) for an app that needs a DB and to call two APIs with the user's
creds:

```json
{
  "reason": "…",
  "models": ["sonnet", "claude-haiku-4-5"],
  "tools": ["WebSearch"],
  "storage": { "defaultFolder": "~/…/.data" },
  "http":    { "hosts": ["api.shopify.com", "api.klaviyo.com"] },
  "db":      { "name": "app" },
  "secrets": ["shopify_token"]
}
```

Each field is independently granted and revocable in the panel. **Narrowing holds**: the daemon may
grant a subset (fewer hosts), and the app must handle a partial grant.

> Grant enforcement is **exact-match** and unforgiving by design (see `allowsModel` /
> `assertCompletionAllowed`). A capability that isn't in the grant is denied, full stop — so the
> manifest must declare exactly what the app uses. (This is the class of bug that made brandbrain's
> haiku calls fail: the app used `claude-haiku-4-5` but the manifest declared only `sonnet`.) The same
> discipline applies to every new capability's scope.

## First capabilities to build (designed)

### A. `sb_http` — outbound proxy with credential injection (highest leverage)

The strongest expression of the whole thesis. The app asks to call an API; the **daemon** injects the
user's own connected credential and returns only the response. The token never touches the page.

```ts
sb_http: {
  params: { method: string; url: string; headers?: Record<string,string>; body?: string;
            useCredential?: string /* a secret/connection name the daemon injects */ };
  result: { status: number; headers: Record<string,string>; body: string };
}
```

- **Scope:** `http: { hosts: string[] }` — an allowlist. A request to a host not granted is denied;
  first request to a *newly needed* host prompts.
- **Posture:** GET/HEAD to a granted host = read (no prompt). Mutating methods = write. `useCredential`
  always requires the secret to be in `secrets` scope.
- **Credential injection:** the app passes `useCredential: "shopify_token"`; the daemon looks it up in
  the vault and sets the auth header **server-side**. The page sees the response, never the token.
- **Isolation / safety:** no `file://`, no loopback, no cloud metadata IPs; per-origin rate/byte
  budgets; response size cap. This is "capability inheritance" + "data locality" extended to any API.
- **Adapter shim:** map `fetch`/axios in ported route handlers → `sb_http`, so app code is unchanged.

### B. `sb_db` — per-origin embedded database

A real relational backend the daemon hosts, zero provisioning.

```ts
sb_db: {
  params: { sql: string; args?: unknown[] } | { batch: Array<{ sql: string; args?: unknown[] }> };
  result: { rows: unknown[]; rowsAffected: number };
}
```

- **Backing:** one SQLite file per (origin, db name) under `<stateDir>/db/<origin-slug>/<name>.sqlite`,
  the exact isolation pattern as `store.ts`'s `folderFor`. An origin can only ever touch its own db.
- **Scope:** `db: { name }`. **Posture:** SELECT = read; INSERT/UPDATE/DELETE/DDL = write (gated by
  mode; `readonly` mode blocks writes just like storage). Statements are parameterized only — no string
  interpolation across the boundary.
- **Bind, like storage:** allow pointing a db at an existing file the user picks (path-consent), so an
  app can adopt real data with no migration — the same move as folder-bind.
- **Adapter shim:** a Prisma/Drizzle/`better-sqlite3` adapter → `sb_db`.

### C. `sb_secrets` — scoped credential reads

The daemon already *is* the credential holder. Expose named, click-gated access; mostly consumed
indirectly via `sb_http`'s `useCredential` (so raw secret material need never reach the page at all).

```ts
sb_secrets: { params: { name: string }; result: { value: string } }  // prompt on every raw read
```

### Deferred

- **`sb_exec`** — sandboxed compute (the airgapped runner): run server-only/long code with no ambient
  net/fs unless granted, resource-limited, prompted. The one real security jump — ship last, opt-in.
- **`sb_jobs`** (cron/background), **`sb_queue`** / events, **`sb_vector`** (embeddings + search for
  RAG backends). All follow the same capability shape.

## Security invariants (must hold for every capability)

Non-negotiable — these are the moat:

- **Origin oracle.** Every call's origin is the browser-verified sender, stamped by the extension,
  never the page's claim. New capabilities inherit per-origin isolation for free.
- **Human-click consent.** Each capability defines what *always* prompts; the model/page can never
  satisfy a prompt — only a click. Fail-closed on timeout or worker eviction.
- **Data locality.** Secrets and credentials never reach the page. `sb_http`/`sb_secrets` are designed
  so raw material stays daemon-side; the app gets results, not keys.
- **Structural isolation.** Partition state by origin at the path/handle level (like `folderFor`), not
  by a runtime check that could be bypassed. Shared/cross-origin access goes through the existing
  context-vault consent (lend one origin's data to another, per session).
- **Exact-match grants + narrowing.** No implicit widening; apps handle partial grants.
- **Small TCB.** Capabilities are modules behind a registry; the core router + consent enforcer never
  grows when you add one. `sb_exec` is the only capability that runs untrusted code, and only sandboxed.

## DX: porting an app that needs a backend

Porting becomes "map the app's backend deps to capabilities" — the same seam-swap the brandbrain port
already does for model/storage/fs:

| App backend dep | Capability | Adapter shim |
|---|---|---|
| `lib/claude` (model) | `claude_complete` | `adapter/claude.mjs` (exists) |
| `.data/*.json` / KV | `claude_storage` | `adapter/claude_storage.mjs` (exists) |
| Prisma / SQLite | `sb_db` | new db adapter |
| `fetch` / axios to a partner API | `sb_http` | new fetch adapter (inject `useCredential`) |
| `process.env.SECRET` | `sb_secrets` | new secrets adapter |
| `child_process` / heavy compute | `sb_exec` (sandbox) | new exec adapter |

The route handlers don't change; only what their server-only imports resolve to. Update
`PORTING-AND-DEPLOY.md`'s seam table as each capability lands.

## Rollout

1. Land the naming: `window.switchboard` + `claude` alias; capability sub-API facade over `request()`.
2. Capability registry + move `claude_storage`/`claude_context` behind it (refactor, no behavior
   change) — proves the interface.
3. `sb_db` (self-contained, low risk).
4. `sb_secrets` then `sb_http` with credential injection (the high-leverage pair).
5. `sb_exec` last, gated on the airgapped runner.

Each step is an additive protocol MINOR bump + a new adapter shim + a `PORTING-AND-DEPLOY.md` update.

## Open questions

- **Naming migration timeline** — how long to keep `claude_*` wire methods aliased.
- **Cross-origin sharing** — do `sb_db`/`sb_queue` get first-class cross-origin grants, or stay strictly
  per-origin and route sharing through `claude_context`?
- **Budgets** — per-capability rate/byte/row budgets in the grant, surfaced in the panel.
- **Offline posture** — per-capability behavior when the daemon is down (fail-closed vs. degraded), and
  how the app detects it via `claude_capabilities`.
