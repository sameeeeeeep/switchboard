// Pure-logic tests for the Bank connector's project structuring. Run: node project.test.mjs
import assert from "node:assert/strict";
import { buildProject, projectToMarkdown, slugify, isProjectDir, PROJECT_MARKERS } from "./project.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("  ✓", name); };

test("slugify makes a stable, file-safe slug", () => {
  assert.equal(slugify("Switchboard"), "switchboard");
  assert.equal(slugify("sameeeeeeep.github.io"), "sameeeeeeep-github-io");
  assert.equal(slugify(""), "project");
});

test("isProjectDir recognises every marker", () => {
  for (const m of PROJECT_MARKERS) assert.equal(isProjectDir([m, "src"]), true, m);
});

test("isProjectDir rejects a folder with no project markers", () => {
  assert.equal(isProjectDir(["screenshot.png", "notes.txt", "img"]), false);
  assert.equal(isProjectDir([]), false);
});

test("the README H1 wins, and its em-dash tagline is split off", () => {
  const p = buildProject({ readme: "# Switchboard — MetaMask, but for AI\n\nBody.", dirName: "relay" });
  assert.equal(p.name, "Switchboard");
  assert.equal(p.slug, "switchboard");
});

test("the folder name is the fallback when there is no README H1 or package name", () => {
  // The bulk-seed regression: without this, every unnamed repo became "Project" and they collided.
  const p = buildProject({ dirName: "d2cOS" });
  assert.equal(p.name, "d2cOS");
  assert.equal(p.slug, "d2cos");
});

test("an explicit name overrides everything", () => {
  const p = buildProject({ readme: "# Ignored", pkgName: "also-ignored", dirName: "nope", name: "Real Name" });
  assert.equal(p.name, "Real Name");
});

test("name falls back through h1 → pkgName → dirName in order", () => {
  assert.equal(buildProject({ pkgName: "pkg", dirName: "dir" }).name, "pkg");
  assert.equal(buildProject({ dirName: "dir" }).name, "dir");
  assert.equal(buildProject({}).name, "Project");
});

test("summary prefers the package description, then a blockquote, then the first paragraph", () => {
  assert.equal(buildProject({ pkgDesc: "From package.json" }).summary, "From package.json");
  assert.equal(buildProject({ readme: "# T\n\n> Quoted line\n\nPara." }).summary, "Quoted line");
  assert.equal(buildProject({ readme: "# T\n\nFirst para." }).summary, "First para.");
});

test("status joins version and license, omitting a 0.0.0 version", () => {
  assert.equal(buildProject({ version: "1.0.0", license: "MIT" }).status, "v1.0.0 · MIT");
  assert.equal(buildProject({ version: "0.0.0", license: "MIT" }).status, "MIT");
});

test("lists are deduped and bounded", () => {
  const p = buildProject({ stack: ["TypeScript", "TypeScript", "MCP"], openTasks: Array.from({ length: 80 }, (_, i) => `t${i}`) });
  assert.deepEqual(p.stack, ["TypeScript", "MCP"]);
  assert.equal(p.tasks.length, 40);
});

test("open tasks accept both string and {text} shapes", () => {
  const p = buildProject({ openTasks: ["plain", { text: "structured" }, { text: "" }] });
  assert.deepEqual(p.tasks, ["plain", "structured"]);
});

test("projectToMarkdown renders a card and omits empty sections", () => {
  const md = projectToMarkdown(buildProject({
    readme: "# Switchboard — MetaMask, but for AI\n\n> A local broker.",
    version: "1.0.0", license: "MIT", stack: ["TypeScript"], roadmap: ["Ship the board"],
  }));
  assert.match(md, /^# Switchboard\n/);
  assert.match(md, /> A local broker\./);
  assert.match(md, /- \*\*status:\*\* v1\.0\.0 · MIT/);
  assert.match(md, /## Roadmap\n- Ship the board/);
  assert.equal(md.includes("## Packages"), false);
});

test("tasks are a comment, not checkboxes (the board owns them)", () => {
  const md = projectToMarkdown(buildProject({ name: "X", openTasks: ["a", "b"] }));
  assert.equal(md.includes("- [ ]"), false);
  assert.match(md, /2 open tasks synced to your board/);
});

console.log(`\n${n} tests passed`);
