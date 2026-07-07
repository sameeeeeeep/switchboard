import type { CompletionParams, StreamDelta, ToolCallRequest, ToolCallResult } from "@relay/protocol";

/**
 * A model backend. Claude Code is the reference; local OpenAI-compatible runners (Ollama,
 * LM Studio, llama.cpp) are siblings. The provider surface (window.claude) is identical
 * regardless of which backend serves a request — this is what lets relay route "any local
 * model or a Claude subscription" through one broker (the app-store vision).
 *
 * CRITICAL: backends do NOT make policy decisions. During an agentic run a backend routes
 * EVERY proposed tool call through `ctx.gateToolCall`, which is the daemon's out-of-band
 * gate (scope + budget + per-action consent). A backend that ignored the gate would be a
 * security hole, so the tool-execution path must live in the daemon, not the backend — a
 * backend only decides *which* tool it wants, never *whether* it may run.
 */
export interface BackendRunContext {
  /** The browser-verified origin this run is attributed to. */
  origin: string;
  /**
   * AUTHORIZE-ONLY gate for backends where the runtime executes the tool itself after approval
   * — notably the Agent SDK's `canUseTool`. Runs full policy (scope, allowlist, budget,
   * per-action write consent) and returns allow/deny WITHOUT running the tool. The backend maps
   * a denial into its own refusal shape (e.g. SDK `{behavior:'deny'}`). Never bypass.
   */
  authorizeToolCall: (call: ToolCallRequest) => Promise<{ allow: boolean; message?: string }>;
  /** AUTHORIZE-AND-EXECUTE gate for backends that run their OWN tool loop (e.g. the local
   *  OpenAI backend parsing tool_calls). Resolves to the tool result or a denial. */
  gateToolCall: (call: ToolCallRequest) => Promise<ToolCallResult>;
  /** The exact allowlisted, server-qualified tool names this origin may use. Empty = non-agentic. */
  allowedTools: string[];
  /** MCP servers to expose to the runtime for the agentic loop (creds stay here, never to page). */
  mcpServers?: Record<string, unknown>;
  /** Emit a streaming delta to the page. */
  emit: (delta: StreamDelta) => void;
  /** Abort signal for cancellation (claude_cancel / kill switch). */
  signal: AbortSignal;
}

export interface ModelBackend {
  /** Stable id used in model routing + capabilities, e.g. "claude-code", "ollama". */
  id: string;
  /** Model ids this backend can currently serve. */
  listModels(): Promise<string[]>;
  /** True if the backend is reachable right now (CLI present / local server up). */
  healthy(): Promise<boolean>;
  /** Run a (possibly agentic, possibly streaming) completion. The backend pushes deltas via
   *  ctx.emit and returns the final text. Throws on backend error; the daemon maps to BYOP. */
  run(params: CompletionParams, ctx: BackendRunContext): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;
}
