#!/usr/bin/env node
// Bank connector — an MCP server that lets ANY Claude thread push to-dos into your Bank.
//
// Your Bank's vault is a folder of plain .md files you own. The Bank web app writes tasks into it
// through the consent daemon; Obsidian edits the same files by hand. This server is the third writer:
// add it to any Claude (Claude Code, claude.ai) and a conversation — a coding session on this very
// repo, a brandbrain thread, a phone chat — can drop tasks straight into that folder. They show up in
// the Bank UI and in Obsidian, because everyone is reading the same plain text. No database, no API.
//
//   claude mcp add bank -- node /abs/path/packages/bank-mcp/bank-mcp.mjs --vault ~/SwitchboardBrain
//
// It only ever touches ONE file it owns (tasks.md) for writes, reads *.md in the vault for listing,
// and can never resolve outside the vault folder. Adding it is your consent; the vault path is yours.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { addTask, completeTask, parseTasks } from "./tasks.mjs";
import { buildProject, projectToMarkdown, slugify, isProjectDir } from "./project.mjs";
import { buildBrand, brandToMarkdown, brandToContext } from "./brand.mjs";

// ---- vault resolution: --vault <path> | $BANK_VAULT | ~/SwitchboardBrain (Bank's default) ----
function argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; }
function expand(p) { return p.startsWith("~") ? join(homedir(), p.slice(1)) : p; }
const VAULT = resolve(expand(argVal("--vault") || process.env.BANK_VAULT || join(homedir(), "SwitchboardBrain")));
const TASKS_FILE = "tasks.md"; // the one file this server writes new tasks into

function ensureVault() { if (!existsSync(VAULT)) mkdirSync(VAULT, { recursive: true }); }
function readDoc(name) { const p = join(VAULT, name); return existsSync(p) ? readFileSync(p, "utf8") : ""; }
function writeDoc(name, text) { ensureVault(); writeFileSync(join(VAULT, name), text); }
function mdFiles() { try { return readdirSync(VAULT).filter((f) => f.toLowerCase().endsWith(".md")); } catch { return []; } }
const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

// ---- repo gathering for bank_extract_project (deterministic; reads only markdown/manifest facts) ----
const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "out", ".turbo", "vendor"]);
function readSafe(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }
function listDirs(p) { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !IGNORE.has(d.name)).map((d) => d.name); } catch { return []; } }
function walkMd(dir, out, budget) {
  if (out.length >= budget.files) return;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (out.length >= budget.files) return;
    if (e.name.startsWith(".") || IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkMd(full, out, budget);
    else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
  }
}
function gatherRepo(dir) {
  const readme = readSafe(join(dir, "README.md")) || readSafe(join(dir, "readme.md"));
  let pkg = {}; try { pkg = JSON.parse(readSafe(join(dir, "package.json")) || "{}"); } catch { /* none */ }
  const licenseFirst = (readSafe(join(dir, "LICENSE")) || readSafe(join(dir, "LICENSE.md"))).split("\n").find((l) => l.trim()) || "";
  const license = /\bMIT\b/i.test(licenseFirst) ? "MIT" : /\bApache/i.test(licenseFirst) ? "Apache-2.0" : pkg.license || "";
  // stack: cheap, honest markers
  const stack = [];
  if (existsSync(join(dir, "tsconfig.json"))) stack.push("TypeScript");
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [k, label] of [["esbuild", "esbuild"], ["three", "three.js"], ["@modelcontextprotocol/sdk", "MCP"], ["react", "React"], ["vite", "Vite"], ["zod", "zod"]]) if (deps[k]) stack.push(label);
  // links from README markdown links (http only), plus package repo/homepage
  const links = [];
  const repoUrl = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repoUrl) links.push({ label: "repo", url: String(repoUrl).replace(/^git\+/, "").replace(/\.git$/, "") });
  if (pkg.homepage) links.push({ label: "home", url: pkg.homepage });
  for (const m of String(readme).matchAll(/\[([^\]]{1,40})\]\((https?:\/\/[^)\s]+)\)/g)) { if (links.length < 6) links.push({ label: m[1], url: m[2] }); }
  // docs/*.md H1 titles
  const docs = [];
  for (const f of readdirSafe(join(dir, "docs"))) {
    if (!f.toLowerCase().endsWith(".md")) continue;
    const title = (readSafe(join(dir, "docs", f)).split("\n").find((l) => l.startsWith("# ")) || "").replace(/^#\s+/, "").trim();
    if (title) docs.push({ title, file: `docs/${f}` });
  }
  // monorepo packages + example wrapps
  const packages = listDirs(join(dir, "packages"));
  const wrapps = readdirSafe(join(dir, "examples", "apps", "src")).filter((f) => f.endsWith(".js")).map((f) => basename(f, ".js"));
  // roadmap bullets from a ROADMAP file, if any
  const roadmapFile = readSafe(join(dir, "ROADMAP.md")) || readSafe(join(dir, "roadmap.md"));
  const roadmap = roadmapFile.split("\n").filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ""));
  // open tasks across the repo's markdown (bounded)
  const files = []; walkMd(dir, files, { files: 400 });
  const openTasks = [];
  for (const f of files) { for (const t of parseTasks(readSafe(f))) if (!t.done && openTasks.length < 40) openTasks.push({ text: t.text, file: f }); }
  return { readme, pkgName: pkg.name, pkgDesc: pkg.description, version: pkg.version, license, links, stack, docs, packages, wrapps, roadmap, openTasks, dirName: basename(dir) };
}
function readdirSafe(p) { try { return readdirSync(p); } catch { return []; } }

// ---- multi-project discovery (the cold-start seed) ----
// Point at the folder your work lives in; every project inside becomes a card. We stop descending the
// moment a folder looks like a project, so a monorepo lands as ONE project rather than one per package.
function findProjects(root, maxDepth = 1, limit = 60) {
  if (isProjectDir(readdirSafe(root))) return [root]; // pointed straight at a repo → just that repo
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= limit || depth > maxDepth) return;
    for (const name of readdirSafe(dir).sort()) {
      if (found.length >= limit) return;
      if (name.startsWith(".") || IGNORE.has(name)) continue;
      const full = join(dir, name);
      try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
      if (isProjectDir(readdirSafe(full))) found.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(root, 1);
  return found;
}

// ---- site fetching for bank_extract_brand ----
// The whole point of the brand extractor is that colours and products come from bytes the site
// actually served, never from a model's recollection. So we do the fetching here and hand raw text to
// the pure parser in brand.mjs.
const UA = "Mozilla/5.0 (compatible; SwitchboardBank/0.1; +https://github.com/sameeeeeeep/switchboard)";
const MAX_BYTES = 4_000_000;
// A URL reaches this tool from a model or a paste, so it must never be a lever onto the local network.
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|\[?::1\]?|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

function safeUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${String(raw).trim()}`); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(h) || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return null;
  return u;
}

async function get(url, { timeoutMs = 20_000, json = false } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: json ? "application/json" : "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_BYTES);
    if (!json) return text;
    try { return JSON.parse(text); } catch { return null; } // a bot-block serves HTML here, not JSON
  } catch { return null; }
}

/** The full catalogue. `?limit=250` is what turns "the first 30" into everything. */
async function fetchCatalog(origin) {
  const products = [];
  for (let page = 1; page <= 8; page++) {
    const j = await get(`${origin}/products.json?limit=250&page=${page}`, { json: true });
    const list = j && Array.isArray(j.products) ? j.products : null;
    if (!list || !list.length) break;
    products.push(...list);
    if (list.length < 250) break;
  }
  // Some storefronts bot-block the query-string form; the bare endpoint usually still answers.
  if (!products.length) {
    const j = await get(`${origin}/products.json`, { json: true });
    if (j && Array.isArray(j.products)) products.push(...j.products);
  }
  return { products };
}

/** Homepage + its same-origin stylesheets + the catalogue. Stylesheets matter for themes that don't
 *  inline their custom properties — without them the palette silently degrades to frequency guessing. */
async function gatherSite(u) {
  const origin = u.origin;
  const html = await get(`${origin}/`);
  if (!html) return null;
  const hrefs = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)].map((m) => m[1]);
  const sheets = await Promise.all(
    hrefs.slice(0, 4).map(async (h) => {
      try {
        const abs = new URL(h, origin);
        if (abs.origin !== origin && !/(^|\.)shopify(cdn)?\.com$|cdn\.shopify\.com/.test(abs.hostname)) return "";
        return (await get(abs.href, { timeoutMs: 12_000 })) || "";
      } catch { return ""; }
    }),
  );
  return { html, css: sheets.join("\n"), catalog: await fetchCatalog(origin) };
}

const server = new McpServer({ name: "bank", version: "0.1.0" });

server.registerTool(
  "bank_add_task",
  {
    title: "Add a task to the Bank",
    description:
      "Add a to-do to the user's Bank. Use this whenever the user wants to remember, capture, or track something — 'add to my bank', 'put this on my list', 'remind me to…', or when you finish work and there are clear follow-ups worth saving. `list` groups related tasks (a project, an area, a channel — e.g. 'Relay', 'Errands'); it shows up as the task's source in the Bank. Keep `text` a short imperative action.",
    inputSchema: {
      text: z.string().describe("the task, as a short imperative action, e.g. 'Reply to Acme about the renewal'"),
      list: z.string().optional().describe("which list/project to file it under (becomes a heading). Default 'Inbox'."),
      due: z.string().optional().describe("optional short due hint, e.g. 'Fri' or '2026-07-20'"),
    },
  },
  async ({ text, list, due }) => {
    const { doc, added, reason, list: filed } = addTask(text, { list, due }, readDoc(TASKS_FILE));
    if (added) writeDoc(TASKS_FILE, doc);
    return ok({ ok: added, added, list: filed, reason, file: TASKS_FILE });
  },
);

server.registerTool(
  "bank_list_tasks",
  {
    title: "List Bank tasks",
    description:
      "Read the user's Bank to-dos across every note in their vault. Use it before adding (to avoid duplicates), to answer 'what's on my list / plate / for <project>', or to review progress. Returns tasks with their list and whether they're done.",
    inputSchema: {
      status: z.enum(["open", "done", "all"]).optional().describe("filter by status; default 'open'"),
      list: z.string().optional().describe("only tasks in this list/project (case-insensitive)"),
    },
  },
  async ({ status = "open", list }) => {
    const all = mdFiles().flatMap((f) => parseTasks(readDoc(f), f));
    const wantList = list ? String(list).toLowerCase() : null;
    const tasks = all
      .filter((t) => (status === "all" ? true : status === "done" ? t.done : !t.done))
      .filter((t) => (wantList ? t.list.toLowerCase() === wantList : true))
      .map((t) => ({ text: t.text, done: t.done, list: t.list, file: t.file }))
      .slice(0, 200);
    return ok({ ok: true, count: tasks.length, tasks });
  },
);

server.registerTool(
  "bank_complete_task",
  {
    title: "Complete a Bank task",
    description:
      "Mark a Bank to-do done by matching its text (case-insensitive substring). Use when the user says something is finished/handled. Flips `- [ ]` to `- [x]` in place so it stays checked off and won't resurface.",
    inputSchema: { match: z.string().describe("text (or a distinctive fragment) of the task to complete") },
  },
  async ({ match }) => {
    for (const f of mdFiles()) {
      const { doc, completed } = completeTask(match, readDoc(f));
      if (completed) { writeDoc(f, doc); return ok({ ok: true, completed, file: f }); }
    }
    return ok({ ok: false, reason: "no open task matches that text" });
  },
);

server.registerTool(
  "bank_extract_project",
  {
    title: "Extract a project into the Bank",
    description:
      "Read a code project (a repo folder) and file it into the Bank as a `project` card — its summary, status, stack, docs, packages, and links — while syncing its open `- [ ] ` tasks onto your board under the project's name. Use when the user wants to 'add this project to my bank', 'track this repo', or make a project's context viewable alongside everything else. `path` defaults to the current working directory, so in a Claude Code session it captures the repo you're in.",
    inputSchema: {
      path: z.string().optional().describe("absolute path to the repo/project root. Default: the current working directory."),
      name: z.string().optional().describe("override the project name (else taken from the README title)"),
    },
  },
  async ({ path, name }) => {
    const dir = resolve(path ? expand(path) : process.cwd());
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return ok({ ok: false, reason: `not a directory: ${dir}` });
    const project = buildProject({ ...gatherRepo(dir), name });
    writeDoc(`project-${project.slug}.md`, projectToMarkdown(project));
    // Sync the project's open tasks onto the board, filed under the project's name.
    let synced = 0, doc = readDoc(TASKS_FILE);
    for (const t of project.tasks) { const r = addTask(t, { list: project.name }, doc); if (r.added) { doc = r.doc; synced++; } }
    if (synced) writeDoc(TASKS_FILE, doc);
    return ok({ ok: true, project: project.slug, name: project.name, summary: project.summary, file: `project-${project.slug}.md`, tasksSynced: synced, from: dir });
  },
);

server.registerTool(
  "bank_extract_projects",
  {
    title: "Seed the Bank from a folder of projects",
    description:
      "Scan a folder that CONTAINS several projects and file each one into the Bank as its own `project` card. Use this to solve the cold start — 'I just installed this and my Bank is empty', 'point at my projects folder', 'import all my repos', 'seed my workspace'. Give it the PARENT folder (e.g. ~/Documents/Projects) and every project inside it is extracted; a monorepo is captured as one project, not one per package. If you point it at a single repo it just extracts that repo. Task syncing is off by default so a first run fills the shelf without flooding the board.",
    inputSchema: {
      path: z.string().optional().describe("absolute path to the FOLDER CONTAINING your projects. Default: the current working directory."),
      depth: z.number().optional().describe("how many levels down to look for projects (default 1; use 2 if your projects are grouped in sub-folders like work/ and personal/)"),
      limit: z.number().optional().describe("max projects to extract in one run (default 60)"),
      syncTasks: z.boolean().optional().describe("also sync each project's open `- [ ] ` tasks onto the board (default false — a bulk seed would otherwise add hundreds of to-dos)"),
    },
  },
  async ({ path, depth, limit, syncTasks = false }) => {
    const root = resolve(path ? expand(path) : process.cwd());
    if (!existsSync(root) || !statSync(root).isDirectory()) return ok({ ok: false, reason: `not a directory: ${root}` });

    const dirs = findProjects(root, Math.max(1, Math.min(3, depth ?? 1)), Math.max(1, Math.min(200, limit ?? 60)));
    if (!dirs.length) return ok({ ok: false, reason: `no projects found under ${root}. A project is a folder with a README, package.json, .git, CLAUDE.md or similar marker.`, from: root });

    const seen = new Set();
    const projects = [];
    let synced = 0, doc = readDoc(TASKS_FILE);
    for (const dir of dirs) {
      const project = buildProject(gatherRepo(dir));
      // Two folders can render the same title; keep both rather than silently overwriting one card.
      let slug = project.slug;
      if (seen.has(slug)) slug = slugify(`${project.name}-${basename(dir)}`);
      seen.add(slug);
      writeDoc(`project-${slug}.md`, projectToMarkdown(project));
      if (syncTasks) {
        for (const t of project.tasks) { const r = addTask(t, { list: project.name }, doc); if (r.added) { doc = r.doc; synced++; } }
      }
      projects.push({ slug, name: project.name, summary: project.summary, openTasks: project.tasks.length, from: dir });
    }
    if (synced) writeDoc(TASKS_FILE, doc);
    return ok({ ok: true, count: projects.length, projects, tasksSynced: synced, from: root, vault: VAULT });
  },
);

server.registerTool(
  "bank_extract_brand",
  {
    title: "Extract a brand from its website into the Bank",
    description:
      "Read a live website and file the brand into the Bank as a `brand` card — its real colour palette, its real product catalogue with prices, category, currency and socials. Use when the user wants to 'add my brand', 'import my store', 'pull in my company', or set up brand context from a URL. Everything is parsed from what the site actually serves (CSS custom properties, /products.json, meta tags), so colours and products are observed facts, not guesses — each colour records the CSS variable it came from. Works best on Shopify stores, where the whole catalogue is available.",
    inputSchema: {
      url: z.string().describe("the brand's website, e.g. 'nailin.it' or 'https://nailin.it'"),
      name: z.string().optional().describe("override the brand name (else taken from og:site_name or the page title)"),
    },
  },
  async ({ url, name }) => {
    const u = safeUrl(url);
    if (!u) return ok({ ok: false, reason: `not a fetchable public website: ${url}` });

    const site = await gatherSite(u);
    if (!site) return ok({ ok: false, reason: `could not fetch ${u.origin} — is the site up and public?` });

    const brand = buildBrand({ url: u.origin, html: site.html, css: site.css, productsJson: site.catalog, name });
    writeDoc(`brand-${brand.slug}.md`, brandToMarkdown(brand));
    return ok({
      ok: true,
      brand: brand.slug,
      name: brand.name,
      file: `brand-${brand.slug}.md`,
      // Returned so the calling thread can SEE what was observed rather than re-deriving it.
      palette: brand.paletteRich.map((p) => ({ hex: p.hex, from: p.name || p.source })),
      products: brand.products.length,
      sample: brand.products.slice(0, 8).map((p) => p.short),
      catalog: brand.catalog,
      context: brandToContext(brand),
      note: brand.palette.length ? undefined : "no brand colours found in the served CSS — the site may render its theme client-side",
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[bank-mcp] serving tasks from ${VAULT}`);
