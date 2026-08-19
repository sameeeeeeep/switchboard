# The Autonomous Company — Software Business

> Archetype spec. Extends [`AUTONOMOUS-COMPANY.md`](./AUTONOMOUS-COMPANY.md) §2.1. Same venture object,
> same engine, same honest boundary — this document resolves the three `kind`-forked slots for a
> **software business** and specs the loop, the economics, and the states down to the leaf.
>
> The line, unchanged and non-negotiable: **it drafts everything, ships nothing without a connected
> lane and the human's go, and never shows a number a connector didn't report.**

---

## 0. The one sentence

**You fund a bet with your own tokens. The engine specs a wedge, generates the app, and stages it for
one tap to ship to its own subdomain — then instruments a real activation signal and drafts the first
outreach, so the only thing you ever clear is the outbound.**

A software business is the one kind whose deployable is *itself software the engine can write* — so the
build→ship loop closes tighter here than for any other kind. The subdomain is inherent distribution: the
platform already ships every wrapp to `<slug>.wrapp.sh` (engine: `<slug>.sameep.ai`), so "deploy" is a
gated push, not a hosting project. That distribution *is* the moat — the cockpit is table stakes.

---

## 1. Where it forks — `resolveKind` for software

Software resolves to one of **two engine kinds**, split not by "software vs not" but by **how it earns**:

| Engine kind | Deployable | Host | Economics | The scarce thing |
|---|---|---|---|---|
| `wrapp` | the wrapp (runs on the visitor's own Claude) | `<slug>.wrapp.sh` / `<slug>.sameep.ai` | **usage** — Spotify-pool rev-share | compute (fund your own tokens) |
| `product` | the app / SaaS | `<slug>.app` | **sales** — subscription or one-off | compute + a payments lane |

Both are *software*. The picker doesn't ask "is this software" — it asks **"who pays for the compute?"**
That single question is the whole fork:

- **USAGE (wrapp):** the visitor brings their own Claude. You never charge the runner. You earn a share
  of the Pro-subscription pool, weighted by how much your wrapp gets used — a song on Spotify.
- **SALES (product):** you host the compute (or sell access to a workflow), and you charge — a
  subscription or a one-off. This needs a **payments lane** before a dollar is real.

Everything downstream of this — decisions, the four domains, the task compiler, the CEO, the autonomy
ticker, the daemon runner — is byte-identical to every other kind. *A mode is an answer to one question,
not a second app.*

### Decisions that seed a software venture
`one job` (what the app does, in one sentence) · `who for` (the wedge user) · `wedge feature` (the single
thing worth shipping first) · `pricing shape` (**usage vs sales** — this is the mode fork, asked as a
decision) · `name / brand` (from CREST/brandbrain). The task compiler is a pure function of these; tasks
are derived, never invented.

---

## 2. The two economic modes, in depth

### 2.1 USAGE — the wrapp shape

The wrapp is **free to run**. A visitor lands on `<slug>.wrapp.sh`, connects their own Claude through
Switchboard, and the wrapp runs on *their* compute. The founder holds no key, pays for no inference on
the visitor's runs, and never sees the visitor's data — the broker brokers everything. This is the
inversion that makes usage honest: **there is no one to charge, so there is no invoice to fake.**

Revenue is the Spotify model, restated as an invariant:

```
pro members  → one subscription  → a pool
your payout  = pool  ×  (your wrapp's metered uses / all wrapps' metered uses)
```

- The runner is **never** charged. A "connect to run" that billed the visitor would break the whole shape.
- `metrics.uses` and `metrics.payout` are `null` — literally "not connected" — until a **usage meter**
  (a `usage`/analytics connector: Plausible, PostHog, Umami, or the platform's own meter) is wired and
  reports. Connecting the meter is an **approve-class move** (`lane: "usage"`), gated by the daemon like
  every other outbound act.
- Until then the money surface reads *"the wrapp earns like a song on Spotify… you're paid from the pool
  by how much your wrapp gets used"* — the model, described, with **no fabricated play count or payout.**

The product card for a usage venture shows no separate priced offer: **the shipped wrapp *is* the
product.** The only money action is "Connect usage meter."

### 2.2 SALES — subscription or one-off

The founder hosts the compute (or gates a workflow) and charges. This is a digital `product`: it has a
**merchant-of-record** (Switchboard carries tax/returns/compliance) but **no supply spine** — software
sources nothing, co-packs nothing, ships nothing. (Guard: the MOQ/fulfilment card must never render for a
software venture — that was a real bug that once put a "Shared MOQ pool" on a software product.)

- The engine drafts a **priced offer** (`co.product = { name, price, blurb, drafted }`) from the context
  and the chosen angle — reversible, nothing charged.
- `metrics.revenue` stays `null` until a **payments lane** (Stripe/Paddle) is `connected` *and* a real
  sale lands. Setting up payments is an approve-class move (`lane: "payments"`); the engine **never
  charges on its own**, and the revenue line fills only from a connector-reported sale.
- Margin (price − fees) shows only once the fee side is real; there is no COGS for pure software.

### 2.3 How the founder picks — and switches

The mode is **a decision**, `pricing shape`, asked in the seed path with the house pattern: options with
exactly one ⭐ recommended.

| Option | ⭐ | When it's recommended |
|---|---|---|
| **Usage (wrapp)** | ⭐ default for a single-purpose tool | zero-friction distribution, no billing to build, the founder wants reach and the pool. |
| **Subscription** | — | a durable workflow users return to; recurring value; founder will host compute. |
| **One-off** | — | a discrete deliverable or unlock; no ongoing relationship needed. |

Switching mode after decisions lock is **not silent** (master §11): it requires confirm and re-derives
the task set — usage↔sales changes the deployable's shape (a wrapp entry screen vs a hosted app + a
checkout), the money lane (usage meter vs payments), and the milestone ladder. Decisions that still apply
(name, one job, wedge) carry over; the money-path tasks are rebuilt. See §7 (edge: usage-vs-sales switch).

### 2.4 The honest revenue rule (both modes)

Economics is always in exactly one of three states (master §4.5): `not-connected` (no meter/Stripe) ·
`connected, zero` (real, and honestly zero) · `earning`. **There is no fourth "estimated revenue" state.**
A usage projection or a pipeline guess, if ever shown, lives in a clearly-labelled *projected* channel and
never touches the revenue figure. Revenue "stays not connected" until a real meter or Stripe reports —
this is enforced structurally: `metrics.*` initialize to `null`, and only a `runMove` whose `callTool`
returned success flips them to a real `0`.

---

## 3. The loop, compiled as tasks

The software growth loop is **build → ship → traffic → activation → learn → build**, and the subdomain
is the distribution. Compiled from the locked decisions, each task carries its **class** (reversible vs
outbound) and its **mode** (`auto | approve | manual` — master §9):

| # | Task | Class | Mode | What it does | Boundary |
|---|---|---|---|---|---|
| 1 | **Spec the wedge** | reversible | `auto` | Turn the decisions into a one-screen spec of the single feature worth shipping first. | on-device only |
| 2 | **Generate the app** | reversible | `auto` | Write the wrapp/app from the wedge + context; preview **locally**, nothing public. | on-device only |
| 3 | **Deploy to subdomain** | **outbound** | **`approve`** | Push the previewed build to `<slug>.wrapp.sh`. Stages until a **deploy lane** is connected + you tap go. | needs `site` lane |
| 4 | **Landing page** | reversible | `auto` | Generate the launch page (or, for a wrapp, the entry screen) from context + voice + angle; preview local. Publishing it is itself an approve-move. | draft on-device; publish needs `site` lane |
| 5 | **Instrument activation** | **outbound** | **`approve`** | Wire the usage/analytics meter so a *real* activated-user signal exists. | needs `usage` lane |
| 6 | **First-user outreach** | reversible→outbound | draft `auto` / **send `approve`** | Draft cold emails/DMs to the first users (reversible); **sending** stages for your go and needs the email lane. | draft on-device; send needs `inbox` lane |
| 7 | **Iterate from usage** | reversible | `auto` | Read the real activation/usage signal, draft the next wedge/release; re-enters at #1. | reads real data; drafts only |

Two rules make this honest and un-fakeable:

- **Everything reversible (spec, generate, draft landing, draft outreach, iterate) the autonomy ticker
  may do itself,** budget-permitting — it fills a review queue while you sleep.
- **Everything outbound (deploy, instrument, send) is approve-only,** and only sendable once its lane is
  `connected`. No lane ⇒ the move **stages honestly** ("ready — connect a deploy lane to ship").

The loop is a cycle, not a line: #7 feeds #1. The living log shows each beat as it lands, with who
cleared it.

---

## 4. The token game / compute-runway

Software is the kind whose scarce resource is **compute you fund yourself** — so the runway *is* the game.

### 4.1 The mechanics (all real, none fabricated)

- **Fuel** = the broker's real token budget (`co.tokens = { spent, budget: 2_000_000, by, estimated }`).
  The fuel gauge is `spent / budget` — a measurement from `relay.complete().usage`, marked `estimated`
  only when the backend didn't report usage (an estimate labelled an estimate is honest; an estimate shown
  as a measurement is the exact lie this surface avoids).
- **Level** = the count of *real* milestones cleared, named `Seed → Sprout → Traction → Scaling → Live`:

  ```
  1. Company decided · N/N        done when every decision is chosen/inherited   (real state)
  2. Ship the wrapp               done when co.site.live                          (real deploy event)
  3. First user                   done when metrics.uses > 0    · LOCKED until a meter is connected
  4. First rev-share $            done when metrics.payout > 0   · LOCKED until a meter reports
  ```

  The **build** milestones (1–2) flip on real state the engine can see. The **money** milestones (3–4)
  stay `locked` ("needs a meter") and can *only* be lit by a real usage-meter event. **The level never
  rises on a fabricated user or dollar.** This is the compute-runway of company-of-record made playable,
  without ever letting the game lie.

- **Feeding it** opens a runway dial (Trickle / Steady / Push) — pour a trickle and it moves one beat at a
  time; pour a tank and it works ahead of you. Framed as **fuel, not a subscription and not an
  investment**: "runway is capacity to work on your own Claude — not a subscription, no key ever leaves
  you. No promises, no returns."

### 4.2 Budget guard on autonomy

Autonomy is always budget-guarded. On each tick, before any work:

```
if (co.tokens.spent >= co.tokens.budget) {
  co.auto.on = false;                 // drop out of the loop
  log("autopilot paused — out of runway this week. Fund more to keep it moving.");
  // the in-flight artifact is SAVED, not lost
}
```

Hitting the cap drops autonomy `drafting → off` and logs *why*; the human can re-fuel to resume. The cap
governs **drafts only** — sends were never on the autonomy line, so exhausting the budget can never strand
a half-sent outbound.

---

## 5. Deploy pipeline

"Deploy to subdomain" is one approve-move, but it has two halves — one draftable everywhere, one gated.

### 5.1 What's draftable with no lane at all

- **Generate the build** (the wrapp/app code, or the landing HTML) — a `relay.complete` that returns a
  self-contained artifact, previewed **locally** in the cockpit. Fully reversible; the ticker does it.
- **The target subdomain** is computed (`kindCfg.host(slugOf(co.name))`) and shown as where it *will*
  live — a plan, not a claim. `co.site.live` stays `false`.

So a founder with zero connectors gets the entire build previewed and a subdomain reserved-in-spirit — the
product is a complete glass-box builder before a single lane exists.

### 5.2 What "deploy" concretely needs — a deploy connector

Publishing needs a **`site` deploy lane** (`/deploy|publish|pages|vercel|netlify/`, or the platform's own
`wrapp.sh` publisher). The move:

```
runMove(co, { mode:"approve", lane:"site", n:"Ship <name> to <host>", args:{ html, host } })
  → relay.callTool(deployTool, args)     // the daemon consent gate fires HERE
  → on success: co.site.live = true; co.site.url = res.url || "https://" + host
```

- No `site` lane ⇒ the deploy **stages**: "ready to ship — connect a deploy lane." Never a dead end.
- The consent gate is the daemon's per-action check — the same gate every send passes through. A deploy is
  outbound (it faces the public), so it is *structurally* the same class as sending an email or charging a
  card.
- Deploy **failure** (lane errors) surfaces in the log with a retry; the ship task returns to `staged`,
  not `done`; `co.site.live` stays `false`. The build is never lost.

---

## 6. Activation instrumentation

The software venture's "first real milestone" is **the first activated user** — and it must be *real*.

- **What counts:** a value reported by a connected usage/analytics meter — a run, a completed core action,
  or a returning session, depending on what the meter exposes. `metrics.uses` moving from `null` to a
  real positive integer.
- **How it's wired:** task #5, "Instrument activation," is an approve-move on the `usage` lane. Until it's
  connected, `metrics.uses == null` and the "First user" milestone renders **`locked · needs a meter`** —
  not zero, *unknown*.
- **Honest zero:** once the meter is connected and reports zero, the milestone shows a real, proud **zero**
  ("connected, zero") — never rounded up to a projection. `connected-zero` is a first-class, honest state;
  it means "we are truly measuring, and no one has activated yet," which is different information from
  "we have no meter."
- **The celebration:** the first activated user is an *earned* oomph moment (master §12) precisely because
  it's a real connector event. The cockpit celebrates it because it cannot be fabricated.

The same discipline governs traffic (`metrics.traffic`) and, for a sales venture, revenue: real from a
connector, or `null`/"not connected." **No surface ever shows a metric a connector didn't report.**

---

## 7. Cockpit mapping

The four domains (master §5.3) are the same four for software; here is what fills each column:

| Domain | Fills with (software) |
|---|---|
| **Company** | Identity + one-line thesis · the live site line (kind-aware: a wrapp **ships**, a product **builds a landing page**) · the two real numbers (uses/payout **or** revenue/traffic — `null` = "not connected") · the **Fund runway** control. The running log lives here with the CEO chat docked at its foot. |
| **Operations** | The **deployable card** (app/wrapp preview) · the derived **task list** with status tabs and "Run now" · **releases** (ship history, each a real deploy event) · the decision slate. This is where the build→ship half of the loop is worked. |
| **Growth** | The **landing/entry-screen** preview · launch **social** with an auto-post toggle (draft `auto`, post `approve`) · **outreach**/inbox (draft `auto`, send `approve`) · any ads preview. The traffic→activation half. |
| **Strategy** | **Economics** readout (real-or-not-connected) · the **autonomy** master switch + per-lane allowances + budget cap · the **token level** (`Seed…Live`) and fuel gauge · thesis and bets · the CEO's running plan. The learn half. |

The mapping is deliberate: **Operations = the app + releases/tasks; Growth = landing/content/outreach;
Strategy = economics + autonomy + the token level.** The middle card in the Company column resolves by
kind — a usage wrapp shows the **token game (`gameCard`)**; a sales product shows the **merchant-of-record**
card; neither ever shows a supply spine (software has nothing to ship).

---

## 8. Edge cases (≥12)

1. **Zero users, honest state** — `metrics.uses` is `null` before a meter, a real `0` after. The "First
   user" milestone reads `locked · needs a meter` (unknown) or a proud connected **zero** — never a
   projected count, never rounded up.
2. **No payments lane (sales mode)** — the priced offer drafts and previews; "Set up payments" stages;
   `metrics.revenue` stays `null`. Fully usable as a glass-box planner; the money move says which lane it
   waits on.
3. **No deploy lane** — build + landing preview locally; "Ship" stages ("connect a deploy lane"). The
   subdomain is shown as *where it will live*, `co.site.live = false`.
4. **Usage-vs-sales switch after lock** — not silent: confirm required, task set re-derived, money-path
   tasks rebuilt (usage meter ↔ payments), milestone ladder swapped. Name/one-job/wedge carry over.
5. **Deploy fails** — surfaced in the log with a retry; ship task returns to `staged` not `done`;
   `co.site.live` stays `false`; the built artifact is preserved.
6. **App regenerated** — a re-generate replaces the local preview only; it does **not** touch the live
   subdomain. Shipping the new build is a fresh approve-move (a new release). The old live site stays up
   until a successful redeploy.
7. **Free-runner abuse (usage)** — the runner pays their *own* compute, so heavy use costs the founder
   nothing and can't drain the founder's runway; the meter counts real uses. Abuse is a broker-rate-limit
   concern, not a revenue or cost leak on the founder's side — the shape is structurally abuse-resistant.
8. **Budget exhausted mid-build** — autonomy drops `drafting → off`, logs "out of runway," the in-flight
   draft is saved. Re-fuel to resume. No send can be stranded (sends aren't on the autonomy line).
9. **Meter connected, reports zero** — honest `connected, zero`. The milestone and traffic show a real
   zero; the level does **not** advance past "Shipped." This is correct, not a failure.
10. **Usage payout pool is tiny / zero** — payout is `pool × share`; if the pool is small, payout is a
    real small (or zero) number the meter/broker reports. Never inflated, never promised.
11. **Deploy succeeds but activation never wired** — the app is live (`co.site.live`), yet uses stay
    `null`. The cockpit is honest: shipped, but blind — surfaces "instrument activation" as the next task
    so the founder isn't flying without a signal.
12. **Two software ventures share a deploy lane** — the connector is per-origin isolated; shipping venture
    A never touches B.
13. **Daemon offline** — cockpit still builds and drafts; the overnight runner is marked down by a banner;
    no autonomous ticks fire until it's back.
14. **CEO proposes a "ship now"** — the CEO's output is always a *proposed* move on the board, never an
    executed deploy. It becomes an approve-move; the human still taps go.
15. **Estimate leaks into the fuel gauge** — when `usage` isn't reported, spend is estimated and the token
    surface marks itself `estimated`; the gauge never presents an estimate as a measurement.

---

## 9. Software-specific routines

Routines are the daemon's temporal spine (master §7); these are the software kind's, each honest about its
boundary in its own header.

| Routine | Cadence | What it does | Boundary |
|---|---|---|---|
| **Usage digest** | daily | Reads the real meter: uses, new activations, returning sessions, payout movement since yesterday; drafts a one-line "what your users did." | read-only; **zero if the meter says zero**; drafts, sends nothing |
| **Activation watch** | on-change | Fires the *earned* celebration the moment `metrics.uses` crosses 0 from a real meter event; nudges "instrument activation" if the app is live but blind. | reacts to real connector events only; never fabricates the crossing |
| **Ship cadence** | weekly | Reviews usage → drafts the next wedge/release and stages the deploy; keeps a steady build→ship rhythm. | drafts the release + **stages** the deploy; the ship itself waits for your go + the deploy lane |
| **Autonomy ticker** | ~9s while `drafting` | Advances the next reversible beat of the loop (spec → generate → draft landing → draft outreach → iterate); fills the review queue. | reversible only, budget-guarded; drops to `off` at the cap |
| **Runway watch** | continuous | Warns before the fuel budget runs out; offers a top-up before the ticker stalls mid-beat. | alert + fund prompt only |

The line holds across every one of them: **reads your venture, then drafts — ships nothing without a lane
and your go, and never a number a connector didn't report.**

---

## 10. Honest gaps (software-specific)

- A **real deploy** to a live subdomain needs the deploy connector wired against the platform's `wrapp.sh`
  publisher — the pipeline is specced and staged, but a green end-to-end ship needs that lane live.
- **Usage-pool payout** is real in shape (pool × metered share) but the pool accounting and the meter → 
  broker → payout wiring is infra, not UI; until it reports, payout is honestly `null`.
- **Live activation measurement** depends on a connected meter; on a dev Mac with no meter, "First user"
  correctly reads `locked`, not a demo number.

The whole spec, in one line: **fund it with your own tokens, watch a real level rise, ship to a subdomain
with one tap — and never let the game, the money, or the metric tell you something a connector didn't.**
