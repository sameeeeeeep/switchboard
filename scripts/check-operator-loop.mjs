#!/usr/bin/env node
// check-operator-loop.mjs — read-only health probe for Switchboard's operator loop.
//
// The operator loop = app + connector + skills: a Claude Code session that reads the
// user's board, picks up a task, and runs the wrapps to clear it. A fresh install ships
// the app but a half-wired connector and zero skills, so this script reports the two
// readiness rungs that decide whether the loop can close (§6 of docs/STATES.md), plus the
// vault they operate on.
//
// It ONLY READS ~/.claude.json and ~/.claude/skills — it never modifies Claude Code's
// config. Zero dependencies; Node 20+. Always exits 0 (a report, not a gate).

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";

const HOME = homedir();
const CLAUDE_JSON = join(HOME, ".claude.json");
const SKILLS_DIR = join(HOME, ".claude", "skills");
const REQUIRED_SKILLS = ["adhd-pm", "spec", "switchboard", "wrapp", "task"];
const DEFAULT_VAULT = join(HOME, "SwitchboardBrain");

// ── tiny formatting helpers ────────────────────────────────────────────────
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (supportsColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => paint("32", s);
const red = (s) => paint("31", s);
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);
const CHECK = () => green("✓"); // ✓
const CROSS = () => red("✗"); //  ✗

function line(ok, label, detail) {
  const mark = ok ? CHECK() : CROSS();
  const tail = detail ? "  " + dim(detail) : "";
  console.log(`  ${mark} ${label}${tail}`);
}

// ── rung 7: the switchboard MCP connector ──────────────────────────────────
// The CLI can register it at user scope (mcpServers.switchboard) or project scope
// (projects[<dir>].mcpServers.switchboard, how `-s project` records it). Accept either.
function checkConnector() {
  if (!existsSync(CLAUDE_JSON)) {
    return { ok: false, detail: `no ${CLAUDE_JSON} — Claude Code not set up here` };
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CLAUDE_JSON, "utf8"));
  } catch (e) {
    return { ok: false, detail: `couldn't parse ~/.claude.json (${e.message})` };
  }

  const found = [];
  if (cfg.mcpServers && cfg.mcpServers.switchboard) {
    found.push({ scope: "user", entry: cfg.mcpServers.switchboard });
  }
  for (const [dir, proj] of Object.entries(cfg.projects || {})) {
    if (proj && proj.mcpServers && proj.mcpServers.switchboard) {
      found.push({ scope: `project ${dir}`, entry: proj.mcpServers.switchboard });
    }
  }

  if (found.length === 0) {
    return {
      ok: false,
      detail: "no `switchboard` MCP registered — run: claude mcp add switchboard -s user -- <node> <path>/switchboard-mcp.mjs mcp",
    };
  }

  // Report the vault the connector points at (explicit --vault, else the default).
  const { scope, entry } = found[0];
  const args = Array.isArray(entry.args) ? entry.args : [];
  const vi = args.indexOf("--vault");
  const vault = vi !== -1 && args[vi + 1] ? args[vi + 1] : null;
  const scopeNote = found.length > 1 ? `${scope} (+${found.length - 1} more)` : scope;
  const vaultNote = vault
    ? `--vault ${vault}`
    : `no --vault flag, relies on ~/SwitchboardBrain default`;
  return { ok: true, detail: `${scopeNote}; ${vaultNote}`, vault: vault || DEFAULT_VAULT };
}

// ── rung 8: the five operator skills ────────────────────────────────────────
function checkSkills() {
  const present = [];
  const missing = [];
  for (const name of REQUIRED_SKILLS) {
    const skillMd = join(SKILLS_DIR, name, "SKILL.md");
    (existsSync(skillMd) ? present : missing).push(name);
  }
  const ok = missing.length === 0;
  const detail = ok
    ? `all 5 present: ${present.join(", ")}`
    : `${present.length} of 5 — missing: ${missing.join(", ")}`;
  return { ok, detail, present, missing };
}

// ── the vault the loop operates on ──────────────────────────────────────────
function checkVault(connectorVault) {
  const vault = process.env.SWITCHBOARD_VAULT || connectorVault || DEFAULT_VAULT;
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    return { ok: false, detail: `${vault} — not found` };
  }
  const tasks = join(vault, "tasks.md");
  if (!existsSync(tasks)) {
    return { ok: false, detail: `${vault} exists, but no tasks.md — the board is empty` };
  }
  return { ok: true, detail: `${vault} (has tasks.md)` };
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(bold("\nSwitchboard operator loop — health check"));
console.log(dim("  app + connector + skills → a Claude Code session that runs your board\n"));

const connector = checkConnector();
line(connector.ok, "connector  (switchboard MCP in Claude Code)", connector.detail);

const skills = checkSkills();
line(skills.ok, "skills     (5 operator skills in ~/.claude/skills)", skills.detail);

const vault = checkVault(connector.vault);
line(vault.ok, "vault      (board the loop operates on)", vault.detail);

// One-line verdict. Connector + skills are what gate the loop; vault is a warning.
const missing = [];
if (!connector.ok) missing.push("connector");
if (!skills.ok) missing.push("skills");
if (!vault.ok) missing.push("vault");

console.log("");
if (missing.length === 0) {
  console.log("  " + bold(green("operator loop: ready")));
} else {
  console.log("  " + bold(red(`operator loop: missing ${missing.join(", ")}`)));
}
console.log("");

process.exit(0);
