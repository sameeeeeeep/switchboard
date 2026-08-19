// North-star meter — REAL numbers from the existing local audit log. Read-only. No daemon changes,
// no consent-path touching, no content read (the log only holds method/origin/ts/outcome — never a
// prompt or a payload). This is the on-device half of the north-star meter, wired to real data.
//
// Run:  node docs/operating/bank/meter/audit-runs.mjs
//
// A "wrapp run" = a real model invocation on the visitor's Claude: claude_complete | claude_stream.
// Honest scope: this counts THIS instance's runs (the machine's own audit log) — real, but one
// install, mostly local/dev origins. Aggregate-across-installs needs the opt-in floored beacon (gated).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyState, ingest, weekly, isoWeek } from "./weekly-counter.mjs";

const RUN_METHODS = new Set(["claude_complete", "claude_stream"]);
const logPath = join(homedir(), ".relay", "audit.log");

let raw;
try { raw = readFileSync(logPath, "utf8"); }
catch { console.error(`no audit log at ${logPath} — nothing to count`); process.exit(0); }

const state = emptyState();
let total = 0;
const origins = new Map();          // origin -> run count (for the "which wrapps" view)
for (const line of raw.split("\n")) {
  const s = line.trim(); if (!s) continue;
  let d; try { d = JSON.parse(s); } catch { continue; }
  if (!RUN_METHODS.has(d.method)) continue;
  if (typeof d.ts !== "number") continue;
  ingest(state, { ts: d.ts, wrappId: d.origin || "unknown" });
  origins.set(d.origin || "unknown", (origins.get(d.origin || "unknown") || 0) + 1);
  total++;
}

const weeks = weekly(state, "local-instance", { floorTo: 10 });
const topOrigins = [...origins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

console.log("# North-star meter — real, from ~/.relay/audit.log (this instance)\n");
console.log(`Total model runs logged: ${total}  (claude_complete + claude_stream)\n`);
console.log("## Weekly active wrapp-runs (floored ≥, honest lower bound)\n");
console.log("| ISO week | runs (≥) | distinct wrapps |");
console.log("|---|---|---|");
for (const w of weeks) console.log(`| ${w.week} | ≥ ${w.runsAtLeast} | ${w.wrappCount} |`);
console.log("\n## Where the runs came from (origins)\n");
console.log("| origin | runs |");
console.log("|---|---|");
for (const [o, n] of topOrigins) console.log(`| ${o} | ${n} |`);
console.log("\n_Scope: this machine only. Origins are mostly localhost (dev/harness) — real runs, not");
console.log("external users. Cross-install totals need the opt-in floored beacon (founder-gated)._");
