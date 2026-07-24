/**
 * Run the IMAGE GENERATOR example end-to-end — the simplest connector app. No model: the page
 * calls claude_callTool("...generate_image") directly. Because generating spends credits it's a
 * WRITE, so each call hits a per-action consent (here: approved). Proves the direct tool-call path
 * through the real daemon + gate + consent, using the mock Higgsfield MCP.
 *
 * Run: node examples/harness/run-imagegen.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const PORT = 8795;
const dir = mkdtempSync(join(tmpdir(), "relay-img-"));
const higgs = resolve("examples/harness/mock-higgsfield.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { higgsfield: { command: process.execPath, args: [higgs] } } }));

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT), RELAY_IMPORT_CLAUDE: "0" },
  stdio: ["ignore", "inherit", "inherit"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("exit", () => daemon.kill("SIGKILL"));

async function token() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 50; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("no token");
}
const TOOL = "mcp__higgsfield__generate_image";
function onConsent(kind, body) {
  if (kind === "consent:connect") {
    // body.tools is already the REQUESTED set, daemon-classified: [{name, access, label}].
    return { models: [], tools: (body.tools ?? []).map((t) => ({ name: t.name, access: t.access })), budgets: { maxTokensPerDay: 1e6, maxCallsPerMin: 120 } };
  }
  console.log(`   🔐 approve generate: "${String(body.tool.arguments.prompt).slice(0, 48)}…"`);
  return true;
}

async function main() {
  const tok = await token();
  // Retry the dial: the token file lands before the WS listens (MCP + backend probes boot in
  // between) — a fixed sleep loses that race on a cold machine.
  const app = await (async () => {
    const t0 = Date.now();
    for (;;) {
      try { return await connectAsExtension({ port: PORT, token: tok, origin: "https://imagegen.example", onConsent }); }
      catch (err) { if (Date.now() - t0 > 20_000) throw err; await sleep(250); }
    }
  })();
  await app.request("claude_connect", { reason: "generate images", tools: [TOOL] });

  const prompts = [
    "A neon koi swimming through a rainy Tokyo alley, cinematic, 85mm",
    "A minimalist matcha latte on cream linen, soft morning light",
    "An astronaut planting a single lime-green flag on a charcoal dune",
  ];
  console.log(`\n🖼️  prism.example — prompt → image, ${prompts.length} generations (each consent-gated)\n`);
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    // Give the last generation a reference image to prove image-to-image rides the same gate.
    const args = { name: TOOL, arguments: { prompt, aspect_ratio: "1:1", ...(i === prompts.length - 1 ? { reference: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" } : {}) } };
    const res = await app.request("claude_callTool", args);
    const text = (res.content ?? []).map((c) => c.text ?? "").join("");
    let out = {}; try { out = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch {}
    console.log(`   ✅ ${prompt.slice(0, 38)}…  [${out.mode ?? "?"}]\n      → ${out.url ?? "?"}`);
  }
  console.log("\n✓ Direct tool calls, each gated by consent, executed on the user's Higgsfield connector.");
  daemon.kill("SIGKILL");
  process.exit(0);
}
main().catch((e) => { console.error("imagegen harness error:", e); daemon.kill("SIGKILL"); process.exit(1); });
