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

const HERE = dirname(fileURLToPath(import.meta.url));            // plugin/connector
const REPO = resolve(HERE, "../..");                            // repo root
const ENTRY = resolve(REPO, "packages/switchboard-mcp/switchboard-mcp.mjs");
const OUT = resolve(HERE, "switchboard-mcp.mjs");

await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});

console.log(`[connector build] wrote ${OUT}`);
