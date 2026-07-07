/**
 * Audit records. The daemon appends one per request and per tool call, per origin. The log is
 * viewable + exportable in the extension popup and underpins the kill switch and revoke UX.
 */
import type { ConsentDecision } from "./tools.js";

export interface AuditEntry {
  id: string;
  ts: number;
  origin: string;
  kind: "request" | "tool_call" | "consent" | "connect" | "revoke";
  method?: string;
  toolName?: string;
  /** For tool_call/consent entries. */
  decision?: ConsentDecision;
  /** Coarse outcome for quick scanning. */
  outcome: "ok" | "denied" | "error";
  /** Tokens attributed, if any — feeds the daily budget view. */
  tokens?: number;
  /** Short, non-sensitive detail. Never store raw MCP credentials or full tool payloads. */
  note?: string;
}
