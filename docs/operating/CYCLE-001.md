# Cycle 001 — real deliverables (Switchboard)

All grounded in the **live** landing (thelastprompt.ai/switchboard/) fetched 2026-08-04 and the real
repo. Everything outbound below is **DRAFT — staged for founder approval**; nothing has been posted,
emailed, or deployed.

---

## 1. Landing audit (real — against the live page)

**Live hero, verbatim:**
- Headline: **"Bring your own AI"**
- Subhead: *"Run AI apps on the Claude Code subscription you already pay for — private by default, personal from the first second, no signup."*
- Primary CTA: **"Download for Mac"**
- Section order: one board / set up in 2 minutes / the same job, two ways / personalised by default / what makes it different / the wrapp store / pricing / how the call gets connected / trust model / team mode / for builders / faq / the board is live.

**Highest-impact issue — the page undersells its own catalog.**
The page says **"20+ wrapps."** The real catalog is **76** (source of truth: `catalog.json`, corroborated
by 76 manifests). Undercounting by ~3.7× throws away the single most tangible proof that this is a real
platform, not a demo. **Fix:** change "20+" → "76 wrapps" everywhere, and reconcile any other stale
surface (README, store) to 76. Reversible, high-trust, minutes of work — but the live landing lives in
the separate `thelastprompt.ai` deploy repo, so it needs that repo + a deploy (a gated step).

**Other real issues (ranked):**
2. **Hero doesn't say what you get in 5s.** "Bring your own AI" is a mechanism, not an outcome. A
   first-timer doesn't learn there's a *store of 76 apps* until section 6. Lead with the outcome.
3. **CTA is one-note.** "Download for Mac" asks for a commitment before the value is shown, and
   excludes non-Mac lookers. Add a low-commitment secondary CTA: **"Browse the 76 wrapps →"**.
4. **The differentiator is buried at #5** ("what makes it different"). The five-noes / "nothing
   leaves your machine" story is the wedge — it should be visible above the fold.
5. **No proof-of-life above the fold.** "the board is live" is the last section; a live tile or the
   real count belongs higher.

**Hero rewrite — 2 variants + ⭐ recommended** (keeps the real voice; no invented claims):
- ⭐ **A —** Headline: *"76 AI apps that run on the Claude you already pay for."* Subhead: *"Private by
  default, personal from the first second, no signup — your files and keys never leave your machine."*
  CTAs: **"Download for Mac"** + **"Browse the 76 wrapps →"**
- **B —** Headline: *"Bring your own AI. Run anything."* Subhead: *"76 wrapps on your own Claude Code
  subscription — nothing leaves your machine, no signup, $0 to the app."* CTAs: same.
  _(A leads with the concrete outcome + proof; B keeps the current headline and adds the number.)_

---

## 2. Launch content — DRAFT, staged for approval

> Confirm before posting: the exact **"five noes"** wording, the live **count to advertise** (76 vs a
> vetted subset), and the current **download/store URLs**.

### Show HN (plain, technical register)
**Title:** `Show HN: Switchboard – run web apps on your own Claude subscription (BYO-AI, MIT)`

**Body:**
> Switchboard is an open-source "MetaMask, but for AI." A local daemon holds your Claude (or a local
> model) and your connected MCP tools; a browser extension injects a standard `window.claude` provider
> into any page, so a website runs on *your* model, tools, and data — it never holds an API key, sees a
> credential, or pays for inference. Every sensitive action goes through a scoped, per-origin consent
> prompt (think EIP-1193, but the asset is your Claude + context).
>
> Why it might interest you: the economics invert (the site runs on the visitor's compute, not the
> operator's bill), apps inherit every MCP tool you've already connected, and your files/keys stay
> local. It's MIT, and it ships with a catalog of 76 "wrapps" (skins over Claude Code) — a store, a
> brand-kit generator, meeting notes, ad tools, etc.
>
> Early and honest about it: it's a Mac DMG + a Chrome extension today, and the consent broker is the
> part we care most about getting right. Repo and a 2-minute setup in the link. Feedback on the trust
> model especially welcome.

### Product Hunt
- **Tagline (≤60):** `Run AI apps on the Claude you already pay for` (56)
- **One-liner:** `76 private, no-signup AI apps that run on your own Claude — nothing leaves your machine.`
- **Description (3 paras):**
  1. Switchboard is a wallet for AI. You own three things — your inference (Claude), your context
     (portable brand/project knowledge), and an app's backend run locally — and lend them to apps
     under explicit, revocable consent. Apps you don't have to trust with your whole life get exactly
     the one thing you hand them, for the session.
  2. That flips the model: apps run on *your* compute (not the operator's bill), inherit the MCP tools
     you've already connected, and never see your keys or files. Open source, MIT.
  3. It comes with 76 wrapps out of the box — a store, brand-kit and logo generators, meeting notes,
     ad and content tools — all running on your own Claude, no signup, $0 to the app. Download for
     Mac, connect once, and every wrapp just works.

### X / Twitter — 5 posts (varied angles, no hashtag spam)
1. **Thesis:** Every AI app wants your API key, your signup, and your data. Switchboard flips it: apps
   run on *your* Claude subscription, and nothing leaves your machine. 76 of them, open source. BYO-AI.
2. **Concrete demo:** Same prompt, two ways — paste it into a chatbot, or run a wrapp that already
   knows your brand, files, and tools. The wrapp wins because the context is *yours* and it never left.
3. **Privacy:** No signup. No API key. No inference bill. Nothing leaves your machine. Your keys and
   files stay local; only prompts reach the model. Private by default, personal from second one.
4. **Open-source / builder:** Ship an AI app with no backend and no inference cost — it runs on the
   visitor's own Claude and inherits their tools. `window.claude`, like `window.ethereum`. MIT.
5. **CTA:** 76 AI apps that run on the Claude you already pay for. Download, connect once, done →
   [store link]

### Changelog — "what shipped recently" (from real commits)
- **v0.3.0** — wrapps are prebundled and served locally; the DMG is a real, shippable install.
- **⌥⌥ launcher + 39 interactive notch widgets**, panel v2, guides-as-a-capability.
- **CREST** — a brief-in, logo-out brand-kit wrapp (palette + font pairing, exportable PDF).
- **Deck / Dub / Huddle** — slides→pptx, per-speaker TTS revoice, meeting notes.
- **Onboarding** — adaptive full-journey concierge with spoken voiceover.

### Launch email (warm list) — DRAFT
- **Subject:** `Switchboard is live — 76 AI apps on your own Claude`
- **Body:**
  > Short version: Switchboard lets you run AI apps on the Claude Code subscription you already pay
  > for — private by default, no signup, nothing leaves your machine. It ships with 76 apps today.
  >
  > It's open source (MIT), it's a 2-minute Mac install, and the whole thing is built around one idea:
  > you own your AI, your context, and your data, and you lend them to apps under consent — revocably,
  > one session at a time.
  >
  > If you try it, the one thing I'd love feedback on is the trust model. [Download] · [Browse the apps]
  >
  > — [founder]

---

## 3. The one reversible fix I can do in-repo now (proposed)

Reconcile the catalog number **in this repo** (README / store copy) to **76**, so at least the sources
that live here stop contradicting each other. The live landing's "20+ → 76" needs the deploy repo, so
that one stays a founder/access item. Say the word and I'll make the in-repo edits (still reversible;
no push/deploy without your go).
