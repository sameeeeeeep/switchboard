import type { ToolAccess } from "@relay/protocol";

/**
 * Tool danger classification — decided HERE, out of band, never by the model and never from
 * page input. DEFAULT-DENY: any tool not known to be read-only is treated as `write`, which
 * forces per-action consent. This is deliberately conservative: a misclassified read is a
 * minor annoyance (an extra prompt); a misclassified write is a security failure.
 *
 * MCP tools don't reliably self-declare danger, so we combine:
 *   1. A curated table of known connectors (highest priority).
 *   2. Name heuristics (verbs like create/send/delete/pay ⇒ write).
 *   3. Fallback ⇒ write.
 * The user can pin any tool's class in the extension UI, which writes an override consulted
 * before this table.
 */

/** Curated per-connector overrides. Key is the server-qualified tool name. */
const CURATED: Record<string, ToolAccess> = {
  // Gmail
  "gmail__search_threads": "read",
  "gmail__get_thread": "read",
  "gmail__list_labels": "read",
  "gmail__create_draft": "write",
  "gmail__label_message": "write",
  // Shopify
  "shopify__search_products": "read",
  "shopify__get_order": "read",
  "shopify__list_orders": "read",
  "shopify__run-analytics-query": "read",
  "shopify__create-product": "write",
  "shopify__create-discount": "write",
  "shopify__set-inventory": "write",
  // Filesystem
  "fs__read_file": "read",
  "fs__list_directory": "read",
  "fs__write_file": "write",
  "fs__move_file": "write",
  // Built-ins
  "WebSearch": "read",
  "WebFetch": "read",
  // claude.ai connector: Higgsfield (image/video/audio gen). Generation SPENDS credits → write;
  // the status/poll tools an async generation needs are reads (so the model can poll without a
  // consent prompt on every check).
  "mcp__claude_ai_Higgsfield__generate_image": "write",
  "mcp__claude_ai_Higgsfield__generate_video": "write",
  "mcp__claude_ai_Higgsfield__generate_audio": "write",
  "mcp__claude_ai_Higgsfield__generate_3d": "write",
  "mcp__claude_ai_Higgsfield__media_upload": "read",
  "mcp__claude_ai_Higgsfield__media_import_url": "read",
  "mcp__claude_ai_Higgsfield__media_confirm": "read",
  "mcp__claude_ai_Higgsfield__job_status": "read",
  "mcp__claude_ai_Higgsfield__job_display": "read",
  "mcp__claude_ai_Higgsfield__creation_status": "read",
  "mcp__claude_ai_Higgsfield__show_generations": "read",
  "mcp__claude_ai_Higgsfield__models_explore": "read",
};

const WRITE_VERBS = /(create|update|delete|remove|send|pay|charge|purchase|order|set|write|move|copy|cancel|deploy|publish|revoke|transfer|update|edit|draft|post)/i;
const READ_VERBS = /^(get|list|search|read|show|find|query|fetch|describe|preview|count)/i;

/** Classify a tool. Order: pinned override → curated → heuristic → default write. */
export function classifyTool(name: string, pinned?: Record<string, ToolAccess>): ToolAccess {
  if (pinned && name in pinned) return pinned[name]!;
  if (name in CURATED) return CURATED[name]!;
  // Heuristic runs on the bare tool name — the LAST `__`-delimited segment. MCP tools are
  // `mcp__<server>__<tool>`, so the tool is the final segment, not everything after the first.
  const short = name.includes("__") ? name.split("__").pop()! : name;
  if (READ_VERBS.test(short) && !WRITE_VERBS.test(short)) return "read";
  return "write"; // default-deny
}
