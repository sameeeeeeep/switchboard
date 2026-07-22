# The Last Prompt: Wrapps and the Switchboard Broker

**Packaging AI fluency — and delivering it privately, on the user's own AI**

*thelastprompt.ai · July 2026 · draft*

---

## Abstract

Frontier models are already capable of most knowledge work. What separates the people for whom "superintelligence" is a daily reality from the people for whom it is a disappointing chat box is not access to better models — it is fluency: the skill of using AI, which is precisely the kind of skill AI was supposed to let us bypass. We argue this fluency gap is the binding constraint on AI adoption, and that it is compounded by four structural barriers — inference economics, cold context, the absence of a safe permission layer, and per-app siloing — that prevent fluency from being packaged and distributed even when someone has it. The Last Prompt is an AI lab organized around closing this gap. Its output is wrapps: wrappers, deliberately named, that seal the prompts, skills, workflows, and interface for one task into a static frontend. Its infrastructure is Switchboard: a browser extension plus local daemon that lets any wrapp run on the visitor's own AI — their Claude subscription or a local model — through a consent broker on the visitor's machine, so wrapps run private to the user, at no extra cost, with no installation and no signup. The broker is the sole enforcement point for permissions, is open source (MIT), and doubles as an un-fakeable usage meter, which makes an honest publisher-payout economy possible. We describe the fluency thesis, the wrapp format, the broker architecture and its security invariants, the economics they enable, and — precisely — what is built versus what is designed.

---

## 1. The gap is fluency, not capability

Two curves have diverged. The capability curve — what a frontier model can do under ideal conditions — has compounded for years. The adoption curve — what ordinary people do with AI in a normal day — has barely moved past a chat tab.

The usual explanations are model-shaped: hallucination, reliability, "not AGI yet." But the same models, on the same day, are running one-person companies for some users and generating slop for others. When outcomes diverge that widely on identical capability, the constraint is not the capability.

The constraint is a paradox specific to this technology: **AI makes it possible to bypass acquiring skill, but using it is a skill in itself.** A user no longer needs years of programming, design, or copywriting — yet the skill they skipped reappears in a new shape: knowing what to ask for, prompting with precision, arming the model with the right tools and skills, sharing the right context, adapting to the interface, and judging good output from plausible output. Call this *fluency*.

Getting the best out of frontier intelligence means knowing how to use it. So superintelligence is not arriving evenly; it is pooling around the fluent. For everyone else it is "in reach, yet not there" — visible in demos, absent from their inbox.

Formally, what a person actually gets from AI is a product of four factors:

> personal superintelligence = your model × your context × real permissions × fluency

A zero in any factor zeroes the product. The model factor is, to a first approximation, solved. For almost everyone, at least one of the remaining three is zero.

## 2. Why fluency doesn't spread on its own

If fluency is the constraint, the obvious fix is to package it: experts encode what they know, everyone else uses it. This is happening — as SaaS wrappers — and it is failing structurally, for four reasons that have nothing to do with the quality of the craft:

**2.1 Economics: someone has to pay for the tokens.** Every packaged-fluency app needs inference, so every app needs the user's card or the operator's API key. Users won't hold thirty AI subscriptions, so marginal apps never get opened. Operators can't fund strangers' inference, so open-source AI apps rate-limit, demand keys, or shut down — and "self-hostable" means almost nobody hosts it. Intelligence became abundant; access stayed retail, marked up per app.

**2.2 Context: every app starts cold.** The user re-teaches each new app their brand, files, and preferences, and the resulting context is then siloed inside that app. The fluency the package provides is undermined by the context it lacks.

**2.3 Trust: no safe way for untrusted software to touch real data.** The most valuable packaged workflows act on real email, real files, real money. Nothing lets an arbitrary website do that safely, because the industry keeps trying to make the *model* trustworthy — alignment, system prompts, guardrails — when the missing piece is an enforcement point outside the model entirely. Without one, packaged fluency stays quarantined in chat.

**2.4 Distribution: every app solves 2.1–2.3 alone.** Payment, context, and permission are rebuilt per app, behind per-app signups. The fixed cost of solving all three is why most packaged craft never escapes demo-hood — and why the "wrapper" business model degenerated into middleman economics: their model, your card, their markup.

None of these are intelligence problems. All four are plumbing, and plumbing is buildable now.

## 3. The Last Prompt: an AI lab

The Last Prompt is organized as a lab, not an app company. Its research question is narrow: for each real task, what is the *last prompt* — the exact prompts, sequence, tools, and taste that an expert would use, found once, so no user ever has to find it again? The lab's two outputs correspond to the two halves of the problem:

- **Wrapps** package fluency (§4) — closing the gap in §1.
- **Switchboard** delivers it (§5) — dissolving the four barriers in §2.

## 4. Wrapps: fluency as an artifact

A wrapp is a series of prompts, skills, workflows, and an interface that completes one task end to end. The name is deliberate. "Just a wrapper" was an insult about middleman economics; Switchboard deletes the middleman economics entirely — BYO model, no account, no markup, data stays local — and what remains is only the craft, which was the valuable part all along. A wrapp *is* the last prompt: already found, sequenced, and given an interface.

Technically, a wrapp is static files: a pure frontend published to a subdomain, running against the `window.claude` provider. It ships no server, holds no key, and pays for no inference. Because publishing costs nothing, the catalog can behave like a true library rather than a portfolio of hosted liabilities.

Two publisher paths exist. Existing apps adopt the platform with minimal change: an adapter runs their route handlers client-side and swaps their model-transport import for the provider — proven by porting a full production app (32 API routes) and roughly thirty apps since, including third-party open-source ones. And any developer with a working Claude Code skill or workflow is a latent wrapp publisher: the manifest embeds their craft, a template supplies the shell. Fluency is widely held in fragments; wrapps are the container that makes those fragments distributable.

## 5. Switchboard: the delivery substrate

Wrapps make a claim that should sound impossible: they run private to the user, on the user's own AI setup, at no extra cost, without installation or signup. Switchboard is the machinery that makes the claim true. It is three components:

**The extension** injects a `window.claude` provider into any page and serves as the *origin oracle*: the true origin of every request comes from the browser (content-script sender), never from page-supplied data. All permissions key on it. The extension speaks to the daemon over loopback WebSocket with a pairing token; pages never touch the daemon directly.

**The daemon** (the "sidekick") runs on the user's machine as a background service with a menu-bar face. It holds the model backend — the Claude Agent SDK as the reference backend, with local OpenAI-compatible runners (Ollama, LM Studio) as siblings behind the same surface — plus the user's MCP tools and bound folders. Local by default, private by default; the cloud only where the user chooses it. Because the daemon runs as the signed-in user, it inherits the user's existing claude.ai connectors with zero configuration. Secrets never cross the boundary: API keys and tool credentials stay with the daemon; pages receive results only.

**The consent broker** lives inside the daemon and is the *only* enforcement point — never the model. Its invariants:

- **Two consent tiers.** Reads are pre-approvable within a granted scope. Writes, irreversible actions, and anything touching money require a per-action consent popup, every time, non-bypassable.
- **Default-deny classification.** A daemon-side policy table classifies every tool; unknown tools are treated as dangerous.
- **Gated agentic loop.** The model may pick tools mid-reasoning, but every proposed call — including MCP tools and builtins — is arbitrated out-of-band by the broker, which can block on a human click. No prompt, and no output of any model, can widen scope.
- **Audit and control.** Append-only per-origin audit log, exportable; per-origin revoke; global kill switch.
- **Context is lent, not read.** Apps request context *kinds* at connect; enumeration returns metadata only, and reading data is one item at a time, granted, selected, and audited by name.

Untrusted third-party wrapps are designed to run in a sandboxed (airgapped) runtime so they cannot exfiltrate what they are lent. The broker is open source (MIT): a security primitive you cannot inspect is not one.

This dissolves the four barriers mechanically: the visitor's own model erases the app's inference bill (2.1); the daemon's context store makes knowledge portable across apps (2.2); the broker is the missing permission layer (2.3); and one provider surface means each problem is solved once, for every wrapp at once (2.4).

## 6. Economics

**Zero marginal cost of goods.** The visitor's own subscription covers inference, so roughly 90% of what a wrapp does can be free — for the user and the publisher alike. This inverts the standard failure mode: apps no longer die of their own success.

**One subscription instead of thirty.** Switchboard Pro is a single pooled subscription unlocking the premium tier across the entire catalog. Publishers are paid from the pool by metered usage share — approximately 75% to developers, 25% retained — the streaming model rather than per-use IAP: the people who found the craft get paid the way artists do, by how much their work is used, not by how well they gatekeep it.

**The meter is the trust.** A payout economy is only as honest as its measurement. Because the broker sits in the data path, it observes real per-wrapp token spend and tool calls; a page cannot inflate its own numbers. The same measurement funds two honesty features in the store: real broker-measured run cost per wrapp, and real build cost — only meter-measured numbers ever get a badge.

**Neutrality is the position no vendor can occupy.** A model vendor could build this pipe, but not a neutral one: a broker where any model backs any app makes the model interchangeable, which is a strange thing to fund if you sell inference. Switchboard sells neither models nor compute, which is precisely what makes its meter and its payouts credible.

**Longer-term direction:** the broker's ledger already resembles a wallet — inference as the fungible gas, context as the compounding asset — and publisher payouts can be denominated in compute credit, so a developer's first earning is a zero AI bill. A second, orthogonal line is enterprise governance: the same per-origin grants, budgets, audit log, and kill switch, sold to organizations adopting BYO-AI.

## 7. Context: the compounding asset

Models will be commodities; everyone will have one. What compounds is what yours knows about you. Switchboard treats context as a first-class, user-owned object: typed kinds (brand, personal, project, …) stored on the user's machine, browsable by the user, lent to apps under the enumeration-is-consented-metadata rule (§5). Work done with one wrapp enriches the same vault the next wrapp draws from — the anti-silo. This matters doubly under the fluency thesis: sharing the right context is one of the fluency skills most users lack, and a persistent, typed, lendable context store is that skill made structural. It is also the moat: an operator can copy an interface, but cannot clone context that never leaves the user's machine.

## 8. Status: built versus designed

In keeping with the meter's honesty rule, this section separates what runs from what is direction.

**Built and running (July 2026):** the consent broker with all invariants in §5; the extension (Chrome Web Store); the daemon on a Claude subscription or Ollama backend; the SDK and adapter; ~30 wrapps live on their own subdomains; the store at thelastprompt.ai/apps with an intent bar that routes a typed task to the right wrapp; a shared notes-and-tasks wrapp backed by the same file dialect; a headless harness that boots every wrapp against a mock provider (68 runs, 64 passing — the four non-passes are two wrapps whose scope requires a real bound folder or a live connector).

**Designed, not built:** the earn-and-payout economy (Pro tier, ledger, 75/25 distribution) — the meter that would feed it exists; the ledger and payouts do not. The sandboxed runtime for untrusted third-party wrapps is designed; today's catalog is first-party. The skill→wrapp publisher import path is specified, not shipped.

**Not yet demonstrated:** external usage at scale. The single riskiest assumption is behavioral, not technical: that a normal person will connect their own AI to a stranger's page. Everything in §5 exists to make the honest answer to "is that safe?" be *yes, verifiably*.

## 9. Risks and open questions

- **The consent-fatigue trade.** Per-action clicks on writes are the security model, and also a UX tax. The bet is that scoped reads plus per-action writes is the correct floor, and that consent UI can get better without the invariant getting weaker.
- **Platform dependence.** The reference backend rides commercial subscription terms and browser extension policy. Mitigation is architectural: the pluggable backend layer means local models are siblings, not fallbacks.
- **The craft-market cold start.** Supply that isn't the founder is the true chicken-and-egg. The wedge is open-source maintainers, who already have users and already cannot pay for their inference.
- **Fluency moves.** Models are getting better at eliciting intent, which erodes some of today's fluency gap. The bet is that the floor rises but the gap persists: better models raise what fluency can extract, and context, permissions, and economics — the other three factors — do not improve with model quality at all.
- **Security surface.** A broker that can touch real data is a target. The mitigations are the invariants themselves — default-deny, origin from the browser, out-of-band arbitration, open source — plus the position that a security primitive must be auditable to deserve adoption.

## 10. Conclusion

Superintelligence does not feel absent because the models are lacking. It feels absent because using frontier intelligence well is a skill — the one skill AI cannot bypass on its own — and because the structures that would let the fluent package their skill for everyone else were never built. The Last Prompt is a lab that does both halves: wrapps seal the craft — the prompts, skills, workflows, and interface for one task — and Switchboard delivers them on the intelligence you already own, fed by your own context, under consent no page or model output can forge. The last prompt is the one the user never has to write.

---

*Switchboard is open source under MIT: [github.com/sameeeeeeep/switchboard](https://github.com/sameeeeeeep/switchboard). The store is live at [thelastprompt.ai/apps](https://thelastprompt.ai/apps).*
