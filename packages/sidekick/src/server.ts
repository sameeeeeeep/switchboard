import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type {
  BYOPMethod,
  Capabilities,
  CompletionParams,
  OriginGrant,
  RequestEnvelope,
  ScopeRequest,
  StorageRequest,
  StorageResult,
  ContextRequest,
  ContextResult,
  Context,
  SessionRequest,
  SessionResult,
  SpeakParams,
  StreamDelta,
  ToolCallRequest,
  ToolDescriptor,
} from "@relay/protocol";
import { BYOP_VERSION, BYOPErrorCode, ProviderError, isTabPrincipal, hostOfTabPrincipal } from "@relay/protocol";
import type { DaemonConfig } from "./config.js";
import { saveProfile } from "./config.js";
import type { Gate } from "./security/gate.js";
import type { GrantStore } from "./security/grant-store.js";
import type { BudgetLedger } from "./security/budgets.js";
import type { AuditLog } from "./security/audit-log.js";
import type { ConsentPrompter, PerActionConsentRequest } from "./security/consent.js";
import type { McpRegistry } from "./mcp/registry.js";
import type { BackendRegistry } from "./backends/registry.js";
import { relayNativeServer, type GitPublishContext } from "./backends/relay-native.js";
import { classifyTool } from "./security/classifier.js";
import { StorageStore, StorageKeyError } from "./storage/store.js";
import { ContextLibrary, folderOf } from "./context/library.js";
import { resolveCsv, assertPublicUrl } from "./context/resolver.js";
import { SessionManager } from "./session/manager.js";
import { localTTS, ttsAvailable, ttsVoices } from "./media/speech.js";

/** Merge the origin's local MCP servers with a per-run relay-native server holding this call's
 *  attachments (relay__put_blob) and, when the origin has a BOUND folder, the publish verb
 *  (relay__git_commit_push). Neither → no relay server at all, so the SDK still inherits the
 *  user's claude.ai connectors unchanged. */
function buildMcpServers(local: Record<string, unknown>, attachments?: { handle: string; filename: string; contentType: string; dataUrl: string }[], gitCtx?: GitPublishContext) {
  const wantGit = !!gitCtx?.folder;
  if (!attachments?.length && !wantGit) return local;
  return { ...local, relay: relayNativeServer(new Map((attachments ?? []).map((a) => [a.handle, a])), wantGit ? gitCtx : undefined) };
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
  storage: StorageStore;
  contexts: ContextLibrary;
  sessions: SessionManager;
}

interface Pending { resolve: (v: any) => void; reject: (e: any) => void; }

/** How long a resolved source-backed context (Sheet/CSV) stays cached before the next read re-fetches. */
const SOURCE_TTL_MS = 5 * 60_000;

/** Built-in (non-MCP) tools the model can be granted. Classified by the daemon like any tool
 *  (WebFetch/WebSearch are reads). They're offered in the connect flow and gated identically. */
const BUILTIN_TOOLS: Array<{ name: string; server: string; description: string }> = [
  { name: "WebFetch", server: "builtin", description: "Fetch and read a web page" },
  { name: "WebSearch", server: "builtin", description: "Search the web" },
];

/** App-level keepalive frame (Chrome resets the MV3 idle timer on received WS messages). */
const PING_MSG = JSON.stringify({ type: "ping" });

export class Broker implements ConsentPrompter {
  private wss: WebSocketServer | null = null;
  private extensions = new Set<WebSocket>();
  /** Consent + control requests awaiting a reply from the extension. */
  private pending = new Map<string, Pending>();
  /** DURABLE prompt queue: every open consent prompt, kept so it can be RE-PUSHED to any extension
   *  that (re)connects. This is what lets a consent survive an MV3 worker eviction — the daemon's
   *  prompt would otherwise land on a dropped socket and fail closed. Cleared on reply/timeout. */
  private promptQueue = new Map<string, { kind: string; body: unknown }>();
  /** In-flight streams for cancellation. */
  private streams = new Map<string, AbortController>();
  /** Keeps every connected extension's MV3 worker alive (see start()). */
  private heartbeat: NodeJS.Timeout | null = null;

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
          if (msg?.type === "auth" && msg.token === pairingToken) {
            authed = true; this.extensions.add(ws); ws.send(JSON.stringify({ type: "auth_ok" }));
            // A (re)connecting extension may have missed prompts sent while it was evicted — re-push them.
            for (const [id, p] of this.promptQueue) { try { ws.send(JSON.stringify({ type: "prompt", id, kind: p.kind, body: p.body })); } catch { /* ignore */ } }
          }
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
    // HEARTBEAT — the fix for "attached but not flowing". The extension is an MV3 service worker
    // that Chrome evicts after ~30s of silence; a long model "think" produces no deltas, the worker
    // dies, its socket drops, and every later delta broadcasts into the void while the page waits
    // forever. An app-level ping every 20s keeps message traffic flowing, which resets Chrome's SW
    // idle timer (WS activity extends worker lifetime), so the pipe stays alive through long streams.
    this.heartbeat = setInterval(() => {
      for (const ws of this.extensions) {
        if (ws.readyState === ws.OPEN) { try { ws.send(PING_MSG); } catch { this.extensions.delete(ws); } }
        else this.extensions.delete(ws);
      }
    }, 20_000);
    this.heartbeat.unref?.();
    console.error(`[relay] sidekick listening on ws://${host}:${port} (paired-only)`);
  }

  // ---- ConsentPrompter: push to the extension popup, await the user's click. Fail-closed. ----
  requestWriteConsent(reqBody: PerActionConsentRequest): Promise<boolean> {
    return this.ask<boolean>("consent:write", reqBody, 120_000, false);
  }
  /** Ask the user to authorize pointing an origin's storage at a real folder. The exact absolute
   *  path is shown; this is the one storage escalation that always needs a human click. */
  requestStorageBindConsent(origin: string, path: string): Promise<boolean> {
    return this.ask<boolean>("consent:storage-bind", { origin, path }, 120_000, false);
  }
  /** Ask the user to pick a context to lend this origin — the picker shows the library (names only)
   *  and returns the chosen id, or null. Selecting IS the consent to share that whole context. */
  requestContextPick(origin: string, contexts: unknown): Promise<{ contextId: string } | null> {
    return this.ask<{ contextId: string } | null>("consent:context-pick", { origin, contexts }, 120_000, null);
  }
  /** First-use consent for TabSidekick ("Unconnected Mode") on a host that hasn't opted in. One
   *  prompt per host: "Use TabSidekick on <host> — reads page content and images; nothing is sent to
   *  the site." Durable like every other consent (re-pushed on reconnect). */
  requestTabSidekickConsent(origin: string, host: string): Promise<boolean> {
    return this.ask<boolean>("consent:tabsidekick", { origin, host }, 120_000, false);
  }
  async requestConnectConsent(_origin: string, body: unknown) {
    // `body` is already the full consent payload (origin, reason, models, tools, budgets) — send it
    // through as-is so the consent view can read it directly.
    return this.ask<null | { models: string[]; tools: Array<{ name: string; access: "read" | "write" }>; budgets?: any; expiresAt?: number }>(
      "consent:connect", body, 120_000, null,
    );
  }
  private ask<T>(kind: string, body: unknown, timeoutMs: number, failValue: T): Promise<T> {
    // The prompt is DURABLE: queued so it re-pushes to any extension that (re)connects. The MV3 worker
    // can evict mid-consent and drop its socket; instead of fail-closing that gap, we hold the prompt
    // and re-deliver it when the worker wakes (e.g. the user opens the panel). Only a real timeout
    // (no human decision within `timeoutMs`) fails closed.
    const id = randomUUID();
    return new Promise<T>((resolve) => {
      const done = (v: T) => { clearTimeout(timer); this.pending.delete(id); this.promptQueue.delete(id); resolve(v); };
      const timer = setTimeout(() => done(failValue), timeoutMs);
      this.pending.set(id, { resolve: (v) => done(v as T), reject: () => done(failValue) });
      this.promptQueue.set(id, { kind, body });
      this.pushPrompt(id, kind, body); // deliver to a currently-connected extension, if any
    });
  }

  /** Send a prompt to the currently-connected extension (if any); harmless if none — it's re-pushed
   *  from `promptQueue` the moment an extension (re)connects. */
  private pushPrompt(id: string, kind: string, body: unknown) {
    const ext = [...this.extensions][0];
    if (ext) { try { ext.send(JSON.stringify({ type: "prompt", id, kind, body })); } catch { /* re-pushed on reconnect */ } }
  }

  // ---- request routing: one authoritative `origin` per envelope, set by the extension. ----
  private async handle(ws: WebSocket, env: RequestEnvelope) {
    const respond = (result?: unknown, error?: unknown) => ws.send(JSON.stringify({ type: "response", id: env.id, result, error }));
    try {
      const result = await this.dispatch(env, ws);
      this.deps.audit.record({ origin: env.origin, kind: "request", method: env.method, outcome: "ok" });
      respond(result);
    } catch (err) {
      const e = err instanceof ProviderError ? { code: e_code(err), message: err.message } : { code: BYOPErrorCode.BACKEND_ERROR, message: "internal error" };
      this.deps.audit.record({ origin: env.origin, kind: "request", method: env.method, outcome: "denied", note: e.message.slice(0, 120) });
      respond(undefined, e);
    }
  }

  private async dispatch(env: RequestEnvelope, ws: WebSocket): Promise<unknown> {
    const { origin, method } = env;
    switch (method as BYOPMethod) {
      case "claude_capabilities":
        return this.capabilities();
      case "claude_connect":
        return this.connect(origin, (env.params as ScopeRequest) ?? {});
      case "claude_disconnect":
        return { ok: true };
      case "claude_speak":
        return this.speak(origin, env.params as SpeakParams);
      case "claude_permissions":
        return this.permissions(origin, env.params as any);
      case "claude_listTools":
        return { tools: this.listTools(origin) };
      case "claude_callTool":
        return this.deps.gate.gateToolCall(origin, env.params as ToolCallRequest);
      case "claude_complete":
        return this.complete(origin, env.params as CompletionParams);
      case "claude_stream":
        return this.startStream(origin, env.params as CompletionParams, ws);
      case "claude_cancel": {
        const { streamId } = env.params as { streamId: string };
        this.streams.get(streamId)?.abort();
        return { ok: true };
      }
      case "claude_storage":
        return this.storageOp(origin, env.params as StorageRequest);
      case "claude_context":
        return this.contextOp(origin, env.params as ContextRequest);
      case "claude_session":
        return this.sessionOp(origin, env.params as SessionRequest);
      default:
        throw new ProviderError(BYOPErrorCode.UNSUPPORTED_METHOD, `unknown method ${method}`);
    }
  }

  private async capabilities(): Promise<Capabilities> {
    return {
      version: BYOP_VERSION,
      methods: ["claude_capabilities", "claude_connect", "claude_disconnect", "claude_complete", "claude_stream", "claude_cancel", "claude_listTools", "claude_callTool", "claude_permissions", "claude_storage", "claude_context", "claude_session", "claude_speak"],
      models: await this.deps.backends.models(),
      backends: await this.deps.backends.onlineIds(),
      agentic: true,
      user: this.deps.config.profile,
      local: { tts: ttsAvailable(), voices: ttsVoices() },
    };
  }

  /** claude_speak — synthesize speech on-device (local TTS server or the OS engine). No cloud, no
   *  connector, no credits; it only touches local audio synthesis, so a connected origin may call it
   *  freely (audited, no per-action consent). The orchestrator leaning on a local model. */
  private async speak(origin: string, params: SpeakParams): Promise<{ audio: string; backend: string; voice?: string }> {
    if (!this.deps.grants.get(origin)) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using speech");
    if (!ttsAvailable()) throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "no local TTS on this machine");
    try {
      const out = await localTTS(params.text, params.voice);
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `claude_speak__${out.backend}`, outcome: "ok", note: `${params.text.length} chars` });
      return out;
    } catch (e) {
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "claude_speak", outcome: "denied", note: String((e as Error).message).slice(0, 80) });
      throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "local TTS failed");
    }
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
          grants: this.deps.grants.list().map((g) => ({
            ...g,
            usage: this.deps.budgets.usage(g.origin),
            // Where this origin's data lives — the folder it's bound to (or its private sandbox) and
            // how many records are there. This is the "your data" the side panel surfaces per site.
            storage: (() => { try { return this.deps.storage.info(g.origin); } catch { return null; } })(),
          })),
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
      case "setModelOverride": {
        // Per-site USER model choice: run this granted model regardless of what the app asks for
        // (null clears it → honor the app's request). Rejected if the model isn't granted.
        const origin = String(args?.origin ?? "");
        const model = args?.model == null ? null : String(args.model);
        const g = this.deps.grants.setModelOverride(origin, model);
        if (g) { this.deps.audit.record({ origin, kind: "request", method: `model-override:${model ?? "(cleared)"}`, outcome: "ok" }); this.broadcast({ type: "event", event: "permissionsChanged", payload: g }); }
        return { ok: !!g, grant: g };
      }
      case "listContexts":
        // The WHOLE library — panel-only (an app never gets this). Powers the project switcher.
        return {
          contexts: this.deps.contexts.listAll(),
          activeProject: this.deps.contexts.activeProject(),
          selections: this.deps.grants.list().map((g) => ({ origin: g.origin, contextId: this.deps.contexts.selectionFor(g.origin) })),
        };
      case "selectContext": {
        // The user lends a context to ONE app (or clears it with null). Selection = consent, out of band.
        const origin = String(args?.origin ?? "");
        // A "project" context carries a folder. Lending it to an app points the app's storage AT that
        // folder — the wrapp reads/writes its real project files, not the private sandbox. Do this
        // BEFORE mutating the selection so we can tell what the app was lent previously.
        const prevContextId = this.deps.contexts.selectionFor(origin) ?? null;
        const prevFolder = folderOf(this.deps.contexts.get(prevContextId ?? "")?.data);
        const nextFolder = folderOf(this.deps.contexts.get(String(args?.contextId ?? ""))?.data);
        this.deps.contexts.select(origin, args?.contextId ?? null);
        if (nextFolder) {
          // A malformed project folder must not crash the control channel — fail the lend cleanly and
          // revert the selection so the app isn't left pointing at a folder we couldn't bind.
          try {
            this.deps.storage.bind(origin, nextFolder);
          } catch (err) {
            this.deps.contexts.select(origin, prevContextId);
            this.deps.audit.record({ origin, kind: "request", method: "context:select", outcome: "error", note: String((err as Error)?.message || err).slice(0, 160) });
            return { ok: false, error: `Couldn't point this app at that project's folder — ${String((err as Error)?.message || err).slice(0, 160)}` };
          }
        } else if (prevFolder) this.deps.storage.unbind(origin); // left a folder-project → back to sandbox
        this.deps.audit.record({ origin, kind: "request", method: `context:${args?.contextId ? "select" : "clear"}`, outcome: "ok" });
        const g = this.deps.grants.get(origin);
        if (g) this.broadcast({ type: "event", event: "permissionsChanged", payload: g });
        return { ok: true };
      }
      case "setActiveProject": {
        // The user's global "working on" project — the default context every connected app inherits.
        this.deps.contexts.setActiveProject(args?.contextId ?? null);
        this.deps.audit.record({ origin: "*", kind: "request", method: `project:${args?.contextId ? "set" : "clear"}`, outcome: "ok" });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "project-changed" } });
        return { ok: true };
      }
      case "getProfile":
        return { profile: this.deps.config.profile };
      case "setProfile": {
        // The user tells us their name (or a connected account provides it) — the REAL source of the
        // greeting, persisted. Updates the in-memory config so capabilities() reflects it immediately.
        const name = String(args?.name ?? "").trim();
        if (!name) return { ok: false, error: "name required" };
        this.deps.config.profile = saveProfile({ name, avatar: args?.avatar });
        this.deps.audit.record({ origin: "*", kind: "request", method: "profile:set", outcome: "ok" });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "profile-changed" } });
        return { ok: true, profile: this.deps.config.profile };
      }
      case "saveContext": {
        // Panel-authored context — e.g. kind "personal": the founder's own contact card (name,
        // phone, email, address, company). The panel is the trusted author; an app still only
        // ever receives it when the user LENDS it (selection = consent, same as any context).
        const name = String(args?.name ?? "").trim();
        if (!name) return { ok: false, error: "name required" };
        const kind = String(args?.kind ?? "note").trim() || "note";
        const saved = this.deps.contexts.publish("panel", { id: args?.id ? String(args.id) : undefined, name, kind, data: args?.data ?? null });
        this.deps.audit.record({ origin: "*", kind: "request", method: "context:save", outcome: "ok", note: name });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "context-changed" } });
        return { ok: true, id: saved.id };
      }
      case "getContext": {
        // Panel-only: the FULL context (data included) so the manager can prefill an edit form.
        const ctx = this.deps.contexts.get(String(args?.contextId ?? ""));
        return ctx ? { ok: true, context: ctx } : { ok: false, error: "not found" };
      }
      case "deleteContext": {
        const removed = this.deps.contexts.remove(String(args?.contextId ?? ""));
        this.deps.audit.record({ origin: "*", kind: "request", method: "context:delete", outcome: removed ? "ok" : "denied" });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "context-changed" } });
        return { ok: removed };
      }
      case "addSourceContext": {
        // The user adds a live data source (a published Google Sheet / CSV URL) as a context. Panel-driven.
        const name = String(args?.name ?? "").trim();
        const url = String(args?.url ?? "").trim();
        if (!name || !url) return { ok: false, error: "name and url required" };
        try { assertPublicUrl(url); } catch (e) { return { ok: false, error: String((e as Error).message) }; }
        const ctx = this.deps.contexts.publish("panel", { name, kind: args?.kind === "gsheet" ? "gsheet" : "csv", source: { kind: args?.kind === "gsheet" ? "gsheet" : "csv", url } });
        const resolved = await this.resolveContext(this.deps.contexts.get(ctx.id)); // fetch once now
        this.deps.audit.record({ origin: "panel", kind: "request", method: "context:add-source", outcome: "ok", note: name.slice(0, 40) });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "context-added" } });
        return { ok: true, id: ctx.id, rowCount: (resolved?.data as any)?.rowCount ?? 0 };
      }
      case "refreshContext": {
        this.deps.contexts.markStale(String(args?.id ?? ""));
        await this.resolveContext(this.deps.contexts.get(String(args?.id ?? "")));
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "context-refreshed" } });
        return { ok: true };
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
    // TabSidekick principal (`tabsidekick@<host>`): a distinct, extension-driven flow — the user's
    // own Claude working on content extracted from a page that hasn't opted in. Separate consent,
    // separate grant key, never the page's connectors.
    if (isTabPrincipal(origin)) return this.connectTabSidekick(origin);
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
      // Library visibility the app asks for (names by kind, e.g. ["brand"]) — its own consent row.
      contextKinds: (requested.contextKinds ?? []).map((k) => String(k).trim()).filter(Boolean),
    };
    const approved = await this.requestConnectConsent(origin, consentBody);
    if (!approved) throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user rejected connect");
    // Re-classify every approved tool out of band so the UI's labels can't downgrade danger.
    const tools = approved.tools.map((t) => ({ name: t.name, access: classifyTool(t.name) }));
    // contextKinds is FAIL-CLOSED: only what the consent UI explicitly echoes back survives — an
    // older extension that doesn't know the field yields none, never an implicit grant. The echo
    // keeps its shape: [] = the user saw the library row and declined it (never re-ask), undefined
    // = the UI never asked (a scope-upgrade re-consent may ask later).
    const approvedKinds = (approved as unknown as { contextKinds?: unknown }).contextKinds;
    const contextKinds = Array.isArray(approvedKinds) ? approvedKinds.map((k) => String(k)).filter(Boolean) : undefined;
    const grant = this.deps.grants.upsert(origin, { models: approved.models, tools, budgets: approved.budgets, contextKinds, expiresAt: approved.expiresAt });
    this.deps.audit.record({ origin, kind: "connect", outcome: "ok" });
    this.broadcast({ type: "event", event: "connect", payload: grant });
    return grant;
  }

  /**
   * TabSidekick connect: first use per host shows ONE consent, then a fixed, minimal grant keyed to
   * the `tabsidekick@<host>` principal — the user's own models, COMPLETIONS ONLY (tools: []). It gets
   * no site connectors: TabSidekick reads the page read-only in the browser and the user performs any
   * delivery back, so nothing is ever sent to the site. Storage/context/speak all work off this grant
   * exactly like a connected app, but under the separate principal key. Idempotent: once granted, the
   * same host returns the existing grant without re-prompting.
   */
  private async connectTabSidekick(origin: string): Promise<OriginGrant> {
    const existing = this.deps.grants.get(origin);
    if (existing) return existing;
    const host = hostOfTabPrincipal(origin);
    const approved = await this.requestTabSidekickConsent(origin, host);
    if (!approved) throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user rejected TabSidekick");
    const models = await this.deps.backends.models();
    const grant = this.deps.grants.upsert(origin, { models, tools: [], budgets: undefined });
    this.deps.audit.record({ origin, kind: "connect", outcome: "ok", note: `tabsidekick ${host}` });
    this.broadcast({ type: "event", event: "connect", payload: grant });
    return grant;
  }

  private async permissions(origin: string, params?: { request?: ScopeRequest }): Promise<OriginGrant | null> {
    if (params?.request) return this.connect(origin, params.request); // change ⇒ re-consent
    return this.deps.grants.get(origin);
  }

  /**
   * claude_storage — per-origin persistence. Consent tiers, enforced out of band:
   *   - get / list / info  → reads, auto-approved within the origin's grant.
   *   - set / delete       → writes, allowed unless the site's mode is "readonly". These touch only
   *                          the origin's OWN folder (sandbox or a folder the user already bound), so
   *                          like localStorage they don't prompt per write.
   *   - bind               → the escalation: point the store at a real folder. ALWAYS a consent click
   *                          showing the exact path; the model/page can never satisfy it alone.
   */
  private async storageOp(origin: string, req: StorageRequest): Promise<StorageResult> {
    const grant = this.deps.grants.get(origin);
    if (!grant) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using storage");
    const store = this.deps.storage;
    const log = (op: string, outcome: "ok" | "denied", note?: string) =>
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `claude_storage__${op}`, outcome, note });
    try {
      switch (req.op) {
        case "get": {
          const value = store.get(origin, requireKey(req.key));
          log("get", "ok");
          return { ok: true, value };
        }
        case "list":
          return { ok: true, keys: store.list(origin) };
        case "info":
          return { ok: true, info: store.info(origin) };
        case "set": {
          if (grant.mode === "readonly") { log("set", "denied", "readonly"); throw new ProviderError(BYOPErrorCode.CONSENT_DENIED, "site is read-only"); }
          store.set(origin, requireKey(req.key), req.value ?? "");
          log("set", "ok");
          return { ok: true };
        }
        case "delete": {
          if (grant.mode === "readonly") { log("delete", "denied", "readonly"); throw new ProviderError(BYOPErrorCode.CONSENT_DENIED, "site is read-only"); }
          const existed = store.delete(origin, requireKey(req.key));
          log("delete", "ok");
          return { ok: existed };
        }
        case "bind": {
          if (!req.path) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "bind requires a path");
          const approved = await this.requestStorageBindConsent(origin, req.path);
          if (!approved) { log("bind", "denied", req.path.slice(0, 120)); throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user rejected folder bind"); }
          store.bind(origin, req.path);
          const info = store.info(origin);
          log("bind", "ok", info.folder.slice(0, 120));
          this.broadcast({ type: "event", event: "permissionsChanged", payload: grant });
          return { ok: true, info };
        }
        default:
          throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, `unknown storage op ${(req as any).op}`);
      }
    } catch (err) {
      if (err instanceof StorageKeyError) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, err.message);
      if (err instanceof ProviderError) throw err;
      // Surface the REAL reason (e.g. a bad bound folder) instead of a generic "internal error".
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `claude_storage__${req.op}`, outcome: "denied", note: String((err as Error)?.message || err).slice(0, 160) });
      throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, `storage ${req.op} failed: ${String((err as Error)?.message || err).slice(0, 160)}`);
    }
  }

  /**
   * claude_context — the shared, cross-app context primitive.
   *   - publish → producer writes a whole context to the library (a write; blocked in readonly mode).
   *   - list    → the caller's OWN published contexts (metadata) — safe, it made them.
   *   - active  → the ONE context the user selected for THIS origin (or null). This is the only way
   *               an app sees another app's context, and only because the user chose to lend it.
   *   - pick    → open the panel picker; the user's choice becomes this origin's selection + returns it.
   * An app can never enumerate the whole library — that's panel-only (handleControl).
   */
  private async contextOp(origin: string, req: ContextRequest): Promise<ContextResult> {
    const grant = this.deps.grants.get(origin);
    if (!grant) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using context");
    const lib = this.deps.contexts;
    const log = (op: string, outcome: "ok" | "denied", note?: string) =>
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `claude_context__${op}`, outcome, note });
    switch (req.op) {
      case "publish": {
        if (grant.mode === "readonly") { log("publish", "denied", "readonly"); throw new ProviderError(BYOPErrorCode.CONSENT_DENIED, "site is read-only"); }
        if (!req.context?.name) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "publish requires context.name");
        const ctx = lib.publish(origin, req.context);
        log("publish", "ok", ctx.name.slice(0, 60));
        this.broadcast({ type: "event", event: "permissionsChanged", payload: grant });
        return { ok: true, id: ctx.id };
      }
      case "list": {
        // Own published contexts, always — plus library METADATA for any kinds the user granted
        // at connect (ScopeRequest.contextKinds). Names travel; data never does on this op.
        const own = lib.listOwn(origin);
        const kinds = this.deps.grants.get(origin)?.contextKinds ?? [];
        if (!kinds.length) return { ok: true, contexts: own };
        const kindSet = new Set(kinds.map((k) => k.toLowerCase()));
        const seen = new Set(own.map((c) => c.id));
        const shared = lib.listAll().filter((c) => !seen.has(c.id) && kindSet.has((c.kind ?? "").toLowerCase()));
        log("list", "ok", `${own.length} own + ${shared.length} library`);
        return { ok: true, contexts: [...own, ...shared] };
      }
      case "use": {
        // Read ONE listed context in full and make it this app's selection. Allowed only for the
        // app's own contexts or kinds the user granted visibility to — and audited by name.
        const id = String(req.id ?? "");
        const ctx = id ? lib.get(id) : null;
        if (!ctx) { log("use", "denied", "not found"); return { ok: false, error: "no such context" }; }
        const kinds = this.deps.grants.get(origin)?.contextKinds ?? [];
        const allowed = ctx.publishedBy === origin || kinds.map((k) => k.toLowerCase()).includes((ctx.kind ?? "").toLowerCase());
        if (!allowed) { log("use", "denied", ctx.name); return { ok: false, error: "not granted for this kind" }; }
        lib.select(origin, id);
        log("use", "ok", ctx.name);
        return { ok: true, context: lib.active(origin) };
      }
      case "active":
        return { ok: true, context: await this.resolveContext(lib.active(origin)) };
      case "pick": {
        const choice = await this.requestContextPick(origin, lib.listAll());
        if (!choice) { log("pick", "denied"); return { ok: true, context: null }; }
        lib.select(origin, choice.contextId);
        log("pick", "ok", choice.contextId);
        this.broadcast({ type: "event", event: "permissionsChanged", payload: grant });
        return { ok: true, context: await this.resolveContext(lib.active(origin)) };
      }
      default:
        throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, `unknown context op ${(req as any).op}`);
    }
  }

  /** For a source-backed context (a Google Sheet / CSV), fetch + parse it into JSON rows when the cache
   *  is missing or stale, then hand back the resolved context. Plain contexts pass through untouched.
   *  Failures are non-fatal — the app just gets the last cached value (or null rows). */
  private async resolveContext(ctx: Context | null): Promise<Context | null> {
    if (!ctx?.source) return ctx;
    const fresh = ctx.source.fetchedAt && Date.now() - ctx.source.fetchedAt < SOURCE_TTL_MS;
    if (fresh) return ctx;
    try {
      const resolved = await resolveCsv(ctx.source.url, { timeoutMs: 12_000 });
      this.deps.contexts.setResolved(ctx.id, resolved, resolved.fetchedAt);
      this.deps.audit.record({ origin: ctx.publishedBy ?? "panel", kind: "tool_call", toolName: "claude_context__resolve", outcome: "ok", note: `${resolved.rowCount} rows` });
      return this.deps.contexts.get(ctx.id);
    } catch (err) {
      this.deps.audit.record({ origin: ctx.publishedBy ?? "panel", kind: "tool_call", toolName: "claude_context__resolve", outcome: "error", note: String(err).slice(0, 80) });
      return ctx; // fall back to last cached value
    }
  }

  /**
   * claude_session — a warm, read-only completion thread. Gated like a completion: the origin must be
   * connected and the model in scope, and each turn is budget-counted. The session runs with only the
   * web read tools the origin granted (never a write tool), so no gated write can happen inside it.
   */
  private async sessionOp(origin: string, req: SessionRequest): Promise<SessionResult> {
    const grant = this.deps.grants.get(origin);
    if (!grant) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using a session");
    if (!req.sessionId) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "session requires a sessionId");
    if (req.op === "end") { this.deps.sessions.end(origin, req.sessionId); return { ok: true }; }
    if (req.op !== "send") throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, `unknown session op ${(req as any).op}`);
    // Gate the turn exactly like a completion: model in scope + rate/token budget.
    this.deps.gate.assertCompletionAllowed(origin, req.model, 4096);
    // A session may use ONLY the web reads the origin already granted — never a write tool.
    const granted = new Set(grant.tools.map((t) => t.name));
    const allowedReadTools = ["WebSearch", "WebFetch"].filter((t) => granted.has(t));
    const text = await this.deps.sessions.send(origin, req.sessionId, req.prompt ?? "", {
      system: req.system, model: req.model, effort: req.effort, allowedReadTools,
    });
    this.deps.gate.recordCompletion(origin, estimateTokens(text ?? ""));
    return { ok: true, text };
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

  /** Apply the user's per-origin model override: if set, run THAT model instead of the one the app
   *  asked for (the app never learns; it just runs on the user's chosen backend). The override is
   *  always a granted model (enforced at set-time), so assertCompletionAllowed still passes. */
  private withModelOverride(origin: string, params: CompletionParams): CompletionParams {
    const override = this.deps.grants.get(origin)?.modelOverride;
    return override ? { ...params, model: override } : params;
  }

  private async complete(origin: string, params: CompletionParams) {
    params = this.withModelOverride(origin, params);
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    const controller = new AbortController();
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest) => this.deps.gate.gateToolCall(origin, call),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments, this.gitCtxFor(origin)),
      emit: (_d: StreamDelta) => { /* one-shot: deltas discarded */ },
      signal: controller.signal,
    };
    const out = await backend.run(params, ctx);
    const text = out.text;
    const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(text);
    this.deps.gate.recordCompletion(origin, tokens);
    return { text, model: params.model ?? backend.id, usage: out.usage, stopReason: "end" as const };
  }

  /** Per-request context for relay__git_commit_push: the origin's EXPLICIT binding (never the
   *  sandbox), its readonly posture, the standard write-consent card, and audit. */
  private gitCtxFor(origin: string): GitPublishContext {
    const grant = this.deps.grants.get(origin);
    return {
      origin,
      folder: this.deps.storage.boundFolder(origin),
      readonly: (grant?.mode ?? "ask") === "readonly",
      requestConsent: (args) => this.requestWriteConsent({ id: randomUUID(), origin, tool: { name: "relay__git_commit_push", arguments: args }, reason: "write-action" }),
      audit: (outcome, note) => this.deps.audit.record({ origin, kind: "tool_call", toolName: "relay__git_commit_push", outcome, note }),
    };
  }

  private async startStream(origin: string, params: CompletionParams, ws: WebSocket): Promise<{ streamId: string }> {
    params = this.withModelOverride(origin, params);
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    const streamId = randomUUID();
    const controller = new AbortController();
    this.streams.set(streamId, controller);
    // Deltas go to the socket that ASKED, not to every connected browser. Broadcasting leaked
    // one origin's model output into every other paired profile's extension (and from there into
    // every page port). sendTo falls back to broadcast only if the requesting socket is gone —
    // an MV3 worker evicted mid-stream reconnects as a NEW socket and must still get the tail.
    const emit = (delta: StreamDelta) => this.sendTo(ws, { type: "event", event: "delta", payload: { streamId, ...delta } });
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest) => this.deps.gate.gateToolCall(origin, call),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments, this.gitCtxFor(origin)),
      emit,
      signal: controller.signal,
    };
    // Fire and forget; deltas flow as events keyed by streamId. Lifecycle is LOGGED so a hung or
    // failed backend shows up in sidekick.log instead of a silent, undiagnosable stall.
    const t0 = Date.now();
    console.error(`[stream] ${streamId.slice(0, 8)} start origin=${origin} model=${params.model ?? backend.id} agentic=${!!params.agentic} prompt=${(params.prompt ?? "").length}ch`);
    backend.run(params, ctx)
      .then((out) => {
        const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(out.text);
        this.deps.gate.recordCompletion(origin, tokens);
        console.error(`[stream] ${streamId.slice(0, 8)} done in ${((Date.now() - t0) / 1000).toFixed(1)}s text=${out.text.length}ch`);
        emit({ type: "done", result: { text: out.text, model: params.model ?? backend.id, usage: out.usage, stopReason: "end" } });
      })
      .catch((err) => {
        console.error(`[stream] ${streamId.slice(0, 8)} ERROR after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(err).slice(0, 200)}`);
        // Preserve typed errors — flattening everything to BACKEND_ERROR hid the one message
        // that tells a user what to actually do ("Claude Code isn't signed in…", UNAUTHORIZED).
        const code = err instanceof ProviderError ? e_code(err) : BYOPErrorCode.BACKEND_ERROR;
        const message = err instanceof ProviderError ? err.message : String(err).slice(0, 160);
        emit({ type: "error", error: { code: String(code), message } });
      })
      .finally(() => this.streams.delete(streamId));
    return { streamId };
  }

  /** Deliver to the socket that made the request; broadcast only when it's gone (worker evicted
   *  mid-stream reconnects as a new socket — the tail must not be lost). */
  private sendTo(ws: WebSocket, msg: unknown) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(msg)); return; } catch { /* fall through to broadcast */ }
    }
    this.broadcast(msg);
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

/** A storage key is required for get/set/delete; missing → INVALID_PARAMS before touching disk. */
function requireKey(key: string | undefined): string {
  if (typeof key !== "string" || key.length === 0) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "storage op requires a key");
  return key;
}

function e_code(err: ProviderError): number { return (err as any).code ?? BYOPErrorCode.BACKEND_ERROR; }
function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
