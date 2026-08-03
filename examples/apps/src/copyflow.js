// COPYFLOW — show a workflow once, God learns it, it runs itself. The AUTHORING + MANAGEMENT wrapp:
// record a 2-step demo → God generalizes it into a parameterized routine → confirm → it lives in the
// ~/.relay control plane and runs on a daemon tick. This wrapp NEVER runs routines itself. It writes
// the objects the daemon (sb_routines / sb_recorder) watches. Every daemon call is FEATURE-DETECTED —
// when the engine isn't there yet, we fall back to the control-plane files (via local storage) and
// show an HONEST "waiting for the routines engine" state. We never fake success. (Mirrors the swap
// seam in src/dub.js's tryRealDiarizer().)
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
// God's hands: expose CopyFlow's authoring action as a page-tool so the native God webview (or any
// WebMCP host) can DRIVE it — reusing the same authoring path a click runs, plus a notch widget glance.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "copyflow",                               // = build.mjs entry name = ./dist/<id>.js in the html
  name: "CopyFlow",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "CopyFlow — records a workflow demo, generalizes it into a routine on your own Claude, and manages the routines the Switchboard daemon runs for you",
    models: ["sonnet"],
    tools: [],                                  // the GENERALIZE pass is text-only; routines it authors carry their own grant bundle
  },
  usesContext: null,                            // an authoring tool — no lent context needed
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
// COPYFLOW — three views over ONE routine object:
//   (a) RECORD    — author the 2-step demo (fetch JSON from a URL → append a row to a target). "Save
//                   demo" writes a recording trace (§1.2 shape) via the daemon's routine_save_recording
//                   verb if it exists, else to local storage — then auto-advances to GENERALIZE.
//   (b) REVIEW    — God's agentic GENERALIZE pass (§1.3) compiles the trace into a parameterized routine
//                   JSON (§3.1 shape): steps + inputs+defaults + grant bundle. Editable, then "Confirm
//                   & save routine" writes ~/.relay/routines/<id>.json (daemon routine_save, else local).
//   (c) ROUTINES  — reads ~/.relay/routines.json + routines/*.json (daemon routine_list, else local) and
//                   lists each: name · last-run · status dot · Pause · Run now.
//
// THE SEAM DISCIPLINE (mirrors dub.js): EVERY daemon method is feature-detected against
// capabilities().methods. When the routines engine isn't in this tree yet, we degrade to the
// control-plane FILES (persisted locally, honestly labeled "waiting for the routines engine") and NEVER
// pretend a routine ran. The daemon side is built to match the contract documented in the hand-back.

const STEER_CHIPS = ["stricter", "simpler", "add anchors", "JavaScript flavor"]; // kept for house-consistency; RECORD steers differently

// The daemon verbs this wrapp PREFERS, once sb_routines / sb_recorder ship. Every call is guarded by
// hasMethod() — the exact "prefer the real capability, fall back honestly" seam from dub.js.
const M = {
  recordStart:  "routine_record_start",   // { id, title } → open a live trace sink at ~/.relay/recordings/<id>.jsonl
  recordStop:   "routine_record_stop",    // { id } → close the sink, return { ok, id, events? }
  saveRecording:"routine_save_recording", // { id, title, events[] } → write the trace (§1.2) to ~/.relay/recordings/<id>.jsonl
  generalize:   "routine_generalize",     // OPTIONAL { id } → daemon-side compile; PRIMARY path is God-direct (relay.stream)
  save:         "routine_save",            // { routine } → write ~/.relay/routines/<id>.json (§3.1)
  list:         "routine_list",            // {} → { definitions:[…§3.1…], status:{ <id>:{ state,lastRun,nextRun,outcome,tokens } }, control:{…} }
  runNow:       "routine_run_now",         // { id } → run immediately
  control:      "routine_control",         // { patch:{ off?, routines:{ <id>:{ off?, runNow? } } } } → merge into ~/.relay/routines-control.json
};

// ---- the raw provider (window.claude). The SDK wraps stream()/storage() but NOT the routine_* verbs,
// so we reach them through the provider directly — the same object @relay/sdk wraps (dub.js idiom). ----
function rawProvider() { const c = (typeof window !== "undefined" ? window : globalThis).claude; return (c && c.isRelay && typeof c.request === "function") ? c : null; }
let _caps = null;
async function caps() { if (_caps) return _caps; try { _caps = await relay.capabilities(); } catch { _caps = {}; } return _caps || {}; }
async function hasMethod(name) { const c = await caps(); return Array.isArray(c?.methods) && c.methods.includes(name); }
async function enginePresent() { return (await hasMethod(M.list)) || (await hasMethod(M.runNow)); }
async function callDaemon(method, params) { const p = rawProvider(); if (!p) throw new Error("Switchboard isn't connected — connect it (top-right) first."); return p.request({ method, params: params || {} }); }

// ---- local control-plane fallback (values are opaque strings — store JSON). When the daemon can't
// write ~/.relay yet, these HOLD the same objects locally so the UI is honest and nothing is lost. The
// day the engine lands, these become a reconciliation source. ----
async function readLocal(key, dflt) { try { const raw = await relay.storage.get(APP.id + "-" + key); return raw ? JSON.parse(raw) : dflt; } catch { return dflt; } }
async function writeLocal(key, val) { try { await relay.storage.set(APP.id + "-" + key, JSON.stringify(val)); } catch { /* non-fatal */ } }

// ---- host origin of a URL (for the grant bundle) ----
function hostOf(url) { try { return new URL(String(url)).host; } catch { return ""; } }
function originOf(url) { try { const u = new URL(String(url)); return u.origin; } catch { return ""; } }

// ═══ RECORD → the §1.2 trace ═══════════════════════════════════════════════════════════════════
// The manual authoring path: the user describes the two steps; we synthesize the recording trace the
// daemon's sb_recorder would have captured, so GENERALIZE sees the SAME shape either way.
function buildTrace(draft) {
  const s1 = draft.fetch || {}, s2 = draft.append || {};
  const origin1 = originOf(s1.url), origin2 = "https://docs.google.com"; // demo append target = Sheets-shaped
  const events = [];
  events.push({ t: 0,    channel: "voice", kind: "say",      text: s1.intent || "fetch today's numbers from the URL" });
  if (s1.url) events.push({ t: 1200, channel: "web", kind: "navigate", origin: origin1, url: s1.url });
  events.push({ t: 2400, channel: "web", kind: "toolcall", origin: origin1, tool: "fetch_json", args: { method: (s1.method || "GET"), url: s1.url } });
  events.push({ t: 5100, channel: "voice", kind: "say",      text: s2.intent || "append it as a new row in the target" });
  events.push({ t: 6800, channel: "web", kind: "toolcall", origin: origin2, tool: "append_row",
                args: { target: s2.target, values: splitValues(s2.values) } });
  return events;
}
function splitValues(v) {
  const raw = String(v || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) { try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [raw]; } catch { /* csv */ } }
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

async function saveRecording(rec) {
  // rec = { id, title, events }
  let daemon = false;
  if (await hasMethod(M.saveRecording)) {
    try { await callDaemon(M.saveRecording, rec); daemon = true; } catch { /* fall through — still keep it locally */ }
  }
  await writeLocal("rec-" + rec.id, rec); // always keep a local copy so nothing is lost
  return { daemon };
}

// ═══ GENERALIZE → God's agentic pass over the trace (§1.3) ═════════════════════════════════════
// PRIMARY path: God directly, via relay.stream — reuses the gated inference the visitor already
// connected, no new daemon verb needed. A daemon routine_generalize verb, if it ever ships, is an
// optional upgrade (feature-detected first).
function generalizePrompt(rec) {
  return [
    `You are ${APP.name}'s GENERALIZE pass. You are given a RECORDING TRACE of a workflow a user demonstrated once (voice narration segments interleaved with the browser/API events between them). Compile it into ONE reusable, parameterized ROUTINE.`,
    `THREE JOBS:`,
    `1. SEGMENT & LABEL — fuse the voice "say" events (step boundaries + intent) with the web events between them into an ordered steps[].`,
    `2. LIFT LITERALS → {{inputs}} — instance-specific values become parameters (a date → {{run.date}}; an email → {{recipient}}; a sheet/target id → {{sheet}}). Structural values (a fixed range, a tool name) stay literal. THE DEMOED VALUES BECOME THE DEFAULTS in "inputs", so the routine is runnable as-recorded AND re-parameterizable.`,
    `3. ASSIGN EACH STEP A REPLAY CHANNEL — "http" (a raw API call via sb_http), "connector" (an installed wrapp/MCP action), or "browser" (must drive a page). PREFER promoting a recorded browser toolcall to http/connector when an API exists (a recorded append_row becomes a google_sheets.appendRow connector call; a recorded fetch_json becomes an sb_http GET).`,
    `THE TRACE (JSONL, one event per line):`,
    rec.events.map((e) => JSON.stringify(e)).join("\n"),
    `Reply with ONE JSON object ONLY — no prose, no fences — in EXACTLY this shape:`,
    `{
  "id": "${rec.id}",
  "title": "<short human title>",
  "sourceRecording": "${rec.id}",
  "inputs": { "<name>": "<default from the demo>" },
  "schedule": { "kind": "manual" },
  "tier": "daemon",
  "grants": { "http": { "hosts": ["<host>"] }, "connectors": ["<connector id>"], "browser": [] },
  "steps": [
    { "id": "fetch",  "channel": "http",      "call": { "method": "GET", "url": "https://…/{{...}}" } },
    { "id": "append", "channel": "connector", "call": { "tool": "google_sheets.appendRow", "args": { "spreadsheetId": "{{sheet}}", "values": "{{fetch.rows}}" } } }
  ]
}`,
    `Every {{input}} referenced in a step MUST appear in "inputs" with its demoed default. Flag any step that can only be done in a browser with "channel":"browser". Never invent steps that were not demonstrated.`,
  ].filter(Boolean).join("\n\n");
}

async function generalize(rec, onProgress) {
  // optional daemon-side compile first
  if (await hasMethod(M.generalize)) {
    try { const out = await callDaemon(M.generalize, { id: rec.id }); const r = out?.routine || out; if (r && Array.isArray(r.steps)) return normalizeRoutine(r, rec); } catch { /* fall back to God-direct */ }
  }
  const text = await streamText({ prompt: generalizePrompt(rec), maxTokens: 1800 }, onProgress);
  const routine = parseJson(text);
  if (!routine || !Array.isArray(routine.steps) || !routine.steps.length) throw new Error("Couldn't compile that into a routine — add a bit more detail to the two steps and try again.");
  return normalizeRoutine(routine, rec);
}
function normalizeRoutine(r, rec) {
  r.id = r.id || rec.id;
  r.title = r.title || rec.title || "Untitled routine";
  r.sourceRecording = rec.id;
  r.inputs = (r.inputs && typeof r.inputs === "object") ? r.inputs : {};
  r.schedule = r.schedule || { kind: "manual" };
  r.tier = r.tier || "daemon";
  r.grants = r.grants || { http: { hosts: [] }, connectors: [], browser: [] };
  r.grants.http = r.grants.http || { hosts: [] };
  r.grants.connectors = Array.isArray(r.grants.connectors) ? r.grants.connectors : [];
  r.grants.browser = Array.isArray(r.grants.browser) ? r.grants.browser : [];
  r.steps = r.steps.filter((s) => s && s.id);
  return r;
}

// ═══ SAVE the confirmed routine → ~/.relay/routines/<id>.json (§3.1) ═══════════════════════════
async function saveRoutine(routine) {
  let daemon = false;
  if (await hasMethod(M.save)) {
    try { await callDaemon(M.save, { routine }); daemon = true; } catch { /* keep local */ }
  }
  const idx = await readLocal("routines", []);
  const i = idx.findIndex((r) => r.id === routine.id);
  if (i >= 0) idx[i] = routine; else idx.push(routine);
  await writeLocal("routines", idx); // local index — the list reads this when the daemon can't
  return { daemon };
}

// ═══ ROUTINES list — read status, control ══════════════════════════════════════════════════════
// Returns [{ def, status }] where status.state ∈ active|idle|running|failed|waiting.
async function loadRoutines() {
  if (await hasMethod(M.list)) {
    try {
      const out = await callDaemon(M.list, {});
      const defs = Array.isArray(out?.definitions) ? out.definitions : (Array.isArray(out?.routines) ? out.routines : []);
      const status = (out && out.status && typeof out.status === "object") ? out.status : {};
      return defs.map((def) => ({ def, status: normStatus(status[def.id]) }));
    } catch { /* fall to local */ }
  }
  // no engine — show the locally-authored routines, honestly "waiting"
  const idx = await readLocal("routines", []);
  const pending = await readLocal("control", {});
  return idx.map((def) => ({ def, status: { state: "waiting", lastRun: null, nextRun: null, outcome: pending?.routines?.[def.id]?.runNow ? "run requested" : "", off: !!pending?.routines?.[def.id]?.off } }));
}
function normStatus(s) {
  const x = (s && typeof s === "object") ? s : {};
  const state = ["active", "idle", "running", "failed", "waiting"].includes(x.state) ? x.state : "idle";
  return { state, lastRun: x.lastRun || null, nextRun: x.nextRun || null, outcome: x.outcome || "", off: !!x.off, step: x.step || null, tokens: x.tokens || 0 };
}

async function runNow(id) {
  if (await hasMethod(M.runNow)) { await callDaemon(M.runNow, { id }); return { ran: true }; }
  if (await hasMethod(M.control)) { await callDaemon(M.control, { patch: { routines: { [id]: { runNow: true } } } }); return { queued: true }; }
  // no engine — record the intent honestly; DO NOT pretend it ran
  const ctl = await readLocal("control", {}); ctl.routines = ctl.routines || {}; ctl.routines[id] = { ...(ctl.routines[id] || {}), runNow: true };
  await writeLocal("control", ctl);
  return { waiting: true };
}
async function togglePause(id, off) {
  if (await hasMethod(M.control)) { await callDaemon(M.control, { patch: { routines: { [id]: { off } } } }); return { daemon: true }; }
  const ctl = await readLocal("control", {}); ctl.routines = ctl.routines || {}; ctl.routines[id] = { ...(ctl.routines[id] || {}), off };
  await writeLocal("control", ctl);
  return { waiting: true };
}

// ═══ orchestration — record → generalize → review ══════════════════════════════════════════════
let busy = false;

function autostart() {
  if (!state.view) state.view = "record";
  if (!state.draft) state.draft = blankDraft();
}
function blankDraft() {
  return {
    title: "",
    fetch:  { intent: "", url: "", method: "GET" },
    append: { intent: "", target: "", values: "" },
  };
}

async function saveDemoAndGeneralize() {
  if (!relay || busy) return;
  const d = state.draft || blankDraft();
  if (!String(d.fetch?.url || "").trim()) { toast("Add the URL for step 1 (fetch JSON) first.", true); return; }
  if (!String(d.append?.target || "").trim()) { toast("Add the target for step 2 (append a row) first.", true); return; }
  busy = true;
  const rec = { id: "rt_" + uid(), title: (d.title || "").trim() || "Fetch → append", events: buildTrace(d) };
  state.busyMsg = "saving the demo recording…"; render();
  try {
    const savedRec = await saveRecording(rec);
    state.busyMsg = "God is generalizing the demo into a routine…"; render();
    const routine = await generalize(rec, (p) => { if (p.text) { const live = $("gen-live"); if (live) live.textContent = p.text.slice(-1200); } });
    state.routine = routine;
    state.lastRecSavedToDaemon = savedRec.daemon;
    state.view = "review";
    await saveState();
  } catch (e) {
    toast(msg(e), true);
  } finally {
    busy = false; state.busyMsg = ""; render();
  }
}

async function confirmRoutine() {
  if (!relay || busy || !state.routine) return;
  busy = true; state.busyMsg = "saving the routine…"; render();
  try {
    const res = await saveRoutine(state.routine);
    state.draft = blankDraft();
    state.routine = null;
    state.view = "routines";
    await saveState();
    toast(res.daemon ? "Routine saved ✓ — the daemon has it." : "Routine saved locally — waiting for the routines engine.");
  } catch (e) { toast(msg(e), true); }
  finally { busy = false; state.busyMsg = ""; render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!relay; // once connected we're an app surface, not a pitch
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "the loop (connect to author your own)"));
    s.append(el("div", "sample-text", "1 · Record a 2-step demo — fetch JSON from a URL, append a row to a target.\n2 · God generalizes it into a parameterized routine you review and confirm.\n3 · The Switchboard daemon runs it — pause or run-now any time."));
    view.append(s);
    return;
  }

  autostart();
  view.append(navBar());

  if (state.busyMsg) {
    view.append(researching(state.busyMsg));
    if (state.view === "record") { const live = el("div", "gen-live"); live.id = "gen-live"; view.append(live); }
  }

  if (state.view === "record") return void view.append(recordView());
  if (state.view === "review") return void view.append(reviewView());
  if (state.view === "routines") return void view.append(routinesView());
}

function navBar() {
  const nav = el("div", "nav");
  const tabs = [["record", "Record"], ["review", "Review"], ["routines", "Routines"]];
  for (const [id, label] of tabs) {
    const b = el("button", "tab" + (state.view === id ? " on" : ""), label);
    if (id === "review" && !state.routine) b.classList.add("dim");
    b.onclick = () => { if (id === "review" && !state.routine) { toast("Record a demo first — Review shows the generalized routine.", true); return; } state.view = id; void saveState(); render(); };
    nav.append(b);
  }
  const grow = el("span", "grow"); nav.append(grow);
  // honest engine badge
  const badge = el("span", "engine off", "checking engine…");
  nav.append(badge);
  void enginePresent().then((on) => { badge.className = "engine " + (on ? "on" : "off"); badge.textContent = on ? "routines engine · live" : "waiting for the routines engine"; });
  return nav;
}

// ── (a) RECORD ──────────────────────────────────────────────────────────────────────────────
function recordView() {
  const d = state.draft;
  const col = el("div", "run");
  col.append(el("div", "kicker sect", "record a workflow — the smallest proving demo"));

  // title
  const titleRow = el("div", "field");
  titleRow.append(el("label", "flabel", "routine name"));
  const ti = el("input"); ti.placeholder = "e.g. daily numbers → sheet"; ti.value = d.title || "";
  ti.oninput = () => { d.title = ti.value; };
  titleRow.append(ti); col.append(titleRow);

  // STEP 1 — fetch JSON
  const s1 = el("div", "stepcard");
  s1.append(stepHead("1", "fetch JSON from a URL", "http"));
  s1.append(field("what this step does (say it plainly)", d.fetch, "intent", "fetch today's numbers from the dashboard"));
  s1.append(field("URL", d.fetch, "url", "https://api.example.com/daily?d=2026-08-03"));
  const methodRow = el("div", "field");
  methodRow.append(el("label", "flabel", "method"));
  const sel = el("select");
  for (const m of ["GET", "POST"]) { const o = el("option", null, m); o.value = m; if ((d.fetch.method || "GET") === m) o.selected = true; sel.append(o); }
  sel.onchange = () => { d.fetch.method = sel.value; };
  methodRow.append(sel); s1.append(methodRow);
  col.append(s1);

  // STEP 2 — append a row
  const s2 = el("div", "stepcard");
  s2.append(stepHead("2", "append a row to a target", "connector"));
  s2.append(field("what this step does", d.append, "intent", "append it as a new row in the daily-numbers sheet"));
  s2.append(field("target (sheet id / connector target)", d.append, "target", "1AbC…  (a Google Sheet id)"));
  s2.append(field("row values (comma-separated, or a JSON array)", d.append, "values", "{{run.date}}, 142, 17, $4,210"));
  col.append(s2);

  const actions = el("div", "actions");
  const go = el("button", "primary", busy ? "recording…" : "Save demo → generalize ⤳");
  go.disabled = busy; go.onclick = () => void saveDemoAndGeneralize();
  actions.append(go);
  const clear = el("button", "act", "reset"); clear.onclick = () => { state.draft = blankDraft(); void saveState(); render(); };
  actions.append(clear);
  col.append(actions);
  col.append(el("div", "hint", "This wrapp does NOT run the routine — it writes the recording the Switchboard daemon watches, then God compiles it. Values you show become the routine's editable defaults."));
  return col;
}
function stepHead(n, title, channel) {
  const h = el("div", "stephead");
  h.append(el("span", "sn", n));
  h.append(el("span", "st", title));
  h.append(el("span", "chan chan-" + channel, channel));
  return h;
}
function field(label, obj, key, placeholder) {
  const f = el("div", "field");
  f.append(el("label", "flabel", label));
  const input = el("input"); input.placeholder = placeholder || ""; input.value = obj[key] || "";
  input.oninput = () => { obj[key] = input.value; };
  f.append(input);
  return f;
}

// ── (b) REVIEW ──────────────────────────────────────────────────────────────────────────────
function reviewView() {
  const r = state.routine;
  const col = el("div", "run");
  if (!r) { col.append(el("div", "err", "Nothing to review yet — record a demo first.")); return col; }

  col.append(el("div", "kicker sect", "review the generalized routine"));
  col.append(el("div", "rtitle", r.title || "Untitled routine"));
  const prov = el("div", "prov");
  prov.textContent = state.lastRecSavedToDaemon
    ? "Recording saved to the daemon · compiled by your Claude"
    : "Recording saved locally (no recorder daemon yet) · compiled by your Claude";
  col.append(prov);

  // INPUTS (editable defaults)
  col.append(el("div", "kicker sect", "inputs — defaults from your demo, editable"));
  const inputs = el("div", "inputs");
  const keys = Object.keys(r.inputs || {});
  if (!keys.length) inputs.append(el("div", "muted", "no lifted inputs — the routine runs exactly as demoed."));
  for (const k of keys) {
    const f = el("div", "field");
    f.append(el("label", "flabel", "{{" + k + "}}"));
    const input = el("input"); input.value = r.inputs[k] == null ? "" : String(r.inputs[k]);
    input.oninput = () => { r.inputs[k] = input.value; };
    f.append(input); inputs.append(f);
  }
  col.append(inputs);

  // STEPS
  col.append(el("div", "kicker sect", "compiled steps"));
  const steps = el("div", "steps-list");
  (r.steps || []).forEach((s, i) => {
    const row = el("div", "steprow" + (s.channel === "browser" ? " fragile" : ""));
    const top = el("div", "steprow-top");
    top.append(el("span", "sn", String(i + 1)));
    top.append(el("span", "st", s.id || ("step " + (i + 1))));
    top.append(el("span", "chan chan-" + (s.channel || "http"), s.channel || "http"));
    if (s.channel === "browser") top.append(el("span", "warnpill", "fragile · may need re-recording"));
    row.append(top);
    const call = el("pre", "callpre"); call.textContent = JSON.stringify(s.call || {}, null, 2);
    row.append(call);
    steps.append(row);
  });
  col.append(steps);

  // GRANT BUNDLE
  col.append(el("div", "kicker sect", "grant bundle — confirming is the standing grant"));
  const grants = el("div", "grants");
  const hosts = (r.grants?.http?.hosts || []); const conns = (r.grants?.connectors || []); const brs = (r.grants?.browser || []);
  grants.append(grantLine("http hosts", hosts.length ? hosts.join(", ") : "none"));
  grants.append(grantLine("connectors", conns.length ? conns.join(", ") : "none"));
  grants.append(grantLine("browser origins", brs.length ? brs.join(", ") : "none — fully API/connector, no unattended browser"));
  col.append(grants);
  const hasSend = (r.steps || []).some((s) => s.sendClass);
  if (hasSend) col.append(el("div", "sendnote", "This routine has a send-class step. v1 stages it and asks before sending — no unattended send."));

  const actions = el("div", "actions");
  const confirm = el("button", "primary", busy ? "saving…" : "Confirm & save routine ✓");
  confirm.disabled = busy; confirm.onclick = () => void confirmRoutine();
  actions.append(confirm);
  const back = el("button", "act", "← back to demo"); back.onclick = () => { state.view = "record"; void saveState(); render(); };
  actions.append(back);
  const regen = el("button", "act", "re-generalize"); regen.onclick = () => void saveDemoAndGeneralize();
  actions.append(regen);
  col.append(actions);
  return col;
}
function grantLine(label, val) {
  const l = el("div", "grantline");
  l.append(el("span", "glabel", label));
  l.append(el("span", "gval", val));
  return l;
}

// ── (c) ROUTINES ────────────────────────────────────────────────────────────────────────────
function routinesView() {
  const col = el("div", "run");
  col.append(el("div", "kicker sect", "routines — what runs on your behalf"));
  const list = el("div", "routines");
  list.append(researching("reading the routines control plane…"));
  col.append(list);

  const newBtn = el("button", "act", "＋ Record a new workflow");
  newBtn.onclick = () => { state.view = "record"; state.draft = blankDraft(); void saveState(); render(); };
  col.append(el("div", "actions").appendChild ? (() => { const a = el("div", "actions"); a.append(newBtn); return a; })() : newBtn);

  void loadRoutines().then((rows) => {
    list.textContent = "";
    if (!rows.length) { list.append(el("div", "muted", "No routines yet — record a workflow to author your first.")); return; }
    for (const { def, status } of rows) list.append(routineRow(def, status));
  }).catch((e) => { list.textContent = ""; list.append(el("div", "err", msg(e))); });
  return col;
}
function routineRow(def, status) {
  const row = el("div", "rt");
  const dot = el("span", "dot dot-" + status.state);
  const main = el("div", "rt-main");
  const top = el("div", "rt-top");
  top.append(dot);
  top.append(el("span", "rt-name", def.title || def.id));
  top.append(el("span", "grow"));
  const meta = statusMeta(status);
  top.append(el("span", "rt-meta", meta));
  main.append(top);
  main.append(el("div", "rt-sub", stepSummary(def) + (status.off ? " · paused" : "")));
  row.append(main);

  const acts = el("div", "rt-acts");
  const pause = el("button", "act", status.off ? "▶ resume" : "⏸ pause");
  pause.onclick = async () => { const res = await togglePause(def.id, !status.off); toast(res.daemon ? (status.off ? "Resumed" : "Paused") : "Saved — waiting for the routines engine."); render(); };
  const run = el("button", "act run", "▷ run now");
  run.onclick = async () => {
    const res = await runNow(def.id);
    if (res.ran) toast("Running now — watch the status.");
    else if (res.queued) toast("Queued a run for the daemon.");
    else toast("Run requested — waiting for the routines engine to pick it up.", false);
    render();
  };
  acts.append(pause, run);
  row.append(acts);
  return row;
}
function statusMeta(s) {
  if (s.state === "waiting") return "waiting for engine";
  if (s.state === "running") return "running… " + (s.step ? "(" + s.step + ")" : "");
  if (s.state === "failed") return "⚠ failed" + (s.outcome ? " · " + s.outcome : "");
  if (s.lastRun) return "last " + s.lastRun + (s.outcome ? " · " + s.outcome : "");
  if (s.nextRun) return "next " + s.nextRun;
  return s.outcome || "idle";
}
function stepSummary(def) {
  const chans = (def.steps || []).map((s) => s.id || s.channel).filter(Boolean);
  return chans.length ? chans.join(" → ") : "no steps";
}

render();

// ---- God's hand: author a routine from a 2-step demo, end to end ---------------------------------
// `copyflow_record` runs the SAME record→generalize path a form submit runs, then leaves the routine
// on the Review view for the user to confirm — returning the compiled routine JSON for God to speak.
exposeToGod({
  name: "copyflow_record",
  description: "Author a routine from a 2-step demo: step 1 fetches JSON from a URL, step 2 appends a row of values to a target. CopyFlow saves the recording trace, generalizes it into a parameterized routine with the user's Claude, and shows it on the Review view for the user to confirm. Returns the compiled routine JSON (NOT yet confirmed — confirming is the user's standing grant).",
  inputSchema: {
    fetchUrl: "string — the URL step 1 fetches JSON from. Required.",
    appendTarget: "string — where step 2 appends the row (a sheet id / connector target). Required.",
    appendValues: "string — the new row's values, comma-separated or a JSON array. Optional.",
    title: "string — a name for the routine. Optional.",
    fetchIntent: "string — plain-language description of step 1. Optional.",
    appendIntent: "string — plain-language description of step 2. Optional.",
  },
  execute: async ({ fetchUrl, appendTarget, appendValues, title, fetchIntent, appendIntent } = {}) => {
    const url = String(fetchUrl || "").trim();
    const target = String(appendTarget || "").trim();
    if (!url) throw new Error("pass { fetchUrl } — the URL step 1 fetches JSON from");
    if (!target) throw new Error("pass { appendTarget } — where step 2 appends the row");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("CopyFlow isn't connected to Switchboard yet");
    await waitFor(() => !busy, 180000);
    state.draft = {
      title: String(title || "").trim(),
      fetch: { intent: String(fetchIntent || "").trim(), url, method: "GET" },
      append: { intent: String(appendIntent || "").trim(), target, values: String(appendValues || "").trim() },
    };
    await saveDemoAndGeneralize();
    await waitFor(() => !busy, 180000);
    if (!state.routine) throw new Error("Couldn't generalize that demo — try adding clearer step descriptions.");
    return { routine: state.routine, note: "shown on the Review view — the user confirms to save it as a standing routine" };
  },
});

// ---- Notch widget: a glance of active routines ------------------------------------------------
// A purpose-built glance, not a shrunk page. Reads the routines control plane (daemon routine_list if
// present, else the local index) and renders the count + a card each. Honest "waiting" state when the
// engine isn't there. Works pre-connect with a minimal prompt state.
exposeWidget(async () => {
  const openLabel = "Open CopyFlow";
  if (!relay) {
    return { kicker: "COPYFLOW · ROUTINES", title: "Connect to see routines", openLabel, shape: "text",
      result: { body: "Connect Switchboard, then record a workflow — this glance shows the routines running on your behalf.", caption: "authoring lives in the CopyFlow tab" } };
  }
  let rows = [];
  try { rows = await loadRoutines(); } catch { rows = []; }
  const engine = await enginePresent().catch(() => false);
  if (!rows.length) {
    return { kicker: "COPYFLOW · ROUTINES", title: "No routines yet", openLabel, shape: "text",
      result: { body: "Record a 2-step workflow — God generalizes it into a routine that runs itself.", caption: engine ? "routines engine · live" : "waiting for the routines engine" } };
  }
  const items = rows.slice(0, 6).map(({ def, status }) => ({
    label: def.title || def.id,
    text: statusMeta(status) + " · " + stepSummary(def) + (status.off ? " · paused" : ""),
    recommended: status.state === "running" || status.state === "active",
  }));
  const active = rows.filter((r) => r.status.state === "active" || r.status.state === "running").length;
  return {
    kicker: "COPYFLOW · ROUTINES",
    title: `${rows.length} routine${rows.length === 1 ? "" : "s"}${active ? ` · ${active} active` : ""}`,
    openLabel, shape: "cards",
    result: { caption: engine ? "live from the routines engine" : "local · waiting for the routines engine", items },
  };
});

// test/inspection hook
try { (typeof window !== "undefined" ? window : globalThis).__copyflowTest = { buildTrace, splitValues, generalizePrompt, normalizeRoutine, normStatus, hostOf, originOf, blankDraft, get state() { return state; } }; } catch { /* ignore */ }
