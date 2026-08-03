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

// FEATURE 2 — multi-select styles. `r.styleIds` is the chosen set; migrate old single-style runs.
function ensureStyleIds(r) {
  if (!r) return [];
  if (!Array.isArray(r.styleIds) || !r.styleIds.length) r.styleIds = r.styleId ? [r.styleId] : [];
  return r.styleIds;
}
// The style a given mark belongs to (marks are tagged with lo.styleId in runLogos).
function styleOf(lo) { return styleById((lo && lo.styleId) || (state.run && state.run.styleId)); }
// Spread 4 marks across the selected styles: 1→[4] · 2→[2,2] · 3→[2,1,1] · 4→[1,1,1,1].
function distributeStyles(ids, total = 4) {
  const use = (ids || []).slice(0, total);
  const n = use.length || 1;
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return use.map((id, i) => ({ styleId: id, count: base + (i < rem ? 1 : 0) }));
}

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

// Instant, zero-token default: the recommended style, nudged by styleHints then personality words.
function recommendStyle(f, prefs) {
  // FEATURE 1: seed from an explicit style hint first (direct match against the STYLE shelf).
  const hints = (prefs && prefs.styleHints) || [];
  for (const h of hints) {
    const hl = String(h).toLowerCase();
    const m = STYLES.find((s) => hl.includes(s.id) || hl.includes(s.label.toLowerCase()) || s.label.toLowerCase().split(/[\s/]+/).some((w) => w.length > 3 && hl.includes(w)));
    if (m) return m.id;
  }
  const words = ((f && f.personality) || []).join(" ").toLowerCase() + " " + String(f && f.positioning || "").toLowerCase() + " " + hints.join(" ").toLowerCase();
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
    prefs: null,              // FEATURE 1: extracted brand preferences (qualities/avoid/styleHints/…)
    foundation: null, directions: null,
    chosenDirId: null,        // the direction the HUMAN clicked (accent); null until they do
    activeDirId: null,        // the direction the marks are FOR (recommended by default)
    styleId: null,            // the recommended style is seeded here as a highlighted default…
    styleIds: [],             // FEATURE 2: the multi-select set of chosen styles (1–4)
    styleChosen: false,       // …but accent only lands once the human generates the marks
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
    // 0 — PREFERENCES — parse the brief into structured, EDITABLE preferences BEFORE the
    // foundation so the avoid-list + qualities thread through every downstream generation.
    if (!r.prefs) {
      r.stage = "foundation"; setStatus("reading your preferences…"); render();
      try {
        const ptext = await streamText({ prompt: buildPrefsPrompt(r.brief), maxTokens: 700 });
        r.prefs = coercePrefs(parseJson(ptext));
      } catch { r.prefs = coercePrefs(null); }
      await saveState(); render();
    }

    // 1 — FOUNDATION
    r.stage = "foundation"; setStatus("reading the brief…"); render();
    const ftext = await streamText({ prompt: buildFoundationPrompt(r.brief, r.prefs), maxTokens: 900 },
      (p) => { if (p.text) setStatus("defining the foundation… " + (p.text.length / 1024).toFixed(1) + " kb"); });
    const f = coerceFoundation(parseJson(ftext));
    if (!f) throw new Error("The foundation came back malformed — hit ‘try again’.");
    r.foundation = f;
    await saveState(); render();

    // 2 — DIRECTIONS
    r.stage = "directions"; setStatus("sketching directions…"); render();
    const dtext = await streamText({ prompt: buildDirectionsPrompt(f, r.prefs), maxTokens: 1100 },
      (p) => { if (p.text) setStatus("sketching directions… " + (p.text.length / 1024).toFixed(1) + " kb"); });
    const dirs = coerceDirections(parseJson(dtext));
    if (!dirs) throw new Error("The directions came back malformed — hit ‘try again’.");
    r.directions = dirs;
    const rec = dirs.find((d) => d.recommended) || dirs[0];
    r.activeDirId = rec.id;          // marks will use the recommended direction; human can switch
    r.styleId = recommendStyle(f, r.prefs);   // seed a highlighted default style — NOT chosen yet
    r.styleIds = [r.styleId];        // FEATURE 2: multi-select — the recommended style starts selected
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

// ---- preferences (FEATURE 1) ---------------------------------------------------------------
// Parse the brief into structured, EDITABLE preferences up front. The AVOID list becomes HARD
// negative constraints; qualities become positive requirements; styleHints seed the recommended
// style. Threaded into every foundation/direction/mark/image prompt so a detailed brief counts.
function buildPrefsPrompt(brief) {
  return [
    "You are Crest, a brand strategist. Parse the brief below into structured brand preferences that will steer every downstream generation. Infer sensibly — do not just echo literal words.",
    `BRIEF:\n"""${brief.slice(0, 4000)}"""`,
    "Extract:",
    "- qualities: 3-6 adjectives the identity must FEEL (expand what the brief implies).",
    "- avoid: 3-6 things to steer AWAY from — clichés, over-used symbols, colors, and registers this brand should NOT resemble. Infer category-appropriate ones even if unstated (e.g. a cross-cultural community brief should avoid flags, globes, handshakes; a fintech brief should avoid looking like a bank or consultancy).",
    "- styleHints: 0-4 visual looks the brief implies (e.g. 'monoline', 'heritage badge', 'flat geometric', 'gradient').",
    "- audiences: 1-4 who this is for.",
    "- ambition: one short phrase on reach/scale (one city → global; community ↔ professional).",
    "- taglineNeed: boolean — does the name likely need a descriptor/tagline?",
    "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:",
    '{"qualities":[string],"avoid":[string],"styleHints":[string],"audiences":[string],"ambition":string,"taglineNeed":boolean}',
  ].join("\n\n");
}
function coercePrefs(p) {
  const arr = (a) => (Array.isArray(a) ? a : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
  if (!p || typeof p !== "object") p = {};
  return {
    qualities: arr(p.qualities),
    avoid: arr(p.avoid),
    styleHints: arr(p.styleHints),
    audiences: arr(p.audiences),
    ambition: String(p.ambition || "").trim(),
    taglineNeed: !!p.taglineNeed,
  };
}
// Positive requirements + HARD negative constraints, for text (strategy/direction/mark) prompts.
function prefsPromptBlock(prefs) {
  if (!prefs) return "";
  const lines = [];
  if (prefs.qualities && prefs.qualities.length) lines.push(`REQUIRED QUALITIES (the identity must feel these): ${prefs.qualities.join(", ")}.`);
  if (prefs.styleHints && prefs.styleHints.length) lines.push(`STYLE HINTS the brief implies: ${prefs.styleHints.join(", ")}.`);
  if (prefs.audiences && prefs.audiences.length) lines.push(`AUDIENCES: ${prefs.audiences.join(", ")}.`);
  if (prefs.ambition) lines.push(`AMBITION / REACH: ${prefs.ambition}.`);
  if (prefs.avoid && prefs.avoid.length) lines.push(`HARD NEGATIVE CONSTRAINTS — you MUST strictly AVOID these clichés, colors, symbols and registers (do NOT drift toward them): ${prefs.avoid.join("; ")}.`);
  return lines.join("\n");
}
// Compact avoid clause folded into every Higgsfield image prompt.
function avoidClause(prefs) {
  return (prefs && prefs.avoid && prefs.avoid.length) ? `; strictly avoid: ${prefs.avoid.join(", ")}` : "";
}

// ---- foundation ----------------------------------------------------------------------------
function buildFoundationPrompt(brief, prefs) {
  return [
    "You are Crest, a brand designer. From the brief below, define a compact brand foundation to anchor a logo.",
    `BRIEF:\n"""${brief.slice(0, 4000)}"""`,
    prefsPromptBlock(prefs),
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"name":string (the brand name, cleaned up),"positioning":string (one line, <= 90 chars),"personality":[string,string,string] (exactly 3 single evocative words),"voice":string (a short phrase),"palette":[string] (3-4 hex colors like "#1A2B3C" that genuinely suit this brand),"rationale":string (one line on the logo direction this foundation implies)}',
  ].filter(Boolean).join("\n\n");
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
function buildDirectionsPrompt(f, prefs) {
  return [
    "You are Crest. Propose 3 DISTINCT logo directions for this brand.",
    `BRAND: ${f.name}`,
    f.positioning ? `POSITIONING: ${f.positioning}` : "",
    `PERSONALITY: ${f.personality.join(", ")}`,
    f.voice ? `VOICE: ${f.voice}` : "",
    `PALETTE: ${f.palette.join(", ")}`,
    prefsPromptBlock(prefs),
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
function buildLogosPrompt(f, dir, style, opts = {}, prefs = null) {
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
    prefsPromptBlock(prefs),
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
    styleId: null,            // FEATURE 2: tagged by runLogos so each mark renders in ITS style
    imageUrl: null, imgStatus: "queued", imgError: null, kept: false,
  };
}
function coerceLogos(o, max = 4) {
  const arr = o && Array.isArray(o.logos) ? o.logos : (Array.isArray(o) ? o : []);
  const list = arr.map(coerceLogo).filter(Boolean).slice(0, max);
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
  const styleIds = (opts.styleIds && opts.styleIds.length) ? opts.styleIds : ensureStyleIds(r);
  if (!dir || !styleIds.length) return;
  running = true; r.error = null; r.stage = "logos"; r.logos = null;
  const dist = distributeStyles(styleIds);           // FEATURE 2: [{styleId,count}] summing to 4
  const only = styleIds.length === 1 ? styleById(styleIds[0]).label.toLowerCase() + " " : "";
  setStatus(`sketching four ${only}marks…`); render();
  try {
    // One batch per selected style, generated in parallel; each mark tagged with its styleId.
    const batches = await Promise.all(dist.map(async ({ styleId, count }) => {
      const style = styleById(styleId);
      const text = await streamText({ prompt: buildLogosPrompt(r.foundation, dir, style, { ...opts, count }, r.prefs), maxTokens: count >= 4 ? 6000 : count >= 2 ? 4000 : 2400 });
      const logos = coerceLogos(parseJson(text), count) || [];
      logos.forEach((l) => { l.styleId = styleId; });
      return logos;
    }));
    const all = batches.flat().slice(0, 4);
    if (!all.length) throw new Error("The marks came back malformed — try ‘generate 4 more’.");
    r.logos = all; r.status = "";
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
  await Promise.all(r.logos.map(async (lo) => {
    if (lo.imageUrl) return;
    const style = styleOf(lo);
    lo.imgStatus = "rendering"; paintTileImg(lo);
    try {
      const prompt = (lo.imagePrompt || `${r.foundation.name} logo`) + `, ${style.img}` + avoidClause(r.prefs);
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
  const style = styleOf(lo);
  lo.imageUrl = null; lo.imgStatus = "rendering"; lo.imgError = null; paintTileImg(lo);
  try {
    const url = await genLogoImage((lo.imagePrompt || `${r.foundation.name} logo`) + `, ${style.img}` + avoidClause(r.prefs));
    if (!url) throw new Error("no image came back");
    lo.imageUrl = url; lo.imgStatus = "done";
  } catch (e) { lo.imgStatus = "error"; lo.imgError = msg(e); }
  await saveState(); paintTileImg(lo);
}

// Regenerate ONE mark completely (new SVG + prompt + image) — the "regenerate this one" control.
async function regenerateOne(lo) {
  const r = state.run; if (!r || !relay || !r.foundation || running) return;
  const dir = (r.directions || []).find((d) => d.id === r.activeDirId) || (r.directions || [])[0];
  const style = styleOf(lo);           // FEATURE 2: keep this slot in ITS own style
  if (!dir || !style) return;
  running = true; render();
  lo.svg = ""; lo.concept = ""; lo.imageUrl = null; lo.imgStatus = "queued"; lo.imgError = null;
  paintTileSketch(lo); paintTileImg(lo);
  try {
    const avoid = r.logos.filter((x) => x !== lo).map((x) => x.label);
    const text = await streamText({ prompt: buildLogosPrompt(r.foundation, dir, style, { count: 1, avoid }, r.prefs), maxTokens: 2400 });
    const fresh = (coerceLogos(parseJson(text), 1) || [])[0];
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

  // 1b — PREFERENCES (editable; extracted from the brief, threaded into every generation)
  if (r.prefs) col.append(prefsPanel(r.prefs));

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

  // 3 — LOCKUPS (refine the kept mark into the working set)
  if (r.kept && r.kept.length) col.append(lockupsBlock());

  // 4 — BRAND KIT (pick palette + fonts → designed PDF) + shareable chooser
  if (r.kept && r.kept.length) col.append(kitBlock());

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

// FEATURE 1 — the editable Preferences panel. Chips are removable; each group has an "+ add"
// input. Edits mutate r.prefs in place + save; they take effect on the next generation.
function prefChipGroup(title, list, accent) {
  const grp = el("div", "prefgroup" + (accent ? " avoid" : ""));
  grp.append(el("div", "pg-k kicker", title));
  const chips = el("div", "prefchips");
  list.forEach((item, i) => {
    const chip = el("span", "prefchip" + (accent ? " no" : ""));
    chip.append(el("span", "pc-t", item));
    const x = el("button", "pc-x", "×"); x.title = "remove";
    x.onclick = () => { list.splice(i, 1); void saveState(); render(); };
    chip.append(x);
    chips.append(chip);
  });
  const addWrap = el("span", "prefadd");
  const inp = el("input"); inp.type = "text"; inp.placeholder = "+ add";
  const add = () => { const v = inp.value.trim(); if (!v) return; list.push(v); inp.value = ""; void saveState(); render(); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  addWrap.append(inp);
  chips.append(addWrap);
  grp.append(chips);
  return grp;
}
function prefsPanel(prefs) {
  const card = el("div", "prefs");
  card.append(el("div", "kicker sect", "preferences — extracted from your brief · edit to steer every step"));
  card.append(prefChipGroup("qualities — the identity must feel", prefs.qualities));
  card.append(prefChipGroup("avoid — hard no's (clichés · colors · symbols · registers)", prefs.avoid, true));
  card.append(prefChipGroup("style hints", prefs.styleHints));
  const metaBits = [];
  if (prefs.audiences && prefs.audiences.length) metaBits.push(["audiences", prefs.audiences.join(" · ")]);
  if (prefs.ambition) metaBits.push(["ambition", prefs.ambition]);
  metaBits.push(["tagline", prefs.taglineNeed ? "likely wanted" : "not essential"]);
  if (metaBits.length) {
    const meta = el("div", "prefmeta");
    for (const [k, v] of metaBits) { const m = el("div", "pm"); m.append(el("span", "pm-k", k), el("span", "pm-v", v)); meta.append(m); }
    card.append(meta);
  }
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
  const ids = ensureStyleIds(r);
  const recId = r.styleId; // seeded recommendation (highlighted)
  const sec = el("div", "sect-block");
  const n = ids.length;
  sec.append(el("div", "kicker sect", r.styleChosen
    ? `styles — ${n} selected · switch the mix any time`
    : `styles — pick 1–4 looks, then generate (${n} selected)`));
  const grid = el("div", "stylegrid");
  for (const st of STYLES) {
    const on = ids.includes(st.id);
    const drafted = !on && recId === st.id;
    const card = el("div", "stylecard" + (on ? " sel" : "") + (drafted ? " draft" : ""));
    const thumb = el("div", "stylethumb"); thumb.innerHTML = sanitizeSvg(styleThumb(st.id));
    card.append(thumb);
    card.append(el("div", "stylelabel", st.label));
    if (drafted) card.append(el("div", "styletag", "recommended"));
    if (on) card.append(el("div", "styletag on", "selected"));
    card.onclick = () => toggleStyle(st.id);
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
  // FEATURE 2: generation is no longer a single-click on a style — pick 1–4, then generate.
  const genRow = el("div", "genrow");
  const spread = distributeStyles(ids).map((d) => `${d.count}× ${styleById(d.styleId).label}`).join(" · ");
  genRow.append(el("div", "spread", n ? spread : "select at least one style"));
  const gen = el("button", "primary gen", r.styleChosen ? "Generate 4 more ✦" : "Generate 4 marks ✦");
  gen.disabled = running || n === 0;
  gen.onclick = () => generateMarks();
  genRow.append(gen);
  sec.append(genRow);
  return sec;
}

function toggleStyle(id) {
  const r = state.run; if (!r || running) return;
  const ids = ensureStyleIds(r);
  const at = ids.indexOf(id);
  if (at >= 0) { if (ids.length > 1) ids.splice(at, 1); }   // keep at least one selected
  else { if (ids.length >= 4) toast("Up to 4 styles — deselect one first.", true); else ids.push(id); }
  r.styleId = ids.includes(r.styleId) ? r.styleId : ids[0]; // keep a valid single fallback
  void saveState(); render();
}

function generateMarks() {
  const r = state.run; if (!r || running) return;
  if (!ensureStyleIds(r).length) { toast("Pick at least one style.", true); return; }
  r.styleChosen = true;
  const steer = r.stylePref && r.stylePref.trim() ? { steer: r.stylePref.trim() } : {};
  void saveState();
  void runLogos(steer);
}

// ---- the four marks + decide/steer ---------------------------------------------------------
function marksBlock() {
  const r = state.run;
  const sec = el("div", "sect-block");
  const ids = ensureStyleIds(r);
  const header = ids.length === 1
    ? `four ${styleById(ids[0]).label.toLowerCase()} marks — keep what's good, change what isn't`
    : `four marks across ${ids.length} styles — keep what's good, change what isn't`;
  sec.append(el("div", "kicker sect", header));
  const grid = el("div", "markgrid");
  for (const lo of r.logos) grid.append(markTile(lo));
  sec.append(grid);

  // overall decide/steer bar
  const barWrap = el("div", "decidebar");
  const more = el("button", "act", "＋ generate 4 more");
  more.disabled = running;
  more.onclick = () => void runLogos({ avoid: r.logos.map((l) => l.label) });
  const chStyle = el("button", "act", "↩ change styles");
  chStyle.onclick = () => scrollToTop();   // the style gallery stays live above — retoggle + regenerate
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
  const lab = el("div", "tlabel"); lab.append(document.createTextNode(lo.label));
  if (ensureStyleIds(r).length > 1) { const b = el("span", "tstyle", styleOf(lo).label); lab.append(b); }
  meta.append(lab);
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
  more.onclick = () => void runLogos({ moreLike: `${lo.label} — ${lo.concept}`, styleIds: lo.styleId ? [lo.styleId] : undefined, avoid: r.logos.map((l) => l.label) });
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

// ============================================================================================
// BRAND KIT — pick a palette + font pairing (options, one recommended), then export a designed PDF.
// Wireframe-first stays: this runs only when the user asks ("Build my brand kit"); no auto spend.
// ============================================================================================
const GF_FAM = (fam) => "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(String(fam || "").trim()).replace(/%20/g, "+") + ":wght@400;600;700&display=swap";
function loadFontPair(fp) {
  if (!fp) return;
  for (const fam of [fp.display, fp.body]) {
    if (!fam) continue;
    const id = "gf-" + String(fam).replace(/\W+/g, "");
    if (document.getElementById(id)) continue;
    const l = el("link"); l.id = id; l.rel = "stylesheet"; l.href = GF_FAM(fam); document.head.append(l);
  }
}
function hexToRgb(h) { h = String(h || "").replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); const n = parseInt(h || "0", 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToCmyk(r, g, b) { r /= 255; g /= 255; b /= 255; const k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 100]; return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100)); }

async function runBrandSystem() {
  const r = state.run; if (!r || !relay || !r.foundation || running) return;
  running = true; r.kit = r.kit || {}; r.kit.loading = true; r.kit.error = null; render();
  try {
    const f = r.foundation;
    const prompt = [
      "You are Crest, a brand designer. Propose the VISUAL SYSTEM options for this brand's starter kit — the user will pick.",
      `BRAND: ${f.name} — ${f.positioning || ""}`,
      `PERSONALITY: ${(f.personality || []).join(", ")}`,
      `SEED PALETTE: ${(f.palette || []).join(", ")}`,
      prefsPromptBlock(r.prefs),
      avoidClause(r.prefs),
      "Respond with ONLY a JSON object — no prose, no markdown fences — in exactly this shape:",
      '{"palettes":[3 items, each {"name":string,"primary":"#hex","secondary":"#hex","ink":"#hex","bg":"#hex","accent":"#hex"}],"fonts":[3 items, each {"name":string,"display":string (a REAL free Google Font family),"body":string (a REAL free Google Font family)}],"taglines":[3 short strings],"voice":string}',
      "Palettes must genuinely suit this brand and RESPECT the avoid list. Fonts must be real, FREE Google Fonts (e.g. Bricolage Grotesque, Space Grotesk, Inter, Hanken Grotesk, Fraunces, Work Sans, Sora, Manrope) — never a paid or fictional family.",
    ].filter(Boolean).join("\n\n");
    const o = await askJson([prompt]);
    r.kit.palettes = Array.isArray(o.palettes) ? o.palettes.slice(0, 3) : [];
    r.kit.fonts = Array.isArray(o.fonts) ? o.fonts.slice(0, 3) : [];
    r.kit.taglines = Array.isArray(o.taglines) ? o.taglines.slice(0, 3) : [];
    r.kit.voice = String(o.voice || f.voice || "");
    r.kit.pIdx = 0; r.kit.fIdx = 0; r.kit.loading = false;
    r.kit.fonts.forEach(loadFontPair);
    await saveState();
  } catch (e) { r.kit.error = msg(e); r.kit.loading = false; }
  finally { running = false; render(); }
}

function kitBlock() {
  const r = state.run; const sec = el("div", "sect-block kit");
  sec.append(el("div", "kicker sect", "brand kit — pick your system, then export"));
  if (!r.kit || (!r.kit.palettes && !r.kit.loading && !r.kit.error)) {
    const intro = el("div", "kit-intro");
    intro.append(el("div", "kit-introtext", "Turn your kept mark into a starter brand kit — palettes and fonts to choose from, then a designed PDF you can hand off."));
    const b = el("button", "primary", "✦ Build my brand kit"); b.disabled = running; b.onclick = () => void runBrandSystem();
    intro.append(b); sec.append(intro); return sec;
  }
  if (r.kit.loading) { sec.append(researching("composing palettes & fonts…")); return sec; }
  if (r.kit.error) { sec.append(el("div", "err", r.kit.error)); const t = el("button", "act", "try again"); t.onclick = () => void runBrandSystem(); sec.append(t); return sec; }
  // palette picker
  sec.append(el("div", "kicker sub", "palette — pick one"));
  const pg = el("div", "palgrid");
  (r.kit.palettes || []).forEach((pal, i) => {
    const card = el("div", "palcard" + (i === r.kit.pIdx ? " sel" : "")); card.onclick = () => { r.kit.pIdx = i; void saveState(); render(); };
    const sw = el("div", "palsw");
    for (const role of ["primary", "secondary", "ink", "bg", "accent"]) { const c = el("span", "pchip"); c.style.background = pal[role] || "#000"; c.title = role + " " + (pal[role] || ""); sw.append(c); }
    card.append(sw); card.append(el("div", "pallabel", pal.name || ("Palette " + (i + 1)))); pg.append(card);
  });
  sec.append(pg);
  // font picker
  sec.append(el("div", "kicker sub", "type — pick a pairing"));
  const fg = el("div", "fontgrid");
  (r.kit.fonts || []).forEach((fp, i) => {
    loadFontPair(fp);
    const card = el("div", "fontcard" + (i === r.kit.fIdx ? " sel" : "")); card.onclick = () => { r.kit.fIdx = i; void saveState(); render(); };
    const d = el("div", "fspec-d"); d.textContent = "Aa"; d.style.fontFamily = '"' + (fp.display || "sans-serif") + '", sans-serif';
    const bd = el("div", "fspec-b"); bd.textContent = "The quick brown fox jumps"; bd.style.fontFamily = '"' + (fp.body || "sans-serif") + '", sans-serif';
    card.append(d, bd, el("div", "fontlabel", (fp.display || "") + " · " + (fp.body || ""))); fg.append(card);
  });
  sec.append(fg);
  const ex = el("div", "kit-export");
  const pdf = el("button", "primary", "⬇ Export brand kit (PDF)"); pdf.disabled = running; pdf.onclick = () => void buildKitPdf();
  const share = el("button", "act", "🔗 Export shareable chooser"); share.disabled = running; share.onclick = () => void exportChooser();
  ex.append(pdf, share);
  sec.append(ex);
  return sec;
}

function kitMarkHtml(big) {
  const r = state.run; const k = (r.kept && r.kept[0]);
  if (!k) return "";
  const sz = big ? 220 : 120;
  if (k.imageUrl) return '<img src="' + k.imageUrl + '" crossorigin="anonymous" style="max-width:' + sz + 'px;max-height:' + sz + 'px;object-fit:contain">';
  if (k.svg) return '<div style="width:' + sz + 'px">' + sanitizeSvg(k.svg) + "</div>";
  return "";
}
function buildKitHtml() {
  const r = state.run, f = r.foundation, kit = r.kit;
  const pal = (kit.palettes || [])[kit.pIdx || 0] || {};
  const fp = (kit.fonts || [])[kit.fIdx || 0] || {};
  const ink = pal.ink || "#101014", bg = pal.bg || "#ffffff", accent = pal.accent || "#C8F250";
  const roles = [["Primary", pal.primary], ["Secondary", pal.secondary], ["Ink", pal.ink], ["Background", pal.bg], ["Accent", pal.accent]].filter((x) => x[1]);
  const swatchPage = roles.map(([name, hex]) => {
    const [R, G, B] = hexToRgb(hex); const [C, M, Y, K] = rgbToCmyk(R, G, B);
    return '<div style="display:flex;align-items:center;gap:16px;margin:10px 0"><div style="width:64px;height:64px;border-radius:10px;background:' + hex + ';border:1px solid rgba(0,0,0,.12)"></div><div><div style="font:600 14px ' + (fp.display || "sans-serif") + '">' + name + '</div><div style="font:400 12px/1.7 monospace;color:#555">HEX ' + String(hex).toUpperCase() + " · RGB " + R + "," + G + "," + B + " · CMYK " + C + "," + M + "," + Y + "," + K + "</div></div></div>";
  }).join("");
  const df = '"' + (fp.display || "Georgia") + '", sans-serif', bf = '"' + (fp.body || "Georgia") + '", sans-serif';
  const tags = (kit.taglines || []).map((t) => "<li>" + stripTags(t) + "</li>").join("");
  const page = (inner) => '<section style="width:794px;min-height:1000px;box-sizing:border-box;padding:56px;background:' + bg + ';color:' + ink + ';page-break-after:always">' + inner + "</section>";
  return '<div style="background:' + bg + '">'
    + page('<div style="font:600 12px monospace;letter-spacing:.2em;text-transform:uppercase;color:' + accent + '">Brand kit</div><h1 style="font:700 46px/1.05 ' + df + ';margin:8px 0 0">' + stripTags(f.name) + '</h1><div style="font:400 16px ' + bf + ';color:' + ink + ';opacity:.8;margin-top:8px">' + stripTags(f.positioning || "") + '</div><div style="margin-top:120px;display:flex;justify-content:center">' + kitMarkHtml(true) + "</div>")
    + page('<h2 style="font:700 28px ' + df + '">Logo</h2><div style="margin-top:24px;display:flex;gap:24px;flex-wrap:wrap"><div style="flex:1;min-width:220px;border:1px solid rgba(0,0,0,.1);border-radius:14px;padding:32px;display:flex;justify-content:center;align-items:center;background:' + bg + '">' + kitMarkHtml(true) + '</div><div style="flex:1;min-width:220px;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:32px;display:flex;justify-content:center;align-items:center;background:' + ink + '">' + kitMarkHtml(true) + '</div></div><p style="font:400 13px/1.7 ' + bf + ';margin-top:20px;opacity:.8">Keep clear space around the mark equal to the height of its counter. Minimum size 24&nbsp;px on screen / 8&nbsp;mm in print. The mark must remain recognizable in one color and at avatar size.</p>')
    + page('<h2 style="font:700 28px ' + df + '">Colour</h2><div style="margin-top:20px">' + swatchPage + "</div>")
    + page('<h2 style="font:700 28px ' + df + '">Type</h2><div style="margin-top:24px"><div style="font:600 12px monospace;letter-spacing:.15em;text-transform:uppercase;opacity:.5">Display — ' + stripTags(fp.display || "") + '</div><div style="font:700 52px ' + df + ';margin:6px 0 22px">' + stripTags(f.name) + '</div><div style="font:600 12px monospace;letter-spacing:.15em;text-transform:uppercase;opacity:.5">Body — ' + stripTags(fp.body || "") + '</div><div style="font:400 16px/1.6 ' + bf + ';margin-top:6px;max-width:560px">The quick brown fox jumps over the lazy dog. A warm, human voice for a community that spans people, ideas and opportunity. Both are free Google Fonts with system fallbacks.</div></div>')
    + page('<h2 style="font:700 28px ' + df + '">Voice & taglines</h2><p style="font:400 15px/1.7 ' + bf + ';margin-top:18px;max-width:600px">' + stripTags(kit.voice || f.voice || "") + '</p><ul style="font:600 18px/2 ' + df + ';margin-top:18px">' + tags + '</ul><p style="font:400 12px ' + bf + ';opacity:.6;margin-top:8px">The brand works fine without a tagline.</p>')
    + "</div>";
}
async function buildKitPdf() {
  const r = state.run; if (!r || !r.kit || !r.kit.palettes) return;
  if (!window.html2pdf) { toast("PDF library still loading — try again in a moment", true); return; }
  toast("Composing your brand-kit PDF…");
  const holder = el("div"); holder.style.position = "fixed"; holder.style.left = "-99999px"; holder.style.top = "0";
  holder.innerHTML = buildKitHtml(); document.body.append(holder);
  try {
    await window.html2pdf().set({ margin: 0, filename: (r.foundation?.name || "brand") + "-kit.pdf", image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: null }, jsPDF: { unit: "px", format: [794, 1123], orientation: "portrait" } }).from(holder.firstElementChild).save();
    toast("Brand kit downloaded ✓");
  } catch (e) { toast("PDF export failed: " + msg(e), true); }
  finally { holder.remove(); }
}

// ============================================================================================
// SHAREABLE CHOOSER — export ONE self-contained HTML packaging every generated option (marks,
// lockups, palettes, fonts) with all image assets inlined as data URIs. The recipient browses,
// PICKS their favourites, and downloads the finished kit — no server, no new generation.
// ============================================================================================
async function toDataUrl(url) {
  if (!url || String(url).startsWith("data:")) return url || "";
  try { const res = await fetch(url); const blob = await res.blob(); return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.onerror = () => r(url); fr.readAsDataURL(blob); }); }
  catch { return url; }
}
async function exportChooser() {
  const r = state.run; if (!r || !r.foundation) return;
  if (!(r.kit && r.kit.palettes)) { toast("build the brand kit first (palettes + fonts)", true); return; }
  toast("Packaging your shareable chooser…");
  try {
    const marks = [];
    for (const k of (r.kept || [])) marks.push({ label: k.label, svg: k.svg || "", img: k.imageUrl ? await toDataUrl(k.imageUrl) : "" });
    for (const it of ((r.lockups && r.lockups.items) || [])) if (it.svg || it.imageUrl) marks.push({ label: it.label, svg: it.svg || "", img: it.imageUrl ? await toDataUrl(it.imageUrl) : "" });
    const data = {
      name: r.foundation.name, positioning: r.foundation.positioning || "",
      marks, palettes: r.kit.palettes || [], fonts: r.kit.fonts || [],
      taglines: r.kit.taglines || [], voice: r.kit.voice || r.foundation.voice || "",
    };
    const blob = new Blob([buildChooserHtml(data)], { type: "text/html" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = String(data.name || "brand").replace(/\s+/g, "-").toLowerCase() + "-chooser.html";
    document.body.append(a); a.click(); a.remove();
    toast("Shareable chooser downloaded ✓ — send it; they pick and download their kit");
  } catch (e) { toast("chooser export failed: " + msg(e), true); }
}
function buildChooserHtml(d) {
  const fams = [...new Set(d.fonts.flatMap((f) => [f.display, f.body]).filter(Boolean))];
  const fontLink = fams.length ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' + fams.map((f) => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600;700").join("&") + '&display=swap">' : "";
  const DATA = JSON.stringify(d).replace(/</g, "\\u003c");
  const APP = 'const D=window.__KIT__;const S={mark:0,pal:0,font:0};'
    + 'const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];'
    + 'function markHTML(m,big){const z=big?200:120;if(m.img)return "<img src=\\""+m.img+"\\" style=\\"max-width:"+z+"px;max-height:"+z+"px;object-fit:contain\\">";if(m.svg)return "<div style=\\"width:"+z+"px\\">"+m.svg+"</div>";return "";}'
    + 'function rgb(h){h=(h||"").replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");const n=parseInt(h||"0",16)||0;return [(n>>16)&255,(n>>8)&255,n&255];}'
    + 'function render(){'
    + '$("#marks").innerHTML=D.marks.map((m,i)=>"<div class=\\"opt "+(i===S.mark?"sel":"")+"\\" data-m=\\""+i+"\\"><div class=\\"thumb\\">"+markHTML(m)+"</div><div class=\\"cap\\">"+m.label+"</div></div>").join("");'
    + '$("#pals").innerHTML=D.palettes.map((p,i)=>"<div class=\\"opt "+(i===S.pal?"sel":"")+"\\" data-p=\\""+i+"\\"><div class=\\"sw\\">"+["primary","secondary","ink","bg","accent"].map(r=>"<span style=\\"background:"+(p[r]||"#000")+"\\"></span>").join("")+"</div><div class=\\"cap\\">"+(p.name||"Palette")+"</div></div>").join("");'
    + '$("#fonts").innerHTML=D.fonts.map((f,i)=>"<div class=\\"opt "+(i===S.font?"sel":"")+"\\" data-f=\\""+i+"\\"><div class=\\"fd\\" style=\\"font-family:\\x27"+f.display+"\\x27\\">Aa</div><div class=\\"fb\\" style=\\"font-family:\\x27"+f.body+"\\x27\\">The quick brown fox</div><div class=\\"cap\\">"+f.display+" \\u00b7 "+f.body+"</div></div>").join("");'
    + '$$("[data-m]").forEach(e=>e.onclick=()=>{S.mark=+e.dataset.m;render();});'
    + '$$("[data-p]").forEach(e=>e.onclick=()=>{S.pal=+e.dataset.p;render();});'
    + '$$("[data-f]").forEach(e=>e.onclick=()=>{S.font=+e.dataset.f;render();});}'
    + 'function kitHTML(){const m=D.marks[S.mark]||{},p=D.palettes[S.pal]||{},f=D.fonts[S.font]||{};'
    + 'const df="\\x27"+(f.display||"Georgia")+"\\x27,sans-serif",bf="\\x27"+(f.body||"Georgia")+"\\x27,sans-serif";'
    + 'const roles=[["Primary",p.primary],["Secondary",p.secondary],["Ink",p.ink],["Background",p.bg],["Accent",p.accent]].filter(x=>x[1]);'
    + 'const sw=roles.map(x=>{const c=rgb(x[1]);return "<div style=\\"display:flex;align-items:center;gap:14px;margin:8px 0\\"><div style=\\"width:54px;height:54px;border-radius:9px;background:"+x[1]+";border:1px solid rgba(0,0,0,.12)\\"></div><div><b style=\\"font-family:"+df+"\\">"+x[0]+"</b><div style=\\"font:400 12px/1.6 monospace;color:#555\\">HEX "+String(x[1]).toUpperCase()+" \\u00b7 RGB "+c[0]+","+c[1]+","+c[2]+"</div></div></div>";}).join("");'
    + 'const tags=(D.taglines||[]).map(t=>"<li>"+t+"</li>").join("");'
    + 'return "<div style=\\"width:794px;box-sizing:border-box;padding:52px;background:"+(p.bg||"#fff")+";color:"+(p.ink||"#101014")+"\\"><div style=\\"font:600 11px monospace;letter-spacing:.2em;text-transform:uppercase;color:"+(p.accent||"#888")+"\\">Brand kit</div><h1 style=\\"font:700 40px/1.05 "+df+";margin:6px 0 0\\">"+D.name+"</h1><div style=\\"font:400 15px "+bf+";opacity:.8;margin-top:6px\\">"+(D.positioning||"")+"</div><div style=\\"margin:30px 0;display:flex;gap:20px\\"><div style=\\"flex:1;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:24px;display:flex;justify-content:center;background:"+(p.bg||"#fff")+"\\">"+markHTML(m,true)+"</div><div style=\\"flex:1;border-radius:12px;padding:24px;display:flex;justify-content:center;background:"+(p.ink||"#111")+"\\">"+markHTML(m,true)+"</div></div><h2 style=\\"font:700 22px "+df+";margin-top:24px\\">Colour</h2>"+sw+"<h2 style=\\"font:700 22px "+df+";margin-top:24px\\">Type</h2><div style=\\"font:700 40px "+df+";margin:8px 0\\">"+D.name+"</div><div style=\\"font:400 15px/1.6 "+bf+"\\">The quick brown fox jumps over the lazy dog. "+(f.display||"")+" for display, "+(f.body||"")+" for body — both free Google Fonts.</div><h2 style=\\"font:700 22px "+df+";margin-top:24px\\">Voice \\u0026 taglines</h2><p style=\\"font:400 14px/1.6 "+bf+"\\">"+(D.voice||"")+"</p><ul style=\\"font:600 17px/1.9 "+df+"\\">"+tags+"</ul></div>";}'
    + 'function download(){if(!window.html2pdf){alert("PDF library still loading — try again in a second");return;}const h=document.createElement("div");h.style.cssText="position:fixed;left:-99999px;top:0";h.innerHTML=kitHTML();document.body.append(h);window.html2pdf().set({margin:0,filename:D.name.replace(/\\s+/g,"-").toLowerCase()+"-kit.pdf",image:{type:"jpeg",quality:.95},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:"px",format:[794,1123],orientation:"portrait"}}).from(h.firstElementChild).save().then(()=>h.remove());}'
    + 'document.addEventListener("DOMContentLoaded",()=>{render();$("#dl").onclick=download;});';
  return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>" + stripTags(d.name) + " — pick your brand</title>" + fontLink
    + "<style>:root{--a:#C8F250}*{box-sizing:border-box}body{margin:0;background:#0A0C10;color:#E8EDF4;font:14px/1.6 system-ui,sans-serif}header{padding:22px 24px;border-bottom:1px solid #1C212B}h1{font:700 24px/1 system-ui;margin:0}.sub{color:#99A3B7;margin-top:6px;font-size:14px}main{max-width:900px;margin:0 auto;padding:28px 24px 100px}.k{font:500 10px/1 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;color:#6E7C90;display:block;margin:26px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.opt{border:1px solid #262C38;background:#070809;border-radius:13px;padding:12px;cursor:pointer;text-align:center}.opt.sel{border-color:var(--a);background:#181d0a}.thumb{aspect-ratio:1;background:#0A0C10;border-radius:9px;display:grid;place-items:center;overflow:hidden;margin-bottom:8px}.thumb img{max-width:80%;max-height:80%}.thumb svg{width:70%;height:70%}.sw{display:flex;gap:4px;margin-bottom:8px}.sw span{flex:1;height:30px;border-radius:5px;border:1px solid rgba(255,255,255,.1)}.fd{font-size:30px;line-height:1}.fb{font-size:13px;color:#B4BECE;margin:5px 0 8px}.cap{font:500 12px/1.3 system-ui;color:#E8EDF4}.bar{position:fixed;left:0;right:0;bottom:0;padding:14px 24px;background:#12151C;border-top:1px solid #262C38;display:flex;justify-content:center}#dl{font:600 14px system-ui;border:0;border-radius:10px;padding:13px 26px;background:var(--a);color:#0A0C10;cursor:pointer}</style></head>"
    + "<body><header><h1>" + stripTags(d.name) + "</h1><div class=sub>Pick the mark, palette and fonts you like — then download your brand kit.</div></header>"
    + "<main><span class=k>Logo — pick one</span><div class=grid id=marks></div><span class=k>Palette — pick one</span><div class=grid id=pals></div><span class=k>Type — pick a pairing</span><div class=grid id=fonts></div></main>"
    + "<div class=bar><button id=dl>⬇ Download my brand kit (PDF)</button></div>"
    + '<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><' + '/script>'
    + "<script>window.__KIT__=" + DATA + ";" + APP + "<" + "/script></body></html>";
}

// ============================================================================================
// LOCKUPS — refine a kept mark into the working set (horizontal / stacked / avatar / wordmark /
// one-colour). Wireframe-first: SVG shows free; image render is opt-in per lockup.
// ============================================================================================
const LOCKUPS = [
  { id: "horizontal", label: "Primary — horizontal", hint: "the symbol on the left, the wordmark to its right, baseline-aligned" },
  { id: "stacked",    label: "Compact — stacked",    hint: "the symbol centred above the wordmark" },
  { id: "avatar",     label: "Avatar / monogram",    hint: "just the symbol or the initials inside a rounded square, for a social avatar" },
  { id: "wordmark",   label: "Wordmark only",        hint: "the name set in the brand's letterform, no symbol" },
  { id: "onecolor",   label: "One-colour",           hint: "the primary lockup flattened to a single colour — the small-size / print test" },
];
async function runLockups() {
  const r = state.run; if (!r || !relay || !r.foundation || running) return;
  const k = (r.kept && r.kept[0]); if (!k) { toast("keep a mark first (♥)", true); return; }
  const style = styleOf(k) || STYLES[1];
  running = true; r.lockups = { for: k.srcId, loading: true, items: null, error: null }; render();
  try {
    const prompt = [
      "You are Crest. Produce the LOCKUP SET for this brand's chosen mark — each as clean inline SVG.",
      `BRAND: ${r.foundation.name}`,
      `MARK CONCEPT: ${k.label}` + (k.concept ? " — " + k.concept : ""),
      `STYLE: ${style.label} — ${style.svgHint}`,
      "Produce EXACTLY these 5, in order: " + LOCKUPS.map((l) => `${l.id} (${l.hint})`).join("; ") + ".",
      "Each SVG must have a viewBox and be self-contained (no external refs). The mark should be recognizable and consistent across all five.",
      "Respond with ONLY a JSON object — no prose, no fences — shape:",
      '{"lockups":[5 items, each {"id":one of ' + LOCKUPS.map((l) => l.id).join("/") + ',"svg":string (inline SVG)}]}',
    ].join("\n\n");
    const o = await askJson([prompt]);
    const byId = {}; (o.lockups || []).forEach((x) => { if (x && x.id) byId[x.id] = sanitizeSvg(String(x.svg || "")); });
    r.lockups.items = LOCKUPS.map((l) => ({ id: l.id, label: l.label, svg: /<svg[\s\S]*<\/svg>/i.test(byId[l.id] || "") ? byId[l.id] : "", imagePrompt: `${r.foundation.name} logo, ${l.hint}`, imageUrl: null, imgStatus: "queued", imgError: null }));
    r.lockups.loading = false; await saveState();
  } catch (e) { r.lockups.error = msg(e); r.lockups.loading = false; }
  finally { running = false; render(); }
}
async function reRenderLockup(it) {
  const r = state.run; if (!r || !relay || !it) return;
  const style = styleOf(r.kept && r.kept[0]) || STYLES[1];
  it.imageUrl = null; it.imgStatus = "rendering"; it.imgError = null; paintLockupImg(it);
  try { const url = await genLogoImage((it.imagePrompt || `${r.foundation.name} logo`) + `, ${style.img}`); if (!url) throw new Error("no image came back"); it.imageUrl = url; it.imgStatus = "done"; }
  catch (e) { it.imgStatus = "error"; it.imgError = msg(e); }
  await saveState(); paintLockupImg(it);
}
function paintLockupImg(it) {
  const host = $("li-" + it.id); if (!host) return; host.textContent = "";
  if (it.imgStatus === "done" && it.imageUrl) {
    const img = el("img", "markimg"); img.src = it.imageUrl; img.alt = it.label; host.append(img);
    const acts = el("div", "img-acts");
    const dl = el("a", "mini", "download"); dl.href = it.imageUrl; dl.download = (state.run?.foundation?.name || "logo") + "-" + it.id + ".png"; dl.target = "_blank"; dl.rel = "noreferrer";
    const rr = el("button", "mini", "↻"); rr.disabled = running; rr.onclick = () => void reRenderLockup(it); acts.append(dl, rr); host.append(acts);
  } else if (it.imgStatus === "rendering") { const l = el("div", "img-load"); l.append(el("div", "scan"), el("div", "statusline", "rendering…")); host.append(l); }
  else { const idle = el("div", "img-idle"); const b = el("button", "renderbtn", "✦ Render image"); b.disabled = running; b.onclick = () => void reRenderLockup(it); idle.append(b); host.append(idle); }
}
function lockupsBlock() {
  const r = state.run; const sec = el("div", "sect-block");
  sec.append(el("div", "kicker sect", "lockups — the working set for your kept mark"));
  if (!r.lockups) {
    const intro = el("div", "kit-intro");
    intro.append(el("div", "kit-introtext", "Refine your kept mark into the pieces you'll actually use — horizontal, stacked, avatar, wordmark-only, and a one-colour version."));
    const b = el("button", "primary", "✦ Refine into a lockup set"); b.disabled = running; b.onclick = () => void runLockups(); intro.append(b); sec.append(intro); return sec;
  }
  if (r.lockups.loading) { sec.append(researching("drawing the lockups…")); return sec; }
  if (r.lockups.error) { sec.append(el("div", "err", r.lockups.error)); const t = el("button", "act", "try again"); t.onclick = () => void runLockups(); sec.append(t); return sec; }
  const grid = el("div", "markgrid");
  for (const it of (r.lockups.items || [])) {
    const tile = el("div", "tile");
    const head = el("div", "tile-head"); head.append(el("div", "tlabel", it.label)); tile.append(head);
    const body = el("div", "tile-body");
    const wp = el("div", "pane"); wp.append(el("div", "panek", "wireframe")); const wf = el("div", "svgwrap"); wf.innerHTML = it.svg ? sanitizeSvg(it.svg) : '<div class="svg-empty">—</div>'; wp.append(wf);
    const ip = el("div", "pane"); ip.append(el("div", "panek", "rendered")); const ti = el("div", "tile-img"); ti.id = "li-" + it.id; ip.append(ti);
    body.append(wp, ip); tile.append(body); grid.append(tile);
  }
  sec.append(grid);
  setTimeout(() => { for (const it of (r.lockups.items || [])) paintLockupImg(it); }, 0);
  const b = el("button", "act", "↻ redo the set"); b.disabled = running; b.onclick = () => void runLockups(); sec.append(el("div", "decidebar").appendChild(b).parentElement);
  return sec;
}

render();

// __CRESTDEV__ — temporary self-test hook (removed before ship); only active with ?crestdev.
if (typeof location !== "undefined" && location.search.includes("crestdev")) {
  window.__crest = { get state() { return state; }, set state(v) { state = v; }, set relay(v) { relay = v; }, render, STYLES };
}

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
    r.styleIds = [r.styleId];
    r.styleChosen = true;
    await runLogos();
    await waitFor(() => !running, 180000);
    // give the parallel Higgsfield renders a chance to settle (bounded)
    await waitFor(() => (state.run?.logos || []).every((l) => l.imageUrl || l.imgStatus === "error"), 180000);
    const rr = state.run || {};
    return {
      foundation: rr.foundation || null,
      styles: ensureStyleIds(rr).map((id) => styleById(id).label),
      directions: (rr.directions || []).map((d) => ({ name: d.name, approach: d.approach, rationale: d.rationale, recommended: d.recommended })),
      marks: (rr.logos || []).map((l) => ({ label: l.label, concept: l.concept, style: styleOf(l).label, imageUrl: l.imageUrl || null })),
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
