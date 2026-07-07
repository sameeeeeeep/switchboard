/**
 * REFERENCE end-to-end: prove the general "local file → remote connector" primitive. Attach a
 * reference image, and the model runs Higgsfield's own upload flow using relay's native put_blob to
 * PUT the bytes: media_upload → relay__put_blob → media_confirm → generate_image(medias) → poll.
 * Spends ~2 credits.
 *
 * Run: node packages/sidekick/spike/connector-ref-e2e.mjs [path-to-reference-image]
 */
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gate } from "../dist/security/gate.js";
import { GrantStore } from "../dist/security/grant-store.js";
import { BudgetLedger } from "../dist/security/budgets.js";
import { AuditLog } from "../dist/security/audit-log.js";
import { McpRegistry } from "../dist/mcp/registry.js";
import { ClaudeCodeBackend } from "../dist/backends/claude-code.js";
import { relayNativeServer } from "../dist/backends/relay-native.js";

const REF = process.argv[2] || "/private/tmp/claude-501/-Users-sameeprehlan-Documents-Projects-relay/fd280540-6d0e-4def-95c5-6f7fe6487c63/scratchpad/strawberry.png";
if (!existsSync(REF)) { console.error("reference image not found:", REF); process.exit(2); }
const dataUrl = "data:image/png;base64," + readFileSync(REF).toString("base64");

const ORIGIN = "https://prism.example";
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";
const dir = mkdtempSync(join(tmpdir(), "relay-ref-"));

const consent = { requestWriteConsent: async (r) => { console.error(`   🔐 WRITE consent: ${r.tool.name} → APPROVE`); return true; }, requestConnectConsent: async () => null };
const grants = new GrantStore(dir);
const gate = new Gate(grants, new BudgetLedger(), new AuditLog(dir), consent, await McpRegistry.boot({ servers: {} }));
grants.upsert(ORIGIN, { models: ["sonnet"], tools: [{ name: CONNECTOR, access: "write" }], budgets: { maxTokensPerDay: 3e6, maxCallsPerMin: 200 } });

const attachments = new Map([["ref", { handle: "ref", filename: "ref.png", contentType: "image/png", dataUrl }]]);
const backend = new ClaudeCodeBackend();
let imageUrl = null;
const ctx = {
  origin: ORIGIN,
  allowedTools: gate.allowedToolsFor(ORIGIN),
  authorizeToolCall: (call) => gate.authorize(ORIGIN, call).then((d) => (d.allow ? { allow: true } : { allow: false, message: d.message })),
  gateToolCall: (call) => gate.gateToolCall(ORIGIN, call),
  mcpServers: { relay: relayNativeServer(attachments) }, // + SDK inherits the claude.ai connector
  emit: (d) => {
    if (d.type === "tool_proposed") console.error(`   🛠  ${d.call.name}`);
    if (d.type === "tool_result" && d.result.ok) {
      const t = (d.result.content ?? []).map((c) => c.text ?? "").join("");
      const m = t.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)/i) || t.match(/"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/);
      if (m) imageUrl = m[1] ?? m[0];
    }
    if (d.type === "text") process.stdout.write(d.text);
  },
  signal: new AbortController().signal,
};

const instruction =
  `Generate an image of: "a bowl of ripe strawberries on a marble counter, natural light", aspect_ratio "1:1", guided by a reference image.\n` +
  `The reference is attached as relay handle "ref". Do EXACTLY:\n` +
  `1) Higgsfield media_upload({ filename:"ref.png", content_type:"image/png" }) → get a presigned upload URL.\n` +
  `2) relay put_blob({ handle:"ref", url:<that URL> }) to upload the bytes (do NOT use bash/curl).\n` +
  `3) Higgsfield media_confirm as the upload result instructs → media_id.\n` +
  `4) Higgsfield generate_image with the prompt and that media_id as a reference in medias.\n` +
  `5) Poll job status until done, then reply with ONLY the final image URL.`;

const timeout = setTimeout(() => { console.error("\nTIMEOUT"); process.exit(2); }, 240_000);
console.error("Reference-guided generation through relay…\n");
const out = await backend.run({ prompt: instruction, agentic: true, model: "sonnet" }, ctx);
clearTimeout(timeout);
if (!imageUrl) { const m = out.text.match(/https?:\/\/\S+/); if (m) imageUrl = m[0].replace(/[)\].,]+$/, ""); }

console.error("\n\n================ VERDICT ================");
console.error(`reference-guided image via relay: ${imageUrl ? "YES" : "NO"}`);
if (imageUrl) console.error(`   ${imageUrl}`);
console.error(imageUrl ? "\n✅ put_blob upload + reference generation worked end-to-end." : "\n❌ no image URL");
process.exit(imageUrl ? 0 : 1);
