/** A minimal stdio MCP server for the MCP-client spike: one read tool, one write tool. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "test", version: "0.0.1" });

server.registerTool(
  "read_note",
  { description: "Read a note by id. Read-only.", inputSchema: { id: z.string() } },
  async ({ id }) => ({ content: [{ type: "text", text: `note[${id}] = "hello from mcp"` }] }),
);

server.registerTool(
  "send_note",
  { description: "Send a note to someone. Delivers a message (write/irreversible).", inputSchema: { to: z.string(), body: z.string() } },
  async ({ to, body }) => ({ content: [{ type: "text", text: `sent to ${to}: ${body}` }] }),
);

await server.connect(new StdioServerTransport());
