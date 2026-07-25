// SCOPE LINT — does each wrapp DECLARE what it actually calls?
//
// Why this exists rather than a harness fix: the mock's grant is fabricated from an empty scope and
// its responder ignores grants entirely, so the test suite cannot see a scope mistake at all. The
// expensive fix is seeding real grants per wrapp; this is the cheap 80% — a static read of each
// wrapp's own source, at build time instead of test time.
//
// It is deliberately conservative. The gate is default-deny and enforced daemon-side, so a scope
// bug already fails loudly on the developer's first real run; this just moves the discovery earlier.
// A finding here is "you will be denied in production", never a security claim.
//
// Run: node scope-lint.mjs   (exits 1 on any finding)
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "src");

/** Tools a wrapp actually reaches for, and how to spot each in source. */
const NEEDS = [
  { tool: "mcp__claude_ai_Higgsfield__*", label: "Higgsfield",
    // the agentic image dance — but ONLY when genImage is really invoked, not merely defined by
    // the template (several wrapps carry the helper and never call it; that is dead code, not a bug)
    used: (s) => /Higgsfield generate_image|generate_image tool/.test(s) && callCount(s, "genImage") > 0,
    declared: (scope) => /HIGGSFIELD|Higgsfield/.test(scope) },
  { tool: "WebSearch", label: "WebSearch",
    used: (s) => /["']WebSearch["']|\bWebSearch\b/.test(stripScope(s)),
    declared: (scope) => /WebSearch/.test(scope) },
  { tool: "WebFetch", label: "WebFetch",
    used: (s) => /["']WebFetch["']|\bWebFetch\b/.test(stripScope(s)),
    declared: (scope) => /WebFetch/.test(scope) },
];

const callCount = (s, fn) => (s.match(new RegExp(`(?<!function\\s)\\b${fn}\\s*\\(`, "g")) || []).length;
const scopeOf = (s) => (s.match(/scope:\s*\{[\s\S]*?\n\s*\}/) || [""])[0];
const stripScope = (s) => s.replace(/scope:\s*\{[\s\S]*?\n\s*\}/, ""); // don't count the declaration as a use
const modelsOf = (s) => [...scopeOf(s).matchAll(/models:\s*\[([^\]]*)\]/g)].flatMap((m) =>
  [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
const modelsCalled = (s) => [...stripScope(s).matchAll(/model:\s*["']([^"']+)["']/g)].map((m) => m[1]);

const files = readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
const findings = [];

for (const f of files) {
  const s = readFileSync(join(SRC, f), "utf8");
  if (!/scope:\s*\{/.test(s)) continue;          // not a wrapp entry (kit module, data file)
  const scope = scopeOf(s);
  const id = f.replace(/\.js$/, "");

  for (const n of NEEDS) {
    if (n.used(s) && !n.declared(scope)) {
      findings.push(`${id}: calls ${n.label} but does not declare it — the gate will DENY this in production`);
    }
  }
  // exact-match model grants: calling a model you didn't declare is denied (a documented gotcha)
  const declared = modelsOf(s);
  for (const m of new Set(modelsCalled(s))) {
    if (declared.length && !declared.includes(m)) {
      findings.push(`${id}: calls model "${m}" but declares [${declared.join(", ")}] — grants are exact-match`);
    }
  }
  // the reverse is only ever noise, so it is a note rather than a failure
  if (/tools:\s*\[\s*\]/.test(scope) && callCount(s, "genImage") > 0) {
    findings.push(`${id}: declares no tools yet calls genImage()`);
  }
}

if (findings.length) {
  console.error(`\n✗ scope-lint — ${findings.length} finding${findings.length === 1 ? "" : "s"}:\n`);
  for (const x of findings) console.error("  " + x);
  console.error("");
  process.exit(1);
}
console.error(`✓ scope-lint — ${files.length} sources checked, every declared scope covers what it calls`);
