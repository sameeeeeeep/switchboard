# Function Spec — Support/Success (the ears) & Analyst/Instrumentation (the eyes)

> Deep spec for two of the seven functions in [the Operating System capstone](../AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md)
> (§2.5, §2.7, §4). These two are paired on purpose: **Support hears the world, Analyst sees it.**
> Between them they own the *Sense* phase of the control loop — the fresh State snapshot the CEO
> decides against. If they lie, the whole loop compounds a lie. So the through-line of both is the
> **honesty rule**: a signal is either *real* (a meter/channel reported it) or reads
> **"unknown — not instrumented."** No estimates dressed as facts, ever.
>
> Grounded in Switchboard as it actually is today: open-source (so **GitHub issues is a real,
> already-live feedback channel**), an in-app **feedback-capture** feature exists
> ([FEEDBACK-CAPTURE.md](../FEEDBACK-CAPTURE.md)), and **there is no analytics/instrumentation** —
> revenue, traffic, installs, activations all currently read *"unknown — not instrumented."* The
> north-star candidate is **weekly active wrapp-runs on connected Switchboards.** The Analyst's #1
> job, therefore, is not to *report* the metric tree — it's to **stand up the meter that doesn't
> exist yet**, because until it does every CEO decision is a coin-flip (§4 instrumentation-first
> corollary).

---

## 0. Why these two share a spec

```
        the world  ──────────────▶  Support (ears)  ──┐
   (issues, feedback,                                  │  feedback → backlog
    DMs, reviews)                                       ├──▶  State snapshot ──▶  CEO Decide
                                                        │  signal → decisions
        the product ─────────────▶  Analyst (eyes)  ──┘
   (installs, runs, revenue,
    retention — via meters)
```

Support turns *qualitative* world-signal (words from humans) into triaged, clustered, backlog-ready
truth. Analyst turns *quantitative* product-signal (numbers from meters) into the metric tree and its
deltas. The CEO's **Sense** phase is exactly the union of their two outputs. Neither acts on the
world alone: Support **drafts** replies and bug reports (sending gated); Analyst is fully reversible
(it only reads and computes) but its *recommendations to stand up a meter* become gated founder
asks. Both degrade **loudly** when starved of a lane.

---

# PART A — Support / Success (the ears)

## A1. Mandate

> Onboarding, retention, feedback triage. The company's ears. Watch every inbound channel, turn raw
> human signal into triaged/clustered truth, **draft** replies and **draft** bug reports into
> Product's backlog — sending gated. Own the two funnel-floor numbers: **activation** and **retention**.

Support is the function that makes the company *listen*. In an open-source product its raw material
is unusually rich and unusually public: GitHub issues, PR comments, discussions, in-app
feedback-capture payloads, and (once lanes connect) email and social DMs. Its job is not to answer
everything — it's to compress a noisy inbound stream into (a) a small set of *clusters* the CEO can
prioritize, (b) *drafted replies* waiting on a go, and (c) *drafted bug/feature tickets* dropped into
Product's backlog with a repro and a severity. It is the shortest path from "a user is confused or
hurting" to "Product ships the fix."

**Inputs:** GitHub issues/PRs/discussions, in-app feedback-capture (`~/.relay/guide-result.json`
notes + screenshots, and any feedback surface), email (when connected), social/DMs (when connected),
release notes (to know what just shipped), the backlog + decision log (to dedupe against known work).

**Outputs:** a **triaged inbox** (each item classed + severity + cluster), **feedback clusters** (the
weekly "what N people are saying" rollup), **drafted replies** (queued, never auto-sent), **drafted
backlog tickets** (bug reports + feature requests into Product's queue), the **activation** and
**retention** metrics it owns, and an **onboarding health** read.

**Autonomy grade:** watch/triage/cluster/draft = **auto & reversible**. Every outbound (reply, issue
comment, DM, email) = **approve**. A few things stay **manual** (see A3).

## A2. Compiled tasks (the derived task set)

Tasks are *derived*, not invented — a pure function of "there is inbound signal + these lanes exist."
The Support loop compiles to:

```
watch  ──▶  triage  ──▶  cluster  ──▶  draft-reply         ──▶ (send: gated)
                    │              └──▶  draft-backlog-ticket ──▶ Product backlog
                    └──▶  onboarding-watch / retention-watch  ──▶ metric deltas ──▶ Analyst/CEO
```

| # | Task | Class | Autonomy | Lane needed | Notes |
|---|---|---|---|---|---|
| S1 | **Watch** — poll issues, feedback-capture, DMs since last sweep | reversible | auto | GitHub (read) always; email/social to widen | Read-only. Absent lane ⇒ that source silently missing is **not allowed** — it reads "email: unknown — not connected." |
| S2 | **Triage** — class each item (`bug`/`feature`/`question`/`praise`/`noise`/`security`), set severity, dedupe against backlog | reversible | auto | — | Economy model (A6). Security-class items get a special path (edge E7). |
| S3 | **Cluster** — group semantically-similar items into themes with a count | reversible | auto | — | The count is the signal the CEO prioritizes on ("14 people hit the same onboarding wall"). |
| S4 | **Draft reply** — write a response per item (answer / ack / "fixed in vX") | reversible (draft) | auto to draft; **approve** to send | GitHub-comment / email / social to send | The draft always exists; the *send* is the gated leaf. |
| S5 | **Draft backlog ticket** — turn a bug/feature into a Product-backlog item with repro + severity + cluster link | reversible | auto | — (writes to internal backlog, not the world) | This is the Support→Product seam (A8). Writing to the *internal* backlog is reversible-internal, not outbound. |
| S6 | **Onboarding watch** — track first-run → first-successful-wrapp-run; flag drop-off points | reversible | auto | Analytics (to be real) | Owns **activation**. Blind until the meter exists (Part B) — until then reads "unknown." |
| S7 | **Retention watch** — track returning-vs-churned Switchboards week over week | reversible | auto | Analytics | Owns **retention**. Same blindness caveat. |
| S8 | **Close-the-loop** — when Product ships a fix for a cluster, draft the "this is fixed" reply back to each reporter | reversible (draft) | auto to draft; **approve** to send | GitHub/email | The retention move: people who get told "your bug is fixed" come back. |
| S9 | **Escalate** — route a security report or a legal/abuse/threat DM to the founder untouched | manual | **manual** | — | Support never drafts a public reply to a security or legal item; it hands it up (A3, E7). |

**The reversibility × direction grid** (every task placed):

| | **auto** | **approve** | **manual** |
|---|---|---|---|
| **reversible / internal** | S1 watch, S2 triage, S3 cluster, S5 backlog-write, S6/S7 metric watch | — | — |
| **outbound / world-touching** | — | S4 send reply, S8 send close-loop, public issue comment | S9 escalate security/legal (founder-only) |

The rule, restated for Support: **it can draft a reply to anyone; it sends to no one without a lane +
a go.** A public GitHub comment is outbound (it's on the open record with the project's name on it),
so it is `approve`, same as an email.

## A3. Onboarding & retention ownership (the Success half)

Support is not just a triage queue — it owns the **floor of the funnel**: does a new install become
an *active* Switchboard, and does an active one *stay*.

- **Onboarding (activation).** Owns the metric `installs → activations` (a Switchboard that has run
  its first wrapp successfully). Its levers are all reversible drafts: improve the first-run tour
  ([ONBOARDING.md](../ONBOARDING.md) is the surface), draft a "you installed but never ran a wrapp —
  here's the 60-second first run" nudge (send gated on a lane), and feed onboarding-wall clusters
  (S3) straight to Product as high-priority backlog. **Blind until instrumented:** with no analytics,
  activation reads *"unknown — not instrumented"* and standing up its meter is a top ask to the
  Analyst (Part B).
- **Retention.** Owns `weekly-active → retained` (a Switchboard active this week that was active last
  week). Its lever is the close-the-loop reply (S8) and a re-engagement draft. Again gated on a lane
  to send and blind until the meter exists.
- **The honest limit.** Support can *draft* every retention/activation nudge today; it can *measure*
  neither until the Analyst stands up the meters and *send* neither until an email/DM lane connects.
  It says both out loud rather than faking a funnel chart.

## A4. Metrics Support owns + their state machines

| Metric | Definition | Owner | Meter today | State machine |
|---|---|---|---|---|
| **Activation rate** | activated Switchboards ÷ installs | Support | **none** → "unknown" | `unknown` (no meter) → `real` (meter live) → `on-track`/`at-risk` vs target |
| **Retention (W/W)** | active-this-week that were active-last-week | Support | **none** → "unknown" | same ladder |
| **Response time** | median time inbound → first drafted reply approved+sent | Support | GitHub timestamps (partial today) | `unknown` → `real (drafts only)` → `real (end-to-end)` once a send lane exists |
| **Feedback→product throughput** | clusters that became backlog tickets that shipped, per cycle | Support | internal backlog (real today) | `real` immediately — it's all internal state, no external lane needed |

Note the split: **throughput** is measurable *today* (it's internal), so it must show a real number,
not "unknown." **Activation/retention** are blind today, so they must show "unknown — not
instrumented," never a guessed percentage. Mixing those two honesties is the failure mode.

**Item-level state machine** (one inbound item):

`new → triaged (class+severity+cluster) → { drafted-reply | drafted-ticket | escalated | closed-noise }`
→ `reply-staged` → `reply-sent` (gated) → `closed`. A ticket-drafted item also carries a *linked
backlog state* mirrored from Product (`backlog → in-progress → shipped`), which is what drives the S8
close-the-loop trigger. An item never auto-advances past `staged` to `sent`.

## A5. Lanes + degradation

| Lane | Unlocks | Absent ⇒ (loud) |
|---|---|---|
| **GitHub (read)** | watch issues/PRs/discussions | this is the one lane live today; its read is real |
| **GitHub (write)** | post issue comments / labels | replies **draft only**, "connect GitHub write to post" |
| **Email** | send support replies, onboarding nudges | drafted, queued; "connect email to send" |
| **Social / DMs** | watch + reply on X/Discord/etc. | that channel reads "unknown — not connected"; nothing silently missing |
| **Analytics** | activation/retention become real (via Analyst) | those two metrics read "unknown — not instrumented" |

Degradation is **loud and specific** (capstone §2 org rule): a starved Support says exactly which
lane it needs and links to connect it, then returns to the staged draft. It never silently drops a
channel — an unwatched channel is *named as unwatched*, because a silent gap in the ears is
indistinguishable from "all quiet," and that false calm is the dangerous state.

## A6. Branching / AI options (Support)

- **Economy model for triage (S2/S3).** Classing and clustering are high-volume, low-stakes,
  text-only work — routed to a cheap/economy model (capstone §12; [MODEL-SELECTION.md](../MODEL-SELECTION.md),
  [FAST-ROUTING.md](../FAST-ROUTING.md)). Economy can't do tool-calls, so it does the *judgment* and
  the deterministic code does the *fetch/write*.
- **Deep model for reply drafting on sensitive items.** A security-adjacent, angry, or public
  high-visibility thread gets the deep model — the cost of a bad public reply is high.
- **Options + ⭐ recommended on replies (S4).** House doctrine everywhere a choice exists: a drafted
  reply comes as N tones/angles ("terse fix-confirm" · "warm + apology" · "ask for repro") with one
  ⭐ recommended; the founder picks "1b" and the send restreams from it. A/B on subject lines where an
  email lane supports it.
- **Cluster-merge branching.** When two clusters might be the same theme, Support offers the merge as
  an option rather than silently collapsing (an over-merged cluster hides a real second bug).

## A7. Cockpit surfaces (Support)

- In the **Org view** (capstone §11): the Support lane shows *inbound this cycle*, *triaged/untriaged
  split*, the top 3 clusters by count, and its connected-lanes readout.
- In the **Brain view**: activation + retention nodes of the metric tree (real-or-unknown).
- In the **Needs-you queue**: every staged reply/comment across ventures, each with its blast radius
  ("posts publicly on issue #214") — the founder clears them over coffee.
- The **feedback cluster rollup** is the weekly artifact Support hands the CEO: "these 5 themes, this
  many voices each, these already ticketed."

## A8. The Support → Product seam (feedback → backlog)

This is the highest-value wire in the doc — it's workflow #2 in the capstone ("ship a feature
end-to-end"). Mechanics:

1. Support clusters (S3) and, for any `bug`/`feature` cluster above a count threshold, drafts a
   backlog ticket (S5): title, repro steps (pulled from the feedback-capture screenshot+note where it
   exists — that's exactly the actionable-bug-report payload FEEDBACK-CAPTURE.md produces), severity,
   the cluster's voice-count, and a **provable lock** back to the source items.
2. The ticket lands in **Product's backlog** in state `backlog`, tagged `from:support`, with the
   voice-count as a priority signal. Writing to the internal backlog is reversible-internal — no lane,
   no gate.
3. The **CEO** (not Support) decides whether to allocate Product to it this cycle — the count is the
   input to that scoring (leverage = impact × confidence ÷ effort, and a 14-voice cluster is high
   confidence).
4. When Product ships it, the ticket flips to `shipped`; that transition **triggers S8**, drafting the
   "fixed in vX" close-the-loop reply to every original reporter (send gated). This closes the loop
   the capstone calls out: Support surfaces → CEO prioritizes → Product builds → Support tells the
   reporters → they come back (retention).

The seam's honesty guarantee: Support never *tells a user* something is fixed until Product's ticket
is really `shipped` — no "we're on it" that isn't backed by a real backlog state.

---

# PART B — Analyst / Instrumentation (the eyes)

## B1. Mandate

> Turn raw signal into the **State snapshot** and the **metric deltas**. Without this the CEO is
> blind. Fully auto and reversible — read meters, compute the metric tree, flag anomalies. **Where a
> meter is missing, its job is to stand up the instrumentation** (or tell the founder exactly what to
> connect). This last clause is, for Switchboard *today*, the entire job — because there is no
> instrumentation at all yet.

The Analyst is the function that makes the company *see*. It produces the artifact every other phase
consumes: the **State snapshot** (capstone §1, the Sense output). It computes the **metric tree**, the
**deltas** against last cycle, and the **anomaly flags**. It is the enforcer of the **honesty rule**:
it is the function most tempted to fill a blank with a plausible number, and the one where doing so
would do the most damage, so its prime directive is the opposite — a blank stays *"unknown — not
instrumented"* and *becomes a task to fix*, never a guess.

**Inputs:** analytics meters (none today), GitHub API (stars/traffic/clones — partially available
today via the API), payments meter (none today), the daemon's own run-log (the closest thing to a
real usage meter that could exist — see B8), the metric-tree history in memory.

**Outputs:** the **State snapshot**, the **metric tree** (each node real-or-unknown), **deltas +
trends**, **anomaly alerts**, and — the load-bearing one — **instrumentation plans** (a concrete
"here's what to measure, how, and what you must connect" proposal when a meter is missing).

**Autonomy grade:** reading/computing/flagging = **auto & reversible** (it only reads). *Standing up*
a meter that requires touching the world (adding an endpoint, connecting a property) becomes a
**gated** founder ask, drafted with the exact steps.

## B2. The metric tree (the decomposition it owns)

The north-star candidate is **weekly active wrapp-runs on connected Switchboards.** Decomposed
(capstone §4):

```
        installs
           │  (Support owns this edge: activation)
           ▼
      activations ─────────────────────────────┐
           │                                     │
           ▼                                     │
      weekly-active Switchboards                 │
           │                                     │  each node:
           ▼                                     │   • an owner
  ★ weekly active wrapp-runs  ◀── NORTH STAR     │   • a target
           │                                     │   • real | "unknown"
           ├────────────▶  paying (Pro subs)     │   • a delta vs last cycle
           │                     │  (Sales owns)  │
           ▼                     ▼               │
        retained  ◀───────  retained-paying  ────┘
     (Support owns)
```

| Node | Owner | Meter today | Reads |
|---|---|---|---|
| installs | Growth/Support | none | **unknown — not instrumented** |
| activations | Support | none | **unknown** |
| weekly-active Switchboards | Analyst | none | **unknown** |
| **★ weekly active wrapp-runs** | **Analyst** | **none — this is the #1 gap** | **unknown** |
| paying (Pro subs) | Sales | none (no Paddle yet) | **not connected** |
| retained | Support | none | **unknown** |

Every node reads honest-blank today. That is *the* finding: **the company is currently blind on every
tier of its own tree, including its north star.** B8 is the plan to open one eye.

## B3. The honesty rule (the Analyst's prime directive)

The non-negotiable, restated as the Analyst's operating law:

1. A metric is **real** (a meter reported it, with a timestamp and a source) **or** it reads
   **"unknown — not instrumented."** There is no third "estimated" state on the revenue/usage figures.
2. A blank is **never** filled with a guess, a proxy dressed as the real thing, or a number carried
   over from a stale read without saying it's stale.
3. A blank is a **task**: "no meter for X" compiles to an instrumentation plan (B4), and if X is the
   north star, standing up that meter is the **highest-priority move in the whole company** (§4
   instrumentation-first corollary) — because every CEO decision is a coin-flip until it exists.
4. **Provenance travels with the number.** Every real metric in the snapshot carries `{value, source,
   as_of, method}` so the CEO can see *why* it's trustworthy and the founder can audit it.
5. A *derived* number (a ratio, a projection) is labeled derived and never counted as revenue
   (mirrors the agency "projected pipeline ≠ revenue" rule).

## B4. Instrumentation-first: when a meter is MISSING (the load-bearing section)

This is the Analyst's #1 job for Switchboard today. When a node has no meter, the Analyst doesn't
shrug — it **produces an instrumentation plan**: a concrete, privacy-respecting proposal for what to
measure, how, and what the founder must connect. The plan is drafted (reversible); the parts that
touch the world (deploy an endpoint, connect a property) are gated founder asks.

**An instrumentation plan is a structured artifact:**

```
InstrumentationPlan
├─ metric        which tree node this lights up (e.g. "weekly active wrapp-runs")
├─ what          the exact event to count + its unit ("a wrapp run completes on a connected Switchboard")
├─ how           where the meter lives (daemon run-log? GitHub API? an opt-in ping? Plausible on the landing?)
├─ privacy       what is and is NOT collected; aggregation/anonymity guarantees; opt-in vs opt-out
├─ founder-step  the one thing only the founder can do (connect the property / flip a default / host the endpoint)
├─ effort        rough build size (so the CEO can score it)
└─ honest-gap    what it still won't tell us (so we don't over-claim the new meter)
```

**The privacy invariant (non-negotiable, and it's the moat).** Switchboard's whole thesis is
local-first, per-origin-isolated, "your data never leaves your machine." Instrumentation **must not
betray that.** So every plan obeys:

- **Aggregate, never surveil.** Count events, not people. "N wrapp-runs this week," never "user X ran
  wrapp Y." No content of a run, no prompts, no file contents, no PII — ever — leaves the device.
- **Opt-in, or opt-out-and-obvious.** A usage ping is either explicitly opt-in, or opt-out with a
  first-run disclosure and a one-flip off. Never silent telemetry. (This is itself a founder
  decision — see the refused-metric edge E11.)
- **On-device aggregation first.** Where possible the daemon aggregates locally and reports only a
  count, so raw events never transit at all.
- **Provenance + retention stated.** Every meter says what it keeps and for how long.

A metric that can only be gotten by violating this (e.g. "which files does each user open") is
**refused**, and the Analyst says so out loud rather than building surveillance to fill a cell (E11).

## B5. Metrics the Analyst owns + state machines

| Metric | Owner | Meter | State machine |
|---|---|---|---|
| **weekly-active wrapp-runs (north star)** | Analyst | none today → B8 plan | `unmetered` → `plan-drafted` → `plan-approved` → `metering` → `real` |
| **weekly-active Switchboards** | Analyst | none → B8 | same ladder |
| **anomaly flags** | Analyst | derived from any real series | `none` → `candidate` → `confirmed` (persists ≥2 reads) / `false-positive` (reverts) |
| **data-honesty coverage** | Analyst | self (how many tree nodes are real vs unknown) | a real number *today*: "1 of 6 nodes could be real; 0 are" — the meta-metric that tracks its own blindness |

**Meter state machine** (per node): `unmetered` (no plan) → `plan-drafted` (Analyst wrote a B4 plan)
→ `plan-approved` (founder said go) → `metering` (endpoint/ping live, warming up) → `real` (enough
data to report) → `degraded` (meter stopped reporting — reverts to "unknown," never to a stale value).

## B6. The daily State snapshot (the Sense artifact)

The Analyst's headline output, produced every **Sense** phase (daily standup, capstone §8):

```
StateSnapshot  { as_of }
├─ metric_tree     every node: {value|"unknown — not instrumented", source, as_of, delta_vs_last}
├─ deltas          what moved since last cycle (real series only)
├─ anomalies       confirmed flags with a plain-language "what changed"
├─ honesty_coverage  "N of M nodes real" — the blindness meta-metric
├─ open_plans      instrumentation plans awaiting a founder go
└─ confidence      per-node, low where a series is short/noisy
```

The snapshot is **reversible and auto** — it only reads and computes. It's written to memory
(capstone §7) so the delta history compounds. On a cold restart the Analyst re-reads the last
snapshot and resumes; nothing important lives only in a session's head.

## B7. Anomaly detection + degradation

- **Anomaly detection** runs only over *real* series (you can't flag an anomaly in a blank). A
  candidate anomaly (a spike/drop beyond a band) must **persist ≥2 reads** before it's `confirmed`,
  which kills the false-positive-alert-storm failure mode (E5). A confirmed anomaly becomes a
  candidate move for the CEO ("wrapp-runs dropped 40% since the vX deploy") and, if it correlates with
  an issue spike, gets cross-linked to Support's cluster.
- **Degradation (loud).** If a meter stops reporting, the node reverts to **"unknown — not
  instrumented (meter down since T)"** — *never* to its last real value silently. A stale number
  presented as current is the single most dangerous thing the eyes can do, so a dead meter is louder
  than a live one.
- **Branching / AI options.** Economy model for the mechanical delta-computation and snapshot
  assembly; **deep model for anomaly *reasoning*** — "is this drop a real regression, a seasonality
  artifact, or a meter glitch?" is exactly the high-stakes judgment worth the expensive model
  (capstone §12). Anomaly explanations come as options + ⭐ recommended ("likely cause: the vX deploy /
  a weekend dip / a meter outage") so the CEO isn't handed one brittle story.

## B8. The Analyst → CEO seam (signal → decisions)

The Analyst hands the CEO the State snapshot; the CEO decides against it. Two rules make the seam
honest:

1. **The CEO scores moves on real deltas only.** A move claiming to lift the north star can't be
   scored if the north star is "unknown" — which is *why* the instrumentation plan for the north star
   is auto-promoted to the top of the candidate list (§4 corollary). The Analyst doesn't just report
   the blindness; it hands the CEO the one move that ends it.
2. **The ungameable-check.** The Analyst flags when a function moved its own metric without moving the
   north star (capstone §14) — a vanity gain, surfaced as such, not a win. This keeps the tree honest
   under optimization pressure.

---

## C. Minimum honest instrumentation for Switchboard (today-doable)

The concrete starter — the smallest thing that opens **one** eye without betraying the privacy moat,
respecting the "unknown — not instrumented" honesty of everything it *can't* yet see.

**Tier 0 — free, no founder infra, real today (do first):**

| Meter | Source | Lights up | How |
|---|---|---|---|
| **GitHub repo signal** | GitHub API (already have read) | a *proxy* for reach: stars, forks, clones, views, unique cloners, referrers | The API's `traffic/clones` + `traffic/views` are real and available now. Labeled a **reach proxy**, never claimed as installs. |
| **Issue/feedback throughput** | GitHub issues + feedback-capture files | Support's feedback→product throughput (real today) | Count clusters → tickets → shipped. All internal. |
| **Release cadence** | git tags / releases | Product's ship rate | Real from the repo. |

**Tier 1 — the north-star meter (the one real build, privacy-first):**

The north star is **weekly active wrapp-runs on connected Switchboards.** The daemon already sees
every wrapp run (it *is* the broker that runs them). So the meter is: **the daemon aggregates a local
count of completed wrapp-runs per week, on-device, and — opt-in — reports only an anonymous
aggregate.**

```
InstrumentationPlan — weekly-active wrapp-runs
├─ what         a wrapp run completing on a connected Switchboard (count only)
├─ how          daemon increments a local weekly counter (already sees every run);
                an opt-in weekly beacon POSTs {anon_instance_id, week, run_count, wrapp_count}
                to a single minimal endpoint. On-device aggregation ⇒ raw events never transit.
├─ privacy      NO prompts, NO file contents, NO wrapp inputs/outputs, NO per-user identity.
                anon_instance_id is a rotating, salted, non-reversible id — a coarse "how many
                Switchboards" denominator, not a person. Opt-out with first-run disclosure + one-flip off.
├─ founder-step (1) host the one endpoint (a Cloudflare Worker + KV is enough — see CLOUD.md);
                (2) approve the opt-out-default + disclosure copy (a privacy decision, founder-only).
├─ effort       small: a local counter + a weekly beacon + a ~30-line Worker.
└─ honest-gap   a beacon undercounts fully-offline/opt-out instances; the number is a floor,
                labeled "≥", never claimed as exact. Better an honest floor than a fabricated total.
```

**Tier 2 — needs a founder bottleneck unlocked (name them, don't fake them):**

| Node | Blocked on | Until then |
|---|---|---|
| installs | a distribution property (landing analytics like privacy-preserving Plausible, or DMG download counts) | "unknown — not instrumented" |
| activations / retention | Tier-1 north-star meter shipped (activation = first run; retention = week-over-week of the same anon id) | "unknown" — these *derive* from Tier 1 once it's live |
| paying | Paddle connected (the money bottleneck, capstone §9) | "not connected" |

The staging: **Tier 0 today** (real reach/throughput/cadence numbers, honestly labeled as proxies),
**Tier 1 as the top build** (one small privacy-first meter that lights the north star as an honest
floor and, once live, derives activation + retention for free), **Tier 2 named and parked** behind the
founder unlocks. This is the "minimum honest instrumentation" — it turns the north star from *unknown*
to a real (if floored) number without collecting a single prompt, file, or identity.

---

## D. Routines (both functions, the temporal spine)

| Routine | Function | Tempo | Phase | Boundary |
|---|---|---|---|---|
| **Feedback sweep** | Support | ~hourly while on / each standup | Sense | reads issues+feedback+DMs, triages, clusters, drafts — sends nothing |
| **Activation/retention watch** | Support | daily | Sense/Measure | reads the (real, once metered) funnel; flags drop-offs; drafts nudges (send gated) |
| **Daily State snapshot** | Analyst | daily (standup) | Sense | reads meters, computes the tree + deltas, writes to memory — reversible |
| **Anomaly alerting** | Analyst | on-change over real series | Measure | flags confirmed anomalies (≥2 reads); alerts only, drafts a candidate move |
| **Instrumentation review** | Analyst | weekly | Learn | re-checks which nodes are still blind; re-drafts/ages open plans; keeps "stand up the meter" on top while the north star is unknown |

Each routine is honest about its boundary in its own header (capstone §8) — "reads, then drafts,
sends nothing."

---

## E. Edge cases (≥12)

1. **Issue spike** — inbound jumps 5× (a bad release, a viral post). Support triages under load with
   the economy model, clusters aggressively so the CEO sees *themes not 200 items*, and the Analyst's
   anomaly flag on inbound-volume cross-links to it. The CEO can reallocate Product to the spike this
   cycle (capstone workflow #4). Support never auto-replies its way out of a spike — the queue stays
   gated; it just gets *organized* fast.
2. **Ambiguous feedback** — "it's broken" with no repro. Support drafts a *clarifying-question* reply
   (send gated) rather than guessing a bug; it does **not** file a backlog ticket on a phantom. If a
   feedback-capture screenshot exists, it mines that for the repro first.
3. **No analytics lane at all (today's reality)** — activation/retention/north-star all read
   "unknown — not instrumented." The Analyst does **not** invent a funnel; it emits the Tier-1
   instrumentation plan (C) as the top candidate move and the CEO surfaces it as *the* founder ask.
   The company runs as a glass-box planner meanwhile.
4. **A privacy-hostile metric is requested** — someone (or a naive optimization) wants "which files
   each user opens" or per-user run detail. The Analyst **refuses to build it**, states why (it
   violates the local-first, aggregate-only invariant that is the moat), and offers the nearest
   privacy-safe aggregate instead. Refusal is surfaced, not silent.
5. **Anomaly false-positive** — a one-read spike. It stays a `candidate`, never fires an alert until
   it persists ≥2 reads. A reverting series flips it to `false-positive` and it's logged, not
   escalated. No alert storms.
6. **Feedback with no signal** — pure praise, or noise/spam. Classed `praise` (optionally a drafted
   thank-you, gated) or `noise` (closed, not ticketed). It never becomes a backlog item — throughput
   isn't inflated by non-actionable inbound.
7. **A security report arrives** (in a public issue or a DM) — Support does **not** cluster it, draft
   a public reply, or file a normal ticket. It **escalates to the founder untouched** (S9, manual),
   because a public "we're fixing this auth hole" comment is itself a disclosure. Security is
   founder-only.
8. **PII in a report** — a user pastes an email/token/log with secrets into an issue or feedback note.
   The Analyst/Support **redacts before it enters the backlog or the snapshot**, never propagates raw
   PII into memory, and (for a public issue) drafts a "please rotate that + we've redacted it" reply
   (gated). PII never travels into the operating record.
9. **A meter dies mid-week** — the beacon endpoint goes down. The node reverts to "unknown — not
   instrumented (meter down since T)," **never** to its last real value. A dead eye reads as blind,
   loudly, not as a frozen picture.
10. **Contradictory signal** — issue volume says "people hate the release" but wrapp-runs are up.
    Analyst flags **low confidence**, presents both with provenance, and the CEO defers the bet rather
    than picking a fake winner (capstone §14).
11. **Founder refuses the usage beacon** (a legitimate privacy call) — the north star stays "unknown";
    the Analyst falls back to the honest Tier-0 GitHub reach proxy (clearly labeled a proxy, not the
    north star) and says the north star is un-metered *by choice*, not by neglect. No shadow telemetry
    is ever built to route around a "no."
12. **Duplicate across channels** — the same bug reported in an issue, a DM, and a feedback note.
    Support dedupes into one cluster with a voice-count of 3 (raising priority), not three tickets.
    The close-the-loop reply (S8) then goes to all three reporters on their own channels.
13. **Backlog claims "fixed" but it isn't** — Product marks a ticket `shipped`; a reporter says it's
    still broken. S8's close-loop reply is gated, so the founder catches it at approval; the item
    re-opens to `backlog` rather than a false "fixed" going out. (The gate is what saves the
    relationship.)
14. **Feedback-capture file is malformed / partial** (a torn `guide-result.json`, screenshot missing)
    — Support ingests the note text it *can* read, flags the missing screenshot, and doesn't block the
    whole sweep on one bad record (mirrors the torn-write skip in capstone §14).

---

## F. Today-doable vs blocked (the honest split)

**Runs today, no founder input (reversible, real):**
- **Support:** watch + triage + cluster GitHub issues and feedback-capture payloads (GitHub read is
  live); draft replies and draft backlog tickets into Product's queue; compute
  feedback→product **throughput** as a *real* number; own onboarding/retention as *drafts*.
- **Analyst:** produce the State snapshot with the **honest tree** (every node real-or-unknown);
  compute Tier-0 real numbers (GitHub reach proxy, issue throughput, release cadence); run anomaly
  detection over those real series; and — the #1 unblock — **draft the Tier-1 instrumentation plan**
  for the north star.

**Blocked on the founder bottlenecks (capstone §9), each named:**
- **Signal:** the north-star meter needs the founder to *host one endpoint + approve the opt-out
  disclosure* (Tier 1). Landing/install analytics need a distribution property (Tier 2). Until then:
  "unknown — not instrumented."
- **Hands:** GitHub *write* (to post comments), email, and social lanes need connecting before any
  Support draft can actually **send**. Until then: drafted + queued, loudly.
- **Money:** the `paying`/`retained-paying` nodes need Paddle + the entity (the money bottleneck).
  Until then: "not connected."

> The line held throughout, for both functions: **they draft everything and measure honestly; they
> send nothing and fabricate nothing without a lane, a meter, and the founder's go.** The single
> highest-leverage thing the founder can do to un-blind the whole company is approve the Tier-1
> north-star meter — one small, privacy-first build that turns the north star from *unknown* into a
> real (honestly-floored) number, and derives activation + retention for free once it's live.
