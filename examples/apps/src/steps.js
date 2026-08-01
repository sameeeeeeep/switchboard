// STEPS — name a goal, get a few distinct plans, each a clean numbered checklist of concrete steps,
// one recommended, on the visitor's OWN Claude. The operator holds no key, pays for no inference, and
// never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from reply.js) — keep it byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED (the plan Steps liked) stays
// visually distinct from CHOSEN (a card a human clicked) so the accent never paints a machine
// decision (doctrine 5), and the slate gets an escape hatch (doctrine 4).
import { optionCards } from "./kit/ui.js";
// God's hands: expose Steps's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "steps",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Steps",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Steps — turns a goal into concrete step-by-step plans on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only; no tools, no image gen
  },
  usesContext: null,                            // single-input utility — no lent context, no cold open
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
// onReady fires TWICE by design — mountConnect's onConnect AND the returning-user probe,
// whichever wins the race. Hydrating from storage on BOTH passes is a real (timing-dependent) bug:
// the second pass re-reads the run the first pass just saved, REPLACING the in-memory object the
// running pipeline still holds a reference to. The pipeline then finishes into a detached orphan and
// the UI sits forever on a run that never completes. Hydrate once.
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render(); autostart();
}

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
// Option cards: 2–4 options, exactly ONE recommended — now imported from ./kit/ui.js (same class
// names, plus the drafted-vs-chosen distinction and the escape hatch).
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
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Pick a plan, steer anywhere, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// STEPS — name a goal → stage 1 drafts 2–4 DISTINCT plans as option cards (a different angle each —
// fastest / most thorough / lowest-effort — one recommended, auto-selected). Each card holds a clean
// numbered checklist of concrete steps. Clicking a card locks it (accent = a human chose) and copy
// grabs its checklist. Steering re-drafts all plans. Text-only — no tools, no image gen.

const STEER_CHIPS = ["fewer steps", "more detail", "faster path", "beginner-friendly"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = "Launch a simple weekly newsletter for my side project.";
let running = false;

function autostart() {
  // No cold open — this is a single-input utility with no lent context. Guarded on brand so if a
  // context is ever lent it stays inert.
  if (state.run) return;
  if (brand) { /* utility wrapp — nothing to autostart */ }
}

async function start(input, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Name the goal you want steps for first.", true); return; }
  // THREE ids, not one (doctrine 5). selectedId = the plan currently shown as the working draft;
  // draftedId = Steps's own pick, tagged neutrally; chosenId = a card a HUMAN clicked, the only card
  // that ever wears the accent.
  state.run = { id: uid(), input, fromContext: !!fromContext, options: null, draftedId: null, selectedId: null, chosenId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await propose();
}

async function propose(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "mapping out the steps…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, turning a goal into concrete, actionable plans. The goal:`,
      `"""${r.input.slice(0, 4000)}"""`,
      r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Draft 2–4 DISTINCT plans to reach this goal, each taking a different angle (e.g. fastest, most thorough, lowest-effort). Each plan is a clean numbered checklist of concrete, specific steps — real actions someone can do, no vague filler and no fluff.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<a short name for the plan, e.g. "Fastest path">,"text":<the numbered checklist, one step per line like "1. …\\n2. …">,"recommended":<true for exactly one — the best default plan for most people>}',
    ]);
    if (!arr || !arr.length) throw new Error("no plans came back — try again");
    r.options = arr.slice(0, 4).map((o) => ({ id: uid(), label: String(o.label || "Plan").slice(0, 40), text: String(o.text || "").slice(0, 3000), recommended: !!o.recommended }));
    if (!r.options.some((o) => o.recommended)) r.options[0].recommended = true;
    r.draftedId = (r.options.find((o) => o.recommended) || r.options[0]).id;
    r.selectedId = r.draftedId;
    r.chosenId = null;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// `byHuman` is the ONLY route to the accent state — wired to a card click and nothing else.
function choose(id, byHuman) {
  const r = state.run; if (!r) return;
  r.selectedId = id;
  if (byHuman) r.chosenId = id;
  void saveState(); render();
}

async function copyPick() {
  const r = state.run; if (!r || !r.options) return;
  const pick = r.options.find((o) => o.id === (r.chosenId || r.selectedId)); if (!pick) return;
  try { await navigator.clipboard.writeText(pick.text); toast("Plan copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample goal (connect to plan your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    const row = el("div", "bindrow");
    const input = el("textarea");
    input.rows = 3;
    input.placeholder = "name the goal you want a step-by-step plan for…";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    const btn = el("button", "primary", "Break it down 🪜"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    startBox.append(el("div", "hint", "⌘/Ctrl + Enter · a few plans — each a numbered checklist"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "planning for"), el("span", "run-input", r.input), el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copyPick(); cp.disabled = !r.options;
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(cp, redo);
  col.append(bar);

  if (r.options) {
    col.append(el("div", "kicker sect", r.chosenId ? "your plan" : "a few plans — drafted, yours to pick"));
    col.append(optionCards({
      options: r.options,
      chosenId: r.chosenId,     // accent — a human clicked, nothing else
      draftedId: r.draftedId,   // neutral tag — Steps's pick, shown but not decided
      onChoose: (o) => choose(o.id, true),
      disabled: running,
      // Rule 4 — a few plans is a menu; this is the exit. Describe the plan you'd take instead.
      escape: {
        label: "none of these — describe the plan you'd take",
        placeholder: "the angle you'd take (e.g. 'weekend project, no budget')…",
        sendLabel: "replan",
        onSubmit: (text) => { if (running) return; return propose(text); },
      },
    }));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void propose();
    col.append(t);
  }
  if (r.options && !running) col.append(steerRow((s) => void propose(s)));
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `steps_run` runs the SAME start() a name-and-go click runs — a few plans are drafted, live in the
// DOM — then returns them (with the recommended one) for God to speak or file.
exposeToGod({
  name: "steps_run",
  description: "Turn a goal into a few distinct step-by-step plans, each a numbered checklist. Writes them live on the page and returns them.",
  inputSchema: { goal: "string — the goal to turn into steps. Required." },
  execute: async ({ goal } = {}) => {
    const input = String(goal || "").trim();
    if (!input) throw new Error("no goal — pass { goal } with the goal to break down");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Steps isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(input);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === input && (r.options || r.error)) {
        if (r.error) throw new Error(r.error);
        const rec = (r.options || []).find((o) => o.id === r.draftedId);
        return { plans: (r.options || []).map((o) => ({ plan: o.label, steps: o.text })), recommended: rec ? rec.text : null };
      }
    }
    throw new Error("Steps stayed busy — try again");
  },
});
