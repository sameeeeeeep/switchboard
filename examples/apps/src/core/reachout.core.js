// Reachout — the B2B outreach ORCHESTRATION, split out from the DOM (docs/EMAIL-WRAPP.md §2 and
// docs/WRAPPS-FOR-AGENTS.md §1). This is the valuable middle: given a lead (+ ICP context), draft a
// personalized N-touch SEQUENCE on the user's own Claude, keep a per-campaign lead ledger, and — the
// one write-class step — STAGE the next due touch as a Gmail DRAFT via the connector. ONE definition,
// THREE clients: the DOM wrapp (src/reachout.js), the switchboard MCP connector (registry.mjs), and
// the routine tick (routine #2, on the unmerged routines branch).
//
// `sb` is the capability subset an action needs (the same surface the SDK's `relay` exposes):
//   sb.stream(params)  -> async-iterable<StreamDelta>   (the model call; how the sequence is drafted)
//   sb.callTool(name,a)-> { ok, content:[{type,text}] } (the connector; create_draft ONLY — see §6)
//   sb.context.active()-> Context|null                  (the ICP / brand — the sender's side)
//   sb.storage.get/set                                  (the lead ledger)
// The harness / a test supplies a MOCK sb; the daemon supplies the gated one. Same functions, same
// output shape — that parity is the whole point.
//
// THE INVARIANT (docs/EMAIL-WRAPP.md §6): Drafts are autonomous. Sends are human. Nothing in this file
// calls a send tool; `create_draft` is the terminal connector call, by design. There is no send path
// and we will not add one.
//
// PURE ESM, NO DOM: imports cleanly in Node (connector / routine / test) and the browser bundle.

// Reuse adpulse's battle-tested CSV parser VERBATIM (quoted commas, escaped quotes, CRLF) — §1.2.
import { parseCsv } from "./adpulse.core.js";

// ─────────────────────────── inputs: leads + ICP + sequence ───────────────────────────

/** Normalize a pasted CSV/table of leads to one row per lead: {email,name,company,role,hook}. The
 *  `hook` — the one true, specific reason to reach THIS person — is mandatory and NEVER fabricated
 *  (§6); a hookless row is kept but flagged so the UI/agent asks for a hook rather than inventing one.
 *  Header-driven (any column order); falls back to positional email/name when there's no header. */
export function parseLeads(text) {
  const grid = parseCsv(String(text || ""));
  if (!grid.length) return [];
  const H = grid[0].map((h) => h.trim().toLowerCase());
  const looksLikeHeader = H.some((h) => /email|e-mail|mail/.test(h)) || H.some((h) => /name|company|role|hook|reason/.test(h));
  const find = (re) => H.findIndex((h) => re.test(h));
  const col = looksLikeHeader
    ? { email: find(/email|e-mail|\bmail\b/), name: find(/^name|full ?name|contact/), company: find(/company|org|account/), role: find(/role|title|position/), hook: find(/hook|reason|why|note/) }
    : { email: 0, name: 1, company: 2, role: 3, hook: 4 };
  const rows = looksLikeHeader ? grid.slice(1) : grid;
  const pick = (r, i) => (i == null || i < 0 ? "" : String(r[i] ?? "").trim());
  const out = [];
  for (const r of rows) {
    const email = pick(r, col.email);
    if (!email || !/@/.test(email)) continue; // a lead is an email address
    out.push({
      email,
      name: pick(r, col.name),
      company: pick(r, col.company),
      role: pick(r, col.role),
      hook: pick(r, col.hook),
    });
  }
  return out;
}

/** Normalize a lent brand/ICP context (or any loose brand object) to the fields the prompt uses —
 *  the SENDER's side (§1.2). Mirrors adpulse.normalizeBrand's shape so a DTC brand context works as-is. */
export function normalizeIcp(ctx) {
  if (!ctx) return null;
  const d = ctx.data || ctx;
  const str = (v) => String(v ?? "").trim();
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  return {
    name: ctx.name || d.name || "the sender",
    oneLine: str(d.oneLine || d.tagline || d.positioning),
    voice: str(d.voice || d.vibe),
    positioning: str(d.positioning),
    audience: str(d.audience),
    products: arr(d.products).length ? arr(d.products) : arr(d.range),
  };
}

/** The default sequence: 3 touches over 8 days. `spacingDays[i]` = days after the PREVIOUS touch. */
export const DEFAULT_SEQUENCE = { touches: 3, spacingDays: [0, 3, 5] };

/** Offered sequence shapes — option cards with exactly ONE recommended (house doctrine, §1.1). */
export const SEQUENCE_OPTIONS = [
  { id: "s3", label: "3 touches over 8 days", touches: 3, spacingDays: [0, 3, 5], recommended: true },
  { id: "s2", label: "2 touches over 5 days", touches: 2, spacingDays: [0, 5], recommended: false },
  { id: "s1", label: "Single email", touches: 1, spacingDays: [0], recommended: false },
];

// ─────────────────────────── the sequence prompt (coldemail's contract, grown to N) ───────────────────────────

/** The honesty clause — inherited VERBATIM from coldemail (src/coldemail.js L234): never fabricate a
 *  shared connection or a false claim. The anti-spam posture starts here (§5.1). */
export const HONESTY =
  "Keep it human — no flattery, no buzzwords, no fake urgency. Never fabricate a shared connection or a false claim. If the lead's hook is thin or missing, write around it honestly — do NOT invent a reason.";

/** Grow coldemail's one-email contract to an N-touch sequence, grounded in the ICP context AND this
 *  lead's hook. A follow-up ADVANCES a real reason (a new proof point / a different angle on the same
 *  value), never "just checking in" (objection.js's calm-honest register). Pure — returns a string. */
export function buildSequencePrompt({ lead, icp, sequence, steers }) {
  const seq = sequence || DEFAULT_SEQUENCE;
  const icpBlock = icp ? [
    `SENDER / ICP CONTEXT (ground the copy in how ${icp.name} actually talks — this is what makes it ours, not generic):`,
    `Sender: ${icp.name}.`,
    icp.oneLine ? `One-line: ${icp.oneLine}.` : "",
    icp.positioning ? `Positioning: ${icp.positioning}.` : "",
    icp.audience ? `Audience: ${icp.audience}.` : "",
    icp.voice ? `Voice: ${icp.voice}.` : "",
    icp.products && icp.products.length ? `Offer: ${icp.products.join(", ")}.` : "",
  ].filter(Boolean).join(" ") : "SENDER / ICP CONTEXT: none lent — write in a plain, honest founder voice.";

  const touchGuide = [
    "Touch 1: one genuine reason (the hook), one concrete value line grounded in the ICP, one low-friction ask. Under-6-word subject; 3–5 short lines.",
    "Touch 2 (a few days later): a DIFFERENT angle on the same value, or a proof point. Never 'just bumping this'. Under-6-word subject; 3–5 lines.",
    "Touch 3: the calm, honest close — name the likely objection ('you already have a way to do outreach') and answer it in one line, then a clean one-line opt-out.",
    "Touch 4+: advance a new, real reason each time; stay calm and specific; always leave a clean opt-out.",
  ];

  return [
    `You are Reachout, drafting a personalized B2B outreach SEQUENCE on the sender's own Claude — ${seq.touches} touch${seq.touches === 1 ? "" : "es"} to ONE lead, as one coherent thread.`,
    icpBlock,
    `THE LEAD (the recipient): ${lead.name || "(no name)"}${lead.role ? `, ${lead.role}` : ""}${lead.company ? ` at ${lead.company}` : ""} <${lead.email}>.`,
    `THE HOOK (the one true, specific reason we're reaching this person — the ONLY ground for personalization): "${String(lead.hook || "").trim() || "(none supplied)"}"`,
    `Draft EXACTLY ${seq.touches} touch${seq.touches === 1 ? "" : "es"}. Each touch builds on the last as the same thread. Guidance per touch:`,
    touchGuide.slice(0, seq.touches).join("\n"),
    steers && steers.length ? `Steering (apply the latest): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
    HONESTY,
    `Return ONLY a JSON object — no prose, no markdown fences — exactly: {"touches":[{"subject":"…","body":"…"}]} with exactly ${seq.touches} entr${seq.touches === 1 ? "y" : "ies"} in order. Body is plain text with real line breaks.`,
  ].filter(Boolean).join("\n\n");
}

/** Coerce the model reply into exactly N touches {subject, body}. Lenient: strips fences, pulls the
 *  one JSON object, pads/truncates to N. Never throws on a slightly-off reply. */
export function normalizeSequence(text, touches) {
  const n = Math.max(1, Number(touches) || 1);
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  let arr = null;
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try { const obj = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(obj?.touches)) arr = obj.touches; } catch { /* fall through */ }
  }
  if (!arr) {
    // salvage: try a bare array
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a !== -1 && b > a) { try { const j = JSON.parse(t.slice(a, b + 1)); if (Array.isArray(j)) arr = j; } catch { /* ignore */ } }
  }
  if (!arr) arr = [];
  const clean = arr.slice(0, n).map((x, i) => ({
    touch: i + 1,
    subject: String(x?.subject ?? x?.title ?? "").trim().slice(0, 120),
    body: String(x?.body ?? x?.text ?? "").trim(),
  }));
  while (clean.length < n) clean.push({ touch: clean.length + 1, subject: "", body: "" });
  return { touches: clean };
}

// ─────────────────────────── the lead ledger (sb.storage — §1.4) ───────────────────────────
// Storage key is a plain FILENAME, never `:` (memory relay-storage-key-rule): "reachout-<campaignId>".

/** Storage key for a campaign. campaignId is sanitized to the daemon's filename rule. */
export function campaignKey(campaignId) {
  const id = String(campaignId || "campaign").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100) || "campaign";
  return `reachout-${id}`;
}

/** Build a fresh campaign record from leads + a chosen sequence (the ledger's initial state, §1.4). */
export function newCampaign({ id, leads, sequence }) {
  const seq = sequence || DEFAULT_SEQUENCE;
  return {
    id: String(id || "campaign"),
    sequence: { touches: seq.touches, spacingDays: seq.spacingDays },
    leads: (leads || []).map((l) => ({
      email: l.email, name: l.name || "", company: l.company || "", role: l.role || "", hook: l.hook || "",
      stage: 0,          // which touch they're on (0 = not started)
      drafts: [],        // one per touch as it gets drafted+staged: {touch,draftId,subject,staged,sent}
      status: "active",  // active | replied | bounced | done | paused
      lastEvent: null,
    })),
    createdAt: Date.now(),
  };
}

/** Load a campaign record from the ledger (or null). */
export async function loadCampaign(sb, campaignId) {
  const raw = await sb.storage.get(campaignKey(campaignId)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Persist a campaign record to the ledger. */
export async function saveCampaign(sb, campaignId, state) {
  await sb.storage.set(campaignKey(campaignId), JSON.stringify(state)).catch(() => {});
  return state;
}

/** Is a lead's next touch due? spacingDays[stage] elapsed since the last event? (stage 0 is always
 *  due — the first touch.) Pure over the ledger + the clock (§3: cadence advances off the ledger). */
export function isTouchDue(lead, sequence, now = Date.now()) {
  if (!lead || lead.status !== "active") return false;
  const seq = sequence || DEFAULT_SEQUENCE;
  if (lead.stage >= seq.touches) return false;         // sequence complete
  if (lead.stage === 0) return true;                   // first touch — always due
  const spacing = seq.spacingDays[lead.stage] ?? 0;    // days to wait before the NEXT touch
  if (!lead.lastEvent) return true;
  return now - lead.lastEvent >= spacing * 24 * 60 * 60 * 1000;
}

// ─────────────────────────── the actions ───────────────────────────

/** THE ACTION #1 — draft one lead's WHOLE sequence in ONE call. Pure model call, no side effects.
 *  Returns { touches:[{touch,subject,body}] }. This is what an agent / the harness / the DOM calls to
 *  preview the sequence before anything is staged. */
export async function draftSequence(input, sb) {
  const lead = input?.lead;
  if (!lead?.email) throw new Error("draftSequence needs a lead { email, hook }.");
  const icp = input?.icp !== undefined ? normalizeIcp(input.icp)
    : normalizeIcp(await sb.context?.active?.().catch(() => null));
  const sequence = input?.sequence || DEFAULT_SEQUENCE;
  const prompt = buildSequencePrompt({ lead, icp, sequence, steers: input?.steers });
  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  return normalizeSequence(text, sequence.touches);
}

/** THE ACTION #2 — draft a lead's NEXT due touch and STAGE it as a Gmail DRAFT. The only function that
 *  touches a connector. It calls `create_draft` — a DRAFT, not a send. There is no send tool here, by
 *  design (§6). input: { campaignId, email, icp? }. Requires the campaign to already exist in the ledger. */
export async function stageNextTouch(input, sb) {
  const { campaignId, email } = input || {};
  if (!campaignId || !email) throw new Error("stageNextTouch needs { campaignId, email }.");
  const state = await loadCampaign(sb, campaignId);
  if (!state) throw new Error(`no campaign ${JSON.stringify(campaignId)} in the ledger — set it up first.`);
  const lead = state.leads.find((l) => l.email === email);
  if (!lead) throw new Error(`lead ${JSON.stringify(email)} not in campaign ${JSON.stringify(campaignId)}.`);
  if (lead.status !== "active") return { staged: false, reason: `lead is ${lead.status}`, touch: lead.stage };
  if (lead.stage >= state.sequence.touches) return { staged: false, reason: "sequence complete", touch: lead.stage };

  const touch = lead.stage + 1;
  const seq = await draftSequence({ lead, icp: input?.icp, sequence: state.sequence }, sb);
  const draft = seq.touches[touch - 1] || { subject: "", body: "" };

  // create_draft — a DRAFT, not a send. Follow-ups thread onto the first touch when we know its thread.
  const res = await sb.callTool("mcp__claude_ai_Gmail__create_draft", {
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
    threadId: lead.drafts?.[0]?.threadId,
  });
  const content = Array.isArray(res?.content) ? res.content.map((c) => c?.text || "").join("") : "";
  let draftId = res?.draftId || null;
  if (!draftId && content) { try { draftId = JSON.parse(content)?.draftId || JSON.parse(content)?.id || null; } catch { /* ignore */ } }

  lead.drafts.push({ touch, draftId, subject: draft.subject, staged: Date.now(), sent: null });
  lead.stage = touch;
  lead.lastEvent = Date.now();
  await saveCampaign(sb, campaignId, state);
  return { staged: true, touch, draftId, subject: draft.subject };
}

/** THE ACTION #3 — the routine tick (routine #2). Advance every lead whose next touch is due; stage
 *  its draft. Returns tokens/touches spent (the routine registry's contract: Promise<number>). Drafts
 *  autonomously; SENDS NOTHING.
 *
 *  STUB / SPEC NOTE: the SCHEDULER that calls this on a cadence lives on the unmerged routines branch
 *  (`claude/autopilot-autonomous`: docs/ROUTINES.md + packages/sidekick/src/routines/registry.ts). Until
 *  it merges, `tick` is a plain function — invoke it manually (or from a test) to advance the cadence;
 *  the DOM board's "stage" button (stageNextTouch) covers the same ground one lead at a time. When the
 *  branch lands, declare the routine { id:"reachout-send", schedule:"daily 09:00", tier:"daemon",
 *  scope:{ models:["sonnet"], tools:["mcp__claude_ai_Gmail__*"] } } and register THIS tick against it. */
export async function tick(input, sb) {
  const state = await loadCampaign(sb, input?.campaignId);
  if (!state) return 0;
  let spent = 0;
  for (const lead of state.leads) {
    if (!isTouchDue(lead, state.sequence)) continue;
    await stageNextTouch({ campaignId: state.id, email: lead.email, icp: input?.icp }, sb);
    spent += 1; // ~1 model call per staged touch
  }
  return spent;
}

// ─────────────────────────── the agent-facing manifest (docs/WRAPPS-FOR-AGENTS.md §1) ───────────────────────────
// Register EXACTLY like adpulse in packages/switchboard-mcp/registry.mjs:
//   import reachout from "…/reachout.core.js";  → add `reachout` to MANIFESTS.
// That one line renders three ways: DOM wrapp, MCP tool (wrapp__reachout__draftSequence /
// wrapp__reachout__stageNextTouch), and the routine tick. NOTE: `tick` is intentionally NOT exposed
// as an MCP action — it is the routine's entry, driven by the scheduler, not an ad-hoc agent call.
//
// SCOPE — the one new grant vs coldemail (which is tools:[]): tools:["mcp__claude_ai_Gmail__*"], the
// whole-connector wildcard (the ONLY form the gate accepts). `create_draft` is inside that grant; a
// hypothetical `send` tool would ALSO be inside it — which is exactly why the human-send discipline is
// enforced in OUR code (no send call anywhere) and at the notch, not left to the grant boundary (§6).
export const manifest = {
  name: "reachout",
  title: "Reachout",
  origin: "https://reachout.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand"], tools: ["mcp__claude_ai_Gmail__*"] },
  actions: [
    {
      name: "draftSequence",
      summary:
        "Draft a full personalized B2B outreach sequence (a first touch + N follow-ups) for one lead, grounded in the sender's ICP/brand context and the lead's true hook. Runs on the user's own Claude; no side effects, nothing sent.",
      input: {
        lead: "object — { email, name?, company?, role?, hook } — the recipient + the one true reason to reach them. Required.",
        icp: "object? — the sender's brand/ICP context {name, oneLine, voice, positioning, audience, products[]}. Falls back to the active context.",
        sequence: "object? — { touches, spacingDays[] }. Default 3 touches over 8 days.",
        steers: "string[]? — per-lead steering, e.g. 'warmer', 'shorten touch 2'.",
      },
      output: { touches: "[{ touch, subject, body }] — the drafted sequence" },
      run: draftSequence,
    },
    {
      name: "stageNextTouch",
      summary:
        "Draft a lead's next DUE touch and stage it as a Gmail DRAFT (create_draft) — never sends. Records the draftId in the campaign ledger and advances the lead's stage. The send stays a human click.",
      input: {
        campaignId: "string — the campaign to advance. Required.",
        email: "string — the lead's email (must already be in the campaign ledger). Required.",
        icp: "object? — the sender's ICP context; falls back to the active context.",
      },
      output: { staged: "boolean", touch: "which touch was staged", draftId: "the Gmail draft id (or null)", subject: "the drafted subject" },
      run: stageNextTouch,
    },
  ],
};

export default manifest;
