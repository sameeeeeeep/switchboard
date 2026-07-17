import { build, context } from "esbuild";
const watch = process.argv.includes("--watch");
const options = {
  entryPoints: { home: "src/home.js", bank: "src/bank.js", chat: "src/chat.js", adgen: "src/adgen.js", imagegen: "src/imagegen.js", persona: "src/persona.js", cartridge: "src/cartridge.js", adpulse: "src/adpulse.js", adforge: "src/adforge.js", shelf: "src/shelf.js", studio: "src/studio.js", aplus: "src/aplus.js", natal: "src/natal.js", arcana: "src/arcana.js", redline: "src/redline.js", batch: "src/batch.js", take: "src/take.js", identity: "src/identity.js", reel: "src/reel.js", marquee: "src/marquee.js", huddle: "src/huddle.js" },
  bundle: true, format: "esm", target: "chrome111", outdir: "dist", sourcemap: true, logLevel: "info",
};
if (watch) { const ctx = await context(options); await ctx.watch(); console.error("[apps] watching…"); }
else { await build(options); console.error("[apps] bundled → dist/"); }
