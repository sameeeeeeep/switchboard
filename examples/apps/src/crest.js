// CREST — a brief in, a logo out. A focused subset of brandbrain: describe a brand in one line and
// Crest runs ONE auto-advancing pipeline on the visitor's OWN Claude + Higgsfield —
//   1) FOUNDATION   name · positioning · 3-word personality · voice · palette · logo rationale
//   2) DIRECTIONS   3 distinct logo directions, exactly one recommended (option cards)
//   3) STYLE        an instant gallery of visual styles (3D isometric, flat, monoline, pixel…),
//                   each with a hand-drawn inline-SVG cue so the look is chosen UP FRONT, no waiting
//   4) FOUR MARKS   4 concrete options in the chosen direction + style; each = a live inline-SVG
//                   WIREFRAME (Claude-streamed, sanitized) PLUS a real image rendered on the user's
//                   Higgsfield — then a full decide/steer layer so nothing is final until they say so.
//
// The operator holds no key, pays for no inference, and never sees the user's data — Switchboard
// brokers everything. This file is TEMPLATE PLUMBING + the app: everything between here and the
// "APP LOGIC" line is proven idiom (distilled from regex.js / imagegen.js) — kept byte-identical.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED stays visually distinct from CHOSEN
// so the accent never paints a machine decision (doctrine 5), and any slate gets an escape hatch.
import { optionCards } from "./kit/ui.js";
// God's hands: expose Crest's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen. And a
// notch GLANCE via exposeWidget: the recommended logo direction, declared as data.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "crest",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Crest",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Crest — turns a one-line brand brief into a logo foundation, directions, and four marks on your own Claude + Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // image gen for the four rendered marks
  },
  usesContext: null,                            // works from a single brief; no lent context required
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
// CREST — brief → foundation → directions → STYLE PICKER → four marks (SVG wireframe + Higgsfield
// image) → decide/steer. Foundation + directions auto-advance; the style is chosen up front (instant
// gallery, no image gen); the four marks then render; every mark can be kept, regenerated, cloned,
// re-styled, or steered — nothing is final until the founder says so.

const STEER_CHIPS = ["cleaner", "bolder", "more playful", "more premium"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = "Northwind — a small-batch coffee roaster for early-morning commuters who want a calmer, more deliberate start to the day. Warm, honest, unfussy.";

// The instant style gallery. Each style ships a hand-drawn inline-SVG cue (fixed, legible colors —
// these illustrate the STYLE, not the brand) plus two prompt fragments: `svgHint` steers the
// wireframe, `img` is folded into every Higgsfield prompt. NO image gen here — the picker is snappy.
const STYLES = [
  { id: "iso3d",     label: "3D isometric",   svgHint: "isometric parallelograms, layered faces, a sense of depth", img: "as a 3D isometric logo icon, soft studio lighting, subtle drop shadow, clean render" },
  { id: "flat",      label: "Flat / plain",   svgHint: "flat solid fills, no gradients, no shadows", img: "as a flat 2D vector logo, solid color fills, no gradients, no shadows" },
  { id: "monoline",  label: "Monoline",       svgHint: "a single uniform stroke width, fill:none, open line work", img: "as a single-weight monoline logo, thin uniform strokes, no fills, elegant" },
  { id: "mono",      label: "Monochrome",     svgHint: "one hue only, tints via opacity, no second color", img: "as a monochrome one-color logo on a plain background" },
  { id: "illus2d",   label: "2D illustrative", svgHint: "a friendly hand-drawn character mark with simple features", img: "as a 2D illustrative logo, friendly hand-drawn character mark, flat colors" },
  { id: "pixel",     label: "Pixel art",      svgHint: "blocky pixel grid, 8-bit squares, no curves", img: "as a pixel-art logo, 8-bit blocky mark, limited retro palette" },
  { id: "gradient",  label: "Gradient",       svgHint: "a smooth linear gradient fill between two palette colors", img: "as a smooth gradient logo, vibrant modern color blend" },
  { id: "bold",      label: "Solid / bold",   svgHint: "heavy weighty shapes, thick forms, high contrast", img: "as a bold solid logo, heavy geometric shapes, high contrast, confident" },
  { id: "emblem",    label: "Emblem / badge", svgHint: "a circular emblem: the mark enclosed in a ring with the name curved around", img: "as a circular emblem badge logo, enclosed crest with the name on a ring" },
  { id: "geometric", label: "Geometric",      svgHint: "built from precise circles, triangles and lines on a grid", img: "as a precise geometric logo built from circles, triangles and lines" },
  { id: "negative",  label: "Negative space", svgHint: "a clever hidden shape carved from the counterform", img: "as a clever negative-space logo, a hidden shape in the counterform" },
  { id: "retro",     label: "Retro",          svgHint: "warm vintage forms, groovy rounded arcs, 70s feel", img: "as a retro 1970s-style logo, warm vintage palette, rounded groovy forms" },
];
const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[1];

// Instant SVG cue per style. c1/c2 are FIXED brand-neutral so every thumb is legible on the dark
// card regardless of the brand palette — they teach the LOOK, not the colors.
function styleThumb(id) {
  const c1 = "#C8F250", c2 = "#7DE0FF", bg = "#0A0C10";
  const g = "g" + uid();
  const map = {
    iso3d: `<svg viewBox="0 0 48 48"><polygon points="24,7 41,17 24,27 7,17" fill="${c1}"/><polygon points="7,17 24,27 24,43 7,33" fill="${c2}" opacity=".7"/><polygon points="41,17 24,27 24,43 41,33" fill="${c1}" opacity=".85"/></svg>`,
    flat: `<svg viewBox="0 0 48 48"><rect x="8" y="8" width="20" height="20" rx="4" fill="${c1}"/><circle cx="32" cy="32" r="10" fill="${c2}"/></svg>`,
    monoline: `<svg viewBox="0 0 48 48" fill="none" stroke="${c1}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="12"/><path d="M14 30 L24 14 L34 30"/></svg>`,
    mono: `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="14" fill="${c1}"/><circle cx="24" cy="24" r="7" fill="${c1}" opacity=".4"/></svg>`,
    illus2d: `<svg viewBox="0 0 48 48"><path d="M10 26c0-10 6-16 14-16s14 6 14 16-6 12-14 12-14-2-14-12z" fill="${c1}"/><circle cx="19" cy="24" r="2.5" fill="${bg}"/><circle cx="29" cy="24" r="2.5" fill="${bg}"/><path d="M19 31q5 4 10 0" stroke="${bg}" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
    pixel: `<svg viewBox="0 0 48 48"><g fill="${c1}"><rect x="12" y="12" width="8" height="8"/><rect x="20" y="12" width="8" height="8"/><rect x="28" y="20" width="8" height="8"/><rect x="12" y="28" width="8" height="8"/><rect x="20" y="28" width="8" height="8"/></g><rect x="28" y="12" width="8" height="8" fill="${c2}"/></svg>`,
    gradient: `<svg viewBox="0 0 48 48"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><circle cx="24" cy="24" r="15" fill="url(#${g})"/></svg>`,
    bold: `<svg viewBox="0 0 48 48"><path d="M10 35 L24 9 L38 35 Z" fill="${c1}"/><rect x="18" y="26" width="12" height="9" fill="${bg}"/></svg>`,
    emblem: `<svg viewBox="0 0 48 48" fill="none" stroke="${c1}" stroke-width="2.4"><circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="8"/></svg>`,
    geometric: `<svg viewBox="0 0 48 48"><circle cx="20" cy="24" r="11" fill="${c1}"/><polygon points="30,13 40,34 20,34" fill="${c2}" opacity=".8"/></svg>`,
    negative: `<svg viewBox="0 0 48 48"><rect x="9" y="9" width="30" height="30" rx="8" fill="${c1}"/><path d="M24 15a9 9 0 1 0 0 18 6 6 0 1 1 0-12 3 3 0 0 0 0-6z" fill="${bg}"/></svg>`,
    retro: `<svg viewBox="0 0 48 48"><g fill="none" stroke="${c1}" stroke-width="3" stroke-linecap="round"><path d="M8 31a16 16 0 0 1 32 0"/><path d="M14 31a10 10 0 0 1 20 0"/></g><circle cx="24" cy="31" r="3" fill="${c2}"/></svg>`,
  };
  return map[id] || map.flat;
}

// Instant, zero-token default: the recommended style, nudged by the brand's personality words.
function recommendStyle(f) {
  const words = ((f && f.personality) || []).join(" ").toLowerCase() + " " + String(f && f.positioning || "").toLowerCase();
  const has = (re) => re.test(words);
  if (has(/play|fun|friend|kid|whimsi|quirk/)) return "illus2d";
  if (has(/retro|vintage|nostalg|classic|heritage/)) return "retro";
  if (has(/tech|game|arcade|8-?bit|pixel|digital/)) return "pixel";
  if (has(/premium|luxur|elegan|refined|crafted|artisan/)) return "monoline";
  if (has(/bold|strong|power|confiden|energ/)) return "bold";
  if (has(/depth|dimension|spatial|3d|isometric/)) return "iso3d";
  if (has(/heritage|trust|establish|instituti|badge|club/)) return "emblem";
  if (has(/vibrant|modern|dynamic|gradient|fresh/)) return "gradient";
  return "flat";
}

let running = false;

function autostart() { if (state.run) return; }

// ---- start + the auto-advancing pipeline ---------------------------------------------------
async function start(brief) {
  if (!relay || running) return;
  brief = String(brief || "").trim();
  if (!brief) { toast("Describe your brand first — one line is enough.", true); return; }
  state.run = {
    id: uid(), brief,
    foundation: null, directions: null,
    chosenDirId: null,        // the direction the HUMAN clicked (accent); null until they do
    activeDirId: null,        // the direction the marks are FOR (recommended by default)
    styleId: null,            // the recommended style is seeded here as a highlighted default…
    styleChosen: false,       // …but accent only lands once the human clicks a style
    logos: null, kept: [], logoSteer: null,
    stage: "foundation", status: "", error: null,
  };
  await saveState(); render();
  await runPipeline();
}

function setStatus(t) { const r = state.run; if (r) r.status = t; const live = $("crest-live"); if (live) live.textContent = t; }

async function runPipeline() {
  const r = state.run; if (!r || !relay) return;
  running = true; r.error = null;
  try {
    // 1 — FOUNDATION
    r.stage = "foundation"; setStatus("reading the brief…"); render();
    const ftext = await streamText({ prompt: buildFoundationPrompt(r.brief), maxTokens: 900 },
      (p) => { if (p.text) setStatus("defining the foundation… " + (p.text.length / 1024).toFixed(1) + " kb"); });
    const f = coerceFoundation(parseJson(ftext));
    if (!f) throw new Error("The foundation came back malformed — hit ‘try again’.");
    r.foundation = f;
    await saveState(); render();

    // 2 — DIRECTIONS
    r.stage = "directions"; setStatus("sketching directions…"); render();
    const dtext = await streamText({ prompt: buildDirectionsPrompt(f), maxTokens: 1100 },
      (p) => { if (p.text) setStatus("sketching directions… " + (p.text.length / 1024).toFixed(1) + " kb"); });
    const dirs = coerceDirections(parseJson(dtext));
    if (!dirs) throw new Error("The directions came back malformed — hit ‘try again’.");
    r.directions = dirs;
    const rec = dirs.find((d) => d.recommended) || dirs[0];
    r.activeDirId = rec.id;          // marks will use the recommended direction; human can switch
    r.styleId = recommendStyle(f);   // seed a highlighted default style — NOT chosen yet
    r.stage = "style";               // 3 — STYLE PICKER: stop here; the human chooses the look
    r.status = "";
    await saveState(); render();
  } catch (e) {
    r.error = msg(e); r.status = "";
    await saveState(); render();
  } finally {
    running = false;
  }
}

// ---- foundation ----------------------------------------------------------------------------
function buildFoundationPrompt(brief) {
  return [
    "You are Crest, a brand designer. From the brief below, define a compact brand foundation to anchor a logo.",
    `BRIEF:\n"""${brief.slice(0, 4000)}"""`,
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"name":string (the brand name, cleaned up),"positioning":string (one line, <= 90 chars),"personality":[string,string,string] (exactly 3 single evocative words),"voice":string (a short phrase),"palette":[string] (3-4 hex colors like "#1A2B3C" that genuinely suit this brand),"rationale":string (one line on the logo direction this foundation implies)}',
  ].join("\n\n");
}
function coerceFoundation(f) {
  if (!f || typeof f !== "object") return null;
  const name = String(f.name || "").trim();
  if (!name) return null;
  const hex = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter((x) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x)).slice(0, 4);
  let pal = hex(f.palette); if (!pal.length) pal = ["#C8F250", "#12151C", "#E8EDF4"];
  let pers = (Array.isArray(f.personality) ? f.personality : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  if (!pers.length) pers = ["clear", "modern", "honest"];
  return {
    name,
    positioning: String(f.positioning || "").trim(),
    personality: pers,
    voice: String(f.voice || "").trim(),
    palette: pal,
    rationale: String(f.rationale || "").trim(),
  };
}

// ---- directions ----------------------------------------------------------------------------
function buildDirectionsPrompt(f) {
  return [
    "You are Crest. Propose 3 DISTINCT logo directions for this brand.",
    `BRAND: ${f.name}`,
    f.positioning ? `POSITIONING: ${f.positioning}` : "",
    `PERSONALITY: ${f.personality.join(", ")}`,
    f.voice ? `VOICE: ${f.voice}` : "",
    `PALETTE: ${f.palette.join(", ")}`,
    "Each direction must take a genuinely different formal approach — e.g. wordmark, monogram, symbol + wordmark, abstract mark.",
    "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:",
    '{"directions":[exactly 3 items, each {"name":string (2-4 words),"approach":string (the mark type + form, one short line),"rationale":string (why it fits this brand, one line),"recommended":boolean}]}',
    'Exactly ONE direction must have "recommended": true.',
  ].filter(Boolean).join("\n\n");
}
function coerceDirections(o) {
  const arr = o && Array.isArray(o.directions) ? o.directions : (Array.isArray(o) ? o : []);
  const list = arr.map((d) => {
    if (!d || typeof d !== "object") return null;
    const name = String(d.name || "").trim();
    if (!name) return null;
    return { id: uid(), name, approach: String(d.approach || "").trim(), rationale: String(d.rationale || "").trim(), recommended: !!d.recommended };
  }).filter(Boolean).slice(0, 3);
  if (list.length < 2) return null;
  const rec = list.findIndex((d) => d.recommended);
  list.forEach((d, i) => { d.recommended = i === (rec === -1 ? 0 : rec); });
  return list;
}

// ---- four marks (SVG wireframe + Higgsfield image) ------------------------------------------
function buildLogosPrompt(f, dir, style, opts = {}) {
  const count = opts.count || 4;
  const one = count === 1;
  return [
    `You are Crest, designing ${one ? "a concrete logo option" : "concrete logo options"} for this brand along ONE chosen direction and ONE chosen visual style.`,
    `BRAND: ${f.name}`,
    f.positioning ? `POSITIONING: ${f.positioning}` : "",
    `PERSONALITY: ${f.personality.join(", ")}`,
    `PALETTE (use ONLY these hex values): ${f.palette.join(", ")}`,
    `DIRECTION: ${dir.name} — ${dir.approach}. ${dir.rationale}`,
    `VISUAL STYLE: ${style.label} — ${style.svgHint}. Every mark — the SVG AND the imagePrompt — MUST clearly read as this style.`,
    opts.moreLike ? `Make them variations in the spirit of this concept: ${opts.moreLike}.` : "",
    opts.steer ? `Apply this steer from the user: "${opts.steer}".` : "",
    opts.avoid && opts.avoid.length ? `Make them clearly different from these existing options: ${opts.avoid.join(", ")}.` : "",
    `Produce EXACTLY ${count} distinct logo option${one ? "" : "s"}. For EACH, hand-build a clean, self-contained inline SVG logo concept (the mark AND the wordmark "${f.name}") from the brand palette, rendered in the ${style.label} style.`,
    'SVG RULES: a single <svg> element with viewBox="0 0 400 200" and NO width/height attributes; NO <script>, <foreignObject>, <image> or external references; use only <rect> <circle> <ellipse> <path> <polygon> <line> <g> <text> <defs> <linearGradient> <stop>; put the wordmark in a <text> element (font-family="Georgia, serif" or "Arial, sans-serif", font-weight="700"); keep each SVG under ~1600 characters.',
    `Also give each an "imagePrompt": a vivid text-to-image prompt to render the SAME mark as a real logo ${style.img}, on a clean plain background, centered, minimal, no mockup, no photograph — the only text is the brand name.`,
    "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:",
    `{"logos":[exactly ${count} item${one ? "" : "s"}, each {"label":string (2-3 words),"concept":string (one short line),"svg":string (the inline SVG markup),"imagePrompt":string}]}`,
  ].filter(Boolean).join("\n\n");
}
function coerceLogo(lo) {
  if (!lo || typeof lo !== "object") return null;
  const svgRaw = sanitizeSvg(String(lo.svg || ""));
  return {
    id: uid(),
    label: String(lo.label || "").trim() || "Option",
    concept: String(lo.concept || "").trim(),
    svg: /<svg[\s\S]*<\/svg>/i.test(svgRaw) ? svgRaw : "",
    imagePrompt: String(lo.imagePrompt || "").trim(),
    imageUrl: null, imgStatus: "queued", imgError: null, kept: false,
  };
}
function coerceLogos(o) {
  const arr = o && Array.isArray(o.logos) ? o.logos : (Array.isArray(o) ? o : []);
  const list = arr.map(coerceLogo).filter(Boolean).slice(0, 4);
  return list.length ? list : null;
}

// Aspect 1:1 render on the visitor's Higgsfield — the imagegen.js idiom, logo-tuned.
const LOGO_IMG_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
async function genLogoImage(promptText) {
  const instruction = `Use the Higgsfield generate_image tool to generate an image of: "${promptText}", aspect_ratio "1:1". Wait for it to finish (poll the job status if needed), then reply with ONLY the final image URL on its own line.`;
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const t = (d.result.content ?? []).map((x) => x.text ?? "").join(""); const m = t.match(LOGO_IMG_RE); if (m) url = m[1] || m[2] || m[0]; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  if (!url) { const m = acc.match(LOGO_IMG_RE); if (m) url = m[1] || m[2] || m[0]; }
  return url;
}

// Stream the 4 marks' SVG + prompts for the chosen direction + style, then render their images in
// parallel. Called on style pick, "generate 4 more", "more like this", and free-text steer.
async function runLogos(opts = {}) {
  const r = state.run; if (!r || !relay || !r.foundation || running) return;
  const dir = (r.directions || []).find((d) => d.id === r.activeDirId) || (r.directions || [])[0];
  const style = styleById(r.styleId);
  if (!dir || !style) return;
  running = true; r.error = null; r.stage = "logos"; r.logos = null;
  setStatus(`sketching four ${style.label.toLowerCase()} marks…`); render();
  try {
    const text = await streamText({ prompt: buildLogosPrompt(r.foundation, dir, style, opts), maxTokens: 6000 },
      (p) => { if (p.text) setStatus(`sketching four marks… ${(p.text.length / 1024).toFixed(1)} kb`); });
    const logos = coerceLogos(parseJson(text));
    if (!logos) throw new Error("The marks came back malformed — try ‘generate 4 more’.");
    r.logos = logos; r.status = "";
    await saveState(); render();
  } catch (e) {
    r.error = msg(e); r.status = "";
    await saveState(); render();
  } finally {
    running = false;
    render();
    // WIREFRAME-FIRST: do NOT auto-spend Higgsfield renders. The four SVG wireframes show instantly
    // (free); the user renders an image only for the marks they like (per-tile "✦ Render image"),
    // conserving image credits.
  }
}

async function renderLogoImages() {
  const r = state.run; if (!r || !r.logos) return;
  const style = styleById(r.styleId);
  await Promise.all(r.logos.map(async (lo) => {
    if (lo.imageUrl) return;
    lo.imgStatus = "rendering"; paintTileImg(lo);
    try {
      const prompt = (lo.imagePrompt || `${r.foundation.name} logo`) + `, ${style.img}`;
      const url = await genLogoImage(prompt);
      if (!url) throw new Error("no image came back");
      lo.imageUrl = url; lo.imgStatus = "done"; lo.imgError = null;
    } catch (e) { lo.imgStatus = "error"; lo.imgError = msg(e); }
    await saveState(); paintTileImg(lo);
  }));
}

// Re-render ONE mark's image only (the ↻ per-tile control).
async function reRenderOne(lo) {
  const r = state.run; if (!r || !relay || !lo) return;
  const style = styleById(r.styleId);
  lo.imageUrl = null; lo.imgStatus = "rendering"; lo.imgError = null; paintTileImg(lo);
  try {
    const url = await genLogoImage((lo.imagePrompt || `${r.foundation.name} logo`) + `, ${style.img}`);
    if (!url) throw new Error("no image came back");
    lo.imageUrl = url; lo.imgStatus = "done";
  } catch (e) { lo.imgStatus = "error"; lo.imgError = msg(e); }
  await saveState(); paintTileImg(lo);
}

// Regenerate ONE mark completely (new SVG + prompt + image) — the "regenerate this one" control.
async function regenerateOne(lo) {
  const r = state.run; if (!r || !relay || !r.foundation || running) return;
  const dir = (r.directions || []).find((d) => d.id === r.activeDirId) || (r.directions || [])[0];
  const style = styleById(r.styleId);
  if (!dir || !style) return;
  running = true; render();
  lo.svg = ""; lo.concept = ""; lo.imageUrl = null; lo.imgStatus = "queued"; lo.imgError = null;
  paintTileSketch(lo); paintTileImg(lo);
  try {
    const avoid = r.logos.filter((x) => x !== lo).map((x) => x.label);
    const text = await streamText({ prompt: buildLogosPrompt(r.foundation, dir, style, { count: 1, avoid }), maxTokens: 2200 });
    const fresh = (coerceLogos(parseJson(text)) || [])[0];
    if (!fresh) throw new Error("couldn't re-sketch that one");
    lo.label = fresh.label; lo.concept = fresh.concept; lo.svg = fresh.svg; lo.imagePrompt = fresh.imagePrompt;
    await saveState(); render();
  } catch (e) {
    toast(msg(e), true);
  } finally {
    running = false; render();
    // wireframe-first: a fresh wireframe only — the user opts into the image render per tile.
  }
}

// ---- keep shelf ----------------------------------------------------------------------------
function toggleKeep(lo) {
  const r = state.run; if (!r) return;
  r.kept = r.kept || [];
  const at = r.kept.findIndex((k) => k.srcId === lo.id);
  if (at >= 0) { r.kept.splice(at, 1); lo.kept = false; }
  else { r.kept.unshift({ srcId: lo.id, label: lo.label, svg: lo.svg, imageUrl: lo.imageUrl }); lo.kept = true; }
  if (r.kept.length > 12) r.kept.length = 12;
  void saveState(); render();
}
function dropKept(k) {
  const r = state.run; if (!r) return;
  r.kept = (r.kept || []).filter((x) => x !== k);
  const lo = (r.logos || []).find((l) => l.id === k.srcId); if (lo) lo.kept = false;
  void saveState(); render();
}

// ---- render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample brief (connect to make your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) { view.append(startBox()); return; }

  const col = el("div", "run");
  // runbar
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "brief"), el("span", "run-input", r.brief), el("span", "grow"));
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => { if (!r.foundation) return void runPipeline(); if (!r.logos) return void runLogos(); void runLogos({ steer: "try a different take" }); };
    col.append(t);
  }

  // 1 — FOUNDATION
  if (r.foundation) col.append(foundationCard(r.foundation));
  else if (r.stage === "foundation") { const b = liveSection("Foundation"); b.append(researching(r.status || "reading the brief…")); col.append(b); }

  // 2 — DIRECTIONS
  if (r.directions) {
    const sec = el("div", "sect-block");
    sec.append(el("div", "kicker sect", "directions — pick one, or keep the recommended"));
    sec.append(optionCards(
      r.directions.map((d) => ({ id: d.id, label: d.name, text: (d.approach ? d.approach : "") + (d.rationale ? "\n" + d.rationale : ""), recommended: d.recommended })),
      r.chosenDirId,
      (opt) => chooseDirection(opt.id),
    ));
    col.append(sec);
  } else if (r.stage === "directions") { const b = liveSection("Directions"); b.append(researching(r.status || "sketching directions…")); col.append(b); }

  // 3 — STYLE PICKER (instant) — visible from the style stage onward
  if (r.foundation && r.directions && (r.stage === "style" || r.stage === "logos")) col.append(styleGallery());

  // 4 — FOUR MARKS + decide/steer
  if (r.logos) col.append(marksBlock());
  else if (r.stage === "logos") { const b = liveSection("Four marks"); b.append(researching(r.status || "sketching four marks…")); col.append(b); }

  // kept shelf
  if (r.kept && r.kept.length) col.append(keptShelf());

  view.append(col);
}

function liveSection(title) {
  const b = el("div", "sect-block");
  b.append(el("div", "kicker sect", title));
  const live = el("div", "livewrap"); live.id = "crest-live-wrap";
  b.append(live);
  // stash the live status text node so setStatus can update it mid-stream
  setTimeout(() => { const w = $("crest-live-wrap"); if (w) { const s = w.querySelector(".researching span"); if (s) s.id = "crest-live"; } }, 0);
  return b;
}

function startBox() {
  const startBox = el("div", "start");
  const row = el("div", "bindrow");
  const input = el("textarea");
  input.rows = 8;
  input.placeholder = "Paste your full brief, or describe your brand — name, what it does, who it's for, the qualities it should feel, and anything to avoid. The more detail, the better Crest can extract your preferences.";
  const go = () => { if (input.value.trim()) void start(input.value); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
  const btn = el("button", "primary", "Make the logo ✦"); btn.onclick = go;
  row.append(input, btn);
  startBox.append(row);
  startBox.append(el("div", "hint", "⌘/Ctrl + Enter · foundation → directions → style → four marks"));
  setTimeout(() => input.focus(), 30);
  return startBox;
}

function foundationCard(f) {
  const card = el("div", "found");
  const top = el("div", "found-top");
  top.append(el("div", "found-name", f.name));
  const sw = el("div", "sw-row");
  for (const c of f.palette) { const s = el("span", "sw"); s.style.background = c; s.title = c; sw.append(s); }
  top.append(sw);
  card.append(top);
  if (f.positioning) card.append(el("div", "found-pos", f.positioning));
  const meta = el("div", "found-meta");
  const pers = el("div", "fm"); pers.append(el("span", "fm-k", "personality"), el("span", "fm-v", f.personality.join(" · "))); meta.append(pers);
  if (f.voice) { const v = el("div", "fm"); v.append(el("span", "fm-k", "voice"), el("span", "fm-v", f.voice)); meta.append(v); }
  card.append(meta);
  if (f.rationale) card.append(el("div", "found-rat", f.rationale));
  return card;
}

function chooseDirection(id) {
  const r = state.run; if (!r || running) return;
  r.chosenDirId = id; r.activeDirId = id;
  if (r.styleChosen) { r.logos = null; void saveState(); void runLogos(); }
  else { void saveState(); render(); }
}

function styleGallery() {
  const r = state.run;
  const sec = el("div", "sect-block");
  sec.append(el("div", "kicker sect", r.styleChosen ? "style — switch the look any time" : "style — pick the look (instant)"));
  const grid = el("div", "stylegrid");
  const recId = r.styleId; // seeded recommendation (highlighted as a draft until chosen)
  for (const st of STYLES) {
    const chosen = r.styleChosen && r.styleId === st.id;
    const drafted = !r.styleChosen && recId === st.id;
    const card = el("div", "stylecard" + (chosen ? " sel" : "") + (drafted ? " draft" : ""));
    const thumb = el("div", "stylethumb"); thumb.innerHTML = sanitizeSvg(styleThumb(st.id));
    card.append(thumb);
    card.append(el("div", "stylelabel", st.label));
    if (drafted) card.append(el("div", "styletag", "recommended"));
    if (chosen) card.append(el("div", "styletag on", "chosen"));
    card.onclick = () => chooseStyle(st.id);
    grid.append(card);
  }
  sec.append(grid);
  // optional preference note (line / solid / gradient / background)
  const prefWrap = el("div", "prefrow");
  const pin = el("input"); pin.type = "text"; pin.className = "prefin";
  pin.placeholder = "optional — line / solid / gradient / background notes…";
  pin.value = r.stylePref || "";
  pin.addEventListener("input", () => { r.stylePref = pin.value; });
  prefWrap.append(el("span", "kicker", "prefs"), pin);
  sec.append(prefWrap);
  return sec;
}

function chooseStyle(id) {
  const r = state.run; if (!r || running) return;
  r.styleId = id; r.styleChosen = true;
  const steer = r.stylePref && r.stylePref.trim() ? { steer: r.stylePref.trim() } : {};
  void saveState();
  void runLogos(steer);
}

// ---- the four marks + decide/steer ---------------------------------------------------------
function marksBlock() {
  const r = state.run;
  const sec = el("div", "sect-block");
  const style = styleById(r.styleId);
  sec.append(el("div", "kicker sect", `four ${style.label.toLowerCase()} marks — keep what's good, change what isn't`));
  const grid = el("div", "markgrid");
  for (const lo of r.logos) grid.append(markTile(lo));
  sec.append(grid);

  // overall decide/steer bar
  const barWrap = el("div", "decidebar");
  const more = el("button", "act", "＋ generate 4 more");
  more.disabled = running;
  more.onclick = () => void runLogos({ avoid: r.logos.map((l) => l.label) });
  const chStyle = el("button", "act", "↩ change the style");
  chStyle.onclick = () => { r.stage = "style"; r.styleChosen = false; r.logos = null; void saveState(); render(); scrollToTop(); };
  barWrap.append(more, chStyle);
  sec.append(barWrap);

  // free-text steer
  if (!running) sec.append(steerRow((s) => void runLogos({ steer: s }), STEER_CHIPS));
  else sec.append(researching(r.status || "working…"));
  return sec;
}

function markTile(lo) {
  const r = state.run;
  const tile = el("div", "tile" + (lo.kept ? " kept" : ""));
  const head = el("div", "tile-head");
  const meta = el("div", "tile-meta");
  meta.append(el("div", "tlabel", lo.label));
  if (lo.concept) meta.append(el("div", "tconcept", lo.concept));
  head.append(meta);
  const keep = el("button", "heart" + (lo.kept ? " on" : ""), lo.kept ? "♥ kept" : "♡ keep");
  keep.title = "Keep this mark";
  keep.onclick = () => toggleKeep(lo);
  head.append(keep);
  tile.append(head);

  const body = el("div", "tile-body");
  // (a) live SVG wireframe
  const wpane = el("div", "pane");
  wpane.append(el("div", "panek", "wireframe"));
  const wf = el("div", "svgwrap"); wf.id = "wf-" + lo.id;
  wf.innerHTML = lo.svg ? sanitizeSvg(lo.svg) : '<div class="svg-empty">sketching…</div>';
  wpane.append(wf);
  // (b) Higgsfield-rendered image
  const ipane = el("div", "pane");
  ipane.append(el("div", "panek", "rendered"));
  const ti = el("div", "tile-img"); ti.id = "ti-" + lo.id;
  ipane.append(ti);
  body.append(wpane, ipane);
  tile.append(body);

  // per-mark decide row
  const foot = el("div", "tile-foot");
  const regen = el("button", "mini", "↻ regenerate"); regen.disabled = running; regen.title = "New concept for this slot";
  regen.onclick = () => void regenerateOne(lo);
  const more = el("button", "mini", "✦ more like this"); more.disabled = running;
  more.onclick = () => void runLogos({ moreLike: `${lo.label} — ${lo.concept}`, avoid: r.logos.map((l) => l.label) });
  foot.append(regen, more);
  tile.append(foot);

  // paint the image pane now (queued/rendering/done/error)
  setTimeout(() => paintTileImg(lo), 0);
  return tile;
}

function paintTileSketch(lo) {
  const wf = $("wf-" + lo.id); if (!wf) return;
  wf.innerHTML = lo.svg ? sanitizeSvg(lo.svg) : '<div class="svg-empty">sketching…</div>';
}

function paintTileImg(lo) {
  const host = $("ti-" + lo.id); if (!host) return;
  host.textContent = "";
  if (lo.imgStatus === "done" && lo.imageUrl) {
    const img = el("img", "markimg"); img.src = lo.imageUrl; img.alt = lo.label; img.loading = "lazy";
    img.addEventListener("error", () => { lo.imgStatus = "error"; lo.imgError = "the image link expired"; paintTileImg(lo); });
    host.append(img);
    const acts = el("div", "img-acts");
    const open = el("a", "mini", "open ↗"); open.href = lo.imageUrl; open.target = "_blank"; open.rel = "noreferrer";
    const dl = el("a", "mini", "download"); dl.href = lo.imageUrl; dl.download = (state.run?.foundation?.name || "logo") + "-" + lo.label.replace(/\s+/g, "-").toLowerCase() + ".png"; dl.target = "_blank"; dl.rel = "noreferrer";
    const rr = el("button", "mini", "↻ re-render"); rr.disabled = running; rr.onclick = () => void reRenderOne(lo);
    acts.append(open, dl, rr);
    host.append(acts);
  } else if (lo.imgStatus === "error") {
    const e = el("div", "img-err");
    e.append(el("div", "emsg", lo.imgError || "render failed"));
    const rr = el("button", "mini", "retry"); rr.onclick = () => void reRenderOne(lo);
    e.append(rr);
    host.append(e);
  } else if (lo.imgStatus === "rendering") {
    const load = el("div", "img-load");
    load.append(el("div", "scan"), el("div", "statusline", "rendering on your Higgsfield…"));
    host.append(load);
  } else {
    // WIREFRAME-FIRST: queued = no image spent yet. Show the opt-in render button so credits are
    // only used on marks the user likes.
    const idle = el("div", "img-idle");
    idle.append(el("div", "statusline", "like the wireframe?"));
    const btn = el("button", "renderbtn", "✦ Render image"); btn.disabled = running; btn.onclick = () => void reRenderOne(lo);
    idle.append(btn);
    idle.append(el("div", "img-note", "spends one Higgsfield render"));
    host.append(idle);
  }
}

function keptShelf() {
  const r = state.run;
  const sec = el("div", "sect-block");
  sec.append(el("div", "kicker sect", `kept — your shortlist (${r.kept.length})`));
  const row = el("div", "keptrow");
  for (const k of r.kept) {
    const chip = el("div", "keptchip");
    const th = el("div", "keptthumb");
    if (k.imageUrl) { const img = el("img"); img.src = k.imageUrl; img.alt = k.label; th.append(img); }
    else if (k.svg) th.innerHTML = sanitizeSvg(k.svg);
    else th.append(el("div", "svg-empty", "—"));
    chip.append(th);
    chip.append(el("div", "keptlabel", k.label));
    const x = el("button", "keptx", "×"); x.title = "Remove"; x.onclick = () => dropKept(k);
    chip.append(x);
    if (k.imageUrl) { const dl = el("a", "keptdl", "↓"); dl.href = k.imageUrl; dl.download = (r.foundation?.name || "logo") + "-" + k.label.replace(/\s+/g, "-").toLowerCase() + ".png"; dl.target = "_blank"; dl.rel = "noreferrer"; dl.title = "Download"; chip.append(dl); }
    row.append(chip);
  }
  sec.append(row);
  return sec;
}

function scrollToTop() { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* noop */ } }

render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `crest_run` runs the SAME start() a type-and-go click runs — foundation, directions, the seeded
// style, and the four marks all render live in the DOM — then returns the structured logo for God to
// speak or file. Images render on the visitor's own Higgsfield and are awaited to completion.
exposeToGod({
  name: "crest_run",
  description: "Turn a one-line brand brief into a logo: a brand foundation, three directions (one recommended), a chosen visual style, and four concrete marks (SVG wireframe + a real image rendered on your Higgsfield). Runs live on the page and returns the result.",
  inputSchema: {
    brief: "string — brand name + what it does / who it's for / any vibe. Required.",
    style: "string — OPTIONAL. One of: 3D isometric, flat, monoline, monochrome, 2D illustrative, pixel art, gradient, bold, emblem, geometric, negative space, retro. Defaults to the recommended style.",
  },
  execute: async ({ brief, style } = {}) => {
    const val = String(brief || "").trim();
    if (!val) throw new Error("nothing to brand — pass { brief } describing the brand");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Crest isn't connected to Switchboard yet");
    await waitFor(() => !running, 180000);
    await start(val);                                   // foundation → directions → style stage
    await waitFor(() => !running, 180000);
    const r = state.run || {};
    if (r.error) throw new Error(r.error);
    if (!r.foundation) throw new Error("Crest couldn't read that brief — try again");
    // pick the style (given or the seeded recommendation) and generate the four marks
    if (style) { const m = STYLES.find((s) => s.label.toLowerCase() === String(style).toLowerCase() || s.id === style); if (m) r.styleId = m.id; }
    r.styleChosen = true;
    await runLogos();
    await waitFor(() => !running, 180000);
    // give the parallel Higgsfield renders a chance to settle (bounded)
    await waitFor(() => (state.run?.logos || []).every((l) => l.imageUrl || l.imgStatus === "error"), 180000);
    const rr = state.run || {};
    return {
      foundation: rr.foundation || null,
      style: styleById(rr.styleId).label,
      directions: (rr.directions || []).map((d) => ({ name: d.name, approach: d.approach, rationale: d.rationale, recommended: d.recommended })),
      marks: (rr.logos || []).map((l) => ({ label: l.label, concept: l.concept, imageUrl: l.imageUrl || null })),
    };
  },
});

// ---- notch GLANCE: the recommended logo direction, declared as data (docs/WIDGETS.md) ------------
exposeWidget(() => {
  const r = state.run;
  if (r && Array.isArray(r.directions) && r.directions.length) {
    const swatch = (r.foundation && r.foundation.palette && r.foundation.palette[0]) || "#C8F250";
    return {
      kicker: "CREST · LOGO DIRECTION",
      title: (r.foundation && r.foundation.name) || "Recommended direction",
      openLabel: "Open Crest",
      shape: "cards",
      result: {
        caption: (r.foundation && r.foundation.positioning) || "one recommended direction",
        items: r.directions.map((d) => ({ label: d.name, text: d.approach + (d.rationale ? " — " + d.rationale : ""), recommended: d.recommended, swatch })),
      },
    };
  }
  return {
    kicker: "CREST · LOGO MAKER",
    title: "A brief in, a logo out",
    openLabel: "Open Crest",
    shape: "text",
    result: {
      body: "Describe your brand — name, what it does, the vibe — and Crest drafts a foundation, three directions, a visual style, and four marks.",
      caption: "runs on your Claude + Higgsfield",
    },
  };
});
