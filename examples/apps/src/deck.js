// DECK — paste notes, an outline, or just a topic → your own Claude drafts a real slide deck
// (a title slide + N content slides, each a title + 3–5 bullets + an optional speaker note) as
// structured JSON, renders it as a clean slide preview, and exports a genuine .pptx you can open in
// PowerPoint / Keynote / Google Slides. The operator holds no key, pays for no inference, and never
// sees your notes — Switchboard brokers everything; the PowerPoint is built entirely in your tab.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from recap.js / regex.js) — keep it byte-identical. Edit the CONFIG block
// and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED stays visually distinct from CHOSEN
// so the accent never paints a machine decision (doctrine 5), and any slate gets an escape hatch.
import { optionCards } from "./kit/ui.js";
// God's hands: expose Deck's action as a page-tool so the native God webview (or any WebMCP host)
// can DRIVE it — reusing the same start() a click runs — and expose a notch-widget glance.
import { exposeToGod, exposeWidget } from "./kit/webmcp.js";
// Carried context: when the Switchboard OS launches Deck AT an item, open focused on it.
import { readOsContext } from "./os/os-context.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "deck",                                 // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Deck",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Deck — turns notes or an outline into a real slide deck you can export to PowerPoint, on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only; the .pptx is built in-tab, no tools
  },
  usesContext: "single",                        // a brand/project context styles the deck (palette + voice)
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

// carried context — the OS may launch Deck AT an item; open on it instead of a cold start. Safe
// no-op when absent (bad hash → null → "").
const OS_CTX = readOsContext();
function osCtxTitle() {
  const c = OS_CTX; if (!c) return "";
  if (typeof c.artifact === "string") return c.artifact.slice(0, 160);
  if (c.artifact && typeof c.artifact.title === "string") return c.artifact.title.slice(0, 160);
  if (typeof c.term === "string") return c.term.slice(0, 160);
  return "";
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
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Paste notes, an outline, or a topic — the deck drafts itself";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Preview the slides, steer anything, export a real .pptx";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// DECK — a single paste (notes / an outline / a bare topic) → one stage drafts a structured deck as
// JSON (a title slide + N content slides, each with a title, 3–5 bullets, and an optional speaker
// note) → the page renders it as a clean slide preview → "Download .pptx" builds a genuine
// PowerPoint file entirely client-side (pptxgenjs, loaded from CDN in deck.html). Steering re-drafts
// the whole deck (fewer/more slides, punchier titles, more data, tighter bullets…). A lent brand
// context styles the export (its palette accent) and the copy (its voice) — context-first.

const STEER_CHIPS = ["fewer slides", "more detail", "punchier titles", "add data points", "tighter bullets"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = "Q3 board update: revenue up 34% to $1.2M ARR, churn down to 2.1%, shipped the mobile app, hired 4 engineers. Risks: enterprise sales cycle lengthening, one key customer renewal at risk. Ask: approve $500k for GTM hires.";
let running = false;

// ---- pptx builder (real PowerPoint, built entirely in-tab via pptxgenjs from CDN) ----------------
function slugify(s) { return String(s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "deck"; }
function hex6(c, fallback) {
  const h = String(c || "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback;
}
function deckAccent() {
  const pal = brand?.data?.palette;
  if (Array.isArray(pal) && pal.length) return hex6(pal[0], "C8F250");
  return "C8F250";
}
// Build a pptxgenjs presentation from the structured deck. Dark house theme, one accent bar per
// slide (the lent brand's first palette colour when present — context-first), speaker notes carried
// into the file's notes pane. Widescreen 16:9.
function buildPptx(deck) {
  const P = (typeof window !== "undefined") && window.PptxGenJS;
  if (!P) throw new Error("The PowerPoint library didn't load — reload the tab and try again.");
  const accent = deckAccent();
  const BG = "0B0E14", INK = "F2F5FA", SEC = "B4BECE", DIM = "8A94A6";
  const FONT = "Arial";
  const pptx = new P();
  pptx.layout = "LAYOUT_WIDE";                 // 13.333 × 7.5 in, 16:9
  const W = 13.333;

  // --- title slide ---
  const t = pptx.addSlide();
  t.background = { color: BG };
  t.addShape(pptx.ShapeType.rect, { x: 0.7, y: 2.55, w: 1.6, h: 0.09, fill: { color: accent }, line: { type: "none" } });
  t.addText(String(deck.title || "Untitled deck"), { x: 0.7, y: 2.75, w: W - 1.4, h: 1.7, fontFace: FONT, fontSize: 44, bold: true, color: INK, align: "left", valign: "top" });
  if (deck.subtitle) t.addText(String(deck.subtitle), { x: 0.7, y: 4.5, w: W - 1.4, h: 1.0, fontFace: FONT, fontSize: 20, color: SEC, align: "left", valign: "top" });
  const footer = brand?.name ? String(brand.name) : "";
  if (footer) t.addText(footer, { x: 0.7, y: 6.9, w: W - 1.4, h: 0.4, fontFace: FONT, fontSize: 11, color: DIM, align: "left" });

  // --- content slides ---
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  slides.forEach((s, i) => {
    const sl = pptx.addSlide();
    sl.background = { color: BG };
    sl.addShape(pptx.ShapeType.rect, { x: 0.7, y: 0.75, w: 0.9, h: 0.08, fill: { color: accent }, line: { type: "none" } });
    sl.addText(String(s.title || `Slide ${i + 1}`), { x: 0.7, y: 0.95, w: W - 1.4, h: 1.0, fontFace: FONT, fontSize: 28, bold: true, color: INK, align: "left", valign: "top" });
    const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map((b) => String(b || "").trim()).filter(Boolean);
    if (bullets.length) {
      sl.addText(
        bullets.map((b) => ({ text: b, options: { bullet: { characterCode: "2022" }, color: SEC, fontSize: 18, paraSpaceAfter: 10 } })),
        { x: 0.9, y: 2.1, w: W - 1.8, h: 4.5, fontFace: FONT, valign: "top" },
      );
    }
    sl.addText(`${i + 1} / ${slides.length}`, { x: W - 1.7, y: 6.95, w: 1.1, h: 0.35, fontFace: FONT, fontSize: 10, color: DIM, align: "right" });
    const note = String(s.note || "").trim();
    if (note) sl.addNotes(note);
  });

  return pptx;
}
async function downloadPptx() {
  const r = state.run; if (!r || !r.deck) { toast("Draft a deck first.", true); return; }
  try {
    const pptx = buildPptx(r.deck);
    await pptx.writeFile({ fileName: slugify(r.deck.title) + ".pptx" });
    toast("PowerPoint saved ✓");
  } catch (e) { toast(msg(e), true); }
}

function autostart() {
  // THE COLD OPEN: connect with a lent brand and Deck is already drafting an overview deck on it,
  // ZERO input. Fires only when a brand context makes the run unambiguous; never over a saved run.
  if (state.run) return;
  if (brand) {
    const seed = `An overview deck for ${brand.name}${brand.data?.positioning ? " — " + brand.data.positioning : ""}${brand.data?.oneLiner ? " (" + brand.data.oneLiner + ")" : ""}. Use what you know about the brand to structure a clear investor/partner-ready story.`;
    void start(seed, true);
  }
}

async function start(input, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Paste notes, an outline, or a topic first.", true); return; }
  state.run = { id: uid(), input, fromContext: !!fromContext, steers: [], deck: null, raw: "", status: "", error: null };
  await saveState(); render();
  await run();
}

async function run(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "structuring the deck…"; render();
  try {
    const raw = await streamText({
      prompt: [
        `You are ${APP.name}, a sharp presentation designer. Turn the material below into a clean, well-structured slide deck.`,
        brand ? `LENT BRAND "${brand.name}" — write in its voice and frame the story for it. Context: ${JSON.stringify(brand.data || {}).slice(0, 1400)}` : "",
        r.fromContext ? "The user gave no notes — build the deck from the lent brand context above." : `THE MATERIAL:\n"""${r.input.slice(0, 14000)}"""`,
        r.steers.length ? `Steering (apply the latest, keep the rest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        [
          "Return ONE JSON object and NOTHING else — no prose, no markdown fences. Shape EXACTLY:",
          `{"title": <deck title, punchy, <=60 chars>, "subtitle": <one supporting line or "">, "slides": [ {"title": <slide title>, "bullets": [<3 to 5 short bullet strings, each <=120 chars, no leading dashes>], "note": <optional 1-2 sentence speaker note or "">} ]}`,
          "Rules: 5–9 content slides (fewer if the material is thin — never pad). Every bullet is a real point from the material, tightened — invent NOTHING that wasn't given or isn't true of the brand. Bullets are phrases, not sentences with periods. The title slide is separate (the top-level title/subtitle); do not repeat it as a content slide. Speaker notes are optional and terse.",
        ].join("\n"),
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2600,
    }, (p) => { if (p.text) { r.raw = p.text; const live = $("stream-live"); if (live) live.textContent = "drafting… " + p.text.slice(-140); } });
    r.raw = raw;
    const deck = parseJson(raw);
    if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) throw new Error("The deck didn't come back structured — try rephrasing, or steer it.");
    // normalize shape defensively
    deck.title = String(deck.title || r.input.slice(0, 60) || "Untitled deck");
    deck.subtitle = String(deck.subtitle || "");
    deck.slides = deck.slides.slice(0, 12).map((s) => ({
      title: String(s?.title || "").trim() || "Slide",
      bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map((b) => String(b || "").trim()).filter(Boolean).slice(0, 6),
      note: String(s?.note || "").trim(),
    }));
    r.deck = deck;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// ==== render ================================================================================
function slideCard(s, idx, total) {
  const card = el("div", "slide");
  const head = el("div", "slide-head");
  head.append(el("span", "slide-no", String(idx + 1).padStart(2, "0")));
  head.append(el("span", "slide-title", s.title));
  card.append(head);
  if (s.bullets && s.bullets.length) {
    const ul = el("ul", "slide-bullets");
    for (const b of s.bullets) ul.append(el("li", null, b));
    card.append(ul);
  }
  if (s.note) {
    const note = el("div", "slide-note");
    note.append(el("span", "note-tag", "speaker note"));
    note.append(el("span", "note-text", s.note));
    card.append(note);
  }
  return card;
}

function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample notes (connect to build your own deck)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "styled for your lent brand — " + brand.name));
    const osTitle = osCtxTitle();
    if (osTitle) startBox.append(el("div", "ctx", "Opened from Switchboard OS · " + osTitle));
    const row = el("div", "bindrow");
    const input = el("textarea");
    input.rows = 5;
    input.placeholder = "paste notes, an outline, or a topic…";
    // When the OS launched Deck AT an item, that carried title/topic seeds the source note.
    if (osTitle) input.value = osTitle;
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    const btn = el("button", "primary", "Build the deck 🖥"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    startBox.append(el("div", "hint", "⌘/Ctrl + Enter · title slide + content slides · export .pptx"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "building deck"), el("span", "run-input", r.input), el("span", "grow"));
  const dl = el("button", "act dl", "download .pptx"); dl.onclick = () => void downloadPptx(); dl.disabled = !r.deck;
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(dl, redo);
  col.append(bar);

  if (r.status) { const s = researching(r.status); const live = el("div", "stream-live"); live.id = "stream-live"; col.append(s, live); }
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void run();
    col.append(t);
  }
  if (r.deck) {
    const d = r.deck;
    col.append(el("div", "kicker sect", `the deck · ${d.slides.length + 1} slides`));
    const title = el("div", "slide title-slide");
    title.append(el("div", "accent-bar"));
    title.append(el("div", "ts-title", d.title));
    if (d.subtitle) title.append(el("div", "ts-sub", d.subtitle));
    if (brand?.name) title.append(el("div", "ts-foot", brand.name));
    col.append(title);
    d.slides.forEach((s, i) => col.append(slideCard(s, i, d.slides.length)));
    if (!running) col.append(steerRow((s) => void run(s)));
  }
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `deck_build` runs the SAME start() a paste-and-go click runs — the deck structures live in the DOM —
// then returns the deck's title and slide outline for God to speak, file, or hand onward. The user
// clicks "download .pptx" to get the PowerPoint (a browser download can't be initiated headlessly).
exposeToGod({
  name: "deck_build",
  description: "Turn notes, an outline, or a topic into a structured slide deck (a title slide plus content slides, each with a title, bullets, and an optional speaker note). Builds it live on the page and returns the outline; the user exports a real .pptx from the page.",
  inputSchema: { notes: "string — notes, an outline, or a topic to turn into a slide deck. Required." },
  execute: async ({ notes } = {}) => {
    const input = String(notes || "").trim();
    if (!input) throw new Error("nothing to build from — pass { notes } (notes, an outline, or a topic)");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Deck isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(input);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === input && (r.deck || r.error)) {
        if (r.error) throw new Error(r.error);
        const d = r.deck;
        const outline = [`# ${d.title}`, d.subtitle ? `_${d.subtitle}_` : "", ...d.slides.map((s, i) => `\n## ${i + 1}. ${s.title}\n` + s.bullets.map((b) => `- ${b}`).join("\n"))].filter(Boolean).join("\n");
        return { text: outline, title: d.title, slideCount: d.slides.length + 1 };
      }
    }
    throw new Error("Deck stayed busy — try again");
  },
});

// ---- The notch GLANCE: paste a topic → a slide outline at a glance (docs/WIDGETS.md, cards shape) --
// The producer reuses the pipeline: given an injected topic it drafts the deck, then returns each
// slide's title as a card (first bullet as its supporting line). No input → an honest prompt state.
exposeWidget(async (input) => {
  const topic = String((input && (input.text || input)) || "").trim();
  if (!topic) {
    return { kicker: "DECK · slide outline", title: "Drop a topic", openLabel: "Open Deck", shape: "text",
      result: { body: "Paste notes, an outline, or a topic to get a slide-by-slide outline — then export a real .pptx from the full app.", caption: "on your own Claude · via Switchboard" } };
  }
  if (!relay) {
    return { kicker: "DECK · slide outline", title: topic.slice(0, 40), openLabel: "Open Deck", shape: "text",
      result: { body: "Connect Switchboard to draft this deck on your own Claude.", caption: "not connected" } };
  }
  await start(topic);
  const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 100)); } return true; };
  await waitFor(() => !running, 180000);
  const r = state.run || {};
  if (r.error || !r.deck) return { kicker: "DECK · slide outline", title: topic.slice(0, 40), openLabel: "Open Deck", shape: "text", result: { body: r.error || "Couldn't structure a deck — open the app and steer it.", caption: "" } };
  const d = r.deck;
  const items = [{ label: d.title, text: d.subtitle || "title slide", recommended: true }].concat(
    d.slides.slice(0, 8).map((s) => ({ label: s.title, text: (s.bullets && s.bullets[0]) || "" })),
  );
  return {
    kicker: "DECK · slide outline",
    title: `${d.slides.length + 1} slides drafted`,
    openLabel: "Open Deck",
    shape: "cards",
    result: { caption: "export a real .pptx in the full app", items },
    copyText: [d.title, ...d.slides.map((s, i) => `${i + 1}. ${s.title}`)].join("\n"),
  };
});
