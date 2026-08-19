# The Autonomous Company — Operating System (the capstone spec)

> The other docs spec the *archetypes* (software/agency/brand) and the *UI*. This one specs the thing
> that makes it a **company and not a task list**: the org, the CEO decision-loop, the money engine,
> the metrics/memory, the connector-hands, the cadence, and the founder boundary. Switchboard is the
> running example; the model is kind-agnostic.

---

## 0. The thesis in one line

A company is a **loop that compounds**. The product is not a dashboard — it is a *persistent org of
agents* driven by a CEO loop, grounded in real signal, closing a money loop, remembering across time,
and gated at the line where actions touch the world.

```
             ┌────────────────────────────────────────────────────┐
   signal →  │  SENSE → DECIDE → ALLOCATE → ACT → MEASURE → LEARN  │ → signal
             └───────────────────────────┬────────────────────────┘
                                         │  (memory persists all of it)
                                         ▼
                              reallocate next cycle
```

Everything below is a part of this loop. If a feature doesn't make the loop tighter, truer, or
faster-compounding, it isn't in scope.

---

## 1. The control loop (the spine)

Six phases, run every cycle by the CEO agent. Each phase has a definite input, output, and owner.

| Phase | Question it answers | Input | Output | Owner |
|---|---|---|---|---|
| **Sense** | What's true right now? | metrics, inbox, issues, mentions, revenue, runway | a fresh **State snapshot** | Analyst |
| **Decide** | What matters most this cycle? | State + OKRs + backlog | a ranked **plan** (3–7 moves) | CEO |
| **Allocate** | Who does each move? | the plan + function capacity + lanes | dispatched **assignments** | CEO |
| **Act** | Do the reversible work; stage the rest | assignments | artifacts + a **Needs-you** queue | the six functions |
| **Measure** | Did it move the number? | artifacts + new signal | deltas against the metric tree | Analyst |
| **Learn** | What do we keep / kill / change? | deltas + decisions | updated OKRs, backlog, **memory** | CEO |

**Cadence** (see §8): Sense+Decide+Allocate is the **daily standup**; Act runs continuously via the
**autonomy ticker**; Measure+Learn is the **weekly review**; strategy is a **monthly** reset.

**The invariant that makes it honest:** Act never crosses the world-boundary on its own. Reversible
work lands; **outbound/spend is drafted and queued for the founder** (§9). This is the same
"drafts everything, sends nothing without a lane + a go" rule, lifted from a single wrapp to a whole org.

---

## 2. The org (functions as agents)

Seven roles. Each is an agent (or agent pool) with a **mandate**, **inputs**, **outputs**, an
**autonomy grade**, **metrics it owns**, and the **lanes** it needs. The CEO allocates across them.

### 2.1 CEO / Chief of Staff — the loop driver
- **Mandate:** run the control loop; hold the OKRs; allocate effort; escalate the few real decisions.
- **Autonomy:** decides + drafts freely; **never** commits money, outbound, or irreversible strategy
  without the founder. Its output is always a *proposed* plan/move, legible ("here's why, tap the locks").
- **Owns:** the plan, the backlog priority, the founder-decision queue.

### 2.2 Product / Engineering — *the one truly autonomous function*
- **Mandate:** build and ship the product. For Switchboard this is **real**: the daemon's backend is
  Claude Code editing the actual repo — so this function ships wrapps, fixes bugs, cuts releases for real.
- **Autonomy:** code changes are **reversible** (branch/PR) → auto. Merge to main, release, and deploy
  are **gated** (a human/CI go). This is the superpower: most "autonomous company" demos can only draft
  marketing; here the product function actually produces the product.
- **Owns:** shipped features, bug burndown, release cadence, quality. **Lanes:** GitHub, CI, deploy.

### 2.3 Growth / Marketing
- **Mandate:** create and capture demand — content, launches, SEO, community, partnerships.
- **Autonomy:** drafts everything (posts, pages, outreach, SEO copy); **publishing is gated**.
- **Owns:** traffic, signups, activation-top-of-funnel. **Lanes:** social, blog/CMS, email, deploy (landing).

### 2.4 Sales / Revenue
- **Mandate:** close the money loop — pricing, conversion, monetization plumbing, deals.
- **Autonomy:** models pricing, drafts pages/sequences, prepares checkout; **charging/sending is gated**.
- **Owns:** revenue, conversion, ARPU, the money loop's health. **Lanes:** payments (Paddle/Stripe), email, MoR.

### 2.5 Support / Success
- **Mandate:** onboarding, retention, feedback triage. The company's ears.
- **Autonomy:** watches issues/feedback/DMs, triages, **drafts** replies and bug reports into Product's
  backlog; **sending is gated**.
- **Owns:** activation, retention, response time, feedback→product throughput. **Lanes:** GitHub issues, email, chat.

### 2.6 Finance / Ops
- **Mandate:** runway, spend, unit economics, legal/compliance, the entity of record.
- **Autonomy:** tracks and models; **all spend and legal actions are gated** (and some are founder-only
  — the legal person, bank, contracts). Enforces the **budget guard** that caps autonomy.
- **Owns:** runway, burn, unit economics, budget caps. **Lanes:** payments, accounting, (founder for legal).

### 2.7 Analyst / Instrumentation — *the eyes*
- **Mandate:** turn raw signal into the State snapshot and the metric deltas. Without this the CEO is blind.
- **Autonomy:** fully auto and reversible — reads meters, computes the metric tree, flags anomalies.
  Where a meter is missing, its job is to **stand up the instrumentation** (or tell the founder what to connect).
- **Owns:** the metric tree, data honesty ("unknown — not instrumented"), anomaly alerts. **Lanes:** analytics, meters.

> **Org rule:** every function can *draft*; only the founder-gated boundary lets a draft touch the world.
> A function starved of its lane degrades to "draft-only" **loudly** (it says which lane it needs), never silently.

---

## 3. The CEO decision engine (how effort gets allocated)

The CEO doesn't do the work — it decides *where the work goes*. Concretely, each cycle:

1. **Objective function = the OKRs** (§4). Every candidate move is scored on *how much it moves the
   current key result*, not on how nice it is.
2. **Candidate generation** — the CEO pulls candidates from: the backlog, each function's suggestions,
   the anomaly alerts, and the founder's standing goals. It generates them as **options + ⭐ recommended**
   (house doctrine), so the founder can veto or re-rank with "1a 2c."
3. **Prioritization** — score each on **leverage** (impact × confidence ÷ effort), filter by **lane
   availability** (can we even act?) and **budget** (can we afford it?), and by **reversibility** (prefer
   moves we can run without waiting on the founder).
4. **The plan** — 3–7 moves, each with an owner function, an expected metric delta, and a class
   (reversible-auto vs gated). Written to memory; shown in the cockpit.
5. **Escalation** — anything gated, expensive, or strategically irreversible becomes a **founder decision**,
   surfaced with the recommendation and the blast radius. The CEO never blocks the whole loop on a
   pending decision — it runs the reversible half and parks the rest.

**Reallocation is the point.** Last cycle's measured deltas feed this cycle's scores. A move that didn't
move the number gets deprioritized; a function that's winning gets more budget. This is the difference
between a company and a checklist.

---

## 4. Goals & metrics — the memory of purpose

You cannot run a company blind. This layer is a first-class part of the OS, not a report.

- **North-star metric** — one number that proxies real value. (Switchboard candidate: **weekly active
  wrapp-runs on connected Switchboards** — usage of the thing, on real user compute.)
- **The metric tree** — the north star decomposed into input metrics each function owns: installs →
  activations → weekly-active → wrapp-runs → paying → retained. Each node has an owner (§2) and a target.
- **OKRs** — the quarter's objective + 3 key results, held in memory, re-read every Decide phase. The
  objective function of the whole loop.
- **The honesty rule (non-negotiable):** every metric is **real (a meter reported it)** or reads
  **"unknown — not instrumented."** No estimates dressed as facts; no fabricated numbers, ever. A metric
  with no meter is a *task for the Analyst*, not a guess.
- **Instrumentation-first corollary:** if the north star isn't measurable, standing up its meter is the
  **highest-priority move**, because every other decision is a coin-flip until it exists.

---

## 5. The money engine

A thing with no revenue loop is a project, not a company. This is the loop Sales+Finance own.

- **The model (Switchboard):** a Pro-subscription **pool**, rev-shared to wrapp builders **by usage**
  (Spotify-style), with **Paddle as merchant-of-record** so the platform never touches card data or tax.
  The visitor who runs a wrapp on their own Claude is **never charged** — they pay for their own Claude;
  the platform earns from Pro subscribers.
- **Per-kind resolution:** software = usage-pool or subscription; agency = billable invoices; brand =
  product sales + MoR. Same engine, `kind` picks the meter.
- **Unit economics** — the OS tracks CAC (once Growth spend is real), payback, gross margin (only once
  real COGS/fees exist), and pool-share per builder. Shown only when the inputs are real; else "unknown."
- **The revenue-state ladder** (same as the archetype specs): `not-connected` → `connected, zero`
  (honest real zero) → `earning`. The `earning` state is unreachable without a payments lane + a **real**
  paid event. No fabrication path exists.
- **Runway & budget** — Finance sets a token/compute budget and a spend cap; the **budget guard** drops
  autonomy `drafting → off` at the cap and saves in-flight work. Autonomy is always affordable-by-construction.

---

## 6. The hands (connectors / lanes)

A function's real capability = which lanes are connected. This is the capability layer of the OS.

| Lane | Unlocks (function) | Absent ⇒ |
|---|---|---|
| **GitHub / CI** | Product ships & releases | code drafts on a branch; no merge/release |
| **Deploy** | Product/Growth publish live | site/app staged, not live |
| **Analytics** | Analyst sees | metrics read "unknown" |
| **Email** | Growth/Sales/Support send | messages drafted, queued |
| **Social** | Growth publishes | posts drafted, queued |
| **Payments (Paddle/Stripe)** | Sales earns | revenue "not connected" |
| **Accounting** | Finance reconciles | manual/unknown |

- **Degradation is loud and specific** — a gated move always names the exact lane it needs and links to
  connect it, returning to the staged move afterward. The company is fully usable as a **glass-box planner**
  with zero lanes; connecting a lane turns a draft into a doable action.
- **Per-origin isolation** — lanes are scoped; one venture's connected lane never acts for another.

---

## 7. Memory & continuity (the company that outlives a session)

The OS persists its whole self so the loop compounds across weeks, not just within a session.

- **What's remembered:** OKRs, the metric tree + a **history** of deltas, the backlog (prioritized), the
  **decision log** (what we chose and why), the artifact store, the Needs-you queue, per-function state,
  and the connector/budget state.
- **Where:** the operating record as files (the `docs/operating/` log is the seed) + the daemon's
  livestore (one company = one file, per-origin isolated, torn-write safe). The **daemon runner** advances
  auto-on companies headless — the "while you sleep" spine — reversible-only, budget-guarded.
- **Team mode:** multiple people/agents on one company folder, LWW-merged, no protocol change — the org
  can have human teammates alongside the agents.
- **Continuity guarantee:** a cold restart re-reads memory and resumes mid-plan; nothing important lives
  only in a session's head.

---

## 8. Cadence & routines (the temporal spine)

The loop runs at four nested tempos. Each routine is honest about its boundary in its own header.

| Routine | Tempo | Phases it runs | Boundary |
|---|---|---|---|
| **Autonomy ticker** | ~seconds while on | Act (reversible only) | drafts, never sends; budget-guarded |
| **Daily standup** | daily | Sense → Decide → Allocate | produces the day's plan + a to-approve queue |
| **Weekly review** | weekly | Measure → Learn | reallocates; drafts a strategy update; founder commits |
| **Monthly strategy** | monthly | full reset | re-sets OKRs & north star; founder-approved |
| **Overnight runner** | continuous (daemon) | Act, headless | reversible-only; the one honest verification gap (never yet run against a live funded company) |

---

## 9. The founder boundary (what stays human)

An autonomous company still has a founder — reduced to **four jobs**:

1. **Set direction** — approve OKRs / the north star (monthly).
2. **Clear the queue** — approve the gated outbound/spend moves (daily, over coffee — one place, all ventures).
3. **Connect the hands** — plug in the lanes (§6).
4. **Be the legal person** — the entity of record, bank, contracts, anything a machine legally can't own.

**The three structural bottlenecks only the founder can unclog** — and *nothing real compounds until they are*:

| Bottleneck | Why it's the founder's | Until then |
|---|---|---|
| **Signal** (analytics) | needs analytics on the live property | the CEO allocates by guess |
| **Money** (payments + entity) | needs Paddle/Stripe + a legal company-of-record | no revenue loop to grow |
| **Hands** (connectors) | only the founder can grant lanes | functions draft but can't act |

Naming these is part of the spec: an honest autonomous company is explicit about what it *cannot* do alone.

---

## 10. States (org-level machines)

Beyond the per-venture/task states in the master doc, the OS adds:

- **Function state:** `idle` · `working` (a Set per assignment, never a global boolean) · `blocked`
  (missing lane/decision — names it) · `draft-only` (lane absent) · `over-budget`.
- **Decision state:** `open` → `recommended` (CEO has a ⭐ pick) → `decided` → `applied`; plus `stale`
  (signal changed, needs re-decide).
- **OKR state:** `set` → `on-track` / `at-risk` / `missed` (each computed from real deltas, or `unknown`).
- **Budget state:** `healthy` → `warning` → `capped` (autonomy off, work saved).
- **Cycle state:** `sensing` → `deciding` → `acting` → `measuring` → `learning`; a crash resumes at the
  last persisted phase.

---

## 11. Dashboard / UI for the OS (the org, not just the tasks)

Extends the four-column cockpit with the operating-system surfaces:

- **The Brain view** — the metric tree live (north star + inputs, real-or-unknown), the current OKRs with
  on-track/at-risk, and the CEO's plan for the cycle. This is the "are we winning?" screen.
- **The Org view** — the seven functions as lanes, each showing what it's doing now, its owned metric, its
  connected-lanes readout, and its draft-vs-gated output. You can see the whole company working at a glance.
- **The Needs-you queue** — every gated move across every function and venture, one place, with blast radius.
- **The Decision log** — the running "what we chose and why," with provable locks back to the signal that drove it.
- **The Cadence bar** — where we are in the loop (sensing…learning), next standup/review, autonomy + budget pills.

Everything is glass-box: you can always see the last thing each function did and *why*.

---

## 12. AI options, model routing & branching

- **Per-function model routing** — cheap/economy models for high-volume reversible drafting (Growth
  variants, Support triage); deep models for the CEO's Decide/Learn and Product's real code. Routing is a
  cost lever Finance owns; local-can't-do-tools boundary respected.
- **auto | approve | manual per function** — the taxonomy applies at the function level and per task-type;
  overridable per task. It's what makes "autonomous" honest and tunable.
- **Branching everywhere a choice exists** — the CEO's plan, Growth's creative, Sales' pricing, Product's
  approach all generate **N options + ⭐ recommended**; picking one restreams downstream. A/B where a lane supports it.

---

## 13. Workflows (a company, running)

1. **A day in the life** — overnight ticker drafts across all functions → morning standup produces the plan
   + a to-approve queue → founder clears outbound over coffee → functions execute the reversible half →
   evening: Analyst measures, memory updates.
2. **Ship a feature end-to-end** — Support surfaces a feedback cluster → CEO prioritizes it → Product builds
   it on a branch (real code) → CI green → founder approves merge/release → Growth drafts the changelog →
   Analyst watches adoption. The only human touches: approve merge, approve the post.
3. **Close first revenue** — Finance+Sales model pricing → founder connects Paddle + entity → Sales stages a
   checkout → first **real** paid event flips revenue `not-connected → earning` → unit economics appear as inputs become real.
4. **Absorb an issue spike** — Analyst flags an anomaly → Support triages + drafts fixes into the backlog →
   CEO re-allocates Product to the spike this cycle → the loop bends toward the fire without the founder steering.

---

## 14. Edge cases (org-level)

- **Contradictory signal** — two metrics disagree; Analyst flags low-confidence, CEO defers the bet, not fakes it.
- **A function starved** — no lane or no budget; it degrades to draft-only *loudly* and the CEO reallocates.
- **Budget exhausted mid-cycle** — autonomy → off, in-flight work saved, reason logged, founder notified.
- **Founder unavailable for days** — the reversible half keeps compounding; the gated queue accumulates
  safely; nothing outbound leaks; a digest waits.
- **Two functions edit the same file** — worktree/branch isolation for parallel Product work; LWW-merge for
  memory; never a silent clobber.
- **A gated move stuck forever** — it stays `staged`, never silently expires or auto-sends; the queue shows its age.
- **Runaway loop / agent conflict** — a hard cap on cycle count + a budget ceiling backstop; the CEO
  de-conflicts assignments so two functions don't chase the same move.
- **Memory corruption / torn write** — torn records are skipped, per-origin isolation holds; a cold restart
  resumes from the last clean phase.
- **The north star is ungameable-check** — if a function can move its metric without moving the north star,
  that's flagged as a vanity gain, not a win.

---

## 15. Critical path to actually running Switchboard

Honest split, grounded in the real product (the daemon *is* a Claude Code backend on the real repo):

**Runs today, no founder input (reversible, real):**
- **Product/Eng** shipping real repo work on branches (the genuine unlock).
- **Analyst** standing up the *shape* of the metric tree + flagging what's not instrumented.
- **CEO loop** + memory + the daily/weekly cadence, drafting plans and queuing everything gated.
- **Growth/Sales/Support** drafting content, pricing, and triage into the queue.

**Blocked on the three founder bottlenecks (§9):** live **signal** (analytics), the **money** loop
(Paddle + entity), and the **hands** (connect GitHub/deploy/email/social/payments). Every gated move
already names exactly which one it's waiting on.

> The company can *start running* today on its reversible half — real product shipping + a real operating
> loop + honest metrics-shape — and each founder unlock (a lane, a meter, the entity) converts a whole
> column of drafts into live action. That conversion, repeated, is the launch.
