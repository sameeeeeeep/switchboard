import type { CompletionParams, StreamDelta, ToolCallRequest, ToolCallResult, ToolDescriptor } from "@relay/protocol";

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
  gateToolCall: (call: ToolCallRequest, signal?: AbortSignal) => Promise<ToolCallResult>;
  /** The exact allowlisted, server-qualified tool names this origin may use. Empty = non-agentic. */
  allowedTools: string[];
  /** Broker-discovered MCP tool schemas. Execution still goes through gateToolCall. */
  tools?: ToolDescriptor[];
  /** MCP servers to expose to the runtime for the agentic loop (creds stay here, never to page). */
  mcpServers?: Record<string, unknown>;
  /** Emit a streaming delta to the page. */
  emit: (delta: StreamDelta) => void;
  /** Abort signal for cancellation (claude_cancel / kill switch). */
  signal: AbortSignal;
  /** A prior SDK session UUID to RESUME (real warm thread — the Agent SDK threads the conversation,
   *  incl. prior turns + prompt caching, while this turn still carries live vision). Daemon-owned and
   *  keyed by (origin, sessionId) — never page-settable, so a page can't resume someone else's thread. */
  resumeSessionId?: string;
}

export interface ModelBackend {
  /** Stable id used in model routing + capabilities, e.g. "claude-code", "ollama". */
  id: string;
  /** True for a HOSTED backend that routes prompts through a third party (e.g. OpenRouter) — the
   *  opposite of BYO-local. The daemon surfaces this so the panel can badge the trust trade
   *  honestly ("prompts routed through a provider") and never default to it. Absent = local/BYO. */
  hosted?: boolean;
  capabilities?: { vision: boolean; agentic: boolean; warmSessions?: boolean };
  defaultModel?(): string | undefined;
  endSession?(origin: string, sessionId: string): Promise<void>;
  close?(): void;
  /** Model ids this backend can currently serve. */
  listModels(): Promise<string[]>;
  /** True if the backend is reachable right now (CLI present / local server up). */
  healthy(): Promise<boolean>;
  /** Rung 4 (STATES.md §4): whether this backend is not just present but ACTUALLY USABLE — for BYO
   *  Claude Code that means signed in, which `healthy()` deliberately does NOT test (sign-in lives in
   *  the Keychain and is only truly known at call time). `true`/`false`/`undefined` (can't tell).
   *  Optional: a backend that is usable whenever healthy (a local runner, a hosted key) omits it. */
  signedIn?(): Promise<boolean | undefined>;
  /** Run a (possibly agentic, possibly streaming) completion. The backend pushes deltas via
   *  ctx.emit and returns the final text. Throws on backend error; the daemon maps to BYOP. */
  run(params: CompletionParams, ctx: BackendRunContext): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number }; sessionId?: string }>;
}
