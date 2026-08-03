import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { query, type CanUseTool, type PermissionResult, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { BYOPErrorCode, ProviderError, SIGNED_OUT_MESSAGE, type CompletionParams } from "@relay/protocol";
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

/** The CLI `query()` will ACTUALLY spawn: the agent SDK's own native binary, resolved the same
 *  way sdk.mjs resolves it. In the packaged app this is the CLI the DMG ships beside sidekick.mjs;
 *  in a dev checkout it's the one in node_modules. Null when the native package is absent. */
function sdkNativeCli(): string | null {
  try {
    const cli = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk-darwin-arm64/claude");
    return existsSync(cli) ? cli : null;
  } catch { return null; }
}

/** Cached spawn probe. `existsSync` alone was a tautology (claudeBin() falls back to the literal
 *  "claude", so `|| === "claude"` could never be false) — the daemon reported "backends online:
 *  claude-code" on machines with no Claude at all, and the first real call failed opaquely. A
 *  real probe execs the CLI that query() will use. Note: this proves the RUNTIME works, not that
 *  the user is signed in — sign-in lives in ~/.claude/Keychain and is only truly testable by a
 *  real call, so auth failures are classified at run() time instead (see the result branch). */
let cliProbe: { at: number; ok: boolean } | null = null;
const PROBE_TTL_MS = 60_000;

function probeCli(): Promise<boolean> {
  const bin = sdkNativeCli() ?? (existsSync(claudeBin()) ? claudeBin() : null);
  if (!bin) return Promise.resolve(false);
  return new Promise((resolve) => {
    const p = spawn(bin, ["--version"], { stdio: "ignore", timeout: 8_000 });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

/** Sign-in failures come back inside the SDK's result message, not as spawn errors. */
const AUTH_ERROR_RE = /log ?in|logged.?out|not.+authenticated|authentication|credential|api.?key|unauthorized|oauth|billing|subscription/i;

/** Rung 4's signal (STATES.md §4). `healthy()` proves the CLI RUNTIME works but NOT sign-in, so the
 *  cliff — installed, paired, green everywhere, first call fails — needs a real signed-in probe.
 *
 *  Two honest sources, most-authoritative first:
 *   1. `observedSignedIn` — set by a REAL call: a success proves signed in, an auth-classified failure
 *      proves signed out. Sticky (survives until the next call flips it); the ground truth once we have it.
 *   2. The credential MARKER in ~/.claude.json (`oauthAccount.accountUuid`) — a non-secret, non-prompting
 *      file the daemon can read as the user. Present ⇒ signed in at some point; a readable file WITHOUT it
 *      ⇒ ran `claude`, never logged in ⇒ signed out. Missing/unreadable ⇒ undefined (never assert).
 *  Framed per §3 rule 4: absence is "we haven't seen a sign-in", reversible — never a hard "you are not". */
let observedSignedIn: boolean | undefined;
/** Record what a real call proved about sign-in (called from run()). */
export function noteSignInObserved(ok: boolean): void { observedSignedIn = ok; }

let markerProbe: { at: number; val: boolean | undefined } | null = null;
const MARKER_TTL_MS = 30_000;
function signInMarker(): boolean | undefined {
  if (markerProbe && Date.now() - markerProbe.at < MARKER_TTL_MS) return markerProbe.val;
  let val: boolean | undefined;
  try {
    const raw = readFileSync(join(homedir(), ".claude.json"), "utf8");
    // Parse only the field we need — the file is large and the rest is none of our business.
    const acct = (JSON.parse(raw) as { oauthAccount?: { accountUuid?: string } }).oauthAccount;
    val = acct ? !!acct.accountUuid : false; // readable but no account ⇒ ran claude, not logged in
  } catch {
    val = undefined; // missing or unreadable ⇒ we can't tell; do not assert signed-out
  }
  markerProbe = { at: Date.now(), val };
  return val;
}

const DEFAULT_MODEL = process.env.RELAY_CLAUDE_MODEL || "sonnet";

function toPrompt(params: CompletionParams): string {
  if (params.prompt) return params.prompt;
  if (params.messages?.length) return params.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  return "";
}

/** Split a `data:<media>;base64,<b64>` URL into the SDK's image-source parts. Returns null for a
 *  non-image or malformed URL so the caller can skip it (attachments stay text-safe). */
function imageSourceFromDataUrl(dataUrl: string): { media_type: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const [, mediaType, data] = m;
  if (!mediaType || !data || !mediaType.startsWith("image/")) return null;
  // The Anthropic vision API only decodes jpeg/png/gif/webp. A caller that hands us HEIC/HEIF (an
  // iPhone photo) would otherwise fail the WHOLE completion; skip it instead (text-safe). God already
  // transcodes HEIC→JPEG before sending, so this only guards other callers (extension, bridge).
  if (mediaType === "image/heic" || mediaType === "image/heif") return null;
  return { media_type: mediaType, data };
}

/**
 * Build the SDK prompt. Vision-in: when the call carries image attachments (a screenshot, a
 * reference image), the model must SEE them — not just have them available to `relay__put_blob`.
 * The SDK's string prompt can't carry pixels, so we hand it a one-message async-iterable whose
 * content is [text, ...image blocks]. Proven pixel-accurate in spike/god-eye-spike.mjs. No
 * attachments ⇒ the plain string, byte-for-byte the old path (zero behaviour change).
 */
function toSdkPrompt(params: CompletionParams): string | AsyncIterable<SDKUserMessage> {
  const images = (params.attachments ?? [])
    .map((a) => imageSourceFromDataUrl(a.dataUrl))
    .filter((s): s is { media_type: string; data: string } => s !== null);
  if (images.length === 0) return toPrompt(params);
  const content = [
    { type: "text" as const, text: toPrompt(params) },
    ...images.map((source) => ({ type: "image" as const, source: { type: "base64" as const, ...source } })),
  ];
  return (async function* () {
    yield { type: "user", parent_tool_use_id: null, message: { role: "user", content } } as unknown as SDKUserMessage;
  })();
}

export class ClaudeCodeBackend implements ModelBackend {
  id = "claude-code";

  async healthy(): Promise<boolean> {
    if (!cliProbe || Date.now() - cliProbe.at > PROBE_TTL_MS) {
      cliProbe = { at: Date.now(), ok: await probeCli() };
    }
    return cliProbe.ok;
  }

  async listModels(): Promise<string[]> {
    // Aliases the SDK/CLI accepts; the daemon routes any of these here. NOTE: this stays non-empty
    // even when signed OUT (the CLI accepts these ids regardless), which is exactly why an empty
    // models[] can't be the signed-out signal — `signedIn()` is. See STATES.md §4.
    return [DEFAULT_MODEL, "opus", "sonnet", "haiku", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"];
  }

  /** Rung 4: signed in on this Mac? Observed truth (a real call) wins; otherwise the credential
   *  marker. Never touches the network and never prompts — see signInMarker/noteSignInObserved. */
  async signedIn(): Promise<boolean | undefined> {
    return observedSignedIn !== undefined ? observedSignedIn : signInMarker();
  }

  async run(params: CompletionParams, ctx: BackendRunContext): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number }; sessionId?: string }> {
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
    let sdkSessionId: string | undefined;   // the SDK's session UUID — captured so the daemon can resume it

    const q = query({
      prompt: toSdkPrompt(params),
      options: {
        model: params.model || DEFAULT_MODEL,
        // Real warm thread: resume the prior SDK session so this turn CONTINUES the conversation
        // (prior turns + prompt caching) instead of starting cold. The daemon owns the id per
        // (origin, sessionId); vision still rides live in this turn's prompt. On the first turn
        // (no id yet) this is absent and the SDK mints a fresh session we capture below.
        ...(ctx.resumeSessionId ? { resume: ctx.resumeSessionId } : {}),
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
          const r = msg as { usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }; result?: unknown; is_error?: boolean; subtype?: string; session_id?: string };
          if (r.session_id) sdkSessionId = r.session_id;   // capture for resume next turn
          if (r.usage) {
            // Count CACHED input too — cache-creation + cache-read are real consumed input the budget must
            // see. Reading only input_tokens undercounted by ~77x (e.g. 451 reported vs 34,585 consumed),
            // making per-day budgets wildly too permissive. (OpenAI-shaped backends already total correctly.)
            inputTokens = (r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0);
            outputTokens = r.usage.output_tokens ?? 0;
          }
          // The SDK reports failures IN the result message, not by throwing — an unread is_error
          // meant "not signed in" surfaced as a generic backend error (or worse, empty success).
          if (r.is_error || (r.subtype && r.subtype !== "success")) {
            const raw = typeof r.result === "string" ? r.result : (r.subtype ?? "backend error");
            if (AUTH_ERROR_RE.test(raw)) {
              noteSignInObserved(false); // ground truth: this Mac is signed OUT — the ladder upgrades to it
              throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, SIGNED_OUT_MESSAGE);
            }
            throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, raw.slice(0, 200));
          }
          noteSignInObserved(true); // a completed result proves we ARE signed in — clears a stale marker
          if (typeof r.result === "string" && !text) text = r.result;
        }
      }
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }

    return { text, usage: { inputTokens, outputTokens }, sessionId: sdkSessionId };
  }
}
