// Record — the capability that refuses to end a pipeline step with "you go do it." The content
// pipeline (ideabrain → draft → …) produces a WRITTEN post. The next real step is a human recording a
// video of it — the one irreducibly-human part: a face and a voice talking to camera. Everything AROUND
// that is not human work, so we do ALL of it: rewrite the post into spoken teleprompter lines, plan the
// shots and screen-captures, write the setup checklist — and then hand the founder a GUIDED teach-mode
// "guru" flow that walks them line-by-line through the take. They supply only their face and voice.
//
// This is the hard product principle made mechanical: a step that needs the human does the MAXIMUM for
// them and then LAUNCHES the guided part; it never stops at an instruction. Concretely the capability
// ships two features on one definition:
//   • plan(input, sb)            — turn a written post into a SPOKEN, camera-ready plan (one model call).
//   • buildRecordGuide({…})      — a PURE builder that turns that plan into a teach-mode guide-run.json
//                                  object: the "guru does every step" artifact the notch/CursorGuide
//                                  runs. Each teleprompter line is a step whose `say` is spoken aloud on
//                                  device and whose `text` tells the human what to do ("read this to
//                                  camera"). The human just talks; the guide shows and says each line.
//
// `sb` is the same capability subset the SDK's `relay` exposes:
//   sb.stream(params)   -> async-iterable<StreamDelta>   (the model call)
//   sb.context.active() -> Context|null                  (the brand/project to ground tone in)
// The harness / a test supplies a MOCK sb; the daemon supplies the gated one. Same functions, same
// output shape — that parity is the whole point (see draft.core.js / reachout.core.js for the siblings).
//
// PURE ESM, NO DOM: imports cleanly in Node (connector / test) and the browser bundle.

// ─────────────────────────── the brief (tone to ground in) ───────────────────────────

/** Normalize a lent brand/project context (or any loose object) to the few fields the prompt uses to
 *  keep the SPOKEN lines on-voice. Mirrors draft.normalizeBrief — every field optional. */
export function normalizeBrief(ctx) {
  if (!ctx) return null;
  const d = ctx.data || ctx;
  const str = (v) => String(v ?? "").trim();
  return {
    name: str(ctx.name || d.name || d.company),
    about: str(d.about || d.productIdea || d.oneLine || d.tagline),
    voice: str(d.voice || d.vibe),
    audience: str(d.audience),
  };
}

// ─────────────────────────── the prompt ───────────────────────────

/** The factual honesty clause — same posture as draft/reachout: a spoken take can't invent facts. */
export const HONESTY =
  "Never add a fact, a number, a claim, or a name that isn't already in the post. Recording it out loud does not make it truer — if it wasn't written, don't say it.";

/** THE VOICE RULE for a SPOKEN take. A written post read verbatim to camera sounds like reading. The
 *  single failure mode this kills is teleprompter lines that sound WRITTEN instead of like a person
 *  talking. Grounded in the same plain, un-announced spirit as draft.core.js's VOICE. */
export const VOICE = [
  "VOICE: these lines are SPOKEN to a camera, not read off a page. Write how the person actually talks — contractions, short breaths, the plainest true version. If a written sentence would sound stiff out loud, loosen it; keep the meaning, lose the polish.",
  "ONE breath per line. Segment the take so each teleprompter line is one short spoken beat a person can say in a single glance-and-look-back-up — roughly 4–9 seconds. Never a paragraph.",
  "Open on the truest, most concrete thing — a moment, a plain admission — never 'Hey guys' or a channel intro or a product pitch. No 'welcome back', no 'in this video'.",
  "NO sign-off cliché — no 'smash that like', no 'link in bio', no 'let me know in the comments'. Let it end when the thought is done.",
  "Keep the person's own words from the post verbatim wherever they're already speakable. Don't upgrade their phrasing into cleverer words.",
].join("\n");

/** Ground block from a brief — keeps the spoken rewrite in the person's register. Pure. */
function briefBlock(brief) {
  if (!brief) return "TONE: none lent — keep it plain, first-person, spoken-aloud honest.";
  return [
    "TONE (keep the spoken lines in this register — it's what makes the take theirs):",
    brief.name ? `Who: ${brief.name}.` : "",
    brief.about ? `About: ${brief.about}.` : "",
    brief.voice ? `Voice: ${brief.voice}.` : "",
    brief.audience ? `Audience: ${brief.audience}.` : "",
  ].filter(Boolean).join(" ");
}

/** Build the PLAN prompt: written post → spoken teleprompter + shot plan + setup checklist. Pure. */
export function buildPlanPrompt({ brief, format, body, steers }) {
  return [
    "You are Record. You turn a WRITTEN social post into a SPOKEN, camera-ready plan a person can record themselves talking through. You do the whole job around the human so all they have to do is talk.",
    VOICE,
    briefBlock(brief),
    format ? `THE POST'S FORMAT: ${format} (context only — the take is a person talking to camera, not the text on screen).` : "",
    `THE WRITTEN POST (rewrite THIS into spoken lines — same substance, spoken register):\n${String(body || "").trim()}`,
    steers && steers.length ? `Steering (apply the latest, it wins): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
    "Produce THREE things:",
    "1) teleprompter: the post rewritten as an ordered list of short spoken lines (one breath each, ~4–9s), each with a rough `seconds` estimate. This is what scrolls on the teleprompter and is spoken aloud.",
    "2) shots: a short shot plan — for each segment, the camera framing (e.g. 'medium, eyes to lens') and a `capture` note for when to screen-capture or cut to b-roll (or 'talking head' when it's just them). Keep it to a handful of shots, aligned to the take.",
    "3) setup: a short setup checklist BEFORE recording — lighting, mic, framing, background. Plain imperative items.",
    HONESTY,
    'Return ONLY a JSON object — no prose, no markdown fences — exactly: {"teleprompter":[{"line":"…","seconds":6}],"shots":[{"shot":"…","framing":"…","capture":"…"}],"setup":["…"]}. Lines are plain spoken text.',
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

/** Rough per-line seconds when the model omits one: ~0.4s per word, floored/capped to a sane beat. */
function estimateSeconds(line) {
  const words = String(line || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.min(15, Math.round(words * 0.4)));
}

/** Coerce a plan reply into { teleprompter, shots, setup, durationSec }. Never throws; salvages a lot. */
export function normalizePlan(text) {
  const obj = firstJsonObject(text) || {};

  const tRaw = Array.isArray(obj.teleprompter) ? obj.teleprompter
    : Array.isArray(obj.lines) ? obj.lines
    : Array.isArray(obj.script) ? obj.script : [];
  const teleprompter = tRaw
    .map((x) => {
      const line = typeof x === "string" ? x : String(x?.line ?? x?.text ?? "").trim();
      if (!line) return null;
      const secs = Number(x?.seconds ?? x?.sec ?? x?.duration);
      return { line, seconds: Number.isFinite(secs) && secs > 0 ? Math.round(secs) : estimateSeconds(line) };
    })
    .filter(Boolean);

  const sRaw = Array.isArray(obj.shots) ? obj.shots : [];
  const shots = sRaw
    .map((x, i) => ({
      shot: String(x?.shot ?? x?.name ?? `Shot ${i + 1}`).trim(),
      framing: String(x?.framing ?? x?.frame ?? "").trim(),
      capture: String(x?.capture ?? x?.broll ?? x?.bRoll ?? "talking head").trim() || "talking head",
    }))
    .filter((s) => s.shot || s.framing || s.capture);

  const setRaw = Array.isArray(obj.setup) ? obj.setup : Array.isArray(obj.checklist) ? obj.checklist : [];
  const setup = setRaw.map((s) => String(typeof s === "string" ? s : s?.item ?? s?.text ?? "").trim()).filter(Boolean);

  const durationSec = teleprompter.reduce((a, t) => a + (t.seconds || 0), 0);
  return { teleprompter, shots, setup, durationSec };
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

// ─────────────────────────── the teach-mode guide builder (the "guru does every step" artifact) ───────────────────────────

/** slug a string into a stable, unique-able step-id fragment. */
function slug(s, fallback) {
  const out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return out || fallback;
}

/** THE PURE BUILDER — turn a plan into a teach-mode guide-run.json OBJECT that walks the recording:
 *  one setup step per checklist item, a camera-framing step, one teleprompter step PER spoken line
 *  (say = the line, text = "read this to camera"), and a final "review your take" step. No `sb`, no
 *  side effects — the DOM/connector/notch writes the returned object to ~/.relay/guide-run.json and the
 *  native CursorGuide.begin(...) runs it. `source:"God"`, `mode:"teach"`.
 *
 *  This is where the principle lands: the human never gets told "now go record it." They get a guided
 *  flow that shows and SPEAKS every line; the only thing they do is talk. NEVER put a secret in `copy`. */
export function buildRecordGuide({ piece, plan, project } = {}) {
  const p = plan || {};
  const tele = Array.isArray(p.teleprompter) ? p.teleprompter.filter((t) => t && String(t.line || "").trim()) : [];
  const setup = Array.isArray(p.setup) ? p.setup.filter((s) => String(s || "").trim()) : [];
  const shots = Array.isArray(p.shots) ? p.shots : [];
  const format = piece?.format ? String(piece.format) : "";
  const totalSec = tele.reduce((a, t) => a + (Number(t.seconds) || 0), 0) || p.durationSec || 0;

  const steps = [];
  const used = new Set();
  const pushId = (base) => {
    let id = base, n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };

  // 1) setup checklist — one step each, spoken so the founder can prep hands-free.
  setup.forEach((item, i) => {
    steps.push({
      id: pushId(`setup-${slug(item, String(i + 1))}`),
      text: item,
      hint: "Ready when this is done.",
      say: item,
    });
  });

  // 2) camera-framing step — from the first shot's framing if we have one.
  const framing = shots.find((s) => s?.framing)?.framing || "Medium shot, eyes to the lens, phone at eye level.";
  steps.push({
    id: pushId("frame"),
    text: `Set your frame: ${framing}`,
    hint: "You can see yourself, eyes to the lens.",
    say: "Now let's frame the shot. Look right into the lens, not at yourself.",
  });

  // 3) one step PER teleprompter line — the guru speaks each line; the human reads it to camera.
  //    `say` = the exact line (spoken aloud on device), `text` = the instruction, `hold` = its seconds.
  tele.forEach((t, i) => {
    const line = String(t.line).trim();
    const secs = Number(t.seconds) || 0;
    steps.push({
      id: pushId(`line-${i + 1}`),
      text: "Read this to camera",
      hint: `Line ${i + 1} of ${tele.length}${secs ? ` · ~${secs}s` : ""}`,
      say: line,
      copy: line,                       // non-secret: the spoken line itself, handy to paste into a teleprompter app.
      ...(secs ? { hold: Math.round(secs * 1000) } : {}),
    });
  });

  // 4) review your take — the last step; nothing more is asked of them.
  steps.push({
    id: pushId("review"),
    text: "Review your take",
    hint: "Watch it back once; re-record any line that felt off.",
    say: "That's the whole take. Watch it back once, and if a line felt off, just do that one again.",
  });

  const title = piece?.hook
    ? `Record: ${String(piece.hook).slice(0, 60)}`
    : `Record your ${format || "post"}`;

  return {
    mode: "teach",
    title,
    source: "God",
    project: String(project || ""),
    steps,
    // non-schema metadata some runners surface; harmless to the ones that don't.
    meta: { format, lines: tele.length, durationSec: totalSec },
  };
}

// ─────────────────────────── the actions ───────────────────────────

/** THE ACTION #1 — plan a take: a written post → a spoken, camera-ready plan. Pure model call.
 *  input: { piece:{format?, body}, brief?, steers? }. Returns { teleprompter, shots, setup, durationSec }. */
export async function plan(input, sb) {
  const piece = input?.piece || {};
  const body = piece.body ?? input?.body;
  if (!body) throw new Error("plan needs { piece: { body } } — the written post to turn into a take.");
  const format = piece.format || input?.format || "";
  const brief = input?.brief !== undefined ? normalizeBrief(input.brief)
    : normalizeBrief(await sb.context?.active?.().catch(() => null));
  const prompt = buildPlanPrompt({ brief, format, body, steers: input?.steers });
  const text = await runPrompt(sb, prompt);
  return normalizePlan(text);
}

/** THE ACTION #2 — plan a take AND emit its teach-mode guide in one shot. This is the "do the max, then
 *  launch the guided part" action: the caller gets both the plan (to show) and the guide-run.json object
 *  (to write to ~/.relay/guide-run.json so CursorGuide runs it). Pure model call + pure build.
 *  input: { piece:{format?, hook?, body}, brief?, project?, steers? }. Returns { plan, guide }. */
export async function guide(input, sb) {
  const built = await plan(input, sb);
  const guideObj = buildRecordGuide({ piece: input?.piece || {}, plan: built, project: input?.project });
  return { plan: built, guide: guideObj };
}

// ─────────────────────────── the agent-facing manifest ───────────────────────────
// Register EXACTLY like the others in packages/switchboard-mcp/registry.mjs:
//   import record from "…/record.core.js";  → add `record` to MANIFESTS.
// That renders it as MCP tools wrapp__record__plan and wrapp__record__guide, and (via run(input, sb))
// makes it composable by the launcher's planner. NO connector grant — planning is a pure model call and
// the guide is a pure object the notch writes; tools:[].
export const manifest = {
  name: "record",
  title: "Record",
  origin: "https://record.thelastprompt.ai",
  scope: { models: ["sonnet"], contextKinds: ["brand", "project"], tools: [] },
  actions: [
    {
      name: "plan",
      summary:
        "Turn a WRITTEN post into a SPOKEN, camera-ready plan: teleprompter lines (one breath each, with rough seconds), a shot plan (framing + when to screen-capture / cut b-roll), and a setup checklist (lighting/mic/frame). Does the whole job around the human so all they do is talk. Runs on the user's own Claude; no side effects.",
      input: {
        piece: "object — { format?, body } — the written post to record. Required (body).",
        brief: "object? — { name, about, voice, audience } to keep the spoken lines on-voice. Falls back to the active context.",
        steers: "string[]? — steering, e.g. 'more casual', 'cut it to 30 seconds', 'lead with the admission'.",
      },
      output: {
        teleprompter: "[{ line, seconds }] — the post rewritten as spoken lines",
        shots: "[{ shot, framing, capture }] — the shot plan",
        setup: "string[] — the pre-record checklist",
        durationSec: "number — total spoken seconds",
      },
      run: plan,
    },
    {
      name: "guide",
      summary:
        "Plan the take AND emit its teach-mode guide-run.json object in one call — the 'do the max for them, then launch the guided part' action. Returns { plan, guide }; the guide walks the recording step-by-step (setup, framing, one teleprompter step per line where it SPEAKS the line while the human reads it to camera, then review). Write `guide` to ~/.relay/guide-run.json to run it. Pure model call + pure build; no side effects.",
      input: {
        piece: "object — { format?, hook?, body } — the written post to record. Required (body).",
        brief: "object? — tone context; falls back to the active context.",
        project: "string? — project label shown on the guide card.",
        steers: "string[]? — steering for the spoken rewrite.",
      },
      output: {
        plan: "{ teleprompter, shots, setup, durationSec } — the same plan `plan` returns",
        guide: "teach-mode guide-run.json object { mode:'teach', title, source:'God', project, steps[] }",
      },
      run: guide,
    },
  ],
};

export default manifest;
