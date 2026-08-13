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
    guide: "An X (Twitter) thread, 4–7 tweets. Number them 1/ 2/ …; each ≤270 chars, one thought per tweet, tweets separated by a blank line. Tweet 1 opens on something concrete and specific — a moment, a detail, a plain admission — never a pitch or a product intro. Let it end when the thought is finished: no follow-me CTA, no question tacked on the end.",
  },
  "x-single": {
    label: "X post",
    guide: "A single X (Twitter) post, ≤270 chars. One real thing, said plainly, the truest line first. No hashtags. Don't end on a question.",
  },
  "linkedin": {
    label: "LinkedIn post",
    guide: "A LinkedIn post, 120–200 words. Short paragraphs, one line each. Open on a real first line, not a hook. Talk through the actual thing — a decision, what happened, what you think — like you're telling one person. End when you're done: no question to the reader, no 'building in public' sign-off, at most one hashtag if any.",
  },
  "ig-caption": {
    label: "Instagram caption",
    guide: "An Instagram caption, 40–120 words. The first line is a real opening line (it shows before 'more'), not a hook. A few line breaks for air. A couple of hashtags only if they'd actually help someone find it.",
  },
  "ig-carousel": {
    label: "Instagram carousel",
    guide: "An Instagram carousel, 5–7 slides. Body: one slide per line as 'Slide N — HEADLINE (≤8 words): sub-line (≤20 words)'. Slide 1 opens on something concrete; the last slide can point somewhere, but don't make it a hard CTA.",
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

/** The factual honesty clause (facts only — voice lives in VOICE below). */
export const HONESTY =
  "Never fabricate a fact, a metric, a quote, or a shared connection. If a specific number isn't in the brief or topic, write around it — don't invent one.";

/** THE VOICE RULE — matters more than the format. The single failure mode this exists to kill is
 *  writing that sounds like an ANNOUNCEMENT / an ad / a keynote instead of one person talking. Every
 *  ban here is a real tell that reads as AI-marketing copy. */
export const VOICE = [
  "VOICE (this matters more than the format): write like one specific person typing to another person. Not a brand, not a landing page, not a keynote. The worst possible failure is sounding like an ANNOUNCEMENT.",
  "ONE idea per piece — this is the top rule. Pick the single thing this post is about and cut everything that isn't it. Do NOT cram the product, the story, and the thesis into one post. If a second point wants in, it's a different post, not another line. A thread stays on its one story start to finish.",
  "NEVER announce or introduce the product. No 'I'm building…', no 'introducing', no 'I call them X' or revealing a coined name like it's a moment — if a coined term matters, drop it in passing as if the reader already knows it; never present it.",
  "NO feature-bullet cadence — no strings of clipped fragments like 'No subscription. No middleman.' That is ad copy, not speech.",
  "NO tidy quotable one-liners or aphorisms built to be screenshotted. Do not reach for a memorable line. If a good line happens on its own, fine.",
  "NO rhetorical question at the end. No 'is it just me?', no 'what would you do?'. Just stop when the thought is done.",
  "NO sign-off clichés — no 'building in public', 'still unfinished', 'more soon', 'let's go', 'excited to share'.",
  "NO 'it's not X, it's Y' seesaw constructions. Go easy on em-dashes and balanced clauses.",
  "KEEP the person's own plain words from the brief and topic — verbatim wherever you can. Do NOT upgrade their phrasing into cleverer words; plain and true beats polished. If they wrote 'getting anxious for no reason', keep that exact register — do not turn it into a metaphor.",
  "Let it be a little unpolished. A sentence that runs on or trails off like real speech beats a balanced, written-sounding one. Understate; don't sell.",
].join("\n");

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
    `You are drafting ${count} ${FORMATS[format]?.label || "post"}${count === 1 ? "" : "s"} on the user's own Claude. Make each genuinely different — a different way in, a different thing to say; never ${count} rewrites of one idea.`,
    VOICE,
    briefBlock(brief),
    `FORMAT: ${formatGuide(format)}`,
    topic ? `WHAT THIS IS ABOUT: ${topic}` : `WHAT THIS IS ABOUT: nothing given — take the ${count} most specific, real angles straight from the brief.`,
    steers && steers.length ? `Steering (apply the latest, it wins): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
    HONESTY,
    `Return ONLY a JSON object — no prose, no markdown fences — exactly: {"pieces":[{"hook":"…","body":"…"}]} with exactly ${count} entr${count === 1 ? "y" : "ies"}. "hook" is a ≤12-word internal label (never shown to a reader — do not write the body to match it); "body" is the full post as plain text with real line breaks.`,
  ].filter(Boolean).join("\n\n");
}

/** Build the REVISE prompt: re-draft ONE existing piece with a steer, same format. Pure. This is the
 *  select-and-say primitive — the steer is the user's typed words against the selected block. */
export function buildRevisePrompt({ brief, format, body, steers }) {
  return [
    `You are revising ONE ${FORMATS[format]?.label || "post"} on the user's own Claude. Rewrite it applying the steer: keep what works, change what the steer asks for, keep the same format and roughly the same length unless the steer says otherwise.`,
    VOICE,
    briefBlock(brief),
    `FORMAT: ${formatGuide(format)}`,
    `CURRENT PIECE:\n${String(body || "").trim()}`,
    steers && steers.length ? `STEER (what to change — this is the instruction): ${steers.map((s) => `"${s}"`).join(" → ")}` : "STEER: tighten it — cut anything that sounds written or salesy, keep the plainest true version.",
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
