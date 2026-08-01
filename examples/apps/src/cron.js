// CRON — describe a schedule and get the cron expression (with a human-readable confirmation), or
// paste a cron expression and get it explained field by field, all on the visitor's OWN Claude. The
// operator holds no key, pays for no inference, and never sees the user's data — Switchboard brokers
// everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from recap.js) — keep it byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED stays visually distinct from CHOSEN
// so the accent never paints a machine decision (doctrine 5), and any slate gets an escape hatch.
import { optionCards } from "./kit/ui.js";
// God's hands: expose Cron's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "cron",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Cron",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Cron — converts a schedule to a cron expression, or explains a cron expression, on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only; no tools, no image gen
  },
  usesContext: null,                            // a dev utility — no lent context needed
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
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Pick a card, steer anywhere, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// CRON — describe a schedule OR paste a cron expression → one stage either converts the schedule to a
// cron expression (with a plain-English confirmation) or explains the expression field by field,
// streamed as markdown. Steering rewrites (6-field, quartz, UTC…). Text-only.

const STEER_CHIPS = ["6-field (with seconds)", "Quartz format", "confirm in UTC", "every field explained"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = "Every weekday at 9:30am — or paste an expression like 0 */4 * * * to have it explained.";
let running = false;

function autostart() {
  // No cold open — Cron needs a schedule or an expression. Left in place for house-consistency.
  if (state.run) return;
}

async function start(input, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Describe a schedule or paste a cron expression first.", true); return; }
  state.run = { id: uid(), input, fromContext: !!fromContext, steers: [], out: "", status: "", error: null };
  await saveState(); render();
  await run();
}

async function run(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.out = ""; r.status = "working out the schedule…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}. Convert the schedule below to a cron expression, or — if the input already IS a cron expression — explain it.`,
        `THE INPUT:\n"""${r.input.slice(0, 12000)}"""`,
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        "If the input is a human schedule, reply in markdown with EXACTLY these bold headings, in order: **Cron** (the expression in a fenced code block) and **In plain English** (one line confirming exactly what it means, plus any timezone caveat). If the input is already a cron expression, reply under a single **In plain English** heading that states what it means and then breaks down each field. Use standard 5-field cron unless the user asks for seconds/6-field or Quartz. Never guess ambiguous intent silently — state the assumption you made.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1600,
    }, (p) => { if (p.text) { r.out = p.text; const live = $("out-live"); if (live) live.innerHTML = mdLite(r.out); } });
    r.out = text.trim();
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

async function copyOut() {
  const r = state.run; if (!r || !r.out) return;
  try { await navigator.clipboard.writeText(r.out); toast("Cron copied ✓"); }
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
    s.append(el("div", "kicker", "sample schedule (connect to convert your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    const row = el("div", "bindrow");
    const input = el("textarea");
    input.rows = 3;
    input.placeholder = "describe a schedule, or paste a cron expression…";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    const btn = el("button", "primary", "Convert it ⏱"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    startBox.append(el("div", "hint", "⌘/Ctrl + Enter · schedule → cron · or cron → plain English"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "converting"), el("span", "run-input", r.input), el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copyOut(); cp.disabled = !r.out;
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(cp, redo);
  col.append(bar);

  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void run();
    col.append(t);
  }
  if (r.out) {
    col.append(el("div", "kicker sect", "the cron"));
    const m = el("div", "md out-md"); m.id = "out-live"; m.innerHTML = mdLite(r.out);
    col.append(m);
    if (!running) col.append(steerRow((s) => void run(s)));
  }
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `cron_run` runs the SAME start() a type-and-go click runs — the result streams live in the DOM —
// then returns the cron expression (or the explanation) for God to speak or file.
exposeToGod({
  name: "cron_run",
  description: "Convert a plain-English schedule to a cron expression (with a human-readable confirmation), or explain a cron expression field by field. Writes it live on the page and returns it.",
  inputSchema: { schedule: "string — a schedule to convert, or a cron expression to explain. Required." },
  execute: async ({ schedule } = {}) => {
    const input = String(schedule || "").trim();
    if (!input) throw new Error("nothing to convert — pass { schedule } with a schedule or a cron expression");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Cron isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(input);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === input && (r.out || r.error)) {
        if (r.error) throw new Error(r.error);
        return { text: r.out };
      }
    }
    throw new Error("Cron stayed busy — try again");
  },
});
