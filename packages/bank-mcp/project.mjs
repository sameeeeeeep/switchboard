// Pure project-structuring for the Bank connector's extractor. NO I/O — the server gathers raw repo
// facts (README, package.json, docs, tasks…) and hands them here; this turns them into a `project`
// context object and the `project-<slug>.md` card Bank renders. Deterministic, so it's fully testable
// and reliable on structured repos ("we anyway maintain roadmap and CLAUDE.md") — no model needed.
//
// The output shape is the `kind: "project"` convention documented in docs/CONTEXT-KINDS.md.

export const slugify = (s) =>
  String(s || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";

// A folder is a project if it carries one of the markers a real project always leaves behind. This is
// the cold-start heuristic: point at the folder your work lives in, and every project inside it gets
// extracted. Deliberately marker-based rather than "any directory" — a screenshots folder is not a
// project, and seeding the vault with junk is worse than seeding it with nothing.
export const PROJECT_MARKERS = [
  ".git", "package.json", "README.md", "readme.md", "CLAUDE.md", "ROADMAP.md",
  "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "Gemfile",
  "pom.xml", "build.gradle", "composer.json", "Package.swift", "pubspec.yaml",
];

/** Does this directory listing look like a project root? `names` is the plain `readdir` result. */
export function isProjectDir(names = []) {
  const set = new Set(names);
  return PROJECT_MARKERS.some((m) => set.has(m));
}

const oneLine = (s) =>
  String(s || "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

// README "# Switchboard — MetaMask, but for AI" → name "Switchboard", tagline "MetaMask, but for AI".
function splitTitle(h1) {
  const t = oneLine(String(h1 || "").replace(/^#\s+/, ""));
  const m = t.split(/\s+[—–-]\s+/);
  return { name: (m[0] || t).trim(), tagline: (m.slice(1).join(" — ") || "").trim() };
}

function summaryFrom(readme, pkgDesc, tagline) {
  if (pkgDesc && pkgDesc.trim()) return oneLine(pkgDesc);
  const lines = String(readme || "").split("\n");
  let i = lines.findIndex((l) => l.startsWith("# "));
  i = i < 0 ? 0 : i + 1;
  const rest = lines.slice(i);
  const bq = rest.find((l) => l.trim().startsWith("> "));
  if (bq) return oneLine(bq.replace(/^\s*>\s?/, ""));
  const para = rest.find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("["));
  return oneLine(para || tagline || "");
}

/** Build the structured project object from gathered repo facts. */
export function buildProject(input = {}) {
  const { readme = "", pkgName, pkgDesc, version, license, links = [], stack = [], docs = [], packages = [], wrapps = [], openTasks = [], roadmap = [], name: nameHint, dirName } = input;
  const h1 = String(readme).split("\n").find((l) => l.startsWith("# "));
  const { name: h1name, tagline } = splitTitle(h1);
  // The folder name is the last honest identifier we have. Without this rung a repo carrying neither a
  // README H1 nor a package name becomes the literal "Project" — which, in a bulk seed, collides with
  // every other such repo and buries them all in one card.
  const name = (nameHint || h1name || pkgName || dirName || "Project").trim();
  const status = [version && version !== "0.0.0" ? `v${version}` : null, license || null].filter(Boolean).join(" · ");
  return {
    slug: slugify(name),
    name,
    summary: summaryFrom(readme, pkgDesc, tagline),
    status,
    links: dedupe(links).slice(0, 6),
    stack: dedupe(stack).slice(0, 8),
    roadmap: dedupe(roadmap.map(oneLine)).filter(Boolean).slice(0, 12),
    docs: docs.slice(0, 12),
    packages: dedupe(packages).slice(0, 24),
    wrapps: dedupe(wrapps).slice(0, 40),
    tasks: openTasks.map((t) => (typeof t === "string" ? t : t.text)).filter(Boolean).slice(0, 40),
  };
}

const dedupe = (a) => [...new Set((a || []).map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean))];
const bullets = (arr) => arr.map((x) => `- ${x}`).join("\n");

/** Render the project card as `project-<slug>.md` — the file Bank shows as a project card. Tasks are
 *  NOT checkboxes here (they're synced to tasks.md under the project's list); roadmap/docs are plain
 *  bullets so they render as card content, not board tasks. */
export function projectToMarkdown(p) {
  const meta = [
    p.status && `- **status:** ${p.status}`,
    p.stack.length && `- **stack:** ${p.stack.join(", ")}`,
    ...p.links.map((l) => `- **${l.label || "link"}:** ${l.url || l}`),
  ].filter(Boolean).join("\n");
  const sec = (title, body) => (body && body.trim() ? `\n## ${title}\n${body}\n` : "");
  return (
    `# ${p.name}\n\n` +
    (p.summary ? `> ${p.summary}\n\n` : "") +
    (meta ? `${meta}\n` : "") +
    sec("Roadmap", bullets(p.roadmap)) +
    sec("Docs", bullets(p.docs.map((d) => (d.title ? `${d.title}${d.file ? ` — ${d.file}` : ""} ` : d)))) +
    sec("Packages", bullets(p.packages)) +
    sec("Wrapps", bullets(p.wrapps)) +
    (p.tasks.length ? `\n<!-- ${p.tasks.length} open task${p.tasks.length === 1 ? "" : "s"} synced to your board under “${p.name}” -->\n` : "")
  );
}
