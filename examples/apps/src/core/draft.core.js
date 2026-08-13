// Draft — the GENERAL content-drafting capability the composition vision was missing. Every other core
// is single-purpose (batch = a YC application, reachout = one lead's sequence). This one is factored:
// given a BRIEF (voice/angle/audience — the kind of thing ideabrain.brief + autopilot.slate produce) and
// a FORMAT (x-thread, x-single, linkedin, ig-caption, ig-carousel …), draft N distinct pieces on the
// user's own Claude. It is the piece between "great strategy" and "posts in the queue".
//
// It ships TWO actions on purpose — one capability, two features:
//   • draft(input, sb)  — batch: N pieces for a format (the content pipeline's last stage).
//   • revise(input, sb) — ONE piece + a steer, re-drafted in place (the primitive behind notch
//                          "select-and-say": select a block → your words become a steer → re-run JUST
//                          this piece → swap the result. Same `steers` contract reachout already uses).
//
// `sb` is the same capability subset the SDK's `relay` exposes:
//   sb.stream(params)   -> async-iterable<StreamDelta>   (the model call)
//   sb.context.active() -> Context|null                  (the brand/strategy to ground in)
// The harness / a test supplies a MOCK sb; the daemon supplies the gated one. Same functions, same
// output shape — that parity is the whole point (see reachout.core.js for the sibling pattern).
//
// HONESTY: never fabricate a fact, a metric, or a quote. If a number isn't in the brief/topic, write
// around it — do NOT invent one. Same anti-slop posture as reachout's HONESTY clause.
//
// PURE ESM, NO DOM: imports cleanly in Node (connector / test) and the browser bundle.

// ─────────────────────────── the brief (the strategy to ground in) ───────────────────────────

/** Normalize a content brief from whatever the upstream produced — a lent brand/idea context, an
 *  ideabrain.brief ({productIdea, positioningHint, audience, vibe, …}), or an autopilot.slate voice/
 *  angle pick, or a loose object. Every field optional; missing ones just drop out of the prompt. */
export function normalizeBrief(ctx) {
  if (!ctx) return null;
  const d = ctx.data || ctx;
  const str = (v) => String(v ?? "").trim();
  return {
    name: str(ctx.name || d.name || d.company),
    about: str(d.about || d.productIdea || d.oneLine || d.tagline),
    positioning: str(d.positioning || d.positioningHint),
    audience: str(d.audience),
    voice: str(d.voice || d.vibe),        // slate "Builder's Diary" text, or ideabrain vibe
    angle: str(d.angle),                  // slate "Unfinished, on purpose"
  };
}

// ─────────────────────────── the formats (per-channel shape guidance) ───────────────────────────
// One place that knows what each format IS. Adding a channel = adding one entry here.

export const FORMATS = {
  "x-thread": {
    label: "X thread",
    guide: "An X (Twitter) thread of 4–7 tweets. Tweet 1 is a scroll-stopping hook — a claim, a number, or a tension — that works alone. Number tweets 1/ 2/ …; each ≤270 chars, one idea per tweet. End on a soft follow CTA or an open question. Body: the whole thread, tweets separated by a blank line.",
  },
  "x-single": {
    label: "X post",
    guide: "A single X (Twitter) post, ≤270 chars. One sharp idea, strongest line first. No hashtags unless exactly one genuinely earns it. Body: the post text.",
  },
  "linkedin": {
    label: "LinkedIn post",
    guide: "A LinkedIn post, 120–200 words, operator register — the reasoning behind a decision, not a demo reel. Open with a one-line hook, then short one-line paragraphs, close with a question to the reader. No hashtag soup; at most 2–3 at the very end.",
  },
  "ig-caption": {
    label: "Instagram caption",
    guide: "An Instagram caption, 40–120 words, warm and visual. The first line is the hook (it shows before 'more'). A few line breaks for air. End with 3–5 relevant hashtags. Body: caption then hashtags.",
  },
  "ig-carousel": {
    label: "Instagram carousel",
    guide: "An Instagram carousel of 5–7 slides. Slide 1 hooks, the last slide carries the CTA. Body: one slide per line as 'Slide N — HEADLINE (≤8 words): sub-line (≤20 words)'.",
  },
};

/** Format option cards — exactly one recommended (house doctrine, cf. reachout.SEQUENCE_OPTIONS). */
export const FORMAT_OPTIONS = [
  { id: "x-thread", label: "X thread", recommended: true },
  { id: "x-single", label: "X post", recommended: false },
  { id: "linkedin", label: "LinkedIn post", recommended: false },
  { id: "ig-caption", label: "Instagram caption", recommended: false },
  { id: "ig-carousel", label: "Instagram carousel", recommended: false },
];

/** Resolve a format id to its guide; unknown ids fall back to a plain-post guide so we never throw. */
export function formatGuide(format) {
  const f = FORMATS[String(format || "").toLowerCase()];
  return f ? f.guide : "A single short social post. One clear idea, strongest line first.";
}

// ─────────────────────────── the prompts ───────────────────────────

/** The anti-slop clause, mirrored from reachout.HONESTY. */
export const HONESTY =
  "Keep it human — no buzzwords, no fake urgency, no flattery, no emoji unless it truly fits. Sound like a specific person, not a brand account. Never fabricate a fact, a metric, a quote, or a shared connection; if a number isn't given, write around it rather than inventing one.";

/** Ground block from a brief — shared by draft + revise so a re-drafted piece stays on-voice. Pure. */
function briefBlock(brief) {
  if (!brief) return "STRATEGY / BRIEF: none lent — write in a plain, honest, specific first-person voice.";
  return [
    "STRATEGY / BRIEF (ground every piece in this — it's what makes the content theirs, not generic):",
    brief.name ? `Who: ${brief.name}.` : "",
    brief.about ? `About: ${brief.about}.` : "",
    brief.positioning ? `Positioning: ${brief.positioning}.` : "",
    brief.audience ? `Audience: ${brief.audience}.` : "",
    brief.voice ? `Voice: ${brief.voice}.` : "",
    brief.angle ? `Angle: ${brief.angle}.` : "",
  ].filter(Boolean).join(" ");
}

/** Build the BATCH prompt: N distinct pieces of one format, grounded in the brief + topic. Pure. */
export function buildDraftPrompt({ brief, format, topic, n, steers }) {
  const count = Math.max(1, Number(n) || 1);
  return [
    `You are Draft, writing content on the user's own Claude — ${count} ${FORMATS[format]?.label || "post"}${count === 1 ? "" : "s"}, each a DISTINCT piece (different hook and angle; never N rewrites of one idea).`,
    briefBlock(brief),
    `FORMAT: ${formatGuide(format)}`,
    topic ? `TOPIC / THEME for this batch: ${topic}` : "TOPIC: draw from the brief — pick the ${count} strongest, most postable angles the strategy implies.",
    steers && steers.length ? `Steering (apply the latest, it wins): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
    HONESTY,
    `Return ONLY a JSON object — no prose, no markdown fences — exactly: {"pieces":[{"hook":"…","body":"…"}]} with exactly ${count} entr${count === 1 ? "y" : "ies"}. "hook" is a ≤12-word label for the piece; "body" is the full post as plain text with real line breaks.`,
  ].filter(Boolean).join("\n\n");
}

/** Build the REVISE prompt: re-draft ONE existing piece with a steer, same format. Pure. This is the
 *  select-and-say primitive — the steer is the user's typed words against the selected block. */
export function buildRevisePrompt({ brief, format, body, steers }) {
  return [
    `You are Draft, revising ONE ${FORMATS[format]?.label || "post"} on the user's own Claude. Rewrite it applying the steer — keep what works, change what the steer asks for, keep the same format and roughly the same length unless the steer says otherwise.`,
    briefBlock(brief),
    `FORMAT: ${formatGuide(format)}`,
    `CURRENT PIECE:\n${String(body || "").trim()}`,
    steers && steers.length ? `STEER (what to change — this is the instruction): ${steers.map((s) => `"${s}"`).join(" → ")}` : "STEER: tighten it — cut anything soft, keep the sharpest version.",
    HONESTY,
    `Return ONLY a JSON object — no prose, no markdown fences — exactly: {"hook":"…","body":"…"}. "body" is the full revised post as plain text.`,
  ].filter(Boolean).join("\n\n");
}

// ─────────────────────────── lenient parsing ───────────────────────────

/** Pull the first JSON object out of a possibly-messy model reply (fences stripped). Null on failure. */
function firstJsonObject(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

/** Coerce a batch reply into exactly N pieces {format, hook, body}. Never throws; pads/truncates to N. */
export function normalizeDraft(text, format, n) {
  const count = Math.max(1, Number(n) || 1);
  const obj = firstJsonObject(text);
  let arr = Array.isArray(obj?.pieces) ? obj.pieces : (Array.isArray(obj) ? obj : null);
  if (!arr) {
    // salvage a bare array
    const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a !== -1 && b > a) { try { const j = JSON.parse(t.slice(a, b + 1)); if (Array.isArray(j)) arr = j; } catch { /* ignore */ } }
  }
  if (!arr) arr = [];
  const clean = arr.slice(0, count).map((x) => ({
    format,
    hook: String(x?.hook ?? x?.title ?? "").trim().slice(0, 120),
    body: String(x?.body ?? x?.text ?? "").trim(),
  }));
  while (clean.length < count) clean.push({ format, hook: "", body: "" });
  return { pieces: clean };
}

/** Coerce a revise reply into one piece {format, hook, body}. Never throws. */
export function normalizeRevised(text, format) {
  const obj = firstJsonObject(text) || {};
  return {
    format,
    hook: String(obj.hook ?? obj.title ?? "").trim().slice(0, 120),
    body: String(obj.body ?? obj.text ?? String(text || "")).trim(),
  };
}

// ─────────────────────────── the model call ───────────────────────────

async function runPrompt(sb, prompt) {
  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  return text;
}

// ─────────────────────────── the actions ───────────────────────────

/** THE ACTION #1 — draft N distinct pieces of one format. Pure model call, no side effects.
 *  input: { format, topic?, n?, brief?, steers? }. Returns { format, pieces:[{format,hook,body}] }. */
export async function draft(input, sb) {
  const format = String(input?.format || "x-single").toLowerCase();
  const n = Math.max(1, Number(input?.n) || 3);
  const brief = input?.brief !== undefined ? normalizeBrief(input.brief)
    : normalizeBrief(await sb.context?.active?.().catch(() => null));
  const prompt = buildDraftPrompt({ brief, format, topic: input?.topic, n, steers: input?.steers });
  const text = await runPrompt(sb, prompt);
  return { format, ...normalizeDraft(text, format, n) };
}

/** THE ACTION #2 — re-draft ONE piece with a steer (the select-and-say primitive). Pure model call.
 *  input: { piece:{format?, body}, steer? | steers?, brief? }. Returns { piece:{format,hook,body} }. */
export async function revise(input, sb) {
  const piece = input?.piece || {};
  const body = piece.body ?? input?.body;
  if (!body) throw new Error("revise needs { piece: { body } } — the current text to re-draft.");
  const format = String(piece.format || input?.format || "x-single").toLowerCase();
  const steers = input?.steers || (input?.steer ? [input.steer] : []);
  const brief = input?.brief !== undefined ? normalizeBrief(input.brief)
    : normalizeBrief(await sb.context?.active?.().catch(() => null));
  const prompt = buildRevisePrompt({ brief, format, body, steers });
  const text = await runPrompt(sb, prompt);
  return { piece: normalizeRevised(text, format) };
}

// ─────────────────────────── the agent-facing manifest ───────────────────────────
// Register EXACTLY like the others in packages/switchboard-mcp/registry.mjs:
//   import draft from "…/draft.core.js";  → add `draft` to MANIFESTS.
// That one line renders it as MCP tools wrapp__draft__draft and wrapp__draft__revise, and (via the
// same run(input, sb) contract) makes it composable by the launcher's planner and the select-and-say
// edit layer. NO connector grant — drafting is a pure model call, tools:[].
export const manifest = {
  name: "draft",
  title: "Draft",
  origin: "https://draft.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand", "project"], tools: [] },
  actions: [
    {
      name: "draft",
      summary:
        "Draft N distinct social posts of one format (x-thread, x-single, linkedin, ig-caption, ig-carousel), grounded in a voice/angle/audience brief and an optional topic. The general content-drafting capability; runs on the user's own Claude, no side effects.",
      input: {
        format: "string — one of: x-thread, x-single, linkedin, ig-caption, ig-carousel. Default x-single.",
        topic: "string? — the theme/hook for this batch. Omit to draw the strongest angles from the brief.",
        n: "number? — how many distinct pieces to draft. Default 3.",
        brief: "object? — { name, about, positioning, audience, voice, angle } (accepts an ideabrain.brief or autopilot.slate voice/angle). Falls back to the active context.",
        steers: "string[]? — steering, e.g. 'punchier', 'lead with the stat', 'less salesy'.",
      },
      output: { format: "the format drafted", pieces: "[{ format, hook, body }] — the drafted pieces" },
      run: draft,
    },
    {
      name: "revise",
      summary:
        "Re-draft ONE existing piece applying a steer, keeping its format — the primitive behind notch 'select-and-say': select a block, your typed words become the steer, only that piece re-runs. Pure model call.",
      input: {
        piece: "object — { format?, body } — the current piece to re-draft. Required (body).",
        steer: "string? — the change to apply (or pass steers[]).",
        steers: "string[]? — ordered steers, latest wins.",
        brief: "object? — the same brief the piece was drafted from; falls back to the active context.",
      },
      output: { piece: "{ format, hook, body } — the revised piece" },
      run: revise,
    },
  ],
};

export default manifest;
