/**
 * Does passing a custom in-process mcpServer to query() still INHERIT the user's claude.ai
 * connectors? If adding a relay-native tool suppresses Higgsfield, the reference plan needs a
 * different shape. DENY all tools (no credits) — we only want to see what's visible.
 *
 * Run: node packages/sidekick/spike/mcp-coexist-probe.mjs
 */
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const relay = createSdkMcpServer({
  name: "relay", version: "0.0.1",
  tools: [tool("relay_ping", "A relay-native test tool.", { x: z.string() }, async () => ({ content: [{ type: "text", text: "pong" }] }))],
});

const seen = new Set();
for await (const msg of query({
  prompt: "List, by exact name, every MCP tool you can see whose name contains 'relay_' or 'generate_image' or 'Higgsfield'. Do not call any tool.",
  options: {
    model: "sonnet",
    permissionMode: "default",
    mcpServers: { relay },                       // <-- custom server present
    canUseTool: async (n) => { seen.add(n); return { behavior: "deny", message: "probe" }; },
  },
})) {
  if (msg.type === "assistant") for (const b of msg.message.content ?? []) if (b.type === "text") process.stdout.write(b.text);
}

console.error("\n\n================");
console.error("(the model's list above tells us what's visible with a custom mcpServer present)");
process.exit(0);
