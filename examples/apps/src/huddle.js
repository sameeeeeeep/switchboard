// HUDDLE — any meeting into clean, skimmable notes on the visitor's OWN Claude. Paste a transcript,
// or drop an audio file (transcribed LOCALLY on the daemon's whisper/STT — audio never leaves the
// machine), then one stage structures it into a TL;DR, decisions, action items with owners, and
// collapsible per-topic notes. The operator holds no key, pays for no inference, and never sees the
// user's data — Switchboard brokers everything. Granola, but private + one-click.
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
// God's hands: expose Huddle's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Carried context — when the Switchboard OS launches Huddle AT an item, open focused on it (prefill
// the transcript box) instead of cold. Safe no-op when absent (readOsContext returns null).
import { readOsContext } from "./os/os-context.js";
const osCtx = readOsContext();
let osTitle = null;
if (osCtx) {
  if (typeof osCtx.artifact === "string") osTitle = osCtx.artifact.slice(0, 160);
  else if (osCtx.artifact && typeof osCtx.artifact.title === "string") osTitle = osCtx.artifact.title.slice(0, 160);
  if (!osTitle && typeof osCtx.term === "string") osTitle = osCtx.term.slice(0, 160);
}

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "huddle",                                 // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Huddle",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Huddle — turns a meeting transcript (or a locally-transcribed audio file) into clean notes, decisions and action items on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // transcription is a LOCAL daemon verb (claude_transcribe), not a gated connector tool
  },
  usesContext: "single",                        // a lent project scopes the notes to your own material
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
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Paste a transcript or drop an audio file — the notes write themselves";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Skim decisions + action items, steer anywhere, copy or export";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// HUDDLE — a meeting into clean notes. Two input doors: (a) paste a transcript, or (b) drop/select an
// audio file → transcribed LOCALLY via the daemon's `claude_transcribe` (whisper/STT on the machine,
// audio never uploaded). Either way ONE stage streams STRUCTURED notes JSON — {title, tl_dr,
// decisions[], action_items[{who,what}], topics[{heading, notes[]}]} — rendered as a skimmable page:
// a TL;DR, a decisions list, an action-items checklist with owners, and collapsible per-topic notes.
// Copy / export markdown. Steer chips re-draft. A lent project scopes the notes to your own material.

const STEER_CHIPS = ["shorter", "more detail", "just decisions", "group by owner", "sharper owners"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = `Priya: Ok, standup. The onboarding redesign — where are we?
Marco: Flow's built, but the email verification step is flaky. I think we cut it for launch and add it back in v2.
Priya: Agreed, cut it. Marco, can you file the v2 ticket so we don't forget?
Marco: Yep, I'll do that today.
Dana: Pricing page copy is still blocking the marketing site. I can draft it by Thursday.
Priya: Good. Let's also decide — are we launching Tuesday or waiting for the mobile fix?
Marco: Mobile fix lands Monday night, so Tuesday's fine.
Priya: Tuesday it is. Dana, loop in support once copy's locked.`;
let running = false;

// ---- the raw provider (window.claude). The SDK wraps speak() but NOT transcribe(), so we reach the
// local `claude_transcribe` verb through the provider directly — the same object @relay/sdk wraps.
// (Verified path: examples/apps/src/dub.js transcribeAudio → p.request({ method:"claude_transcribe" }).) ----
function rawProvider() { const c = (typeof window !== "undefined" ? window : globalThis).claude; return (c && c.isRelay && typeof c.request === "function") ? c : null; }
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("couldn't read that file"));
    fr.readAsDataURL(file);
  });
}
// ---- LOCAL transcription (daemon's claude_transcribe: whisper/STT on-device; audio never leaves) ----
async function transcribeAudio(dataUrl) {
  const p = rawProvider();
  if (!p) throw new Error("Switchboard isn't connected — connect it (top-right) first.");
  const out = await p.request({ method: "claude_transcribe", params: { audio: dataUrl } });
  const text = String(out?.text || "").trim();
  if (!text) throw new Error("No speech was recognized. Local transcription needs a whisper/STT backend on the daemon (RELAY_LOCAL_STT_URL, RELAY_WHISPER_BIN, or RELAY_STT_CMD).");
  return { text, backend: out?.backend || "" };
}

function autostart() {
  // No cold open — Huddle needs a transcript or an audio file. Left in place for house-consistency.
  if (state.run) return;
}

// Entry from the paste box.
async function startFromText(transcript, fromContext) {
  if (!relay || running) return;
  transcript = String(transcript || "").trim();
  if (!transcript) { toast("Paste a transcript or notes first.", true); return; }
  state.run = { id: uid(), source: "paste", fileName: "", transcript, notes: null, steers: [], expanded: {}, status: "", error: null };
  await saveState(); render();
  await run();
}

// Entry from an audio file — transcribe LOCALLY first, then structure.
async function startFromAudio(file) {
  if (!relay || running) return;
  if (!file) return;
  const fileName = file.name || "recording";
  state.run = { id: uid(), source: "audio", fileName, transcript: "", notes: null, steers: [], expanded: {}, status: "transcribing on your device…", error: null };
  running = true; await saveState(); render();
  try {
    const dataUrl = await fileToDataUrl(file);
    const tr = await transcribeAudio(dataUrl);
    state.run.transcript = tr.text;
    state.run.backend = tr.backend;
  } catch (e) {
    state.run.error = msg(e); state.run.status = "";
    running = false; await saveState(); render(); return;
  }
  running = false; state.run.status = "";
  await run();
}

// THE stage — structure the transcript into clean notes JSON. Streams; renders on completion (with a
// live raw peek while it writes). Steering re-runs with the accumulated steers applied.
async function run(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  if (!r.transcript) { toast("Nothing to structure yet.", true); return; }
  running = true; r.error = null; r.status = "reading the meeting…"; render();
  try {
    const raw = await streamText({
      prompt: [
        `You are ${APP.name}. Turn the meeting transcript below into clean, skimmable notes.`,
        brand ? `PROJECT CONTEXT (scope names, products and decisions to this — never invent beyond the transcript): ${JSON.stringify(brand.data || {}).slice(0, 2200)}` : "",
        `THE TRANSCRIPT:\n"""${r.transcript.slice(0, 16000)}"""`,
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        'Reply with ONE JSON object ONLY — no prose, no fences:',
        '{ "title": "<short meeting title>", "tl_dr": "<2–3 sentence summary of what happened and what was decided>", "decisions": ["<a decision that was actually made>"], "action_items": [ { "who": "<owner name, or \\"Unassigned\\">", "what": "<the concrete task>" } ], "topics": [ { "heading": "<topic discussed>", "notes": ["<a bullet of substance under this topic>"] } ] }',
        "Rules: only what is in the transcript — never invent decisions, owners, or tasks. If nobody was named as owner, use \"Unassigned\". Keep bullets tight. Order topics as they came up. Omit an empty array only by leaving it [].",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2200,
    }, (p) => { if (p.text) { r.status = "writing the notes…"; const live = $("raw-live"); if (live) live.textContent = p.text.slice(-600); } });
    const notes = parseJson(raw);
    if (!notes || typeof notes !== "object") throw new Error("Couldn't structure that — try again, or paste a cleaner transcript.");
    r.notes = normalizeNotes(notes);
    r.expanded = {};
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Defensive shaping so a slightly-off JSON never breaks the render.
function normalizeNotes(n) {
  const arr = (x) => Array.isArray(x) ? x : [];
  return {
    title: String(n.title || "Meeting notes").slice(0, 140),
    tl_dr: String(n.tl_dr || n.tldr || n.summary || "").trim(),
    decisions: arr(n.decisions).map((d) => (typeof d === "string" ? d : String(d?.text || d?.decision || ""))).filter(Boolean).slice(0, 30),
    action_items: arr(n.action_items || n.actions).map((a) => {
      if (typeof a === "string") return { who: "Unassigned", what: a };
      return { who: String(a?.who || a?.owner || "Unassigned").slice(0, 60) || "Unassigned", what: String(a?.what || a?.task || a?.text || "").trim() };
    }).filter((a) => a.what).slice(0, 40),
    topics: arr(n.topics).map((t) => ({
      heading: String(t?.heading || t?.title || "Topic").slice(0, 120),
      notes: arr(t?.notes || t?.bullets || t?.points).map((b) => (typeof b === "string" ? b : String(b?.text || ""))).filter(Boolean).slice(0, 20),
    })).filter((t) => t.notes.length).slice(0, 20),
  };
}

// ---- markdown export -----------------------------------------------------------------------
function notesToMarkdown(n) {
  if (!n) return "";
  const L = [];
  L.push(`# ${n.title}`, "");
  if (n.tl_dr) L.push(`**TL;DR** — ${n.tl_dr}`, "");
  if (n.decisions.length) { L.push("## Decisions"); for (const d of n.decisions) L.push(`- ${d}`); L.push(""); }
  if (n.action_items.length) { L.push("## Action items"); for (const a of n.action_items) L.push(`- [ ] **${a.who}** — ${a.what}`); L.push(""); }
  if (n.topics.length) { L.push("## Notes"); for (const t of n.topics) { L.push(`### ${t.heading}`); for (const b of t.notes) L.push(`- ${b}`); L.push(""); } }
  return L.join("\n").trim() + "\n";
}
async function copyOut() {
  const r = state.run; if (!r || !r.notes) return;
  try { await navigator.clipboard.writeText(notesToMarkdown(r.notes)); toast("Notes copied as markdown ✓"); }
  catch { toast("Couldn't copy.", true); }
}
function exportMd() {
  const r = state.run; if (!r || !r.notes) return;
  const md = notesToMarkdown(r.notes);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = (r.notes.title || "meeting-notes").replace(/[^\w-]+/g, "-").toLowerCase().slice(0, 60) + ".md";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
    s.append(el("div", "kicker", "sample transcript (connect to structure your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) { view.append(inputCard()); return; }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "meeting notes"));
  bar.append(el("span", "run-input", r.source === "audio" ? "🎙 " + (r.fileName || "audio") : "pasted transcript"));
  bar.append(el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copyOut(); cp.disabled = !r.notes;
  const ex = el("button", "act", "export .md"); ex.onclick = () => exportMd(); ex.disabled = !r.notes;
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(cp, ex, redo);
  col.append(bar);

  if (r.status) col.append(researching(r.status));
  if (r.status && running) { const raw = el("pre", "raw-peek"); raw.id = "raw-live"; col.append(raw); }
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => { r.error = null; void run(); };
    col.append(t);
  }
  if (r.notes) { renderNotes(col, r.notes); if (!running) col.append(steerRow((s) => void run(s), STEER_CHIPS)); }
  view.append(col);
}

// The input surface: two doors — paste a transcript, or drop/select an audio file.
function inputCard() {
  const box = el("div", "start");

  if (brand) box.append(el("div", "ctx", "scoped to your project — " + brand.name));
  // Legibility: when the OS opened us AT an item, say so in Huddle's own token.
  if (osTitle) box.append(el("div", "ctx", "Opened from Switchboard OS · " + osTitle));

  const ta = el("textarea"); ta.rows = 7;
  ta.placeholder = "paste your meeting transcript or rough notes here…";
  // Carried context: seed the transcript box from the item the OS opened us at — only when empty,
  // never clobbering anything the user typed.
  if (osTitle && !ta.value.trim()) ta.value = osTitle;
  box.append(ta);

  const row = el("div", "startrow");
  const go = () => { if (ta.value.trim()) void startFromText(ta.value); };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
  const btn = el("button", "primary", "Make notes ▸"); btn.onclick = go;
  row.append(el("span", "hint", "⌘/Ctrl + Enter · TL;DR · decisions · action items · per-topic notes"), el("span", "grow"), btn);
  box.append(row);

  box.append(el("div", "or", "or drop a recording"));

  const drop = el("label", "drop");
  drop.append(el("div", "drop-icon", "▤"));
  drop.append(el("div", "drop-title", "Drop an audio file"));
  drop.append(el("div", "drop-sub", "wav · mp3 · m4a — transcribed locally on your machine. Never uploaded."));
  const file = el("input"); file.type = "file"; file.accept = "audio/*"; file.hidden = true;
  file.onchange = () => { const f = file.files && file.files[0]; if (f) void startFromAudio(f); };
  drop.append(file);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) void startFromAudio(f); });
  box.append(drop);

  box.append(el("div", "note", "Live meeting capture isn't here yet — recording a call needs system-audio the browser can't reach. Paste a transcript or upload a file for now."));

  setTimeout(() => ta.focus(), 30);
  return box;
}

// The notes surface: TL;DR, decisions, action-items checklist with owners, collapsible topics.
function renderNotes(col, n) {
  col.append(el("h2", "notes-title", n.title));

  if (n.tl_dr) {
    const tl = el("div", "tldr");
    tl.append(el("span", "tldr-tag", "TL;DR"));
    tl.append(el("span", "tldr-text", n.tl_dr));
    col.append(tl);
  }

  if (n.decisions.length) {
    col.append(el("div", "kicker sect", "decisions"));
    const ul = el("ul", "decisions");
    for (const d of n.decisions) { const li = el("li"); li.append(el("span", "dec-mark", "✓")); li.append(el("span", "dec-text", d)); ul.append(li); }
    col.append(ul);
  }

  if (n.action_items.length) {
    col.append(el("div", "kicker sect", "action items"));
    const list = el("div", "actions");
    n.action_items.forEach((a, i) => {
      const row = el("label", "action");
      const cb = el("input"); cb.type = "checkbox"; cb.className = "act-cb";
      cb.checked = !!(state.run && state.run.done && state.run.done[i]);
      cb.onchange = () => { const r = state.run; if (!r) return; r.done = r.done || {}; r.done[i] = cb.checked; row.classList.toggle("done", cb.checked); void saveState(); };
      row.classList.toggle("done", cb.checked);
      const who = el("span", "act-who", a.who || "Unassigned");
      const what = el("span", "act-what", a.what);
      row.append(cb, who, what);
      list.append(row);
    });
    col.append(list);
  }

  if (n.topics.length) {
    col.append(el("div", "kicker sect", "notes by topic"));
    const wrap = el("div", "topics");
    n.topics.forEach((t, i) => {
      const open = !!(state.run && state.run.expanded && state.run.expanded[i]);
      const card = el("div", "topic" + (open ? " open" : ""));
      const head = el("button", "topic-head");
      head.append(el("span", "topic-caret", open ? "▾" : "▸"));
      head.append(el("span", "topic-h", t.heading));
      head.append(el("span", "topic-n", String(t.notes.length)));
      head.onclick = () => { const r = state.run; if (!r) return; r.expanded = r.expanded || {}; r.expanded[i] = !r.expanded[i]; void saveState(); render(); };
      card.append(head);
      if (open) { const ul = el("ul", "topic-notes"); for (const b of t.notes) ul.append(el("li", null, b)); card.append(ul); }
      wrap.append(card);
    });
    col.append(wrap);
  }
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `huddle_notes` runs the SAME pipeline a paste-and-go (or drop-and-go) click runs — the notes render
// live on the page — then returns the structured notes + a markdown export for God to speak or file.
exposeToGod({
  name: "huddle_notes",
  description: "Turn a meeting into clean notes: TL;DR, decisions, action items with owners, and per-topic notes. Pass a transcript, or an audio file as a data:audio/… URL (transcribed locally). Writes the notes live on the page and returns them.",
  inputSchema: {
    transcript: "string — the meeting transcript or rough notes. Provide this OR audio.",
    audio: "string — an audio recording as a data:audio/… URL, transcribed locally on the device. Provide this OR transcript.",
  },
  execute: async ({ transcript, audio } = {}) => {
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Huddle isn't connected to Switchboard yet");
    const text = String(transcript || "").trim();
    const audioUrl = String(audio || "").trim();
    if (!text && !/^data:audio\//.test(audioUrl)) throw new Error("pass { transcript } text OR { audio } as a data:audio/… URL");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 190000);
      if (text) await startFromText(text);
      else {
        // Build a File-like from the data URL so the same startFromAudio pipeline runs (and is seen).
        const p = rawProvider();
        if (!p) throw new Error("Switchboard isn't connected");
        state.run = { id: uid(), source: "audio", fileName: "god-audio", transcript: "", notes: null, steers: [], expanded: {}, status: "transcribing on your device…", error: null };
        running = true; await saveState(); render();
        try { const tr = await transcribeAudio(audioUrl); state.run.transcript = tr.text; state.run.backend = tr.backend; }
        catch (e) { state.run.error = msg(e); state.run.status = ""; running = false; await saveState(); render(); throw e; }
        running = false; state.run.status = ""; await run();
      }
      await waitFor(() => !running, 190000);
      const r = state.run || {};
      if (r.notes || r.error) {
        if (r.error) throw new Error(r.error);
        return { notes: r.notes, markdown: notesToMarkdown(r.notes), transcript: r.transcript };
      }
    }
    throw new Error("Huddle stayed busy — try again");
  },
});

// ---- The notch glance: a compact "cards" view of decisions + action items -----------------------
// The producer reuses the same structuring pipeline. With no input (or no connection) it returns an
// honest prompt state rather than a fake glance. Input may be a pasted transcript ({ text }) or an
// audio data: URL ({ audio | dataUrl }) the notch launcher hands over.
function widgetTextFrom(input) {
  if (!input) return { transcript: "", audio: "" };
  if (typeof input === "string") return /^data:audio\//.test(input) ? { transcript: "", audio: input } : { transcript: input, audio: "" };
  if (typeof input === "object") {
    const audio = /^data:audio\//.test(String(input.audio || "")) ? input.audio : (/^data:audio\//.test(String(input.dataUrl || "")) ? input.dataUrl : "");
    const transcript = String(input.text || input.transcript || "").trim();
    return { transcript: audio ? "" : transcript, audio };
  }
  return { transcript: "", audio: "" };
}
exposeWidget(async (input) => {
  const prompt = {
    kicker: "HUDDLE · MEETING NOTES", title: "Paste a meeting", openLabel: "Open Huddle", shape: "text",
    result: { body: "Hand me a transcript or a recording — I pull out the TL;DR, decisions and action items.", caption: "on your Claude · audio transcribed on-device" },
  };
  const { transcript, audio } = widgetTextFrom(input);
  if ((!transcript && !audio) || !relay) return prompt;
  try {
    let text = transcript;
    if (!text && audio) { const tr = await transcribeAudio(audio); text = tr.text; }
    const notes = normalizeNotes(parseJson(await streamText({
      prompt: [
        `You are ${APP.name}. Turn this meeting into structured notes.`,
        `TRANSCRIPT:\n"""${String(text).slice(0, 12000)}"""`,
        'Reply with ONE JSON object ONLY: { "title": "…", "tl_dr": "…", "decisions": ["…"], "action_items": [{"who":"…","what":"…"}], "topics": [{"heading":"…","notes":["…"]}] }. Only what is in the transcript. Unassigned owners → "Unassigned".',
      ].join("\n\n"),
      maxTokens: 1600,
    })) || {});
    const items = [];
    for (const d of notes.decisions.slice(0, 3)) items.push({ label: "Decision", text: d });
    for (const a of notes.action_items.slice(0, 4)) items.push({ label: a.who || "Unassigned", text: a.what, recommended: false });
    if (!items.length) return { ...prompt, title: notes.title || "Notes ready", result: { body: notes.tl_dr || "Notes are ready — open Huddle for the full breakdown.", caption: "on your Claude" } };
    if (items[0]) items[0].recommended = true;
    return {
      kicker: "HUDDLE · " + (notes.decisions.length ? "DECISIONS + ACTIONS" : "ACTION ITEMS"),
      title: notes.title || "Meeting notes",
      openLabel: "Open Huddle — full notes", shape: "cards",
      result: { caption: `${notes.decisions.length} decision${notes.decisions.length === 1 ? "" : "s"} · ${notes.action_items.length} action item${notes.action_items.length === 1 ? "" : "s"}`, items },
      copyText: notesToMarkdown(notes),
    };
  } catch (e) {
    return { ...prompt, title: "Couldn't read that", result: { body: msg(e), caption: "on your Claude · audio transcribed on-device" } };
  }
});

// ---- In-tab verification hook (used by the headless proof; harmless in production) -----------------
// `mockNotes(json)` stubs a connected relay + a completed run so the REAL render()/renderNotes() paths
// can be exercised without a live model — proving the notes/decisions/action-items surface cleanly.
try {
  (typeof window !== "undefined" ? window : globalThis).__huddleTest = {
    normalizeNotes, notesToMarkdown, widgetTextFrom,
    mockNotes(json) {
      relay = { storage: { get: async () => null, set: async () => {} }, context: { active: async () => null } };
      state.run = { id: uid(), source: "paste", fileName: "", transcript: "mock", notes: normalizeNotes(json || {}), steers: [], expanded: {}, status: "", error: null };
      render();
      return state.run.notes;
    },
  };
} catch { /* ignore */ }
