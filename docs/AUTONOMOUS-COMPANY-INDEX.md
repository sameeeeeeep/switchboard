# The Autonomous Company — Full Spec Index

The complete spec set for the autonomous-company product (public name **COS**, codename **Autopilot**),
run as one venture engine where `kind` is a parameter. Switchboard is the live operating example.

## Read in this order

| # | Doc | What it specs |
|---|---|---|
| 1 | [AUTONOMOUS-COMPANY.md](AUTONOMOUS-COMPANY.md) | **Master.** The model (one engine, `kind` forks 3 slots), the three archetypes in brief, IA/hierarchy, states, navigation, interactions, routines, workflows, AI options, dashboard, edge cases, register. |
| 2 | [AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md](AUTONOMOUS-COMPANY-OPERATING-SYSTEM.md) | **Capstone — what it takes to *run* it.** The control loop, the 7-function org, the CEO decision engine, money engine, metric tree/OKRs, memory/continuity, cadence, the founder boundary + 3 bottlenecks, the OS dashboard. |
| 3 | Archetype playbooks | [software](AUTONOMOUS-COMPANY-SOFTWARE.md) · [agency](AUTONOMOUS-COMPANY-AGENCY.md) · [brand](AUTONOMOUS-COMPANY-BRAND.md) — each kind's economics, compiled tasks, states, routines, edge cases. |
| 4 | Function deep-specs | [CEO/brain](operating-spec/FUNCTION-CEO.md) · [Product/Eng](operating-spec/FUNCTION-PRODUCT.md) · [Growth+Sales](operating-spec/FUNCTION-GROWTH-SALES.md) · [Support+Analyst](operating-spec/FUNCTION-SUPPORT-ANALYST.md) · [Finance/Ops](operating-spec/FUNCTION-FINANCE-OPS.md) — each function's mandate, task set, state machines, routines, edge cases, today-doable split. |
| 5 | [AUTONOMOUS-COMPANY-LAUNCH.md](AUTONOMOUS-COMPANY-LAUNCH.md) | The code-grounded launch path (seed→generate→deploy→autonomy→daemon) + the today-doable vs needs-connector split. |
| — | [cos-mockup.html](../examples/apps/cos-mockup.html) | The live, kind-aware UI mockup (portfolio dashboard + cockpit). |
| — | [operating/](operating/) | The **real** operating record for Switchboard (LOG + Cycle 001 deliverables). |

## The spine in one screen

- **One engine, `kind` is a parameter** — software / agency / brand share decisions, ops, growth, strategy, CEO, autonomy, daemon; `kind` only resolves the deployable, the economics, and the host.
- **It's a loop, not a list** — Sense→Decide→Allocate→Act→Measure→Learn, run by a CEO across a 7-function org, compounding on measured deltas, remembered across time.
- **The honest boundary** — drafts everything reversible autonomously; **sends/charges/deploys nothing** without a connected lane + the founder's go. Every number is real or "unknown — not instrumented." No fabrication path exists.
- **The superpower** — Product/Eng is genuinely autonomous (the daemon is Claude Code on the real repo), so the company ships its own product, not just marketing.
- **The three founder bottlenecks** — signal (analytics), money (payments + entity), hands (connectors). The reversible half runs today; each unlock converts a column of drafts into live action.

## Reconciliation list (known cross-doc items to settle)

These are flagged honestly rather than papered over:

1. **Kind naming** — the master §2.1 speaks of a "software business"; the engine's `KINDS` has no literal `software` key — it's `product` (sales, `<slug>.app`) or `wrapp` (usage pool, `<slug>.sameep.ai`). The launch doc uses the engine names. *Settle:* keep "software business" as the user-facing label mapping to `product`|`wrapp` under the hood.
2. **Wrapp host domain** — master cites `<slug>.wrapp.sh`; engine `KINDS` uses `<slug>.sameep.ai`. *Settle:* pick one canonical host string.
3. **Catalog count** — resolved to **76** (source of truth: `catalog.json` + 76 manifests); the live landing still says "20+". *Settle:* reconcile every surface to 76 (or a vetted subset).
4. **North-star metric** — CEO + Support/Analyst both use **weekly active wrapp-runs on connected Switchboards**; consistent. The Analyst proposes a privacy-first floored ("≥") meter for it — the one real instrumentation build.
5. **Daemon runner honesty gap** — compiles + wired, but never run against a live funded company. Unchanged across docs.

## Status

Spec is **complete** across model, archetypes, operating system, functions, and launch path. The real
operating record (Switchboard) has Cycle 001 done with everything outbound staged for founder approval.
Open founder decisions live in [operating/LOG.md](operating/LOG.md) and [operating/CYCLE-001.md](operating/CYCLE-001.md).
