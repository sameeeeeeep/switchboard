# The Autonomous Company — Consumer Brand archetype

> Companion to **[AUTONOMOUS-COMPANY.md](AUTONOMOUS-COMPANY.md)**. That doc is the master; §2.3 is the seed.
> This is the definitive spec for `kind = brand` — the one archetype that ships real, physical goods.
> Everything here inherits the master's model, states, taxonomy and honest boundary; it only fills the
> three slots `resolveKind` forks (deployable, economics, host) with the concrete machinery of a
> product company: an **offer object**, a **supply spine**, a **merchant-of-record**, and a storefront.

The brand is the archetype where the moat is not software. A software-only rival can clone the cockpit,
the CEO chat, the autonomy ticker. It cannot clone **provable locks over real inventory, a real supply
spine, and a merchant-of-record** — because those are claims about the physical world that either
reconcile against a connector or don't exist. This doc specs exactly the surface a clone can't fake.

**The line, unchanged:** it drafts everything — the offer, the photography, the launch content, the ad
copy, the restock PO. It **sources nothing, charges nothing, ships nothing, restocks nothing** without
a connected lane **and** the human's go. And it never prints a revenue, margin, or inventory number it
didn't get from a connector or the human's own hand.

---

## 1. The offer object (product + price + COGS) and the SKU/drop model

The master engine already drafts a first offer (`genProduct` → `{name, price, blurb}`). For a brand that
is the seed of a richer object. The offer is not one product — it is a **line of SKUs** grouped into
**drops**, each SKU carrying its own cost truth so margin can be *computed, never guessed*.

### 1.1 The Offer object

```
Offer                          // the product line — one per venture, drafted from context
├─ line          name, story, the shared brand thread across SKUs
├─ skus[]        the actual buyable units
└─ drops[]       time-boxed releases that bundle a subset of SKUs at a moment
```

```
SKU
├─ id            stable slug (never a ":" — it's a filename; see storage-key rule)
├─ name          "Merino Beanie — Charcoal"
├─ variant       size / colour / option axes
├─ price         the listed price (USD) — drafted, human-editable, reversible
├─ cogs          landed unit cost — NULL until the human enters it. Never drafted, never guessed.
├─ fees          { payment: %+fixed, platform: %, shipping: est }  — from the connectors, or null
├─ supply        → the SupplyLine for this SKU (source/make, lead time, MOQ)   [see §2]
├─ inventory     → InventoryTruth (on-hand, committed, incoming)               [see §2]
└─ status        draft → listed → live → sold-out → retired
```

```
Drop
├─ id, name      "Winter Capsule", "Founders' 100"
├─ skus[]        the subset released together
├─ window        opens-at, closes-at (or "until sold out")
├─ cap           optional hard unit cap (a limited drop) — the scarcity is real, tied to inventory
└─ state         planned → staged → live → sold-out → closed
```

### 1.2 Price is drafted; COGS is entered; margin is computed

Three numbers, three different sources of truth, and the product must never blur them:

| Number | Source | Class | If missing |
|---|---|---|---|
| **Price** | drafted from context + angle (reversible), human overrides | reversible draft | falls back to the drafted number, marked draft |
| **COGS** | **the human enters it** — the platform never invents a unit cost | manual input | **margin is "unknown"** — honest, not zero, not estimated |
| **Fees** | the payments + storefront connectors report them; else null | real-or-not-connected | excluded from margin, margin marked "pre-fee" |

**Margin is a pure function, shown only once COGS exists:**

```
margin(sku)  =  price − cogs − fees          // only when cogs != null
```

- `cogs == null` → the margin slot reads **"Margin unknown — enter unit cost"** with a single input. It
  does **not** show $0, does **not** show a percentage, does **not** guess from category. A fabricated
  margin is the exact lie this surface exists to prevent (mirrors the master's revenue rule in §4.5).
- `cogs` set, `fees == null` (no payments/storefront connector) → margin shows as **"pre-fee"** —
  `price − cogs` — clearly labelled that the connector fees aren't in yet.
- `cogs` and `fees` both real → the true unit margin, and only then does the drop-level "contribution"
  roll-up appear (unit margin × units, again real-only).

This is the brand's version of the master invariant: **every economic figure is real, entered-by-human,
or explicitly not-yet-known — never modelled.**

### 1.3 Compiled offer tasks (extends the master's §2.3 list)

`define the offer` (draft SKUs + prices, reversible) → `enter unit costs` (manual, unlocks margin) →
`supply plan` [§2] → `product photography / creative` (reversible) → `list on storefront` (approve, §3) →
`plan the drop` (reversible) → `launch content` (reversible draft; publish is approve) → `open the drop`
(approve — the storefront goes live) → `fulfil` [§2] → `restock` (approve, §2).

---

## 2. The SUPPLY SPINE — the real-world moat, specced concretely

This is the part no software-only competitor has. A brand that *cannot see its own inventory* cannot
honestly say "in stock", cannot honestly open a drop, cannot honestly run an ad. The supply spine is the
set of objects that make inventory a **provable fact reconciled against a connector**, not a claim.

### 2.1 Source vs make

Every SKU has a **SupplyLine** — how the unit comes into existence and what it costs to make one more:

```
SupplyLine
├─ mode          "source" (buy finished units from a supplier) | "make" (assemble from inputs)
├─ supplier      name, contact, lead-time-days, MOQ (min order qty), unit-cost → feeds SKU.cogs
├─ inputs[]      (make mode) bill-of-materials: each input's own cost + on-hand
├─ leadTime      days from PO to received — drives the reorder point
└─ state         draft → supplier-chosen → PO-drafted → PO-placed(approve) → in-transit → received
```

- **Source mode** is the common D2C case (print-on-demand, wholesale, contract manufacturer). `unit-cost`
  from the supplier is what the human enters as `SKU.cogs`. The platform can *draft* a supplier shortlist
  and a PO, but placing it is an approve-move.
- **Make mode** rolls COGS up from a bill of materials — each input's cost + on-hand. A make SKU can be
  *input-blocked* (can't build more units until an input restocks), which is a distinct state from
  finished-goods stock-out and surfaces differently.

The platform drafts the supply plan (reversible). It never contacts a supplier, never places a PO, never
commits spend on its own.

### 2.2 Inventory truth — reconciled, never asserted

```
InventoryTruth (per SKU, per location)
├─ onHand        units physically available to ship        ← from storefront/3PL connector, or human count
├─ committed     units in unfulfilled paid orders          ← from the storefront connector
├─ available     onHand − committed  (derived; can't be faked)
├─ incoming      units on an open PO with an ETA           ← from the SupplyLine's PO
├─ source        "connector:shopify" | "connector:3pl" | "manual-count" | "unknown"
└─ asOf          timestamp of the last reconcile
```

- `source == "unknown"` (no storefront/3PL connector, no manual count) → inventory reads **"not
  tracked"**. The product does **not** invent a stock number. Every stock-gated action (open drop, run
  ad, approve launch content) then says *which* connector or count it needs — never blocks silently, never
  guesses.
- `available` is always **derived** (`onHand − committed`) so overselling is structurally visible: when
  `committed > onHand`, the SKU is **oversold** and the loop refuses to advance demand [§7].
- Reconcile cadence: the **inventory watch** routine [§8] re-reads the connector on a beat and on every
  order webhook, stamping `asOf`. A stale `asOf` (connector unreachable) is shown as stale, not hidden.

### 2.3 Reorder point + restock as an approve-move gated on cash + inventory

The reorder point is the one piece of the spine the platform computes and *watches* continuously:

```
reorderPoint(sku)  =  dailyVelocity × SupplyLine.leadTime  +  safetyStock
restockNeeded(sku) =  available <= reorderPoint  (and no open incoming PO already covering it)
```

- `dailyVelocity` comes from **real paid-order history** (the storefront connector). No orders yet →
  velocity is unknown → reorder point is unknown → the watch stays quiet rather than crying wolf on
  invented demand.
- When `restockNeeded`, the loop **drafts a purchase order** (reversible): supplier, quantity (rounded up
  to MOQ), unit cost, landed total, ETA. That draft sits as a **staged approve-move**.

**Restock is double-gated** — it is the sharpest expression of the honest boundary in the brand kind:

```
approve "Restock 200 × Merino Beanie — $1,400 to Acme Knits"
  gate 1 (inventory):  a real restockNeeded signal from real velocity     — else it's not offered
  gate 2 (cash):       cash-on-hand ≥ landed PO total                      — else it BLOCKS [§7]
  gate 3 (lane):       a supplier/payments lane is connected               — else it STAGES honestly
  → then, and only then, the human taps go and a real PO is placed via callTool (daemon consent)
```

Cash-on-hand is itself real-or-not-connected: it comes from the funded restock budget the human added
(the "fund runway" gesture, master §6) plus real revenue the storefront reported, minus placed POs.
Never a projected cash number.

---

## 3. Merchant-of-Record setup + the storefront connector

### 3.1 Merchant-of-Record (approve-gated)

Selling physical goods means collecting money, remitting sales tax/VAT, and standing behind chargebacks.
The **Merchant-of-Record (MoR)** is who is legally on the hook. This is a first-party moat piece: the lab
can be the MoR (Paddle-backed, per the master's backend-as-connector doctrine) so a founder ships without
forming an entity — something a pure-software cockpit can't offer.

```
MoR
├─ mode          "self" (founder's own entity + Stripe) | "platform" (the lab as MoR, Paddle)
├─ state         absent → configured → active
├─ taxRemit      who remits sales tax / VAT   (platform mode = the lab; self mode = the founder)
└─ payouts       schedule + destination  (real, from the connector)
```

- MoR setup is **approve-class**: it's a standing financial arrangement (master's "Explicit permission"
  list — creating standing configuration). The platform drafts the setup, explains both modes and their
  blast radius (who owes the tax, who eats chargebacks), and waits for the human's go.
- Until `MoR.state == active`, the storefront can be **built and staged** but the drop **cannot open for
  real orders** — the "open the drop" approve-move points at MoR as the lane it needs.

### 3.2 The storefront connector (Shopify) — what's real vs draft

The storefront is the deployable for a brand (master's `resolveKind` "Deployable" slot). Shopify is the
first connector; the split between draft and real is absolute:

| Thing | Draft (reversible, no lane) | Real (approve + connected Shopify) |
|---|---|---|
| **Store & theme** | previewed from a description (get-new-store-previews) | a real store exists after the human signs up through the preview link |
| **Products / SKUs** | drafted locally as Offer objects | created on Shopify via connector (create-product) |
| **Prices** | drafted, editable | pushed to the live listing (update-product) |
| **Inventory** | "not tracked" | read from Shopify (get-inventory-levels) → InventoryTruth |
| **Drop open** | staged | listing goes live / discount opens (approve-move) |
| **Orders** | none | real paid orders (list-orders) → revenue + committed inventory |
| **Revenue** | "— not connected" | sum of paid orders, real (§5) |

Nothing about the storefront is asserted as live until `listTools` reports a connected Shopify tool for
this origin. Draft SKUs, a drafted store preview, a planned drop — all fully usable as a glass-box plan
with zero connection, every real step labelled with the lane it's waiting on. (Same pattern as the master
§11 "no connectors at all" — never a dead end.)

---

## 4. The growth loop as compiled tasks: drop → demand → fulfil → restock → repeat

The brand's growth loop (master §2.3) compiles to a concrete, repeating task set. Every task carries its
**reversibility** and its **`auto | approve | manual` mode** — the taxonomy that makes "autonomous"
honest (master §9). The compiler is a pure function of the offer + inventory + connector state; tasks are
derived, never hand-authored.

| # | Task | Reversible? | Mode | Gate / lane | Notes |
|---|---|---|---|---|---|
| 1 | Shape the offer (SKUs + prices) | reversible | **auto** | — | drafts from context + angle |
| 2 | Enter unit costs (COGS) | — (human input) | **manual** | — | unlocks margin; nothing computes until it's in |
| 3 | Draft the supply plan | reversible | **auto** | — | supplier shortlist / BOM, lead times |
| 4 | Place the initial PO | irreversible spend | **approve** | supplier/payments + cash gate | real money leaves; double-gated like restock |
| 5 | Product photography / creative | reversible | **auto** | — | drafted assets, nothing published |
| 6 | List on storefront | outbound | **approve** | Shopify | pushes SKUs live |
| 7 | Set up Merchant-of-Record | standing config | **approve** | MoR lane | who remits tax / eats chargebacks |
| 8 | Plan the drop | reversible | **auto** | — | window, cap, which SKUs |
| 9 | Draft launch content | reversible | **auto** | — | posts/emails in the brand voice |
| 10 | **Open the drop** | outbound + inventory | **approve** | Shopify + MoR + **stock gate** | refuses if stock can't back it [§7] |
| 11 | Publish launch content | outbound | **approve** | social/email lane | the actual post/send |
| 12 | Run ads | irreversible spend | **approve** | ads lane + **margin gate** | refuses if margin unknown [§7] |
| 13 | Fulfil paid orders | outbound (ship) | **approve** | 3PL/shipping lane | decrements onHand; label-buy is real spend |
| 14 | Watch reorder point | reversible | **auto** | — | continuous; drafts a PO when `restockNeeded` |
| 15 | **Restock** | irreversible spend | **approve** | supplier + **cash + inventory gate** | double-gated [§2.3] |
| 16 | Weekly review / next drop | reversible | **auto** | — | drafts the next drop from what sold |

Reversible rows (1,3,5,8,9,14,16) are exactly what the autonomy ticker may advance unattended. Every
outbound or spend row (4,6,7,10,11,12,13,15) is an approve-move that stages honestly with no lane and
fires a gated `callTool` with one. The loop closes: what sold in a drop drafts the next drop and the next
restock — repeat, forever, but every dollar and every shipment crossing the reversible line waits for a tap.

---

## 5. Economics states — real orders or "not connected", never projected

The brand inherits the master's economic state machine (§4.5) and adds inventory + cash truth. **No
projected revenue number ever exists.**

### 5.1 Revenue

```
revenue = Σ paid orders from the storefront connector      // real
        | "— not connected"                                 // no storefront lane
```

- `not-connected` — no Shopify lane → revenue slot reads "— not connected". Demand forecasts, drop
  interest, ad-projected sales all live in a **clearly-labelled *projected* channel** [§6 Growth] and
  **never touch the revenue figure** (master §4.5: never a fourth "estimated revenue" state).
- `connected, zero` — Shopify connected, no paid orders yet → shows a proud **real $0** (master edge:
  "show real zero proudly"). This is the honest pre-launch state.
- `earning` — real paid orders roll up. The **first paid order** is a genuine milestone celebration
  (master §12) precisely because it's a real connector event, impossible to fabricate.

### 5.2 Inventory states (per SKU)

`not-tracked` (no connector/count) · `in-stock` (`available > reorderPoint`) · `low` (`available ≤
reorderPoint`, restock drafted) · `oversold` (`committed > onHand` — demand outran stock) · `sold-out`
(`available == 0`) · `input-blocked` (make-mode, an input is out) · `incoming` (open PO with an ETA).

### 5.3 Cash states

`not-funded` (no restock budget, no revenue) · `funded` (human added cash-to-restock) · `earning-cash`
(real revenue net of placed POs) · `short` (a needed restock exceeds cash-on-hand — blocks the restock
approve-move [§7]). Cash is always real: funded amount + real revenue − placed POs. Never projected.

### 5.4 Margin (per SKU / per drop)

`unknown` (COGS not entered) · `pre-fee` (COGS in, fees not connected — `price − cogs`) · `real`
(COGS + connector fees — `price − cogs − fees`). Only `real` rolls up to a drop-level contribution figure.

---

## 6. Cockpit mapping (the four domains, brand-resolved)

The brand renders into the master's four fixed columns (§5.3). Same shape as every kind — you learn the
cockpit once — with brand-specific leaves.

### Company
Identity + thesis + the living operating log + CEO chat. CEO slash verbs are kind-aware (master §5.5):
brand gets **`/drop`** (plan a release) and **`/restock`** (draft a PO). The log is the spine — every
listing, order, shipment and PO shows who fired it and its consent state.

### Operations — storefront + supply/fulfilment + tasks
The heaviest column for a brand. Three stacked cards:
- **Storefront card** — the Shopify store preview (draft) or live status; per-SKU listing state.
- **Supply/fulfilment card** — the **inventory board**: each SKU's `available / committed / incoming`,
  its inventory state chip [§5.2], the reorder line, open POs with ETAs, and unfulfilled paid orders
  waiting on a shipping approve-move. This card *is* the supply spine made visible — the moat, on screen.
- **Tasks card** — the compiled task list [§4] with status tabs (pending / staged / done / blocked),
  "Run now" on reversible tasks, approve buttons on outbound ones.

### Growth — content / ads / social
Product photography and creative variants, launch content drafts, the social auto-post toggle, the ads
preview. **Demand projections live here, in the *projected* channel**, visually walled off from revenue —
"projected interest", never "projected revenue". A/B where the ads lane supports it.

### Strategy — economics + autonomy
- **Economics readout**: revenue (real-or-not-connected), per-SKU and per-drop margin (unknown/pre-fee/
  real), cash-on-hand + restock runway, the drop's real contribution once fees are in.
- **Autonomy**: the master switch + per-lane allowances + budget cap. The brand-specific hero metric is
  **paid orders** with its 7-point sparkline. Connector readout ⚡N/5 with each dark lane one-tap connect;
  the dark lanes for a brand are typically Shopify, payments/MoR, shipping/3PL, ads, email.

---

## 7. Edge cases (≥12)

1. **Stock-out blocks "approve launch content"** — a drop whose SKUs have `available == 0` (or can't
   cover the drop cap) cannot open. The "open the drop" and "publish launch content" moves **refuse and
   surface restock first**: "Can't launch what can't ship — restock or lower the cap." (master §11).
2. **Restock cash shortfall** — `restockNeeded` but `landed PO total > cash-on-hand`. The restock
   approve-move **blocks** in state `short`, shows the gap, and offers "fund runway" — never places a PO
   the cash can't cover. Autonomy can *draft* the PO; only the human, having funded, can approve it.
3. **Supplier delay** — an open PO's ETA slips (connector/manual update). `incoming` units keep their old
   ETA struck through; the reorder-point watch re-computes stock-out risk against the *new* lead time and
   may raise a "will stock out before restock lands" alert. Never hides the slip.
4. **COGS not entered** — margin is **"unknown"**, honestly. No $ , no %, no category guess. Ads [§7.8]
   and drop-contribution roll-ups stay disabled with "enter unit cost to see margin." (§1.2).
5. **Refund / return** — a real connector event: revenue decrements by the refund (real, not netted into
   a projection), and if the item is restockable, `onHand` increments on receipt. A return in transit is
   `incoming` from the customer, not yet available. Never a silent revenue figure.
6. **Oversell** — `committed > onHand` (two buyers, one unit; or a race). SKU enters `oversold`; the loop
   **refuses to advance demand** (pauses ads/launch for that SKU), flags the shortfall as a fulfilment
   problem, and drafts an expedited restock. The human decides refund-vs-backorder — the platform never
   silently cancels a paid order.
7. **Drop sells out** — `available == 0` mid-drop. Drop state → `sold-out`; the storefront honestly shows
   sold-out; running ads for it auto-pause (spending on unbuyable stock is waste); the loop drafts either
   a restock or the next drop. A *capped* limited drop selling out is success, not an error.
8. **Ads before margin is real** — running paid ads with `margin == unknown` is spending to sell at an
   unknown loss. The "run ads" approve-move is **gated on `margin != unknown`**: it stages with "enter
   COGS so we know these ads don't sell at a loss." Once COGS is in, it's approve-able (pre-fee margin is
   enough to clear the gate, with a note that connector fees will refine it).
9. **No payments lane** — the storefront can list and preview, but "open the drop" for real orders stages
   with "connect payments / set up MoR to take money." Revenue stays "— not connected." Fully usable as a
   glass-box plan meanwhile.
10. **No storefront connector at all** — inventory is `not-tracked`, revenue `not-connected`, every SKU a
    draft. The whole brand is a planner; each real step names its lane. Never dead-ends (master §11).
11. **Daemon offline** — cockpit works read/draft; the inventory watch and overnight restock-drafting
    routines are marked down in a banner; no PO or order state changes while it's unreachable — stale
    `asOf` is shown as stale, not refreshed with a guess.
12. **Two brands, same Shopify** — per-origin connector isolation (master §11): approving a listing or
    restock in brand A never touches brand B, even on the same Shopify account/lane.
13. **Inventory connector goes stale mid-tick** — `asOf` ages past threshold; inventory-gated moves
    (open drop, fulfil) **pause** rather than act on stale stock. "Inventory last synced 40m ago —
    reconnect to open the drop safely."
14. **Make-mode input stock-out** — a make SKU is `input-blocked`: finished-goods `available` may read 0
    but the fix is restocking an *input*, not the SKU. The loop drafts the input PO and labels the block
    distinctly so the human doesn't reorder the wrong thing.
15. **Price edited below COGS** — the human sets a price under the entered unit cost. Margin goes negative
    and is shown **in the red, truthfully** ("selling at −$3/unit") — never clamped to 0. A loss the
    founder chose is legitimate; a hidden one isn't.
16. **Kind switched away from brand** — switching a seeded brand to another kind requires confirm and
    re-derives tasks (master §11). The physical objects (SKUs, inventory, POs) can't carry to a
    non-physical kind and are archived, not silently dropped — the human is told what's being set aside.

---

## 8. Brand-specific routines

These extend the master's routine table (§7) with the temporal spine a physical company needs. Each is
honest about its boundary in its own header — reads and drafts, sends/spends nothing.

| Routine | Cadence | What it does | Boundary |
|---|---|---|---|
| **Inventory / reorder watch** | on-change + hourly | Re-reads the storefront/3PL connector into InventoryTruth, recomputes `available` and the reorder point from real velocity, flags `low` / `oversold` / stock-out-risk SKUs. | read-only; reconciles truth, raises alerts |
| **Restock drafter** | on `restockNeeded` | Drafts a purchase order (supplier, MOQ-rounded qty, landed cost, ETA) and stages it as an approve-move. Checks the cash gate and marks it `short` if funds don't cover it. | drafts a PO; **never places it** — approve + cash + lane |
| **Drop cadence** | per drop window | Watches the drop clock: pre-drop, drafts launch content + schedules the "open the drop" approve-move; mid-drop, tracks sell-through vs cap; on sold-out/close, drafts the next drop from what sold. | drafts + stages; opening, publishing, closing stay approve |
| **Fulfilment sweep** | on new paid order + daily | Groups unfulfilled paid orders, drafts pick/pack/label batches, decrements the projected `available`, and stages the shipping approve-move per batch. | drafts batches; buying labels / shipping is approve (real spend) |
| **Margin/COGS nag** | on new SKU listed | If a live SKU has no COGS, keeps margin "unknown" and surfaces a quiet one-tap "enter unit cost" — and holds back any ad move for that SKU until it's in. | alert only; blocks ads until COGS entered |

The overnight runner (master §7) advances only the reversible halves of these — drafting content, drafting
POs, reconciling inventory, planning the next drop — filling a morning to-approve queue. The founder wakes
to: what advanced, which POs and drops are staged for a go, what's blocked on stock or cash, and the one
decision that matters today. Every spend and every shipment still waits for the tap.

---

## 9. Honest gaps (brand-specific)

- **Inventory reconcile** is specced against the Shopify connector's `get-inventory-levels`; a real 3PL
  lane (ShipBob/ShipStation) is a second connector, not yet wired.
- **MoR "platform" mode** (the lab as merchant-of-record via Paddle) is a doctrine claim from
  backend-as-connector; the real Paddle onboarding + tax-remit plumbing is infra, not built.
- **Velocity-based reorder point** needs real order history to be meaningful; with zero orders it stays
  honestly quiet rather than reordering on invented demand.
- No real PO has been placed, no real drop opened, no real label bought end-to-end — the same
  connector-plus-funded-time verification gap the master notes (§13), sharper here because the boundary
  is real money and real goods.

The line held throughout, in the one archetype where it costs the most to hold: **drafts the offer, the
supply plan, the drop, the restock PO — sources, charges, ships and restocks nothing without a connected
lane and the human's go, and prints no revenue, margin, inventory or cash number it didn't earn from a
connector or the human's own hand.**
