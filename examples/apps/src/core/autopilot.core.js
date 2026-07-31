// Autopilot — the operating-slate engine, headless (docs/WRAPPS-FOR-AGENTS.md §1). Autopilot the
// wrapp is a finite decision engine: four decisions — Voice → Ad angle → Channel (a dependency
// chain) plus an independent Next move — each drafted as 3 options with one recommended, downstream
// decisions constrained by the upstream pick. This lifts that engine so `claude` can draft the whole
// slate for a company/idea headless.
//
// NOTE: the Autopilot wrapp (src/autopilot.js) lives on the unmerged feat/autopilot-wrapp branch, so
// this core mirrors its genOptions() prompt VERBATIM rather than sharing a module with it (yet). Its
// origin (https://sameep.ai — the OS lives at the apex root) becomes a granted origin once the wrapp
// is connected once in the browser; until then the connector runs it in mock.
//
// Autopilot uses relay.complete() (not stream) — options come back as one JSON array, no partial
// render — so the action uses sb.complete(). PURE ESM, NO DOM.

/** The decision spec — DATA (mirrors src/autopilot.js SPEC). One entry = one decision + deps + the
 *  prompt contract for its options. Voice→angle→channel is the chain; next is independent. */
export const SPEC = [
  { id: "voice", label: "Voice", axis: "HOW IT TALKS, AND TO WHOM", deps: [],
    ask: "3 distinct voices this company could speak in. Each must create a genuinely DIFFERENT relationship with the customer — not three shades of friendly.",
    fields: '"label":<2-4 words>,"text":<one sentence on the relationship it creates>,"lines":[<exactly 3 sentences written IN that voice, as this company would actually say them>]' },
  { id: "angle", label: "Ad angle", axis: "WHAT THE AD IS ACTUALLY ABOUT", deps: ["voice"],
    ask: "3 ad angles. Each must answer a DIFFERENT objection a real buyer actually has. Write every line in the chosen voice.",
    fields: '"label":<2-4 words naming the angle>,"text":<the headline>,"body":<one sentence of body copy>,"cta":<2-3 word call to action>' },
  { id: "channel", label: "Channel", axis: "WHERE IT RUNS, AND WHY THERE", deps: ["angle"],
    ask: "3 places to run this angle. Each must be somewhere this specific buyer already is — say why there, and what it actually costs in effort to start.",
    fields: '"label":<the channel>,"text":<why this buyer is there>,"body":<what it takes to start — concrete effort, not money>' },
  { id: "next", label: "Next move", axis: "WHAT WIDENS THE COMPANY", deps: [],
    ask: "3 next moves that would widen the company — a new product, format, segment or surface. Each must be a specific named thing, not a category.",
    fields: '"label":<what kind of move it is, 2-3 words>,"text":<the move itself, specific and named>,"body":<one sentence on why now>' },
];
const SPEC_BY_ID = Object.fromEntries(SPEC.map((s) => [s.id, s]));

function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}

/** What the model may know about the company: the input line + any lent context, nothing invented. */
export function groundingBlock({ company, context }) {
  const parts = [];
  const name = company?.name || context?.name || "Company";
  const oneLine = company?.oneLine || company?.summary || "";
  parts.push(oneLine ? `${name} — ${oneLine}` : name);
  const d = (context && (context.data || context)) || {};
  for (const k of ["voice", "positioning", "audience", "category", "priceRange", "domain"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim().slice(0, 400)}`);
  }
  for (const k of ["products", "stack", "roadmap"]) {
    if (Array.isArray(d[k]) && d[k].length) parts.push(`${k}: ${d[k].filter((x) => typeof x === "string").join(", ").slice(0, 400)}`);
  }
  return "The company:\n" + parts.join("\n");
}

/** The per-decision prompt — VERBATIM from src/autopilot.js genOptions(). */
export function buildDecisionPrompt({ spec, grounding, upstream }) {
  return [
    "You are Autopilot. You operate a real company and propose its next decisions.",
    grounding,
    upstream.length ? "Already decided — obey these exactly:\n" + upstream.join("\n") : "",
    "Propose " + spec.ask,
    `Return ONLY a JSON array of 3 objects — no prose, no fences. Each: {${spec.fields},"recommended":<true for exactly one>}`,
    "Ground every option in the company above. If you don't know a fact, say what you'd need instead — never invent a metric, a customer, a price or a result.",
  ].filter(Boolean).join("\n\n");
}

function coerceOptions(arr) {
  const opts = arr.slice(0, 4).map((o) => ({
    label: String(o?.label || "Option").slice(0, 60),
    text: String(o?.text || "").slice(0, 400),
    body: o?.body ? String(o.body).slice(0, 400) : undefined,
    cta: o?.cta ? String(o.cta).slice(0, 40) : undefined,
    lines: Array.isArray(o?.lines) ? o.lines.slice(0, 3).map((l) => String(l).slice(0, 240)) : undefined,
    recommended: !!o?.recommended,
  }));
  if (opts.length && !opts.some((o) => o.recommended)) opts[0].recommended = true;
  return opts;
}

/**
 * THE ACTION. Draft the whole operating slate for a company/idea. Runs the decisions in dependency
 * order (voice → angle → channel, then next), auto-adopting each decision's RECOMMENDED option as the
 * constraint for its dependents — the same ripple the wrapp shows when the founder picks. One
 * complete() call per decision (4 total).
 */
export async function slate(input, sb) {
  const company = input?.company || (input?.name ? { name: input.name, oneLine: input.oneLine } : null);
  if (!company || !company.name) throw new Error("slate needs `company` { name, oneLine? } (or `name`): the company/idea to operate.");
  const context = input?.context || null;
  const grounding = groundingBlock({ company, context });

  const chosen = {}; // id -> the recommended option (the auto-pick that constrains dependents)
  const decisions = [];
  for (const spec of SPEC) {
    const upstream = spec.deps.map((dep) => {
      const uo = chosen[dep];
      const ud = SPEC_BY_ID[dep];
      return uo ? `${ud.label} is "${uo.label}" — ${uo.text || ""}`.trim() : "";
    }).filter(Boolean);
    const prompt = buildDecisionPrompt({ spec, grounding, upstream });
    const res = await sb.complete({ prompt, model: "sonnet", maxTokens: 1400 });
    const arr = parseJsonArray(res?.text || "");
    if (!arr || !arr.length) throw new Error(`no options came back for "${spec.label}" — retry.`);
    const options = coerceOptions(arr);
    const rec = options.find((o) => o.recommended) || options[0];
    chosen[spec.id] = rec;
    decisions.push({ id: spec.id, label: spec.label, axis: spec.axis, options, recommended: rec.label });
  }
  return {
    company: company.name,
    decisions,
    note: "The operating slate, drafted on the user's own Claude — recommendations are auto-picks (nothing committed). Each downstream decision was constrained by the upstream recommendation.",
  };
}

function parseJsonObject(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { const o = JSON.parse(t.slice(s, e + 1)); return o && typeof o === "object" ? o : null; } catch { return null; }
}
const MODE = (m) => (["auto", "approve", "manual"].includes(String(m)) ? String(m) : "approve");

/**
 * MOVES. Autopilot's own thing: given a company, the concrete next PLAYS, each tagged with the mode
 * that makes autonomy honest — auto (reversible prep the clone just does), approve (irreversible /
 * costs money / faces the public → stages for the founder's go), manual (only the founder, in the
 * real world). One complete() call.
 */
export async function moves(input, sb) {
  const company = input?.company || (input?.name ? { name: input.name, oneLine: input.oneLine } : null);
  if (!company || !company.name) throw new Error("moves needs `company` { name, oneLine? } (or `name`).");
  const grounding = groundingBlock({ company, context: input?.context || null });
  const prompt = [
    "You are Autopilot. You operate a real company; propose its next MOVES.",
    grounding,
    "List the 4-6 highest-leverage next plays — concrete, named, not categories.",
    "Tag each with a MODE: \"auto\" = reversible prep the clone can just do (draft/generate/preview); \"approve\" = irreversible, costs money, or faces the public → it stages and the founder taps go; \"manual\" = only the founder can do it, out in the real world.",
    "Name the connector each would use, or null: one of gmail, ads, deploy, payments, social, none.",
    "Return ONLY a JSON array of objects — no prose, no fences. Each: {\"title\":<the play, 2-6 words>,\"detail\":<one sentence: what it is and why now>,\"mode\":\"auto|approve|manual\",\"connector\":<string|null>}",
    "Ground every move in the company above. Never invent a metric, a customer, a price or a result.",
  ].join("\n\n");
  const res = await sb.complete({ prompt, model: "sonnet", maxTokens: 1200 });
  const arr = parseJsonArray(res?.text || "");
  if (!arr || !arr.length) throw new Error("no moves came back — retry.");
  const list = arr.slice(0, 6).map((m) => ({
    title: String(m?.title || "Move").slice(0, 80),
    detail: String(m?.detail || "").slice(0, 240),
    mode: MODE(m?.mode),
    connector: m?.connector && m.connector !== "none" ? String(m.connector).slice(0, 24) : null,
  }));
  return { company: company.name, moves: list, note: "Staged plays on the user's own Claude. `auto` is reversible prep; `approve`/`manual` never happen without the founder — the connectors they name act, this engine only decides." };
}

/**
 * PLAN. Autopilot's own thing: the day's operating plan — the single most important thing, then the
 * prioritized moves for today. One complete() call.
 */
export async function plan(input, sb) {
  const company = input?.company || (input?.name ? { name: input.name, oneLine: input.oneLine } : null);
  if (!company || !company.name) throw new Error("plan needs `company` { name, oneLine? } (or `name`).");
  const grounding = groundingBlock({ company, context: input?.context || null });
  const state = input?.state && typeof input.state === "object" ? "\n\nWhere it stands: " + JSON.stringify(input.state).slice(0, 600) : "";
  const prompt = [
    "You are Autopilot, the operating CEO of this company, writing today's plan for the founder.",
    grounding + state,
    "Return ONLY a JSON object — no prose, no fences: {\"headline\":<one sentence on the single most important thing to move today>,\"today\":[{\"title\":<a move, 2-6 words>,\"detail\":<one sentence: what and why>}]}. 3-5 items in `today`, ordered by leverage.",
    "Ground everything in the company above. Never invent a metric, a customer, a price or a result.",
  ].join("\n\n");
  const res = await sb.complete({ prompt, model: "sonnet", maxTokens: 900 });
  const obj = parseJsonObject(res?.text || "");
  if (!obj || !obj.headline) throw new Error("no plan came back — retry.");
  const today = Array.isArray(obj.today) ? obj.today.slice(0, 5).map((t) => ({ title: String(t?.title || "").slice(0, 80), detail: String(t?.detail || "").slice(0, 240) })) : [];
  return { company: company.name, headline: String(obj.headline).slice(0, 400), today, note: "The day's plan, drafted on the user's own Claude — nothing here has happened yet." };
}

export const manifest = {
  name: "autopilot",
  title: "Autopilot",
  origin: "https://sameep.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand", "project", "idea"] },
  actions: [
    {
      name: "slate",
      summary:
        "Draft a company's operating slate: Voice → Ad angle → Channel (a dependency chain) plus a Next move, each as 3 grounded options with one recommended, downstream decisions constrained by the upstream pick. Runs on the user's own Claude.",
      input: {
        company: "object — { name, oneLine? } the company/idea to operate. Required (or pass `name`).",
        context: "object? — a lent brand/project/idea context {name, data} to ground the slate in.",
      },
      output: { company: "name", decisions: "[{ id, label, axis, options:[{label,text,body?,cta?,lines?,recommended}], recommended }] (4)" },
      run: slate,
    },
    {
      name: "moves",
      summary:
        "The company's next concrete PLAYS, each tagged auto (reversible prep the clone does) / approve (irreversible, costs money, faces the public → stages for the founder) / manual (only the founder), with the connector each would use. Autopilot decides; the named connectors act.",
      input: {
        company: "object — { name, oneLine? } the company to operate. Required (or pass `name`).",
        context: "object? — a lent brand/project/idea context {name, data} to ground against.",
      },
      output: { company: "name", moves: "[{ title, detail, mode:auto|approve|manual, connector:string|null }] (4-6)" },
      run: moves,
    },
    {
      name: "plan",
      summary:
        "Today's operating plan: the single most important thing to move, then 3-5 prioritized moves. The daily-planning beat, headless on the user's own Claude.",
      input: {
        company: "object — { name, oneLine? } the company to operate. Required (or pass `name`).",
        context: "object? — a lent brand/project/idea context {name, data} to ground against.",
        state: "object? — where the company stands (decisions made, what's live) to plan against.",
      },
      output: { company: "name", headline: "the one most-important thing today", today: "[{ title, detail }] (3-5)" },
      run: plan,
    },
  ],
};

export default manifest;
