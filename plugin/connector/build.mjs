#!/usr/bin/env node
// Rebuild the self-contained connector bundle that ships inside this plugin.
//
// WHY a bundle: when a plugin is installed from a marketplace, Claude Code caches ONLY the
// plugin/ folder and blocks `../` path traversal — so the connector cannot reach the repo's
// sibling packages (../bank-mcp, ../../examples/apps/src/core) or the repo's node_modules at
// runtime. esbuild inlines that entire source closure + the three npm deps
// (@modelcontextprotocol/sdk, ws, zod) into ONE file with no external imports, so the plugin
// is fully self-contained.
//
// Run this whenever packages/switchboard-mcp/*.mjs, packages/bank-mcp/tasks.mjs, or the
// examples/apps/src/core/*.core.js the registry imports change. The output
// (connector/switchboard-mcp.mjs) is a committed build artifact.
//
//   node plugin/connector/build.mjs          # from repo root, with esbuild installed
//
// Needs esbuild resolvable (repo devDependency, or `npm i` first). The banner injects a
// createRequire shim so CJS deps that call require() work under ESM output.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));            // plugin/connector
const REPO = resolve(HERE, "../..");                            // repo root
const ENTRY = resolve(REPO, "packages/switchboard-mcp/switchboard-mcp.mjs");
const OUT = resolve(HERE, "switchboard-mcp.mjs");
const STARTER = resolve(REPO, "skills/build-a-wrapp/assets/starter");
const starter = Object.fromEntries(readdirSync(STARTER).map(name => [name, readFileSync(resolve(STARTER, name), "utf8")]));
// Generate the portable OpenAI envelope from the existing metadata. Claude retains its legacy
// discovery files; both envelopes point at the very same launcher, skills, hooks, and connector.
const PLUGIN = resolve(HERE, "..");
const metadata = JSON.parse(readFileSync(resolve(PLUGIN, ".codex-plugin/plugin.json"), "utf8"));
const portable = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: metadata.name, version: metadata.version, description: metadata.description, author: metadata.author,
  extensions: { "com.openai": { interface: metadata.interface, hooks: "./hooks/hooks.json" } },
};
const legacyMcp = JSON.parse(readFileSync(resolve(PLUGIN, ".mcp.json"), "utf8"));
const portableMcp = JSON.parse(JSON.stringify(legacyMcp).replaceAll("${CLAUDE_PLUGIN_ROOT}", "${PLUGIN_ROOT}"));
portableMcp.$schema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
portableMcp.mcpServers.switchboard.command = "sh";
portableMcp.mcpServers.switchboard.cwd = "${PLUGIN_ROOT}";
writeFileSync(resolve(PLUGIN, "plugin.json"), JSON.stringify(portable, null, 2) + "\n");
writeFileSync(resolve(PLUGIN, "mcp.json"), JSON.stringify(portableMcp, null, 2) + "\n");

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  define: { __SWITCHBOARD_STARTER__: JSON.stringify(starter) },
  write: false,
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});
// Dependency code generators contain whitespace-only lines inside template strings. Removing that
// indentation preserves generated JS semantics and keeps the committed artifact whitespace-clean.
writeFileSync(OUT, result.outputFiles[0].text.replace(/^[\t ]+$/gm, ""));

console.log(`[connector build] wrote ${OUT}`);
