// Thumbs — a video title → click-worthy thumbnails, on the visitor's OWN Claude. The operator
// holds no key, pays for no inference, and never sees the user's data — Switchboard brokers it all.
//
// Shape: ONE line (the video title) → stage 1 drafts 3 distinct thumbnail concepts as option cards
// (composition + a big ALL-CAPS text overlay idea + the emotion it sells + a detailed imagePrompt),
// one recommended, tuned to the lent brand's palette + voice. Stage 1 is a single pure-text
// askJsonArray call — it NEVER waits on an image. Rendering the actual 16:9 thumbnail on the user's
// Higgsfield is a SEPARATE per-card stage 2, one click, one credit, one consent — exactly like
// studio.js/imagegen.js. THE COLD OPEN: lend a brand and the concepts for its next video draft
// themselves with zero input.
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
  id: "thumbs",                                 // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Thumbs",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "turn a video title into click-worthy thumbnail concepts and render them on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // whole-connector wildcard — the thumbnail render dance
    contextKinds: ["brand"],                    // so a lent brand tunes concepts to its palette + voice
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
// THIS wrapp: ONE line (the video title) → stage 1 drafts 3 thumbnail CONCEPTS as option cards
// (composition + a big ALL-CAPS overlay + the emotion it sells + a detailed imagePrompt), one
// recommended, auto-selected. Stage 1 is a single pure-text askJsonArray — it NEVER waits on an
// image. Stage 2 renders the actual 16:9 thumbnail on the user's Higgsfield, PER CARD, one click,
// one credit, one consent — it runs only after the cards are on screen (studio/imagegen idiom).
// Steering re-drafts the concepts; picking a card just selects it for a render.

const STEER_CHIPS = ["more clickbait", "cleaner + calmer", "bolder face", "brighter colors", "another angle"];
let running = false;   // stage-1 concept draft in flight
let renderingId = null; // which concept's thumbnail render is in flight (image renders never auto-fire)

function autostart() {
  // THE COLD OPEN — the single strongest selling moment: when a brand is lent, Thumbs drafts
  // concepts for the brand's NEXT video with ZERO input (no form, no prompt, no button). The value
  // is on screen before the user types a character. Fire only with a lent brand, never over a saved run.
  if (state.run) return;
  if (brand) {
    const d = brand.data || {};
    const pos = d.positioning || d.voice || "";
    const seed = "The next video from " + (brand.name || "the brand") + (pos ? " — " + pos : "");
    void start(seed, { fromContext: true });
  }
}

async function start(input, opts = {}) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it the video title first.", true); return; }
  state.run = { id: uid(), input, fromContext: !!opts.fromContext, concepts: null, selectedId: null, steers: [], status: "", error: null, images: {} };
  await saveState(); render();
  await proposeConcepts();
}

// STAGE 1 — pure text, one streamed JSON array. This is what a headless run verifies: option cards
// on screen, never gated on a Higgsfield image.
async function proposeConcepts(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = r.concepts ? "reworking the concepts…" : "finding the click…"; render();
  try {
    const d = brand && brand.data ? brand.data : null;
    const arr = await askJsonArray([
      `You are Thumbs, a YouTube thumbnail director who lives and dies by click-through rate.`,
      `The video title is: "${r.input}".`,
      d ? `The channel/brand this thumbnail is for — match its palette, audience and energy:\n${JSON.stringify(d).slice(0, 1800)}` : "",
      r.steers.length ? `Steering notes (apply the LATEST hardest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      `Propose 3 DISTINCT thumbnail concepts — each a genuinely different visual bet on why someone clicks.`,
      `Return ONLY a JSON array — no prose, no code fences. Each element EXACTLY:`,
      `{"label":<3–5 word concept name>,` +
        `"overlay":<the BIG text overlay, 2–4 punchy words, ALL CAPS, what the eye reads in 0.1s>,` +
        `"emotion":<the single emotion it sells: shock|curiosity|desire|triumph|fear|outrage|awe>,` +
        `"composition":<one line: subject, framing, where the face/object sits, where the text goes>,` +
        `"imagePrompt":<a vivid image-generation prompt — subject, expression, setting, lighting, saturated high-contrast colors, mood; leave one clear high-contrast zone for the big text; photoreal or bold graphic as fits>,` +
        `"recommended":<true for EXACTLY one — the highest-CTR bet>}`,
    ]);
    if (!arr || !arr.length) throw new Error("no concepts came back — hit try again, it usually lands on the second pass");
    r.concepts = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Concept").slice(0, 60),
      overlay: String(o.overlay || "").slice(0, 40).toUpperCase(),
      emotion: String(o.emotion || "").slice(0, 24).toLowerCase(),
      composition: String(o.composition || "").slice(0, 240),
      imagePrompt: String(o.imagePrompt || "").slice(0, 600),
      recommended: !!o.recommended,
    }));
    if (!r.concepts.some((o) => o.recommended)) r.concepts[0].recommended = true;
    r.selectedId = (r.concepts.find((o) => o.recommended) || r.concepts[0]).id;
    r.images = {}; // fresh concepts → no stale renders
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// STAGE 2 — render ONE thumbnail on the user's Higgsfield. One click, one credit, one consent.
// Never auto-fires (spends credits) — the concept cards are the artifact of stage 1.
function buildThumbPrompt(c) {
  const d = brand && brand.data ? brand.data : null;
  const palette = d && Array.isArray(d.palette) && d.palette.length ? d.palette.filter(Boolean).slice(0, 5).join(", ") : "";
  return [
    c.imagePrompt,
    c.emotion ? `The whole frame must radiate ${c.emotion}.` : "",
    c.overlay ? `Bake in a bold, ultra-legible text overlay reading exactly "${c.overlay}" — heavy sans-serif, high contrast against its zone, occupying a clear part of the frame (not over the subject's face).` : "",
    palette ? `Fold this brand palette into the graphics, backdrop and text accents (never muddy the contrast): ${palette}.` : "",
    `YouTube thumbnail style: 16:9, ultra-sharp, saturated, punchy, one clear focal subject, reads instantly at small size. No watermarks, no borders, no channel logos.`,
  ].filter(Boolean).join(" ");
}

async function renderThumb(id) {
  const r = state.run; if (!r || !relay || renderingId) return;
  const c = (r.concepts || []).find((o) => o.id === id); if (!c) return;
  r.selectedId = id;
  renderingId = id;
  r.images[id] = { url: r.images[id]?.url || null, status: "rendering on your Higgsfield…", error: null };
  render();
  try {
    const url = await genImage(buildThumbPrompt(c));
    if (!url) throw new Error("no image came back — hit re-render, the second pass usually lands");
    r.images[id] = { url, status: "", error: null };
  } catch (e) { r.images[id] = { url: r.images[id]?.url || null, status: "", error: msg(e) }; }
  finally { renderingId = null; await saveState(); render(); }
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
    if (brand) startBox.append(el("div", "ctx", "tuned to your lent brand — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "paste your video title — e.g. “I tried the world's spiciest ramen”";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Make thumbnails"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    if (!brand) startBox.append(el("div", "hint", "one line in — three thumbnail concepts out, each a one-click render on your own Higgsfield."));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "title"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ new title");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.concepts) {
    col.append(el("div", "kicker sect", "three thumbnails to test"));
    const grid = el("div", "concepts");
    for (const c of r.concepts) grid.append(conceptCard(c));
    col.append(grid);
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeConcepts();
    col.append(t);
  }
  if (r.concepts && !running) col.append(steerRow((s) => void proposeConcepts(s)));
  view.append(col);
}

// One concept = the house .opt card + a 16:9 render slot and its own render button. The card body
// is the stage-1 artifact; the render slot is stage 2, filled only on a click.
function conceptCard(c) {
  const r = state.run;
  const sel = c.id === r.selectedId;
  const card = el("div", "opt concept" + (sel ? " sel" : ""));
  card.onclick = () => { r.selectedId = c.id; render(); };
  card.append(el("div", "check", "✓"));
  if (c.recommended) card.append(el("div", "rec", "highest CTR"));
  card.append(el("div", "o-label", c.label));

  const overlay = el("div", "overlay");
  overlay.append(el("span", "ov-lbl", "big text"), el("span", "ov-text", c.overlay || "—"));
  card.append(overlay);

  const meta = el("div", "c-meta");
  if (c.emotion) meta.append(el("span", "emo", c.emotion));
  if (c.composition) meta.append(el("span", "comp", c.composition));
  card.append(meta);

  const img = r.images[c.id] || null;
  const slot = el("div", "shot");
  if (img && img.url) { const im = el("img", "shot-img"); im.src = img.url; im.alt = c.label; im.loading = "lazy"; slot.append(im); }
  else if (renderingId === c.id) { const s = el("div", "shot-live"); s.append(el("span", "dot"), el("span", null, img?.status || "rendering…")); slot.append(s); }
  else { slot.append(el("div", "shot-empty", "16:9 — one click, one Higgsfield credit")); }
  card.append(slot);

  if (img && img.error) card.append(el("div", "err small", img.error));

  const foot = el("div", "c-foot");
  const btn = el("button", (img && img.url) ? "act" : "primary sm", renderingId === c.id ? "rendering…" : (img && img.url) ? "↺ re-render" : "Render thumbnail");
  btn.disabled = !!renderingId;
  btn.onclick = (e) => { e.stopPropagation(); void renderThumb(c.id); };
  foot.append(btn);
  if (img && img.url) {
    const dl = el("a", "act dl", "⬇ save");
    dl.href = img.url; dl.target = "_blank"; dl.rel = "noopener";
    dl.onclick = (e) => e.stopPropagation();
    foot.append(dl);
  }
  card.append(foot);
  return card;
}
render();
