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
let filterLink = null; // active [[link]] filter, or null
let asking = false;
let askSeq = 0;
let syncing = false;
let syncSeq = 0;
let showDone = false;        // board: reveal completed tasks
let selectedList = "Inbox";  // board quick-add target
const TASKS_KEY = "tasks.md"; // the board's own file — SHARED with the Bank connector (packages/bank-mcp)

// ---------- sync across channels ----------
// One managed note gathers OPEN to-dos pulled from the user's own channels — gmail/whatsapp/granola
// connectors on their Claude, plus the project contexts brandbrain published to their library. Same
// discover→consent→pull shape as adpulse's live pull: the model NAMES the connector (no grant needed
// to read the tool list), we re-connect for exactly those tools as read-only wildcards, then an
// agentic turn extracts action items and returns them as JSON. Results land as - [ ] lines in a
// plain .md note, so they flow into the tasks section (and Obsidian) like any other task, and the
// checkbox rewrites the source line. Completed items are never re-added; open ones are merged, deduped.
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
  onConnect: (r) => { relay = r; void boot(); },
  onDisconnect: () => { relay = null; reflect(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; void boot(); return; }
  } else if (r && r.installed === false) notInstalled = true;
  renderSample();
  reflect();
})();

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

async function boot() {
  lastBoot = Date.now();
  subscribeLive();
  try {
    const [metas, keys, info] = await Promise.all([
      relay.context.list().catch(() => []),
      relay.storage.list().catch(() => []),
      relay.storage.info().catch(() => null),
    ]);
    contexts = metas || [];
    const mdKeys = (keys || []).filter((k) => k.endsWith(".md"));
    const bodies = await Promise.all(mdKeys.map((k) => relay.storage.get(k).catch(() => null)));
    notes = mdKeys.map((k, i) => parseNote(k, bodies[i] ?? "")).filter((n) => n.body.trim());
    wireBacklinks(notes);
    renderVault(info);
    renderAll();
  } catch (e) {
    sysline("couldn't open the bank — " + String(e?.message || e).slice(0, 120));
  }
  reflect();
}

function reflect() {
  const on = !!relay;
  $("bank-it").disabled = !on;
  $("ask-go").disabled = !on || asking;
  const sg = $("sync-go");
  if (sg) { sg.disabled = !on || syncing; sg.textContent = syncing ? "pulling…" : "⟲ pull from channels"; }
  const ta = $("task-add"); if (ta) ta.disabled = !on;
  const ti = $("task-in"); if (ti) ti.disabled = !on;
  const tl = $("task-list"); if (tl) tl.disabled = !on;
  $("capture-hint").textContent = on ? "" : notInstalled ? "sample brain below — install Switchboard to start your own" : "sample brain below — connect (top right) to start your own";
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
$("vault-bind").addEventListener("click", async () => {
  if (!relay) return;
  const path = prompt("Folder for your brain (an existing Obsidian vault works):", DEFAULT_FOLDER);
  if (!path) return;
  const info = await relay.storage.bind(path.trim()).catch(() => null);
  if (info) { sysline(""); await boot(); }
  else sysline("bind declined or failed — the sandbox keeps working meanwhile.");
});

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
  notes = [...SAMPLE_NOTES, ...SAMPLE_PROJECTS].map((s) => parseNote(s.key, s.body));
  wireBacklinks(notes);
  contexts = [];
  renderAll(true);
}

function renderAll(sample = false) {
  renderShelf(sample);
  renderProjects(sample);
  renderBoard(sample);
  renderNotes(sample);
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

function renderProjects(sample) {
  const box = $("projects");
  const note = $("projects-note");
  box.textContent = "";
  const projNotes = notes.filter((n) => isProjectKey(n.key));
  // Count each project's open tasks on the board (its tasks live under a list named after it).
  const openBy = new Map();
  for (const n of notes) for (const t of n.tasks) if (!t.done) { const k = (t.section || n.title).toLowerCase(); openBy.set(k, (openBy.get(k) || 0) + 1); }
  note.textContent = projNotes.length ? `${projNotes.length} project${projNotes.length === 1 ? "" : "s"} — extracted into your Bank` : sample ? "sample — this is Switchboard, extracted into itself" : "";
  if (!projNotes.length) {
    box.append(chipEl(sample ? "" : "no projects yet — run the Bank connector’s extract-project on any repo, or publish one from a wrapp", "shelf-empty"));
    if (sample) box.lastChild.remove();
    if (!sample) return;
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

    if (!sample && relay) {
      const foot = document.createElement("div"); foot.className = "pfoot";
      const pub = document.createElement("button"); pub.className = "linklike"; pub.textContent = "publish to library →";
      pub.title = "share this project as a context every wrapp can borrow";
      pub.onclick = () => void publishProject(p, pub);
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
  if (!relay) return;
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
  btn.disabled = true; btn.textContent = "publishing…";
  try {
    await relay.context.publish({ id: p.key.replace(/\.md$/, "").replace(/^.*project-/, ""), name: p.title, kind: "project", data });
    btn.textContent = "in your library ✓";
    sysline("");
  } catch (e) {
    btn.disabled = false; btn.textContent = "publish to library →";
    sysline("couldn't publish — " + String(e?.message || e).slice(0, 120));
  }
}

function renderShelf(sample) {
  const box = $("shelf");
  box.textContent = "";
  if (sample || !contexts.length) {
    box.append(chipEl(sample ? "your brands + personal card appear here on connect" : "nothing in the library yet — build a brand in brandbrain, or add your details in the panel", "shelf-empty"));
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
function renderBoard(sample) {
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
  $("tasks-count").textContent = totalOpen || totalDone ? `${totalOpen} open${totalDone ? ` · ${totalDone} done` : ""}` : sample ? "sample board" : "all clear";
  populateLists([...groups.keys()]);
  $("show-done").hidden = !totalDone;
  $("show-done").textContent = showDone ? "hide done" : `show done${totalDone ? ` (${totalDone})` : ""}`;

  if (!groups.size) {
    box.append(chipEl(sample ? "your tasks land here as list cards — connect to start" : "no tasks yet — add one above, pull from your channels, or send them in from any Claude thread", "shelf-empty"));
    return;
  }
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
    const rows = g.open.concat(showDone ? g.done : []);
    for (const { n, t } of rows) card.append(taskRow(n, t, sample));
    box.append(card);
  }
}

function taskRow(n, t, sample) {
  const row = document.createElement("label");
  row.className = "trow" + (t.done ? " done" : "");
  const cb = document.createElement("input"); cb.type = "checkbox";
  cb.checked = t.done; cb.disabled = sample || !relay;
  cb.onchange = () => void toggleTask(n, t);
  const dm = DUE_RE.exec(t.text);
  const span = document.createElement("span"); span.textContent = dm ? dm[1] : t.text;
  row.append(cb, span);
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

async function toggleTask(note, task) {
  const lines = note.body.split("\n");
  lines[task.line] = task.done
    ? lines[task.line].replace(/- \[[xX]\]/, "- [ ]")
    : lines[task.line].replace("- [ ]", "- [x]");
  try { await relay.storage.set(note.key, lines.join("\n")); await boot(); }
  catch (e) { sysline("couldn't update that — " + String(e?.message || e).slice(0, 100)); }
}

function renderNotes(sample) {
  const box = $("notes");
  box.textContent = "";
  $("brain-note").textContent = sample ? "sample brain — connect to start yours" : filterLink ? `filtered by [[${filterLink}]] — click the chip again to clear` : `${notes.length} note${notes.length === 1 ? "" : "s"}, newest first`;
  const shown = notes
    .filter((n) => !isProjectKey(n.key)) // projects render as cards up in §03, not here in the brain
    .filter((n) => !filterLink || n.links.some((l) => l.toLowerCase() === filterLink.toLowerCase()) || n.title.toLowerCase() === filterLink.toLowerCase())
    .slice()
    .reverse();
  if (!shown.length) { box.append(chipEl(filterLink ? "nothing links here yet" : "empty brain — bank the first note above", "shelf-empty")); return; }
  for (const n of shown) {
    const card = document.createElement("div");
    card.className = "note";
    const h = document.createElement("div"); h.className = "nt"; h.textContent = n.title;
    card.append(h);
    const snippet = n.body.split("\n").filter((l) => l.trim() && !l.startsWith("# ")).slice(0, 3).join(" · ").slice(0, 220);
    if (snippet) card.append(Object.assign(document.createElement("div"), { className: "nb", textContent: snippet }));
    if (n.links.length || n.backlinks.length) {
      const lr = document.createElement("div"); lr.className = "nlinks";
      for (const l of n.links) {
        const b = document.createElement("button"); b.className = "wikilink"; b.textContent = `[[${l}]]`;
        b.onclick = () => { filterLink = filterLink?.toLowerCase() === l.toLowerCase() ? null : l; renderAll(sample); };
        lr.append(b);
      }
      if (n.backlinks.length) lr.append(Object.assign(document.createElement("span"), { className: "backl", textContent: `← ${n.backlinks.join(", ")}` }));
      card.append(lr);
    }
    if (!sample && relay) {
      const del = document.createElement("button"); del.className = "ndel"; del.textContent = "forget";
      del.onclick = async () => { if (confirm(`Forget “${n.title}”? The .md file is deleted.`)) { await relay.storage.delete(n.key).catch(() => {}); await boot(); } };
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
  if (!q || !relay || asking) return;
  const my = ++askSeq;
  asking = true; reflect();
  const out = $("ask-out");
  out.hidden = false; out.textContent = "";
  let corpus = "";
  for (const n of notes) {
    if (corpus.length > 24000) { corpus += "\n[...more notes truncated]"; break; }
    corpus += `\n--- ${n.title} (${n.key}) ---\n${n.body}\n`;
  }
  const shelfNames = contexts.map((c) => `${c.name} (${c.kind || "context"})`).join(", ");
  const prompt = [
    "You are the user's context bank — answer from THEIR notes below, plus the names of what's in their library. Cite note titles when you draw on them. If the notes don't cover it, say so plainly. Be concise and direct; second person.",
    shelfNames ? `LIBRARY (names only): ${shelfNames}` : "",
    `NOTES:${corpus || "\n(none yet)"}`,
    `QUESTION: ${q}`,
  ].filter(Boolean).join("\n\n");
  try {
    for await (const d of relay.stream({ prompt })) {
      if (my !== askSeq) return;
      if (d.type === "text") out.textContent += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
  } catch (e) {
    out.textContent += `\n[the brain went quiet — ${String(e?.message || e).slice(0, 100)}]`;
  } finally {
    if (my === askSeq) { asking = false; reflect(); }
  }
}

// ---------- board controls ----------
$("task-add").addEventListener("click", addTask);
$("task-in").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });
$("task-list").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "__new__") {
    const name = (prompt("New list name:", "") || "").trim();
    selectedList = name || "Inbox";
    renderAll(); // re-render so the new name is a real option and stays selected
  } else selectedList = v;
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

// Ask the model to NAME the connectors (reads its ambient tool list — no grant needed yet). Cached.
async function discoverChannels(myRun) {
  try { const c = JSON.parse(localStorage.getItem(PREFIX_CACHE) || "null"); if (c) return c; } catch { /* refetch */ }
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
  try { localStorage.setItem(PREFIX_CACHE, JSON.stringify(obj)); } catch { /* non-fatal */ }
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
  return arr.map((x) => ({ text: String(x?.text ?? "").trim(), source: String(x?.source ?? "").trim() })).filter((x) => x.text);
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
