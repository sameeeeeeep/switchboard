// AdPulse — the ORCHESTRATION, split out from the DOM (docs/WRAPPS-FOR-AGENTS.md §1).
//
// A wrapp is a scope + an orchestration + a UI. The browser only supplies the UI. This module is
// the middle — the pure "given a Meta export, diagnose it" pipeline — lifted out of src/adpulse.js
// so it has exactly ONE definition with TWO clients:
//   • the DOM wrapp (src/adpulse.js) imports parseCsv/computeTotals/buildAnalyzePrompt/normalizeReport
//     and drives them from its inputs/render, exactly as before;
//   • the switchboard MCP connector (packages/switchboard-mcp) imports `manifest` and calls
//     `analyze(input, sb)` headless, so `claude` (or any MCP client) can run the same diagnosis.
//
// `sb` is the same capability surface the SDK's `relay` exposes — the subset an action needs:
//   sb.stream(params) -> async-iterable<StreamDelta>   (the model call; the ONLY thing analyze needs)
//   sb.complete(params) -> { text, ... }               (one-shot alternative)
//   sb.storage / sb.context                            (available; unused by analyze)
// The harness provides a MOCK sb (keyword responder); the connector provides a DAEMON sb (gated,
// on the user's own Claude). Same function, same output shape — that parity is the whole point.
//
// PURE ESM, NO DOM: this file must import cleanly in Node (the connector) and in the browser bundle
// (the wrapp). Nothing here touches document/window/localStorage.

// ---------- CSV parsing (quoted commas, escaped quotes, CRLF) ----------
export function parseCsv(text) {
  const out = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) out.push(row);
  return out;
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const findCol = (headers, re) => headers.findIndex((h) => re.test(h));

/** Currency symbol from an ISO code (INR → ₹, else narrow symbol, else the code). Pure — the DOM
 *  wrapp keeps its own copy for rendering; this one is for the prompt's aggregate line. */
export function currencySymbol(code) {
  const currency = code || "INR";
  if (currency === "INR") return "₹";
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0).find((p) => p.type === "currency");
    return part ? part.value : currency + " ";
  } catch { return currency + " "; }
}

/** Locale number formatting used inside the prompt (INR grouping vs en-US). */
export function fmtNum(n, currency, d = 0) {
  return Number(n).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: d });
}

/**
 * Parse a Meta Ads Manager CSV export into normalized campaign rows + the account currency.
 * The pure half of the wrapp's loadData(): no DOM, no persistence, no render — just text → data.
 * Throws with a founder-readable message when the shape isn't a Meta export.
 */
export function loadRows(text) {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new Error("that doesn't look like a CSV — need a header row plus at least one campaign row.");
  const H = grid[0].map((h) => h.trim().toLowerCase());
  const col = {
    name: findCol(H, /campaign/),
    adset: findCol(H, /ad\s?set/),
    spend: findCol(H, /spen[dt]/),
    impr: findCol(H, /impr/),
    clicks: findCol(H, /click/),
    ctr: findCol(H, /\bctr\b|click-?through/),
    cpc: findCol(H, /\bcpc\b|cost per (link )?click/),
    purch: H.findIndex((h) => /purchase|result|conversion/.test(h) && !/value|cost|roas/.test(h)),
    value: findCol(H, /(purchase|conversion).*value|value.*(purchase|conversion)/),
    roas: findCol(H, /roas|return on ad/),
    freq: findCol(H, /freq/),
    range: findCol(H, /date|range|report/),
  };
  if (col.name === -1 || col.spend === -1)
    throw new Error("couldn't find “Campaign name” + “Amount spent” columns — is this a Meta Ads Manager export?");
  const cur = String(grid[0][col.spend] || "").match(/\(([A-Z]{3})\)/);
  const currency = cur ? cur[1] : "INR";
  const pick = (r, i) => (i === -1 ? "" : (r[i] ?? "").trim());
  const rows = grid.slice(1).map((r) => {
    const spend = num(pick(r, col.spend));
    const value = num(pick(r, col.value));
    const roasCol = num(pick(r, col.roas));
    return {
      name: pick(r, col.name) || "(unnamed)",
      adset: pick(r, col.adset),
      spend,
      impr: num(pick(r, col.impr)),
      clicks: num(pick(r, col.clicks)),
      ctr: num(pick(r, col.ctr)),
      cpc: num(pick(r, col.cpc)),
      purch: num(pick(r, col.purch)),
      value,
      roas: spend > 0 && value > 0 ? value / spend : roasCol,
      freq: num(pick(r, col.freq)),
      range: pick(r, col.range),
    };
  }).filter((r) => r.name !== "(unnamed)" || r.spend > 0);
  if (!rows.length) throw new Error("parsed the header but found no campaign rows underneath it.");
  return { rows, currency, hasAdset: col.adset !== -1 };
}

/** Pre-computed aggregates the model is told to trust (so it never has to sum a CSV itself). */
export function computeTotals(rows) {
  const spend = rows.reduce((a, r) => a + r.spend, 0);
  const value = rows.reduce((a, r) => a + r.value, 0);
  const purch = rows.reduce((a, r) => a + r.purch, 0);
  const spent = rows.filter((r) => r.spend > 0);
  let worst = null;
  for (const r of spent) {
    const cpa = r.purch > 0 ? r.spend / r.purch : Infinity;
    if (!worst || cpa > (worst.purch > 0 ? worst.spend / worst.purch : Infinity)) worst = r;
  }
  let best = null;
  for (const r of spent) if (!best || r.roas > best.roas) best = r;
  return { spend, value, purch, blended: spend > 0 ? value / spend : 0, worst, best };
}

/** Normalize a lent brand context (or any loose brand object) to the fields the prompt uses. */
export function normalizeBrand(ctx) {
  if (!ctx) return null;
  const d = ctx.data || ctx;
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  let palette = arr(d.palette).filter((c) => !/^\[object/i.test(c));
  if (!palette.length && Array.isArray(d.paletteRich))
    palette = d.paletteRich.map((s) => s && s.hex).filter(Boolean).map(String);
  return {
    name: ctx.name || d.name || "Brand",
    voice: String(d.voice || d.vibe || d.positioning || "").trim(),
    positioning: String(d.positioning || "").trim(),
    audience: String(d.audience || "").trim(),
    palette,
    products: arr(d.products).length ? arr(d.products) : arr(d.range),
  };
}

/**
 * The diagnosis prompt — VERBATIM from the wrapp's buildPrompt(), parameterized instead of reading
 * module state + the DOM. Keeping the wording identical matters twice: it's what the real model was
 * tuned against, and it's what the harness responder keys on (`you are adpulse`, `pre-computed
 * aggregates`, `monthlyBurn`) — so the mock sb routes to the right shape.
 */
export function buildAnalyzePrompt({ rows, totals, csv, currency, curSym, brand, focus }) {
  const t = totals;
  let body = String(csv).trim();
  if (body.length > 28000) body = body.slice(0, 28000) + "\n[...truncated]";
  const brandBlock = brand ? [
    "BRAND CONTEXT (the user lent this brand via Switchboard — judge the numbers against it):",
    `Brand: ${brand.name}.`,
    brand.positioning ? `Positioning: ${brand.positioning}.` : "",
    brand.audience ? `Audience: ${brand.audience}.` : "",
    brand.voice ? `Voice: ${brand.voice}.` : "",
    brand.products && brand.products.length ? `Products: ${brand.products.join(", ")}.` : "",
    "Use it: judge CPA/CAC against the price point the positioning implies when one is stated; flag campaigns whose naming or targeting reads off-audience; wins, leaks and per-campaign verdicts should call out brand fit, not just ROAS.",
  ].filter(Boolean).join(" ") : "";
  return [
    `You are AdPulse, a blunt, numbers-first Meta Ads performance analyst. A founder exported the data below from Meta Ads Manager. Currency is ${currency} (per the spend header); treat the export window as roughly one month.`,
    `Pre-computed aggregates (trust these): total spend ${curSym}${fmtNum(t.spend, currency)}; blended ROAS ${t.blended.toFixed(2)}; total purchases ${fmtNum(t.purch, currency)}; total purchase value ${curSym}${fmtNum(t.value, currency)}; ${rows.length} campaigns.`,
    brandBlock,
    "CSV EXPORT:\n" + body,
    "ANALYSIS FOCUS (weigh the whole diagnosis toward this): " + focus,
    `Respond with ONLY one JSON object — no prose, no markdown fences — in exactly this shape:\n{"score": <integer 0-100, overall account health: 0 = burning cash, 100 = dialed in>, "headline": "<one blunt verdict sentence, max 120 chars>", "wins": [{"title": "...", "detail": "..."}], "leaks": [{"title": "...", "detail": "...", "monthlyBurn": <estimated ${currency} wasted per month, plain number>}], "actions": [{"title": "...", "impact": "high"|"medium", "effort": "low"|"medium"|"high", "detail": "..."}], "campaigns": [{"name": "<campaign name copied EXACTLY from the data>", "verdict": "scale"|"keep"|"fix"|"kill", "note": "<max 90 chars>"}]}`,
    "Rules: 2-4 wins, 2-4 leaks, 4-6 actions ordered most-urgent first, and one campaigns entry per campaign in the data. Cite real numbers from the data (ROAS, CPA, frequency, spend) in every detail. Each detail under 220 chars. Specific beats generic; a founder acts on this tomorrow morning.",
  ].filter(Boolean).join("\n\n");
}

/** Coerce the model's JSON into the shape the readout renders — VERBATIM from the wrapp's normalize(). */
export function normalizeReport(d) {
  const clampArr = (a) => (Array.isArray(a) ? a : []);
  const VERDICTS = ["scale", "keep", "fix", "kill"];
  const IMPACTS = ["high", "medium"];
  const EFFORTS = ["low", "medium", "high"];
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(d.score) || 0))),
    headline: String(d.headline || "Diagnosis complete — see the readout below.").slice(0, 200),
    wins: clampArr(d.wins).slice(0, 6).map((w) => ({ title: String(w?.title || "Win"), detail: String(w?.detail || "") })),
    leaks: clampArr(d.leaks).slice(0, 6).map((l) => ({ title: String(l?.title || "Leak"), detail: String(l?.detail || ""), monthlyBurn: l?.monthlyBurn })),
    actions: clampArr(d.actions).slice(0, 8).map((a) => ({
      title: String(a?.title || "Action"),
      impact: IMPACTS.includes(String(a?.impact).toLowerCase()) ? String(a.impact).toLowerCase() : "medium",
      effort: EFFORTS.includes(String(a?.effort).toLowerCase()) ? String(a.effort).toLowerCase() : "medium",
      detail: String(a?.detail || ""),
    })),
    campaigns: clampArr(d.campaigns).slice(0, 60).map((c) => ({
      name: String(c?.name || "?"),
      verdict: VERDICTS.includes(String(c?.verdict).toLowerCase()) ? String(c.verdict).toLowerCase() : "keep",
      note: String(c?.note || ""),
    })),
  };
}

/** Pull the one JSON object out of a model reply that may carry prose/fences around it. */
function extractJson(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * THE ACTION. Headless "analyze a Meta export" — the same orchestration the wrapp's analyse() runs,
 * with `sb` in place of `relay`. input: { csv, focus?, brand? }. Returns the normalized report plus
 * the pre-computed tape so a caller (agent) gets the numbers, not just the verdict.
 */
export async function analyze(input, sb) {
  const csv = String(input?.csv ?? input?.export ?? "").trim();
  if (!csv) throw new Error("analyze needs `csv`: a Meta Ads Manager export (campaign-level), or the CSV a live pull produced.");
  const { rows, currency } = loadRows(csv);
  const curSym = currencySymbol(currency);
  const totals = computeTotals(rows);
  const brand = input?.brand ? normalizeBrand(input.brand) : null;
  const focus = String(input?.focus ?? "").trim() || "Full account post-mortem: wins, leaks, and what to do next.";
  const prompt = buildAnalyzePrompt({ rows, totals, csv, currency, curSym, brand, focus });

  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  const data = extractJson(text);
  if (!data) throw new Error("the model didn't return clean JSON — retry; it usually lands on the second pass.");

  return {
    report: normalizeReport(data),
    tape: {
      currency,
      campaigns: rows.length,
      totalSpend: Math.round(totals.spend),
      blendedRoas: Number(totals.blended.toFixed(2)),
      totalPurchases: totals.purch,
      totalValue: Math.round(totals.value),
    },
  };
}

/**
 * The wrapp's agent-facing manifest (docs/WRAPPS-FOR-AGENTS.md §1). `origin` is the authoritative
 * isolation key — it MUST equal the deployed wrapp's origin so a headless call reuses the exact
 * same per-origin grant the browser established. Every action's `run` is a pure (input, sb) fn.
 */
export const manifest = {
  name: "adpulse",
  title: "AdPulse",
  origin: "https://adpulse.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand"] },
  actions: [
    {
      name: "analyze",
      summary:
        "Diagnose a Meta Ads Manager CSV export: an account-health score (0-100), wins, leaks with estimated monthly burn, a scale/keep/fix/kill verdict per campaign, and prioritized actions. Runs on the user's own Claude; no data leaves their machine.",
      input: {
        csv: "string — a Meta Ads Manager campaign-level CSV export (header row + one row per campaign). Required.",
        focus: "string? — what to weigh the diagnosis toward, e.g. 'find wasted spend' or 'what should I scale'.",
        brand: "object? — brand context {name, positioning, audience, voice, products[]} to judge the numbers against.",
      },
      output: {
        report: "{ score, headline, wins[], leaks[], actions[], campaigns[] }",
        tape: "{ currency, campaigns, totalSpend, blendedRoas, totalPurchases, totalValue }",
      },
      run: analyze,
    },
  ],
};

export default manifest;
