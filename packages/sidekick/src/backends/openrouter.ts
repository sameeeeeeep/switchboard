import type { CompletionParams, Message, StreamDelta } from "@relay/protocol";
import { BYOPErrorCode, ProviderError } from "@relay/protocol";
import type { BackendRunContext, ModelBackend } from "./types.js";

/**
 * OpenRouter backend — the OPT-IN "hosted tokens" path. OpenRouter is OpenAI-compatible
 * (`/v1/chat/completions`), so it slots straight into the sibling-of-local-openai seam: a wrapp
 * using window.claude runs on a hosted model exactly as it would on the visitor's own Claude.
 *
 * THE TRUST TRADE IS EXPLICIT. Unlike the BYO-Claude/local backends, this one routes the user's
 * prompts THROUGH a third-party provider (their own OpenRouter key, or later a Switchboard-hosted
 * allowance). So `hosted = true`: the daemon surfaces it and the panel badges it "on Switchboard
 * cloud · prompts routed through a provider" — never the default, never silent. The BYO path keeps
 * its "nothing leaves your machine" story; this is a second, clearly-labelled lane.
 *
 * The daemon does the metering (gate.recordCompletion) and the gating — this backend only calls the
 * model and streams text. Streaming is REAL (SSE), so claude_stream gets live deltas. The agentic
 * tool loop is not wired here yet, so any tool-bearing run FAILS CLOSED (a backend must never be the
 * thing that widens scope — see BackendRunContext), matching local-openai.
 */

/** A small, hand-picked default model set — not OpenRouter's full firehose of hundreds. Users can
 *  override via cloud config `models`. Kept vendor-diverse and current-ish; ids are OpenRouter slugs
 *  (distinct from claude-code's short ids, so routing never collides). */
export const DEFAULT_OPENROUTER_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];

export interface OpenRouterOptions {
  apiKey: string;
  /** Override for the mock server in tests; defaults to the real OpenRouter API. */
  baseUrl?: string;
  /** Curated model ids this backend advertises. Defaults to DEFAULT_OPENROUTER_MODELS. */
  models?: string[];
  id?: string;
}

export class OpenRouterBackend implements ModelBackend {
  id: string;
  /** Marks this as a hosted, prompts-leave-the-machine backend — surfaced for the honest badge. */
  readonly hosted = true;
  private apiKey: string;
  private baseUrl: string;
  private modelList: string[];

  constructor(opts: OpenRouterOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.modelList = opts.models?.length ? opts.models : DEFAULT_OPENROUTER_MODELS;
    this.id = opts.id ?? "switchboard-cloud";
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
      // OpenRouter asks callers to identify themselves; harmless + polite.
      "http-referer": "https://thelastprompt.ai/switchboard",
      "x-title": "Switchboard",
    };
  }

  async healthy(): Promise<boolean> {
    // A configured key is the gate; a cheap models probe confirms reachability. Never throws.
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.modelList;
  }

  async run(
    params: CompletionParams,
    ctx: BackendRunContext,
  ): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
    // Fail closed: no gated tool loop here yet — never silently drop tools or run them ungated. A
    // ProviderError (not a bare throw) so the wrapp gets an actionable message, not "internal error".
    if (params.agentic || ctx.allowedTools.length > 0) {
      throw new ProviderError(BYOPErrorCode.UNSUPPORTED_METHOD, "this hosted model doesn't support the agentic tool loop yet — run with agentic:false");
    }

    const messages = toChatMessages(params);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: params.model ?? this.modelList[0],
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      }),
      signal: ctx.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`switchboard-cloud completion failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }

    // Parse the SSE stream: `data: {json}` lines, `data: [DONE]` terminator. Emit each content
    // delta live (so claude_stream is real), accumulate the full text, capture usage if present.
    let text = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let evt: any;
          try { evt = JSON.parse(payload); } catch { continue; }
          const delta = evt?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            text += delta;
            ctx.emit({ type: "text", text: delta } as StreamDelta);
          }
          if (evt?.usage) {
            usage = { inputTokens: evt.usage.prompt_tokens ?? 0, outputTokens: evt.usage.completion_tokens ?? 0 };
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    return { text, usage };
  }
}

/** Flatten a completion's prompt/messages/system into OpenAI chat-messages shape. */
function toChatMessages(params: CompletionParams): Message[] {
  const messages: Message[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  if (params.messages?.length) messages.push(...params.messages);
  else if (params.prompt) messages.push({ role: "user", content: params.prompt });
  return messages;
}
