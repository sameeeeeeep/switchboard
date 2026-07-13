/**
 * Bundles the extension into self-contained files a browser can load. TypeScript's `tsc` leaves
 * bare imports like `@relay/protocol` in place — which a browser extension can't resolve — so we
 * bundle each entry point with esbuild (IIFE, no external imports). `tsc --noEmit` still runs via
 * `npm run typecheck` for type safety; this script only produces the loadable JS.
 *
 * Usage: node build.mjs [--watch]
 */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    background: "src/background.ts", // MV3 service worker
    content: "src/content.ts",       // ISOLATED-world content script
    inject: "src/inject.ts",         // MAIN-world provider injection
    sidepanel: "src/sidepanel.ts",   // the primary control surface
  },
  bundle: true,
  format: "iife",           // self-contained; works for SW, content scripts, and page scripts
  target: "chrome111",
  outdir: "dist",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.error("[extension] watching…");
} else {
  await build(options);
  console.error("[extension] bundled → dist/");
}
