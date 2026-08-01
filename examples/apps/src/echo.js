// {{NAME}} — {{what it does}}, on the visitor's OWN Claude. The operator holds no key, pays for no
// inference, and never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + a sample app. Everything between here and the "APP LOGIC" line
// is proven idiom (distilled from redline.js) — keep it byte-identical unless the app truly needs
// otherwise. Edit the CONFIG block and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { collection, mountLive } from "./kit/livestore.js";
// God's hands: expose Echo's one action as a page-tool so the native God webview (or any WebMCP host)
// can DRIVE it — reusing the same speak() a click runs, so the user hears it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "echo",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Echo",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Echo reads your text aloud with a LOCAL voice model on your machine — nothing leaves it",
    models: [],                                 // TTS needs no model — claude_speak only needs a grant
    tools: [],
  },
  usesContext: "none",                          // standalone utility — no lent context
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
let live = null;          // kit/mountLive handle — re-reads on teammate/Obsidian/git changes

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
function wire(r) {
  if (wired) return; wired = true;
  r.on("permissionsChanged", () => void syncContext());
  // TEAM-READY (doctrine gate 7): re-read persisted state whenever reality moves — a teammate's
  // Team Mode sync, your own edit in another window, an Obsidian save, a git pull. Throttled +
  // guarded by the kit; solo users never notice (no teammates ⇒ no nudges). `reloadState` re-reads
  // storage and re-renders; keep it idempotent.
  live = mountLive(r, reloadState);
}
async function onReady() { await syncContext(); await loadState(); render(); autostart(); }
/** Re-read everything this wrapp persists, then render. Called on every live nudge. For a wrapp
 *  that ACCUMULATES items (a library, notes, a task list), read the collection here (see `items`
 *  below) — never a single growing blob, or two teammates' edits clobber each other. */
async function reloadState() { if (!relay) return; await loadState(); render(); }

// CONTEXT-FIRST: the moment a context is lent, everything derives from it — options from
// data.products, tone from data.voice, colors from data.palette (FLAT hex strings — see
// docs/CONTEXT-KINDS.md). Hardcoded samples are allowed ONLY pre-connect, visibly labeled.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON) =============================
// TWO shapes, and picking the right one is doctrine gate 7 (team-ready):
//   • THE RUN — one ephemeral, single-user editing session (this template's generate pipeline).
//     A single `<id>-state` blob is correct: there's one run, one editor. Kept below.
//   • ACCUMULATED ITEMS — a library / notes / tasks / a gallery that grows over time. Use a
//     `collection` (one item = one file), NEVER an array in one blob: under Team Mode, per-file
//     LWW then merges two teammates editing different items instead of clobbering. Example:
//         const items = collection(relay, APP.id + "-item");   // files: <id>-item-<uid>.json
//         await items.put(uid(), { title, body, at: Date.now() });
//         const all = await items.all();   // [{ id, ... }] — read this in reloadState()
// KEYS ARE FILENAMES: a key maps to `<key>.json` on disk, so it must match
// /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/. Namespace with "-" (APP.id + "-state"), NEVER ":" — a colon
// is rejected outright (and is Alternate Data Stream syntax on Windows), and because the catch below
// swallows it, the write would silently do nothing forever. Slug anything interpolated: spaces are
// illegal too — see examples/apps/src/kit/storekey.js `keySegment`.
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

// ==== APP LOGIC — Echo: text → speech, on a LOCAL model, through the broker ═══════════════════
// A utility, not an options pipeline. `relay.speak` routes to the daemon's LOCAL TTS: macOS `say`
// out of the box, or the user's RELAY_LOCAL_TTS_URL server (which can host voice-CLONED voices).
// Nothing leaves the machine. This wrapp is the demo that local models route through Switchboard.

let voices = [];        // local voice ids from capabilities().local.voices
let ttsBackend = "";    // filled after synth: "macos-say" / "local-server"
let speaking = false;
let lastAudio = null;   // the current clip (data: URL) — kept in memory, never persisted (can be large)
let lastError = null;

// No cold open — TTS is user-driven. On connect we just load the machine's local voices.
function autostart() { void loadVoices(); }

async function loadVoices() {
  try {
    const caps = await relay.capabilities();
    voices = caps?.local?.voices ?? [];
    if (!state.voice && voices.length) state.voice = voices[0];
  } catch { voices = []; }
  render();
}

async function speak() {
  if (!relay || speaking) return;
  const text = String(state.text || "").trim();
  if (!text) { toast("Type something to speak.", true); return; }
  speaking = true; lastError = null; render();
  try {
    const out = await relay.speak(text, { voice: state.voice || undefined });
    if (!out || !out.audio) throw new Error("No audio came back — is a local TTS available on this machine?");
    lastAudio = out.audio; ttsBackend = out.backend || "local";
    await saveState(); // persist text + chosen voice for a returning visit (not the audio)
  } catch (e) { lastError = msg(e); }
  finally { speaking = false; render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!relay;
  view.textContent = "";
  if (!relay) { view.append(connectSteps()); return; }

  const col = el("div", "echo");

  const ta = el("textarea", "say");
  ta.placeholder = "Type anything — hear it in a voice model running on your machine…";
  ta.value = state.text || "";
  ta.addEventListener("input", () => { state.text = ta.value; });
  ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void speak(); });
  col.append(ta);

  const row = el("div", "ctrls");
  if (voices.length) {
    const sel = el("select", "voice");
    for (const v of voices) { const o = el("option", null, v); o.value = v; if (v === state.voice) o.selected = true; sel.append(o); }
    sel.onchange = () => { state.voice = sel.value; void saveState(); };
    row.append(sel);
  } else {
    row.append(el("span", "novoice", "your machine's default voice"));
  }
  const go = el("button", "primary", speaking ? "Synthesizing…" : "Speak ⌘↵");
  go.disabled = speaking; go.onclick = () => void speak();
  row.append(go);
  col.append(row);

  if (lastError) col.append(el("div", "err", lastError));

  // the artifact — an audio player + download, labelled with WHERE it ran (the whole point).
  if (lastAudio) {
    const clip = el("div", "clip");
    const audio = el("audio"); audio.controls = true; audio.autoplay = true; audio.src = lastAudio;
    clip.append(audio);
    const meta = el("div", "clipmeta");
    meta.append(el("span", "kicker", ttsBackend ? "on-device · " + ttsBackend : "on-device"));
    const dl = el("a", "act", "↓ Download"); dl.href = lastAudio; dl.download = "echo.wav";
    meta.append(dl);
    clip.append(meta);
    col.append(clip);
  }

  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real synth -------------------------------------------
// `echo_speak` runs the SAME speak() the "Speak" button runs — the text is synthesized on the
// machine's LOCAL voice model and plays on the page — then reports where it ran. Nothing leaves the box.
// Reused as-is by the native God webview (window.__god.call) and any WebMCP host.
exposeToGod({
  name: "echo_speak",
  description: "Speak text aloud with a local, on-device voice model. Plays the audio on the page and returns which local backend spoke it.",
  inputSchema: { text: "string — the text to read aloud. Required." },
  execute: async ({ text } = {}) => {
    const val = String(text || "").trim();
    if (!val) throw new Error("nothing to speak — pass { text } with what to say");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Echo isn't connected to Switchboard yet");
    await waitFor(() => !speaking, 180000);   // let any in-flight synth finish before we take the mic
    state.text = val;
    await speak();                             // reuses the wrapp's own local-TTS pipeline, awaited
    if (lastError) throw new Error(lastError);
    if (!lastAudio) throw new Error("Echo produced no audio — is a local TTS available on this machine?");
    return { spoken: true, backend: ttsBackend || "local", voice: state.voice || null };
  },
});
