# Autonomous Company — LAUNCH PLAN (software business, today)

> Grounded entirely in the real engine on branch `claude/autopilot-autonomous`. No invented
> functions, no fabricated numbers. Every step cites `file:function`.
> Engine files (read via `git show claude/autopilot-autonomous:<path>`):
> - `examples/apps/src/autopilot.js` — the wrapp (cockpit + decision engine + tab-open ticker)
> - `packages/sidekick/src/autopilot/runner.ts` — the daemon "while you sleep" runner
> - `packages/sidekick/src/server.ts` — where the runner is registered as a routine
> - `docs/AUTONOMOUS-COMPANY.md` — the full spec this plan executes against

The honest boundary is the whole product: **the engine drafts everything reversible itself, and
SENDS / CHARGES / DEPLOYS nothing without a connected lane + a human approve-move.** Enforced
structurally, not by convention — see steps 3–5.

---

## 1. Seed a venture (kind = software)

**Where:** `examples/apps/src/autopilot.js`

- Two seed entry points, both reversible, both land you on the running cockpit:
  - `seedFromLine(line, kind)` — a single input like `"Kettle — a cold-brew subscription for offices"`;
    splits name from thesis, then `newCompany({ id, name, oneLine, kind })`.
  - `seedFromContext()` — the **cold open**: when a context is lent (brandbrain `brand`, ideabrain
    `idea`, store `project`), `autostart()` → `seedFromContext()` seeds with zero input and
    `inheritFrom(brand)` carries the lent voice/palette forward. Idempotent by `id` **and** `ctxId`
    so the same context never mints two companies.
- **`kind` resolution — `resolveKind(raw)` + the `KINDS` table.** The venture is ONE object; `kind`
  only forks three slots (what deploys, how it earns, where it lives). The real table:

  | kind | econ | deployNoun | host | notes |
  |---|---|---|---|---|
  | `brand` | sales | landing page | `<slug>.site` | physical, has supply chain |
  | `product` | sales | product site | `<slug>.app` | **the software-business, sales mode** |
  | `wrapp` | usage | wrapp | `<slug>.sameep.ai` | **the software-business, Spotify-pool mode** |

  `KIND_OF` maps a lent context's raw kind → a venture kind: `project`/`idea`/`product` → `product`,
  `wrapp` → `wrapp`, `brand`/`company` → `brand`. **Caveat to respect:** there is no literal
  `"software"` key — `resolveKind("software")` falls to the default `"brand"`. To launch a software
  business today, seed with **`kind: "product"`** (own site + sales) or **`kind: "wrapp"`** (runs on
  the visitor's own Claude, earns by usage), or lend an ideabrain `idea` / store `project` context
  which `KIND_OF` already routes to `product`.
- **App scope** (`APP.scope` in `autopilot.js`): `models: ["sonnet"]`, `tools: []`,
  `contextKinds: ["brand", "project", "idea"]` — deliberately broad so the ideabrain→run graduation
  works. Origin is `https://autopilot.thelastprompt.ai`.

Result of this step: a `newCompany(cfg)` record with an empty decision graph (`SPEC`: voice → angle
→ channel, plus independent `next`), `tokens.budget = 2_000_000`, `auto: { on:false }`,
`policy = DEFAULT_POLICY`. Persisted as one file per company under key `autopilot-co-<id>` via
`collection(relay, "autopilot-co")` (`kit/livestore.js`).

---

## 2. Generate its deployable (the app / site)

**Where:** `examples/apps/src/autopilot.js`

- `draftSlate(co)` first drafts the operating slate: `genOptions(co, id, "draft")` runs voice→angle→
  channel sequentially (each constrains the next) with `next` in parallel. Each option set is
  `relay.complete({ model:"sonnet" })` via `completeCounted()` — real `usage` when the broker
  reports it, a **labelled estimate** otherwise (`estimateTokens`). Nothing invented: prompts carry
  `groundingBlock(co)` and forbid fabricated metrics/customers/prices.
- `genSite(co)` is the **deployable generator**. It builds `host = kindCfg(co).host(slugOf(co.name))`
  and asks the model for **one self-contained HTML document** (inline `<style>`, no scripts, no
  external assets), grounded in the chosen voice + angle + inherited palette. Stores
  `co.site = { host, html, drafted:true, live:false }`. For a `wrapp` kind the brief switches to a
  single-purpose entry screen ("runs on the visitor's own Claude, no signup, no charge").
- `genProduct(co)` (sales kinds only) drafts the first paid offer as `{ name, price, blurb }` —
  `co.product = { …, drafted:true, live:false }`. **Drafting a price is not charging one.**

Everything in this step is **reversible and local** — `live:false` on both `site` and `product`. The
HTML exists on the visitor's machine; nothing is public yet.

---

## 3. Deploy it live to a subdomain

**Where:** `examples/apps/src/autopilot.js` — `runMove()`, `movesFor()`, `toolForLane()`, `LANE_MATCH`

- The target host already exists as a string the moment the site drafts: `kindCfg.host(slug)` →
  e.g. `kettle.app` (product) or `kettle.sameep.ai` (wrapp).
- Publishing is an **approve-class move on the `site` lane**, never automatic. `runMove(co, move)`
  resolves a connector via `toolForLane("site")`, matched by
  `LANE_MATCH.site = /deploy|publish|website|pages|vercel|netlify/i`.
  - **If a deploy connector is wired:** `relay.callTool(tool, args)` fires — and the Switchboard
    daemon classifies it write-class and throws its own **per-action human consent the model cannot
    click**. On success `runMove` sets `co.site.live = true` and `co.site.url = res.url`.
  - **If no deploy connector is wired (the state today):** `laneLive("site")` returns `false`, the
    move **stages honestly** — logs `"staged … — no site connected yet"` and tells you which lane to
    connect. It never pretends to publish.
- **Does it need a deploy connector today? YES.** No `deploy`/`pages`/`vercel`/`netlify` tool is
  registered on the branch, so `laneLive("site") === false`. Going live to a real subdomain requires
  connecting a deploy lane **and** a human approve-move. (Deploying the *Autopilot app itself* is a
  separate, ordinary wrapp build: `examples/apps/build.mjs` bundles `dist/`, hosted per the
  per-wrapp Pages-repo recipe — that is platform infra, not the venture's deployable.)

---

## 4. Enable drafting autonomy (the `co.auto.on` ticker)

**Where:** `examples/apps/src/autopilot.js` — `runTheRoute()`, `ensureAutoLoop()`, `tickAll()`, `autoTick()`

- Turning autonomy on **is the authorizing human act**. `runTheRoute(co)` (the "⚡ Let AI run it"
  fast-track) drafts the slate, `autoChoose`-s the recommended option at every open decision in SPEC
  order, then sets `co.auto.on = true` and calls `ensureAutoLoop()`.
- `ensureAutoLoop()` starts a `setInterval(tickAll, AUTO_MS)` with **`AUTO_MS = 9000`** (≈9s, "slow
  enough to read"). `tickAll()` advances each auto-on company by **one beat per tick** via
  `autoTick(co)`.
- **What advances headless (all reversible):** `autoChoose` (pick the ⭐recommended open decision) →
  then the beat cursor cycles `genProduct` → `genSite` → `genPost` → `genOutreach` → `ceoProactive`.
  Each beat is gated by the **per-lane autonomy policy** (`co.policy`, `DEFAULT_POLICY` all-on): a
  lane set `false` is skipped. **Sends are never beats** — posts/emails only ever reach `state:
  "draft"`/`"staged"`, never sent.
- **Budget guard:** at the top of `autoTick`, `if (co.tokens.spent >= co.tokens.budget)` →
  `co.auto.on = false`, log "out of runway this week", and `ensureAutoLoop()` tears the timer down.
  `spend(co, tokens, area, estimated)` counts every call; the token surface is honest (real usage or
  labelled estimate).

The autonomy line, restated by the code: `co.policy` governs **drafts only**; every outbound act
stays an `approve`-class move requiring the daemon's per-action tap.

---

## 5. The daemon "while you sleep" runner

**Where:** `packages/sidekick/src/autopilot/runner.ts` (`AutopilotRunner`) + `packages/sidekick/src/server.ts`

- Same advance as step 4, but with the **tab closed**. `AutopilotRunner.tick()` sweeps
  `deps.origins()` (the granted origins) and, for every storage key starting with
  `CO_PREFIX = "autopilot-co-"`, calls `advanceOne(origin, key)`.
- `advance(origin, co)` mirrors the wrapp's `autoTick` and its policy exactly: decide one open
  decision → `draftProduct` → `draftSite` → `draftSocial` → `draftOutreach`. **It never sends** — no
  post, email, ad, payment, or publish. Those stay `approve`-class, which no headless loop (and no
  model) can produce.
- **Gated + budgeted:** it doesn't own a backend — it's handed the server's OWN gated completion
  (`CompleteFn`), wired in `server.ts`:
  `complete: (origin, prompt, maxTokens) => this.complete(origin, { prompt, model:"sonnet", maxTokens })`.
  So every background call is scope-checked, budget-counted, and attributed like a page call. Same
  runway guard: `if (budget && spent >= budget) { co.auto.on = false; … "out of runway" }`.
- **The flag → registry migration (be precise here):** the old **`RELAY_AUTOPILOT=1`** env flag is
  **retired** in favor of the RoutineRegistry. `server.ts` registers it as a daemon-tier routine
  `{ id:"autopilot", intervalMs: AUTOPILOT_TICK_MS }` where **`AUTOPILOT_TICK_MS = 60_000`** (one
  reversible step per company per minute). The visible control is the menubar's
  `~/.relay/routines-control.json`; the per-company `co.auto.on` toggle remains the real gate. The
  env flag is still honored as a **legacy alias** so an existing launch that exports it keeps
  working. Additive by construction: **no company opted in ⇒ nothing runs.**
- **The one honest verification gap:** per the runner's own `STATUS` header and
  `docs/AUTONOMOUS-COMPANY.md §13 / §7`, the runner **compiles and is wired against the real
  `StorageStore` + injected gated completion, but has never run end-to-end against a live funded
  company** (autopilot on → close the tab → confirm the board advanced on a real daemon + real
  backend). Do not present it as proven against a funded company until that single run is watched.

---

## 6. TODAY-DOABLE vs NEEDS-CONNECTOR / FUNDED

**Ships live today, zero external accounts (all reversible, on your own Claude):**
- Seed a software venture — `seedFromLine(line, "product")` / lend an ideabrain `idea` → `seedFromContext()`.
- Draft the whole operating slate — `draftSlate` → `genOptions` (voice/angle/channel/next), pick + restream downstream.
- Generate the deployable — `genSite` (self-contained HTML) and `genProduct` (offer + price), both `live:false`.
- Draft launch social + outreach — `genPost` / `genOutreach`, staged as drafts, nothing sent.
- Turn on drafting autonomy — `runTheRoute` / `co.auto.on`, the 9s `autoTick` ticker, budget-guarded.
- CEO planning/status — `ceoProactive` posts a proactive status to the thread.
- Portfolio persistence proven — `examples/apps/proof/run-autopilot-storage.mjs` drives the real
  `kit/livestore.js collection()` against a throwaway daemon (per-file, per-origin isolation).

**Gated on a connector + a human go (cannot go live today without it):**
- **Publish the site to a real subdomain** — `site` lane; needs a `deploy/pages/vercel/netlify` tool. **This is the blocker below.**
- **Send outreach email** — `inbox` lane (draft-only connector; sending stays your tap in Gmail).
- **Post to X / LinkedIn** — `social` lane.
- **Launch an ad campaign** — `ads` lane.
- **Charge for the product** — `payments` lane; revenue stays "not connected" until a meter/Stripe reports a real number.
- **Meter usage → Spotify-pool rev-share** — `usage` lane (wrapp economics).

**Gated on FUNDED time / a real daemon:**
- The daemon overnight runner against a live funded company — the one verification gap (step 5).
- Any real revenue figure — every economic number is real-or-"not-connected"; the engine never fabricates one.

---

## The single biggest blocker to a real launch today

**There is no deploy lane.** Every reversible thing — seed, slate, site HTML, offer, staged posts,
autonomy, overnight drafting — runs today on the user's own Claude with zero external accounts. But
"launch" means the venture's site is **publicly live at a subdomain**, and `laneLive("site")` is
`false` on the branch: no tool matches `LANE_MATCH.site = /deploy|publish|website|pages|vercel|netlify/`.
So the deployable stays a local draft that **stages honestly** until a deploy connector is wired and
the human taps go. Connecting one deploy lane (e.g. a Cloudflare Pages / Vercel `callTool`) is the
smallest change that turns a glass-box planner into a company that is actually live — and by design
it still can't publish without the human's approve-move.
