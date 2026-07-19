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
  id: "meme",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Meme",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Meme — caption on-trend memes for your topic (or your lent brand) on your own Claude; nothing leaves your machine",
    models: ["sonnet"],
    tools: [],                                  // pure text — captions are written, memes are drawn locally in SVG
    // contextKinds omitted: single lent context is read via context.active()
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
// Everything below is THIS wrapp — Meme. ONE line (your topic, or zero from a lent brand) → stage 1
// writes 3 meme CONCEPTS as option cards (a known format + the exact captions, one recommended,
// auto-selected). Stage 2 is fully DETERMINISTIC and offline: the selected concept is DRAWN as a
// clean SVG meme card (impact captions in the format's slots) — no image model, no upload, no wait.
// Picking a different card re-draws instantly; steering ("spicier"/"cleaner") re-writes the concepts.

const STEER_CHIPS = ["spicier", "cleaner", "different format", "more relatable"];
let running = false;

// The meme formats we can both WRITE for and DRAW. The model must pick one of these names; `slots`
// fixes how many captions come back, and `hint` tells the model what each caption slot means so the
// joke lands in the right place of the scene. Anything unrecognized falls back to Classic top/bottom.
const FORMATS = [
  { name: "Drake", slots: 2, hint: '2 captions: [0] = the thing being REJECTED (Drake\'s hand up, disgusted), [1] = the pettier/funnier thing PREFERRED (Drake approving). [1] should be the absurd upgrade over [0].' },
  { name: "Distracted Boyfriend", slots: 3, hint: '3 SHORT labels (2-4 words each): [0] = the person/subject being tempted, [1] = what they SHOULD stay loyal to (the girlfriend, ignored), [2] = the shiny new temptation they turn to chase (the other woman).' },
  { name: "Two Buttons", slots: 2, hint: '2 button labels — a sweaty, impossible either/or where BOTH options are tempting or both damning.' },
  { name: "Expanding Brain", slots: 4, hint: '4 escalating captions — each a more galaxy-brained, absurdly "enlightened" take than the last.' },
  { name: "Change My Mind", slots: 1, hint: '1 spicy hot-take written on the sign — a bold, debatable opinion stated flatly as fact.' },
  { name: "This Is Fine", slots: 1, hint: '1 caption naming the slow-motion disaster that everyone is calmly pretending is fine.' },
  { name: "Classic", slots: 2, hint: '2 captions: [0] = top setup, [1] = bottom punchline.' },
];
const fmtOf = (name) => FORMATS.find((f) => f.name.toLowerCase() === String(name || "").toLowerCase()) || FORMATS.find((f) => f.name === "Classic");
const fmtLabel = (name) => (name === "Classic" ? "Classic top/bottom" : name);

function autostart() {
  // THE COLD OPEN — connect a brand and memes are ALREADY being written about its niche, zero input.
  // The value (a drawn meme) is on screen before the user types a character. Fire only with a lent
  // context, never re-fire over a saved run.
  if (state.run) return;
  if (brand) {
    const bits = [brand.name, brand.data?.positioning || brand.data?.voice || ""].filter(Boolean).join(" — ");
    void start("memes about " + (bits || brand.name));
  }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it a topic first.", true); return; }
  state.run = { id: uid(), input, concepts: null, selectedId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeConcepts();
}

// STAGE 1 — one askJsonArray call → 3 meme concepts as option cards, exactly one recommended.
async function proposeConcepts(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "cooking up memes…"; render();
  try {
    const menu = FORMATS.map((f) => `- "${f.name}" (${f.slots} caption${f.slots > 1 ? "s" : ""}): ${f.hint}`).join("\n");
    const arr = await askJsonArray([
      `You are ${APP.name}, a shitposter with taste — you write memes that are genuinely funny and on-trend, never corny "how do you do fellow kids" filler.`,
      `The topic / angle to meme: "${r.input}".`,
      brand ? `Active brand context — the memes are about THIS brand's world; pull specifics (products, audience, voice, pet peeves) from it and match its vibe:\n${JSON.stringify(brand.data).slice(0, 1800)}` : "",
      r.steers.length ? `Apply this steering to the humor (latest wins): ${r.steers.map((s) => `"${s}"`).join(" → ")}. "spicier" = bolder, edgier, more chaotic; "cleaner" = safe-for-work, wholesome, no punching down.` : "",
      "Pick from EXACTLY these meme formats (use the name verbatim) and honor each format's caption slots:",
      menu,
      "Rules: captions are SHORT and punchy (a few words each, meme-length — never a paragraph). Vary the formats across the 3 concepts. Make the jokes land for THIS specific topic, not generic.",
      'Return ONLY a JSON array of exactly 3 objects — no prose, no fences. Each: {"format":<one format name from the menu>,"captions":[<one string per slot, in slot order>],"recommended":<true for exactly ONE, the funniest>}',
    ]);
    if (!arr || !arr.length) throw new Error("no memes came back — hit try again");
    r.concepts = arr.slice(0, 4).map((o) => {
      const f = fmtOf(o.format);
      let caps = Array.isArray(o.captions) ? o.captions.map((c) => String(c == null ? "" : c).slice(0, 90)) : [];
      caps = caps.slice(0, f.slots);
      while (caps.length < f.slots) caps.push("");
      return { id: uid(), format: f.name, captions: caps, recommended: !!o.recommended };
    });
    if (!r.concepts.some((c) => c.recommended)) r.concepts[0].recommended = true;
    r.selectedId = (r.concepts.find((c) => c.recommended) || r.concepts[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// STAGE 2 — pick a concept. No model call: the render() below DRAWS it. Just record + repaint.
function pickConcept(id) {
  const r = state.run; if (!r) return;
  r.selectedId = id; void saveState(); render();
}

// ==== the meme drawer — deterministic SVG scenes, self-contained hex (downloadable, theme-proof) ==
const SC = { page: "#070809", panel: "#12151C", inset: "#0B0E14", raised: "#1A1F29", edge: "#2A3140", accent: "#FF5CA8", accentSoft: "#3A1526", ink: "#E8EDF4" };
const escX = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function wrapLines(str, max) {
  const words = String(str || "").trim().split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ["…"];
}
// classic Impact caption: uppercase, white fill, thick dark outline, centered + vertically balanced.
function impact(cx, cy, str, size, maxChars) {
  const lines = wrapLines(str, maxChars);
  const lh = size * 1.04;
  const startY = cy - (lines.length * lh) / 2 + size * 0.8;
  const tspans = lines.map((ln, i) => `<tspan x="${cx}" y="${(startY + i * lh).toFixed(1)}">${escX(ln.toUpperCase())}</tspan>`).join("");
  return `<text text-anchor="middle" font-family="Impact,'Hanken Grotesk',Arial,sans-serif" font-weight="800" font-size="${size}" fill="#fff" stroke="#0a0a0a" stroke-width="${Math.max(2, size * 0.11).toFixed(1)}" paint-order="stroke" style="letter-spacing:.4px">${tspans}</text>`;
}
function emoji(cx, cy, glyph, size) {
  return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${size}" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${escX(glyph)}</text>`;
}
function svgWrap(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${SC.inset}"/>${body}</svg>`;
}

function sceneDrake(c) {
  const [a, b] = c.captions;
  return svgWrap(600, 460,
    `<rect x="0" y="0" width="300" height="230" fill="${SC.raised}"/>` +
    `<rect x="0" y="230" width="300" height="230" fill="${SC.accentSoft}"/>` +
    `<rect x="300" y="0" width="300" height="230" fill="${SC.panel}"/>` +
    `<rect x="300" y="230" width="300" height="230" fill="${SC.inset}"/>` +
    `<line x1="0" y1="230" x2="600" y2="230" stroke="${SC.edge}" stroke-width="2"/>` +
    `<line x1="300" y1="0" x2="300" y2="460" stroke="${SC.edge}" stroke-width="2"/>` +
    emoji(150, 158, "🙅", 110) +
    emoji(150, 390, "👉", 110) +
    impact(450, 115, a, 30, 15) +
    impact(450, 345, b, 30, 15));
}
function sceneBoyfriend(c) {
  const [subject, loyal, temptation] = c.captions;
  const col = (x, glyph, label) =>
    emoji(x, 175, glyph, 96) +
    `<line x1="${x}" y1="205" x2="${x}" y2="235" stroke="${SC.edge}" stroke-width="2"/>` +
    impact(x, 300, label, 22, 12);
  return svgWrap(600, 400,
    col(115, "😍", temptation) +
    col(300, "🚶", subject) +
    col(485, "😠", loyal) +
    `<text x="300" y="385" text-anchor="middle" font-family="'Spline Sans Mono',monospace" font-size="13" fill="${SC.accent}" letter-spacing="2">CHASING → ${escX((temptation || "").toUpperCase()).slice(0, 22)}</text>`);
}
function sceneTwoButtons(c) {
  const [a, b] = c.captions;
  return svgWrap(600, 470,
    `<rect x="44" y="40" width="238" height="150" rx="16" fill="${SC.accent}"/>` +
    `<rect x="318" y="40" width="238" height="150" rx="16" fill="#E23F86"/>` +
    impact(163, 118, a, 22, 13) +
    impact(437, 118, b, 22, 13) +
    emoji(300, 400, "😰", 150) +
    emoji(205, 320, "👉", 64) +
    emoji(395, 320, "👈", 64));
}
function sceneBrain(c) {
  const caps = c.captions.filter((x) => x != null);
  const n = Math.max(1, caps.length);
  const rowH = 132, h = 24 + n * rowH;
  let body = "";
  for (let i = 0; i < n; i++) {
    const y = 12 + i * rowH;
    const glow = 0.12 + (i / Math.max(1, n - 1 || 1)) * 0.6;
    body +=
      `<rect x="0" y="${y}" width="600" height="${rowH}" fill="${i % 2 ? SC.panel : SC.inset}"/>` +
      `<line x1="230" y1="${y}" x2="230" y2="${y + rowH}" stroke="${SC.edge}" stroke-width="2"/>` +
      (i ? `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="${SC.edge}" stroke-width="2"/>` : "") +
      `<circle cx="115" cy="${y + rowH / 2}" r="${34 + i * 10}" fill="${SC.accent}" opacity="${glow.toFixed(2)}"/>` +
      emoji(115, y + rowH / 2 + 22, "🧠", 52 + i * 12) +
      impact(415, y + rowH / 2, caps[i], 22, 18);
  }
  return svgWrap(600, h, body);
}
function sceneChangeMyMind(c) {
  const [take] = c.captions;
  return svgWrap(600, 400,
    `<rect x="0" y="300" width="600" height="100" fill="${SC.panel}"/>` +
    `<rect x="150" y="150" width="410" height="150" rx="8" fill="#F4F4F0" stroke="${SC.edge}" stroke-width="3"/>` +
    (() => {
      const lines = wrapLines(take, 24);
      const size = 26, lh = size * 1.15, startY = 225 - (lines.length * lh) / 2 + size * 0.8;
      return `<text text-anchor="middle" font-family="'Hanken Grotesk',Arial,sans-serif" font-weight="700" font-size="${size}" fill="#141414">${lines.map((ln, i) => `<tspan x="355" y="${(startY + i * lh).toFixed(1)}">${escX(ln)}</tspan>`).join("")}</text>`;
    })() +
    `<rect x="330" y="300" width="14" height="60" fill="${SC.raised}"/>` +
    emoji(78, 300, "🧔", 96) +
    emoji(150, 330, "☕", 40));
}
function sceneThisIsFine(c) {
  const [cap] = c.captions;
  let fires = "";
  for (const x of [60, 175, 300, 425, 540]) fires += emoji(x, 90, "🔥", 60);
  for (const y of [170, 250]) { fires += emoji(45, y, "🔥", 52) + emoji(555, y, "🔥", 52); }
  return svgWrap(600, 420,
    `<rect x="0" y="0" width="600" height="420" fill="#1c0f0a"/>` +
    fires +
    emoji(300, 250, "🐶", 120) +
    `<rect x="150" y="285" width="300" height="34" rx="6" fill="#0a0a0a" opacity=".35"/>` +
    impact(300, 380, cap, 30, 22));
}
function sceneClassic(c) {
  const [top, bottom] = c.captions;
  return svgWrap(600, 470,
    `<radialGradient id="g" cx="50%" cy="52%" r="60%"><stop offset="0%" stop-color="${SC.raised}"/><stop offset="100%" stop-color="${SC.inset}"/></radialGradient>` +
    `<rect width="600" height="470" fill="url(#g)"/>` +
    emoji(300, 305, "🗿", 190) +
    impact(300, 66, top, 36, 18) +
    impact(300, 420, bottom, 36, 18));
}
const SCENES = {
  "Drake": sceneDrake, "Distracted Boyfriend": sceneBoyfriend, "Two Buttons": sceneTwoButtons,
  "Expanding Brain": sceneBrain, "Change My Mind": sceneChangeMyMind, "This Is Fine": sceneThisIsFine, "Classic": sceneClassic,
};
function sceneSvg(c) { return (SCENES[c.format] || sceneClassic)(c); }

function downloadMeme(c) {
  try {
    const blob = new Blob([sceneSvg(c)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = el("a"); a.href = url; a.download = c.format.replace(/\s+/g, "-").toLowerCase() + "-meme.svg";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast("Couldn't save the meme — " + msg(e), true); }
}

function memeCard(c) {
  const wrap = el("div", "meme");
  wrap.append(el("div", "meme-fmt", fmtLabel(c.format) + " meme"));
  const art = el("div", "meme-art");
  art.innerHTML = sceneSvg(c); // trusted: our own SVG, every caption run through escX()
  wrap.append(art);
  const acts = el("div", "meme-acts");
  const dl = el("button", "act", "↓ download .svg"); dl.onclick = () => downloadMeme(c);
  const re = el("button", "act", "↻ fresh batch"); re.disabled = running; re.onclick = () => void proposeConcepts();
  acts.append(dl, re);
  wrap.append(acts);
  return wrap;
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
    if (brand) startBox.append(el("div", "ctx", "ready to meme your lent context — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — the topic or brand angle to meme";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Meme it"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "topic"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.concepts) {
    col.append(el("div", "kicker sect", "the concepts"));
    col.append(optionCards(
      r.concepts.map((c) => ({
        id: c.id, label: fmtLabel(c.format),
        text: c.captions.filter(Boolean).join("  •  ") || "(no captions)",
        recommended: c.recommended,
      })),
      r.selectedId,
      (o) => pickConcept(o.id),
    ));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeConcepts();
    col.append(t);
  }
  const sel = r.concepts && r.concepts.find((c) => c.id === r.selectedId);
  if (sel && !r.status) {
    col.append(el("div", "kicker sect", "the meme"));
    col.append(memeCard(sel));
    if (!running) col.append(steerRow((s) => void proposeConcepts(s)));
  }
  view.append(col);
}
render();
