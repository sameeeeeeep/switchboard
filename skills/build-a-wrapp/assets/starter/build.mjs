// Bundle app.js (which imports @relay/sdk) → dist/app.js, loaded by index.html.
// `npm run dev` rebuilds on change; `npm run build` does a one-shot build.
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: { app: "app.js" },
  bundle: true,
  format: "esm",
  target: "chrome111",
  outdir: "dist",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.error("[wrapp] watching…");
} else {
  await build(options);
  console.error("[wrapp] bundled → dist/");
}
