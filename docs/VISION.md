# Switchboard — Vision Spec

*"MetaMask, but for AI." A local sidekick daemon holds the visitor's Claude and their MCP tools; a browser extension injects `window.claude` into every page; any website runs on the visitor's own model, tools, context, and data — the operator holds no API key and pays no inference bill. Every sensitive action is brokered through explicit, scoped, per-origin consent.*

---

## Executive summary

Switchboard is a consent broker, and the consent broker is the product — the plumbing (a provider-swapped `window.claude`, a client fetch-router, MCP tools) is commodity by design. What makes it more than a clever provider-swap is what the broker lets a user *own and lend*: a **typed context graph** (the Vault) of `brand`, `task`, `person`, `event`, `decision`, `note`, `asset` objects, and a marketplace of **wrapps** that are each just a *lens* onto it — some producing objects, some consuming them, most both. A user lends exactly three things under scoped, revocable, per-origin consent: **inference** (their Claude), **context** (a slice of the Vault), and **backend** (in-tab route handlers plus daemon-provided capabilities). Because Switchboard absorbs the integration tax — shared inference, shared user-owned data, shared identity, one Pro subscription — that normally forces software to bundle, unbundling a monolith into cheap mini-wrapps becomes economically viable, and a cross-domain graph that lives on the user's side (portable, lent, never held) becomes the moat. This spec defines that product model, then makes it buildable: an **information architecture** that falls out of one hard boundary (what a page may render vs. what only the trusted extension may), precise **layout specs** for every surface, the **user flows** that thread them, a **capability roadmap** that front-loads the Vault evolution ahead of the backend primitives, and an **app pipeline** — a formal portability test, five porting tiers, a split-our-own-monolith strategy, and a supply-first backlog — that seeds the graph before it drains it. It closes with a **first-90-days** build sequence that ties the two together.

Three invariants govern everything and never regress: **the chip is a door, never a control panel** (identity only; all management lives in the side panel); **apps can never enumerate the Vault** (only the trusted control channel can; a scoped read returns only the granted subset); and **only a human click resolves consent** (fail-closed, on a surface the page cannot reach, origin stamped by the daemon and never read from the page).

---

## 1. Vision & product model

### 1.1 The thesis

A local sidekick **daemon** holds the visitor's Claude (via the Claude Code CLI) and their connected MCP tools. A browser **extension** injects `window.claude` — an EIP-1193-style provider — into every page. Any website then runs on the *visitor's* model, tools, context, and data; the operator ships an interface but holds no API key and funds no token bill. Everything sensitive is brokered through explicit, scoped, per-origin **consent**. **The consent broker is the product; the plumbing is commodity.**

That is the mechanism. The *product model* — the thing that makes this more than a provider-swap — is what the broker lets a user own and lend: a **typed context graph** (the Vault), and a marketplace of **wrapps** that are each a lens onto it. This section defines those primitives, the economic argument for why they change what a software product can be, and where the defensibility lives.

### 1.2 What the user owns: a typed context graph (the Vault)

Today Switchboard's context primitive is deliberately thin. A `Context` is `{ id, name, kind?, data, source?, publishedBy?, updatedAt }` where `data` is opaque and `kind` is a free-form string tag ("brand") that apps "agree on by convention, not lock" (`packages/protocol/src/context.ts`). Consumption is strictly **one-active-context-per-app**: an app reads exactly the single context the user selected for that origin, out of band, in the side panel. Selection *is* consent. Apps can never enumerate the library — `list` returns only the caller's own published contexts. This boundary is load-bearing.

The product model's central bet is that this single opaque blob is the seed of something much larger: **a user-owned, typed graph of context that every wrapp reads from and writes to.** Not a pile of documents — a graph of *typed objects*:

- **Kinds** — a small, shared, extensible union: `brand`, `task`, `person`, `event`, `decision`, `note`, `asset` (and app-defined tags beyond that via `string & {}`). The union is not decoration; it is the axis consent keys on. "This app wants to read your **task** and **person** context" is only a sentence you can put in a consent prompt if `kind` is a first-class typed thing.
- **Objects** — instances of a kind, owned by the user, portable across every wrapp. One `task`. One `person`. One `brand` one-pager.
- **Edges** — the relationships the graph implies: this `task` belongs to that `brand`; this `event` involves that `person`; this `decision` locked that `brand.positioning`. (Cast's calendar `event`s and production-queue `task`s already reference the locked persona they were generated from — the edges exist in the data today, before the schema names them.)
- **Provenance** — every object carries `source` and `publishedBy`. A `brand` teardown carries `source.kind: "url"` and the id of the extractor that produced it, so a downstream consumer knows the *schema* of the opaque `data`, not just that it exists.

**Why "typed graph" and not "documents" or "memory."** A memory store is a bag of text retrieved by similarity; it has no consent surface finer than "all or nothing," and no consumer can ask for *"my tasks"* as distinct from *"my brand."* A typed graph gives you the exact seam the consent broker needs: a scoped, revocable, audited read of *one slice* — `context.query({ kinds: ["task", "person"] })` — that returns only the objects the user consented to lend to this origin, and still never enumerates the whole library. The type system is what makes partial, honest consent *expressible*. Everything downstream — cross-domain wrapps, the extractor supply side, the moat — depends on context being *typed*, not merely *stored*.

**The evolution is additive, not a rewrite.** `active`/`pick` (the single-blob lens, ideal for "which brand am I working on") stay exactly as they are. `query` is the new, kind-scoped read layered beside them, gated by a new `ContextGrant` recorded on the origin's grant (`OriginGrant.context?`) so multi-context consent becomes revocable in the panel like any tool grant — not a second out-of-band pointer. The invariant survives untouched: `query` enumerates only the granted `kinds`/`ids` subset, never the library. (This typed multi-context read is committed future work, not shipped today — see §5 — but the product model is designed around it because it is what unblocks everything cross-domain.)

### 1.3 Wrapps are lenses: producers, consumers, and the fact that most are both

A **wrapp** is a static HTML/JS bundle whose API routes compile into the browser tab; its only escape hatches are `window.claude` (→ daemon → Claude Code CLI) and a bound local folder; its tools come from the user's own MCP servers. That is the *runtime* definition. The *product* definition is sharper:

> **Every wrapp is a lens on the Vault.** It either fills the graph (a producer / extractor), reads a slice of it (a consumer / utilizer), or — most often — both.

This is not a taxonomy imposed after the fact; it is already the shape of the apps in the repo:

| Wrapp | Produces (fills the graph) | Consumes (reads a slice) |
|---|---|---|
| **Cast / persona** | `persona`/`brand` (locked foundation), `event` (calendar), `task` (production queue), `asset` | `brand` grounding, web-search results |
| **brandbrain** | `brand` (finalised one-pager), `decision`, `competitor`/`person`, `note` | `brand` workspace, Shopify data via MCP |
| **imagegen / Prism** | `asset` (on-brand images) | **`brand`** — explicit `claude_context` consumer |
| **adgen** | `asset`, transient `brand` teardown | *should* consume a locked `brand` instead of re-extracting |
| **assistant** | `task` (actions taken) | the user's MCP tools; natural home for `task`/`person`/`event` multi-read |
| **chat** | — | optionally any context as system preamble |

The reuse this implies is the whole point. **One `task` object is a to-do in an Executive-Assistant wrapp, a runbook item in brandbrain OS, and an NPC quest in a "life is a game" pixel RPG — the same object, three surfaces.** A wrapp is not a silo that happens to store some data; it is a *view* over shared, user-owned objects. The RPG never re-enters your tasks; it renders the tasks the graph already holds, under a scoped read grant, and writes progress back to *its own* named slice on those objects — never over another producer's slice (§4.7 defines the single-writer rule that makes "writes back" safe).

Two facts the repo makes concrete, both of which the product model treats as *symptoms of the graph not existing yet*, not as acceptable behavior:

1. **adgen and imagegen re-extract brand data the graph should serve.** adgen takes a URL and re-derives the brand every run; imagegen/Prism reads a single active `brand` via `context.active`/`pick`. In the product model, re-extraction is waste: a `brand` object already exists, produced once by brandbrain or an import-from-URL extractor, and the right move is `context.query({ kinds: ["brand"] })`, not a fresh teardown. Re-extraction is the tell that the consumer half of the graph is still stubbed.
2. **Cast produces `event`/`task` no consumer can yet read cross-domain.** The producer side already emits exactly the objects the EA and the RPG want. Nothing consumes them across domains today — that is blocked purely on typed multi-context consent, which is why that primitive is the pivotal unlock and not a nice-to-have.

### 1.4 The three things a user lends

Under scoped, per-origin, revocable consent, the user lends exactly three assets. A wrapp's identity in the store is, precisely, *which of these three it asks for* — and that declaration is what turns "install" from opening an HTML file into granting a bounded capability.

1. **Inference** — their Claude. `claude_complete` / `claude_stream` / `claude_session`, scoped to specific models. The grant check is exact-match-plus-narrowing, but the daemon **canonicalizes known alias↔full-id pairs first** (`canonicalModel` / `MODEL_ALIASES` in `packages/sidekick/src/security/grant-store.ts` folds `claude-haiku-4-5 → haiku`, `claude-sonnet-5 → sonnet`, `claude-opus-4-8 → opus`), so a grant of `haiku` and a request for `claude-haiku-4-5` are treated as the *same* model — an alias spelling mismatch does **not** cause a phantom denial. The real failure mode is requesting a **different model family** than granted: a manifest scoped to `sonnet` while the app calls `claude-haiku-4-5` is denied because those are different models, not because of alias strictness. The lesson for a wrapp is *handle partial grants* (the user may narrow you to fewer models than you asked for), not *spell out exact full IDs to dodge phantom denials*. The operator ships the interface; the visitor brings the intelligence and pays the inference bill on their own plan.
2. **Context** — a slice of the Vault. Today: the one active context per origin (`active`/`pick`). Tomorrow: a typed, kind-scoped read (`query`) recorded as a revocable `ContextGrant`. This is the asset that is *portable and user-owned* — it follows the user across every wrapp, and no operator holds a copy.
3. **Backend** — the app's own route handlers, compiled into the tab and run locally by the client fetch-router, **plus** capabilities the daemon provides: per-origin `storage` today; `sb_db` / `sb_http` / `sb_secrets` / `sb_exec` on the roadmap (`docs/CAPABILITIES.md`). Credentials never cross to the page; results only. The backend a wrapp "has" is either pure computation (in-tab or WASM), an LLM call (which *is* `window.claude`), or a daemon capability under its own scope — never a server the operator runs.

The consent broker's job is to make each of these three grants explicit, narrowable, audited, and revocable, per origin, with a human click the model can never satisfy. That is the product. Everything else is a lens.

### 1.5 The core argument: BYO-inference + portable context absorb the integration tax, which is *why* unbundling works

This is the load-bearing economic claim of the whole product, so state it plainly.

**Software bundles because integration is expensive.** The reason a "brand studio" ships as one monolith with market research *and* naming *and* voice *and* pricing *and* a store builder *and* ad generation is not that users want a monolith. It is that splitting those into seven separate products would force each to independently pay the **integration tax**: stand up its own database, its own auth, its own billing relationship, its own copy of the user's data, its own inference contract. Seven products means seven sign-ups, seven data silos that don't share your brand, seven subscriptions, and seven API keys the operator has to fund. The integration tax is a *bundling pressure*: it is cheaper to build one big thing that shares one DB and one login than seven small things that each rebuild that substrate. Users tolerate monoliths because the unbundled alternative is even more painful to assemble.

**Switchboard's architecture pays that tax once, centrally, on the user's side.** Look at what the three lent assets remove:

- **Inference is BYO.** No wrapp signs an inference contract, holds an API key, or funds a token bill. The visitor's Claude is shared substrate every wrapp inherits for free.
- **Data/auth/context are user-owned and portable.** There is no per-app database of the user's brand, no per-app login, no per-app copy of their tasks. The Vault *is* the shared database, the shared identity ("Sign in with Switchboard"), and the shared context — and it lives on the user's side, lent per origin. Seven wrapps read the *same* `brand` object; each writes only its own named slice of it (§4.7), so there is nothing to sync because there was never a second copy.
- **Billing is one relationship.** The user has one Switchboard Pro subscription (the Spotify-model rev-share: a flat Pro sub, ~75% distributed to developers by usage, *not* per-use metering). A wrapp does not stand up Stripe; it earns its share of a pool the user already pays into. That removes the last per-app integration — commerce — from the wrapp's shoulders.

So the pressure that forced bundling **evaporates**. When shared DB, shared auth, shared context, shared inference, and shared billing are all provided by the substrate under consent, a seven-way split stops being seven times the integration work — it becomes seven lenses on one graph, each of which the user already has an account for, already has data for, and already pays for through one sub. **Unbundling into wrapps is viable precisely because Switchboard absorbs the integration tax that normally makes unbundling uneconomic.** The Vault is what makes a mini-wrapp cheap to ship *and* cheap to adopt: cheap to ship because it inherits the substrate; cheap to adopt because it plugs into context the user already owns.

This is the direct justification for the cold-start strategy in §6 — porting frontend-only OSS and splitting brandbrain into mini-wrapps (market canvas, naming, voice/identity, vendor book, pricing, store builder, adgen, investor deck). A user can enter through **Naming** alone, produce one `brand.name` slice, and later "graduate" the *same* `brand` object into the full brandbrain OS. The split is non-lossy because the shared typed object persists between the small entry point and the large retention product, and it is safe because each mini-wrapp owns exactly one named slice (§6.3) — Naming writes `brand.name`, Voice writes `brand.voice`, and neither can clobber the other. Without the Vault, that split would be seven disconnected apps; with it, it's one graph seen through seven lenses.

### 1.6 The moat: extractors are the supply side, and a cross-domain graph compounds

If context portability is the product, then the graph's *contents* are the defensibility — and the way you win is a marketplace cold-start, seeded from the supply side.

**Extractors are the supply side.** A wrapp that *fills* the graph is worth more, strategically, than one that only reads it, because the graph is empty on day one and a consumer of an empty graph is inert. The producers are the flywheel:

- **Import-from-URL** — a read-only brand/site teardown. The daemon (or a designated extractor wrapp) fetches a page, an LLM call produces a typed `Context` (`kind: "brand"`, `source.kind: "url"`, `extractor` id stamped), and it is published as a user-owned object. This is the cheapest way to take a user *who already has a web presence* from an empty Vault to a populated one, and it generalizes the CSV/gsheet source primitive that already exists. It is **not** universally zero-prerequisite: a pre-launch founder has no site to tear down, so their zero-prerequisite entry is the manual/Market-Canvas producer below (see §6.4).
- **An Executive-Assistant extractor** — Gmail/Calendar (via the user's own MCP) → `task` / `person` / `event` objects. This is the supply that makes the EA, the RPG, the scheduling wrapp, and every future cross-domain consumer *have something to read*. Its one honest precondition: the user must have connected a Gmail/Calendar MCP server first (Connections ▸ Manage MCP servers, §2.4.3), so the EA is a *second-step* producer, not a blank-account first touch.
- **The brandbrain mini-wrapps** — each is a cheap extractor seeding one `brand` slice (market, name, voice, vendor, pricing). Splitting the monolith isn't only a distribution move; it multiplies the number of producers feeding the graph. **Market Canvas doubles as the truly-zero-prerequisite first producer** — it needs only a typed brief, so a pre-launch founder with no site and no connected MCP can still mint a first `brand.market` slice on a blank account.

**Seed supply first, exactly like a marketplace.** The cold-start is not "ship consumers and hope the graph fills." It is: ship the extractors that populate the graph read-only and for free, so that by the time a consumer wrapp arrives, the user's Vault already has a `brand`, a roster of `person`s, a week of `event`s, a backlog of `task`s worth rendering. Consumers are the demand side; they light up only once supply exists. That ordering is the strategy, and §6.6 sequences the backlog on it.

**Why the graph is defensible — it compounds and it is cross-domain.** A single wrapp is commodity: the plumbing is commodity by design, and a competitor can clone any one interface. What a competitor *cannot* clone is a user's accumulated, typed, cross-domain graph — every `brand` they've torn down, every `decision` they've locked, every `person` and `task` and `event` an extractor has filed over months of use. Each new producer wrapp deepens that graph; each new consumer wrapp raises its value; and crucially the value is **cross-domain** — the same `task` is more useful because it is simultaneously legible to the EA, brandbrain, and the RPG. A graph that spans domains is worth more than the sum of per-domain silos, and it gets more valuable with every wrapp the user touches. That compounding, user-owned, cross-domain graph — not any individual lens — is the moat. The consent broker is what makes it *safe* to accumulate; the typed graph is what makes it *worth* accumulating; and the fact that it lives on the user's side, portable and lent rather than held, is what makes it *impossible for any single operator to take hostage*.

---

## 2. Information architecture & navigation

> **The one rule that decides everything below:** consent can only be satisfied by a human click on a surface the page cannot reach, and *the Vault can only be enumerated by the trusted control channel* — never by an app. So the IA is not a matter of taste. It falls out of a hard boundary: **what a page can render vs. what only the extension can render.** Anything that grants, reveals, or scopes lives extension-side. Everything a page shows is either its own UI or a *door* to the extension. Get that split wrong and you have re-drawn the security model in CSS.

This section maps the entire Switchboard surface, assigns every function to exactly one home, and specifies the transitions between homes. It supersedes the two divergent surfaces that exist today (the designed side panel and the undesigned legacy `popup.ts`) and the two unreconciled store pages (`examples/apps/index.html` and `store.html`).

### 2.1 The trust boundary is the information architecture

There are exactly two rendering contexts, and they have different trust:

| Context | Who controls the pixels | What it may do | Where it lives |
|---|---|---|---|
| **The page** (a wrapp, or any site) | The site's own untrusted code | Show its own app UI; mount the standard chip; *call* `window.claude` and receive results | The browser tab |
| **The extension** (chip shadow-root, side panel, consent view) | Switchboard, un-restylable by the page | Grant/deny scope, reveal the Vault, scope context, hold the kill switch, show the audit ledger | Extension chrome |

Every placement decision reduces to a single question: **does this function reveal something the user owns, or authorize something on the user's behalf?** If yes, it is extension-only, full stop — because the origin oracle (`RequestEnvelope.origin`, stamped by the background worker from `port.sender`) and the fail-closed human-click gate only exist there. If no, it may live in the page.

Three consequences, each already load-bearing in the codebase and non-negotiable going forward:

1. **The chip is a door, not a control panel.** `mountConnect` carries *identity only* — "Hi {name} · {project}" and an inline project switcher via `context.pick()`. It renders in a shadow root precisely so the host page cannot restyle it into something that *looks* like it grants more than it does. No app-side folder picker, connector list, budget field, trust toggle, or revoke button — those would be a page drawing the trusted surface. Enforced by the two most recent commits; must never regress.
2. **Apps never enumerate the Vault.** `context.list` returns only the caller's *own* published contexts; the cross-app read is `context.active` — the single object the user selected *out of band, in the panel*. The Vault browser (§2.5) is therefore panel-only. When typed multi-context (`context.query({kinds})`) lands, the *grant* is authored in the panel and the query returns only the granted subset — the enumeration boundary is preserved (§2.6.4).
3. **The side panel is a consumer home, not a logs dashboard.** It answers "what do I own and who is using it," with the technical exhaust (token meters, raw tool names, trust mode, the audit feed) folded behind expanders. New IA *extends* that stance; it does not revert the panel into an admin console.

```
                    ┌──────────────────────────────────────────────┐
   THE PAGE         │            THE EXTENSION (trusted)            │
  (untrusted)       │                                              │
 ┌────────────┐     │   ┌─────────────┐      ┌──────────────────┐  │
 │  wrapp UI  │     │   │ Side panel  │◀────▶│  Consent view    │  │
 │            │     │   │ (control    │ push │  (5 kinds, ONLY  │  │
 │ ┌────────┐ │     │   │  center)    │      │   in the panel)  │  │
 │ │  chip  │─┼─────┼──▶│             │      └──────────────────┘  │
 │ └────────┘ │ door│   │ Home ─ Vault│              ▲             │
 │            │     │   │ Wrapps ─    │              │ human click │
 │ window.    │     │   │ Connections │      ═══════════════════   │
 │ claude ────┼─────┼──▶│ Activity ─  │      only a click resolves │
 └────────────┘ rpc │   │ Account     │      (fail-closed on evict)│
                    │   └─────────────┘                            │
                    └──────────────────────────────────────────────┘
```

### 2.2 The complete nav tree

The canonical map. Indentation is containment; `→` marks a transition that changes surface. `[panel]`, `[page]`, `[chip]`, `[consent]` tag the rendering context.

```
Switchboard
│
├─ CONNECT CHIP  [chip · in every wrapp header, shadow-root]
│   ├─ state: not-installed   → "Get Switchboard"      → install page [page]
│   ├─ state: disconnected    → "Connect Switchboard"  → consent:connect [consent]
│   └─ state: connected       → "Hi {name} · {project}" pill
│       ├─ project switcher (inline)   → context.pick()  [consent:context-pick]
│       └─ "Manage in Switchboard"     → opens SIDE PANEL → Home [panel]
│   (no "offline" chip state today — see §2.3 and §3.3 on the fail-open gap)
│
├─ SIDE PANEL  [panel · the control center — ONE scrolling column today]
│   │
│   ├─ HEADER (persistent)
│   │   ├─ brand mark + status pill  (on / sidekick offline / not paired)
│   │   ├─ today's spend  (compact total across all apps)   ← NEW, was absent
│   │   └─ ⋯ menu
│   │       ├─ Set your name
│   │       ├─ Export activity (JSON)      ← migrated from legacy popup
│   │       └─ Disconnect everything  (global kill switch)
│   │
│   ├─ 1 · HOME / TODAY                       [top of the scroll]
│   │   ├─ This tab            (classify active origin; suggest alternativeTo wrapps)
│   │   ├─ Working on          (the one active project + Switch → picker sheet)
│   │   ├─ Needs you           (pending consents, budget warnings, expiring grants)
│   │   └─ Scheduled           (recurring wrapp tasks — next run / pause)   ← NEW, gated on daemon cron
│   │
│   ├─ 2 · VAULT                              [the typed context graph browser]
│   │   ├─ filter by kind      (brand · task · person · event · decision · note · asset)
│   │   ├─ object list         (name, kind glyph, source badge, updated — NO swatches)
│   │   ├─ object detail       → producers (who wrote it) · consumers (who may read it)
│   │   │                        · lineage (source URL/sheet) · per-object revoke
│   │   ├─ "Who can read this" → per-object context-grant management
│   │   └─ + Import            → context:import (URL teardown / Sheet)  [consent: egress-guarded]
│   │
│   ├─ 3 · WRAPPS                             [installed + store, one surface]
│   │   ├─ Installed           (granted origins as cards; launch / manage / disconnect)
│   │   ├─ Store               (registry-driven grid; category · capability · tier filters)
│   │   │   ├─ search          (over the manifest — real, not a no-op)
│   │   │   └─ wrapp detail    → declared lends → Install = scoped grant [consent:connect]
│   │   └─ Paste any URL       (run an un-listed wrapp)
│   │
│   ├─ 4 · CONNECTIONS                        [tools & MCP servers the Vault lends]
│   │   ├─ Connector tiles     (Higgsfield / Shopify / Gmail … — friendly, from tool names)
│   │   ├─ connector detail    → underlying raw tools · which apps use it · health
│   │   └─ Manage MCP servers  → add / authorize / remove a server   ← NEW drill-down
│   │
│   └─ 5 · ACTIVITY                           [the accountability ledger]
│       ├─ filter (by app · by kind · by outcome · by time)
│       ├─ timeline (origin · tool/method · decision · outcome, colored)
│       └─ per-entry → jump to the app card / the Vault object it touched
│
├─ APP CARD  (expandable, lives in Wrapps ▸ Installed)   [panel]
│   ├─ collapsed: name · activity dot (active now / idle / last-seen)
│   └─ expanded:
│       ├─ Can use            (connector pills, read/write — badges DAEMON-derived, not manifest)
│       ├─ Context access     (granted kinds / objects)   ← NEW, mirrors ContextGrant
│       ├─ Storage            (bound folder · record count · rebind · revoke)   ← NEW mgmt
│       ├─ Compute today      (per-app token meter)
│       ├─ Mode               (Ask / Trust / Read-only segment)
│       ├─ Re-scope           (widen → re-raises consent; narrow → no prompt)   ← NEW re-consent
│       ├─ inline pending consent  (approve / deny)
│       └─ Disconnect
│
└─ CONSENT  [consent · the ONE surface — always inline in the panel; never a window]
    ├─ consent:connect        (models · tools w/ read|write badges · budgets · All/none)
    ├─ consent:write          (per-action approve-once · args JSON · "may send/change/spend")
    ├─ consent:storage-bind   (one-time folder path consent, exact path shown)
    ├─ consent:context-pick   (radio-select the ONE brand to lend — single-context today)
    └─ consent:context-query  (checkbox the KINDS/objects to lend)   ← NEW, typed multi-context
```

Everything below justifies why each function sits where it does.

### 2.3 The connect chip — identity, and a door

**Home:** in-page, in every wrapp's header, via `mountConnect` (shadow DOM, un-restylable).

**What it holds:** exactly one asset — *who you are and which single project is lent to this app.* Its three renderable states are already implemented (`not-installed → "Get Switchboard"`, `disconnected → "Connect Switchboard"`, `connected → "Hi {name} · {project}"`, plus a transient `booting`), and its only two actions are (a) open the connect consent and (b) switch the lent project inline via `context.pick()`.

**A known fail-open gap, stated honestly.** The chip has **no "offline" state today**, and it cannot get one without new work. On refresh, `connect-chip.ts:124` does `r.permissions().catch(() => null)` — so a daemon that is **down or unreachable returns `null` and renders identically to "no grant"**, i.e. the chip shows **"Connect Switchboard."** That is a *fail-open* read: it invites the user to click Connect into a `relay.connect()` that will silently fail, when the honest message is "your sidekick is offline." Producing a real offline state requires a new provider **liveness signal** — a `claude_ping` / `capabilities` call that distinguishes *transport-down* from *ungranted* — which does not exist yet. This spec therefore treats an OFFLINE chip (and the panel's offline distinction, §3.1) as **future work contingent on that signal** (committed in §5's P0), not as a state designable today. Until it ships, the chip's three states are the ground truth, and the fail-open behavior is a named risk, not a feature.

**What it must never hold, and why.** Any surface that grants, reveals, or scopes is trusted-channel-only. The chip is drawn by a page; a page-drawn "revoke" or "budget" control is a page *impersonating* the broker. So the chip gets one escape valve and no more: a **"Manage in Switchboard"** affordance that *opens the side panel*. This is the load-bearing chip↔panel transition — the chip never *copies* the panel, it *summons* it. A copy can lie about origin and scope; a door hands control to the surface that can't.

**Design consequence:** the chip stays tiny and legible. When a wrapp needs to say "connect your Gmail to use this," it does *not* grow a connector UI — it deep-links: chip → panel → Connections. The page describes the need; the panel satisfies it.

### 2.4 The side panel — the control center

The panel is the trusted home for the three things a user owns (inference, context, backend) and the apps consuming them. **Today it is a single top-to-bottom scroll** with sections stacked head to foot (This tab → Working on → Connectors → Apps → Wrapps → Recent activity), which is exactly what `sidepanel.ts` `render()` builds, and this spec's layout in §3.1 implements *that scroll*, extended with the new Vault/Store/MCP/Activity content. A **five-tab reshape is the planned evolution, not the v1 target** — it is what the scroll becomes once the function count (a full Vault browser, a real store, MCP management, a scheduled-tasks surface, a filterable ledger) makes one scroll unwieldy. The trigger for the reshape is concrete: when Home/Vault/Wrapps/Connections/Activity each hold enough that the single column can no longer be scanned, they split into tabs, each answering one question:

| Tab (evolution) | The question it answers | Why it earns its own tab |
|---|---|---|
| **Home / Today** | "What needs me right now?" | The daily landing. Time-sensitive and tab-contextual; the zero-scroll default. |
| **Vault** | "What knowledge do I own?" | The context graph is a first-class asset now. It needs a browser (§2.5) only the trusted channel may render. |
| **Wrapps** | "What runs on my Claude, and what could?" | Merges installed apps with the store so a wrapp is *declared once* and install means *grant* (§2.7). |
| **Connections** | "What tools/servers does my Vault lend?" | Connectors get a drill-down and MCP-server management — a real capability surface, not read-only tiles. |
| **Activity** | "What actually happened?" | The accountability ledger, filterable, with export. Promoted out of a collapsed `<details>` because accountability is a headline feature. |

Until that reshape, all five live as sections of the one scroll (§3.1). Everything below specifies the content; §3.1 specifies its rendered form as sections, and flags the tab split as the later step.

**Persistent header.** Three things transcend the layout, scroll or tabs:
- **Status pill** (`on` / `sidekick offline` / `not paired`) — the trust state of the whole system. (The `sidekick offline` value is only fully honest once the liveness signal of §2.3/§5-P0 lands; today it reflects the pairing/reachability check `getStatus` already returns, not a live socket-death probe.)
- **Today's spend** — a **compact** total of today's compute across all apps. This lives in the panel header because the panel is the daily surface and the Spotify-style Pro rev-share needs the number glanceable; it anchors to the existing per-origin budget ledger (`OriginGrant.budgets`, `usage.tokensToday`) — the panel just *sums* what the daemon already meters. The **full breakdown** (per-wrapp, plan, the 75%→devs split) is *not* here — it lives in the Store's **Billing** rail (§3.2.1). Compact total in the panel; full accounting in Billing. This is the single home rule for the spend number; there is no third copy.
- **⋯ menu** — the rare, heavy, global actions: **Set your name**, **Export activity (JSON)** (migrated out of the orphaned `popup.ts`, which then retires to a bare pairing/launcher), and **Disconnect everything** (the global kill switch).

#### 2.4.1 Home / Today

The zero-scroll landing, tab-contextual and time-sensitive:

- **This tab** — classify the active origin (Connected · Works with Switchboard · Hasn't opted in) from `chrome.tabs`, and when the site hasn't opted in, surface wrapps whose manifest declares `alternativeTo` that host (Canva → Prism, ChatGPT → Chat). This is the panel's unique retention hook and already exists; it stays on Home because it changes as you browse.
- **Working on** — the single active project, with **Switch/Choose** opening the grouped picker sheet (Projects / Brands / Data sources) and its "Connect a Google Sheet" add-source form. This is the *identity* face of the one-active-context model — the same object the chip greets you with.
- **Needs you** — a new consolidation: pending write consents, apps nearing a budget cap, grants about to expire. Today consent takes over the whole panel when it arrives; "Needs you" is the *resting-state* index of everything awaiting a human click, so nothing sits unnoticed.
- **Scheduled** *(gated on new work)* — recurring wrapp tasks with next-run and pause. The honest home for daemon cron. **Flagged as net-new that dents the airgap:** a task that "runs when the tab is closed" contradicts today's pure-client wrapp definition, so this row renders empty (or hidden) until the daemon ships `sb_jobs`. It is placed on Home, not buried, because the thesis is that scheduled execution roughly *doubles* the portable universe — it deserves a first-class slot the moment it exists.

#### 2.4.2 App card

An app's full relationship lives in one expandable card under **Wrapps ▸ Installed** (an app is always viewed *in the context of* the installed list, so it is not a separate tab). Collapsed: name + activity dot. Expanded, it becomes the per-origin control that today's model half-implements and this spec completes:

- **Can use** — connector pills with read/write. **The access class on each pill is the daemon's, not the manifest's:** every badge reflects the `ToolAccess` the daemon's policy table assigned out of band (`permissions.ts:11-13` — default-deny, unclassified = `write`), never what the wrapp's manifest claimed. A manifest that labels a `write` tool as `read` cannot lull the user, because the card re-derives and may show a *stricter* class than requested.
- **Context access** *(new)* — the granted context kinds/objects, mirroring `OriginGrant.context` (§2.6). Today an app's context grant is invisible here; it must be as visible and revocable as its tools. A `mode:"all"` grant carries a **standing "reads ALL {kind}, including future ones" indicator** (§2.6.4), so an unbounded future-read is never silent.
- **Storage** *(new management)* — the bound folder and record count are *shown* today but inert; here they gain **rebind** and **revoke**, because folder access is a lend and every lend must be revocable from the trusted channel.
- **Compute today**, **Mode** (Ask/Trust/Read-only), **inline pending consent**, **Disconnect** — as today.
- **Re-scope** *(new)* — add/remove individual tools, change budgets, add or drop a context kind *after* connect. Because narrowing-only is an invariant, **tightening** scope here (drop a tool, drop a kind, switch a kind from `all`→`selected`, lower a budget) needs no prompt. **Widening** scope — adding a tool, adding a context kind, switching `selected`→`all`, adding ids — **re-raises the matching consent for the delta on a human click**: `consent:connect` for a tool/budget delta, `consent:context-query` for a context delta (§2.6.4). The Vault inspector and this card's Manage affordances are otherwise *narrow/revoke-only*; widening never happens without a fresh consent.

#### 2.4.3 Connections

Connector tiles stay (friendly capability names inferred from raw tool names via `connectorOf`), but gain the drill-down the read-only version lacks: **connector detail** → the underlying raw tools, which apps use it, and health; and **Manage MCP servers** → add / authorize / remove a server. Connectors are how the *backend* asset is lent, so managing the servers behind them belongs in the trusted channel next to the tiles they produce. This surface is also the **precondition the EA extractor depends on** (§1.6, §6.4): the user connects their Gmail/Calendar MCP server here *before* the EA can produce `task`/`person`/`event`. First-run should route a user toward this when they pick the EA path (§4.1).

#### 2.4.4 Activity

Promoted from a collapsed `<details>` to a full tab because a consent broker's ledger is a feature, not exhaust. Adds **filters** (by app · by context kind · by outcome · by time) and per-entry drill (jump to the app card or the Vault object touched). Export lives in the header ⋯ menu, unifying the one affordance the legacy popup uniquely had.

When typed multi-context lands, every `context.query` read is logged so the ledger can state "the game read 12 tasks." **This requires a protocol change that §5(i) commits to as work:** today's `AuditEntry` (`packages/protocol/src/audit.ts`) has no field for context kind or object ids — its `kind` field is an *entry-type* enum (`"request" | "tool_call" | "consent" | "connect" | "revoke"`), which also *collides* with the term "context kind" and must be renamed in copy. The ledger's per-read accountability is therefore a promise the data model cannot keep until `AuditEntry` gains a `context_read` entry type (or `contextKinds?` / `contextIds?` fields). One further constraint carries over from the same file: `AuditEntry.note` "must stay non-sensitive," so a read log records *counts and kinds*, **never the object titles or `data`** — the consent-preview titles (§3.5.5) are shown to the human on the trusted surface but are never written to the ledger, or the accountability log becomes a PII leak.

### 2.5 The Vault browser

**Home:** panel-only, its own surface. This placement is forced by the enumeration invariant: **apps can never enumerate the library; only the control channel can.** A page-side Vault browser would be a page enumerating what the user owns — exactly the boundary the whole product defends. So the graph browser is structurally extension-only.

**What it is.** The user owns a *typed graph* of context — kinds `brand · task · person · event · decision · note · asset`. The Vault is the lens onto that graph:

- **Filter by kind** — chips across the top; the typed axis the graph is built on. Today `kind` is a free-form string tag; this surface is what makes promoting it to a `ContextKind` union worth doing.
- **Object list** — name, kind glyph, **source badge** (`brand` · imported-from-`{host}` · Sheet-backed), updated-ago. **No brand-colour swatches:** a context is never decorated with its own palette in Switchboard chrome — the shipped panel deliberately does not render `ContextMeta.swatches` (`sidepanel.ts:240-241`, `:367-368` — "No brand swatches here", "No colour swatches in the picker"), and the chip carries the context name in ink only (`connect-chip.ts:213-215`). The one per-object mark is Switchboard's lime **initial-mark** (the established pattern); a monochrome **kind-glyph** conveys type. Brand colour is meaningful *inside the consuming app*, never in the broker.
- **Object detail** — the pivotal view. Every wrapp is a *lens*: some **produce** a slice of an object, some **consume** it. The detail panel names both — *"Written by Cast · Readable by Prism, Ad generator"* — so the user sees the graph as relationships, not a flat list. It also shows **lineage** (the `ContextSource` URL/sheet and the `extractor` that produced it) and offers **per-object revoke**.
- **Who can read this** — per-object context-grant management, the read side of §2.6.
- **+ Import** — the supply-side extractor entry point: a read-only URL teardown or a Sheet, run through `context:import`. Because it makes the *daemon* fetch a user-supplied URL, it is an egress action and raises a consent modeled on `sb_http`'s guard, not a weaker path-only click — see §2.6.5.

**Why the Vault matters to the whole IA.** It is where the "one task object is a to-do, a runbook item, *and* an NPC quest" reuse becomes visible and manageable. The single active-project model (Home ▸ Working on) is the *identity* view of context; the Vault is the *ownership* view. They coexist: Working on answers "what am I lending this app," the Vault answers "what do I own and who reads it."

### 2.6 Consent surfaces

Consent is where the security model becomes UI. One shared renderer (`renderConsent`) covers every kind so they cannot drift; and it renders in **exactly one place — inline in the side panel — never in a separate window.** This is the real mechanism (`background.ts:112`: a daemon consent prompt "ALWAYS shows in the side panel — never a separate window"). If the panel is closed when a prompt arrives, the daemon **badges the action icon** and best-effort opens the panel (`tryOpenPanel`); the request sits **pending until the user opens the panel**, and **fails closed** on the daemon's timeout / worker eviction. There is no second render target to keep in sync and nothing for a page to spoof: one renderer, one surface. **Only a human click resolves consent** — the model can propose scope but can never satisfy the prompt. Origin is stamped by the background worker from `port.sender`, never read from the page. There are four kinds today and one new kind this spec adds.

#### 2.6.1 `consent:connect` — the scope grant

Raised by the chip's "Connect" or by **Install** in the store. Shows requested **models** (narrow checkboxes), **tools** with read/write badges, editable **budgets**, and All/none. **The access badges are the daemon's classification, not the manifest's** — when this dialog is pre-filled from a store manifest (§2.7), the manifest is a *request*; every badge is re-derived by the daemon's policy classifier and may be stricter than the manifest claimed (`permissions.ts:11-13`). The user can *narrow only* — drop a tool, uncheck a model, lower a budget — never widen. Apps must handle a partial grant: the model check canonicalizes alias↔full-id pairs (§1.4), so the real denial mode is a *different model family*, and the app must degrade gracefully when granted fewer models/tools than asked. Install-as-grant means launching a wrapp later *carries an established scope* instead of cold-calling `window.claude`.

#### 2.6.2 `consent:write` — approve-once

Every write prompts (or is pre-authorized per-site by Trust mode). Shows the exact tool, the **arguments as JSON**, and a plain-language warning ("may send / change / delete / spend"). This is the surface a prompt injection can never satisfy, because satisfying it requires a click on a surface the page cannot reach. **This gate is non-negotiable and non-delegable** (`permissions.ts:15-24`: write → per-action consent *every invocation*, never bypassable) — a constraint that directly bounds what a scheduled job may do unattended (§5-vii).

#### 2.6.3 `consent:storage-bind` — folder access

One-time, shows the **exact path** being bound. Per-origin isolation is structural (`folderFor(origin)` at the handle level), not a runtime check the page could talk its way past.

#### 2.6.4 `consent:context-pick` vs. `consent:context-query` — the pivotal evolution

- **Today — `consent:context-pick`:** radio-select *the one* context (a brand) lent to an origin. Selection *is* consent, set out of band. Single object, all-or-nothing on its opaque `data`.
- **Next — `consent:context-query` (new):** the typed multi-context grant that unblocks cross-domain consumers (the RPG reading `task` + `person`; the EA writing them). The prompt reads *"This app wants to read your **task** and **person** context,"* with per-kind checkboxes and an `all-of-kind` ↔ `selected-objects` toggle. It writes a **`ContextGrant`** onto the `OriginGrant` — a *scoped, revocable, audited* grant living alongside tools, not a single out-of-band pointer.

**The `mode:"all"` risk is named, not buried.** A `query` returns **full opaque `data` payloads**, and `mode:"all"` means *all objects of these kinds, present and future*. So an app granted `task:all` once silently gains every task the user ever adds later — including tasks a newly-connected Gmail extractor files months from now, whose content the user never previewed. Three mitigations make this legible rather than a footnote:
1. A `mode:"all"` grant carries a **visible standing indicator** in the app card and the Vault ("life-rpg reads ALL tasks, including future ones") — a persistent, revocable badge, not a one-time line.
2. The ledger surfaces the **first read of each newly-created object** by an `all`-scoped origin (subject to the §2.4.4 audit-schema work), so "the game just read a task you added yesterday" is visible.
3. High-sensitivity kinds (`person`, `event`) **default to `mode:"selected"`**; escalating them to `all` requires an extra confirmation in the dialog. `task`/`brand`/`note` may default to `all`.

And the disclosure asymmetry is stated plainly: the human preview shows **titles only** (§3.5.5), but the app receives **full `data`**. That is deliberate — the human deciding needs enough to judge, the app needs the payload to function — but it is a real asymmetry, so the dialog says so rather than implying the app sees only what the preview showed.

**Widening is a fresh consent.** Narrowing a `ContextGrant` (drop a kind, `all`→`selected`, remove ids, revoke) happens in the panel with no prompt. **Widening** it (add a kind, `selected`→`all`, add ids) **re-raises `consent:context-query` for the delta** on a human click — the exact analogue of tool re-scope (§2.4.2). There is no path anywhere that widens a context grant without a new consent.

**The invariant survives the evolution.** `context.query({kinds})` still never enumerates the library — it returns *only the granted subset*. `pick` remains for the single-brand lens; `query` is gated by the `ContextGrant`; and the grant is authored, viewed, narrowed, and revoked in the panel (App card ▸ Context access, and Vault ▸ Who can read this). The consent moves from *implicit and singular* to *explicit, typed, and revocable* — without ever letting a page see what it wasn't granted.

#### 2.6.5 `context:import` — an egress action, guarded like `sb_http`

Import (URL teardown / Sheet) is **not** a mere path-consent click, because it makes the *daemon* fetch a user-supplied URL — the identical primitive `sb_http` surrounds with egress rails (`docs/CAPABILITIES.md:145`: no `file://`, no loopback, no cloud-metadata IPs, per-origin byte caps). Since import ships *before* `sb_http` in the roadmap (§5-ii before §5-iv), those rails must be applied to import from day one: **the same IP/scheme denylist, the same byte cap, and the reason/URL displayed-never-executed rule.** A pasted `http://169.254.169.254/…` or `file:///etc/…` must be denied by import exactly as `sb_http` would deny it. Import is, in effect, a constrained `sb_http` GET, and it reuses that capability's egress guard rather than inventing a weaker path-only model. The consent shows the exact URL, warns the fetch happens, and the untrusted URL/reason string is displayed, never executed.

### 2.7 The Wrapp Store & discovery

**Home:** the **Wrapps** surface, which *merges* installed apps and the store so a wrapp is declared once. This reconciles the two placeholder surfaces (`index.html`'s honest linked-wrapps + `store.html`'s richer IA) into one, and kills the drift where the same wrapp appears under three names.

**The concrete reconciliation target is `examples/apps/src/store.js:41-56`, and it is worse than a naming nit.** Today `INSTALLED = ["Landing Studio","Campaign Studio","Brand Builder","Store Auditor"]` is keyed by **display name**, while the `POPULAR` catalog lists *different* names and two entries — `"Video Studio"` and `"UGC Studio"` — **both point at `persona.html`** (`:54`, `:56`), and every catalog entry carries **fabricated `rating`/`installs`** (`:51-56`). The fix is explicit:
- **INSTALLED is keyed by manifest `id`, never by display name** — so a rename can't orphan an install and a duplicate-name can't double-count.
- **The two `persona.html` entries collapse to one `id`** — one URL, one manifest record.
- **The fake `rating`/`installs` fields are deleted, not carried forward** — every field on a card is real or absent (§3.2.2).

**The missing primitive: a manifest.** Discovery today is "eyeball a hardcoded array; launch = `window.open`." The fix is one typed record per wrapp, keyed by a **stable `id`** (not the name), decoupled from any store HTML:

- **Identity** — `id`, `name`, `icon`, `tagline`, `author`, `verified`, `version`, entry `url`.
- **Capability declaration** — the broker's whole point, surfaced *before* install: which of the three lends it needs — **inference** (`claude_complete/stream/session` + model scope), **context** (which graph `kinds` it queries — the `context.query` axis), **backend** (bound folder? which MCP servers / `sb_*` capabilities?). This is what powers honest filtering: *"apps that only need inference"* vs. *"apps that touch my Gmail."* **It is a request, never a grant:** the manifest's declared read/write classes are *displayed* in the store, but the actual `consent:connect` re-derives every access class from the daemon's policy table and may be stricter (§2.6.1). The store shows what the app *asks for*; the daemon decides what it *gets*.
- **Taxonomy** — category (chat / editor / canvas / research / commerce), port tier (A / B / B\* / C), runtime (airgapped vs. MCP-driven), and Vault lens role (producer / consumer / both).

**Install ≠ open.** *Install* persists the wrapp to the installed set (**keyed by `id`**) **and** records the granted capability scope per origin via `consent:connect` — the point where the store meets the permission model, with daemon-re-derived badges. *Launch* then carries an established grant. **Search and filter** run over the manifest (by category, capability, tier, context-kind), wiring the input that is a no-op today. **Context-aware discovery** is the store's unique hook: using a wrapp's declared context-kinds against the real Vault, the store surfaces *"works with your active context"* — a generic gallery cannot do this.

### 2.8 Transitions — how the surfaces hand off

The surfaces are deliberately few, and every hand-off moves control *toward* the trusted channel, never away:

- **Page → chip → consent → panel (first run / cold start).** A visitor lands on a wrapp. The chip reads `not-installed` → "Get Switchboard" → install page; after pairing it reads `disconnected` → "Connect Switchboard" → **`consent:connect`** inline in the panel. Approve, and the chip flips to "Hi {name} · {project}"; the app is now "yours." First-run deliberately routes through the panel so the user's *first* experience of granting is on the trusted surface, setting the mental model for every grant after.
- **Chip ↔ panel (management).** The chip's project switcher handles the one inline identity action (`context.pick`); everything heavier is **"Manage in Switchboard"** → the panel opens to the relevant section. The chip summons; it never copies.
- **Store → wrapp (install-then-launch).** In **Wrapps ▸ Store**, a wrapp detail shows its declared lends; **Install** raises `consent:connect` (daemon-derived badges); the wrapp opens in a new tab already carrying the grant, so its first `window.claude` call is pre-authorized rather than cold.
- **Panel ↔ Vault ↔ app card (the context loop).** Grant context to an app from the app card (**Context access**) *or* from the object (**Vault ▸ Who can read this**) — same `ContextGrant`, two entry points, one source of truth. Revoke or narrow from either; widen only through a fresh `consent:context-query`. The Vault shows producer→consumer edges so the user always knows *which app wrote which slice and which app reads* every object.
- **Any surface → consent → the panel (interruptive, fail-closed).** A write mid-task, or a daemon-pushed prompt, badges the icon and takes over the panel with `consent:write`; the background worker best-effort opens the panel if closed; the request stays pending, and on eviction or timeout it **fails closed**. Consent can be *triggered* from anywhere, but it always resolves in the one place a page cannot reach — the panel — and only a human click resolves it.

---

## 3. Layout specs

This section specifies, surface by surface, what an engineer builds. Every surface inherits the brandbrain token system (see `relay-design-system`): page `#0A0C10`, panel `#12151C`, raised `#1A1F29`, hairline edge `#262C38`; ink ramp `#E8EDF4 → #6E7C90`; **one** accent, lime `#C8F250` on `#232B0D` soft; semantics `ok #3DD68C` / `warn #F59E0B` / `danger #FF2D6E`. Display = Bricolage Grotesque; body = Hanken Grotesk; **mono = Spline Sans Mono for every number, hex, kind-tag, timestamp, and origin**. Two hard rules bind everything below:

- **No brand palettes in Switchboard chrome.** A context is never decorated with its own colours anywhere in the broker UI — not in the project card, the Vault, the picker, or a consent dialog. This is enforced in the shipped code (`sidepanel.ts:240-241` "No brand swatches here"; `:367-368` "No colour swatches in the picker"; `connect-chip.ts:213-215` "no brand colours in Switchboard's chrome"). The `swatches` field exists on `ContextMeta` but is deliberately not rendered. The only per-item marks are Switchboard's lime **initial-mark** and the monochrome **kind-glyph**. Brand colour is meaningful *inside the consuming app*, never in the broker.
- **The chip is a door, never a copy.** No app-side folder / connector / budget / trust-mode / revoke UI. All management lives in the side panel. The chip carries identity only.

Measurements assume the extension side panel's real constraint: **a 360–400px-wide column**, full viewport height, single scroll. The Store and Vault are full-tab surfaces (`store.html`, a new `vault.html`) and get a wider grid. Consent renders **inline in the panel column — the only consent surface there is** (`renderConsent` is one shared renderer; there is no fallback window to drift from — §2.6).

### 3.0 Shared primitives

Build these once; every surface composes them.

| Primitive | Spec |
|---|---|
| **Kicker** | mono 10px, uppercase, `letter-spacing .16em`, `ink-dim`. Section eyebrows only. |
| **Card** | `bg-panel`, `1px edge`, `radius 14px`, `padding 14px`. Hover → `edge-soft`. Selected/active → `1px lime` border + `lime-soft` bg wash. |
| **Chip** | `radius 999px`, `bg-raised`, `ink-dim`, mono 10px, `padding 3px 8px`. Write/danger variant → `danger` on `color-mix(danger 14%)`. Read variant → `ok` on `color-mix(ok 14%)`. |
| **Kind-tag** | a chip whose label is a `ContextKind`. Each kind gets a **fixed monochrome glyph** (see 3.4) so a kind is recognisable pre-read. Glyph is ink — never coloured by brand. |
| **Initial-mark** | the per-object visual: a lime square with the object's first initial. The *only* per-object colour in chrome. Replaces any notion of a brand swatch. |
| **Status dot** | 8px circle. `ok` = active now, `ink-dim` = idle, `ink-faint` = last-seen/offline. Always paired with a text label; never colour-only. |
| **Access badge** | `read` (ok) / `write` (danger) pill, mono 10px. Reused verbatim from `consent-view.ts`. **Always reflects the daemon's assigned class, never a manifest claim.** |
| **Primary button** | `bg lime`, text `#0A0C10`, `radius 10px`, weight 600. **Secondary** = `border edge`, `bg panel`, `ink-sec`. **Danger** = `border danger`, `danger` text, fill only on hover. |
| **Sticky action bar** | `.actions`, `position: sticky; bottom: 0`, `bg page`, `padding-top 10px`, two equal-flex buttons. Consent + any destructive flow uses it. |
| **Empty state** | vertical stack, centered: mono kicker, one `ink` sentence naming what's missing, one `ink-dim` sentence naming the fix, then a **single primary button that launches the extractor/producer that fills it**. Never a dead end — see 3.7. |

### 3.1 The side panel — global frame

`sidepanel.html`. **One scrolling column** — the shipped `render()` shape. The IA from §2 renders top-to-bottom; technical detail stays folded. (The five-tab reshape of §2.4 is the later evolution; this layout is the v1 scroll it grows out of, and the section order below *is* the tab order for that future split.)

```
┌────────────────────────────────────────┐
│  ◆ Switchboard   ● on   18.2k   ⋯      │   HEADER  (sticky) — compact spend total
├────────────────────────────────────────┤
│  THIS TAB                              │   §3.1.1
│  ┌──────────────────────────────────┐  │
│  │ canva.com   ○ Hasn't opted in    │  │
│  │ Try Prism instead  → open        │  │
│  └──────────────────────────────────┘  │
│                                        │
│  WORKING ON                            │   §3.1.2
│  ┌──────────────────────────────────┐  │
│  │ N  nailin.it        Switch ▸     │  │
│  │    brand · 4 sources             │  │
│  └──────────────────────────────────┘  │
│                                        │
│  CONNECTORS               Manage ▸    │   §3.1.3
│  [ Higgsfield ] [ Shopify ] [ Gmail ] │
│                                        │
│  APPS                                  │   §3.1.4
│  ┌──────────────────────────────────┐  │
│  │ ● Cast            active now  ▾  │  │
│  ├──────────────────────────────────┤  │
│  │ ○ Prism           idle  · 2h  ▸  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  WRAPPS                   Browse ▸    │   §3.1.5
│  [grid of launch tiles]               │
│  ┌ paste any URL ─────────────  → ┐   │
│                                        │
│  ▸ Recent activity                    │   §3.1.6  (folded)
└────────────────────────────────────────┘
```

**Header (sticky, 52px).** Left: 16px lime diamond wordmark + "Switchboard" (Bricolage 15px). Center: **status pill** — `● on` (ok dot), `sidekick offline` (warn), `not paired` (ink-faint). A **compact today's-spend** total sits between the pill and the menu (mono, tabular-nums — the sum of per-origin `usage.tokensToday`); it is glanceable only, the full breakdown lives in Store ▸ Billing (§3.2.1). Right: `⋯` opens a 3-item menu — *Set your name*, *Export activity (JSON)* (jumps to 3.1.6 expanded), *Disconnect everything* (danger, confirm-gated). The menu is the **only** home for the kill switch; it is never a visible button in the flow.

**Panel-level states** (mutually exclusive full-column takeovers):
- **Pairing** — a single centered card: kicker `PAIR YOUR SIDEKICK`, one line "Paste the token from `npm run sidekick`", a mono paste field, primary *Pair*. Nothing else renders.
- **Offline** — status pill reads `sidekick offline`; sections dim to `ink-faint` and a `Retry` secondary sits under the header. Cached last-known data stays visible but non-interactive (no phantom "everything's gone"). **Caveat, stated:** today the panel can only distinguish *not-paired* and *not-reachable* via `getStatus` (`{paired, reachable}`); a true "provider injected but socket dead mid-session" offline requires the same liveness signal the chip needs (§2.3, committed in §5-P0). Until it lands, "offline" here means "the daemon didn't answer the reachability check," not a live socket probe.
- **Consent** — takes over the whole column (§3.5). Sections below are hidden, not scrolled past, so a prompt can't be missed. This is the *only* consent surface; there is no window variant.
- **MOCK** — outside the extension, all sections render seeded demo data so the panel is viewable standalone. A tiny mono `demo` chip sits by the wordmark so it's never mistaken for live.

#### 3.1.1 This tab

One card, driven by the active tab host + classification.

- **Connected** — lime initial-mark, host, `● Running on your Claude`, a mono micro-line `12.4k tokens today · 3 tools`. Tapping expands the matching Apps card (3.1.4).
- **Works with Switchboard** — host, `○ Works with Switchboard`, primary **Connect** button (triggers the connect consent, 3.5.1).
- **Hasn't opted in** — host, `○ Hasn't opted in`; if a wrapp declares `alternativeTo` this host, a suggestion row: `Try Prism instead → open`. If none, the card collapses to a single muted line (no empty pep-talk).

Empty (no active web tab / new-tab page): card is replaced by a one-line `ink-dim` "Open a site to see how it works with Switchboard."

#### 3.1.2 Working on

The single active project/context (today's one-active model; the Vault in 3.4 is where multi-context lives). Card: lime initial-mark, name (Bricolage 15px), a mono sub-line `kind · N sources`, and a **Switch ▸** affordance opening the **picker bottom-sheet**:

```
┌ Switch context ───────────────  ✕ ┐
│  ┌ search ───────────────────────┐ │
│  BRANDS                            │
│   ◉ nailin.it        brand         │
│   ○ Aera             brand         │
│  DATA SOURCES                      │
│   ○ Q3 sales.csv     gsheet        │
│  PROJECTS                          │
│   ○ Store relaunch   task          │
│  ────────────────────────────────  │
│  + Connect a Google Sheet          │
│  + Import a brand from a URL   ✨   │
└────────────────────────────────────┘
```

Grouped by `kind` (`sidepanel.ts` already renders a group header only when there's more than one kind); a new kind forms its own group automatically. Two add-affordances anchor the bottom: **Connect a Google Sheet** (published-CSV form) and — new, load-bearing for cold-start — **Import a brand from a URL ✨**, which runs the URL extractor (3.7) through the egress-guarded import consent (§2.6.5). **No brand colours** render on any row (the shipped picker keeps only a `live · N rows` badge for source-backed contexts, no palette); the only colour is the lime radio + lime initial-mark.

Empty (no contexts): the sheet's list region is replaced by the cold-start extractor CTA (3.7.1).

#### 3.1.3 Connectors

Friendly capability tiles derived from granted tool names (`connectorOf` regex → Higgsfield / Shopify / Gmail / …). Horizontal wrap of chips, each `[ icon · name ]` with a mono sub-count `N apps`. Read-only *display* today; the section head carries a **Manage ▸** link. Until the full connectors detail view ships, `Manage ▸` opens a bottom-sheet listing the underlying raw tools with their **daemon-assigned** read/write badges, plus an **Add MCP server** entry point (the EA precondition, §2.4.3). This closes the "friendly abstraction has no drill-down" gap.

Empty: `ink-dim` line "No connectors yet. Apps you connect will list the tools they can use here."

#### 3.1.4 Apps

Connected origins as collapsible cards. This is the panel's densest region; **collapsed rows must be scannable at a glance**.

**Collapsed row:** status dot + name + right-aligned state (`active now` / `idle · 2h` / `last seen 3d`) + `▸`. Nothing else.

**Expanded card** (accordion, one open at a time):

```
┌ ● Cast · cast.studio ───────────  ▾ ┐
│ CAN USE                              │
│ [ Higgsfield ] [ WebSearch ]         │   ← read/write badges are daemon-derived
│                                      │
│ CONTEXT                              │   ← NEW (3.4.3)
│ Reads:  brand · task                 │
│ ⚠ ALL tasks — incl. future ones      │   ← standing mode:"all" indicator
│         12 lent · Manage ▸           │
│                                      │
│ STORAGE                              │
│ ~/Switchboard/cast   · 34 records    │
│ Rebind ▸   Browse ▸                  │
│                                      │
│ COMPUTE TODAY                        │
│ ▁▂▅▇▆▃  18.2k / 50k tokens           │
│                                      │
│ MODE   ( Ask · Trust · Read-only )   │
│                                      │
│ [ Disconnect ]                       │
└──────────────────────────────────────┘
```

- **Can use** — connector pills for this origin's granted tools; each badge is the daemon's `ToolAccess`, never the manifest's claim.
- **Context** (new) — the per-origin `ContextGrant` summary: which `kinds` this app may query, `all` vs `selected (N)`, a live count "12 lent", and **Manage ▸** → the re-consent sheet (3.4.3). A `mode:"all"` grant renders a **persistent `⚠ ALL {kind} — incl. future ones`** line (§2.6.4) so an unbounded standing read is never invisible. This is the only place besides consent where context scope is editable; **narrowing here is instant, widening bounces through `consent:context-query`** (3.5.5).
- **Storage** — folder path (mono, truncated middle) + record count; **Rebind** (re-runs storage-bind consent) and **Browse** (opens the bound folder). Closes the "storage is invisible" gap.
- **Compute today** — a 6-bar mono sparkline + `used / cap` in tabular-nums. Bar turns `warn` at 80%, `danger` at cap.
- **Mode** — three-way segment (Ask / Trust / Read-only). Ask = writes prompt every time; Trust = per-site pre-approve of writes *while the user is present*; Read-only = writes hard-denied. (Trust mode is a per-site, human-present pre-approval — it is **not** a delegation an unattended job may inherit; see §5-vii.)
- **Disconnect** — danger secondary, revokes the origin grant (confirm inline).
- **Inline pending consent** — if a write is awaiting approval for this origin, an approve/deny strip pins to the top of the card (mirrors the takeover in 3.5, for when the user is already here).

Empty (no connected apps): a card-shaped empty state — kicker `NO APPS YET`, "Nothing is using your Claude.", "Open a wrapp below to start.", primary scrolls to Wrapps.

#### 3.1.5 Wrapps

Launcher grid (not the Store — this is the panel's quick-launch). 2-column tiles: icon, name (Bricolage 13px), a status dot (lime if this origin is connected). Tap → opens in a new tab. Below: a mono **paste-any-URL** field with a `→` submit (loads an arbitrary wrapp URL). Section head: **Browse ▸** → full Store tab (3.2).

#### 3.1.6 Recent activity

A `<details>`, **collapsed by default** (the panel is a consumer home, not a log dashboard). Expanded: a timeline of audit entries — `time ago · app · tool`, left-bordered by outcome colour (ok / warn / danger). Each row is tappable → filters the full activity view. A `View all in activity` link at the bottom is the honest home for filtering/search/export; export currently lives only in the orphaned popup, and the `⋯ → Export activity` menu item is its replacement path. **A ledger row never prints an object title or `data`** — `AuditEntry.note` must stay non-sensitive (§2.4.4), so a context read shows *"read 12 tasks"* (count + kind), never the task names.

### 3.2 The Wrapp Store — `store.html`

A full-tab surface. Reconciles the two divergent surfaces (`index.html` honesty + `store.html` IA) into **one manifest-driven view**. Every wrapp is one typed registry record (**stable `id`, not name**); the store never transcribes a wrapp twice. The concrete reconciliation of `store.js:41-56` (INSTALLED keyed by `id`; the two `persona.html` entries collapsed to one; fake `rating`/`installs` deleted) is specified in §2.7.

**Frame:** left rail (fixed 220px) + content + a sticky bottom context bar.

```
┌──────────┬────────────────────────────────────────────────┐
│ ◆ SWBD   │  Wrapp Store            ┌ search wrapps ──────┐ │
│          │                         └─────────────────────┘ │
│ Home     │  FILTERS                                        │
│ Store  ● │  [ All ][ Chat ][ Editor ][ Canvas ][ Research ]│
│ Connectrs│  [ Commerce ]   needs: [inference][context][…] │
│ Permissn │                                                 │
│ Activity │  FEATURED OS                                    │
│ Billing  │  ┌──────────────────────────────────────────┐  │
│ Settings │  │  Commerce OS — brandbrain + 6 lenses      │  │
│          │  └──────────────────────────────────────────┘  │
│ ──────── │                                                 │
│ CONTEXT  │  WORKS WITH nailin.it            (3.2.3)        │
│ ◉ nailin │  [Prism] [Adgen] [Store Builder] [Naming]      │
│  it      │                                                 │
│          │  ALL WRAPPS                                     │
│          │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │
│          │  │card│ │card│ │card│ │card│  (3.2.2)           │
│          │  └────┘ └────┘ └────┘ └────┘                    │
├──────────┴────────────────────────────────────────────────┤
│  nailin.it · brand · 4 sources          on · 18.2k today  │  CONTEXT BAR
└────────────────────────────────────────────────────────────┘
```

#### 3.2.1 Rail
`Home / Store / Connectors / Permissions / Activity / Billing / Settings`. Active item = lime left-tick + `ink`. **Context switcher** pinned lower — the active context, click → same picker as 3.1.2, so the store's "works with" region (3.2.3) recomputes. **Billing** is where the Pro-sub / rev-share model gets its full surface: total spend, plan, and a per-wrapp usage breakdown feeding the 75%-to-devs split. The panel header carries only the *compact daily total*; **Billing owns the full breakdown** — the two are one number at two depths, not a contradiction (§2.4).

#### 3.2.2 Wrapp card (the manifest, made visible)
The store's core component and the payoff of the registry. **Every field is real or absent — no fake `rating`/`installs`** (those are deleted from `store.js`, §2.7).

```
┌───────────────────────────────┐
│ ▧  Prism            ✓ verified │
│ On-brand image studio          │
│                                │
│ NEEDS (requested)              │
│ ⚡ inference  ·  ◈ brand       │   ← capability declaration = a REQUEST
│ ⬡ Higgsfield                   │
│                                │
│ [ airgapped ]  [ producer ]    │   ← runtime + Vault role
│ ───────────────────────────    │
│ [ Install ]           Open ↗   │
└───────────────────────────────┘
```

- **Identity:** icon, name, tagline, a `✓ verified` mark only when the manifest asserts it.
- **NEEDS (requested)** (the whole point of a consent broker): which of the three lends it wants, drawn from the manifest — `⚡ inference` (+ model scope on hover), `◈ context` with the **exact kind-tags** it queries (`brand`, `task`…), `⬡` MCP connectors / `sb_*` capabilities, `⌂ folder` if it binds one. The label says **requested** on purpose: this is what the app *asks for*, not what it gets. The actual access class of each tool is **re-derived by the daemon at consent time and may be stricter** (§2.6.1) — the store may display a manifest's requested capabilities, but never presents them as the grant.
- **Taxonomy chips:** category, tier (A / B / B\* / C), runtime (`airgapped` vs `mcp-driven`), and Vault role (`producer` / `consumer` / `both`).
- **Install ≠ Open.** **Install** persists the wrapp to the `INSTALLED` set **by `id`** *and* records the granted capability scope per origin — it opens the connect consent (3.5.1) pre-filled from the manifest's declared needs *with daemon-re-derived badges*, so launch later carries an established grant instead of cold-calling `window.claude`. **Open ↗** launches. A connected wrapp shows a lime dot and the button reads *Open*, not *Install*.

#### 3.2.3 "Works with your context"
The store's unique hook vs a generic gallery. Given the active context's `kind`, surface wrapps whose manifest declares a matching `consumes` kind. Header names the context: `WORKS WITH nailin.it`. This is where a `brand` context routes the user to Prism / Adgen / Store Builder, and where the graph starts paying off.

**Empty store states:** no search hits → "No wrapps match `foo`. Clear filters." No context selected → the "Works with" strip is simply omitted (not an empty box). No installed apps → Home shows the cold-start rail (3.7.2).

### 3.3 The chip states — `connect-chip.ts`

Identity only, shadow DOM, un-restylable, mandatory on every wrapp. **Three renderable states plus a transient `booting`.** No management ever appears here. **There is deliberately no OFFLINE state today** — see the fail-open note below.

```
DISCONNECTED     ┌───────────────────────────┐
                 │ ◆ Connect Switchboard     │
                 └───────────────────────────┘

BOOTING          ┌───────────────────────────┐   (transient, while whenRelayReady resolves)
                 │ ◆ …                       │
                 └───────────────────────────┘

CONNECTED        ┌───────────────────────────────────┐
                 │ ◆ Hi Sameep · nailin.it      ▾   │
                 └───────────────────────────────────┘

NOT-INSTALLED    ┌───────────────────────────┐
                 │ ◆ Get Switchboard         │
                 └───────────────────────────┘
```

- **Not-installed:** provider never injected → "Get Switchboard" → `installUrl`.
- **Disconnected:** provider present, no grant (or `permissions()` returned null) → "Connect Switchboard". Click → connect consent (3.5.1).
- **Connected:** `Hi {name} · {lent context}` pill. The `▾` opens a **minimal** menu: the lent-project switcher (same picker, 3.1.2) and "Open Switchboard" (focuses the panel). **Never** budgets/tools/revoke — those are panel-only. The greeting guards against naming the user after a context: `name` comes from identity, and the shipped code has anti-collision logic (`connect-chip.ts:205` — falls back to "there" when the name collides), with the context name only after the `·`. When no context is lent the pill reads `No context lent`.

**The fail-open gap (a known limitation, not a state to design).** `refresh()` does `const grant = ... await r.permissions().catch(() => null)` (`connect-chip.ts:124`); a **down or unreachable daemon returns `null`, and `!grant` renders `disconnected` → "Connect Switchboard."** So a dead sidekick reads as *ungranted*, inviting a Connect click into a `relay.connect()` that will silently fail — a **fail-open** read, and the one place the chip's UX is not yet fail-closed-honest. There is no way to reach an "offline" chip state with today's SDK: it has exactly the states above, and `permissions()` cannot distinguish *transport-down* from *no-grant*. A real OFFLINE chip is **future work contingent on a provider liveness signal** (`claude_ping` / `capabilities`, committed in §5-P0); this spec does not present OFFLINE as a designable-today state, and flags the fail-open behavior explicitly so it is fixed at the SDK layer, not papered over in CSS.

The chip re-pulls on `permissionsChanged` / `disconnect`. Colour rule holds: the pill shows the context *name* in ink, never its brand palette.

### 3.4 The Context Vault — `vault.html` (new surface)

The Vault is the typed graph made navigable — what the single-active model evolves into. It is a **full tab**, not a panel section (the panel keeps the one-active "Working on" card; the Vault is where the whole graph and multi-context grants live). It has three jobs: **see** the graph, **see who reads what** (per-origin context grants), and **run extractors** to fill it.

**Frame:** left kind-filter rail + a graph/list canvas + a right inspector.

```
┌────────────┬──────────────────────────────┬───────────────────┐
│ KINDS      │  Your context                 │  INSPECTOR        │
│ ◈ all  47  │  ┌ search ──────────────────┐ │  nailin.it        │
│ ◈ brand  3 │                              │  brand            │
│ ⊙ task  21 │  ◈ nailin.it        brand    │  updated 2d ago   │
│ ⌂ person 8 │  ⊙ Restock listings task     │  from nailin.it ↗ │
│ ▤ event  6 │  ⊙ Draft launch email  task  │  ───────────────  │
│ ⚑ decisn 4 │  ⌂ Priya Shah      person    │  WRITTEN BY       │
│ ✎ note  5  │  ▤ Founder AMA      event    │  ● Cast (name,    │
│ ───────    │  …                           │    voice slices)  │
│ SOURCES    │                              │  LENT TO          │
│ ⤓ Import ✨ │                              │  ● EA-wrapp task  │
│ ⤓ Sheet    │                              │  [ Revoke ]       │
└────────────┴──────────────────────────────┴───────────────────┘
```

#### 3.4.1 Kind rail
Every `ContextKind` with a live count, each with its fixed monochrome glyph (the kind-tag glyph reused). Selecting a kind filters the canvas. `all` is default. `SOURCES` block at the bottom holds **Import ✨** (URL extractor, egress-guarded §2.6.5) and **Connect a Sheet** — the supply-side entry points, given rail-level prominence because extractors are the flywheel.

#### 3.4.2 Canvas
A list by default (dense, scannable: glyph + name + kind-tag + `updated` mono timestamp + a tiny `lent to N` count). **No swatches** — the initial-mark and kind-glyph carry all per-object visual identity. A **Graph** toggle switches to a node view where edges are producer→object→consumer relations (the same `task` shown lent to both Cast and the EA wrapp — the reuse story, made literal). List is the workhorse; graph is the "aha". Selecting a row populates the inspector.

#### 3.4.3 Inspector — where multi-context consent is governed
For a selected object: name, kind-tag, `updated`, and its **source** (`from nailin.it ↗` / `imported from stripe.com` / `built in brandbrain`). Then two blocks:
- **WRITTEN BY** — the producers and, when the object is composed of named slices, *which slice each wrote* (Naming wrote `brand.name`, Voice wrote `brand.voice`). This makes the **single-writer-per-slice** model (§4.7, §6.3) visible: no two producers own the same slice, so there is no clobber.
- **LENT TO** — every origin currently granted a `ContextGrant` that covers this object, each with the specific kinds it reads, its `all`/`selected` mode (an `all` grant flagged `⚠ incl. future`), and a per-origin **Revoke**. This is the object-centric mirror of the app-centric grant in 3.1.4 — the same `ContextGrant`, viewed two ways. **Revoking or narrowing here is instant; there is no widen affordance in the inspector** — widening a grant only ever happens through a fresh `consent:context-query` raised from the consuming app (3.5.5), never from this narrow/revoke-only surface.

**Invariant preserved:** the Vault is a *control-channel* surface (panel-class), so it may enumerate the whole library. Apps still cannot — `context.query` returns only the granted subset. The Vault is precisely the out-of-band place where that grant is set.

**Empty Vault:** the entire canvas is the cold-start extractor state (3.7.3) — the single most important empty state in the product.

### 3.5 Consent dialogs

All consent renders through the one shared `renderConsent`, **inline in the panel column — the only consent surface** (§2.6; there is no window variant to keep in sync). Shared frame for every kind: mono **kicker** naming the class, a Bricolage `h2` with the **origin host in lime**, an optional italic **reason** (untrusted string — *displayed, never executed*), the kind-specific body, and the sticky **actions** bar. **Only a human click resolves it; it stays pending if the panel is closed and fails closed on timeout/worker eviction; the model can never satisfy consent.**

#### 3.5.1 Connect (existing, `consent:connect`)
Kicker `CONNECTION REQUEST`; "Connect to **{host}**?"; reason. Then **Models** (checkboxes, default to requested set, All/none), **Tools** (only what the site requested, pre-checked, **daemon-derived read/write badges**; empty → "No tools requested — completions only."), **Budget** (max tokens/day, max calls/min, mono inputs). **When launched from Store Install, this dialog is pre-filled from the manifest's declared needs, but every access badge is re-derived by the daemon** (§2.6.1) — the manifest requests, the daemon classifies. It additionally shows the **Context** block (3.5.5) if the manifest declares `consumes` kinds — so install is one scoped grant, not two prompts. Actions: `Deny` / `Approve`. Approve narrows-only.

#### 3.5.2 Write (existing, `consent:write`)
Kicker `WRITE ACTION`; "Approve this action?"; "`{host}` wants to run **`{tool}`**"; the **Arguments** JSON in a mono, scrollable, wrap-safe block (max-height 180px); a `danger` warn line "This may send, change, delete, or spend. Approve only if you initiated it." Actions: `Deny` / `Approve once`. **Fires every time unless the origin is in Trust mode** — the per-action gate is never bypassable or delegable (`permissions.ts:15-24`), which is exactly why an unattended job cannot satisfy it (§5-vii).

#### 3.5.3 Storage-bind (existing, `consent:storage-bind`)
Kicker `FOLDER ACCESS`; "Let **{host}** use a folder?"; explains it binds the app's local store to a real folder, read/write *there and nowhere else*; the **path** in a mono block; a `danger` warn. Actions: `Deny` / `Bind folder`.

#### 3.5.4 Context-pick — single brand (existing, `consent:context-pick`)
Kicker `LOAD CONTEXT`; "Lend a brand to **{host}**?"; the invariant restated: "The app receives ONLY the one you pick, for this session. It never sees the rest of your library." Radio list of the user's own contexts (name + kind-tag). Actions: `Cancel` / `Lend brand`. Empty → "No brands yet — build one in brandbrain first." + disabled approve. **This stays** for the single-brand lens; 3.5.5 is the multi-context evolution, not a replacement.

#### 3.5.5 Typed multi-context consent — the new dialog (`consent:context-query`)

The dialog the whole Vault evolution rides on. The failure mode to design against: a user blankly approving "read your context" without grasping that it means *this game can read the tasks Switchboard extracted from your Gmail, and the people in them — now and every one you add later.* Legibility is the entire job. Five design commitments:

**(a) Lead with provenance, not the kind name.** A `task` is abstract; "tasks from your Gmail" is concrete and is what the user actually fears. Each requested kind renders as a row that names **where those objects came from** (their `source`) and **how many** exist, before any approve control.

**(b) Per-kind granularity, `all` vs `selected`, with sensitive kinds defaulting to `selected`.** Each kind row is independently droppable, and each carries an `all` ↔ `selected` toggle. **`person` and `event` default to `selected`** (the user must opt *up* to `all`, which shows an extra confirmation); `task`/`brand`/`note` may default to `all`. Narrowing-only within the request — the user can never grant more than the app asked for.

**(c) `mode:"all"` states the future-objects reach in words.** The `all` option's label is not just "all" — it reads **"all — including ones you add later"**, and selecting it renders a persistent standing note that this grant covers objects that do not exist yet (the same standing indicator that then lives in the app card, §2.6.4). This is the single most important sentence in the dialog.

**(d) Show a real sample — and name the disclosure asymmetry.** Under each kind, a collapsed **Preview** reveals up to 3 example object *titles* so "12 tasks" is inspectable. But the framing is honest, not "metadata is safe": for `person`/`event`/`task` the **title itself is sensitive** (a person's name, a meeting subject like "layoff call with Priya" *is* the PII). So the dialog says plainly: *"Preview shows titles so you can decide; the app will receive the full contents of everything you grant."* The human sees **less** (titles) than the app will get (full `data`) — a deliberate asymmetry, disclosed, not hidden. These previews are shown only on the trusted panel and are **never written to the audit ledger** (`AuditEntry.note` stays non-sensitive, §2.4.4).

**(e) Name the cross-domain risk in plain words.** A single `warn`-toned sentence states the actual exposure: "This app will be able to read these objects — and their full contents — whenever it runs, until you revoke it in the Vault." No jargon, no `ContextGrant`.

```
┌──────────────────────────────────────────────┐
│ TYPED CONTEXT ACCESS                          │  kicker
│ Let  life-rpg.app  read your context?         │  h2 (host in lime)
│ "Turn your real tasks into quests."           │  reason (untrusted)
│                                               │
│ THIS APP WANTS TO READ                        │
│ ┌──────────────────────────────────────────┐ │
│ │ ☑  ⊙ task            21 objects   [all ▾] │ │
│ │    from your Gmail · nailin.it            │ │  ← provenance line
│ │    all — including ones you add later     │ │  ← future-objects note
│ │    ▸ Preview (titles; app gets full text) │ │
│ │      · Restock listings                   │ │
│ │      · Draft launch email                 │ │
│ │      · Reply to Priya                     │ │
│ ├──────────────────────────────────────────┤ │
│ │ ☑  ⌂ person          8 objects [selected]│ │  ← sensitive kind: defaults to selected
│ │    from your Gmail · Contacts             │ │
│ │    Choose which people ▸                  │ │
│ ├──────────────────────────────────────────┤ │
│ │ ☐  ◈ brand           3 objects  (dropped) │ │  ← user unchecked a kind
│ └──────────────────────────────────────────┘ │
│                                               │
│ ⚠ This app can read these objects and their   │  warn line
│   full contents whenever it runs, until you   │
│   revoke it in the Vault.                     │
│                                               │
│ ┌ Deny ────────┐ ┌ Grant read access ──────┐ │  sticky actions
└──────────────────────────────────────────────┘
```

**Row anatomy (per requested kind):**

| Element | Behaviour |
|---|---|
| Checkbox | Include/drop this kind. Unchecked → row dims, tag reads `(dropped)`, kind is excluded from the grant. |
| Kind-tag + glyph | `⊙ task` etc., monochrome — never brand-coloured. |
| Count | mono `N objects`, tabular-nums, live from the graph. |
| **`[all ▾]` / `[selected]` scope** | `all` = every object of this kind, present *and future*, labelled "including ones you add later". `selected` = an allowlist the user checks now. `person`/`event` start on `selected`; upgrading to `all` shows an extra confirm. |
| Provenance line | `ink-dim` — "from your Gmail · {producer context}". The most important line for comprehension. |
| **▸ Preview** | ≤3 object titles, labelled "titles; app gets full text" so the asymmetry is on the tin. "+18 more" if truncated. Never shows `data`; never logged. |

**Result → `ContextGrant`.** Approve produces `{ kinds: [checked], mode: "all" | "selected" per kind, ids?: [...] }`, recorded on `OriginGrant.context`, revocable/narrowable in both the app card (3.1.4) and the Vault inspector (3.4.3), widenable only by a fresh raise of this dialog. Every subsequent `context.query` is **audited by count and kind** (`read 12 tasks`) once the `AuditEntry` schema work of §2.4.4/§5(i) lands — never by title. Actions: `Deny` / **`Grant read access`** (label says exactly what it grants — read, not write).

**Empty / degenerate states:**
- **Requested kind the user has none of** — row still shows, count `0 objects`, provenance replaced by an inline extractor CTA: "No tasks yet — `Run the Email extractor` to create some." (ties consent directly to supply, 3.7). The kind stays grantable (future objects) but the app is honestly told there's nothing yet.
- **Nothing requested is grantable** (user has zero of every requested kind) — the dialog becomes a cold-start prompt: "This app reads tasks and people, which you don't have yet. Set them up first," + a primary that launches the relevant extractor, + a secondary `Connect anyway` (grants the empty-but-future scope, which — for sensitive kinds — is the one case an `all` grant is minted with no objects to preview, so the future-objects warning is doubly prominent).

### 3.6 Consent, but for scheduled execution (forward-declared)

Cron / `sb_jobs` is a **known gap that breaks the pure-airgap model** (something runs when the tab is closed) — not a shipped feature. When it lands it needs its own consent class, specified here so the pattern is reserved: `consent:schedule` — kicker `SCHEDULED TASK`, "Let **{host}** run **{task}** on a schedule?", the **cadence** in mono (`daily · 09:00`), the **read-only scope it will use unattended** (which reads/read-capabilities — never a write scope, per §5-vii), and a `danger` warn that it *runs without you present*. Actions: `Deny` / `Allow schedule`. A managed-schedules list belongs on the Store rail (a new `Schedules` item), never the panel flow. Flagged, not built.

### 3.7 Cold-start empty states — the extractor on-ramp

Extractors are the supply side, the flywheel, and the moat, so **every empty state in the product routes to running one.** The unifying pattern: *name the void → name the extractor that fills it → one button that runs it.* Three concrete instances. Crucially, **every empty state only offers producers that actually exist at that moment** (§4.1) — no button dead-ends into an unbuilt extractor.

#### 3.7.1 Empty "Working on" (panel)
No context exists. The card becomes:
```
┌──────────────────────────────────┐
│ NOTHING TO WORK ON YET            │  kicker
│ Your apps run on your context —   │
│ brands, tasks, people you own.    │
│ Start by making one:              │
│                                   │
│ [ ⤓ Import a brand from a URL ✨ ] │  primary → URL extractor (if you have a site)
│   Paste any site; we read it into │
│   a brand you own.                │
│                                   │
│ [ ◈ Describe your brand ]         │  secondary → Market Canvas (no site needed)
│ Connect a Google Sheet   ·  Later │
└──────────────────────────────────┘
```
The second option (Market Canvas / "Describe your brand") is what makes this honest for a **pre-site founder** with no URL to import (§1.6, §6.4) — the zero-prerequisite path is always present.

#### 3.7.2 Empty Store Home
No installed wrapps. Home leads with the **extractor wrapps that exist right now**, framed as "start here." Copy: "The best wrapps read *your* context. First, make some." Which producers appear is gated on what has shipped (§4.1): the URL teardown and Market Canvas from the first fortnight; the Email/EA extractor only once it lands *and* only surfaced with its MCP-setup precondition named. Only below the producers does the general grid appear. This is the marketplace "seed supply first" move rendered as IA.

#### 3.7.3 Empty Vault — the keystone
The Vault with zero objects is the highest-leverage screen in the product; it must feel like a beginning, not a 404. It offers **only producers that exist and whose prerequisites the user can meet**:

```
┌───────────────────────────────────────────────────────┐
│  YOUR CONTEXT IS EMPTY                                 │  kicker, centered
│                                                         │
│  Switchboard gets powerful when your apps share        │
│  one graph of what you own — your brands, your          │
│  tasks, the people and events around them.              │
│                                                         │
│  Fill it by running an extractor:                       │
│                                                         │
│  ┌─────────────────────┐  ┌─────────────────────┐      │
│  │ ⤓ Import from a URL │  │ ◈ Describe a brand  │      │
│  │ RECOMMENDED         │  │ No website needed.  │      │
│  │ One site → a brand  │  │ 3 fields → a brand  │      │
│  │ you own.            │  │ you own. [ Run ]    │      │
│  │ [ Run ✨ ]          │  │                     │      │
│  └─────────────────────┘  └─────────────────────┘      │
│                                                         │
│  Connected your email? ✉ Import tasks & people from     │  ← shown only if a
│  Gmail — needs your Gmail connector first. [ Set up ]   │     Gmail MCP is present
│                                                         │
│  Every extractor is read-only and asks before it        │  reassurance
│  touches anything.                                      │
└───────────────────────────────────────────────────────┘
```

Three decisions make this specific to Switchboard: (1) it offers **options with one marked RECOMMENDED** (the brandbrain "never a single answer" rule — URL import is recommended *for users who have a site*), (2) a **zero-prerequisite fallback** (Describe a brand → Market Canvas) so a pre-site founder is never stranded, and (3) the **Gmail/EA row is conditional and names its precondition** — it appears only when a Gmail MCP is connected, and otherwise routes to **Connections ▸ Add MCP server** rather than dead-ending on an extractor the user can't yet run. Running any of them launches the producer wrapp, which on completion `publish`es its objects and the Vault re-renders populated.

### 3.8 Cross-surface consistency checklist (build-time invariants)

An engineer building any surface above must hold all of these:

1. **One accent.** Lime is the only decorative colour; `ok/warn/danger` are semantic-only and never stand in for the accent. **No brand palettes anywhere in chrome** — the `swatches` field is never rendered; per-object identity is the lime initial-mark + monochrome kind-glyph only.
2. **Mono for all data.** Every number, count, hex, timestamp, kind-tag, origin, and path is Spline Sans Mono with tabular-nums where columnar.
3. **Kinds are recognisable pre-read.** Every `ContextKind` has one fixed monochrome glyph, used identically in the kind rail, kind-tags, consent rows, and app cards.
4. **The chip never manages.** Any management affordance that appears on a chip is a bug; it belongs in the panel. The chip has three renderable states + `booting`; there is no offline state until the liveness signal ships.
5. **Consent is one renderer, one surface.** All consent is the shared `renderConsent` output, inline in the panel, *never* a separate window. A new kind is a new branch, never a new renderer and never a new render target.
6. **Access badges are the daemon's.** Every read/write badge reflects the daemon's out-of-band classification, never a manifest claim; the store may show a manifest's *requested* capabilities but never presents them as the grant.
7. **Provenance before kind, and titles are not "safe".** Any surface that shows context to a *human deciding to lend it* leads with where it came from. For `person`/`event`/`task`, the title itself is PII — disclose it on the trusted panel to inform the decision, but never log it and never call it "metadata-only, safe."
8. **No dead empty states.** Every empty region ends in a button that runs an extractor/producer *that exists and whose prerequisites the user can meet*.
9. **Widen re-consents; narrow doesn't.** Narrowing or revoking any grant (tool or context) is instant and promptless. Widening any grant re-raises the matching consent for the delta on a human click. No surface widens silently.
10. **Control channel vs app channel.** Panel, Store, and Vault may enumerate the library; apps receive only granted subsets via `query`. Never build an app-facing enumeration.

---

## 4. User flows

These are the canonical journeys through Switchboard. Each is an ordered sequence of concrete UI touchpoints — the **wrapp page** (host site + `mountConnect` chip), the **extension side panel**, the **inline consent view**, and the **daemon** — and every consent moment is named against the real primitive that fires it (`connect`, `write`, `storage-bind`, `context-pick`, and the future `context-query` / `context-import`). Where a flow depends on a not-yet-built primitive (typed multi-context consent, daemon cron, the provider liveness signal), it is flagged inline and the primitive is treated as net-new work.

A note on the recurring split, because it governs every flow: **the chip is identity, the panel is control, the inline view is consent — and consent lives only in the panel, never a window.** The `mountConnect` chip never renders a folder picker, budget slider, connector list, or revoke button — it shows "Get Switchboard" / "Connect Switchboard" / "Hi {name} · {project}" and nothing else, and its own footer says so ("Connectors, budgets & activity live in the Switchboard toolbar panel."). Any time a flow needs scope decisions, they surface in the **inline consent view** (`renderConsent`, in the panel) or the **side panel** — never on the app page, and never in a separate consent window.

### 4.1 First-run cold-start — install → pair → empty Vault → first extractor → first context exists

The cold-start is a **supply problem disguised as an onboarding problem**. A new user has no context graph, so every consumer wrapp they open greets them with "No context lent" and does nothing interesting. The job of first-run is therefore not "explain the product" — it is **manufacture the user's first Context object** by walking them into an extractor before they ever open a consumer. We front-load supply, exactly like a marketplace seeding its first listings.

**A hard sequencing constraint governs which extractors first-run may offer.** First-run must only present producers that *exist and whose prerequisites the user can meet at that moment*. In the first weeks (per §5 / First-90-days), the shipped producers are the **URL brand teardown** and **Market Canvas** ("Describe your brand"); the **EA extractor lands later (weeks 5–6) and itself requires a Gmail MCP connected first**. So first-run's "Start your Vault" card:
- always shows **Import a brand from a URL** (for users who have a site) and **Describe your brand / Market Canvas** (the zero-prerequisite path for a pre-site founder);
- shows **Connect your assistant (Gmail + Calendar)** *only once the EA extractor has shipped*, and when shown, it routes first to **Connections ▸ Add MCP server** (naming the precondition) rather than dead-ending on an extractor that has nothing to read. This honors the "no dead empty states" invariant its own sequencing would otherwise violate.

1. **Install the extension.** From the Web Store, or the "Get Switchboard" chip on any wrapp (which points at `installUrl`). `window.claude` is now injected into every page but no daemon is paired, so `whenRelayReady` resolves a provider that reports **not paired**.
2. **Open the side panel; land on the pairing card.** Status pill reads `not paired`. The panel renders its **pairing state**: "Run `npm run sidekick` and paste your pairing token." The one place raw setup detail is allowed, because there genuinely is a local process to start.
3. **Start the daemon.** `npm run sidekick` boots on the signed-in Claude Code CLI, auto-imports MCP servers and inherited claude.ai connectors, and prints a pairing token.
4. **Pair.** Paste the token into the panel. Status pill flips to `on` (the `getStatus` reachability check passes). The daemon is now the enforcement point for this browser.
5. **Set your name (identity seed).** The `⋯` menu offers **Set your name**; first-run pre-opens it. This is the "Hi {name}" the chip will greet with — the *person*, deliberately never a context (the chip's anti-collision logic ensures it never greets you by your brand's name).
6. **Land in the empty Vault — framed as an invitation, not a void.** The **Working on** section has no project. Instead of an empty picker, first-run shows the **"Start your Vault" card** (§3.7.1/§3.7.3) with the extractor entry points that exist right now — URL import and Describe-your-brand always, the EA path only if shipped-and-preconditioned. The card names the payoff in graph terms: "Switchboard gets useful once you own some context. Pick one to create your first."
7. **Run the extractor — import-brand-from-URL (recommended *if you have a site*).**
   1. The extractor wrapp opens with the standard **Connect Switchboard** chip. Click it → the **`connect` consent** fires inline in the panel: models (an inference lend — the teardown is an LLM call) and the app's WebFetch tool, with **daemon-derived** read/write badges and editable budgets. Approve.
   2. The wrapp shows a single URL field. Paste the store/site URL, hit "Import."
   3. Because the import makes the *daemon* fetch a network URL and then *publishes a Context the user owns* (not the app), it triggers a **`context-import` consent** — **egress-guarded exactly like `sb_http`** (§2.6.5): the exact URL is shown and the untrusted string displayed-never-executed, and the daemon applies the `sb_http` denylist (no `file://`, no loopback, no `169.254.x`/cloud-metadata IPs) and byte cap before fetching. (Net-new: today `ContextSource` supports `csv`/`gsheet`; `kind:"url"` + an `import` op are the additions, and the egress guard is imported from the `sb_http` design even though import ships first.)
   4. The daemon fetches the page, runs the brand-teardown extractor over an LLM call, and **publishes** a `Context { kind:"brand", source:{kind:"url"} }` owned by the user.
   - *(Pre-site founder path:* if the user has no site, they instead pick **Describe your brand / Market Canvas**, type a short brief, and the wrapp publishes a `brand.market` slice — same outcome, no URL, no egress.)*
8. **First context exists — reflected everywhere at once.** **Working on** now shows the new brand as the active project; the wrapp's chip flips from "No context lent" to "Hi {name} · {brand}". The "Start your Vault" card is replaced by the normal populated Vault. First-run is complete: the user owns exactly one real, reusable object.

**Top intuitiveness pitfall:** the classic empty-state trap — a brand-new user opens a *consumer* wrapp first (Prism, chat), sees "No context lent," and concludes the product is broken. **How the UI prevents it:** first-run refuses to dump the user into a consumer. Step 6 replaces the empty Working-on picker with a **"Start your Vault" card whose only actions are extractors that exist**, and the panel's **This tab** classifier reinforces the ordering — if the user does wander onto a consumer wrapp with an empty Vault, "This tab" says *Connected* but the empty picker offers "Create your first context" (routing to a shipped producer) rather than a silent blank.

### 4.2 Connect a wrapp

The atomic handshake every wrapp shares, so connecting "feels the same everywhere."

1. **Arrive on a wrapp page.** The `mountConnect` chip shows one of its states: **Get Switchboard** (not installed), **Connect Switchboard** (installed, no grant *— or, per the fail-open gap §3.3, a daemon that is down, which currently reads the same; a returning user should be aware a "Connect" prompt can also mean "your sidekick isn't running"*), or the **Hi {name} · {project} pill** (already granted — a returning user auto-reconnects on load because the grant persists, and `onConnect` fires without a second click).
2. **Click "Connect Switchboard."** `relay.connect(opts.scope)` fires; the app's declared `ScopeRequest` (models, tools, optional `reason`) is sent to the daemon, which pushes a `consent:connect` prompt **into the panel** (badging the icon and best-effort opening the panel if it's closed — never a window).
3. **Inline `connect` consent (in the panel).** `renderConnect` shows: the origin host ("Connect to **{host}**?"), the italic `reason` if provided, a **Models** checklist (pre-checked to the requested set), a **Tools** checklist (only what the site asked for, each with a **daemon-assigned** `read`/`write` badge — not the manifest's claim), and editable **Budget** inputs (max tokens/day, max calls/min). All-or-none toggles per section; the user can **narrow** (uncheck models/tools, lower budgets) but the app can never widen later without a fresh consent.
4. **Approve.** The daemon records an `OriginGrant` for this origin. Background stamps the origin from `port.sender` — the page can never forge it.
5. **Chip becomes the pill.** The chip re-pulls identity + active project and renders "Hi {name} · {project}". The wrapp can now call `window.claude`.

**Consent moments:** exactly one — `connect`. No folder or context consent fires here unless the app separately calls `storage.bind` / `context.pick` / `context.query` (§4.3, §4.4, §4.7).

**Top intuitiveness pitfall:** **over-granting by reflex** — users approve whatever is pre-checked, and a chip that requested five tools when the app needs one trains blanket approval. **How the UI prevents it:** the Tools section renders **only the tools the site actually requested** (never the full tool library), each carries a **daemon-derived red `write` / green `read` badge** so danger is visible at a glance (and cannot be understated by a lying manifest), and the per-section **All / none** plus editable budgets make narrowing a one-click affordance. The consent view is deliberately the *only* place scope is set, so the decision happens once, in context, with the origin named at the top.

### 4.3 Lend / switch a single context

The current, shipped context model: **one active context per app**, selection *is* consent, chosen out of band.

1. **From the chip (identity path).** On a connected wrapp, click the pill → the menu shows **Working on** with the current project and a **Switch ▸** (or **Choose ▸** if none). Clicking it calls `relay.context.pick()`.
2. **Inline `context-pick` consent (in the panel).** `renderContextPick` shows "Lend a brand to **{host}**?" with the invariant restated in the UI: *"The app receives ONLY the one you pick, for this session. It never sees the rest of your library."* The user's own brands render as **radio buttons** (single-select, first pre-selected), each with a kind badge. If the Vault is empty, it degrades honestly: "No brands yet — build one in brandbrain first," with the action disabled.
3. **Pick and lend.** Select one, click **Lend brand**. The daemon sets that origin's active context. The picker never enumerates anything the app can read on its own — only the panel (the control channel) can list the library.
4. **Live reflection.** `onProjectChange` fires; the chip re-renders "Hi {name} · {new project}", and because the chip subscribes to `permissionsChanged`, the same switch made from the **side panel's Working on picker** (bottom-sheet, grouped Projects / Brands / Data sources, with a "Connect a Google Sheet" add-source form) reflects into the chip live, and vice versa.

**Consent moment:** one — `context-pick` (radio, single object). Distinct from the connect grant; you can be connected with no context lent, and lending a context is a separate, revocable act.

**Top intuitiveness pitfall:** the user fears "lend my brand" means the app can now **read all their brands**, or doesn't realize a *different* app still has the old one. **How the UI prevents it:** the consent copy states the isolation invariant in plain language every single time ("ONLY the one you pick … never sees the rest of your library"), the selector is a **radio, not a multi-select**, and context is **scoped per origin** — the pill on *this* wrapp shows *this* app's lent project, so "what this app sees" is always the thing named in front of you. Switching here changes only this origin.

### 4.4 Typed multi-context consent — the game requests `task` + `person`

The **pivotal evolution**, explicitly *not built today*: it extends the single-select primitive into a **scoped, typed, revocable, audited read across the graph** via `context.query({ kinds })`. The load-bearing new pieces are a `ContextGrant` on `OriginGrant`, a `context` field on `ScopeRequest`, a `query` op, and the `AuditEntry` extension of §2.4.4 — all additive, all preserving the "never enumerate the library" invariant.

1. **Open the "life is a game" RPG wrapp.** It needs to read the user's real tasks and people to spawn quests and NPCs, so its `ScopeRequest` declares `context: { kinds: ["task","person"], reason: "Turn your real to-dos into quests and the people you work with into NPCs." }` alongside its inference lend.
2. **Connect fires a combined consent.** The inline `connect` view renders as in §4.2 **plus the typed "Context access" section** (§3.5.5) — a row per requested kind. Each row leads with **provenance** ("tasks from your Gmail"), a checkbox (narrowable — drop `person`, keep `task`), and a mode toggle: **All** (all objects of this kind, *present and future*, labelled "including ones you add later") vs **Selected** (an explicit id allowlist). **`person` starts on `Selected`** (sensitive-kind default); the user opts up to `All` only with an extra confirm. A **Preview** discloses ≤3 titles, labelled "titles; app gets full text," so the disclosure asymmetry (human sees titles, app receives full `data`) is stated, not hidden.
3. **Narrow if desired.** Say the user keeps both kinds, leaves `task` on **All**, and keeps `person` on **Selected** with three specific people — happy to expose all tasks but only some contacts. Recorded as `ContextGrant { kinds:["task","person"], mode per kind, ids:[…] for person }`. The `task:all` choice mints the **standing "reads ALL tasks, incl. future" indicator** that will live in the app card.
4. **Approve.** The daemon records the `ContextGrant` on the origin's `OriginGrant`, *alongside* tools — so it is revocable and re-scopable in the panel exactly like a tool.
5. **The app queries.** The RPG calls `relay.context.query({ kinds:["task","person"] })`. The daemon returns **only** the granted slice — all `task` objects, the three allow-listed `person` — as **full `data` payloads** (`ContextResult.items`). It cannot see anything outside the grant, and still cannot enumerate the library. Because `task` is `mode:"all"`, this and every *future* task the user adds is in scope with no further prompt — which is exactly why the standing indicator and the first-read audit line (below) exist.
6. **Every read is audited by count + kind.** The activity view shows "**the game read 12 tasks and 3 people**," and — once the §2.4.4 `AuditEntry` extension ships — flags the **first read of each newly-created task** by this `all`-scoped origin, so a future object entering scope is visible. A `query` is a *read* under the existing `ConsentTier` model (pre-approved within the granted kinds), so it doesn't re-prompt per object, but it is logged **by count and kind only — never by title** (`AuditEntry.note` stays non-sensitive).
7. **Revoke / narrow / widen in the panel.** The app card's **Context access** row mirrors the `ContextGrant`: **narrow instantly** (drop a kind, switch `all`→`selected`, remove ids, revoke), independently of tools and of the single-`active` brand lens. **Widening** (add a kind, `selected`→`all`, add ids) **re-raises `consent:context-query` for the delta** on a human click (§2.6.4) — there is no silent widen.

**Consent moments:** the typed `context` grant is approved *inside* the connect consent (one click covers connect + typed context), then optionally narrowed (no prompt) or widened (fresh `context-query`) later in the panel. Reads within scope don't re-prompt; they audit by count and kind.

**Top intuitiveness pitfall:** **"typed kinds" is an abstraction the user has never seen, *and* an `all` grant silently reaches future objects** — a checkbox that says `task` reads like jargon, and the user can't tell whether approving it means "some tasks" or "my entire life, forever." **How the UI prevents it:** the Context access section speaks in **objects with provenance, not types** ("tasks from your Gmail"), shows *named objects* when the user picks **Selected** (three specific people, by name), spells out **"all — including ones you add later"** on the `all` option, defaults sensitive kinds to **Selected**, and lands the grant in the same per-app card as tools with a **standing "reads ALL tasks" badge**. The audit line ("read 12 tasks," plus first-read-of-new flags) closes the loop by making the abstract, forward-reaching grant visibly concrete after the fact.

### 4.5 Discover + launch a wrapp from the store

Today "install" is theater — an `<a href>` to a co-located HTML file with fake ratings and no grant. The target flow makes **install a scoped grant**, driven by a real manifest, so launch carries an established consent instead of cold-calling `window.claude`.

1. **Enter discovery.** Open the **Wrapp Store** — either the side panel's launcher grid (green dot = already connected) or the full store surface (rail: Home / Store / Connectors / Permissions / Activity / Billing / Settings; a Context switcher; Installed / Featured / Popular). Both are driven by **one manifest keyed by stable `id`**, so a wrapp is declared once, not transcribed three times under three names, and the `store.js:41-56` INSTALLED-by-name / duplicate-`persona.html` / fake-ratings drift is gone (§2.7).
2. **Search / filter over the manifest.** The `#q` search and filters operate on real fields: **category** (chat/editor/canvas/research/commerce), **capability** ("apps that only need inference" vs "apps that touch my Gmail"), **tier** (A/B/B*/C), and **context-kind** (producer/consumer). The store's unique hook fires here: **"Works with your active context"** — the store surfaces consumers whose declared context-kinds match the user's current Vault slice.
3. **Open a wrapp detail.** The card shows identity (name, author, **Verified** / **Airgapped** badges — real, not cosmetic) and, crucially, the **capability declaration labelled *requested***: exactly which of the three lends it asks for — inference (+ model scope), context (which `kinds` it queries), backend (bound folder? which MCP servers / `sb_*` capabilities?). This is the pre-consent *disclosure*, not the grant: the actual access class of each tool is **re-derived by the daemon at consent time and may be stricter** (§2.6.1).
4. **Install = scoped grant, not a bookmark.** Clicking **Install** adds the wrapp to the `INSTALLED` set **by `id`** **and** records the granted capability scope per origin, running the same `connect`/`context`/`storage-bind` consent the wrapp would otherwise trigger on first open — **with daemon-derived badges**, so what the user approves is the real access class, not the manifest's claim. Install is where the store meets the panel's permission model.
5. **Launch carries the grant.** Opening the installed wrapp finds an existing `OriginGrant`; the chip auto-reconnects to the pill, and the app runs immediately with no cold consent handshake.
6. **This-tab reciprocity.** If the user is instead on a *non-wrapp* site with an `alternativeTo` mapping (e.g. Canva), the panel's **This tab** section suggests the matching wrapp (Prism), routing discovery back through the surface the user is already looking at.

**Consent moments:** consent is pulled **forward to install** (from the manifest's *requested* capabilities, re-classified by the daemon) rather than deferred to first API call — so scope is reviewed once, with full disclosure, at the moment of choosing.

**Top intuitiveness pitfall:** **"install" reading as a heavyweight, irreversible commitment** — or the opposite, users not realizing install *granted real permissions* because legacy "install" meant nothing. **How the UI prevents it:** the detail page's **capability declaration makes install self-describing** — the user sees "needs inference + your `task` context + a bound folder" before clicking, so install visibly *is* the grant, and the same familiar consent view (with the daemon's real badges) confirms it. Uninstall/revoke lives in the panel's Permissions surface, mirroring the granted scope, so the commitment is legibly reversible. Verified/Airgapped badges are typed and honest.

### 4.6 The full EA → game reuse loop, end to end

The flywheel the entire architecture exists to enable: **one `task` object, produced once by a serious tool, reused by a playful one — same object, two surfaces.** It threads the extractor (supply), typed multi-context consent (the unlock), and a producer→consumer handoff through the graph, and surfaces the known gaps (MCP-setup precondition, scheduled execution, cross-machine persistence) honestly.

1. **Precondition — connect the Gmail/Calendar MCP.** Before the EA can produce anything, the user adds their Gmail/Calendar MCP server in **Connections ▸ Manage MCP servers** (§2.4.3). This is a real first step, not assumed away: the EA's entire value is gated on it, so the flow names it.
2. **Run the EA extractor (producer).** Open the Executive-Assistant wrapp and connect. The `connect` consent lends inference + the user's **Gmail** and **Calendar** MCP tools (read badges dominate; any send/modify is a `write` badge, per the daemon's classification). The EA reads inbox + calendar and, via `context.publish`, mints typed objects the user owns: `task` (to-dos from mail), `person` (correspondents), `event` (calendar items). The Vault now has real `task`/`person`/`event` supply. *(Producer-write mechanics, including the single-writer-per-slice rule, in §4.7.)*
3. **[Known gap — scheduled refresh] Keep it current.** For the EA to re-extract new mail daily without the user reopening the tab, a **daemon cron** must run the extractor on a schedule — which breaks the pure-airgap "nothing runs when the tab is closed" invariant and is therefore **net-new committed work**, and **read-only** when it runs (a refresh job reads mail and publishes context; it may not perform a `write`-classed tool action unattended — §5-vii). The panel would grow a **Scheduled tasks** surface (view / pause / run-now). Until cron ships, refresh is manual: reopen the EA. The loop *works* without cron; it just isn't continuous.
4. **Open the "life is a game" RPG (consumer).** Launch from the store. Because its manifest declares `context.kinds:["task","person"]`, install/connect runs the **typed multi-context consent** of §4.4. Approve (say, `task:all`, `person:selected`) — with the `task:all` standing indicator and future-objects note as specified.
5. **The graph does the reuse.** The RPG calls `context.query({ kinds:["task","person"] })` and receives the *same* `task` and `person` objects the EA produced — **no re-extraction, no copy, full payloads**. Each to-do becomes an NPC quest; each granted person becomes an NPC. The exact object that is a to-do in the EA is a quest here; if the user also runs brandbrain OS, that same `task` is a runbook item there — **one object, three surfaces**. When the RPG marks a quest done, it writes to **its own slice** on the task (e.g. `task.rpg.questState`), never over the EA's fields (§4.7).
6. **Cross-app coherence is visible in the panel.** The **Connectors** and **Apps** sections show the EA (produces task/person/event) and the RPG (consumes task/person) as distinct origins; the Vault object detail shows the EA as *writer* and the RPG as *reader* of the same task; the activity feed shows "the game read N tasks" (count + kind), so the user can *see* the reuse and revoke the RPG's context access without touching the EA.
7. **[Known gap — persistence beyond one machine] The object is local.** The Vault lives on the paired machine. Reusing the same `task` on a second device requires **cross-machine sync** — also net-new, also outside today's pure-client model, and flagged as a first-class roadmap bet (§6.5) rather than assumed.

**Consent moments across the loop:** MCP-server add (Connections, a one-time authorize); EA `connect` (inference + Gmail/Calendar, `write` on any send); EA producer writes (§4.7, no re-prompt for own-slice writes); RPG typed `context-query` consent (§4.4). The handoff *between* producer and consumer requires **zero** direct app-to-app permission — the graph is the only channel, and the user is the only party who can widen what the consumer sees.

**Top intuitiveness pitfall:** the user **cannot see that reuse happened** — the RPG "just knows" their tasks, which feels either magical (untrustworthy) or invasive. **How the UI prevents it:** the two acts are visibly separated and independently governed — the user *personally granted* `task`+`person` to the RPG in a typed consent that named exactly those kinds and their future reach, and the activity feed attributes the read to that grant. Provenance is legible: the Vault shows the EA as the *producer* (writer of specific fields) of those objects and the RPG as a *consumer* (reader, writer only of its own slice), so "how does the game know" has a concrete, revocable answer the user authored. Nothing crosses app-to-app; the user is always the broker.

### 4.7 A wrapp writing context back (produce) — and the single-writer rule for shared objects

The supply-side act: a producer wrapp doesn't just consume — it **writes typed objects into the graph the user owns**, seeding reuse for every downstream consumer. This is how brandbrain finalizes a `brand`, how Cast locks a `persona`, how the EA mints `task`s. It is also where the "seven wrapps share one `brand`" claim must be made safe, because `publish` with an `id` **updates in place** (`context.ts:65`) and `list` returns only the caller's own published contexts — so the write model must say *who may write what* on a shared object.

**The write-authority model: single-writer-per-slice.** The "same `brand` object read by seven wrapps" is composed of **named slices**, and **each slice has exactly one producer**: Naming owns `brand.name`, Voice owns `brand.voice`/`brand.identity`, Market Canvas owns `brand.market`, Pricing owns `brand.pricing`, the RPG owns `task.rpg.*` on a task it consumes. A producer `publish`es (creates/updates) **only its own slice**; it never writes another producer's slice. This makes the shared object real without a clobber risk: two mini-wrapps open at once (Naming + Voice) touch disjoint slices, so concurrent publishes cannot conflict. Where a genuinely shared field is unavoidable, the object's **owner-origin** (the producer that created it) must grant a `ContextWriteGrant` before another origin may write it — but the default and the design target is disjoint single-writer slices, which is why the split strategy (§6.3) assigns each mini-wrapp exactly one slice. The read-before-write / last-write-wins discipline that today guards the shared *folder* (§6.1) extends to `context.publish` on any shared object, so even within a single slice a producer reads current state before writing rather than blind-overwriting (§5-i, §6.3).

1. **Do the work in-app.** The user runs the wrapp's real flow — brandbrain's gated assembly board finalizes every locked decision; Cast completes its gates and locks the persona foundation. Inference is the visitor's Claude under the existing `connect` grant.
2. **[If the app binds a workspace folder] `storage-bind` consent.** Wrapps like brandbrain bind a local folder as their workspace (via `bindFolder`), which fires the **`storage-bind` consent** inline in the panel: "Let **{host}** use a folder?" showing the exact path, warning "it can read and write files there, and nowhere else." Per-origin structural isolation (`folderFor(origin)`), approved once. Distinct from context — the folder is the app's private store; the Context is the user's shared graph object.
3. **Publish to the graph — own slice only.** The wrapp calls `context.publish`. It **creates** (no `id`) or **updates in place** (with `id`) *its own slice*, and `list` returns **only this app's own published contexts** — a producer sees what it wrote, never the rest of the library. The published object is **owned by the user**, not the app: it survives the app being disconnected and is lendable to *other* apps.
4. **Confirmation, not consent.** Writing a Context the user owns from data the app already legitimately holds does **not** re-prompt — the write is to the user's own graph, gated by the existing grant, on the app's own slice. (Contrast a `write` *tool* action — sending an email, spending money, mutating an MCP resource — which fires the per-action **`write` consent** every time: "This may send, change, delete, or spend.") The **`context-import` extractor** case (§4.1) *does* prompt, because it makes the daemon fetch the network (egress-guarded, §2.6.5).
5. **The new object appears in the Vault immediately.** The **Working on** picker and the chip's project list now include the published `brand` / `persona` / `task`. Its source badges its provenance ("imported from {host}", or app-produced), and the Vault object detail names *which slice* this producer wrote. From this moment it is available to §4.3 (lend singly) and §4.4 (query by kind) for any other wrapp.
6. **Reuse is now free.** Prism and adgen, which today *re-extract* brand data from a URL, can instead read this published `brand` via `context.query({ kinds:["brand"] })` — the produce step is precisely what lets consumers stop re-extracting and start reusing.

**Consent moments:** `storage-bind` once (if the app uses a workspace folder); `context.publish` writes **without** a re-prompt (own-slice write to the user's graph under the existing grant); `write` tool consent per external side effect; `context-import` prompts (egress-guarded) only for URL-fetching extractors.

**Top intuitiveness pitfall:** the user **doesn't realize a durable, reusable object was just created** — they think they "made a brand *in brandbrain*," app-scoped and trapped, and never discover it's a portable graph object. The supply flywheel dies if producers feel like silos. **How the UI prevents it:** the moment `publish` lands, the object **surfaces in the panel's Vault and the chip's project switcher** — the same surfaces every *other* wrapp reads from — so the user sees it escape the producing app immediately, with a provenance badge and a "written by" attribution naming which slice this app owns. The consistent "Working on" language across chip and panel makes "this is a thing I own and can lend" the obvious reading. And because the folder (`storage-bind`, app-private) and the Context (`publish`, user-owned graph) are approved through **visibly different consents**, the user learns the durable/portable object is the Context, not the workspace files.

---

## 5. Capability roadmap

This is the build order that unblocks the vision. Each capability is a **module behind the daemon's capability registry** — the small trusted core (`Capability { methods, scopeKey, describeScope, posture, handle }` from `docs/CAPABILITIES.md`) never grows as we add rows to it. Every capability inherits the non-negotiable invariants: origin oracle, daemon-only enforcement, human-click consent (fail-closed, one surface — the panel), default-deny classification, data locality, structural per-origin isolation, context-is-consent, exact-match-plus-narrowing grants (with alias canonicalization, §1.4), full audit, small TCB. Where a capability *does* strain one (cron dents the airgap; multi-context `all` reaches future objects), it is called out explicitly and made opt-in.

**Two ordering lenses, reconciled.** `docs/CAPABILITIES.md` commits a *technical* build order optimized for TCB safety: registry refactor → `sb_db` → `sb_secrets`+`sb_http` → `sb_exec` last. This roadmap keeps that order for the backend primitives, but **front-loads the two context capabilities ahead of them**, because they unblock the pivotal Vault evolution and the cold-start supply flywheel — the product's actual bottleneck — while touching a subsystem (`claude_context`) that already ships. The one place we re-sequence a committed doc is here, and the reason is leverage, not convenience: a `brand` slice that three wrapps can read is worth more this quarter than a per-origin SQLite file.

**Prerequisite (P0) — capability registry + naming facade + the liveness signal.** Before any new row, land the two refactors `docs/CAPABILITIES.md` §Rollout 1–2 already specify: (a) introduce `window.switchboard` as the canonical provider with `window.claude` kept as an alias for the inference asset, sub-namespaced as `.model / .context / .storage / .db / .http / .secrets / .exec`; (b) move the shipping `claude_storage` and `claude_context` behind the `Capability` registry with **no behavior change**. **P0 also lands the provider liveness signal** the chip and panel need to stop failing open (§2.3, §3.3): a cheap `claude_ping` / `capabilities` call that distinguishes *transport-down* from *ungranted*, so `refresh()` can render a real **offline** state instead of collapsing a dead daemon into "Connect Switchboard." Without it, the OFFLINE states in the IA are undeliverable; with it, they become a one-line branch in the chip and panel. Wire methods stay `claude_*` for ≥1 MINOR, then migrate to `sb_*` with aliases — additive, versioned (`version.ts`), never a breaking cutover. Mostly plumbing; ships first, with one user-visible win (honest offline).

The seven capabilities, in order.

### (i) Typed multi-context consent — `context.query` + kind taxonomy + scoped grant + audit extension

**What it is.** The evolution of `claude_context` from *one opaque blob chosen out of band* into *a scoped, typed, revocable, audited read across the context graph*. Today a consumer reads exactly one context (`active`). This adds a `query` op that returns a **typed slice** of **full payloads**:

```ts
// packages/protocol/src/context.ts
export type ContextKind =
  | "brand" | "task" | "person" | "event" | "decision" | "note" | "asset" | (string & {});

export interface ContextQuery { kinds: ContextKind[]; limit?: number; updatedSince?: number; }

export type ContextOp = "publish" | "active" | "list" | "pick" | "query";  // + "query"
// ContextRequest gains `query?: ContextQuery`
// ContextResult gains `items?: Context[]`  — FULL payloads the user consented to lend for these kinds
```

`kind` promotes from a free-form string to a `ContextKind` union — still extensible via `(string & {})`, but now giving the consent layer a **known set to grant against**. `Context.kind` and `ContextMeta.kind` retype to `ContextKind`.

**What it unblocks.** The entire cross-domain consumer class. The RPG reading `context.query({ kinds: ["task","person","event"] })` to turn Cast's calendar slots and the EA's people into quests and NPCs; `adgen`/`imagegen` reading `context.query({ kinds:["brand"] })` from the graph instead of re-extracting on every run (they are `brand`-consumers today, wastefully re-deriving what brandbrain/Cast already produced); the EA reading `task`/`person`/`event` across producers. First in the order because it is the product's pivot, and because it extends a shipping subsystem rather than adding a new trust surface.

**Protocol + consent impact.** The load-bearing change is that context consent **stops living out of band** and becomes part of the recorded, revocable `OriginGrant`:

```ts
// packages/protocol/src/permissions.ts
export interface ContextGrant {
  kinds: ContextKind[];              // typed kinds this origin may query
  mode: "all" | "selected";          // all objects of these kinds (present+FUTURE), vs an explicit id allowlist
  ids?: string[];                    // when mode:"selected"
  expiresAt?: number;
}
// OriginGrant gains  context?: ContextGrant
// ScopeRequest gains context?: { kinds: ContextKind[]; reason?: string }
```

The connect prompt renders one row per kind — *"This app wants to read your **task** and **person** context"* — approvable, narrowable, revocable in the panel exactly like a tool grant. **Posture:** a `query` is a **read**, preapproved *within the granted kinds/ids only*; it never prompts inside scope, and can never widen. **The `mode:"all"` reach is a named risk, not a footnote:** `all` covers **present and future** objects and returns **full `data`**, so a `task:all` grant silently admits every task a future extractor files. Mitigations are committed here, not deferred: (a) `all` grants carry a **standing, revocable indicator** in the app card and Vault; (b) `person`/`event` **default to `selected`**, with `all` requiring an extra confirm; (c) the consent preview shows **titles only** while the app receives full `data` — a **disclosed** asymmetry (§3.5.5). **The enumeration invariant is preserved and this is the crux:** `query` still never enumerates the library — it returns *only the granted subset*. `active`/`pick` stay untouched for the single-brand lens; the connect chip is unchanged (identity still uses `active`).

**Audit is part of this capability's work, not assumed.** The ledger's "the game read 12 tasks" line requires an `AuditEntry` extension, because today's shape (`packages/protocol/src/audit.ts`) has **no** field for context kind or ids, and its `kind` field is an *entry-type* enum that collides with "context kind." So (i) includes:

```ts
// packages/protocol/src/audit.ts — extend, and rename to avoid the ContextKind collision in copy
// add either a dedicated entry type or fields:
//   entryType: ... | "context_read"
//   contextKinds?: ContextKind[]; contextIds?: string[]
```

with the hard constraint that reads are logged **by count + kind + ids only**, never by object title or `data` — `AuditEntry.note` "must stay non-sensitive," so the human-facing consent previews (titles) are **never** written to the ledger. **SDK:** `context.query(q) → items ?? []`. **Panel:** a new per-origin "Context access" section mirroring `OriginGrant.context`, with per-kind narrow/revoke inline and **widen only via a fresh `consent:context-query`**; the read-before-write discipline extends to `publish` on shared objects (single-writer slices, §4.7).

**Depended on by:** Tier B\* and cross-domain consumers generally — the EA/skill-pack wrapps, the RPG, and any consumer wanting more than one brand. The difference between a wrapp gallery and a context graph.

### (ii) Context-import from URL — extractor source kind, refreshable, egress-guarded

**What it is.** The **supply-side extractor** primitive: generalize the existing `ContextSource` (which backs a context with a CSV/gsheet URL the daemon fetches and parses) to a `"url"` page-teardown kind. The daemon fetches the page and an LLM call (the same completion path) produces a typed `Context` (`kind:"brand"`) whose `data` is the structured teardown.

```ts
// packages/protocol/src/context.ts
export interface ContextSource {
  kind: "csv" | "gsheet" | "url";     // + "url"
  url: string;
  fetchedAt?: number;
  extractor?: string;                 // id of the lens that produced `data` from `url` (e.g. "brand-teardown")
}
export type ContextOp = "publish" | "active" | "list" | "pick" | "query" | "import";  // + "import"
// ContextRequest gains  import?: { url: string; as?: ContextKind; extractor?: string }
```

`import` fetches `url`, runs the named extractor, and **publishes the result as a Context owned by the user** (not the app), returning its `id`. Because it is source-backed and `extractor`-stamped, it is **refreshable** — re-running `import` re-derives `data` in place, exactly as the CSV/gsheet cache already refreshes.

**What it unblocks.** The marketplace cold-start. Import-from-URL is a one-click "read-only brand teardown" that seeds a `brand` context for a user *with an existing web presence*, giving downstream consumers something to read on day one — the "seed supply first" move a two-sided marketplace lives or dies on. (For pre-site founders the zero-prerequisite seed is Market Canvas, §6.4.) Second in the order because it is the cheapest way to *fill* the typed graph that (i) just made queryable.

**Protocol + consent impact.** `import` makes the daemon fetch a user-supplied URL on the user's behalf — the **identical egress primitive** `sb_http` guards. Since import ships *before* `sb_http` (ii before iv), the guard is **imported early, not skipped**: the `context-import` consent shows the exact URL (untrusted string displayed-never-executed) *and* the daemon applies the same egress rails `sb_http` mandates (`docs/CAPABILITIES.md:145`) — **no `file://`, no loopback, no `169.254.x`/cloud-metadata IPs, per-origin byte cap** — so a pasted `http://169.254.169.254/…` or `file:///etc/…` is denied by import exactly as it would be by `sb_http`. Import is, in effect, a constrained `sb_http` GET and reuses that egress guard rather than inventing a weaker path-only model. `ContextMeta.sourceKind` widens to `"csv" | "gsheet" | "url"` so the panel badges imported contexts as *"imported from {host}"* with a refresh affordance. The extraction is a normal audited inference call; the publish is owned by the user, so no consuming origin gains anything it wasn't already granted under (i).

**Depended on by:** the supply side of the whole store; the mini-wrapp split (§6.3) leans on it — Market Canvas, Naming, and Voice/Identity all want a seed `brand` to condition on.

### (iii) `sb_db` — per-origin embedded database

**What it is.** A real relational backend the daemon hosts, zero provisioning — one SQLite file per `(origin, db name)` under `<stateDir>/db/<origin-slug>/<name>.sqlite`, the exact `folderFor(origin)` isolation pattern the store already uses.

```ts
sb_db: {
  params: { sql: string; args?: unknown[] } | { batch: Array<{ sql: string; args?: unknown[] }> };
  result: { rows: unknown[]; rowsAffected: number };
}
```

**What it unblocks.** Ports whose "backend" is a client-shaped DB with no home beyond IndexedDB/OPFS. The first of two capabilities that materially widen **Tier B**: **LobeChat** (ships a client-side PGlite DB), **OpenCut** (editor state), any ported app whose Prisma/Drizzle/`better-sqlite3` layer was accounts-and-state, not multi-user server logic. First *backend primitive* because `CAPABILITIES.md` ranks it lowest-risk: self-contained, no new egress, no credential surface.

**Protocol + consent impact.** **Scope:** `db: { name }`. **Posture:** `SELECT` = read; `INSERT/UPDATE/DELETE/DDL` = write, gated by the app's mode (`readonly` blocks writes). Statements are **parameterized only**. **Bind, like storage:** an app may point a db at a file the user picks (path-consent), adopting real data with no migration. **Isolation is structural.** **Adapter shim:** a Prisma/Drizzle/`better-sqlite3` adapter → `sb_db`, so ported route handlers are unchanged.

**Depended on by:** Tier B ports with a local DB (LobeChat, OpenCut).

### (iv) `sb_http` — outbound proxy with credential injection

**What it is.** The strongest single expression of the thesis. The app asks to call an API; the **daemon injects the user's own connected credential and returns only the response** — the token never touches the page.

```ts
sb_http: {
  params: { method: string; url: string; headers?: Record<string,string>; body?: string;
            useCredential?: string /* a secret/connection name the daemon injects */ };
  result: { status: number; headers: Record<string,string>; body: string };
}
```

**What it unblocks.** Every port whose backend is "call a partner API with a key" — the larger half of the **Tier B** widening, and the honest alternative to MCP for one-shot API calls. Research ports (**Perplexica / GPT-Researcher / STORM**) hitting a search API; anything that talked to a REST endpoint server-side. It is what lets a static wrapp inherit the user's connected accounts without the app ever seeing a token — capability inheritance and data locality extended from inference to any API.

**Protocol + consent impact.** **Scope:** `http: { hosts: string[] }`, an allowlist; a request to an ungranted host is denied, and the first request to a newly needed host prompts. **Posture:** GET/HEAD to a granted host = read (no prompt); mutating methods = write; `useCredential` **always** requires the secret to be in `secrets` scope. **Credential injection** happens server-side. **Safety rails (the same ones already borrowed by `context-import` in ii):** no `file://`, no loopback, no cloud-metadata IPs; per-origin rate/byte budgets; response-size cap. **Adapter shim:** map `fetch`/axios → `sb_http`. Because it introduces real egress and credential handling, it comes *after* `sb_db` deliberately — but its egress denylist is authored early (for import), then reused here.

**Depended on by:** Tier B research/API ports; the credential-injection path also gives some **Tier C** integrations a lighter alternative to a full MCP server for simple stateless API calls (stateful/scheduled Tier C still belongs on MCP + cron).

### (v) `sb_secrets` — scoped credential reads

**What it is.** The daemon already *is* the credential holder; this exposes named, click-gated access.

```ts
sb_secrets: { params: { name: string }; result: { value: string } }  // prompt on every raw read
```

**What it unblocks.** The rare case where an app needs raw secret *material* in-tab (a client-side SDK that signs its own requests). The design intent is that it is **mostly consumed indirectly via `sb_http`'s `useCredential`**, so raw material need never reach the page. `sb_secrets` is the escape hatch, not the default. Ships alongside `sb_http` as the other half of the high-leverage pair.

**Protocol + consent impact.** **Scope:** `secrets: string[]`. **Posture:** a raw read **prompts every single time** — no read-without-prompt tier for handing plaintext credentials to a page; that is the point. This is the one capability that can put a secret on the page, so it is deliberately the highest-friction one and the panel surfaces every grant of it prominently. Prefer routing through `sb_http`.

**Depended on by:** a small tail of Tier B ports with client-side signing SDKs; otherwise subordinate to `sb_http`.

### (vi) `sb_exec` — sandboxed compute

**What it is.** The one real security jump: run server-only / long-running / native code with **no ambient network or filesystem** unless explicitly granted, resource-limited, and prompted — inside the airgapped runner (CSP `connect-src 'none'`). The only capability that runs *untrusted app code* in the daemon rather than in the tab, which is why `CAPABILITIES.md` is emphatic: keep app logic in the tab by default; reach for `sb_exec` only when an app *genuinely* needs native execution. For most "needs a backend" apps, **in-tab logic + `sb_db` + `sb_http` + storage covers it** — that is the 80/20; `sb_exec` is the 20 you avoid until you can't.

**What it unblocks.** The heavy tail: ports that shell out to native binaries or need long compute. The clearest fit is **Tier B\*** projects whose brain is a local toolchain — **OpenMontage** (runs `ffmpeg` locally; a Premiere-class wrapp pure-web rivals can't match), and any port whose backend was `child_process`/heavy WASM that can't live in a tab. Note these need it *least* in one sense: because the daemon already shells out to the Claude Code CLI, the OSS repo *is* the brain and much of their "execution" is already the agentic loop, not `sb_exec`. `sb_exec` is for the residual native compute those pipelines invoke.

**Protocol + consent impact.** Ships **last, opt-in, gated on the airgapped runner** being hardened. Every invocation is a `prompt`-posture write with an explicit resource/permission grant (net off by default, fs off by default, CPU/mem/time bounded). It is the sole expansion of the TCB in this entire roadmap, designed so that even a fully-compromised app inside it cannot exfiltrate: no ambient egress, structural per-origin sandbox, fail-closed.

**Depended on by:** Tier B\* native-compute ports (OpenMontage-class). Everything above it exists partly so that this stays a rarely-needed capability.

### (vii) `sb_jobs` — a lightweight daemon cron (net-new; the ~2× lever; **read-only unattended**)

**What it is.** A minimal scheduler in the daemon: "run this wrapp task on a schedule" (`daily`, `hourly`, a cron expression), executing a declared, pre-consented wrapp entrypoint **even when no tab is open**. Listed as **deferred** in `CAPABILITIES.md` and not in the daemon today — this roadmap promotes it to a first-class, explicitly-scoped bet because of its leverage, not because it is close.

**What it unblocks.** Per the central insight, a daemon cron **roughly doubles the portable universe** — possibly worth more than any single port. It is the missing half of the two biggest gaps in the wrapp model (the other being persistence-beyond-one-machine). It converts a large class of "skip / MCP-only" apps into ports: **rank tracking**, **posting queues / scheduling** (Postiz-style), **monitoring**, the **Vendor Book** re-sync, and any recurring extractor that keeps the graph fresh. Placed *last* not because it is low-value but because it most strains a core invariant, and should land only after the primitives it schedules (`sb_http`, `sb_db`, `sb_exec`) are solid.

**Protocol + consent impact — and the hard rule that keeps it honest.** This is the one capability that **dents the pure-airgap wrapp definition**: the current model's hard rule is *nothing runs when the tab is closed*, and cron exists precisely to break that. So it carries extra consent weight, and one non-negotiable restriction the earlier draft got wrong:

**Jobs are read-only and read-capability-only. Full stop.** An unattended run has no human, and the write-consent invariant is explicit that a `write`-classed action needs **per-action human consent on every invocation, never bypassable, never delegated** (`permissions.ts:15-24`). "Trust mode" is a *per-site, human-present* pre-approval (§3.1.4) — it is **not** a delegation a cron run can inherit. Therefore a job may **read** (reads, `sb_http` GETs to allow-listed hosts, `context.query`, `context.publish` of its own extracted slice) but may **not** perform any `write`-classed tool action, spend, or send unattended. There is no "pre-approved write" scope for a job. Any write a job's logic wants must either:
- **(a) enqueue a pending per-action consent** that surfaces in the panel's **Needs you** the next time the user opens it — a *deferred human click*, fail-closed if never approved (the post is never sent, the budget never spent, until a human clicks); or
- **(b) be explicitly out of scope for v1 `sb_jobs`.**

So a "posting queue" job (§6.6 #23) *drafts and enqueues* posts read-only and unattended; the actual send waits behind a per-action consent the human resolves later. A rank-tracker job reads and publishes `note`/`brand` context freely (all reads). This keeps the one invariant the spec calls non-negotiable intact under automation. A job grant declares, up front and revocably: the exact wrapp entrypoint, the schedule, the **read-only capability sub-grants** it may use, a hard budget, and where its deferred-write consents will surface. Every run is audited as a distinct, attributable event with a one-click "stop schedule." The panel gains a **Scheduled** surface the side-panel IA does not have today. This capability is the clearest case where the spec must be read as *net-new committed work that changes an invariant* — and even then, the write gate does not bend.

### Roadmap at a glance — order, dependency, tier

| # | Capability | Ships after | Primary unlock | Porting tiers it serves |
|---|---|---|---|---|
| P0 | Registry + `window.switchboard` facade + **liveness signal** | — | Interface proof; naming migration; **honest offline chip/panel** | (all — prerequisite) |
| i | `context.query` + kind taxonomy + `ContextGrant` + **audit extension** | P0 | Typed multi-context Vault reads (full payloads, `all`=future) | Tier B\* & all cross-domain consumers (EA, RPG, imagegen/adgen dedupe) |
| ii | Context-import from URL (`source.kind:"url"`, refreshable, **egress-guarded**) | i | Cold-start supply / extractors | Store supply side; mini-wrapp seeds |
| iii | `sb_db` (per-origin SQLite) | P0 | Local relational backend | Tier B (LobeChat, OpenCut) |
| iv | `sb_http` (proxy + credential injection) | iii | Call any API, token stays daemon-side | Tier B (Perplexica/GPT-Researcher/STORM); lighter Tier C |
| v | `sb_secrets` (raw reads, always-prompt) | iv (pair) | Client-side signing SDKs | Tier B tail |
| vi | `sb_exec` (sandbox) | iv, v; airgap hardened | Native/long compute | Tier B\* (OpenMontage-class native work) |
| vii | `sb_jobs` (daemon cron, **read-only unattended**) | iv, iii, vi | Scheduled runs — **~2× the universe**; **dents the airgap**; writes deferred to a human click | Rank-tracking, posting queues, monitoring, Vendor Book, refresh-extractors (much of Tier C without full MCP) |

Every step is an **additive protocol MINOR bump + a new adapter shim + a `PORTING-AND-DEPLOY.md` seam-table update**, with `claude_*` wire methods kept aliased for ≥1 MINOR before any `sb_*` rename. The core router and consent enforcer do not grow across any of these; only the registry gains rows. `sb_exec` is the sole TCB expansion, and `sb_jobs` is the sole invariant *strain* (never a write bypass) — both called out as such so the roadmap stays honest about its own cost.

---

## 6. App pipeline & porting backlog — the cold-start engine

The consent broker is worthless with an empty Vault and an empty shelf. This section defines how Switchboard gets to critical mass: a **hard portability test** that decides what can even become a wrapp, five **porting tiers** that sort the candidate universe by how much surgery each app needs, a **split-our-wrapps** strategy that turns our one monolith (brandbrain) into a shelf of cheap extractors, and a **sequenced backlog** whose single organizing principle is *seed the supply side first* — ship the extractors that **fill** the Vault before the consumers that **drain** it, because a consumer that opens onto an empty graph churns on contact.

The whole section rests on one asymmetry: **a producer is useful alone; a consumer is useless alone.** Naming (produces `brand.name`) delivers value on a blank account. The RPG (consumes `task` + `person` + `event`) delivers nothing until three other wrapps have run. So we build producers first — not because they're easier, but because they're the only things that work on day one.

### 6.1 The portability test (the gate every candidate passes or fails)

A candidate is a wrapp **only if it survives with no server**. Run every app through this checklist before it enters the backlog. This is not aspirational — it is the exact contract of the real port pipeline (`docs/PORTING-AND-DEPLOY.md §1–3`, proven on `examples/brandbrain-port/`, 32 routes, no server, no keys). If a box is unchecked, the app is **surgery**, **MCP-integration**, or **skip** — not a port.

**PASS requires ALL of:**

- [ ] **No server-side database.** All persistence is client-side: IndexedDB / OPFS, or the **bound local folder** via `claude_storage` (`bindFolder`, as brandbrain uses), or — once shipped — the daemon's per-origin `sb_db`. If rows must live on a server shared between strangers, it fails.
- [ ] **No scheduled jobs.** Nothing runs when the tab is closed. Every code path is triggered by a user action or a page load. (Cron is a *deferred daemon capability*, §6.5 / §5-vii — not a thing a wrapp may assume today, and even then unattended runs are read-only.)
- [ ] **No server-held OAuth secrets.** The app holds no client secret, no long-lived refresh token server-side. Credentials either don't exist (pure inference/compute) or live in the visitor's own **MCP server** and never cross into the page (§6.4, the `sb_secrets`/`sb_http` posture).
- [ ] **No GPU / inference service of its own.** The only model it may call is the visitor's, via `window.claude` (`claude_complete` / `claude_stream` / `claude_session`). No hosted embeddings endpoint, no render farm. In-tab WASM/WebGPU (Transformers.js) is fine — it runs on the visitor's silicon.
- [ ] **All "backend" logic is pure computation or an LLM call.** Every route handler reduces to (a) deterministic computation runnable in-tab or in WASM, or (b) a model call that becomes `window.claude`, or (c) a tool call that becomes an **MCP** invocation. Nothing else.
- [ ] **Web-standard routes only.** Route handlers are `Request → Response`, reachable through the client fetch-router at `/api/*` only (the adapter patches `fetch`; it never networks). No framework-private server context, no Node-runtime middleware.
- [ ] **Read-before-write race guard — folder AND graph.** Persistence is last-write-wins; the app must read current state before writing, not blind-overwrite. This applies to the bound folder (the brandbrain workspace-load-races-connect gotcha) **and** to `context.publish` on any shared graph object: a producer reads current state and writes only its own named slice (§4.7), so two mini-wrapps publishing to the same logical `brand` at once (Naming + Voice) touch disjoint slices and cannot conflict.
- [ ] **Honest no-provider degradation.** With no daemon paired, the frontend renders standalone and live features fail with an **honest error** — never a fabricated fallback answer.
- [ ] **Frontend-only / single-user / generative shape.** The app is one person's tool, not a multi-user shared-state service. Collaboration-by-server is out of scope by construction.

**Two structural escape hatches, and only two:** `window.claude` (→ daemon → CLI + MCP) and the **bound local folder**. If a feature needs a third thing (a webhook receiver, a shared queue, a background worker), it is not a wrapp — it is Tier C (drive it over MCP) or Tier D (skip).

**Grant hygiene (a sub-clause of the test, not optional):** the wrapp must declare its capability scope honestly and handle **partial grants** — the model check canonicalizes known alias↔full-id pairs (`canonicalModel`, §1.4), so an app can request `claude-haiku-4-5` against a `haiku` grant without a phantom denial; the real denial is a *different model family* (asking for haiku when granted only sonnet), narrowing-only tool sets, and a context read that may return fewer objects than asked. An app that breaks when the user grants a subset — or that assumes an exact full-ID spelling to dodge a denial that alias-folding already prevents — fails the test.

### 6.2 The porting tiers (the candidate universe, sorted by surgery)

Five tiers, from "paste it in" to "don't." For each app: **rationale**, **what gets amputated**, and **where each capability lands** (`window.claude` vs bound-folder vs `sb_db` vs MCP).

#### Tier A — ports nearly as-is (frontend-only / local-first OSS)

The provider swap *is* the port: replace the LLM client with `window.claude`, replace localStorage/server persistence with the bound folder or `sb_db`, ship. The fastest shelf-fillers and the cold-start's front line.

| App | Rationale | Amputated | Maps to |
|---|---|---|---|
| **BetterChatGPT / NextChat** | A chat UI is a provider shim away from being our default chat wrapp; we already have a thinner `chat.js`. | Their API-key box + OpenAI/Anthropic HTTP client + server proxy. | Inference → `window.claude` (`claude_stream`). History → bound-folder or `sb_db`. No MCP. |
| **Novel** (Notion-style AI editor) | Client-side ProseMirror editor; AI is inline completions — a textbook `claude_complete` swap. | Their hosted AI endpoint / Vercel AI route. | Inference → `window.claude`. Docs → bound-folder (OPFS today). No MCP. |
| **Excalidraw / tldraw** | Client canvas; tldraw's **"make real"** (sketch → UI) maps 1:1 onto `window.claude`, and a **tldraw MCP already exists**. | The hosted "make real" key/proxy. | Inference → `window.claude`. Canvas files → bound-folder. Optional tools → **tldraw MCP**. |
| **OpenPolotno / Polotno Studio** | Client Canva-class editor, JSON templates, local persistence — the exact shape of our Prism/store split. | Any Polotno cloud save. **Mind Polotno SDK licensing** before shipping. | Local persistence → bound-folder / `sb_db`. AI layout/copy → `window.claude`. No server. |
| **Transformers.js tools** (Whisper, RMBG/BiRefNet bg-removal, embeddings, classification) | Run **in-tab via WebGPU** — no server, no key, no `window.claude` even. A free "utilities shelf" that also seeds embeddings. | Nothing — there was never a backend. | Compute → **in-tab WASM/WebGPU**. Outputs → bound-folder. Optional AI captioning → `window.claude`. |
| **JSON Crack / Mermaid live / drawio / Squoosh-class utilities + AI layer** | Pure client tools; the only new thing is an AI assist, one `window.claude` call. | Nothing structural. | Compute → in-tab. AI assist → `window.claude`. Save → bound-folder. |

#### Tier B — portable with surgery (keep frontend, amputate backend)

The frontend survives; a real backend must be excised and re-expressed as `window.claude` + in-tab compute. More effort, higher payoff — recognizable products.

| App | Rationale | Amputated | Maps to |
|---|---|---|---|
| **Presenton** | FastAPI backend is *LLM orchestration + PPTX assembly* — both portable. | The **entire FastAPI server**. | LLM orchestration → `window.claude`. PPTX generation → **`pptxgenjs` client-side**. Decks → bound-folder. |
| **LobeChat** | Ships a **client-side PGlite DB** already — far more amputatable than a typical chat app. | Its server auth / hosted sync. | Inference → `window.claude`. Data → **PGlite in-tab** (or `sb_db`). Plugins → **MCP**. |
| **OpenCut** | Postgres/Redis exist for *accounts*, not editing; editor is client-side, render core going Rust/WASM. | Account server + hosted render. | Editing → in-tab. Render → **WASM**. AI cuts → `window.claude`. Projects → bound-folder. |
| **Perplexica / GPT-Researcher / STORM** | Port the **logic, not the Python backend**: a research loop is a model + a search tool. | The Python orchestration server and its bundled search backend. | Reasoning → `window.claude` (`claude_session` for multi-step). Search → the visitor's **web-search MCP** (or `sb_http` GET to a search API). Report → bound-folder; a `note` context. |
| **Screenshot-to-code / OpenUI** | Image-in → code-out is a single multimodal `window.claude` call (media as data-URI). | Their hosted model proxy. | Inference (vision) → `window.claude`. Output → in-tab preview + bound-folder. No server. |

#### Tier B\* — the best fit (skill/agent-layer projects; the OSS repo is the BRAIN, the wrapp is the FACE)

Already built for this runtime: the daemon shells out to the **Claude Code CLI**, so an OSS project that *is* a pack of Claude Code skills/agents needs **no porting** — the repo becomes the brain, the wrapp is a thin face. Our unfair advantage; `window.claude` ≈ the Claude Artifacts app API surface, so artifact-style generators import directly.

| App | Rationale | Amputated | Maps to |
|---|---|---|---|
| **OpenMontage** ("AI coding assistant → video studio"; 12 pipelines, 52 tools, 400+ skills, approval gates, runs **ffmpeg locally**) | A Premiere-class studio pure-web rivals **cannot** build — needs local ffmpeg + the CLI, exactly our runtime. | Nothing — it already targets a local agent. | Brain → **CLI skills** via `window.claude` (`claude_session`). Media I/O → **bound-folder**. Native compute → **`sb_exec`**. Approval gates → the broker's **write-consent** clicks. |
| **SEOMachine** (Claude Code SEO workspace: `/research` `/write` `/optimize`) | Slash-command SEO workflows are agent skills; the wrapp is a workspace shell. | None. | Commands → `window.claude` agentic loop. Search/rank tools → **MCP**. Drafts → bound-folder; `note` contexts. |
| **MIT marketing plugin** (158 skills, 25 agents) & growth/sales/content-ops packs | Huge skill surface, pure agent-layer — instant capability inheritance for marketing wrapps. | None. | Skills → `window.claude`. Data reach → the user's **MCP** (Gmail/CRM/ads). Outputs → `task`/`note` contexts. |
| **E2B Fragments / artifact-style micro-apps** | `window.claude` mirrors the Artifacts app API, so these generators are **import-compatible store content**. | Their hosted sandbox/model. | Generation → `window.claude`. Preview → in-tab. Save → bound-folder. |

#### Tier C — don't port; integrate via MCP (the brandbrain Shopify/Higgsfield pattern)

The product is a service with real server-side state and side effects. We don't own it — we **drive** it. The wrapp is a static UI; the app's own **first-party MCP server** does the work. The honest architecture whenever an action must persist server-side or fire off-tab.

| Service | Rationale | Amputated | Maps to |
|---|---|---|---|
| **Postiz** | Ships a first-party **MCP server**; a "scheduling wrapp" = a static calendar UI driving the user's own Postiz. Scheduling **can't** be a static wrapp anyway (nothing fires when the tab is closed), so MCP is the only honest fit. | The entire Postiz front/back — keep only its MCP. | UI → static wrapp. Every action → **Postiz MCP** (send is a write → per-action consent). Post plans → `event`/`task` contexts. |
| **Meta Ads / Google Ads** | Ad platforms are server-of-record with money side effects; rich ads MCP surface. | Everything but the UI. | Campaign ops → **ads MCP** (write-gated per action). Read insights → MCP reads. Briefs → consume `brand`/`asset`. |
| **CRMs / Email (Gmail, etc.)** | Shared server state + OAuth secrets the wrapp may never hold. | All backend. | Reads/writes → the user's **CRM/Gmail MCP**. Extracted people/threads → produce `person`/`task`/`event` (this is the EA extractor, §6.4). |

#### Tier D — skip (the server IS the product)

Multi-user shared-state services whose whole value is the always-on server. They fail the portability test at the first box and have no honest MCP-only reduction.

| Service | Why it's a hard skip |
|---|---|
| **Chatwoot** | Multi-agent shared inbox; real-time server state is the product. |
| **Mautic** | Marketing automation = scheduled server jobs + shared DB. |
| **Twenty** | Multi-user CRM; the shared server *is* the CRM. |
| **SerpBear** | Needs **cron** + third-party SERP APIs server-side. |
| **SEOnaut** | Go server + DB crawler; nothing left after amputation. |

### 6.3 Split our wrapps: brandbrain → a shelf of mini-wrapps

We don't only port other people's apps — we **split our own monolith** into cold-start supply. brandbrain is one gated assembly board over a `spec` task set, filtered by a `studio: "brand" | "launch"` axis (confirmed in `cast/*.js`: locked decisions, `LaunchGate`, per-facet locks). **That axis is the fault line.** Each decision card is already a self-contained extractor that writes one slice of the `brand` context and reads back the locked deps it needs — so most cards can ship *standalone*.

**Each mini-wrapp owns exactly one named `brand` slice — this is the write-authority model, not just a distribution choice.** Per §4.7, a shared graph object is single-writer-per-slice: Naming writes only `brand.name`, Voice only `brand.voice`/`brand.identity`, and neither can clobber the other. That is what makes "seven wrapps write the same `brand`" safe rather than a race — the writes are disjoint by construction, and the split table below *is* the slice-ownership map.

| Mini-wrapp | From brandbrain decision(s) | Produces (its OWNED slice) | Consumes |
|---|---|---|---|
| **Market Canvas** | category, positioning map, segments, players, scored gaps | `brand.market`, `gap`, `competitor` | brief (needs only a typed brief — the zero-prereq entry) |
| **Naming** | name decision (late — after positioning + audience) | `brand.name` | `brand.market`, audience slices |
| **Voice / Identity** | voice, identity, palette | `brand.voice`, `brand.identity`, palette `asset` | `brand.market`, audience |
| **Vendor Book / Sourcing** | Launch sourcing + the existing Alibaba/Accio sync skill | `vendor`, `product` (pricing/MOQ/terms) | `brand.product` / range |
| **Pricing & Range** | pricing, range decisions | `brand.pricing`, `product` | positioning, sourcing |
| **Store Builder** | Launch "store" | `asset` (store pages) | full `brand` |
| **Adgen / Prism** | already split (`adgen.js`, `imagegen.js`) | `asset` | `brand` |
| **Investor Deck** | one-pager → deck | `asset` | full `brand` |

**Which split *first*:** **Market Canvas, then Naming, then Voice/Identity.** They are pure producers, they seed the slices every downstream mini-wrapp reads, and Market Canvas is the natural first touch of a brand — it needs only the brief, which makes it the **truly-zero-prerequisite producer** a pre-site founder starts from (§1.6, §3.7, §4.1). Naming and Voice deliberately depend on `brand.market` + audience — so shipping Canvas first makes them *work* instead of asking the user to hand-type their positioning.

**What stays bundled in the big brandbrain OS (the moat):** the **gated assembly board itself** — the Blocked → To-research → Researching → Ready-and-locked kanban, the serial research queue, the dependency cascade / re-research on pick-change, path re-sequencing — and the **finalisation hard-gate** (`LaunchGate`: Launch Studio stays locked until *every* Brand decision is locked). That cross-decision orchestration spans all the mini-wrapps and cannot live in any one. The mini-wrapps are the **supply** (cheap extractors, one slice each); the bundle is the **retention product** that composes those slices under gates.

**How they hand off via the Vault (the non-lossy, race-safe part):** every mini-wrapp reads and writes the **same typed `brand` context** the user owns, each on its own slice. A user can enter through **Naming alone**, produce `brand.name`, and later "graduate" that same object into the full OS — Voice reads the name, Store Builder reads the whole brand, Prism reads palette + products. Because writes are single-writer-per-slice with read-before-write (§6.1), two mini-wrapps open at once never conflict. Today this hand-off runs on **one-active-context-per-app** (`context.active` / `pick`, as `imagegen.js` does); the moment the split matters most — a downstream wrapp needing `brand` **plus** `vendor` **plus** `product` at once — is exactly the moment we need **typed multi-context consent** (`context.query({ kinds })`). The split strategy and the Vault evolution are the same bet from two sides.

### 6.4 Seed extractors first — the supply-side flywheel

Extractors are the supply side, the cold-start flywheel, and the moat. A Vault with objects in it makes every consumer instantly valuable; an empty Vault makes every consumer churn. So before any cross-domain consumer ships, we seed the graph with producers — and we are honest about each producer's prerequisites, because two of the three flagship producers are **not** zero-prerequisite:

1. **Market Canvas (the true zero-prerequisite seed).** Needs only a typed brief — no site, no connected account. This is the producer a **pre-launch founder with no web presence** starts from, minting a first `brand.market` slice on a blank account. It is the honest "day-one on nothing" entry, and first-run always offers it (§4.1).
2. **Import-from-URL (brand teardown) — for users who already have a site.** A read-only extractor: fetch a URL, run one `window.claude` call (egress-guarded, §2.6.5), publish a typed `brand` context the *user* owns. The cheapest first touch **for anyone with an existing web presence** — paste your site, get a brand object. It is **not** universally zero-prerequisite (a pre-site founder has no URL), so it is scoped to that persona and paired with Market Canvas as the fallback, never presented as the one universal first win.
3. **The EA wrapp (Gmail / Calendar → `task` / `person` / `event`) — needs an MCP connected first.** The Tier-C MCP pattern turned into a producer: the assistant connects the visitor's Gmail/Calendar MCP, reads threads and events, and writes `task`/`person`/`event` contexts. This finally populates the *non-brand* kinds cross-domain consumers need. **Its honest precondition, stated in first-run and the empty-Vault UI:** the user must have added a Gmail/Calendar MCP server in **Connections ▸ Manage MCP servers** (§2.4.3) before the EA can produce anything — so the day-one supply chain is *MCP setup → EA → tasks*, a real dependency, not a one-click win. Its natural home is `assistant.js`, which already runs the agentic tool loop.
4. **Our own split mini-wrapps (§6.3).** Naming, Voice — each writes a `brand` slice. Free supply we already own the code for.

Only *after* these have filled the Vault do the **consumers** arrive: Prism and adgen stop re-extracting brand data and start reading it via `context.query({ kinds: ["brand"] })`; the RPG reads `task` + `person` + `event`; the Investor Deck reads the whole brand. Sequencing this backwards — shipping the RPG before the EA — is the one mistake that guarantees churn.

### 6.5 Two capability bets that roughly double the universe (net-new, not free)

Two of the biggest gaps in the wrapp model are **persistence-beyond-one-machine** and **scheduled execution**. Both live *outside* today's pure-client wrapp definition, so the spec names them as first-class roadmap bets with an honest note on what each dents:

- **Daemon cron (`sb_jobs`).** "Run this wrapp task daily" roughly **doubles** the portable universe — rank tracking, posting queues, monitoring, the whole Tier-C-adjacent world that fails only on "nothing fires when the tab is closed." **But it breaks the pure-airgap model by definition** and is **read-only when unattended** — any write a job wants is deferred to a per-action human click in the panel's **Needs you** (§5-vii), never auto-approved. Net-new committed daemon work (deferred in `CAPABILITIES.md`), fail-closed and per-origin-scoped — not a thing wrapps may assume today.
- **Sync (persistence beyond one machine).** The bound folder is one machine; a real product needs the Vault on the user's laptop *and* phone. A genuine roadmap bet that dents **data-locality** unless designed as end-to-end-encrypted, daemon-mediated sync (never operator-readable). Until it ships, "your Vault" means "your Vault on this machine," and the spec should say so plainly.

Framed honestly, these two are worth more than any single port — but they are **work to commit to**, not features to cite as existing.

### 6.6 The backlog (sequenced supply-first)

One table, ordered by ship sequence. **Producers before consumers, always.** Effort is S/M/L. "Maps to": **wc** = `window.claude`, **bf** = bound-folder, **db** = `sb_db`, **wasm** = in-tab compute, **mcp** = the visitor's MCP.

| # | App | Tier | Produces kinds | Consumes kinds | License | What amputates | Maps to | Effort |
|---|---|---|---|---|---|---|---|---|
| **Phase 1 — Extractors (fill the Vault)** | | | | | | | | |
| 1 | **Market Canvas** (brandbrain split) — zero-prereq seed | split | `brand.market`, `gap`, `competitor` | brief only | ours | assembly board, gates | wc + bf | **M** |
| 2 | **Import-from-URL** (brand teardown, for users w/ a site) | new | `brand` | — | ours | n/a (net-new, egress-guarded) | wc + bf | **S** |
| 3 | **Naming** (brandbrain split) | split | `brand.name` | `brand.market`, audience | ours | assembly board, gates | wc + bf | **S** |
| 4 | **Voice / Identity** (brandbrain split) | split | `brand.voice`, `brand.identity`, `asset` | `brand.market` | ours | assembly board, gates | wc + bf | **M** |
| 5 | **EA wrapp** (Gmail/Cal → tasks) — needs MCP first | C→producer | `task`, `person`, `event` | mcp reads | ours (`assistant.js`) | all backend | mcp + wc | **M** |
| 6 | **Vendor Book / Sourcing** | split | `vendor`, `product` | `brand.product` | ours + Alibaba skill | assembly board | wc + bf + mcp | **M** |
| 7 | **Transformers.js utilities shelf** | A | `asset`, embeddings | — | Apache-2.0 | nothing (no backend) | wasm | **S** |
| **Phase 2 — Fast shelf-fillers (breadth)** | | | | | | | | |
| 8 | **Default Chat** (BetterChatGPT/NextChat) | A | — | — | MIT/CC | key box, HTTP client, proxy | wc + bf | **S** |
| 9 | **Novel editor** | A | `note` | — | Apache-2.0 | hosted AI route | wc + bf | **S** |
| 10 | **tldraw / Excalidraw** (+make-real) | A | `asset` | `brand` (optional) | MIT/tldraw lic. | make-real proxy | wc + bf + mcp | **M** |
| 11 | **Polotno Studio** | A | `asset` | `brand` | ⚠ Polotno SDK | cloud save | wc + bf | **M** |
| 12 | **Screenshot-to-code / OpenUI** | B | `asset` | — | MIT | model proxy | wc (vision) | **S** |
| **Phase 3 — B\* agent-layer (the unfair advantage)** | | | | | | | | |
| 13 | **OpenMontage** (video studio) | B\* | `asset` | `task` (queue) | check repo | nothing (agent-native) | wc(session) + bf + sb_exec | **L** |
| 14 | **SEOMachine** (SEO workspace) | B\* | `note`, `task` | `brand` | check repo | none | wc + mcp + bf | **M** |
| 15 | **Marketing skill packs** (MIT plugin) | B\* | `task`, `note` | `brand`, `person` | MIT | none | wc + mcp | **M** |
| **Phase 4 — Consumers (now the Vault is full)** | | | | | | | | |
| 16 | **Prism / adgen re-wire** | consumer | `asset` | `brand` (via `query`) | ours | stop re-extracting | wc + mcp | **S** |
| 17 | **Investor Deck** (brandbrain split) | consumer | `asset` | full `brand` | ours | assembly board | wc + bf | **M** |
| 18 | **Store Builder** (brandbrain split) | consumer | `asset` | full `brand` | ours | assembly board | wc + bf | **M** |
| 19 | **"Life is a game" RPG** | consumer | `task.rpg.*` (own slice) | `task`, `person`, `event` (multi-`query`) | new | n/a | wc + `context.query` | **L** |
| 20 | **Research** (Perplexica/GPT-Researcher/STORM) | B | `note`/`research` | mcp search | MIT/Apache | Python backend | wc(session) + mcp + bf | **L** |
| **Phase 5 — MCP-driven & deferred-capability** | | | | | | | | |
| 21 | **Postiz scheduler** | C | `event`, `task` | `asset`, `brand` | AGPL (MCP only) | Postiz front/back | mcp | **M** |
| 22 | **Meta/Google Ads** | C | — | `brand`, `asset` | vendor MCP | all backend | mcp (write-gated) | **M** |
| 23 | **Rank tracker / posting queue** (read-only job; sends deferred to human click) | needs cron | `note` | `brand` | new | requires `sb_jobs` | mcp + `sb_jobs` | **L** |
| 24 | **LobeChat** (full, PGlite) | B | `note` | — | MIT | server auth/sync | wc + db + mcp | **L** |
| 25 | **OpenCut** (video editor) | B | `asset` | — | MIT | account server, hosted render | wc + wasm + bf | **L** |

**Reading the sequence:** Phase 1 leads with **Market Canvas** (the zero-prerequisite producer that works on a blank account with no site and no MCP) so the very first backlog item lights up for *every* new user, then adds URL-import (for users with a site) and the brandbrain splits; the EA at #5 is explicitly gated on the user having connected a Gmail MCP first. By the end of Phase 2 the Vault holds `brand` (from Canvas + teardown + splits) and `task`/`person`/`event` (from the EA). Phase 3 adds the agent-layer wrapps only we can build. **Phase 4 is the first phase that dares to ship a pure consumer** — the RPG at #19, which writes only its own `task.rpg.*` slice — because it is the first phase where the graph it reads is guaranteed non-empty. Phase 5 is gated on **net-new daemon capability** (`context.query` for multi-kind reads, `sb_jobs` for cron) and is deliberately last: highest-leverage work, and the work that most dents the airgap invariants, so it ships once the shelf below it is proven.

Three hard dependencies to honor in scheduling: **#16 and #19 both require typed multi-context consent** (`context.query({ kinds })`) — they cannot ship on today's one-active-context primitive; **#5 (EA) requires a Gmail/Calendar MCP connected first** — a user prerequisite, not a code dependency, but one first-run must surface; and **#23 requires `sb_jobs`** (daemon cron), which breaks the pure-airgap model and runs **read-only unattended** (its posting-queue sends wait behind a deferred per-action human consent, §5-vii). Everything above those lines ships on the primitives that exist today.

---

## First 90 days — build sequence

The capability roadmap (§5) and the porting backlog (§6.6) are one plan seen twice: capabilities are the primitives; ports are what light up when each primitive lands. This sequence interleaves them so that no wrapp is scheduled before the primitive it needs, and every fortnight ends with something shippable that fills the Vault. It also front-loads the IA/layout work (§2–§3) that everything else renders into.

**Weeks 1–2 — Prove the interface, ship the manifest, fix the fail-open chip.** Land **P0** (capability registry + `window.switchboard` facade; move `claude_storage`/`claude_context` behind the registry, no behavior change; **and the provider liveness signal** so the chip and panel stop failing open, §2.3/§3.3). In parallel, define the **wrapp manifest** (§2.7) — stable `id`, capability declaration, taxonomy — because both the store and Install-as-grant depend on it. Reconcile `index.html` + `store.html` into the single manifest-driven **Wrapps** surface (§3.2), and fix `store.js:41-56` concretely: **INSTALLED keyed by `id`, the two `persona.html` entries collapsed to one, fake `rating`/`installs` deleted**.
*Ships:* an honest offline chip/panel state; a real, searchable, drift-free store grid.

**Weeks 3–4 — The first extractor, on today's primitives, for everyone.** Ship **capability (ii) context-import-from-URL** (`source.kind:"url"`, `import` op, **egress-guarded like `sb_http`**) and the **Market Canvas** producer (#1) alongside **Import-from-URL** (#2). Market Canvas is the keystone here precisely because it is **zero-prerequisite** — a brand-new user with no site and no MCP mints a first `brand.market` slice, so the empty-Vault floor works for *every* persona, not just those with an existing site. Build the **empty-Vault keystone** (§3.7.3) and the **"Start your Vault" first-run** (§4.1) around both, offering the URL path only to users who have a site and never dead-ending the EA path (it isn't shown until #5 ships).
*Ships:* every new user can create a first `brand` object on a blank account. Cold-start has a floor with no persona gap.

**Weeks 5–6 — Fill the non-brand kinds; ship the cheap producers (and the MCP-setup path they need).** Ship backlog **#5 EA wrapp** (Gmail/Calendar → `task`/`person`/`event`, on the visitor's MCP) *together with* the **Connections ▸ Manage MCP servers** surface (§2.4.3) it depends on — the EA is worthless without a way to connect the Gmail MCP, so they ship as one unit and first-run only surfaces the EA path once this exists. Also ship **#3 Naming** (the brandbrain split; #1 Market Canvas already shipped weeks 3–4). Land the **Vault browser** (§3.4) so the objects these producers create are visible.
*Ships:* the Vault now holds `brand`, `task`, `person`, `event`. Supply exists before any consumer needs it, and the EA's precondition has a home.

**Weeks 7–9 — The pivot: typed multi-context consent (with its audit and future-object rails).** Ship **capability (i)** — `ContextKind` union, `context.query` returning full payloads, `ContextGrant` on `OriginGrant`, the `consent:context-query` dialog (§3.5.5) with **sensitive-kind `selected` defaults, the "all = future objects" note, and the titles-vs-full-data disclosure**, the **`AuditEntry` extension** (context_read entries, count+kind only), the app-card **Context access** row (with the standing `all` indicator and widen-re-consents-narrow-doesn't rule) and Vault **Who-can-read-this**. Immediately cash it in with backlog **#16 Prism/adgen re-wire** (stop re-extracting; read `brand` via `query`) — the smallest possible consumer, proving the primitive end-to-end on a wrapp we already own, and validating the single-writer-slice publish path.
*Ships:* the graph becomes queryable; the first consumer reads it; re-extraction waste is gone; the audit ledger can honestly say "read N brands."

**Weeks 10–13 — First cross-domain consumer + the backend primitive that widens Tier B.** Ship backlog **#19 the "life is a game" RPG** (`context.query({ kinds:["task","person","event"] })`, writing only its own `task.rpg.*` slice) — the end-to-end reuse loop (§4.6) made real, and the proof that one `task` object serves a serious tool and a playful one. In parallel, land **capability (iii) `sb_db`** (lowest-risk backend primitive) so the Tier-B port queue (LobeChat, OpenCut) can begin, and ship **#7 Transformers.js utilities shelf** (Tier A, zero backend) as free breadth.
*Ships:* the flywheel turns — a producer feeds a consumer across domains under a typed grant the user authored, can revoke, and can see in the ledger.

**What is deliberately NOT in the first 90 days:** `sb_http`/`sb_secrets` (weeks 14+, unblocking the research ports #20 and lighter Tier C — though their egress denylist is authored early, for import), `sb_exec` (gated on airgap hardening, for OpenMontage-class #13), and `sb_jobs` (the cron bet, #23) — each is net-new and, in the case of `sb_jobs`, dents a core invariant (read-only unattended, writes deferred to a human click), so none is rushed onto the critical path. The 90-day arc is exactly the supply-first thesis executed once: **plumbing + honest offline → first extractor for everyone → fill the graph → make it queryable (safely) → first cross-domain consumer.** Everything after is more lenses on a graph that, by day 90, is no longer empty.
