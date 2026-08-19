# STEP 2 — RUN THE LOOP (press go against Switchboard)

> The capstone (`docs/AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md`) specs the org. `AUTONOMOUS-COMPANY-LAUNCH.md`
> recon'd the engine. **This doc specs the single milestone in between: making the autonomous loop
> _run itself live_ against one real venture — Switchboard — on the founder's own Claude.**
>
> Every claim cites `file:symbol` on branch `claude/autopilot-autonomous` (read via `git show`) or the
> working tree. The honest boundary is law: **the live loop advances only reversible work; every
> outbound/spend act stages for the founder.** No fabricated numbers — every metric is real or "unknown".

Engine files:
- `packages/sidekick/src/autopilot/runner.ts` — `AutopilotRunner` (the headless "while you sleep" runner)
- `packages/sidekick/src/server.ts` — routine registration + gated completion injection
- `packages/sidekick/src/security/gate.ts` — `Gate` (the reversible-only chokepoint)
- `examples/apps/src/autopilot.js` — the wrapp (tab-open ticker + decision engine)
- `docs/operating/bank/{extract-state.sh,state.md,intent.md}` — the context-bank feed

---

## 1. What already exists

The advance spine is **built and compiles**; only the end-to-end funded run is missing.

| Piece | Symbol (`file:function`) | What it does |
|---|---|---|
| **Runner spine** | `runner.ts:AutopilotRunner.tick()` | One sweep across `deps.origins()`; `this.sweeping` guard stops a slow model call overlapping the next tick; returns `sweepTokens` so background spend shows in the menubar |
| **Per-company advance** | `runner.ts:advanceOne(origin, key)` | Reads one `autopilot-co-<id>` blob (`CO_PREFIX`), `JSON.parse` in try/catch (torn record ⇒ `return`), skips unless `co.auto.on`, then one `advance()` |
| **One reversible beat** | `runner.ts:advance(origin, co)` | `decide` → `draftProduct` → `draftSite` → `draftSocial` → `draftOutreach`, each gated by `allow(lane)=P[lane]!==false` from `co.policy`. Returns whether anything changed. **No send exists in this function.** |
| **Registration** | `server.ts` (~L181–189) | `new AutopilotRunner({ storage, origins:()=>grants.list().map(g=>g.origin), complete:(o,p,m)=>this.complete(o,{prompt:p,model:"sonnet",maxTokens:m}), log })`; `routines.register({ id:"autopilot", tier:"daemon", intervalMs:AUTOPILOT_TICK_MS, tick:()=>autopilot.tick() })`; `routines.start()` |
| **Tick interval** | `runner.ts:AUTOPILOT_TICK_MS = 60_000` | One reversible step **per company per minute** (the wrapp's tab-open twin is `autopilot.js:AUTO_MS = 9000`, ≈9 s) |
| **RoutineRegistry** | `server.ts:RoutineRegistry` (`docs/ROUTINES.md`) | Autopilot is routine #1, daemon tier. **`RELAY_AUTOPILOT` env flag is retired** in favour of the menubar's `~/.relay/routines-control.json`; the flag is still honoured as a legacy alias. Additive: no company opted in ⇒ nothing runs |
| **Budget guard (venture)** | `runner.ts:advanceOne` | `if (budget && spent >= budget) { co.auto.on = false; log "out of runway this week"; save }` — mirrors `autopilot.js:autoTick` |
| **Budget guard (daemon)** | `server.ts:complete()` → `gate.assertCompletionAllowed(origin, model, maxTokens)` | Every runner completion is scope + token-budget checked at the grant level; default `budgets.maxTokensPerDay = 2_000_000` (raised from 200K when cached-token accounting was corrected) |

**How the gate enforces reversible-only** (`gate.ts:Gate`). The runner is *structurally incapable of
sending*, two ways:

1. It only ever calls `this.complete(...)` (a model completion, read-class) and `storage.set(...)` on
   the app's own origin. It **never calls `relay.callTool`** — the only path to a lane (deploy, email,
   social, payments).
2. Any send *is* a `callTool`, which hits `gate.gateToolCall → authorize()`: `classify(name)` returns
   `"write"` for a send, and a write in the default `ask` mode requires
   `consent.requestWriteConsent(...)` — a per-action human tap, **fail-closed** (`ask<boolean>(…,
   120_000, false)`). No headless loop and no model output can produce that click. "The model proposes,
   the gate disposes."

---

## 2. What "running against the context bank" means

The capstone's six phases (`§1`) map onto the existing functions like this:

| Phase (capstone `§1`) | What it reads / writes | Existing symbol |
|---|---|---|
| **Sense** | the bank: `bank/state.md` (what exists, auto-extracted) + `bank/intent.md` (thesis, ICP, north-star, OKRs, the "done" bar) | **gap — see below** (`runner.ts:grounding` reads only `co.name`+`co.oneLine`) |
| **Decide** | pick the ⭐recommended open decision | `runner.ts:advance` step 1 / `autopilot.js:autoChoose` |
| **Act (reversible)** | draft offer, site copy, social, outreach — all `live:false` / `state:"draft"` | `runner.ts:draftProduct/draftSite/draftSocial/draftOutreach` |
| **Act (stage outbound)** | any send → an `approve`-class move | `autopilot.js:movesFor` (`mode:"approve"`) → `runMove` → gated `callTool` |
| **Measure** | tokens spent (real `usage` or labelled estimate); market metrics read **"unknown — not instrumented"** | `runner.ts:sweepTokens` / `autopilot.js:spend`; `state.md` "Honestly blind" |
| **Learn** | append to `co.log[]` (last 14) | `runner.ts:pushLog` / `autopilot.js:logLine` |

**The Sense feed already exists as files.** `bank/extract-state.sh` reads the real repo
(`cd "$(git rev-parse --show-toplevel)"`) and emits `state.md` — catalog size, landing/widget coverage,
latest release, consent-gate presence, and go-live readiness signals, every value real-or-`unknown`.
`intent.md` holds the thesis, ICP, north-star (**"weekly active wrapp-runs on connected Switchboards"**,
currently `unknown — not instrumented`), and the D1–D5 "done" bar. **The gaps between them are the plan.**

**The concrete wiring gap.** There are *two* loops today and they do not touch:

- **Loop A — the daemon runner.** `AutopilotRunner.tick()` sweeps **per-origin storage** for
  `autopilot-co-<id>` blobs (`runner.ts:advanceOne`). Its only grounding is
  `runner.ts:grounding(co) = "The company:\n" + co.name + (co.oneLine ? " — " + co.oneLine : "")`.
  **It never opens `docs/operating/bank/`.**
- **Loop B — the context bank.** `extract-state.sh` writes `state.md`, diffed against `intent.md` by a
  human/Claude-Code operating cycle (`docs/operating/`). Nothing feeds it into Loop A.

So "run the loop against the context bank" needs one bridge: **make the runner's `grounding(co)` (and
the wrapp's `groundingBlock`) fold `bank/state.md` + `bank/intent.md` into the prompt for the Switchboard
company**, and seed that company's `oneLine` from `intent.md`'s thesis. That is a read-only injection —
it changes what the model *knows*, never what the loop is *allowed to do*.

---

## 3. The exact "press go" sequence

Run against Switchboard, on the founder's Claude/quota, tab-closed (the real milestone).

**Precondition (founder, one-time):** Switchboard daemon running on the Mac; the founder's Claude
connected; the autopilot origin (`https://autopilot.thelastprompt.ai`) granted with
`models:["sonnet"]`, `budgets.maxTokensPerDay = 2_000_000` (`server.ts` grant defaults). This is the
founder's own quota — the operator holds no key.

| # | Step | Symbol | Effect |
|---|---|---|---|
| 1 | **Seed the venture** | `autopilot.js:seedFromLine("Switchboard — MetaMask, but for AI", "product")` *or* lend a `project`/`idea` context → `seedFromContext()` | Writes `autopilot-co-switchboard`: empty `SPEC` graph, `tokens.budget = 2_000_000`, `auto:{on:false}`, `policy = DEFAULT_POLICY` (all-on) |
| 2 | **Authorize autonomy** | `autopilot.js:runTheRoute(co)` ("⚡ Let AI run it") | Drafts the slate, `autoChoose`-s the ⭐recommended at each open decision, then `co.auto.on = true`. **Turning it on is the authorizing human act.** |
| 3a | **Tab open** | `ensureAutoLoop()` → `setInterval(tickAll, AUTO_MS=9000)` | One beat / 9 s while the tab is open |
| 3b | **Tab closed (the milestone)** | `RoutineRegistry` ticks `AutopilotRunner.tick()` every `AUTOPILOT_TICK_MS = 60_000` | Sweeps granted origins; `advanceOne` per `autopilot-co-*` with `auto.on` |
| 4 | **One tick = one reversible beat** | `runner.ts:advance` | decide → draftProduct → draftSite → draftSocial → draftOutreach; each model call → `server.complete()` → `gate.assertCompletionAllowed` on the founder's Claude |
| 5 | **Budget cap** | `advanceOne` venture guard (`spent>=budget`) **+** daemon `maxTokensPerDay` via the gate | Out of runway ⇒ `auto.on=false`, `"out of runway this week"` logged, in-flight work saved |
| 6 | **Outbound stages, never sends** | `movesFor` (`mode:"approve"`) → `runMove` → `callTool` → `gate` write-class → `requestWriteConsent` (fail-closed) | No lane connected ⇒ `laneLive` false ⇒ stages honestly ("no site connected yet") |

**How we'd know it actually ran (the artifacts a real tick must leave):**
- `co.log[]` gains entries: `"CEO chose <opt> for <decision>"`, `"drafted the product — <name>"`,
  `"drafted the site copy — preview and publish when ready"`, `"drafted a launch post — staged for your
  review, not sent"`, `"drafted outreach — staged, never sent without you"` (`runner.ts:pushLog`).
- `co.product.drafted` / `co.site.drafted` flip true; `co.posts[]` grows to 3, `co.inbox[]` to 2; all
  `live:false` / `state:"draft"`.
- `co.auto.at` timestamp bumps each changed tick.
- `tick()` returns `sweepTokens > 0` → menubar background-spend; `server.ts` emits `console.error("[relay] …")`.

**The honest verification gap.** Per `runner.ts`'s own `STATUS` header and capstone `§8` ("Overnight
runner … the one honest verification gap"), this has **compiled and wired against the real `StorageStore`
+ injected gated completion but never run end-to-end against a live funded company.** Do not call it
proven until one real tick is watched (autopilot on → close the tab → the board advanced).

---

## 4. The minimal changes needed

From "compiles, never run" → "ticks against Switchboard's bank and produces real staged work". Ranked
smallest-first; **all reversible-safe** — none can send or spend.

| Rank | Change | Class | Diff size |
|---|---|---|---|
| **1** | **Seed `autopilot-co-switchboard`** (`newCompany` with `oneLine` from `intent.md` thesis, `kind:"product"`) and set `auto.on=true`. This alone makes the *existing* loop run. | data write, reversible | zero code |
| **2** | **Bridge the bank into grounding.** Extend `runner.ts:grounding(co)` (and `autopilot.js:groundingBlock`) to append the text of `bank/state.md` + `bank/intent.md` when the company is the Switchboard venture. Read-only; changes what the model knows, not what the loop may do. | small reversible read | ~10 lines |
| **3** | *(optional)* A **Sense beat** that shells `extract-state.sh` before a cycle so `state.md` is fresh. Bigger surface (daemon spawning a subprocess) — defer past the first watched tick. | reversible but new surface | medium |

**Anything that could send or spend is explicitly _out_ of this diff** — connecting a `deploy` /
`email` / `social` / `payments` lane needs the founder + a connector + a per-action approve-move
(`gate.gateToolCall`). Those convert a column of drafts into live action; they are Step 3, not "make it run".

**The single smallest change:** rank 1 — seed one Switchboard company blob and flip `co.auto.on`. No
code. The loop is already registered and ticking (`server.ts` `routines.start()`); it advances any
`auto.on` company it sweeps. To satisfy the *"against the context bank"* clause specifically, add rank 2.

---

## 5. Risks + guards

| Risk | Guard (cited) |
|---|---|
| **Runaway loop** | `runner.ts:tick` `this.sweeping` reentrancy guard (no overlap); one beat per tick; `AUTOPILOT_TICK_MS=60_000` pacing; capstone `§14` hard cap on cycle count + budget ceiling backstop |
| **Budget exhaustion** | Two layers: `advanceOne` venture guard (`spent>=budget` ⇒ `auto.on=false`, work saved) **and** daemon `gate.assertCompletionAllowed(origin,model,maxTokens)` against `maxTokensPerDay` (2M). Autonomy is affordable-by-construction |
| **An outbound move leaking past the gate** | Structurally impossible from the runner: it never calls `callTool`. Any send is write-class → `gate.authorize` → `requestWriteConsent` **fail-closed** (`ask(...,120_000,false)`). Even a mis-coded send beat is blocked without a human click |
| **Worktree-path hazard** (memory: relay-worktree-path-trap) | `extract-state.sh` uses `cd "$(git rev-parse --show-toplevel)"` (resolves to the correct tree from inside a worktree); the daemon reads real per-origin `StorageStore` paths. Keep bank reads cwd/`git rev-parse`-relative — a bare absolute path silently hits the wrong tree |
| **Memory / torn write** | livestore one-file-per-company, per-origin isolation; `advanceOne` `JSON.parse` in try/catch skips torn records; `save()` in try/catch logs on failure; the wrapp's `loadState` merges (in-memory wins while `drafting`) to avoid the detached-orphan swap. Capstone `§14`: cold restart resumes from last clean phase |
| **Double-seed / racing onReady** | `autopilot.js` `hydrated` + `coldOpened` guards; `seedFromContext` idempotent by `id` **and** `ctxId` |

---

## 6. Today-doable vs blocked

**Doable today, founder's own Claude, zero external accounts (all reversible, real):**
- Seed the Switchboard company; draft the full slate; generate the site HTML + offer (both `live:false`);
  draft launch social + outreach (staged); turn on drafting autonomy (9 s tab-open ticker *and* the 60 s
  headless daemon runner); budget-guarded; CEO proactive status; per-company log artifacts.
- **Bank-grounding (rank 2)** — a small reversible read-only diff.
- Persistence is already proven headless (`examples/apps/proof/run-autopilot-storage.mjs`).

**Blocked (needs a founder unlock — never in the "make it run" diff):**
- Publish the site to a real subdomain — `site` lane; **no deploy connector on the branch** (`laneLive("site")===false`) — the single biggest launch blocker.
- Send outreach / post social / launch an ad / charge — `inbox`/`social`/`ads`/`payments` lanes + approve-move.
- Real market metrics — installs, weekly-active, retention, revenue read **"unknown — not instrumented"** (`state.md`, `intent.md` north-star); the top architectural gap.
- **The end-to-end funded-company run** — the one honest verification gap (`runner.ts` STATUS, capstone `§8`).

---

*Honesty refrain, restated by the code: `co.policy` governs **drafts only**. Every outbound act stays an
`approve`-class move that needs the founder's tap. Drafting a price is not charging one; drafting a post
is not sending one. The loop runs the reversible half and parks the rest — that is what makes "autonomous"
honest here.*
