import type { CompletionParams } from "@relay/protocol";
import type { BackendRunContext, ModelBackend } from "./types.js";

/**
 * Local OpenAI-compatible backend — Ollama, LM Studio, llama.cpp, vLLM, etc. all expose a
 * `/v1/chat/completions` endpoint on localhost. This is the sibling backend that realizes the
 * "route ANY local model through the broker" half of the vision: a site using window.claude
 * can run on the visitor's 8B local model exactly as it would on their Claude subscription.
 *
 * [SCAFFOLD] Streaming + a local tool-use loop (parse tool_calls, route each through
 * ctx.gateToolCall, feed results back) are stubbed. The gate contract is identical to the
 * Claude backend — the model proposes, the daemon disposes.
 */
export interface LocalOpenAIOptions {
  /** e.g. "http://127.0.0.1:11434/v1" (Ollama) or "http://127.0.0.1:1234/v1" (LM Studio). */
  baseUrl: string;
  id?: string;
}

export class LocalOpenAIBackend implements ModelBackend {
  id: string;
  private baseUrl: string;
  constructor(opts: LocalOpenAIOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.id = opts.id ?? "local-openai";
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => m.id);
    } catch {
      return [];
    }
  }

  async run(_params: CompletionParams, _ctx: BackendRunContext): Promise<{ text: string }> {
    // TODO(M-local): stream from /v1/chat/completions; on tool_calls, route each through
    // _ctx.gateToolCall and continue the loop with tool results. Emit deltas via _ctx.emit.
    throw new Error("local-openai backend not yet implemented");
  }
}
