/**
 * Tool discovery + invocation types. Tools come from the daemon's connected MCP servers
 * (Shopify, Gmail, Meta, filesystem, …) plus a few built-ins (WebSearch/WebFetch). The
 * daemon assigns each a danger class from its policy table; the page only ever sees the
 * subset its origin is allowed to see.
 */
import type { ToolAccess } from "./permissions.js";

/** A tool as exposed to a page via claude_listTools. Note: the access class is included so
 *  the SDK can warn a developer that a call will trigger a per-action consent popup. */
export interface ToolDescriptor {
  /** Server-qualified name, unique per daemon, e.g. "shopify__create_order". */
  name: string;
  /** Originating MCP server id, or "builtin". */
  server: string;
  title?: string;
  description?: string;
  /** JSON Schema for the tool's arguments, passed through from the MCP server. */
  inputSchema?: Record<string, unknown>;
  access: ToolAccess;
}

/** A tool invocation the PAGE requests explicitly via claude_callTool, OR that the model
 *  proposes inside a gated agentic completion. Either way it hits the same consent gate. */
export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/** Result of a tool invocation. `content` mirrors MCP tool result content blocks. The page
 *  receives results only — never the raw MCP credentials that produced them. */
export interface ToolCallResult {
  ok: boolean;
  content?: Array<{ type: string; [k: string]: unknown }>;
  /** Present when ok === false. */
  error?: { code: string; message: string };
}

/** How a proposed tool call was resolved by the gate — recorded in the audit log. */
export type ConsentDecision = "auto-approved" | "user-approved" | "user-denied" | "blocked";
