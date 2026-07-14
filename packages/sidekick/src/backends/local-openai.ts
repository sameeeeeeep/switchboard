import type { CompletionParams, Message } from "@relay/protocol";
import type { BackendRunContext, ModelBackend } from "./types.js";

/**
 * Local OpenAI-compatible backend — Ollama, LM Studio, llama.cpp, vLLM, etc. all expose a
 * `/v1/chat/completions` endpoint on localhost. This is the sibling backend that realizes the
 * "route ANY local model through the broker" half of the vision: a site using window.claude
 * can run on the visitor's 8B local model exactly as it would on their Claude subscription.
 *
 * IMPLEMENTED: non-agentic completion (pure text generation, no tools) — the majority of wrapp
 * calls, incl. the brandbrain-port single-shot `claude_complete` → JSON path.
 *
 * [SCAFFOLD] Streaming + a local tool-use loop (parse tool_calls, route each through
 * ctx.gateToolCall, feed results back) are stubbed. The gate contract is identical to the
 * Claude backend — the model proposes, the daemon disposes. Until that lands, any run that
 * would put tools in play FAILS CLOSED rather than silently dropping them (a backend must never
 * be the thing that widens scope — see BackendRunContext).
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

  async run(
    params: CompletionParams,
    ctx: BackendRunContext,
  ): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
    // Fail closed: the gated tool loop (parse tool_calls → ctx.gateToolCall → feed results back)
    // isn't implemented yet, so refuse any run that would put tools in play rather than silently
    // running tool-free. A backend must never be the thing that narrows/widens scope.
    if (params.agentic || ctx.allowedTools.length > 0) {
      throw new Error(
        "local-openai backend does not yet support the agentic tool loop; run with agentic:false",
      );
    }

    const messages = toChatMessages(params);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: params.model ?? undefined,
        messages,
        stream: false,
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      }),
      signal: ctx.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`local-openai completion failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage
      ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
      : undefined;
    return { text, usage };
  }
}

/** Flatten a completion's prompt/messages/system into the OpenAI chat-messages shape. */
function toChatMessages(params: CompletionParams): Message[] {
  const messages: Message[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  if (params.messages?.length) {
    messages.push(...params.messages);
  } else if (params.prompt) {
    messages.push({ role: "user", content: params.prompt });
  }
  return messages;
}
