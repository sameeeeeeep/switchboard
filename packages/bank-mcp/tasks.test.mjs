// Pure-logic tests for the Bank connector's task transforms. Run: node tasks.test.mjs
import assert from "node:assert/strict";
import { addTask, completeTask, parseTasks } from "./tasks.mjs";

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

console.log(`\n${n} pure-logic tests passed.`);
