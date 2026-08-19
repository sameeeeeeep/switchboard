# Switchboard — context bank · INTENT feed

_The "what we're building and what 'done' means" half of the bank. COS diffs this against the STATE
feed (`state.md`, auto-extracted) to derive next steps (`NEXT-STEPS.md`). Reconstructed from the real
repo (README, MANIFESTO, the live landing) + the founder's strategic calls. Targets are aspirations,
not facts — every current number lives in `state.md`/`METRICS.md` and reads real-or-unknown._

## Thesis (from README, verified)
Switchboard is **"MetaMask, but for AI"**: a local consent-broker daemon holds your Claude + MCP
tools; a browser extension injects `window.claude` so **any site runs on the visitor's own model,
tools, and data** — no API key, no signup, nothing leaves the machine. **The consent broker is the
product; the plumbing is commodity.** Open source, MIT.

## ICP — builders first (founder's call, this session)
1. **Primary: developers / indie hackers** who want to ship an AI app with **no backend, no API key,
   no inference bill** (it runs on the visitor's Claude and inherits their MCP tools). They tolerate
   the install, get the strongest value, are reachable (HN/X/GitHub), and **become supply** (they
   build wrapps → the store fills → consumers follow).
2. Secondary: **privacy-conscious Claude power users** who want more from the sub they already pay for.
3. Consumers = **Phase 2**, pulled in later by wrapps worth using.

## Positioning
Privacy-led, glass-box, BYO. Live hero today: **"Bring your own AI."** The wedge line for builders:
*"Ship an AI app with no backend, no API key, no inference bill — it runs on your visitor's Claude."*

## North-star metric
**Weekly active wrapp-runs on connected Switchboards.** (Currently: unknown — not instrumented.)

## The "done" bar — go-live definition (made diffable/measurable)
A target is met only when it's **verified**, not asserted. Switchboard is "live" when:
- **D1** A stranger can **install → connect Claude → run a wrapp in under 3 minutes**, verified by a real human once.
- **D2** The public landing states the **true catalog number (76)** with **one clear primary CTA** and a **working download** of the latest signed DMG.
- **D3** A **no-install / try-before-install demo** delivers the "aha" *before* the install (the activation-cliff fix) — verified to actually run, not just present in the repo.
- **D4** The **north-star meter emits** a real (privacy-first, floored) weekly-active number — the loop is no longer blind.
- **D5** Launch assets are ready and **one launch is fired** (HN + founder X), from the founder's accounts.

## OKRs — Q (first)
**O: Go from "built" to "a stranger can adopt it," with eyes on.**
- **KR1** Verified new-user path (D1) works and is timed. — *state: unverified*
- **KR2** North-star meter live (D4) → a real weekly-active number exists. — *state: unknown/not instrumented*
- **KR3** ≥5 design-partner builders install and ship a wrapp. — *state: 0 / unknown*
- **KR4** One launch fired (D5). — *state: drafted, not fired*

## Standing constraints (from the record)
- **Honest boundary:** COS drafts everything reversible; **sends/deploys/charges nothing** without a
  connected lane + the founder's go. Every number real or "unknown."
- **Local-first / privacy is the moat** — no metric or feature may break "nothing leaves your machine."
- **Not needed to go live:** payments, entity, revenue (free + BYO). Don't let them scope-creep the launch.
