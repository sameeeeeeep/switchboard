# Function spec: Finance / Ops — the money conscience

> One of the seven functions in [the Operating System capstone](../AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md)
> (§2.6, §5, §9) and [the full spec](../AUTONOMOUS-COMPANY.md). This is the deep spec for the function
> that keeps the company **solvent, honest about money, and inside a budget it can never overspend**.
> Grounded in Switchboard's real economics (the [token economy](../TOKENS.md)): monetization is a
> Pro-subscription **pool** rev-shared to builders by usage, with **Paddle as merchant-of-record**;
> the real runway cost is **token/compute** (BYO-Claude means the visitor's runs are free to us); the
> company-of-record candidate entity is `sameep.ai`. The model is kind-agnostic — `kind` only picks
> which meter reports revenue.

---

## 0. The one line

**Finance is the function that turns "autonomous" into "affordable-by-construction" and "solvent-by-honesty":**
it holds the budget guard that caps the loop before it can overspend, tracks a runway that is mostly
compute, and refuses to print a single economic number that a meter didn't report. It is also the one
function with a hard ceiling on its own authority — the legal person, the bank, the contracts, and the
entity of record are **structurally beyond any agent**, forever, by law and not by policy.

Finance's outputs are never *money moved*. They are: a budget the CEO allocates against, a runway
countdown, a unit-economics readout that is real-or-`unknown`, and a queue of spend/legal moves staged
for the founder. The dollar and the signature stay human.

---

## 1. Mandate & the authority ladder (auto · gated · founder-only)

**Mandate:** runway, spend, unit economics, the budget guard, and the legal/entity boundary. Finance is
the CEO's affordability oracle (§3) and the company's money conscience — it can model anything and
commit nothing.

Every Finance capability sits on one of **three rungs**. The rung is a property of the *act*, not a
setting — no configuration promotes a founder-only act to gated, ever.

| Rung | What it means | Finance acts here |
|---|---|---|
| **auto** (reversible) | runs itself, budget-permitting, no human | read meters, compute runway/burn, model unit economics, allocate the per-function budget, draft a spend proposal, reconcile the ledger, route to the economy model, **enforce the budget guard** |
| **gated** (approve-move) | drafted + staged; needs a lane **and** a founder go | execute a spend the platform *can* make once a lane exists (a Paddle payout config, an ad-spend cap change, a tooling subscription on the company card), file an accounting export, apply a refund the MoR permits |
| **founder-only** (structural) | **no agent may ever do this**, connected lane or not | be the legal person; open/operate the **bank** account; sign **contracts**; incorporate or change the **entity of record** (`sameep.ai`); accept MoR terms with Paddle; anything that legally requires a natural or legal person |

> **The structural line (non-negotiable).** Rungs one and two are about *reversibility and consent*.
> The third rung is about *legal capacity* — and an agent has none. It cannot own a bank account, cannot
> be a party to a contract, cannot be the taxable entity. This is not a guardrail we chose; it is a fact
> we encode. Finance's job at this line is to **name the exact founder-only act, prepare everything
> around it, and stop** — draft the contract, never sign it; model the payout, never open the bank; fill
> the incorporation packet, never be the incorporator.

**What "prepare everything around it" looks like.** A founder-only act still gets full Finance support up
to the legal edge: the contract is drafted and red-lined, the bank-setup checklist is compiled with the
exact fields, the entity packet is pre-filled with `sameep.ai` details, the Paddle onboarding steps are
sequenced. The founder walks into a finished form and provides only the thing a machine legally can't —
their identity and their signature. Finance measures its own success partly by *how little* is left for
the founder to do at that edge, never by doing the edge itself.

---

## 2. The budget guard (concrete)

The budget guard is the mechanism that makes autonomy **affordable-by-construction**: the loop cannot
spend past a cap because the cap is checked *before every autonomous act*, and hitting it doesn't crash
the company — it lowers autonomy and preserves work.

### 2.1 What the budget is denominated in

Two real costs, one honest unit each:

- **Token/compute budget** — the dominant runway cost, because BYO-Claude means visitor runs cost the
  platform nothing; what the *company itself* spends is the agents' own model tokens (the CEO's Decide/
  Learn reasoning, Product's real code, Growth's drafting). Denominated in **metered model tokens**
  normalized by the published [rate card](../TOKENS.md) (a haiku token < an opus token). The daemon
  already meters this per origin (`usage.tokensToday`, `OriginGrant.budgets`) — the guard reads the same
  meter the payout ledger does, so it can't be fooled.
- **Spend cap** — any *real fiat* the company commits (an ad budget once a payments lane exists, a
  tooling subscription, a Paddle payout float). Denominated in the currency of record (§7.5). Zero until
  a lane makes real spend possible — until then the spend cap is `0`, honestly, and every fiat move
  stages as "ready — connect a payments lane."

Both are **caps, not forecasts**. A cap is a number the loop is forbidden to cross; a forecast is a
guess, and Finance doesn't dress guesses as limits.

### 2.2 The guard's state machine

```
   healthy ───(spend crosses warn threshold)──▶ warning ───(spend hits cap)──▶ capped
      ▲                                            │                              │
      └──────────(founder raises cap / new cycle resets budget)◀─────────────────┘
```

- **healthy** — below the warn threshold (default 75% of cap). Autonomy runs normally.
- **warning** — between warn and cap. Autonomy still runs, but the CEO is told to prefer cheap/reversible
  moves and Finance surfaces the burn rate + the projected cap-hit time (labeled *projected*, not fact).
  Economy-model routing (§2.4) is nudged on.
- **capped** — spend has reached the cap. **Autonomy drops `drafting → off`.** No further autonomous
  token spend. In-flight work is saved (§2.3), the reason is logged, the founder is notified with the one
  number that matters ("hit the 8M-token cycle cap at 14:20; 3 tasks paused mid-draft, all saved").

The drop is exactly the capstone rule (§5, §10): *hitting the cap drops autonomy `drafting → off` and
saves in-flight work. Autonomy is always affordable-by-construction.* The company can never wake up to a
bill it didn't approve, because the ceiling is enforced before the spend, not reconciled after it.

### 2.3 How the cap saves in-flight work (not lose it)

The guard is checked at the **task boundary**, not mid-token. When a task would push spend over the cap:

1. The **currently-executing** task is allowed to finish its atomic step and its partial artifact is
   **persisted to the artifact store** in whatever `drafting`/`staged` state it reached — never discarded.
2. The task's status returns to `staged` (if it produced a reversible artifact) or `blocked: over-budget`
   (if it needs more compute to be useful) — never `done`, never silently dropped.
3. Autonomy flips `off`; the ticker stops pulling new tasks.
4. A `budget:capped` entry hits the decision log with the reason and the saved-work manifest.
5. On the next cycle (or a founder cap-raise), work resumes from the persisted state — continuity
   guarantee (§7 of the capstone): nothing important lived only in a session's head.

This is the finance-side twin of the master doc's edge case *"budget hits zero mid-tick → autonomy drops
to drafting→off, logs the reason, the in-flight artifact is saved not lost."*

### 2.4 Per-function budget allocation (the lever the CEO uses)

Finance doesn't just cap the *whole* company — it hands the CEO a **per-function budget envelope** each
cycle, and the CEO allocates effort against it (this is the "can we afford it?" filter in the CEO's
prioritization, capstone §3.3). The default split is derived from last cycle's leverage, not fixed:

| Function | Typical envelope share | Why |
|---|---|---|
| **Product/Eng** | largest | real code on the real repo is the genuine unlock; deep-model tokens, highest value-per-token |
| **CEO/Analyst** | steady overhead | Decide/Learn + the metric tree run every cycle; can't be starved or the loop goes blind |
| **Growth/Support** | elastic, economy-routed | high-volume reversible drafting → cheap models (§2.4 routing); scales down first under `warning` |
| **Sales/Finance** | small | mostly modeling + staging; cheap until a real lane makes real spend |

**Reallocation is the point** (capstone §3): a function that's winning gets more envelope next cycle; a
function whose drafts never convert gets less. The envelope is a soft budget *within* the hard cap — a
function can be told "you're out of envelope this cycle" (degrades to draft-only *loudly*) without the
whole company hitting `capped`. Finance owns the envelope math; the CEO owns the allocation decision.

### 2.5 Economy-model routing as a cost lever

Finance owns model routing as a **spend lever** (capstone §12): route high-volume reversible work to the
cheaper economy model to stretch the token budget. The rules, inherited from the real economy-mode
decision:

- Economy routing is a **post-gate downgrade** — it changes *which model* does an already-permitted task,
  never *whether* the task is permitted. No extra grant needed.
- **The local-can't-do-tools boundary is respected**: economy/local models are routed only to pure text
  work (Growth variants, Support triage drafts, summaries). Any task that must call a tool (Product's
  code edits, connector actions) stays on the tool-capable deep model.
- Under `warning`, Finance nudges economy routing **on** for eligible work automatically; under `healthy`
  it's the CEO's/founder's per-function choice. This is the graceful degradation that keeps the loop
  alive longer before it has to hit `capped`.

---

## 3. Unit economics (real-or-`unknown`, never fabricated)

Finance models CAC, payback, gross margin, pool-share, and LTV — but **each figure appears only when its
inputs are real**, and reads `unknown — not instrumented` otherwise. This is the honesty rule (capstone
§4, §5) applied to money: no estimate dressed as a fact, no fabricated number, ever.

### 3.1 The metrics and their real-input gates

Each row is a locked gate: the metric is computable *only* when every input in its "requires" column is a
real meter/connector reading. Miss one → the whole metric reads `unknown`, with the missing input named.

| Metric | Formula | Requires (all must be real) | Until then |
|---|---|---|---|
| **CAC** | Growth spend ÷ new paying users | real Growth **spend** (a payments/ads lane) + real **paying-user count** (Paddle) | `unknown — no growth spend meter` |
| **Payback** | CAC ÷ (monthly gross margin per user) | CAC (above) + gross margin (below) | `unknown` — inherits its inputs' gaps |
| **Gross margin** | revenue − COGS − fees | real **revenue** (Paddle) + real **COGS** + real **fees** (Paddle's MoR statement) | `unknown — COGS not entered` |
| **Pool-share per builder** | this wrapp's metered Pro usage ÷ total Pro usage | real **metered usage** (the daemon meter — already real) + real **Pro pool** (Paddle Pro revenue) | share is REAL, pool is `unknown` until Pro revenue is real → the *dollar* payout stays `unknown` |
| **LTV** | ARPU × gross-margin % × avg lifetime | ARPU (real revenue ÷ users) + gross margin + **real retention/lifetime** (needs history) | `unknown` — needs several real cycles of retention |

Note the honest asymmetry on **pool-share**: the *usage share* is real today (the broker is the meter,
pages can't fake their own usage — [TOKENS.md](../TOKENS.md) invariant), but the *dollar value* of that
share is `unknown` until real Pro revenue exists to divide. Finance shows the real half and marks the
unreal half — it never multiplies a real share by an imagined pool to manufacture a payout figure.

### 3.2 COGS is the usual missing input

For Switchboard-as-software the dominant "COGS" is **compute** — and because BYO-Claude means the runner
pays for their own inference, the platform's marginal cost per Pro user is genuinely near-zero except for
any hosted-inference fallback and Paddle's fees. So gross margin is often `unknown` for the honest reason
that **COGS hasn't been entered**, not because it's high. Finance's job is to say exactly that — `gross
margin: unknown — enter COGS` — and to make entering COGS a one-field founder task, not to guess a number
to fill the hole. For an agency `kind`, COGS is delivery capacity/hours; for a brand `kind`, COGS is
unit cost + fulfillment. Same gate, `kind` picks the input.

### 3.3 The revenue-state ladder (no fabrication path)

Revenue lives on the same three-rung ladder as the archetype specs (capstone §5, master §4.5) — and there
is **no fourth "estimated" rung**, by construction:

```
   not-connected ──(founder connects Paddle + entity)──▶ connected, zero ──(a REAL paid event)──▶ earning
        │                                                      │                                      │
   "no payments lane;                              "real, and honestly $0 —                "a connector reported
    revenue is unknown"                             the meter reports zero"                  real money; economics
                                                                                             inputs start filling in"
```

- **not-connected** — no payments lane. Revenue reads `not connected`, not `$0`. Every monetization move
  stages as "ready — connect Paddle to earn."
- **connected, zero** — the lane exists and the meter reports a real, honest zero. This is a *proud* zero
  (master §11 edge case: *"Real revenue is zero — show real zero proudly; never round up to a
  projection"*). It is categorically different from `not-connected`: one is unknown, the other is a
  measured fact.
- **earning** — a real Paddle paid event flipped the state. **This state is unreachable by fabrication** —
  the guard on the venture lifecycle (master §4.1) literally cannot enter `earning` without a connector
  event. As real inputs arrive with the first paid event, the §3.1 metrics begin resolving from `unknown`
  to real, one gate at a time.

**Projections live in a separate channel.** Where a `kind` has a pipeline (agency deal value, brand
demand forecast), that number lives in a clearly-labeled *projected* lane and **never** touches the
revenue figure or the unit-economics inputs. Finance may show "pipeline: $X projected" beside "revenue:
$0 real" — it may never add them.

---

## 4. Runway, the merchant-of-record boundary & the founder bottlenecks

### 4.1 Runway tracking

Runway is **how long the company can keep running before it exhausts what the founder funded** — and for
a software `kind` that is overwhelmingly **compute time**, not cash:

- **Compute runway** — funded token budget ÷ current burn rate = cycles/days remaining. This is the
  primary runway meter, real today (the daemon meters burn). Shown as a countdown ("~11 days at current
  burn" — the rate is real, the projection is labeled *projected*). This is the token-game "level" from
  the master spec (§2.1) read as a runway: funding your own tokens *is* extending runway, framed as fuel.
- **Cash runway** — any real fiat commitments ÷ funded cash. `not-connected`/`unknown` until real spend
  exists; for a brand `kind` this is the cash-to-restock line, real once a storefront + supply connector
  report.

Runway is never a promise. It's `funded ÷ measured-burn`, with the burn real and the horizon labeled
projected — same honesty posture as everything else. No connector, no runway number: `runway: unknown —
no burn meter` (which, for compute, is real today, so compute-runway is the one that actually shows).

### 4.2 The merchant-of-record boundary (why the platform stays clean)

**Paddle is the merchant-of-record** — this is a load-bearing architectural choice, not just a vendor
pick. It draws a bright line that keeps a whole class of founder-only/regulated work *off the platform*:

| Paddle (MoR) handles | So the platform **never**… |
|---|---|
| card data / PCI scope | touches a card number, holds PCI scope |
| sales tax / VAT calculation + remittance | computes or remits tax in N jurisdictions |
| chargebacks / refund rails | operates a payment processor |
| payout mechanics to builders | becomes a money transmitter (until dev cash-out, deliberately deferred — [TOKENS.md](../TOKENS.md) future work) |
| the buyer-facing invoice/receipt | is the legal seller of record for the card transaction |

The value: Finance can *model* the whole money loop and Paddle *is* the thing that legally executes it,
so the platform stays a **thin broker** (the doctrine throughout). Setting up Paddle — accepting its MoR
terms, being the legal counterparty — is **founder-only** (§1, it's a contract + entity act). Finance
preps the onboarding and stops at the signature.

### 4.3 The three founder bottlenecks, from the money angle

The capstone (§9) names three structural bottlenecks only the founder can unclog. Finance's whole reason
to exist is honest accounting of the middle one, and it depends on the other two:

| Bottleneck | The money reading | Until the founder clears it |
|---|---|---|
| **Money** (payments + entity) | needs Paddle **and** a legal `sameep.ai` company-of-record — a machine can be neither the MoR counterparty nor the taxable entity | no revenue loop; every economic metric that needs real revenue reads `unknown`; the company is a glass-box planner, honestly pre-revenue |
| **Signal** (analytics) | without real usage/spend meters, CAC/payback/margin have no inputs | Finance models the *shape*, marks every figure `unknown`, and the CEO allocates budget by guess |
| **Hands** (connectors) | without a payments lane, no spend can execute and no revenue can be reported | spend moves stage forever as "connect Paddle to…"; spend cap stays `0`; only compute runway is live |

Naming these from the money side is part of the spec: an honest autonomous company is explicit that it
**cannot** open its own bank, be its own legal seller, or report revenue it has no meter for.

---

## 5. Metrics owned · state machines · lanes · cockpit surface

### 5.1 Metrics Finance owns

Per capstone §2.6 — Finance **owns**: runway, burn, unit economics, budget caps. Concretely the meters it
is accountable for (real-or-`unknown` each):

- **runway** — compute (real today) + cash (real once a lane reports)
- **burn rate** — tokens/cycle and $/cycle (compute burn real today)
- **budget health** — % of cap consumed, per-function envelope consumption, guard state
- **unit economics** — the §3 table, each gated on real inputs
- **the money-loop health** — revenue state (§3.3), pool-share arithmetic, MoR-connected yes/no

### 5.2 State machines Finance drives

- **Budget state** (the guard, §2.2): `healthy → warning → capped` — the primary Finance machine;
  `capped` drops autonomy off and saves work.
- **Revenue/economic state** (§3.3): `not-connected → connected, zero → earning` — never a fabricated
  fourth state.
- **Function state** contribution: Finance can push any function to `over-budget` (envelope exhausted →
  draft-only loudly) or the whole company to `capped`.
- **Metric state**: each unit-economics figure is `real` or `unknown — <named missing input>`; a figure
  can regress to `unknown` if its meter goes dark (honesty over stale numbers).

### 5.3 Lanes Finance needs (and its loud degradation)

Per capstone §2.6 lanes: **payments, accounting; (founder for legal).** Absent-lane behavior is loud and
specific (capstone org rule + §6):

| Lane | Unlocks | Absent ⇒ (loud, named) |
|---|---|---|
| **Payments (Paddle)** | revenue reporting, spend execution, pool payouts | revenue `not-connected`; spend cap `0`; every spend move stages "connect Paddle" |
| **Accounting** | ledger reconcile, exports, tax packet prep | reconcile is manual/`unknown`; Finance drafts the export, can't file it |
| **(Legal / bank / entity)** | *not a connector* — **founder-only** | Finance preps the packet and **stops**; never a lane that promotes this to auto |

The last row is the important honesty: legal is **not** a lane that, once connected, lets an agent sign.
There is no such lane. It's founder-only forever — the table lists it to make the absence explicit, not
to imply a future connector unlocks it.

### 5.4 The cockpit surface — "Strategy / economics"

Finance's readout lives in the **Strategy** column of the four-column cockpit (master §5.3, §10), as the
**economics readout**, plus pills in the global cadence bar:

- **Economics readout** (Strategy column): revenue state (real-or-not-connected, per §3.3), the
  unit-economics table with every `unknown` named, and the money-loop health at a glance.
- **Runway + burn tile**: the compute-runway countdown (real burn, projected horizon), $/cycle burn,
  funded balance, and the "fund runway" affordance (framed as fuel, no returns — master §6).
- **Budget meter** (global top bar, master §5): `% of cap · guard state` pill — green `healthy`, amber
  `warning`, red `capped`. One glance tells the founder whether the loop is spending safely.
- **Needs-you queue** contributions: every staged spend move (with blast radius: "charge $X", "raise ad
  cap to $Y") and every founder-only prep ("Paddle MoR — ready for your signature", "entity packet —
  ready to file") land in the one approval queue (master §5.4, §10 needs-you rail).
- Everything glass-box: the budget meter links to the real burn ledger; a `capped` event links to its
  decision-log entry and the saved-work manifest. Provable locks, no black box.

---

## 6. Routines (the temporal spine for money)

Finance runs on the nested cadence (capstone §8, master §7). Each routine states its boundary in its own
header — *reads and models, spends nothing without a lane + a go.*

| Routine | Cadence | What it does | Boundary |
|---|---|---|---|
| **Runway watch** | ~every tick while autonomy on | recompute burn + runway from the live meter; if projected cap-hit is near, flip guard `healthy→warning` and nudge economy routing on | read-only; the guard's *enforcement* is the only "action", and it only *reduces* spend |
| **Budget guard check** | before every autonomous task | check the task's projected token cost against remaining cap + the function's envelope; allow, or trip `capped` and save work (§2.3) | the safety interlock; can only stop spend, never authorize it |
| **Budget reconcile** | daily (with the standup) | reconcile metered burn vs the cap, refresh per-function envelopes from last cycle's leverage, surface the day's spend proposals into the queue | drafts the envelope + proposals; founder clears any gated spend |
| **Monthly financial review** | monthly (with the strategy reset) | close the period: real revenue (if any), unit-economics figures that resolved this month, pool-share statement (real shares, pool real-or-`unknown`), runway trajectory; draft the money section of the strategy update | drafts a review; founder commits; any founder-only item (entity, bank, MoR) is prepped and named, never executed |

The monthly review is the finance twin of TOKENS.md's period settle — but it **publishes the math**
(pool size, shares, rate card) only when the pool is real, and prints `pool: unknown — Pro revenue not
connected` otherwise. It never renders a simulated payout as though it were a settlement.

---

## 7. Edge cases (≥12)

1. **Budget exhausted mid-cycle.** Guard trips `capped` at the task boundary; the executing step finishes
   atomically, its partial artifact persists, autonomy flips `off`, `budget:capped` logs with the
   saved-work manifest, founder notified with the one number. Resumes next cycle from persisted state.
   *(The core §2.3 path.)*

2. **A spend move with no lane.** Any real fiat move while payments is `not-connected` stages honestly:
   "ready — connect Paddle to charge $X." It never dead-ends, never silently succeeds, never fabricates a
   receipt. Spend cap stays `0`; the move waits in the queue naming the exact lane.

3. **COGS unknown → margin unknown.** Gross margin (and everything downstream: payback, LTV) reads
   `unknown — enter COGS`, with a one-field founder task to fill it. Finance never guesses a COGS to
   produce a margin number. The honest reason is stated, not hidden.

4. **Refund / chargeback.** Paddle (MoR) owns the rails; Finance *reads* the reversal from Paddle's
   statement and adjusts real revenue **downward** to the new real figure — revenue can move back toward
   `connected, zero`. It never nets a chargeback against a projection to keep a number pretty. A refund
   that needs a founder decision (goodwill credit) stages as a gated move.

5. **MoR not set up.** Paddle onboarding is **founder-only** (contract + entity). Finance preps the full
   onboarding checklist with `sameep.ai` pre-filled and stops at the terms-acceptance signature. Revenue
   stays `not-connected`; the whole money loop stages behind this one founder act, clearly named as the
   **Money** bottleneck (§4.3).

6. **Currency.** A currency-of-record is set at entity setup (founder-only). Real figures from Paddle
   arrive in their settlement currency; Finance converts to the currency-of-record **using the rate on
   Paddle's own statement** (a real number), never a live-guessed FX rate. If no rate is available, the
   figure shows in its native currency, labeled — a real foreign number beats a fabricated converted one.

7. **An agent tries a founder-only action.** Structurally refused (§1) — there is no code path for an
   agent to open a bank, sign a contract, or become the entity. The attempt converts to a *prepared
   founder task* in the queue ("contract drafted — ready for your signature"), logs the boundary hit, and
   the agent proceeds with the reversible half. The line is enforced by absence of capability, not by a
   policy toggle that could be flipped.

8. **Runaway spend / self-reinforcing loop.** Two backstops (master §14): the per-cycle **budget ceiling**
   (the guard) *and* a **hard cap on cycle count**. A loop that keeps generating expensive tasks hits the
   token cap → `capped` → autonomy off, long before it can drain the funded budget. The cap is checked
   before the spend, so runaway is bounded by construction, not caught after the fact.

9. **Founder unavailable for days.** The reversible half keeps compounding within budget; every gated
   spend and every founder-only prep accumulates safely in the queue; **nothing money-related leaks** — no
   charge, no payout, no signature happens without the founder. A digest waits. If the budget caps while
   they're away, autonomy parks `off` and work is saved, not lost.

10. **Meter goes dark (signal bottleneck bites).** If the burn meter or a revenue connector stops
    reporting, the dependent figures **regress to `unknown`** rather than showing a stale last-known value
    as current. Honesty over continuity: a number with no live meter is not a fact. The Analyst is tasked
    to restore the meter; Finance flags which figures went dark.

11. **Two ventures share a payments lane.** Per-origin isolation (master §11, §6): a Paddle connection is
    scoped; revenue and spend for venture A never bleed into B, and approving a spend in A never touches
    B's budget or cap. Each venture has its own budget guard and its own runway.

12. **Pool-share real, pool value unknown.** The metered usage share is real (broker is the meter) but Pro
    revenue is `not-connected`. Finance shows the **real share** and marks the **dollar payout `unknown`**
    — it never multiplies a real share by an imagined pool. A builder sees "your real share: 4.2% of
    metered Pro usage · payout: unknown until Pro revenue connects," never a fabricated dollar figure.

13. **Simulated-vs-real confusion in the store.** Any pre-rails economic surface (mock checkout, simulated
    payout statement) carries the visible `SIMULATED` tag (TOKENS.md honesty law #4). Finance's numbers in
    the cockpit are **never** simulated — they're real-or-`unknown`. The simulation lives only in labeled
    demo surfaces; the operating economics never fabricate.

14. **Cap raised mid-`capped`.** Founder raises the token cap while `capped`. Guard re-evaluates: if now
    below the new warn threshold → `healthy`, autonomy may resume `drafting`; work resumes from the
    persisted state (§2.3). The raise itself is a founder action, logged; the loop never raises its own
    cap.

15. **Spend proposal exceeds remaining runway.** A gated spend that, if approved, would push cash/compute
    runway below a safety floor is surfaced with that consequence spelled out in its blast radius ("this
    $X ad spend drops runway from ~11 days to ~6"). Finance states the trade-off; the founder decides. It
    never auto-approves a runway-threatening spend, and never hides the consequence to get a yes.

---

## 8. Today-doable vs blocked

Grounded in the real product (the daemon *is* a Claude Code backend on the real repo; the broker *is* the
token meter — TOKENS.md), split honestly per capstone §15.

**Runs today, no founder input (reversible, real):**
- **The budget guard, fully** — the daemon already meters tokens per origin (`usage.tokensToday`,
  `OriginGrant.budgets`); the `healthy→warning→capped` machine, the task-boundary check, and the
  autonomy `drafting→off` drop with saved work are buildable on real meter data today.
- **Compute runway + burn** — real, from the same meter. Countdown shows a real burn rate with a labeled
  projection.
- **Per-function budget envelopes + economy-model routing** — allocation math and the post-gate economy
  downgrade are real levers today (economy mode already exists).
- **Unit-economics *shape*** — the §3 table renders today with every figure honestly `unknown — <named
  input>`, because the real inputs (revenue, COGS, spend) don't exist yet. That's not a placeholder;
  it's the honest state.
- **Pool-share *usage* arithmetic** — real today (the broker meter can't be faked); only the dollar value
  is `unknown`.
- **Every spend/founder-only move staged and named** — the queue and the prep-up-to-the-legal-edge work
  are fully doable now.

**Blocked on the three founder bottlenecks (§4.3):**
- **Real revenue, gross margin, CAC, payback, LTV in dollars** — blocked on the **Money** loop: Paddle
  (founder-only MoR terms) + a legal `sameep.ai` entity. No lane ⇒ these stay `unknown` by honest design.
- **Real fiat spend execution + a non-zero spend cap** — blocked on the **Hands** (a payments lane) and
  the **Money** entity. Until then spend cap is `0`, all fiat moves stage.
- **Accounting reconcile / tax filing / bank operations** — blocked on the accounting lane and, at the
  legal edge, on founder-only acts a machine has no capacity to perform.
- **Cash runway** — blocked on real cash commitments existing (a lane); compute runway is the one that's
  live today.

> The line held throughout, from the money side: **Finance models everything, meters what's real, caps
> the loop so it can never overspend, prepares every dollar-and-signature move right up to the legal
> edge — and moves no money, signs nothing, and reports no revenue a meter didn't see.** Each founder
> unlock (connect Paddle, be the entity, fund the budget) converts a column of `unknown`s and staged
> moves into live, real economics. That conversion, repeated, is the money loop coming alive.
