# Function Spec — CEO / Decision Engine / Memory

> This is the depth-spec for §2.1, §3, §4, and §7 of the capstone
> (`docs/AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md`), read against the master
> (`docs/AUTONOMOUS-COMPANY.md`). The capstone names the CEO; this doc builds it: the mandate, the
> exact six-phase loop, the decision engine that allocates effort, the OKRs/metric-tree it holds, the
> memory that lets it outlive a session, its state machines, and the honest split of what runs today.
>
> Running example throughout: **Switchboard** — the open-source BYO-Claude "wrapper app store." Its
> daemon backend is **Claude Code editing the real repo**, so the Product function ships for real; the
> catalog is **76 wrapps**; the north-star candidate is **weekly active wrapp-runs on connected
> Switchboards**. The model is kind-agnostic; Switchboard just makes it concrete.

---

## 0. The one line

**The CEO is the loop, not a worker.** It never builds, sends, charges, or deploys. It *senses the
truth, decides what matters, allocates effort, watches the number move, and reallocates* — and it holds
the company's memory of purpose (OKRs), of what happened (the decision log + metric history), and of
what's still owed to the founder (the Needs-you queue). Every output it produces is a **proposal on the
board**, legible, with provable locks back to the signal that drove it. The one refrain: *decides and
drafts freely; never crosses the world-boundary itself.*

---

## 1. Mandate & the control loop (the spine)

### 1.1 Mandate

| | |
|---|---|
| **Mandate** | Run the control loop each cycle; hold the OKRs and the metric tree; allocate effort across the seven functions; escalate the few real decisions to the founder. |
| **Inputs** | the State snapshot (from the Analyst), the OKRs, the backlog, per-function suggestions, anomaly alerts, the founder's standing goals, last cycle's measured deltas, budget + connector state. |
| **Outputs** | a ranked **plan** (3–7 moves) → dispatched **assignments** → an updated backlog, decision log, OKR status, and Needs-you queue. |
| **Autonomy** | decides + drafts freely. **Never** commits money, outbound, deploy, or irreversible strategy. Its output is always a *proposed* plan. |
| **Owns** | the plan, the backlog priority, the founder-decision queue, the memory of purpose. |
| **Lanes it needs** | **none to think** — the CEO is fully usable with zero lanes as a glass-box planner. It reads the Analyst's meters and dispatches to functions; the lanes belong to the functions that *act*. |

### 1.2 The six phases

The CEO runs Sense → Decide → Allocate → Act → Measure → Learn each cycle. It personally **owns Decide,
Allocate, and Learn**; it *consumes* Sense and Measure (produced by the Analyst) and *dispatches* Act
(performed by the six functions). Each phase has a definite input and output.

| Phase | Owner | Input | Output | The CEO's part |
|---|---|---|---|---|
| **Sense** | Analyst | meters, inbox, issues, mentions, revenue, runway | a fresh **State snapshot** (real-or-unknown) | *consumes* — does not read raw meters itself |
| **Decide** | **CEO** | State + OKRs + backlog + suggestions + last deltas | a ranked **plan** (3–7 moves), each as options + ⭐ | **owns** — the decision engine (§2) runs here |
| **Allocate** | **CEO** | the plan + function capacity + lane availability | dispatched **assignments** (one owner per move) | **owns** — de-conflicts, respects capacity Sets |
| **Act** | the six functions | assignments | artifacts + a **Needs-you** queue entry per gated move | *dispatches* — never performs the work |
| **Measure** | Analyst | artifacts + new signal | deltas against the metric tree | *consumes* — receives deltas, does not compute them |
| **Learn** | **CEO** | deltas + the decisions that produced them | updated OKRs, re-scored backlog, appended decision log | **owns** — closes the loop; feeds next Decide |

**Cadence binding** (capstone §8): *Sense + Decide + Allocate* is the **daily standup**; *Act* runs
continuously on the **autonomy ticker**; *Measure + Learn* is the **weekly review**; a full OKR reset is
**monthly**. The CEO is the agent invoked by each of those routines; it is stateless between them except
through memory (§4).

### 1.3 What the CEO does NOT do (the world-boundary, restated as the CEO's own invariant)

The capstone's org rule — *Act never crosses the world-boundary on its own* — lands on the CEO as a hard
list of non-actions. The CEO:

- **does not build** — it dispatches Product; it never edits the repo, never opens a PR itself.
- **does not send** — no email, post, DM, or reply leaves the CEO; it drafts a move and *queues it for
  the founder*.
- **does not spend or charge** — no payment, no deploy-to-prod, no restock; these are gated moves it can
  only *recommend*.
- **does not merge / release / deploy** — even reversible-looking Product work stops at "branch/PR"; the
  merge is a founder go.
- **does not decide the irreversible alone** — a strategically one-way move (pricing change, a launch, an
  entity action) becomes a **founder decision** with its blast radius, never an executed one.
- **does not block the loop on a pending decision** — it runs the reversible half and *parks* the gated
  half; the queue accumulates safely.
- **does not fabricate** — it never fills an un-instrumented number with a guess; it reasons over
  `"unknown — not instrumented"` explicitly (§3).

> **The refrain, one function down:** the CEO is the sharpest reasoner in the company and the one with the
> least hands. That asymmetry is the safety model — the thing that decides is structurally unable to act.

---

## 2. The decision engine (how effort gets allocated)

The Decide phase is where the CEO earns its title. It is a **pure function** of memory + fresh signal:
`decide(State, OKRs, backlog, suggestions, alerts, lastDeltas, budget, lanes) → plan`. Deterministic
inputs in, a ranked plan out, everything written to the decision log so the reasoning is replayable.

### 2.1 Candidate generation

The CEO pulls a candidate pool from five sources, tagged by origin so the log shows *where a move came
from*:

| Source | Example (Switchboard) |
|---|---|
| **The backlog** | "instrument wrapp-run events" (carried from a prior cycle, still un-done) |
| **Each function's suggestions** | Product: "the God wrapp cold-start is 4s"; Growth: "the landing has no changelog" |
| **Anomaly alerts** | Analyst: "installs flat 3 cycles; activation dropped vs last cycle" |
| **The founder's standing goals** | "get to a real weekly-active number"; "don't touch pricing this quarter" |
| **Instrumentation gaps** | any metric reading `unknown` auto-generates a candidate to stand up its meter |

Candidates are generated as **options + ⭐ recommended** per decision point (house doctrine), so the
founder can veto or re-rank with "1a 2c." A move is never presented as the only path when a choice exists.

### 2.2 The scoring function — leverage

Every candidate is scored on **how much it moves the current key result**, not on how nice it is. The core
score:

```
leverage = (impact × confidence) ÷ effort
```

| Factor | Meaning | Source of the estimate |
|---|---|---|
| **impact** | expected delta on the KR this move targets | the metric tree edge it acts on (§3); `0` if it touches no owned metric |
| **confidence** | how sure we are it will move (0–1) | last cycle's measured deltas for similar moves; **low, and flagged, when signal is `unknown`** |
| **effort** | rough cost to run (function-cycles + token budget) | the owning function's estimate; never zero |

Then three **hard filters** knock candidates out before ranking — a high-leverage move that fails any of
these is *not* dispatched, it's *staged or escalated*:

1. **Lane availability** — *can we even act?* A move needing a dark lane doesn't get dispatched to run; it
   becomes a **staged** artifact that names the exact lane (capstone §6). Growth's "publish the changelog"
   with no deploy lane stages honestly.
2. **Budget** — *can we afford it?* If the move's effort exceeds remaining budget, it's deferred; if the
   budget guard is `capped`, only zero-cost moves survive (§4).
3. **Reversibility** — *can we run it without the founder?* Reversible moves are **preferred** and can run
   this cycle; irreversible/outbound moves are down-weighted and routed to the Needs-you queue rather than
   executed. This is what keeps the loop compounding while the founder sleeps.

The output of scoring is a ranked list; the CEO takes the **top 3–7** that survive the filters as the
plan. Each plan move carries: `{ owner function, targeted KR, expected metric delta, class
(reversible-auto | gated), leverage score, source }`.

### 2.3 Options + ⭐ recommended (the plan is itself branched)

The plan is not a single decree. At every point where a genuine choice exists — *which* three moves,
*which* approach for a move, *which* function owns it — the CEO emits **N options with one ⭐
recommended** and the reasoning. Picking one restreams the downstream (Allocate re-dispatches from the
pick). This is the same branching doctrine the capstone applies to Growth's creative and Sales' pricing,
applied to the CEO's own plan. The founder answers "1a 2c"; absent an answer, the ⭐ recommended path runs
its reversible half and parks its gated half.

### 2.4 Reallocation — the whole point

> *A company is a loop that compounds.* Reallocation is where that happens.

Last cycle's **measured deltas** (from Measure) feed this cycle's `confidence` and re-score the backlog in
Learn:

- **A move that didn't move its number** → its `confidence` for that class of move drops → it's
  deprioritized next cycle. The CEO does not re-run a losing bet on faith.
- **A function that's winning** (its owned metric moved) → gets more budget and more of the plan's slots.
- **A move whose number is still `unknown`** → cannot be scored on outcome; the CEO instead prioritizes the
  *instrumentation* candidate that would make it scorable (§3 corollary). Guessing is not an allowed
  substitute.
- **A stale decision** (signal changed under it) → flagged `stale`, pulled back into Decide, re-scored
  against the new State before any further effort rides on it.

This is the difference between a company and a checklist: the checklist runs the same items regardless of
whether they worked; the CEO bends the next cycle toward what measurably moved.

### 2.5 Escalation

Anything **gated, expensive, or strategically irreversible** becomes a **founder decision**, surfaced with:
the ⭐ recommendation, the blast radius, the exact lane it's waiting on (if any), and the cost. The CEO
**never blocks the whole loop** on a pending decision — it runs the reversible half of the plan and parks
the rest in the Needs-you queue, which accumulates safely and never auto-fires.

---

## 3. OKRs & the metric tree (the memory of purpose)

You cannot allocate effort blind. The OKRs are the **objective function** of the decision engine, and the
metric tree is the map from the north star down to the inputs each function owns. Both are **held objects
in memory** (§4), re-read every Decide phase — not a report generated at the end.

### 3.1 The OKR object

```
OKR
├─ objective     one sentence, the quarter's aim            (e.g. "Prove real usage of Switchboard")
├─ keyResults[]  3, each measurable
│   ├─ metric        a node in the metric tree
│   ├─ baseline      the value when the OKR was set   (real | "unknown — not instrumented")
│   ├─ target        the value that means success
│   ├─ current       latest measured value            (real | "unknown")
│   └─ status         set → on-track | at-risk | missed | unknown   (computed, never asserted)
├─ owner         usually the CEO for the objective; each KR maps to a function via its metric
├─ horizon       the quarter (monthly reset re-sets these)
└─ setAt / setBy the founder go that locked it (monthly, capstone §9 job 1)
```

The **objective function**: every candidate move's `impact` (§2.2) is measured as *its expected delta on
a key result's `metric`*. A move that touches no KR metric scores `impact = 0` and is only dispatched if a
KR explicitly names "keep the lights on" work. This is how "score on how much it moves the number, not on
how nice it is" becomes mechanical.

### 3.2 The metric tree

The north star decomposed into input metrics, each with an **owner** and a **target**. Switchboard's
candidate shape:

```
weekly active wrapp-runs        ← north star (Analyst owns the roll-up)
├─ installs                     ← Growth
│   └─ activations              ← Support / Growth
│        └─ weekly-active users ← Product / Support
│             └─ wrapp-runs     ← Product   (the catalog of 76 wrapps is the surface these run on)
├─ paying (Pro subs)            ← Sales
└─ retained                     ← Support
```

Each node is a `Metric` object:

```
Metric
├─ id            weekly_active_wrapp_runs
├─ owner         a function (§2 of the capstone)
├─ value         real (a meter reported it) | "unknown — not instrumented"
├─ meter         the connector/lane that reports it, or null
├─ target        the OKR's number for it, if it's a KR
└─ history[]     an append-only series of { cycle, value, source }   (the deltas the loop learns from)
```

### 3.3 The honesty rule (non-negotiable)

Every metric is **real (a meter reported it)** or reads **"unknown — not instrumented."** There is no
third "estimated" state. The CEO reasons over `unknown` explicitly — a plan built on an unknown number
carries **low confidence** by construction (§2.2), and the plan says so. No estimate is ever dressed as a
fact; no number is ever fabricated to make a slide look complete. A metric with no meter is **not a
guess — it is a task for the Analyst.**

### 3.4 The instrumentation-first corollary

If the **north star itself** isn't measurable, standing up its meter is the **highest-leverage move in the
company**, because every other decision is a coin-flip until it exists. The decision engine encodes this
directly: an `unknown` north star forces its instrumentation candidate to the top of the plan, above any
feature or campaign, until it reports real. For Switchboard concretely: until wrapp-run events are
instrumented on connected Switchboards, "instrument wrapp-runs" outranks shipping the 77th wrapp — you
cannot allocate toward usage you cannot see.

---

## 4. Memory model (the company that outlives a session)

The CEO is stateless between routine invocations; **memory is the company.** A cold restart re-reads it
and resumes mid-plan. Nothing important lives only in a session's head.

### 4.1 The persisted objects

| Object | What it holds | Written by | Read every |
|---|---|---|---|
| **OKRs** | objective + 3 KRs + status (§3.1) | Learn (status), founder (set) | Decide |
| **Metric history** | per-metric append-only series of deltas (§3.2) | Measure (Analyst) | Decide, Learn |
| **Backlog** | candidate moves, prioritized, with leverage + source | Decide, Learn | Decide |
| **Decision log** | every plan move: what was chosen, why, its ⭐/alternatives, its outcome delta, its provable locks back to signal | Decide, Learn | Learn, cockpit |
| **Artifact store** | the drafts each function produced (posts, code branches, pricing models, proposals) | Act (functions) | Measure, cockpit |
| **Needs-you queue** | every gated move across every function + venture, with blast radius + the lane it waits on | Allocate/Act | founder (daily), cockpit |
| **Per-function state** | each function's `idle/working(Set)/blocked/draft-only/over-budget` (§5.1) | Allocate, Act | Decide, Allocate |
| **Budget / connector state** | remaining budget, cap, guard level; each lane's `absent/installed/connected` | Finance, connector probe | every filter in §2.2 |

### 4.2 Where it lives

Two tiers, mirroring the capstone §7:

- **Files — the operating record.** `docs/operating/` is the seed: the OKRs, the decision log, and the
  metric history persist as human-readable files (the same glass-box artifact a founder can read without
  the app). Team-editable, git-trackable, survives the daemon being down.
- **Daemon livestore — the live state.** One company = one livestore file, **per-origin isolated**,
  **torn-write safe**. The per-function state, the Needs-you queue, the in-flight artifacts, and the
  budget/connector readout live here for the ticker and cockpit to read/write at speed. The **daemon
  runner** advances auto-on companies headless off this store — the "while you sleep" spine, reversible-only
  and budget-guarded.

The invariant: **the memory of purpose and record (OKRs, log, metric history) is durable in files; the
live working set is in the livestore.** A livestore loss degrades the company to its last file checkpoint —
never to zero, never to a fabricated resume.

### 4.3 Cold-restart resume

On restart the CEO:
1. reads the files → reconstructs OKRs, metric history, decision log.
2. reads the livestore → reconstructs per-function state, the Needs-you queue, in-flight artifacts, budget.
3. reads the persisted **cycle state** (§5.3) → resumes at the last clean phase, not from the top.

A crash mid-`acting` resumes at `acting` with the already-dispatched assignments intact; a crash
mid-`deciding` re-runs Decide (pure function, safe to replay) from the same inputs. Nothing double-fires,
because Act writes an idempotency marker per assignment before it runs.

### 4.4 Team mode (LWW)

Multiple people/agents can share one company folder. Merges are **last-writer-wins** on a per-object key,
**no protocol change** — the same additive model the platform already ships. Concretely: two teammates
re-scoring the backlog merge field-by-field, latest timestamp wins per move; the decision log is
append-only so it never conflicts (both appends survive); the OKR status is computed, so it converges once
both see the same metric history. Human teammates sit *alongside* the agent functions — a person can own a
function's lane and clear its queue. No login gate; the folder is the boundary.

---

## 5. State machines, routing & the cockpit

### 5.1 Function state (what the CEO allocates against)

`idle` · `working` (a **Set** per assignment — never a global boolean, or working one move abandons the
next) · `blocked` (missing lane/decision — **names it**) · `draft-only` (lane absent — degrades **loudly**,
says which lane) · `over-budget`. The CEO reads these in Allocate to avoid dispatching to a starved or
saturated function.

### 5.2 Decision state

```
open → recommended → decided → applied
                ↘ stale ↗
```

- `open` — a candidate is in the pool, not yet scored into a plan.
- `recommended` — the CEO has a ⭐ pick with alternatives (options presented).
- `decided` — the founder picked (or the ⭐ ran its reversible half by default).
- `applied` — the move ran; its outcome delta is measured and logged.
- `stale` — signal changed under a `recommended`/`decided` move before it applied; it's pulled back into
  Decide and re-scored against the new State before any further effort rides on it.

### 5.3 OKR state

`set` → `on-track` / `at-risk` / `missed` — **each computed from real deltas**, or `unknown` when the KR's
metric has no meter. The status is never asserted; it's a function of `(current − baseline)` against
`(target − baseline)` over the horizon remaining. An `unknown` KR is a standing instrumentation task, not a
blank.

### 5.4 Cycle state

`sensing → deciding → acting → measuring → learning`. Persisted after each phase so a crash resumes at the
last clean phase (§4.3). The **Cadence bar** in the cockpit shows where the loop is right now.

### 5.5 Branching & model routing for Decide / Learn

- **Model routing** — the CEO's **Decide and Learn run on a deep model** (the reasoning that allocates the
  whole company's effort is the last place to cheap out). High-volume reversible drafting (Growth variants,
  Support triage) routes to economy models; that routing is a cost lever Finance owns, respecting the
  local-can't-do-tools boundary. The CEO *chooses* the routing per function/task-type; it doesn't do the
  cheap work itself.
- **Branching** — as in §2.3, the plan itself generates N options + ⭐ recommended; picking one restreams
  Allocate. A/B only where a lane supports it (the CEO can't A/B a send with no email lane).
- **auto | approve | manual** — the CEO respects each function's per-task-type mode: `auto` moves may run
  on the ticker, `approve` moves stage for the founder, `manual` moves are never dispatched to an agent.

### 5.6 Cockpit surfaces the CEO owns

- **The Brain view** — the metric tree live (north star + inputs, **real-or-unknown**), the current OKRs
  with on-track/at-risk/missed, and the CEO's plan for this cycle. The "are we winning?" screen. Every
  `unknown` is shown as `unknown`, never a placeholder number.
- **The Decision log** — the running "what we chose and why," each entry with **provable locks** back to
  the signal that drove it (tap a decision → see the State snapshot + the leverage math + the alternatives
  that lost). Glass box over black box: the founder can always audit *why* effort went where it went.
- **The Cadence bar** — where we are in the loop (sensing…learning), next standup/review, the autonomy +
  budget pills.

---

## 6. Edge cases (CEO-level)

1. **Contradictory signal** — two metrics disagree (installs up, activations down). The Analyst flags
   low-confidence; the CEO **defers the bet rather than faking a read** — scores the affected moves at low
   `confidence`, prioritizes the instrumentation that would resolve the disagreement, and says so in the log.
2. **Founder unavailable for days** — the reversible half of every plan keeps compounding; the gated
   Needs-you queue accumulates safely; **nothing outbound leaks**; a digest waits. The loop does not stall
   and does not self-authorize the gated moves.
3. **Budget exhausted mid-cycle** — the budget guard drops autonomy `drafting → off`, **saves in-flight
   artifacts** (never lost), logs the reason, notifies the founder. Next Decide only the zero-cost moves
   (re-scoring, reading, planning) survive the budget filter.
4. **A stale decision** — signal moved under a `decided`-but-not-yet-`applied` move; it flips to `stale`,
   is pulled back into Decide, and re-scored against the new State before effort rides on it. No move
   applies on a stale premise.
5. **Vanity-metric gaming** — a function moves its owned metric without moving the north star (e.g. installs
   up via a bot spike, weekly-active flat). The CEO's **ungameable-check** flags it a *vanity gain, not a
   win*, does **not** credit the function's `confidence` for it, and re-checks the metric-tree edge that was
   supposed to connect them.
6. **Crash mid-phase** — the cycle state is persisted per phase; restart resumes at the last clean phase
   (§4.3). `deciding` re-runs safely (pure function); `acting` resumes with idempotency markers so no
   assignment double-fires.
7. **North star is `unknown`** — the instrumentation-first corollary (§3.4) forces its meter to the top of
   the plan above all feature/campaign work; every downstream decision is explicitly labeled low-confidence
   until it reports real.
8. **Two functions chase the same move** — the CEO de-conflicts in Allocate (one owner per move); a hard
   cap on cycle count + the budget ceiling backstop any runaway loop.
9. **A gated move stuck forever** — it stays `staged`, **never silently expires or auto-sends**; the
   Needs-you queue shows its **age** so the founder sees what's been waiting.
10. **Memory corruption / torn write** — torn records are skipped (livestore is torn-write safe),
    per-origin isolation holds, a cold restart resumes from the last clean file checkpoint. No fabricated
    resume, no cross-venture bleed.
11. **All metrics `unknown` (fresh company, zero lanes)** — the CEO runs fully as a **glass-box planner**:
    it can Sense the *shape* of the tree, Decide the instrumentation plan, and draft/queue everything; every
    move names the lane it's blocked on. The company is honest and usable at zero connectors.
12. **Founder over-rides the ⭐ recommendation** ("1b not 1a") — the pick is honored, restreams Allocate,
    and is **logged with the founder as decider**; the CEO's alternative stays in the log so a later Learn
    can compare what the ⭐ path would have predicted.
13. **A move's target metric has no owning function** — the metric-tree edge is dangling; the CEO cannot
    allocate it and raises it as a *tree-integrity task* (assign an owner) rather than dispatching blind.
14. **Reversible move fails at act-time** (a function errors) — the task returns to `staged`/`failed`, not
    `done`; the failure is logged with a retry; the CEO does **not** count the intended delta as achieved in
    the next Learn.
15. **Team-mode concurrent re-plan** — two agents re-score the backlog at once; LWW merges per-move
    (latest timestamp wins), the append-only decision log keeps both entries, OKR status converges once both
    read the same metric history (§4.4). Never a silent clobber.

---

## 7. Today-doable vs blocked

Honest split, grounded in the real product — the daemon *is* a Claude Code backend on the real Switchboard
repo, so the CEO's dispatch to Product produces real work.

### 7.1 Runs today, no founder input (reversible, real)

| Capability | Why it's real today |
|---|---|
| **The full CEO loop** (Sense→Decide→Allocate→…→Learn) | pure reasoning over memory + the Analyst's read; needs no lane to *think* |
| **The decision engine** (candidate gen, leverage scoring, options + ⭐, reallocation from last deltas) | operates on persisted memory; deterministic, replayable |
| **OKRs + the metric-tree *shape*** | the CEO can hold the objects and reason over them; the Analyst stands up the shape and marks nodes `unknown` honestly |
| **Memory** (files + livestore, cold-restart resume, LWW) | the operating record + livestore already exist; this is persistence, not a new lane |
| **The Brain view + Decision log** (glass-box, provable locks) | renders the memory it already holds |
| **Dispatching Product** to ship real repo work on branches | the genuine unlock — Claude Code edits the real repo; the CEO allocates, Product ships to a branch |
| **Queuing everything gated** with the exact lane named | staging is a local operation; the queue is honest with zero lanes |

### 7.2 Blocked on the three founder bottlenecks (capstone §9)

| Bottleneck | What it blocks for the CEO | Until then |
|---|---|---|
| **Signal** (analytics on the live property) | real values for the north star + metric tree; scoring on outcome instead of guess | the CEO allocates by *guess* — low-confidence, and it says so; the north star reads `unknown` |
| **Money** (Paddle/Stripe + a legal entity) | any move that closes the revenue loop; the `earning` state | no revenue loop to allocate toward; economics read `not-connected` |
| **Hands** (connect GitHub-merge/deploy/email/social/payments) | *executing* any gated move the CEO recommends | functions draft and the CEO queues; nothing crosses the world-boundary |

> The CEO can **start running today** on its reversible half — a real operating loop, real product
> shipping on branches, honest metric-shape, and a queue that never lies about what it's waiting on. Each
> founder unlock (a meter, the entity, a lane) converts a whole column of the CEO's drafts into live action.
> That conversion, repeated, is the company coming alive. The line held throughout: **decides and drafts
> freely; never crosses the world-boundary itself.**
