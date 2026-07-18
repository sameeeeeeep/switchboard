# Spec: the Switchboard token economy & Pro plan

**Status:** draft / design — economics are decided, rails are not built. The store UI ships first
with clearly-labeled simulation (see "Real today vs simulated").
**Related:** [VISION.md](./VISION.md) §1.5/§2.7/§3.2 (store + Billing rail),
[YC-APPLICATION.md](./YC-APPLICATION.md) Q6 (the Spotify arithmetic),
[CAPABILITIES.md](./CAPABILITIES.md) (the daemon as meter), the budget ledger
(`OriginGrant.budgets`, `usage.tokensToday`) and audit log the daemon already keeps.

## The model in one paragraph

Music had this problem before Spotify: per-song pricing made no sense, people pirated, artists
earned nothing. AI apps have it now: nobody holds twenty subscriptions, so app #21 never gets a
chance, and "I could build this myself" eats the rest. Switchboard's answer is one **Pro** plan
that unlocks the premium tier of *every* wrapp at once, with **~75% of Pro revenue paid to
developers pro-rata by metered usage** — plays, not downloads. The split is honest because the
broker *is* the meter: it sits in the data path, sees real per-wrapp spend, and a page can't fake
its own usage. Payouts land as **tokens** — compute credit a developer spends building the next
wrapp — so the first thing publishing earns you is a zero AI bill. And underneath all of it, one
law that nothing may violate: **bringing your own Claude or local model is free, forever, ungated.**

## What a token is

A **token** is a unit of compute credit in the Switchboard ledger. Precisely:

- **Denomination:** metered model tokens, normalized by a published **rate card** (model → SB
  tokens per 1K input/output tokens, so a haiku token costs less than an opus token). The daemon
  already counts model tokens per origin; the rate card is a lookup on top.
- **Nature:** a ledger entry, not a cryptocurrency. No chain, no speculation, no transfer between
  users. Two balances exist: a **user wallet** (spendable on running wrapps without BYO) and a
  **developer wallet** (earned from the Pro pool, spendable on building/running).
- **Backing:** every token in circulation is backed either by fiat (a purchased pack) or by the
  75% share of collected Pro revenue (a settlement mint). Switchboard never mints unbacked tokens
  except explicitly-labeled promotional grants, which are capped and marked in the ledger.
- **The other face of the token — the receipt.** The same meter that counts spend counts *effort*:
  a wrapp's store card shows its real, broker-measured **build cost** ("AdForge — built with 2.1M
  tokens · 34 updates"). That number is the answer to "I could build this myself": yes, for 2.1M
  tokens of your own — or use it here, maintained, for approximately nothing. Nobody else can
  print that receipt, because nobody else holds the meter.

Tokens are the **convenience and economics layer, never a wall**. BYO inference neither mints nor
burns tokens — it is metered only for stats and payout attribution.

## Actors & flows

```
                         fiat: $20/mo                     fiat: pack purchase
              ┌────────────────────────────┐        ┌──────────────────────────┐
              │                            ▼        ▼                          │
   ┌──────────┴─────────┐          ┌───────────────────────┐          ┌────────┴────────┐
   │      PRO USER      │          │      SWITCHBOARD      │          │  NON-BYO USER   │
   │ (has own Claude —  │          │  broker = the meter   │          │ (no AI setup;   │
   │  BYO, pays $0 gas) │          │  ledger = the books   │          │  runs on packs) │
   └──────────┬─────────┘          │  keeps ~25% of Pro    │          └────────┬────────┘
              │ uses wrapps        └──────────┬────────────┘                   │ uses wrapps
              │ (usage METERED,               │ monthly SETTLE:                │ (usage BURNS
              │  nothing burned)              │ 75% of Pro revenue             │  wallet tokens)
              ▼                               │ → minted as tokens,            ▼
   ┌────────────────────┐                     │ split pro-rata by     ┌─────────────────┐
   │       WRAPPS       │                     │ metered Pro usage     │ hosted inference │
   │ free core for all; │                     ▼                       │ pool (future     │
   │ Pro tier unlocked  │          ┌───────────────────────┐          │ daemon fallback) │
   │ by broker-carried  │          │      DEVELOPERS       │          └─────────────────┘
   │ entitlement flag   │◀─────────│ earn tokens by usage  │
   └────────────────────┘ publish, │ share; spend them     │
                          update   │ BUILDING (metered →   │
                                   │ the build-cost badge) │
                                   │ cash-out: future work │
                                   └───────────────────────┘
```

Four loops, one meter:

1. **BYO loop (sacred, free).** User runs any wrapp on their own Claude/local model. No tokens
   involved. The broker meters usage per origin — that's it.
2. **Pro loop (the revenue).** A Pro user's usage of pro-tier features is attributed per wrapp.
   Monthly, 75% of Pro fiat revenue converts at the posted rate into tokens minted to developer
   wallets, split by each wrapp's share of metered Pro usage. Spotify royalties, verbatim.
3. **Pack loop (the on-ramp).** A user with no AI setup buys a token pack; running wrapps burns
   tokens against the rate card via a Switchboard-pooled inference backend. This is how someone
   with zero setup tries the catalog — and graduates to BYO the moment they install a model.
4. **Build loop (the flywheel).** A developer spends earned tokens generating and updating wrapps
   through the metered creator pipeline. The spend is itself metered — and becomes the wrapp's
   build-cost receipt on the store card. Earnings become supply; supply earns.

## The ledger: mint / burn / settle

Append-only, double-entry against the audit log the daemon already writes. Every ledger entry
references the audit line(s) that justify it.

**Mint** (tokens enter circulation):
- `mint:pack` — user buys a pack; fiat in, tokens to user wallet at the posted rate.
- `mint:settle` — period close; 75% of collected Pro revenue converts to tokens, credited to
  developer wallets pro-rata by metered Pro usage share. Switchboard's ~25% stays as fiat, never
  minted.
- `mint:grant` — promotional/bounty credit. Explicitly labeled, capped, never counted in payout
  arithmetic.

**Burn** (tokens leave circulation):
- `burn:run` — a non-BYO request routes through the pooled inference backend; burn = metered
  tokens × rate card, attributed to the wrapp's origin.
- `burn:build` — a developer's creator-pipeline session; same mechanics, but the cumulative burn
  is stamped onto the wrapp's manifest as its **build cost** and its update counter increments.

**Settle** (the monthly close):
1. Sum each wrapp's metered **Pro-attributable usage** for the period from the audit ledger
   (usage by Pro subscribers, BYO or hosted — attribution is about *plays*, not about gas).
2. Compute shares; mint 75% of the period's Pro revenue to developer wallets by share.
3. Publish the period statement: pool size, per-wrapp share, rate card used. Auditable because
   the underlying meter is the same audit log users already see in the panel.

**Invariants:** wallet balance = Σ mint − Σ burn, always ≥ 0; Σ `mint:settle` per period ≤ 75% of
that period's Pro revenue at the posted rate; no ledger entry without an audit-log reference; BYO
traffic appears in *attribution* but never in *mint or burn*.

## Plans

| | **Free** | **Pro** (~$20/mo, one sub) | **Token packs** (one-time) |
|---|---|---|---|
| Core of every wrapp | ✔ full, forever | ✔ | ✔ (burns tokens) |
| Pro tier of every wrapp | — | ✔ across the whole catalog | — (packs ≠ Pro) |
| Latest feature updates | stable core | newest stream, day one | stable core |
| BYO inference | ✔ free | ✔ free | ✔ free (packs sit unused) |
| Hosted inference | — | — (Pro ≠ compute)* | ✔ until the pack runs out |
| Funds developer payouts | — | ✔ (75% of it) | — |

\* Keeping Pro (entitlement) and packs (compute) orthogonal is deliberate: Pro is *access*, packs
are *gas*. A Pro subscriber without BYO also needs packs; a BYO free user needs neither. A modest
monthly token allowance bundled into Pro is an acceptable future sweetener, not a launch feature.

**Entitlement mechanics.** The daemon knows the user's plan; the grant handshake carries
`plan: "free" | "pro"` to the page (additive protocol field, future work). The page can't forge it
— it arrives over the broker channel, same as identity. Fail-closed **to free**: a missing field,
an old daemon, or an offline sidekick degrades to the free tier, never to a locked app.

## The honesty laws (non-negotiable)

These are the store's currency; one violation bankrupts it.

1. **BYO is never gated, metered against packs, throttled, or nagged.** Tokens are convenience,
   not a wall. There is no surface anywhere that makes BYO feel like the second-class path.
2. **The free tier is complete, not crippled.** The primary loop works end to end. No watermarks,
   no artificial delays, no locked export of the user's own work, no consent/safety feature ever
   behind Pro. The user's own context and data are theirs on every plan.
3. **Only meter-measured numbers get a badge.** A wrapp built off-platform shows
   `build cost: unmeasured` — never an estimate dressed as data. No fabricated installs, ratings,
   or earnings anywhere (the fake `rating`/`installs` fields died in VISION §2.7; they stay dead).
4. **Simulated surfaces say so.** Until the fiat rails exist, every checkout and payout number in
   the UI carries a visible `SIMULATED` tag. Demo mode is a labeled mode, not a deception.
5. **Purchased tokens don't expire.** Breakage is not a business model.
6. **The payout math is published.** Pool size, shares, and the rate card per period — the same
   auditability posture as the consent broker itself.

## Real today vs simulated in the store

| Piece | Status |
|---|---|
| Per-origin token metering (`usage.tokensToday`, budgets) | **REAL** — daemon meters every request |
| Audit log (origin, method, decision) | **REAL** — the substrate for attribution |
| Origin oracle / un-fakeable per-wrapp attribution | **REAL** — pages can't spoof usage |
| Panel header compact spend total | **REAL** — sums the meter |
| Build-cost badge for meter-built wrapps | **REAL mechanism, empty set** — no wrapp has a metered build yet, so today every badge honestly reads `unmeasured` |
| `plan` entitlement flag in the grant | **NOT BUILT** — additive protocol field; store simulates with a local flag |
| Pro checkout / Stripe / fiat rails | **SIMULATED** — labeled mock checkout |
| Token pack purchase + user wallet balance | **SIMULATED** — labeled; no hosted pool exists to burn against |
| Hosted inference pool (the pack burn path) | **NOT BUILT** — real infra, sequenced after demand exists |
| Ledger service (mint/burn/settle) | **NOT BUILT** — the store renders a simulated period statement computed from REAL meter data, labeled |
| Developer payout dashboard | **SIMULATED numbers over REAL usage shares** — shares from the actual meter, pool size mocked |
| Dev cash-out | **FUTURE WORK** — tokens spend on builds first; cash-out needs money-transmission diligence |

The build order this implies: entitlement flag → creator-pipeline build metering (start printing
real receipts) → ledger service → fiat rails → hosted pool. The store UI ships *ahead* of all of
it, simulation labeled, because the surfaces teach the model.

## Per-wrapp Free-vs-Pro split guidance

The rubric every wrapp (first-party and third-party) follows. **Free = the fully useful core.
Pro = advanced features + the latest update stream.** Spotify's framing: free plays the catalog;
premium gets the full experience — nobody is asked to re-record the songs.

Litmus tests for gating a feature behind Pro:
- **Creation test:** does the Pro feature create *new* value (batch, automation, depth) rather
  than un-cripple the core? If removing it breaks the primary loop, it belongs in free.
- **Data test:** does it gate the user's own data, context, or export? Then it can never be Pro.
- **Recommendation test:** would a free user still recommend the wrapp? If not, the split is wrong.

What typically lands where:

| Free (core, stable) | Pro (advanced + newest) |
|---|---|
| The complete primary loop, single-item | Batch / bulk / campaign-scale runs |
| Standard generation options | Premium option packs, deeper multi-step modes |
| Manual runs | Scheduled / recurring runs (when `sb_jobs` lands) |
| Current stable feature set | New features on day one; free absorbs them later |
| Single active context | Cross-wrapp / multi-context automations |
| Export of everything the user made | Team/hand-off formats, white-label outputs |

Worked examples from the current catalog: **AdForge** free = generate ad concepts from your brand,
one campaign at a time; Pro = multi-variant matrices, competitor-reactive refresh, newest formats.
**Redline** free = full single-page review; Pro = whole-site crawls, scheduled re-reviews, diff
reports. **Bank** free = the whole vault, always (data test — nothing in Bank gates); Pro = the
automation layer on top (recurring extractors, cross-vault syntheses).

Updates are the publisher's ongoing job — that's what the usage share pays for. A wrapp that stops
shipping updates keeps its free core working but naturally loses Pro share to maintained neighbors.
The economics reward maintenance without ever punishing the free user.

## Store UI surfaces (the implementer's exact list)

All of these live on the store surfaces VISION.md already defines (the full-tab store with the
`Home / Store / Connectors / Permissions / Activity / Billing / Settings` rail, plus the catalog
cards). Simulated elements carry the visible `SIMULATED` tag per honesty law #4.

1. **Build-cost receipt badge** — on every catalog card and wrapp detail header:
   `built with {N} tokens · {M} updates` when meter-measured, else `build cost: unmeasured`.
   Mono, tabular-nums, never estimated.
2. **Buy-vs-build panel** — on wrapp detail: build cost vs. typical per-session run cost on your
   own plan (from real meter averages when available), with the one-line argument: "rebuilding
   this yourself costs ~{N} tokens; using it costs ~{s} per session on your own Claude."
3. **Free/Pro feature-split table** — on wrapp detail: two columns from the wrapp's manifest,
   following the split rubric; Pro rows carry the lime `PRO` chip.
4. **Pro plan page** — one surface (Billing rail entry or standalone): price, "one sub, every
   wrapp's pro tier," the 75%-to-developers explainer with the split diagram, subscribe CTA
   (simulated checkout), and the standing BYO banner (see 9).
5. **Billing rail** — the full accounting home (panel header keeps only the compact total, per
   VISION §2.4): current plan card, per-wrapp spend breakdown from the real meter, period history.
6. **Wallet balance card** — token balance (user + developer balances where applicable), buy-pack
   CTA, and a transaction ledger view rendering `mint / burn / settle` entries with their
   audit-log references.
7. **Token pack purchase sheet** — posted rate card (model → tokens), pack sizes, simulated
   checkout, "packs never expire" stated inline.
8. **Earn / publisher dashboard** — for developer identities: usage share per wrapp this period,
   simulated period statement (real shares, mocked pool), token payout history, and a
   "spend on builds" link into the creator pipeline.
9. **BYO-is-free banner** — a standing, unmissable notice on the Pro page, pack sheet, and any
   surface that takes money: "Your own Claude or local model runs everything free, forever.
   Tokens and Pro are conveniences, not walls." This is a product surface, not fine print.
10. **Tier chips + filters on catalog cards** — `FREE CORE` / `PRO TIER` chips beside the existing
    capability-lends row; store filter by tier alongside category/capability/context-kind.

## Future work & open questions

- **Dev cash-out** — converting earned tokens to fiat crosses into money transmission; sequence
  after payout volume justifies the compliance work. Until then tokens spend on builds and runs.
- **Rate-card governance** — who sets model→token weights and how often; publish changes like
  protocol MINORs.
- **Attribution edge cases** — multi-wrapp sessions (context lent from one wrapp, consumed in
  another): does the producer earn a share of the consumer's play? Lean yes eventually — it pays
  extractors, the supply side — but v1 attributes to the consuming origin only.
- **Pro token allowance** — whether Pro bundles a monthly pack for non-BYO users, and at what size
  it stops being a sweetener and starts being a compute business.
- **Fraud posture** — self-play inflation (a dev's own Pro account farming usage share) is bounded
  by per-account metering and the audit trail; define the anomaly rules before real money settles.
