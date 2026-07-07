/**
 * REAL connector end-to-end through the daemon: the actual ClaudeCodeBackend + real Gate, a prefix
 * grant of the inherited claude.ai Higgsfield connector, agentic generation. Proves relay can make
 * a REAL image via the user's connector — no bridge. Spends ~2 credits.
 *
 * Run: node packages/sidekick/spike/connector-e2e.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gate } from "../dist/security/gate.js";
import { GrantStore } from "../dist/security/grant-store.js";
import { BudgetLedger } from "../dist/security/budgets.js";
import { AuditLog } from "../dist/security/audit-log.js";
import { McpRegistry } from "../dist/mcp/registry.js";
import { ClaudeCodeBackend } from "../dist/backends/claude-code.js";

const ORIGIN = "https://prism.example";
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";
const dir = mkdtempSync(join(tmpdir(), "relay-conn-"));

const consent = {
  requestWriteConsent: async (r) => { console.error(`   🔐 WRITE consent: ${r.tool.name}(${JSON.stringify(r.tool.arguments).slice(0, 80)}) → APPROVE`); return true; },
  requestConnectConsent: async () => null,
};

const grants = new GrantStore(dir);
const budgets = new BudgetLedger();
const audit = new AuditLog(dir);
const mcp = await McpRegistry.boot({ servers: {} });
const gate = new Gate(grants, budgets, audit, consent, mcp);

// Grant the whole Higgsfield connector (wildcard). generate_* → write (consent), poll tools → read.
grants.upsert(ORIGIN, {
  models: ["sonnet"],
  tools: [{ name: CONNECTOR, access: "write" }],
  budgets: { maxTokensPerDay: 2_000_000, maxCallsPerMin: 120 },
});

const backend = new ClaudeCodeBackend();
const controller = new AbortController();
let imageUrl = null;
let text = "";
const ctx = {
  origin: ORIGIN,
  allowedTools: gate.allowedToolsFor(ORIGIN),
  authorizeToolCall: (call) => gate.authorize(ORIGIN, call).then((d) => (d.allow ? { allow: true } : { allow: false, message: d.message })),
  gateToolCall: (call) => gate.gateToolCall(ORIGIN, call),
  mcpServers: {}, // no local servers — the SDK inherits the claude.ai connector on its own
  emit: (d) => {
    if (d.type === "tool_proposed") console.error(`   🛠  ${d.call.name}(${JSON.stringify(d.call.arguments).slice(0, 70)})`);
    if (d.type === "tool_result" && d.result.ok) {
      const t = (d.result.content ?? []).map((c) => c.text ?? "").join("");
      const m = t.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)/i) || t.match(/"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/);
      if (m) imageUrl = m[1] ?? m[0];
    }
    if (d.type === "text") process.stdout.write(d.text);
  },
  signal: controller.signal,
};

const timeout = setTimeout(() => { console.error("\nTIMEOUT"); process.exit(2); }, 180_000);
console.error(`Generating a real image via ${CONNECTOR} through the daemon…\n`);
const out = await backend.run({
  prompt: "Use the Higgsfield generate_image tool to generate an image of 'a single ripe strawberry on a white studio background, macro, soft light', aspect_ratio 1:1. Wait for it to finish (poll if needed), then reply with the final image URL on its own line.",
  agentic: true, model: "sonnet",
}, ctx);
clearTimeout(timeout);
text = out.text;

// Fallback: pull a URL from the model's final text if we didn't catch it in a tool_result.
if (!imageUrl) { const m = text.match(/https?:\/\/\S+/); if (m) imageUrl = m[0].replace(/[)\].,]+$/, ""); }

console.error("\n\n================ VERDICT ================");
console.error(`real image generated through relay: ${imageUrl ? "YES" : "NO"}`);
if (imageUrl) console.error(`   ${imageUrl}`);
console.error(imageUrl ? "\n✅ CONNECTOR WORKS — relay reached your claude.ai Higgsfield connector, no bridge." : "\n❌ no image URL captured");
process.exit(imageUrl ? 0 : 1);
