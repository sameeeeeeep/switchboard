// REEL — a promo/launch reel from one line, on the visitor's OWN Claude. COMPOSE wrapp: Claude
// drafts a scene script (option cards); Higgsfield paints each scene; the shared kit CAPTURE element
// renders the scenes onto a canvas and records a .webm — the "sections → mp4" primitive. The video
// is assembled in-browser (canvas.captureStream), nothing uploads except the image prompts.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { renderScenesToVideo } from "./kit/capture.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "reel",
  name: "Reel",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Reel — drafts a promo reel script and paints its scenes on your own Claude + Higgsfield; the video is built in your browser",
    models: ["sonnet"],
    tools: [HIGGSFIELD],
    contextKinds: ["brand"],
  },
  usesContext: "single",
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
// REEL — ONE line → Claude drafts a 4-6 scene script (each scene = title + on-screen subtitle +
// image brief) → paint scenes on Higgsfield → the kit CAPTURE element renders them to a .webm.
// Steer re-scripts; regenerate a single scene's image; render the video when you like the scenes.

const STEER_CHIPS = ["punchier", "fewer scenes", "more energy", "different angle"];
let running = false;

function autostart() {
  if (state.run) { state.run.status = ""; render(); return; }
  // THE COLD OPEN: connect with a lent brand and Reel is already scripting AND painting scenes on
  // your Higgsfield — the "Connect Switchboard, an image is generating" moment, with zero input.
  if (brand) { const seed = "a launch reel for " + brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("One line on the reel first.", true); return; }
  state.run = { id: uid(), input, scenes: null, steers: [], status: "", error: null, videoUrl: null, progress: 0 };
  await saveState(); render();
  await script();
}

async function script(steer) {
  const r = state.run; if (!r || !relay) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.videoUrl = null; r.status = "scripting the scenes…"; render();
  try {
    const arr = await askJsonArray([
      "You are Reel, scripting a short vertical-friendly promo/launch reel on the founder's own Claude.",
      `THE BRIEF (ground truth): "${r.input}"`,
      brand ? `LENT BRAND "${brand.name}" (match its voice, colors, specifics): ${JSON.stringify(brand.data).slice(0, 2500)}` : "",
      r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Write 4–6 scenes that build to one call to action. Each scene: a punchy on-screen TITLE (≤6 words), a SUBTITLE line (≤12 words), an IMAGE brief (a vivid, on-brand visual — no text in the image), and seconds (2–4).",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"title":<≤6 words>,"subtitle":<≤12 words>,"imageBrief":<vivid visual, no text>,"seconds":<2-4>}',
    ]);
    if (!arr || !arr.length) throw new Error("no scenes came back — try again");
    r.scenes = arr.slice(0, 6).map((s) => ({ id: uid(), title: String(s.title || "").slice(0, 60), subtitle: String(s.subtitle || "").slice(0, 120), imageBrief: String(s.imageBrief || "").slice(0, 300), seconds: Math.min(4, Math.max(2, Number(s.seconds) || 3)), imageUrl: null, imgErr: false }));
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.scenes && !r.error) void paintAll(); // ONE-GO: start painting the scenes right away
}

async function paintAll() {
  const r = state.run; if (!r || !r.scenes || running) return;
  running = true;
  for (let i = 0; i < r.scenes.length; i++) {
    const sc = r.scenes[i];
    if (sc.imageUrl) continue;
    r.status = `painting scene ${i + 1} of ${r.scenes.length} on your Higgsfield…`; render();
    await paintScene(sc.id);
  }
  running = false; r.status = ""; await saveState(); render();
}

async function paintScene(id) {
  const r = state.run; const sc = (r.scenes || []).find((x) => x.id === id); if (!sc || !relay) return;
  sc.imgErr = false; render();
  try {
    const url = await genImage(`${sc.imageBrief}. Cinematic, on-brand, no text overlays.${brand && brand.data?.palette ? " Palette: " + (brand.data.palette.slice(0, 3).join(", ")) : ""}`);
    if (!url) throw new Error("no image");
    sc.imageUrl = url;
  } catch { sc.imgErr = true; }
  await saveState(); render();
}

async function makeVideo() {
  const r = state.run; if (!r || !r.scenes || running) return;
  running = true; r.error = null; r.progress = 0; r.status = "rendering the reel…"; render();
  try {
    const scenes = r.scenes.map((s) => ({ title: s.title, subtitle: s.subtitle, imageUrl: s.imageUrl, seconds: s.seconds, bg: brand?.data?.palette?.[0] }));
    const blob = await renderScenesToVideo(scenes, { width: 1280, height: 720, fps: 30, onProgress: (p) => { r.progress = p; const b = $("rp"); if (b) b.style.width = Math.round(p * 100) + "%"; } });
    r.videoUrl = URL.createObjectURL(blob);
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; render(); }
}

function download() {
  const r = state.run; if (!r?.videoUrl) return;
  const a = document.createElement("a"); a.href = r.videoUrl; a.download = "reel.webm"; a.click();
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
    if (brand) startBox.append(el("div", "ctx", "reel for your lent brand — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — what's the reel for?";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Make the reel ▸"); btn.onclick = go;
    row.append(input, btn); startBox.append(row); view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "reel"), el("span", "run-input", r.input), el("span", "grow"));
  const painted = (r.scenes || []).filter((s) => s.imageUrl).length;
  if (!running && r.scenes && painted === r.scenes.length) {
    const mk = el("button", "act", r.videoUrl ? "↻ re-render" : "▶ render video"); mk.onclick = () => void makeVideo(); bar.append(mk);
  }
  const nu = el("button", "act", "× new"); nu.onclick = () => { if (r.videoUrl) URL.revokeObjectURL(r.videoUrl); state.run = null; void saveState(); render(); };
  bar.append(nu); view.append(bar);

  if (r.status) view.append(researching(r.status));
  if (r.error) { view.append(el("div", "err", r.error)); const t = el("button", "act", "try again"); t.onclick = () => void script(null); view.append(t); }

  if (r.videoUrl) {
    view.append(el("div", "kicker sect", "the reel"));
    const v = el("video", "reel-video"); v.controls = true; v.src = r.videoUrl; v.loop = true; view.append(v);
    const dl = el("button", "act", "⬇ download .webm"); dl.onclick = download; view.append(dl);
  }

  if (r.scenes) {
    view.append(el("div", "kicker sect", "the scenes"));
    if (r.status && r.status.startsWith("rendering")) { const bar2 = el("div", "rp-wrap"); const fill = el("div", "rp"); fill.id = "rp"; fill.style.width = Math.round(r.progress * 100) + "%"; bar2.append(fill); view.append(bar2); }
    for (const sc of r.scenes) view.append(sceneCard(sc));
    if (!running) view.append(steerRow((s) => void script(s)));
  }
}

function sceneCard(sc) {
  const card = el("div", "q-card scene");
  const head = el("div", "scene-head");
  head.append(el("div", "scene-title", sc.title));
  head.append(el("div", "scene-secs", sc.seconds + "s"));
  card.append(head);
  if (sc.subtitle) card.append(el("div", "scene-sub", sc.subtitle));
  const media = el("div", "scene-media");
  if (sc.imageUrl) { const img = el("img"); img.src = sc.imageUrl; img.alt = sc.title; media.append(img); }
  else if (sc.imgErr) { const b = el("button", "act", "↻ repaint scene"); b.onclick = () => void paintScene(sc.id); media.append(b); }
  else media.append(researching("painting…"));
  card.append(media);
  card.append(el("div", "scene-brief", "▸ " + sc.imageBrief));
  return card;
}
render();
