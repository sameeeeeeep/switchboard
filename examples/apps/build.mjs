import { build, context } from "esbuild";
const watch = process.argv.includes("--watch");
const options = {
  entryPoints: { chat: "src/chat.js", assistant: "src/assistant.js", adgen: "src/adgen.js", imagegen: "src/imagegen.js", brandbrain: "src/brandbrain.js" },
  bundle: true, format: "esm", target: "chrome111", outdir: "dist", sourcemap: true, logLevel: "info",
};
if (watch) { const ctx = await context(options); await ctx.watch(); console.error("[apps] watching…"); }
else { await build(options); console.error("[apps] bundled → dist/"); }
