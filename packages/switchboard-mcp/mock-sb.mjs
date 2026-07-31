// MOCK sb — the daemon's stand-in, mirroring the wrapp test harness (examples/apps/harness/
// provider.js). It runs a keyword-routed responder that returns the EXACT JSON shape each action's
// core parses, so the SAME run(input, sb) that talks to a real Claude produces a real, structurally
// valid result offline. This is the parity that makes the harness and the connector two `sb`
// implementations of ONE interface — the whole thesis of the connector.
//
// It is NOT a model: every reply is canned. The server always labels a mock result `mode:"mock"`
// so a caller is never fooled into thinking it hit their Claude. Use it for `npm test`, for a demo
// without a paired daemon, or when the daemon is offline (auto-fallback).

function brandFromPrompt(prompt) {
  // The core's prompt carries "Brand: <name>." when a brand was lent; pull it so mock output is
  // brand-grounded exactly like the harness (switchboard vs nailinit produce different text).
  const m = /Brand:\s*([^.\n]+)\./.exec(prompt);
  return m ? m[1].trim() : "your account";
}

function adpulseDiagnosis(prompt) {
  const bname = brandFromPrompt(prompt);
  return {
    score: 54,
    headline: `${bname}: you're losing money on prospecting and underfunding your best retargeting.`,
    wins: [
      { title: "Retargeting carries the account", detail: "ROAS 4.2 on the 7d window — the only line reliably returning cash." },
      { title: "Creative CTR beats benchmark", detail: "1.81% CTR on warm audiences vs the ~1% category norm." },
    ],
    leaks: [
      { title: "Broad prospecting is bleeding", detail: "ROAS 0.8 over 30 days on the largest single line item.", monthlyBurn: 42000 },
    ],
    actions: [
      { title: "Kill Prospecting — Broad", impact: "high", effort: "low", detail: "ROAS 0.8 for 30 days. Turn it off today and the loss stops today." },
      { title: "Shift that budget to Retargeting — 7d", impact: "high", effort: "low", detail: "Same spend at ROAS 4.2 is roughly 5× the return." },
      { title: "Cap frequency on the fatigued video", impact: "medium", effort: "low", detail: "Frequency past 6 with falling CTR — refresh the hook or cap it." },
      { title: "Rebuild the Lookalike 1% creative", impact: "medium", effort: "medium", detail: "ROAS 2.1 is stable but flat; the creative is the constraint, not the audience." },
    ],
    campaigns: [
      { name: "Prospecting — Broad", verdict: "kill", note: "ROAS 0.8, burning cash" },
      { name: "Retargeting — 7d", verdict: "scale", note: "ROAS 4.2, room to grow" },
      { name: "Lookalike 1%", verdict: "keep", note: "ROAS 2.1, stable" },
    ],
  };
}

function ideaFromPrompt(prompt) {
  const m = /THE IDEA \(ground truth[^)]*\):\s*"([\s\S]*?)"/.exec(prompt);
  return m ? m[1].trim() : "your idea";
}

function batchDraft(prompt) {
  // The connector's batch `draft` asks for all 8 YC answers as {answers:[{n,answer}]}. Return a
  // structurally-valid draft grounded in the idea (canned prose — this is the mock, not a model).
  const idea = ideaFromPrompt(prompt);
  const a = (n, answer) => ({ n, answer });
  return JSON.stringify({
    answers: [
      a(1, String(idea).slice(0, 50)),
      a(2, `We're building ${idea}. [Describe the core loop and what the user does — grounded in your ground truth.]`),
      a(3, `We picked this because [your insight]. Founder story: [yours to add]. We know people need it because [evidence].`),
      a(4, `Today people resort to [substitutes] and hit [limits]. What's new: [the genuinely new thing].`),
      a(5, `Competitors: [the real field]. What we understand that they don't: [the moat].`),
      a(6, `[Who pays] pays for [what], about [price]. Sizing: [labeled arithmetic your ground truth supports].`),
      a(7, `So far: [what's genuinely done]. Riskiest assumption: [X]; cheapest test: [Y]. Next proof: [Z].`),
      a(8, `First 100 users: [concrete move] via [channel]. Beachhead: [segment]. Cold-start: [tactic].`),
    ],
  });
}

// Redline — mirrors the harness responder (examples/apps/harness/provider.js redlineAudit/Respond).
function redlineAudit() {
  const slop = ["seamless", "unleash", "empower", "elevate", "game-changing"];
  return JSON.stringify(slop.map((w) => ({
    tag: "p", label: "AI-slop: " + w,
    snippet: "We " + w + " your workflow with next-gen synergy.",
    issue: "Empty hype word '" + w + "' — say the concrete thing instead.",
    find: "We " + w + " your workflow with next-gen synergy.",
    replace: "We do the specific job — in plain words.",
    preview: "Concrete, on-brand rewrite.",
  })));
}
function redlineRespond(p) {
  const note = (p.match(/Reviewer's comment: "([\s\S]*?)"\n/) || [])[1] || "";
  const vis = (p.match(/Current visible text: "([^"\n]{1,})"/) || [])[1] || "the headline";
  const sel = (p.match(/Element CSS path: (\S+)/) || [])[1] || "";
  if (/^Mock up/i.test(note)) return JSON.stringify({ mode: "image", brief: "A stronger hero visual — product-forward, match the page palette, no text overlays" });
  if (/^Entrance:/i.test(note) || /^Backdrop:/i.test(note)) {
    const id = sel.charAt(0) === "#" ? sel.slice(1) : null;
    if (!id) return JSON.stringify({ mode: "reply", markdown: "This section has no id to anchor a style edit — give it one and ask again." });
    const open = 'id="' + id + '"', isBack = /^Backdrop:/i.test(note);
    const mk = (label, style, rec) => ({ label, replace: open + " " + style, preview: label, recommended: rec });
    return JSON.stringify({
      mode: "edit", summary: isBack ? "Restyle the backdrop" : "Soften the entrance", find: open,
      options: isBack
        ? [mk("Deep gradient", 'data-backdrop="gradient"', true), mk("Subtle texture", 'data-backdrop="texture"', false)]
        : [mk("Gentle rise (0.8s)", 'data-entrance="rise-800"', true), mk("Slow drift (1.6s)", 'data-entrance="drift-1600"', false)],
    });
  }
  return JSON.stringify({
    mode: "edit", summary: "Tighten the copy", find: vis,
    options: [
      { label: "Tighter", replace: vis.split(" ").slice(0, Math.max(3, Math.ceil(vis.split(" ").length / 2))).join(" "), preview: "Tighter cut of the line.", recommended: true },
      { label: "Punchier", replace: vis + " — and here's why it matters.", preview: "Punchier rewrite.", recommended: false },
    ],
  });
}

// Autopilot — the four decision option-arrays (mirrors harness autopilotSlate). Each `ask` string
// is unique, so route on it. Exactly one recommended per array.
function autopilotSlate(prompt) {
  const rec = (arr) => { arr.forEach((o) => (o.recommended = false)); arr[0].recommended = true; return arr; };
  if (/3 distinct voices this company could speak in/i.test(prompt)) return JSON.stringify(rec([
    { label: "Warm operator", text: "Talks like someone who has done the job, not sold the tool.", lines: ["We do the boring half, you keep the judgement.", "No dashboards you'll never open.", "You'll know what changed and why."] },
    { label: "Dry and exact", text: "Spec-first — never an adjective it cannot measure.", lines: ["Shipped to spec.", "Every claim here is a number.", "No hedging, no filler."] },
    { label: "Deadpan", text: "Undersells on purpose and trusts you to get it.", lines: ["It works. It's also good.", "We were surprised too.", "Tastes like you tried."] },
  ]));
  if (/3 ad angles\./i.test(prompt)) return JSON.stringify(rec([
    { label: "Objection: trust", text: "Nothing sends without you", body: "Every move is staged and waits for your go.", cta: "See it staged" },
    { label: "Objection: effort", text: "Zero input to start", body: "Lend it what you already have and the slate drafts itself.", cta: "Start free" },
    { label: "Objection: price", text: "Capacity, not a subscription", body: "You fund work in tokens and stop whenever you want.", cta: "See the maths" },
  ]));
  if (/3 places to run this angle/i.test(prompt)) return JSON.stringify(rec([
    { label: "Founder communities", text: "This buyer already asks these questions in public.", body: "One honest post a week; no budget, real replies." },
    { label: "Paid search", text: "They search the problem by name before they search you.", body: "Ten exact-match terms, a small daily cap, one landing page." },
    { label: "Partner newsletters", text: "Borrowed trust from someone they already read.", body: "Three lists, one swap each — costs a written intro, not money." },
  ]));
  return JSON.stringify(rec([
    { label: "New surface", text: "The core feature as a standalone page", body: "It is the thing people already ask for by name." },
    { label: "New segment", text: "A version for the adjacent buyer", body: "Same engine, a vocabulary they recognise." },
    { label: "New format", text: "A weekly digest of what changed", body: "Turns one-off use into a habit." },
  ]));
}

// Autopilot — the next PLAYS, each tagged auto|approve|manual with the connector it'd use.
function autopilotMoves() {
  return JSON.stringify([
    { title: "Draft the launch social", detail: "three posts in the chosen voice, ready to schedule", mode: "auto", connector: "social" },
    { title: "Build the landing page", detail: "the chosen angle, one clear CTA above the fold", mode: "auto", connector: "deploy" },
    { title: "Stage outreach to 20 warm leads", detail: "cold email to the beachhead — waits for your go", mode: "approve", connector: "gmail" },
    { title: "Set up payments", detail: "a checkout for the first product — needs your go", mode: "approve", connector: "payments" },
    { title: "Post in a founder community", detail: "one honest post where the buyer already asks this", mode: "manual", connector: "none" },
  ]);
}
// Autopilot — the day's plan: the one thing that matters, then the prioritized moves.
function autopilotPlan() {
  return JSON.stringify({
    headline: "Get the first honest signal — ship the page and start the outreach; nothing else matters until someone replies.",
    today: [
      { title: "Ship the landing page", detail: "the chosen angle, one clear call to action" },
      { title: "Draft + stage 20 outreach emails", detail: "warm and specific, waiting for your go" },
      { title: "Post once in a founder community", detail: "where the buyer already asks this question" },
    ],
  });
}

function ideabrainBrief(prompt) {
  const idea = (prompt.match(/My brand idea:\s*([\s\S]*?)\n/) || [])[1]?.trim() || "your idea";
  const market = (prompt.match(/target market:\s*"([^"]+)"/) || [])[1] || "";
  return JSON.stringify({
    productIdea: idea.slice(0, 80),
    category: "[category — mock]",
    audience: "early adopters who feel this problem acutely",
    demographics: "25-40, urban, mid-high income" + (market ? `, ${market}` : ""),
    priceTier: "Mid",
    market: market || "primary market",
    vibe: "sharp, honest, useful, modern",
    positioningHint: `the ${idea.slice(0, 40)} that respects your time`,
  });
}

// First-match-wins, same idea as the harness ROUTES table. Extend as more actions come online.
const ROUTES = [
  [(p) => /you are adpulse|blunt, numbers-first|pre-computed aggregates|monthlyburn/i.test(p), (p) => JSON.stringify(adpulseDiagnosis(p))],
  [(p) => /you are batch|"answers":\s*\[\s*\{\s*"n"/i.test(p), (p) => batchDraft(p)],
  [(p) => /propose its next MOVES|Tag each with a MODE/i.test(p), () => autopilotMoves()],
  [(p) => /operating CEO of this company, writing today's plan|writing today's plan/i.test(p), () => autopilotPlan()],
  [(p) => /you are autopilot/i.test(p), (p) => autopilotSlate(p)],
  [(p) => /expand it into a sharp, specific brief/i.test(p), (p) => ideabrainBrief(p)],
  // Redline respond-router BEFORE audit (both mention "Redline"); key on the router's own wording.
  [(p) => /choose a mode|left a comment on one element|the comment wants to change/i.test(p), (p) => redlineRespond(p)],
  [(p) => /worst offenders|ai-slop copy|walls of meta-text|most damaging first/i.test(p), () => redlineAudit()],
];

function respond(prompt) {
  for (const [test, produce] of ROUTES) if (test(prompt)) return produce(prompt);
  // Generic: hand back an object so a JSON-parsing action still gets something structurally valid.
  return JSON.stringify({ ok: true, note: "mock sb: no route matched this prompt", echo: prompt.slice(0, 120) });
}

/** The mock `sb`: only `stream` is needed by the pilot action, but complete/storage/context are
 *  present so it can stand in for more actions later. */
export function mockSb() {
  const streamFor = async function* (params) {
    const prompt = params.prompt || (params.messages ? params.messages.map((m) => m.content).join("\n") : "") || "";
    const text = respond(prompt);
    yield { type: "text", text };
    yield { type: "done", result: { text, model: "mock-sonnet", usage: { inputTokens: 400, outputTokens: 220 } } };
  };
  return {
    mode: "mock",
    stream: streamFor,
    complete: async (params) => {
      const prompt = params.prompt || "";
      return { text: respond(prompt), model: "mock-sonnet", usage: { inputTokens: 400, outputTokens: 220 } };
    },
    storage: { get: async () => null, list: async () => [] },
    context: { active: async () => null },
  };
}
