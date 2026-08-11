# Company OS — how a company runs on Autopilot

**One idea:** a company is a small set of **decisions** you own, feeding a daily **loop** that produces
**moves** — and every move is sorted by one question: *can this be undone?* If yes, **God's hands do it
while you sleep**. If no, it waits at a gate for one tap from you. You wake up to work already made and
a short list of calls only you can make.

This is the model behind the Autopilot cockpit. It's deliberately small — three sectors, one loop, three
move-classes — because the point isn't to simulate a company, it's to *run* one honestly.

---

## 1. A company has three layers

```
   IDENTITY  ──────►  LOOP  ──────►  GROWTH
   (you own)        (runs daily)     (measured, never faked)
   decisions         moves            real metrics or an honest —
```

### 1.1 Identity — the decisions you own
A company is defined by **4 decisions**. You lock them; everything downstream is drafted *from* them, so
changing one visibly re-drafts the rest. The machine may *recommend* (draft) a decision; only your click
*locks* it. This is the one hard rule: **draft is the machine's, lock is yours.**

The four decisions are sector-shaped:

| | **Software** | **Brand** | **Agency** |
|---|---|---|---|
| **1. Offer** | What the product does | The hero product | The service |
| **2. Who** | ICP (who it's for) | The audience | Who you serve |
| **3. Edge** | The wedge (sharp use case) | The voice + look | Why you, not them (positioning) |
| **4. Model** | Pricing model | Price + drop cadence | Engagement + rate |

### 1.2 Loop — the moves
Each day the loop reads Identity and drafts the **3–5 highest-leverage moves**. Every move is a real
unit of work with a named output — a landing draft, three posts, a proposal, a changelog. Moves are the
whole product; §2 is how they're classified and run.

### 1.3 Growth — the metrics
Revenue, traffic, signups. Shown **only when a connector actually provides them**. No connector → an
honest "— not connected," never a placeholder number. (The one number always honest is *tokens spent* —
we meter it exactly, so background work is never invisible.)

---

## 2. The autonomy gradient — the heart of it

Every move is sorted into one of three lanes by **reversibility**. This gradient *is* the safety model:
the more a move can be undone, the more autonomously it runs.

```
  ◀── more autonomous ──────────────────────────── more your call ──▶

  ┌─ AUTOPILOT ────────┐   ┌─ GATE ─────────────┐   ┌─ FOUNDER ──────────┐
  │ reversible         │   │ irreversible /     │   │ judgment /         │
  │ God's hands do it  │   │ outward / costs $  │   │ relationship / legal│
  │ → produces a draft │   │ → waits for 1 tap  │   │ → a decision, not a │
  │   or artifact      │   │   from you         │   │   task              │
  └────────────────────┘   └────────────────────┘   └────────────────────┘
     drafts while you        approve to act           only you can make
     sleep                                             this call
```

**AUTOPILOT (reversible → God executes).** The move produces something that changes nothing in the
world: copy, creative, a spec, a draft page, a drafted email, a research memo. God's hands run the
matching wrapp and file the artifact into the company's Bank. You wake up and it's *made*. Undoing it is
deleting a draft.

**GATE (irreversible → you approve).** Anything that leaves the machine or spends money: publish, send,
deploy, charge, sign, run ads. God prepares it to the last inch — the post is written, the email drafted,
the deploy staged — and then **stops**. One tap sends it. No headless loop can forge that tap.

**FOUNDER (judgment → you decide).** Hiring, pricing strategy, a legal call, a relationship. Not a task
God stages — a *decision* surfaced with the context to make it. God never touches these.

**The send line never moves.** No amount of autonomy promotes a GATE move to AUTOPILOT. Reversibility is
a property of the move, decided once, in the catalog — not a setting.

## 2b. The GATE line — review, approve, send (and full auto)

A GATE move isn't a bare "approve?" prompt. God **prepares the exact content that would go out** — the
launch post, the email, the DM — as a reversible draft, and stages it with that content as a **preview**.
So the founder reviews the *real thing*, not a description, before anything is sent.

Two autonomy modes, chosen **per company** (`~/.relay/autopilot.json → companies.<id>.auto`):

- **Assisted (default).** Each GATE move is staged with its preview. The founder expands it ("review
  what it'll send"), then **Approve & send** fires the outward action — *through a connected sender and
  the daemon's consent gate*. No sender connected for that channel → the button is honestly **Connect to
  send**, routing to the connector flow. Nothing goes out on its own.
- **Full auto.** The founder has **pre-authorized** sends for this company (a standing grant). GATE moves
  dispatch automatically — same connector + gate path, just without the per-move tap. Every send is
  still **audited and stoppable** (the routines master switch, the audit trail). Full auto requires both
  the `auto` flag *and* a connected sender; absent either, moves stay staged rather than fail silently.

The dispatch itself is the [[God's Hands]] pattern in reverse: an approved GATE move calls its named
wrapp/connector action (publish/send/charge) through the gate. The daemon never invents a sender — if
the channel has no connector, the move waits, honestly, until one is connected. **We never fire an
irreversible outward action without either a tap or a standing auto grant, and always through a real,
audited connector.**

---

## 3. God's hands — how a reversible move actually executes

A reversible move names a **wrapp + action** it can be produced by. Execution is the [[God's Hands]]
pattern: the daemon (or God) calls that wrapp's action through the Switchboard connector, the wrapp does
the real work on *your* Claude, and the output lands as an artifact on the company. The move flips
`drafting → done` with the artifact attached. Nothing about this can send or charge — the wrapp's own
outward actions are themselves GATE-class and never auto-fire.

**How the routine picks the wrapp (live).** The routine carries an ordered **move→wrapp catalog**
(`packages/sidekick/src/routines/autopilot.ts` `CATALOG`): each tick, the first reversible move is
matched by intent to a real wrapp action and run on your own Claude via the Switchboard connector
(`broker.routineInvoke` → `mcp__…__wrapp__*`, audited as `routine@autopilot`). Its structured result
is rendered into the artifact — the same output as if you'd opened that wrapp by hand. If no wrapp
fits the move, or the named wrapp isn't connected, the routine falls back to a generic draft so the
tick still lands. **Bound today:** foundational moves → *ideabrain · brand brief*; operational moves
(voice/angle/channel/content/growth) → *autopilot · operating slate*. **Catalogued, not yet bound:**
redline/adpulse want a page's HTML or an ads CSV the routine doesn't yet carry — they wait on a
source artifact. Only ever DRAFT-class wrapp actions are bound; outward actions stay in the GATE lane.

Per-sector move catalog (v1 — the reversible ones God runs, and the gated ones it stages):

**Software**
- ⚙ *Draft the landing copy* → brandbrain / a copy wrapp · **reversible**
- ⚙ *Draft the changelog* → a writer wrapp · **reversible**
- ⚙ *Draft a feature spec* → a writer wrapp · **reversible**
- ✎ *Draft outreach to 5 design partners* → a writer wrapp · **reversible** (drafting) → **gate** (send)
- ▲ *Deploy the site* · **gate** · ▲ *Charge a customer* · **gate**

**Brand**
- ⚙ *Draft this week's 3 posts* → a content wrapp · **reversible**
- ⚙ *Generate 3 ad creatives* → Prism / AdForge · **reversible**
- ⚙ *Draft the next drop's page + price* → a copy wrapp · **reversible**
- ▲ *Publish the posts* · **gate** · ▲ *Run the ad* · **gate** · ▲ *Open the pre-order* · **gate**

**Agency**
- ⚙ *Draft a proposal for <lead>* → a doc wrapp · **reversible**
- ⚙ *Draft 5 cold outreach messages* → a writer wrapp · **reversible**
- ⚙ *Draft a case study* → a writer wrapp · **reversible**
- ▲ *Send the proposal* · **gate** · ▲ *Invoice the client* · **gate**

---

## 4. The daily loop (one tick)

```
  read Identity
     │
     ▼
  draft 3–5 moves ──► classify each (reversible / gate / founder)
     │
     ├─ reversible ─► God's hands run the wrapp ─► artifact filed ─► move: done
     ├─ gate       ─► prepare to the last inch ─► move: awaiting you
     └─ founder    ─► surface as a decision with context
     │
     ▼
  you wake to:  artifacts already made · a short approve-queue · a couple of real calls
```

The clock is the [[routines]] Run layer (already live). Autopilot is routine #1; while the master switch
is on, each tick advances every company whose own "Autopilot on" is set. Off by default; background token
spend is metered and visible.

---

## 5. States (the cockpit must render all of them)

| State | What you see |
|---|---|
| **Fresh company** | Identity has drafts, no locks → "Lock your 4 decisions to start." The board is empty with one CTA. Never a fake company. |
| **Running (autopilot on)** | Reversible moves flowing `drafting → done`; the heartbeat pulses; artifacts accruing. |
| **Awaiting you** | The GATE lane has N staged moves, each one tap from acting. The rail badge counts them. |
| **Paused (autopilot off)** | Everything frozen where it was; "Turn Autopilot on to resume." No ticks, no spend. |
| **Out of runway** | Token budget hit → the loop pauses itself and says so; no silent stop. |
| **No connector for a metric** | "— not connected," with a one-tap connect. Never a placeholder number. |
| **A move failed** | The move shows the real error + Retry; the loop keeps going; it escalates to Needs attention. |

---

## 6. What's built vs next

- **Built:** the Run layer / routines clock (routine #1 drafts the day's moves — [[routines]]); the
  cockpit UI (§ below); the move classifier; the portfolio view (many companies advancing at once);
  **reversible moves executed by real wrapps** (`routineInvoke` → the move→wrapp catalog above:
  ideabrain/operating-slate on your own Claude, generic-draft fallback); the **GATE dispatch path**
  (`routineDispatch` → resolve a sender for the move's channel → the write-consent card is the founder's
  tap, or a standing full-auto grant → send through a real connector + audit; no sender ⇒ an honest
  `no-sender`, staged, nothing leaves the machine). Full-auto is wired in the routine; every channel is
  `no-sender` today (no publisher/email connector connected), so nothing sends until one is.
- **Next:** the assisted approve-queue TAP surfaced in the cockpit (the cockpit is still a static
  prototype — wire it to the real portfolio/gate storage + call `routineDispatch`); more wrapp bindings
  as their cores are exposed (a page/CSV source for redline/adpulse); real metric connectors.

---

## 7. Cockpit UI — direction

The cockpit is a **wrapp** (it may go vibrant — chrome discipline is the OS's job, not a running
company's). Its signature is the **autonomy gradient board**: three lanes, left→right, showing exactly
how much the company does without you. Reversible moves visibly complete on their own; gated moves halt
at a seam with a seal you break with one tap. A live **heartbeat** marks each loop. Identity sits above
as four lockable decisions; growth sits beside as honest metrics. Sector is worn as a single hue + glyph,
never chrome. See `examples/autopilot/cockpit.html`.
