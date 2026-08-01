// Batch — the YC-application orchestration, shared between the DOM wrapp (src/batch.js) and the
// headless connector (docs/WRAPPS-FOR-AGENTS.md §1). The TUNED CONTENT — the 8 YC questions + their
// per-question drafting guidance, the honesty contract, the thesis-branch line — lives here as the
// single source of truth; the DOM wrapp imports it (so an edit to a question can't drift between the
// two surfaces).
//
// The DOM app drafts one question at a time (3 option cards, steerable) — the right shape for a
// human clicking through. A headless agent wants the whole draft in one shot, so the connector's
// `draft(input, sb)` runs ONE call that answers all 8. Same questions, same honesty rules; different
// composition — exactly the split the spec allows (expose the composable action, keep the
// interactive parts in the browser).
//
// PURE ESM, NO DOM.

/** The 8 YC application questions + per-question drafting guidance (carved from brandbrain's
 *  ideabrain yc-* tasks — these contracts were tuned; change with care). Shared with src/batch.js. */
export const QUESTIONS = [
  { n: 1, q: "Describe what your company does in 50 characters or less.",
    guide: "The answer IS the one-liner — 50 characters or fewer, plain and concrete, no hype. Angles: outcome-first, analogy, mechanism." },
  { n: 2, q: "What is your company going to make? Describe your product and what it does or will do.",
    guide: "80–160 words of flowing first-person-plural prose — plain confident words, concrete specifics pulled ONLY from the ground truth, no hype adjectives, no lists." },
  { n: 3, q: "Why did you pick this idea to work on? Do you have domain expertise? How do you know people need what you're making?",
    guide: "80–160 words, first person. NEVER invent biography, credentials or evidence; if the founder story isn't in the ground truth, argue from the insight and mark the founder story as [yours to add]." },
  { n: 4, q: "What's new about what you're making? What substitutes do people resort to because it doesn't exist yet (or they don't know about it)?",
    guide: "80–160 words. Name the real substitutes people resort to today and where each falls short, then the genuinely new thing — plain words, nothing invented." },
  { n: 5, q: "Who are your competitors? What do you understand about your business that they don't?",
    guide: "80–160 words: the real competitive field, then the ONE understanding that's yours (the moat) — concrete, no bravado." },
  { n: 6, q: "How do or will you make money? How much could you make?",
    guide: "80–160 words: who pays, for what, roughly how much. Sizing only as labeled arithmetic the ground truth supports — never invent figures." },
  { n: 7, q: "How far along are you?",
    guide: "60–120 words, HONEST about stage: what's genuinely done, the riskiest assumption and its cheapest test, the next proof point. Never claim users, revenue or a build the ground truth doesn't state." },
  { n: 8, q: "How will you get users? If your idea faces a chicken-and-egg problem, how will you crack it?",
    guide: "80–160 words: the concrete first-100-users move, the beachhead, and any cold-start tactic — specific channels and first moves, no hand-waving." },
];

/** The two videos YC asks for. Shared with src/batch.js. */
export const VIDEOS = [
  { key: "founder", title: "Founder video", sub: "1 minute · camera · unedited — who you are, what you're building", mode: "camera", maxSeconds: 60, fileName: "founder-video.webm",
    guide: "Talking points for a 60-second unedited founder video: 5–7 short beats, first person, plain SPOKEN words (things a human says to a camera, not prose). Ground every claim in the ground truth and the picked answers; never invent biography or numbers." },
  { key: "demo", title: "Product demo video", sub: "up to 3 minutes · screen — the real product doing the core loop", mode: "screen", maxSeconds: 180, fileName: "demo-video.webm",
    guide: "A shot list for a ≤3-minute screen demo: 5–8 beats, each = what is on screen + the one spoken line over it. Show the real product's core loop end to end; no slides, no invented features." },
];

/** The honesty contract — nothing fabricated beyond the ground truth. Shared verbatim. */
export const HONESTY =
  'Honesty contract: never invent facts, metrics, names, users, or biography beyond the ground truth. Where a needed fact is missing, write around it and mark the spot like "[your metric here]".';

/** The branch line — a founder's SETTLED answers condition the others so the app is one story. */
export const THESIS_LINE =
  "THE FOUNDER'S SETTLED ANSWERS to other questions (also ground truth). They are decided — do not contradict them, do not re-argue them, and make this answer part of the SAME story: reuse their framing and vocabulary where it fits, and stay consistent on the business model, the moat and the stage.";

/** Ground-truth lines from the founder's one line + any lent context (brand/project). Shared. */
export function groundTruthLines({ idea, context }) {
  return [
    `THE IDEA (ground truth — the ONLY source of facts): "${String(idea || "").trim()}"`,
    context ? `LENT CONTEXT "${context.name || "context"}" (also ground truth): ${JSON.stringify(context.data || context).slice(0, 3000)}` : "",
    HONESTY,
  ].filter(Boolean);
}

function parseJsonObject(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

/**
 * The headless full-draft prompt: all 8 answers in ONE call. Keeps the exact question text + guide
 * the DOM uses, so the two surfaces answer the same questions the same way.
 */
export function buildFullPrompt({ idea, context }) {
  return [
    "You are Batch, drafting a founder's Y Combinator application on their own Claude — the complete application in one pass.",
    ...groundTruthLines({ idea, context }),
    "Draft an answer to EACH of these 8 questions. Follow each question's guidance exactly:",
    QUESTIONS.map((q) => `Q${q.n}. ${q.q}\n   Guidance: ${q.guide}`).join("\n"),
    "Make the eight answers ONE coherent story — consistent on the product, the business model, the moat and the stage; reuse framing across answers where it fits.",
    'Return ONLY a JSON object — no prose, no markdown fences — exactly: {"answers":[{"n":<1-8>,"answer":<the complete answer for that question>}]} with all 8 entries in order.',
  ].join("\n\n");
}

/**
 * THE ACTION. Headless "draft my YC application" — input { idea, context? }, one model call, all 8
 * answers back. (The DOM wrapp's per-question steering stays in the browser; this is the composable
 * whole-draft an agent asks for.)
 */
export async function draft(input, sb) {
  const idea = String(input?.idea ?? "").trim();
  if (!idea) throw new Error("draft needs `idea`: one line on what you're building (the ground truth the whole application is drafted from).");
  const context = input?.context || null;
  const prompt = buildFullPrompt({ idea, context });

  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  const data = parseJsonObject(text);
  const raw = Array.isArray(data?.answers) ? data.answers : null;
  if (!raw) throw new Error("the model didn't return the expected {answers:[…]} JSON — retry.");

  const byN = new Map(raw.map((a) => [Number(a?.n), String(a?.answer ?? "").trim()]));
  const answers = QUESTIONS.map((q) => ({ n: q.n, question: q.q, answer: byN.get(q.n) || "" }));
  return {
    answers,
    drafted: answers.filter((a) => a.answer).length,
    note: "Drafted on the user's own Claude, grounded only in the idea (+ lent context). Nothing fabricated; [bracketed] spots are the founder's to fill. Edit into your own voice before submitting.",
  };
}

export const manifest = {
  name: "batch",
  title: "Batch",
  origin: "https://batch.thelastprompt.ai",
  scope: { models: ["sonnet"] },
  actions: [
    {
      name: "draft",
      summary:
        "Draft a full Y Combinator application from a one-line idea: an answer to each of the 8 YC questions, as one coherent story, following an honesty contract (nothing fabricated; missing facts marked [like this]). Runs on the user's own Claude.",
      input: {
        idea: "string — one line on what you're building; the ground truth the whole application is drafted from. Required.",
        context: "object? — a lent brand/project context {name, data} to also ground the answers in.",
      },
      output: { answers: "[{ n, question, answer }] (all 8)", drafted: "how many were drafted", note: "the honesty framing" },
      run: draft,
    },
  ],
};

export default manifest;
