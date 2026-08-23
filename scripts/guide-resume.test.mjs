// Headless assertions for the resume primitive. node scripts/guide-resume.test.mjs
import { parseHistory, isResumable, remainingSteps, pickRun, buildResumeRun } from "./guide-resume.mjs";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

const abortedMidway = {
  runId: "100", title: "Test X", mode: "test", outcome: "aborted", passed: 3, total: 7,
  results: [
    { id: "a", text: "A", verdict: "pass" },
    { id: "b", text: "B", verdict: "pass" },
    { id: "c", text: "C", verdict: "pass" },
    { id: "d", text: "D", verdict: "skipped" },
    { id: "e", text: "E", verdict: "skipped" },
    { id: "f", text: "F", verdict: "skipped" },
    { id: "g", text: "G", verdict: "skipped" },
  ],
};
const completed = { runId: "101", title: "Done", outcome: "completed", passed: 2, total: 2,
  results: [{ id: "x", text: "X", verdict: "pass" }, { id: "y", text: "Y", verdict: "pass" }] };
// a single-step ask/decision card: it 'completed' (the human answered), verdict isn't 'pass' — must NOT resume
const askCard = { runId: "102", title: "Which one?", outcome: "completed", passed: 0, total: 1,
  results: [{ id: "pick", text: "Pick", verdict: "skipped" }] };
const abortedAsk = { runId: "103", title: "Aborted decision", outcome: "aborted", passed: 0, total: 1,
  results: [{ id: "d", text: "Decide", verdict: "skipped" }] };

console.log("\n── resumability (only ABANDONED runs) ───────────────────");
expect(isResumable(abortedMidway), "an aborted-midway test is resumable");
expect(!isResumable(completed), "a fully-passed run is NOT resumable");
expect(!isResumable(askCard), "a COMPLETED single-step ask card is NOT resumable (the human answered)");
expect(isResumable(abortedAsk), "an ABORTED run with an undone step is resumable");
expect(!isResumable({ outcome: "aborted", results: [] }), "an empty run is not resumable");

console.log("\n── remaining steps (from first non-pass to end) ─────────");
{ const rem = remainingSteps(abortedMidway);
  expect(rem.length === 4 && rem[0].id === "d" && rem[3].id === "g", "resumes d..g (the 4 undone), not a..c");
  expect(rem.every((s) => s.id && s.text), "each remaining step keeps id + text"); }
{ // an abort right after step a → resume b..g (b was the first non-pass)
  const rem = remainingSteps({ outcome: "aborted", results: [
    { id: "a", verdict: "pass", text: "A" }, { id: "b", verdict: "skipped", text: "B" }, { id: "c", verdict: "skipped", text: "C" }] });
  expect(rem.length === 2 && rem[0].id === "b", "resumes from the first undone step to the end"); }
expect(remainingSteps(completed).length === 0, "completed run → nothing remaining");

console.log("\n── pick the run ─────────────────────────────────────────");
const log = parseHistory([completed, askCard, abortedMidway].map((r) => JSON.stringify(r)).join("\n") + "\n");
expect(log.length === 3, "parseHistory reads 3 runs");
expect(pickRun(log).runId === "100", "no id → most recent ABORTED run (100), skipping the completed 101 + ask 102");
expect(pickRun(log, "100").runId === "100", "explicit runId picks that run");
expect(pickRun([completed, askCard]) === null, "history with no aborted runs → nothing to resume");
expect(parseHistory("garbage\n{bad}\n" + JSON.stringify(abortedMidway)).length === 1, "tolerates broken JSONL lines");

console.log("\n── build the resume card ────────────────────────────────");
{ const card = buildResumeRun(abortedMidway);
  expect(card.steps.length === 4, "card has the 4 remaining steps");
  expect(card.title === "Resume: Test X (4 left)", "title notes how many are left");
  expect(card.resumeOf === "100" && card.resumedPast === 3, "card records what it resumed and how many it skipped");
  expect(card.mode === "test", "carries the original mode"); }
{ // with a full-fidelity archive, remaining steps regain hint/point/etc.
  const archived = { source: "God", project: "SB", steps: [
    { id: "d", text: "D", hint: "the drop bar", point: { x: 1, y: 2 } },
    { id: "e", text: "E", say: "next" } ] };
  const card = buildResumeRun(abortedMidway, archived);
  expect(card.steps[0].hint === "the drop bar" && card.steps[0].point.x === 1, "archived step d regains hint + point");
  expect(card.source === "God" && card.project === "SB", "archive provenance carried through");
  expect(card.steps[2].id === "f" && !card.steps[2].hint, "a step missing from the archive falls back to text-only"); }

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
