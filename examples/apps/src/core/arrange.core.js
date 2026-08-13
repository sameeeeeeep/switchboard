// Arrange — the EDITOR capability. draft.core.js WRITES content; this one refuses to. It takes what a
// specific person actually said, in their own voice, and only makes it postable: cut filler, fix
// transcription, break into lines, reorder for flow. It never adds a sentence, never "improves" a word,
// never reaches for a hook or a closing line. Because a person's own plain words beat anything a model
// drafts — the founder's "just looking at a lot of stream text getting anxious for no reason" is better
// than any line the writer produced, and the whole job is to not wreck it.
//
// This exists because generate-from-a-brief (draft.core.js) produced content-shaped slop for personal
// posts. `arrange` is what should back notch select-and-say for a founder's own voice: you talk, it trims.
//
// `sb` is the same surface: sb.stream(params). PURE ESM, NO DOM.

// ─────────────────────────── the editor rules (the whole point) ───────────────────────────

/** The editor contract. Every ALLOWED line is a cut/fix/reorder; every FORBIDDEN line is an act of
 *  writing. If the model is tempted to improve, the rule is: don't. */
export const EDITOR_RULES = [
  "You are an EDITOR, not a writer. The text below is something a specific person actually said, in their own voice. Your ONLY job is to make it postable WITHOUT changing whose words they are.",
  "ALLOWED: remove filler and repetition; fix transcription errors and typos; break it into short lines or a few short paragraphs; reorder for the way it reads best; drop a redundant clause.",
  "FORBIDDEN: writing any new sentence; swapping their words for 'better' or cleverer ones; adding a hook, an opening line, a closing line, a call to action, a summary, a metaphor, or an aphorism; making it punchier. Do NOT try to make any line 'land'.",
  "Keep their exact phrasing wherever you can — including casual, lowercase, unfinished-sounding style. If a bit is already good, leave it completely alone. When in doubt, cut rather than rewrite.",
  "You are allowed to end up changing almost nothing. That is a success, not a failure. The best possible output is their words, lightly cut and ordered, and nothing else.",
].join("\n");

/** Per-format shaping — still edit-only. Just says how to break it up, never how to rewrite it. */
export function arrangeShape(format) {
  switch (String(format || "").toLowerCase()) {
    case "x-thread":
      return "Shape: an X thread. If it naturally breaks into beats, number them 1/ 2/ … and put one beat per part, ≤270 chars each — but only split their existing words; do not write connective tissue between beats.";
    case "linkedin":
      return "Shape: short paragraphs, one thought each. No hashtags, no sign-off.";
    case "x-single":
      return "Shape: one short post, ≤270 chars. If their words are longer, CUT down to the truest part — do not rewrite to fit.";
    default:
      return "Shape: short lines/paragraphs, whatever fits their words most plainly.";
  }
}

/** Build the arrange prompt. Pure. `steers` are EDITORIAL nudges only (e.g. 'shorter', 'cut the last
 *  line', 'keep it rawer') — never 'make it punchier' style rewrites; the rules above still bind. */
export function buildArrangePrompt({ raw, format, steers }) {
  return [
    EDITOR_RULES,
    arrangeShape(format),
    steers && steers.length ? `Editorial steer (still edit-only — cut/reorder, do not rewrite): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
    "THEIR WORDS (arrange these — do not write new ones):",
    String(raw || "").trim(),
    "Output ONLY the arranged text. No preamble, no quotes around it, no notes, no JSON.",
  ].filter(Boolean).join("\n\n");
}

/** Coerce the reply to plain text — strip any fences/labels the model adds. Never throws. */
export function normalizeArranged(text) {
  let t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  // drop a leading "Here's..." line if the model ignored the no-preamble instruction
  t = t.replace(/^\s*(here'?s|arranged|output)\b[^\n]*\n+/i, "").trim();
  return { body: t };
}

// ─────────────────────────── the action ───────────────────────────

/** THE ACTION — arrange one block of the person's own words. input: { raw|body, format?, steers? }.
 *  Returns { body }. Pure model call, no side effects. */
export async function arrange(input, sb) {
  const raw = input?.raw ?? input?.body;
  if (!raw || !String(raw).trim()) throw new Error("arrange needs { raw } — the person's own words to arrange.");
  const prompt = buildArrangePrompt({ raw, format: input?.format, steers: input?.steers });
  let text = "";
  for await (const d of sb.stream({ prompt })) {
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  return normalizeArranged(text);
}

// ─────────────────────────── manifest ───────────────────────────
// Register in packages/switchboard-mcp/registry.mjs: import arrange + push onto MANIFESTS →
// wrapp__arrange__arrange. No connector grant — pure model call, tools:[].
export const manifest = {
  name: "arrange",
  title: "Arrange",
  origin: "https://arrange.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand", "project"], tools: [] },
  actions: [
    {
      name: "arrange",
      summary:
        "Turn a person's own raw words (a voice note, a rant, a rough dump) into a postable version WITHOUT rewriting them — cut filler, fix transcription, break into lines, reorder. Never adds a sentence or a hook. The editor, not the writer; use this instead of draft for a person's own voice.",
      input: {
        raw: "string — the person's own words to arrange. Required.",
        format: "string? — x-thread, x-single, or linkedin (shapes the break-up only, never the wording).",
        steers: "string[]? — editorial nudges only: 'shorter', 'cut the last line', 'keep it rawer'.",
      },
      output: { body: "the arranged text — their words, cut and ordered" },
      run: arrange,
    },
  ],
};

export default manifest;
