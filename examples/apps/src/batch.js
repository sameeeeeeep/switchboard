// BATCH — your YC application drafted answer by answer, on the visitor's OWN Claude. Carved from
// brandbrain's ideabrain YC composer (lib/studio/yc-application.ts + the yc-* idea-pitch tasks) via
// the /wrapp carve mode: the 8 questions, options-per-answer, the honesty contract, and the .md
// export carried over; the board/locks chassis replaced by this template's plumbing; grounding
// swapped from locked decisions to the lent idea/project context + the founder's one line.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { mountRecorder } from "./kit/recorder.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "batch",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Batch",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Batch — drafts your YC application as option cards on your own Claude, grounded only in your idea and lent context",
    models: ["sonnet"],
    tools: [],
  },
  usesContext: "single",                        // a lent idea/project context becomes ground truth
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 160);
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function mdLite(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}
function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3200);
}

// ==== connect (standard chip + returning-user probe) ========================================
let relay = null;
let notInstalled = false;
let brand = null;         // the ONE lent context, when APP.usesContext === "single"
let wired = false;

mountConnect($("chip-dock"), {
  scope: APP.scope,
  context: APP.usesContext,
  installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; wire(r); void onReady(); },
  onDisconnect: () => { relay = null; render(); },
  onProjectChange: () => { void syncContext(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) { relay = r; wire(r); void onReady(); return; } }
  else if (r && r.installed === false) notInstalled = true;
  render();
})();
function wire(r) { if (wired) return; wired = true; r.on("permissionsChanged", () => void syncContext()); }
async function onReady() { await syncContext(); await loadState(); render(); autostart(); }

// CONTEXT-FIRST: the moment a context is lent, everything derives from it — options from
// data.products, tone from data.voice, colors from data.palette (FLAT hex strings — see
// docs/CONTEXT-KINDS.md). Hardcoded samples are allowed ONLY pre-connect, visibly labeled.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON) =============================
let state = { run: null };
async function loadState() { try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { run: null }; } }
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== llm helpers — the EXACT stream contract; never guess these shapes =====================
// relay.stream(params) is an async iterator of deltas:
//   { type:"text", text }  { type:"tool_proposed", call }  { type:"tool_result", result }
//   { type:"error", error:{ message } }  { type:"done", result }
// relay.complete(params) resolves { text, usage, stopReason }.
const STREAM_TIMEOUT_MS = 180000;
async function streamText(params, onProgress) {
  const it = relay.stream(params);
  let text = "", settled = false, timer = null;
  try {
    return await Promise.race([
      (async () => {
        for await (const d of it) {
          if (d.type === "text") { text += d.text; onProgress && onProgress({ text }); }
          else if (d.type === "tool_proposed") { onProgress && onProgress({ tool: d.call?.name }); }
          else if (d.type === "error") throw new Error(d.error?.message || "stream error");
        }
        settled = true;
        return text;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          try { it.return?.(); } catch { /* already closed */ }
          reject(new Error("Switchboard didn't respond — is the sidekick running? Reload this tab and try again."));
        }, STREAM_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
async function askJson(parts) { return parseJson(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
async function askJsonArray(parts) { return parseJsonArray(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}
// Image generation on the USER'S Higgsfield (agentic; needs HIGGSFIELD in the granted tools).
const IMG_URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
async function genImage(promptText) {
  const instruction = `Use the Higgsfield generate_image tool to generate an image of: "${promptText}", aspect_ratio "16:9". Wait for it to finish (poll job status if needed), then reply with ONLY the final image URL on its own line.`;
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const t = (d.result.content ?? []).map((x) => x.text ?? "").join(""); const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
  return url;
}

// ==== house UI atoms ========================================================================
// Option cards: 2–4 options, exactly ONE recommended. opts: [{ id, label, text?, imageUrl?, recommended? }]
function optionCards(opts, selectedId, onPick) {
  const wrap = el("div", "opts");
  for (const o of opts) {
    const card = el("div", "opt" + (o.id === selectedId ? " sel" : ""));
    card.onclick = () => onPick(o);
    card.append(el("div", "check", "✓"));
    if (o.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", o.label));
    if (o.text) card.append(el("div", "o-text", o.text));
    if (o.imageUrl) { const img = el("img", "o-img"); img.src = o.imageUrl; img.alt = o.label; card.append(img); }
    wrap.append(card);
  }
  return wrap;
}
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function steerRow(onSteer, chips) {
  const wrap = el("div", "steer");
  wrap.append(el("span", "kicker", "not quite? steer it"));
  const row1 = el("div", "chips");
  for (const s of (chips || STEER_CHIPS)) { const c = el("button", "chip", s); c.onclick = () => onSteer(s); row1.append(c); }
  wrap.append(row1);
  const row = el("div", "row");
  const box = el("div", "box");
  const input = el("input"); input.placeholder = "tell it what to change…";
  const send = () => { const t = input.value.trim(); if (!t) return; input.value = ""; onSteer(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  box.append(input);
  const btn = el("button", "send", "send"); btn.onclick = send;
  row.append(box, btn); wrap.append(row);
  return wrap;
}
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · One line in — the pipeline runs itself";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Pick a card, steer anywhere, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// BATCH — each YC question is a DECISION: 3 drafted answer options in genuinely different angles,
// one recommended (pre-selected), steer to redraft. ONE-GO: a single line drafts all 8 questions
// sequentially, cards filling as they land. Ground truth = the founder's line + the lent context;
// the honesty contract (from ideabrain's yc-* tasks, kept verbatim in spirit): nothing fabricated,
// missing facts marked as [yours to fill]. Editing the idea flags drafted answers stale.

const STEER_CHIPS = ["plainer words", "more concrete", "shorter", "different angle"];

// The 8 questions + per-question drafting guidance (compressed from brandbrain spec.ts yc-* fields
// — these prompt contracts were tuned; change with care).
const QUESTIONS = [
  { n: 1, q: "Describe what your company does in 50 characters or less.",
    guide: "Each option's text is the one-liner ITSELF — 50 characters or fewer, plain and concrete, no hype. Angles: outcome-first, analogy, mechanism." },
  { n: 2, q: "What is your company going to make? Describe your product and what it does or will do.",
    guide: "80–160 words of flowing first-person-plural prose — plain confident words, concrete specifics pulled ONLY from the ground truth, no hype adjectives, no lists. Angles: mechanism-first, user-story-first, analogy-first." },
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

// The two videos YC asks for — same decision shape as the questions (3 script options, one
// recommended, steer), then the shared wrapp-kit RECORDER mounts under the picked script so the
// founder records against it in place. Recordings stay local (download); only scripts persist.
const VIDEOS = [
  { key: "founder", title: "Founder video", sub: "1 minute · camera · unedited — who you are, what you're building", mode: "camera", maxSeconds: 60, fileName: "founder-video.webm",
    guide: "Talking points for a 60-second unedited founder video: 5–7 short beats, first person, plain SPOKEN words (things a human says to a camera, not prose). Ground every claim in the ground truth and the picked answers; never invent biography or numbers." },
  { key: "demo", title: "Product demo video", sub: "up to 3 minutes · screen — the real product doing the core loop", mode: "screen", maxSeconds: 180, fileName: "demo-video.webm",
    guide: "A shot list for a ≤3-minute screen demo: 5–8 beats, each = what is on screen + the one spoken line over it. Show the real product's core loop end to end; no slides, no invented features." },
];
const mkVideos = () => Object.fromEntries(VIDEOS.map((v) => [v.key, { options: null, selectedId: null, steers: [], stale: false, error: null }]));
const recHosts = {}; // key → { host, handle } — kept OUT of render() so re-renders never kill a live stream
function destroyRecorders() { for (const k of Object.keys(recHosts)) { try { recHosts[k].handle.destroy(); } catch { /* gone */ } delete recHosts[k]; } }

let running = false;
let editingBrief = false;

function autostart() {
  // A saved mid-draft status must not restore as a live spinner (the redline sanitize lesson).
  if (state.run) { state.run.status = ""; render(); return; }
  // THE COLD OPEN (the demo IS the product running): a lent idea/project context is enough to begin
  // with ZERO input — the moment you connect, Batch is already drafting all 8 answers from your idea.
  // No form, no prompt, no button. "Connect Switchboard, something is happening."
  if (brand) { const seed = brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

function groundTruth() {
  const r = state.run;
  return [
    `THE IDEA (ground truth — the ONLY source of facts): "${r.brief}"`,
    brand ? `LENT CONTEXT "${brand.name}" (also ground truth): ${JSON.stringify(brand.data).slice(0, 3000)}` : "",
    'Honesty contract: never invent facts, metrics, names, users, or biography beyond the ground truth. Where a needed fact is missing, write around it and mark the spot like "[your metric here]".',
  ].filter(Boolean);
}

async function start(brief) {
  if (!relay || running) return;
  brief = String(brief || "").trim();
  if (!brief) { toast("One line on what you're building first.", true); return; }
  state.run = { id: uid(), brief, status: "", answers: QUESTIONS.map((s) => ({ n: s.n, options: null, selectedId: null, steers: [], stale: false, error: null })), videos: mkVideos() };
  await saveState(); render();
  await draftAll();
}

// ONE-GO: draft every missing/stale answer sequentially, cards filling in as each lands.
async function draftAll() {
  const r = state.run; if (!r || !relay || running) return;
  running = true;
  if (!r.videos) r.videos = mkVideos(); // runs saved before the video stage existed
  for (const a of r.answers) {
    if (a.options && !a.stale) continue;
    r.status = `drafting ${a.n} of 8 — “${QUESTIONS[a.n - 1].q.slice(0, 46)}…”`;
    render();
    await draftOne(a.n);
  }
  for (const v of VIDEOS) {
    const vs = r.videos[v.key];
    if (vs.options && !vs.stale) continue;
    r.status = `drafting the ${v.title.toLowerCase()} script…`;
    render();
    await draftVideo(v.key);
  }
  running = false; r.status = "";
  await saveState(); render();
}

// the picked application answers become ground truth for the video scripts — compose, don't re-ask
function pickedDigest() {
  const r = state.run;
  return r.answers.filter((a) => a.options).map((a) => `Q${a.n}: ${selectedText(a)}`).join("\n").slice(0, 4000);
}

async function draftVideo(key, steer) {
  const r = state.run; if (!r || !relay) return;
  const spec = VIDEOS.find((v) => v.key === key);
  const vs = r.videos[key];
  if (steer) vs.steers.push(steer);
  vs.error = null;
  try {
    const digest = pickedDigest();
    const arr = await askJsonArray([
      "You are Batch, prepping the videos for a founder's Y Combinator application, on their own Claude.",
      ...groundTruth(),
      digest ? `THE PICKED APPLICATION ANSWERS (also ground truth):\n${digest}` : "",
      `Draft 3 script options for the ${spec.title.toUpperCase()} (${spec.sub}). Each option a genuinely different angle. ${spec.guide}`,
      vs.steers.length ? `Steering from the founder (apply the latest): ${vs.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the angle, 2-5 words>,"text":<the beats, one per line>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no scripts came back — try again");
    vs.options = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Angle").slice(0, 60), text: String(o.text || "").trim(), recommended: !!o.recommended }));
    if (!vs.options.some((o) => o.recommended)) vs.options[0].recommended = true;
    vs.selectedId = (vs.options.find((o) => o.recommended) || vs.options[0]).id;
    vs.stale = false;
  } catch (e) { vs.error = msg(e); }
  await saveState(); render();
}

async function steerVideo(key, steer) {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.status = "redrafting the script…"; render();
  await draftVideo(key, steer);
  running = false; r.status = ""; render();
}

async function draftOne(n, steer) {
  const r = state.run; if (!r || !relay) return;
  const spec = QUESTIONS[n - 1];
  const a = r.answers[n - 1];
  if (steer) a.steers.push(steer);
  a.error = null;
  try {
    const arr = await askJsonArray([
      "You are Batch, drafting a Y Combinator application with a founder, on their own Claude.",
      ...groundTruth(),
      `QUESTION ${n}: "${spec.q}"`,
      `Draft 3 complete answer options, each a genuinely different angle. ${spec.guide}`,
      a.steers.length ? `Steering from the founder (apply the latest): ${a.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the angle, 2-5 words>,"text":<the complete answer>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no drafts came back — try again");
    a.options = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Angle").slice(0, 60), text: String(o.text || "").trim(), recommended: !!o.recommended }));
    if (!a.options.some((o) => o.recommended)) a.options[0].recommended = true;
    a.selectedId = (a.options.find((o) => o.recommended) || a.options[0]).id;
    a.stale = false;
  } catch (e) { a.error = msg(e); }
  await saveState(); render();
}

async function steerOne(n, steer) {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.status = `redrafting ${n} of 8…`; render();
  await draftOne(n, steer);
  running = false; r.status = ""; render();
}

// Editing the idea flags every drafted answer stale — they were grounded in the old line.
function editIdea(next) {
  const r = state.run; if (!r) return;
  const brief = String(next || "").trim();
  if (!brief || brief === r.brief) return;
  r.brief = brief;
  for (const a of r.answers) if (a.options) a.stale = true;
  if (r.videos) for (const k of Object.keys(r.videos)) if (r.videos[k].options) r.videos[k].stale = true;
  void saveState(); render();
}

// ---- export (carved from ideabrain's ycMarkdown — same honesty framing) ----
function selectedText(a) { const o = (a.options || []).find((x) => x.id === a.selectedId); return o ? o.text : ""; }
function applicationMd() {
  const r = state.run;
  const done = r.answers.filter((a) => a.options).length;
  const L = [
    `# YC application draft — ${r.brief.slice(0, 90)}`,
    "",
    `> ${done}/8 answers drafted on your own Claude, grounded only in your idea${brand ? ` and the lent context “${brand.name}”` : ""} — nothing fabricated; [bracketed] spots are yours to fill. Edit into your own voice before submitting.`,
    "",
  ];
  for (const a of r.answers) {
    L.push(`## ${a.n}. ${QUESTIONS[a.n - 1].q}`, "");
    const t = selectedText(a);
    L.push(t || "_(not drafted yet)_", "");
    if (a.stale) L.push("> Note: the idea changed after this was drafted — redraft it in Batch.", "");
  }
  L.push("---", "Built with Batch, on your own Claude.");
  return L.join("\n");
}
function download() {
  const blob = new Blob([applicationMd()], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "yc-application.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function copyAll() {
  try { await navigator.clipboard.writeText(applicationMd()); toast("Application copied ✓"); }
  catch { toast("Couldn't copy — download instead.", true); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) { view.append(connectSteps()); return; }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "grounding in your lent context — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — what are you building?";
    // CONTEXT-FIRST: a lent idea/project context prefills the line — one click, zero typing.
    if (brand) input.value = brand.name + (brand.data && brand.data.positioning ? " — " + brand.data.positioning : "");
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", brand ? "Draft from " + brand.name + " ▸" : "Draft all 8 ▸");
    btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "the idea"), el("span", "run-input", r.brief), el("span", "grow"));
  const staleCount = r.answers.filter((x) => x.stale).length;
  const undrafted = r.answers.filter((x) => !x.options).length;
  if (!running && (staleCount || undrafted)) {
    const rd = el("button", "act", staleCount ? `↻ redraft ${staleCount} stale` : `▸ draft remaining ${undrafted}`);
    rd.onclick = () => void draftAll();
    bar.append(rd);
  }
  const ed = el("button", "act", "✎ idea"); ed.onclick = () => { editingBrief = !editingBrief; render(); };
  const cp = el("button", "act", "copy .md"); cp.onclick = () => void copyAll();
  const dl = el("button", "act", "⬇ download"); dl.onclick = download;
  const nu = el("button", "act", "× new"); nu.onclick = () => { destroyRecorders(); state.run = null; editingBrief = false; void saveState(); render(); };
  bar.append(ed, cp, dl, nu);
  view.append(bar);

  if (editingBrief) {
    const row = el("div", "bindrow"); row.style.marginTop = "10px";
    const input = el("input"); input.value = r.brief;
    const save = () => { editingBrief = false; editIdea(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    const b = el("button", "primary", "Save"); b.onclick = save;
    row.append(input, b);
    view.append(row);
    setTimeout(() => input.focus(), 30);
  }

  if (r.status) view.append(researching(r.status));

  for (const a of r.answers) view.append(questionCard(a));

  // the two YC videos — script decisions + the shared kit recorder mounted against the pick
  if (r.videos) {
    view.append(el("div", "kicker sect", "the videos"));
    for (const v of VIDEOS) view.append(videoCard(v));
  }
}

function videoCard(spec) {
  const r = state.run;
  const vs = r.videos[spec.key];
  const card = el("div", "q-card");
  card.append(el("span", "q-num", spec.title));
  if (vs.stale) card.append(el("span", "stale-chip", "idea changed — redraft"));
  card.append(el("div", "q-text", spec.sub));
  if (vs.options) {
    card.append(optionCards(vs.options, vs.selectedId, (o) => { vs.selectedId = o.id; void saveState(); render(); }));
    if (!running) card.append(steerRow((s) => void steerVideo(spec.key, s)));
    // The recorder is a shared wrapp-kit element with LIVE MediaStream state — it must NOT be torn
    // down and rebuilt on every render (that would kill a recording mid-take). Mount it once into a
    // detached host node cached in recHosts, and re-append that SAME node each render.
    card.append(el("div", "kicker sect", "record it"));
    let h = recHosts[spec.key];
    if (!h) {
      const host = el("div");
      const handle = mountRecorder(host, {
        mode: spec.mode, maxSeconds: spec.maxSeconds, fileName: spec.fileName,
        hint: spec.mode === "screen" ? "Pick the tab/window with your product, then walk the core loop against the script above." : "Look at the camera and hit the beats above — one take, no edit needed.",
      });
      h = recHosts[spec.key] = { host, handle };
    }
    card.append(h.host);
  } else if (vs.error) {
    card.append(el("div", "err", vs.error));
    const t = el("button", "act", "try again"); t.onclick = () => void steerVideo(spec.key, null);
    card.append(t);
  } else {
    card.append(researching(running ? "queued…" : "not drafted yet"));
  }
  return card;
}

function questionCard(a) {
  const spec = QUESTIONS[a.n - 1];
  const card = el("div", "q-card");
  card.append(el("span", "q-num", "question " + a.n));
  if (a.stale) card.append(el("span", "stale-chip", "idea changed — redraft"));
  card.append(el("div", "q-text", spec.q));
  if (a.options) {
    const wrap = optionCards(a.options, a.selectedId, (o) => { a.selectedId = o.id; void saveState(); render(); });
    if (a.n === 1) {
      // the 50-char limit is the whole game on Q1 — show the count on every option
      [...wrap.children].forEach((optEl, i) => {
        const o = a.options[i]; if (!o) return;
        optEl.querySelector(".o-label")?.append(el("span", "charcount" + (o.text.length > 50 ? " over" : ""), o.text.length + " chars"));
      });
    }
    card.append(wrap);
    if (!running) card.append(steerRow((s) => void steerOne(a.n, s)));
  } else if (a.error) {
    card.append(el("div", "err", a.error));
    const t = el("button", "act", "try again"); t.onclick = () => void steerOne(a.n, null);
    card.append(t);
  } else {
    card.append(researching(running ? "queued…" : "not drafted yet"));
  }
  return card;
}
render();
