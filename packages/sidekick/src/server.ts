import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type {
  BYOPMethod,
  Capabilities,
  CompletionParams,
  OriginGrant,
  RequestEnvelope,
  ScopeRequest,
  StreamDelta,
  ToolCallRequest,
  ToolDescriptor,
} from "@relay/protocol";
import { BYOP_VERSION, BYOPErrorCode, ProviderError } from "@relay/protocol";
import type { DaemonConfig } from "./config.js";
import type { Gate } from "./security/gate.js";
import type { GrantStore } from "./security/grant-store.js";
import type { BudgetLedger } from "./security/budgets.js";
import type { AuditLog } from "./security/audit-log.js";
import type { ConsentPrompter, PerActionConsentRequest } from "./security/consent.js";
import type { McpRegistry } from "./mcp/registry.js";
import type { BackendRegistry } from "./backends/registry.js";
import { relayNativeServer } from "./backends/relay-native.js";
import { classifyTool } from "./security/classifier.js";

/** Merge the origin's local MCP servers with a per-run relay-native server holding this call's
 *  attachments (so the agentic loop can upload them via relay__put_blob). Empty attachments → no
 *  relay server, so the SDK still inherits the user's claude.ai connectors. */
function buildMcpServers(local: Record<string, unknown>, attachments?: { handle: string; filename: string; contentType: string; dataUrl: string }[]) {
  if (!attachments?.length) return local;
  return { ...local, relay: relayNativeServer(new Map(attachments.map((a) => [a.handle, a]))) };
}

/**
 * The loopback WS server. Two hard security rules:
 *   1. Bind 127.0.0.1 only, and reject any connection whose Origin header is a real web page
 *      (browser fetch/WS to localhost) — only the extension (origin chrome-extension://… or a
 *      null/absent origin from the native context) may connect.
 *   2. Authenticate with the pairing token before processing any message. The page never has
 *      this token, so it can never drive the daemon directly; it must go through the extension,
 *      which stamps the browser-verified `origin` on every envelope.
 *
 * The server also IS the ConsentPrompter: it pushes consent requests down the same authenticated
 * socket to the extension popup and awaits the user's click.
 */
export interface BrokerDeps {
  config: DaemonConfig;
  gate: Gate;
  grants: GrantStore;
  budgets: BudgetLedger;
  audit: AuditLog;
  mcp: McpRegistry;
  backends: BackendRegistry;
}

interface Pending { resolve: (v: any) => void; reject: (e: any) => void; }

/** Built-in (non-MCP) tools the model can be granted. Classified by the daemon like any tool
 *  (WebFetch/WebSearch are reads). They're offered in the connect flow and gated identically. */
const BUILTIN_TOOLS: Array<{ name: string; server: string; description: string }> = [
  { name: "WebFetch", server: "builtin", description: "Fetch and read a web page" },
  { name: "WebSearch", server: "builtin", description: "Search the web" },
];

export class Broker implements ConsentPrompter {
  private wss: WebSocketServer | null = null;
  private extensions = new Set<WebSocket>();
  /** Consent + control requests awaiting a reply from the extension. */
  private pending = new Map<string, Pending>();
  /** In-flight streams for cancellation. */
  private streams = new Map<string, AbortController>();

  constructor(private deps: BrokerDeps) {}

  start() {
    const { host, port, pairingToken } = this.deps.config;
    this.wss = new WebSocketServer({ host, port });
    // A ws 'error' with no listener is an UNCAUGHT exception that kills the daemon. A dropped
    // extension connection (tab close → ECONNRESET) trips this. Handle it at both levels.
    this.wss.on("error", (err) => console.error("[relay] wss error:", String(err).slice(0, 160)));
    this.wss.on("connection", (ws, req) => {
      ws.on("error", (err) => { console.error("[relay] ws error:", String(err).slice(0, 120)); this.extensions.delete(ws); });
      // Rule 1: reject connections that look like a web page reaching localhost directly.
      const origin = req.headers["origin"];
      const isExtension = !origin || origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
      if (!isExtension) { ws.close(1008, "forbidden origin"); return; }
      // Rule 2: token auth (sent as the first message, or a subprotocol — first message here).
      let authed = false;
      ws.on("message", async (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (!authed) {
          if (msg?.type === "auth" && msg.token === pairingToken) { authed = true; this.extensions.add(ws); ws.send(JSON.stringify({ type: "auth_ok" })); }
          else { ws.close(1008, "unauthorized"); }
          return;
        }
        if (msg?.type === "reply" && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!; this.pending.delete(msg.id); p.resolve(msg.result);
          return;
        }
        if (msg?.type === "request") {
          await this.handle(ws, msg as RequestEnvelope);
          return;
        }
        if (msg?.type === "control") {
          const result = await this.handleControl(msg.action, msg.args);
          ws.send(JSON.stringify({ type: "control_result", id: msg.id, result }));
          return;
        }
      });
      ws.on("close", () => this.extensions.delete(ws));
    });
    console.error(`[relay] sidekick listening on ws://${host}:${port} (paired-only)`);
  }

  // ---- ConsentPrompter: push to the extension popup, await the user's click. Fail-closed. ----
  requestWriteConsent(reqBody: PerActionConsentRequest): Promise<boolean> {
    return this.ask<boolean>("consent:write", reqBody, 120_000, false);
  }
  async requestConnectConsent(_origin: string, body: unknown) {
    // `body` is already the full consent payload (origin, reason, models, tools, budgets) — send it
    // through as-is so the consent view can read it directly.
    return this.ask<null | { models: string[]; tools: Array<{ name: string; access: "read" | "write" }>; budgets?: any; expiresAt?: number }>(
      "consent:connect", body, 120_000, null,
    );
  }
  private ask<T>(kind: string, body: unknown, timeoutMs: number, failValue: T): Promise<T> {
    const ext = [...this.extensions][0];
    if (!ext) return Promise.resolve(failValue); // no paired UI ⇒ deny
    const id = randomUUID();
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(failValue); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v as T); }, reject: () => { clearTimeout(timer); resolve(failValue); } });
      ext.send(JSON.stringify({ type: "prompt", id, kind, body }));
    });
  }

  // ---- request routing: one authoritative `origin` per envelope, set by the extension. ----
  private async handle(ws: WebSocket, env: RequestEnvelope) {
    const respond = (result?: unknown, error?: unknown) => ws.send(JSON.stringify({ type: "response", id: env.id, result, error }));
    try {
      const result = await this.dispatch(env);
      this.deps.audit.record({ origin: env.origin, kind: "request", method: env.method, outcome: "ok" });
      respond(result);
    } catch (err) {
      const e = err instanceof ProviderError ? { code: e_code(err), message: err.message } : { code: BYOPErrorCode.BACKEND_ERROR, message: "internal error" };
      this.deps.audit.record({ origin: env.origin, kind: "request", method: env.method, outcome: "denied", note: e.message.slice(0, 120) });
      respond(undefined, e);
    }
  }

  private async dispatch(env: RequestEnvelope): Promise<unknown> {
    const { origin, method } = env;
    switch (method as BYOPMethod) {
      case "claude_capabilities":
        return this.capabilities();
      case "claude_connect":
        return this.connect(origin, (env.params as ScopeRequest) ?? {});
      case "claude_disconnect":
        return { ok: true };
      case "claude_permissions":
        return this.permissions(origin, env.params as any);
      case "claude_listTools":
        return { tools: this.listTools(origin) };
      case "claude_callTool":
        return this.deps.gate.gateToolCall(origin, env.params as ToolCallRequest);
      case "claude_complete":
        return this.complete(origin, env.params as CompletionParams);
      case "claude_stream":
        return this.startStream(origin, env.params as CompletionParams);
      case "claude_cancel": {
        const { streamId } = env.params as { streamId: string };
        this.streams.get(streamId)?.abort();
        return { ok: true };
      }
      default:
        throw new ProviderError(BYOPErrorCode.UNSUPPORTED_METHOD, `unknown method ${method}`);
    }
  }

  private async capabilities(): Promise<Capabilities> {
    return {
      version: BYOP_VERSION,
      methods: ["claude_capabilities", "claude_connect", "claude_disconnect", "claude_complete", "claude_stream", "claude_cancel", "claude_listTools", "claude_callTool", "claude_permissions"],
      models: await this.deps.backends.models(),
      backends: await this.deps.backends.onlineIds(),
      agentic: true,
    };
  }

  /**
   * Control channel for the paired extension (no origin — these act ACROSS origins). Powers the
   * popup's grant list, audit view, per-origin revoke, and the kill switch. Only an authenticated
   * extension can reach this; a page never can.
   */
  private async handleControl(action: string, args: any): Promise<unknown> {
    switch (action) {
      case "listGrants":
        return {
          grants: this.deps.grants.list().map((g) => ({ ...g, usage: this.deps.budgets.usage(g.origin) })),
          tokenPresent: true,
        };
      case "audit":
        return { entries: this.deps.audit.read(args?.origin, args?.limit ?? 300) };
      case "revoke": {
        const origin = String(args?.origin ?? "");
        this.deps.grants.revoke(origin);
        this.deps.audit.record({ origin, kind: "revoke", outcome: "ok" });
        this.broadcast({ type: "event", event: "disconnect", payload: { reason: "user-revoked" } });
        return { ok: true };
      }
      case "setMode": {
        // Per-site trust mode (ask/trust/readonly). User-driven from the panel, out of band.
        const g = this.deps.grants.setMode(String(args?.origin ?? ""), args?.mode);
        if (g) { this.deps.audit.record({ origin: g.origin, kind: "request", method: `mode:${g.mode}`, outcome: "ok" }); this.broadcast({ type: "event", event: "permissionsChanged", payload: g }); }
        return { ok: !!g, grant: g };
      }
      case "killSwitch":
        // Drop every grant and sever all sockets. The extension also drops its local token.
        this.deps.grants.revokeAll();
        this.deps.audit.record({ origin: "*", kind: "revoke", outcome: "ok", note: "kill switch" });
        this.broadcast({ type: "event", event: "disconnect", payload: { reason: "kill-switch" } });
        return { ok: true };
      default:
        return { ok: false, error: `unknown control action ${action}` };
    }
  }

  /** claude_connect: run the connect consent flow, then persist the (narrowed) grant. */
  private async connect(origin: string, requested: ScopeRequest): Promise<OriginGrant> {
    // Show the user ONLY what the site asked for — its requested tools (each pre-classified out of
    // band so a site can't mislabel a write as a read), plus the models it may run on. We do NOT
    // dump the user's whole tool universe; a site gets what it requests, nothing more.
    const builtinDesc = new Map(BUILTIN_TOOLS.map((t) => [t.name, t.description]));
    const requestedTools = ((requested.tools ?? []) as string[]).map((name) => ({
      name,
      access: classifyTool(name),
      label: builtinDesc.get(name) ?? this.deps.mcp.get(name)?.title ?? connectorLabel(name),
    }));
    const consentBody = {
      origin,
      reason: requested.reason,
      models: { available: await this.deps.backends.models(), requested: requested.models ?? [] },
      tools: requestedTools,
      budgets: { maxTokensPerDay: requested.budgets?.maxTokensPerDay ?? 200_000, maxCallsPerMin: requested.budgets?.maxCallsPerMin ?? 30 },
    };
    const approved = await this.requestConnectConsent(origin, consentBody);
    if (!approved) throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user rejected connect");
    // Re-classify every approved tool out of band so the UI's labels can't downgrade danger.
    const tools = approved.tools.map((t) => ({ name: t.name, access: classifyTool(t.name) }));
    const grant = this.deps.grants.upsert(origin, { models: approved.models, tools, budgets: approved.budgets, expiresAt: approved.expiresAt });
    this.deps.audit.record({ origin, kind: "connect", outcome: "ok" });
    this.broadcast({ type: "event", event: "connect", payload: grant });
    return grant;
  }

  private async permissions(origin: string, params?: { request?: ScopeRequest }): Promise<OriginGrant | null> {
    if (params?.request) return this.connect(origin, params.request); // change ⇒ re-consent
    return this.deps.grants.get(origin);
  }

  private listTools(origin: string): ToolDescriptor[] {
    const grant = this.deps.grants.get(origin);
    if (!grant) return [];
    const allowed = new Set(grant.tools.map((t) => t.name));
    const builtins: ToolDescriptor[] = BUILTIN_TOOLS.map((t) => ({ name: t.name, server: t.server, title: t.description, description: t.description, access: classifyTool(t.name) }));
    return [...builtins, ...this.deps.mcp.all()]
      .filter((t) => allowed.has(t.name))
      .map((t) => ({ ...t, access: classifyTool(t.name) }));
  }

  private async complete(origin: string, params: CompletionParams) {
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    const controller = new AbortController();
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest) => this.deps.gate.gateToolCall(origin, call),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments),
      emit: (_d: StreamDelta) => { /* one-shot: deltas discarded */ },
      signal: controller.signal,
    };
    const out = await backend.run(params, ctx);
    const text = out.text;
    const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(text);
    this.deps.gate.recordCompletion(origin, tokens);
    return { text, model: params.model ?? backend.id, usage: out.usage, stopReason: "end" as const };
  }

  private async startStream(origin: string, params: CompletionParams): Promise<{ streamId: string }> {
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    const streamId = randomUUID();
    const controller = new AbortController();
    this.streams.set(streamId, controller);
    const emit = (delta: StreamDelta) => this.broadcast({ type: "event", event: "delta", payload: { streamId, ...delta } });
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest) => this.deps.gate.gateToolCall(origin, call),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments),
      emit,
      signal: controller.signal,
    };
    // Fire and forget; deltas flow as events keyed by streamId.
    backend.run(params, ctx)
      .then((out) => {
        const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(out.text);
        this.deps.gate.recordCompletion(origin, tokens);
        emit({ type: "done", result: { text: out.text, model: params.model ?? backend.id, usage: out.usage, stopReason: "end" } });
      })
      .catch((err) => emit({ type: "error", error: { code: String(BYOPErrorCode.BACKEND_ERROR), message: String(err).slice(0, 160) } }))
      .finally(() => this.streams.delete(streamId));
    return { streamId };
  }

  private broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ext of this.extensions) { try { ext.send(s); } catch { /* dropped */ } }
  }
}

/** A friendly label for a requested tool/connector name for the consent UI. */
function connectorLabel(name: string): string {
  const m = name.match(/^mcp__claude_ai_([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (m) return m[2] === "*" ? `${m[1]} connector (all tools)` : `${m[1]} · ${m[2]}`;
  return name.endsWith("*") ? `${name.replace(/^mcp__/, "").replace(/__\*$/, "")} (all tools)` : name;
}

function e_code(err: ProviderError): number { return (err as any).code ?? BYOPErrorCode.BACKEND_ERROR; }
function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
