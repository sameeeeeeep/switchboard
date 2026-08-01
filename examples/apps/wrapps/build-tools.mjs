// build-tools.mjs — harvest the TOOL REGISTRY from every wrapp's exposeToGod() declaration.
//
// A wrapp can expose MANY God-callable commands, not one standardized "<id>_run" — so the drive can't
// guess the name. Each exposeToGod({ name, description, inputSchema, execute }) already carries the three
// things a registry needs, the same triple a skill has: the command (name), WHEN to use it (description),
// and HOW to call it (inputSchema). This walks src/*.js, lifts those three off every declaration, and
// writes wrapps/tools.json keyed by SOURCE id. build-catalog.mjs folds each wrapp's commands into its
// listing (via SRC_ALIAS where the catalog id differs, e.g. prism→imagegen), so God sees a wrapp's real
// commands — not just a tagline — and can resolve a request to the right command with the right args.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));   // examples/apps/wrapps
const SRC = join(HERE, "..", "src");

// Pull the metadata block off ONE exposeToGod({...}) — everything before `execute:` (which we skip so
// its nested braces never confuse the parse). Returns { name, description, inputSchema } or null.
function parseDecl(block) {
  const head = block.split(/\bexecute\s*:/)[0];   // metadata only — name/description/inputSchema precede execute
  const name = /\bname\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
  if (!name) return null;
  const description = /\bdescription\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1] || "";
  const schema = {};
  const schemaText = /\binputSchema\s*:\s*\{([\s\S]*?)\}/.exec(head)?.[1] || "";
  const keyRe = /(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = keyRe.exec(schemaText))) schema[m[1]] = m[2].replace(/\\"/g, '"');
  return { name, description: description.replace(/\\"/g, '"'), inputSchema: schema };
}

// Every exposeToGod( call in a file → its declarations. Handles the single-object and (future) array
// forms; splits on the next `exposeToGod(` so multiple calls in one file each get parsed.
function harvestFile(text) {
  const out = [];
  const parts = text.split(/\bexposeToGod\s*\(/).slice(1);
  for (const part of parts) {
    // Each object declaration inside starts at a `{ name:` — grab up to the following `execute:` end.
    const decls = part.split(/\}\s*,?\s*\{/);   // crude split for the array form; single form yields one
    // Simpler + reliable: find each `name:`…`inputSchema:{…}` window in this part, before its execute.
    const nameRe = /\bname\s*:/g;
    let nm;
    while ((nm = nameRe.exec(part))) {
      const window = part.slice(nm.index, nm.index + 1200);   // metadata is small; execute is sliced off inside parseDecl
      const d = parseDecl("name:" + window.slice(window.indexOf(":") + 1));
      if (d) out.push(d);
      if (out.length > 12) break;   // sanity cap per file
    }
    void decls;
  }
  // de-dupe by name (the windowed scan can re-capture)
  const seen = new Set();
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

const registry = {};
let total = 0;
for (const f of readdirSync(SRC)) {
  if (!f.endsWith(".js")) continue;
  const id = f.replace(/\.js$/, "");
  const text = readFileSync(join(SRC, f), "utf8");
  if (!text.includes("exposeToGod")) continue;
  const tools = harvestFile(text);
  if (tools.length) { registry[id] = tools; total += tools.length; }
}

const outPath = join(HERE, "tools.json");
writeFileSync(outPath, JSON.stringify(registry, null, 2) + "\n");
console.log(`✓ ${total} tools across ${Object.keys(registry).length} wrapps → ${outPath}`);
