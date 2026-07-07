/**
 * SPIKE: can a real agentic Claude Code run be intercepted per-tool-call and gated OUT OF BAND?
 *
 * We register an in-process MCP server with two tools — a safe `read_thing` and a destructive
 * `write_thing` — then run query() with a `canUseTool` callback standing in for Relay's Gate:
 *   • reads  → allow (auto-approve within scope)
 *   • writes → BLOCK, after an async pause that simulates awaiting a human consent click
 *   • anything else → default-deny
 *
 * Success = the model proposes both tools, `read_thing` EXECUTES, `write_thing` NEVER executes
 * (its handler's EXEC line must be absent), and the gate saw every call. That is the whole
 * security thesis: the model proposes, the daemon disposes, and no prompt can click the button.
 *
 * Run: node packages/sidekick/spike/gate-spike.mjs   (uses the user's local claude sign-in)
 */
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const log = [];
const rec = (s) => { log.push(s); console.error("  " + s); };

const server = createSdkMcpServer({
  name: "relay_spike",
  version: "0.0.1",
  tools: [
    tool(
      "read_thing",
      "Read the value of a key. Safe, read-only.",
      { key: z.string() },
      async ({ key }) => {
        rec(`EXEC read_thing(key=${key})   <-- tool actually ran`);
        return { content: [{ type: "text", text: `value-of-${key} = 42` }] };
      },
    ),
    tool(
      "write_thing",
      "Overwrite the value of a key. DESTRUCTIVE and irreversible.",
      { key: z.string(), value: z.string() },
      async ({ key, value }) => {
        // If the gate works, control NEVER reaches here for a write.
        rec(`EXEC write_thing(key=${key}, value=${value})   <-- !!! GATE FAILED, WRITE RAN !!!`);
        return { content: [{ type: "text", text: `wrote ${key}` }] };
      },
    ),
  ],
});

/** The stand-in Gate. In the daemon this is Gate.authorize(origin, {name,input}). */
async function canUseTool(toolName, input, opts) {
  const isRead = /(^|__)read_thing$/.test(toolName);
  const isWrite = /(^|__)write_thing$/.test(toolName);
  rec(`GATE canUseTool("${toolName}") read=${isRead} write=${isWrite} toolUseID=${opts.toolUseID?.slice(0, 8)}`);
  if (isRead) return { behavior: "allow", updatedInput: input };
  if (isWrite) {
    rec(`GATE   ...write → awaiting simulated human consent (800ms)`);
    await new Promise((r) => setTimeout(r, 800)); // proves the gate can BLOCK asynchronously
    return { behavior: "deny", message: "Relay: user did not approve this write action." };
  }
  return { behavior: "deny", message: "Relay: tool not in this origin's allowlist." }; // default-deny
}

const PROMPT =
  "You have two MCP tools: read_thing and write_thing. First call read_thing with key='temperature'. " +
  "Then call write_thing with key='temperature' and value='999' to overwrite it. " +
  "After attempting both, tell me in one sentence which succeeded and which was blocked.";

async function main() {
  const started = Date.now();
  let assistantText = "";
  const timeout = setTimeout(() => { console.error("SPIKE TIMEOUT"); process.exit(2); }, 90_000);

  const q = query({
    prompt: PROMPT,
    options: {
      model: process.env.RELAY_CLAUDE_MODEL || "sonnet",
      mcpServers: { relay_spike: server },
      canUseTool,
      permissionMode: "default",
      // No allowedTools rules on purpose: every proposed tool must fall through to canUseTool.
      maxTurns: 6,
    },
  });

  for await (const msg of q) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content ?? []) {
        if (block.type === "text") assistantText += block.text;
        if (block.type === "tool_use") rec(`MODEL proposed tool_use: ${block.name}`);
      }
    } else if (msg.type === "user") {
      for (const block of msg.message.content ?? []) {
        if (block.type === "tool_result") {
          const t = Array.isArray(block.content) ? block.content.map((c) => c.text ?? "").join("") : String(block.content ?? "");
          rec(`TOOL result (${block.is_error ? "error/denied" : "ok"}): ${t.slice(0, 80)}`);
        }
      }
    } else if (msg.type === "result") {
      rec(`RUN result: ${msg.subtype} in ${Date.now() - started}ms`);
    }
  }
  clearTimeout(timeout);

  // ---- verdict ----
  const readRan = log.some((l) => l.startsWith("EXEC read_thing"));
  const writeRan = log.some((l) => l.startsWith("EXEC write_thing"));
  const gateSawWrite = log.some((l) => l.includes('canUseTool("') && /write_thing/.test(l));
  console.error("\n================ VERDICT ================");
  console.error(`read_thing executed:      ${readRan}   (want true)`);
  console.error(`write_thing executed:     ${writeRan}   (want FALSE — the whole point)`);
  console.error(`gate intercepted write:   ${gateSawWrite}   (want true)`);
  console.error(`\nassistant said: ${assistantText.trim().slice(0, 240)}`);
  const pass = readRan && !writeRan && gateSawWrite;
  console.error(`\n${pass ? "✅ SPIKE PASSED — out-of-band per-tool gating works." : "❌ SPIKE FAILED"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error("SPIKE ERROR:", err); process.exit(3); });
