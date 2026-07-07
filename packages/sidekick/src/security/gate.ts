import type { ToolCallRequest, ToolCallResult } from "@relay/protocol";
import { BYOPErrorCode, ProviderError } from "@relay/protocol";
import { GrantStore } from "./grant-store.js";
import { BudgetLedger } from "./budgets.js";
import { AuditLog } from "./audit-log.js";
import { classifyTool } from "./classifier.js";
import type { ConsentPrompter } from "./consent.js";
import type { McpRegistry } from "../mcp/registry.js";
import { randomUUID } from "node:crypto";

/**
 * THE GATE — the single out-of-band chokepoint every sensitive action passes through. Nothing
 * else in the daemon executes a tool or a model call without going through here. Because it is
 * enforced in the daemon, no page prompt and no model output can widen scope: the model
 * proposes, the gate disposes.
 *
 * Enforcement order for a tool call (fail-closed at each step):
 *   1. Origin has a grant?                         → else UNAUTHORIZED
 *   2. Tool is in the origin's allowlist?           → else SCOPE_EXCEEDED
 *   3. Rate budget ok?                              → else BUDGET_EXCEEDED
 *   4. Access class (out-of-band, default-deny):
 *        read  → auto-approve
 *        write → per-action user consent EVERY time → else CONSENT_DENIED
 *   5. Execute directly against the MCP server (creds never leave), audit, return.
 */
export class Gate {
  constructor(
    private grants: GrantStore,
    private budgets: BudgetLedger,
    private audit: AuditLog,
    private consent: ConsentPrompter,
    private mcp: McpRegistry,
    private pinned: Record<string, "read" | "write"> = {},
  ) {}

  /** Resolve a tool's effective access class from the daemon policy — never from the model. */
  classify(name: string): "read" | "write" {
    return classifyTool(name, this.pinned);
  }

  /** The allowlisted tool names an origin may use — passed to the model as a HARD capability
   *  set (e.g. CLI --allowed-tools) so it is handed exactly these and nothing else. */
  allowedToolsFor(origin: string): string[] {
    const grant = this.grants.get(origin);
    return grant ? grant.tools.map((t) => t.name) : [];
  }

  /** Does a granted pattern cover a concrete tool name? Exact match, OR a connector wildcard like
   *  `mcp__claude_ai_Higgsfield__*` (grant a whole connector so the model can do the submit-then-
   *  poll dance async tools need — each individual call is still classified + gated below). */
  private matches(pattern: string, name: string): boolean {
    if (pattern === name) return true;
    if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
    return false;
  }

  /**
   * AUTHORIZE-ONLY path. Used by the gated agentic loop's `canUseTool`, where the Agent SDK
   * EXECUTES the tool itself after we allow. So this runs the full policy (scope, allowlist,
   * budget, classification, per-action write consent) but does NOT invoke the tool. Same
   * checks and same fail-closed order as gateToolCall — the model gets no weaker gate than a
   * page-initiated call. Returns allow/deny; the caller maps deny → the SDK's `{behavior:'deny'}`.
   */
  async authorize(origin: string, call: ToolCallRequest): Promise<{ allow: true; decision: "auto-approved" | "user-approved" } | { allow: false; message: string }> {
    const grant = this.grants.get(origin);
    if (!grant) {
      this.audit.record({ origin, kind: "tool_call", toolName: call.name, outcome: "denied", decision: "blocked", note: "no grant" });
      return { allow: false, message: "origin not connected" };
    }
    if (!grant.tools.some((t) => this.matches(t.name, call.name))) {
      this.audit.record({ origin, kind: "tool_call", toolName: call.name, outcome: "denied", decision: "blocked", note: "not in allowlist" });
      return { allow: false, message: `tool ${call.name} not in this origin's allowlist` };
    }
    if (!this.budgets.canCall(origin, grant.budgets)) {
      this.audit.record({ origin, kind: "tool_call", toolName: call.name, outcome: "denied", decision: "blocked", note: "rate limit" });
      return { allow: false, message: "rate limit exceeded" };
    }
    const access = this.classify(call.name);
    if (access === "write") {
      const mode = grant.mode ?? "ask";
      if (mode === "readonly") {
        this.audit.record({ origin, kind: "consent", toolName: call.name, outcome: "denied", decision: "blocked", note: "read-only mode" });
        return { allow: false, message: "this site is set to read-only" };
      }
      if (mode === "trust") {
        // Trusted site: auto-approve the write (no per-action prompt). Still allowlist + budget bounded.
        this.audit.record({ origin, kind: "consent", toolName: call.name, outcome: "ok", decision: "auto-approved", note: "trust mode" });
      } else {
        // ask (default): per-action human consent.
        const approved = await this.consent.requestWriteConsent({ id: randomUUID(), origin, tool: call, reason: "write-action" });
        if (!approved) {
          this.audit.record({ origin, kind: "consent", toolName: call.name, outcome: "denied", decision: "user-denied" });
          return { allow: false, message: "user denied the write action" };
        }
        this.audit.record({ origin, kind: "consent", toolName: call.name, outcome: "ok", decision: "user-approved" });
      }
    }
    this.budgets.recordCall(origin);
    return { allow: true, decision: access === "read" || grant.mode === "trust" ? "auto-approved" : "user-approved" };
  }

  /**
   * Gate one tool call. This is invoked BOTH by claude_callTool (page-initiated) AND by the
   * agentic loop's ctx.gateToolCall (model-proposed) — same path, so the model gets no weaker
   * checks than a direct call. Returns a ToolCallResult; denials come back as ok:false with a
   * code so the model can be told "not permitted" without the action ever running.
   */
  async gateToolCall(origin: string, call: ToolCallRequest): Promise<ToolCallResult> {
    // Same policy as the agentic path (single source of truth), then EXECUTE — because here the
    // page named the tool directly and no model/SDK is in the loop to run it for us.
    const decision = await this.authorize(origin, call);
    if (!decision.allow) {
      // Map the policy failure to a stable BYOP code for the page.
      const code = decision.message?.includes("not connected") ? BYOPErrorCode.UNAUTHORIZED
        : decision.message?.includes("allowlist") ? BYOPErrorCode.SCOPE_EXCEEDED
        : decision.message?.includes("rate limit") ? BYOPErrorCode.BUDGET_EXCEEDED
        : BYOPErrorCode.CONSENT_DENIED;
      return deny(code, decision.message ?? "denied");
    }
    try {
      const result = await this.mcp.invoke(call);
      this.audit.record({ origin, kind: "tool_call", toolName: call.name, outcome: result.ok ? "ok" : "error", decision: decision.decision });
      return result;
    } catch (err) {
      this.audit.record({ origin, kind: "tool_call", toolName: call.name, outcome: "error", note: String(err).slice(0, 120) });
      return deny(BYOPErrorCode.BACKEND_ERROR, `tool ${call.name} failed`);
    }
  }

  /** Pre-flight a completion: model in scope + rate budget. Token budget is checked against the
   *  request cap up front and reconciled with actual usage after. */
  assertCompletionAllowed(origin: string, model: string | undefined, estTokens: number): void {
    const grant = this.grants.get(origin);
    if (!grant) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "origin not connected");
    if (!this.grants.allowsModel(origin, model)) {
      throw new ProviderError(BYOPErrorCode.SCOPE_EXCEEDED, `model ${model ?? "(default)"} not granted`);
    }
    if (!this.budgets.canCall(origin, grant.budgets)) {
      throw new ProviderError(BYOPErrorCode.BUDGET_EXCEEDED, "rate limit exceeded");
    }
    if (!this.budgets.canSpend(origin, grant.budgets, estTokens)) {
      throw new ProviderError(BYOPErrorCode.BUDGET_EXCEEDED, "daily token budget exceeded");
    }
  }

  recordCompletion(origin: string, tokens: number) {
    this.budgets.recordCall(origin);
    this.budgets.recordTokens(origin, tokens);
  }
}

function deny(code: number, message: string): ToolCallResult {
  return { ok: false, error: { code: String(code), message } };
}
