#!/usr/bin/env node
// install-skills.mjs — the FALLBACK operator-loop installer for Switchboard.
//
// The PRIMARY path is the Claude Code plugin (see docs/INSTALL-SKILLS.md):
//   /plugin marketplace add sameeeeeeep/switchboard
//   /plugin install switchboard@switchboard
//
// This script is the no-plugin fallback. It copies the five operator skills
// from <repo>/.claude/skills/<name>/ into ~/.claude/skills/<name>/ and prints
// (optionally runs) the one command that wires the task-board connector.
//
// Zero dependencies. Node 20+. Safe + idempotent: an existing target skill dir
// is NEVER clobbered silently — it is skipped unless you pass --force.
//
// Usage:
//   node scripts/install-skills.mjs                 copy skills to ~/.claude/skills
//   node scripts/install-skills.mjs --connector     also run `claude mcp add switchboard …`
//   node scripts/install-skills.mjs --dry-run       print what WOULD happen, touch nothing
//   node scripts/install-skills.mjs --force          overwrite skill dirs that already exist
//   node scripts/install-skills.mjs --target <dir>  install into <dir> instead of ~/.claude/skills
//   node scripts/install-skills.mjs --help

import { existsSync, mkdirSync, readdirSync, statSync, cpSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_SRC = join(REPO_ROOT, ".claude", "skills");
const CONNECTOR = join(REPO_ROOT, "packages", "switchboard-mcp", "switchboard-mcp.mjs");

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
function hasFlag(name) { return argv.includes(name); }
function flagVal(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`install-skills.mjs — fallback operator-loop installer for Switchboard

  node scripts/install-skills.mjs [options]

  --connector       after copying skills, run: claude mcp add switchboard -s user -- <node> <connector> mcp
  --dry-run         print what would be copied; touch nothing
  --force           overwrite skill dirs that already exist in the target (default: skip them)
  --target <dir>    install into <dir> instead of ~/.claude/skills
  --help, -h        show this message
`);
  process.exit(0);
}

const DRY = hasFlag("--dry-run");
const FORCE = hasFlag("--force");
const RUN_CONNECTOR = hasFlag("--connector");
const TARGET_DIR = resolve(flagVal("--target") || join(homedir(), ".claude", "skills"));

const NODE_BIN = process.execPath; // absolute path to the node running this script

// ---- helpers ----------------------------------------------------------------
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

// A skill is a subdirectory of SKILLS_SRC that contains a SKILL.md file.
function discoverSkills() {
  if (!isDir(SKILLS_SRC)) {
    console.error(`error: skills source not found: ${SKILLS_SRC}`);
    process.exit(1);
  }
  return readdirSync(SKILLS_SRC)
    .filter((name) => !name.startsWith("."))
    .filter((name) => isDir(join(SKILLS_SRC, name)))
    .filter((name) => existsSync(join(SKILLS_SRC, name, "SKILL.md")))
    .sort();
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (isDir(p)) n += countFiles(p);
    else n += 1;
  }
  return n;
}

// ---- run --------------------------------------------------------------------
const skills = discoverSkills();

console.log("Switchboard skill installer (fallback)");
console.log(`  source : ${SKILLS_SRC}`);
console.log(`  target : ${TARGET_DIR}${DRY ? "  (dry-run — nothing will be written)" : ""}`);
console.log(`  skills : ${skills.length} found — ${skills.join(", ")}`);
console.log("");

if (!DRY && !existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
}

const installed = [];
const skipped = [];
const overwritten = [];

for (const name of skills) {
  const src = join(SKILLS_SRC, name);
  const dst = join(TARGET_DIR, name);
  const nFiles = countFiles(src);
  const exists = existsSync(dst);

  if (exists && !FORCE) {
    skipped.push(name);
    console.log(`  = skip   ${name}  (already exists — pass --force to overwrite)`);
    continue;
  }

  if (DRY) {
    console.log(`  + copy   ${name}  (${nFiles} file${nFiles === 1 ? "" : "s"})${exists ? "  [would overwrite]" : ""}`);
    (exists ? overwritten : installed).push(name);
    continue;
  }

  if (exists && FORCE) {
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    overwritten.push(name);
    console.log(`  ↻ force  ${name}  (${nFiles} file${nFiles === 1 ? "" : "s"}, overwritten)`);
  } else {
    cpSync(src, dst, { recursive: true });
    installed.push(name);
    console.log(`  + copy   ${name}  (${nFiles} file${nFiles === 1 ? "" : "s"})`);
  }
}

// ---- connector --------------------------------------------------------------
if (!existsSync(CONNECTOR)) {
  console.log("");
  console.log(`warning: connector not found at ${CONNECTOR}`);
}
const connectorArgs = ["mcp", "add", "switchboard", "-s", "user", "--", NODE_BIN, CONNECTOR, "mcp"];
const connectorCmd = `claude ${connectorArgs.join(" ")}`;

console.log("");
console.log("Connector (task board):");
console.log(`  ${connectorCmd}`);

let connectorRan = false;
if (RUN_CONNECTOR) {
  if (DRY) {
    console.log("  (--dry-run: not executing)");
  } else {
    try {
      execFileSync("claude", connectorArgs, { stdio: "inherit" });
      connectorRan = true;
      console.log("  ✓ connector registered");
    } catch (err) {
      console.log(`  ✗ could not run connector command: ${err.message}`);
      console.log("    Run the command above by hand once `claude` is on your PATH.");
    }
  }
}

// ---- summary ----------------------------------------------------------------
console.log("");
console.log("Summary");
console.log(`  installed  : ${installed.length ? installed.join(", ") : "(none)"}`);
if (overwritten.length) console.log(`  overwritten: ${overwritten.join(", ")}`);
console.log(`  skipped    : ${skipped.length ? skipped.join(", ") : "(none)"}`);
console.log(`  connector  : ${RUN_CONNECTOR ? (connectorRan ? "registered" : (DRY ? "printed (dry-run)" : "not registered — run the command above")) : "printed above (re-run with --connector to register)"}`);
if (DRY) console.log("  (dry-run — no files were written)");
console.log("");
if (!DRY && (installed.length || overwritten.length)) {
  console.log("Next: open a Claude Code session in any folder and ask it to check your board —");
  console.log('the operator loop is live once `switchboard_next_task` returns your cards.');
}
