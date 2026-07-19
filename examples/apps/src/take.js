// TAKE — record a screen or camera take against an AI-drafted script, on the visitor's OWN Claude.
// COMPOSE wrapp: the deterministic capture is the shared wrapp-kit RECORDER element (kit/recorder.js
// — the same one Batch's video stage uses); the only app-specific part is the script stage. One
// line on what you're recording → your Claude drafts 3 beat-scripts (one recommended) → record
// against the pick → download. Nothing uploads; the recording stays in the browser.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { mountRecorder } from "./kit/recorder.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "take",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Take",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Take — drafts a recording script on your own Claude; the capture stays local in your browser",
    models: ["sonnet"],
    tools: [],
  },
  usesContext: "single",                        // a lent context grounds the script (optional)
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
let state = { premises: null, premiseError: null, run: null };
// onReady() fires from BOTH the chip's onConnect and the returning-user probe. A second boot must
// never read state back over a run that is mid-stream — that would orphan the results.
async function loadState() {
  if (running || premLoading) return;
  try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = Object.assign({ premises: null, premiseError: null, run: null }, JSON.parse(raw)); }
  catch { state = { premises: null, premiseError: null, run: null }; }
}
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
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Four takes worth recording appear — nothing to type";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · The ★ one scripts itself; pick another or steer it";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// TAKE — PROACTIVE, context-first. The moment Switchboard is connected (fresh chip click OR a
// page-load with a standing grant) Take reads the lent context and drafts 4 concrete PREMISES —
// specific things THIS project is worth recording right now — one ★ recommended, then expands the
// ★ into a full beat script with ZERO typing. The text box below is a steer ("or describe your
// own take"), never a gate. Stage 2 is the shared kit RECORDER against the picked script; the take
// never leaves the browser — Claude only ever sees the premise line, never the recording.

const STEER_CHIPS = ["plainer words", "punchier", "shorter", "different angle"];
const MODES = [
  { key: "screen", label: "Screen + mic", sub: "walk through a product, tool, or flow", maxSeconds: 180, fileName: "take-screen.webm" },
  { key: "camera", label: "Camera + mic", sub: "talk to camera — intro, pitch, update", maxSeconds: 120, fileName: "take-camera.webm" },
];
let running = false;      // the script stage is busy
let premLoading = false;  // the premise stage is busy
let premisesTried = false; // one proactive premise pass per page life — the chip's onConnect and the
                           // returning-user probe both funnel through onReady(); this dedupes them.
let recHost = null; // stable recorder host, kept OUT of render() so a re-render never kills a live take

// The whole doctrine in one function: connected → options on screen, nothing typed.
function autostart() {
  if (state.run) state.run.status = "";
  render();
  if (state.premises && state.premises.length) { premisesTried = true; return; }
  if (premisesTried) return;
  premisesTried = true;
  void loadPremises();
}

const ctxBlob = (n) => (brand ? JSON.stringify(brand.data || {}).slice(0, n || 2200) : "");

// STAGE 0 — the premises. Derived entirely from the lent project: its products, voice, audience.
// Degrades honestly with no context (generic-but-real takes, visibly labeled) and never locks the UI.
async function loadPremises(steer) {
  if (!relay || premLoading) return;
  premLoading = true; state.premiseError = null; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}. A founder is about to hit record — screen or camera — and needs to know WHAT is worth recording right now.`,
      brand
        ? `THE PROJECT "${brand.name}" — everything must come from here (its products, voice, audience, positioning): ${ctxBlob()}`
        : "No project was lent, so propose four takes any small product team could genuinely record this week, and keep them concrete.",
      "Propose 4 takes. Each is a specific, shootable idea — a named product walked through end to end, a real objection answered out loud, a proof shown live on screen — not a category and not a topic. Never invent facts beyond what you're given.",
      steer ? `Steer (apply it): "${steer}"` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the take, 3-7 words>,"text":<one line: what happens on screen and who it is for>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no takes came back — hit ⟳ other takes");
    const opts = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || o.title || "A take").slice(0, 70),
      text: String(o.text || o.body || o.description || "").trim().slice(0, 320),
      recommended: !!o.recommended,
    }));
    if (!opts.some((o) => o.recommended)) opts[0].recommended = true;
    let seen = false;
    for (const o of opts) { if (o.recommended) { if (seen) o.recommended = false; else seen = true; } }
    state.premises = opts;
  } catch (e) { state.premiseError = msg(e); }
  finally {
    premLoading = false; await saveState(); render();
    // The ★ is a call, not a decoration: it details itself into a full script with zero clicks.
    const rec = (state.premises || []).find((o) => o.recommended);
    if (rec && !state.run && !running) void start(rec);
  }
}

async function start(premise) {
  if (!relay) return;
  if (running) { toast("Still drafting that one — one sec."); return; }
  const label = String(premise?.label || "").trim();
  if (!label) { toast("Pick a take, or describe one.", true); return; }
  destroyRecorder();
  state.run = {
    id: uid(), premiseId: premise.id || null, input: label, brief: String(premise.text || ""),
    mode: "screen", options: null, selectedId: null, steers: [], status: "", error: null,
  };
  await saveState(); render();
  await draftScript();
}

async function draftScript(steer) {
  const r = state.run; if (!r || !relay) return;
  const mode = MODES.find((m) => m.key === r.mode) || MODES[0];
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "drafting the script…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, scripting a ${mode.label.toLowerCase()} recording (${mode.sub}, up to ${mode.maxSeconds}s).`,
      `WHAT THEY'RE RECORDING: "${r.input}"`,
      r.brief ? `THE PREMISE IN FULL: ${r.brief}` : "",
      brand ? `LENT CONTEXT "${brand.name}" (ground the script in it — voice, specifics): ${ctxBlob(2500)}` : "",
      "Draft 3 script options, each a genuinely different angle. Each option: a list of BEATS, one per line — for screen recordings each beat is 'what's on screen — the spoken line'; for camera each beat is a short spoken line. Plain words a person actually says out loud. Never invent facts beyond what you're given.",
      r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the angle, 2-5 words>,"text":<the beats, one per line>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no scripts came back — try again");
    r.options = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Angle").slice(0, 60), text: String(o.text || "").trim(), recommended: !!o.recommended }));
    if (!r.options.some((o) => o.recommended)) r.options[0].recommended = true;
    r.selectedId = (r.options.find((o) => o.recommended) || r.options[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Switching capture mode re-scripts (the beats differ for screen vs camera) and drops the recorder.
async function setMode(key) {
  const r = state.run; if (!r || running || r.mode === key) return;
  destroyRecorder();
  r.mode = key; r.options = null; r.selectedId = null; r.steers = [];
  await saveState(); render();
  await draftScript();
}

function destroyRecorder() { if (recHost) { try { recHost.handle.destroy(); } catch { /* gone */ } recHost = null; } }
function selectedText() { const r = state.run; const o = (r.options || []).find((x) => x.id === r.selectedId); return o ? o.text : ""; }
async function copyScript() {
  try { await navigator.clipboard.writeText(selectedText()); toast("Script copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!relay;
  view.textContent = "";

  if (!relay) { view.append(connectSteps()); return; }

  // ---- stage 0: the premises — always on screen the moment we're connected ----
  const head = el("div", "runbar");
  head.append(el("span", "kicker", "what to record"));
  head.append(el("span", "run-input", brand ? "drawn from " + brand.name : "no context lent — generic takes"));
  const more = el("button", "act", "⟳ other takes");
  more.disabled = premLoading;
  more.onclick = () => void loadPremises();
  head.append(more);
  view.append(head);

  if (premLoading) view.append(researching("reading " + (brand ? brand.name : "the project") + " for what's worth recording…"));
  if (state.premiseError) {
    view.append(el("div", "err", state.premiseError));
    const t = el("button", "act", "try again"); t.onclick = () => void loadPremises(); view.append(t);
  }
  if (state.premises && state.premises.length) {
    view.append(optionCards(state.premises, r ? r.premiseId : null, (o) => { void start(o); }));
  }

  // The ONE free-text box: a steer on an already-populated board, never a gate in front of it.
  const own = el("div", "steer");
  own.append(el("span", "kicker", "or describe your own — optional"));
  const ownRow = el("div", "row");
  const ownBox = el("div", "box");
  const ownInput = el("input"); ownInput.placeholder = "e.g. a 40-second walkthrough of the pricing page";
  const ownGo = () => { const t = ownInput.value.trim(); if (!t) return; ownInput.value = ""; void start({ id: null, label: t, text: "" }); };
  ownInput.addEventListener("keydown", (e) => { if (e.key === "Enter") ownGo(); });
  ownBox.append(ownInput);
  const ownBtn = el("button", "send", "script it"); ownBtn.onclick = ownGo;
  ownRow.append(ownBox, ownBtn); own.append(ownRow);
  view.append(own);

  if (!r) return;

  const bar = el("div", "runbar");
  bar.style.marginTop = "26px";
  bar.append(el("span", "kicker", "recording"), el("span", "run-input", r.input));
  const cp = el("button", "act", "copy script"); cp.onclick = () => void copyScript(); cp.disabled = !r.options;
  const nu = el("button", "act", "× clear"); nu.onclick = () => { destroyRecorder(); state.run = null; void saveState(); render(); };
  bar.append(cp, nu);
  view.append(bar);

  // capture mode toggle (re-scripts on change)
  const modeRow = el("div", "opts"); modeRow.style.flexDirection = "row"; modeRow.style.flexWrap = "wrap";
  for (const m of MODES) {
    const o = el("div", "opt" + (r.mode === m.key ? " sel" : "")); o.style.flex = "1"; o.style.minWidth = "180px";
    o.onclick = () => void setMode(m.key);
    o.append(el("div", "check", "✓"), el("div", "o-label", m.label), el("div", "o-text", m.sub));
    modeRow.append(o);
  }
  view.append(modeRow);

  if (r.status) view.append(researching(r.status));
  if (r.error) {
    view.append(el("div", "err", r.error));
    const t = el("button", "act", "try again"); t.onclick = () => void draftScript(null); view.append(t);
  }

  if (r.options) {
    view.append(el("div", "kicker sect", "the script"));
    view.append(optionCards(r.options, r.selectedId, (o) => { r.selectedId = o.id; void saveState(); render(); }));
    if (!running) view.append(steerRow((s) => { running = true; render(); void draftScript(s).finally(() => { running = false; render(); }); }));

    // the shared kit recorder — mounted ONCE into a cached host, re-appended each render so a live
    // MediaStream survives re-renders (the compose-recorder invariant from the skill).
    view.append(el("div", "kicker sect", "record it"));
    const mode = MODES.find((m) => m.key === r.mode) || MODES[0];
    if (!recHost) {
      const host = el("div");
      const handle = mountRecorder(host, {
        mode: r.mode, maxSeconds: mode.maxSeconds, fileName: mode.fileName,
        hint: r.mode === "screen" ? "Share the tab/window, then walk the beats above." : "Look at the camera and hit the beats above — one take.",
      });
      recHost = { host, handle };
    }
    view.append(recHost.host);
  }
}
render();
