/**
 * INTEGRATION SPIKE: run the REAL daemon gate path end-to-end.
 *
 * Unlike gate-spike.mjs (which used an inline canUseTool), this wires the ACTUAL compiled
 * ClaudeCodeBackend → the ACTUAL Gate → ACTUAL GrantStore + BudgetLedger + AuditLog + classifier.
 * Only the consent prompter and the MCP server are stubbed. It proves the wired daemon enforces:
 *   • a tool NOT in the origin's grant → denied at the allowlist step (never reaches the model's hands)
 *   • a granted READ (pinned) → auto-approved, executes
 *   • a granted WRITE → routed to consent; our stub prompter DENIES → tool never executes
 *
 * Run: node packages/sidekick/spike/integration-spike.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { Gate } from "../dist/security/gate.js";
import { GrantStore } from "../dist/security/grant-store.js";
import { BudgetLedger } from "../dist/security/budgets.js";
import { AuditLog } from "../dist/security/audit-log.js";
import { McpRegistry } from "../dist/mcp/registry.js";
import { ClaudeCodeBackend } from "../dist/backends/claude-code.js";

const ORIGIN = "https://demo.test";
const exec = [];

// In-process MCP server standing in for a real connected server (e.g. a filesystem or Shopify MCP).
const server = createSdkMcpServer({
  name: "relay_spike", version: "0.0.1",
  tools: [
    tool("read_thing", "Read a key. Read-only.", { key: z.string() },
      async ({ key }) => { exec.push(`read_thing(${key})`); return { content: [{ type: "text", text: `${key}=42` }] }; }),
    tool("write_thing", "Overwrite a key. Destructive.", { key: z.string(), value: z.string() },
      async ({ key, value }) => { exec.push(`write_thing(${key}=${value})`); return { content: [{ type: "text", text: `wrote ${key}` }] }; }),
    tool("delete_everything", "Delete all data. Not granted to this origin.", { confirm: z.boolean() },
      async () => { exec.push(`delete_everything`); return { content: [{ type: "text", text: "deleted" }] }; }),
  ],
});

// Stub consent prompter: approves connect, DENIES every write (simulating the user clicking "deny").
const consent = {
  requestWriteConsent: async () => { console.error("  [consent] write prompt → user DENIES"); return false; },
  requestConnectConsent: async () => null,
};

const dir = mkdtempSync(join(tmpdir(), "relay-int-"));
const grants = new GrantStore(dir);
const budgets = new BudgetLedger();
const audit = new AuditLog(dir);
const mcp = await McpRegistry.boot([]);

// Pin classifications so read_thing is a READ (default-deny would otherwise make it a write).
const pinned = { "mcp__relay_spike__read_thing": "read", "mcp__relay_spike__write_thing": "write" };
const gate = new Gate(grants, budgets, audit, consent, mcp, pinned);

// Grant the origin: model + read_thing + write_thing. NOTE: delete_everything is deliberately NOT granted.
grants.upsert(ORIGIN, {
  models: ["sonnet"],
  tools: [
    { name: "mcp__relay_spike__read_thing", access: "read" },
    { name: "mcp__relay_spike__write_thing", access: "write" },
  ],
  budgets: { maxTokensPerDay: 500_000, maxCallsPerMin: 60 },
});

const backend = new ClaudeCodeBackend();
const controller = new AbortController();
const emitted = [];
const ctx = {
  origin: ORIGIN,
  allowedTools: gate.allowedToolsFor(ORIGIN),
  authorizeToolCall: (call) => gate.authorize(ORIGIN, call).then((d) => (d.allow ? { allow: true } : { allow: false, message: d.message })),
  gateToolCall: (call) => gate.gateToolCall(ORIGIN, call),
  mcpServers: { relay_spike: server },
  emit: (d) => { emitted.push(d.type); if (d.type === "tool_proposed") console.error(`  [emit] tool_proposed: ${d.call.name}`); if (d.type === "tool_result" && !d.result.ok) console.error(`  [emit] tool_result DENIED: ${d.call.name} — ${d.result.error?.message}`); },
  signal: controller.signal,
};

const PROMPT =
  "You have MCP tools read_thing, write_thing, and delete_everything. Do all three IN ORDER: " +
  "1) read_thing key='temp'. 2) write_thing key='temp' value='999'. 3) delete_everything confirm=true. " +
  "Then state in one sentence which succeeded and which were blocked.";

const timeout = setTimeout(() => { console.error("TIMEOUT"); process.exit(2); }, 90_000);
console.error("Running real backend through real Gate…\n");
const out = await backend.run({ prompt: PROMPT, model: "sonnet", agentic: true }, ctx);
clearTimeout(timeout);

console.error("\n================ VERDICT ================");
const readRan = exec.some((e) => e.startsWith("read_thing"));
const writeRan = exec.some((e) => e.startsWith("write_thing"));
const deleteRan = exec.some((e) => e.startsWith("delete_everything"));
console.error(`granted READ executed:        ${readRan}   (want true)`);
console.error(`granted WRITE executed:       ${writeRan}   (want FALSE — consent denied)`);
console.error(`UNGRANTED delete executed:    ${deleteRan}   (want FALSE — not in allowlist)`);
console.error(`\nassistant: ${out.text.trim().slice(0, 220)}`);
const pass = readRan && !writeRan && !deleteRan;
console.error(`\n${pass ? "✅ INTEGRATION PASSED — the wired daemon gate enforces scope + consent." : "❌ FAILED"}`);
process.exit(pass ? 0 : 1);
