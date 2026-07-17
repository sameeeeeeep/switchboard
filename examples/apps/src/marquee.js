// MARQUEE — a scrollable, cinematic landing page (secretslumberparty energy) from one line, on the
// visitor's OWN Claude. Claude writes a complete scroll-driven HTML page (full-viewport sections,
// reveal-on-scroll, Higgsfield hero art); you refine it the REDLINE way — describe a change, Claude
// makes a find/replace edit into the file (the carved applyEdit write-loop). Download the .html, or
// hand it to Reel for an mp4. The page is the user's; the operator never sees it.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "marquee",
  name: "Marquee",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Marquee — generates a cinematic scrolling landing page on your own Claude + Higgsfield, and edits it in place",
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
// MARQUEE — ONE line → Claude writes a COMPLETE scroll-driven landing page (self-contained HTML,
// reveal-on-scroll, cinematic full-viewport sections) → paint the hero on Higgsfield and weave it
// in → preview live → REFINE the Redline way: describe a change, Claude returns a find/replace edit
// applied straight into the file (the carved applyEdit write-loop). Download the .html.

const STEER_CHIPS = ["bolder type", "add a section", "calmer palette", "tighten the copy"];
let running = false;

function autostart() {
  if (state.run) { state.run.status = ""; render(); return; }
  // THE COLD OPEN: connect with a lent brand and Marquee is already writing the page + painting the
  // hero — a scrolling landing page materializes in the preview with zero input.
  if (brand) { const seed = "a landing page for " + brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("One line on the page first.", true); return; }
  state.run = { id: uid(), input, html: "", edits: [], status: "", error: null, heroUrl: null };
  await saveState(); render();
  await generate();
}

async function generate() {
  const r = state.run; if (!r || !relay) return;
  running = true; r.error = null; r.status = "writing the page…"; render();
  try {
    const html = await streamText({
      prompt: [
        "You are Marquee, writing a complete, cinematic, SCROLL-DRIVEN landing page as a single self-contained HTML document (inline CSS + a little inline JS; no external files except fonts from Google Fonts).",
        `THE BRIEF: "${r.input}"`,
        brand ? `LENT BRAND "${brand.name}" — match its voice, and use its palette: ${JSON.stringify(brand.data?.palette || brand.data).slice(0, 1200)}` : "",
        "Requirements: 5–7 FULL-VIEWPORT (100vh) sections stacked vertically; each reveals on scroll (IntersectionObserver toggling a class, with CSS transitions — fade + rise). Big display type, generous whitespace, one accent color, a sticky mini-nav, a final call-to-action. Feel: premium, editorial, a little dreamy — like a landing page that plays like a video as you scroll. Use a placeholder hero with id=\"hero-img\" (a full-bleed <div> with a background gradient) that a real image can later replace. NO lorem ipsum — write real copy from the brief.",
        "Return ONLY the HTML document, starting with <!doctype html>. No prose, no fences.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 8000,
    }, (p) => { if (p.text) { r.html = p.text; const fr = $("mq-frame"); if (fr && p.text.length % 400 < 40) fr.srcdoc = stripFences(p.text); } });
    r.html = stripFences(r.html);
    if (!/<[a-z]/i.test(r.html)) throw new Error("the page didn't come back as HTML — try again");
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.html && !r.error && !r.heroUrl) void paintHero();
}

async function paintHero() {
  const r = state.run; if (!r || !relay || !r.html.includes("hero-img")) return;
  r.status = "painting the hero on your Higgsfield…"; render();
  try {
    const url = await genImage(`Cinematic full-bleed hero image for a landing page: ${r.input}. Atmospheric, premium, no text.${brand?.data?.palette ? " Palette: " + brand.data.palette.slice(0, 3).join(", ") : ""}`);
    if (url) {
      // weave the image into the hero div's background — a find/replace, the same primitive as refine
      const next = r.html.replace(/(id=["']hero-img["'][^>]*style=["'][^"']*)/i, `$1;background-image:url('${url}');background-size:cover;background-position:center`);
      if (next !== r.html) { r.html = next; r.heroUrl = url; }
      else { r.heroUrl = url; toast("Hero painted — add it via a refine if it didn't land."); }
    }
  } catch { /* hero is optional polish */ }
  r.status = ""; await saveState(); render();
}

// REFINE — the carved Redline write-loop: a plain-language change → a find/replace edit into the file.
async function refine(instruction) {
  const r = state.run; if (!r || !relay || running) return;
  instruction = String(instruction || "").trim(); if (!instruction) return;
  running = true; r.error = null; r.status = "editing the page…"; render();
  try {
    const out = await askJson([
      "You edit a landing page's HTML by returning ONE find/replace. The FIND must be an EXACT unique substring of the SOURCE.",
      `THE CHANGE THE FOUNDER WANTS: "${instruction}"`,
      'Return ONLY JSON: {"find":<exact unique substring to change, ≤400 chars>,"replace":<the edited substring>}. If the change needs more than one edit, make the single most impactful one.',
      "SOURCE:\n" + r.html.slice(0, 12000),
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
function stripFences(s) { return String(s || "").replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/i, "").trim(); }
function download() {
  const r = state.run; if (!r?.html) return;
  const blob = new Blob([r.html], { type: "text/html" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "landing.html"; a.click();
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
    if (brand) startBox.append(el("div", "ctx", "page for your lent brand — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — what's the landing page for?";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Build the page ▸"); btn.onclick = go;
    row.append(input, btn); startBox.append(row); view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "page"), el("span", "run-input", r.input), el("span", "grow"));
  if (r.html && !running) {
    const rg = el("button", "act", "↻ regenerate"); rg.onclick = () => void generate(); bar.append(rg);
    const dl = el("button", "act", "⬇ download .html"); dl.onclick = download; bar.append(dl);
  }
  const nu = el("button", "act", "× new"); nu.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(nu); view.append(bar);

  if (r.status) view.append(researching(r.status));
  if (r.error) { view.append(el("div", "err", r.error)); }

  // live preview — the page runs its own scroll JS, so allow-scripts (it's the user's own Claude's output)
  const wrap = el("div", "mq-wrap");
  const frame = el("iframe"); frame.id = "mq-frame"; frame.className = "mq-frame"; frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  if (r.html) frame.srcdoc = r.html;
  wrap.append(frame); view.append(wrap);

  if (r.html && !running) {
    view.append(el("div", "kicker sect", "refine it — describe any change"));
    const refBox = el("div", "bindrow");
    const input = el("input"); input.placeholder = "e.g. make the headline bigger and the hero darker";
    const go = () => { const t = input.value.trim(); if (t) { input.value = ""; void refine(t); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const b = el("button", "primary", "Edit"); b.onclick = go;
    refBox.append(input, b); view.append(refBox);
    if (r.edits.length) { const log = el("div", "mq-edits"); log.textContent = "edits: " + r.edits.slice(-4).join(" · "); view.append(log); }
  }
}
render();
