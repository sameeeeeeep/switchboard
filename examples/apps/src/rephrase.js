// REPHRASE — paste text, get it rewritten in the tone/length you ask for (meaning kept), on the
// visitor's OWN Claude. The operator holds no key, pays for no inference, and never sees the user's
// data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from roast.js) — keep it byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { optionCards } from "./kit/ui.js";
// God's hands: expose Rephrase's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const APP = {
  id: "rephrase",                               // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Rephrase",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Rephrase — rewrites text you paste in the tone/length you ask for, on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only; no tools, no image gen
  },
  usesContext: "single",                        // a lent context = rewrite the brand's own positioning
  placeholder: "paste the text you want rewritten…",
  extraField: { placeholder: "tone / length (optional) — e.g. 'friendly and short', 'formal'" },
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
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render(); autostart();
}

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

// ==== house UI atoms ========================================================================
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
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Copy the result, steer it, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// REPHRASE — paste text (+ an optional tone/length) → stream the rewrite, meaning kept, as markdown.
// Steering re-runs the rewrite. THE COLD OPEN: a lent brand context autostarts a rewrite of the
// brand's own positioning with zero input. Text-only — no tools, no image gen.

const STEER_CHIPS = ["shorter", "more formal", "more casual", "punchier"];
const SAMPLE = "hey so basically we do a thing where u can like manage all ur tasks n stuff in one place and its rly good honestly, teams love it, u should try it";
let running = false;

function autostart() {
  if (state.run) return;
  if (brand) {
    const bits = [brand.name, brand.data?.positioning, brand.data?.tagline, brand.data?.oneLiner].filter(Boolean);
    const seed = bits.length ? bits.join(" — ") : brand.name;
    if (seed) void start(seed, "", true);
  }
}

async function start(input, extra, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Paste some text first.", true); return; }
  state.run = { id: uid(), input, extra: String(extra || "").trim(), fromContext: !!fromContext, output: "", status: "", error: null, steer: "" };
  await saveState(); render();
  await run();
}

async function run(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steer = steer;
  running = true; r.error = null; r.output = ""; r.status = "rewriting…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}. Rewrite the text below, preserving its exact meaning.`,
        r.extra ? `Requested tone / length: "${r.extra}".` : "Requested tone: clear and natural, roughly the same length.",
        `TEXT:\n"""${r.input.slice(0, 8000)}"""`,
        r.fromContext ? `(This is the user's OWN brand — rewrite its positioning, keep every claim intact.)` : "",
        r.steer ? `Adjust per this instruction: "${r.steer}".` : "",
        "Output ONLY the rewritten text — no preamble, no explanation, no options. Markdown allowed.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1400,
    }, (p) => { if (p.text) { r.output = p.text; const live = $("out-live"); if (live) live.innerHTML = mdLite(r.output); } });
    r.output = text.trim();
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

async function copyOutput() {
  const r = state.run; if (!r || !r.output) return;
  try { await navigator.clipboard.writeText(r.output); toast("Copied ✓"); }
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
    s.append(el("div", "kicker", "sample (connect to rephrase your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "loaded your lent context — " + brand.name + " · about to rewrite its positioning"));
    const input = el("textarea"); input.rows = 4; input.placeholder = APP.placeholder;
    let extraInput = null;
    const go = () => { if (input.value.trim()) void start(input.value, extraInput ? extraInput.value : ""); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    startBox.append(input);
    if (APP.extraField) { extraInput = el("input", "extra"); extraInput.placeholder = APP.extraField.placeholder; startBox.append(extraInput); }
    const btn = el("button", "primary", "Rephrase it"); btn.onclick = go;
    startBox.append(btn);
    startBox.append(el("div", "hint", "⌘/Ctrl + Enter to run · same meaning, your tone"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "rephrasing"), el("span", "run-input", r.input), el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copyOutput(); cp.disabled = !r.output;
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
  if (r.output) {
    col.append(el("div", "kicker sect", "the rewrite"));
    const m = el("div", "md out-md"); m.id = "out-live"; m.innerHTML = mdLite(r.output);
    col.append(m);
    if (!running) col.append(steerRow((s) => void run(s)));
  }
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
exposeToGod({
  name: "rephrase_run",
  description: "Rewrite a bit of text in a requested tone/length, keeping its meaning. Writes it live on the page and returns it.",
  inputSchema: { text: "string — the text to rewrite. Required.", tone: "string — desired tone or length (optional)." },
  execute: async ({ text, tone } = {}) => {
    const input = String(text || "").trim();
    if (!input) throw new Error("nothing to rewrite — pass { text } with the text to rephrase");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Rephrase isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(input, tone);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === input && (r.output || r.error)) {
        if (r.error) throw new Error(r.error);
        return { rewrite: r.output };
      }
    }
    throw new Error("Rephrase stayed busy — try again");
  },
});
