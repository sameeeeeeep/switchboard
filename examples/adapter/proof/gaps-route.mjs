// brandbrain's app/api/studio/gaps/route.ts — VERBATIM logic. The ONLY changes from the original:
//   • `@/lib/claude`        → the Switchboard shim (../claude.mjs)      ← the whole migration
//   • `@/lib/studio/spec`   → ./spec.mjs
//   • TypeScript types stripped (a real brandbrain build keeps the .ts; its bundler handles types
//     and resolves the @/lib/claude alias to the shim — so even these imports wouldn't change).
// The body — prompt building, the runClaude calls, extractJson, scoring — is untouched.
import { runClaude, extractJson } from "../claude.mjs";
import { gapScore } from "./spec.mjs";

const SYSTEM = `You are brandbrain, a strategist finding white space for a consumer (D2C) founder. You propose openings grounded in the real market landscape you're given — never generic, never invented. Sentence case, no emoji. Output ONLY the JSON asked for.`;

function summarise(c) {
  const cat = c.category?.name ? `Category: ${c.category.name} — ${c.category.scope || ""}` : "";
  const segs = (c.segments ?? []).map((s) => `${s.name} [${s.tag}]`).join(", ");
  const players = (c.players ?? [])
    .map((p) => `${p.brand} (${p.kind}, ${p.segment})${p.note ? `: ${p.note}` : ""}`)
    .join("\n");
  return [cat, segs && `Segments: ${segs}`, players && `Players:\n${players}`].filter(Boolean).join("\n");
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const c = body.canvas;
  if (!c || (!c.category?.name && !c.players?.length && !c.segments?.length)) {
    return Response.json({ error: "No canvas to ground openings in" }, { status: 400 });
  }

  const steer = body.input?.trim() ? `\n\nThe founder added this steer — let it shape the openings: "${body.input.trim()}".` : "";
  const avoid = body.existing?.length
    ? `\n\nAlready proposed (give genuinely DIFFERENT ones): ${body.existing.map((t) => `"${t}"`).join(", ")}.`
    : "";
  const shifts = (body.trends?.trends ?? [])
    .slice(0, 4)
    .map((t) => `${t.dimension ? `${t.dimension}: ` : ""}${t.shift || t.opportunity || ""}`.trim())
    .filter(Boolean);
  const trendLens =
    shifts.length || body.trends?.whitespace
      ? `\n\nWhere preference is shifting in this category — favour openings that ride these, not ones the market is leaving behind:\n${shifts.map((s) => `- ${s}`).join("\n")}${body.trends?.whitespace ? `\nThe opening they point to: ${body.trends.whitespace}.` : ""}`
      : "";
  const picked = (body.pickedShifts ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 6);
  const pickedLens = picked.length
    ? `\n\nThe founder PERSONALLY resonates with these shifts — weight the openings hard toward them:\n${picked.map((s) => `- ${s}`).join("\n")}`
    : "";
  const prompt =
    `Here is the market landscape:\n${summarise(c)}${trendLens}${pickedLens}\n\n` +
    `Propose 3 fresh openings (white space) a new brand could own — each grounded in a real weakness or absence in the landscape above.${steer}${avoid}\n\n` +
    `For each, estimate honestly (0–1): demand (rising?), sparsity (unoccupied?), vulnerability (incumbents weak?), feasibility (buildable?), risk (regulatory/fad?).\n` +
    `Return ONLY: {"gaps":[{"title":"a 2-5 word opening","rationale":"one line why it's open","demand":0.0-1.0,"sparsity":0.0-1.0,"vulnerability":0.0-1.0,"feasibility":0.0-1.0,"risk":0.0-1.0}]}`;

  let text = await runClaude(prompt, { system: SYSTEM, effort: "low", timeoutMs: 120_000 });
  let parsed = text ? extractJson(text) : null;
  if (!parsed) {
    text = await runClaude(prompt + "\n\nReturn ONLY the JSON object — nothing else.", { system: SYSTEM, effort: "low", timeoutMs: 120_000 });
    parsed = text ? extractJson(text) : null;
  }
  if (!parsed) return Response.json({ error: "Couldn’t generate openings" }, { status: 503 });

  const num01 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
  };
  const gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : [])
    .map((g) => {
      const out = { title: String(g.title ?? "").trim(), rationale: String(g.rationale ?? "").trim() };
      const d = num01(g.demand), s = num01(g.sparsity), v = num01(g.vulnerability), f = num01(g.feasibility), r = num01(g.risk);
      if ([d, s, v, f, r].every((n) => n !== undefined)) {
        out.components = { demand: d, sparsity: s, vulnerability: v, feasibility: f, risk: r };
        out.score = gapScore(out.components);
      }
      return out;
    })
    .filter((g) => g.title)
    .slice(0, 4);
  return Response.json({ gaps });
}
