#!/usr/bin/env node
// GUIDE-RESUME — relaunch a guided notch run from the step it was abandoned on.
//
// The problem (founder, 2026-08-19): a guided run gets abandoned (esc), or its card is knocked off the
// notch by a concurrent session (two sessions share the single ~/.relay/guide-run.json slot, and
// guide-result.json gets clobbered — see the [[fetch]] recovery skill). Re-firing the WHOLE run makes
// the human redo the steps they already passed. Resume should pick up at the first not-yet-passed step.
//
// This module is the RESUME PRIMITIVE — pure enough to unit-test, and the exact logic a native notch
// "Resume (N left)" chip should call (docs/GUIDE-QUEUE-RESUME.md). It reads the DURABLE, append-only
// log (~/.relay/guide-history.jsonl, never clobbered) — not guide-result.json (which is) — so it works
// even after the run's live result was overwritten by another session.
//
//   node scripts/guide-resume.mjs            # resume the most recent incomplete run
//   node scripts/guide-resume.mjs --dry      # print what it WOULD resume, write nothing
//   node scripts/guide-resume.mjs --list     # list resumable runs from the log
//   node scripts/guide-resume.mjs --run <id> # resume a specific runId
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RELAY = join(homedir(), ".relay");
const HISTORY = join(RELAY, "guide-history.jsonl");
const RUN = join(RELAY, "guide-run.json");
const ARCHIVE = join(RELAY, "guide-runs");   // optional full-fidelity archive keyed by runId (native, future)

// ── pure core (unit-tested) ──────────────────────────────────────────────────────────────────

/** Parse the append-only JSONL into run objects, newest last. Tolerates blank/broken lines. */
export function parseHistory(text) {
  return String(text || "").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** A run is RESUMABLE only when the human ABANDONED it (esc) with steps still undone. A `completed`
 *  run ran to its end — the human chose to finish, even if some steps were skipped — so it is NOT
 *  resumed (this is also what keeps single-step ask/decision cards, which complete with a chosenOption
 *  rather than a 'pass', out of the resume list). Re-run a completed run fresh if you want it again. */
export function isResumable(run) {
  if (!run || run.outcome !== "aborted" || !Array.isArray(run.results)) return false;
  return run.results.some((s) => s.verdict !== "pass");
}

/** The steps still to do = from the FIRST non-'pass' step to the end (preserving order), so a run
 *  abandoned midway continues where it stopped and a 'fail' step is retried rather than skipped. */
export function remainingSteps(run) {
  const r = run.results || [];
  const first = r.findIndex((s) => s.verdict !== "pass");
  if (first < 0) return [];
  return r.slice(first).map((s) => ({ id: s.id, text: s.text }));
}

/** Pick the run to resume: an explicit runId, else the most recent resumable run in the log. */
export function pickRun(runs, runId) {
  const resumable = runs.filter(isResumable);
  if (runId) return resumable.reverse().find((r) => String(r.runId) === String(runId)) || null;
  return resumable.length ? resumable[resumable.length - 1] : null;
}

/** Build the new guide-run.json for a resume. If a full-fidelity archived run is supplied, its step
 *  objects (hint/say/point/doneWhen…) are carried through for the remaining ids — otherwise we resume
 *  with the text the log preserved. */
export function buildResumeRun(run, archived = null) {
  const remaining = remainingSteps(run);
  const passed = (run.results || []).length - remaining.length;
  let steps = remaining;
  if (archived && Array.isArray(archived.steps)) {
    const byId = new Map(archived.steps.map((s) => [s.id, s]));
    steps = remaining.map((s) => byId.get(s.id) || s);   // full step if we have it, else text-only
  }
  return {
    mode: run.mode || "test",
    title: `Resume: ${run.title || "guided run"} (${remaining.length} left)`,
    source: (archived && archived.source) || "Claude Code · resume",
    project: (archived && archived.project) || undefined,
    resumeOf: run.runId,
    resumedPast: passed,
    steps,
  };
}

// ── side-effecting shell (not imported by the test) ──────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

  if (!existsSync(HISTORY)) { console.error(`no history at ${HISTORY} — nothing to resume`); process.exit(2); }
  const runs = parseHistory(readFileSync(HISTORY, "utf8"));

  if (flag("--list")) {
    const rs = runs.filter(isResumable);
    if (!rs.length) return console.error("no resumable runs.");
    for (const r of rs.slice(-10)) {
      const rem = remainingSteps(r).length;
      console.error(`  ${r.runId}  ${r.outcome.padEnd(9)} ${r.passed}/${r.total} done · ${rem} left  — ${r.title}`);
    }
    return;
  }

  const run = pickRun(runs, val("--run"));
  if (!run) { console.error("no resumable run found (everything completed)."); process.exit(1); }

  // full-fidelity archive, if the native app wrote one for this runId
  let archived = null;
  const arch = join(ARCHIVE, `${run.runId}.json`);
  if (existsSync(arch)) { try { archived = JSON.parse(readFileSync(arch, "utf8")); } catch { /* text-only */ } }

  const resume = buildResumeRun(run, archived);
  if (!resume.steps.length) { console.error("nothing left to resume — the run is complete."); process.exit(0); }

  console.error(`Resuming "${run.title}" — skipping ${resume.resumedPast} passed step(s), ${resume.steps.length} to go:`);
  for (const s of resume.steps) console.error(`   · ${s.id}: ${s.text}`);

  if (flag("--dry")) { console.error("\n(--dry: no card written)"); return; }
  writeFileSync(RUN, JSON.stringify(resume, null, 2) + "\n");
  console.error(`\n✓ wrote ${RUN} — the card is now on the notch (resumed from step "${resume.steps[0].id}").`);
}

// only run main when invoked directly (not when imported by the test)
if (import.meta.url === `file://${process.argv[1]}`) main();
