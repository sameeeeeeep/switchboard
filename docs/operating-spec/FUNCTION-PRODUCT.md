# Function Spec — Product / Engineering

> The deep spec for the **one genuinely autonomous function** of the company. The other five
> functions draft and stage; this one *produces the product*, because the company's backend is
> Claude Code editing the real `relay` repo. Read the capstone first
> (`AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md` §2.2, §15) and `AUTONOMOUS-COMPANY.md`. Switchboard is
> the running example; the model is kind-agnostic. Sibling to the other `FUNCTION-*.md` specs.

---

## 0. Why this function is different (the one-line thesis)

Every "autonomous company" demo can draft a tweet. **This one merges a pull request.** The
difference is not ambition, it's substrate: the daemon's `ClaudeCodeBackend`
(`packages/sidekick/src/backends/claude-code.ts`) runs the founder's own Claude Code over the
actual repository. Product's "draft" is a **branch with a green test run**; Product's "outbound"
is a **merge/release/deploy**. The reversible half of this function is not a mockup of shipping —
it *is* shipping, held one `git merge` short of the world.

That single fact is the company's moat over marketing-only autonomy: the reversible boundary,
applied to a coding agent on a real repo, lands genuine engineering value on a branch every cycle
and asks the founder only to open the last gate.

---

## 1. Mandate & how "ship real code" actually works

### 1.1 Mandate
Build and ship the product. For Switchboard that means: fix bugs, implement features, generate and
regenerate wrapps (catalog of **76**, source of truth `catalog.json`), keep the daemon
(`packages/sidekick`), the extension, and the release pipeline healthy, and cut DMGs (current line
**v0.3.0**, prebundled-wrapps, arm64). Product owns *what actually exists in the product*, not a
plan for it.

### 1.2 The mechanism — Claude Code is the backend
The seed that makes this real is already in the tree. The daemon exposes Claude Code as a model
backend; the same `canUseTool` consent gate that protects a wrapp's tool calls also governs the
coding agent's `Bash`/`Write`/`Edit` calls. Product runs as a Claude Code session **inside a git
worktree of the repo**, with the Gate deciding which tool calls are auto and which stage for a human:

```
backlog item  →  Product session (Claude Code, in a worktree)
                   ├─ Read / Grep / Edit / Write  ────────── auto      (reversible: edits a branch)
                   ├─ Bash: test / build / lint   ────────── auto      (reversible: read-only-ish, sandboxed)
                   ├─ Bash: git commit / push branch ─────── auto      (reversible: nothing is live)
                   ├─ gh pr create                ────────── auto      (reversible: a PR is a proposal)
                   ├─ gh pr merge  ───────────────────────── GATED     (outbound: touches main)
                   ├─ gh release create / DMG publish ────── GATED     (outbound: ships to users)
                   └─ deploy (Pages / prod)       ────────── GATED     (outbound: live to the world)
```

### 1.3 The reversible-vs-gated line (the invariant, applied to code)

| Class | What it is | Autonomy | Why |
|---|---|---|---|
| **Reversible** | a branch, a commit, a pushed feature branch, an **open PR**, a CI run | **auto** — the ticker does it itself, budget-permitting | nothing users touch changed; `git` makes it trivially undoable; the diff is the glass box |
| **Outbound / irreversible** | **merge to `main`**, tag a release, publish a DMC/DMG, deploy a site | **gated** — staged with a one-tap approve + blast radius | the moment code reaches `main`, a user, or prod it has left the reversible boundary |

The rule is the house rule of the whole OS ("drafts everything, sends nothing without a lane + a
go"), lifted onto engineering: **code on a branch = auto; anything that merges, releases, or
deploys = a founder go.** A branch is a draft you can read; `main` is the world.

### 1.4 Why this is the superpower
- A marketing-only autonomous company converts *effort* into *drafts of persuasion*. This one
  converts effort into **committed, tested engineering** — the actual asset.
- The gate is narrow and cheap: the founder reviews a PR (or trusts CI + a policy) and taps merge.
  Everything expensive — triage, spec, implementation, self-test, PR authoring — happened
  reversibly and unattended.
- It compounds against a real artifact. Last cycle's merged PRs are this cycle's baseline; the
  metric tree (bug burndown, release cadence) moves against real HEAD, not a slide.

---

## 2. The compiled task set

Tasks are **derived, not invented** — a pure function of the backlog + repo state. Each task
carries a class (**reversible / outbound**) × an autonomy mode (**auto | approve | manual**). The
pipeline:

```
triage → spec → implement(branch) → self-test/CI → open PR → [merge] → [release] → [deploy]
  auto    auto      auto              auto           auto      GATE      GATE        GATE
```

| # | Task | Input | Output | Class | Mode | Notes |
|---|---|---|---|---|---|---|
| 1 | **Triage backlog** | Support clusters, Analyst anomalies, issue tracker, founder goals | ranked, deduped, labelled backlog | reversible | **auto** | leverage = impact×confidence÷effort; dedupes across sources |
| 2 | **Spec the item** | one backlog item | a short in-repo spec / acceptance criteria + N options + ⭐ | reversible | **auto** | derived like the wrapp task-compiler; options restream downstream |
| 3 | **Implement on a branch** | the spec | commits in a dedicated **worktree/branch** | reversible | **auto** | one worktree per parallel item (§4.3); real `Edit`/`Write` |
| 4 | **Self-test / harness / CI** | the branch | pass/fail + coverage delta | reversible | **auto** | `examples/apps/harness` + suite + lint/build; **never merge red** (§4) |
| 5 | **Open PR** | a green branch | a PR with title, body, changelog stub, test evidence | reversible | **auto** | a PR is a *proposal*; opening one is not outbound |
| 6 | **Merge to `main`** | an approved, green PR | `main` advances | **outbound** | **approve** | the primary founder gate; policy-mergeable when CI green + rules met |
| 7 | **Cut a release** | merged `main` at a milestone | tagged version, built+notarized DMG (v0.3.0 line) | **outbound** | **approve** | signing/notarization via `relay-notary`; arm64 DMG |
| 8 | **Deploy** | a release or a landing/store change | live site (`thelastprompt.ai`/Pages) or published artifact | **outbound** | **approve** | landing lives in the separate deploy repo — a distinct gated hop |

**Mode nuance (§12 of the capstone applies per task-type):** items 1–5 default `auto`; 6–8 default
`approve`; anything the founder marks security-, billing-, or auth-touching is bumped to `manual`
(human writes/reviews the diff, not just the merge). Modes are overridable per task.

**The only human touches in the happy path:** tap merge (6), tap release (7), tap deploy (8).
Everything upstream is unattended and reversible.

---

## 3. Cross-function seams (where Product plugs into the org)

Product is a **consumer of signal** and a **producer of shipped change**. Three load-bearing seams:

### 3.1 Support → Product (inbound: feedback clusters)
Support is "the company's ears": it watches issues/DMs/feedback, triages, and **drafts bug reports
into Product's backlog** (capstone §2.5). The seam is a typed backlog item, not a vibe:
`{ cluster_id, symptom, frequency, repro?, suspected_area, severity }`. Product's **triage** task
(2.1) treats a Support cluster as a first-class candidate — a cluster of N identical complaints
outranks a lone feature wish by frequency×severity. This is the loop in capstone §13.4: an issue
spike bends Product's allocation toward the fire without the founder steering.

### 3.2 Analyst → Product (inbound: what to build)
Analyst turns raw signal into the metric tree and flags anomalies (capstone §2.7). Two feeds into
Product:
- **What to build** — a feature with low adoption, a funnel step that leaks, a wrapp with runs but
  no retention becomes a spec candidate with an *expected metric delta* attached (so the CEO can
  score it on leverage).
- **Regression sentinel** — after a merge/release, Analyst watches the owned metrics; a post-release
  dip in activation or a crash-rate spike is an anomaly that reopens a backlog item (see §7 revert).

### 3.3 Product → Growth (outbound: the changelog)
When a release ships, Product **emits a changelog** derived from the merged PRs since the last tag
(the real one in `docs/operating/CYCLE-001.md` §2 is the template: "v0.3.0 — wrapps prebundled…").
Product *drafts* the changelog (reversible); **Growth** owns turning it into a post/email/launch and
**publishing is Growth's gate**, not Product's. The seam is a structured `changelog[]` of
`{ pr, title, user_visible_summary, kind: feat|fix|chore }`, user-visible entries only.

### 3.4 Contract summary

| Seam | Direction | Payload | Product's obligation |
|---|---|---|---|
| Support → Product | in | feedback cluster | fold into triage by frequency×severity |
| Analyst → Product | in | build-signal + regression alert | spec candidates w/ expected delta; reopen on regression |
| Product → Growth | out | user-visible changelog | draft from merged PRs; hand off, never self-publish |
| Product → Analyst | out | "shipped X at commit Y / release Z" | timestamp so adoption can be attributed |
| Product → Finance | out | token/compute burn of the session | so the budget guard can cap (§5, §7) |

---

## 4. Quality gates

Product's autonomy is only safe because the branch it lands is **verified before it's proposed**.

### 4.1 Self-test / the harness
Every branch runs the real verification stack before a PR is opened:
- **The wrapp test harness** (`examples/apps/harness`) — a mock `window.claude` drives all 76 wrapps
  × the sample projects headless; the baseline is a known green count. A regenerated or edited wrapp
  must not drop the count.
- **Unit / integration suite + typecheck + lint + build** for the daemon (`packages/sidekick`) and
  extension.
- **Guided self-test for GUI-only paths** — where a change is in native/notch UI the harness can't
  reach, Product scripts a `guided-cursor` pass/fail run and records the machine-readable result
  rather than asserting "looks fine."

### 4.2 The "never merge red" rule (non-negotiable)
A PR whose CI is red **cannot be a merge candidate** — full stop. Red CI keeps the task in `staged`
(green branch not achieved), never `done`. The founder gate at merge is *in addition to* green CI,
not a substitute for it: **green is necessary, the go is sufficient.** No "merge and fix forward"
autonomy — forward-fixes are themselves new reversible branches.

### 4.3 Worktree isolation for parallel work (and the real hazard)
Parallel Product items each get their **own git worktree** so two in-flight features never share a
dirty tree (capstone §14 "two functions edit the same file"). This is how the company runs several
engineering tasks a cycle without clobber.

> **Cite the real trap.** Worktrees in this repo nest *inside the main repo path*
> (`.claude/worktrees/…`), so a **bare absolute path silently resolves to the wrong tree/branch** —
> an agent that `cd`s out and uses a root-absolute path edits the main checkout while believing it's
> on its branch, and the "isolated" work lands on the wrong HEAD. **Rule: every path a Product
> session uses is cwd-relative to its own worktree; never `cd` out, never a bare repo-root absolute
> path.** This is a known, recurring hazard, not a hypothetical — it has bitten builds before and is
> the single most likely way parallel isolation fails silently.

### 4.4 The gate stack (a change must clear all of these to reach `main`)
```
green harness  ∧  green suite/build/lint  ∧  no merge conflict with main
               ∧  PR authored w/ evidence  ∧  founder go (or policy auto-merge rule)
```
Miss any ⇒ the item stays reversible and re-enters implementation. The world-boundary is only ever
crossed by the founder's go on a fully-green proposal.

---

## 5. Metrics, state machine, lanes, cockpit

### 5.1 Metrics Product owns
Per capstone §2.2, honesty rule §4 applies — every number is real (a meter reported it) or reads
**"unknown — not instrumented."**

| Metric | Definition | Meter | Health signal |
|---|---|---|---|
| **Bug burndown** | open bug-labelled items opened − closed, per cycle | issue tracker + backlog | trend down = healthy |
| **Release cadence** | days between tagged releases; releases/month | git tags | steady/known = healthy |
| **PR throughput** | PRs opened → merged per cycle; merge latency | GitHub | drafts landing = alive |
| **CI health** | % green on first run; red-streak length | CI | high green = trustworthy autonomy |
| **Feature adoption** | usage of a shipped feature (via **Analyst**) | analytics lane | attributes ship → value; guards vanity (§7) |
| **Harness pass count** | green wrapps / 76 | `examples/apps/harness` | regression alarm |

Adoption is *owned jointly*: Product ships, Analyst measures; a feature that ships but no meter can
see reads "adoption: unknown — not instrumented," which is itself a task for Analyst.

### 5.2 Function state machine
Per capstone §10, function state is a **Set per assignment**, never a global boolean:
`idle` · `working{item}` · `blocked` (names the missing lane/decision) · `draft-only` (a lane is
absent — e.g. no GitHub → code stays local) · `over-budget` (budget guard tripped, work saved).

Per-item task state (ported from the OS): `prepared → drafting → staged → (approved) → done`, plus
`blocked` and `failed`. A red CI or merge conflict returns an item to `staged`/`drafting`, **never
`done`**.

### 5.3 Lanes & degradation (loud, specific, per capstone §6)

| Lane | Unlocks | Absent ⇒ (degraded but honest) |
|---|---|---|
| **GitHub** | branch push, PR, merge | code lives on a **local** worktree branch; "connect GitHub to open a PR" |
| **CI** | automated verification | Product runs the harness/suite **locally**, reports it, marks "CI lane absent — local-only evidence" |
| **Deploy** (Pages / prod / DMG dist) | releases & sites go live | release artifact **built and staged**, not published; "connect deploy to ship" |

Degradation is never silent: a starved Product drops to `draft-only` and *says which lane it needs*,
and the CEO reallocates. With **zero lanes**, Product is still a real code-generator against a local
checkout — a glass-box engineering planner that has actually written the diff.

### 5.4 Cockpit — the "Operations" surface
Product renders into the cockpit's **Operations** column (capstone §11 Org view / AC §5.3):
- **The deployable card** — current HEAD / release, the built-but-unpublished DMG if staged.
- **The derived task list** with status tabs (`prepared/drafting/staged/done`) and "Run now."
- **The PR rail** — open PRs as staged outbound moves, each a one-tap **Approve merge** with its
  blast radius ("merges 3 commits to `main`, touches the daemon Gate").
- **CI/harness readout** — green count / 76, last run, red-streak.
- **Lanes readout** — GitHub · CI · Deploy, each dark lane a one-tap connect.
- **Changelog draft** — the pending Product→Growth handoff.

Everything is glass-box: the founder can always open the diff behind any staged merge and read *why*
it was proposed (the backlog item + its source cluster/anomaly).

---

## 6. Routines (the temporal spine for Product)

Each routine is honest about its boundary in its own header (capstone §8, AC §7). All are
reversible-only and budget-guarded; none crosses the merge/release/deploy gate on its own.

| Routine | Tempo | What it does | Boundary |
|---|---|---|---|
| **Autonomy ticker** | ~seconds while on | advances the next reversible engineering task (triage→spec→implement→test→open PR) | drafts branches & PRs; never merges/releases/deploys; budget-guarded |
| **Ship cadence** | per cycle / on green milestone | assembles mergeable green PRs into a proposed merge+release set; drafts the changelog | stages the release; founder taps go |
| **Bug sweep** | daily | pulls Support clusters + Analyst regressions, re-triages, opens fix branches for the top-severity items | branch + PR only |
| **Dependency & security watch** | weekly (+ on advisory) | scans deps for advisories, drafts an upgrade branch, runs the harness against it, flags anything auth/crypto/Gate-touching as `manual` | opens a PR; security-sensitive merges are founder-only |
| **Regression watch** | post-release (with Analyst) | watches owned metrics after a ship; a dip reopens the item and drafts a revert branch | revert is a *proposed* PR, not an auto-merge |

The **overnight runner** (daemon, headless) advances the ticker/bug-sweep against granted origins —
the "while you sleep" engineering spine — reversible-only, and per capstone §13 the one honest
verification gap: it compiles and is wired but has **not** run against a live funded company.

---

## 7. Edge cases (≥12)

1. **CI goes red on a branch** → item stays `staged`, never a merge candidate (§4.2). Product
   attempts a fix on the same branch (bounded retries); if still red, it parks the item `blocked`
   with the failing log and surfaces it — no forward-merge.
2. **Merge conflict with `main`** (main moved under an in-flight branch) → auto-rebase in the item's
   own worktree; if the rebase is clean and green, re-propose; if it touches contested hunks,
   escalate as a `blocked` item with the conflict shown. Never a blind `-X theirs`.
3. **A shipped release breaks something** (post-release regression) → Analyst's regression watch
   flags the dip; Product drafts a **revert PR** (reversible) and a forward-fix branch in parallel,
   both staged; the founder picks. A release is outbound, so **un-shipping is also gated** — the
   revert is a proposal, not an auto-rollback.
4. **Two features touch one file** → each in its own worktree (§4.3); the second to reach PR rebases
   onto the first's merged `main`. Memory/log conflicts are LWW-merged; code conflicts are never
   silently clobbered.
5. **The worktree-path trap fires** → an agent used a bare repo-root absolute path and edited the
   main checkout. Guard: sessions are pinned cwd-relative to their worktree; a pre-PR check asserts
   the branch's diff lives on the expected worktree HEAD, else the item fails loudly (§4.3).
6. **A regenerated wrapp regresses the harness** → the `/76` green count drops after a wrapp
   regen; the harness gate blocks the PR; the regen is reverted on-branch and re-attempted, or the
   item parks `blocked`. A regen is never merged below baseline.
7. **Security finding in a dependency** → dependency watch opens an upgrade PR, but anything touching
   auth/crypto/the consent **Gate** (`canUseTool`) is auto-bumped to `manual` — the founder reviews
   the diff, not just the merge. Critical advisories raise the item's priority in triage.
8. **Runaway auto-PRs** → a hard cap on open auto-PRs/cycle + a budget ceiling backstop (capstone
   §14). Past the cap, the ticker stops opening new PRs and consolidates; the CEO de-conflicts so two
   items don't chase the same fix. No unbounded PR spam at the founder's queue.
9. **Budget exhausted mid-implementation** → the budget guard drops autonomy `drafting → off`, the
   in-flight branch is **committed and saved** (not lost), the reason is logged, founder notified.
   Autonomy is affordable-by-construction.
10. **GitHub lane absent** → code still gets written on a **local** worktree branch; Product is
    `draft-only`, says "connect GitHub to open a PR," and the CEO reallocates or waits. No silent
    stall.
11. **CI lane absent** → Product runs the harness/suite **locally** and attaches that as evidence,
    labelled "local-only, CI lane not connected." The never-merge-red rule holds against the local
    run; the founder knows the evidence's provenance.
12. **Founder away for days** → reversible half keeps compounding (branches + PRs accumulate green
    and safe); the merge/release/deploy queue grows but **nothing reaches `main` or users**; a digest
    waits. The gate accumulating is the feature, not a failure.
13. **A gated merge sits forever** → the PR stays `staged`, never auto-merges, never silently
    expires; the PR rail shows its age. Stale-but-safe beats auto-shipped.
14. **Backend not signed in** → the `ClaudeCodeBackend` probe proves the runtime, not sign-in
    (auth lives in `~/.claude` and only fails at run-time). A signed-out session surfaces
    `SIGNED_OUT_MESSAGE` as a `blocked` state — "connect the coding backend" — not a fabricated
    diff.
15. **Vanity ship** → a feature moves its own metric but not the north star (weekly active
    wrapp-runs). Analyst flags it as a vanity gain (capstone §14 ungameable-check); Product
    deprioritizes that line next triage rather than doubling down.
16. **Daemon offline** → the overnight runner is down; the cockpit still reads/drafts against the
    local checkout, and a banner marks the headless spine as offline.

---

## 8. Today-doable vs blocked (this is the most today-doable function)

The honest split, grounded in the real product — the daemon **is** a Claude Code backend on the real
repo (capstone §15). Be concrete:

### Runs today, no founder input (reversible, real — this is the genuine unlock)
- **Triage → spec → implement on a branch** over the actual `relay` tree, in an isolated worktree,
  via the existing `ClaudeCodeBackend` + Gate. Real `Edit`/`Write`/`Bash`.
- **Self-test locally** — the `examples/apps/harness` (76 wrapps × sample projects), the daemon
  suite, typecheck/lint/build. Green-or-not is a real signal today.
- **Open a PR** and author its body + changelog stub from real commits (see `CYCLE-001.md` §2 for a
  real changelog drafted this way).
- **The whole reversible pipeline unattended** via the ticker/bug-sweep routines, budget-guarded, on
  a local checkout — a real engineering agent that lands verified diffs on branches while you sleep.
- **Draft the changelog + hand off to Growth**, draft dependency-upgrade branches, run the harness
  against them.

Concretely: *today* Product can take "the landing says 20+ wrapps but the catalog is 76," open a
worktree, edit the in-repo README/store copy to 76, run the harness, and open a green PR — all
unattended — and stage the merge for a tap. That is a real, end-to-end, reversible ship minus one
click.

### Blocked on the founder bottlenecks (capstone §9) — the gated hops
- **Merge to `main`** — needs the GitHub lane connected + the founder's go (or a standing
  auto-merge-on-green policy the founder sets).
- **CI as a lane** — until connected, evidence is local-only (honest, but not the same trust as a
  hosted green check).
- **Cut a release / publish the DMG** — needs the signing identity + `relay-notary` profile and the
  founder's go; the arm64 DMG (v0.3.0 line) builds locally but publishing is outbound.
- **Deploy the landing/store** — lives in the separate `thelastprompt.ai` deploy repo; connecting
  that deploy lane + a go is a distinct gated step (why "20+ → 76" on the *live* page is founder-gated
  even though the in-repo fix is auto).

> The company can start running today on Product's reversible half — real code, really written,
> really tested, really proposed — and each founder unlock (GitHub, CI, deploy, signing) converts a
> whole column of staged merges into live shipping. That conversion, repeated, is the product
> shipping itself.
