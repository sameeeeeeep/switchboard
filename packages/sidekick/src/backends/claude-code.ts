import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { query, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { CompletionParams } from "@relay/protocol";
import type { BackendRunContext, ModelBackend } from "./types.js";

/**
 * Claude Code backend — runs the user's local Claude (their sign-in / subscription; no shared
 * API key) via the Agent SDK's `query()`. The SDK gives us the load-bearing primitive proven in
 * spike/gate-spike.mjs: `canUseTool` fires OUT OF BAND for every proposed tool — MCP tools
 * included — is async (so it can block on a human consent click), and ENFORCES deny for MCP
 * tools (unlike PreToolUse hooks in this version, gh #33106). We route it straight into the Gate.
 *
 *   model proposes tool → SDK calls canUseTool → ctx.authorizeToolCall (Gate policy + consent)
 *     → allow: SDK executes the tool (creds stay in the daemon's MCP client, never to the page)
 *     → deny:  { behavior: 'deny', message } — the model sees a tool error, the action never runs
 */

export function claudeBin(): string {
  const candidates = [
    process.env.RELAY_CLAUDE_CLI,
    join(homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return "claude";
}

const DEFAULT_MODEL = process.env.RELAY_CLAUDE_MODEL || "sonnet";

function toPrompt(params: CompletionParams): string {
  if (params.prompt) return params.prompt;
  if (params.messages?.length) return params.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  return "";
}

export class ClaudeCodeBackend implements ModelBackend {
  id = "claude-code";

  async healthy(): Promise<boolean> {
    return existsSync(claudeBin()) || claudeBin() === "claude";
  }

  async listModels(): Promise<string[]> {
    // Aliases the SDK/CLI accepts; the daemon routes any of these here.
    return [DEFAULT_MODEL, "opus", "sonnet", "haiku", "claude-opus-4-8", "claude-sonnet-5"];
  }

  async run(params: CompletionParams, ctx: BackendRunContext): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const agentic = !!params.agentic && ctx.allowedTools.length > 0;

    // THE GATE, as the SDK sees it. Deny-by-default: only allowlisted tools even reach policy,
    // and this runs the full scope/budget/consent check out of band. bypassPermissions is NEVER
    // used — that would skip canUseTool and defeat the broker.
    // Track each proposed call by its toolUseID so we can pair the SDK's later tool_result
    // message back to the call and surface it to the page (image URLs, tool output, …).
    const proposed = new Map<string, { name: string; arguments: Record<string, unknown> }>();

    const canUseTool: CanUseTool = async (toolName, input, opts): Promise<PermissionResult> => {
      const call = { name: toolName, arguments: (input ?? {}) as Record<string, unknown> };
      proposed.set(opts.toolUseID, call);
      ctx.emit({ type: "tool_proposed", call });
      // Relay-native primitives (e.g. relay__put_blob) are relay's own controlled tools, not
      // per-origin model capabilities — auto-approve without a grant/consent check.
      if (toolName.startsWith("mcp__relay__")) return { behavior: "allow", updatedInput: call.arguments };
      const decision = await ctx.authorizeToolCall(call);
      if (!decision.allow) {
        ctx.emit({ type: "tool_result", call, result: { ok: false, error: { code: "denied", message: decision.message ?? "denied" } } });
        return { behavior: "deny", message: `Relay: ${decision.message ?? "not permitted"}` };
      }
      return { behavior: "allow", updatedInput: call.arguments };
    };

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    const q = query({
      prompt: toPrompt(params),
      options: {
        model: params.model || DEFAULT_MODEL,
        ...(params.system ? { systemPrompt: params.system } : {}), // app persona (brandbrain STUDIO_SYSTEM etc.)
        ...(agentic
          ? {
              // Expose the origin's local MCP servers. Only pass mcpServers when non-empty — an
              // empty object would suppress the user's INHERITED claude.ai connectors (Higgsfield,
              // etc.), which the SDK loads automatically and which the model may propose. Every
              // proposal (local or connector) is arbitrated by canUseTool → the gate; no
              // allowedTools rules, so nothing is pre-approved past it.
              ...(Object.keys(ctx.mcpServers ?? {}).length ? { mcpServers: ctx.mcpServers as never } : {}),
              canUseTool,
              permissionMode: "default" as const,
            }
          : {
              // Pure generation: no tools at all. Injection can yield text, never an action.
              disallowedTools: ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "NotebookEdit", "TodoWrite"],
              canUseTool: (async () => ({ behavior: "deny", message: "Relay: tools disabled for this call." })) as CanUseTool,
              permissionMode: "default" as const,
            }),
      },
    });

    const onAbort = () => { try { q.interrupt?.(); } catch { /* ignore */ } };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          for (const block of (msg.message.content ?? []) as Array<{ type: string; text?: string }>) {
            if (block.type === "text" && block.text) { text += block.text; ctx.emit({ type: "text", text: block.text }); }
          }
        } else if (msg.type === "user") {
          // The SDK executed an allowed tool; surface its result to the page, paired to the call.
          for (const block of (msg.message.content ?? []) as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
            if (block.type !== "tool_result" || !block.tool_use_id) continue;
            const call = proposed.get(block.tool_use_id) ?? { name: "unknown", arguments: {} };
            const content = Array.isArray(block.content)
              ? (block.content as Array<{ type: string; [k: string]: unknown }>)
              : [{ type: "text", text: String(block.content ?? "") }];
            ctx.emit({ type: "tool_result", call, result: { ok: !block.is_error, content } });
          }
        } else if (msg.type === "result") {
          const u = (msg as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
          if (u) { inputTokens = u.input_tokens ?? 0; outputTokens = u.output_tokens ?? 0; }
          if (typeof (msg as { result?: unknown }).result === "string" && !text) text = (msg as { result: string }).result;
        }
      }
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }

    return { text, usage: { inputTokens, outputTokens } };
  }
}
