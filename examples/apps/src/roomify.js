// Roomify — describe a room + a vibe, get three restyle DIRECTIONS as option cards, then repaint the
// space for real on the visitor's OWN Claude + Higgsfield. The operator holds no key, pays for no
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
  id: "roomify",                                // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Roomify",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Roomify — pitch three restyle directions for your room, then render each on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // stage 2 repaints the room on the user's own Higgsfield
    contextKinds: ["brand"],                    // a lent brand lets the cold open restyle a space in its palette
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
// Everything below is THIS wrapp. The sample shape is the house pipeline: ONE input → stage 1
// proposes angles (option cards, one recommended, auto-selected) → stage 2 produces the artifact
// from the selection, AUTOMATICALLY. Picking a different card or steering re-runs stage 2.
// Replace the prompts, stages, and final render; keep the shape (and the one-go auto-advance).

// Roomify's one-go pipeline: ONE line (room + vibe) → STAGE 1 pitches three restyle DIRECTIONS as
// option cards (a cheap text-only askJsonArray, one ★ recommended, NEVER gated on an image) →
// STAGE 2 repaints each room on the user's own Higgsfield (agentic genImage), fired per-card AFTER
// the cards are on screen. The recommended direction auto-renders (the cold-open demo); the others
// are one click each. Re-pitch (steer) re-runs stage 1; "restyle again" re-runs stage 2 for a card.
const STEER_CHIPS = ["warmer & cozier", "more minimal", "bolder color", "try another room"];
let running = false;   // stage 1 (direction pitch) in flight
let painting = false;  // stage 2 (one Higgsfield render) in flight — one consent at a time

// Pre-connect sample directions — visibly LABELED, so the page is never a blank form. Wiped the
// moment a real run starts on the user's own Claude.
const SAMPLE_DIRS = [
  { label: "Warm minimal", text: "Pared-back and calm — oak, off-white plaster, one sculptural lamp, morning light doing the decorating.", recommended: true },
  { label: "Japandi", text: "Japanese restraint meets Scandi warmth — low linen seating, paper shades, a single ikebana branch.", recommended: false },
  { label: "Considered maximalist", text: "Layered and lived-in — a deep jewel-tone sofa, gallery wall, patterned rug, brass and greenery everywhere.", recommended: false },
];

// The single line the room + vibe get parsed from. A lent brand seeds the cold open with a space
// styled in the brand's world instead.
function brandSeed() {
  const d = (brand && brand.data) || {};
  const vibe = String(d.positioning || d.voice || d.vibe || "").trim();
  return `a living room styled in ${brand.name}'s world${vibe ? " — " + vibe : ""}`;
}
function brandPaletteLine() {
  const d = (brand && brand.data) || {};
  const pal = Array.isArray(d.palette) ? d.palette.filter(Boolean).map(String).slice(0, 6) : [];
  return pal.length ? `Weave this brand palette through the furniture, walls and textiles (never garish, always tasteful): ${pal.join(", ")}.` : "";
}

function autostart() {
  // THE COLD OPEN — when a brand is lent, Roomify restyles a space in that brand's world with ZERO
  // input: three directions pitch themselves and the recommended one starts repainting on the user's
  // Higgsfield before they type a character. Fire only with a lent brand; never over a saved run.
  if (state.run) return;
  if (brand) void start(brandSeed());
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Tell it the room and the vibe first.", true); return; }
  state.run = { id: uid(), input, dirs: null, selectedId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeDirections();
}

// STAGE 1 — text-only, cheap, and the whole reliability spine: it renders OPTION CARDS and never
// waits on a Higgsfield call. Higgsfield only enters in stage 2 (restyle), after these are painted.
async function proposeDirections(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "sketching three directions…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, an interior designer. The space + vibe brief is: "${r.input}".`,
      brand ? `Lent brand context — let its personality and palette flavour the directions: ${JSON.stringify(brand.data).slice(0, 1600)}` : "",
      r.steers.length ? `Apply this steering, latest wins: ${r.steers.map((s) => `"${s}"`).join(" → ")}.` : "",
      "Pitch exactly 3 DISTINCT restyle directions for the SAME room (keep its layout, windows and proportions plausible — restyle, don't rebuild).",
      "Return ONLY a JSON array — no prose, no fences. Each element:",
      '{"label":<2-4 word style name, e.g. "Warm minimal">,"text":<one vivid sentence on the mood: materials, palette, light>,"imagePrompt":<a complete photorealistic interior-render prompt: the room type, restyle style, key furniture and materials, wall + floor treatment, lighting and time of day, camera angle — no people, no text, no watermark>,"recommended":<true for exactly ONE>}',
    ]);
    if (!arr || !arr.length) throw new Error("no directions came back — try again");
    r.dirs = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Direction").slice(0, 60),
      text: String(o.text || "").slice(0, 280),
      imagePrompt: String(o.imagePrompt || o.text || "").slice(0, 700),
      recommended: !!o.recommended,
      imageUrl: null, imgStatus: "", imgError: null,
    }));
    if (!r.dirs.some((o) => o.recommended)) r.dirs[0].recommended = true;
    r.selectedId = (r.dirs.find((o) => o.recommended) || r.dirs[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  // ONE-GO: the cards are on screen — NOW auto-repaint the recommended room (stage 2, separate call).
  if (r.dirs && !r.error) { const rec = r.dirs.find((o) => o.recommended); if (rec && !rec.imageUrl) await restyle(rec.id); }
}

// STAGE 2 — repaint ONE room on the user's Higgsfield. Per-card, one consent at a time. A failure
// leaves the card with an inline error + retry; the direction cards themselves never disappear.
function roomPrompt(dir) {
  return [dir.imagePrompt, brandPaletteLine(), "Photorealistic architectural interior render, natural depth, no people, no text, no lettering, no watermark."]
    .filter(Boolean).join(" ");
}
async function restyle(id) {
  const r = state.run; if (!r || !relay) return;
  const dir = (r.dirs || []).find((o) => o.id === id); if (!dir) return;
  if (painting) { toast("One room at a time — the current render is still developing.", true); return; }
  r.selectedId = id;
  painting = true; dir.imgError = null; dir.imgStatus = dir.imageUrl ? "repainting…" : "repainting your room…"; render();
  try {
    const url = await genImage(roomPrompt(dir));
    if (!url) throw new Error("no render came back — try again, the second pass usually lands");
    dir.imageUrl = url;
  } catch (e) { dir.imgError = msg(e); }
  finally { painting = false; dir.imgStatus = ""; await saveState(); render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    view.append(el("div", "kicker sect", "sample — connect to restyle for real"));
    view.append(sampleCards());
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "brand lent — Roomify will style a room in " + brand.name + "'s world"));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — the room + the vibe (e.g. “small living room, cozy japandi”)";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Restyle"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    view.append(el("div", "kicker sect", "sample — three directions Roomify might pitch"));
    view.append(sampleCards());
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "restyling"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.dirs) {
    col.append(el("div", "kicker sect", "three directions · restyle any one"));
    const wrap = el("div", "opts");
    for (const d of r.dirs) wrap.append(dirCard(d, d.id === r.selectedId));
    col.append(wrap);
    if (!running) col.append(steerRow((s) => void proposeDirections(s)));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeDirections();
    col.append(t);
  }
  view.append(col);
}

// One direction card = the house option-card atom + a 16:9 render slot and its stage-2 controls.
function dirCard(d, selected) {
  const card = el("div", "opt" + (selected ? " sel" : ""));
  card.onclick = (e) => { if (e.target.closest("button, a")) return; state.run.selectedId = d.id; render(); };
  card.append(el("div", "check", "✓"));
  if (d.recommended) card.append(el("div", "rec", "recommended"));
  card.append(el("div", "o-label", d.label));
  if (d.text) card.append(el("div", "o-text", d.text));

  const slot = el("div", "dir-render");
  const frame = el("div", "dir-frame");
  if (d.imageUrl) {
    const img = el("img"); img.src = d.imageUrl; img.alt = d.label; img.loading = "lazy";
    img.addEventListener("error", () => { d.imageUrl = null; d.imgError = "the render link expired — restyle again"; render(); });
    frame.append(img);
  } else if (d.imgStatus) {
    frame.append(el("div", "scanline"));
    frame.append(el("div", "placeholder", d.imgStatus));
  } else {
    frame.append(el("div", "placeholder", d.imgError ? "" : "not rendered yet — hit restyle to repaint it on your Higgsfield"));
  }
  slot.append(frame);

  const rowc = el("div", "dir-row");
  const btn = el("button", "dir-btn" + (d.imageUrl ? " ghost" : ""), d.imgStatus ? "repainting…" : d.imageUrl ? "↻ restyle again" : "Restyle this room");
  btn.disabled = painting;
  btn.onclick = () => void restyle(d.id);
  rowc.append(btn);
  if (d.imgError) { const s = el("span", "dir-stat bad", d.imgError); rowc.append(s); }
  if (d.imageUrl) { const a = el("a", "dir-dl", "⬇ download"); a.href = d.imageUrl; a.target = "_blank"; a.rel = "noopener"; rowc.append(a); }
  slot.append(rowc);
  card.append(slot);
  return card;
}

// Labeled sample cards (pre-connect / start screen) — the option-card look, no live render slot.
function sampleCards() {
  const wrap = el("div", "opts");
  for (const s of SAMPLE_DIRS) {
    const card = el("div", "opt");
    if (s.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", s.label));
    card.append(el("div", "o-text", s.text));
    wrap.append(card);
  }
  return wrap;
}
render();
