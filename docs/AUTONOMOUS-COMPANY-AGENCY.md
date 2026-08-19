# The Autonomous Company — the AGENCY archetype

> Companion to [AUTONOMOUS-COMPANY.md](./AUTONOMOUS-COMPANY.md). That doc specs the shared engine and
> names the agency as the newest, least-built `kind` (§2.2, §13). This is the definitive spec for that
> `kind`: the `Engagement` object, the two concurrent loops, billable economics, the capacity model, the
> pipeline board, autonomy, edge cases, and routines. Everything here obeys the master invariant —
> **drafts everything, sends nothing without a connected lane + the human's go; no fabricated numbers.**

---

## 0. Why the agency is the hard one

The other two kinds have **one deployable**. A software business ships an app; a consumer brand ships a
product line. Their whole surface can be a single cockpit because there is a single thing being built.

An agency has **no single deployable**. Its output is *N client engagements*, each a small company
lifecycle of its own — sold, scoped, delivered, invoiced, retained or lost — running concurrently and out
of phase. So the agency needs one structure the others don't: a **first-class pipeline of `Engagement`
objects**, and **two loops running at once** — winning work (business development) and doing work
(delivery). Everything else — the four domains, the decision compiler, the CEO chat, the autonomy ticker,
the daemon, the honest boundary — is inherited unchanged.

**`kind` resolution (the new column in the master `resolveKind` table):**

| Slot | **Agency** |
|---|---|
| Deployable | client deliverables (decks, sites, campaigns, copy, code) — one set per engagement |
| Unit of work | **`Engagement`** (retainer or project) |
| Economics | **billable** — retainers, project fees, performance; revenue = paid invoices only |
| Growth loop | list → outreach → qualify → propose → close → deliver → **referral / case study** → list |
| Host | client-facing microsites + a **pipeline board** |
| The scarce thing | **capacity** — how many engagements can be served at the quality bar |
| First "real" milestone | **first signed client** (a `won` engagement with a real countersign) |

Engine keying, consistent with `KINDS` in `autopilot.js`:
`agency: { label: "AGENCY", econ: "billable", scarce: "capacity", deployNoun: "engagement", ... }`.
`econ:"billable"` is a third value beside `sales` and `usage`; the task compiler and economics readout
branch on it exactly as they branch on the other two.

---

## 1. The `Engagement` object

The engagement is to the agency what the venture is to the lab: a nested lifecycle the cockpit renders as
a card and opens as a detail panel. A venture (the agency) **has many** engagements. Following the engine's
own rule (`companies` is a `collection`, one company = one file, never one blob), **engagements are a
per-agency `collection` — one engagement = one record**, so two teammates can each move a *different*
engagement under Team Mode without clobbering, and a paused engagement never drags the board.

```
Engagement
├─ id            stable id (collection key)
├─ client        { name, contact, source, brandRef }   brandRef → a CREST kit for THIS client
├─ stage         lead → qualified → proposed → won → delivering → delivered → retained | lost
│                 + edges: stalled, churned  (see §2)
├─ scope         { deliverables[], dueDates[], acceptanceCriteria, revisionsAllowed }
├─ economics     { feeModel: retainer|project|performance, amount, cadence,
│                  invoiced[], paid[], projectedValue }   ← real-or-not-connected, §4
├─ health        { lastContactAt, nextTouchDue, ghostStrikes, revisionRound, satisfaction? }
├─ artifacts[]   every draft this engagement produced: outreach, proposal, deliverable vN, invoice,
│                 case study — each with { class, consentState, laneNeeded, ref }
├─ log[]         this engagement's own operating record (rolls up into the company log)
└─ at            created ts
```

Notes:
- **`brandRef` is per-client, not per-agency.** The delivery loop drafts *in the client's brand*, so each
  engagement points at its own CREST kit (§2 delivery, "uses the client's brand via CREST"). The agency
  also has its *own* kit for outreach and case studies. Two brand contexts, never confused.
- **`artifacts[]` carries the honest boundary at the item level.** Every artifact is tagged
  `class: reversible|outbound`, `consentState: draft|staged|sent`, and `laneNeeded` (the exact connector).
  This is what the leaf detail panel reads to render an approve-move.
- **`economics.projectedValue`** lives in its own field and **never** sums into revenue. `invoiced[]` and
  `paid[]` are arrays of real connector events. Revenue is `sum(paid)`. Full stop (§4).

---

## 2. The full stage machine

One engagement walks one path. The happy path is linear; every real deal also has the sideways edges.

```
                    ┌──────────────── lost ◀──────────┐ (any pre-won stage can be lost)
                    │                                  │
  lead ─▶ qualified ─▶ proposed ─▶ won ─▶ delivering ─▶ delivered ─▶ retained
   │          │           │        │          │            │            │
   └─ stalled ┴─ stalled ─┘        │          └─ stalled ──┘            └─ churned ─▶ (re-engage → lead)
   (no reply / gone quiet)         │
                                   └─ won but never delivered = at-risk, still "won" until kickoff
```

| Stage | Meaning | Entry guard | The one thing waiting |
|---|---|---|---|
| **lead** | a name on the target list, no contact yet | on list build | draft + send outreach |
| **qualified** | replied and fits ICP (budget, need, timing) | a real reply logged | draft a proposal |
| **proposed** | proposal sent, awaiting decision | proposal `sent` via a lane | their yes / no |
| **won** | client said yes | a countersign / explicit go recorded | kickoff |
| **delivering** | work in flight | kickoff brief drafted | draft v1 → QA → review |
| **delivered** | client accepted the deliverable | client acceptance logged | invoice + referral ask |
| **retained** | ongoing (retainer renews / next project opens) | a renewal or new scope | recurring delivery |

**Edges (never silent):**

| Edge | Trigger | Behaviour |
|---|---|---|
| **lost** | explicit "no", or a `stalled` engagement the human marks dead | terminal; feeds a "why we lost" note the weekly review reads. Never auto-marked. |
| **stalled** | `nextTouchDue` passed with no reply for the cadence window (§7) | a *flag on the current stage*, not a new stage — the card dims and the follow-up routine drafts a nudge. Auto-recovers to its live stage on any reply. |
| **churned** | a `retained` client ends the relationship | terminal-ish; re-engagement drafts it back to `lead` with full history (never a cold start). |

**Guards that can't be faked** (mirrors the master's "state can't be entered by fabrication"):
- `proposed` requires the proposal artifact to be `consentState:sent` — i.e. a real lane fired. No lane ⇒
  the proposal *stages* and the engagement stays `qualified` ("ready — connect Gmail to send").
- `won` requires an explicit human-recorded yes (a countersigned doc ref, or the human tapping "mark won").
  The ticker **cannot** move an engagement to `won` on its own.
- `delivered` requires client acceptance logged — the ticker can draft and QA, but *acceptance* is a
  human/inbound event.
- `earning` (venture-level) still requires a **paid** invoice, not an issued one.

---

## 3. The two concurrent loops

The agency runs **business development** (fill the pipeline) and **delivery** (empty the backlog) at the
same time, on the same board. Both are compiled — like every task in the engine, they are a pure function
of engagement state, never hand-authored (`tasksFor(co)` idiom). Each task carries its **class**
(reversible vs outbound) and its **mode** (`auto | approve | manual`, per the master taxonomy). The rule is
mechanical: **reversible ⇒ eligible for `auto`; outbound ⇒ `approve` and only when its lane is connected;
real-world / signature ⇒ `manual`.**

### 3.1 Business-development loop (Growth domain)

| # | Task | Class | Mode | Lane | Notes |
|---|---|---|---|---|---|
| B1 | Build target list from ICP | reversible | **auto** | — | drafts N leads with a fit rationale each; capacity-gated (§4.4) |
| B2 | Draft outreach per lead (in the agency's own voice) | reversible | **auto** | — | options+⭐: 3 angles per lead, one recommended |
| B3 | **Send outreach** | outbound | **approve** | email | batched: "Send to 12 leads" with the blast radius shown |
| B4 | Qualify replies against ICP | reversible | **auto** | — | drafts a fit read; moves `lead → qualified` on a real reply |
| B5 | Draft proposal (scope + fee + timeline) | reversible | **auto** | — | uses the qualified need; options+⭐ on fee shape |
| B6 | **Send proposal** | outbound | **approve** | email/docs | moves `qualified → proposed` only on real send |
| B7 | Follow-up nudge on a stalled thread | reversible→outbound | draft **auto**, send **approve** | email | cadence-driven (§7) |
| B8 | **Mark won / lost** | real-world | **manual** | — | the countersign is human; opens the delivery loop |

### 3.2 Delivery loop (Operations domain) — one instance per `won` engagement

| # | Task | Class | Mode | Lane | Notes |
|---|---|---|---|---|---|
| D1 | Draft kickoff brief | reversible | **auto** | — | from scope + client brand; moves `won → delivering` |
| D2 | Draft deliverable **v1** (in the client's brand via CREST) | reversible | **auto** | — | the core work product; options+⭐ where the deliverable has variants |
| D3 | Internal QA pass (against acceptance criteria) | reversible | **auto** | — | a self-review; flags gaps before the client sees it (self-test doctrine) |
| D4 | **Send for review** | outbound | **approve** | email/docs | shares v1; awaits client feedback |
| D5 | Revise from feedback → v2, v3… | reversible | **auto** | — | bounded by `revisionsAllowed`; loop guard in §6 |
| D6 | **Deliver** (final handoff) | outbound | **approve** | email/docs/deploy | moves `delivering → delivered` on client acceptance |
| D7 | **Draft + issue invoice** | outbound | **approve** | payments | drafts always; *issuing* needs a payments lane; **paid** is inbound, not this step |
| D8 | Draft referral ask + **case study** | reversible | **auto** | — | case study feeds B1 next cycle (the growth flywheel) |

**Reading the two tables together:** everything an agency does that is *reversible* — research a list,
write an email, draft a proposal, produce a deliverable, QA it, revise it, draft an invoice, write a case
study — the ticker may do **itself**. Every point where something **leaves the machine** — send outreach,
send a proposal, share a deliverable, deliver final, issue an invoice — is an **approve-move** gated on the
right connector. And the two human-only beats — **sign the client** and **mark the outcome** — stay
`manual`. This is the master's autonomy line, expressed for billable work.

---

## 4. Economics — billable, real-or-projected, capacity-bounded

### 4.1 Fee models

| Model | Shape | "Real revenue" event | Projected value |
|---|---|---|---|
| **Retainer** | recurring fee / period | each period's invoice **paid** | remaining periods × fee (labelled projected) |
| **Project** | fixed fee, milestones | each milestone invoice **paid** | unbilled milestones (labelled projected) |
| **Performance** | fee tied to an outcome | paid on the reported outcome | modelled range, **always** labelled projected + assumption-shown |

### 4.2 The real-vs-projected rule (non-negotiable)

- **Revenue = Σ(paid invoices reported by a connector).** Nothing else is revenue. An *issued* invoice is
  not revenue; a *signed* retainer is not revenue; a full pipeline is not revenue.
- **Pipeline value is projected**, lives in its own clearly-labelled channel, and **never** touches the
  revenue figure. This is the master's Economic-states rule (§4.5): there is no "estimated revenue" state.
- The cockpit shows two numbers, never blended:
  - **Booked (real):** `Σ paid`. Or a proud, real **zero**. Or **"— not connected"** if no payments lane.
  - **Pipeline (projected):** `Σ projectedValue` across live engagements, weighted by stage probability,
    with the weighting shown. A hover reads: *"projection, not revenue — 4 engagements, weighted by stage."*
- **Invoiced-but-unpaid** is its own visible bucket (accounts-receivable), distinct from both. Issuing an
  invoice moves value from pipeline → receivable; a **paid** event moves it receivable → booked.

### 4.3 What each state proves

`not-connected` (no payments lane; all money reads "—") · `connected, zero` (lane live, honestly nothing
paid yet) · `earning` (a real paid invoice landed). The venture cannot enter `earning` by having a fat
pipeline — only a connector's paid event flips it. Same guard as every other kind.

### 4.4 The capacity model — the agency's scarce resource

Software's scarce thing is compute; a brand's is inventory + cash. **The agency's is capacity** — how many
engagements it can deliver *at the quality bar*. This is the model that makes autopilot **refuse to
over-commit**, which is the honest thing an agency built on a founder's own Claude must do.

```
capacity = { ceiling: N,           // max concurrent DELIVERING engagements at the quality bar (human-set)
             weightBy: "deliverable-load",   // not all engagements cost the same
             inFlight: Σ weight(delivering engagements),
             headroom: ceiling - inFlight }
```

- **`inFlight` counts `delivering` engagements, weighted** by deliverable load (a monthly-retainer content
  engagement ≠ a one-off logo). `won`-but-not-kicked-off counts at a reduced weight (committed, not yet
  loaded); `proposed`/earlier do **not** count (not yet real).
- **The ceiling is human-set** and framed as a quality guarantee, not a limit ("I can do great work for N
  clients at once"). Fund-runway for an agency raises capacity by *adding compute/time*, never by pretending
  the founder can clone themselves.
- **The refusal rule (structural):** when `headroom ≤ 0`, the ticker **will not** auto-run **B1 (build
  list)** or **B3 (send outreach)** — it would be drafting work it can't deliver. Instead it surfaces:
  *"At capacity (N/N). Close a delivery or raise the bar before taking on more."* This is the master
  edge-case "Agency over-capacity — warn and refuse to auto-draft new outreach past the quality-bar
  ceiling," specified. Delivery tasks on existing engagements **keep running** — you never starve current
  clients to chase new ones.
- **Near-capacity (headroom small):** bizdev drafting continues but **staging is held** — new outreach
  drafts sit as `blocked: at-capacity` with a one-tap "queue anyway" the human owns.

---

## 5. UI — the pipeline board, the engagement panel, the four-domain cockpit

The agency reuses the master cockpit shell (slim left rail, top bar with venture switcher / autonomy pill /
⚡N/5 lanes / budget meter, right detail panel). Two things are agency-specific: the **pipeline board** as
the Operations+Growth surface, and the **engagement detail panel** as the leaf.

### 5.1 The pipeline board (columns = stages)

A horizontal, kanban-style board — the one view the other kinds don't have. **Columns are the stage
machine**; cards are engagements.

```
┌ LEADS ─┐ ┌ QUALIFIED ┐ ┌ PROPOSED ┐ ┌ WON ┐ ┌ DELIVERING ┐ ┌ DELIVERED ┐ ┌ RETAINED ┐
│ Acme   │ │ Beckett   │ │ Corva    │ │ Dune│ │ Ellis  ▓▓  │ │ Faro      │ │ Gild     │
│ ·draft │ │ ·proposal │ │ ·waiting │ │ kick│ │ v2 · QA'd  │ │ invoice → │ │ renews 9d│
│  ready │ │  ready→⚡ │ │  3d      │ │ off │ │ review→⚡   │ │ ⚡pay     │ │ referral │
└────────┘ └───────────┘ └──────────┘ └─────┘ └────────────┘ └───────────┘ └──────────┘
    2          1              1          1          1 / cap N      1            1
  stalled cards dim · a ⚡ badge = an approve-move staged on that card, waiting on a lane/your go
```

- **Each column footer** shows its count; the **DELIVERING** column also shows `inFlight / ceiling` and
  turns amber at headroom 0 (the capacity signal lives where the load is).
- **A card** shows client name, its current draft/next action, days-in-stage, a ⚡ if an approve-move is
  staged on it, and a dim treatment if `stalled`.
- **Cards advance by real events, not drag.** You *can* drag a card to `won`/`lost` (those are the `manual`
  human beats), but the ticker never drags — `qualified→proposed` happens when a proposal actually sends.
  A drag into an outbound stage with no lane stages the move instead of faking the transition.
- **A "needs you" filter** collapses the board to just cards with a staged ⚡ move — the approval queue.

### 5.2 The engagement detail panel (the leaf)

Right-side slide-over, same pattern as task/artifact leaves. Sections:
1. **Header** — client name, stage pill, fee model + amount, source, capacity weight.
2. **Scope** — deliverables, due dates, acceptance criteria, revisions used / allowed.
3. **Artifacts timeline** — every draft (outreach → proposal → v1 → v2 → invoice → case study), each with
   its class, consent state, the exact lane it needs, and a primary action whose label is the **real-world
   act** ("Send proposal to Beckett", "Deliver final to Ellis", "Issue invoice · $4,000") with the blast
   radius under it. Reversible artifacts read "already drafted, tap to see."
4. **Economics** — invoiced / paid / projected for *this* engagement, real-or-not-connected.
5. **Health** — last contact, next touch due, ghost strikes, revision round; the follow-up routine's next
   drafted nudge sits here.
6. **Provable locks** — e.g. "Invoice locked · tap to see why" → opens the `delivered` guard (can't invoice
   what isn't accepted).

### 5.3 How it maps onto the four domains

The four domains are the **same four** as every kind — the agency just fills two of them differently:

| Domain | Software / Brand | **Agency** |
|---|---|---|
| **Company** | identity, running log, CEO chat | same — plus the log is the union of every engagement's log |
| **Operations** | the deployable + tasks | **Delivery** — the pipeline board's `won…retained` half + the delivery task loop per engagement |
| **Growth** | site, content, outreach, ads | **Business development** — the `lead…proposed` half + list/outreach/proposal loop |
| **Strategy** | thesis, bets, autonomy, economics | same — plus the **capacity** control and the booked/pipeline/receivable readout |

So: **Operations becomes delivery, Growth becomes bizdev.** The pipeline board spans both (it *is* the join
between them), which is why it's the agency's signature surface — the hand-off from a `won` card in Growth's
half to a `delivering` card in Operations' half is the whole business, made visible.

The CEO chat gets agency-aware slash verbs (master §5.5): `/list` (build a target list), `/pitch` (draft
outreach), `/proposal` (draft a proposal), `/deliver` (advance a delivery), `/invoice`, `/casestudy`.

---

## 6. Autonomy for an agency — exactly what the ticker may draft

**May draft, itself, budget-permitting (all reversible):**

- target lists from the ICP (B1)
- outreach emails, options+⭐ per lead (B2)
- reply qualification reads (B4)
- proposals — scope, fee options, timeline (B5)
- follow-up nudges (drafts only; B7)
- kickoff briefs (D1)
- **deliverables** — v1 and every revision, in the client's brand via CREST (D2, D5)
- internal QA passes (D3)
- **invoice drafts** (the document; D7 up to but not including *issuing*)
- referral asks and **case studies** from delivered work (D8)
- the daily plan / weekly reflection (routines, §7)

**Must NEVER do on its own (always the human + a lane):**

- **send** any outreach, proposal, review, or final delivery (every B3/B6/D4/D6)
- **issue** an invoice or take any payment action (D7 issue; and it can *never* charge — payments are
  approve-move only, and moving money is out of scope for the loop entirely)
- **mark won / lost** or otherwise assert a client decision (B8 — human `manual`)
- **sign, commit, or accept** anything on the client's or agency's behalf
- **advance a stage that implies an outbound event** without that event actually firing through a connector
- **build a list or send outreach while over capacity** (§4.4 refusal)
- **fabricate** a metric — no invented revenue, no invented pipeline, no invented client sentiment; a
  number is real (a connector reported it) or explicitly "not connected."

The line is identical to the master's: *the machine may fully prepare anything reversible and may only
stage anything that spends money, faces the public, signs, or can't be undone.* An agency is simply the kind
where "faces the public" means "faces the client."

---

## 7. Routines specific to the agency

Inherits the shared routines (morning briefing, autonomy ticker, overnight runner, weekly review). Three
are agency-shaped or agency-only:

| Routine | Cadence | What it does | Boundary |
|---|---|---|---|
| **Capacity watch** | on-change | Recomputes `inFlight` on every stage move; warns as headroom → 0; **blocks** auto-B1/B3 at ceiling; surfaces "close a delivery or raise the bar." | alerts + refusal; drafts nothing outbound |
| **Follow-up cadence** | daily | Scans every `proposed`/`qualified`/`stalled` engagement against `nextTouchDue`; drafts a nudge for each overdue thread; dims cards gone quiet past the window. | drafts nudges only; **sending stays approve-move** |
| **Weekly pipeline review** | weekly | Reflection over the whole board: conversion by stage, win/loss reasons, aging leads, capacity utilization, receivables outstanding; drafts a strategy update ("kill these 3 dead leads, chase these 2, we're at 90% capacity — raise the bar or hold outreach"). | drafts; the human commits every decision |

Cadence windows (the follow-up defaults, human-overridable per engagement): outreach → nudge at **3 days**,
second at **7**, then mark `stalled`. Proposal → nudge at **4 days**, then **9**, then `stalled`. Delivery
review → nudge at **2 days**. `stalled` past **21 days** with no reply prompts a human "mark lost?" (never
auto-lost).

---

## 8. Edge cases (exhaustive)

Extends the master §11. Each is stated with its honest behaviour.

| # | Edge | Behaviour |
|---|---|---|
| 1 | **Over-capacity** | `headroom ≤ 0` ⇒ ticker refuses to auto-run B1/B3; existing deliveries keep running; card column turns amber; surfaces "close one or raise the bar." Never silently drops a client to make room. |
| 2 | **Client ghosts (no reply)** | follow-up routine drafts nudges on cadence; after the window the card goes `stalled` (dimmed, not deleted); at 21 days prompts "mark lost?". **Auto-lost is never allowed** — a human ends a relationship. |
| 3 | **Scope creep** (client asks for more than `scope`) | detected when a review reply requests out-of-scope work; the loop **does not** silently absorb it — it drafts a *change-order* (new/expanded scope + fee delta) as an approve-move, and flags the engagement `scope-drift` until the human resolves it. Revisions used vs allowed is always visible. |
| 4 | **Proposal rejected** | engagement → `lost` (human-marked) with a "why" note; the reason feeds the weekly review; the drafted proposal stays on the board, re-usable as a template for the next similar lead. |
| 5 | **Deliverable revision loop** (endless "one more change") | `revisionsAllowed` caps auto-revision (default 3); past it, D5 stops auto-drafting and stages a **"revisions exhausted — propose a change-order or a scope reset"** decision for the human. The loop never spins the founder's tokens forever on free rework. |
| 6 | **Invoice unpaid** | issued-but-unpaid sits in the **receivable** bucket (not revenue); follow-up routine drafts a payment-reminder (approve-move, needs the lane); `earning` is **not** entered — only a paid event flips it. Never counted as booked. |
| 7 | **Referral / case-study auto-draft** | on `delivered`, D8 drafts a case study (reversible) and a referral ask; **both stay drafts** — the case study is public-facing so publishing it is an approve-move, and the referral ask is outbound so sending it is too. The draft feeds B1 next cycle regardless. |
| 8 | **Two engagements, same client** | two separate `Engagement` records sharing one `client.brandRef`; economics and stages are independent (one can be `retained` while a new one is `proposed`); the board shows both; capacity counts both. A win on one never mutates the other. |
| 9 | **Connector-less operation** | the entire pipeline is usable as a glass-box planner: lists, outreach, proposals, deliverables, invoices, case studies all **draft and stage**; every send reads "ready — connect Gmail/Docs/Stripe to send." Never a dead-end; revenue reads "— not connected." |
| 10 | **A send fails** (lane errors mid-send) | the artifact returns to `staged` (not `sent`); the engagement does **not** advance stage; the failure surfaces in the log with a retry; a proposal that failed to send keeps the engagement at `qualified`. |
| 11 | **Budget hits zero mid-draft** | autonomy drops `drafting → off`, logs why, the in-flight deliverable/proposal is **saved not lost** (in-memory-wins merge rule); the human refuels or works manually. |
| 12 | **Won but never delivered** (kickoff stalls) | engagement stays `won` (at reduced capacity weight) but flags **at-risk** after the kickoff window; the board surfaces it above new bizdev — you owe a signed client before you chase a new one. |
| 13 | **Client sentiment / satisfaction** | only ever real (a logged reply, a connector signal) or absent — **never** an invented "client is happy" number. Satisfaction is optional and human/inbound-sourced. |
| 14 | **Kind switched to/from agency** after decisions lock | not silent (master §11): requires confirm + re-derives the task set. Engagements have no equivalent in other kinds, so switching *away* archives them with a warning; switching *in* starts an empty pipeline. |
| 15 | **Team Mode: two people on the board** | per-engagement `collection` records + LWW mean two teammates advancing *different* engagements merge cleanly; the guard is the same in-memory-wins-while-drafting rule the engine already ships. Same client, two people, one engagement each = fine. |
| 16 | **Retainer renewal vs churn** | a `retained` engagement whose period ends re-opens a delivery cycle on renewal or moves to `churned`; churn drafts a win-back to `lead` with full history — never a cold restart, never auto-sent. |

---

## 9. Honest gaps (agency-specific)

- The agency `kind` is **specced, not yet in the engine.** `autopilot.js` today ships `brand` / `product` /
  `wrapp` (`econ: sales|usage`). Landing the agency means: adding `agency`/`econ:"billable"` to `KINDS`, the
  `Engagement` collection + stage machine, the dual-loop `tasksFor` branch, the capacity model, and the
  pipeline board view. Everything it depends on — the collection primitive, MODES, movesFor/tasksFor,
  approve-moves, CREST kits, the routines spine — **already exists**; this is composition, not new
  foundations.
- **Capacity weighting is a heuristic**, not a measured cost. `weightBy: "deliverable-load"` starts as a
  human-tunable estimate; it becomes honest only once real delivery time is observed. Labelled an estimate
  until then (same honesty rule as tokens).
- **No live client send has run** — proposals, deliveries, and invoices are drafted and gated but not yet
  fired against a real Gmail/Docs/Stripe lane on a funded company. Same real-verification gap the master
  names for the overnight runner.
- **Performance fees** model a *range*, always labelled projected with assumptions shown; the real number is
  whatever the outcome connector reports, and until it does, there is no revenue.

The line holds, unchanged, for billable work: **drafts everything — lists, outreach, proposals,
deliverables, invoices, case studies — and sends, signs, and charges nothing without a connected lane and
the human's go. No fabricated revenue; pipeline is projected, never counted.**
