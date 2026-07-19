// Storybook — one idea → an illustrated children's picture book, your character as the hero, on the
// visitor's OWN Claude. The operator holds no key, pays for no inference, and never sees the user's
// story — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from redline.js) — kept byte-identical. Stage 1 is ONE text-only
// askJsonArray → three book concepts as option cards (never gated on an image). Stage 2 writes the
// pages (a second text turn) THEN illustrates each page on the user's Higgsfield, one consistent
// style — image generation is a separate per-page pass that runs AFTER the pages are on screen
// (the studio.js / imagegen.js reliability shape).
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "storybook",                              // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Storybook",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Storybook — writes an illustrated children's picture book from your one line and draws every page on your own Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // the per-page illustrations render on the user's Higgsfield
  },
  usesContext: "single",                        // a lent brand becomes the hero (mascot / founder book)
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
// Storybook's pipeline: ONE line (the story idea + who the hero is) → STAGE 1 proposes three book
// concepts as option cards (title + arc + age band, one recommended, auto-selected) → STAGE 2 writes
// the pages (one text turn), renders them, THEN illustrates each page on the user's Higgsfield in one
// consistent style. Stage 1 NEVER waits on an image; illustration is a separate per-page pass that
// only starts once the words are on screen (the studio.js / imagegen.js reliability shape). Picking a
// different concept or steering re-writes the book; each page can be redrawn on its own.

const STEER_CHIPS = ["gentler", "funnier", "simpler words", "more pages", "new art style"];
let running = false;      // a STAGE-1/2 text turn is in flight (image passes are tracked separately)
let illusRun = 0;         // illustration run token — a re-draft / start-over abandons the stale pass

function autostart() {
  // THE COLD OPEN — the strongest selling moment: when a brand is lent, Storybook writes and draws a
  // whole book about that brand's mascot / founder with ZERO input. Connect Switchboard and a picture
  // book is already being made on your world — no form, no prompt, no button. Fire only when the lent
  // context makes the run unambiguous, and never re-fire over a saved run.
  if (state.run) return;
  if (brand) {
    const d = brand.data || {};
    const world = d.positioning || d.voice || d.audience || "";
    const seed = `A children's picture book starring ${brand.name}${world ? ` — ${world}` : ""}, as the hero of its own adventure`;
    void start(seed);
  }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it a story idea and a hero first.", true); return; }
  illusRun++; // any prior illustration pass is now stale
  state.run = { id: uid(), input, books: null, selectedId: null, steers: [], book: null, status: "", error: null };
  await saveState(); render();
  await proposeBooks();
}

// STAGE 1 — three book concepts, one text-only turn, rendered as option cards. No image here.
async function proposeBooks() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "dreaming up three books…"; render();
  try {
    const arr = await askJsonArray([
      `You are Storybook, an award-winning children's picture-book author.`,
      `The reader gave you this story idea and hero: "${r.input}".`,
      brand ? `A brand is lent as the hero's world — draw the hero from it (its mascot, founder, or product world) and match its voice: ${JSON.stringify(brand.data).slice(0, 1800)}` : "",
      r.steers.length ? `Keep these wishes in mind: ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Propose 3 DISTINCT picture-book concepts for the SAME hero — different tones, arcs, or worlds.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the book title, 2–5 words>,"text":<one warm sentence describing the story arc>,"age":<age band like "Ages 3–5">,"recommended":<true for exactly one, the strongest>}',
    ]);
    if (!arr || !arr.length) throw new Error("no book ideas came back — try again");
    r.books = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || "Untitled").slice(0, 70),
      text: String(o.text || "").slice(0, 240),
      age: String(o.age || "").slice(0, 24),
      recommended: !!o.recommended,
    }));
    if (!r.books.some((o) => o.recommended)) r.books[0].recommended = true;
    r.selectedId = (r.books.find((o) => o.recommended) || r.books[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.books && !r.error) await writeBook(r.selectedId); // ONE-GO: auto-advance on the recommended concept
}

// STAGE 2a — write the pages (one text turn: title + a locked art style + a locked hero + page lines).
async function writeBook(id, steer) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  const concept = (r.books || []).find((o) => o.id === id); if (!concept) return;
  if (steer) r.steers.push(steer);
  illusRun++; // supersede any illustration pass already running on an older book
  running = true; r.error = null; r.book = null; r.status = "writing the pages…"; render();
  try {
    const obj = await askJson([
      `You are Storybook, an award-winning children's picture-book author and illustrator.`,
      `Story idea and hero (from the reader): "${r.input}".`,
      `Write THIS book: "${concept.label}" — ${concept.text}.${concept.age ? ` Target age band: ${concept.age}.` : ""}`,
      brand ? `The hero is drawn from this lent brand (mascot / founder / product world); match its voice and world: ${JSON.stringify(brand.data).slice(0, 1800)}` : "",
      r.steers.length ? `Revisions — apply the latest: ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Write a complete picture book of 6–8 pages. Simple, warm language for the age band; one or two short sentences per page; a gentle arc with a satisfying ending.",
      "Lock ONE illustration style and ONE hero description so every page reads as the same book.",
      'Return ONLY a JSON object — no prose, no fences — exactly: {"title":<book title>,"style":<one line: the art medium, palette and mood used on EVERY page>,"hero":<one line: the hero\'s exact look, so it stays identical page to page>,"pages":[{"text":<the words on this page, 1–2 short sentences>,"scene":<what to illustrate: subject, action, setting — never any text in the picture>}]}',
    ]);
    const pages = Array.isArray(obj?.pages) ? obj.pages : null;
    if (!pages || !pages.length) throw new Error("the pages came back malformed — try again");
    r.book = {
      title: String(obj.title || concept.label).slice(0, 100),
      style: String(obj.style || "warm hand-painted watercolor, soft rounded shapes").slice(0, 300),
      hero: String(obj.hero || "").slice(0, 300),
      age: concept.age,
      pages: pages.slice(0, 10).map((p) => ({
        id: uid(),
        text: String(p?.text || "").slice(0, 400),
        scene: String(p?.scene || p?.text || "").slice(0, 400),
        url: null,
        imgStatus: "queued",
        imgError: null,
      })).filter((p) => p.text || p.scene),
    };
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.book && !r.error) await illustrateBook(); // STAGE 2b — the pages are on screen; draw them now
}

// STAGE 2b — illustrate every page on the user's Higgsfield, one page at a time, in the locked style.
// This runs ONLY after the words render. genImage carries its own per-generation consent.
function illusPrompt(book, page) {
  return [
    "Children's picture book illustration, a single warm scene, NO text, letters, words or numbers anywhere in the image.",
    `Consistent art style across the whole book: ${book.style}.`,
    book.hero ? `The recurring hero stays visually identical on every page: ${book.hero}.` : "",
    `This page shows: ${page.scene}`,
  ].filter(Boolean).join(" ");
}

async function illustrateBook() {
  const r = state.run; if (!r || !r.book || !relay) return;
  const run = ++illusRun;
  const book = r.book;
  for (const page of book.pages) {
    if (run !== illusRun) return;       // a re-draft or start-over superseded this pass
    if (page.url) continue;             // already drawn (a returning user's finished book)
    await drawPage(page, run);
  }
}

// One hardened page render — the auto pass AND the per-page "redraw" both call this. run=null means a
// standalone manual redraw that no illustration-pass token can cancel.
async function drawPage(page, run) {
  const r = state.run; if (!r || !r.book || !relay) return;
  page.imgStatus = "drawing"; page.imgError = null; page.url = null; render();
  try {
    const url = await genImage(illusPrompt(r.book, page));
    if (run != null && run !== illusRun) return; // superseded mid-draw
    if (!url) throw new Error("no image came back — Redraw usually lands it");
    page.url = url; page.imgStatus = "done";
  } catch (e) {
    if (run != null && run !== illusRun) return;
    page.imgStatus = "error"; page.imgError = msg(e);
  }
  await saveState(); render();
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
    if (brand) startBox.append(el("div", "ctx", "working with your lent world — " + brand.name + " · connect fires a book automatically"));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — the story, and who the hero is (e.g. “Maya, who’s scared of the dark, meets a friendly star”)";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Make the book"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "story"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ new story");
  redo.onclick = () => { illusRun++; state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.books) {
    col.append(el("div", "kicker sect", "pick a book"));
    col.append(optionCards(
      r.books.map((b) => ({ id: b.id, label: b.label, text: b.age ? `${b.text}\n${b.age}` : b.text, recommended: b.recommended })),
      r.selectedId,
      (o) => void writeBook(o.id),
    ));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.books ? void writeBook(r.selectedId) : void proposeBooks());
    col.append(t);
  }

  if (r.book) {
    const book = r.book;
    col.append(el("div", "kicker sect", "your picture book"));
    col.append(el("div", "book-title", book.title));
    const bits = [`${book.pages.length} page${book.pages.length === 1 ? "" : "s"}`];
    if (book.age) bits.push(book.age);
    if (book.style) bits.push(book.style.split(",")[0].trim());
    col.append(el("div", "book-meta", bits.join(" · ")));

    const drawn = book.pages.filter((p) => p.url).length;
    const drawing = book.pages.some((p) => p.imgStatus === "drawing");
    if (drawing || drawn < book.pages.length) {
      const note = el("div", "illus-note");
      note.append(el("div", "scan"), el("span", null, drawing
        ? `illustrating on your Higgsfield — ${drawn}/${book.pages.length} pages · one consent per page`
        : `${drawn}/${book.pages.length} pages illustrated · redraw any page below`));
      col.append(note);
    }

    const pages = el("div", "pages");
    book.pages.forEach((p, i) => pages.append(pageEl(book, p, i)));
    col.append(pages);

    if (!running) col.append(steerRow((s) => void writeBook(r.selectedId, s)));
  }

  view.append(col);
}

// A single spread: the illustration (or its placeholder / error), the page's words, and per-page tools.
function pageEl(book, page, idx) {
  const card = el("div", "page");
  const illus = el("div", "page-illus");
  illus.append(el("span", "page-n", "PAGE " + (idx + 1)));
  if (page.url) {
    const img = el("img"); img.src = page.url; img.alt = page.scene || ("page " + (idx + 1)); img.loading = "lazy";
    img.addEventListener("error", () => { page.url = null; page.imgStatus = "error"; page.imgError = "the image link expired — redraw it"; render(); });
    illus.append(img);
  } else if (page.imgStatus === "error") {
    const f = el("div", "fail");
    f.append(el("div", null, "couldn't draw this page"));
    if (page.imgError) f.append(el("div", null, page.imgError));
    illus.append(f);
  } else {
    const ph = el("div", "ph");
    ph.append(el("div", "scan"), el("span", null, page.imgStatus === "drawing" ? "drawing…" : "waiting to draw"));
    illus.append(ph);
  }
  const body = el("div", "page-body");
  body.append(el("div", "page-line", page.text || page.scene));
  const tools = el("div", "page-tools");
  if (page.imgStatus !== "drawing") {
    const redraw = el("button", "mini", page.url ? "redraw" : "draw");
    redraw.onclick = () => void drawPage(page, null);
    tools.append(redraw);
  }
  if (page.url) {
    const dl = el("a", "mini", "save"); dl.href = page.url; dl.target = "_blank"; dl.rel = "noopener";
    dl.download = "storybook-page-" + (idx + 1) + ".png";
    tools.append(dl);
  }
  body.append(tools);
  card.append(illus, body);
  return card;
}

render();
