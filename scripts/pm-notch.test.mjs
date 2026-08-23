// Headless assertions for the pm-notch payload builder. node scripts/pm-notch.test.mjs
import { buildNotify, KINDS } from "./pm-notch.mjs";

let fails = 0, checks = 0;
const expect = (ok, what) => { checks++; ok ? console.log("  ✓ " + what) : (fails++, console.log("  ✗ " + what)); };

console.log("\n── kinds + defaults ─────────────────────────────────────");
{ const n = buildNotify({ kind: "picked", text: "seed keywords" });
  expect(n.kind === "picked" && n.text === "seed keywords", "picked event round-trips");
  expect(n.source === "Claude Code · adhd-pm", "default source is the adhd-pm operator");
  expect(n.ttl === 3, "passive event defaults to a 3s ttl"); }
expect(buildNotify({ kind: "nonsense", text: "x" }).kind === "info", "unknown kind degrades to info (older app safe)");
expect(buildNotify({ kind: "decided", text: "  harvest first  " }).text === "harvest first", "text is trimmed");
{ const n = buildNotify({ kind: "resume", text: "Resume run", action: "resume", actionLabel: "Resume" });
  expect(n.action === "resume" && n.actionLabel === "Resume", "a tappable event carries action + label");
  expect(n.ttl === 8, "a tappable event lingers (8s) so it's catchable"); }
{ const n = buildNotify({ kind: "spec", text: "tidied", project: "Switchboard", ttl: 5 });
  expect(n.project === "Switchboard" && n.ttl === 5, "project + explicit ttl carried through"); }
expect([...KINDS].includes("captured") && [...KINDS].includes("thread"), "KINDS covers the PM event set");
// empty text is caught by fire(), but buildNotify still shapes it
expect(buildNotify({ kind: "info", text: "" }).text === "", "empty text builds (fire() rejects it)");

console.log(`\n${checks - fails}/${checks} passed` + (fails ? `  — ${fails} FAILED\n` : " ✓\n"));
process.exit(fails ? 1 : 0);
