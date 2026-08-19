# First 10 real users — the distribution playbook

_Everything here is DRAFT — staged for the founder's send. Nothing posts itself. No invented people:
targets are real venues; individual names get filled in by you (or by a research pass you approve).
ICP per the context bank: **builders first** — devs/indie hackers who want to ship an AI app with no
backend, no API key, no inference bill._

## What counts (so we don't lie to ourselves)

A "design partner" = a real person who (1) installs, (2) runs a wrapp on their own Claude, and
(3) talks to us once about it. Ten of those beats a thousand impressions. Track in this file's
ledger (bottom) — real names/dates only, or it stays empty.

## The one ask (same everywhere, tuned per venue)

> I built an open-source thing: websites that run on *your* Claude subscription — no signup, no API
> key, your files never leave your machine. 76 apps work today. I need 10 people to break it and
> tell me where it snags. Mac + Claude Code sub required. [link]

Honest, specific, small ask, no hype. The "break it" framing recruits testers, not spectators.

## Venues, ranked (each with its angle)

| # | Venue | Why them | The angle | Format |
|---|---|---|---|---|
| 1 | **r/ClaudeAI** | literally people paying for Claude — the BYO pitch needs zero explanation | "get more out of the sub you already pay for" | post + comments |
| 2 | **MCP / Claude-dev Discords** | already connect tools to Claude; capability-inheritance lands instantly | "your MCP tools work in every wrapp, zero OAuth" | short message in #show-your-stuff-style channels |
| 3 | **r/LocalLLaMA** | privacy-first, local-first values match the five noes | "nothing leaves your machine" lead; be upfront it's Claude (cloud model, local data) or they'll call it out | post |
| 4 | **Hacker News — Show HN** | the drafted post exists (CYCLE-001); technical, tolerant of early | consent-broker architecture + `window.claude` as EIP-1193 analog | Show HN (fire once, when D1-cold + demo are live) |
| 5 | **X — builder/AI dev circles** | the founder's own graph; warm | the 90s "two ways" demo clip quote-tweetable | thread (drafted in CYCLE-001) |
| 6 | **Indie Hackers** | "ship without a backend" = their economics | "your app, zero inference cost — it runs on the visitor's Claude" | post |
| 7 | **lobste.rs** | security-literate; the consent gate is the story | broker/consent design writeup | link post (needs an invite — founder has/gets one) |
| 8 | **Product Hunt** | later — after funnel is tighter | drafted tagline/description exist | hold |

Sequencing: **2 → 1 → 3 → 5** first (small rooms, fast feedback, low blast radius), then HN when the
cold-install path is verified. PH last. This inverts "big launch first" on purpose: 10 partners from
small rooms de-risk the one-shot venues.

## Ready-to-send drafts

### Discord/DM (venue 2) — short
> Built something the MCP crowd might actually use: an open-source consent broker that injects
> `window.claude` into any site, so web apps run on *your* Claude + *your* connected MCP tools —
> the app never sees a key and OAuths nothing. 76 apps ship with it. Looking for ~10 people to
> break it (Mac + Claude Code sub). Repo: [link] — brutal feedback wanted.

### r/ClaudeAI post (venue 1)
> **Title:** I made your Claude Code subscription power 76 web apps (open-source, no signup, nothing leaves your machine)
> **Body:** You already pay for Claude. Switchboard is a local daemon + extension that lets websites
> run on it — with per-action consent, so an app gets exactly what you grant, for the session. No
> API keys, no signup, your files stay local. It's MIT and early: I want 10 people to install it,
> run a wrapp, and tell me where it snags. What I'd love feedback on most: the trust model. [link]

### r/LocalLLaMA post (venue 3) — honesty-first variant
> **Title:** Local-first consent broker for AI apps — your data never leaves, the model is your own Claude sub
> **Body:** Upfront: the model is Claude (cloud), not local — but everything else is: credentials,
> files, and context stay on your machine; only prompts go up; every sensitive action is a local
> per-origin consent prompt; local models are on the roadmap via the same broker. If "apps I don't
> have to trust with my whole life" resonates, I need testers. MIT. [link]

### Indie Hackers post (venue 6)
> **Title:** Ship an AI app with no backend and a $0 inference bill
> **Body:** My weird bet: the visitor brings the AI. Switchboard apps run on the *user's* Claude
> subscription and inherit the tools they've already connected — so you ship static files, pay for
> no inference, store no keys, and privacy is the default. 76 apps in the store, MIT license.
> Looking for 10 builders to try shipping one. [link]

## Before ANY send (the gate)

- [ ] Cold-install D1 verified once on a clean machine (else early testers hit the wall for us)
- [ ] The link: decide landing vs repo per venue (repo for HN/lobste.rs; landing elsewhere)
- [ ] Landing says **76** (not 20+) so the claim matches the pitch
- [ ] Founder confirms the exact five-noes wording used in venue 3's honesty framing

## Ledger (real people only — starts empty, honestly)

| date | who | venue | installed? | ran a wrapp? | talked? | notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |
