# Switchboard Wrapp Store — Product Requirements

_Status: v0.1 draft · 2026-07-17. The living definition of the wrapp-store homepage. Supersedes the ad-hoc "store" framing._

## 0. The stack — naming & layering

| Layer | What it is |
|---|---|
| **thelastprompt.ai** | The AI lab. Ships Switchboard and the first-party wrapps. |
| **Switchboard** | The **broker**. Bring your own AI (a Claude subscription or a local model) and lend it — plus your tools, context and data — to any app, under per-site consent, enforced by a local daemon. The trust layer. Unchanged by this doc. |
| **Switchboard wrapp store (the homepage)** | The **hub**. The homepage to all your wrapps: discover them, connect your Switchboard, and work. The "home screen" of the platform. **This document is about this surface.** |
| **Wrapps** | Web apps that run on your own AI through the broker — first-party (AdForge, Bank, Studio, Redline, …) and third-party. Including **taskOS**, the first-party daily-driver task wrapp that is the homepage's default surface. |

**Architectural principle: everything is a wrapp; the homepage is the shell that hosts them.** Even the killer feature — the task OS — is a wrapp. The homepage provides only the native chrome (connect, nav, discovery, launcher, brand switcher, account) and hosts wrapps as surfaces. This dogfoods the platform and keeps one consistent model.

## 1. Thesis

Switchboard's homepage is the thing you open every day **instead of opening Claude** — because it already knows what you're working on, what's next, and which wrapp moves it forward, and it runs entirely on the AI you already pay for, on your machine, under your consent.

The wedge is the **task layer**: a to-do list you don't maintain. Switchboard extracts it from what you tell it, what it observes you doing, and what it reads (with consent) from your Gmail, Granola, WhatsApp, ClickUp; tracks each item through its lifecycle; and routes it to the wrapp that completes it. The store is how you acquire new capability for those tasks. The broker is why you can trust it with your inbox.

## 2. Who it's for

- A solo founder building a consumer brand or app.
- A brand team.
- An agency running multiple client brands.

Multiplayer is later; single-operator now, with the seams left in (see §7).

## 3. The object model

- **Context / brand** — the top scope (a broker primitive today). For an agency, a client.
- **Task** — the spine. `{ title, source (given · observed · connector), status, project, wrapp(s) that can complete it, artifact(s) it produces, owner }`. Status lifecycle: **not-started / decision-pending → in-progress → draft → needs-approval → done.**
- **Artifact** — an output a task produces (landing page, ad, doc, image, review …). The workspace-of-record.
- **Wrapp** — the doer; produces artifacts, completes tasks. Has plays (usage), versions/updates, a developer.
- **Connector** — a context source (Gmail, Granola, WhatsApp, ClickUp, Shopify, Meta), lent via the broker.
- **Plan / tokens** — Pro (flat, unlimited) plus tokens (a non-BYO convenience). BYO is free forever.

## 4. taskOS — the home wrapp (the retention engine)

The homepage's default surface is the **taskOS wrapp**. It:

- **Extracts** tasks from three sources — what you tell it, what it observes you doing, and what it reads (with consent) from connectors — then de-dupes and keeps them current.
- **Tracks** status: where each in-progress thing has reached, whether a finished thing is draft vs approved, whether a not-started thing is blocked on a decision.
- **Persists** per project as plain `.md` — `claude.md`, `readme.md`, `tasks.md` — i.e. the **Bank vault**. Your roadmap and to-dos are files you own: portable, gitable, no lock-in.
- **Routes** each task to the wrapp(s) that complete it and offers "here's how I can help" — so you navigate your work and the wrapps organize around it, not the other way around.
- **Accepts intent** — tell it "launch the Diwali campaign" and it decomposes that into tasks and assigns wrapps (AdForge → the ads, Redline → the landing page, Shelf → inventory).
- **Runs wrapps from here** — a task isn't just routed, it can be **executed** in place. Two modes: **Run** (open the wrapp with the task pre-loaded) and **Complete run** (execute headlessly to a finished output that lands in a **Ready-to-review** queue — your job shrinks to approve / edit). A batch "auto-run the routine tasks" clears the safe ones at once. (Mechanism: taskOS drives a wrapp's exposed actions — see WEBMCP.md — or a headless run; the result is an artifact for review.)
- **Automations** — recurring runs on a cadence (e.g. weekdays: analyse yesterday's blog → digest; Mondays: competitor ad sweep → report; daily: low-stock check → reorder alert). Each automation runs a wrapp unattended and drops its output into Ready-to-review. This is the engine of daily return.

**It is a Work OS for any company** — a solo brand, a brand team, a multi-brand studio, an agency, a consumer-tech company — with **all tasks across every brand/client/product in one place** (unified, brand-tagged, filterable). Plays/usage counts never appear on *your* wrapps here (noise); they belong to the **store**, where store wrapps are **suggested contextually inside the Work OS** ("for what you're working on") and browsable as-is.

taskOS is a **privileged first-party wrapp**: with your consent it holds broad grants (read your contexts, cross-wrapp artifacts, and the connectors you allow) — but it is still a wrapp running on your own AI, so a third party could ship an alternative. It **earns** the home slot; it isn't hard-wired.

## 5. The two faces of the homepage

- **Home (do)** — the taskOS wrapp: your tasks, brand-scoped, with the accent wearing the active brand; each task links to the wrapp that advances it; completing a task produces an artifact (the record). Calm, utilitarian.
- **Explore (discover)** — the wrapp store, Spotify-style: new drops & updates, top charts by plays, made-for-your-brand, creators-as-artists, follow — and each wrapp's **context is visible right there** (what it can see and do, what it has made, how and why people use it, how to get it — all free on your own AI). Vibrant, editorial.
- The **workspace-of-record** (artifacts / projects) is the record both faces write into — surfaced inside Home and browsable on its own.

## 6. Trust & privacy — the centerpiece

"Reads your Gmail and WhatsApp to build your to-do list" is the scariest sentence in most pitches and the strongest in ours, because of the broker:

- taskOS reads **only what you consent to**, connector by connector.
- Extraction runs on **your own AI, on your own machine** — nothing is uploaded.
- You **see and control** what was extracted and from where; every task shows its source; revoke a source and its tasks recede.
- This is the moat: a daily-driver task OS that reads your life is only trustworthy if your life never leaves your machine. **Only a consent-broker can ship it.**

## 7. Economy

- **Pro** — one flat, **unlimited** subscription; unlocks every wrapp's pro tier. No usage meter.
- **Rev-share** — 75% of Pro revenue to developers, split by usage (plays) — streaming royalties. Plays drive discovery (charts) for everyone; Pro-attributable usage drives the payout pool.
- **Tokens** — a convenience layer for people with no AI of their own; packs, non-BYO.
- **BYO free forever** — your own Claude or local model runs everything at no charge; a BYO play still counts toward a wrapp's ranking, but not its payout.

## 8. Honesty rules

Show only data we can back. Task provenance is always visible. No fake metrics — performance/analytics numbers appear only when a connector is wired. Simulated surfaces (token wallet, plan toggle) are clearly labeled.

## 9. Scope & phasing

- **P1 — real data, today's primitives.** The homepage shell (connect, nav, brand switcher, launcher) + the taskOS home surface (tasks from what-you-give, the connectors we already broker, on the Bank `.md` substrate) + the workspace-of-record (artifacts on the existing context library) + Explore v1 (catalog + plays, which we already meter) + Pro-unlimited/plan surfaces. Two wrapps (AdForge, Redline) publish artifacts and complete tasks so the loop is genuinely live.
- **P2 — shared storage.** Cross-device sync; task statuses & assignment; richer artifacts; Explore charts / updates / following; then multiplayer (owner → teammates, near-free once storage is team-shared).
- **P3 — connectors & rails.** Deeper extraction (Gmail / Granola / WhatsApp); per-brand performance analytics; payout rails.

## 10. Non-goals (for now)

Not a BI dashboard. Not general-purpose project management — it is AI-native task *completion*. Not multiplayer yet. Never a place your data is uploaded.

## 11. Open questions

1. How much *observation* (beyond explicit connectors) is acceptable, and how is it made transparent and revocable?
2. Task → wrapp routing accuracy — how good must it be, and what's the fallback when it's unsure?
3. `.md` files vs a structured store as the task substrate — Bank is `.md`; do status rollups need a DB, or do we parse the files?
4. taskOS's privileged breadth — how do we present "this wrapp can see across your work" consent clearly without alarming, given it's first-party?
5. Where does a wrapp actually render — embedded in the homepage or its own tab — and how does taskOS hand off to it and get the artifact back?
6. The single-device (local daemon) present vs the shared-storage future — what's the bridge, and what breaks without it?
