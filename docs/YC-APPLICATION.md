# Switchboard — YC application

## 1. Describe what your company does in 50 characters or less.

Spotify for AI tools — run on your own AI

## 2. What is your company going to make? Describe your product and what it does or will do.

Switchboard is a browser extension plus a local daemon. The daemon holds your Claude subscription —
or a local model — and your authorized tools and connectors; the extension injects a
`window.claude` provider into every page. Any website runs on the visitor's own model, tools, and
data — the operator holds no API key, pays no inference bill. We call these apps "wrapps" — they
ship only the interface.

A consent broker is the sole enforcement point: per-origin grants, read/write classification,
budgets, audit log, kill switch. Writes need an out-of-band human click no page or model output can
forge, and every request carries the browser-verified origin, so no site can spoof another.

The whole surface is a wallet — MetaMask for intelligence. Inference is the gas; your context is
the asset, the balance that compounds and makes the wallet yours. Developers earn inference back
when their wrapps run.

Two layers. **Switchboard**, the wallet, is open source (MIT, on GitHub) — a consent broker must be
auditable to be trusted. **Wrapps**, the marketplace, is the business: store, Pro subscription,
usage payout.

## 3. Why did you pick this idea to work on? Do you have domain expertise? How do you know people need what you're making?

There have never been more people building AI apps, and never a wider gap between how many build
and how many use. I think that gap is economic, not a quality problem. Every new app carries a
context cost — it starts cold, and you re-teach it your brand, your data, your preferences. A
switching cost — your work stays siloed inside it. A subscription it can't justify — nobody holds
20–30 AI subscriptions, so app #31 never gets a chance. And in the vibe-coding era, a new attitude:
"I could build this myself." So creators multiply faster than paying users. I've lived both sides.
I built brandbrain, an AI brand studio with 32 API routes, and watched users hesitate at yet
another signup asking for yet another API key. Then, solo, I ported that same 32-route app to run
client-side on the visitor's own Claude — no server, no keys, no signup.

## 4. What's new about what you're making? What substitutes do people resort to because it doesn't exist yet (or they don't know about it)?

This is the next step in how software has moved: static sites needed no backend; then apps grew
servers, databases, and auth; the store era solved distribution but left operators carrying the
backend and users paying per-app subscriptions. AI made that backend unaffordable for both. The
inversion is next — apps become interfaces again (wrapps are literally static files) and the user
brings the backend. We're the dev↔user marketplace for that step.

The substitutes are the tell — piracy behaviors of the pre-streaming era. People copy-paste between
their subscription and the tool they work in; they vibe-code a clone instead of subscribing;
developers ship their own key and rate-limit to survive. Most often, they never adopt.

What's new: an EIP-1193-style provider for AI — any origin borrows the visitor's model, tools, and
data through the broker, so a wrapp costs the visitor nothing new, the developer nothing to serve.
The store answers "I could build this myself" with a receipt: every wrapp shows its broker-measured
build cost — millions of tokens and updates — beside what a session costs on your subscription.
Nobody else can print that receipt, because nobody else holds the meter.

## 5. Who are your competitors? What do you understand about your business that they don't?

Three buckets: AI-wrapper SaaS that funds its own inference (Jasper, Copy.ai); agent platforms and
MCP hosts (GPTs, Poe) where the operator holds the key and your data; and bring-your-own-key
bolt-ons. What we understand: the consent broker is the product; the plumbing is commodity.
Everyone races to make agents do things — but the only thing that lets an untrusted site touch your
real Gmail, store, or files is an enforcement chokepoint the model can't talk its way past. It's
architectural, slow to copy, and we open-sourced it on purpose: an auditable wallet is how a
security primitive becomes a standard. It's also model-agnostic by design — the same provider
fronts a Claude subscription (the official Agent SDK, the user's own plan on their own machine) or
a local model, so no single vendor's decision can kill it. The business moat sits one layer up —
metering ledger, payout trust, the user's vault. And it compounds: context built in one wrapp and
lent to the next becomes switching cost no operator can clone, because it lives on the user's side.

## 6. How do or will you make money? How much could you make?

Music had this problem before Spotify: per-song pricing made no sense; people pirated, artists
earned nothing. Streaming made consumption rational — one subscription, play anything, artists paid
by plays. We're that model for AI apps.

Wrapps are ~90% free (the visitor's own subscription covers inference); one Switchboard Pro unlocks
the premium tier across every wrapp. Pro is the Spotify move: one price replacing the twenty
subscriptions people refuse to hold. We keep ~25% and pay ~75% to developers by metered usage —
plays, not downloads. The split is honest because we're in the data path: the broker meters real
per-wrapp spend, and a page can't fake its usage.

Payouts are denominated in inference — a developer's share arrives as compute credit to spend or
cash out, so the first thing a wrapp earns its builder is a zero AI bill.

How big? Arithmetic, not forecast: 1M Pro subscribers × $20/mo = $240M ARR; ~25% — $60M — is ours,
the rest flows to developers as inference. Our inference cost is ~zero — structural margin.

The cash line is enterprise: BYO-AI governance (audit log, scopes, budgets, kill switch), custom
wrapps, implementation — sold on the same broker to a buyer that doesn't need the catalog big
first.

## 7. How far along are you?

One week, solo, started 2026-07-07; public MIT repo. Proven end-to-end with runnable pass/fail
spikes: the gated agentic loop — a destructive write never executes even when the model proposes
it; the full pairing → consent → grant → read-auto/write-denied path over a real WebSocket; the
user's claude.ai connectors inherited with zero config (a real image generated through their own
Higgsfield connector); consent surviving Chrome service-worker eviction; an airgapped runner whose
exfiltration attempts are provably blocked; local models via Ollama, with the user's model choice
overriding the app's. Live: a wrapp store at thelastprompt.ai/apps, seven wrapps on their own
subdomains — including my 32-route brand studio ported to run fully client-side — and the extension
packaged for Chrome Web Store review. I built all of it — broker, extension, daemon, store, seven
apps — in that week. Honest gaps: local-model tool use fails closed (completion only), distribution
is macOS-first, and the consent UX is early.

## 8. How will you get users? If your idea faces a chicken-and-egg problem, how will you crack it?

Supply-first, like any marketplace. I ship the first-party wrapps myself (seven live) so the
install is worth it before third-party developers arrive, and I split my own monolith into small
entry tools — a user enters through one free tool, and the same portable brand object later
graduates them into the full studio, so the small door and the retention product share data. Demand
capture at the point of pain: the extension's widget appears on the exact paid tools people already
use (Canva, Notion, Meta Ads Manager) and offers "do this on your own Claude, free" — converting
existing intent instead of manufacturing it. The pitch: use what you already pay for, everywhere,
safely. For developers: your users bring the compute, you pay $0 to run AI. Enterprise governance
runs as a parallel motion that doesn't need the network effect, funding it.

---

# Interview prep (not part of the application)

**"Anthropic could block subscription use through your broker — or ship this themselves."**
The daemon uses the official Claude Code / Agent SDK, running the user's own subscription on the
user's own machine for their own use — a user exercising a plan they pay for, not key-resale or a
shared pool; we're demand-gen for subscriptions, not arbitrage. The provider is model-agnostic:
`window.claude` fronts a local Ollama model today (completion working), so a single-vendor block
degrades us, it doesn't kill us. And the moat isn't the model — it's the neutral, open-source
consent broker + metering ledger + user-owned vault that works across models; a model vendor is
structurally disinclined to build the thing that commoditizes its own model. If ToS explicitly
banned third-party brokering, that's a real risk — the mitigation is the multi-model posture, not
denial.

**"You're solo, on a trust product plus a marketplace. Why can you win alone?"**
The evidence is velocity: in one week, solo, I shipped the extension, daemon, seven live wrapps,
ported a 32-route production app fully client-side, and stood up a gated agentic loop with runnable
pass/fail spikes. The gap I can't cover alone is named — a security/distribution partner — and
open-sourcing the broker is partly a contributor-and-cofounder funnel. Not claiming solo is
optimal; showing I move, and asking for the person who de-risks trust and BD.

**"Zero users. Why believe anyone wants this?"**
True — one week old, external users zero, and I won't dress that up. Instead of faking traction I
removed the two reasons marketplaces stall: supply exists day one (seven wrapps, my own real app
ported), and the whole loop is dogfooded. The demand test is concrete and next: the widget on tools
people already pay for, offering "do this on your own Claude, free." Give me the batch; I'll come
back with an installed-and-retained number.

**"If 90% is free, why does anyone pay?"**
Pro isn't an upsell on a free product — it's the consolidation product: one price replacing the
twenty subscriptions people refuse to hold, unlocked across the entire catalog at once. The honest
answer on ARPU is that I'd rather show assumptions (labeled arithmetic in Q6) and a first real
cohort than a fabricated TAM.

**"A malicious wrapp or prompt injection drains someone's Gmail. What actually stops it?"**
Enforcement is out-of-band and default-deny: tool danger classified in the daemon — never by the
page or model — writes need a human click no output can satisfy, every request carries the
browser-verified origin, audit log and kill switch on top. Open-sourced so it's auditable, not
trust-me. Honest limits: consent UX is early, click-fatigue is a real failure mode to design
against, and there's no external security audit yet — that audit is exactly what I'd prioritize;
for this product, security review *is* the roadmap.
