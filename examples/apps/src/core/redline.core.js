// Redline — the review orchestration, headless (docs/WRAPPS-FOR-AGENTS.md §1). Redline the wrapp is
// a 2.2k-line DOM canvas (iframe, element anchoring, the CUT timeline); the VALUE underneath is two
// pure model conversations: AUDIT a page's copy/design, and RESPOND to a comment on one element with
// edit options. Those are lifted here so `claude` can review a page headless — the page HTML comes
// in as a string instead of being read off a bound folder + iframe.
//
// The prompts mirror src/redline.js's audit()/respond() VERBATIM (so behaviour — and the harness
// responder that keys on their wording — is identical). The DOM app keeps its own copies for now;
// unifying it onto this core (as adpulse/batch already are) is a safe follow-up.
//
// PURE ESM, NO DOM.

const SOURCE_WINDOW = 4500;

export function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }

function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

async function collect(sb, params) {
  let text = "";
  for await (const d of sb.stream(params)) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  return text;
}

/** Apply a validated find/replace to the source (pure). Exact single-match; else a whitespace-
 *  flexible single-match. Returns the new html, or null when it can't apply safely. */
export function applyEdit(html, find, replace) {
  if (typeof find !== "string" || !find) return null;
  const first = html.indexOf(find);
  if (first !== -1 && html.indexOf(find, first + 1) === -1) return html.slice(0, first) + replace + html.slice(first + find.length);
  const flex = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(flex);
    const m = re.exec(html);
    if (m && !re.exec(html.slice(m.index + m[0].length))) return html.slice(0, m.index) + replace + html.slice(m.index + m[0].length);
  } catch { /* bad regex */ }
  return null;
}

// ---------- AUDIT ----------
/** The self-audit prompt — VERBATIM from redline.js audit(), with the page HTML parameterized. */
export function buildAuditPrompt(html) {
  return [
    "You are Redline, auditing a landing page like a sharp editor + designer. Find the WORST offenders: AI-slop copy (generic hype, filler, clichés like unleash/seamless/empower/elevate, walls of meta-text), pointless or redundant meta lines, dead or duplicated sections, inconsistent voice, weak headlines. 5–8 findings, most damaging first.",
    "Within that budget, you may include up to 2 FILM findings — about how the page MOVES, not what it says: a section whose entrance feels abrupt or lifeless as the reader scrolls to it, or an image that undercuts its section. For an entrance finding: tag = the section's own tag, snippet = exact visible text from inside that section, and issue MUST start with \"Entrance: \". Motion rarely fits a safe find/replace — omit find/replace for these unless certain.",
    'Return ONLY a JSON array — no prose, no fences. Each element: {"tag":<lowercase tag of the element, e.g. "p">,"snippet":<EXACT visible text of that element, ≤100 chars, verbatim>,"issue":<one blunt sentence: what is wrong + the direction to fix>,"label":<2–4 word name for the fix>,"find":<EXACT unique substring of SOURCE containing what to change, ≤300 chars, enough markup to be unique>,"replace":<the find with the fix applied; "" to delete the element; ≤400 chars>,"preview":<the new visible text, or "removed">}',
    "If a finding can't be expressed as a safe find/replace, omit find/replace and keep the issue only.",
    "SOURCE:\n" + html,
  ].join("\n\n");
}

function coerceFinding(f, html) {
  const snippet = String(f?.snippet || "").trim();
  const issue = String(f?.issue || "").trim();
  if (!snippet || !issue) return null;
  const find = typeof f.find === "string" && f.find.length >= 8 ? f.find : null;
  const lockable = !!(find && f.replace != null && html.includes(find));
  return {
    tag: String(f.tag || "").toLowerCase() || "p",
    snippet: snippet.slice(0, 200),
    issue: issue.slice(0, 300),
    label: String(f.label || "Suggested fix").slice(0, 40),
    find: lockable ? find : null,
    replace: lockable ? String(f.replace) : null,
    preview: String(f.preview || "").trim() || (lockable ? stripTags(String(f.replace)).trim().slice(0, 220) || "(removed)" : ""),
    lockable, // true = a ready-to-apply edit validated against SOURCE; false = issue-only
  };
}

export async function audit(input, sb) {
  const html = String(input?.html ?? "").trim();
  if (!html) throw new Error("audit needs `html`: the full HTML of the page to review.");
  const text = await collect(sb, { prompt: buildAuditPrompt(html), maxTokens: 8000 });
  const arr = parseJsonArray(text);
  if (!arr) throw new Error("the model didn't return a JSON array of findings — retry.");
  const findings = arr.map((f) => coerceFinding(f, html)).filter(Boolean);
  return { findings, count: findings.length, lockable: findings.filter((f) => f.lockable).length };
}

// ---------- RESPOND (comment on one element → edit options / reply) ----------
function target({ selector, snippet, note, steers }) {
  return [
    `Element CSS path: ${selector || "(none)"}`,
    `Current visible text: "${snippet || note || ""}"`,
    `Reviewer's comment: "${note || "(make this stronger)"}"`,
    steers && steers.length ? `Follow-ups (apply the latest): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
  ].filter(Boolean).join("\n");
}
function sourceWindow(html, snippet) {
  if (!snippet) return html.slice(0, SOURCE_WINDOW * 2);
  const i = html.indexOf(snippet);
  if (i === -1) return html.slice(0, SOURCE_WINDOW * 2);
  return html.slice(Math.max(0, i - SOURCE_WINDOW), i + snippet.length + SOURCE_WINDOW);
}

/** The respond prompt — VERBATIM from redline.js respond(), parameterized. Emits the exact
 *  `Reviewer's comment:` / `Current visible text:` / `Element CSS path:` markers the responder keys on. */
export function buildRespondPrompt({ html, note, selector, snippet, steers }) {
  return [
    "You are Redline, reviewing a landing page with the founder. They left a comment on ONE element. Decide the single best way to respond and return ONE JSON object — no prose, no fences.",
    target({ selector, snippet, note, steers }),
    "Choose a mode:",
    '• "edit" — the comment wants to CHANGE the page (rewrite, sharpen, shorten, REMOVE, restructure, or add an inline SVG). Return {"mode":"edit","summary":<one line on what you propose>,"find":<EXACT unique substring of the SOURCE to change; for a removal, the whole element>,"options":[{"label":<short name>,"replace":<the find edited; "" to delete it; may embed an inline <svg> for a diagram>,"preview":<new visible text, or "removed">,"recommended":<true for exactly one>}]} — 2–3 options.',
    '• "image" — the comment wants a photo/mockup/visual. Return {"mode":"image","brief":<a vivid image prompt>}.',
    '• "references" — the comment wants references/examples/inspiration. Return {"mode":"references","query":<what to look up>}.',
    '• "reply" — the comment is a question or asks your opinion. Return {"mode":"reply","markdown":<your answer, a few tight lines>}.',
    'For "edit", find MUST appear verbatim exactly once in the SOURCE.',
    "SOURCE (the relevant section of the page's HTML):\n" + sourceWindow(html, snippet),
  ].join("\n\n");
}

export async function respond(input, sb) {
  const html = String(input?.html ?? "").trim();
  const note = String(input?.note ?? input?.comment ?? "").trim();
  if (!html) throw new Error("respond needs `html`: the page HTML the comment is about.");
  if (!note) throw new Error("respond needs `note`: the reviewer's comment on the element (what to change/ask).");
  const prompt = buildRespondPrompt({ html, note, selector: input.selector, snippet: input.snippet, steers: input.steers });
  const route = parseJson(await collect(sb, { prompt }));
  if (!route || !route.mode) throw new Error("no decision came back — retry.");

  if (route.mode === "edit" && route.find && Array.isArray(route.options) && html.includes(route.find)) {
    const options = route.options.slice(0, 3).map((o) => ({
      label: String(o.label || "Option").slice(0, 40),
      preview: o.preview != null ? String(o.preview) : stripTags(String(o.replace || "")).trim().slice(0, 220) || "(removed)",
      edit: { find: route.find, replace: o.replace ?? "" },
      recommended: !!o.recommended,
    }));
    if (!options.some((o) => o.recommended) && options[0]) options[0].recommended = true;
    return { mode: "edit", summary: String(route.summary || "").slice(0, 200), find: route.find, options };
  }
  if (route.mode === "reply" && route.markdown) return { mode: "reply", markdown: String(route.markdown) };
  // image / references are surfaced but NOT executed headless (they need Higgsfield / WebSearch) —
  // the caller gets the brief/query to run itself if it wants.
  if (route.mode === "image") return { mode: "image", brief: String(route.brief || "") };
  if (route.mode === "references") return { mode: "references", query: String(route.query || "") };
  throw new Error(`unusable response (mode=${route.mode}) — retry.`);
}

export const manifest = {
  name: "redline",
  title: "Redline",
  origin: "https://redline.thelastprompt.ai",
  scope: { models: ["sonnet"] },
  actions: [
    {
      name: "audit",
      summary:
        "Review a landing page's copy and design: 5–8 findings (AI-slop, weak headlines, dead sections, abrupt motion), most-damaging first, each with a ready-to-apply find/replace edit when it's a safe one. Pass the page HTML; runs on the user's own Claude.",
      input: { html: "string — the full HTML of the page to review. Required." },
      output: { findings: "[{ tag, snippet, issue, label, find, replace, preview, lockable }]", count: "n", lockable: "how many are ready-to-apply edits" },
      run: audit,
    },
    {
      name: "respond",
      summary:
        "Given a reviewer's comment on ONE element of a page, return 2–3 edit options (find/replace, one recommended) — or a reply/image-brief/reference-query if that's what the comment wants. Pass the page HTML + the comment (+ optional element selector/visible text).",
      input: {
        html: "string — the page HTML the comment is about. Required.",
        note: "string — the reviewer's comment (what to change or ask). Required.",
        selector: "string? — the element's CSS path, if known.",
        snippet: "string? — the element's current visible text, if known (used to window the SOURCE).",
      },
      output: { mode: '"edit"|"reply"|"image"|"references"', options: "[{ label, preview, edit:{find,replace}, recommended }] (edit mode)", markdown: "(reply mode)" },
      run: respond,
    },
  ],
};

export default manifest;
