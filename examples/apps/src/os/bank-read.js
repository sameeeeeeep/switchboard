// bank-read.js — the OS's shared Bank data layer. Pure, self-contained: given a CONNECTED relay
// handle it reads the vault (relay.storage) and derives the same project/brand/task/note model the
// standalone Bank wrapp (../bank.js) renders, reshaped into the flatter BankData shape the OS
// surfaces (./surfaces/bank.js) expect. No DOM, no globals, no polling — call buildBankData(relay)
// on demand; the caller decides when "on demand" is (tab open, focus, a permissionsChanged event…).
//
// This file intentionally does NOT import ../bank.js or ./surfaces/bank.js — they're a different
// app's UI module and a rendering sample respectively. Their PARSING CONVENTIONS are ported here
// (kept in lockstep on purpose) so the OS agrees with the standalone wrapp on what a vault means:
//
//   • a project/brand "card" is a `project-<slug>.md` / `brand-<slug>.md` file, written by the Bank
//     connector's extractor (packages/bank-mcp/project.mjs) or brandbrain — see bank.js §03/§04
//     (isProjectKey/isBrandKey, parseProjectCard) and docs/CONTEXT-KINDS.md `kind:"project"`.
//   • a task is any `- [ ] text` line in ANY .md note (not just tasks.md — bank.js's board
//     aggregates the whole vault, see bank.js renderBoard). Its LIST is the nearest `## Heading`
//     above it, or the note's own title — see bank.js parseNote / packages/bank-mcp/tasks.mjs.
//   • the kanban dialect (status:/id:/epic:/prio:/due:/blocked:/needs: inline tokens, `[x]` always
//     wins as done) is ported verbatim from packages/bank-mcp/tasks.mjs so this module and the Bank
//     connector agree on the one tasks.md. See parseTasks()/columnOf() below — same precedence:
//     done > backlog (parked) > blocked (unresolved blocker or status:blocked) > doing/review > todo.
//
// GROUPING CONVENTION (the "which note belongs to which project" call the task brief asked to be
// documented): bank.js has NO automatic per-project note ownership beyond two REAL relations it
// already uses elsewhere in its own UI —
//   (1) a task's list name equals the project's title (this is exactly how bank.js's renderProjects
//       counts each project's "N open tasks" via its `openBy` map), and
//   (2) a note [[wikilinks]] to the project's title (exactly how bank.js's backlinks/matchingBrand
//       work — a brand card is "matched" to a project by title, and SAMPLE_NOTES model tasks/notes
//       that reference a project/brand by name via [[link]]).
// A plain note that does neither is NOT auto-assigned to any project here — in bank.js it still
// shows up in the global, unfiltered "brain" list (filtered manually by clicking a [[link]] chip).
// Since BankData is a PER-PROJECT model with no top-level catch-all bucket, such notes simply don't
// surface under any project. That's a deliberate scope cut, not a bug — see the report for the
// alternative (a synthetic "all"/"unsorted" bucket) if the OS wants it later.
//
// ARTIFACTS: bank.js and the Bank connector have no shipping "artifact" producer today (the OS's
// cross-app artifacts — Crest marks, AdForge ads — live in other wrapps' own storage, not the vault).
// The one place a project CAN describe its own artifacts today is a `## Artifacts` section on its own
// card, parsed the same way project.mjs's Products/Roadmap bullets are ("Title — src · time"). Until
// a real producer exists this will almost always be `[]`, and that's the honest state — see report.

export const KINDS = ["brand", "personal", "persona", "project", "csv", "gsheet", "note"];

const ACTIVE_KEY = "active-project"; // same Bank-local key bank.js reads/writes (mirrors daemon setActiveProject)
const PROJECT_RE = /(^|\/)project-([^/]+)\.md$/i;
const BRAND_RE = /(^|\/)brand-([^/]+)\.md$/i;

const isProjectKey = (k) => PROJECT_RE.test(k || "");
const isBrandKey = (k) => BRAND_RE.test(k || "");
function cardKind(key) {
  if (isProjectKey(key)) return "project";
  if (isBrandKey(key)) return "brand";
  return null;
}
function slugOf(key) {
  const m = PROJECT_RE.exec(key) || BRAND_RE.exec(key);
  return (m ? m[2] : String(key || "").replace(/\.md$/i, "")) || "project";
}
const normTitle = (s) => String(s || "").toLowerCase().trim();

// ---------- note parsing (bank.js parseNote, minus its inline naive task scan — parseTasks below
// owns the full kanban dialect instead) ----------
export function parseNote(key, body) {
  const b = String(body || "");
  const lines = b.split("\n");
  const h = lines.find((l) => l.startsWith("# "));
  const title = (h ? h.slice(2) : (lines.find((l) => l.trim()) || key)).trim().slice(0, 120);
  const links = [...new Set([...b.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean))];
  return { key, title, body: b, links, backlinks: [] };
}
function wireBacklinks(list) {
  for (const n of list) n.backlinks = [];
  for (const n of list) for (const l of n.links) {
    const target = list.find((t) => t.title.toLowerCase() === l.toLowerCase());
    if (target && target !== n) target.backlinks.push(n.title);
  }
}

// ---------- the card dialect (bank.js parseProjectCard) — `> summary`, `- **key:** val` meta lines,
// `## Section` → bullet-list items. Same shape for project-*.md AND brand-*.md (bank.js shares one
// parser between §03 projects and §04 brands). ----------
function parseCard(note) {
  const meta = {}; const sections = {}; let summary = ""; let cur = null;
  for (const l of String(note.body || "").split("\n")) {
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
const HEX_RE = /`?(#[0-9a-fA-F]{6})`?/;
function parseSwatch(line) {
  const hex = (HEX_RE.exec(line) || [])[1];
  if (!hex) return null;
  const from = line.replace(HEX_RE, "").replace(/^\s*—\s*/, "").replace(/_\(([^)]*)\)_/, "($1)").trim();
  return { hex: hex.toLowerCase(), from };
}
// A card's "## Artifacts" bullet, in the same "Title — src · time" shape Products/roadmap lines use.
function parseArtifactLine(line) {
  const [titlePart, restPart] = String(line || "").split(/\s+—\s+/);
  const rest = (restPart || "").split(/\s+·\s+/).map((s) => s.trim()).filter(Boolean);
  return { title: (titlePart || line || "").trim(), src: rest[0] || "", time: rest[1] || undefined };
}

// ---------- the kanban task dialect — ported from packages/bank-mcp/tasks.mjs so this module and
// the Bank connector parse ONE tasks.md identically. See that file's header for the full grammar;
// kept verbatim here (TOKEN keys, precedence) minus the `detail`/subtask capture bank.js's simpler
// board doesn't need — nested `- [ ]` lines are recognized (so they never get double-counted as a
// top-level task) but their text isn't retained. ----------
const TASK_LINE_RE = /^(\s*)- \[( |x|X)\] (.+)$/;
const HEAD_RE = /^##\s+(.+)$/;
const TOKEN_RE = /^(status|id|epic|prio|due|blocked|needs):(.+)$/i;
export const OPEN_STATUSES = ["backlog", "todo", "doing", "blocked", "review"];

function parseTaskBody(bodyRaw) {
  let body = String(bodyRaw || "").trim();
  const out = { title: "", tag: null, proj: null, status: null, id: null, epic: null, prio: null, due: null, blockedBy: [] };
  const legacy = body.match(/\s+—\s+by\s+(.+)$/i);
  if (legacy) { out.due = legacy[1].trim(); body = body.slice(0, legacy.index).trim(); }
  const words = [];
  for (const tok of body.split(/\s+/)) {
    if (!tok) continue;
    if (tok[0] === "@" && tok.length > 1) { out.tag = tok.slice(1); continue; }
    if (tok[0] === "#" && tok.length > 1) { out.proj = tok.slice(1); continue; }
    const m = TOKEN_RE.exec(tok);
    if (m) {
      const k = m[1].toLowerCase(), v = m[2];
      if (k === "status") out.status = v.toLowerCase();
      else if (k === "id") out.id = v;
      else if (k === "epic") out.epic = v;
      else if (k === "prio") out.prio = v.toLowerCase();
      else if (k === "due") out.due = v;
      else out.blockedBy.push(v); // blocked: / needs:
      continue;
    }
    words.push(tok);
  }
  out.title = words.join(" ").trim();
  return out;
}

/** Every top-level task in one note's body, tagged with its `## ` list (falling back to
 *  `sectionFallback`, normally the note's own title — mirrors bank.js's `t.section || n.title`).
 *  `status` here is the RAW token (or null); call resolveTaskStatus() across the full task set to
 *  get the final kanban column (blockers can point at ids in other notes). */
export function parseTasks(body, sectionFallback = "Inbox") {
  const lines = String(body || "").split("\n");
  const out = [];
  let list = sectionFallback || "Inbox";
  let parentIndent = null;
  let current = null;
  const flush = () => { if (current) { out.push(current); current = null; parentIndent = null; } };
  for (const l of lines) {
    const h = HEAD_RE.exec(l);
    if (h) { flush(); list = h[1].trim() || "Inbox"; continue; }
    const m = TASK_LINE_RE.exec(l);
    if (m) {
      const indent = m[1].length;
      const done = m[2] !== " ";
      if (current && parentIndent !== null && indent > parentIndent) continue; // a subtask — not top-level
      flush();
      let p;
      try { p = parseTaskBody(m[3]); }
      catch { p = { title: m[3].trim(), tag: null, proj: null, status: null, id: null, epic: null, prio: null, due: null, blockedBy: [] }; }
      current = { done, list, rawStatus: p.status, ...p };
      parentIndent = indent;
      continue;
    }
    if (l.trim() === "") continue;
    if (current && parentIndent !== null && (l.match(/^(\s*)/)[1].length) > parentIndent) continue; // detail line
    flush();
  }
  flush();
  return out;
}

/** Resolve each task's kanban column from its checkbox, status token, and blocker state — same
 *  precedence as packages/bank-mcp/tasks.mjs columnOf(). Mutates `.status` on each task in place. */
function resolveTaskStatus(tasks) {
  const byId = {};
  for (const t of tasks) if (t.id) byId[String(t.id).toLowerCase()] = t;
  for (const t of tasks) {
    if (t.done) { t.status = "done"; continue; }
    if (t.status === "backlog") continue; // parked — leave as-is
    const unresolved = (t.blockedBy || []).some((bid) => {
      const dep = byId[String(bid).toLowerCase()];
      return !dep || !dep.done;
    });
    if (unresolved || t.status === "blocked") { t.status = "blocked"; continue; }
    t.status = (t.status === "doing" || t.status === "review") ? t.status : "todo";
  }
  return byId;
}

// ---------- the full build ----------

/** Build the whole Bank data model from a CONNECTED relay handle (relay.storage.list/get/info,
 *  ideally already past relay.connect()). Any single note's parse failure is caught and that note is
 *  dropped rather than failing the whole read; a failure to LIST the vault at all is left to throw —
 *  same "surface as an error state, not an empty vault" doctrine bank.js's boot() uses. */
export async function buildBankData(relay) {
  if (!relay || !relay.storage || typeof relay.storage.list !== "function") {
    throw new Error("buildBankData: relay is not connected (no relay.storage)");
  }
  const [keys, info, activeRaw] = await Promise.all([
    relay.storage.list(),                                  // the core read — let this throw
    relay.storage.info().catch(() => null),
    relay.storage.get(ACTIVE_KEY).catch(() => null),
  ]);
  const mdKeys = (keys || []).filter((k) => typeof k === "string" && k.endsWith(".md"));
  const bodies = await Promise.all(mdKeys.map((k) => relay.storage.get(k).catch(() => null)));

  const notes = [];
  for (let i = 0; i < mdKeys.length; i++) {
    try {
      const n = parseNote(mdKeys[i], bodies[i] ?? "");
      if (n.body.trim()) notes.push(n);
    } catch { /* one bad note never kills the vault read */ }
  }
  wireBacklinks(notes);

  // Vault-wide task pool (every note may carry `- [ ]` lines — see the header comment).
  const allTasks = [];
  for (const n of notes) {
    try {
      for (const t of parseTasks(n.body, n.title)) allTasks.push({ ...t, file: n.key });
    } catch { /* this note's tasks are dropped, the rest of the build continues */ }
  }
  resolveTaskStatus(allTasks);

  const cardNotes = notes.filter((n) => cardKind(n.key));
  const idOf = assignIds(cardNotes); // key -> unique id (disambiguates a project/brand pair sharing one slug)
  const activeCard = cardNotes.find((n) => n.key === activeRaw);
  const activeProjectId = activeCard ? idOf.get(activeCard.key) : (cardNotes[0] ? idOf.get(cardNotes[0].key) : null);

  const vaultFolder = info && !info.autoAssigned ? info.folder : (info ? info.folder : "");
  const projects = cardNotes.map((cardNote) => buildProjectEntry(cardNote, idOf.get(cardNote.key), notes, allTasks, cardNotes, idOf, vaultFolder, activeProjectId));

  return { activeProjectId, projects };
}

// `project-x.md` and `brand-x.md` can legally share a slug (same-named entity, two card kinds) — give
// each card note a unique id so the flattened projects[] array never carries a duplicate id: plain
// slug when it's unique, `<slug>-<kind>` when it collides, `<slug>-<kind>-2/3/…` if that STILL collides.
function assignIds(cardNotes) {
  const bySlug = new Map();
  for (const n of cardNotes) { const s = slugOf(n.key); if (!bySlug.has(s)) bySlug.set(s, []); bySlug.get(s).push(n); }
  const idOf = new Map();
  for (const [slug, group] of bySlug) {
    if (group.length === 1) { idOf.set(group[0].key, slug); continue; }
    const used = new Set();
    for (const n of group) {
      let id = `${slug}-${cardKind(n.key)}`;
      let i = 2;
      while (used.has(id)) id = `${slug}-${cardKind(n.key)}-${i++}`;
      used.add(id);
      idOf.set(n.key, id);
    }
  }
  return idOf;
}

function fileEntry(note, kind) {
  const bodyLines = String(note.body || "").split("\n").filter((l) => l.trim() && !l.startsWith("# "));
  return { key: note.key, title: note.title, kind, src: "vault", note: bodyLines.slice(0, 2).join(" ").slice(0, 160) };
}

function buildProjectEntry(cardNote, id, allNotes, allTasks, cardNotes, idOf, vaultFolder, activeProjectId) {
  const kind = cardKind(cardNote.key); // "project" | "brand"
  const p = parseCard(cardNote);
  const titleLower = normTitle(p.title);

  // ---- related notes: task-list-name match (real relation #1) ∪ [[wikilink]] match (real relation #2)
  const relatedKeys = new Set();
  for (const t of allTasks) if (normTitle(t.list) === titleLower) relatedKeys.add(t.file);
  for (const n of allNotes) if (n !== cardNote && n.links.some((l) => normTitle(l) === titleLower)) relatedKeys.add(n.key);
  relatedKeys.delete(cardNote.key);

  const brainNotes = allNotes.filter((n) => relatedKeys.has(n.key) && !cardKind(n.key));
  const files = [fileEntry(cardNote, kind), ...brainNotes.map((n) => fileEntry(n, "note"))];
  const brain = brainNotes.map((n) => ({ key: n.key, title: n.title, note: fileEntry(n, "note").note, src: "vault" }));

  // ---- brand facet: for a project card, the matching brand-<slug>.md by title; for a brand card, itself.
  let brandSource = null;
  if (kind === "brand") brandSource = p;
  else {
    const match = cardNotes.find((n) => isBrandKey(n.key) && normTitle(parseCard(n).title) === titleLower);
    if (match) { brandSource = parseCard(match); relatedKeys.add(match.key); if (!files.some((f) => f.key === match.key)) files.push(fileEntry(match, "brand")); }
  }
  const swatches = brandSource ? (brandSource.sections.Palette || []).map(parseSwatch).filter(Boolean).map((s) => s.hex) : [];
  const brandCount = brandSource ? (brandSource.sections.Products || []).length : 0;
  const brandSet = { text: brandSource ? (brandCount ? `${brandCount} product${brandCount === 1 ? "" : "s"}` : brandSource.summary || "") : "", swatches };

  // ---- roadmap: plain bullet strings in the real project.mjs output carry no explicit done/now
  // marker; best-effort read a leading "(done)"/"(now)" hint if a hand-edited card carries one,
  // otherwise every item is "" (undetermined) — see the report for this deviation.
  const roadmap = (p.sections.Roadmap || []).map((line) => {
    const m = /^\(?(done|now)\)?\s*[-:]?\s*/i.exec(line);
    const state = m ? m[1].toLowerCase() : "";
    return [state ? line.slice(m[0].length).trim() : line, state];
  });

  const voiceVal = (p.meta.voice || [])[0] || (p.sections.Voice || []).join(" ");
  const voice = voiceVal ? { empty: false, val: voiceVal, cta: "" } : { empty: true, val: "no voice profile yet", cta: "Extract voice" };

  const tasks = allTasks
    .filter((t) => normTitle(t.list) === titleLower)
    .map((t) => {
      const out = { text: t.title, done: t.done, status: t.status, section: t.list };
      if (t.id) out.id = t.id;
      if (t.epic) out.epic = t.epic;
      if (t.prio) out.prio = t.prio;
      if (t.blockedBy && t.blockedBy.length) out.blocked = t.blockedBy.join(",");
      return out;
    });

  const artifacts = (p.sections.Artifacts || []).map((line) => {
    const a = parseArtifactLine(line);
    return { key: `${cardNote.key}#${a.title}`, title: a.title, kind: "artifact", src: a.src, time: a.time };
  });

  const folder = (p.meta.folder || [])[0] || (vaultFolder ? `${vaultFolder}/` : "");
  const path = vaultFolder ? `${vaultFolder}/${cardNote.key}` : cardNote.key;

  return {
    id,
    name: p.title,
    kind,
    active: id === activeProjectId,
    essence: p.summary || "",
    folder,
    path,
    facets: {
      essence: p.summary || "",
      audience: (p.meta.audience || [])[0] || "",
      goals: (p.meta.goals || [])[0] || "",
      brandSet,
      roadmap,
      voice,
    },
    counts: { tasks: tasks.length, brain: brain.length, artifacts: artifacts.length },
    files,
    tasks,
    brain,
    artifacts,
  };
}

// ---------- static offline fallback — same shape as buildBankData()'s result, so the OS renders
// identically (labeled elsewhere as sample) with no daemon connected. Never mixed with a real read. ----------
export const SAMPLE_BANK = {
  activeProjectId: "indeur",
  projects: [
    {
      id: "indeur",
      name: "IndEur Club",
      kind: "project",
      active: true,
      essence: "A membership community for the Indian-European diaspora — cultural events, professional network, a sense of home away from home.",
      folder: "~/Bank/projects/indeur-club/",
      path: "~/Bank/projects/indeur-club/project-indeur.md",
      facets: {
        essence: "A membership community for the Indian-European diaspora — cultural events, professional network, a sense of home away from home.",
        audience: "First & second-gen Indians in the EU, 24–40, city-based, seeking belonging + opportunity.",
        goals: "500 founding members before launch · a monthly flagship event in 3 cities · a warm, ownable brand.",
        brandSet: { text: "Palette: Terracotta & Indigo", swatches: ["#e0764a", "#5b4fe8", "#e8b04a", "#1b1a2e"] },
        roadmap: [["Name", "done"], ["Brand", "done"], ["Launch page", "now"], ["First event", ""], ["500 members", ""]],
        voice: { empty: true, val: "no voice profile yet", cta: "Extract voice" },
      },
      counts: { tasks: 6, brain: 4, artifacts: 4 },
      files: [
        { key: "project-indeur.md", title: "IndEur Club", kind: "project", src: "vault", note: "the root essence + audience + goals" },
        { key: "n-meetup-notes.md", title: "meetup-notes", kind: "note", src: "vault", note: "what the first 30 members want from a chapter" },
        { key: "n-pricing-thesis.md", title: "pricing-thesis", kind: "note", src: "vault", note: "founding vs monthly tiers; €9 anchor" },
        { key: "n-voice-scratch.md", title: "voice-scratch", kind: "note", src: "vault", note: "warm, plural, never corporate — draft phrases" },
      ],
      tasks: [
        { id: "t1", text: "Finalize Q4 palette", done: false, status: "doing", epic: "launch", section: "IndEur Club" },
        { id: "t2", text: "Ship the launch page", done: false, status: "doing", epic: "launch", section: "IndEur Club" },
        { id: "t3", text: "Book 3 event venues", done: false, status: "todo", section: "IndEur Club" },
        { id: "t4", text: "Draft founding-member email", done: false, status: "todo", section: "IndEur Club" },
        { id: "t5", text: "Extract brand voice", done: false, status: "todo", section: "IndEur Club" },
        { id: "t6", text: "Confirm pricing tiers", done: false, status: "blocked", blocked: "t3", section: "IndEur Club" },
      ],
      brain: [
        { key: "n-meetup-notes.md", title: "meetup-notes", note: "what the first 30 members want from a chapter", src: "vault" },
        { key: "n-pricing-thesis.md", title: "pricing-thesis", note: "founding vs monthly tiers; €9 anchor", src: "vault" },
        { key: "n-voice-scratch.md", title: "voice-scratch", note: "warm, plural, never corporate — draft phrases", src: "vault" },
        { key: "project-indeur.md", title: "IndEur Club", note: "the root essence + audience + goals", src: "vault" },
      ],
      artifacts: [
        { key: "project-indeur.md#Switch-ligature monogram", title: "Switch-ligature monogram", kind: "artifact", src: "Crest", time: "20m" },
        { key: "project-indeur.md#IndEur — 4 marks", title: "IndEur — 4 marks", kind: "artifact", src: "Crest", time: "22m" },
        { key: "project-indeur.md#Terracotta beam render", title: "Terracotta beam render", kind: "artifact", src: "Prism", time: "1h" },
        { key: "project-indeur.md#\"Find your people\" ad", title: '"Find your people" ad', kind: "artifact", src: "AdForge", time: "1h" },
      ],
    },
    {
      id: "nailinit",
      name: "nailinit",
      kind: "brand",
      active: false,
      essence: "india's #1 press-ons, stick-ons, and express nail care brand — salon-quality nails in minutes.",
      folder: "",
      path: "~/Bank/brand-nailinit.md",
      facets: {
        essence: "india's #1 press-ons, stick-ons, and express nail care brand — salon-quality nails in minutes.",
        audience: "",
        goals: "",
        brandSet: { text: "6 products", swatches: ["#c4301c", "#072835", "#fc3f75", "#e7e1f5", "#ffe093"] },
        roadmap: [],
        voice: { empty: true, val: "no voice profile yet", cta: "Extract voice" },
      },
      counts: { tasks: 0, brain: 0, artifacts: 0 },
      files: [{ key: "brand-nailinit.md", title: "nailinit", kind: "brand", src: "vault", note: "salon-quality nails in minutes" }],
      tasks: [],
      brain: [],
      artifacts: [],
    },
  ],
};
