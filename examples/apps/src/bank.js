// Bank — the context bank. One place that KNOWS things: every context you own (brands, your
// personal card, data sources) on one shelf, plus an Obsidian-inspired notes brain — plain .md
// records with [[links]], backlinks, and - [ ] tasks aggregated across notes — living in a folder
// YOU own. Bind it to a real directory (an existing Obsidian vault works: its .md files appear
// here, and notes banked here open in Obsidian). Ask-the-brain runs on your Claude with your notes
// inlined — the operator stores nothing and knows nothing.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const KINDS = ["brand", "personal", "persona", "project", "csv", "gsheet", "note"];
const DEFAULT_FOLDER = "~/SwitchboardBrain";

let relay = null;
let notInstalled = false;
let notes = [];      // [{key, title, body, links[], tasks[{line, done, text}], backlinks[]}]
let contexts = [];   // library metas
let identityName = ""; // paired user's display name (starter-note seeds)
let filterLink = null; // active [[link]] filter, or null
let asking = false;
let askSeq = 0;
let syncing = false;
let syncSeq = 0;
let showDone = false;        // board: reveal completed tasks
let selectedList = "Inbox";  // board quick-add target
let sampleActive = false;    // pre-connect sample brain is on screen (never mixed with real calls)
const expandedNotes = new Set(); // note keys currently expanded to full view
let editingKey = null;           // note key currently in edit mode
const TASKS_KEY = "tasks.md"; // the board's own file — SHARED with the Bank connector (packages/bank-mcp)
const BRIEF_KEY = "brief.json";     // {date, brief[], recommended} — today's auto-brief, cached
const ASK_LAST_KEY = "ask-last.json"; // {q, text, at} — last answer, restored on return
const SYNC_STAMP_KEY = "sync-stamp";  // yyyy-mm-dd of the last consent-free daily project pull
const today = () => new Date().toISOString().slice(0, 10);

// ---------- sync across channels ----------
// One managed note gathers OPEN to-dos pulled from the user's own channels — gmail/whatsapp/granola
// connectors on their Claude, plus the project contexts brandbrain published to their library. Same
// discover→consent→pull shape as adpulse's live pull: the model NAMES the connector (no grant needed
// to read the tool list), we re-connect for exactly those tools as read-only wildcards, then an
// agentic turn extracts action items and returns them as JSON. Results land as - [ ] lines in a
// plain .md note, so they flow into the tasks section (and Obsidian) like any other task, and the
// checkbox rewrites the source line. Completed items are never re-added; open ones are merged, deduped.
// The projects-only half needs NO new grant, so it also auto-runs once a day after boot.
const SYNC_KEY = "n-synced-todos.md";
const SYNC_TITLE = "Synced to-dos";
const PREFIX_CACHE = "bank:channel-prefixes";
const CHANNELS = [
  { key: "gmail", label: "Gmail", tools: "search_threads, get_thread, list_labels", what: "unresolved threads that need a reply or an action FROM you — skip newsletters, receipts, notifications" },
  { key: "whatsapp", label: "WhatsApp", tools: "chat / message reading tools", what: "messages where someone is asking you to do something or owes you a follow-up" },
  { key: "granola", label: "Granola", tools: "query_granola_meetings, list_meetings, get_meeting_transcript", what: "action items assigned to you in recent meeting notes" },
];

// ---------- sample brain (pre-connect only — in-memory, never persisted, always labeled) ----------
const SAMPLE_NOTES = [
  { key: "n-launch-plan.md", body: "# Diwali launch plan\n\nGifting bundles for [[Haazma]] — 3 SKUs, kraft boxes.\n\n- [ ] finalize bundle pricing with [[Piqual]] learnings\n- [ ] brief [[Studio]] shots for the gift box\n- [x] lock the festive palette" },
  { key: "n-vendor-notes.md", body: "# Vendor notes\n\nCuticle oil vendor quotes 18% lower at 5k MOQ. Relevant to [[Haazma]] restock.\n\n- [ ] counter at 4k MOQ" },
  { key: "n-positioning-idea.md", body: "# Positioning idea\n\n\"Premium without the city tax\" also works for tier-2 men's skincare — see [[Sela]]." },
];

// A real project card — Switchboard, extracted into itself by the Bank connector (bank_extract_project).
// Pre-connect this shows what "every project in one place" looks like; connected, your own repos land here.
const SAMPLE_PROJECTS = [
  { key: "project-switchboard.md", body: "# Switchboard\n\n> BYO-Claude broker — MetaMask, but for AI. A local sidekick brokers your model + MCP tools to any website through window.claude, under per-origin, out-of-band consent.\n\n- **status:** MIT\n- **stack:** TypeScript, esbuild, MCP\n- **repo:** https://github.com/sameeeeeeep/switchboard\n\n## Roadmap\n- Daemon (packages/sidekick): gated agentic loop via the Agent SDK\n- MCP + connectors: auto-imports the user's existing ~/.claude.json servers\n- Extension (MV3): injects window.claude into every page\n- claude.context primitive: the shared, cross-app CONTEXT layer\n- Projects (scoping unit) + consumer side panel\n\n## Docs\n- Vision Spec — docs/VISION.md\n- Building a Wrapp — docs/BUILDING-A-WRAPP.md\n- Context Kinds — docs/CONTEXT-KINDS.md\n- Security & Bindings — docs/SECURITY-AND-BINDINGS.md\n\n## Packages\n- protocol\n- sdk\n- sidekick\n- extension\n- bank-mcp\n- menubar\n\n## Wrapps\n- brandbrain\n- bank\n- imagegen\n- persona\n- adforge\n- adpulse\n- studio\n- aplus\n" },
];

// A real brand card — nailinit, read off its live storefront by the Bank connector
// (bank_extract_brand). Every hex below is the value its theme actually serves, annotated with the CSS
// variable it came from, and the products are its real catalogue. That provenance IS the feature: the
// old way asked a model what the brand "looked like" and got invented colours and no products.
const SAMPLE_BRANDS = [
  { key: "brand-nailinit.md", body: "# nailinit\n\n> india's #1 press-ons, stick-ons, and express nail care brand — salon-quality nails in minutes.\n\n- **site:** https://nailin.it\n- **catalogue:** 32 products · INR 59–INR 999\n- **category:** Press-On Nails\n- **platform:** shopify\n- **instagram:** https://instagram.com/nailinittt\n\n## Palette\n- `#c4301c` — --color-primary _(css-var)_\n- `#072835` — --color-button _(css-var)_\n- `#fc3f75` — --color-primary _(css-var)_\n- `#e7e1f5` — --color-secondary-button _(css-var)_\n- `#ffe093` — --color-button _(css-var)_\n\n## Products\n- Berry Bomb — INR 449\n- Moonchild Stick On Nails — INR 449\n- Gold Drip — INR 599\n- Cosmic Crush — INR 449\n- Watermelon Sugar — INR 449\n- Clean Girl — INR 449\n" },
];

// ---------- md parsing ----------
function parseNote(key, body) {
  const lines = String(body || "").split("\n");
  const h = lines.find((l) => l.startsWith("# "));
  const title = (h ? h.slice(2) : (lines.find((l) => l.trim()) || key)).trim().slice(0, 120);
  const links = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))];
  const tasks = [];
  let section = ""; // last "## " subheading — lets synced tasks carry their channel/project label
  lines.forEach((l, i) => {
    const hs = /^##\s+(.+)$/.exec(l);
    if (hs) { section = hs[1].trim(); return; }
    const m = /^\s*- \[( |x|X)\] (.+)$/.exec(l);
    if (m) tasks.push({ line: i, done: m[1] !== " ", text: m[2].trim(), section });
  });
  return { key, body, title, links, tasks, backlinks: [] };
}
function wireBacklinks(list) {
  for (const n of list) n.backlinks = [];
  for (const n of list) for (const l of n.links) {
    const target = list.find((t) => t.title.toLowerCase() === l.toLowerCase());
    if (target && target !== n) target.backlinks.push(n.title);
  }
}
const slug = (t) => (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note");

// ---------- the standard chip ----------
mountConnect($("chip-dock"), {
  scope: { reason: "Bank — your context bank: notes, tasks and your library in one place", models: ["sonnet"], contextKinds: KINDS },
  context: "none", // the Bank shows the WHOLE library — pinning one "working on" here is the category error
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; enterVault(); },
  onDisconnect: () => {
    relay = null;
    recommendedText = "";
    $("brief-sec").hidden = true;
    reflect();
    renderAll(); // re-render so task checkboxes / forget / publish go inert, not dead
  },
});

// The moment a grant exists (fresh chip click OR load-with-grant): wipe the sample so it can never
// leak into a real model call, paint an opening state, then read the vault — which chains straight
// into the auto-brief + the daily project pull. Idempotent: both connect paths may land here.
let entered = false;
function enterVault() {
  if (!entered) {
    entered = true;
    sampleActive = false;
    notes = []; contexts = [];
    for (const id of ["board", "notes"]) { const b = $(id); b.textContent = ""; b.append(chipEl("opening your vault…", "shelf-empty")); }
    $("projects").textContent = ""; $("shelf").textContent = "";
    $("tasks-count").textContent = "opening…"; $("brain-note").textContent = "opening…"; $("projects-note").textContent = "";
  }
  void boot();
}

// ---------- self-updating: re-read whenever reality may have moved ----------
// Two signals cover the daily cases without a daemon file-watcher:
//   1. tab becomes visible again — you edited notes in Obsidian (same files!) or banked from
//      another window; a throttled re-read on focus picks it up.
//   2. the daemon broadcasts permissionsChanged (context published/edited, folder re-bound) —
//      brandbrain publishing a brand or the panel saving your personal card refreshes the shelf.
// External edits made WHILE the tab stays focused still need a manual reload — a real
// storage-changed push from the daemon (fs.watch on bound folders) is the future upgrade.
let lastBoot = 0;
async function bootThrottled() {
  if (!relay || Date.now() - lastBoot < 2500) return;
  await boot();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void bootThrottled(); });

let subscribed = false;
function subscribeLive() {
  if (subscribed || !relay) return; subscribed = true;
  try { relay.on("permissionsChanged", () => void bootThrottled()); } catch { /* older provider */ }
}

// Reentrancy guard: the chip's onConnect and the load-with-grant probe both boot on a warm load —
// share one in-flight read instead of racing two full vault reads + renders.
let bootP = null;
function boot() {
  if (bootP) return bootP;
  bootP = doBoot().finally(() => { bootP = null; });
  return bootP;
}
async function doBoot() {
  lastBoot = Date.now();
  subscribeLive();
  if (!relay) return;
  try {
    const [metas, keys, info, who] = await Promise.all([
      relay.context.list().catch(() => []),
      relay.storage.list(), // the core read — if THIS fails it must surface as the error+retry state, not an "empty vault"
      relay.storage.info().catch(() => null),
      relay.identity().catch(() => null),
    ]);
    contexts = metas || [];
    identityName = who?.name || identityName;
    const mdKeys = (keys || []).filter((k) => k.endsWith(".md"));
    const bodies = await Promise.all(mdKeys.map((k) => relay.storage.get(k).catch(() => null)));
    sampleActive = false;
    notes = mdKeys.map((k, i) => parseNote(k, bodies[i] ?? "")).filter((n) => n.body.trim());
    wireBacklinks(notes);
    renderVault(info);
    renderAll();
    // proactive from here — none of these need another click:
    void maybeBrief();      // today's brief + the ★ recommended task
    void maybeAutoSync();   // consent-free daily pull from project contexts
    restoreAsk();           // last answer back on screen for a returning user
  } catch (e) {
    renderBootError(String(e?.message || e).slice(0, 120));
  }
  reflect();
}

// A failed vault read gets an explicit error state with a retry — never stale/sample content.
function renderBootError(msg) {
  sysline("couldn't open the bank — " + msg);
  const box = $("notes");
  box.textContent = "";
  const err = chipEl(`couldn't open your vault — ${msg} `, "shelf-empty");
  const retry = document.createElement("button");
  retry.className = "linklike"; retry.type = "button"; retry.textContent = "retry";
  retry.onclick = () => { sysline(""); void boot(); };
  err.append(retry);
  box.append(err);
  $("brain-note").textContent = "";
}

function reflect() {
  const on = !!relay;
  $("bank-it").disabled = !on;
  $("ask-go").disabled = !on || asking;
  $("ask-in").disabled = !on;
  const br = $("brief-regen"); if (br) br.disabled = !on || briefBusy;
  const sg = $("sync-go");
  if (sg) { sg.disabled = !on || syncing; sg.textContent = syncing ? "pulling…" : "⟲ pull from channels"; }
  const ta = $("task-add"); if (ta) ta.disabled = !on;
  const ti = $("task-in"); if (ti) ti.disabled = !on;
  const tl = $("task-list"); if (tl) tl.disabled = !on;
  $("capture-hint").textContent = on ? ""
    : sampleActive ? (notInstalled ? "sample brain below — install Switchboard to start your own" : "sample brain below — connect (top right) to start your own")
    : "disconnected — reconnect (top right) to keep banking";
}
function sysline(t) { const e = $("sysline"); e.hidden = !t; e.textContent = t || ""; }

// ---------- vault bar (where the brain LIVES — user-owned) ----------
function renderVault(info) {
  const bar = $("vault");
  bar.hidden = false;
  $("vault-path").textContent = info?.folder || "private sandbox";
  $("vault-state").textContent = info?.autoAssigned ? "sandbox — bind a real folder and it becomes a portable vault" : "bound — this folder IS your vault (Obsidian opens it as-is)";
  $("vault-bind").hidden = !info?.autoAssigned;
}
// Inline bind row (design-system, not a prompt()): reveal → prefilled path → bind / escape.
$("vault-bind").addEventListener("click", () => {
  if (!relay) return;
  const row = $("vault-bindrow");
  row.hidden = false;
  const inp = $("vault-bind-path");
  if (!inp.value.trim()) inp.value = DEFAULT_FOLDER;
  inp.focus(); inp.select();
});
$("vault-bind-cancel").addEventListener("click", () => { $("vault-bindrow").hidden = true; });
$("vault-bind-path").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); void doBind(); }
  else if (e.key === "Escape") $("vault-bindrow").hidden = true;
});
$("vault-bind-go").addEventListener("click", () => void doBind());
async function doBind() {
  if (!relay) return;
  const path = $("vault-bind-path").value.trim();
  if (!path) return;
  const go = $("vault-bind-go");
  go.disabled = true; go.textContent = "binding…";
  try {
    const info = await relay.storage.bind(path).catch(() => null);
    if (info) { sysline(""); $("vault-bindrow").hidden = true; await boot(); }
    else sysline("bind declined or failed — the sandbox keeps working meanwhile.");
  } finally { go.disabled = false; go.textContent = "bind"; }
}

// ---------- capture: ONE input, banked on enter ----------
const CAPTURE_CHIPS = [
  ["note", "# Idea\n\n"],
  ["task", "# Today\n\n- [ ] "],
  ["linked note", "# \n\nRe [[]]: "],
];
const chipBox = $("capture-chips");
for (const [label, tpl] of CAPTURE_CHIPS) {
  const b = document.createElement("button");
  b.className = "chip"; b.type = "button"; b.textContent = label;
  b.onclick = () => { const c = $("capture"); c.value = tpl; c.focus(); c.selectionStart = c.selectionEnd = tpl.indexOf("\n") === 1 ? 2 : tpl.length; };
  chipBox.append(b);
}
$("bank-it").addEventListener("click", bankIt);
$("capture").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") bankIt(); });
async function bankIt() {
  const body = $("capture").value.trim();
  if (!body || !relay) return;
  const n = parseNote("", body);
  let key = `n-${slug(n.title)}.md`;
  if (notes.some((x) => x.key === key)) key = `n-${slug(n.title)}-${Date.now().toString(36)}.md`;
  $("bank-it").disabled = true;
  try {
    await relay.storage.set(key, body);
    $("capture").value = "";
    await boot();
  } catch (e) {
    sysline("couldn't bank that — " + String(e?.message || e).slice(0, 120));
  } finally { $("bank-it").disabled = !relay; }
}

// ---------- render ----------
function renderSample() {
  sampleActive = true;
  notes = [...SAMPLE_NOTES, ...SAMPLE_PROJECTS, ...SAMPLE_BRANDS].map((s) => parseNote(s.key, s.body));
  wireBacklinks(notes);
  contexts = [];
  renderAll();
}

function renderAll() {
  renderShelf();
  renderProjects();
  renderBrands();
  renderBoard();
  renderNotes();
}

// ---------- today's brief: the proactive half ----------
// From the moment a grant exists, the brief auto-streams off the notes+open-tasks corpus: 3-5
// concrete bullets + the ONE open task to do first (★ on the board). Cached per-day in storage so a
// returning user sees it instantly; a stale one paints first while a fresh one streams behind it.
let briefBusy = false;
let briefSeq = 0;
let briefAttemptedFor = ""; // auto-attempt once per day per session; retry/regenerate stay manual
let recommendedText = "";   // normText of the ★ task, matched in taskRow

function buildCorpus(cap = 24000) {
  let corpus = "";
  for (const n of notes) {
    if (corpus.length > cap) { corpus += "\n[...more notes truncated]"; break; }
    corpus += `\n--- ${n.title} (${n.key}) ---\n${n.body}\n`;
  }
  return corpus;
}
const openTaskLines = () => {
  const out = [];
  for (const n of notes) for (const t of n.tasks) if (!t.done) out.push(`- ${t.text} (${t.section || n.title})`);
  return out;
};

async function maybeBrief() {
  if (!relay || sampleActive) return;
  if (!notes.length) { renderStarter(); return; }
  $("brief-sec").hidden = false;
  $("starter").hidden = true;
  $("brief-regen").hidden = false;
  let cached = null;
  try { cached = JSON.parse((await relay.storage.get(BRIEF_KEY).catch(() => null)) || "null"); } catch { /* regenerate */ }
  if (cached && Array.isArray(cached.brief)) {
    renderBrief(cached);
    $("brief-note").textContent = cached.date === today() ? "today — from your notes + open tasks" : "yesterday's — refreshing…";
    if (cached.date === today()) return;
  }
  if (briefAttemptedFor === today()) return;
  briefAttemptedFor = today();
  void generateBrief();
}

function renderBrief(v) {
  const out = $("brief-out");
  out.hidden = false; out.textContent = "";
  for (const b of (v.brief || []).slice(0, 5)) {
    out.append(Object.assign(document.createElement("div"), { className: "briefline", textContent: String(b) }));
  }
  if (v.recommended) {
    const r = document.createElement("div"); r.className = "briefrec";
    r.append(Object.assign(document.createElement("span"), { className: "recbadge", textContent: "★ do this first" }));
    r.append(Object.assign(document.createElement("span"), { textContent: String(v.recommended) }));
    out.append(r);
  }
  recommendedText = normText(v.recommended || "");
  renderBoard(); // restamp the ★ on the matching board row
}

async function generateBrief() {
  if (!relay || briefBusy || sampleActive || !notes.length) return;
  const my = ++briefSeq;
  briefBusy = true; reflect();
  const note = $("brief-note");
  note.textContent = "your Claude is reading the vault…";
  try {
    const open = openTaskLines();
    const prompt = [
      "You are the user's chief of staff. Below are their own notes and open tasks. Write today's brief: 3-5 short, concrete bullets — what matters right now and why, drawn ONLY from this material. Then pick the ONE open task they should do first.",
      'Reply with ONLY a JSON object — no prose, no fences: {"brief": ["bullet", ...], "recommended": "<the EXACT text of one open task from the list, or empty string if there are none>"}',
      open.length ? "OPEN TASKS:\n" + open.join("\n") : "OPEN TASKS: (none)",
      `NOTES:${buildCorpus(16000) || "\n(none yet)"}`,
    ].join("\n\n");
    let text = "";
    for await (const d of relay.stream({ prompt })) {
      if (my !== briefSeq) return;
      if (d.type === "text") text += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (my !== briefSeq) return;
    const m = text.replace(/```[a-z]*\n?/gi, "").match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : null;
    if (!v || !Array.isArray(v.brief) || !v.brief.length) throw new Error("your Claude answered but not with a brief");
    const rec = { date: today(), brief: v.brief.map(String).slice(0, 5), recommended: String(v.recommended || "") };
    renderBrief(rec);
    note.textContent = "today — from your notes + open tasks";
    void relay.storage.set(BRIEF_KEY, JSON.stringify(rec)).catch(() => { /* re-streams next visit */ });
  } catch (e) {
    if (my !== briefSeq) return;
    note.textContent = "";
    const out = $("brief-out");
    out.hidden = false; out.textContent = "";
    out.append(chipEl(`the brief didn't land — ${String(e?.message || e).slice(0, 90)} `, "shelf-empty"));
    const retry = document.createElement("button");
    retry.className = "linklike"; retry.type = "button"; retry.textContent = "retry";
    retry.onclick = () => void generateBrief();
    out.lastChild.append(retry);
  } finally {
    if (my === briefSeq) { briefBusy = false; reflect(); }
  }
}
$("brief-regen").addEventListener("click", () => void generateBrief());

// Empty vault ≠ blank form: offer three concrete starter notes seeded from what the user already
// owns (their brands / projects / name), one ★ recommended — a click prefills the capture box.
function renderStarter() {
  $("brief-sec").hidden = false;
  $("brief-out").hidden = true;
  $("brief-regen").hidden = true;
  const box = $("starter");
  box.hidden = false; box.textContent = "";
  $("brief-note").textContent = "empty vault — three ways to start, seeded from what you own";
  const brand = contexts.find((c) => (c.kind || "").toLowerCase() === "brand")?.name;
  const proj = contexts.find((c) => (c.kind || "").toLowerCase() === "project")?.name;
  const first = (identityName || "").split(/\s+/)[0];
  const opts = [
    { label: `${brand || "launch"} plan`, tpl: `# ${brand ? `${brand} launch plan` : "Launch plan"}\n\n- [ ] `, rec: true },
    { label: "this week", tpl: "# This week\n\n- [ ] " },
    proj
      ? { label: `${proj} next steps`, tpl: `# ${proj} — next steps\n\n- [ ] ` }
      : { label: first ? `${first}'s inbox` : "inbox", tpl: "# Inbox\n\n- [ ] " },
  ];
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip" + (o.rec ? " chip-rec" : "");
    b.textContent = (o.rec ? "★ " : "") + o.label;
    b.onclick = () => { const c = $("capture"); c.value = o.tpl; c.focus(); c.selectionStart = c.selectionEnd = c.value.length; };
    box.append(b);
  }
}

// ---------- projects: the cross-project viewer ----------
// A project is a `project-<slug>.md` in the vault (written by the Bank connector's extractor) OR a
// `kind:"project"` context in the library. Either way it renders as one card here — Bank is the one
// place every project's context lands, viewable side by side. Its `- [ ]` tasks flow to the board.
const isProjectKey = (k) => /(^|\/)project-[^/]+\.md$/i.test(k || "");
function parseProjectCard(note) {
  const meta = {}; const sections = {}; let summary = ""; let cur = null;
  for (const l of note.body.split("\n")) {
    const h2 = /^##\s+(.+)$/.exec(l);
    if (h2) { cur = h2[1].trim(); sections[cur] = []; continue; }
    if (!cur) {
      if (!summary && l.trim().startsWith("> ")) summary = l.replace(/^\s*>\s?/, "").trim();
      const mm = /^-\s+\*\*([^:]+):\*\*\s*(.+)$/.exec(l);
      if (mm) (meta[mm[1].trim().toLowerCase()] ||= []).push(mm[2].trim());
    } else {
      const b = /^\s*[-*]\s+(.+)$/.exec(l);
      if (b) sections[cur].push(b[1].trim());
    }
  }
  return { key: note.key, title: note.title, summary, meta, sections };
}

function renderProjects() {
  const box = $("projects");
  const note = $("projects-note");
  box.textContent = "";
  const projNotes = notes.filter((n) => isProjectKey(n.key));
  // Count each project's open tasks on the board (its tasks live under a list named after it).
  const openBy = new Map();
  for (const n of notes) for (const t of n.tasks) if (!t.done) { const k = (t.section || n.title).toLowerCase(); openBy.set(k, (openBy.get(k) || 0) + 1); }
  note.textContent = sampleActive ? "sample — this is Switchboard, extracted into itself" : projNotes.length ? `${projNotes.length} project${projNotes.length === 1 ? "" : "s"} — extracted into your Bank` : "";
  if (!projNotes.length) {
    if (!sampleActive) box.append(chipEl("no projects yet — run the Bank connector’s extract-project on any repo, or publish one from a wrapp", "shelf-empty"));
    return;
  }
  const URL_RE = /^https?:\/\//i;
  for (const n of projNotes) {
    const p = parseProjectCard(n);
    const card = document.createElement("div");
    card.className = "projcard";
    const head = document.createElement("div"); head.className = "projhead";
    head.append(Object.assign(document.createElement("b"), { textContent: p.title }));
    const status = (p.meta.status || [])[0];
    if (status) head.append(Object.assign(document.createElement("i"), { className: "pstatus", textContent: status }));
    card.append(head);
    if (p.summary) card.append(Object.assign(document.createElement("div"), { className: "psum", textContent: p.summary }));

    // meta row: stack + links + task count
    const metaRow = document.createElement("div"); metaRow.className = "pmeta";
    for (const s of (p.meta.stack || []).join(", ").split(", ").filter(Boolean)) metaRow.append(tag(s));
    for (const [k, vals] of Object.entries(p.meta)) {
      if (k === "status" || k === "stack") continue;
      for (const v of vals) if (URL_RE.test(v)) { const a = document.createElement("a"); a.className = "plink"; a.href = v; a.target = "_blank"; a.rel = "noopener"; a.textContent = k; metaRow.append(a); }
    }
    const openN = openBy.get(p.title.toLowerCase()) || 0;
    if (openN) metaRow.append(Object.assign(document.createElement("span"), { className: "ptasks", textContent: `${openN} open task${openN === 1 ? "" : "s"}` }));
    if (metaRow.children.length) card.append(metaRow);

    // stat line for the big enumerable sections
    const stats = ["Packages", "Wrapps", "Docs"].map((s) => (p.sections[s]?.length ? `${p.sections[s].length} ${s.toLowerCase()}` : null)).filter(Boolean);
    if (stats.length) card.append(Object.assign(document.createElement("div"), { className: "pstats", textContent: stats.join(" · ") }));

    // roadmap peek
    const road = p.sections.Roadmap || [];
    if (road.length) {
      const rl = document.createElement("div"); rl.className = "proad";
      rl.append(Object.assign(document.createElement("span"), { className: "proadk", textContent: "roadmap" }));
      for (const item of road.slice(0, 4)) rl.append(Object.assign(document.createElement("div"), { className: "proaditem", textContent: item }));
      if (road.length > 4) rl.append(Object.assign(document.createElement("div"), { className: "proadmore", textContent: `+${road.length - 4} more` }));
      card.append(rl);
    }

    if (!sampleActive && relay) {
      const foot = document.createElement("div"); foot.className = "pfoot";
      const pub = document.createElement("button"); pub.className = "linklike"; pub.type = "button";
      const already = contexts.some((c) => (c.kind || "").toLowerCase() === "project" && (c.name || "").toLowerCase() === p.title.toLowerCase());
      if (already) { pub.textContent = "in your library ✓"; pub.disabled = true; }
      else {
        pub.textContent = "publish to library →";
        pub.title = "share this project as a context every wrapp can borrow";
        pub.onclick = () => void publishProject(p, pub);
      }
      foot.append(pub);
      card.append(foot);
    }
    box.append(card);
  }
}
function tag(text) { const s = document.createElement("span"); s.className = "ptag"; s.textContent = text; return s; }

// Promote a vault project file into the shared library as a kind:"project" context — the bridge from
// Bank-private files to context EVERY wrapp can consume (bounded by the user's consent, as always).
async function publishProject(p, btn) {
  if (!relay) return sysline("connect (top right) to publish projects");
  const data = {
    summary: p.summary,
    status: (p.meta.status || [])[0] || "",
    stack: (p.meta.stack || []).join(", ").split(", ").filter(Boolean),
    links: Object.entries(p.meta).flatMap(([k, vals]) => vals.filter((v) => /^https?:\/\//i.test(v)).map((url) => ({ label: k, url }))),
    roadmap: p.sections.Roadmap || [],
    docs: p.sections.Docs || [],
    packages: p.sections.Packages || [],
    wrapps: p.sections.Wrapps || [],
  };
  const id = p.key.replace(/\.md$/, "").replace(/^.*project-/, "");
  btn.disabled = true; btn.textContent = "publishing…";
  try {
    await relay.context.publish({ id, name: p.title, kind: "project", data });
    btn.textContent = "in your library ✓";
    contexts.push({ id, name: p.title, kind: "project", updatedAt: Date.now() }); // survives re-renders until the next boot re-lists
    sysline("");
  } catch (e) {
    btn.disabled = false; btn.textContent = "publish to library →";
    sysline("couldn't publish — " + String(e?.message || e).slice(0, 120));
  }
}

// ---------- brands: the extraction brain's other output ----------
// A brand is a `brand-<slug>.md` in the vault, written by the Bank connector (bank_extract_brand).
// Its colours come from the CSS the site actually served and its products from the live catalogue —
// so every swatch here is an observed fact carrying the variable it was read from, not a model's
// recollection of what the brand "probably looks like". Same card dialect as projects; the payload is
// a palette and a catalogue instead of a roadmap.
const isBrandKey = (k) => /(^|\/)brand-[^/]+\.md$/i.test(k || "");
const HEX_RE = /`?(#[0-9a-fA-F]{6})`?/;
// "`#c4301c` — --color-primary _(css-var)_" → { hex, from }
function parseSwatch(line) {
  const hex = (HEX_RE.exec(line) || [])[1];
  if (!hex) return null;
  const from = line.replace(HEX_RE, "").replace(/^\s*—\s*/, "").replace(/_\(([^)]*)\)_/, "($1)").trim();
  return { hex: hex.toLowerCase(), from };
}

function renderBrands() {
  const box = $("brands");
  const note = $("brands-note");
  box.textContent = "";
  const brandNotes = notes.filter((n) => isBrandKey(n.key));
  note.textContent = sampleActive
    ? "sample — nailinit, read off its live storefront"
    : brandNotes.length ? `${brandNotes.length} brand${brandNotes.length === 1 ? "" : "s"} — read from the live site` : "";
  if (!brandNotes.length) {
    if (!sampleActive) box.append(chipEl("no brands yet — ask any Claude with the Bank connector to “add nailin.it to my bank”", "shelf-empty"));
    return;
  }
  const URL_RE = /^https?:\/\//i;
  for (const n of brandNotes) {
    const p = parseProjectCard(n); // the card dialect is shared: `> summary`, `- **k:** v`, `## Section`
    const card = document.createElement("div");
    card.className = "projcard";

    const head = document.createElement("div"); head.className = "projhead";
    head.append(Object.assign(document.createElement("b"), { textContent: p.title }));
    const category = (p.meta.category || [])[0];
    if (category) head.append(Object.assign(document.createElement("i"), { className: "pstatus", textContent: category }));
    card.append(head);
    if (p.summary) card.append(Object.assign(document.createElement("div"), { className: "psum", textContent: p.summary }));

    // the palette, as actual colour — the whole point of extracting it properly
    const swatches = (p.sections.Palette || []).map(parseSwatch).filter(Boolean);
    if (swatches.length) {
      const row = document.createElement("div"); row.className = "pswatches";
      for (const s of swatches) {
        const sw = document.createElement("span");
        sw.className = "pswatch"; sw.style.background = s.hex;
        sw.title = s.from ? `${s.hex} — from ${s.from}` : s.hex;
        row.append(sw);
      }
      row.append(Object.assign(document.createElement("i"), { className: "pswatchnote", textContent: swatches[0].from ? `read from ${swatches[0].from.replace(/\s*\(.*\)$/, "")}` : "" }));
      card.append(row);
    }

    // meta row: catalogue size + real outbound links
    const metaRow = document.createElement("div"); metaRow.className = "pmeta";
    const cat = (p.meta.catalogue || [])[0];
    if (cat) metaRow.append(tag(cat));
    for (const [k, vals] of Object.entries(p.meta)) {
      for (const v of vals) if (URL_RE.test(v)) { const a = document.createElement("a"); a.className = "plink"; a.href = v; a.target = "_blank"; a.rel = "noopener"; a.textContent = k; metaRow.append(a); }
    }
    if (metaRow.children.length) card.append(metaRow);

    // a peek at the real catalogue
    const prods = p.sections.Products || [];
    if (prods.length) {
      const rl = document.createElement("div"); rl.className = "proad";
      rl.append(Object.assign(document.createElement("span"), { className: "proadk", textContent: "products" }));
      for (const item of prods.slice(0, 4)) rl.append(Object.assign(document.createElement("div"), { className: "proaditem", textContent: item }));
      if (prods.length > 4) rl.append(Object.assign(document.createElement("div"), { className: "proadmore", textContent: `+${prods.length - 4} more` }));
      card.append(rl);
    }

    if (!sampleActive && relay) {
      const foot = document.createElement("div"); foot.className = "pfoot";
      const pub = document.createElement("button"); pub.className = "linklike"; pub.type = "button";
      const already = contexts.some((c) => (c.kind || "").toLowerCase() === "brand" && (c.name || "").toLowerCase() === p.title.toLowerCase());
      if (already) { pub.textContent = "in your library ✓"; pub.disabled = true; }
      else {
        pub.textContent = "publish to library →";
        pub.title = "share this brand as a context every wrapp can borrow";
        pub.onclick = () => void publishBrand(p, swatches, pub);
      }
      foot.append(pub);
      card.append(foot);
    }
    box.append(card);
  }
}

// Promote a vault brand file into the shared library as a kind:"brand" context. `palette` and
// `products` go out as FLAT strings — docs/CONTEXT-KINDS.md — because every consumer applies them
// directly (el.style.background = c, palette.join(", ")); swatch objects render "[object Object]".
async function publishBrand(p, swatches, btn) {
  if (!relay) return sysline("connect (top right) to publish brands");
  const site = Object.values(p.meta).flat().find((v) => /^https?:\/\//i.test(v)) || "";
  const data = {
    positioning: p.summary,
    palette: swatches.map((s) => s.hex),
    paletteRich: swatches.map((s) => ({ hex: s.hex, name: s.from })),
    products: (p.sections.Products || []).map((b) => b.split(/\s+—\s+/)[0].trim()).filter(Boolean),
    ...((p.meta.category || [])[0] ? { category: (p.meta.category || [])[0] } : {}),
    ...(site ? { domain: site.replace(/^https?:\/\//, "").replace(/\/$/, "") } : {}),
  };
  const id = p.key.replace(/\.md$/, "").replace(/^.*brand-/, "");
  btn.disabled = true; btn.textContent = "publishing…";
  try {
    await relay.context.publish({ id, name: p.title, kind: "brand", data });
    btn.textContent = "in your library ✓";
    contexts.push({ id, name: p.title, kind: "brand", updatedAt: Date.now() });
    sysline("");
  } catch (e) {
    btn.disabled = false; btn.textContent = "publish to library →";
    sysline("couldn't publish — " + String(e?.message || e).slice(0, 120));
  }
}

function renderShelf() {
  const box = $("shelf");
  box.textContent = "";
  if (sampleActive || !contexts.length) {
    box.append(chipEl(sampleActive ? "your brands + personal card appear here on connect" : "nothing in the library yet — build a brand in brandbrain, or add your details in the panel", "shelf-empty"));
    return;
  }
  const KIND_LABEL = { brand: "brand", personal: "you", csv: "live data", gsheet: "live data" };
  for (const c of contexts) {
    const chip = document.createElement("button");
    chip.className = "shelfchip" + (filterLink && c.name.toLowerCase() === filterLink.toLowerCase() ? " on" : "");
    const mk = document.createElement("b"); mk.textContent = c.name[0]?.toUpperCase() ?? "•";
    const nm = document.createElement("span"); nm.textContent = c.name;
    const kd = document.createElement("i"); kd.textContent = KIND_LABEL[(c.kind || "").toLowerCase()] || c.kind || "";
    chip.append(mk, nm, kd);
    chip.onclick = () => { filterLink = filterLink?.toLowerCase() === c.name.toLowerCase() ? null : c.name; renderAll(); };
    box.append(chip);
  }
}

function chipEl(text, cls) { const d = document.createElement("div"); d.className = cls || "chip"; d.textContent = text; return d; }

// ---------- the board: tasks grouped into lists (ClickUp-in-.md) ----------
// Every task's LIST is its `## ` section (or its note title) — so the connector's `## Relay`, a
// synced `## Gmail`, and a plain note all become columns here, from the same plain files.
const DUE_RE = /^(.*?)\s+—\s+by\s+(.+)$/; // split a "text — by Fri" line into text + due badge
function renderBoard() {
  const box = $("board");
  box.textContent = "";
  const groups = new Map(); // list -> { open:[{n,t}], done:[{n,t}] }
  for (const n of notes) for (const t of n.tasks) {
    const list = (t.section || n.title || "Inbox").trim() || "Inbox";
    if (!groups.has(list)) groups.set(list, { open: [], done: [] });
    groups.get(list)[t.done ? "done" : "open"].push({ n, t });
  }
  let totalOpen = 0, totalDone = 0;
  for (const g of groups.values()) { totalOpen += g.open.length; totalDone += g.done.length; }
  $("tasks-count").textContent = totalOpen || totalDone ? `${totalOpen} open${totalDone ? ` · ${totalDone} done` : ""}` : sampleActive ? "sample board" : "all clear";
  populateLists([...groups.keys()]);
  $("show-done").hidden = !totalDone;
  $("show-done").textContent = showDone ? "hide done" : `show done${totalDone ? ` (${totalDone})` : ""}`;

  if (!groups.size) {
    box.append(chipEl(sampleActive ? "your tasks land here as list cards — connect to start" : "no tasks yet — add one above, pull from your channels, or send them in from any Claude thread", "shelf-empty"));
    return;
  }
  const isRec = (t) => !t.done && recommendedText && normText(t.text) === recommendedText;
  // Lists with open work first (most open on top); fully-done lists only when “show done” is on.
  const order = [...groups.entries()].sort((a, b) => b[1].open.length - a[1].open.length);
  for (const [list, g] of order) {
    if (!g.open.length && !(showDone && g.done.length)) continue;
    const card = document.createElement("div");
    card.className = "listcard";
    const head = document.createElement("div"); head.className = "listhead";
    head.append(Object.assign(document.createElement("b"), { textContent: list }));
    head.append(Object.assign(document.createElement("i"), { textContent: g.open.length ? `${g.open.length} open` : "done" }));
    card.append(head);
    const open = g.open.slice().sort((a, b) => (isRec(b.t) ? 1 : 0) - (isRec(a.t) ? 1 : 0)); // ★ first
    const rows = open.concat(showDone ? g.done : []);
    for (const { n, t } of rows) card.append(taskRow(n, t, isRec(t)));
    box.append(card);
  }
}

function taskRow(n, t, rec) {
  const row = document.createElement("label");
  row.className = "trow" + (t.done ? " done" : "");
  const cb = document.createElement("input"); cb.type = "checkbox";
  cb.checked = t.done; cb.disabled = sampleActive || !relay;
  cb.onchange = () => void toggleTask(n, t, cb);
  const dm = DUE_RE.exec(t.text);
  const span = document.createElement("span"); span.textContent = dm ? dm[1] : t.text;
  row.append(cb, span);
  if (rec) row.append(Object.assign(document.createElement("span"), { className: "recbadge", textContent: "★ do this first" }));
  if (dm && !t.done) row.append(Object.assign(document.createElement("span"), { className: "due", textContent: dm[2] }));
  return row;
}

// Keep the quick-add list picker in sync with the lists that actually exist (+ a "new list" escape).
function populateLists(lists) {
  const sel = $("task-list");
  if (!sel) return;
  const opts = [...new Set(["Inbox", selectedList, ...lists])]; // keep the picked (maybe brand-new) list
  sel.textContent = "";
  for (const l of opts) sel.append(new Option(l, l, false, l === selectedList));
  sel.append(new Option("＋ new list…", "__new__"));
}
// ---------- board quick-add: append `- [ ] text` under `## <list>` in tasks.md ----------
// Deliberately the SAME file + dialect the Bank connector writes, so a task typed here and a task
// sent in from a Claude thread land in one place. Mirrors packages/bank-mcp/tasks.mjs::addTask.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normText = (s) => String(s || "").toLowerCase().replace(/\s+—\s+by\s+.*$/i, "").replace(/\s+/g, " ").trim();
function appendTask(existing, text, list) {
  const clean = text.trim();
  if (!clean) return null;
  // dedupe by base text across the file
  for (const l of String(existing || "").split("\n")) {
    const m = /^\s*- \[( |x|X)\] (.+)$/.exec(l);
    if (m && normText(m[2]) === normText(clean)) return null;
  }
  const line = `- [ ] ${clean}`;
  let doc = existing && existing.trim() ? existing.replace(/\n+$/, "\n") : "# Tasks\n";
  const lines = doc.split("\n");
  const hi = lines.findIndex((l) => new RegExp(`^##\\s+${escapeRe(list)}\\s*$`, "i").test(l));
  if (hi === -1) { if (!doc.endsWith("\n")) doc += "\n"; return `${doc}\n## ${list}\n${line}\n`; }
  let j = hi + 1; while (j < lines.length && !/^##\s+/.test(lines[j])) j++;
  let at = j; while (at - 1 > hi && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, line);
  return lines.join("\n");
}
async function addTask() {
  const input = $("task-in");
  const text = input.value.trim();
  if (!text || !relay) return;
  const list = (selectedList || "Inbox").trim() || "Inbox";
  $("task-add").disabled = true;
  try {
    const existing = await relay.storage.get(TASKS_KEY).catch(() => null);
    const next = appendTask(existing || "", text, list);
    if (next) { await relay.storage.set(TASKS_KEY, next); input.value = ""; await boot(); }
    else { sysline(`“${text.slice(0, 40)}” is already on the ${list} list.`); }
  } catch (e) {
    sysline("couldn't add that — " + String(e?.message || e).slice(0, 100));
  } finally { $("task-add").disabled = !relay; }
}

async function toggleTask(note, task, cb) {
  if (!relay) { cb.checked = task.done; return sysline("connect (top right) to update tasks"); }
  const lines = note.body.split("\n");
  lines[task.line] = task.done
    ? lines[task.line].replace(/- \[[xX]\]/, "- [ ]")
    : lines[task.line].replace("- [ ]", "- [x]");
  try { await relay.storage.set(note.key, lines.join("\n")); await boot(); }
  catch (e) {
    cb.checked = task.done; // revert the optimistic flip — the UI never diverges from disk
    sysline("couldn't update that — " + String(e?.message || e).slice(0, 100));
  }
}

function renderNotes() {
  const box = $("notes");
  box.textContent = "";
  $("brain-note").textContent = sampleActive ? "sample brain — connect to start yours" : filterLink ? `filtered by [[${filterLink}]] — click the chip again to clear` : `${notes.length} note${notes.length === 1 ? "" : "s"}, newest first`;
  const shown = notes
    .filter((n) => !isProjectKey(n.key) && !isBrandKey(n.key)) // projects/brands render as cards up in §03–04, not here in the brain
    .filter((n) => !filterLink || n.links.some((l) => l.toLowerCase() === filterLink.toLowerCase()) || n.title.toLowerCase() === filterLink.toLowerCase())
    .slice()
    .reverse();
  if (!shown.length) { box.append(chipEl(filterLink ? "nothing links here yet" : "empty brain — bank the first note above, or pick a starter at the top", "shelf-empty")); return; }
  for (const n of shown) {
    const card = document.createElement("div");
    card.className = "note";
    const h = document.createElement("button"); h.className = "nt"; h.type = "button"; h.textContent = n.title;
    const isOpen = expandedNotes.has(n.key);
    h.title = isOpen ? "collapse" : "read the whole note";
    h.onclick = () => {
      if (expandedNotes.has(n.key)) { expandedNotes.delete(n.key); if (editingKey === n.key) editingKey = null; }
      else expandedNotes.add(n.key);
      renderAll();
    };
    card.append(h);
    if (isOpen && editingKey === n.key) {
      const ta = document.createElement("textarea"); ta.className = "nedit"; ta.value = n.body; ta.spellcheck = false;
      const row = document.createElement("div"); row.className = "row";
      const save = document.createElement("button"); save.className = "btn btn-primary"; save.type = "button"; save.textContent = "Save";
      const cancel = document.createElement("button"); cancel.className = "btn"; cancel.type = "button"; cancel.textContent = "Cancel";
      save.onclick = async () => {
        if (!relay) return sysline("connect (top right) to edit notes");
        const v = ta.value.trim();
        if (!v) return;
        save.disabled = true;
        try { await relay.storage.set(n.key, v); editingKey = null; await boot(); }
        catch (e) { save.disabled = false; sysline("couldn't save — " + String(e?.message || e).slice(0, 100)); }
      };
      cancel.onclick = () => { editingKey = null; renderAll(); };
      row.append(save, cancel);
      card.append(ta, row);
    } else if (isOpen) {
      const pre = document.createElement("pre"); pre.className = "nfull"; pre.textContent = n.body;
      card.append(pre);
      if (!sampleActive && relay) {
        const er = document.createElement("div"); er.className = "row";
        const eb = document.createElement("button"); eb.className = "linklike"; eb.type = "button"; eb.textContent = "edit";
        eb.onclick = () => { editingKey = n.key; renderAll(); };
        er.append(eb);
        card.append(er);
      }
    } else {
      const snippet = n.body.split("\n").filter((l) => l.trim() && !l.startsWith("# ")).slice(0, 3).join(" · ").slice(0, 220);
      if (snippet) card.append(Object.assign(document.createElement("div"), { className: "nb", textContent: snippet }));
    }
    if (n.links.length || n.backlinks.length) {
      const lr = document.createElement("div"); lr.className = "nlinks";
      for (const l of n.links) {
        const b = document.createElement("button"); b.className = "wikilink"; b.textContent = `[[${l}]]`;
        b.onclick = () => { filterLink = filterLink?.toLowerCase() === l.toLowerCase() ? null : l; renderAll(); };
        lr.append(b);
      }
      if (n.backlinks.length) lr.append(Object.assign(document.createElement("span"), { className: "backl", textContent: `← ${n.backlinks.join(", ")}` }));
      card.append(lr);
    }
    if (!sampleActive && relay) {
      // Two-click inline confirm (no confirm() dialog): arm → "really forget?" → 3s revert.
      const del = document.createElement("button"); del.className = "ndel"; del.type = "button"; del.textContent = "forget";
      del.onclick = async () => {
        if (!relay) return sysline("connect (top right) to manage notes");
        if (!del.dataset.armed) {
          del.dataset.armed = "1"; del.classList.add("armed"); del.textContent = "really forget?";
          setTimeout(() => { if (del.isConnected && del.dataset.armed) { delete del.dataset.armed; del.classList.remove("armed"); del.textContent = "forget"; } }, 3000);
          return;
        }
        del.disabled = true;
        try { await relay.storage.delete(n.key); expandedNotes.delete(n.key); await boot(); }
        catch (e) { del.disabled = false; sysline("couldn't forget that — " + String(e?.message || e).slice(0, 100)); }
      };
      card.append(del);
    }
    box.append(card);
  }
}

// ---------- ask the brain ----------
const ASK_CHIPS = ["what's on my plate this week?", "summarize everything about the launch", "which brand do my notes mention most?"];
const askChipBox = $("ask-chips");
for (const q of ASK_CHIPS) {
  const b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = q;
  b.onclick = () => { $("ask-in").value = q; };
  askChipBox.append(b);
}
$("ask-go").addEventListener("click", ask);
$("ask-in").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
async function ask() {
  const q = $("ask-in").value.trim();
  if (!q || !relay || asking || sampleActive) return;
  const my = ++askSeq;
  asking = true; reflect();
  const out = $("ask-out");
  out.hidden = false; out.textContent = "";
  const shelfNames = contexts.map((c) => `${c.name} (${c.kind || "context"})`).join(", ");
  const prompt = [
    "You are the user's context bank — answer from THEIR notes below, plus the names of what's in their library. Cite note titles when you draw on them. If the notes don't cover it, say so plainly. Be concise and direct; second person.",
    shelfNames ? `LIBRARY (names only): ${shelfNames}` : "",
    `NOTES:${buildCorpus() || "\n(none yet)"}`,
    `QUESTION: ${q}`,
  ].filter(Boolean).join("\n\n");
  try {
    for await (const d of relay.stream({ prompt })) {
      if (my !== askSeq) return;
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (my === askSeq) void relay.storage.set(ASK_LAST_KEY, JSON.stringify({ q, text: out.textContent, at: Date.now() })).catch(() => { /* non-fatal */ });
  } catch (e) {
    out.textContent += `\n[the brain went quiet — ${String(e?.message || e).slice(0, 100)}]`;
  } finally {
    if (my === askSeq) { asking = false; reflect(); }
  }
}
// A returning user gets their last answer back instantly (once per load, never over a live ask).
let askRestored = false;
function restoreAsk() {
  if (askRestored || !relay) return;
  askRestored = true;
  relay.storage.get(ASK_LAST_KEY).then((raw) => {
    if (!raw || asking || !$("ask-out").hidden) return;
    try {
      const v = JSON.parse(raw);
      if (!v?.text) return;
      $("ask-out").hidden = false;
      $("ask-out").textContent = v.text;
      if (!$("ask-in").value) $("ask-in").value = v.q || "";
    } catch { /* stale */ }
  }).catch(() => { /* non-fatal */ });
}

// ---------- board controls ----------
$("task-add").addEventListener("click", addTask);
$("task-in").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
// "＋ new list…" swaps the select for an inline input (no prompt()): Enter commits, Escape reverts.
$("task-list").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "__new__") {
    $("task-list").hidden = true;
    const inp = $("task-newlist");
    inp.hidden = false; inp.value = ""; inp.focus();
  } else selectedList = v;
});
function commitNewList() {
  const inp = $("task-newlist");
  const name = inp.value.trim();
  inp.hidden = true; $("task-list").hidden = false;
  if (name) selectedList = name;
  renderAll(); // re-render so the new name is a real option and stays selected
}
function cancelNewList() {
  const inp = $("task-newlist");
  inp.hidden = true; inp.value = ""; $("task-list").hidden = false;
  renderAll();
}
$("task-newlist").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitNewList(); }
  else if (e.key === "Escape") cancelNewList();
});
$("task-newlist").addEventListener("blur", () => {
  const inp = $("task-newlist");
  if (inp.hidden) return;
  inp.value.trim() ? commitNewList() : cancelNewList();
});
$("show-done").addEventListener("click", () => { showDone = !showDone; renderAll(); });

// ---------- sync: pull open to-dos from every channel into one managed note ----------
$("sync-go").addEventListener("click", syncTasks);

// Progress + terminal messages live in the neutral sync-line (never the red sysline). Passing a
// line sets it; a terminal message stays put after syncing ends (finally passes no line).
function setSync(on, line) {
  syncing = on;
  if (line != null) { const s = $("sync-line"); s.hidden = !line; s.textContent = line; }
  reflect();
}

// Read each brandbrain "project" context in full (granted kind → silent) and inline it for the pull.
async function gatherProjects(myRun) {
  const projs = contexts.filter((c) => (c.kind || "").toLowerCase() === "project");
  if (!projs.length) return "";
  let out = "";
  for (const p of projs) {
    if (myRun !== syncSeq) return "";
    if (out.length > 12000) break;
    const full = await relay.context.use(p.id).catch(() => null);
    const data = full && "data" in full ? full.data : full;
    const text = typeof data === "string" ? data : JSON.stringify(data ?? {});
    out += `\n### PROJECT: ${p.name}\n${text.slice(0, 4000)}\n`;
  }
  return out;
}

// Ask the model to NAME the connectors (reads its ambient tool list — no grant needed yet). Cached
// with a 24h TTL, and any null/missing channel makes the cache stale — so installing a connector
// AFTER a first sync is discovered on the very next pull instead of never.
async function discoverChannels(myRun) {
  try {
    const c = JSON.parse(localStorage.getItem(PREFIX_CACHE) || "null");
    const fresh = c && c.map && typeof c.at === "number"
      && Date.now() - c.at < 24 * 3600 * 1000
      && CHANNELS.every((ch) => c.map[ch.key]);
    if (fresh) return c.map;
  } catch { /* refetch */ }
  const spec = CHANNELS.map((c) => `"${c.key}" (tools like ${c.tools})`).join("; ");
  let text = "";
  for await (const d of relay.stream({
    prompt: `Look at the MCP tool names available to you. For each of these sources find the connector that serves it: ${spec}. Reply with ONLY a JSON object mapping each key (${CHANNELS.map((c) => c.key).join(", ")}) to that connector's tool-name prefix up to and INCLUDING the trailing double underscore — e.g. "mcp__aaae5ded_1234__" — or null if you have no such tools. No prose, no fences.`,
    agentic: true,
  })) {
    if (myRun !== syncSeq) return null;
    if (d.type === "text") text += d.text;
    else if (d.type === "error") throw new Error(d.error?.message || "stream error");
  }
  let obj = null;
  const m = text.replace(/```[a-z]*\n?/gi, "").match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch { /* unparseable */ } }
  obj = obj || {};
  try { localStorage.setItem(PREFIX_CACHE, JSON.stringify({ at: Date.now(), map: obj })); } catch { /* non-fatal */ }
  return obj;
}

function buildSyncPrompt(found, projectText) {
  const channelLines = found.map((c) => `- ${c.label}: ${c.what}. Use its tools (${c.tools}). Look back ~30 days; make as few calls as possible.`).join("\n");
  return [
    "You are the user's chief of staff, assembling their personal to-do list by pulling OPEN action items that are theirs to do, from several channels. Only real, still-open, actionable items — short, imperative, specific, deduplicated. Skip anything already done or handled, FYIs, newsletters, receipts, and automated notifications.",
    found.length ? "CHANNELS TO PULL:\n" + channelLines : "",
    projectText ? "BRANDBRAIN PROJECTS — extract open next-steps / TODOs mentioned in each; use the project name as the source:\n" + projectText : "",
    "Then reply with ONLY a JSON array — no prose, no markdown fences. Each element exactly:",
    '{"text": "<short imperative action>", "source": "<Gmail|WhatsApp|Granola|the project name>", "due": "<optional short due hint, else empty>"}',
    "At most 40 items, most important first. Fold a due hint into text when it matters (e.g. \"Reply to Acme re: renewal — by Fri\"). If a tool is denied or a channel is empty, skip it silently. If there is genuinely nothing open anywhere, reply with exactly []",
  ].filter(Boolean).join("\n\n");
}

function parseTodoJson(text) {
  const t = text.replace(/```[a-z]*\n?/gi, "");
  const s = t.indexOf("["); const e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  let arr; try { arr = JSON.parse(t.slice(s, e + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  return arr.map((x) => {
    let text2 = String(x?.text ?? "").trim();
    const due = String(x?.due ?? "").trim();
    // a schema-following model puts the due hint in its own field — fold it back so the board badges it
    if (text2 && due && !DUE_RE.test(text2)) text2 = `${text2} — by ${due}`;
    return { text: text2, source: String(x?.source ?? "").trim() };
  }).filter((x) => x.text);
}

// Merge incoming items into the managed note: existing lines win (preserving their done state, so
// checked-off to-dos never resurface), new ones append under their source subheading.
function buildSyncedNote(existingBody, items) {
  const state = new Map(); // normalized text -> { done, text, source }
  const add = (rawText, source, done) => {
    const text = String(rawText || "").trim();
    if (!text) return;
    const k = text.toLowerCase().replace(/\s+/g, " ");
    if (state.has(k)) return; // first writer wins — keeps the existing done state + source
    state.set(k, { done: !!done, text, source: (source || "Synced").trim() || "Synced" });
  };
  if (existingBody) for (const tk of parseNote(SYNC_KEY, existingBody).tasks) add(tk.text, tk.section || "Synced", tk.done);
  for (const it of items) add(it.text, it.source, false);
  const groups = new Map();
  for (const v of state.values()) { if (!groups.has(v.source)) groups.set(v.source, []); groups.get(v.source).push(v); }
  const stamp = new Date().toISOString().slice(0, 10);
  let md = `# ${SYNC_TITLE}\n\n_synced ${stamp} · ${[...groups.keys()].join(" · ") || "nothing open"}_\n`;
  for (const [src, arr] of groups) {
    md += `\n## ${src}\n`;
    for (const v of arr) md += `- [${v.done ? "x" : " "}] ${v.text}\n`;
  }
  return md;
}

// The consent-free half of sync, auto-run once a day after boot: project contexts are already
// granted (contextKinds) and the extraction is a plain non-agentic turn — no new consent prompt.
// Full channel sync (which DOES trigger a consent prompt) stays behind the button.
let autoSyncTried = false; // once per session — a failed attempt retries on the next page load
async function maybeAutoSync() {
  if (!relay || syncing || sampleActive || autoSyncTried) return;
  const projs = contexts.filter((c) => (c.kind || "").toLowerCase() === "project");
  if (!projs.length) return;
  const stamp = await relay.storage.get(SYNC_STAMP_KEY).catch(() => null);
  if (stamp === today() || syncing) return;
  autoSyncTried = true;
  const myRun = ++syncSeq;
  setSync(true, "daily pull — extracting open to-dos from your projects…");
  try {
    const projectText = await gatherProjects(myRun);
    if (myRun !== syncSeq) return;
    if (!projectText) { setSync(false, ""); return; }
    let text = "";
    for await (const d of relay.stream({ prompt: buildSyncPrompt([], projectText) })) {
      if (myRun !== syncSeq) return;
      if (d.type === "text") text += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (myRun !== syncSeq) return;
    const items = parseTodoJson(text);
    if (!items) { setSync(false, ""); return; } // silent — the manual button is the loud path
    const existing = await relay.storage.get(SYNC_KEY).catch(() => null);
    await relay.storage.set(SYNC_KEY, buildSyncedNote(existing, items));
    await relay.storage.set(SYNC_STAMP_KEY, today()).catch(() => { /* retries tomorrow */ });
    setSync(false, "✓ daily pull — your project to-dos are on the board");
    await boot();
  } catch { if (myRun === syncSeq) setSync(false, ""); /* silent — the manual sync button reports errors */ }
  finally { if (myRun === syncSeq) setSync(false); }
}

async function syncTasks() {
  if (!relay || syncing) return;
  const myRun = ++syncSeq;
  sysline("");
  setSync(true, "reading your brandbrain projects…");
  try {
    const projectText = await gatherProjects(myRun);
    if (myRun !== syncSeq) return;

    setSync(true, "finding your gmail, whatsapp & granola connectors…");
    const prefixes = await discoverChannels(myRun);
    if (myRun !== syncSeq) return;
    const valid = /^mcp__[A-Za-z0-9_]+__$/;
    const found = CHANNELS.filter((c) => valid.test(prefixes?.[c.key] || ""));

    if (!found.length && !projectText) {
      throw new Error("nothing to sync yet — no gmail / whatsapp / granola connector on your Claude, and no brandbrain projects in your library. Add a connector on claude.ai (Settings → Connectors), or publish a project from brandbrain.");
    }

    if (found.length) {
      const names = found.map((c) => c.label).join(", ");
      setSync(true, `asking your consent to read ${names}…`);
      await relay.connect({
        reason: `sync your open to-dos from ${names} (read-only)`,
        tools: found.map((c) => prefixes[c.key] + "*"),
        models: ["sonnet"],
        contextKinds: KINDS,
      });
      if (myRun !== syncSeq) return;
    }

    setSync(true, "gathering your open to-dos across channels…");
    let text = "";
    for await (const d of relay.stream({ prompt: buildSyncPrompt(found, projectText), agentic: true })) {
      if (myRun !== syncSeq) return;
      if (d.type === "tool_proposed") setSync(true, "reading " + d.call.name.split("__").pop() + "…");
      else if (d.type === "tool_result" && !d.result.ok) setSync(true, "⛔ " + (d.result.error?.message || "denied") + " — continuing…");
      else if (d.type === "text") text += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (myRun !== syncSeq) return;

    const items = parseTodoJson(text);
    if (!items) throw new Error("your Claude answered but not with a parseable to-do list — Sync again, it usually lands on the second pass.");

    const before = notes.find((n) => n.key === SYNC_KEY)?.tasks.length ?? 0;
    const existing = await relay.storage.get(SYNC_KEY).catch(() => null);
    await relay.storage.set(SYNC_KEY, buildSyncedNote(existing, items));
    await relay.storage.set(SYNC_STAMP_KEY, today()).catch(() => { /* the daily pull just happened by hand */ });
    await boot();
    const after = notes.find((n) => n.key === SYNC_KEY)?.tasks.length ?? 0;
    const added = Math.max(0, after - before);
    setSync(false, added ? `✓ synced — ${added} new to-do${added === 1 ? "" : "s"} added` : "✓ synced — nothing new, you're all caught up");
  } catch (err) {
    if (myRun !== syncSeq) return;
    // A stale cached prefix (connector renamed/removed) denies every call — drop it so a retry rediscovers.
    try { localStorage.removeItem(PREFIX_CACHE); } catch { /* ignore */ }
    setSync(false, "");
    sysline("sync failed — " + String(err?.message || err).slice(0, 240));
  } finally {
    if (myRun === syncSeq) setSync(false);
  }
}

// ---------- first paint (last in the module so every binding above is live) ----------
// Synchronous sample render — the page is never blank: not for the 2s not-installed probe, not
// while a warm grant's vault read runs (home.js's paint-before-probe idiom).
renderSample();
reflect();
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; enterVault(); return; } // pre-existing grant — same proactive path as the chip
  } else if (r && r.installed === false) notInstalled = true;
  reflect();
})();
