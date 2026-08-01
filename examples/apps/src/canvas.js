// CANVAS — describe a diagram, board, or layout in words → the visitor's OWN Claude writes a
// self-contained HTML/SVG document → it renders live in a sandboxed iframe → export the .html. The
// HTML capability made real, in the browser: it composes create-HTML, takes a single line, and runs
// on the user's own Claude at zero extra cost. Refine it the REDLINE way — describe a change, Claude
// returns a find/replace edit applied straight into the file. The document is the user's; the
// operator never sees it.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// God's hands: expose Canvas's generate step as a page-tool the native God webview (or any WebMCP
// host) can DRIVE — reusing the same start() a click runs.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const APP = {
  id: "canvas",
  name: "Canvas",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Canvas — turns a line of description into an editable diagram or board, rendered as a self-contained HTML document on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text/markup only — the diagram is a self-contained .html
  },
  usesContext: "single",                        // a lent context can seed the diagram (e.g. a brand's flow)
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 160);
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function stripFences(s) { return String(s || "").replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim(); }
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

// ==== house UI atoms ========================================================================
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Describe a diagram, board, or layout in one line";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · It renders live — refine it, then download the .html";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// CANVAS — ONE line describing a diagram/board/flow → Claude writes a COMPLETE self-contained HTML
// document (dark canvas, ink text, one lime accent, ~1000×700) → render it live in a SANDBOXED
// iframe → REFINE the Redline way: describe a change, Claude returns a find/replace edit applied
// straight into the file. Download the .html. Text/markup only — no tools, no image gen.

const DIAGRAM_SYSTEM = `You are Canvas, a diagram engine. You output ONE complete, self-contained HTML document that lays out a clean, editable diagram, board, or flow.

Hard requirements — every one matters:
- ONE complete html document, starting with <!doctype html>. Inline <style> (and inline SVG or a little inline JS if a layout needs it). NO external URLs of any kind (no CDNs, fonts, images, or scripts) — use system-ui and draw everything with HTML/CSS/SVG.
- Visual system: background #000 (pure black), ink text #E8EDF4, EXACTLY ONE accent colour #C8F250 (lime) used sparingly for emphasis/edges/keys. font-family: system-ui, sans-serif. Muted secondary text around #99A3B7. Thin hairline borders around #262C38.
- Size: design for roughly 1000×700; center the diagram with generous whitespace. It must never need scrolling to read the structure.
- It must READ as a real diagram/board/flow — nodes with clear labels, connectors/arrows where a flow implies them, columns for a board, a legend if it helps. Clean, aligned, legible. No lorem ipsum — write real labels from the brief.
- No console errors. No TODOs. No placeholder comments — finished code only.

Respond with ONLY the html document. No prose, no markdown fences.`;

const STEER_CHIPS = ["more nodes", "cleaner layout", "add a legend", "tighter labels"];
let running = false;

function autostart() {
  if (state.run) { state.run.status = ""; render(); return; }
  // THE COLD OPEN: connect with a lent brand and Canvas is already drawing a diagram OF it — its
  // flow, its architecture, its board — a diagram materializes in the preview with zero input.
  if (brand) {
    const seed = "a clean architecture / flow diagram for " + brand.name + (brand.data?.positioning ? " — " + String(brand.data.positioning).slice(0, 200) : "");
    void start(seed);
  }
}

function contextBrief() {
  if (!brand) return "";
  const d = brand.data || {};
  return [
    `The diagram is for the lent brand "${brand.name}".`,
    d.positioning ? `Brand positioning (grounds the content): ${String(d.positioning).slice(0, 240)}` : "",
    Array.isArray(d.products) && d.products.length ? `Its products/pieces (candidate nodes): ${d.products.map((p) => (typeof p === "string" ? p : (p?.name || p?.title || ""))).filter(Boolean).slice(0, 8).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Describe the diagram in one line first.", true); return; }
  state.run = { id: uid(), input, html: "", edits: [], status: "", error: null };
  await saveState(); render();
  await generate();
}

async function generate() {
  const r = state.run; if (!r || !relay) return;
  running = true; r.error = null; r.html = ""; r.status = "drawing the diagram… (0 kb)"; render();
  let acc = "";
  try {
    const text = await streamText({
      prompt: [
        `You are a diagram engine. Output ONLY one self-contained HTML document (no fences), dark #000 bg, ink #E8EDF4, ONE lime #C8F250 accent, system-ui, ~1000x700, that lays out as a clean diagram/board/flow: ${r.input}`,
        brand ? contextBrief() : "",
      ].filter(Boolean).join("\n\n"),
      system: DIAGRAM_SYSTEM,
      maxTokens: 12000,
    }, (p) => {
      if (p.text) {
        acc = p.text;
        const s = $("build-status"); if (s) s.textContent = "drawing the diagram… (" + (acc.length / 1024).toFixed(1) + " kb)";
        // Stream the document into the live preview as it writes — prefer the extracted HTML once the
        // doctype/svg lands, and fall back to the raw text so the frame fills the moment tokens arrive.
        const fr = $("cv-frame"); if (fr && acc.length % 400 < 40) fr.srcdoc = extractHtml(acc) || stripFences(acc);
      }
    });
    const html = extractHtml(text);
    if (!html) throw new Error("the diagram didn't come back as HTML — hit ↻ regenerate (it usually lands on the second pull)");
    r.html = html;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Doctype-sniff extraction: pull the complete HTML document out, tolerating any stray prose/fences.
function extractHtml(text) {
  let t = String(text || "").replace(/```(?:html)?/gi, "").trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start !== -1) {
    const end = t.lastIndexOf("</html>");
    if (end > start) return t.slice(start, end + "</html>".length);
    return t.slice(start); // still streaming — return what we have so far
  }
  // No doctype/html yet — accept a bare SVG document too (a valid self-contained diagram).
  const svg = t.search(/<svg[\s>]/i);
  if (svg !== -1) { const e = t.lastIndexOf("</svg>"); return e > svg ? t.slice(svg, e + "</svg>".length) : t.slice(svg); }
  return null;
}

// REFINE — the carved Redline write-loop: a plain-language change → a find/replace edit into the file.
async function refine(instruction) {
  const r = state.run; if (!r || !relay || running) return;
  instruction = String(instruction || "").trim(); if (!instruction) return;
  running = true; r.error = null; r.status = "editing the diagram…"; render();
  try {
    const out = await askJson([
      "You edit a diagram's HTML by returning ONE find/replace. The FIND must be an EXACT unique substring of the SOURCE.",
      `THE CHANGE THE USER WANTS: "${instruction}"`,
      'Return ONLY JSON: {"find":<exact unique substring to change, ≤400 chars>,"replace":<the edited substring>}. If the change needs more than one edit, make the single most impactful one. Keep the visual system: #000 bg, #E8EDF4 ink, #C8F250 accent, system-ui.',
      "SOURCE:\n" + r.html.slice(0, 14000),
    ]);
    if (!out || !out.find || out.replace == null) throw new Error("no edit came back — rephrase");
    const applied = applyEdit(r.html, out.find, out.replace);
    if (!applied.ok) throw new Error("couldn't place that edit — try describing it differently");
    r.html = applied.next; r.edits.push(instruction);
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// carved verbatim-in-spirit from redline.js applyEdit — exact-single-match, then whitespace-flexible
function applyEdit(html, find, replace) {
  if (typeof find !== "string" || !find) return { ok: false };
  const first = html.indexOf(find);
  if (first !== -1 && html.indexOf(find, first + find.length) === -1) return { ok: true, next: html.slice(0, first) + replace + html.slice(first + find.length) };
  const pat = find.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  try { const re = new RegExp(pat, "g"); const m = html.match(re); if (m && m.length === 1) { const x = new RegExp(pat).exec(html); return { ok: true, next: html.slice(0, x.index) + replace + html.slice(x.index + x[0].length) }; } } catch { /* bad regex */ }
  return { ok: false };
}
function download() {
  const r = state.run; if (!r?.html) return;
  const blob = new Blob([r.html], { type: "text/html" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  const slug = (r.input || "diagram").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  a.download = (slug || "canvas-" + r.id) + ".html"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
    if (brand) startBox.append(el("div", "ctx", "diagram for your lent context — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("textarea");
    input.rows = 2;
    input.placeholder = brand ? "one line — the diagram to draw (or hit Draw to map " + brand.name + ")" : "one line — e.g. a signup flow with email, verify, and onboarding steps";
    const go = () => { if (input.value.trim()) void start(input.value); else if (brand) void start(""); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    const btn = el("button", "primary", "Draw it ▸"); btn.onclick = go;
    row.append(input, btn); startBox.append(row);
    startBox.append(el("div", "hint", "Enter to draw · a self-contained diagram, on your own Claude"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "diagram"), el("span", "run-input", r.input), el("span", "grow"));
  if (r.html && !running) {
    const rg = el("button", "act", "↻ regenerate"); rg.onclick = () => void generate(); bar.append(rg);
    const dl = el("button", "act", "⬇ download .html"); dl.onclick = download; bar.append(dl);
  }
  const nu = el("button", "act", "× new"); nu.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(nu); view.append(bar);

  if (r.status) { const w = researching(r.status); const live = w.querySelector("span"); if (live) live.id = "build-status"; view.append(w); }
  if (r.error) view.append(el("div", "err", r.error));

  // live preview — SANDBOX: allow-scripts ONLY → opaque origin. The model-written document can't
  // reach window.claude, this page's storage, or its grant. The airgap holds for the user's own
  // Claude's output. (SVG-only diagrams need no scripts; a doc with inline JS still runs safely.)
  const wrap = el("div", "cv-wrap");
  const frame = el("iframe"); frame.id = "cv-frame"; frame.className = "cv-frame"; frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", r.input || "your diagram");
  if (r.html) frame.srcdoc = r.html;
  wrap.append(frame); view.append(wrap);

  if (r.html && !running) {
    view.append(el("div", "kicker sect", "refine it — describe any change"));
    const refBox = el("div", "bindrow");
    const input = el("input"); input.placeholder = "e.g. add a payment step after verify, and colour the exit red";
    const go = () => { const t = input.value.trim(); if (t) { input.value = ""; void refine(t); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const b = el("button", "primary", "Edit"); b.onclick = go;
    refBox.append(input, b); view.append(refBox);
    const chips = el("div", "chips");
    for (const s of STEER_CHIPS) { const c = el("button", "chip", s); c.onclick = () => void refine(s); chips.append(c); }
    view.append(chips);
    if (r.edits.length) { const log = el("div", "cv-edits"); log.textContent = "edits: " + r.edits.slice(-4).join(" · "); view.append(log); }
  }
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `canvas_run` runs the SAME start() a describe-and-go click runs — Claude writes the complete
// self-contained diagram document into the live preview — then returns the document HTML for God.
// Refining the diagram is a follow-on human act and stays out of this tool.
exposeToGod({
  name: "canvas_run",
  description: "Describe a diagram, board, or layout in words and get an editable, self-contained HTML document. Renders it live on the page and returns the document HTML.",
  inputSchema: { prompt: "string — one line describing the diagram/board/layout to draw. Required." },
  execute: async ({ prompt } = {}) => {
    const val = String(prompt || "").trim();
    if (!val) throw new Error("nothing to draw — pass { prompt } with one line describing the diagram");
    // God may call before connect finishes, and while the context-first cold-open is still drawing.
    // start() early-returns while a run is in flight, so wait for connect, then for idle, run, and
    // confirm the settled run is OURS (same input) with a result; if a cold-open shadowed us, retry.
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Canvas isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);   // let any in-flight run finish before we take the wheel
      await start(val);                         // generate, awaited
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === val && (r.html || r.error)) {
        if (r.error) throw new Error(r.error);
        return { html: r.html };
      }
    }
    throw new Error("Canvas stayed busy — try again");
  },
});
