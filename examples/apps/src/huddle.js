// HUDDLE — get on a working call with Claude to move a project forward, on the visitor's OWN Claude.
// COMPOSE wrapp: camera presence (getUserMedia) + a warm stateful thread (claude_session, one
// sessionId held across turns) + the shared kit SPEAKER element (relay.speak — Claude talks back
// ON-DEVICE, no cloud voice) + storage.bind to a real project folder so the call is grounded in
// actual files. You type; Claude answers in text and speaks it. Nothing but your prompts leaves.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { mountSpeaker } from "./kit/speaker.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "huddle",
  name: "Huddle",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Huddle — a working call with Claude on your own model; Claude speaks back on-device and can read the project you lend it",
    models: ["sonnet"],
    tools: ["WebSearch", "WebFetch"],
    // The call is grounded in the LENT context first (that's what makes the openers real) and in an
    // optional bound folder second. Reused grants are exact-match and ignore newly requested kinds,
    // so every list()/use() call below tolerates an empty result or a throw.
    contextKinds: ["project", "brand", "note", "personal"],
  },
  usesContext: "single",                        // a lent context grounds the call; a bound folder deepens it
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
  if (APP.usesContext === "single") {
    brand = await relay.context.active().catch(() => null);
    // Doctrine fallback: nothing lent → auto-select the best-matching banked context so the call
    // still opens on something real. A project beats a brand beats whatever else is banked.
    if (!brand && typeof relay.context.list === "function" && typeof relay.context.use === "function") {
      try {
        const metas = (await relay.context.list()) || [];
        const rank = { project: 0, brand: 1, note: 2, personal: 3 };
        const best = metas.slice().sort((a, b) => (rank[(a.kind || "").toLowerCase()] ?? 9) - (rank[(b.kind || "").toLowerCase()] ?? 9))[0];
        if (best) brand = (await relay.context.use(best.id)) || null;
      } catch { /* grant without the kind, or an older daemon — the picker still works */ }
    }
  }
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
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Four openers from your project — nothing to type";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · The ★ one is already answered; take it from there";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// HUDDLE — a live working call that OPENS ITSELF. The moment Switchboard is connected (fresh chip
// click OR a page-load with a standing grant) Huddle reads the lent context and drafts 4 opening
// questions grounded in it — one ★ recommended — then ASKS the ★ one, so the founder lands on a
// real answer instead of a blank composer. Camera preview (presence) + a warm claude_session thread
// + replies SPOKEN via the kit speaker (local TTS). Typing stays available; it is never required.

let running = false;
let startersLoading = false;
let startersTried = false;          // one proactive opener pass per page life — the chip's onConnect
                                    // and the returning-user probe both funnel through onReady().
let speaker = null;                 // kit/speaker handle
let camStream = null;               // live getUserMedia stream (presence, NOT recorded)
const SESSION_ID = "huddle-" + uid(); // one warm session for the whole page session
let session = { folder: null, files: [], turns: [], starters: null, starterError: null, camOn: false, voiceOn: true, status: "", error: null };

let opened = false;
function autostart() { void openCall(); }
async function openCall() {
  // onReady() fires from BOTH the chip's onConnect and the returning-user probe — opening twice
  // would read the transcript back over a turn that is mid-stream.
  if (opened) return;
  opened = true;
  await loadCall();
  // A warm call resumes where it was — never re-open (and never re-spend) on top of real turns.
  if (session.turns.length) { startersTried = true; return; }
  if (startersTried) return;
  startersTried = true;
  await loadStarters();
}
async function loadCall() { try { const raw = await relay.storage.get(APP.id + "-call"); if (raw) { const s = JSON.parse(raw); session.turns = s.turns || []; session.folder = s.folder || null; } } catch { /* fresh */ } if (session.folder) await refreshFiles(); render(); }
async function saveCall() { try { await relay.storage.set(APP.id + "-call", JSON.stringify({ turns: session.turns.slice(-40), folder: session.folder })); } catch { /* non-fatal */ } }

async function bindProject(path) {
  if (!relay) return;
  session.status = "opening the project…"; render();
  try {
    const info = await relay.storage.bind(String(path).trim());
    if (!info) throw new Error("bind declined");
    session.folder = info.folder;
    await refreshFiles();
  } catch (e) { toast("Couldn't open — " + msg(e), true); }
  finally { session.status = ""; await saveCall(); render(); }
}
async function refreshFiles() {
  try { const keys = await relay.storage.list(); session.files = (keys || []).filter((k) => /\.(md|txt|json|js|ts|tsx|css|html)$/i.test(k)).slice(0, 40); }
  catch { session.files = []; }
}
// A compact grounding blob: file names + the head of a few text files, so the call knows the project.
async function projectGrounding() {
  if (!session.folder || !session.files.length) return "";
  const heads = [];
  for (const k of session.files.slice(0, 6)) { try { const v = await relay.storage.get(k); if (v) heads.push(`--- ${k} ---\n${String(v).slice(0, 800)}`); } catch { /* skip */ } }
  return `PROJECT FOLDER: ${session.folder}\nFILES: ${session.files.join(", ")}\n\n${heads.join("\n\n")}`.slice(0, 6000);
}

// STAGE 0 — the openers. Derived from the lent context (plus the bound folder when there is one),
// so the call starts on this project's real decisions. Degrades honestly with no context and never
// leaves the UI locked (unlock in a finally).
const ctxBlob = (n) => (brand ? JSON.stringify(brand.data || {}).slice(0, n || 2200) : "");

async function loadStarters(steer) {
  if (!relay || startersLoading) return;
  startersLoading = true; session.starterError = null; render();
  try {
    const arr = await askJsonArray([
      `You are setting the agenda for a founder's working session on "${brand ? brand.name : "their project"}".`,
      brand
        ? `THE PROJECT — every question must come from here (its products, status, roadmap, open tasks, audience): ${ctxBlob()}`
        : "Nothing was lent, so keep the openers concrete and useful to any small product team shipping this week.",
      session.folder && session.files.length ? `They also opened the folder ${session.folder} — files: ${session.files.slice(0, 20).join(", ")}` : "",
      "Propose 4 opening questions the founder would genuinely want answered in the first ten minutes. Each must name something specific from the material above — a real product, a real decision, a real gap. No generic coaching questions, no 'what are your goals'.",
      steer ? `Steer (apply it): "${steer}"` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the question, asked in the founder\'s own first person, at most 14 words>,"text":<one line on why it is worth the first ten minutes>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no openers came back — hit ⟳ other openers");
    const opts = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || o.title || o.question || "Where should I start?").slice(0, 120),
      text: String(o.text || o.body || o.description || "").trim().slice(0, 240),
      recommended: !!o.recommended,
    }));
    if (!opts.some((o) => o.recommended)) opts[0].recommended = true;
    let seen = false;
    for (const o of opts) { if (o.recommended) { if (seen) o.recommended = false; else seen = true; } }
    session.starters = opts;
  } catch (e) { session.starterError = msg(e); }
  finally {
    startersLoading = false; render();
    // The ★ is a call, not a decoration: it gets asked, so the founder lands on an answer.
    const rec = (session.starters || []).find((o) => o.recommended);
    if (rec && !session.turns.length && !running) void ask(rec.label);
  }
}

async function toggleCam() {
  session.camOn = !session.camOn;
  if (session.camOn) {
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false }); }
    catch { session.camOn = false; toast("Camera declined.", true); }
  } else if (camStream) { for (const t of camStream.getTracks()) t.stop(); camStream = null; }
  render();
}

async function ask(text) {
  text = String(text || "").trim();
  if (!text || !relay || running) return;
  session.turns.push({ role: "user", text });
  session.turns.push({ role: "assistant", text: "", pending: true });
  running = true; session.error = null; render();
  const turn = session.turns[session.turns.length - 1];
  try {
    const grounding = await projectGrounding();
    const full = await streamText({
      sessionId: SESSION_ID,
      system: "You are on a live working call with the founder, helping move their project forward. Be concise and spoken — short paragraphs, one idea at a time, like talk not an essay. Ask a sharp question when it would help."
        + (brand ? `\n\nThe project they lent you is "${brand.name}":\n` + ctxBlob(2500) : "")
        + (grounding ? "\n\nYou can also see their files:\n" + grounding : ""),
      prompt: text,
      maxTokens: 1200,
    }, (p) => { if (p.text) { turn.text = p.text; const live = document.querySelector(".turn.pending .bubble"); if (live) live.textContent = p.text; } });
    turn.text = full.trim(); turn.pending = false;
    if (session.voiceOn && speaker) void speaker.speak(turn.text);
  } catch (e) { turn.pending = false; turn.text = ""; session.error = msg(e); session.turns.pop(); }
  finally { running = false; await saveCall(); render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!relay;
  view.textContent = "";
  if (!relay) { view.append(connectSteps()); return; }
  if (!speaker) speaker = mountSpeaker(relay);

  // the call surface: a stage (camera + controls) over a transcript, with a persistent composer
  const stage = el("div", "call-stage");
  const cam = el("div", "cam" + (session.camOn ? " on" : ""));
  if (session.camOn && camStream) { const v = el("video"); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = camStream; v.style.transform = "scaleX(-1)"; cam.append(v); }
  else cam.append(el("div", "cam-off", "camera off"));
  stage.append(cam);
  const claude = el("div", "cam claude"); claude.append(el("div", "orb" + (running ? " live" : "")), el("div", "cam-tag", running ? "Claude is talking…" : "Claude")); stage.append(claude);
  view.append(stage);

  // controls
  const ctl = el("div", "call-ctl");
  const camBtn = el("button", "act" + (session.camOn ? " on" : "")); camBtn.textContent = session.camOn ? "◉ camera on" : "○ camera"; camBtn.onclick = () => void toggleCam();
  const vBtn = el("button", "act" + (session.voiceOn ? " on" : "")); vBtn.textContent = session.voiceOn ? "🔊 voice on" : "🔇 voice off"; vBtn.onclick = () => { session.voiceOn = !session.voiceOn; if (!session.voiceOn && speaker) speaker.stop(); render(); };
  ctl.append(camBtn, vBtn);
  // project bind
  if (session.folder) { const f = el("span", "proj-tag"); f.textContent = "▸ " + session.folder + " (" + session.files.length + " files)"; ctl.append(f); const chg = el("button", "act", "change"); chg.onclick = () => { session.folder = null; render(); }; ctl.append(chg); }
  else { const b = el("button", "act", "＋ bring a project folder"); b.onclick = () => { const p = prompt("Project folder to work on (path):", "~/Documents/Projects/"); if (p) void bindProject(p); }; ctl.append(b); }
  view.append(ctl);

  if (session.status) view.append(researching(session.status));
  if (session.error) view.append(el("div", "err", session.error));

  // ---- the openers: options on the table, never an empty composer ----
  const shead = el("div", "opener-head");
  shead.append(el("span", "kicker", "on the table"));
  shead.append(el("span", "opener-src", brand ? "drawn from " + brand.name : "no context lent — general openers"));
  const more = el("button", "act", "⟳ other openers");
  more.disabled = startersLoading || running;
  more.onclick = () => void loadStarters();
  shead.append(more);
  view.append(shead);

  if (startersLoading) view.append(researching("reading " + (brand ? brand.name : "the project") + " for what's worth asking…"));
  if (session.starterError) {
    view.append(el("div", "err", session.starterError));
    const t = el("button", "act", "try again"); t.onclick = () => void loadStarters(); view.append(t);
  }
  if (session.starters && session.starters.length) {
    view.append(optionCards(session.starters, null, (o) => { if (!running) void ask(o.label); }));
  }

  // transcript
  const log = el("div", "call-log");
  if (!session.turns.length && !startersLoading) log.append(el("div", "empty", "Pick one above — or type anything. Claude answers in text and talks back."));
  for (const t of session.turns) {
    const row = el("div", "turn " + t.role + (t.pending ? " pending" : ""));
    const b = el("div", "bubble"); b.textContent = t.pending ? "…" : t.text; row.append(b);
    log.append(row);
  }
  view.append(log);

  // composer
  const comp = el("div", "composer");
  const input = el("input"); input.placeholder = running ? "Claude is answering…" : "type to the call — ⏎ to send"; input.disabled = running;
  const send = () => { const t = input.value.trim(); if (t && !running) { input.value = ""; void ask(t); } };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  const b = el("button", "primary", "Send"); b.disabled = running; b.onclick = send;
  comp.append(input, b);
  view.append(comp);
  if (!running) setTimeout(() => input.focus(), 30);
}
render();
