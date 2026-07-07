/**
 * Model completion types. A completion targets one of the daemon's model backends (Claude
 * Code by default; local OpenAI-compatible runners as siblings). In v1 a completion MAY be
 * agentic: the model can propose tool calls mid-reasoning, and every one is routed through
 * the daemon's out-of-band permission gate before it executes. The model is never the
 * security boundary — the gate is.
 */
import type { ToolCallRequest, ToolCallResult } from "./tools.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/** A binary blob the page attaches to a completion (e.g. a reference image). The daemon holds it
 *  for the run and exposes a native `relay__put_blob` tool so the agentic loop can upload it to a
 *  connector's presigned URL — the general "local file → remote connector" primitive. */
export interface Attachment {
  /** Short id the prompt refers to, e.g. "ref". */
  handle: string;
  filename: string;
  contentType: string;
  /** data: URL (base64). Kept on the daemon; never echoed to other origins or the audit log. */
  dataUrl: string;
}

export interface CompletionParams {
  /** Either a single prompt or a message list. Both are UNTRUSTED page input. */
  prompt?: string;
  messages?: Message[];
  /** Replaces the model's default system prompt with the app's persona (e.g. brandbrain's
   *  STUDIO_SYSTEM). Untrusted page input; the daemon never lets it widen tool/permission scope. */
  system?: string;
  /** Binary inputs the page attaches (reference images, etc.). Held daemon-side for the run. */
  attachments?: Attachment[];
  /** Model id; must be within the origin's granted models. Omit for the origin's default. */
  model?: string;
  /** Cap on output tokens for this call (still subject to the origin's daily budget). */
  maxTokens?: number;
  /** Reasoning effort passthrough for backends that support it. */
  effort?: "low" | "medium" | "high";
  /** Opt into the gated agentic loop: the model may propose tools from the origin's allowed
   *  set. Each proposal hits the gate (reads auto-approve in scope; writes prompt the user).
   *  When false/omitted, the completion runs with NO tools — pure text generation. */
  agentic?: boolean;
  /** Warm-session id for multi-turn continuity; the daemon owns the stateful process. */
  sessionId?: string;
}

/** Non-streaming completion result. */
export interface CompletionResult {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Tool calls that ran during a gated agentic completion, with how the gate resolved them. */
  toolCalls?: Array<{ request: ToolCallRequest; result: ToolCallResult }>;
  stopReason?: "end" | "max_tokens" | "denied" | "error";
}

/** Streaming delta shapes, delivered to the page via the `delta` provider event keyed by a
 *  streamId returned from claude_stream. Mirrors the daemon's newline-delimited event feed. */
export type StreamDelta =
  | { type: "text"; text: string }
  /** The model proposed a tool; the UI can show "site wants to <tool>" while the gate resolves. */
  | { type: "tool_proposed"; call: ToolCallRequest }
  | { type: "tool_result"; call: ToolCallRequest; result: ToolCallResult }
  /** Real URLs the backend fetched/searched, surfaced once so the page can cite sources. */
  | { type: "sources"; urls: string[] }
  | { type: "done"; result: CompletionResult }
  | { type: "error"; error: { code: string; message: string } };
