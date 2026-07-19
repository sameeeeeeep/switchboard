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

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "yearbook",                               // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Yearbook",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Yearbook — draft retro yearbook portrait concepts, then develop each one on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // the whole-connector wildcard — the portrait dance
    contextKinds: ["brand", "persona"],         // themes the decades to a lent persona/brand
  },
  usesContext: "single",                        // "single" = consumes one lent context; "none" = standalone
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
// Everything below is THIS wrapp — the AI Yearbook. The pipeline is the house shape wearing a
// portrait: ONE line (the subject, or the lent persona) → stage 1 proposes 3 retro yearbook ERAS
// as option cards (decade + archetype + a detailed imagePrompt, one recommended) in a SINGLE cheap
// text call → stage 2 develops each portrait on the user's OWN Higgsfield, one card at a time,
// AFTER the cards are already on screen. Stage 1 NEVER waits on an image. Steering re-runs stage 1;
// a per-card re-shoot re-runs just that portrait. The cold open fires the whole thing from a lent
// persona with zero typing.

const STEER_CHIPS = ["different decades", "goofier archetypes", "dial up the film grain", "add a Y2K one"];
let running = false; // guards stage 1 (era proposal) only — portraits develop with running=false

// A run's develop-token: bumping run.gen (a steer/regenerate) abandons any portraits still in flight.
function token() { return state.run ? state.run.id + ":" + (state.run.gen || 0) : null; }

// Labeled SAMPLE portraits — shown ONLY pre-connect so the page is never a blank promise. Real
// portraits (developed on the user's Higgsfield) replace these the moment a run starts.
const SAMPLE_ERAS = [
  { label: "Class of '77", vibe: "Disco senior — feathered hair, wide collar, amber haze.",
    colors: { bg1: "#B5813A", bg2: "#6E4415", body: "#3A2A16", skin: "#D8A878", hair: "#insert" } },
  { label: "Class of '88", vibe: "New Wave — teal laser backdrop, blazer, big attitude.",
    colors: { bg1: "#2E8C8C", bg2: "#123B45", body: "#20303A", skin: "#CFA383", hair: "#1C1712" } },
  { label: "Class of '95", vibe: "Grunge — flannel, mall-studio maroon, soft grain.",
    colors: { bg1: "#7C3B45", bg2: "#3A1B22", body: "#2A1B1E", skin: "#D3A585", hair: "#241A12" } },
];
SAMPLE_ERAS[0].colors.hair = "#4A2F14";

function samplePortraitNode(c) {
  const w = el("div", "yb-frame sample");
  // Static, author-written SVG (not model output) — a plain silhouette headshot, tinted per era.
  w.innerHTML =
    `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<defs><linearGradient id="g${c.bg2.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient></defs>` +
    `<rect width="200" height="250" fill="url(#g${c.bg2.slice(1)})"/>` +
    `<ellipse cx="100" cy="252" rx="72" ry="92" fill="${c.body}"/>` +
    `<circle cx="100" cy="98" r="46" fill="${c.skin}"/>` +
    `<path d="M52 96 Q50 44 100 44 Q150 44 148 96 Q140 64 100 64 Q60 64 52 96Z" fill="${c.hair}"/>` +
    `</svg>`;
  return w;
}

function sampleBar() {
  const wrap = el("div", "yb-samplebar");
  wrap.append(el("span", "kicker", "sample — connect to shoot your own"));
  const grid = el("div", "yb-grid");
  for (const s of SAMPLE_ERAS) {
    const card = el("div", "yb-card");
    card.append(samplePortraitNode(s.colors));
    const meta = el("div", "yb-meta");
    meta.append(el("span", "yb-tag", "sample"));
    meta.append(el("div", "yb-label", s.label));
    meta.append(el("div", "yb-vibe", s.vibe));
    card.append(meta);
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

// ---------- THE COLD OPEN ----------
function personaSeed(b) {
  const d = b.data || {};
  const desc = String(d.positioning || d.voice || d.audience || d.vibe || "").trim();
  return [b.name, desc].filter(Boolean).join(" — ").slice(0, 200);
}
function autostart() {
  // When a persona/brand is lent, the whole yearbook fires with ZERO input: eras themed to that
  // person, portraits already developing. The value is on screen before the user types a character.
  // Fires only when the seed is real, and never re-fires over a saved run.
  if (state.run) return;
  if (brand) { const seed = personaSeed(brand); if (seed) void start(seed, true); }
}

// ---------- stage 0 · the single input ----------
async function start(input, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Tell it who to yearbook — one line.", true); return; }
  state.run = { id: uid(), gen: 0, input, fromContext: !!fromContext, eras: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeEras();
}

// ---------- stage 1 · propose the eras (ONE cheap text call → option cards; NEVER waits on an image) ----------
async function proposeEras(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.eras = null; r.status = "picking the decades…"; render();
  const runId = r.id;
  try {
    const arr = await askJsonArray([
      `You are Yearbook, an AI photographer who recreates vintage high-school yearbook portraits. The subject: "${r.input}".`,
      brand ? `A persona/brand is lent — theme the decades, wardrobe and mood to this person (voice, era, audience, palette). Context: ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
      r.steers.length ? `Apply this steering (latest wins): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      'Pick 3 DISTINCT retro yearbook treatments — each a different decade AND archetype (e.g. \'77 disco senior, \'85 New Wave rebel, \'93 grunge slacker, Y2K frosted-tips jock, \'80s valedictorian). Return ONLY a JSON array — no prose, no fences. Each element: {"label":<"Class of \'8X" or "\'70s Disco Senior" — 2-5 words>,"vibe":<one punchy line describing the look>,"imagePrompt":<a complete, vivid text-to-image prompt for ONE vintage yearbook HEADSHOT of the subject in that era: hairstyle, wardrobe, mottled studio backdrop, film stock, lighting, faded period colors — square-on, shoulders-up, no text, no captions, no logos, no watermarks>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no eras came back — try again");
    if (runId !== r.id) return;
    r.eras = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || "Yearbook").slice(0, 60),
      vibe: String(o.vibe || o.text || "").slice(0, 200),
      imagePrompt: String(o.imagePrompt || "").slice(0, 800),
      recommended: !!o.recommended,
      imageUrl: null, imgStatus: "idle", imgError: null,
    })).filter((e) => e.imagePrompt);
    if (!r.eras.length) throw new Error("the eras came back malformed — try again");
    if (!r.eras.some((e) => e.recommended)) r.eras[0].recommended = true;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  // ONE-GO: with the cards on screen, portraits develop themselves — recommended first.
  if (r.eras && !r.error && runId === r.id) { r.gen = (r.gen || 0) + 1; await developAll(token()); }
}

// ---------- stage 2 · develop each portrait on the user's Higgsfield (per-card, sequential) ----------
async function developAll(tok) {
  const r = state.run;
  const eras = (r && r.eras) ? r.eras.slice().sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)) : [];
  for (const era of eras) {
    if (tok !== token()) return;   // a steer/start-over abandoned this batch
    if (era.imageUrl) continue;
    await developPortrait(era, tok);
  }
}

async function developPortrait(era, tok) {
  if (!relay || !state.run) return;
  tok = tok || token();
  era.imgStatus = "developing"; era.imgError = null; paintFrame(era); paintActions(era);
  const instruction =
    `Use the Higgsfield generate_image tool to generate an image of: "${era.imagePrompt}", aspect_ratio "4:5". ` +
    `Wait for it to finish (poll the job status if needed), then reply with ONLY the final image URL on its own line.`;
  let url = null, acc = "";
  try {
    for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
      if (tok !== token()) return; // superseded — drop the frame silently
      if (d.type === "tool_result") {
        if (d.result?.ok) { const t = (d.result.content ?? []).map((x) => x.text ?? "").join(""); const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
      } else if (d.type === "text") { acc += d.text; }
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (tok !== token()) return;
    if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
    if (!url) throw new Error("no portrait came back — retry usually lands the second pass");
    era.imageUrl = url; era.imgStatus = "done";
  } catch (e) {
    if (tok !== token()) return;
    era.imgStatus = "error"; era.imgError = msg(e);
  }
  await saveState(); paintFrame(era); paintActions(era);
}

// ---------- the portrait frame (painted in place so parallel develops never trigger a full reflow) ----------
function fillFrame(frame, era) {
  if (!frame) return;
  frame.textContent = "";
  if (era.imageUrl) {
    const img = el("img"); img.src = era.imageUrl; img.alt = era.label; img.loading = "lazy";
    img.onerror = () => { era.imageUrl = null; era.imgStatus = "error"; era.imgError = "the image link expired"; fillFrame(frame, era); paintActions(era); };
    frame.append(img);
  } else if (era.imgStatus === "developing") {
    const d = el("div", "yb-dev"); d.append(el("div", "spark"), el("span", null, "developing…")); frame.append(d);
  } else if (era.imgStatus === "error") {
    const f = el("div", "yb-fail");
    f.append(el("div", "m", era.imgError || "didn't develop"));
    const b = el("button", "yb-retry", "retry"); b.onclick = () => { era.imageUrl = null; void developPortrait(era); };
    f.append(b); frame.append(f);
  } else {
    const i = el("div", "yb-idle");
    const b = el("button", "yb-develop", "develop portrait"); b.onclick = () => void developPortrait(era);
    i.append(b); frame.append(i);
  }
}
function paintFrame(era) { fillFrame($("yb-frame-" + era.id), era); }
function paintActions(era) {
  const host = $("yb-actions-" + era.id);
  if (!host) return;
  host.textContent = "";
  const re = el("button", "yb-mini", era.imgStatus === "developing" ? "developing…" : "↻ re-shoot");
  re.disabled = era.imgStatus === "developing";
  re.onclick = () => { era.imageUrl = null; void developPortrait(era); };
  host.append(re);
  if (era.imageUrl) {
    const dl = document.createElement("a");
    dl.className = "yb-mini"; dl.textContent = "⬇ save"; dl.href = era.imageUrl;
    dl.target = "_blank"; dl.rel = "noopener"; dl.download = "yearbook-" + era.id + ".png";
    host.append(dl);
  }
}

function eraCard(era) {
  const card = el("div", "yb-card" + (era.recommended ? " rec" : ""));
  if (era.recommended) card.append(el("div", "yb-rec", "our pick"));
  const frame = el("div", "yb-frame"); frame.id = "yb-frame-" + era.id;
  fillFrame(frame, era);
  const meta = el("div", "yb-meta");
  meta.append(el("div", "yb-label", era.label));
  if (era.vibe) meta.append(el("div", "yb-vibe", era.vibe));
  const actions = el("div", "yb-actions"); actions.id = "yb-actions-" + era.id;
  meta.append(actions);
  card.append(frame, meta);
  // paint actions after the id is in the tree
  queueMicrotask(() => paintActions(era));
  return card;
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) { view.append(connectSteps(), sampleBar()); return; }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "themed to your lent persona — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — who should we yearbook? e.g. “my roommate Dev, curly hair, always in a hoodie”";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Shoot"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "subject"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.eras) {
    col.append(el("div", "kicker sect", "your yearbook — every decade"));
    const grid = el("div", "yb-grid");
    for (const era of r.eras) grid.append(eraCard(era));
    col.append(grid);
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeEras();
    col.append(t);
  }
  if (r.eras && !running) col.append(steerRow((s) => void proposeEras(s)));
  view.append(col);
}
render();
