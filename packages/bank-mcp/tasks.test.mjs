// Pure-logic tests for the Bank connector's task transforms. Run: node tasks.test.mjs
import assert from "node:assert/strict";
import { addTask, completeTask, parseTasks, parseBody, setStatus, assignIds, columnOf, arrangeBoard } from "./tasks.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("  ✓", name); };

test("add to empty doc creates title + section", () => {
  const { doc, added, list } = addTask("Reply to Acme", { list: "Gmail" });
  assert.equal(added, true);
  assert.equal(list, "Gmail");
  assert.match(doc, /^# Tasks\n/);
  assert.match(doc, /## Gmail\n- \[ \] Reply to Acme\n/);
});

test("second task in same list appends under the same heading (no dup heading)", () => {
  let doc = addTask("First", { list: "Relay" }).doc;
  doc = addTask("Second", { list: "Relay" }, doc).doc;
  assert.equal((doc.match(/## Relay/g) || []).length, 1);
  const tasks = parseTasks(doc).filter((t) => t.list === "Relay").map((t) => t.text);
  assert.deepEqual(tasks, ["First", "Second"]);
});

test("new list adds a new section, existing sections intact", () => {
  let doc = addTask("A", { list: "One" }).doc;
  doc = addTask("B", { list: "Two" }, doc).doc;
  assert.match(doc, /## One\n- \[ \] A/);
  assert.match(doc, /## Two\n- \[ \] B/);
});

test("due hint is folded into the line", () => {
  const { doc } = addTask("Send deck", { list: "Granola", due: "Fri" });
  assert.match(doc, /- \[ \] Send deck — by Fri/);
});

test("duplicate base text is rejected (even with a different due)", () => {
  let doc = addTask("Reply to Acme", { list: "Gmail", due: "Fri" }).doc;
  const r = addTask("Reply to Acme", { list: "Gmail", due: "Mon" }, doc);
  assert.equal(r.added, false);
  assert.equal(r.reason, "duplicate");
  assert.equal((r.doc.match(/Reply to Acme/g) || []).length, 1);
});

test("complete flips the matching open task to [x], leaves others", () => {
  let doc = addTask("Reply to Acme", { list: "Gmail" }).doc;
  doc = addTask("Book flights", { list: "Trip" }, doc).doc;
  const { doc: after, completed } = completeTask("acme", doc);
  assert.equal(completed, "Reply to Acme");
  assert.match(after, /- \[x\] Reply to Acme/);
  assert.match(after, /- \[ \] Book flights/);
});

test("completing an already-done or missing task is a no-op", () => {
  const doc = "# Tasks\n\n## X\n- [x] done already\n";
  assert.equal(completeTask("done already", doc).completed, null);
  assert.equal(completeTask("nonexistent", doc).completed, null);
});

test("parseTasks tags each task with its section as the list", () => {
  const doc = "# Tasks\n\n## Relay\n- [ ] ship connector\n- [x] write tests\n## Errands\n- [ ] milk\n";
  const t = parseTasks(doc, "tasks.md");
  assert.deepEqual(t.map((x) => [x.list, x.text, x.done]), [
    ["Relay", "ship connector", false],
    ["Relay", "write tests", true],
    ["Errands", "milk", false],
  ]);
});

test("list name with markdown/newlines is sanitized to a single heading", () => {
  const { doc, list } = addTask("x", { list: "My\n## Sneaky\nProject" });
  assert.equal(list, "My Sneaky Project");
  assert.equal((doc.match(/^##/gm) || []).length, 1);
});

// ── dialect: tokens ────────────────────────────────────────────────────────────────────────────────
test("parseBody splits title from @tag #proj and every dialect token", () => {
  const p = parseBody("Ship the pricing page @crest #switchboard status:doing id:pr01 epic:launch prio:high due:2026-08-15 blocked:leg1 needs:leg2");
  assert.equal(p.title, "Ship the pricing page");
  assert.equal(p.tag, "crest");
  assert.equal(p.proj, "switchboard");
  assert.equal(p.status, "doing");
  assert.equal(p.id, "pr01");
  assert.equal(p.epic, "launch");
  assert.equal(p.prio, "high");
  assert.equal(p.due, "2026-08-15");
  assert.deepEqual(p.blockedBy, ["leg1", "leg2"]);
});

test("an unknown key:val (a URL) stays in the title, never eaten", () => {
  const p = parseBody("Read the spec at http://example.com/x note:later");
  assert.equal(p.title, "Read the spec at http://example.com/x note:later");
  assert.equal(p.status, null);
});

test("columnOf: done wins, blocked forces Blocked, else the status token, default todo", () => {
  const byId = { pr01: { done: false } };
  assert.equal(columnOf({ done: true, status: "doing", blockedBy: [] }, byId), "done");
  assert.equal(columnOf({ done: false, status: "todo", blockedBy: ["pr01"] }, byId), "blocked"); // open blocker
  assert.equal(columnOf({ done: false, status: "blocked", blockedBy: [] }, byId), "blocked");
  assert.equal(columnOf({ done: false, status: "review", blockedBy: [] }, byId), "review");
  assert.equal(columnOf({ done: false, status: null, blockedBy: [] }, byId), "todo");
  // a blocker that's DONE no longer blocks
  assert.equal(columnOf({ done: false, status: "todo", blockedBy: ["pr01"] }, { pr01: { done: true } }), "todo");
});

test("backlog is parked: it beats blocked, and bank_next_task never pulls from it", () => {
  const byId = { pr01: { done: false } };
  // parked even with an open blocker — a backlog card is not "blocked", it's just not released yet
  assert.equal(columnOf({ done: false, status: "backlog", blockedBy: ["pr01"] }, byId), "backlog");
  // promote backlog→todo: now the open blocker takes over and it lands in Blocked (not yet pickable)
  assert.equal(columnOf({ done: false, status: "todo", blockedBy: ["pr01"] }, byId), "blocked");
  // clear the blocker → it becomes a real pickable Todo
  assert.equal(columnOf({ done: false, status: "todo", blockedBy: ["pr01"] }, { pr01: { done: true } }), "todo");

  // the pickup filter (col === "todo") skips backlog entirely
  let doc = "";
  doc = addTask("Someday idea", { list: "P", status: "backlog", id: "bl01" }, doc).doc;
  doc = addTask("Do this now", { list: "P", id: "td02" }, doc).doc;
  const pickable = parseTasks(doc).filter((t) => t.col === "todo").map((t) => t.id);
  assert.deepEqual(pickable, ["td02"], "backlog card bl01 is not offered to agents");
  // user promotes the backlog card → now it's pickable
  doc = setStatus("bl01", "todo", doc).doc;
  assert.deepEqual(parseTasks(doc).filter((t) => t.col === "todo").map((t) => t.id).sort(), ["bl01", "td02"]);
});

test("parseTasks resolves cols and attaches indented detail + nested subtasks", () => {
  const doc = [
    "## Launch",
    "- [ ] Ship pricing @crest status:doing id:pr01 epic:launch",
    "  Detail: three tiers, monthly/annual toggle",
    "  - [ ] Wire Paddle checkout",
    "- [ ] Legal OK id:leg1 epic:launch blocked:pr01",
  ].join("\n");
  const t = parseTasks(doc, "tasks.md");
  assert.equal(t.length, 2, "nested subtask is not a top-level task");
  assert.equal(t[0].title, "Ship pricing");
  assert.equal(t[0].col, "doing");
  assert.equal(t[0].detail.length, 2);
  assert.equal(t[0].detail[0].text, "Detail: three tiers, monthly/annual toggle");
  assert.equal(t[0].detail[1].sub, true);
  assert.equal(t[0].detail[1].text, "Wire Paddle checkout");
  assert.equal(t[1].col, "blocked", "blocked:pr01 (pr01 open) → Blocked");
});

test("addTask can fold status/epic/prio/id/date-due into the line; friendly due stays '— by'", () => {
  const rich = addTask("Ship pricing", { list: "Launch", status: "doing", epic: "launch", prio: "high", id: "pr01", due: "2026-08-15" }).doc;
  assert.match(rich, /- \[ \] Ship pricing status:doing epic:launch prio:high id:pr01 due:2026-08-15/);
  const soft = addTask("Send deck", { list: "L", due: "Fri" }).doc;
  assert.match(soft, /- \[ \] Send deck — by Fri/);
});

test("dedupe ignores dialect tokens (re-adding a spec'd task is a dupe)", () => {
  let doc = addTask("Ship pricing", { list: "Launch", status: "doing", id: "pr01" }).doc;
  const r = addTask("Ship pricing", { list: "Launch" }, doc);
  assert.equal(r.added, false);
  assert.equal(r.reason, "duplicate");
});

test("setStatus by id rewrites only the status token, preserving the rest of the line", () => {
  const doc = "## L\n- [ ] Ship pricing @crest id:pr01 epic:launch\n- [ ] Other id:x2\n";
  const r = setStatus("pr01", "review", doc);
  assert.equal(r.changed, true);
  assert.match(r.doc, /- \[ \] Ship pricing @crest id:pr01 epic:launch status:review/);
  assert.match(r.doc, /- \[ \] Other id:x2/);   // untouched
});

test("setStatus done flips the checkbox and drops the status token; todo drops it too", () => {
  let doc = "## L\n- [ ] Ship pricing status:doing id:pr01\n";
  doc = setStatus("pr01", "done", doc).doc;
  assert.match(doc, /- \[x\] Ship pricing id:pr01/);
  assert.doesNotMatch(doc, /status:/);
  doc = "## L\n- [ ] Ship pricing status:doing id:pr01\n";
  doc = setStatus("pr01", "todo", doc).doc;
  assert.match(doc, /- \[ \] Ship pricing id:pr01/);
  assert.doesNotMatch(doc, /status:/);
});

test("assignIds gives every task a unique id and is idempotent", () => {
  const doc = "## L\n- [ ] A\n- [ ] B id:keepme\n- [x] C\n";
  const r = assignIds(doc);
  assert.equal(r.assigned, 2);
  const ids = parseTasks(r.doc).map((t) => t.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.includes("keepme"));
  assert.equal(assignIds(r.doc).assigned, 0);   // idempotent
});

// ── the connector pickup flow, end to end (what bank_next_task drives) ────────────────────────────────
test("spec a dump → board → pick up the top unblocked todo → claim → done", () => {
  // A spec-out writes cards with ids, epics, priorities, blockers, and detail.
  let doc = "";
  doc = addTask("Ship pricing page", { list: "Switchboard", epic: "launch", prio: "high", id: "pr01", detail: ["Three tiers + Paddle checkout", "- [ ] Wire checkout"] }, doc).doc;
  doc = addTask("Write launch post", { list: "Switchboard", epic: "launch", prio: "low", id: "wp02" }, doc).doc;
  doc = addTask("Legal OK on copy", { list: "Switchboard", epic: "launch", id: "leg3" }, doc).doc;
  // leg3 blocks pr01 by hand-edit (a blocker the spec-out would emit):
  doc = doc.replace("id:pr01", "id:pr01 blocked:leg3");

  const board = parseTasks(doc, "tasks.md");
  const cols = Object.fromEntries(board.map((t) => [t.id, t.col]));
  assert.equal(cols.pr01, "blocked", "pr01 waits on open leg3");
  assert.equal(cols.leg3, "todo");
  assert.equal(cols.wp02, "todo");

  // bank_next_task: candidates = todo column only (pr01 is blocked, so excluded), highest prio first.
  const candidates = parseTasks(doc, "tasks.md").filter((t) => t.col === "todo");
  const rank = { high: 0, med: 1, low: 2 };
  candidates.sort((a, b) => (rank[a.prio] ?? 1) - (rank[b.prio] ?? 1));
  assert.deepEqual(candidates.map((t) => t.id), ["leg3", "wp02"], "blocked pr01 is not offered; leg3 (no prio=med) beats wp02 (low)");

  // Claim leg3 → doing.
  doc = setStatus("leg3", "doing", doc).doc;
  assert.equal(parseTasks(doc).find((t) => t.id === "leg3").col, "doing");

  // Finish leg3 → done. Now pr01 unblocks and becomes the top todo.
  doc = setStatus("leg3", "done", doc).doc;
  const after = parseTasks(doc);
  assert.equal(after.find((t) => t.id === "leg3").done, true);
  assert.equal(after.find((t) => t.id === "pr01").col, "todo", "blocker done → pr01 no longer blocked");
  // pr01's detail + subtask survived every rewrite.
  const pr01 = after.find((t) => t.id === "pr01");
  assert.ok(pr01.detail.some((d) => d.text.includes("Paddle")));
  assert.ok(pr01.detail.some((d) => d.sub && d.text === "Wire checkout"));
});

test("arrangeBoard folds a conservative near-dup with a legible trail (never a silent delete)", () => {
  const board = [
    "# Tasks", "", "## Launch",
    "- [ ] Ship the pricing page epic:launch prio:med status:todo",
    "  Detail: three tiers.",
    "- [ ] Ship pricing page for launch epic:launch prio:high status:todo",
    "  extra: annual toggle.", "",
  ].join("\n");
  const r = arrangeBoard(board, { today: "2026-08-24" });
  assert.equal(r.merges.length, 1, "one near-dup folded");
  assert.equal(parseTasks(r.doc).length, 1, "two cards became one");
  assert.match(r.doc, /↳ merged \(2026-08-24\)/, "the fold leaves an on-card trail");
  assert.match(r.doc, /annual toggle/, "the folded card's detail is preserved (non-lossy)");
});

test("arrangeBoard never merges two DIFFERENT epics, and never a done card", () => {
  const board = [
    "# Tasks", "", "## L",
    "- [ ] Ship the pricing page epic:launch status:todo",
    "- [ ] Ship the pricing page epic:billing status:todo",   // same words, different epic
    "- [x] Ship the pricing page epic:launch",                // done — historical, untouchable
  ].join("\n");
  const r = arrangeBoard(board, { today: "2026-08-24" });
  assert.equal(r.merges.length, 0, "distinct epics + done card are left alone");
  assert.equal(parseTasks(r.doc).length, 3);
});

test("arrangeBoard regroups by epic and orders by status, done sinking to the bottom", () => {
  const board = [
    "# Tasks", "", "## Work",
    "- [ ] alpha todo epic:alpha status:todo",         // alpha appears first ⇒ its group leads
    "- [ ] beta task epic:beta status:todo",
    "- [ ] alpha doing epic:alpha status:doing",
    "- [x] alpha finished epic:alpha", "",
  ].join("\n");
  const r = arrangeBoard(board, { regroup: true, dedupe: false });
  const order = parseTasks(r.doc).map((t) => t.title);
  assert.equal(order[0], "alpha doing", "same-epic cards cluster (first-seen epic leads); doing leads its group");
  assert.equal(order[order.length - 1], "alpha finished", "the done card sinks to the bottom");
});

test("arrangeBoard leaves a section with loose prose between cards byte-for-byte untouched", () => {
  const board = [
    "# Tasks", "", "## Notes",
    "- [ ] keep me",
    "prose that sits between cards",
    "- [ ] and me too", "",
  ].join("\n");
  const r = arrangeBoard(board, { today: "2026-08-24" });
  assert.equal(r.sectionsSkipped, 1, "the unsafe section is reported skipped");
  assert.match(r.doc, /prose that sits between cards/);
  assert.match(r.doc, /- \[ \] keep me\nprose that sits between cards\n- \[ \] and me too/);
});

test("arrangeBoard parks a stale past-due todo (with a trail) only when given today", () => {
  const board = ["# Tasks", "", "## L", "- [ ] old thing status:todo due:2026-01-01", ""].join("\n");
  assert.equal(arrangeBoard(board).parked.length, 0, "no `today` ⇒ parking is skipped");
  const r = arrangeBoard(board, { today: "2026-08-24", parkStaleDays: 30 });
  assert.equal(r.parked.length, 1);
  assert.equal(parseTasks(r.doc).find((t) => /old thing/.test(t.title)).col, "backlog");
  assert.match(r.doc, /↳ parked \(2026-08-24\)/);
});

test("arrangeBoard is idempotent — a second pass is a no-op", () => {
  const board = [
    "# Tasks", "", "## L",
    "- [ ] Ship the pricing page epic:launch prio:med status:todo",
    "- [ ] Ship pricing page for launch epic:launch prio:high status:todo",
    "- [ ] lone task epic:other status:doing", "",
  ].join("\n");
  const once = arrangeBoard(board, { today: "2026-08-24" });
  const twice = arrangeBoard(once.doc, { today: "2026-08-24" });
  assert.equal(twice.changed, false, "nothing left to tidy");
  assert.equal(twice.doc, once.doc);
});

console.log(`\n${n} pure-logic tests passed.`);
