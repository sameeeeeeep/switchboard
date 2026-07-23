// Redline — review a landing page the brandbrain way, on the visitor's OWN Claude. The real page is
// the canvas; the wrapp is the docked sidebar. CONTEXT-FIRST: the moment a grant exists Redline
// resolves the project itself — an already-bound folder (incl. a "project" context lent via the
// panel, which binds it) loads instantly; otherwise the user's kind-"project" contexts render as
// one-click bind cards (★ on the freshest), with a typed path only as the last fallback. Once a
// page is open with nothing pinned, the AUDIT runs itself — the sidebar fills with findings, each
// carrying a ready-to-lock recommended fix and steer chips. Comment on an element and the user's
// Claude returns a DECISION — 2–3 option cards, one recommended; the founder steers, then LOCKS,
// and the chosen edit writes to the actual file. Copy runs on their Claude, mockups on their
// Higgsfield. The operator holds no key and never sees the page or the edits.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { mountBankIt, listContexts, useContext, slugId } from "./store/bankit.js";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*";
const DEFAULT_FOLDER = "~/Documents/Projects/the-last-prompt/switchboard";
const DRAFT_KEY = "index.html"; // where a drafted page lands the first time it's written

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
let lastAuditAt = 0;     // per-page: when the one-pass audit last completed (persisted in the review record)
let picking = false;
let activeId = null;
let runScripts = false;  // preview-only: whether the reviewed page's own JS runs inside the iframe
let projectMetas = [];   // kind-"project" contexts with a folder — the one-click bind cards
const bankedFolders = new Set(); // folders banked as projects in THIS session (keeps the ✓ standing)
let binding = false;
let isDraft = false;     // the open page was DRAFTED from context, not read off disk (nothing written)
let drafting = false;
let stageOverride = false; // user clicked "change" while a page is open → show the stage over it
let bootstrapped = false;
let booting = false;
let relayWired = false;
let syncSeq = 0;
const busy = new Set();

// ---------- connect chip ----------
mountConnect($("chip-dock"), {
  scope: {
    reason: "Redline — review this page on your own Claude: options for copy, references, diagrams and image mockups, plus the offer to bank the folder you open as a project in your library",
    models: ["sonnet"],
    tools: [HIGGSFIELD, "WebSearch", "WebFetch"],
    // contextKinds lets Redline LIST the user's projects (names + folders, never data) so entry is
    // a one-click bind card instead of a typed filesystem path — and READ one, so a project with no
    // page on disk still gets a first draft to review instead of a dead end. NOTE: pre-existing
    // grants are exact-match and won't gain this on reconnect — list() failing falls back to the
    // manual path, and a context that can't be read just means no draft.
    contextKinds: ["project", "brand"],
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; wireRelay(r); onReady(); },
  onDisconnect: () => { relay = null; bootstrapped = false; reflect(); },
  // The chip's project switcher (and the panel) can re-point this origin's storage folder LIVE.
  onProjectChange: () => { void syncProject(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) { relay = r; wireRelay(r); onReady(); return; } }
  else if (r && r.installed === false) notInstalled = true;
  reflect();
})();

function wireRelay(r) {
  if (relayWired) return; relayWired = true;
  // A panel-side lend of a "project" context rebinds this origin's storage folder while we're open.
  // Without this, pages/pageKey/currentHtml go stale and the next Lock & write would land the OLD
  // page's HTML in the NEW folder. The daemon broadcasts permissionsChanged for it — re-check where
  // storage points and reset the review state when the folder moved.
  r.on("permissionsChanged", () => { void syncProject(); });
}

async function onReady() {
  if (bootstrapped) { reflect(); return; }
  bootstrapped = true; booting = true;
  try { await resolveProject(); } finally { booting = false; }
  reflect();
}

// PROACTIVE ENTRY: resolve the project with zero typing. Already-bound folder (returning user, or a
// panel-lent "project" context — the lend binds the folder, so info() covers it) → load and review
// instantly. Otherwise list the user's project contexts as one-click bind cards on the stage.
async function resolveProject() {
  if (!relay) return;
  const info = await relay.storage.info().catch(() => null);
  // The project list is needed on BOTH paths: unbound, it is the bind cards; bound, it is what tells
  // the bank chip this folder already belongs to a library project (→ nothing to offer).
  await refreshProjectMetas();
  if (info && !info.autoAssigned && info.folder) {
    bound = { folder: info.folder };
    binding = true; reflect();
    try { await loadProject(); } finally { binding = false; reflect(); }
    return;
  }
  reflect();
}

async function refreshProjectMetas() {
  if (!relay) { projectMetas = []; return; }
  try {
    const metas = await relay.context.list();
    projectMetas = metas
      .filter((m) => (m.kind || "").toLowerCase() === "project" && m.folder)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { projectMetas = []; } // old grant without contextKinds → manual path still works
}

// The panel (or the chip's switcher) changed what's lent to this app — re-derive where storage
// points and rebuild the review state if the folder moved. Sequenced so a stale read never wins.
async function syncProject() {
  if (!relay || booting) return;
  const my = ++syncSeq;
  const info = await relay.storage.info().catch(() => null);
  if (my !== syncSeq || !relay) return;
  const folder = info && !info.autoAssigned && info.folder ? info.folder : null;
  if ((bound?.folder || null) === folder) return;
  bound = folder ? { folder } : null;
  pages = []; pageKey = null; currentHtml = ""; decisions = []; activeId = null; lastAuditAt = 0; stageOverride = false;
  $("page-sel").textContent = "";
  await refreshProjectMetas(); // both paths need it — bind cards when unbound, bank-chip dedupe when bound
  if (bound) await loadProject();
  reflect();
}

function reflect() {
  const connected = !!relay;
  $("add-comment").disabled = !connected || !pageKey;
  $("stage").hidden = !!pageKey && !stageOverride;
  $("canvas-bar").hidden = !pageKey;
  $("cutbar").hidden = !cutMode || !pageKey;
  $("proj-bar").hidden = !bound;
  $("draft-flag").hidden = !isDraft;
  $("save-draft").hidden = !isDraft;
  updatePublish();
  updateAudit();
  renderStage();
  renderBankIt();
}

// STOP THE HOARDING: Redline is the wrapp most likely to be the first place a user's folder gets
// bound — a typed path nothing else in the catalogue knows about. This offers that folder to the
// library as a kind:"project" context (data.folder is what lets the panel and every other wrapp
// point at it). Absent when the folder ALREADY belongs to a project context: that one came from the
// library, so there is nothing to bank.
function renderBankIt() {
  const dock = $("bankit-dock");
  if (!dock) return;
  dock.textContent = "";
  if (!relay || !bound || !bound.folder || booting || binding || drafting) return;
  // Banked in this session: keep the confirmation standing. reflect() re-renders this dock constantly,
  // and re-offering "↑ Bank" seconds after the user banked it would read as if nothing happened.
  if (bankedFolders.has(bound.folder)) {
    const done = el("button", "bankit is-done", "in your library ✓");
    done.type = "button";
    done.disabled = true;
    done.title = "this folder is a project in your Switchboard library — every wrapp can open it";
    dock.append(done);
    return;
  }
  if (projectMetas.some((m) => m.folder === bound.folder)) return;
  // Identity comes from the FOLDER, not the page's <title>: the folder is what this context points
  // at, so name and id agree and re-banking the same folder updates in place instead of minting a
  // second entry under the marketing name on the page.
  mountBankIt(dock, {
    relay,
    kind: "project",
    draft: {
      id: slugId(folderName(bound.folder)),
      name: prettyName(bound.folder),
      data: {
        summary: pageDescOf(currentHtml) || pageTitleOf(currentHtml),
        folder: bound.folder,          // the load-bearing field: lending this project binds this folder
        pages: pages.slice(0, 8),      // what's actually in there (not `docs` — these are .html, not docs/*.md)
        source: { kind: "folder", path: bound.folder },
      },
    },
    contexts: projectMetas,
    onPublished: async (meta) => {
      bankedFolders.add(bound.folder);
      toast("“" + meta.name + "” is in your library — every wrapp can open this project now");
      await refreshProjectMetas(); // it now exists as a bind card too
      renderBankIt();
    },
  });
}
function prettyName(folder) {
  const base = folderName(folder).replace(/[-_]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Project";
}
function pageTitleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "") || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html || "");
  if (!m) return "";
  return stripTags(m[1]).replace(/\s+/g, " ").trim().split(/\s+[—|·|]\s+/)[0].slice(0, 60);
}
function pageDescOf(html) {
  const m = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{8,300})["']/i.exec(html || "")
    || /<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]{8,300}?)<\/p>/i.exec(html || "");
  return m ? stripTags(m[1]).replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

// ---------- the stage: connect → pick a project (option cards, no typing) → review ----------
function renderStage() {
  const flow = $("stage-flow"); if (!flow) return;
  flow.textContent = "";
  const sub = $("stage-sub");

  if (!relay) {
    sub.textContent = "Redline renders your real page; your own Claude audits it, pins findings with fixes ready to lock, and every edit you approve writes to the actual file.";
    const steps = el("div", "steps");
    const s1 = el("div"); s1.innerHTML = notInstalled
      ? "<b>1</b> · Install Switchboard (button, top-right)"
      : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
    const s2 = el("div"); s2.innerHTML = "<b>2</b> · Pick your project — Redline lists them the moment you connect";
    const s3 = el("div"); s3.innerHTML = "<b>3</b> · The audit pins findings itself — steer, lock, it's written";
    steps.append(s1, s2, s3);
    flow.append(steps);
    return;
  }

  if (drafting) {
    const r = el("div", "researching");
    r.append(el("div", "scan"), el("span", null, "no page in that folder — drafting the first one from your project…"));
    flow.append(r);
    return;
  }

  if (binding) {
    const r = el("div", "researching");
    r.append(el("div", "scan"), el("span", null, "opening the project…"));
    flow.append(r);
    return;
  }

  sub.textContent = projectMetas.length
    ? "Pick the project to review — one click, no typing. Redline opens its page and runs the first audit itself."
    : "Point Redline at the folder that holds the page (its index.html lives there).";

  if (projectMetas.length) {
    flow.append(el("div", "kicker stage-k", "your projects"));
    const list = el("div", "opts");
    projectMetas.slice(0, 5).forEach((m, i) => {
      const o = el("div", "opt proj");
      if (i === 0) o.append(el("div", "rec", "recommended"));
      o.append(el("div", "go", "open ▸"));
      o.append(el("div", "o-label", m.name));
      o.append(el("div", "o-text o-path", m.folder));
      o.onclick = () => bindFolder(m.folder);
      list.append(o);
    });
    flow.append(list);
  }

  flow.append(el("div", "kicker stage-k", projectMetas.length ? "or open any folder" : "open a folder"));
  const row = el("div", "bindrow");
  const input = el("input");
  input.placeholder = DEFAULT_FOLDER;
  input.value = bound?.folder || DEFAULT_FOLDER;
  const go = () => { const p = input.value.trim(); if (p) bindFolder(p); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  const browse = el("button", "primary", "Browse…");
  browse.title = "pick the folder in your OS's own file dialog — the pick is the consent";
  browse.disabled = binding;
  browse.onclick = pickFolder;
  const btn = el("button", "primary", "Open");
  btn.onclick = go;
  row.append(browse, input, btn);
  flow.append(row);

  if (stageOverride && pageKey) {
    const back = el("button", "stage-cancel", "← keep reviewing " + pageKey);
    back.onclick = () => { stageOverride = false; reflect(); };
    flow.append(back);
  }
}

// ---------- project binding (warm thread) ----------
$("reopen").addEventListener("click", openProject);
async function openProject() {
  if (!relay) return;
  stageOverride = true;
  reflect();
  await refreshProjectMetas();
  renderStage();
}

// The PROPER folder chooser: the daemon raises the OS's own dialog (the page never sees the
// filesystem), and the pick comes back already bound. Cancel or a daemon without a native picker
// resolves undefined — the typed-path row below stays as the fallback.
async function pickFolder() {
  if (!relay || binding) return;
  binding = true; renderStage();
  try {
    const info = await relay.storage.pick("review and edit the landing page in this folder");
    if (!info) return;
    bound = { folder: info.folder };
    stageOverride = false;
    await loadProject();
  } finally { binding = false; reflect(); }
}

async function bindFolder(path) {
  if (!relay || binding) return;
  binding = true; renderStage();
  try {
    const info = await relay.storage.bind(String(path).trim());
    if (!info) throw new Error("bind declined");
    bound = { folder: info.folder };
    stageOverride = false;
    await loadProject();
  } catch (e) { toast("Couldn't open that folder — " + msg(e), true); }
  finally { binding = false; reflect(); }
}

async function loadProject() {
  if (!relay) return;
  $("proj-path").textContent = bound.folder;
  let keys = [];
  try { keys = await relay.storage.list(); } catch { /* empty */ }
  pages = keys.filter((k) => /\.html?$/i.test(k)).sort();
  const sel = $("page-sel"); sel.textContent = "";
  // NO PAGE ON DISK IS NOT A DEAD END. Redline's whole promise is that opening a project starts a
  // review with zero clicks; an empty folder used to end at a toast and an idle sidebar. Draft the
  // first page from the project's own context instead, then audit that — same zero-click contract.
  if (!pages.length) { await draftFirstPage(); return; }
  isDraft = false;
  for (const p of pages) sel.append(new Option(p, p));
  const preferred = pages.find((p) => /(^|\/)index\.html?$/i.test(p)) || pages[0];
  sel.value = preferred;
  await openPage(preferred);
}

// ---------- the first draft: a page to review when the folder has none ----------
// Grounded in whatever the user lent (a "project" context, else a "brand"), written on THEIR Claude,
// and held in memory — nothing touches the folder until the founder saves it or locks an edit, which
// is what the "draft · nothing written yet" flag promises.
async function groundingContext() {
  if (!relay || !relay.context) return null;
  let ctx = null;
  try { ctx = await relay.context.active(); } catch { ctx = null; }
  if (ctx) return ctx;
  const metas = await listContexts(relay);
  const mine = metas.find((m) => (m.kind || "").toLowerCase() === "project" && m.folder === bound?.folder);
  const pick = mine
    || metas.find((m) => (m.kind || "").toLowerCase() === "project")
    || metas.find((m) => (m.kind || "").toLowerCase() === "brand");
  return pick ? await useContext(relay, pick.id) : null;
}

function groundingLines(ctx) {
  const d = (ctx && ctx.data) || {};
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map((x) => String(x)) : []);
  const lines = [
    ctx && ctx.name ? `Name: ${ctx.name}` : "",
    s(d.summary) ? `What it is: ${d.summary}` : "",
    s(d.positioning) ? `Positioning: ${d.positioning}` : "",
    s(d.voice) ? `Voice — write every line in it: ${d.voice}` : "",
    s(d.audience) ? `Audience — write to them: ${d.audience}` : "",
    arr(d.products).length ? `What it sells: ${arr(d.products).join("; ")}` : "",
    arr(d.stack).length ? `Built with: ${arr(d.stack).join(", ")}` : "",
    arr(d.roadmap).length ? `On the roadmap: ${arr(d.roadmap).slice(0, 4).join("; ")}` : "",
    arr(d.palette).length ? `Palette — use exactly these colours: ${arr(d.palette).join(", ")}` : "",
  ].filter(Boolean);
  return lines.length ? lines : [`Name: ${folderName(bound?.folder)}`];
}

function folderName(p) {
  return String(p || "").replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() || "project";
}

// Pull the document out of a model reply that may or may not have wrapped it in fences/prose.
function extractHtml(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const m = /<!doctype html[\s\S]*<\/html\s*>/i.exec(t) || /<html[\s\S]*<\/html\s*>/i.exec(t);
  if (m) return m[0];
  if (/<(section|main|header|div|h1|body)\b/i.test(t)) return "<!doctype html>\n<html>\n<body>\n" + t + "\n</body>\n</html>";
  return "";
}

async function draftFirstPage() {
  if (!relay || drafting) return;
  drafting = true;
  pageKey = null; currentHtml = ""; decisions = []; activeId = null; lastAuditAt = 0;
  reflect();
  try {
    const ctx = await groundingContext();
    const text = await streamText({
      prompt: [
        "You are Redline. This project has no page yet — write the FIRST draft of its landing page, so there is something real on the canvas to review.",
        "THE PROJECT:\n" + groundingLines(ctx).join("\n"),
        "Return the landing page's HTML and nothing else — no prose before or after, no fences. One self-contained document: <!doctype html>, an inline <style>, no external assets and no scripts.",
        "Sections, in order: a hero with ONE clear headline and one supporting line; what it is; who it's for; how it works; and a closing call to action. Write real, specific copy in the project's own voice — no lorem ipsum, no [placeholder] brackets, no generic AI hype.",
      ].join("\n\n"),
      maxTokens: 8000,
    });
    const html = extractHtml(text);
    if (!html) throw new Error("no page came back — press ✦ Audit's neighbour “change” to open a folder that has one");
    isDraft = true;
    pageKey = DRAFT_KEY;
    currentHtml = html;
    pages = [DRAFT_KEY];
    const sel = $("page-sel");
    sel.textContent = "";
    sel.append(new Option(DRAFT_KEY + " · draft", DRAFT_KEY));
    sel.value = DRAFT_KEY;
    stageOverride = false;
    renderFrame(); renderSide(); reflect();
    toast("No page in that folder — Redline drafted one from your project. Nothing is written yet.");
    // Same zero-click contract as a real page: the draft audits itself immediately.
    void audit();
  } catch (e) {
    isDraft = false; pageKey = null;
    toast("Couldn't draft a first page — " + msg(e), true);
  } finally {
    drafting = false;
    reflect();
  }
}

// The draft becomes a real file only when the founder says so.
$("save-draft").addEventListener("click", saveDraft);
async function saveDraft() {
  if (!relay || !isDraft || !pageKey || !currentHtml) return;
  const btn = $("save-draft");
  btn.disabled = true;
  try {
    await relay.storage.set(pageKey, currentHtml);
    isDraft = false;
    pages = [pageKey];
    const sel = $("page-sel");
    sel.textContent = "";
    sel.append(new Option(pageKey, pageKey));
    sel.value = pageKey;
    await saveReview();
    toast("Saved ✓ " + pageKey + " written into " + bound.folder);
  } catch (e) { toast("Couldn't save the draft — " + msg(e), true); }
  finally { btn.disabled = false; reflect(); }
}
$("page-sel").addEventListener("change", (e) => openPage(e.target.value));
$("reload").addEventListener("click", () => {
  if (isDraft) { toast("This page is a draft — there's nothing on disk to re-read yet. Save it first.", true); return; }
  if (pageKey) openPage(pageKey);
});

async function openPage(key) {
  // Read into locals FIRST — a failed read must leave the prior page's state (and its review key)
  // fully intact, or a later saveReview() would write the old page's decisions under the new key.
  const prev = pageKey;
  let html;
  try { html = (await relay.storage.get(key)) || ""; }
  catch (e) {
    toast("Couldn't read " + key + " — " + msg(e), true);
    const sel = $("page-sel"); if (prev && pages.includes(prev)) sel.value = prev;
    return;
  }
  pageKey = key; currentHtml = html; isDraft = false; // read off disk — a real file from here on
  const rev = await loadReview();
  decisions = rev.comments; lastAuditAt = rev.lastAuditAt; activeId = null;
  renderFrame(); renderSide(); reflect();
  // PROACTIVE: a page with zero open comments and no prior audit reviews ITSELF — the sidebar fills
  // with pinned findings (each with a ready-to-lock recommended fix) with no input. ✦ Audit re-runs.
  if (!decisions.some((c) => c && !c.locked) && !lastAuditAt) void audit();
}

const reviewKey = () => "redline-" + slug(pageKey);
async function loadReview() {
  try {
    const raw = await relay.storage.get(reviewKey());
    const parsed = raw ? JSON.parse(raw) : null;
    const arr = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.comments) ? parsed.comments : [];
    const at = parsed && !Array.isArray(parsed) && Number(parsed.lastAuditAt) ? Number(parsed.lastAuditAt) : 0;
    return { comments: arr.filter(Boolean).map(sanitizeComment), lastAuditAt: at };
  } catch { return { comments: [], lastAuditAt: 0 }; }
}
// A persisted decision can carry loading/writing:true (saved mid-stream by a textarea blur). Restored
// verbatim it would render a dead spinner with no way out — normalize it to the error+retry card.
function sanitizeComment(c) {
  const d = c && c.decision;
  if (d && (d.loading || d.writing)) {
    d.loading = false; d.writing = false; d.status = "";
    const hasContent = (Array.isArray(d.options) && d.options.length) || d.markdown;
    if (!hasContent) d.error = d.error || "interrupted — ask again";
  }
  return c;
}
// "draft · nothing written yet" has to be literally true: while the page is a draft, the review
// sidecar stays in memory too. Saving the draft (or locking an edit) is what writes both.
async function saveReview() {
  if (!relay || isDraft) return;
  try { await relay.storage.set(reviewKey(), JSON.stringify({ comments: decisions, lastAuditAt })); } catch { /* non-fatal */ }
}

// ---------- the frame ----------
const OVERLAY_STYLE = `
  [data-redline]{ outline:2px solid #C8F250 !important; outline-offset:2px; scroll-margin:80px; position:relative; }
  [data-redline]::after{ content:attr(data-redline); position:absolute; top:-11px; left:-11px; width:20px; height:20px; border-radius:50%;
    background:#C8F250; color:#0A0C10; font:700 12px/20px ui-sans-serif,system-ui,sans-serif; text-align:center; z-index:2147483000; pointer-events:none; }
  [data-redline].rl-locked{ outline-color:#3DD68C !important; } [data-redline].rl-locked::after{ background:#3DD68C; }
  @keyframes rlflash { 0%{ background-color: rgba(61,214,140,.4); } 100%{ background-color: transparent; } }
  .rl-flash{ animation: rlflash 1.8s ease-out; }
  .rl-hover{ outline:2px dashed rgba(200,242,80,.9) !important; outline-offset:4px; }
  .rl-sel{ outline:2px solid #C8F250 !important; outline-offset:3px; }
  .rl-editing{ outline:2px dashed #C8F250 !important; outline-offset:3px; cursor:text; }
  html.rl-picking *{ cursor:crosshair !important; }
  html.rl-picking *:hover{ outline:1.5px dashed rgba(200,242,80,.85) !important; outline-offset:1px; }
`;
// SECURITY: srcdoc is same-origin — the reviewed page's own <script>s would run with access to
// window.parent and the injected relay provider (a compromised landing page could drive this app's
// grant). The preview therefore renders a SANITIZED COPY: scripts, inline on* handlers and
// javascript: URLs stripped. Writes always use the pristine currentHtml. The iframe additionally
// carries sandbox=allow-same-origin (no allow-scripts) unless the user flips the "js" toggle for a
// JS-dependent page they trust.
function sanitizedPreview(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const s of doc.querySelectorAll("script")) s.remove();
    for (const n of doc.querySelectorAll("*")) {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
    }
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch { return String(html).replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, ""); }
}
// The change must be SEEN landing: a srcdoc reload resets scroll to the top, so a lock deep in the
// page looked like nothing happened. Re-renders keep the reader's place; a just-locked edit scrolls
// itself into view and flashes green (a removal keeps the old scroll so you see the gap it left).
let flashId = null;
function renderFrame() {
  const frame = $("frame");
  let prevScroll = 0;
  try { prevScroll = frameDoc()?.scrollingElement?.scrollTop ?? 0; } catch { /* first render */ }
  frame.setAttribute("sandbox", runScripts ? "allow-same-origin allow-scripts" : "allow-same-origin");
  frame.srcdoc = runScripts ? currentHtml : sanitizedPreview(currentHtml);
  frame.onload = () => {
    try {
      decorateFrame();
      const doc = frameDoc();
      if (doc?.scrollingElement) doc.scrollingElement.scrollTop = prevScroll;
      if (flashId) {
        const c = decisions.find((x) => x.id === flashId);
        flashId = null;
        const node = c && doc ? findNode(doc, c) : null;
        if (node) {
          node.scrollIntoView({ block: "center" });
          node.classList.add("rl-flash");
          setTimeout(() => { try { node.classList.remove("rl-flash"); } catch { /* frame re-rendered */ } }, 2000);
        }
      }
    } catch { /* timing */ }
  };
}
function frameDoc() { try { return $("frame").contentDocument; } catch { return null; } }
function decorateFrame() {
  const doc = frameDoc(); if (!doc) return;
  let st = doc.getElementById("__redline_style");
  if (!st) { st = doc.createElement("style"); st.id = "__redline_style"; doc.head?.appendChild(st); }
  st.textContent = OVERLAY_STYLE;
  for (const c of decisions) { const n = findNode(doc, c); if (n) { n.setAttribute("data-redline", String(c.num)); n.classList.toggle("rl-locked", !!c.locked); } }
  if (!doc.__rlWired) { doc.addEventListener("click", onFrameClick, true); doc.__rlWired = true; }
  if (!doc.__rlCutWired) {
    doc.addEventListener("scroll", cutSync, { passive: true });
    doc.addEventListener("mouseover", cutPageHover, true);
    doc.addEventListener("click", cutInspectClick, true);
    doc.addEventListener("dblclick", cutInlineEdit, true); // double-click text = type into the page
    doc.addEventListener("keydown", cutKeydown, true); // Delete works even when the frame has focus
    doc.__rlCutWired = true;
  }
  // srcdoc re-renders swap the document; page heights settle late (fonts, images) — re-measure
  if (cutMode) { $("cutbar").hidden = !pageKey; for (const t of [60, 500, 1600]) setTimeout(cutLayout, t); setTimeout(() => cutThumbnails(), 1900); cutSync(); }
  if (cutSel && (!frameDoc() || !frameDoc().contains(cutSel.node))) cutClearSel(); // re-render swapped the doc — the old node is gone
  doc.documentElement.classList.toggle("rl-picking", picking);
}
function onFrameClick(e) {
  if (!picking) return;
  e.preventDefault(); e.stopPropagation();
  const node = e.target; if (!node || node.nodeType !== 1) return;
  commentOn(node);
}
// ONE path creates a decision, whether the click came from the page (comment mode) or from the
// CUT timeline's ELEMENTS track — same anchor, same lifecycle, same Ask/options/lock.
function commentOn(node) {
  const snippet = (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160) || node.tagName.toLowerCase();
  const num = (decisions.reduce((m, c) => Math.max(m, c.num), 0) || 0) + 1;
  const c = { id: uid(), num, selector: cssPath(node), snippet, tag: node.tagName.toLowerCase(), note: "", decision: null, locked: null };
  decisions.push(c);
  setPicking(false);
  activeId = c.id;
  saveReview(); renderSide(); decorateFrame();
  setTimeout(() => { const ta = document.querySelector(`.dec[data-id="${c.id}"] textarea`); ta?.focus(); ta?.scrollIntoView({ block: "center" }); }, 30);
  return c;
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

// ---------- CUT: the timeline surface ----------
// The sidebar answers "what changed"; the timeline answers WHERE in the reader's journey it
// changes. Nothing new is created here: the chips ARE the sidebar's decisions — same numbers,
// same lifecycle (pinned → asking → option ready → locked) — projected onto scroll position.
// The PAGE track renders the page's own top-level blocks as clips; the playhead is the reader.
let cutMode = false;
let cutPlaying = false;
let cutLastT = 0;
const CUT_SPEED = 340; // px/s when "playing" the page like footage
const cutClamp = (v) => Math.max(0, Math.min(1, v));
function cutDoc() { const d = frameDoc(); return d && d.scrollingElement && d.body ? d : null; }
function cutMax(d) { return Math.max(1, d.scrollingElement.scrollHeight - $("frame").clientHeight); }
function cutX(d, y) { return cutClamp(y / cutMax(d)); }
const cutBlockLabel = (n) => (n.id || (n.querySelector?.("h1,h2,h3")?.textContent || "").trim().slice(0, 18) || n.tagName).toLowerCase();
function cutBlocks(d) {
  return [...d.body.children].filter((n) => !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(n.tagName) && n.getBoundingClientRect().height >= 120);
}
function toggleCut(on) {
  cutMode = on ?? !cutMode;
  $("cut-toggle").classList.toggle("on", cutMode);
  $("cutbar").hidden = !cutMode || !pageKey;
  if (cutMode) { cutSync(); setTimeout(() => cutThumbnails(), 300); if (!cutWatchTimer) cutWatchTimer = setInterval(cutWatchTick, 80); } else { cutStop(); cutClearSel(); }
  renderSide(); // position badges on the cards appear/disappear with the bar; renderSide re-lays the tracks too
}
// The sanitized preview iframe (sandbox without allow-scripts) swallows scroll EVENTS even though
// scrolling itself works — and rAF can be throttled to zero in background/embedded contexts — so
// the playhead POLLS scrollTop on an interval. Runs only while CUT is open; stops on toggle-off.
let cutWatchTimer = 0, cutLastY = -1;
function cutWatchTick() {
  if (!cutMode) { clearInterval(cutWatchTimer); cutWatchTimer = 0; return; }
  const d = cutDoc();
  if (d) { const y = d.scrollingElement.scrollTop; if (y !== cutLastY) { cutLastY = y; cutSync(); } }
}
// filmstrip: html2canvas runs PARENT-side against the same-origin frame doc, so it works even
// when the reviewed page's own scripts are sandboxed off. Loaded lazily from CDN; no CDN or a
// tainted block → the clip keeps its label, nothing breaks.
let cutThumbs = [];
let cutThumbing = false;
let h2cReady = null;
function ensureH2C() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!h2cReady) h2cReady = new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => res(window.html2canvas);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return h2cReady;
}
async function cutThumbnails(force) {
  const d = cutDoc(); if (!d || cutThumbing || !cutMode || $("cutbar").hidden) return;
  if (d.__rlThumbed && !force) return;
  cutThumbing = true;
  document.querySelectorAll("#cut-page .cut-clip").forEach((c) => c.classList.add("rendering"));
  const h2c = await ensureH2C();
  const next = [];
  if (h2c) {
    const bg = d.defaultView?.getComputedStyle(d.body).backgroundColor || "#fff";
    for (const n of cutBlocks(d).slice(0, 12)) {
      try {
        const cv = await h2c(n, { backgroundColor: bg, logging: false });
        if (!cv.width || !cv.height) continue;
        const t = document.createElement("canvas");
        t.width = 150; t.height = Math.max(1, Math.round(150 * cv.height / cv.width));
        t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
        const u = t.toDataURL("image/png");
        if (u.length > 200) next.push({ el: n, url: u }); // "data:," (6 bytes) is the taint signature
      } catch { /* tainted or hostile block — label survives */ }
    }
  }
  cutThumbs = next;
  if (cutDoc() === d) d.__rlThumbed = true;
  cutThumbing = false;
  cutLayout();
}
// Every CUT gesture is an INTENT, not an edit. It mints a regular decision (same object, same
// card) with the note pre-written from the gesture, and asks Redline immediately — the AI does
// the work, options land async, LOCK stays the only thing that writes.
function intentDecision(node, note) {
  const c = commentOn(node);
  c.note = note;
  renderSide();
  if (relay) respond(c);
  return c;
}
// ---------- the seams: hover, position and motion travel across all three surfaces ----------
// One hover = three highlights: the element on the page, the chip on the track, the card in
// the sidebar. Any surface can originate it; the others follow.
let cutHoverNode = null;
function setLinkHover(decId, node, on) {
  if (cutHoverNode && (!on || cutHoverNode !== node)) { try { cutHoverNode.classList.remove("rl-hover"); } catch { /* frame re-rendered */ } cutHoverNode = null; }
  if (on && node) { node.classList.add("rl-hover"); cutHoverNode = node; }
  document.querySelectorAll(".dec.linked, .cut-pin.linked, .cut-elb.linked").forEach((x) => x.classList.remove("linked"));
  if (on && decId) {
    document.querySelector(`.dec[data-id="${decId}"]`)?.classList.add("linked");
    document.getElementById("cutpin-" + decId)?.classList.add("linked");
  }
}
// sidebar → page + track, delegated so decisionCard/lockedCard stay untouched
{
  let lastHoverCard = null;
  $("side-body").addEventListener("mouseover", (e) => {
    if (!cutMode) return;
    const card = e.target.closest(".dec[data-id]");
    if (card === lastHoverCard) return;
    lastHoverCard = card;
    const c = card && decisions.filter(Boolean).find((k) => k.id === card.dataset.id);
    const d = c && cutDoc();
    setLinkHover(c ? c.id : null, d ? findNode(d, c) : null, !!c);
  });
  $("side-body").addEventListener("mouseleave", () => { lastHoverCard = null; setLinkHover(null, null, false); });
}
// page → track + sidebar: hovering the page lights the chip/card of a pinned element and the
// ELEMENTS block of any layer — the direction that was still missing
let cutElbByNode = new Map(); // rebuilt every cutLayout: element node → its ELEMENTS-track block
function cutPageHover(e) {
  if (!cutMode || picking || $("cutbar").hidden) return;
  document.querySelectorAll(".dec.linked, .cut-pin.linked, .cut-elb.linked").forEach((x) => x.classList.remove("linked"));
  const pinned = e.target.closest?.("[data-redline]");
  const c = pinned && decisions.filter(Boolean).find((k) => String(k.num) === pinned.getAttribute("data-redline"));
  if (c) {
    document.querySelector(`.dec[data-id="${c.id}"]`)?.classList.add("linked");
    document.getElementById("cutpin-" + c.id)?.classList.add("linked");
  }
  const lay = e.target.closest?.("h1,h2,h3,p,a,button,img,input");
  const elb = lay && cutElbByNode.get(lay);
  if (elb) elb.classList.add("linked");
}
// where a decision lives on the film — stamped on its sidebar card while CUT is open
function cutPosBadge(c) {
  if (!cutMode || $("cutbar").hidden) return "";
  const d = cutDoc(); const n = d && findNode(d, c);
  if (!n) return "";
  return " · ⧗ " + Math.round(cutX(d, n.getBoundingClientRect().top + d.scrollingElement.scrollTop) * 100) + "%";
}
const cutLastStatus = new Map(); // a status transition pulses the chip — change is motion, not just a repaint
// every meaningful layer inside a block, for the ELEMENTS track
function cutBlockElements(n) {
  return [...n.querySelectorAll("h1,h2,h3,p,a,button,img,input")]
    .filter((m) => /^(IMG|INPUT)$/.test(m.tagName) || (m.textContent || "").trim())
    .slice(0, 5);
}
function cutLayout() {
  if (!cutMode || $("cutbar").hidden) return;
  const d = cutDoc(); if (!d) return;
  const scrollTop = d.scrollingElement.scrollTop;
  const thumbByEl = new Map(cutThumbs.map((t) => [t.el, t.url]));
  const clips = $("cut-page"); clips.textContent = "";
  const elems = $("cut-elems"); elems.textContent = "";
  $("cut-back").textContent = "";
  cutElbByNode = new Map();
  const layers = []; // every element across all blocks — laid out as visibility windows below
  // SOUND track: shown only when the page actually has audio layers — sound is part of the film
  // the moment a page carries any (or the founder stages an intent to add some via any element)
  const sounds = [...d.querySelectorAll("audio, video, [data-sound]")];
  $("cut-audio-track").hidden = !sounds.length;
  const audioRow = $("cut-audio"); audioRow.textContent = "";
  for (const s of sounds) {
    const host = s.getBoundingClientRect().height ? s : (s.parentElement || d.body);
    const y = host.getBoundingClientRect().top + scrollTop;
    const auPinned = decisions.filter(Boolean).find((c) => (c.note || "").startsWith("Sound:") && findNode(d, c) === s);
    const au = el("div", "cut-au" + (auPinned ? " pinned" : ""));
    au.style.left = (cutX(d, y) * 100) + "%"; au.style.width = "6%";
    au.append(el("span", null, "♪ " + ((s.getAttribute("src") || s.tagName).split("/").pop() || "sound").slice(0, 16).toLowerCase()));
    au.title = auPinned ? "sound layer — open decision #" + auPinned.num : s.tagName.toLowerCase() + " — when it plays, how loud, how it fades: part of the cut";
    au.onclick = (e) => {
      e.stopPropagation(); cutStop();
      if (auPinned) return cutOpen(auPinned);
      if ($("work").classList.contains("collapsed")) setCollapsed(false);
      intentDecision(s, "Sound: review this page's audio layer — when it should start, at what volume, and whether it needs a fade tied to scroll position.");
    };
    audioRow.append(au);
  }
  for (const [bi, n] of cutBlocks(d).entries()) {
    const r = n.getBoundingClientRect(); const top = r.top + scrollTop;
    const a = cutX(d, top), b = cutX(d, top + r.height);
    const clip = el("div", "cut-clip" + (cutThumbing ? " rendering" : ""));
    clip.style.left = (a * 100) + "%"; clip.style.width = (Math.max(0.02, b - a) * 100) + "%";
    const u = thumbByEl.get(n);
    if (u) { const film = el("div", "film"); const im = document.createElement("img"); im.src = u; im.draggable = false; film.append(im); clip.append(film); }
    clip.append(el("span", "c-name", cutBlockLabel(n)));
    // drag the clip to REORDER sections (like moving footage on a track); a plain click still seeks
    clip.addEventListener("pointerdown", (pe) => {
      if (pe.target.closest(".cut-trn")) return;
      pe.stopPropagation(); // never start a scrub from a clip
      try { clip.setPointerCapture(pe.pointerId); } catch { /* synthetic pointer */ }
      const sx = pe.clientX; let dragging = false; let indicator = null;
      const move = (me) => {
        if (!dragging && Math.abs(me.clientX - sx) > 6) {
          dragging = true; clip.classList.add("dragging");
          indicator = el("div", "cut-dropline"); $("cut-page").append(indicator);
        }
        if (dragging) { const g = cutGapAt(me.clientX); if (g) indicator.style.left = (g.x * 100) + "%"; }
      };
      const up = (ue) => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        clip.classList.remove("dragging"); if (indicator) indicator.remove();
        if (!dragging) { cutStop(); d.scrollingElement.scrollTop = Math.max(0, top - 40); return; }
        cutDropMove(n, ue.clientX);
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
    clips.append(clip);
    // BACKDROP track: the section's real background as a strip — click = restyle intent
    const bkPinned = decisions.filter(Boolean).find((c) => (c.note || "").startsWith("Backdrop:") && findNode(d, c) === n);
    const bk = el("div", "cut-bk" + (bkPinned ? " pinned" : ""));
    bk.style.left = (a * 100) + "%"; bk.style.width = (Math.max(0.02, b - a) * 100) + "%";
    const cs = d.defaultView.getComputedStyle(n);
    bk.style.background = cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor;
    bk.title = bkPinned
      ? '"' + cutBlockLabel(n) + '" backdrop — open decision #' + bkPinned.num
      : '"' + cutBlockLabel(n) + '" backdrop — click to restyle; Redline writes the edit';
    bk.onclick = (e) => {
      e.stopPropagation(); cutStop();
      if (bkPinned) return cutOpen(bkPinned);
      if ($("work").classList.contains("collapsed")) setCollapsed(false);
      intentDecision(n, 'Backdrop: restyle the "' + cutBlockLabel(n) + '" section\'s background — keep the palette, add depth (a subtle gradient or texture), keep text contrast.');
    };
    $("cut-back").append(bk);
    // ⧖ at this block's entrance — how it should come in. An INTENT Redline executes, not a knob.
    if (bi) {
      const label = cutBlockLabel(n);
      const existing = decisions.filter(Boolean).find((c) => (c.note || "").startsWith("Entrance:") && findNode(d, c) === n);
      const trn = el("div", "cut-trn" + (existing ? (existing.locked ? " done" : " staged") : ""), "⧖");
      trn.style.left = (a * 100) + "%";
      trn.title = existing
        ? '"' + label + '" entrance — open decision #' + existing.num
        : '"' + label + '" — stage how this section enters; Redline writes the edit';
      trn.onclick = (e) => {
        e.stopPropagation(); cutStop();
        if (existing) return cutOpen(existing);
        if ($("work").classList.contains("collapsed")) setCollapsed(false);
        intentDecision(n, 'Entrance: make the "' + label + '" section come in softly as it scrolls into view — a gentle fade and rise, no layout jump. Write it into this page\'s own styles.');
      };
      clips.append(trn);
    }
    // collect this block's layers — rendered AFTER the loop as visibility-window bars in lanes
    for (const m of cutBlockElements(n)) layers.push(m);
  }
  // the SECOND clock: wall-time motion (tickers, marquees, pulses, autoplay video) — detected
  // FIRST so anything that moves earns a bar even outside the normal layer set
  const motionBy = new Map();
  try {
    for (const a of (d.getAnimations ? d.getAnimations() : [])) {
      if (a.timeline && a.timeline.constructor && a.timeline.constructor.name !== "DocumentTimeline") continue;
      if (a.animationName === "rl-cutin") continue;
      const t0 = a.effect && a.effect.target; if (!t0) continue;
      const host = (t0.closest && t0.closest("h1,h2,h3,p,a,button,img,input")) || t0;
      const tm = a.effect.getTiming();
      const cur = motionBy.get(host) || { dur: 0, inf: false };
      cur.dur = Math.max(cur.dur, typeof tm.duration === "number" ? tm.duration : 0);
      cur.inf = cur.inf || tm.iterations === Infinity;
      motionBy.set(host, cur);
    }
    for (const v of d.querySelectorAll("video[autoplay], marquee")) motionBy.set((v.closest && v.closest("h1,h2,h3,p,a,button,img,input")) || v, { dur: 0, inf: true });
  } catch { /* no WAAPI → bars stay plain */ }
  for (const host of motionBy.keys()) if (!layers.includes(host) && host.getBoundingClientRect().height) layers.push(host);
  // ELEMENTS as a true time map: each layer's bar spans its VISIBILITY WINDOW — the scroll range
  // during which it is actually on screen (enters when its top crosses the viewport bottom, leaves
  // when its bottom crosses the viewport top) — and simultaneous layers stack into parallel lanes,
  // like V1/V2/V3 in an NLE. At any playhead position, the bars under it are what the viewer sees.
  {
    const vh = $("frame").clientHeight;
    const bars = layers.map((m) => {
      const r = m.getBoundingClientRect();
      const top = r.top + scrollTop;
      let a2 = cutX(d, top - vh);
      const b2 = Math.max(cutX(d, top + r.height), a2 + 0.015);
      const ap = parseFloat(m.getAttribute("data-rl-appear"));
      const retimed = !isNaN(ap);
      if (retimed) a2 = Math.min(b2 - 0.01, a2 + (b2 - a2) * ap / 100); // the bar shows WHEN it appears
      return { m, a: a2, b: b2, lane: 0, retimed };
    }).sort((p, q) => p.a - q.a || q.b - p.b);
    const laneEnds = [];
    for (const L of bars) {
      let lane = laneEnds.findIndex((end) => end <= L.a + 0.004);
      if (lane === -1) {
        if (laneEnds.length < 6) { lane = laneEnds.length; laneEnds.push(0); }
        else { lane = 0; for (let i = 1; i < laneEnds.length; i++) if (laneEnds[i] < laneEnds[lane]) lane = i; }
      }
      L.lane = lane; laneEnds[lane] = L.b;
    }
    const laneH = Math.round(13 * cutScale);
    elems.parentElement.style.height = (Math.max(1, laneEnds.length) * laneH + 3) + "px";
    for (const L of bars) {
      const m = L.m;
      const media = /^(IMG|INPUT)$/.test(m.tagName);
      const pinnedBy = decisions.filter(Boolean).find((c) => findNode(d, c) === m);
      const eb = el("div", "cut-elb" + (media ? " media" : "") + (pinnedBy ? " pinned" : ""));
      eb.style.left = (L.a * 100) + "%";
      eb.style.width = ((L.b - L.a) * 100) + "%";
      eb.style.top = (L.lane * laneH + 1) + "px";
      eb.style.height = (laneH - 2) + "px"; eb.style.bottom = "auto";
      eb.dataset.a = String(L.a); eb.dataset.b = String(L.b);
      const mo = motionBy.get(m);
      if (mo) {
        eb.classList.add("live");
        eb.append(el("i", "loop", (mo.inf ? "∞" : "▸") + (mo.dur ? " " + (mo.dur / 1000).toFixed(1).replace(/\.0$/, "") + "s" : "")));
      }
      eb.append(el("b", null, (L.retimed ? "◔ " : "") + m.tagName.toLowerCase()));
      eb.append(el("span", null, media ? "(media)" : (m.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24)));
      eb.addEventListener("pointerdown", (pe) => {
        pe.stopPropagation();
        try { eb.setPointerCapture(pe.pointerId); } catch { /* synthetic */ }
        const sx = pe.clientX; const startLeft = parseFloat(eb.style.left); let dragging = false;
        const mv = (me) => {
          if (!dragging && Math.abs(me.clientX - sx) > 6) { dragging = true; eb.classList.add("dragging"); }
          if (dragging) { const wr = $("cut-zoomwrap").getBoundingClientRect(); if (wr.width) eb.style.left = (startLeft + (me.clientX - sx) / wr.width * 100) + "%"; }
        };
        const upd = (ue) => {
          window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", upd);
          eb.classList.remove("dragging");
          if (!dragging) return;
          cutBarDragged = true; setTimeout(() => { cutBarDragged = false; }, 0);
          const wr = $("cut-zoomwrap").getBoundingClientRect();
          if (wr.width) cutRetime(m, cutClamp((ue.clientX - wr.left) / wr.width));
        };
        window.addEventListener("pointermove", mv); window.addEventListener("pointerup", upd);
      });
      eb.title = pinnedBy ? "open decision #" + pinnedBy.num
        : media ? m.tagName.toLowerCase() + " — ask your Claude for a mockup to replace it"
        : "click to comment on this " + m.tagName.toLowerCase();
      eb.onclick = (e) => {
        e.stopPropagation(); if (cutBarDragged) return; cutStop();
        m.scrollIntoView({ behavior: "smooth", block: "center" }); // the vice-versa: timeline → that part of the page
        cutSelect(m); // same grammar as the page: click selects, the verb bar acts
      };
      if (cutSel && cutSel.node === m) eb.classList.add("selected");
      eb.onmouseenter = () => setLinkHover(pinnedBy ? pinnedBy.id : null, m, true);
      eb.onmouseleave = () => setLinkHover(null, null, false);
      cutElbByNode.set(m, eb);
      elems.append(eb);
    }
  }
  const pins = $("cut-pins"); pins.textContent = "";
  for (const c of decisions.filter(Boolean)) {
    const node = findNode(d, c); if (!node) continue;
    const y = node.getBoundingClientRect().top + scrollTop;
    const st = cutStatus(c);
    const chip = el("div", "cut-pin " + st + (c.id === activeId ? " sel" : ""), String(c.num));
    chip.id = "cutpin-" + c.id;
    if (cutLastStatus.has(c.id) && cutLastStatus.get(c.id) !== st) chip.classList.add("pulse");
    cutLastStatus.set(c.id, st);
    chip.title = `${c.tag}${c.snippet ? " · " + c.snippet.slice(0, 60) : ""}`;
    chip.style.left = (cutX(d, y) * 100) + "%";
    chip.onclick = (e) => { e.stopPropagation(); cutOpen(c); };
    chip.onmouseenter = () => setLinkHover(c.id, node, true);
    chip.onmouseleave = () => setLinkHover(null, null, false);
    pins.append(chip);
  }
  buildRuler();
  // rails: track names pinned in the left gutter, OUTSIDE the zooming/scrolling area
  const rails = $("cut-rails"); rails.textContent = "";
  const railTop = rails.getBoundingClientRect().top;
  for (const t of document.querySelectorAll("#cutbar .cut-track")) {
    if (t.hidden) continue;
    const r = t.getBoundingClientRect();
    const s = el("span", null, t.dataset.label || "");
    s.style.top = (r.top - railTop + r.height / 2) + "px";
    rails.append(s);
  }
}
function cutStatus(c) {
  if (c.locked) return "done";
  if (busy.has(c.id) || c.decision?.loading) return "busy";
  if (c.decision) return "ready";
  return "pending";
}
function cutOpen(c) {
  cutStop();
  activeId = c.id;
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  scrollToNode(c); renderSide();
  document.querySelector(`.dec[data-id="${c.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function cutSync() {
  if (!cutMode || $("cutbar").hidden) return;
  const d = cutDoc(); if (!d) return;
  const x = cutX(d, d.scrollingElement.scrollTop);
  $("cut-playhead").style.left = (x * 100) + "%";
  $("cut-pct").textContent = Math.round(x * 100) + "%";
  let name = "—";
  for (const n of cutBlocks(d)) if (n.getBoundingClientRect().top <= $("frame").clientHeight * 0.4) name = cutBlockLabel(n);
  $("cut-sec").textContent = name;
  // zoomed in: keep the playhead in view while the film is driven
  if (cutZoom > 1 && (cutPlaying || cutScrubbing)) {
    const wrap = $("cut-zoomwrap"), scrubEl = $("cut-scrub");
    const px = x * wrap.offsetWidth;
    if (px < scrubEl.scrollLeft + 30 || px > scrubEl.scrollLeft + scrubEl.clientWidth - 30) scrubEl.scrollLeft = Math.max(0, px - scrubEl.clientWidth / 2);
  }
  // light the bars whose window contains the playhead — what the viewer sees NOW
  for (const bb of document.querySelectorAll("#cut-elems .cut-elb")) {
    bb.classList.toggle("onscreen", x >= parseFloat(bb.dataset.a || "0") && x <= parseFloat(bb.dataset.b || "1"));
  }
  cutPlaceSelbar(); // the verb bar rides with its element as the page scrolls
  // ⏱ one master clock: the playhead drives wall-time too — tickers, loops and video scrub with it
  if (cutMotionLock) {
    const tMs = x * (cutMax(d) / CUT_SPEED) * 1000;
    try {
      for (const a of d.getAnimations()) {
        if (a.timeline && a.timeline.constructor && a.timeline.constructor.name !== "DocumentTimeline") continue;
        if (a.playState === "running") a.pause();
        a.currentTime = tMs;
      }
    } catch { /* no WAAPI */ }
    for (const v of d.querySelectorAll("video")) { try { if (!v.paused) v.pause(); if (v.duration) v.currentTime = (tMs / 1000) % v.duration; } catch { /* cross-origin */ } }
  }
  // ◎ follow: only while the film is DRIVEN (scrub or play) — never hijack the user's own reading scroll
  if (cutFollow && (cutPlaying || cutScrubbing)) {
    let best = null, bestDist = 0.06; // generous capture radius — scrubbing lands NEAR a chip, not on it
    for (const c of decisions.filter(Boolean)) {
      const n = findNode(d, c); if (!n) continue;
      const cx = cutX(d, n.getBoundingClientRect().top + d.scrollingElement.scrollTop);
      const dist = Math.abs(cx - x);
      if (dist < bestDist) { best = c; bestDist = dist; }
    }
    if (best && best.id !== activeId) {
      activeId = best.id; renderSide();
      document.querySelector(`.dec[data-id="${best.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }
}
// ---------- vertical scale: drag the timeline's top edge like any NLE ----------
let cutScale = 1;
{
  const handle = $("cut-resize");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // capture the pointer: without this the drag DIES the moment the cursor crosses onto the
    // preview iframe (frames swallow pointer events); captured events retarget to the handle and
    // still bubble to window, so the listeners below keep firing (and synthetic tests still work)
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    handle.classList.add("dragging");
    const sy = e.clientY, ss = cutScale;
    const move = (ev) => {
      cutScale = Math.max(0.8, Math.min(3, ss + (sy - ev.clientY) / 120));
      $("cutbar").style.setProperty("--cut-scale", String(cutScale));
      cutLayout(); // lane geometry is inline px — re-lay with the new scale
    };
    const up = () => { handle.classList.remove("dragging"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

// ---------- selection: click = SELECT, verbs act — the video-editor grammar ----------
// A selected element stays selected (lime outline on the page, ring on its bar) and grows a
// floating verb bar: Change / Delete / Duplicate / Mock up. Delete and Duplicate PRE-SEED a
// ready-to-lock edit when the element's serialized HTML matches source exactly-once; otherwise
// they Ask the model for the safe edit. Lock stays the only thing that writes.
let cutSel = null; // { node } — single selection
function cutClearSel() {
  if (cutSel && cutSel.node) { try { cutSel.node.classList.remove("rl-sel"); } catch { /* frame re-rendered */ } }
  cutSel = null;
  const bar = $("cut-selbar"); if (bar) bar.hidden = true;
  document.querySelectorAll(".cut-elb.selected").forEach((x) => x.classList.remove("selected"));
}
function cutSelect(node) {
  cutClearSel();
  if (!node) return;
  cutSel = { node };
  node.classList.add("rl-sel");
  const elb = cutElbByNode.get(node);
  if (elb) {
    elb.classList.add("selected");
    const scrub = $("cut-scrub"), wrap = $("cut-zoomwrap");
    const px = (parseFloat(elb.style.left) / 100) * wrap.offsetWidth;
    if (px < scrub.scrollLeft + 20 || px > scrub.scrollLeft + scrub.clientWidth - 60) scrub.scrollLeft = Math.max(0, px - scrub.clientWidth / 3);
  }
  cutBuildSelbar();
  cutPlaceSelbar();
}
function cutBuildSelbar() {
  const bar = $("cut-selbar"); bar.textContent = "";
  const m = cutSel.node;
  const media = /^(IMG|INPUT)$/.test(m.tagName);
  const doc = frameDoc();
  const pinnedBy = decisions.filter(Boolean).find((c) => doc && findNode(doc, c) === m);
  bar.append(el("b", null, m.tagName.toLowerCase()));
  const verb = (label, fn, danger) => { const b = el("button", danger ? "danger" : null, label); b.onclick = (e) => { e.stopPropagation(); fn(); }; bar.append(b); };
  if (pinnedBy) verb("Open #" + pinnedBy.num, () => { if ($("work").classList.contains("collapsed")) setCollapsed(false); cutOpen(pinnedBy); });
  else if (media) verb("✦ Mock up", () => { if ($("work").classList.contains("collapsed")) setCollapsed(false); intentDecision(m, "Mock up a stronger replacement for this " + (m.tagName === "IMG" ? "image" : "form element") + " — match the page's style and palette."); });
  else verb("✎ Change", () => { if ($("work").classList.contains("collapsed")) setCollapsed(false); commentOn(m); });
  verb("⌫ Delete", () => cutDeleteSel(), true);
  if (!media) verb("⧉ Duplicate", () => cutDupSel());
  // moving elements get a Freeze verb — a persistent style edit through the same lock gate
  let liveTargets = [];
  try {
    liveTargets = [...new Set(m.getAnimations({ subtree: true })
      .filter((a) => !(a.timeline && a.timeline.constructor && a.timeline.constructor.name !== "DocumentTimeline") && a.animationName !== "rl-cutin")
      .map((a) => a.effect && a.effect.target).filter(Boolean))];
  } catch { /* none */ }
  if (liveTargets.length) {
    const doc2 = frameDoc();
    const frozen = liveTargets.every((t) => doc2.defaultView.getComputedStyle(t).animationPlayState.includes("paused"));
    verb(frozen ? "▶ Unfreeze" : "⏸ Freeze", () => {
      if ($("work").classList.contains("collapsed")) setCollapsed(false);
      if (liveTargets.length === 1 && liveTargets[0] === m) {
        const before = cutCleanHtml(m);
        const c2 = cutCleanNode(m);
        if (frozen) { c2.style.removeProperty("animation-play-state"); if (!c2.getAttribute("style")) c2.removeAttribute("style"); }
        else c2.style.animationPlayState = "paused";
        preseedEdit(m, (frozen ? "Unfreeze" : "Freeze") + " this element's motion.", frozen ? "Unfreeze" : "Freeze it", frozen ? "moves again" : "holds still", before, c2.outerHTML, (frozen ? "Resume" : "Pause") + " its animation");
      } else {
        intentDecision(m, (frozen ? "Unfreeze" : "Freeze") + " the motion inside this " + m.tagName.toLowerCase() + " — " + (frozen ? "let its animation run again" : "pause its animation so it holds still") + ", changing nothing else.");
      }
      cutClearSel();
    });
  }
  if (m.getAttribute && m.getAttribute("data-rl-appear")) verb("◔ Reset timing", () => {
    const before = cutCleanHtml(m);
    const c2 = cutCleanNode(m);
    c2.removeAttribute("data-rl-appear");
    for (const p of ["animation-name", "animation-timeline", "animation-range", "animation-fill-mode"]) c2.style.removeProperty(p);
    if (!c2.getAttribute("style")) c2.removeAttribute("style");
    if ($("work").classList.contains("collapsed")) setCollapsed(false);
    preseedEdit(m, "Reset this element's entrance timing.", "Reset timing", "appears naturally", before, c2.outerHTML, "Remove scroll-driven entrance");
    cutClearSel();
  });
  const x = el("button", null, "✕"); x.onclick = (e) => { e.stopPropagation(); cutClearSel(); }; bar.append(x);
  bar.hidden = false;
}
function cutPlaceSelbar() {
  const bar = $("cut-selbar"); if (!bar || bar.hidden || !cutSel || !cutSel.node) return;
  let r; try { r = cutSel.node.getBoundingClientRect(); } catch { return cutClearSel(); }
  const fw = $("frame").getBoundingClientRect();
  bar.style.top = Math.max(4, Math.min(fw.height - 38, r.top - 36)) + "px";
  bar.style.left = Math.max(4, Math.min(fw.width - bar.offsetWidth - 8, r.left)) + "px";
}
// a clone of the node minus redline's own decorations — safe to mutate for building edits
function cutCleanNode(m) {
  const c = m.cloneNode(true);
  for (const n of [c, ...c.querySelectorAll("[data-redline], .rl-sel, .rl-hover, .rl-locked, .rl-flash, .rl-editing")]) {
    n.removeAttribute("data-redline");
    n.classList.remove("rl-sel", "rl-hover", "rl-locked", "rl-flash", "rl-editing");
    if (!n.getAttribute("class")) n.removeAttribute("class");
  }
  return c;
}
function cutCleanHtml(m) { return cutCleanNode(m).outerHTML; }
// ---------- retime: drag an ELEMENTS bar horizontally = change WHEN it comes in ----------
// Inside its own window → a scroll-driven CSS entrance (invisible until that moment; pure CSS,
// works with page scripts off) pre-seeded ready to lock. Outside its window → the model is asked
// to move it there coherently. Same rule as everything: lock writes.
let cutBarDragged = false;
function cutNaturalWindow(m) {
  const d = cutDoc();
  const scrollTop = d.scrollingElement.scrollTop;
  const r = m.getBoundingClientRect(); const top = r.top + scrollTop;
  const a = cutX(d, top - $("frame").clientHeight);
  return [a, Math.max(cutX(d, top + r.height), a + 0.02)];
}
function cutRetime(m, drop) {
  const [a, b] = cutNaturalWindow(m);
  const pct = Math.round(drop * 100);
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  if (drop > a + 0.01 && drop < b - 0.01) {
    const P = Math.round(((drop - a) / (b - a)) * 100);
    const before = cutCleanHtml(m);
    const clone = cutCleanNode(m);
    clone.setAttribute("data-rl-appear", String(P));
    clone.style.animationName = "rl-cutin";
    clone.style.animationTimeline = "view()";
    clone.style.animationRange = "cover " + Math.max(0, P - 2) + "% cover " + Math.min(100, P + 12) + "%";
    clone.style.animationFillMode = "both";
    const kf = currentHtml.includes("@keyframes rl-cutin") ? "" : '<style id="rl-cutin">@keyframes rl-cutin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}</style>';
    preseedEdit(m, "Retime: this should first appear around " + pct + "% of the scroll.", "Retime it", "comes in at ~" + pct + "%", before, kf + clone.outerHTML, "Scroll-driven entrance");
  } else {
    intentDecision(m, "Retime: this " + m.tagName.toLowerCase() + " should first appear around " + pct + "% of the page's scroll — move it (or delay its entrance) so it comes in there, keeping the design coherent.");
  }
}
function preseedEdit(m, note, label, text, find, replace, summary) {
  const c = commentOn(m);
  c.note = note;
  const idx = find ? currentHtml.indexOf(find) : -1;
  if (idx !== -1 && currentHtml.indexOf(find, idx + 1) === -1) {
    const opt = { id: uid(), label, text, edit: { find, replace }, recommended: true };
    c.decision = { kind: "edit", lockable: true, loading: false, status: "", options: [opt], selectedId: opt.id, steers: [], markdown: "", find, summary, preseeded: true };
  } else if (relay) {
    respond(c); // serialized DOM ≠ authored source here — the model finds the safe edit instead
  }
  saveReview(); renderSide();
}
function cutDeleteSel() {
  const m = cutSel && cutSel.node; if (!m) return;
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  preseedEdit(m, "Delete this " + m.tagName.toLowerCase() + ".", "Remove it", "(removed)", cutCleanHtml(m), "", "Remove this element");
  cutClearSel();
}
function cutDupSel() {
  const m = cutSel && cutSel.node; if (!m) return;
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  const html = cutCleanHtml(m);
  preseedEdit(m, "Duplicate this " + m.tagName.toLowerCase() + ".", "Duplicate", "(duplicated)", html, html + html, "Duplicate this element");
  cutClearSel();
}
// ---------- undo/redo: every locked write snapshots the whole page — ⌘Z back, ⇧⌘Z forward ----------
// Snapshots (not inverse edits) because a deletion's inverse has no unique anchor; whole-page
// restore through the SAME storage.set path every lock uses. Session-local, capped at 30.
const cutUndoStack = [];
const cutRedoStack = [];
async function cutTimeTravel(fromStack, toStack, label) {
  if (!fromStack.length || !relay || !pageKey) return;
  const html = fromStack.pop();
  toStack.push(currentHtml);
  try {
    await relay.storage.set(pageKey, html);
    currentHtml = html;
    renderFrame(); renderSide();
    toast(label + " ✓");
  } catch (e) { fromStack.push(html); toStack.pop(); toast(label + " failed — " + msg(e), true); }
}
function cutKeydown(e) {
  if (!cutMode) return;
  const t = e.target;
  if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) void cutTimeTravel(cutRedoStack, cutUndoStack, "Redo");
    else void cutTimeTravel(cutUndoStack, cutRedoStack, "Undo");
    return;
  }
  if (e.key === "Escape") { cutClearSel(); return; }
  if ((e.key === "Delete" || e.key === "Backspace") && cutSel) { e.preventDefault(); cutDeleteSel(); }
}
window.addEventListener("keydown", cutKeydown);
// ---------- inline edit: double-click text on the canvas, type, Enter — the editor's native verb ----------
// The live DOM previews your words immediately; committing stages a ready-to-lock rewrite
// (find = the element's clean serialization when it matches source exactly-once, model otherwise).
function cutInlineEdit(e) {
  if (!cutMode || picking || $("cutbar").hidden) return;
  const lay = e.target.closest?.("h1,h2,h3,p,a,button");
  if (!lay || !cutElbByNode.get(lay)) return;
  e.preventDefault(); e.stopPropagation();
  cutClearSel();
  const before = cutCleanHtml(lay);
  const beforeInner = lay.innerHTML;
  lay.setAttribute("contenteditable", "plaintext-only");
  lay.classList.add("rl-editing");
  lay.focus();
  try { const s = frameDoc().getSelection(); s.selectAllChildren(lay); } catch { /* selection is a nicety */ }
  const finish = (commit) => {
    lay.removeEventListener("blur", onBlur); lay.removeEventListener("keydown", onKey);
    lay.removeAttribute("contenteditable"); lay.classList.remove("rl-editing");
    if (!commit) { lay.innerHTML = beforeInner; return; }
    const after = cutCleanHtml(lay);
    if (after === before) return;
    if ($("work").classList.contains("collapsed")) setCollapsed(false);
    preseedEdit(lay, "Rewrite this " + lay.tagName.toLowerCase() + " to: " + (lay.textContent || "").trim().slice(0, 80),
      "Your rewrite", (lay.textContent || "").trim().slice(0, 120), before, after, "Direct rewrite");
  };
  const onBlur = () => finish(true);
  const onKey = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); lay.blur(); }
    else if (ev.key === "Escape") { ev.preventDefault(); lay.removeEventListener("blur", onBlur); finish(false); }
  };
  lay.addEventListener("blur", onBlur);
  lay.addEventListener("keydown", onKey);
}
// ---------- drag-reorder: move a section like a clip on the track ----------
// The drop becomes a SOURCE-LEVEL move (one find/replace spanning both sections, interstitial
// whitespace preserved) pre-seeded ready to lock — or an intent for the model when the page's
// serialization doesn't match its source. Same gate as everything: lock writes, nothing else.
function cutGapAt(clientX) {
  const d = cutDoc(); const blocks = cutBlocks(d);
  const wr = $("cut-zoomwrap").getBoundingClientRect();
  if (!wr.width) return null; // mid-re-render or zero-size viewport — a drop must be a no-op, never "move to top"
  const fx = (clientX - wr.left) / wr.width;
  if (!isFinite(fx)) return null;
  const scrollTop = d.scrollingElement.scrollTop;
  let best = { after: null, x: 0, dist: Math.abs(fx) }; // the gap before the first block
  for (const nb of blocks) {
    const r = nb.getBoundingClientRect();
    const end = cutX(d, r.top + scrollTop + r.height);
    if (Math.abs(fx - end) < best.dist) best = { after: nb, x: end, dist: Math.abs(fx - end) };
  }
  return best;
}
function cutDropMove(A, clientX) {
  const d = cutDoc(); if (!d) return;
  const gap = cutGapAt(clientX);
  if (!gap) return;
  const B = gap.after;
  if (B === A) return;
  const blocks = cutBlocks(d); const ai = blocks.indexOf(A);
  if ((B === null && ai === 0) || (B && blocks.indexOf(B) === ai - 1)) return; // dropped where it already lives
  const src = currentHtml;
  const aH = cutCleanHtml(A);
  const aIdx = src.indexOf(aH);
  const aOk = aIdx !== -1 && src.indexOf(aH, aIdx + 1) === -1;
  const label = cutBlockLabel(A), tLabel = B ? cutBlockLabel(B) : "the top";
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  const bH = B ? cutCleanHtml(B) : null;
  const bIdx = bH ? src.indexOf(bH) : -1;
  const bOk = !B || (bIdx !== -1 && src.indexOf(bH, bIdx + 1) === -1);
  if (!aOk || !bOk) {
    intentDecision(A, 'Move: place the "' + label + '" section ' + (B ? 'immediately AFTER the "' + tLabel + '" section' : "at the very top of the page") + ", keeping everything else unchanged.");
    return;
  }
  let find, replace;
  if (B === null) {
    const fH = cutCleanHtml(blocks[0]); const fIdx = src.indexOf(fH);
    find = src.slice(fIdx, aIdx + aH.length);
    replace = aH + src.slice(fIdx, aIdx);
  } else if (aIdx < bIdx) {
    find = src.slice(aIdx, bIdx + bH.length);
    replace = src.slice(aIdx + aH.length, bIdx + bH.length) + aH;
  } else {
    find = src.slice(bIdx, aIdx + aH.length);
    replace = src.slice(bIdx, bIdx + bH.length) + aH + src.slice(bIdx + bH.length, aIdx);
  }
  preseedEdit(A, 'Move the "' + label + '" section ' + (B ? 'after "' + tLabel + '"' : "to the top") + ".", "Move it", "(moved)", find, replace, "Reorder sections");
}
// click ON THE PAGE: select the layer under the cursor; empty space clears. Footage never navigates.
function cutInspectClick(e) {
  if (!cutMode || picking || $("cutbar").hidden) return;
  e.preventDefault(); e.stopPropagation();
  const lay = e.target.closest?.("h1,h2,h3,p,a,button,img,input");
  if (!lay || !cutElbByNode.get(lay)) return cutClearSel();
  cutSelect(lay);
}

// ---------- zoom: the film at section scale ----------
// zoomwrap scales horizontally inside the scrolling scrub; every position stays in % of the wrap,
// so clips/playhead/seek all keep working at any zoom. Zoom anchors on the playhead (or cursor).
let cutZoom = 1;
function cutFracFromEvent(e) { const r = $("cut-zoomwrap").getBoundingClientRect(); return cutClamp((e.clientX - r.left) / r.width); }
function buildRuler() {
  const ruler = $("cut-ruler"); if (!ruler) return;
  ruler.textContent = "";
  const step = cutZoom >= 6 ? 5 : cutZoom >= 3 ? 10 : 25;
  for (let p = 0; p <= 100; p += step) { const s = el("span", null, p + "%"); s.style.left = p + "%"; ruler.append(s); }
}
function setCutZoom(z, anchorFrac) {
  z = Math.max(1, Math.min(12, z));
  const scrub = $("cut-scrub"), wrap = $("cut-zoomwrap");
  const d = cutDoc();
  const frac = anchorFrac != null ? anchorFrac : (d ? cutX(d, d.scrollingElement.scrollTop) : 0);
  const anchorPx = frac * wrap.offsetWidth - scrub.scrollLeft; // keep the anchor at the same screen x
  cutZoom = z;
  wrap.style.width = (z * 100) + "%";
  scrub.scrollLeft = Math.max(0, frac * wrap.offsetWidth - anchorPx);
  buildRuler();
}
$("cut-zoom-in").addEventListener("click", () => setCutZoom(cutZoom * 1.5));
$("cut-zoom-out").addEventListener("click", () => setCutZoom(cutZoom / 1.5));
$("cut-zoom-fit").addEventListener("click", () => setCutZoom(1));
$("cut-scrub").addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = the native horizontal scroll
  e.preventDefault();
  setCutZoom(cutZoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), cutFracFromEvent(e));
}, { passive: false });

let cutScrubbing = false; // module-visible: follow mode needs to know the film is being driven
{
  const scrub = $("cut-scrub");
  const seek = (e) => { const d = cutDoc(); if (!d) return; d.scrollingElement.scrollTop = cutFracFromEvent(e) * cutMax(d); };
  scrub.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".cut-pin,.cut-elb,.cut-trn,.cut-bk,.cut-au")) return;
    try { scrub.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } // scrub survives the cursor crossing the iframe
    cutScrubbing = true; cutStop(); seek(e);
  });
  window.addEventListener("pointermove", (e) => { if (cutScrubbing) seek(e); });
  window.addEventListener("pointerup", () => { cutScrubbing = false; });
}
// ◎ follow: while the film is being driven, the decision under the playhead opens itself —
// review by scrubbing, instead of scrub-then-hunt-then-click
let cutFollow = false;
$("cut-follow").addEventListener("click", () => { cutFollow = !cutFollow; $("cut-follow").classList.toggle("on", cutFollow); });
// ⏱ preview-only: locking wall-time to the playhead changes nothing in the file — it makes the
// page's own motion scrubbable while you edit
let cutMotionLock = false;
$("cut-motion").addEventListener("click", () => {
  const d = cutDoc(); if (!d) return;
  cutMotionLock = !cutMotionLock;
  $("cut-motion").classList.toggle("on", cutMotionLock);
  if (!cutMotionLock) {
    try {
      for (const a of d.getAnimations()) {
        const t = a.effect && a.effect.target;
        if (t && d.defaultView.getComputedStyle(t).animationPlayState.includes("paused")) continue; // frozen stays frozen
        a.play();
      }
    } catch { /* no WAAPI */ }
    for (const v of d.querySelectorAll("video[autoplay]")) { try { v.play(); } catch { /* fine */ } }
  } else cutSync();
  toast(cutMotionLock ? "Motion locked to the playhead — scrubbing drives the page's own animation" : "Motion runs free again");
});
let cutPlayTimer = 0;
function cutTick() {
  if (!cutPlaying) return;
  const d = cutDoc(); if (!d) return cutStop();
  const t = performance.now(); const dt = (t - cutLastT) / 1000; cutLastT = t;
  d.scrollingElement.scrollTop += CUT_SPEED * dt;
  if (d.scrollingElement.scrollTop >= cutMax(d) - 2) cutStop();
}
function cutStop() { cutPlaying = false; if (cutPlayTimer) { clearInterval(cutPlayTimer); cutPlayTimer = 0; } const b = $("cut-play"); b.classList.remove("on"); b.textContent = "▶"; }
function cutPlay() {
  if (cutPlaying) return cutStop();
  const d = cutDoc(); if (!d) return;
  cutPlaying = true; const b = $("cut-play"); b.classList.add("on"); b.textContent = "❚❚";
  cutLastT = performance.now(); cutPlayTimer = setInterval(cutTick, 33);
}
function cutJump(dir) {
  const d = cutDoc(); if (!d) return; cutStop();
  const here = d.scrollingElement.scrollTop;
  const anchored = decisions.filter(Boolean)
    .map((c) => { const n = findNode(d, c); return n ? { c, y: n.getBoundingClientRect().top + here } : null; })
    .filter(Boolean).sort((a, b) => a.y - b.y);
  const hit = dir > 0 ? anchored.find((a) => a.y > here + 8) : [...anchored].reverse().find((a) => a.y < here - 8);
  if (hit) cutOpen(hit.c);
}
$("cut-toggle").addEventListener("click", () => toggleCut());
$("cut-play").addEventListener("click", cutPlay);
$("cut-prev").addEventListener("click", () => cutJump(-1));
$("cut-next").addEventListener("click", () => cutJump(1));
$("cut-rethumb").addEventListener("click", () => cutThumbnails(true));

// ---------- comment mode + view + collapse ----------
$("pick-toggle").addEventListener("click", () => setPicking(!picking));
$("add-comment").addEventListener("click", () => { if ($("work").classList.contains("collapsed")) setCollapsed(false); setPicking(true); });
$("send-all").addEventListener("click", sendAll);
$("publish").addEventListener("click", publish);
$("audit").addEventListener("click", audit);
$("run-scripts").addEventListener("click", () => {
  runScripts = !runScripts;
  const b = $("run-scripts");
  b.classList.toggle("on", runScripts);
  b.textContent = runScripts ? "js on" : "js off";
  if (runScripts) toast("Page scripts now run inside the preview — only enable this for pages you trust.");
  if (pageKey) renderFrame();
});
// ---------- audit: ONE upfront pass over the WHOLE page (true brandbrain style) ----------
// The AI reads the full source once and pins its findings — AI-slop copy, pointless meta-text,
// dead sections — as comments with the note pre-filled AND, where the fix survives validation,
// a ready recommended option: open the card and Lock & write is already loaded. Steer regenerates.
// Runs AUTOMATICALLY the first time a page opens with nothing pinned (the proactive first batch);
// the ✦ Audit button is the "generate more" re-run.
let auditing = false;
// complete array elements from a PARTIAL stream: parse up to the last closing brace; a brace that
// closes mid-element fails the parse and we simply wait for more text
function parseJsonPrefix(text) {
  const s = text.indexOf("["); if (s < 0) return null;
  const e = text.lastIndexOf("}"); if (e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1) + "]"); } catch { return null; }
}
async function audit() {
  if (!relay || !pageKey || auditing) return;
  const forPage = pageKey; // if the user switches pages mid-audit, drop the results — never pin page A's findings onto page B
  auditing = true; updateAudit(); renderSide();
  let added = 0, streamedThrough = 0;
  // one finding → one pinned decision; used BOTH by the stream (as each element completes) and by
  // the final pass — the snippet-overlap dedupe makes the second call a no-op for anything pinned
  const pinFinding = (f) => {
    const snippet = String(f.snippet || "").trim();
    const issue = String(f.issue || "").trim();
    if (!snippet || !issue) return false;
    if (decisions.some((c) => c.snippet && (c.snippet.includes(snippet.slice(0, 40)) || snippet.includes(c.snippet.slice(0, 40))))) return false;
    const doc = frameDoc();
    const node = doc ? locateBySnippet(doc, f.tag, snippet) : null;
    const num = (decisions.reduce((m, c) => Math.max(m, c.num), 0) || 0) + 1;
    const c = {
      id: uid(), num,
      selector: node ? cssPath(node) : "",
      snippet: node ? (node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160) : snippet,
      tag: (node ? node.tagName.toLowerCase() : String(f.tag || "section")).slice(0, 12),
      note: issue.slice(0, 300), decision: null, locked: null,
    };
    // pre-seed the ready-to-lock option when the audit's edit applies cleanly to the source
    const find = typeof f.find === "string" && f.find.length >= 8 ? f.find : null;
    if (find && f.replace != null && currentHtml.includes(find)) {
      const opt = { id: uid(), label: String(f.label || "Suggested fix").slice(0, 40), text: String(f.preview || "").trim() || stripTags(String(f.replace)).trim().slice(0, 220) || "(removed)", edit: { find, replace: String(f.replace) }, recommended: true };
      c.decision = { kind: "edit", lockable: true, loading: false, status: "", options: [opt], selectedId: opt.id, steers: [], markdown: "", find, summary: c.note, preseeded: true };
    }
    decisions.push(c); added++;
    return true;
  };
  // findings land on the page + timeline AS THE MODEL FINDS THEM, not as one batch at the end
  const onChunk = (p) => {
    if (!p.text || pageKey !== forPage) return;
    const arr = parseJsonPrefix(p.text);
    if (!arr || arr.length <= streamedThrough) return;
    let fresh = 0;
    for (const f of arr.slice(streamedThrough, 10)) if (pinFinding(f)) fresh++;
    streamedThrough = Math.min(arr.length, 10);
    if (fresh) { renderSide(); decorateFrame(); }
  };
  try {
    const text = await streamText({
      prompt: [
        "You are Redline, auditing a landing page like a sharp editor + designer. Find the WORST offenders: AI-slop copy (generic hype, filler, clichés like unleash/seamless/empower/elevate, walls of meta-text), pointless or redundant meta lines, dead or duplicated sections, inconsistent voice, weak headlines. 5–8 findings, most damaging first.",
        "Within that budget, you may include up to 2 FILM findings — about how the page MOVES, not what it says: a section whose entrance feels abrupt or lifeless as the reader scrolls to it, or an image that undercuts its section. For an entrance finding: tag = the section's own tag, snippet = exact visible text from inside that section, and issue MUST start with \"Entrance: \". Motion rarely fits a safe find/replace — omit find/replace for these unless certain.",
        'Return ONLY a JSON array — no prose, no fences. Each element: {"tag":<lowercase tag of the element, e.g. "p">,"snippet":<EXACT visible text of that element, ≤100 chars, verbatim>,"issue":<one blunt sentence: what is wrong + the direction to fix>,"label":<2–4 word name for the fix>,"find":<EXACT unique substring of SOURCE containing what to change, ≤300 chars, enough markup to be unique>,"replace":<the find with the fix applied; "" to delete the element; ≤400 chars>,"preview":<the new visible text, or "removed">}',
        "If a finding can't be expressed as a safe find/replace, omit find/replace and keep the issue only.",
        "SOURCE:\n" + currentHtml,
      ].join("\n\n"),
      maxTokens: 8000,
    }, onChunk);
    if (pageKey !== forPage) return; // stale — a different page is open now
    // Mark this page audited even on a clean/empty pass, so the auto-run never loops on reload.
    lastAuditAt = Date.now();
    const arr = parseJsonArray(text);
    if ((!arr || !arr.length) && !added) { await saveReview(); toast("Audit came back empty — press ✦ Audit to run it again."); return; }
    for (const f of (arr || []).slice(0, 10)) pinFinding(f); // stragglers only — the dedupe guard makes this idempotent
    saveReview(); renderSide(); decorateFrame();
    toast(added ? `Audit ✓ ${added} suggestion${added === 1 ? "" : "s"} pinned — open a card, the fix is ready to lock` : "Audit ✓ nothing new beyond your existing comments");
  } catch (e) { toast("Audit failed — " + msg(e), true); }
  finally { auditing = false; updateAudit(); renderSide(); }
}
function updateAudit() {
  const b = $("audit"); if (!b) return;
  b.hidden = !relay || !pageKey;
  b.disabled = auditing;
  b.textContent = auditing ? "auditing…" : "✦ Audit";
}
// Re-find an audit finding's element by its visible text — smallest matching node wins.
function locateBySnippet(doc, tag, snippet) {
  const want = snippet.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();
  if (!want || !doc.body) return null;
  const sel = tag && /^[a-z0-9]+$/i.test(String(tag)) ? String(tag) : "h1,h2,h3,h4,p,li,a,button,blockquote,pre,span,div";
  let best = null;
  for (const n of doc.body.querySelectorAll(sel)) {
    const t = (n.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (t.includes(want) && (!best || (n.textContent || "").length < (best.textContent || "").length)) best = n;
  }
  return best;
}
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}
// ---------- publish: commit + push the bound folder via the daemon's relay__git_commit_push ----------
// The REAL confirmation is the Switchboard consent card (repo, branch, diffstat — a human click the
// model can't fake). The in-sidebar card here only chooses the message and live-vs-review-branch —
// and its Cancel truly aborts (no dialog where "Cancel" still pushes).
let publishing = false;
let publishUI = null; // { message, choice: "branch"|"live", branch }
function publish() {
  if (!relay || !pageKey || publishing) return;
  if (publishUI) { publishUI = null; renderSide(); return; }
  if ($("work").classList.contains("collapsed")) setCollapsed(false);
  const done = decisions.filter((c) => c && c.locked);
  const defaultMsg = "redline: " + (done.length
    ? done.map((c) => (c.locked.label || labelFor(c.locked.kind)) + (c.note ? " — " + c.note.slice(0, 40) : "")).slice(0, 4).join("; ")
    : "page edits");
  publishUI = {
    message: defaultMsg,
    choice: "branch",
    branch: "redline/" + new Date().toISOString().slice(2, 16).replace(/[-:T]/g, ""),
  };
  renderSide();
  setTimeout(() => document.querySelector(".pubcard .pub-msg")?.focus(), 30);
}
function publishCard() {
  const card = el("div", "dec active pubcard");
  const b = el("div", "dec-body pub-body");
  b.append(el("div", "kicker pub-k", "publish — commit & push this project"));
  const input = el("input", "pub-msg");
  input.value = publishUI.message; input.placeholder = "commit message";
  b.append(input);
  const opts = el("div", "opts");
  let goBtn = null;
  const mkOpt = (choice, label, text, rec) => {
    const o = el("div", "opt" + (publishUI.choice === choice ? " sel" : ""));
    o.onclick = () => { publishUI.choice = choice; renderSide(); };
    o.append(el("div", "check", "✓"));
    if (rec) o.append(el("div", "rec", "recommended"));
    o.append(el("div", "o-label", label));
    o.append(el("div", "o-text", text));
    return o;
  };
  opts.append(
    mkOpt("branch", "Review branch", "pushes to " + publishUI.branch + " — merge when you're happy", true),
    mkOpt("live", "Push live", "commits straight to the current branch"),
  );
  b.append(opts);
  if (publishing) {
    const r = el("div", "researching");
    r.append(el("div", "scan"), el("span", null, "publishing — approve the Switchboard card…"));
    b.append(r);
  } else {
    const foot = el("div", "dec-foot");
    goBtn = el("button", "lock", "⇪ Publish");
    goBtn.disabled = !publishUI.message.trim();
    goBtn.onclick = doPublish;
    const cancel = el("button", "discard", "Cancel");
    cancel.onclick = () => { publishUI = null; renderSide(); };
    foot.append(goBtn, cancel);
    b.append(foot);
  }
  input.addEventListener("input", () => { publishUI.message = input.value; if (goBtn) goBtn.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) doPublish(); });
  card.append(b);
  return card;
}
async function doPublish() {
  if (!relay || publishing || !publishUI) return;
  const message = publishUI.message.trim(); if (!message) return;
  const branch = publishUI.choice === "branch" ? publishUI.branch : undefined;
  publishing = true; updatePublish(); renderSide();
  try {
    const args = { message, ...(branch ? { branch } : {}) };
    const text = await streamText({
      prompt: "Call the relay git_commit_push tool EXACTLY ONCE with exactly these arguments: " + JSON.stringify(args) + ". Then reply with ONLY the JSON result the tool returned — no prose, no fences.",
      agentic: true,
    });
    const out = parseJson(text);
    if (out && out.ok) {
      toast("Published ✓ " + (out.sha || "") + " → " + (branch || "live") + (out.changes ? " · " + out.changes : ""));
      publishUI = null;
    } else if (!out && String(text || "").trim()) {
      // A reused pre-tools grant (exact-match) makes the model answer in prose instead of running the
      // tool — surface the actual fix instead of a generic "no result".
      throw new Error("your grant predates publishing — disconnect and reconnect the Switchboard chip, then publish again");
    } else {
      throw new Error((out && out.error) || "no result came back");
    }
  } catch (e) { toast("Publish failed — " + msg(e), true); }
  finally { publishing = false; updatePublish(); renderSide(); }
}
function updatePublish() {
  const b = $("publish"); if (!b) return;
  // A draft isn't on disk yet, so there is nothing for git to commit — "save page" (or the first
  // Lock & write) comes first, and Publish reappears the moment the file is real.
  b.hidden = !relay || !pageKey || isDraft;
  b.disabled = publishing;
  b.textContent = publishing ? "publishing…" : "⇪ Publish";
}
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
    // Malformed/empty router output is an ERROR (retry card) — never a fake "(no reply)" reply the
    // user could mark done.
    if (!route || typeof route !== "object" || !route.mode) throw new Error("no decision came back — try again");
    const mode = route.mode;
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
      if (!route.markdown) throw new Error("no decision came back — try again");
      c.decision.kind = "reply"; c.decision.lockable = false;
      c.decision.markdown = route.markdown;
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
    cutUndoStack.push(currentHtml); if (cutUndoStack.length > 30) cutUndoStack.shift(); cutRedoStack.length = 0; // every write is one ⌘Z away from undone
    await relay.storage.set(pageKey, applied.next);
    currentHtml = applied.next;
    // Locking an edit on a DRAFT is the moment it stops being a draft: the file now exists on disk.
    if (isDraft) {
      isDraft = false;
      pages = [pageKey];
      const sel = $("page-sel");
      sel.textContent = "";
      sel.append(new Option(pageKey, pageKey));
      sel.value = pageKey;
      toast(pageKey + " created in " + bound.folder + " — the draft is a real file now");
    }
    // Higgsfield URLs are typically presigned and EXPIRE — persist the card's copy as a data: URL
    // (best-effort; CORS/size may say no) so a returning user's locked card still shows the mockup.
    let lockedImageUrl = opt.imageUrl || null;
    if (lockedImageUrl && !lockedImageUrl.startsWith("data:")) {
      d.status = "saving the mockup…"; renderSide();
      const inlined = await toDataUrl(lockedImageUrl).catch(() => null);
      if (inlined) lockedImageUrl = inlined;
    }
    c.locked = { kind: d.kind, label: opt.label, text: opt.text || "", svg: opt.svg || null, imageUrl: lockedImageUrl };
    c.decision = null;
    flashId = c.id; // scroll the landed change into view + flash it green on the re-render
    saveReview(); renderFrame(); renderSide();
    toast("Done ✓ written to " + pageKey + " — reopen the card to make more changes");
  } catch (e) { if (c.decision) c.decision.lockError = msg(e); toast("Couldn't lock — " + msg(e), true); }
  finally { busy.delete(c.id); if (c.decision) { c.decision.loading = false; c.decision.writing = false; } renderSide(); }
}

// Apply a find/replace, tolerating the model collapsing/altering whitespace in `find` (a common cause
// of "the file changed" when the file actually hasn't). Exact match first — but ONLY when it appears
// exactly once (a non-unique find must never silently edit the first/wrong occurrence of a repeated
// snippet); then a whitespace-flexible regex, same single-match rule.
function applyEdit(html, find, replace) {
  if (typeof find !== "string" || !find) return { ok: false };
  const first = html.indexOf(find);
  if (first !== -1 && html.indexOf(find, first + find.length) === -1) {
    return { ok: true, next: html.slice(0, first) + replace + html.slice(first + find.length) };
  }
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

// Best-effort: pull a (presigned, soon-to-expire) image URL down into a durable data: URL for the
// review record. Fails quietly on CORS/timeout/size — callers keep the hotlink then.
async function toDataUrl(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > 1_500_000) return null;
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(blob);
    });
  } finally { clearTimeout(t); }
}

// An <img> whose source may be an expired presigned URL: when it breaks, swap in a house-styled
// "regenerate" affordance instead of a broken-image glyph (reopens a locked card first).
function imgWithFallback(url, alt, cls, c) {
  const img = el("img", cls || null);
  img.src = url; if (alt) img.alt = alt;
  img.onerror = () => {
    const b = el("button", "img-expired", "mockup expired — regenerate");
    b.onclick = (e) => {
      e.stopPropagation();
      if (c.locked) { c.locked = null; saveReview(); }
      respond(c, "the previous image mockup expired — regenerate it");
    };
    try { img.replaceWith(b); } catch { /* card re-rendered */ }
  };
  return img;
}

// ---------- the sidebar (the wrapp) ----------
function renderSide() {
  cutLayout(); // decision state is already current at entry — chips follow the lifecycle colors
  const body = $("side-body"); body.textContent = "";
  const live = decisions.filter(Boolean);
  const open = live.filter((c) => !c.locked).length, done = live.length - open;
  $("dec-count").textContent = live.length ? `${open} open${done ? ` · ${done} done` : ""}` : "";
  updateSendAll();
  if (publishUI) body.append(publishCard());
  if (auditing) {
    const r = el("div", "researching");
    r.append(el("div", "scan"), el("span", null, "auditing the whole page — pinning suggestions…"));
    body.append(r);
  }
  if (!live.length) {
    if (!auditing) {
      const e = el("div", "empty");
      e.innerHTML = lastAuditAt
        ? 'Audit ran clean — nothing left to pin.<br /><b>✦ Audit</b> runs another pass, or turn on <b>comment mode</b> and click anything on the page.'
        : 'No comments yet.<br /><b>✦ Audit</b> runs one pass over the whole page and pins suggestions with fixes ready to lock — or turn on <b>comment mode</b> and click anything yourself.';
      body.append(e);
    }
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
  main.append(el("div", "dec-target", `${c.tag}${c.snippet ? " · " + c.snippet.slice(0, 60) : ""}${cutPosBadge(c)}`));
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
    if (o.imageUrl) card.append(imgWithFallback(o.imageUrl, o.label, "o-img", c));
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
  main.append(el("div", "dec-target", `${c.tag}${c.snippet ? " · " + c.snippet.slice(0, 60) : ""}${cutPosBadge(c)}`));
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
  if (c.locked.imageUrl) lm.append(imgWithFallback(c.locked.imageUrl, "", null, c));
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
// instead of an infinite "reading the page…" spinner. On timeout the iterator is RELEASED
// (it.return() → the SDK's finally detaches the delta listener) so the abandoned stream doesn't keep
// feeding a dead UI. onProgress gets {text} and {tool} as they arrive.
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
