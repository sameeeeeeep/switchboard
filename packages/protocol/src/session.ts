/**
 * claude_session — a WARM, stateful completion thread. Some apps (brandbrain's Studio) generate a
 * long sequence of structured cards in one continuous conversation; spawning a fresh model process
 * per card pays a cold start every time AND, when the app fires many cards, floods the machine with
 * concurrent processes. A warm session keeps ONE long-lived process per (origin, sessionId): turns
 * are fed to it and QUEUE so they run sequentially on the same warm process — fast, and no thundering
 * herd. Mirrors the model brandbrain proved (lib/claude-session.ts / scripts/sidekick.mjs).
 *
 * SECURITY: a session is deliberately READ-ONLY — it runs with web read tools only (WebSearch/
 * WebFetch, and only if the origin granted them) and no MCP connectors, so it can never perform a
 * gated write. Writes still go through claude_callTool / the agentic gate. Model must be in the
 * origin's grant; every turn is budget-counted like a completion.
 */
export interface SessionRequest {
  op: "send" | "end";
  /** Client-chosen id scoping the warm thread (e.g. one per brand-build). */
  sessionId: string;
  /** For `send`: the turn text. Callers re-send needed context inline each turn. */
  prompt?: string;
  /** System prompt — applied when the session's process is first spawned; ignored thereafter. */
  system?: string;
  model?: string;
  effort?: "low" | "medium" | "high";
}

export interface SessionResult {
  ok: boolean;
  /** For `send`: the turn's completion text, or null on failure/timeout. */
  text?: string | null;
  error?: string;
}
