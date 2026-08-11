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
