---
name: wrapp
description: Generate a new Switchboard wrapp from a one-line idea, CARVE a feature out of an existing app into its own wrapp, or COMPOSE elements from several apps into one. Copies the house template (plumbing, SDK contracts, and design system already correct) so generation only writes the app-specific pipeline. Use for "make a wrapp that…", "new wrapp", "carve X into a wrapp", "add an app to the store".
---

# One-line idea → shipped wrapp

A wrapp = one static page + one esbuild bundle in `examples/apps` (`<id>.html` + `src/<id>.js`),
running on the visitor's own Claude via `@relay/sdk`. **All plumbing is already correct in this
folder's `template.html` / `template.js` — copy it, never retype it, never guess SDK shapes.**
The token cost of a new wrapp should be ~only its CONFIG, prompts, pipeline, and hero copy.

## Procedure

**1 · Spec (think, don't ask).** From the one-line idea derive:
- `id` (short slug — becomes the filename, build entry, and eventual `<id>.thelastprompt.ai`), name, tagline
- the ONE primary input (a line / a URL / a paste / a file / "your brand" = zero input from lent context)
- scope: models, **exact** tool names, `contextKinds` only if the app lists the user's contexts
- context participation: `"single"` (consumes one lent context — founder tools) or `"none"` (fun/standalone)
- the pipeline: 2–4 auto-advancing stages, each ending in option cards or an artifact
- store section in `src/store/catalog.js` (founder stack / after hours / play & make)

Only ask the user when the idea is genuinely ambiguous. State the spec in one short paragraph, then build.

**2 · Copy, then edit.**
```bash
cp .claude/skills/wrapp/template.html examples/apps/<id>.html
cp .claude/skills/wrapp/template.js  examples/apps/src/<id>.js
```
Edit ONLY:
- html: `<title>`, word mark, hero `h1`/`p`, `./dist/<id>.js` script src, app CSS **at the end** of the style block
- js: the `CONFIG` block + everything below the `APP LOGIC` line (prompts, stages, render)

The plumbing between CONFIG and APP LOGIC stays byte-identical. It encodes the returning-user
probe, the stream contract, timeouts, context sync, storage, and the option-card atom — all
previously debugged; re-deriving any of it is how wrapps break.

**3 · Wire up — AFTER the files exist.** esbuild aborts the whole multi-entry build on one missing
source, so never pre-wire entries (this killed builds before):
- add `<id>: "src/<id>.js"` to `entryPoints` in `examples/apps/build.mjs`
- add a catalog entry in `examples/apps/src/store/catalog.js` (href `./<id>.html` until deployed;
  token numbers are dev-reported)
- add the store CARD in `examples/apps/index.html` (the `<a class="card" data-app="<id>" …>` block
  in the right section, with `data-tags` for search and an accent `--c`) — catalog.js only
  DECORATES cards with receipts/tiers; the card markup itself is static in index.html

**4 · Build + verify.** `cd examples/apps && npm run build`. Serve via the `apps` launch config
(port 5174), open `/<id>.html`, and gate on:
- zero console errors
- pre-connect state is honest and explorable (steps card, labeled samples only)
- the untouched `mountConnect` chip in `#chip-dock` — never a custom connect button
- the five doctrine gates below

**5 · Offer, don't do unasked:** deploy as its own repo + subdomain per
`docs/PORTING-AND-DEPLOY.md` (per-wrapp origins are required — grants/storage/trust are per-origin).

## The five doctrine gates (every wrapp)

1. **Context-first** — on connect read `context.active()`; everything derives from the lent context
   (products, voice, palette). Hardcoded samples only pre-connect, visibly labeled, gone on connect.
2. **Single input** — one line / one URL / one paste, or zero input from the lent context. Never a form.
3. **Options, not answers** — every generative step returns 2–4 distinct cards with exactly ONE
   recommended; regenerate/steer on everything.
4. **House design system** for brand/founder tools (the template's tokens ARE it). Fun apps may keep
   their own art direction — that exemption is explicit, everything else isn't.
5. **One-go UX** — the pipeline auto-advances from the single input to the finished artifact; the
   user can steer or re-run at ANY point. Never form → button → output → next form.
6. **The cold open (THE demo, THE selling moment)** — when a context is lent, the wrapp launches its
   FULL workflow on connect with ZERO input: no form, no prompt, no button. "Connect Switchboard, and
   something is already happening — on your stuff." The value is on screen before the user types a
   character; the app demonstrates itself by *running*, not by an AI salesperson demoing it. Wire
   this in `autostart()`: `if (state.run) return; if (brand) void start(seedFromContext)`. Fire only
   when the lent context makes the run unambiguously useful; never re-fire over a saved run; keep it
   interruptible (one-go doctrine). Reference: Prism (imagegen) — connect a brand, its product images
   are already generating. This is Switchboard's answer to the AI-diffusion "demo gap": remove the
   tax so completely that trying the product and seeing its value are the same instant.

## Contracts that have burned us before (do not rediscover)

- **Stream deltas** (the #1 porting failure): `relay.stream()` yields `{type:"text",text}`,
  `{type:"tool_proposed",call}`, `{type:"tool_result",result}`, `{type:"error",error:{message}}`,
  `{type:"done",result}`. `relay.complete()` resolves `{text,usage,stopReason}`. The template's
  `streamText` (with its 180s timeout + `it.return()`) is the only sanctioned wrapper.
- **Exact-match grants, default-deny.** Call only models/tools you declared; read the returned
  grant and handle partial approval. During dev, a scope edit does NOT reach an existing grant —
  disconnect and reconnect the chip after changing `scope`.
- **Higgsfield** = the whole-connector wildcard `mcp__claude_ai_Higgsfield__*`. Single tool names
  get denied, and any upload→generate→poll dance needs the wildcard anyway. Media upload flows:
  crib from `src/studio.js` / `src/imagegen.js`.
- **Palette is flat hex strings** (`data.palette: ["#4C6B2F", …]`) per `docs/CONTEXT-KINDS.md`; a
  new context kind's first producer must pin its shape there.
- **Storage values are opaque strings** — always `JSON.stringify`/`parse`. `bind` prompts; get/set
  in the private sandbox don't.
- **Rendering model/user HTML?** Sanitize + sandbox like `src/redline.js` (`sanitizedPreview`,
  `sandbox="allow-same-origin"`, `sanitizeSvg`). srcdoc is same-origin — unsanitized scripts could
  drive the app's grant.
- Full API + error codes: `docs/BUILDING-A-WRAPP.md`. Only read it when the template doesn't cover
  the need.

## Carve — one app's feature → its own wrapp

The second mode: extract a feature from an existing codebase (brandbrain, a wrapp, any app) into a
standalone wrapp. Parts of one app become many. The procedure is the same copy-then-edit flow with
one extra first step:

**0 · Separate essence from chassis.** Read the source feature and split it:
- **Essence (carries over):** the domain data (question lists, stage specs, scoring rubrics), the
  prompt contracts (honesty rules, word counts, angle instructions — copy these VERBATIM, they were
  tuned), the decision shape (what's an option, what's a pick, what steers), the export format.
- **Chassis (gets replaced by the template):** the host app's store/state, routes, board/lock
  machinery, auth, cross-feature deps. Never port chassis — the template IS the new chassis.
- **Grounding (gets re-plumbed):** wherever the feature read host-app state (locks, canvas,
  workspace), the wrapp reads the LENT CONTEXT + the single input + per-step steers instead.
  Contexts are the data bridge between carved wrapps — a producer app publishes
  (`context.publish`), the carved wrapp consumes (`context.active()`). Same honesty rule holds:
  drafts ground ONLY in context + input; missing facts are marked (`[your metric here]`), never
  fabricated.

Worked example — the YC composer carve (brandbrain → Batch): essence = the 8 `YC_QUESTIONS`, the
per-question drafting prompts from `spec.ts` (`yc-*` task `fields`), options-per-answer + steer +
stale, `ycMarkdown` export. Chassis left behind = the board, locks, refit cascade, workspace store.
Grounding swap = locked decisions → lent idea/project context + the founder's one line. Result:
`examples/apps/batch.html` + `src/batch.js`, app logic only.

## Compose — many elements → one wrapp

The reverse: a new wrapp assembles stages from several sources. Rules:
- Compose at the **stage boundary** (each stage = input → options/artifact).
- **Prompt-bearing stages get COPIED** into the new wrapp's APP LOGIC — each wrapp owns its prompts.
- **Deterministic, prompt-free elements** (recorders, parsers, renderers — no model calls, no
  daemon) live ONCE in `examples/apps/src/kit/` and ARE imported by any wrapp. A kit element
  injects its own house-token styles and carries zero app opinion. First resident:
  `kit/recorder.js` (screen/camera + mic capture → preview/timer/re-take/download; used by Batch's
  video stage AND the standalone Take wrapp — one element, two surfaces).
- Cross-wrapp DATA flows through **contexts** (publish/consume) or a shared **storage dialect**
  (bound folder with documented file shapes, like Bank's .md dialect) — never through shared JS.
- Keep ONE pipeline: composed stages still auto-advance as a single one-go flow.

## Reusable pipeline elements (crib, don't reinvent)

- multi-stage option pipeline with locks: `src/cast/{stages,gen,ui,state}.js`
- offline demo harness for a media pipeline: `src/cast/harness.js` (`?harness` boot)
- review-and-write-to-file loop (find/replace with whitespace-tolerant apply): `src/redline.js`
- CSV paste → instant no-AI stats + AI diagnosis: `src/adpulse.js`
- product-photo → Higgsfield shoot (media_upload dance): `src/studio.js`
- agentic connector discovery (model lists its own tools, reconnect with `<prefix>*`): `src/adpulse.js`
