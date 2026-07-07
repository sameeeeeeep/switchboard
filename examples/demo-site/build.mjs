/** Bundle src/demo.js (which imports @relay/sdk) into a single self-contained demo.js the page
 *  loads as a module. Mirrors how a real site would bundle the SDK with its own build. */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/demo.js"],
  bundle: true,
  format: "esm",
  target: "chrome111",
  outfile: "demo.js",
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.error("[demo] watching…");
} else {
  await build(options);
  console.error("[demo] bundled → demo.js");
}
