# Function spec — Growth / Marketing × Sales / Revenue

> The capstone (`docs/AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md`) names the seven functions; this doc
> specs two of them to depth: **Growth** (§2.3, creates and captures demand) and **Sales/Revenue**
> (§2.4 + §5, closes the money loop). They are one column of the cockpit read top-to-bottom: Growth
> makes demand, Sales turns demand into money. Both obey the org invariant — **drafts everything,
> sends/charges nothing without a lane and a founder go** (OS §1, §9).
>
> Grounded in the running example: **Switchboard** — open-source BYO-Claude wrapper app store, **76
> wrapps** (source of truth `examples/apps/wrapps/catalog.json`), live landing at
> **thelastprompt.ai/switchboard/**, privacy-led positioning, monetization = a Pro-subscription pool
> rev-shared to builders by usage (Spotify-style) via **Paddle as merchant-of-record**; the visitor
> who runs a wrapp on their own Claude is **never charged**. Every number in this doc is real or reads
> **"unknown — not instrumented."** No fabrication path exists (OS §4 honesty rule).

---

## 0. The two mandates in one line each

- **Growth / Marketing** — *create and capture demand.* Content, launches, SEO, community,
  partnerships, the landing. Drafts freely; **publishing is gated**. Owns the top of the funnel:
  traffic → signup → activation-top.
- **Sales / Revenue** — *close the money loop.* Pricing, conversion, monetization plumbing, deals.
  Models and stages freely; **charging and sending are gated**. Owns revenue, conversion, ARPU, and
  the health of the money engine.

The seam between them (§4) is the funnel handoff: Growth hands Sales *qualified demand at the
activation line*; Sales hands the number back that reprioritizes Growth. Neither can reach the world
without its lane — Growth is blind without **social / email / deploy**; Sales is blind without
**payments** (OS §6).

---

## 1. Growth / Marketing — deep spec

### 1.1 Mandate, inputs, outputs, autonomy grade

| Field | Value |
|---|---|
| **Mandate** | Create demand (content, launches, SEO, community, partnerships) and capture it (landing, signup path). Move traffic → signup → the top of activation. |
| **Inputs** | the venture's identity + thesis + brand kit (CREST), the product's real facts (76 wrapps, the five-noes privacy story, recent shipped features), the metric tree's top nodes, the CEO's plan for the cycle, Support's feedback clusters, the live landing (`thelastprompt.ai/switchboard/`). |
| **Outputs** | drafted posts, launch kits, SEO pages/copy, community replies, partnership outreach, landing edits — each **staged** with its class, its lane, and its blast radius. |
| **Autonomy grade** | **drafts everything auto (reversible); every publish/send is gated.** This is the whole function's posture: it is the loudest "draft-only until a lane + a go" of any function, because nearly all its output is outbound. |
| **Owns (metrics)** | traffic, signups, activation-top-of-funnel (see §5). |
| **Lanes** | **social** (X, HN, Product Hunt, Reddit, LinkedIn), **blog/CMS**, **email** (list), **deploy** (the landing — for Switchboard the live page lives in the separate `thelastprompt.ai` repo, so a landing edit needs that repo **and** a deploy: a doubly-gated step). |

### 1.2 The "drafts everything, publishing gated" rule (restated for Growth)

Growth's atomic unit is a **staged creative artifact**: the copy is written, the variants are
generated, the ⭐recommended one is marked — and then it waits. The reversible half (writing,
generating, A/B-structuring, SEO-drafting) runs on the autonomy ticker for real; the world-crossing
half (post, send, publish, deploy) is an **approve-move** (OS §1; company spec §6) with the button
labelled as the real act — *"Post to X", "Publish landing", "Send to 142-address list"* — and the
blast radius spelled out beneath it. No lane ⇒ the move stages honestly: *"ready — connect X to
post."* It never dead-ends and never silently sends.

### 1.3 Compiled tasks (the derived task set)

Tasks are **derived, not invented** (company spec §2) — a pure function of the locked decisions +
the current metric gaps. Each row carries a **class** (reversible/outbound), a default **mode**
(`auto | approve | manual`, OS §12), and the **lane** it needs. Mode is set per task-type and
overridable per task.

| Task | Class | Default mode | Lane it needs | Notes |
|---|---|---|---|---|
| **Content — draft post / thread / changelog** | reversible | **auto** | — (draft only) | high-volume; economy-model routed (§6). |
| **Content — publish post** | outbound | **approve** | social / blog | approve-move; A/B on subject/hook where lane supports. |
| **Launch — assemble a launch kit** (Show HN, PH tagline+desc, X set, changelog, email) | reversible | **auto** | — | drafted as one bundle from real product facts (cf. `CYCLE-001.md §2`). |
| **Launch — fire the launch** (post HN/PH, send email, flip landing) | outbound | **approve** | social + email + deploy | multi-lane; each sub-move gated separately, sequenced. |
| **SEO — keyword/page plan** | reversible | **auto** | — | derived from the thesis + real product surfaces. |
| **SEO — publish a page / meta change** | outbound | **approve** | blog/CMS / deploy | reversible-to-draft, gated-to-live. |
| **Community — draft reply / comment** | reversible | **auto** | — | grounded in real state; Support co-owns tone. |
| **Community — post reply** | outbound | **approve** | social / forum | never auto-post into a community — spam risk (§7). |
| **Partnership — build target list + draft outreach** | reversible | **auto** | — | list is data; outreach is a draft. |
| **Partnership — send outreach** | outbound | **approve** | email | volume-capped, dedup-checked (§7). |
| **Landing — audit + draft edit + hero variants** | reversible | **auto** | — | e.g. the real "20+" → "76" fix + hero rewrite in `CYCLE-001.md §1`. |
| **Landing — deploy the edit** | outbound | **approve** (×2 for Switchboard) | deploy (+ external `thelastprompt.ai` repo access) | doubly-gated; names both blockers. |

### 1.4 The funnel Growth owns

```
   TRAFFIC ──▶ SIGNUP/INSTALL ──▶ ACTIVATION-TOP
   (visits,     (download,          (first wrapp run
    referrers)   first-open)         on a connected
                                     Switchboard)
        └──────────── Growth owns ────────────┘  │
                                                 ▼
                                          (Sales' funnel begins:
                                           activation-deep → Pro → earning)
```

Growth's line ends at **activation-top** — the first real use of the product (for Switchboard:
first wrapp-run on a connected Switchboard, the north-star's atom). It does **not** own the money
conversion; that's the handoff to Sales (§4). Growth is measured on getting a real human to the
first-run line, honestly — a traffic spike that doesn't reach activation is flagged as **vanity**,
not a win (OS §14 ungameable-check; §7 edge case here).

---

## 2. Sales / Revenue — deep spec

### 2.1 Mandate, inputs, outputs, autonomy grade

| Field | Value |
|---|---|
| **Mandate** | Close the money loop: pricing, conversion, monetization plumbing, deals. Turn activated users into Pro subscribers; keep the pool→builder rev-share honest. |
| **Inputs** | the money model (kind-resolved), the activation signal handed up by Growth, real pricing-experiment results, the payments lane's `listTools`/webhook truth, Finance's budget + unit-cost inputs. |
| **Outputs** | pricing models + experiments (drafted), checkout/upgrade pages + email sequences (staged), a **checkout path** prepared but not charged, the revenue-state readout (real-or-not-connected). |
| **Autonomy grade** | **models pricing and drafts pages/sequences and prepares checkout auto (reversible); charging and sending are gated.** The `earning` state is **unreachable** without a payments lane + a real paid event (OS §5). |
| **Owns (metrics)** | revenue, conversion, ARPU, money-loop health (§5). |
| **Lanes** | **payments** (Paddle as MoR; Stripe as the per-kind alternative), **email** (upgrade/dunning sequences), **MoR** (Paddle handles card data + tax so the platform never touches either). |

### 2.2 The money engine, concretely

**The model (Switchboard).** A **Pro-subscription pool**. Pro subscribers pay one recurring fee; that
pool is **rev-shared to wrapp builders by usage** (Spotify-style — a builder's share = their share of
total qualifying wrapp-runs). **Paddle is merchant-of-record**: it collects the money, owns the card
data and the sales-tax/VAT liability, and remits. The platform is a thin broker on top — it never
touches a card number and never files a tax return. Crucially: **the visitor who runs a wrapp is
never charged.** They already pay Anthropic for their own Claude; the wrapp runs on *their* compute.
Revenue comes only from **Pro subscribers**, never from the runner. This is the invariant that keeps
the privacy-led, BYO-Claude story and the money story consistent (they'd contradict if we charged the
runner).

**Per-kind resolution** (OS §5; company spec §1). Same engine, `kind` picks the meter:

| kind | money meter | MoR |
|---|---|---|
| **software (Switchboard)** | Pro-pool usage share **or** subscription | Paddle |
| **agency** | billable — paid invoices (retainer/project) | Stripe/invoicing |
| **brand** | paid orders from the storefront | Shopify + MoR |

**The checkout path** (software / Switchboard):

```
 activated user ──▶ upgrade surface ──▶ Paddle checkout (MoR) ──▶ webhook: paid ──▶ Pro active
   (Growth's         (Sales' staged      (hosted by Paddle;        (the ONLY thing      │
    handoff)          page; no card        card + tax never          that flips           ▼
                      touches us)          hit the platform)         `earning`)      pool accrues;
                                                                                      builder share
                                                                                      computed by usage
```

Sales **prepares** every box up to the Paddle checkout (drafts the upgrade page, wires the
would-be checkout link, drafts the confirmation + dunning email). The **charge itself is gated**: it
only exists once the founder connects Paddle (a lane) and only fires on a real user action. Sales
never charges on the ticker.

**Pricing experiments.** Sales generates pricing as **N options + ⭐recommended** (OS §12): price
point, billing period (monthly/annual), the free/Pro line, trial vs no-trial. Where the payments
lane supports it, price/paywall variants run as a real **A/B** (company spec §9). Until the lane is
live, experiments are **drafted proposals with an explicit "needs payments to run" tag** — no result
is invented. A pricing model shown without a live meter is labelled *projected*, never *revenue*.

### 2.3 The revenue-state ladder (no fabrication path)

Exactly three states (OS §5; company spec §4.5). There is **no fourth "estimated revenue" state.**

```
 not-connected ───▶ connected, zero ───▶ earning
 (no payments        (Paddle live,        (a real paid
  lane; revenue        real meter, and      webhook fired;
  reads "not           honestly $0)         the number is
  connected")                               real, from the
                                            connector)
```

- **not-connected** — no payments lane. Revenue reads *"not connected."* Everything up to checkout is
  staged and usable as a glass-box plan.
- **connected, zero** — Paddle is connected, the meter is real, and it honestly reports **$0**. Shown
  proudly as a real zero (company spec §11) — never rounded up to a projection.
- **earning** — a **real** paid event (a Paddle webhook) fired. The state **cannot be entered by
  fabrication** (OS §5; company spec §4.1 guard) — no connector, no `earning`. The first transition
  here is an earned milestone worth celebrating (company spec §12), because it's a real connector
  event.

**Projections live in their own channel.** Pool-size-at-N-subscribers, TAM math, agency pipeline
value, brand demand forecasts — all clearly labelled *projected* and **never touch the revenue
figure** (company spec §4.5).

### 2.4 Unit economics — shown only when the inputs are real

Sales surfaces unit economics **only once each input is a real meter**, else the cell reads
*"unknown — not instrumented"* (OS §5). No input estimated as fact.

| Metric | Formula | Requires (real inputs) | Until then |
|---|---|---|---|
| **CAC** | Growth spend ÷ new Pro subs | a real ad/spend meter + real sub count | "unknown" (no paid spend yet) |
| **Payback** | CAC ÷ monthly gross margin per sub | CAC + margin, both real | "unknown" |
| **Gross margin** | price − (Paddle fees + real COGS) | Paddle fee data + real COGS | "unknown" (fees known only once Paddle live) |
| **ARPU** | Pro revenue ÷ active users | real Pro revenue + real active count | "unknown" |
| **Pool share / builder** | builder's qualifying runs ÷ total qualifying runs × pool | a real runs meter + a real pool balance | "unknown" |

Because Switchboard's revenue and traffic are currently **unknown — not instrumented** (per
`docs/operating/LOG.md`), every one of these reads "unknown" **today**, honestly. They light up
input-by-input as Finance/Analyst stand up the meters and the founder connects Paddle.

---

## 3. The Growth → Sales handoff (demand → conversion → revenue)

The two functions are a pipeline, not a wall:

```
 GROWTH                         │  handoff line          SALES
 ───────────────────────────────┼───────────────────────────────────────────
 traffic ─▶ signup ─▶ activation│─top ──▶ activation-deep ─▶ Pro upgrade ─▶ earning
 (owns getting a real human to  │        (Sales owns turning an activated
  first wrapp-run)              │         user into a paying Pro subscriber)
                                │
        ◀──────────────── reallocation feedback ────────────────────
        (Sales' conversion + ARPU numbers feed next cycle's CEO scoring:
         if traffic is high but conversion is dead, the CEO shifts budget
         from Growth's top-of-funnel to Sales' activation-deep / pricing.)
```

- **The handoff object** is the **activated user** — a real human who ran a wrapp on a connected
  Switchboard (Growth's exit metric = Sales' entry metric; one shared node in the tree, §5). This
  single shared node prevents the classic vanity trap: Growth can't "win" by driving traffic that
  never activates, because its own owned metric ends *at* the shared line, and Sales' funnel visibly
  starts empty if the traffic didn't convert.
- **Reallocation is the point** (OS §3). Last cycle's *measured* conversion feeds this cycle's CEO
  scoring. High traffic + low conversion ⇒ the CEO moves leverage from Growth acquisition to Sales
  conversion (pricing, upgrade UX) — the loop bends toward the bottleneck without the founder
  steering.

### 3.1 Where each is blind without its lane (OS §6 degradation, made specific)

| Function | Blind without | What it can still do | What it cannot do |
|---|---|---|---|
| **Growth** | **social** | draft every post/thread/launch set | post anything — stages "connect X to post" |
| **Growth** | **email** | draft launch + nurture emails | send — stages "connect Gmail/email to send" |
| **Growth** | **deploy** (+ external landing repo) | draft the landing edit + hero variants | push it live — stages "connect deploy (+ `thelastprompt.ai` repo access)" |
| **Sales** | **payments (Paddle/MoR)** | model pricing, draft upgrade page + checkout, draft sequences | **charge** — revenue stays `not-connected`; `earning` is unreachable |
| **Sales** | **email** | draft dunning/upgrade sequences | send them |

Degradation is **loud and specific** (OS §2 org rule; §6): a starved function drops to **draft-only**
and *names the exact lane it needs*, links to connect it, and returns to the staged move afterward —
never a silent stall. The company is fully usable as a glass-box planner with **zero** lanes; each
connected lane converts a column of drafts into doable action (OS §15).

---

## 4. Metrics owned + the metric tree

### 4.1 The tree (OS §4) — which nodes each function owns

North star (OS §4): **weekly active wrapp-runs on connected Switchboards** — usage of the thing, on
real user compute.

```
                      ★ weekly-active wrapp-runs   (north star — usage, real compute)
                      ╱                       ╲
        ┌────── GROWTH owns ──────┐   ┌────────── SALES owns ──────────┐
   traffic ─▶ signup/install ─▶ activation ─▶  Pro-conversion ─▶ revenue
   (visits)   (downloads)       (first run)    (% activated→Pro)  (Pro-pool $)
      │            │                │                 │              │
   referrers   install-rate    activation-rate    ARPU           pool-share/builder
```

- **Growth owns:** traffic, signup/install, install-rate, activation-top (first-run) — the top three
  layers.
- **Sales owns:** Pro-conversion, revenue, ARPU, pool-share-per-builder — the bottom layers.
- **Shared node:** *activation (first run)* is Growth's exit and Sales' entry — the handoff (§3).
- **Ungameable check** (OS §14): any metric a function can move *without* moving the north star (e.g.
  bot traffic, a signup that never runs a wrapp) is flagged a **vanity gain**, not a win.

### 4.2 Per-metric state machines

Every metric is **real (a meter reported it)** or reads **"unknown — not instrumented"** (OS §4).
Today, for Switchboard, traffic and revenue are both **unknown** (LOG.md) — so the honest states are:

- **Traffic / signup / activation** (Growth) node state: `unknown — not instrumented` → (Analyst
  stands up analytics on the live property) → `real: N` → per-cycle `Δ` tracked with history.
- **Revenue** (Sales) node state — the ladder (§2.3): `not-connected` → `connected, zero` →
  `earning`. Mirrors OS §5 exactly.
- **Conversion / ARPU / pool-share** (Sales): `unknown` until *both* numerator and denominator are
  real meters; a half-real ratio stays `unknown` rather than showing a misleading number.
- **OKR rollup** for each (OS §10): `set → on-track / at-risk / missed`, each computed from real
  deltas, or `unknown` when the meter is missing. A missing meter makes the OKR `unknown`, which is
  itself the Analyst's highest-priority task (OS §4 instrumentation-first).

### 4.3 Cockpit surfaces (OS §11; company spec §5.3, §10)

- **Growth column** (the cockpit's Growth domain): site preview, social with an auto-post toggle,
  outreach/inbox, ads preview — each item showing draft-vs-gated state and its owned funnel metric
  (traffic → signup → activation) real-or-unknown.
- **Strategy → economics readout** (Sales' surface): the revenue-state ladder (`not-connected` /
  `connected, zero` / `earning`), ARPU + conversion (real-or-unknown), pool-share per builder, and
  the unit-economics table (§2.4) with every not-yet-real cell reading "unknown." Connector readout
  ⚡N/5 with payments as a one-tap connect when dark.
- **The Brain view** (OS §11): the metric tree live — the Growth nodes and Sales nodes side by side,
  each real-or-unknown, with the shared activation node lit as the handoff.
- **Needs-you queue** (OS §11; company spec §10): every gated Growth publish and Sales charge across
  ventures, one place, each with blast radius and the lane it's waiting on.

---

## 5. Routines (the temporal spine — OS §8; company spec §7)

Each routine is honest about its boundary in its own header ("reads state, drafts — sends nothing").

| Routine | Tempo | What it does | Boundary |
|---|---|---|---|
| **Content cadence** | daily (on the autonomy ticker) | Growth drafts the day's content (post/thread/changelog) from real product facts + Support's clusters; fills the review queue. | reversible only; drafts, never posts; economy-model routed; budget-guarded. |
| **Launch playbook** | on-trigger (a shipped feature / milestone) | Assembles the full launch kit (Show HN, PH tagline+desc, X set, changelog, launch email) as one bundle, sequences the gated sub-moves. | drafts the whole kit; each publish/send is a separate approve-move. |
| **Pricing review** | weekly (rides the weekly review) | Sales re-reads real conversion + ARPU (or "unknown"), drafts the next pricing experiment as options + ⭐recommended, proposes an A/B if the lane supports it. | drafts; founder commits; no price goes live without a go. |
| **Funnel watch** | on-change / daily | Analyst-fed: watches traffic→signup→activation→conversion deltas; flags a vanity spike (traffic up, activation flat) and a conversion cliff (activation up, Pro flat) for the CEO to reallocate. | alerts only; never acts. |

All four are **reversible-only** and **budget-guarded**: at the budget cap the ticker drops
`drafting → off` and saves in-flight drafts (OS §5 budget guard; §10 budget state).

---

## 6. Branching & AI options (OS §12; company spec §9)

- **Creative variants + ⭐recommended** — every Growth creative surface (hero, post, thread, launch
  copy, outreach angle) and every Sales choice (price point, billing period, paywall copy) generates
  **N options with one ⭐recommended**; the founder answers "1a 2c" style; picking one **restreams
  everything downstream** from the pick (e.g. the chosen hero reshapes the launch kit's framing). Real
  example already in the record: the two hero variants + ⭐A in `CYCLE-001.md §1`.
- **A/B where a lane supports it** — ads and email subject/hook lines (Growth) and price/paywall
  variants (Sales) run as real A/Bs **only when the lane is live**; otherwise the variants are drafted
  and tagged "needs \<lane\> to run." No A/B result is ever invented.
- **Economy-model routing for high-volume drafting** — Growth's content/variant drafting and outreach
  drafting are high-volume reversible text work → routed to the **economy model** (a cheaper model as
  a post-gate downgrade; can't do tool-calls, so text-only work only). The CEO's Decide/pricing-strategy
  reasoning and anything crossing a lane stay on the deep model. Routing is a cost lever Finance owns
  (OS §12); the local-can't-do-tools boundary is respected.

---

## 7. Edge cases (≥12, across both functions)

1. **A launch flops** (Growth) — posted, near-zero traffic delta. Not hidden: the flat delta lands in
   the log honestly, the launch is marked low-yield, and the CEO deprioritizes that channel next cycle
   (OS §3 reallocation). No spin, no invented "impressions."
2. **Zero-traffic honest state** (Growth) — analytics not yet connected ⇒ traffic reads *"unknown —
   not instrumented"* (LOG.md today). Growth still drafts; standing up the meter becomes the Analyst's
   top task (OS §4 instrumentation-first). Never a fabricated visit count.
3. **No payments lane** (Sales) — revenue stays `not-connected`; the full checkout is staged and
   usable as a plan; `earning` is unreachable. Every upgrade CTA reads "ready — connect Paddle to
   charge" (§2.3).
4. **Pricing change mid-cycle** (Sales) — a live price edit is a gated approve-move; in-flight
   checkouts honor the price they started on (no retroactive change); the change is logged with its
   before/after and the experiment it belongs to.
5. **Refund** (Sales) — a real Paddle refund webhook **decrements** real revenue; it is never netted
   silently. If it drops the venture back to real $0, the state honestly returns to `connected, zero`
   from `earning` — the ladder runs backward truthfully. Refund itself is Paddle/founder-gated (a
   money-moving action, OS §9).
6. **Vanity-traffic vs activation** (handoff) — traffic spikes but activation is flat: flagged a
   **vanity gain**, not a win (OS §14 ungameable-check); the CEO shifts leverage from acquisition to
   activation. Growth is not credited for traffic that never reached first-run.
7. **Spam-risk on outreach** (Growth) — partnership/outreach sends are volume-capped, deduped against
   prior contacts, and **never auto-posted into communities**; community replies are always
   `approve`, never `auto` (§1.3). An outreach batch over the cap refuses to auto-draft more until the
   founder clears it (mirrors OS §14 "function starved" discipline).
8. **Budget exhausted mid-draft** (both) — the content/pricing ticker drops `drafting → off`, the
   in-flight draft is **saved not lost**, the reason is logged, the founder notified (OS §5, §14).
9. **A gated post stuck forever** (Growth) — a staged publish with no lane stays `staged`
   indefinitely; it never silently expires and never auto-sends; the Needs-you queue shows its age
   (OS §14).
10. **Landing edit blocked on external repo** (Growth, Switchboard-specific) — the live landing is in
    the separate `thelastprompt.ai` deploy repo, so a landing fix is **doubly gated** (repo access +
    deploy). The staged move names *both* blockers explicitly (LOG.md constraint; §1.3).
11. **Two ventures share a lane** (both) — a connected Paddle/social/email lane is **per-origin
    isolated**; approving a charge or a post in venture A never fires for venture B (OS §6; company
    spec §11).
12. **Fabricated-number pressure** (Sales) — a stakeholder wants "a revenue number for the deck."
    Sales refuses to invent one: it shows real revenue (or `not-connected`) and, separately, a
    clearly-labelled **projected** pool-at-N-subscribers model that never touches the revenue figure
    (§2.3; OS §4).
13. **Conversion cliff** (handoff/Sales) — activation is real and rising but Pro-conversion is flat:
    funnel watch flags it; the bottleneck is pricing/upgrade UX, so the CEO reallocates to Sales, not
    Growth (§3.1).
14. **A published post needs a correction** (Growth) — a live post with an error: the fix is itself a
    gated approve-move (edit/delete-and-repost), logged; the original is not silently memory-holed.
15. **Trial-to-paid churn** (Sales) — if a trial is offered, a trial that ends without payment is a
    real "did-not-convert," not counted as revenue at any point; only a real paid webhook counts.

---

## 8. Today-doable vs blocked (OS §15, honest split)

**Runs today — reversible, real, no founder input:**
- **Growth** drafts the full content + launch surface from real product facts: Show HN / Product Hunt
  / X set / changelog / launch email, hero rewrites, SEO page plan, community + partnership outreach
  drafts, the landing audit + "20+" → "76" fix + hero variants (all already demonstrated in
  `docs/operating/CYCLE-001.md`).
- **Sales** models the Pro-pool + Paddle-MoR economics, drafts the upgrade page + checkout path +
  confirmation/dunning sequences, and drafts pricing experiments as options + ⭐recommended.
- **The metric tree's shape** is stood up with every Growth/Sales node reading its honest state (today:
  traffic + revenue = "unknown — not instrumented").
- **Branching + economy-model routing + the routines** (content cadence, launch playbook, pricing
  review, funnel watch) all run on the reversible half.

**Blocked on the three founder bottlenecks (OS §9):**
- **Signal** — Growth's traffic/signup/activation and Sales' conversion/ARPU stay `unknown` until the
  founder connects **analytics** on the live property.
- **Money** — revenue stays `not-connected` and `earning` is unreachable until the founder connects
  **Paddle** (+ the legal entity of record). No paid event, no revenue loop.
- **Hands** — every Growth publish/send and the landing deploy stay staged until **social / email /
  deploy** (and, for the landing, the external `thelastprompt.ai` repo) are connected.

> The line held throughout, both functions: **drafts everything, publishes/charges nothing without a
> lane and the founder's go.** Each founder unlock — an analytics meter, the Paddle lane, a social
> token — converts a whole column of Growth/Sales drafts into live action. That conversion, repeated,
> is the launch.
