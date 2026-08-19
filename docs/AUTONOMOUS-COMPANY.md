# The Autonomous Company — Full Spec

> Public name: **COS** (the Promptless rung). Codename: **Autopilot**. Entity of record candidate: `sameep.ai`.
> This supersedes the thin passes. It specs the whole surface: model, states, IA, navigation, layout,
> interactions, routines, workflows, AI options, branching, dashboard — and the register that makes it feel alive.

---

## 0. The one sentence

**You fund a bet. The company runs itself — in the open, on your own Claude, and it never spends a dollar or sends a message you didn't clear.**

Three shapes of bet ship in v1: a **software business**, an **agency**, a **consumer brand**. They are the *same venture object* with a different `kind`. The engine — decisions, operations, growth, strategy, the CEO, autonomy, the overnight runner — is shared. `kind` only resolves three slots: what gets **deployed**, how it makes **money**, and where it **lives**.

### Non-goals (say these out loud in the product)
- It does **not** move money or send outbound without a connected lane **and** a human go. "Autonomous" ends at the reversible boundary.
- It does **not** fabricate a revenue number. Every economic figure is either real (a connector reported it) or explicitly **"not connected."**
- It is **not** a portfolio manager that promises returns. Runway is compute + time you fund; the lab is company-of-record, not a fund.

---

## 1. Core model — one engine, `kind` is a parameter

```
Venture
├─ identity      name, one-line thesis, kind, brand kit (from CREST/brandbrain)
├─ decisions[]   the locked playbook — pure inputs to everything downstream
├─ operations[]  the deployable + supply/delivery spine (kind-resolved)
├─ growth[]      site, content, outreach, ads — draft-first
├─ economics     the money model (kind-resolved), always "real or not-connected"
├─ strategy      thesis, bets, the CEO's running plan
├─ autonomy      off | drafting | live  + budget + guardrails
├─ connectors    the N lanes; each is stub | connected; gates every real action
└─ log[]         the operating record — every move, who fired it, its consent state
```

### `resolveKind` — the only thing that forks

| Slot | **Software business** | **Agency** | **Consumer brand** |
|---|---|---|---|
| **Deployable** | the app/wrapp (ships to `<slug>.wrapp.sh` or a repo the coding agent edits) | client deliverables (decks, sites, campaigns, code) | the product line + storefront |
| **Unit of work** | features / releases | **client engagements** (retainer or project) | SKUs / drops |
| **Economics** | usage (Spotify-pool rev-share) **or** subscription/sales | **billable** — retainers, project fees, hours | **sales** — offer + price + merchant-of-record |
| **Growth loop** | build → ship → traffic → activation | outreach → pitch → win → deliver → referral | drop → demand → fulfil → repeat |
| **Host** | subdomain / GitHub repo | client-facing microsites + a pipeline board | Shopify / storefront + supply spine |
| **The scarce thing** | compute (fund your own tokens, "level up") | **capacity** (how many clients can be served at the quality bar) | inventory + cash-to-restock |
| **First "real" milestone** | first activated user | first signed client | first paid order |

Everything else — the four domains, the task compiler, the CEO chat, the autonomy ticker, the daemon — is identical across kinds. **A new kind is a column in this table, not a new app.**

### The honest boundary (the moat, restated as an invariant)
Every action carries a class:

- **reversible** (draft a post, generate a site, plan a slate, write an outreach email) → the autonomy loop may do it **itself**, budget-permitting.
- **irreversible / outbound** (publish, send, charge, deploy to prod, restock) → **approve-move only**, and only when the relevant connector is `connected`. No connector ⇒ the move **stages honestly** ("ready — connect Gmail to send").

This line is the same for all three kinds. It's what makes "autonomous" honest and un-clonable by a software-only rival: glass box, provable locks, real supply/merchant spine.

---

## 2. The three archetypes in depth

Each archetype is defined by four things: its **unit of work**, its **compiled task set**, its **economic truth**, and its **growth loop**. The task compiler is a pure function of the locked decisions — "tasks are not invented, they're derived."

### 2.1 Software business
- **Decisions that seed it:** what it does (one job), who for, wedge feature, pricing shape (usage vs sub), name/brand.
- **Compiled tasks:** `spec the wedge` → `generate the app` → `deploy to subdomain` (approve) → `landing page` → `instrument activation` → `first-user outreach` → `iterate from usage`.
- **Economics:** two modes. *Usage* (wrapp shape) = the app is free to run on the visitor's own Claude; you earn from the Pro-sub pool by usage share — never charge the runner. *Sales* = subscription or one-off; needs a payments lane. Revenue = "not connected" until a meter/Stripe reports.
- **The token game:** software kinds fund with the founder's **own** tokens; a visible "level" rises with real usage. This is the compute-runway of company-of-record made playable.
- **Growth loop:** build → ship to subdomain (inherent distribution) → traffic → activation → learn → build. The subdomain *is* the distribution; that was Acoco's real moat, not the cockpit.

### 2.2 Agency (the new one — spec it hardest)
The agency breaks the "one deployable" assumption: its output is **many client engagements**, each with its own mini-lifecycle. This is why it needs a first-class **pipeline** the other two don't.

- **Decisions that seed it:** service (what we do), ICP (who we serve), offer + price shape (retainer / project / performance), proof (portfolio, case study), positioning.
- **New object — `Engagement`:**
  ```
  Engagement
  ├─ client        name, contact, source
  ├─ stage         lead → qualified → proposed → won → delivering → delivered → retained | lost
  ├─ scope         deliverables[], due dates
  ├─ economics     fee model, invoiced, paid  (real-or-not-connected)
  └─ artifacts[]   the drafts this engagement produced
  ```
- **Compiled tasks (two loops running at once):**
  - *Business-development loop:* `build target list` → `draft outreach` (reversible) → `send` (approve, needs email lane) → `qualify replies` → `draft proposal` → `send proposal` (approve) → `close`.
  - *Delivery loop (per won engagement):* `kickoff brief` → `draft deliverable v1` (reversible, uses the client's brand via CREST) → `internal QA` → `send for review` (approve) → `revise` → `deliver` (approve) → `invoice` (approve, needs payments) → `ask for referral`.
- **Economics:** billable, not product sales. Revenue = sum of paid invoices (real) + pipeline value (clearly labelled *projected*, never counted as revenue). The scarce resource is **capacity**: the dashboard shows engagements-in-flight vs a quality-bar ceiling and warns before over-committing.
- **Growth loop:** outreach → pitch → win → deliver → **referral / case study** → more outreach. Case studies are auto-drafted from delivered engagements (reversible) and feed the next outreach batch.
- **Autonomy for an agency:** the loop can build lists, draft outreach, draft proposals, draft deliverables, draft invoices, draft case studies — **all reversible**. It sends nothing, signs nothing, invoices no one without the human + the lane.

### 2.3 Consumer brand
- **Decisions that seed it:** category, product idea, audience, price point, brand identity (CREST-generated kit).
- **Compiled tasks:** `define the offer` (product + price) → `supply plan` (source / make) → `storefront` (Shopify) → `merchant-of-record setup` (approve) → `product photography / creative` → `launch content` → `ads` (approve) → `fulfilment` → `restock`.
- **Economics:** sales with a real **merchant-of-record** and a **supply spine** — the two things a software-only rival structurally can't fake. Revenue = paid orders from the storefront connector. Margin = price − COGS − fees, shown only once COGS is entered.
- **Growth loop:** drop → demand (content + ads) → fulfil → restock → repeat. Restock is an approve-move gated on cash + inventory truth.

---

## 3. Information architecture & hierarchy

Three nested scopes. Navigation never makes you guess which one you're in.

```
LAB  (company-of-record — the you-level home)
 └─ PORTFOLIO         all your ventures, any kind, side by side
     └─ COMPANY       one venture — the cockpit
         ├─ Company        identity, thesis, the running log, CEO chat
         ├─ Operations     the deployable + delivery/supply spine + tasks
         ├─ Growth         site, content, outreach, ads
         └─ Strategy       thesis, bets, autonomy controls, economics
             └─ TASK / ARTIFACT / ENGAGEMENT   the leaf detail
```

- **Four domains, always the same four** across kinds (Company / Operations / Growth / Strategy). Consistency is the point — you learn the shape once, then every venture reads the same.
- The **leaf** layer differs by kind: software→task/release, agency→engagement, brand→SKU/drop — but all open in the same right-hand **detail panel** pattern.

---

## 4. States (the full state machine)

### 4.1 Venture lifecycle
`seeded` (kind picked, no decisions yet) → `deciding` (playbook being locked) → `built` (deployable exists) → `live` (deployed / first real action taken) → `earning` (a connector reported real money/usage) → `paused` (autonomy off, no activity) → `archived`.

Guards: can't reach `built` without the minimum decisions for its kind; can't reach `earning` without a connector — the state literally cannot be entered by fabrication.

### 4.2 Task lifecycle (ported from brandbrain OS)
`prepared` → `approved` → `done`, plus `drafting` (in-flight), `staged` (reversible done, waiting on a lane to send), `blocked` (missing a dependency/decision), `failed`. A task's available actions are a function of its class (reversible vs outbound) × the connector state.

### 4.3 Autonomy states
`off` — nothing moves on its own · `drafting` (the live default) — the ticker advances reversible work, fills the review queue, sends nothing · `live` — reserved; only reachable per-lane once a connector is connected **and** the human sets a standing allowance with a budget cap. Autonomy is always **budget-guarded**; hitting the cap drops it to `drafting` and logs why.

### 4.4 Connector / lane states
Each lane: `absent` (not installed) → `installed, not authed` → `connected`. The cockpit shows **⚡ N/5 lanes live**, computed from a real `listTools`, and every gated move points at the exact lane it needs.

### 4.5 Economic states
`not-connected` (no meter) · `connected, zero` (real, and honestly zero) · `earning`. Never a fourth "estimated revenue" state. Projections (agency pipeline, brand demand) live in their own clearly-labelled *projected* channel and never touch the revenue figure.

### 4.6 UI states (every surface must define all of these)
`empty` (first run — a single generative CTA, never a blank grid) · `loading` (skeletons, optimistic) · `partial` (some lanes connected, some not) · `error` (a move failed — surfaced in the log with a retry) · `over-budget` · `offline` (daemon not reachable). No screen ships without its empty and error state drawn.

---

## 5. Navigation & section layout (screen by screen)

Global chrome: a slim **left rail** (Portfolio · the four domains when inside a company · Settings), a persistent **top bar** (venture switcher ⌄, autonomy pill, connector readout ⚡N/5, budget meter), and a **right detail panel** that slides in for any leaf. Nothing modal that could be a panel.

### 5.1 Kind picker (entry)
The **first** thing on a new venture: three big cards — *Software business · Agency · Consumer brand* — each with its one-liner, its economic model, and its first milestone. Picking one is what makes the unification the first thing you see. A fourth ghost card, "same engine, more kinds coming," teaches the model.

### 5.2 Portfolio dashboard (the Lab home)
Grid of venture cards. Each card: name + kind glyph, autonomy pill, the one metric that matters for its kind (software→activated users, agency→engagements in flight / capacity, brand→paid orders), a 7-point sparkline of the operating log, and connector readout. Top: a single **"＋ New venture"** and an aggregate strip (total ventures · lanes live · this-week moves · real revenue across all, or "—" honestly).

### 5.3 Company cockpit (the heart)
Four-column operating surface (from the built engine), each column = one domain:
- **Company** — live operating log (the running record), CEO chat docked at its foot.
- **Operations** — the deployable card (app preview / delivery board / storefront), the derived task list with status tabs, "Run now."
- **Growth** — site preview, social with an auto-post toggle, outreach/inbox, ads preview.
- **Strategy** — thesis, bets, the autonomy master switch + budget, the economics readout.

Columns collapse to a single scroll on narrow widths; on wide, all four breathe. The log is the spine — you can always see what the company just did and who cleared it.

### 5.4 Leaf detail panel
Right-side slide-over for a task, artifact, or engagement: the draft rendered, its class + consent state, the exact lane it needs, and the primary action (Approve / Send / Publish) with its blast-radius spelled out. Reversible leaves show a quiet "already done, tap to see." Provable **locks**: a locked downstream item reads "locked · tap to see why" and opens the upstream decision that gates it.

### 5.5 CEO chat
Grounded chat with slash verbs — `/plan /post /outreach /ship` (kind-aware: agency gets `/pitch /proposal`, brand gets `/drop /restock`). It reads the real venture state; its suggestions become approve-moves, never silent sends.

### 5.6 Settings
Lanes (connect/disconnect, per-lane autonomy allowance), budget caps, model/economy choice, entity-of-record details, danger zone (pause/archive).

---

## 6. Interactions (the patterns that repeat)

- **Approve-move** — the core gesture. A staged reversible artifact + a single button whose label is the real-world act ("Send to 12 leads", "Publish landing", "Charge $49"), with the blast radius under it. Fires `relay.callTool`, gated by the daemon's per-action consent. This is the only way outbound happens.
- **Autonomy toggle** — one master switch (`co.auto.on`) + per-lane allowances. While on, a ~9s ticker advances the next reversible task; a calm activity shimmer on the log shows it's alive. Never a spinner-lock; the human can grab any wheel mid-turn.
- **Fund runway** — a modal to add compute/time to the bet (software: your own tokens + a rising "level"; brand: cash-to-restock; agency: capacity). No promises, no returns — it's fuel, framed as fuel.
- **Connect a lane** — inline from any gated move; returns you to exactly the staged move, now sendable.
- **Provable locks** — nothing is asserted as decided that isn't; every lock links to its cause. Glass box over black box.

---

## 7. Routines (the temporal spine — the "while you sleep" half)

Routines are the daemon capability; they're what separates COS from a wizard.

| Routine | Cadence | What it does | Boundary |
|---|---|---|---|
| **Morning briefing** | daily | Overnight digest: what advanced, what's staged for your go, what's blocked, the one decision that matters today. | read-only; drafts a to-approve queue |
| **Autonomy ticker** | ~9s while `drafting` | Advances the next reversible task; fills the review queue. | reversible only, budget-guarded |
| **Overnight runner** | continuous (daemon) | Sweeps granted origins, advances auto-on ventures headless via the server's own gated completion. | reversible only; flag-gated `RELAY_AUTOPILOT=1` |
| **Weekly review** | weekly | Reflection pass: what's working, what to kill, next week's bets; drafts a strategy update. | drafts; human commits |
| **Capacity/inventory watch** | on-change | Agency: warns before over-committing. Brand: warns before stock-out / restock window. | alerts only |

Each routine is honest about its boundary in its own header ("reads your venture, then drafts — sends nothing").

---

## 8. Workflows (end-to-end)

1. **Create a venture** — pick kind → one-brief seed (name + thesis) → engine auto-seeds the default decision path (brandbrain-style fast-generate) → land *on the cockpit*, not a blank form. "⚡ Let AI run it" fast-track available from second zero.
2. **Software → first activated user** — decide wedge → generate app → approve deploy → landing → instrument → draft outreach → approve send → watch activation in the log.
3. **Agency → first signed client** — decide service+ICP → build target list → draft outreach → approve send → qualify reply → draft proposal → approve send → mark won → delivery loop opens.
4. **Brand → first paid order** — decide product+price → supply plan → storefront → approve MoR setup → creative → approve launch content → first order lands from the connector → margin appears once COGS entered.
5. **The autonomy day** — toggle on → ticker drafts across all reversible work overnight → morning briefing shows a to-approve queue → human clears the outbound ones over coffee.

Every workflow follows the brandbrain pattern: **fast-generate → user picks → downstream restreams from the pick.**

---

## 9. AI options, branching & model choice

- **The `auto | approve | manual` taxonomy** (the origin of "autonomous"): every task carries one of three modes. `auto` = the ticker may do it. `approve` = drafted, waits for a go. `manual` = human-only. This is set per task-type and overridable per task.
- **Branching / options-and-recommended** — the house doctrine everywhere a choice exists: the AI presents **N options with one ⭐ recommended**, distribution shown for multi-select. The founder answers "1a 2c" style. Applies to slate decisions, creative variants, outreach angles, pricing, name.
- **Variant generation** — creative surfaces (posts, sites, product shots, proposals) generate a small set; picking one restreams everything downstream from it. A/B where a lane supports it (ads, subject lines).
- **Model options** — per-venture model choice + **economy mode** (a cheaper model as a post-gate downgrade to save tokens; can't do tool-calls, so it's routed only to text work). Fund-your-own-tokens is visible; the level rises with real use.
- **The CEO agent** — the one grounded reasoner over the whole venture state; its output is always a *proposed* move on the board, never an executed one. Its plan is legible ("here's why, tap the locks").

---

## 10. Dashboard (portfolio + per-company, in detail)

**Portfolio dashboard** — the aggregate glass box:
- Aggregate strip: ventures · lanes live · moves this week · real revenue (or "—").
- Venture cards (see 5.2), sortable by momentum (moves/week) or by kind.
- A **"needs you"** rail: every staged outbound move across all ventures, so the human's approval queue is one place.

**Per-company dashboard** — inside Strategy:
- Economics readout (real-or-not-connected, per the state rules).
- Momentum: moves/week, tasks by status, autonomy uptime, budget burn vs cap.
- Kind-specific hero metric with its sparkline (activated users / engagements-vs-capacity / paid orders).
- Connector readout ⚡N/5 with each dark lane as a one-tap connect.

---

## 11. Edge cases (exhaustive checklist)

- **No connectors at all** — everything drafts and stages; the product is fully usable as a glass-box planner; every send says which lane it's waiting on. Never dead-ends.
- **Budget hits zero mid-tick** — autonomy drops to `drafting`→`off`, logs the reason, the in-flight artifact is saved not lost.
- **Two ventures, same lane** — a shared connector is per-origin isolated; approving in A never touches B.
- **`onReady` fires twice** (mountConnect + returning-user probe) — idempotency flag; never seed a second copy.
- **`loadState` mid-generation** — merge, never blind-replace, or an in-flight draft lands in a detached orphan and the UI renders empty forever.
- **Multi-item busy** — a Set keyed by item id, never a global `busy` boolean, or working on one item abandons the next.
- **Inherited decision with no options** — fall back to the inherited value, or a downstream builder silently drops the constraint the inherit exists to enforce.
- **A move fails** (lane errors) — surfaced in the log with a retry; the task returns to `staged`, not `done`.
- **Real revenue is zero** — show real zero proudly; never round up to a projection.
- **Agency over-capacity** — warn and refuse to auto-draft new outreach past the quality-bar ceiling.
- **Brand stock-out** — block "approve launch content" that would sell what can't ship; surface restock first.
- **Daemon offline** — cockpit still works read/draft; a banner marks the overnight runner as down.
- **Kind switched after decisions locked** — not allowed silently; requires confirm + re-derives the task set (decisions that still apply carry over).
- **Worktree/path traps** (build-time) — the engine lives in one place; a bare path can build the stale copy. (Dev note, not user-facing.)

---

## 12. Sexiness / register — the oomph

The feeling: **a company that is visibly alive, and visibly honest.** Calm confidence, not casino.

- **Glass box, not black box** — you can always see the last thing it did and *why*. Provable locks. This transparency *is* the aesthetic — competitors show a magic black box; we show the machine and it's more impressive.
- **The living log** — a quiet, continuous shimmer as the ticker advances; moves land with a soft settle, not a toast storm. When autonomy is on, the cockpit breathes.
- **Oomph moments** (the ones worth animating): first company seeded (the cockpit assembles), first draft appears, a lane goes live (⚡ lights), the **first real** milestone (first user / first client / first order) — a genuine, earned celebration because it's a real connector event, never fabricated.
- **The kind glyphs** — three distinct, first-party marks (software / agency / brand) carried consistently from picker to card to cockpit. Hardware-icon language, matte, no AI-default gradients.
- **Design system** — brandbrain tokens throughout (CREST for per-venture brand kits); typography-led, generous negative space, one accent per venture pulled from its own kit so each company *feels* like itself.
- **Motion budget** — reserved for state transitions and earned milestones; never decorative. The autonomy shimmer and the milestone celebration are the two signatures.

---

## 13. Honest gaps (what's spec, not yet real)

- The daemon overnight runner compiles and is wired, but has **not** run against a live funded company — needs a running daemon + real backend. The one real verification gap.
- Live token measurement unavailable on the dev Mac (Claude Code not signed in) — the catalog token figure stays an honest dev guess.
- A live external send / real deploy / real Stripe charge needs the user's connectors + funded time — infra, not UI.
- **Agency** is the least-built archetype (new here) — the `Engagement` object, pipeline board, and dual bd/delivery loops are specced above but not yet in the engine.

The line held throughout: **drafts everything, sends nothing without a lane + the human's go.**
