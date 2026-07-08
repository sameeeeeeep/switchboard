/**
 * Switchboard — Next.js port preset (brandbrain is preset #1's proof).
 *
 * Retargets a conventional Next App Router app onto the broker by SUBSTITUTING SEAMS, never
 * rewriting: the real source is copied into a throwaway build dir, a handful of overlays + an
 * alias map swap the runtime seams (model transport, persistence, /api dispatch) to the adapter
 * shims, and two artifacts come out:
 *   A. a static export of the FRONTEND (pages ship unchanged)                    ← this file, Stage A
 *   B. an esbuild bundle of the /api ROUTE HANDLERS for the client fetch-router  ← Stage B
 *   C. a bootstrap that connects window.claude + installs the fetch-shim         ← Stage C
 *
 * The real ~/Documents/Projects/brandbrain is never touched.
 *
 * Run: node examples/brandbrain-port/build.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, cpSync, symlinkSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.BRANDBRAIN_SRC || join(homedir(), "Documents/Projects/brandbrain");
const BUILD = join(HERE, ".build");
const OVERLAYS = join(HERE, "overlays");
const SHIMS = join(HERE, "shims");
const OUT = join(HERE, "dist"); // final served artifact

const log = (m) => console.error(`[port] ${m}`);
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env } });
// Iteration lever: SKIP_FRONTEND=1 reuses the existing static export and only rebuilds the JS bundles
// (routes + bootstrap), skipping the ~30s next build when only adapter/route/bootstrap code changed.
const SKIP_FRONTEND = process.env.SKIP_FRONTEND === "1" && existsSync(join(OUT, "index.html"));

if (!existsSync(SRC)) { console.error(`[port] brandbrain source not found at ${SRC} (set BRANDBRAIN_SRC)`); process.exit(1); }
if (!existsSync(join(SRC, "node_modules", "next"))) { console.error(`[port] ${SRC}/node_modules/next missing — run npm install in brandbrain first`); process.exit(1); }

// ---- 1. Overlay-copy the real source into a throwaway build dir (heavy/generated dirs excluded) ----
log("copying brandbrain source → .build (real source untouched)");
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
const EXCLUDES = ["node_modules", ".next", ".git", ".data", ".cache", "out", ".DS_Store"];
for (const entry of readdirSync(SRC)) {
  if (EXCLUDES.includes(entry)) continue;
  cpSync(join(SRC, entry), join(BUILD, entry), { recursive: true });
}
// Reuse brandbrain's installed deps rather than reinstalling.
symlinkSync(join(SRC, "node_modules"), join(BUILD, "node_modules"), "dir");

// ---- 2. Apply the port overlays (the seams the frontend export needs) ----
log("applying overlays: next.config (output:export) + redirect() fix + script injection");
cpSync(join(OVERLAYS, "next.config.mjs"), join(BUILD, "next.config.mjs"));
cpSync(join(OVERLAYS, "hub-page.tsx"), join(BUILD, "app/(hub)/page.tsx"));
cpSync(join(OVERLAYS, "layout.tsx"), join(BUILD, "app/layout.tsx"));

// The 32 route handlers are Node-only (spawn/fs) and dynamic — they cannot be part of a static
// export. Remove them here; Stage B bundles them from SRC for the client fetch-router instead.
log("removing app/api from the frontend build (routes are bundled separately for the client)");
rmSync(join(BUILD, "app/api"), { recursive: true, force: true });

// ---- 3+4. Static-export the frontend and stage it (skippable when only bundles changed) ----
if (SKIP_FRONTEND) {
  log("SKIP_FRONTEND=1 → reusing existing static export in dist/");
} else {
  log("next build (output: export) …");
  run("./node_modules/.bin/next build", BUILD);
  const exportDir = join(BUILD, "out");
  if (!existsSync(exportDir)) { console.error("[port] expected static export at .build/out — not found"); process.exit(1); }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(exportDir, OUT, { recursive: true });
  const pages = readdirSync(OUT).filter((f) => f.endsWith(".html"));
  log(`✅ Stage A done — static export (${pages.length} top-level html: ${pages.join(", ")})`);
}

// ---- 5. Stage B: bundle the 32 route handlers for the client fetch-router ----
// Collect every app/api/**/route.ts from the REAL source and map it to its URL path.
function collectRoutes(dir, base = "/api") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectRoutes(full, `${base}/${entry}`));
    else if (entry === "route.ts" || entry === "route.js") out.push({ path: base, file: full });
  }
  return out;
}
const routeFiles = collectRoutes(join(SRC, "app/api"));
log(`bundling ${routeFiles.length} route handlers for the client fetch-router`);

// The seam substitution: any import that resolves to one of brandbrain's server-only modules — by the
// `@/lib/...` alias OR a relative `./claude` (research.ts reaches lib/claude directly) — is redirected
// to an adapter shim. Everything else under `@/` resolves against the build copy; npm deps resolve
// normally through the symlinked node_modules.
const seamPlugin = {
  name: "switchboard-seams",
  setup(b) {
    const exts = [".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx", "/index.js"];
    const resolveExt = (p) => { for (const e of ["", ...exts]) { const c = p + e; try { if (statSync(c).isFile()) return c; } catch {} } return p; };
    b.onResolve({ filter: /.*/ }, (args) => {
      const p = args.path;
      if (p === "@/lib/claude" || /(^|\/)claude$/.test(p)) return { path: join(SHIMS, "claude.mjs") };
      if (p === "@/lib/claude-session" || /(^|\/)claude-session$/.test(p)) return { path: join(SHIMS, "claude-session.mjs") };
      if (/server\/workspace-store$/.test(p)) return { path: join(SHIMS, "workspace-store.mjs") };
      if (/server\/vendor-store$/.test(p)) return { path: join(SHIMS, "vendor-store.mjs") };
      if (p === "node:fs" || p === "fs" || p === "node:fs/promises" || p === "fs/promises") return { path: join(SHIMS, "node-fs.mjs") };
      if (p === "node:path" || p === "path") return { path: join(SHIMS, "node-path.mjs") };
      if (p.startsWith("@/")) return { path: resolveExt(join(BUILD, p.slice(2))) };
      return undefined; // relative + npm: default resolution
    });
  },
};

// Generate the entry: import every route module, map path → module, expose mount(provider).
const importLines = routeFiles.map((r, i) => `import * as r${i} from ${JSON.stringify(r.file)};`).join("\n");
const mapLines = routeFiles.map((r, i) => `  ${JSON.stringify(r.path)}: r${i},`).join("\n");
const entry = `
import { setProvider } from "../adapter/claude.mjs";
import { createApp, installFetchShim } from "../adapter/router.mjs";
${importLines}
const routes = {
${mapLines}
};
export function mount(provider) {
  if (provider) setProvider(provider);
  const app = createApp(routes);
  installFetchShim(app);
  return app;
}
if (typeof window !== "undefined") window.__switchboardRoutes = { mount, paths: Object.keys(routes) };
`;

mkdirSync(join(OUT, "sb"), { recursive: true });
await esbuild.build({
  stdin: { contents: entry, resolveDir: HERE, sourcefile: "routes-entry.mjs", loader: "ts" },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome111",
  outfile: join(OUT, "sb/routes.js"),
  plugins: [seamPlugin],
  loader: { ".ts": "ts", ".tsx": "tsx" },
  // brandbrain's server code assumes a Node process global; research.ts calls process.cwd() at import.
  banner: { js: "globalThis.process=globalThis.process||{env:{},cwd:function(){return '/'},platform:'browser'};globalThis.global=globalThis;" },
  logLevel: "info",
});
log(`✅ Stage B done — ${routeFiles.length} routes bundled → dist/sb/routes.js`);

// ---- 6. Stage C: the bootstrap (connect window.claude + mount fetch-router + folder bind) ----
log("bundling bootstrap (connect + mount + bind)");
await esbuild.build({
  entryPoints: [join(HERE, "src/bootstrap.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome111",
  outfile: join(OUT, "sb/bootstrap.js"),
  // Inline the deploy base path so the bootstrap's absolute fetches resolve under a subpath deploy.
  define: { "process.env.PORT_BASE_PATH": JSON.stringify(process.env.PORT_BASE_PATH || "") },
  logLevel: "info",
});
// The capability manifest — served at /switchboard.json; the bootstrap reads it for the connect
// scope (tools + models) and the default data folder.
if (existsSync(join(HERE, "switchboard.json"))) cpSync(join(HERE, "switchboard.json"), join(OUT, "switchboard.json"));
log(`✅ Stage C done — bootstrap → dist/sb/bootstrap.js + switchboard.json`);
log(`\n🎉 brandbrain ported → examples/brandbrain-port/dist  (serve: node examples/brandbrain-port/serve.mjs)`);
