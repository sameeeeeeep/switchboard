/**
 * MCP-CLIENT SPIKE: prove the real McpRegistry connects a real stdio MCP server, discovers its
 * tools (server-qualified + classified), and invokes one. This is the discovery + page-initiated
 * (claude_callTool) path that Gate.gateToolCall relies on.
 *
 * Run: node packages/sidekick/spike/mcp-spike.mjs
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpRegistry } from "../dist/mcp/registry.js";
import { loadMcpConfig } from "../dist/mcp/config.js";

const dir = mkdtempSync(join(tmpdir(), "relay-mcp-"));
const serverPath = resolve("packages/sidekick/spike/test-mcp-server.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({
  servers: { test: { command: process.execPath, args: [serverPath] } },
}));

const reg = await McpRegistry.boot(loadMcpConfig(dir));

const tools = reg.all();
console.error("\nDiscovered tools:");
for (const t of tools) console.error(`  ${t.name}   access=${t.access}   (${t.description ?? ""})`);

const readName = "mcp__test__read_note";
const writeName = "mcp__test__send_note";
const haveRead = tools.some((t) => t.name === readName && t.access === "read");
const haveWrite = tools.some((t) => t.name === writeName && t.access === "write");

console.error("\nInvoking read_note directly (post-gate path)…");
const res = await reg.invoke({ name: readName, arguments: { id: "42" } });
const text = res.content?.map((c) => c.text ?? "").join("") ?? "";
console.error(`  result ok=${res.ok} content="${text}"`);

// sdkServersFor should hand back the 'test' server for an allowlist containing its tool.
const sdk = reg.sdkServersFor("https://x", [readName]);
const sdkHasTest = !!sdk.test;

await reg.close();

console.error("\n================ VERDICT ================");
console.error(`discovered read tool (classified read):   ${haveRead}   (want true)`);
console.error(`discovered write tool (classified write):  ${haveWrite}   (want true — default-deny on 'send_note')`);
console.error(`invoke returned tool result:               ${res.ok && text.includes("hello from mcp")}   (want true)`);
console.error(`sdkServersFor exposes the server:          ${sdkHasTest}   (want true)`);
const pass = haveRead && haveWrite && res.ok && text.includes("hello from mcp") && sdkHasTest;
console.error(`\n${pass ? "✅ MCP-CLIENT SPIKE PASSED — real servers discovered, classified, invoked." : "❌ FAILED"}`);
process.exit(pass ? 0 : 1);
