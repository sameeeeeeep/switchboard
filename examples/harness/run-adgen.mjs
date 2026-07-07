/**
 * Run the AD GENERATOR example end-to-end through the real daemon — the "full AI + connectors"
 * demo. One origin (adgen.example) connects, then an agentic run:
 *   • WebFetch (read)         → reads the target website  [auto-approved]
 *   • model reasons           → extracts the brand
 *   • generate_image (write)  → Higgsfield (mock) makes 3 ads  [per-action consent, approved]
 *
 * Uses a MOCK Higgsfield MCP (examples/harness/mock-higgsfield.mjs) that returns real placeholder
 * image URLs. Point ~/.relay/mcp.json at the real Higgsfield connector and the same app makes real
 * ads. WebFetch is real — the model actually reads the site.
 *
 * Run: node examples/harness/run-adgen.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const URL_ARG = process.argv[2] || "https://www.anthropic.com";
const PORT = 8794;
const dir = mkdtempSync(join(tmpdir(), "relay-adgen-"));
const higgs = resolve("examples/harness/mock-higgsfield.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { higgsfield: { command: process.execPath, args: [higgs] } } }));

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("exit", () => daemon.kill("SIGKILL"));

async function token() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 50; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("no token");
}

function onConsent(kind, body) {
  if (kind === "consent:connect") {
    const { requested, available } = body.requested;
    const want = new Set(requested.tools ?? []);
    const tools = available.tools.filter((t) => want.has(t.name)).map((t) => ({ name: t.name, access: t.access }));
    console.log(`🔐 CONNECT ${body.origin} → grant ${tools.map((t) => `${t.name}[${t.access}]`).join(", ")}`);
    return { models: requested.models ?? available.models.slice(0, 1), tools, budgets: { maxTokensPerDay: 1000000, maxCallsPerMin: 120 } };
  }
  console.log(`🔐 WRITE consent → ${body.tool.name}  prompt="${String(body.tool.arguments.prompt ?? "").slice(0, 60)}…" → APPROVE`);
  return true; // approve every image generation in this demo
}

async function main() {
  const tok = await token();
  await sleep(600);
  const app = await connectAsExtension({ port: PORT, token: tok, origin: "https://adgen.example", onConsent });
  await app.request("claude_connect", { reason: "generate ads", tools: ["WebFetch", "mcp__higgsfield__generate_image"] });

  console.log(`\n🎨 Generating ads for ${URL_ARG} …\n`);
  const ads = [];
  await app.stream({
    prompt: [
      `You are an ad creative director. Target website: ${URL_ARG}`,
      `1) Use WebFetch to read that page.`,
      `2) In 3-4 lines, summarize the brand (name, what it sells, tone, 2-3 signature colors).`,
      `3) Then call generate_image exactly 3 times, each a vivid on-brand ad prompt, aspect_ratio "1:1".`,
    ].join("\n"),
    agentic: true, model: "sonnet",
  }, (d) => {
    if (d.type === "tool_proposed" && d.call.name === "WebFetch") console.log(`🌐 WebFetch(${d.call.arguments.url ?? URL_ARG}) — auto-approved read`);
    if (d.type === "tool_proposed" && d.call.name.endsWith("generate_image")) console.log(`🎨 model proposes generate_image…`);
    if (d.type === "tool_result" && d.call.name.endsWith("generate_image") && d.result.ok) {
      const txt = (d.result.content ?? []).map((c) => c.text ?? "").join("");
      try { const j = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); if (j.url) { ads.push(j.url); console.log(`   ↳ ad ready: ${j.url}`); } } catch { /* ignore */ }
    }
    if (d.type === "text") process.stdout.write(d.text);
  });

  console.log(`\n\n✅ Brand extracted + ${ads.length} ads generated through relay (real WebFetch + Higgsfield mock).`);
  ads.forEach((u, i) => console.log(`   ad ${i + 1}: ${u}`));
  daemon.kill("SIGKILL");
  process.exit(0);
}

main().catch((err) => { console.error("adgen harness error:", err); daemon.kill("SIGKILL"); process.exit(1); });
