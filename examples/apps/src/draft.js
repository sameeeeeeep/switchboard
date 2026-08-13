// DRAFT — the front-end of the notch "select-and-say" edit loop. Topic + a format + a count in, N
// distinct pieces out on the visitor's OWN Claude — then SELECT any piece, SAY a steer, and re-run
// JUST that piece in place. The valuable middle (the voice rule, the format guides, the batch/revise
// prompts, the lenient parsing) lives in src/core/draft.core.js — ONE definition, shared with the MCP
// connector and the launcher's compose layer. This file is TEMPLATE PLUMBING + the app: the block
// between here and "APP LOGIC" is proven idiom (distilled from batch.js / reachout.js) — keep it
// byte-identical; edit the CONFIG block and everything below.
//
// House doctrine (all five): context-first · single input · options with exactly ONE recommended ·
// house design system (the shared kit carries it) · one-go pipeline the user can steer anywhere.
//
// SELECT-AND-SAY is the whole point. Each drafted piece is its own card; the steerRow under it is the
// per-piece "say". Typing a steer → revise({ piece, steer, brief }, relay) → the returned body
// replaces THAT piece's body in state, re-rendered in place and flagged re-drafted. steers[] accrue
// per piece, latest-wins — the same contract reachout/batch use.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { optionCards, steerRow, researching } from "./kit/ui.js";
// God's hand: expose Draft's primary action (draft N pieces of a format) as a page-tool the native God
// webview (or any WebMCP host) can DRIVE — reusing the same start() a click runs.
import { exposeToGod } from "./kit/webmcp.js";
// Carried context: when the Switchboard OS / launcher opens Draft AT an item, seed the topic from it.
import { readOsContext } from "./os/os-context.js";
import { FORMAT_OPTIONS, FORMATS, draft as draftPieces, revise as revisePiece } from "./core/draft.core.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const APP = {
  id: "draft",
  name: "Draft",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Draft — writes N distinct social posts (X, LinkedIn, Instagram) on your own Claude, grounded only in your brief, then re-runs any single piece from a steer (select-and-say)",
    models: ["sonnet"],
    tools: [], // pure model call — no connector grant (see draft.core.js)
  },
  usesContext: "single", // a lent brand/idea context becomes the voice/angle brief
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 200);
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3400);
}

// carried context — the OS/launcher may open Draft AT an item; seed the topic from it. Safe no-op
// when absent (bad hash → null → "").
const OS_CTX = readOsContext();
function osCtxTitle() {
  const c = OS_CTX; if (!c) return "";
  if (typeof c.artifact === "string") return c.artifact.slice(0, 200);
  if (c.artifact && typeof c.artifact.title === "string") return c.artifact.title.slice(0, 200);
  if (typeof c.term === "string") return c.term.slice(0, 200);
  return "";
}

// ==== connect (standard chip + returning-user probe) ========================================
let relay = null;
let notInstalled = false;
let brand = null;   // the ONE lent context, when APP.usesContext === "single"
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

// onReady fires TWICE by design — mountConnect's onConnect AND the returning-user probe, whichever
// wins the race. Hydrating from storage on BOTH passes is a real (timing-dependent) bug: the second
// pass re-reads the run the first pass just saved, REPLACING the in-memory object a running pipeline
// still holds a reference to. Hydrate once. (Learned the hard way in batch.js.)
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render(); autostart();
}

// CONTEXT-FIRST: the moment a context is lent, the brief (voice/angle/audience) derives from it — see
// draft.core.normalizeBrief. Hardcoded samples are allowed ONLY pre-connect, visibly labeled.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON; keys are filenames, no ":") =====
let state = { run: null };
async function loadState() { try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { run: null }; } }
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== house UI atoms (steer chips + connect steps) ==========================================
const STEER_CHIPS = ["plainer words", "more concrete", "shorter", "different angle", "less salesy"];

function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Topic + a format — it drafts a few distinct pieces";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Select any piece, say what to change, it re-runs just that one";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// A run = one topic × one format × N pieces. Each piece is independent and editable in place: its own
// card, its own steers[], its own re-draft. There is no "pick one winner" here (that's batch/reachout);
// every piece is a keeper you can steer. The format picker is the doctrine's options-with-one-
// recommended slate; the count is a small stepper; the topic is the single free-text input.

const COUNT_OPTIONS = [1, 3, 5];
let running = false;                 // a batch draft is in flight
let topicText = "";                  // the single input
let formatChoice = (FORMAT_OPTIONS.find((f) => f.recommended) || FORMAT_OPTIONS[0]).id;
let countChoice = 3;

// The brief handed to draft/revise. Passing the lent context object keeps draft AND every later revise
// grounded in the SAME voice; when nothing is lent we pass undefined so the core falls back to the
// active context itself (identical result, one fewer round-trip here).
function activeBrief() { return brand || undefined; }
function formatLabel(id) { return FORMATS[id]?.label || id; }

// ---- the batch draft (the "one-go" pipeline) ----
async function start(topic) {
  if (!relay || running) return;
  topic = String(topic || "").trim();
  const format = formatChoice;
  const n = Math.max(1, Number(countChoice) || 3);
  state.run = { id: uid(), topic, format, n, status: "", pieces: [] };
  await saveState(); render();
  await draftAll();
}

async function draftAll() {
  const r = state.run; if (!r || !relay || running) return;
  running = true;
  r.status = `drafting ${r.n} ${formatLabel(r.format).toLowerCase()}${r.n === 1 ? "" : "s"}…`;
  r.error = null;
  render();
  try {
    const out = await draftPieces({ format: r.format, topic: r.topic, n: r.n, brief: activeBrief() }, relay);
    const pieces = (out?.pieces || []).filter((p) => (p.body || "").trim());
    if (!pieces.length) throw new Error("nothing came back — try again");
    r.pieces = pieces.map((p) => ({
      id: uid(),
      format: p.format || r.format,
      hook: p.hook || "",
      body: p.body || "",
      steers: [],
      redrafted: false,
      busy: false,
      error: null,
    }));
  } catch (e) {
    r.error = msg(e);
  }
  running = false; r.status = "";
  await saveState(); render();
}

// ---- SELECT-AND-SAY: the primitive. steerRow(piece).onSteer → here → revise() → swap body in place.
//   1. push the typed words onto THIS piece's steers[] (latest wins, same contract as batch/reachout)
//   2. revise({ piece:{format,body}, steers, brief }, relay) — re-runs ONLY this piece on your Claude
//   3. replace this piece's body/hook in state, flag it re-drafted, re-render (in place)
// A per-piece `busy` flag freezes only that card's steer controls, so steering one piece never blocks
// the others — you can nudge three pieces at once.
async function steerOne(id, steer) {
  const r = state.run; if (!r || !relay) return;
  const p = r.pieces.find((x) => x.id === id); if (!p || p.busy) return;
  const s = String(steer || "").trim(); if (!s) return;
  p.steers.push(s);
  p.busy = true; p.error = null;
  render();
  try {
    const out = await revisePiece({ piece: { format: p.format, body: p.body }, steers: p.steers, brief: activeBrief() }, relay);
    const next = out?.piece;
    if (!next || !(next.body || "").trim()) throw new Error("no revision came back");
    p.body = next.body;
    p.hook = next.hook || p.hook;
    p.format = next.format || p.format;
    p.redrafted = true;
  } catch (e) {
    p.error = msg(e);
    toast(msg(e), true);
  }
  p.busy = false;
  await saveState(); render();
}

function newRun() { state.run = null; topicText = ""; void saveState(); render(); }

// ---- export (copy / download the whole batch as .md) ----
function runMd() {
  const r = state.run;
  const L = [
    `# Draft — ${formatLabel(r.format)}${r.topic ? ` · ${r.topic.slice(0, 80)}` : ""}`,
    "",
    `> ${r.pieces.length} piece${r.pieces.length === 1 ? "" : "s"} drafted on your own Claude${brand ? `, grounded in “${brand.name}”` : ""} — nothing fabricated. Edit into your own voice before posting.`,
    "",
  ];
  r.pieces.forEach((p, i) => {
    L.push(`## ${i + 1}. ${p.hook || formatLabel(p.format)}${p.redrafted ? " (re-drafted)" : ""}`, "", p.body || "_(empty)_", "");
  });
  L.push("---", "Built with Draft, on your own Claude.");
  return L.join("\n");
}
async function copyAll() {
  try { await navigator.clipboard.writeText(runMd()); toast("Copied ✓"); }
  catch { toast("Couldn't copy — download instead.", true); }
}
function download() {
  const blob = new Blob([runMd()], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `draft-${state.run.format}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function copyOne(p) {
  try { await navigator.clipboard.writeText(p.body || ""); toast("Piece copied ✓"); }
  catch { toast("Couldn't copy this piece.", true); }
}

// ---- cold open (the demo IS the product running) ----
function autostart() {
  // A saved mid-draft status must not restore as a live spinner (the redline sanitize lesson).
  if (state.run) { state.run.status = ""; render(); return; }
  // CONTEXT-FIRST cold open: a lent brand context is enough to begin with ZERO input — the moment you
  // connect, Draft is already writing a few pieces straight from your brief (topic left empty →
  // draft.core draws the most specific real angles from the brief). No form, no button.
  if (brand) { topicText = ""; void start(""); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) { view.append(connectSteps()); return; }
  if (!r) { view.append(setupScreen()); return; }

  // ---- run bar ----
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "the brief"));
  bar.append(el("span", "run-input", `${formatLabel(r.format)}${r.topic ? " · " + r.topic : brand ? " · from " + brand.name : ""}`));
  bar.append(el("span", "grow"));
  if (!running && r.pieces.length) {
    const rd = el("button", "act", "↻ redraft all"); rd.onclick = () => void draftAll(); bar.append(rd);
    const cp = el("button", "act", "copy .md"); cp.onclick = () => void copyAll(); bar.append(cp);
    const dl = el("button", "act", "⬇ download"); dl.onclick = download; bar.append(dl);
  }
  const nu = el("button", "act", "× new"); nu.onclick = newRun; bar.append(nu);
  view.append(bar);

  if (r.status) view.append(researching(r.status));
  if (r.error) {
    view.append(el("div", "err", r.error));
    const t = el("button", "act", "try again"); t.onclick = () => void draftAll(); view.append(t);
    return;
  }

  for (const p of r.pieces) view.append(pieceCard(p));
}

function setupScreen() {
  const box = el("div", "start");
  if (brand) box.append(el("div", "ctx", "Grounded in your context — " + brand.name));
  else box.append(el("div", "ctx", "Tip: lend your brand in the chip so the writing sounds like you."));

  // single input — the topic
  const f1 = el("div", "field");
  f1.append(el("span", "kicker", "what's it about? — one line (leave blank to draw from your brief)"));
  const row = el("div", "bindrow");
  const ta = el("textarea"); ta.rows = 2; ta.value = topicText || osCtxTitle();
  ta.placeholder = "e.g. what shipping in public actually feels like";
  ta.addEventListener("input", () => { topicText = ta.value; });
  row.append(ta);
  f1.append(row);
  box.append(f1);

  // format picker — the doctrine's options-with-one-recommended slate (the kit atom)
  const f2 = el("div", "field");
  f2.append(el("span", "kicker", "format"));
  f2.append(optionCards({
    options: FORMAT_OPTIONS.map((f) => ({ id: f.id, label: f.label, recommended: f.recommended })),
    chosenId: formatChoice,
    onChoose: (o) => { formatChoice = o.id; render(); },
    chosenNote: "",
  }));
  box.append(f2);

  // count — a small stepper
  const f3 = el("div", "field");
  f3.append(el("span", "kicker", "how many"));
  const counts = el("div", "countrow");
  for (const c of COUNT_OPTIONS) {
    const b = el("button", "count" + (c === countChoice ? " on" : ""), String(c));
    b.onclick = () => { countChoice = c; render(); };
    counts.append(b);
  }
  f3.append(counts);
  box.append(f3);

  const btn = el("button", "primary", brand && !(topicText || "").trim() ? "Draft from " + brand.name + " ▸" : "Draft ▸");
  btn.style.marginTop = "18px";
  btn.onclick = () => void start(topicText);
  box.append(btn);
  box.append(el("div", "hint", "Drafts on your Claude · each piece distinct · select any one and say what to change"));
  setTimeout(() => ta.focus(), 30);
  return box;
}

function pieceCard(p) {
  const card = el("div", "q-card piece");
  const head = el("div", "phead");
  head.append(el("span", "q-num", formatLabel(p.format)));
  if (p.redrafted) head.append(el("span", "redraft-chip", "re-drafted"));
  head.append(el("span", "grow"));
  const cp = el("button", "act tiny", "copy"); cp.onclick = () => void copyOne(p); head.append(cp);
  card.append(head);

  if (p.hook) card.append(el("div", "phook", p.hook));
  card.append(el("div", "pbody", p.body));

  if (p.error) card.append(el("div", "err", p.error));
  // the per-piece "say" — select this piece (it's already the one you're steering) and tell it what to
  // change. Disabled while THIS piece is re-drafting; other pieces stay live.
  card.append(steerRow({
    onSteer: (s) => void steerOne(p.id, s),
    chips: STEER_CHIPS,
    disabled: p.busy,
    kicker: p.busy ? "re-drafting this piece…" : "not quite? say what to change",
    placeholder: "e.g. cut the last line, keep it plainer…",
  }));
  return card;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ------------------------------------
// `draft_pieces` runs the SAME start() a click runs — N distinct pieces of a format draft themselves
// live in the DOM — then returns the batch as markdown for God to read. Pure model call; nothing is
// published or sent. (The select-and-say revise stays a human act at the notch.)
exposeToGod({
  name: "draft_pieces",
  description: "Draft N distinct social posts of one format (x-thread, x-single, linkedin, ig-caption, ig-carousel) from a topic, grounded in the lent brief. Fills the cards live and returns the pieces as markdown; nothing is published.",
  inputSchema: {
    topic: "string? — what the posts are about. Omit to draw the strongest angles from the brief.",
    format: "string? — one of: x-thread, x-single, linkedin, ig-caption, ig-carousel. Default the recommended (x-thread).",
    n: "number? — how many distinct pieces. Default 3.",
  },
  execute: async ({ topic, format, n } = {}) => {
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Draft isn't connected to Switchboard yet");
    if (format && FORMATS[String(format).toLowerCase()]) formatChoice = String(format).toLowerCase();
    if (n != null && Number(n) > 0) countChoice = Math.max(1, Number(n));
    const val = String(topic || "").trim();
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);   // let any in-flight run finish before we take the wheel
      await start(val);                        // draftAll — all pieces, awaited
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if ((r.pieces || []).some((x) => (x.body || "").trim())) return { pieces: runMd() };
    }
    throw new Error("Draft stayed busy — try again");
  },
});
