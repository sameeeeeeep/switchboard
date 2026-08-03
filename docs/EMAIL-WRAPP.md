# Reachout — the B2B email wrapp (and Switchboard's own growth engine)

**Status:** design. No implementation yet. This doc specifies a wrapp (`reachout`) that turns a lead
list into a personalized outreach *sequence* drafted on the user's own Claude, staged as Gmail
**drafts** (never auto-sent), advanced by a **routine** while the founder is away, with **every actual
SEND a human click at the notch**.

**The twist (dogfood):** Switchboard runs its OWN founder-led outreach through this wrapp. "Everything
we need to run Switchboard should be done via Switchboard (its own wrapps)." Reachout is how we grow,
so building it well is not a side quest — it is the growth loop.

**Related & cited:**
- Cold-email wrapp (the seed): [`examples/apps/src/coldemail.js`](../examples/apps/src/coldemail.js), manifest [`examples/apps/wrapps/coldemail/switchboard.json`](../examples/apps/wrapps/coldemail/switchboard.json)
- The `run(input, sb)` core seam: [`examples/apps/src/core/adpulse.core.js`](../examples/apps/src/core/adpulse.core.js), [`examples/apps/src/core/batch.core.js`](../examples/apps/src/core/batch.core.js)
- The connector registry: [`packages/switchboard-mcp/registry.mjs`](../packages/switchboard-mcp/registry.mjs)
- Headless-actions spec: [`docs/WRAPPS-FOR-AGENTS.md`](./WRAPPS-FOR-AGENTS.md)
- God-callable page-tools + notch widget + the send-consent bar: [`docs/GOD-HANDS.md`](./GOD-HANDS.md), kit [`examples/apps/src/kit/webmcp.js`](../examples/apps/src/kit/webmcp.js)
- Routine doctrine (temporal capability, tiers, "send line never moves"): `docs/ROUTINES.md` + `packages/sidekick/src/routines/registry.ts` — **both live on branch `claude/autopilot-autonomous`, not this worktree** (memory: `relay-routines`). Autopilot ([`examples/apps/src/core/autopilot.core.js`](../examples/apps/src/core/autopilot.core.js)) is routine #1; Reachout's sender is routine #2.
- SDK surface (`stream`/`complete`/`callTool`/`context`/`storage`): [`packages/sdk/src/index.ts`](../packages/sdk/src/index.ts)
- Brand/ICP context shape: [`docs/CONTEXT-KINDS.md`](./CONTEXT-KINDS.md) `kind:"brand"`

---

## 0. What we are NOT building (the survey's verdict, kept)

The prior B2B survey concluded: **do not port an OSS mail-sender.** We own no SMTP, warm no IPs, buy no
lead database. Switchboard is a broker, not an ESP. Instead:

- **The mailbox is a rented connector.** Gmail is already a first-class connector in this codebase —
  `mcp__claude_ai_Gmail__*` with `create_draft` / `search` appear in [`examples/apps/index.html`](../examples/apps/index.html) and the gate's wildcard-grant form. A CRM (HubSpot/Attio) can ride the same `sb.callTool` seam later. We call `create_draft`; **we never call a `send` tool** (see §6).
- **The flagship is a routine, not a blast.** "Reachout" = a daemon-controlled routine that *drafts and
  advances a cadence* autonomously and **surfaces each send as a notch click.** Drafts are autonomous;
  sends are human. This is the exact line ROUTINES.md draws: "no tier sends/publishes/charges
  unattended."
- **Minimal new engine.** Reachout = coldemail's prompt, grown from one email to a sequence, wrapped in
  the proven `run(input, sb)` core seam (adpulse/batch), staged through the existing connector
  `callTool` gate, scheduled by the existing routine registry. The only genuinely new code is the
  sequence prompt, the lead ledger, and a thin "stage a draft" call.

---

## 1. The wrapp

### 1.1 Shape (the five house doctrines)

Reachout obeys the same five as every wrapp (see the coldemail header): context-first · single input ·
options with exactly ONE recommended · house design system · one-go auto-advancing pipeline the user
can steer anywhere. It differs from a one-shot skill in one way: its unit of work is a **lead moving
through a sequence over days**, not a single answer. So it adds a **ledger** and a **cadence clock** on
top of the coldemail idiom.

### 1.2 Inputs (context-first)

1. **The ICP / brand context** (`sb.context.active()`) — the *sender's* side. Reuses `kind:"brand"`
   (`oneLine`, `voice`, `positioning`, `audience`, `products`) exactly as adpulse/autopilot consume it
   ([`docs/CONTEXT-KINDS.md`](./CONTEXT-KINDS.md)). This is what makes the copy *ours*, not generic:
   the sequence is grounded in how Switchboard actually talks. (A dedicated `kind:"icp"` is a later
   nicety; brand carries enough to start — do not block on a new kind.)
2. **The lead list** — the *recipients*. A pasted CSV/table or a connector pull, normalized to one row
   per lead: `{ email, name, company, role, hook }` where `hook` is the one true, specific reason we're
   reaching *this* person (a launch, a post, a shared portfolio, a job posting). The hook is mandatory
   and never fabricated (§6). Parsing reuses adpulse's `parseCsv` verbatim — it already handles quoted
   commas / CRLF ([`adpulse.core.js`](../examples/apps/src/core/adpulse.core.js) lines 22–42).
3. **The sequence shape** — how many touches and the cadence. Offered as option cards with ONE
   recommended, e.g. *"3 touches over 8 days (recommended)"* / *"2 touches over 5 days"* / *"single
   email."* The founder can steer ("make it 4, space it wider").

### 1.3 The output: a per-lead sequence, staged as drafts

For each lead the wrapp drafts a **sequence** — a first touch + N follow-ups — each grounded in the ICP
context AND that lead's hook. A follow-up is *not* "just checking in"; it advances a real reason (a new
proof point, a different angle on the same value, per objection.js's calm-honest register). Each drafted
email is immediately staged as a **Gmail draft** via `sb.callTool("mcp__claude_ai_Gmail__create_draft",
…)` and its `draftId` recorded in the ledger. Nothing is sent. The founder opens Gmail (or the notch
widget) to a queue of ready-to-send drafts, each one editable.

### 1.4 The lead ledger (`sb.storage`)

Per-origin, opaque-string storage ([`sdk/src/index.ts`](../packages/sdk/src/index.ts) lines 178–204;
key = a plain filename, never `:` — memory `relay-storage-key-rule`). One record per campaign:

```jsonc
// storage key: "reachout-<campaignId>"
{
  "id": "sw-founders-q3",
  "sequence": { "touches": 3, "spacingDays": [0, 3, 5] },
  "leads": [
    {
      "email": "a@acme.com", "name": "Ana", "company": "Acme", "role": "Founder",
      "hook": "shipped a Claude-powered onboarding flow last week",
      "stage": 1,                     // which touch they're on (0 = not started)
      "drafts": [                      // one per touch, as it gets drafted+staged
        { "touch": 1, "draftId": "r-abc", "subject": "…", "staged": 1730000000000, "sent": 1730100000000 },
        { "touch": 2, "draftId": "r-def", "subject": "…", "staged": 1730300000000, "sent": null }
      ],
      "status": "active",              // active | replied | bounced | done | paused
      "lastEvent": 1730300000000
    }
  ]
}
```

The ledger is the wrapp's whole memory: what's drafted, what's been sent (the founder marks a send, or a
reply-detection pass reads Gmail via `search`), and who's due for the next touch. **Cadence
auto-advances off the ledger, not off a send** — see §3.

### 1.5 Wrapp UI

Same house atoms as coldemail (`optionCards`, `steerRow`, `researching`, the connect chip via
`mountConnect`). Three screens:

- **Empty / connect** — the standard connect steps + a visibly-labeled sample lead so the state isn't
  dead (coldemail's `SAMPLE` idiom, lines 206–207).
- **Set up a campaign** — lend/confirm the ICP context (project chip), paste the lead list, pick a
  sequence shape (option cards, one recommended). One button: *"Draft the sequence."*
- **The campaign board** — a table of leads × touches. Each cell is a draft's state: `— · drafting… ·
  staged ✓ · sent`. Per-row steer ("warmer to this one", "shorten touch 2"). A header shows *"12 drafts
  staged in Gmail · 0 sent · next 4 due tomorrow."* The primary action is **"Review & send in
  Gmail"** — a link out, because the send lives where the human already trusts it. There is no "send
  all" button in the wrapp; that button does not exist by design (§6).

---

## 2. The headless core: `reachout.core.js` (the `run(input, sb)` seam)

Following [`docs/WRAPPS-FOR-AGENTS.md`](./WRAPPS-FOR-AGENTS.md) §1 and the adpulse/batch pattern: the
valuable middle is a **pure ESM module, no DOM**, with ONE definition and THREE clients — the DOM wrapp,
the switchboard MCP connector, and the routine. `sb` is the capability subset (`sb.stream`,
`sb.complete`, `sb.callTool`, `sb.context`, `sb.storage`). The harness supplies a mock `sb`; the daemon
supplies the gated one. Same functions, same output shape — that parity is the point.

```js
// examples/apps/src/core/reachout.core.js   — PURE ESM, NO DOM

export function parseLeads(text) { /* reuse adpulse parseCsv → [{email,name,company,role,hook}] */ }

/** The sequence prompt — coldemail's contract, grown from one email to N touches, grounded in the
 *  ICP context + this lead's hook. Same honesty rules as coldemail (no fabricated connection/claim). */
export function buildSequencePrompt({ lead, icp, sequence, steers }) { /* … */ }

/** THE ACTION #1 — draft one lead's whole sequence in ONE call. Returns { touches:[{subject,body}] }.
 *  Pure model call; no side effects. (This is what an agent or the harness calls.) */
export async function draftSequence(input, sb) {
  const lead = input?.lead;                 if (!lead?.email) throw new Error("draftSequence needs a lead {email, hook}.");
  const icp  = input?.icp || await sb.context.active().catch(() => null);
  const sequence = input?.sequence || { touches: 3, spacingDays: [0, 3, 5] };
  const prompt = buildSequencePrompt({ lead, icp, sequence, steers: input?.steers });
  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  return normalizeSequence(text, sequence.touches);   // {touches:[{subject,body}]}
}

/** THE ACTION #2 — draft a lead's NEXT due touch and STAGE it as a Gmail draft. The write-class step.
 *  This is the only function that touches a connector; it NEVER sends. */
export async function stageNextTouch(input, sb) {
  const { campaignId, email } = input;
  const state = await loadCampaign(sb, campaignId);
  const lead  = state.leads.find((l) => l.email === email);
  const touch = lead.stage + 1;
  const seq   = await draftSequence({ lead, icp: input.icp, sequence: state.sequence }, sb);
  const draft = seq.touches[touch - 1];
  // create_draft — a DRAFT, not a send. Gmail's own tool has no "auto-send" here.
  const res = await sb.callTool("mcp__claude_ai_Gmail__create_draft", {
    to: lead.email, subject: draft.subject, body: draft.body,
    threadId: lead.drafts?.[0]?.threadId,      // follow-ups thread onto the first touch when known
  });
  lead.drafts.push({ touch, draftId: res?.draftId, subject: draft.subject, staged: Date.now(), sent: null });
  lead.stage = touch; lead.lastEvent = Date.now();
  await saveCampaign(sb, campaignId, state);
  return { staged: true, touch, draftId: res?.draftId };
}

/** THE ACTION #3 — the routine tick: advance every lead whose next touch is due; stage its draft.
 *  Returns tokens spent (the routine registry's contract). Drafts autonomously; sends nothing. */
export async function tick(input, sb) {
  const state = await loadCampaign(sb, input.campaignId);
  let spent = 0;
  for (const lead of state.leads) {
    if (lead.status !== "active") continue;
    if (!isTouchDue(lead, state.sequence)) continue;       // spacingDays elapsed since last event?
    await stageNextTouch({ campaignId: input.campaignId, email: lead.email }, sb);
    spent += 1;                                            // 1 model call per staged touch
  }
  return spent;
}

export const manifest = {
  name: "reachout",
  title: "Reachout",
  origin: "https://reachout.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand"], tools: ["mcp__claude_ai_Gmail__*"] },
  actions: [
    { name: "draftSequence", summary: "Draft a full outreach sequence for one lead, grounded in the ICP + the lead's hook. No side effects.", input: {/*…*/}, output: {/*…*/}, run: draftSequence },
    { name: "stageNextTouch", summary: "Draft a lead's next due touch and stage it as a Gmail DRAFT (never sends).", input: {/*…*/}, output: {/*…*/}, run: stageNextTouch },
  ],
};
export default manifest;
```

Register it exactly like adpulse in [`packages/switchboard-mcp/registry.mjs`](../packages/switchboard-mcp/registry.mjs):
`import reachout from "…/reachout.core.js"` → add to `MANIFESTS`. That one line renders three ways:
DOM wrapp, MCP tool (`wrapp__reachout__draftSequence`), and the routine's `tick`.

**Scope note — the one new grant.** coldemail is `tools: []` (text-only). Reachout adds
`tools: ["mcp__claude_ai_Gmail__*"]` — the whole-connector wildcard, the ONLY form the gate accepts
(coldemail CONFIG comment, line 19). `create_draft` is inside that grant; a hypothetical `send` tool
would ALSO be inside it — which is exactly why the human-send discipline is enforced in *our* code and
at the *notch*, not left to the grant boundary (§6).

### 2.1 God's hand (the notch)

Per [`docs/GOD-HANDS.md`](./GOD-HANDS.md), Reachout exposes one page-tool via `exposeToGod`
([`kit/webmcp.js`](../examples/apps/src/kit/webmcp.js)) that drives the real pipeline so the user
watches it happen — e.g. `reachout_draft` (draft/stage the next due touches for a campaign, rendered
live on the board). Two consent bars apply, unchanged:
- **Adding the hand = the read/draft grant** (one-time; GOD-HANDS decision #1). God may draft and stage
  drafts freely thereafter, every call gated + audited by the daemon.
- **A send is the reserved notch confirm** (GOD-HANDS decision #1: "reserved ONLY for genuinely
  destructive / outward-facing actions — send, pay, publish, delete"). The notch widget renders the
  next due email as a card; **the founder taps "Send" on the card** — that tap is the outward action, an
  `ActionConsentDrop`-class click God can never fake.

---

## 3. The routine tie-in ("Reachout" = routine #2)

Routines are the **temporal** capability (memory `relay-routines`; doctrine `docs/ROUTINES.md` +
scheduler `packages/sidekick/src/routines/registry.ts`, both on branch `claude/autopilot-autonomous`).
A connector = "do this now, with consent"; a routine = "keep doing this while I'm away, with consent."
**Autopilot is routine #1** (`tick():Promise<number>`, self-scheduled → registry-driven). **Reachout's
sender is routine #2** — the same shape, the `daemon-controlled` tier:

- **Tier:** daemon-controlled — gated `complete()`/`stream()` + `sb.storage` + connector `callTool`.
  Cheap, always-on, reversible. Reachout drafts and *advances a cadence*; it never edits code and never
  sends. (The heavier `claude-code-controlled` tier is not needed here.)
- **Declaration:** the wrapp declares a routine `{ id:"reachout-send", schedule:"daily 09:00", tier:"daemon",
  scope:{ models:["sonnet"], tools:["mcp__claude_ai_Gmail__*"] } }`. Registering the routine is its own
  **standing grant** ("run in background, on my Claude, drafting outreach for campaign X").
- **The clock is the daemon's.** Each tick, the registry calls `reachout.tick({campaignId}, sb)`, which
  stages the next due touch for every active lead and returns tokens spent (registry tracks spend in
  `~/.relay/routines.json`). The founder wakes up to a Gmail full of *fresh, personalized, staged*
  drafts.
- **Control plane = the menubar** (background work happens with every tab closed). `routines.json` =
  status the daemon writes; `routines-control.json` = `{off?, routines?:{"reachout-send":{off?}}}` = the
  kill switch + per-routine pause the menubar writes. Same two-file pattern autopilot uses; no daemon
  changes.
- **The send line never moves.** ROUTINES.md is explicit: *"no tier sends/publishes/charges unattended
  — always per-action consent."* The routine's job ends at `create_draft`. The send is a separate,
  human, per-message act (§6). This is the single most important sentence in the whole design.

So the founder's mental model: *"Reachout keeps my pipeline warm while I sleep — I approve the sends
over coffee."* Drafting is autonomous; sending is a ritual.

---

## 4. The Switchboard dogfood — we grow through our own wrapp

**Principle:** everything we need to run Switchboard is done via Switchboard's own wrapps. Reachout is
the growth engine, so we run OUR founder-led outreach through it. This is not a demo account — it is how
the company actually reaches its first thousand users.

### 4.1 The ICP context we lend it

We publish a `kind:"brand"` context named **"Switchboard"** (the same object every other wrapp
consumes): `oneLine` = the one-sentence pitch (privacy-led, per memory `relay-privacy-positioning`:
"your own Claude, no middleman, five noes"); `voice` = plain, technical, anti-hype (the same register
as our README and landing); `audience` = the segments below; `positioning` = "the wire is the product /
telephone-operator for your own Claude" (memory `relay-switchboard-thesis`). Every email is grounded in
this — so our outreach *sounds like us*, and improving the copy improves the context every wrapp shares.

### 4.2 The lists (concrete)

1. **Indie devs / wrapp builders** — people shipping Claude-powered apps who currently resell an API
   key or eat the inference. Hook: a repo or a launch that shows they're doing exactly the thing
   Switchboard removes the middleman for. Ask: *"port your app to a wrapp — your users bring their own
   Claude; you keep 75% of usage rev-share"* (memory `relay-monetization-model`).
2. **Founders doing manual cold outreach** — the meta list. Hook: they tweeted/posted about outbound.
   Ask: *"we grew Switchboard using a Switchboard wrapp that drafts on your own Claude and never
   auto-sends — want it?"* The pitch IS the proof.
3. **Privacy-sensitive teams** (legal, healthcare-adjacent, agencies handling client data) who can't
   send data to a third-party AI. Hook: a stated compliance posture. Ask: *"AI wrapps where no data
   leaves your machine — the model is yours."*
4. **YC / accelerator batchmates & alumni** — warm-ish, high-signal. Hook: their launch. Ask: a short
   demo. (Register per memory `relay-yc-register` — Switchboard-not-TLP framing.)

### 4.3 The sequences

- **Touch 1** — one genuine reason (the hook), one concrete value line grounded in the ICP context, one
  low-friction ask (coldemail's exact contract, lines 234). Under 6-word subject, 3–5 lines.
- **Touch 2 (+3 days)** — a *different* angle on the same value, or a proof point (a shipped wrapp, the
  75% number, the "no data leaves your machine" line). Never "just bumping this."
- **Touch 3 (+5 days)** — the calm, honest close (objection.js register): name the likely objection
  ("you already have a way to do outreach") and answer it in one line, then a clean opt-out.

### 4.4 The story ("we use our own product to grow")

This is a narrative asset, not just an ops choice:
- **Landing / YC:** *"Our outreach runs on Switchboard. The emails that got you here were drafted on our
  own Claude, grounded in our own brand context, and staged as drafts a human sent. We didn't blast you
  — we wrote to you."* That sentence is only true because the wrapp is draft-not-send (§6), which makes
  it both the ethical posture AND the sales pitch. (Memory `copy-show-dont-tell`: the product proves the
  claim by being the thing that sent the email.)
- **Compounding dogfood:** every real campaign surfaces real gaps (a follow-up that reads robotic, a
  hook that's too thin) → we fix the prompt → every Switchboard user's Reachout gets better. We are our
  own most demanding user.
- **Rev-share honesty:** we run Reachout on our own Claude subscription like anyone else. No special
  path, no resold key (memory `relay-claude-code-terms`).

---

## 5. Why draft-not-send + own-Claude personalization is the anti-spam posture

The two design choices that look like limitations are actually the entire trust story.

1. **Own-Claude personalization defeats the spam economics.** Spam is cheap because it's untargeted at
   scale. Reachout's copy runs on *the sender's own Claude*, grounded in a real per-lead `hook` the
   sender supplied — the model is told, verbatim from coldemail (line 234), to *"never fabricate a
   shared connection or a false claim."* If a lead has no true hook, the wrapp asks for one rather than
   inventing one. That makes mass, hookless blasting structurally awkward: the wrapp's unit of work is
   *a real reason to email this person*. Personalization isn't a mail-merge token; it's a required,
   non-fabricated input.
2. **Draft-not-send keeps a human on every message.** No tier — not the wrapp, not the connector, not
   the routine, not God — sends unattended. `create_draft` is the terminal call; there is no
   `send_all`. The founder reads each draft in the surface they already trust (Gmail / the notch card)
   and sends it themselves. Volume is naturally throttled by human attention — the single best
   deliverability control there is, and the reason a mailbox stays warm instead of flagged.
3. **The mailbox is the user's own, reputation intact.** We warm no shared IP pool and we're not an
   ESP; each send goes out of the founder's real Gmail, on their real reputation, one human click at a
   time. There is no deliverability substrate for us to poison, and none for a bad actor to rent.

### Safeguards that keep it honest

| Safeguard | Mechanism | Cited |
|---|---|---|
| **No unattended send** | Routine ends at `create_draft`; no send tool is ever called; the send is an `ActionConsentDrop`-class notch click | ROUTINES.md "send line never moves"; [GOD-HANDS.md](./GOD-HANDS.md) #1 |
| **No fabricated hooks/claims** | The sequence prompt inherits coldemail's honesty clause verbatim; missing hook → the wrapp asks, per batch's `[bracketed]` honesty contract | [coldemail.js](../examples/apps/src/coldemail.js) L234; [batch.core.js](../examples/apps/src/core/batch.core.js) `HONESTY` |
| **Per-origin isolation + audit** | Every `stream`/`callTool` runs the daemon's gated loop; each call appends to `~/.relay/audit.log` | [WRAPPS-FOR-AGENTS.md](./WRAPPS-FOR-AGENTS.md) §2 |
| **Standing grant is revocable + paused from the menubar** | `routines-control.json` global kill + per-routine pause; the founder sees tokens spent while away | memory `relay-routines` |
| **One-click opt-out is drafted in** | Touch 3 includes a clean opt-out line; a `replied`/`unsubscribe` lead is marked `status:"done"` and never advanced | ledger §1.4 |
| **Reply detection stops the cadence** | A `search` pass over Gmail marks replied leads → routine skips them (never emails someone who answered) | `mcp__claude_ai_Gmail__search` |
| **Budgets** | The routine's `tick` returns tokens spent; registry enforces per-routine budget (accounting must count cached input — memory `relay-gate-token-accounting`) | registry.ts |

---

## 6. The invariant, stated once

**Drafts are autonomous. Sends are human.** The wrapp, the connector, the routine, and God may all
*draft and stage* freely under a one-time grant. A message leaves the mailbox only on a per-message
human click, in a trusted surface (Gmail or the notch card). There is no code path that sends without
that click, and we will not add one. This is simultaneously the anti-spam posture, the deliverability
strategy, and the growth story.

---

## 7. Phased build order (reuse coldemail + routines + connectors; minimal new engine)

Each phase is independently shippable and leaves the tree green.

**Phase 0 — the core seam (no UI, no connector).** Write `examples/apps/src/core/reachout.core.js` with
`parseLeads` (reuse adpulse `parseCsv`), `buildSequencePrompt` (grow coldemail's prompt to N touches),
`draftSequence`, and `normalizeSequence`. Register in
[`registry.mjs`](../packages/switchboard-mcp/registry.mjs). Verify headless via the harness's mock `sb`
(memory `relay-wrapp-test-harness`) and via `wrapp__reachout__draftSequence` from Claude Code. *No
sending, no Gmail, no DOM yet — pure text.* This alone is a usable agent tool.

**Phase 1 — the DOM wrapp (still no connector).** `examples/apps/src/reachout.js` + manifest
`examples/apps/wrapps/reachout/switchboard.json` (copy coldemail's, add `contextKinds:["brand"]`). Reuse
`mountConnect`, `optionCards`, `steerRow`. Screens: set-up (lend ICP, paste leads, pick sequence) →
campaign board. Output is copy-to-clipboard drafts + the ledger in `sb.storage`. Founder pastes into
Gmail by hand. Ships the whole value with zero new trust surface.

**Phase 2 — the Gmail connector (`create_draft` only).** Add `tools:["mcp__claude_ai_Gmail__*"]` to
scope; implement `stageNextTouch` → `sb.callTool("mcp__claude_ai_Gmail__create_draft", …)`. The board's
"stage" button now writes real Gmail drafts and records `draftId`. **Explicitly do not wire any send
tool.** Add the `search` reply-detection pass. This is the first phase that touches the outside world —
and it only ever creates drafts.

**Phase 3 — the routine (routine #2).** Add `tick(input, sb)` to the core; declare the `reachout-send`
routine (daemon tier) against the registry on `claude/autopilot-autonomous`. Wire the menubar
`routines.json`/`routines-control.json` rows (reuse autopilot's UI when it lands). Cadence now
auto-advances while the founder is away; sends remain manual. *Depends on the routines branch merging.*

**Phase 4 — God's hand + notch send.** `exposeToGod({ name:"reachout_draft", … })`. Build the notch
widget (GOD-HANDS decision #4, `text`/`cards` size class): the next due email as a card with an
`ActionConsentDrop`-class **Send** tap. This is where the human-send click moves to the notch.

**Phase 5 — dogfood live.** Publish the "Switchboard" brand context (§4.1), load the four lists (§4.2),
run the real campaign. Feed every rough draft back into `buildSequencePrompt`. Write the "our outreach
runs on Switchboard" line into the landing + YC app (§4.4).

**New code total:** one core file (sequence prompt + ledger helpers + 3 actions), one DOM wrapp (mostly
copied idiom), one `create_draft` call, one routine declaration. Everything else — parsing, the gated
loop, the connector transport, the scheduler, the notch consent bar, the audit log — already exists.
That is the "minimal new engine" bar the survey set.
