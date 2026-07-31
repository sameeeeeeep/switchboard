// ideabrain — validate-an-idea, headless (docs/WRAPPS-FOR-AGENTS.md §1). brandbrain/ideabrain is a
// Next.js studio (external repo, served via examples/brandbrain-port) whose AI logic lives in
// stateless route handlers. Turn 1 of ideabrain — the one-line idea → a sharp structured BRIEF — is
// the cleanest headless entry point: pure prompt + parse, web-free, fast. This lifts it so `claude`
// can turn an idea into a brief on the user's own Claude.
//
// The prompt + STUDIO_SYSTEM + coercion mirror the port VERBATIM (examples/brandbrain-port/shims/
// claude-session.mjs and brandbrain's app/api/studio/brief/route.ts). The studio runs it as a warm
// session turn; headless it's a single sb.complete() with the same system prompt. PURE ESM, NO DOM.

/** brandbrain's studio system prompt (verbatim from the port's claude-session shim). */
export const STUDIO_SYSTEM = `You are brandbrain, a launch & growth strategist for consumer (D2C) brands, running a guided brand build for a founder in one continuous conversation.

Across this conversation you expand their idea into a brief, then generate OPTIONS for each piece of the brand — name, positioning, audience, voice, visual identity, competitors, pricing, product range, suppliers — as structured cards they pick from. Each turn tells you exactly what to produce and the JSON shape to return.

Rules:
- Remember the brief and the decisions locked earlier in this conversation; build on them, never contradict them.
- Be sharp and specific — concrete names, numbers and a real point of view, never generic filler. Each option is a genuinely different direction.
- When you cite a reference brand, use a REAL brand and its real domain; never invent a brand, a domain, or a URL. Cite a source url only if you actually found it via web search; otherwise omit it.
- Sentence case. No emoji, no hashtags. Keep text tight — these render as compact cards, not essays.
- Output ONLY the JSON the turn asks for. No prose, no markdown code fences.`;

function parseJsonObject(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

/** The brief prompt — VERBATIM from brandbrain's studio/brief route, parameterized. */
export function buildBriefPrompt({ idea, market }) {
  const marketLine = market
    ? `The founder is launching in this target market: "${market}". Use it as the brief's market and let it inform the audience, demographics and price tier (local context).\n\n`
    : "";
  return (
    `My brand idea: ${idea}\n\n` +
    marketLine +
    `Expand it into a sharp, specific brief — infer and commit to sensible specifics, never blank. ` +
    `Do not use web search. Return ONLY this JSON:\n` +
    `{"productIdea":"the product in a phrase","category":"category","audience":"who it's for","demographics":"age/gender/income/region in a phrase","priceTier":"Value|Mid|Premium","market":"primary market","vibe":"3-5 comma-separated brand keywords","positioningHint":"one-line angle to explore"}`
  );
}

/** Coerce the model's JSON into a Brief — VERBATIM from the route's normalize (str + tier whitelist,
 *  explicit market wins over inference). */
export function normalizeBrief(parsed, { idea, market }) {
  const str = (v, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
  const tier = ["Value", "Mid", "Premium"].includes(str(parsed?.priceTier)) ? str(parsed.priceTier) : "Mid";
  return {
    productIdea: str(parsed?.productIdea, idea),
    category: str(parsed?.category),
    audience: str(parsed?.audience),
    demographics: str(parsed?.demographics),
    priceTier: tier,
    market: market || str(parsed?.market),
    vibe: str(parsed?.vibe),
    positioningHint: str(parsed?.positioningHint),
  };
}

/**
 * THE ACTION. ideabrain turn 1 — a one-line idea → a sharp, committed brief. One model call, web-free.
 * input { idea, market? }. (The rest of ideabrain — research → thesis → plan → deck — is the studio's
 * stateful card loop; this is the clean composable entry an agent starts from.)
 */
export async function brief(input, sb) {
  const idea = String(input?.idea ?? "").trim();
  if (!idea) throw new Error("brief needs `idea`: one line describing the idea to validate.");
  const market = String(input?.market ?? "").trim();
  const prompt = buildBriefPrompt({ idea, market });

  let text = "";
  try {
    const res = await sb.complete({ prompt, system: STUDIO_SYSTEM, model: "sonnet", effort: "low" });
    text = res?.text || "";
  } catch (e) { throw new Error(`brief failed: ${e?.message || e}`); }
  let parsed = parseJsonObject(text);
  if (!parsed) {
    const res2 = await sb.complete({ prompt: prompt + "\n\nReturn ONLY the JSON object — nothing else.", system: STUDIO_SYSTEM, model: "sonnet", effort: "low" });
    parsed = parseJsonObject(res2?.text || "");
  }
  if (!parsed) throw new Error("couldn't read a brief from the reply — retry.");
  return { brief: normalizeBrief(parsed, { idea, market }) };
}

export const manifest = {
  name: "ideabrain",
  title: "ideabrain",
  origin: "https://brandbrain.thelastprompt.ai",
  scope: { models: ["sonnet", "claude-haiku-4-5"], contextKinds: ["idea"] },
  actions: [
    {
      name: "brief",
      summary:
        "Turn a one-line idea into a sharp, specific brand brief — product, category, audience, demographics, price tier, market, vibe, and a positioning angle. ideabrain's first step (validate an idea); web-free, one call, on the user's own Claude.",
      input: {
        idea: "string — one line describing the idea to validate. Required.",
        market: "string? — the target market/region; when given, it anchors audience/pricing and wins over inference.",
      },
      output: { brief: "{ productIdea, category, audience, demographics, priceTier, market, vibe, positioningHint }" },
      run: brief,
    },
  ],
};

export default manifest;
