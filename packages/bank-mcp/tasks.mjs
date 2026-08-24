// Pure task-document transforms for the Bank connector. NO I/O — every function takes the current
// markdown and returns the next one, so the whole task model is testable without touching disk.
//
// The dialect is Bank's dialect, which is Obsidian's dialect: a task is a `- [ ] text` line, and the
// nearest preceding `## Heading` is its LIST (Bank renders that heading as the task's source label).
// The base contract is still plain — the same files open in Obsidian — but a task line may now carry a
// few OPTIONAL, order-free, still-plain tokens that turn the two-status list into a real kanban:
//
//   - [ ] Ship the pricing page @crest #switchboard status:doing id:pr01 epic:launch prio:high due:2026-08-15
//         Detail: three tiers, monthly/annual toggle, Paddle checkout.   ← indented lines = the card's detail
//         - [ ] Wire Paddle checkout                                     ← nested checkbox = a subtask
//   - [ ] Legal OK on pricing copy #switchboard status:blocked id:leg1 epic:launch blocked:pr01
//
//   status:<backlog|todo|doing|blocked|review>  the open-state column. `[x]` ALWAYS wins as Done; a
//                                       missing status = todo; `backlog` = parked (not yet released to
//                                       agents); an unresolved `blocked:` forces Blocked (unless parked).
//   id:<short>        a stable handle so other cards (and Claude) can reference this one.
//   blocked:<id>      (repeatable, also spelled needs:) this card waits on task <id>.
//   epic:<slug>       the bundle this card belongs to (a group of related cards).
//   prio:<high|med|low>   priority.
//   due:<YYYY-MM-DD>  a due date (the legacy "— by <hint>" form is still read).
//
// Every token is optional and every one round-trips through Obsidian untouched, so nothing here breaks
// the "a task is a line in a file" invariant — it just lets that line say more.

const TASK_RE = /^(\s*)- \[( |x|X)\] (.+)$/;
const HEAD_RE = /^##\s+(.+)$/;
const KEY_RE = /^(status|id|epic|prio|due|blocked|needs):(.+)$/i;   // the ONLY key:val tokens we consume (URLs etc. stay in the title)
export const OPEN_STATUSES = ["backlog", "todo", "doing", "blocked", "review"];

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// A task's base text (for dedupe) ignores every trailing tag/token: a trailing routing `@<wrapp>`, a
// `#project`, any `key:val` dialect token, and a legacy "— by <due>" hint. Peel them repeatedly off the
// end so re-adding a store-routed / re-dated / spec'd task isn't a false dupe.
const baseText = (t) => {
  let s = String(t || "").trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/\s+(@[a-z][a-z0-9-]{0,47}|#[a-z0-9][a-z0-9-]{0,47}|(?:status|id|epic|prio|due|blocked|needs):[^\s]+)$/i, "")
         .replace(/\s+—\s+by\s+.*$/i, "").trim();
  } while (s !== prev);
  return s;
};
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A list name becomes a heading — collapse to one clean line, strip markdown that would break it.
export const cleanList = (s) => (String(s || "").replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim() || "Inbox").slice(0, 80);

/** Split a task's body into its clean title + the dialect tokens it carries. Unknown `key:val` (a URL,
 *  a "note:foo") is left in the title untouched — we only ever consume the seven keys above. */
export function parseBody(bodyRaw) {
  let body = String(bodyRaw || "").trim();
  const out = { title: "", tag: null, proj: null, status: null, id: null, epic: null, prio: null, due: null, blockedBy: [] };
  // legacy "— by <hint>" due (what addTask writes) — pull it before tokenizing on whitespace.
  const legacy = body.match(/\s+—\s+by\s+(.+)$/i);
  if (legacy) { out.due = legacy[1].trim(); body = body.slice(0, legacy.index).trim(); }
  const words = [];
  for (const tok of body.split(/\s+/)) {
    if (!tok) continue;
    if (tok[0] === "@" && tok.length > 1) { out.tag = tok.slice(1); continue; }
    if (tok[0] === "#" && tok.length > 1) { out.proj = tok.slice(1); continue; }
    const m = KEY_RE.exec(tok);
    if (m) {
      const k = m[1].toLowerCase(), v = m[2];
      if (k === "status") out.status = v.toLowerCase();
      else if (k === "id") out.id = v;
      else if (k === "epic") out.epic = v;
      else if (k === "prio") out.prio = v.toLowerCase();
      else if (k === "due") out.due = v;
      else out.blockedBy.push(v);   // blocked: / needs:
      continue;
    }
    words.push(tok);
  }
  out.title = words.join(" ").trim();
  return out;
}

/** Resolve each task's kanban COLUMN from its checkbox, status token, and blocker state. Precedence:
 *  done (`[x]`) > backlog (parked) > blocked (unresolved blocker or status:blocked) > doing/review >
 *  todo (the default). Needs the whole set so a blocker's done-ness is known. Promoting a card from
 *  backlog→todo is the signal that releases it to agents (see bank_next_task). */
export function columnOf(task, byId) {
  if (task.done) return "done";
  if (task.status === "backlog") return "backlog";   // parked: not released to agents; blockers are just metadata
  const unresolved = (task.blockedBy || []).some((bid) => {
    const dep = byId && byId[bid.toLowerCase()];
    return !dep || !dep.done;   // an unknown or still-open blocker keeps this card blocked
  });
  if (unresolved || task.status === "blocked") return "blocked";
  if (task.status === "doing" || task.status === "review") return task.status;
  return "todo";
}

/** Every task in a doc, tagged with the `## ` list it sits under (default "Inbox") and enriched with the
 *  dialect: title (clean), tag/proj, status, id, epic, prio, due, blockedBy, its resolved kanban `col`,
 *  and `detail` — the indented lines under it (plain notes + nested `- [ ]` subtasks). A nested (more-
 *  indented) task line is a SUBTASK of its parent, not a top-level task, so it is not emitted on its own.
 *  `text` stays the full raw body (backward-compatible); use `title` for the clean label. */
export function parseTasks(text, file = "") {
  const lines = String(text || "").split("\n");
  const out = [];
  let list = "Inbox";
  let parentIndent = null;      // indent of the current top-level task; deeper lines belong to it
  let current = null;
  const flush = () => { if (current) { out.push(current); current = null; parentIndent = null; } };

  lines.forEach((l, i) => {
    const h = HEAD_RE.exec(l);
    if (h) { flush(); list = h[1].trim() || "Inbox"; return; }
    const m = TASK_RE.exec(l);
    if (m) {
      const indent = m[1].length;
      const done = m[2] !== " ";
      // Deeper than the current top-level task → it's a subtask, captured in the parent's detail.
      if (current && parentIndent !== null && indent > parentIndent) {
        current.detail.push({ sub: true, done, text: parseBody(m[3]).title });
        return;
      }
      flush();
      const p = parseBody(m[3]);
      current = { line: i, indent, done, text: m[3].trim(), list, file, detail: [], ...p };
      parentIndent = indent;
      return;
    }
    // A non-task line: if it's indented under the current task, it's detail; blank/less-indented ends it.
    if (current && l.trim() !== "" && (l.match(/^(\s*)/)[1].length) > parentIndent) {
      current.detail.push({ sub: false, text: l.trim().replace(/^[-*]\s+/, "") });
      return;
    }
    if (l.trim() === "") return;   // blanks don't break a run (Obsidian tolerates them inside a list)
    flush();
  });
  flush();

  const byId = {};
  for (const t of out) if (t.id) byId[t.id.toLowerCase()] = t;
  for (const t of out) t.col = columnOf(t, byId);
  return out;
}

/** Append `- [ ] text` under `## <list>` (creating the section if missing). Deduped by base text
 *  across the whole doc, so the same task pushed twice from different threads lands once. Optional
 *  dialect tokens (status/epic/prio/id/due) are folded into the line so a spec'd card can be written in
 *  one call; `detail` lines are appended, indented, as the card's body. */
export function addTask(text, opts = {}, existing = "") {
  const { list = "Inbox", due, status, epic, prio, id, detail } = opts;
  const clean = String(text || "").trim();
  if (!clean) return { doc: existing, added: false, reason: "empty text" };
  const listName = cleanList(list);
  if (parseTasks(existing).some((t) => norm(baseText(t.text)) === norm(baseText(clean)))) {
    return { doc: existing, added: false, reason: "duplicate", list: listName };
  }
  // Tokens go AFTER the human text, in a stable order; a bare due keeps the friendly "— by" form.
  const toks = [];
  if (status && status !== "todo") toks.push(`status:${status}`);
  if (epic) toks.push(`epic:${epic}`);
  if (prio) toks.push(`prio:${prio}`);
  if (id) toks.push(`id:${id}`);
  const dateDue = due && /^\d{4}-\d{2}-\d{2}$/.test(String(due).trim());
  if (dateDue) toks.push(`due:${String(due).trim()}`);
  let line = `- [ ] ${clean}${toks.length ? " " + toks.join(" ") : ""}${due && !dateDue ? ` — by ${String(due).trim()}` : ""}`;
  for (const d of (Array.isArray(detail) ? detail : [])) {
    const dl = String(d || "").trim();
    if (dl) line += `\n  ${dl.startsWith("- [") ? dl : dl}`;   // two-space indent → the card's detail
  }
  let doc = existing && existing.trim() ? existing.replace(/\n+$/, "\n") : "# Tasks\n";
  const lines = doc.split("\n");
  const secRe = new RegExp(`^##\\s+${escapeRe(listName)}\\s*$`, "i");
  const hi = lines.findIndex((l) => secRe.test(l));
  if (hi === -1) {
    if (!doc.endsWith("\n")) doc += "\n";
    return { doc: `${doc}\n## ${listName}\n${line}\n`, added: true, list: listName };
  }
  // Insert after the section's last content line (before the next `## ` or EOF), skipping blank tail.
  let j = hi + 1;
  while (j < lines.length && !/^##\s+/.test(lines[j])) j++;
  let at = j;
  while (at - 1 > hi && lines[at - 1].trim() === "") at--;
  lines.splice(at, 0, line);
  return { doc: lines.join("\n"), added: true, list: listName };
}

/** Flip the first OPEN task whose text contains `match` to `- [x]`. Returns the completed text, or
 *  null if nothing matched — the caller tries the next file. Preserves the whole line (tokens and all). */
export function completeTask(match, existing = "") {
  const m = norm(match);
  if (!m) return { doc: existing, completed: null };
  const lines = String(existing || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = /^(\s*)- \[ \] (.+)$/.exec(lines[i]);
    if (t && norm(t[2]).includes(m)) {
      lines[i] = `${t[1]}- [x] ${t[2]}`;
      return { doc: lines.join("\n"), completed: parseBody(t[2]).title };
    }
  }
  return { doc: existing, completed: null };
}

/** Move a task to a kanban column by rewriting ONLY its line — flip the checkbox for done/reopen, and
 *  set/replace/drop the `status:` token for the open columns (todo drops the token to keep lines spare).
 *  `match` is an `id:` value if it looks like one, else a text substring. Returns {doc, changed, col}. */
export function setStatus(match, status, existing = "") {
  const want = String(status || "").toLowerCase();
  if (want !== "done" && !OPEN_STATUSES.includes(want)) return { doc: existing, changed: false, reason: "bad status" };
  const lines = String(existing || "").split("\n");
  const key = norm(match);
  // Two passes: an EXACT id match wins over any text match, so `setStatus("leg3", …)` never lands on a
  // different card that merely mentions leg3 in a `blocked:leg3` token. Fall back to a title substring.
  const find = (pred) => {
    for (let i = 0; i < lines.length; i++) {
      const m = TASK_RE.exec(lines[i]); if (!m) continue;
      const p = parseBody(m[3]); if (pred(p)) return { i, m, p };
    }
    return null;
  };
  const found = find((p) => p.id && p.id.toLowerCase() === key) || find((p) => norm(p.title).includes(key));
  if (!found) return { doc: existing, changed: false, reason: "no match" };
  const { i, m, p } = found;
  let body = m[3].replace(/\s+status:[^\s]+/i, "");   // strip any existing status token
  const box = want === "done" ? "x" : " ";
  if (want !== "done" && want !== "todo") body = `${body} status:${want}`;
  lines[i] = `${m[1]}- [${box}] ${body.trim()}`;
  return { doc: lines.join("\n"), changed: true, col: want, title: p.title, id: p.id || null };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// arrangeBoard — an on-demand CURATION pass over a task doc (docs/PM-NOTCH-OPERATOR.md slice 2). Pure
// like the rest of this module: takes the markdown, returns the next markdown + a legible report of
// everything it did. Three operations, every one REVERSIBLE + LEGIBLE (the founder's hard rule — a
// merge leaves a trail, never a silent delete):
//   1. dedupe  — fold a conservative near-duplicate card into one, appending a `↳ merged` trail + the
//                loser's own detail lines, so nothing is lost and the fold is visible on the card.
//   2. regroup — within each section, cluster same-epic cards and order by status then priority (done
//                sinks to the bottom). A pure reorder of whole card blocks: no card gained or lost.
//   3. park    — move a clearly-stale card (a past-due todo/blocked older than parkStaleDays) to
//                backlog with a `↳ parked` trail. Skipped unless the caller passes `today`.
// Deterministic throughout; the only "judgment" is the near-dup threshold, kept HIGH so it folds only
// obvious restatements. A section with loose non-card prose *between* its cards is left byte-for-byte
// untouched (reported as skipped) — safety over cleverness. Reordered/merged sections are re-rendered
// with normalized single-blank spacing; untouched sections keep their exact original bytes (no churn).

const STATUS_RANK = { doing: 0, review: 1, blocked: 2, todo: 3, backlog: 4, done: 5 };
const PRIO_RANK = { high: 0, med: 1, low: 2 };
const STOP = new Set(["the", "a", "an", "to", "of", "for", "and", "in", "on", "at", "via", "with", "into", "from", "not", "but"]);
const sigToks = (s) => (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length >= 3 && !STOP.has(t));
/** Conservative title similarity in [0,1]: exact (post-normalize) → 1; too few significant tokens to
 *  judge → only exact counts; otherwise Jaccard over significant tokens. */
function titleSim(a, b) {
  if (norm(a) === norm(b)) return 1;
  const A = new Set(sigToks(a)), B = new Set(sigToks(b));
  if (A.size < 3 || B.size < 3) return 0;               // too short to fuzzy-match safely
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
/** Rewrite a single task line's kanban status (park uses this) — mirrors setStatus for one line. */
function setLineStatus(line, status) {
  const m = TASK_RE.exec(line); if (!m) return line;
  let body = m[3].replace(/\s+status:[^\s]+/i, "");
  if (status !== "todo" && status !== "done") body = `${body} status:${status}`;
  return `${m[1]}- [${status === "done" ? "x" : " "}] ${body.trim()}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

/** Split a doc into SECTIONS of whole card BLOCKS, preserving every line. A section = an optional `## `
 *  heading + pre-lines (before its first card) + card blocks + trailing loose lines. A block = a
 *  top-level task line and all its indented detail/subtask lines. A section with loose prose BETWEEN
 *  cards is flagged unsafe (never reordered). */
function splitSections(text) {
  const lines = String(text || "").split("\n");
  const sections = [];
  let cur = { headingText: null, rawHeading: null, pre: [], blocks: [], trailing: [], safe: true, start: 0 };
  sections.push(cur);
  let block = null;
  const flush = () => { if (block) { cur.blocks.push(block); block = null; } };
  lines.forEach((l, i) => {
    const h = HEAD_RE.exec(l);
    if (h) {
      flush(); cur.end = i;
      cur = { headingText: h[1].trim(), rawHeading: l, pre: [], blocks: [], trailing: [], safe: true, start: i };
      sections.push(cur);
      return;
    }
    const m = TASK_RE.exec(l);
    if (m) {
      const indent = m[1].length;
      if (block && indent > block.parentIndent) { block.lines.push(l); return; }   // subtask
      if (cur.trailing.length) cur.safe = false;   // a card after loose prose → don't reorder this section
      flush();
      block = { lines: [l], parentIndent: indent, start: i };
      return;
    }
    if (l.trim() === "") { flush(); return; }       // blanks separate; dropped, re-normalized on render
    const ind = l.match(/^(\s*)/)[1].length;
    if (block && ind > block.parentIndent) { block.lines.push(l); return; }   // detail line
    flush();
    if (!cur.blocks.length) cur.pre.push(l); else cur.trailing.push(l);        // loose prose
  });
  flush();
  cur.end = lines.length;
  for (const s of sections) s.origLines = lines.slice(s.start, s.end);
  return { sections, lines };
}

/** Curate a task doc: dedupe near-dupes, regroup by epic, order by status/priority, optionally park
 *  stale cards. Returns { doc, changed, merges, parked, regrouped, sectionsScanned, sectionsSkipped }.
 *  Every mutation is legible: merges/parks leave an on-card `↳` trail and are also listed in the report. */
export function arrangeBoard(text, opts = {}) {
  const { dedupe = true, regroup = true, parkStaleDays = 30, today = null, simThreshold = 0.75 } = opts;
  const src = String(text || "");
  if (!src.trim()) return { doc: src, changed: false, merges: [], parked: [], regrouped: 0, sectionsScanned: 0, sectionsSkipped: 0 };

  const { sections } = splitSections(src);
  const byLine = new Map(parseTasks(src).map((t) => [t.line, t]));
  const model = (b) => byLine.get(b.start) || { col: "todo", title: (TASK_RE.exec(b.lines[0]) ? parseBody(TASK_RE.exec(b.lines[0])[3]).title : ""), epic: null, prio: null, done: false, due: null, detail: [] };
  for (const s of sections) for (const b of s.blocks) b.t = model(b);

  const merges = [], parked = [];
  const safeSections = sections.filter((s) => s.safe);

  // 1 · DEDUPE — greedy over survivors; the richer card (further along in status, then more detail,
  // then earlier) is kept and absorbs the other. Never merges a `done` card or two different epics.
  if (dedupe) {
    const richer = (a, b) => {
      const sa = STATUS_RANK[a.t.col] ?? 3, sb = STATUS_RANK[b.t.col] ?? 3; if (sa !== sb) return sa < sb ? a : b;
      const pa = PRIO_RANK[a.t.prio] ?? 1.5, pb = PRIO_RANK[b.t.prio] ?? 1.5; if (pa !== pb) return pa < pb ? a : b;
      if (a.lines.length !== b.lines.length) return a.lines.length > b.lines.length ? a : b;
      return a;
    };
    const survivors = [];
    for (const s of safeSections) {
      for (const b of s.blocks.slice()) {
        if (b.t.done) { survivors.push({ b, s }); continue; }
        let hit = null;
        for (const surv of survivors) {
          if (surv.b.t.done) continue;
          const e1 = (b.t.epic || "").toLowerCase(), e2 = (surv.b.t.epic || "").toLowerCase();
          if (e1 && e2 && e1 !== e2) continue;                       // distinct epics ⇒ not a dup
          if (titleSim(b.t.title, surv.b.t.title) >= simThreshold) { hit = surv; break; }
        }
        if (!hit) { survivors.push({ b, s }); continue; }
        const keep = richer(hit.b, b), loser = keep === hit.b ? b : hit.b;
        const loserSec = keep === hit.b ? s : hit.s, keepSec = keep === hit.b ? hit.s : s;
        // Legible trail on the survivor: name the loser, where it lived, its column — then its detail.
        const where = loserSec.headingText && loserSec !== keepSec ? ` [was ${loserSec.headingText}]` : "";
        const col = loser.t.col !== "todo" ? `, ${loser.t.col}` : "";
        keep.lines.push(`  ↳ merged${today ? ` (${today})` : ""}: "${loser.t.title}"${where}${col}`);
        for (const dl of loser.lines.slice(1)) {                     // fold the loser's detail — non-lossy
          const trimmed = dl.trim(); if (!trimmed) continue;
          if (!keep.lines.some((k) => k.trim() === trimmed)) keep.lines.push(`  ${trimmed}`);
        }
        loserSec.blocks = loserSec.blocks.filter((x) => x !== loser);
        loserSec.changed = true; keepSec.changed = true;
        if (keep === b) { const i = survivors.indexOf(hit); if (i >= 0) survivors[i] = { b: keep, s: keepSec }; }
        merges.push({ into: keep.t.title, from: loser.t.title, fromSection: loserSec.headingText || "(top)", fromColumn: loser.t.col });
      }
    }
  }

  // 2 · PARK — a past-due todo/blocked card older than the window becomes backlog, with a trail.
  if (today && parkStaleDays > 0) {
    for (const s of safeSections) for (const b of s.blocks) {
      if (b.t.done || !(b.t.col === "todo" || b.t.col === "blocked")) continue;
      const due = b.t.due && /^\d{4}-\d{2}-\d{2}$/.test(b.t.due) ? b.t.due : null;
      if (!due || daysBetween(today, due) <= parkStaleDays) continue;
      b.lines[0] = setLineStatus(b.lines[0], "backlog");
      b.lines.push(`  ↳ parked (${today}): stale — due ${due} passed`);
      b.t = { ...b.t, col: "backlog" };
      s.changed = true;
      parked.push({ title: b.t.title, due });
    }
  }

  // 3 · REGROUP — within each safe section, cluster same-epic cards, order by status then priority,
  // done to the bottom. Stable within a group so equal cards keep their relative order.
  let regrouped = 0;
  if (regroup) {
    for (const s of safeSections) {
      const orig = s.blocks.slice();
      if (orig.length < 2) continue;
      const groupOrder = new Map();
      orig.forEach((b, i) => { const k = b.t.epic ? `e:${b.t.epic.toLowerCase()}` : `n:${i}`; if (!groupOrder.has(k)) groupOrder.set(k, groupOrder.size); });
      const keyOf = (b, i) => {
        const gk = b.t.epic ? `e:${b.t.epic.toLowerCase()}` : `n:${i}`;
        return [b.t.done ? 1 : 0, groupOrder.get(gk) ?? 0, STATUS_RANK[b.t.col] ?? 3, PRIO_RANK[b.t.prio] ?? 1.5, i];
      };
      const decorated = orig.map((b, i) => ({ b, k: keyOf(b, i) }));
      decorated.sort((x, y) => { for (let n = 0; n < x.k.length; n++) if (x.k[n] !== y.k[n]) return x.k[n] - y.k[n]; return 0; });
      const sorted = decorated.map((d) => d.b);
      let moved = 0; for (let i = 0; i < sorted.length; i++) if (sorted[i] !== orig[i]) moved++;
      if (moved) { s.blocks = sorted; s.changed = true; regrouped += moved; }
    }
  }

  // RENDER — unchanged safe sections keep their exact bytes; changed/rebuilt ones re-render tidily.
  // A single blank line separates sections; unchanged sections carry their own original spacing.
  const out = [];
  const stripLead = (arr) => { const a = arr.slice(); while (a.length && a[0].trim() === "") a.shift(); return a; };
  for (const s of sections) {
    if (s !== sections[0] && out.length && out[out.length - 1].trim() !== "") out.push("");
    if (!s.changed) { out.push(...stripLead(s.origLines)); continue; }
    if (s.rawHeading) out.push(s.rawHeading);
    out.push(...s.pre);
    s.blocks.forEach((b, i) => { if (i) out.push(""); out.push(...b.lines); });
    if (s.trailing.length) { out.push(""); out.push(...s.trailing); }
  }
  let doc = out.join("\n").replace(/\n{3,}/g, "\n\n");
  if (src.endsWith("\n") && !doc.endsWith("\n")) doc += "\n";
  const changed = merges.length > 0 || parked.length > 0 || regrouped > 0;
  return {
    doc: changed ? doc : src, changed, merges, parked, regrouped,
    sectionsScanned: safeSections.length, sectionsSkipped: sections.length - safeSections.length,
  };
}

/** Ensure every task line carries an `id:` token (base36, unique within the doc), so cards can be
 *  referenced as blockers and claimed by the connector. Returns {doc, assigned}. Idempotent. */
export function assignIds(existing = "") {
  const lines = String(existing || "").split("\n");
  const used = new Set();
  for (const l of lines) { const m = TASK_RE.exec(l); if (m) { const id = parseBody(m[3]).id; if (id) used.add(id.toLowerCase()); } }
  const gen = () => { let s; do { s = Math.random().toString(36).slice(2, 6); } while (used.has(s)); used.add(s); return s; };
  let assigned = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = TASK_RE.exec(lines[i]);
    if (!m || parseBody(m[3]).id) continue;
    lines[i] = `${m[1]}- [${m[2]}] ${m[3].trim()} id:${gen()}`;
    assigned++;
  }
  return { doc: lines.join("\n"), assigned };
}
