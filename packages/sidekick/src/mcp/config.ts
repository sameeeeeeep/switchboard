import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The user's MCP servers, loaded from ~/.relay/mcp.json. These are the tools relay lends to
 * sites — Gmail, Shopify, filesystem, etc. The file lives on the user's machine and its
 * credentials (env, headers, tokens) NEVER leave it: the daemon connects the servers locally and
 * only ever hands tool RESULTS to a page.
 *
 * Format (mirrors the Agent SDK's mcpServers shape so we can pass configs straight through):
 *   {
 *     "servers": {
 *       "filesystem": { "command": "npx", "args": ["-y","@modelcontextprotocol/server-filesystem","/Users/me/docs"] },
 *       "gmail":      { "url": "https://mcp.example/gmail", "headers": { "authorization": "Bearer …" } }
 *     }
 *   }
 */
export type RelayStdioServer = { command: string; args?: string[]; env?: Record<string, string> };
export type RelayHttpServer = { url: string; headers?: Record<string, string> };
export type RelayMcpServer = RelayStdioServer | RelayHttpServer;

export interface RelayMcpConfig {
  servers: Record<string, RelayMcpServer>;
}

export function isHttp(s: RelayMcpServer): s is RelayHttpServer {
  return "url" in s;
}

/** Normalize a Claude Code / MCP server entry into relay's shape (or null if unsupported). */
function normalizeServer(spec: any): RelayMcpServer | null {
  if (!spec || typeof spec !== "object") return null;
  if (spec.url || spec.type === "http" || spec.type === "sse") {
    return spec.url ? { url: spec.url, headers: spec.headers } : null;
  }
  if (spec.command) return { command: spec.command, args: spec.args, env: spec.env };
  return null;
}

/**
 * Auto-import the user's EXISTING Claude Code MCP servers from ~/.claude.json — global and
 * per-project — so relay inherits them with zero re-configuration (the "capability inheritance"
 * promise). NOTE: this covers LOCAL MCP servers (added via `claude mcp add`). It does NOT cover
 * claude.ai *connectors* (Higgsfield, Shopify, Gmail, …), which are remote OAuth integrations held
 * server-side by claude.ai, not in any local file — those need a separate bridge.
 */
export function importClaudeCodeServers(): Record<string, RelayMcpServer> {
  const file = join(homedir(), ".claude.json");
  if (!existsSync(file)) return {};
  const out: Record<string, RelayMcpServer> = {};
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as any;
    const collect = (servers: any) => {
      for (const [name, spec] of Object.entries(servers ?? {})) {
        const norm = normalizeServer(spec);
        if (norm && !(name in out)) out[name] = norm;
      }
    };
    collect(c.mcpServers);                                    // global
    for (const proj of Object.values(c.projects ?? {})) collect((proj as any)?.mcpServers); // per-project
  } catch (err) {
    console.error("[mcp] failed to import ~/.claude.json:", err);
  }
  return out;
}

/**
 * Relay's effective MCP config = the user's existing Claude Code servers (auto-imported) OVERLAID
 * by ~/.relay/mcp.json (relay-specific additions/overrides win). So the common case is: add
 * nothing — your Claude tools just show up. Set RELAY_IMPORT_CLAUDE=0 to disable auto-import.
 */
export function loadMcpConfig(stateDir: string): RelayMcpConfig {
  const imported = process.env.RELAY_IMPORT_CLAUDE === "0" ? {} : importClaudeCodeServers();
  let own: Record<string, RelayMcpServer> = {};
  const file = join(stateDir, "mcp.json");
  if (existsSync(file)) {
    try {
      own = (JSON.parse(readFileSync(file, "utf8")) as Partial<RelayMcpConfig>).servers ?? {};
    } catch (err) {
      console.error("[mcp] failed to parse mcp.json:", err);
    }
  }
  return { servers: { ...imported, ...own } };
}
