#!/usr/bin/env node
// build-skill-prompts.mjs — harvest a canonical system prompt for each category:"skill" wrapp
// into wrapps/skill-prompts.json, so the generic skill-widget.html can run any of them.
//
// For each skill id we produce { name, tagline, system, placeholder }.
//   • name / tagline           ← wrapps/<id>/switchboard.json
//   • system (source of truth) ←
//        - if the wrapp has components.skills[] pointing at real .md skill bodies (gist, yc),
//          read those markdown bodies verbatim (frontmatter stripped) and join them.
//        - else extract the leading "You are …" instruction literal from src/<id>.js
//          (the same string the full page feeds relay.stream), resolving ${APP.name}.
//        - else a generic fallback derived from name + tagline.
//   • placeholder              ← a short example prompt, curated per-skill with a tagline fallback.
//
// Pure Node, ESM, no shell calls. Run:  node examples/apps/build-skill-prompts.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));   // examples/apps
const WRAPPS = join(HERE, "wrapps");
const SRC = join(HERE, "src");
const OUT = join(WRAPPS, "skill-prompts.json");

// The 33 skills (category:"skill") the notch launcher exposes.
const SKILL_IDS = [
  "actions", "caption", "clipfix", "coldemail", "commit", "compare", "cron",
  "docstring", "errslate", "explainthis", "extract", "formula", "gist", "hooks",
  "nameit", "objection", "outline", "polish", "recap", "regex", "rephrase",
  "reply", "repurpose", "shell", "snap", "spellout", "standup", "steps",
  "titles", "translate", "unjargon", "yc",
];

// Curated example prompts — highest quality since this ships to users. Falls back to tagline.
const PLACEHOLDERS = {
  actions: "Paste meeting notes or a transcript…",
  caption: "Describe the post you're captioning…",
  clipfix: "Paste the messy text to clean up…",
  coldemail: "Who are you emailing, and what's the ask?",
  commit: "Paste your git diff or change summary…",
  compare: "List the options you're weighing…",
  cron: "Describe the schedule (e.g. every weekday at 9am)…",
  docstring: "Paste the function to document…",
  errslate: "Paste the error message or stack trace…",
  explainthis: "Paste the confusing text to explain…",
  extract: "Paste the text to pull fields from…",
  formula: "Describe the spreadsheet calculation you need…",
  gist: "Paste text to summarize…",
  hooks: "What's the post or video about?",
  nameit: "Describe the thing you're naming…",
  objection: "Paste the objection you got…",
  outline: "What's the post, talk, or doc about?",
  polish: "Paste the text to proofread…",
  recap: "Paste the long doc to recap…",
  regex: "Describe what you want to match…",
  rephrase: "Paste the text to rewrite…",
  reply: "Paste the message you need to reply to…",
  repurpose: "Paste the content to repurpose…",
  shell: "Describe the task you need a command for…",
  snap: "Ask one direct question…",
  spellout: "Paste the rough phrase to expand…",
  standup: "Paste your notes or commits…",
  steps: "Name the goal you want a plan for…",
  titles: "What's the topic to headline?",
  translate: "Paste the text to translate (name a target language)…",
  unjargon: "Paste the jargon, acronyms, or legalese…",
  yc: "Paste your YC answer draft, or ask a question…",
};

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Strip YAML frontmatter (--- … ---) from a markdown skill body.
function stripFrontmatter(md) {
  const m = md.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? md.slice(m[0].length) : md).trim();
}

// Pull the leading "You are …" instruction literal out of a src/<id>.js file.
// The literal is a single template/quoted string; ${APP.name} is resolved to `name`.
function extractLeadInstruction(srcText, name) {
  // Match the first string literal (backtick, double, or single quote) whose content starts with
  // "You are". Template literals never nest backticks in these files, so a non-greedy grab is safe.
  const re = /([`"'])\s*(You are[\s\S]*?)\1/;
  const m = srcText.match(re);
  if (!m) return null;
  let s = m[2].trim();
  // Resolve the only interpolation that appears in the lead line.
  s = s
    .replace(/\$\{\s*APP\.name\s*\}/g, name)
    .replace(/\$\{\s*APP\.name\.toLowerCase\(\)\s*\}/g, name.toLowerCase());
  // If any other ${…} remain (shouldn't for the lead line), bail so we don't ship a broken prompt.
  if (/\$\{/.test(s)) return null;
  return s;
}

const rows = [];
const out = {};

for (const id of SKILL_IDS) {
  const sjPath = join(WRAPPS, id, "switchboard.json");
  if (!existsSync(sjPath)) { rows.push({ id, name: "?", source: "MISSING switchboard.json" }); continue; }
  const sj = readJson(sjPath);
  const name = sj.name || id;
  const tagline = sj.tagline || "";
  let system = null;
  let source = "";

  // 1) skill body markdown (components.skills[])
  const bodies = (sj.components && Array.isArray(sj.components.skills)) ? sj.components.skills : [];
  const bodyTexts = [];
  for (const ref of bodies) {
    // ref like "gist/summarize" → wrapps/gist/skills/summarize.md ; "yc/register" → wrapps/yc/skills/register.md
    const parts = String(ref).split("/");
    const skillName = parts[parts.length - 1];
    const wrappDir = parts.length > 1 ? parts[0] : id;
    const mdPath = join(WRAPPS, wrappDir, "skills", skillName + ".md");
    if (existsSync(mdPath)) bodyTexts.push(stripFrontmatter(readFileSync(mdPath, "utf8")));
  }
  if (bodyTexts.length) {
    system = bodyTexts.join("\n\n---\n\n");
    source = bodyTexts.length > 1 ? `body ×${bodyTexts.length}` : "body";
  }

  // 2) extract the lead "You are …" instruction from src/<id>.js
  if (!system) {
    const srcPath = join(SRC, id + ".js");
    if (existsSync(srcPath)) {
      const lead = extractLeadInstruction(readFileSync(srcPath, "utf8"), name);
      if (lead) {
        system = lead;
        source = "extracted";
        // Thin lead-ins end with a colon (the real formatting rules live in later array elements).
        // Enrich with the tagline so the model still gets behavioral direction.
        if (/[:：]$/.test(lead.trim())) {
          system = `${lead} ${tagline}`.trim();
          source = "extracted (thin+tagline)";
        }
      }
    }
  }

  // 3) fallback
  if (!system) {
    system = `You are ${name}. ${tagline} Apply your function to the user's input. Be concise; no preamble.`.replace(/\s+/g, " ").trim();
    source = "FALLBACK";
  }

  const placeholder = PLACEHOLDERS[id] || (tagline ? tagline.replace(/\.$/, "") + "…" : `Paste input for ${name}…`);

  out[id] = { name, tagline, system, placeholder };
  rows.push({ id, name, source, systemLen: system.length });
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

// ---- provenance report ----
// NOTE: the brief said "33 skills" but the catalog has exactly 32 category:"skill" wrapps
// (verified against wrapps/catalog.json) — the enumerated list itself is 32 ids. We assert 32.
const EXPECTED = SKILL_IDS.length; // 32
const count = Object.keys(out).length;
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nWrote ${OUT}`);
console.log(`Skills: ${count}/33\n`);
console.log(pad("id", 12) + pad("name", 16) + pad("source", 26) + "system len");
console.log("-".repeat(66));
for (const r of rows) {
  console.log(pad(r.id, 12) + pad(r.name || "?", 16) + pad(r.source, 26) + (r.systemLen ?? ""));
}
const fallbacks = rows.filter((r) => r.source === "FALLBACK");
const thin = rows.filter((r) => String(r.source).startsWith("extracted (thin"));
console.log("\nSummary:");
console.log(`  body       : ${rows.filter((r) => String(r.source).startsWith("body")).length}`);
console.log(`  extracted  : ${rows.filter((r) => r.source === "extracted").length}`);
console.log(`  thin+tag   : ${thin.length}${thin.length ? " (" + thin.map((r) => r.id).join(", ") + ")" : ""}`);
console.log(`  FALLBACK   : ${fallbacks.length}${fallbacks.length ? " ⚠️  (" + fallbacks.map((r) => r.id).join(", ") + ")" : ""}`);
if (count !== EXPECTED) { console.error(`\n❌ expected ${EXPECTED} skills, got ${count}`); process.exit(1); }
console.log(`\n✓ all ${EXPECTED} skills present (catalog has 32 category:"skill" wrapps; brief's "33" was an off-by-one)`);
