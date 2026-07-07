/**
 * PROBE: does the Claude Agent SDK — run the way relay's daemon runs it — inherit the user's
 * claude.ai connectors (Higgsfield, Shopify, …)? If yes, relay's agentic path can reach them with
 * no bridge. We DENY every proposed tool so nothing executes (no credits spent); we only want to
 * see WHICH tool names the model is offered.
 *
 * Run: node packages/sidekick/spike/connector-probe.mjs
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const proposed = new Set();

async function probe(label, options) {
  proposed.clear();
  console.error(`\n=== ${label} ===`);
  let text = "";
  try {
    for await (const msg of query({
      prompt:
        "Do you have any MCP image-generation tool available (e.g. a Higgsfield generate_image tool, or any tool whose name contains 'generate_image' or 'image')? " +
        "If yes, attempt to call it once to generate 'a red apple' — I will decline the actual call, I just need to see the tool. " +
        "Then list, by exact name, every MCP tool you can see. Keep it short.",
      options: {
        model: "sonnet",
        permissionMode: "default",
        canUseTool: async (name) => { proposed.add(name); return { behavior: "deny", message: "probe: declined" }; },
        ...options,
      },
    })) {
      if (msg.type === "assistant") for (const b of msg.message.content ?? []) { if (b.type === "text") text += b.text; if (b.type === "tool_use") proposed.add(b.name); }
    }
  } catch (err) {
    console.error("  query error:", String(err).slice(0, 200));
  }
  console.error("  tools the model proposed/saw:", [...proposed].length ? [...proposed].join(", ") : "(none)");
  console.error("  model said:", text.trim().slice(0, 400));
}

// 1) default (however the daemon's ClaudeCodeBackend runs it today)
await probe("default options", {});
// 2) explicitly load user + project settings (where MCP config / connectors live)
await probe("settingSources: user+project", { settingSources: ["user", "project"] });

process.exit(0);
