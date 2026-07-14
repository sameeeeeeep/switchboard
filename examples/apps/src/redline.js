// Redline — review a landing page the brandbrain way, on the visitor's OWN Claude. The real page is
// the canvas; the wrapp is the docked sidebar. Bind the project folder (the "warm thread":
// storage.bind → the real index.html becomes a record we read AND write). Comment on an element and
// the user's Claude returns a DECISION — 2–3 option cards, one recommended; the founder steers, then
// LOCKS, and the chosen edit writes to the actual file. Copy runs on their Claude, mockups on their
// Higgsfield. The operator holds no key and never sees the page or the edits.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*";
const DEFAULT_FOLDER = "~/Documents/Projects/the-last-prompt/switchboard";

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "page";
const uid = () => Math.random().toString(36).slice(2, 9);

let relay = null;
let notInstalled = false;
let bound = null;        // { folder }
let pages = [];
let pageKey = null;
let currentHtml = "";
let decisions = [];      // [{ id, num, selector, snippet, tag, note, decision|null, locked|null }]
let picking = false;
let activeId = null;
const busy = new Set();

// ---------- connect chip ----------
mountConnect($("chip-dock"), {
  scope: {
    reason: "Redline — review this page on your own Claude: options for copy, references, diagrams, and image mockups",
    models: ["sonnet"],
    tools: [HIGGSFIELD, "WebSearch", "WebFetch"],
  },
  context: "none",
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; onReady(); },
  onDisconnect: () => { relay = null; reflect(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) { relay = r; onReady(); return; } }
  else if (r && r.installed === false) notInstalled = true;
  reflect();
})();

async function onReady() {
  const info = await relay.storage.info().catch(() => null);
  if (info && !info.autoAssigned && info.folder) { bound = { folder: info.folder }; await loadProject(); }
  reflect();
}

function reflect() {
  const connected = !!relay;
  $("open-project").disabled = !connected;
  $("add-comment").disabled = !connected || !pageKey;
  const steps = $("stage-steps");
  if (steps) steps.querySelector("div:nth-child(1)").innerHTML = connected
    ? "<b>✓</b> · Connected — this page runs on your Claude"
    : notInstalled ? "<b>1</b> · Install Switchboard (button, top-right)" : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  $("stage").hidden = !!pageKey;
  $("canvas-bar").hidden = !pageKey;
  $("proj-bar").hidden = !bound;
}

// ---------- project binding (warm thread) ----------
$("open-project").addEventListener("click", openProject);
$("reopen").addEventListener("click", openProject);
async function openProject() {
  if (!relay) return;
  const path = prompt("Folder that holds the page (its index.html lives here):", bound?.folder || DEFAULT_FOLDER);
  if (!path) return;
  const info = await relay.storage.bind(path.trim()).catch(() => null);
  if (!info) { toast("Bind declined or failed.", true); return; }
  bound = { folder: info.folder };
  await loadProject();
}

async function loadProject() {
  if (!relay) return;
  $("proj-path").textContent = bound.folder;
  let keys = [];
  try { keys = await relay.storage.list(); } catch { /* empty */ }
  pages = keys.filter((k) => /\.html?$/i.test(k)).sort();
  const sel = $("page-sel"); sel.textContent = "";
  if (!pages.length) { toast("No .html file in that folder.", true); pageKey = null; reflect(); return; }
  for (const p of pages) sel.append(new Option(p, p));
  const preferred = pages.find((p) => /(^|\/)index\.html?$/i.test(p)) || pages[0];
  sel.value = preferred;
  await openPage(preferred);
}
$("page-sel").addEventListener("change", (e) => openPage(e.target.value));
$("reload").addEventListener("click", () => pageKey && openPage(pageKey, true));

async function openPage(key) {
  pageKey = key;
  try { currentHtml = (await relay.storage.get(key)) || ""; }
  catch (e) { toast("Couldn't read " + key + " — " + msg(e), true); return; }
  decisions = await loadReview(); activeId = null;
  renderFrame(); renderSide(); reflect();
}

const reviewKey = () => "redline-" + slug(pageKey);
async function loadReview() {
  try { const raw = await relay.storage.get(reviewKey()); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}
async function saveReview() { try { await relay.storage.set(reviewKey(), JSON.stringify(decisions)); } catch { /* non-fatal */ } }

// ---------- the frame ----------
const OVERLAY_STYLE = `
  [data-redline]{ outline:2px solid #C8F250 !important; outline-offset:2px; scroll-margin:80px; position:relative; }
  [data-redline]::after{ content:attr(data-redline); position:absolute; top:-11px; left:-11px; width:20px; height:20px; border-radius:50%;
    background:#C8F250; color:#0A0C10; font:700 12px/20px ui-sans-serif,system-ui,sans-serif; text-align:center; z-index:2147483000; pointer-events:none; }
  [data-redline].rl-locked{ outline-color:#3DD68C !important; } [data-redline].rl-locked::after{ background:#3DD68C; }
  html.rl-picking *{ cursor:crosshair !important; }
  html.rl-picking *:hover{ outline:1.5px dashed rgba(200,242,80,.85) !important; outline-offset:1px; }
`;
function renderFrame() {
  const frame = $("frame");
  frame.srcdoc = currentHtml;
  frame.onload = () => { try { decorateFrame(); } catch { /* timing */ } };
}
function frameDoc() { try { return $("frame").contentDocument; } catch { return null; } }
function decorateFrame() {
  const doc = frameDoc(); if (!doc) return;
  let st = doc.getElementById("__redline_style");
  if (!st) { st = doc.createElement("style"); st.id = "__redline_style"; doc.head?.appendChild(st); }
  st.textContent = OVERLAY_STYLE;
  for (const c of decisions) { const n = findNode(doc, c); if (n) { n.setAttribute("data-redline", String(c.num)); n.classList.toggle("rl-locked", !!c.locked); } }
  if (!doc.__rlWired) { doc.addEventListener("click", onFrameClick, true); doc.__rlWired = true; }
  doc.documentElement.classList.toggle("rl-picking", picking);
}
function onFrameClick(e) {
  if (!picking) return;
  e.preventDefault(); e.stopPropagation();
  const node = e.target; if (!node || node.nodeType !== 1) return;
  const snippet = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160) || node.tagName.toLowerCase();
  const num = (decisions.reduce((m, c) => Math.max(m, c.num), 0) || 0) + 1;
  const c = { id: uid(), num, selector: cssPath(node), snippet, tag: node.tagName.toLowerCase(), note: "", decision: null, locked: null };
  decisions.push(c);
  setPicking(false);
  activeId = c.id;
  saveReview(); renderSide(); decorateFrame();
  setTimeout(() => { const ta = document.querySelector(`.dec[data-id="${c.id}"] textarea`); ta?.focus(); ta?.scrollIntoView({ block: "center" }); }, 30);
}
function cssPath(node) {
  const parts = []; let e = node;
  while (e && e.nodeType === 1 && e.tagName.toLowerCase() !== "html") {
    let sel = e.tagName.toLowerCase();
    if (e.id) { parts.unshift("#" + cssEscape(e.id)); break; }
    const p = e.parentElement;
    if (p) { const sibs = [...p.children].filter((n) => n.tagName === e.tagName); if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(e) + 1})`; }
    parts.unshift(sel); e = e.parentElement;
  }
  return parts.join(" > ");
}
function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
function findNode(doc, c) {
  if (c.selector) { try { const n = doc.querySelector(c.selector); if (n) return n; } catch { /* bad selector */ } }
  if (c.snippet) { const want = c.snippet.slice(0, 40).toLowerCase(); for (const n of (doc.body ? doc.body.querySelectorAll(c.tag || "*") : [])) if ((n.textContent || "").trim().replace(/\s+/g, " ").toLowerCase().includes(want)) return n; }
  return null;
}

// ---------- comment mode + view + collapse ----------
$("pick-toggle").addEventListener("click", () => setPicking(!picking));
$("add-comment").addEventListener("click", () => { if ($("work").classList.contains("collapsed")) setCollapsed(false); setPicking(true); });
$("send-all").addEventListener("click", sendAll);
let sendingAll = false;
// Run every comment that has a note but no answer yet — sequentially, so progress shows and we don't
// hammer the model. Locking stays per-decision: you still review each proposal before it's written.
async function sendAll() {
  if (sendingAll) return;
  const pending = decisions.filter((c) => c && !c.locked && !c.decision && (c.note || "").trim() && !busy.has(c.id));
  if (!pending.length) return;
  sendingAll = true; renderSide();
  try { for (const c of pending) await respond(c); }
  finally { sendingAll = false; renderSide(); }
}
// Refresh only the "Send all" chip — cheap, so a typed note updates the count without a full re-render
// (which would steal textarea focus mid-keystroke).
function updateSendAll() {
  const pending = decisions.filter((c) => c && !c.locked && !c.decision && (c.note || "").trim() && !busy.has(c.id));
  const sa = $("send-all");
  if (sa) { sa.hidden = pending.length < 2 && !sendingAll; sa.disabled = sendingAll || !pending.length; sa.textContent = sendingAll ? "sending…" : `Send all (${pending.length})`; }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && picking) setPicking(false); });
function setPicking(on) {
  picking = on && !!pageKey;
  $("pick-toggle").classList.toggle("on", picking);
  $("pick-toggle").textContent = picking ? "✎ click an element…" : "✎ comment mode";
  $("pick-hint").hidden = !picking;
  const doc = frameDoc(); if (doc) doc.documentElement.classList.toggle("rl-picking", picking);
}
$("view-desktop").addEventListener("click", () => setView(false));
$("view-mobile").addEventListener("click", () => setView(true));
function setView(mobile) { $("frame").classList.toggle("mobile", mobile); $("view-mobile").classList.toggle("on", mobile); $("view-desktop").classList.toggle("on", !mobile); }
$("collapse").addEventListener("click", () => setCollapsed(true));
$("reopen-tab").addEventListener("click", () => setCollapsed(false));
function setCollapsed(on) { $("work").classList.toggle("collapsed", on); $("reopen-tab").hidden = !on; }

// ---------- generators: each returns a DECISION (option set) ----------
// ONE input. You type what you want in plain language; Redline reads your comment + the element and
// decides how to respond — an EDIT (rewrite / shorten / remove / restructure / inline diagram → option
// cards you lock), an IMAGE mockup (on your Higgsfield), REFERENCES (a web search), or a plain REPLY
// (a question/opinion). No modes to pick; the intent is inferred. Steer with more words to redo it.
const STEER_CHIPS = ["punchier", "shorter", "remove it instead", "another angle", "go deeper"];

const TARGET = (c, steers) => [
  `Element CSS path: ${c.selector}`,
  `Current visible text: "${c.snippet}"`,
  `Reviewer's comment: "${c.note || "(make this stronger)"}"`,
  steers.length ? `Follow-ups (apply the latest): ${steers.map((s) => `"${s}"`).join(" → ")}` : "",
].filter(Boolean).join("\n");

// Send only the SECTION of the page around the commented element — not the whole (often huge) file.
// A 98KB page on every call is slow, costly, and times out; a focused window keeps completions fast.
// The window is a verbatim substring of currentHtml, so a find/replace the model returns still applies.
// If we can't locate the element by its text (heavy nested markup), fall back to the full source.
const SOURCE_WINDOW = 4500;
function sourceWindow(c) {
  const src = currentHtml;
  if (src.length <= SOURCE_WINDOW * 2) return src;
  const needle = (c.snippet || "").replace(/\s+/g, " ").trim();
  let idx = -1;
  for (let len = Math.min(needle.length, 70); len >= 12 && idx === -1; len -= 8) idx = src.indexOf(needle.slice(0, len));
  if (idx === -1) return src.slice(0, SOURCE_WINDOW * 2); // couldn't locate → send the head (still bounded)
  return src.slice(Math.max(0, idx - SOURCE_WINDOW), Math.min(src.length, idx + SOURCE_WINDOW));
}

async function respond(c, steer) {
  if (!relay || busy.has(c.id)) return;
  if (!c.note && !steer) { toast("Type what you'd like changed, then send.", true); return; }
  busy.add(c.id);
  const steers = [...((c.decision && c.decision.steers) || []), ...(steer ? [steer] : [])];
  c.decision = { kind: null, lockable: false, loading: true, status: "reading the page…", options: [], selectedId: null, steers, markdown: "", find: null, summary: "" };
  renderSide();
  try {
    const route = await askJson([
      "You are Redline, reviewing a landing page with the founder. They left a comment on ONE element. Decide the single best way to respond and return ONE JSON object — no prose, no fences.",
      TARGET(c, steers),
      'Choose a mode:',
      '• "edit" — the comment wants to CHANGE the page (rewrite, sharpen, shorten, REMOVE, restructure, or add an inline SVG). Return {"mode":"edit","summary":<one line on what you propose>,"find":<EXACT unique substring of the SOURCE to change; for a removal, the whole element>,"options":[{"label":<short name>,"replace":<the find edited; "" to delete it; may embed an inline <svg> for a diagram>,"preview":<new visible text, or "removed">,"recommended":<true for exactly one>}]} — 2–3 options.',
      '• "image" — the comment wants a photo/mockup/visual. Return {"mode":"image","brief":<a vivid image prompt>}.',
      '• "references" — the comment wants references/examples/inspiration. Return {"mode":"references","query":<what to look up>}.',
      '• "reply" — the comment is a question or asks your opinion. Return {"mode":"reply","markdown":<your answer, a few tight lines>}.',
      'For "edit", find MUST appear verbatim exactly once in the SOURCE.',
      "SOURCE (the relevant section of the page's HTML):\n" + sourceWindow(c),
    ]);
    const mode = route && route.mode;
    if (mode === "edit") {
      if (!route.find || !Array.isArray(route.options) || !route.options.length) throw new Error("no edit came back — try rephrasing");
      if (!currentHtml.includes(route.find)) throw new Error("the target no longer matches the file");
      c.decision.kind = "edit"; c.decision.lockable = true; c.decision.summary = route.summary || "";
      c.decision.find = route.find;
      c.decision.options = route.options.slice(0, 3).map((o) => ({ id: uid(), label: o.label || "Option", text: o.preview != null ? o.preview : stripTags(o.replace || "").trim().slice(0, 220) || "(removed)", edit: { find: route.find, replace: o.replace ?? "" }, recommended: !!o.recommended }));
    } else if (mode === "image") {
      c.decision.kind = "image"; c.decision.lockable = true;
      await runImage(c, route.brief || c.note, steers);
    } else if (mode === "references") {
      c.decision.kind = "references"; c.decision.lockable = false;
      await runReferences(c, route.query || c.note);
    } else {
      c.decision.kind = "reply"; c.decision.lockable = false;
      c.decision.markdown = (route && route.markdown) || "(no reply came back)";
    }
    const rec = c.decision.options.find((o) => o.recommended) || c.decision.options[0];
    if (rec) c.decision.selectedId = rec.id;
  } catch (e) {
    c.decision.error = msg(e);
  } finally {
    c.decision.loading = false;
    busy.delete(c.id);
    saveReview(); renderSide();
  }
}

async function runImage(c, brief, steers) {
  const base = `A landing-page image mockup. Element: "${c.snippet}". ${brief}. ${steers.join(". ")}. Clean, modern, on-brand for a developer/AI product; no text overlays.`;
  const briefs = [base, base + " Alternative composition."];
  const urls = [];
  for (let i = 0; i < briefs.length; i++) { c.decision.status = `generating image ${i + 1} of 2 on your Higgsfield…`; renderSide(); const u = await genImage(briefs[i]).catch(() => null); if (u) urls.push(u); }
  if (!urls.length) throw new Error("no image came back from Higgsfield");
  c.decision.options = urls.map((u, i) => ({ id: uid(), label: i === 0 ? "Primary" : "Alternate", imageUrl: u, deferredPlacement: true, edit: null, recommended: i === 0 }));
}

async function runReferences(c, query) {
  c.decision.status = "searching the web…"; renderSide();
  const text = await streamText(
    { prompt: `You are a design researcher. Find 2–4 concrete, real references (sites, articles, patterns) for: ${query}. For each: a name, a one-line why, and a URL. Be specific and current.\n\n${TARGET(c, c.decision.steers)}`, agentic: true },
    (p) => { if (p.tool) { c.decision.status = "reading " + p.tool.split("__").pop() + "…"; renderSide(); } else if (p.text) { c.decision.markdown = p.text; } },
  );
  c.decision.markdown = text.trim() || "(nothing came back)";
}

// ---------- lock: write the chosen option's edit into the real file ----------
async function lockDecision(c) {
  const d = c.decision; if (!d || !relay) return;
  const opt = d.options.find((o) => o.id === d.selectedId); if (!opt) return;
  busy.add(c.id); d.writing = true; d.status = "writing to " + pageKey + "…"; renderSide();
  try {
    let edit = opt.edit;
    if (!edit && opt.deferredPlacement && opt.imageUrl) {
      d.status = "placing the image…"; d.loading = true; renderSide();
      const out = await askJson([
        "Place an image into the raw HTML source of a landing page.",
        TARGET(c, d.steers), `Image URL to insert: ${opt.imageUrl}`,
        'Return ONLY JSON: {"find": <EXACT unique substring of the SOURCE to anchor to>, "replace": <that substring with an <img src="…" alt="…" style="max-width:100%"> woven in appropriately>}',
        "SOURCE (the relevant section of the page's HTML):\n" + sourceWindow(c),
      ]);
      d.loading = false;
      if (out && out.find && out.replace && currentHtml.includes(out.find)) edit = { find: out.find, replace: out.replace };
    }
    if (!edit) throw new Error("this option can't be written automatically — try Ask Redline again");
    const applied = applyEdit(currentHtml, edit.find, edit.replace);
    if (!applied.ok) throw new Error("couldn't find this text in the file anymore — click Ask Redline to regenerate against the current page");
    await relay.storage.set(pageKey, applied.next);
    currentHtml = applied.next;
    c.locked = { kind: d.kind, label: opt.label, text: opt.text || "", svg: opt.svg || null, imageUrl: opt.imageUrl || null };
    c.decision = null;
    saveReview(); renderFrame(); renderSide();
    toast("Done ✓ written to " + pageKey + " — reopen the card to make more changes");
  } catch (e) { if (c.decision) c.decision.lockError = msg(e); toast("Couldn't lock — " + msg(e), true); }
  finally { busy.delete(c.id); if (c.decision) { c.decision.loading = false; c.decision.writing = false; } renderSide(); }
}

// Apply a find/replace, tolerating the model collapsing/altering whitespace in `find` (a common cause
// of "the file changed" when the file actually hasn't). Exact match first; then a whitespace-flexible
// regex; requires a single match so we never edit the wrong spot.
function applyEdit(html, find, replace) {
  if (typeof find !== "string" || !find) return { ok: false };
  if (html.includes(find)) return { ok: true, next: html.replace(find, replace) };
  const pat = find.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(pat, "g");
    const matches = html.match(re);
    if (matches && matches.length === 1) { const m = new RegExp(pat).exec(html); return { ok: true, next: html.slice(0, m.index) + replace + html.slice(m.index + m[0].length) }; }
  } catch { /* unbuildable regex */ }
  return { ok: false };
}

function relock(c) { c.locked = null; saveReview(); renderSide(); const doc = frameDoc(); const n = doc && findNode(doc, c); if (n) n.classList.remove("rl-locked"); }

// ---------- image gen (Higgsfield, agentic — mirrors Prism) ----------
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

// ---------- the sidebar (the wrapp) ----------
function renderSide() {
  const body = $("side-body"); body.textContent = "";
  const live = decisions.filter(Boolean);
  const open = live.filter((c) => !c.locked).length, done = live.length - open;
  $("dec-count").textContent = live.length ? `${open} open${done ? ` · ${done} done` : ""}` : "";
  updateSendAll();
  if (!live.length) {
    const e = el("div", "empty");
    e.innerHTML = 'No comments yet.<br /><b>Turn on comment mode</b> and click anything on the page — Redline proposes options you can lock in.';
    body.append(e);
    return;
  }
  // Open work on top, done (locked) below — the sidebar reads like a review checklist.
  const ordered = [...live.filter((c) => !c.locked), ...live.filter((c) => c.locked)];
  for (const c of ordered) body.append(c.locked ? lockedCard(c) : decisionCard(c));
}

function decisionCard(c) {
  const card = el("div", "dec" + (c.id === activeId ? " active" : "")); card.dataset.id = c.id;
  const head = el("div", "dec-head");
  head.append(el("div", "dec-num", String(c.num)));
  const main = el("div", "dec-main");
  main.append(el("div", "dec-target", `${c.tag}${c.snippet ? " · " + c.snippet.slice(0, 60) : ""}`));
  main.append(el("div", "dec-snip", c.snippet));
  const x = el("button", "dec-x", "×"); x.title = "delete"; x.onclick = (e) => { e.stopPropagation(); removeDecision(c); };
  head.append(main, x);
  head.onclick = () => { activeId = c.id; scrollToNode(c); renderSide(); };
  card.append(head);

  const b = el("div", "dec-body");
  const ta = el("textarea"); ta.placeholder = "Tell Redline what you want — “sharper, lead with the benefit”, “remove this”, “why is this here?”, “mock up a hero image”…";
  ta.value = c.note || ""; ta.addEventListener("input", () => { c.note = ta.value; updateSendAll(); }); ta.addEventListener("blur", saveReview);
  ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); respond(c); } });
  b.append(ta);

  const d = c.decision;
  if (!d) {
    const row = el("div", "gen-row");
    const ask = el("button", "lock"); ask.append(el("span", null, "Ask Redline"), askIcon());
    ask.disabled = busy.has(c.id) || !relay;
    ask.onclick = () => respond(c);
    const hint = el("span", "sendhint", "⌘↵");
    row.append(ask, hint);
    b.append(row);
  } else if (d.loading) {
    const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, d.status || "working…")); b.append(r);
  } else if (d.error) {
    b.append(el("div", "err", d.error));
    const retry = el("div", "gen-row"); const btn = el("button", "act", "try again"); btn.onclick = () => respond(c, null); retry.append(btn); b.append(retry);
  } else if (d.lockable) {
    b.append(optionSet(c, d));
    if (d.lockError) {
      const e = el("div", "err", "Couldn't write: " + d.lockError);
      const fix = el("div", "gen-row"); const btn = el("button", "act", "Ask Redline again"); btn.onclick = () => respond(c); fix.append(btn);
      b.append(e, fix);
    }
    b.append(steerBox(c, d));
    b.append(decisionFoot(c, d));
  } else {
    // info response (references / advice)
    const m = el("div", "md"); m.innerHTML = mdLite(d.markdown || ""); b.append(m);
    b.append(steerBox(c, d));
    const foot = el("div", "dec-foot");
    const done = el("button", "lock", "Mark done"); done.onclick = () => { c.locked = { kind: d.kind, label: labelFor(d.kind), text: stripTags(d.markdown || "").slice(0, 300) }; c.decision = null; saveReview(); renderSide(); };
    const other = el("button", "discard", "Other options"); other.onclick = () => { c.decision = null; saveReview(); renderSide(); };
    foot.append(done, other); b.append(foot);
  }
  card.append(b);
  return card;
}

function optionSet(c, d) {
  const wrap = el("div", "opts");
  for (const o of d.options) {
    const card = el("div", "opt" + (o.id === d.selectedId ? " sel" : ""));
    card.onclick = () => { d.selectedId = o.id; d.lockError = null; saveReview(); renderSide(); };
    const chk = el("div", "check", "✓"); card.append(chk);
    if (o.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", o.label));
    if (o.text) card.append(el("div", "o-text", o.text));
    if (o.svg) { const s = el("div", "o-svg"); s.innerHTML = sanitizeSvg(o.svg); card.append(s); }
    if (o.imageUrl) { const img = el("img", "o-img"); img.src = o.imageUrl; img.alt = o.label; card.append(img); }
    wrap.append(card);
  }
  return wrap;
}

function steerBox(c, d) {
  const wrap = el("div", "steer");
  wrap.append(Object.assign(el("span", "kicker"), { textContent: "not quite? tell redline" }));
  const chips = el("div", "chips");
  for (const s of STEER_CHIPS) { const chip = el("button", "chip", s); chip.disabled = busy.has(c.id); chip.onclick = () => respond(c, s); chips.append(chip); }
  wrap.append(chips);
  const row = el("div", "row");
  const box = el("div", "box");
  box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8F250" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>';
  const input = el("input"); input.placeholder = "steer this — e.g. lead with the cost saving";
  const send = () => { const t = input.value.trim(); if (!t || busy.has(c.id)) return; input.value = ""; respond(c, t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  box.append(input);
  const btn = el("button", "send"); btn.textContent = "send"; btn.disabled = busy.has(c.id); btn.onclick = send;
  row.append(box, btn); wrap.append(row);
  return wrap;
}

function decisionFoot(c, d) {
  // While the edit is being written, replace the buttons with a clear progress line (the write +
  // 98KB frame re-render take a beat; a bare disabled button reads as "nothing's happening").
  if (d.writing || busy.has(c.id)) {
    const r = el("div", "researching");
    r.append(el("div", "scan"), el("span", null, d.status || "writing…"));
    return r;
  }
  const foot = el("div", "dec-foot");
  const opt = d.options.find((o) => o.id === d.selectedId);
  const lock = el("button", "lock"); lock.append(lockIcon(), el("span", null, "Lock & write"));
  lock.disabled = !opt;
  lock.onclick = () => lockDecision(c);
  const discard = el("button", "discard", "Discard"); discard.onclick = () => { c.decision = null; saveReview(); renderSide(); };
  foot.append(lock, discard);
  return foot;
}
function lockIcon() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", "13"); s.setAttribute("height", "13"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.2"); s.innerHTML = '<rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'; return s; }

function lockedCard(c) {
  const card = el("div", "dec locked"); card.dataset.id = c.id;
  const head = el("div", "dec-head");
  head.append(el("div", "dec-num done", "✓"));   // a done comment is a checked-off item
  const main = el("div", "dec-main");
  main.append(el("div", "dec-target", `${c.tag}${c.snippet ? " · " + c.snippet.slice(0, 60) : ""}`));
  const x = el("button", "dec-x", "×"); x.title = "delete"; x.onclick = (e) => { e.stopPropagation(); removeDecision(c); };
  head.append(main, x);
  head.onclick = () => { activeId = c.id; scrollToNode(c); };
  card.append(head);

  const b = el("div", "dec-body");
  const tile = el("div", "locked-tile");
  const lm = el("div", "lt-main");
  lm.append(el("div", "lt-k", `done · ${c.locked.label || labelFor(c.locked.kind)}`));
  if (c.note) lm.append(el("div", "lt-note", `you asked: “${c.note.slice(0, 120)}”`));
  if (c.locked.text) lm.append(el("div", "lt-text", c.locked.text));
  if (c.locked.svg) { const s = el("div", "lt-svg"); s.innerHTML = sanitizeSvg(c.locked.svg); lm.append(s); }
  if (c.locked.imageUrl) { const img = el("img"); img.src = c.locked.imageUrl; lm.append(img); }
  const rl = el("button", "relock", "↩ reopen to make more changes"); rl.title = "see the result on the page, then ask for another change here"; rl.onclick = () => relock(c);
  lm.append(rl);
  tile.append(lm); b.append(tile); card.append(b);
  return card;
}

const labelFor = (k) => ({ edit: "edit", image: "mockup", references: "references", reply: "note" }[k] || k);
function askIcon() { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", "13"); s.setAttribute("height", "13"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.innerHTML = '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'; return s; }
function removeDecision(c) { decisions = decisions.filter((x) => x.id !== c.id); const doc = frameDoc(); const n = doc && findNode(doc, c); if (n) { n.removeAttribute("data-redline"); n.classList.remove("rl-locked"); } saveReview(); renderSide(); }
function scrollToNode(c) { const doc = frameDoc(); if (!doc) return; const n = findNode(doc, c); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); }

// ---------- llm + string helpers ----------
// Stream text with a hard timeout, so a wedged daemon / dead connection surfaces as a clear message
// instead of an infinite "reading the page…" spinner. onProgress gets {text} and {tool} as they arrive.
const STREAM_TIMEOUT_MS = 180000;
async function streamText(params, onProgress) {
  let text = "", settled = false;
  return await Promise.race([
    (async () => {
      for await (const d of relay.stream(params)) {
        if (d.type === "text") { text += d.text; onProgress && onProgress({ text }); }
        else if (d.type === "tool_proposed") { onProgress && onProgress({ tool: d.call?.name }); }
        else if (d.type === "error") throw new Error(d.error?.message || "stream error");
      }
      settled = true;
      return text;
    })(),
    new Promise((_, reject) => setTimeout(() => { if (!settled) reject(new Error("Switchboard didn't respond — is the sidekick running? Reload this tab and try again.")); }, STREAM_TIMEOUT_MS)),
  ]);
}

async function askJson(parts) {
  const prompt = parts.filter(Boolean).join("\n\n");
  return parseJson(await streamText({ prompt }));
}
function parseJson(text) {
  let t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
function mdLite(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}
function msg(e) { return String(e?.message || e).slice(0, 160); }
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3200);
}
