// Pure task-document transforms for the Bank connector. NO I/O — every function takes the current
// markdown and returns the next one, so the whole task model is testable without touching disk.
//
// The dialect is Bank's dialect, which is Obsidian's dialect: a task is a `- [ ] text` line, and the
// nearest preceding `## Heading` is its LIST (Bank renders that heading as the task's source label).
// That's the entire contract — no ids, no frontmatter, no JSON. The same plain files open in Obsidian,
// are written by the Bank app through the daemon, and are appended to here from any Claude thread.

const TASK_RE = /^(\s*)- \[( |x|X)\] (.+)$/;
const HEAD_RE = /^##\s+(.+)$/;

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// A task's base text ignores a trailing routing `@<wrapp>` tag (the store pins it dead-last) AND a
// trailing "— by <due>" hint, so re-adding a store-routed task — or re-adding with a new due — isn't a
// dupe. Peel the tag FIRST (it sits after the due), then the due, mirroring home.js normTask.
const baseText = (t) => String(t || "").replace(/\s+@[a-z][a-z0-9-]{0,47}\s*$/i, "").replace(/\s+—\s+by\s+.*$/i, "").trim();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A list name becomes a heading — collapse to one clean line, strip markdown that would break it.
export const cleanList = (s) => (String(s || "").replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim() || "Inbox").slice(0, 80);

/** Every task in a doc, tagged with the `## ` list it sits under (default "Inbox"). */
export function parseTasks(text, file = "") {
  const lines = String(text || "").split("\n");
  const out = [];
  let list = "Inbox";
  lines.forEach((l, i) => {
    const h = HEAD_RE.exec(l);
    if (h) { list = h[1].trim() || "Inbox"; return; }
    const m = TASK_RE.exec(l);
    if (m) out.push({ line: i, done: m[2] !== " ", text: m[3].trim(), list, file });
  });
  return out;
}

/** Append `- [ ] text` under `## <list>` (creating the section if missing). Deduped by base text
 *  across the whole doc, so the same task pushed twice from different threads lands once. */
export function addTask(text, { list = "Inbox", due } = {}, existing = "") {
  const clean = String(text || "").trim();
  if (!clean) return { doc: existing, added: false, reason: "empty text" };
  const listName = cleanList(list);
  if (parseTasks(existing).some((t) => norm(baseText(t.text)) === norm(clean))) {
    return { doc: existing, added: false, reason: "duplicate", list: listName };
  }
  const line = `- [ ] ${clean}${due ? ` — by ${String(due).trim()}` : ""}`;
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
 *  null if nothing matched — the caller tries the next file. */
export function completeTask(match, existing = "") {
  const m = norm(match);
  if (!m) return { doc: existing, completed: null };
  const lines = String(existing || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = /^(\s*)- \[ \] (.+)$/.exec(lines[i]);
    if (t && norm(t[2]).includes(m)) {
      lines[i] = `${t[1]}- [x] ${t[2]}`;
      return { doc: lines.join("\n"), completed: t[2].trim() };
    }
  }
  return { doc: existing, completed: null };
}
