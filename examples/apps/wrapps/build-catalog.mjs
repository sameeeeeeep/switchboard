#!/usr/bin/env node
// The INGESTION step (docs/WRAPP-STORE-MODAL.md §9): walk every wrapp's switchboard.json, validate it
// against the shared consistency rule, and emit ONE catalog.json — the single file the native store
// modal reads. Per-repo manifests are the source of truth; this only collects them. A malformed
// manifest fails the build LOUDLY (never a silently-dropped listing) — honesty is a design constraint.
//
// Worktree-correctness (the node_modules trap, see memory): we import the validator by RELATIVE PATH
// into THIS worktree's built protocol dist, never the bare `@relay/protocol` specifier — that resolves
// to the MAIN checkout and would validate against stale types. Build the protocol first:
//   (cd packages/protocol && npx tsc -p tsconfig.json)

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));           // examples/apps/wrapps
const ROOT = join(HERE, "..", "..", "..");                     // worktree root
const EXAMPLES = join(ROOT, "examples");
const PROTO = join(ROOT, "packages/protocol/dist/store.js");

if (!existsSync(PROTO)) {
  console.error(`✗ protocol not built at ${PROTO}\n  run: (cd packages/protocol && npx tsc -p tsconfig.json)`);
  process.exit(1);
}
const { validateListing } = await import(PROTO);

// Recursive walk for every switchboard.json under examples/ (Node 20 has no fs.globSync).
function findManifests(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) findManifests(p, out);
    else if (name === "switchboard.json") out.push(p);
  }
  return out;
}

const files = findManifests(EXAMPLES).sort();
const listings = [];
const problems = [];
const seen = new Map();
let runtimeOnly = 0;

for (const f of files) {
  let l;
  try { l = JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { problems.push(`${f}: not valid JSON — ${e.message}`); continue; }
  // `switchboard.json` is ALSO the scaffold/runner's runtime config (name/models/tools/storage).
  // A file is a STORE LISTING only if it declares surfaces; runtime-only configs are skipped, not
  // errors. (Unifying the two into one manifest is an open decision — see the note this run prints.)
  if (!Array.isArray(l.surfaces) || l.surfaces.length === 0) { runtimeOnly++; continue; }
  const errs = validateListing(l);
  if (errs.length) { problems.push(`${f} (${l.id || "?"}): ${errs.join("; ")}`); continue; }
  if (seen.has(l.id)) { problems.push(`${f}: duplicate id '${l.id}' (also ${seen.get(l.id)})`); continue; }
  seen.set(l.id, f);
  listings.push(l);
}

if (problems.length) {
  console.error(`✗ ${problems.length} bad manifest(s):`);
  for (const p of problems) console.error("   " + p);
  process.exit(1);
}

// Fold in the TOOL REGISTRY (wrapps/tools.json, harvested by build-tools.mjs from every exposeToGod).
// Each listing carries its God-callable commands (name + when + how) so God resolves a request to the
// RIGHT command with the RIGHT args — not just to a wrapp. The catalog id usually equals the source id;
// SRC_ALIAS covers the few where they differ (Prism's page/tool is imagegen). Swift's decoder ignores
// the extra `tools` key, so this stays backward-compatible with the strict SBListing decode.
const SRC_ALIAS = { prism: "imagegen", cast: "persona" };
// Refresh the registry from source first so the catalog never carries stale commands. execFileSync with
// an argument array (no shell) — the path is fixed, but this keeps it injection-proof by construction.
try { execFileSync(process.execPath, [join(HERE, "build-tools.mjs")], { stdio: "inherit" }); }
catch { console.error("  (build-tools.mjs failed — listings may carry stale/no commands)"); }
let toolReg = {};
try { toolReg = JSON.parse(readFileSync(join(HERE, "tools.json"), "utf8")); }
catch { console.error("  (no tools.json — run build-tools.mjs first; listings ship without commands)"); }
let toolsAttached = 0;
for (const l of listings) {
  const tools = toolReg[SRC_ALIAS[l.id] || l.id];
  if (tools && tools.length) { l.tools = tools; toolsAttached += tools.length; }
}

// Stable order: studios first, then the rest by category then name — a sensible default the modal
// can re-sort. No popularity/recency (no telemetry, by design).
const CAT_ORDER = { studio: 0, agent: 1, tool: 2, skill: 3, fun: 4 };
listings.sort((a, b) =>
  (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) || a.name.localeCompare(b.name));

const catalog = { version: 1, count: listings.length, listings };
const json = JSON.stringify(catalog, null, 2) + "\n";

// The committed copy (reviewable in the repo) + the live copy the running app reads.
const repoOut = join(HERE, "catalog.json");
writeFileSync(repoOut, json);
const relayDir = join(homedir(), ".relay");
try { mkdirSync(relayDir, { recursive: true }); writeFileSync(join(relayDir, "catalog.json"), json); } catch {}

console.log(`✓ ${listings.length} listings → ${repoOut}`);
console.log(`  tool registry: ${toolsAttached} commands attached across ${listings.filter((l) => l.tools).length} listings`);
console.log(`  also wrote ~/.relay/catalog.json (live)`);
console.log(`  surfaces: ${[...new Set(listings.flatMap((l) => l.surfaces))].sort().join(", ")}`);
if (runtimeOnly) console.log(`  (skipped ${runtimeOnly} runtime-only switchboard.json — no surfaces declared)`);
