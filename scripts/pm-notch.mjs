#!/usr/bin/env node
// PM-NOTCH — surface an adhd-pm event at the notch (docs/PM-NOTCH-OPERATOR.md).
//
// The notch already renders ~/.relay/guide-notify.json as a brief ack toast (the /task "captured" flow).
// This makes that callable for EVERY PM event, from ANY Claude thread, so adhd-pm mode is felt working
// visibly — not just /task. It writes the notify file the app watches; if the app is down (or there's no
// ~/.relay), it's a silent no-op that never blocks the thread.
//
//   node scripts/pm-notch.mjs <kind> "<text>" [--source "..."] [--project "..."] [--ttl 3]
//     kind ∈ captured · picked · decided · spec · thread · info · resume
//
// e.g.  node scripts/pm-notch.mjs picked "seed launcher keywords"
//       node scripts/pm-notch.mjs decided "harvest contrast first"
//       node scripts/pm-notch.mjs spec "board tidied — 3 merged, 2 refiled"
import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The kinds an adhd-pm event can be. The native notifyCard maps each to a kicker + accent; unknown kinds
// fall back to `info`, so a new kind added here degrades gracefully on an older app.
export const KINDS = new Set(["captured", "picked", "decided", "spec", "thread", "info", "resume"]);

/** Build the notify object the app reads. Pure — unit-testable without touching disk. */
export function buildNotify({ kind, text, source, project, action, actionLabel, ttl }) {
  const k = KINDS.has(kind) ? kind : "info";
  const obj = { text: String(text || "").trim(), kind: k, source: source || "Claude Code · adhd-pm" };
  if (project) obj.project = project;
  if (action) { obj.action = action; obj.actionLabel = actionLabel || "Open"; }
  obj.ttl = Number.isFinite(+ttl) ? +ttl : (action ? 8 : 3);
  return obj;
}

/** Fire the ack (best-effort). Returns true if written, false on a silent no-op. */
export function fire(opts) {
  const obj = buildNotify(opts);
  if (!obj.text) return false;
  try {
    const dir = join(homedir(), ".relay");
    if (!existsSync(dir)) return false;                 // not a Switchboard machine → no-op
    writeFileSync(join(dir, "guide-notify.json"), JSON.stringify(obj));
    return true;
  } catch { return false; }                             // a toast is never worth failing a thread over
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  const kind = positional[0];
  const text = positional[1];
  if (!kind || !text) {
    console.error('usage: pm-notch <kind> "<text>" [--source ..] [--project ..] [--ttl N]');
    console.error("  kind ∈ " + [...KINDS].join(" · "));
    process.exit(2);
  }
  const ok = fire({ kind, text, source: flag("--source"), project: flag("--project"),
                    action: flag("--action"), actionLabel: flag("--actionLabel"), ttl: flag("--ttl") });
  console.error(ok ? `notch ← ${kind}: ${text}` : "(no notch — app/dir absent; no-op)");
}
if (import.meta.url === `file://${process.argv[1]}`) main();
