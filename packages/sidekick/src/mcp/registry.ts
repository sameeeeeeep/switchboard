import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolCallRequest, ToolCallResult, ToolDescriptor } from "@relay/protocol";
import { classifyTool } from "../security/classifier.js";
import { isHttp, type RelayMcpConfig, type RelayMcpServer } from "./config.js";

/**
 * Owns the user's connected MCP servers and is the ONLY place tools actually execute. Raw MCP
 * credentials live in these connections (on the user's machine) and never leave; a page receives
 * tool RESULTS only.
 *
 * Two consumers:
 *   • Discovery + page-initiated calls (claude_listTools / claude_callTool) use this registry's
 *     own Client connections directly, via all()/invoke().
 *   • The gated agentic loop lets the Agent SDK load the (allowlisted) servers itself via
 *     sdkServersFor(); the SDK executes their tools after canUseTool approves. Same creds, same
 *     machine. The gate (Gate.authorize) governs BOTH paths, so exposing a whole server to the
 *     SDK is safe — the allowlist is enforced at the gate, not by hiding tools.
 *
 * Tools are namespaced `mcp__<serverId>__<toolName>` — the exact convention the Agent SDK uses,
 * so grant allowlists, classifier keys, and canUseTool names all line up across both paths.
 */
interface Registered {
  serverId: string;
  rawName: string;
  client: Client;
}

export class McpRegistry {
  private tools = new Map<string, ToolDescriptor>();
  private routes = new Map<string, Registered>();
  private clients = new Map<string, Client>();
  private configs: Record<string, RelayMcpServer> = {};

  static async boot(config: RelayMcpConfig): Promise<McpRegistry> {
    const reg = new McpRegistry();
    reg.configs = config.servers;
    await Promise.all(
      Object.entries(config.servers).map(([id, spec]) => reg.connect(id, spec).catch((err) => {
        // A server that fails to start must not crash the daemon — it just offers no tools.
        console.error(`[mcp] server "${id}" failed to connect:`, String(err).slice(0, 160));
      })),
    );
    console.error(`[mcp] connected ${reg.clients.size}/${Object.keys(config.servers).length} servers, ${reg.tools.size} tools`);
    return reg;
  }

  private async connect(serverId: string, spec: RelayMcpServer): Promise<void> {
    const client = new Client({ name: `relay-${serverId}`, version: "0.0.1" }, { capabilities: {} });
    const transport = isHttp(spec)
      ? new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: spec.headers } })
      : new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) } });
    await client.connect(transport);
    this.clients.set(serverId, client);

    const { tools } = await client.listTools();
    for (const t of tools) {
      const name = `mcp__${serverId}__${t.name}`;
      this.tools.set(name, {
        name,
        server: serverId,
        title: t.title ?? t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        access: classifyTool(name),
      });
      this.routes.set(name, { serverId, rawName: t.name, client });
    }
  }

  /** All discovered tools (unfiltered by origin). The server filters + classifies per origin. */
  all(): ToolDescriptor[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDescriptor | null {
    return this.tools.get(name) ?? null;
  }

  /**
   * Execute a tool directly against its owning MCP server. Called ONLY after the gate has
   * approved (Gate.gateToolCall for the page-initiated path). Never call from anywhere else.
   */
  async invoke(call: ToolCallRequest): Promise<ToolCallResult> {
    const route = this.routes.get(call.name);
    if (!route) return { ok: false, error: { code: "unknown_tool", message: `no such tool ${call.name}` } };
    try {
      const res = await route.client.callTool({ name: route.rawName, arguments: call.arguments });
      return {
        ok: !(res.isError === true),
        content: (res.content as Array<{ type: string; [k: string]: unknown }>) ?? [],
        ...(res.isError ? { error: { code: "tool_error", message: "tool returned an error" } } : {}),
      };
    } catch (err) {
      return { ok: false, error: { code: "invoke_failed", message: String(err).slice(0, 160) } };
    }
  }

  /**
   * The Agent-SDK-shaped `mcpServers` map for an agentic run — the subset of servers that own at
   * least one of the origin's allowlisted tools. Passed straight through (our config format
   * mirrors the SDK's). `alwaysLoad` so the tools are present when the turn is built and gating
   * is deterministic. The SDK connects these itself and executes their tools after the gate OKs.
   */
  sdkServersFor(_origin: string, allowedToolNames: string[]): Record<string, unknown> {
    const wantedServers = new Set<string>();
    for (const name of allowedToolNames) {
      const route = this.routes.get(name);
      if (route) wantedServers.add(route.serverId);
    }
    const out: Record<string, unknown> = {};
    for (const id of wantedServers) {
      const spec = this.configs[id];
      if (!spec) continue;
      out[id] = isHttp(spec)
        ? { type: "http", url: spec.url, headers: spec.headers, alwaysLoad: true }
        : { type: "stdio", command: spec.command, args: spec.args, env: spec.env, alwaysLoad: true };
    }
    return out;
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close().catch(() => {})));
    this.clients.clear();
    this.routes.clear();
    this.tools.clear();
  }
}
