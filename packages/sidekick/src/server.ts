import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath, sep as pathSep, join as joinPath } from "node:path";
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  ConnectorInventory,
  TranscribeParams,
  SbBrandParams,
  SbBrandResult,
  GuideRunParams,
  GuideResult,
} from "@relay/protocol";
import { BYOP_VERSION, BYOPErrorCode, ProviderError, isTabPrincipal, hostOfTabPrincipal, nativePrincipal } from "@relay/protocol";
import { CONNECTOR_META, connectorIdOf, connectorsInClass, type ConnectorClass } from "@relay/protocol";
import type { DaemonConfig } from "./config.js";
import { saveProfile, saveCloudConfig, loadModelPrefs } from "./config.js";
import type { Gate } from "./security/gate.js";
import type { GrantStore } from "./security/grant-store.js";
import { canonicalModel } from "./security/grant-store.js";
// The daemon-side brand extractor — reuses the deterministic parser in @relay/bank-mcp (brand.mjs)
// over a server-to-server fetch (no CORS). Powers the sb_brand capability.
import { extractBrand } from "@relay/bank-mcp/brand-extract.mjs";
import type { BudgetLedger } from "./security/budgets.js";
import type { AuditLog } from "./security/audit-log.js";
import type { ConsentPrompter, PerActionConsentRequest } from "./security/consent.js";
import type { McpRegistry } from "./mcp/registry.js";
import { loadMcpConfig, setToolSecret } from "./mcp/config.js";
import type { BackendRegistry } from "./backends/registry.js";
import { relayNativeServer, type GitPublishContext } from "./backends/relay-native.js";
import { classifyTool } from "./security/classifier.js";
import { StorageStore, StorageKeyError, expandTilde } from "./storage/store.js";
import { resolveFind, findInFolder, type FindHit } from "./storage/find.js";
import { pickFolderNative } from "./native-picker.js";
import { AsyncLocalStorage } from "node:async_hooks";

// The RENDER surface of the request currently being handled — set per request in handle(), read in
// pushPrompt so a prompt goes back to whoever ASKED, not to a surface picked by the prompt's kind.
// A native-window wrapp (surface "app") renders its prompts on the menu bar (the notch); a browser
// tab (the extension) renders in the extension. This is what fixes "native project-pick fires the
// Chrome dialog": the requester, not the kind, decides. (founder 2026-08-27)
const reqRender = new AsyncLocalStorage<"menubar" | "extension">();
import { ContextLibrary, folderOf } from "./context/library.js";
import { resolveCsv, assertPublicUrl } from "./context/resolver.js";
import { SessionManager } from "./session/manager.js";
import { SessionRoutes } from "./session/routes.js";
import { TeamEngine } from "./team/engine.js";
import { localTTS, ttsAvailable, ttsVoices } from "./media/speech.js";
import { localSTT, sttAvailable } from "./media/stt.js";
import { runGuide } from "./guide/runner.js";
import { registerAppToken, removeAppToken } from "./config.js";
import type { NativeHandler } from "./native/listener.js";

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
  /** Team Mode engine — inert unless the user switched the mode on. Peers connect to ITS
   *  listener, never this Broker's socket; team sockets are never in `extensions`. */
  team: TeamEngine;
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
const NATIVE_METHODS: BYOPMethod[] = ["claude_capabilities", "claude_permissions", "claude_complete", "claude_listTools", "claude_callTool", "claude_storage", "claude_context", "claude_session", "claude_speak", "claude_transcribe"];

/** GATE-dispatch shapes (docs/COMPANY-OS.md §2b) — shared by the routine (full-auto) and the page
 *  (the cockpit's assisted "Approve & send" tap). */
export interface DispatchParams { channel: string; content: string; company?: string; move?: string; auto?: boolean }
export interface DispatchResult { ok: boolean; status: "sent" | "no-sender" | "declined" | "error"; channel: string; class: ConnectorClass | null; connector?: string; suggested?: string[]; note: string }

export class Broker implements ConsentPrompter, NativeHandler {
  private wss: WebSocketServer | null = null;
  private extensions = new Set<WebSocket>();
  /** Native consent surfaces (the menu-bar app). A NATIVE app's "Allow this app?" belongs here —
   *  a native surface — not in a browser side panel. Clients declare `surface:"menubar"` on auth. */
  private menubars = new Set<WebSocket>();
  /** Native APP clients (a GodWebWindow bridge — surface:"app"). They do NOT render prompts; their
   *  requests route prompts to the menu bar (the notch). Kept out of `extensions` so a native
   *  window's consent never lands in Chrome. */
  private apps = new Set<WebSocket>();
  private appOrigins = new Map<WebSocket, string>();
  private nativeEvents = new Set<{ principal: string; send: (event: unknown) => void }>();
  /** Consent + control requests awaiting a reply from the extension. */
  private pending = new Map<string, Pending>();
  /** DURABLE prompt queue: every open consent prompt, kept so it can be RE-PUSHED to any extension
   *  that (re)connects. This is what lets a consent survive an MV3 worker eviction — the daemon's
   *  prompt would otherwise land on a dropped socket and fail closed. Cleared on reply/timeout. */
  private promptQueue = new Map<string, { kind: string; body: unknown; surface: "menubar" | "extension" }>();
  /** In-flight streams for cancellation. */
  private streams = new Map<string, AbortController>();
  /** Keeps every connected extension's MV3 worker alive (see start()). */
  private heartbeat: NodeJS.Timeout | null = null;
  /** Real warm threads for stateful completions: (origin::sessionId) → the SDK's session UUID to
   *  resume on the next turn. Daemon-owned (never page-settable), so a page can only ever continue
   *  ITS OWN thread. This is what makes CompletionParams.sessionId real — the "God remembers across
   *  ⌃⌃ presses" the code long claimed but never delivered (complete() used to ignore sessionId). */
  private completionSessions = new Map<string, string>();
  private modelStateSignature: string | undefined;

  private sessionRoutes: SessionRoutes;
  constructor(private deps: BrokerDeps) { this.sessionRoutes = new SessionRoutes(deps.config.stateDir); }

  start() {
    const { host, port, pairingToken } = this.deps.config;
    this.writeTeamMirror();   // seed ~/.relay/team.json so the panel sees team state from the first read
    this.wss = new WebSocketServer({ host, port });
    // A ws 'error' with no listener is an UNCAUGHT exception that kills the daemon. A dropped
    // extension connection (tab close → ECONNRESET) trips this. Handle it at both levels.
    this.wss.on("error", (err) => console.error("[relay] wss error:", String(err).slice(0, 160)));
    this.wss.on("connection", (ws, req) => {
      ws.on("error", (err) => { console.error("[relay] ws error:", String(err).slice(0, 120)); this.extensions.delete(ws); this.menubars.delete(ws); this.apps.delete(ws); });
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
            authed = true;
            const surface = msg.surface === "menubar" ? "menubar" : msg.surface === "app" ? "app" : "extension";
            (surface === "menubar" ? this.menubars : surface === "app" ? this.apps : this.extensions).add(ws);
            ws.send(JSON.stringify({ type: "auth_ok" }));
            // Re-push queued prompts destined for THIS surface (a reconnecting client missed them).
            for (const [id, p] of this.promptQueue) {
              if (p.surface !== surface) continue;
              try { ws.send(JSON.stringify({ type: "prompt", id, kind: p.kind, body: p.body })); } catch { /* ignore */ }
            }
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
      ws.on("close", () => { this.extensions.delete(ws); this.menubars.delete(ws); this.apps.delete(ws); this.appOrigins.delete(ws); });
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
  /** Panel-anchored folder pick, step 1 of 2: the extension card announces WHO is asking in the
   *  surface every other grant lives in; the approval click is what raises the OS folder dialog. */
  requestStoragePickConsent(origin: string, reason?: string): Promise<boolean> {
    return this.ask<boolean>("consent:storage-pick", { origin, reason }, 120_000, false);
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
      // The menubar implements only connect and folder cards. Context pickers and write
      // approvals must still reach the extension, including requests from native apps.
      const surface = reqRender.getStore() === "extension" ? "extension" : this.surfaceFor(kind);
      this.promptQueue.set(id, { kind, body, surface });
      this.pushPrompt(id, kind, body, surface); // deliver to the requester's render surface
    });
  }

  /** Send a prompt to the currently-connected extension (if any); harmless if none — it's re-pushed
   *  from `promptQueue` the moment an extension (re)connects. */
  /** Which surface a consent belongs to. Native-app connect AND folder consents (bind / pick) go to
   *  the MENU BAR — a native notch card the menubar app renders (StorageBindDrop). This unifies
   *  consent at the notch and, crucially, means a NATIVE wrapp window (GodWebWindow, no browser) can
   *  actually answer a folder-bind: routed to the extension it landed on the browser and, for a
   *  localhost native origin, timed out → auto-deny ("opening the project…" hang). The fallback in
   *  pushPrompt still delivers to the extension if the menu bar isn't connected. Everything else
   *  (write consent, tabsidekick, context-pick) stays on the extension. */
  private surfaceFor(kind: string): "menubar" | "extension" {
    const menubarKinds = ["consent:native-connect", "consent:connect", "consent:storage-bind", "consent:storage-pick"];
    return menubarKinds.includes(kind) ? "menubar" : "extension";
  }
  private pushPrompt(id: string, kind: string, body: unknown, surface?: "menubar" | "extension") {
    // The requester's render surface wins (native window / menu bar → notch; browser → extension);
    // fall back to the kind's default, then to the OTHER surface so a prompt is never undeliverable.
    const s = surface ?? reqRender.getStore() ?? this.surfaceFor(kind);
    const primary = s === "menubar" ? this.menubars : this.extensions;
    const fallback = s === "menubar" ? this.extensions : this.menubars;
    const target = [...(primary.size ? primary : fallback)][0];
    if (target) { try { target.send(JSON.stringify({ type: "prompt", id, kind, body })); } catch { /* re-pushed on reconnect */ } }
  }

  // ---- request routing: one authoritative `origin` per envelope, set by the extension. ----
  private async handle(ws: WebSocket, env: RequestEnvelope) {
    if (this.apps.has(ws)) this.appOrigins.set(ws, env.origin);
    const respond = (result?: unknown, error?: unknown) => ws.send(JSON.stringify({ type: "response", id: env.id, result, error }));
    try {
      // Requests from the menu bar OR a native app window render prompts on the menu bar (the notch);
      // everything else (the browser extension) renders in the extension.
      const renderSurface: "menubar" | "extension" = (this.menubars.has(ws) || this.apps.has(ws)) ? "menubar" : "extension";
      const result = await reqRender.run(renderSurface, () => this.dispatch(env, ws));
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
    // vault.find — the LOCAL, deterministic lookup path (docs/FIND.md). A READ over the origin's own
    // vault, gated exactly like storage.get (standing grant, no consent prompt); it calls NO model and
    // touches NO network. Intercepted here so it needs no new BYOPMethod in @relay/protocol.
    if ((method as string) === "vault.find") return this.vaultFind(origin, env.params as { query?: string; project?: string });
    // claude_setToolSecret — store a third-party tool's credential (0600, local) + live-reconnect its MCP
    // server so the retry spawns with the key (task 3). Intercepted here like vault.find so it needs no
    // new BYOPMethod in @relay/protocol.
    if ((method as string) === "claude_setToolSecret") return this.setToolSecret(origin, env.params as { server?: string; env?: string; value?: string });
    switch (method as BYOPMethod) {
      case "claude_capabilities":
        return this.capabilities(origin);
      case "claude_connect":
        return this.connect(origin, (env.params as ScopeRequest) ?? {});
      case "claude_disconnect":
        return { ok: true };
      case "claude_speak":
        return this.speak(origin, env.params as SpeakParams);
      case "claude_transcribe":
        return this.transcribe(origin, env.params as TranscribeParams);
      case "sb_brand":
        return this.sbBrand(origin, env.params as SbBrandParams);
      case "guide_run":
        return this.guideRun(origin, env.params as GuideRunParams);
      case "guide_history":
        return this.guideHistory(env.params as { limit?: number });
      case "claude_permissions":
        return this.permissions(origin, env.params as any);
      case "claude_listTools":
        return { tools: this.listTools(origin) };
      case "claude_callTool": {
        const call = env.params as ToolCallRequest;
        // First-party GATE dispatch (the autopilot cockpit's "Approve & send") — reuse the callTool
        // channel so no new RPC verb/extension change is needed. pageDispatch applies its own grant
        // check + write-consent gate + audit; a real send needs a connected sender (else no-sender).
        if (call?.name === "relay__autopilot_dispatch") return this.pageDispatch(origin, (call.arguments ?? {}) as Record<string, unknown>);
        return this.deps.gate.gateToolCall(origin, call);
      }
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

  /** Store a third-party tool's credential (0600, ~/.relay/tool-secrets.json — never leaves the daemon)
   *  and live-reconnect that MCP server so the next callTool spawns it WITH the key. The value is never
   *  logged or echoed. Task 3 — the local-key credential lane. */
  private async setToolSecret(_origin: string, p: { server?: string; env?: string; value?: string }): Promise<{ ok: boolean }> {
    const server = (p?.server ?? "").trim();
    const env = (p?.env ?? "").trim();
    const value = p?.value ?? "";
    if (!server || !env || !value) return { ok: false };
    const stateDir = this.deps.config.stateDir;
    setToolSecret(stateDir, server, env, value);
    const fresh = loadMcpConfig(stateDir).servers[server]; // now carries the secret in env/headers
    if (fresh) await this.deps.mcp.reconnect(server, fresh);
    return { ok: true };
  }

  private async capabilities(origin?: string): Promise<Capabilities> {
    // Refresh health before reading the model map so recovery appears in the same snapshot.
    const backends = await this.deps.backends.onlineIds();
    let defaultModel: string | undefined;
    if (origin && this.deps.grants.get(origin)) {
      try {
        const selected = this.selectCompletion(origin, {}).model;
        if (selected && this.deps.backends.allowedModels().includes(selected) && this.deps.grants.allowsModel(origin, selected)) defaultModel = selected;
      } catch { /* No usable default: discovery must still show the recovery choices. */ }
    }
    return {
      version: BYOP_VERSION,
      methods: ["claude_capabilities", "claude_connect", "claude_disconnect", "claude_complete", "claude_stream", "claude_cancel", "claude_listTools", "claude_callTool", "claude_permissions", "claude_storage", "claude_context", "claude_session", "claude_speak", "claude_transcribe", "sb_brand", "guide_run", "guide_history"],
      // Enumerating consumers (the panel, feature-detect) see the ALLOWED set — a model the user
      // disabled in Settings → Models never even appears as a choice (docs/MODEL-SELECTION.md §4c).
      models: this.deps.backends.allowedModels(),
      modelInfo: this.deps.backends.modelInfo(),
      defaultModel,
      sessionModelPinning: true,
      backends,
      signedIn: await this.deps.backends.signedIn(),
      agentic: this.deps.backends.modelInfo().some((m) => m.capabilities.agentic),
      user: this.deps.config.profile,
      local: { tts: ttsAvailable(), stt: sttAvailable(), voices: ttsVoices() },
    };
  }

  /** Invalidate open app/panel catalogs after preferences, sign-in, or backend availability moves. */
  async notifyModelsChanged(): Promise<void> {
    const signature = JSON.stringify({ models: this.deps.backends.modelInfo(), providers: await this.deps.backends.inventory(), preferences: loadModelPrefs() });
    if (signature === this.modelStateSignature) return;
    const initial = this.modelStateSignature === undefined;
    this.modelStateSignature = signature;
    if (!initial) this.broadcast({ type: "event", event: "capabilitiesChanged", payload: { reason: "models-changed" } });
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

  /** claude_transcribe — speech-to-text on-device (local STT server or a whisper CLI). The mirror
   *  of speak: a connected principal may call it freely (audited, no per-action consent) because it
   *  only touches local recognition. Primarily used by direct-principal (native) apps. */
  private async transcribe(origin: string, params: TranscribeParams): Promise<{ text: string; backend: string }> {
    if (!this.deps.grants.get(origin)) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using transcription");
    if (!sttAvailable()) throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "no local STT on this machine");
    try {
      const out = await localSTT(params.audio, params.language);
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `claude_transcribe__${out.backend}`, outcome: "ok", note: `${out.text.length} chars` });
      return out;
    } catch (e) {
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "claude_transcribe", outcome: "denied", note: String((e as Error).message).slice(0, 80) });
      throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "local STT failed");
    }
  }

  /** sb_brand — read a brand's PUBLIC website into provenance-tagged facts, SERVER-SIDE (no browser
   *  CORS). Reuses the deterministic parser in @relay/bank-mcp (brand.mjs) over a server-to-server
   *  fetch: colours come from the site's own CSS, products from /products.json — never a model's
   *  guess. GET-only on public pages ⇒ read posture, so a connected origin may call it freely (audited,
   *  no per-action consent), like the local speak/transcribe verbs. SSRF + byte-budget guards live in
   *  the extractor (safeUrl / PRIVATE_HOST / MAX_BYTES). See docs/BRAND-EXTRACTION.md + IDEAFETCH.md. */
  private async sbBrand(origin: string, params: SbBrandParams): Promise<SbBrandResult> {
    if (!this.deps.grants.get(origin)) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before reading a brand");
    if (!params?.url || typeof params.url !== "string") throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "sb_brand requires a url");
    try {
      const brand = await extractBrand({ url: params.url, name: params.name });
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "sb_brand", outcome: brand.reachable ? "ok" : "error", note: `${brand.domain || params.url}${brand.reachable ? ` · ${brand.palette.length} colours · ${brand.products.length} products` : " · unreachable"}` });
      return brand;
    } catch (e) {
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "sb_brand", outcome: "denied", note: String((e as Error).message).slice(0, 80) });
      throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "brand extraction failed");
    }
  }

  /** guide_run — drive a GUIDED CURSOR-WALKTHROUGH on the user's screen (onboarding / setup / how-to
   *  / guided-test). Unlike speak/transcribe/sb_brand (local reads, no per-call consent), a guide is
   *  WRITE-CLASS: it takes over the cursor + keyboard, so every run is gated by the SAME per-action
   *  write-consent path a write tool call hits (`requestWriteConsent` → the "«origin» wants to …"
   *  card the human must click — no prompt injection can satisfy it). Once approved the daemon hands
   *  the steps to the native runtime via ~/.relay/guide-run.json and waits for guide-result.json.
   *  Only ONE guide runs at a time (there's a single on-screen cursor); a second is refused. */
  /** guide_history — the user's past guided runs, newest-first, from the append-only
   *  ~/.relay/guide-history.jsonl the native runtime writes. Each run carries per-step verdicts, the
   *  options/choices the user picked, any notes, and DURABLE screenshot paths (copied out of /tmp). This
   *  is how ANY later Claude thread reads what the user has done + seen — not just the one that ran the
   *  guide. Read-only over the user's OWN local record → no per-call consent (nothing a grant protects). */
  private guideHistory(params: { limit?: number }): { runs: unknown[] } {
    const path = joinPath(homedir(), ".relay", "guide-history.jsonl");
    let text = "";
    try { text = readFileSync(path, "utf8"); } catch { return { runs: [] }; }
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const limit = Math.max(1, Math.min(params?.limit ?? 25, 200));
    const runs: unknown[] = [];
    for (const l of lines.slice(-limit).reverse()) {
      try { runs.push(JSON.parse(l)); } catch { /* skip a torn line */ }
    }
    return { runs };
  }

  private guideRunning = false;
  private async guideRun(origin: string, params: GuideRunParams): Promise<GuideResult> {
    // NOTE: unlike the data-touching verbs, a guide is gated by its PER-RUN consent alone, NOT by a
    // standing origin grant. A guide reads/writes NO user data — it only floats captions by the cursor
    // and collects pass/fail keypresses — so there's nothing a grant would protect. Requiring a prior
    // Connect would also make the flagship case impossible: onboarding a user (remote Claude included)
    // who hasn't connected anything YET. The human's per-run "Allow?" click is the whole gate.
    // Validate: at least one step, each with real text. Default mode "tour"; synthesize missing ids.
    const rawSteps = Array.isArray(params?.steps) ? params.steps : [];
    const steps = rawSteps
      .filter((s) => s && typeof s.text === "string" && s.text.trim().length > 0)
      .map((s, i) => ({
        id: (typeof s.id === "string" && s.id.trim()) ? s.id.trim() : `step-${i + 1}`,
        text: s.text.trim(),
        ...(typeof s.hint === "string" && s.hint.trim() ? { hint: s.hint.trim() } : {}),
        // Clipboard payloads (non-secret) — carried through so a REMOTE guide can pre-load the clipboard,
        // not just a local guide-run.json writer. The native runtime writes/restores the real pasteboard.
        ...(typeof s.copy === "string" && s.copy.trim() ? { copy: s.copy } : {}),
        ...(typeof s.value === "string" && s.value.trim() ? { value: s.value } : {}),
      }));
    if (steps.length === 0) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "guide_run needs at least one step with text");
    const mode: "test" | "tour" = params?.mode === "test" ? "test" : "tour";
    const autoClipboard = params?.autoClipboard === true;
    const title = (typeof params?.title === "string" && params.title.trim()) ? params.title.trim() : "Guided walkthrough";

    // One cursor, one guide. Refuse a second rather than fight over the pointer.
    if (this.guideRunning) throw new ProviderError(BYOPErrorCode.BACKEND_ERROR, "a guide is already running — finish or abort it first");
    this.guideRunning = true;
    try {
      // Consent — reuse the per-action write-consent path (intrusive: hands over cursor + keyboard).
      // The card names the origin and the action; the args carry the human-readable title/mode/steps.
      const approved = await this.requestWriteConsent({
        id: randomUUID(),
        origin,
        tool: { name: "guide_run", arguments: { title, mode, steps: steps.length } },
        reason: "write-action",
      });
      if (!approved) {
        this.deps.audit.record({ origin, kind: "tool_call", toolName: "guide_run", outcome: "denied", note: `consent declined · ${title}` });
        throw new ProviderError(BYOPErrorCode.CONSENT_DENIED, "the guide was declined");
      }
      const result = await runGuide({ title, mode, steps, ...(autoClipboard ? { autoClipboard: true } : {}) });
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "guide_run", outcome: "ok", note: `${mode} · ${title} · ${result.outcome} (${result.passed}/${result.total})` });
      return result;
    } catch (e) {
      if (e instanceof ProviderError) {
        this.deps.audit.record({ origin, kind: "tool_call", toolName: "guide_run", outcome: e.code === BYOPErrorCode.CONSENT_DENIED ? "denied" : "error", note: String(e.message).slice(0, 80) });
        throw e;
      }
      this.deps.audit.record({ origin, kind: "tool_call", toolName: "guide_run", outcome: "error", note: String((e as Error).message).slice(0, 80) });
      throw new ProviderError(BYOPErrorCode.NO_GUIDE_RUNTIME, "the guide failed to run");
    } finally {
      this.guideRunning = false;
    }
  }

  // ── Native (direct-principal) surface ────────────────────────────────────────────────────────
  // Served on the SEPARATE native listener, never this Broker's extension socket. A native app
  // proves identity with its own per-app token; the daemon stamps `native@<appId>` and routes the
  // request through the SAME grant/gate/audit machinery. Interactive consent uses the menubar;
  // native discovery advertises only the methods this transport implements.

  /** Register a native app OUT OF BAND (the menubar/CLI, i.e. the native connect-consent step): mint
   *  its per-app token and grant it the requested scope so it is "connected". Returns the token the
   *  app stores (e.g. macOS Keychain). Never called by the app itself. */
  async registerNativeApp(appId: string, name?: string, scope?: { models?: string[]; tools?: { name: string; access: "read" | "write" }[]; connectors?: boolean }): Promise<{ appId: string; principal: string; token: string; models: string[] }> {
    const token = registerAppToken(appId, name);
    const principal = nativePrincipal(appId);
    // Default scope: the two local, no-consent capabilities. A grant must exist for them to run.
    const tools = scope?.tools ?? [
      { name: "claude_speak", access: "read" as const },
      { name: "claude_transcribe", access: "read" as const },
    ];
    // `connectors: true` (God's "run things" hand) additionally grants the whole MCP/connector
    // surface via the `mcp__*` wildcard — so the app can invoke ANY wrapp/connector tool the user
    // has. This is NOT a blank cheque: the per-action HUMAN gate lives upstream in the app itself
    // (God's notch "Allow this action?" drop), and every call here is still classified, rate-bounded,
    // and AUDITED. We set the grant to `trust` mode so the daemon doesn't ALSO try to raise a
    // write-consent on the extension surface (which a native app has no path to) — the notch already
    // asked the human. Reversible: disconnectNativeApp revokes the grant + token.
    if (scope?.connectors) tools.push({ name: "mcp__*", access: "write" as const });
    // Default to granting whatever models are online so the app can run cleanup completions. The
    // user's own compute; the app never sees a key. Callers may pass an explicit narrower list.
    // God ENUMERATES (it doesn't hard-code a model), so its default grant is the ALLOWED set — a
    // disabled model is never even a candidate for it (docs/MODEL-SELECTION.md §4c).
    const models = scope?.models ?? this.deps.backends.allowedModels();
    this.deps.grants.upsert(principal, { models, tools, budgets: undefined });
    if (scope?.connectors) this.deps.grants.setMode(principal, "trust");
    this.deps.audit.record({ origin: principal, kind: "request", method: "registerNativeApp", outcome: "ok", note: appId });
    return { appId, principal, token, models };
  }

  /** Interactive "Allow this app": an unregistered native app asked to connect. Push a consent
   *  prompt to the panel (rate-limited to one pending prompt per appId, so a rogue local process
   *  can't spam dialogs); on approval mint its per-app token + grant and hand them back. The human
   *  click is the gate — no prompt injection can satisfy it. (Code-sign verification of the peer is
   *  future hardening; today the card is honest that identity is unverified.) */
  private pendingNativeConnect = new Set<string>();
  async requestNativeConnect(appId: string, reason?: string, name?: string): Promise<{ token: string; models: string[] } | null> {
    if (this.pendingNativeConnect.has(appId)) return null; // already asking about this app — ignore the flood
    this.pendingNativeConnect.add(appId);
    try {
      const principal = nativePrincipal(appId);
      const canDo = ["Use your enabled AI models", "Transcribe and speak on-device", "Save this app's private data", "Use context you lend this app"];
      // `name` is the app's own display name (shown to the human); `appId` is the identity the daemon
      // trusts. Both are shown so the user sees a name AND can verify the id.
      const ok = await this.ask<boolean>("consent:native-connect", { appId, name, reason, verified: false, canDo }, 120_000, false);
      if (!ok) { this.deps.audit.record({ origin: principal, kind: "request", method: "native-connect", outcome: "denied", note: appId }); return null; }
      const reg = await this.registerNativeApp(appId, name);
      return { token: reg.token, models: reg.models };
    } finally {
      this.pendingNativeConnect.delete(appId);
    }
  }

  /** Native apps use the same per-principal scope, storage and context gate. Supported consent
   * cards render at the notch; context pickers and write approvals use the extension. */
  async handleNativeRequest(principal: string, method: string, params: unknown): Promise<unknown> {
    return reqRender.run("menubar", () => this.dispatchNativeRequest(principal, method, params));
  }

  subscribeNativeEvents(principal: string, send: (event: unknown) => void): () => void {
    const subscriber = { principal, send };
    this.nativeEvents.add(subscriber);
    return () => { this.nativeEvents.delete(subscriber); };
  }

  private async dispatchNativeRequest(principal: string, method: string, params: unknown): Promise<unknown> {
    try {
      let result: unknown;
      switch (method) {
        case "claude_capabilities": result = { ...await this.capabilities(principal), methods: NATIVE_METHODS }; break;
        case "claude_permissions": result = this.deps.grants.get(principal) ?? null; break;
        case "claude_storage": result = await this.storageOp(principal, params as StorageRequest); break;
        case "claude_context": result = await this.contextOp(principal, params as ContextRequest); break;
        case "claude_session": result = await this.sessionOp(principal, params as SessionRequest); break;
        case "claude_transcribe": result = await this.transcribe(principal, params as TranscribeParams); break;
        case "claude_speak": result = await this.speak(principal, params as SpeakParams); break;
        // One-shot completion (e.g. cleaning up a raw transcript). Self-contained — it never
        // streams to the extension socket. Tool calls still use the broker's grant and consent gate.
        case "claude_complete": result = await this.complete(principal, params as CompletionParams); break;
        // The "run things" hand (God's connector reach). A native app may ENUMERATE the tools its
        // grant covers and CALL one — but only through the exact same gate as a page: the call is
        // allowlist-checked (`mcp__*` wildcard or an exact name), classified, rate-bounded, and
        // audited. The human gate is upstream (God's notch "Allow this action?"); a native app whose
        // grant lacks the connector wildcard still gets nothing here (fail-closed).
        case "claude_listTools": result = { tools: this.listTools(principal) }; break;
        case "claude_callTool": result = await this.deps.gate.gateToolCall(principal, params as ToolCallRequest); break;
        default: throw new ProviderError(BYOPErrorCode.UNSUPPORTED_METHOD, `native apps cannot call ${method}`);
      }
      this.deps.audit.record({ origin: principal, kind: "request", method, outcome: "ok" });
      return result;
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError(BYOPErrorCode.BACKEND_ERROR, "internal error");
      this.deps.audit.record({ origin: principal, kind: "request", method, outcome: "denied", note: e.message.slice(0, 120) });
      throw e;
    }
  }

  /**
   * Control channel for the paired extension (no origin — these act ACROSS origins). Powers the
   * popup's grant list, audit view, per-origin revoke, and the kill switch. Only an authenticated
   * extension can reach this; a page never can.
   */
  private async handleControl(action: string, args: any): Promise<unknown> {
    switch (action) {
      // Register a native (direct-principal) app — the menubar's "allow this app" action. Mints the
      // app's per-app token + grant out of band; this control action IS the native connect-consent.
      case "registerNativeApp": {
        if (!args?.appId || typeof args.appId !== "string") throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "appId required");
        return this.registerNativeApp(args.appId, args.name, { models: args.models, tools: args.tools, connectors: args.connectors });
      }
      // DISCONNECT a native app (the menu bar's "×"): drop its token so it can never re-auth AND
      // revoke its grant. A later connect re-asks for consent. Reversibility for registerNativeApp.
      case "disconnectNativeApp": {
        if (!args?.appId || typeof args.appId !== "string") throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "appId required");
        const principal = nativePrincipal(args.appId);
        const hadGrant = !!this.deps.grants.get(principal);
        this.deps.grants.revoke(principal);
        const tokenGone = removeAppToken(args.appId);
        this.deps.audit.record({ origin: principal, kind: "request", method: "disconnectNativeApp", outcome: "ok", note: args.appId });
        return { ok: tokenGone || hadGrant };
      }
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
      case "vault.find": {
        // Dictation Fn→FIND (docs/FIND.md) over the TRUSTED menu-bar control channel — the user
        // themselves, so no per-origin grant. SCOPE = the ACTIVE project's vault (founder's call):
        // resolve its folder and read it directly. Pure local lookup; NEVER a model call, NEVER the
        // network. Audit the EVENT only (hit/miss + confidence) — never the query text or the value,
        // which is the whole privacy point.
        const query = typeof args?.query === "string" ? args.query : "";
        if (!query.trim()) return null;
        const activeId = this.deps.contexts.activeProject();
        const folder = folderOf(this.deps.contexts.get(activeId ?? "")?.data);
        if (!folder) return null; // no active project with a bound folder → nothing to search
        const project = typeof args?.project === "string" && args.project.trim() ? args.project.trim() : undefined;
        const hit = findInFolder(folder, query, project);
        this.deps.audit.record({ origin: "*", kind: "tool_call", toolName: "vault_find", outcome: "ok", note: hit ? `hit · ${hit.confidence}` : "miss" });
        return hit;
      }
      case "signedIn":
        // Rung 4 (STATES.md §4): the extension folds this into the ladder once paired, so the panel
        // stops reading green while the daemon can't actually run a call. Lean by design — no models
        // list, no backend probe beyond the cached sign-in verdict — because it's on the health path.
        return { ok: true, signedIn: await this.deps.backends.signedIn() };
      case "listConnectors":
        // Rung 6 (STATES.md §5.4): what's actually available, with an explicit honesty boundary —
        // local MCP servers are enumerable + exact; claude.ai connectors are inherited by the SDK
        // (in no local file) so they degrade to "unknown", never a guessed absence.
        return { ok: true, ...this.connectorInventory() };
      case "revoke": {
        const origin = String(args?.origin ?? "");
        this.deps.grants.revoke(origin);
        this.deps.audit.record({ origin, kind: "revoke", outcome: "ok" });
        this.broadcast({ type: "event", event: "disconnect", payload: { reason: "user-revoked" }, origin });
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
        if (model && !this.deps.backends.allowedModels().includes(model)) return { ok: false, error: "Choose an enabled, available model." };
        const g = this.deps.grants.setModelOverride(origin, model);
        if (g) { this.deps.audit.record({ origin, kind: "request", method: `model-override:${model ?? "(cleared)"}`, outcome: "ok" }); this.broadcast({ type: "event", event: "permissionsChanged", payload: g, origin }); }
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
      // ---- Team Mode (all panel-driven; a page can never reach these). Every case answers
      // {ok, …} instead of throwing, matching the control channel's non-throwing convention. ----
      case "team.status":
        return { ok: true, status: this.deps.team.status() };
      case "team.setEnabled":
        // The mode switch itself — flipping it on/off is a user gesture in the panel, out of band.
        return { ok: true, status: this.deps.team.setEnabled(!!args?.on) };
      case "team.pickFolder": {
        // Choose the folder to share, via the daemon-raised NATIVE dialog (the pick IS the path
        // consent — same trust story as storage "pick"). Falls back to a typed path on non-macOS.
        try {
          const path = await pickFolderNative("Team Mode", "choose the folder your team will share");
          return { ok: true, path };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 160) };
        }
      }
      case "team.host": {
        const folder = String(args?.folder ?? "").trim();
        if (!folder) return { ok: false, error: "folder required" };
        try {
          const { invite, status } = this.deps.team.host({
            folder,
            teamName: args?.teamName ? String(args.teamName) : undefined,
            lan: !!args?.lan,
            port: args?.port ? Number(args.port) : undefined,
            relay: args?.relay ? String(args.relay) : undefined,
          });
          return { ok: true, invite, status };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 160) };
        }
      }
      case "team.join": {
        try {
          const status = await this.deps.team.join(String(args?.code ?? ""), { folder: args?.folder ? String(args.folder) : undefined });
          return { ok: true, status };
        } catch (err) {
          // Never echo the pasted code back — it embeds the team secret.
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 160) };
        }
      }
      case "team.leave":
        return { ok: true, status: this.deps.team.leave() };
      case "team.setEntitlement": {
        // Panel-only: attach the Pro token billing issued for this team (or clear it).
        try {
          return { ok: true, status: this.deps.team.setEntitlement(args?.ent ? String(args.ent) : null) };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 200) };
        }
      }
      case "team.restore": {
        // Pro: rebuild a team folder on this machine from the encrypted cloud backup + invite code,
        // with no teammate online. Only this code's secret can open what the relay returns.
        try {
          const status = await this.deps.team.restore(String(args?.code ?? ""), { folder: args?.folder ? String(args.folder) : undefined });
          return { ok: true, status };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 200) };
        }
      }
      // ---- Hosted inference (OpenRouter) — the OPT-IN "cloud tokens" lane. Panel-only; a page can
      // never set a key. Off by default; the panel badges hosted models as prompts-leave-the-machine. ----
      case "cloud.status":
        return {
          ok: true,
          enabled: this.deps.backends.hasHosted(),
          hostedModels: this.deps.backends.hostedModels(),
          models: this.deps.backends.allowedModels(),
          modelInfo: this.deps.backends.modelInfo(),
        };
      case "cloud.setKey": {
        // The user pastes their own OpenRouter key (a credential — stored 0600, never leaves the
        // daemon, never echoed back). Registering it opts them into the hosted lane at runtime.
        const key = String(args?.openrouterKey ?? "").trim();
        if (!key) return { ok: false, error: "an OpenRouter key is required" };
        const saved = saveCloudConfig({ openrouterKey: key, baseUrl: args?.baseUrl ? String(args.baseUrl) : undefined, models: Array.isArray(args?.models) ? args.models.map(String) : undefined });
        await this.deps.backends.setCloudBackend(saved);
        await this.notifyModelsChanged();
        this.deps.audit.record({ origin: "*", kind: "request", method: "cloud:enable", outcome: "ok" });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "cloud-changed" } });
        return { ok: true, enabled: this.deps.backends.hasHosted(), hostedModels: this.deps.backends.hostedModels() };
      }
      case "cloud.clear": {
        saveCloudConfig({ openrouterKey: undefined });
        await this.deps.backends.setCloudBackend({});
        await this.notifyModelsChanged();
        this.deps.audit.record({ origin: "*", kind: "request", method: "cloud:disable", outcome: "ok" });
        this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "cloud-changed" } });
        return { ok: true, enabled: false };
      }
      case "team.setGit": {
        // Host names the team repo (or clears it with a null/absent remote). The panel button
        // that triggers this states the consequence in full: "commit & push this folder".
        try {
          const status = await this.deps.team.setGit(args?.remote ? String(args.remote) : null);
          return { ok: true, status };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 200) };
        }
      }
      case "team.setGitEnabled": {
        // Per-member opt-in: THIS machine starts (or stops) pushing with its own git auth.
        try {
          const status = await this.deps.team.setGitEnabled(!!args?.on);
          return { ok: true, status };
        } catch (err) {
          return { ok: false, error: String((err as Error)?.message || err).slice(0, 200) };
        }
      }
      case "team.cursor":
        // The native app streams MY cursor here (~20-30Hz, normalized 0..1) → broadcast to teammates.
        // Ephemeral realtime presence; deliberately returns nothing to keep it cheap. Never persisted.
        this.deps.team.broadcastCursor(Number(args?.x) || 0, Number(args?.y) || 0);
        return { ok: true };
      case "team.surface":
        // The native app drives a teammate's surface: open/place a wrapp on their screen. Ephemeral.
        this.deps.team.broadcastSurface({
          action: String(args?.action ?? "open"),
          wrappId: args?.wrappId ? String(args.wrappId) : undefined,
          url: args?.url ? String(args.url) : undefined,
          name: args?.name ? String(args.name) : undefined,
          placement: (args?.placement && typeof args.placement === "object") ? args.placement as any : undefined,
        });
        return { ok: true };
      default:
        return { ok: false, error: `unknown control action ${action}` };
    }
  }

  /** The connector inventory (docs/STATES.md §5.4). Local MCP servers are enumerable + exact; claude.ai
   *  connectors are inherited by the Agent SDK from the user's sign-in — held in no local file — so they
   *  are reported "unknown" rather than asserted absent. `Date.now()` is fine here (not a hot path). */
  private connectorInventory(): ConnectorInventory {
    return { local: this.deps.mcp.connectors(), inherited: "unknown", checkedAt: Date.now() };
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
    const existing = this.deps.grants.get(origin);
    const availableModels = this.deps.backends.allowedModels();
    const suggested = existing?.modelOverride ?? this.deps.backends.preferredModel(undefined);
    const requestedModels = [...new Set([
      ...(suggested ? [suggested] : []),
      ...(existing?.models ?? []),
      ...(requested.models ?? []).map((m) => this.deps.backends.preferredModel(m) ?? m),
    ])].filter((m) => availableModels.includes(m));
    const consentBody = {
      origin,
      reason: requested.reason,
      models: { available: availableModels, requested: requestedModels, default: requestedModels[0] },
      tools: requestedTools,
      budgets: { maxTokensPerDay: requested.budgets?.maxTokensPerDay ?? 200_000, maxCallsPerMin: requested.budgets?.maxCallsPerMin ?? 30 },
      // Library visibility the app asks for (names by kind, e.g. ["brand"]) — its own consent row.
      contextKinds: (requested.contextKinds ?? []).map((k) => String(k).trim()).filter(Boolean),
      // Rung 6 (STATES.md §5): the app's CLASS-level needs + what's actually available, so the consent
      // UI can offer a same-class substitute. Declarative only — `tools` above is what the gate sees;
      // an accepted substitution adds the substitute's exact tool names back through `approved.tools`,
      // which are re-classified below, so the exact-match gate is never widened by a class.
      needs: (requested.needs ?? []),
      connectors: this.connectorInventory(),
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
    const selectedModel = (approved as unknown as { modelOverride?: string }).modelOverride;
    if (selectedModel && approved.models.includes(selectedModel)) this.deps.grants.setModelOverride(origin, selectedModel);
    else if (approved.models.length === 1) this.deps.grants.setModelOverride(origin, approved.models[0]!);
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
          // 2b — attribute the artifact to the project this origin is currently lent (best-effort sidecar),
          // so the OS can scope "recent work" to the active project.
          try { const pid = this.deps.contexts.active(origin)?.id; if (pid) store.attribute(origin, requireKey(req.key), pid); } catch { /* best-effort */ }
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
        case "pick": {
          // The same escalation as bind, PANEL-ANCHORED: the extension card announces who's asking
          // (in the surface every other grant uses), and approving it raises the OS's OWN folder
          // dialog daemon-side. The page supplies at most a sanitized purpose line and never sees
          // the filesystem; the eventual pick binds directly — both clicks are human gestures no
          // page or model output can forge.
          const wanted = await this.requestStoragePickConsent(origin, req.reason);
          if (!wanted) { log("pick", "denied", "declined"); throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user declined the folder picker"); }
          const picked = await pickFolderNative(origin, req.reason);
          if (!picked) { log("pick", "denied", "cancelled"); throw new ProviderError(BYOPErrorCode.USER_REJECTED, "user cancelled the folder picker"); }
          store.bind(origin, picked);
          const info = store.info(origin);
          log("pick", "ok", info.folder.slice(0, 120));
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
   * vault.find — the privacy-preserving LOCAL lookup (docs/FIND.md). Turns a natural-ish query like
   * "GST number of nailinit" into the matched value, pulled STRAIGHT from the origin's local `.md`
   * vault. This is the whole moat: NO model call, NO network, NO shelling out — the returned value
   * never enters an LLM prompt and never leaves the machine. We do NOT audit the query or the value
   * (that would be telemetry of exactly the private thing we promised to keep local); only that a
   * lookup happened, hit-or-miss. Gated like `storage.get`: a standing grant, no per-action consent.
   */
  private vaultFind(origin: string, params: { query?: string; project?: string }): FindHit | null {
    if (!this.deps.grants.get(origin)) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect before using find");
    const query = typeof params?.query === "string" ? params.query : "";
    if (!query.trim()) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "vault.find requires a query");
    const project = typeof params?.project === "string" && params.project.trim() ? params.project.trim() : undefined;
    // resolveFind NEVER throws (a malformed note degrades to null), so a lookup can't wedge anything.
    const hit = resolveFind(this.deps.storage, origin, query, project);
    // Audit the EVENT, never the content — no query text, no value; that's the privacy guarantee.
    this.deps.audit.record({ origin, kind: "tool_call", toolName: "vault_find", outcome: "ok", note: hit ? `hit · ${hit.confidence}` : "miss" });
    return hit;
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
        const existing = req.context.id ? lib.get(req.context.id) : null;
        if (existing && existing.publishedBy !== origin) {
          log("publish", "denied", "another app owns this context");
          throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "cannot replace another app's context");
        }
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
    if (req.op === "end") {
      this.deps.sessions.end(origin, req.sessionId);
      await this.deps.backends.endSession(origin, req.sessionId);
      this.sessionRoutes.end(origin, req.sessionId);
      for (const key of this.completionSessions.keys()) {
        const [sessionOrigin, , sessionId] = JSON.parse(key) as [string, string, string];
        if (sessionOrigin === origin && sessionId === req.sessionId) this.completionSessions.delete(key);
      }
      return { ok: true };
    }
    if (req.op !== "send") throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, `unknown session op ${(req as any).op}`);
    // Global allow/deny (docs/MODEL-SELECTION.md §4b): substitute a disabled model down to an allowed
    // one before the gate. A session is a read-only warm thread (no attachments/agentic here), so the
    // substitute needs neither vision nor the tool loop.
    const model = this.selectCompletion(origin, { prompt: req.prompt ?? "", model: req.model, sessionId: req.sessionId }).model;
    if (!model || !this.deps.backends.capabilityModels().includes(model)) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "This conversation's model is unavailable. Reconnect its provider or start a new conversation.");
    if (this.deps.backends.backendFor(model)?.id === "codex") {
      const out = await this.complete(origin, { prompt: req.prompt ?? "", model, system: req.system, effort: req.effort, sessionId: req.sessionId });
      return { ok: true, text: out.text };
    }
    if (this.deps.backends.backendFor(model)?.id !== "claude-code") {
      throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, `${model} does not support warm sessions yet. Select Claude Code or Codex for this conversation.`);
    }
    // Gate the turn exactly like a completion: model in scope + rate/token budget.
    this.deps.gate.assertCompletionAllowed(origin, model, 4096);
    if (model) this.sessionRoutes.pin(origin, req.sessionId, model);
    // A session may use ONLY the web reads the origin already granted — never a write tool.
    const granted = new Set(grant.tools.map((t) => t.name));
    const allowedReadTools = ["WebSearch", "WebFetch"].filter((t) => granted.has(t));
    const text = await this.deps.sessions.send(origin, req.sessionId, req.prompt ?? "", {
      system: req.system, model, effort: req.effort, allowedReadTools,
    });
    this.deps.gate.recordCompletion(origin, estimateTokens(text ?? ""));
    return { ok: true, text };
  }

  private listTools(origin: string): ToolDescriptor[] {
    const grant = this.deps.grants.get(origin);
    if (!grant) return [];
    // Cover a tool the same way the gate does (security/gate.ts `matches`): an exact grant OR a
    // connector wildcard like `mcp__switchboard__*` / `mcp__*`. Enumeration must agree with the gate,
    // or a wildcard-granted app (God's "run things" scope) would see an empty toolset yet be allowed
    // to call — this keeps listTools and gateToolCall reading from one rule.
    const patterns = grant.tools.map((t) => t.name);
    const covered = (name: string) => patterns.some((p) => p === name || (p.endsWith("*") && name.startsWith(p.slice(0, -1))));
    const builtins: ToolDescriptor[] = BUILTIN_TOOLS.map((t) => ({ name: t.name, server: t.server, title: t.description, description: t.description, access: classifyTool(t.name) }));
    return [...builtins, ...this.deps.mcp.all()]
      .filter((t) => covered(t.name))
      .map((t) => ({ ...t, access: classifyTool(t.name) }));
  }

  /** Apply the user's per-origin model override: if set, run THAT model instead of the one the app
   *  asked for in a new conversation. Capabilities and completion results expose the choice. The override is
   *  always a granted model (enforced at set-time), so assertCompletionAllowed still passes. */
  private withModelOverride(origin: string, params: CompletionParams): CompletionParams {
    const override = this.deps.grants.get(origin)?.modelOverride;
    // Precedence (docs/MODEL-SELECTION.md §6/§7): a GLOBAL disable beats a per-site pin. If the pinned
    // model has since been turned off in Settings → Models, don't resurrect it — fall through to
    // withModelPreference, which substitutes the app's originally-requested model to an allowed one.
    return override && this.deps.backends.isAllowed(override)
      ? { ...params, model: override }
      : { ...params, model: this.deps.backends.preferredModel(params.model) };
  }

  /** Apply the user's global model deny-list (docs/MODEL-SELECTION.md §4b). If the requested model is
   *  disabled, SUBSTITUTE a capability-preserving allowed model before the gate. The result reports
   *  the actual model. Runs AFTER withModelOverride and BEFORE backendFor +
   *  assertCompletionAllowed, so the gate validates the model that will actually run. The substitute is
   *  drawn from the origin's full granted capability set, so allowsModel() still passes — no widening. */
  private withModelPreference(origin: string, params: CompletionParams): CompletionParams {
    const requested = params.model;
    if (!requested || this.deps.backends.isAllowed(requested)) return params; // omitted default / allowed ⇒ untouched
    const sub = this.chooseAllowedSubstitute(origin, requested, { vision: !!params.attachments?.length, agentic: !!params.agentic });
    if (!sub) {
      throw new ProviderError(
        BYOPErrorCode.NO_ALLOWED_MODEL,
        "No enabled, granted model supports this request. Enable a compatible model in Settings or reconnect this app.",
      );
    }
    return { ...params, model: sub };
  }

  /** Capability-aware substitute for a DISABLED requested model (docs/MODEL-SELECTION.md §4d). Preserves
   *  the class of work: vision/agentic never route onto a local runner (non-multimodal, can't drive the
   *  tool loop); a hosted model is never a SILENT substitute unless the request was itself hosted
   *  (keeping faith with backendFor's no-silent-hosted rule). Prefers an allowed Claude model near the
   *  requested tier (opus→sonnet→haiku ladder). undefined ⇒ nothing qualifies ⇒ NO_ALLOWED_MODEL. */
  private chooseAllowedSubstitute(origin: string, requested: string, opts: { vision: boolean; agentic: boolean }): string | undefined {
    const reg = this.deps.backends;
    const requestedKind = reg.backendKindOf(requested);
    const forbidLocal = opts.vision || opts.agentic;
    const candidates = reg.allowedModels().filter((m) => {
      if (!this.deps.grants.get(origin)?.models.some((granted) => canonicalModel(granted) === canonicalModel(m))) return false;
      const k = reg.backendKindOf(m);
      if (!k) return false;                                        // not currently served
      if (forbidLocal && !reg.supports(m, opts)) return false;
      if (k === "hosted" && requestedKind !== "hosted") return false; // no silent hosted substitute
      return true;
    });
    if (!candidates.length) return undefined;
    // Prefer a Claude model near the requested tier: start at the requested rung, then walk the ladder.
    const claude = candidates.filter((m) => reg.backendKindOf(m) === "claude");
    const ladder = ["opus", "sonnet", "haiku"];
    const want = canonicalModel(requested);
    if (ladder.includes(want)) {
      const start = ladder.indexOf(want);
      const order = [...ladder.slice(start), ...ladder.slice(0, start)];
      for (const tier of order) {
        const hit = claude.find((m) => canonicalModel(m) === tier);
        if (hit) return hit;
      }
    }
    return claude[0] ?? candidates[0];
  }

  private selectCompletion(origin: string, params: CompletionParams): CompletionParams {
    const pinned = this.sessionRoutes.get(origin, params.sessionId);
    if (pinned) {
      if (!this.deps.backends.isAllowed(pinned)) throw new ProviderError(BYOPErrorCode.NO_ALLOWED_MODEL, `This conversation uses ${pinned}, which is turned off. Re-enable it or start a new conversation.`);
      return { ...params, model: pinned };
    }
    const selected = this.withModelPreference(origin, this.withModelOverride(origin, params));
    if (selected.model) return selected;
    const model = this.deps.grants.get(origin)?.models.find((m) => this.deps.backends.isAllowed(m) && this.deps.backends.capabilityModels().includes(m));
    if (!model) throw new ProviderError(BYOPErrorCode.NO_ALLOWED_MODEL, "No enabled, available model is granted to this app. Enable a model or reconnect the app.");
    return { ...selected, model };
  }

  private async complete(origin: string, params: CompletionParams) {
    params = this.selectCompletion(origin, params);
    if (params.model && !this.deps.backends.capabilityModels().includes(params.model)) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, `${params.model} is unavailable. Reconnect its provider or start a new conversation.`);
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    if (params.model) this.sessionRoutes.pin(origin, params.sessionId, params.model);
    const controller = new AbortController();
    // Warm-thread continuity: when the caller tags a sessionId, resume the SDK session we minted for
    // (origin, sessionId) last turn — the model continues the real conversation (prior turns + prompt
    // caching), while THIS turn's attachments still carry live vision. Keyed by origin so a page can
    // only continue its own thread.
    const skey = params.sessionId ? JSON.stringify([origin, backend.id, params.sessionId]) : null;
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      tools: this.listTools(origin).filter((t) => !!this.deps.mcp.get(t.name)),
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest, signal?: AbortSignal) => this.deps.gate.gateToolCall(origin, call, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments, this.gitCtxFor(origin)),
      emit: (_d: StreamDelta) => { /* one-shot: deltas discarded */ },
      signal: controller.signal,
      resumeSessionId: skey ? this.completionSessions.get(skey) : undefined,
    };
    const out = await backend.run(params, ctx);
    if (skey && out.sessionId) this.completionSessions.set(skey, out.sessionId);   // remember for next turn
    const text = out.text;
    const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(text);
    this.deps.gate.recordCompletion(origin, tokens);
    return { text, model: params.model ?? backend.id, usage: out.usage, stopReason: "end" as const };
  }

  /** FIRST-PARTY draft for a background routine (the Run layer, docs/ROUTINES.md). Runs a non-agentic
   *  completion on the default backend — no tools, no streaming, no page — attributed to the synthetic
   *  principal `routine@<id>` and AUDITED, so background model spend is visible in the same trail every
   *  other act lands in. This is daemon-own code (like speak/transcribe), so it doesn't pass an
   *  untrusted-origin gate; it draws no page consent and can never act — its only power is to produce
   *  text a human later approves. Returns the real usage tokens for the background-spend meter. */
  async routineDraft(routineId: string, prompt: string): Promise<{ text: string; tokens: number }> {
    const origin = `routine@${routineId}`;
    const model = this.deps.backends.allowedModels()[0];
    const backend = this.deps.backends.backendFor(model);
    if (!model || !backend) { this.deps.audit.record({ origin, kind: "request", method: "claude_complete", outcome: "denied", note: "no enabled backend online" }); return { text: "", tokens: 0 }; }
    const controller = new AbortController();
    const ctx = {
      origin,
      allowedTools: [] as string[],
      authorizeToolCall: async () => ({ allow: false, message: "routines draft only — no tools" }),
      gateToolCall: async () => { throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "routines draft only — no tools"); },
      emit: (_d: StreamDelta) => { /* one-shot: no page */ },
      signal: controller.signal,
    };
    try {
      const out = await backend.run({ model, prompt, maxTokens: 700 } as CompletionParams, ctx);
      const tokens = out.usage ? out.usage.inputTokens + out.usage.outputTokens : estimateTokens(out.text);
      this.deps.audit.record({ origin, kind: "request", method: "claude_complete", outcome: "ok", note: `draft ${tokens} tok` });
      return { text: out.text ?? "", tokens };
    } catch (e) {
      this.deps.audit.record({ origin, kind: "request", method: "claude_complete", outcome: "denied", note: String((e as Error)?.message).slice(0, 80) });
      return { text: "", tokens: 0 };
    }
  }

  /** FIRST-PARTY call of a Switchboard-connector *wrapp* action for a background routine — the
   *  God's-Hands-reuse path (docs/GOD-HANDS.md), pointed at a routine instead of a hotkey. A
   *  reversible move ("draft the operating slate", "write the brand brief") names a wrapp action;
   *  we run that wrapp's real pipeline on the user's own Claude via the switchboard connector and
   *  return its structured result to file as the company's artifact — the same quality as if the
   *  founder had opened that wrapp themselves.
   *
   *  SAFETY (why a routine may call this without a page gate): this ONLY reaches `mcp__…__wrapp__*`
   *  tools — the connector's curated *reversible* surface (drafts/analyses that run on your Claude
   *  and produce text; outward wrapp actions like publish/send are never exposed as connector
   *  tools, they stay per-click). We hard-check that prefix here so a routine can never reach a
   *  non-wrapp or outward tool, resolve by SUFFIX (robust to the connector's serverId prefix), and
   *  AUDIT every call as principal `routine@<id>`. The move-classifier still gates the SEND line
   *  separately; this is strictly the reversible lane. Not connected / unknown wrapp ⇒ a clean
   *  `{ ok:false }` so the routine falls back to a generic draft rather than failing the tick. */
  async routineInvoke(routineId: string, toolSuffix: string, args: Record<string, unknown>): Promise<{ ok: boolean; json: unknown | null; text: string; error?: string }> {
    const origin = `routine@${routineId}`;
    const descr = this.deps.mcp.all().find(
      (t) => t.name.startsWith("mcp__") && t.name.includes("__wrapp__") && t.name.endsWith(toolSuffix),
    );
    if (!descr) {
      this.deps.audit.record({ origin, kind: "tool_call", toolName: toolSuffix, outcome: "denied", note: "wrapp not connected" });
      return { ok: false, json: null, text: "", error: "wrapp not connected" };
    }
    try {
      const res = await this.deps.mcp.invoke({ name: descr.name, arguments: args });
      const text = (res.content ?? [])
        .filter((c) => c.type === "text" && typeof (c as Record<string, unknown>).text === "string")
        .map((c) => String((c as Record<string, unknown>).text))
        .join("\n")
        .trim();
      let json: unknown | null = null;
      try { json = JSON.parse(text); } catch { /* not JSON — keep raw text */ }
      const jsonOk = !(json && typeof json === "object" && (json as { ok?: unknown }).ok === false);
      const ok = res.ok && jsonOk;
      this.deps.audit.record({ origin, kind: "tool_call", toolName: descr.name, outcome: ok ? "ok" : "error", note: ok ? `wrapp draft ${text.length}ch` : "wrapp returned an error" });
      return { ok, json, text, error: ok ? undefined : (res.error?.message ?? "wrapp error") };
    } catch (e) {
      this.deps.audit.record({ origin, kind: "tool_call", toolName: descr.name, outcome: "error", note: String((e as Error)?.message).slice(0, 80) });
      return { ok: false, json: null, text: "", error: String((e as Error)?.message).slice(0, 120) };
    }
  }

  /** The connector CLASS that could SEND a given channel. Social publishing (Instagram/TikTok/X/…)
   *  has no class in the taxonomy yet, so it resolves to null → an honest no-sender. */
  private static channelClass(channel: string): ConnectorClass | null {
    const c = channel.toLowerCase();
    if (/\b(e-?mail|newsletter|waitlist|inbox)\b/.test(c)) return "email";
    if (/\b(dm|dms|message|slack|whatsapp|telegram|discord)\b/.test(c)) return "chat";
    return null; // instagram/tiktok/x/twitter/linkedin/facebook — no send class today
  }

  /** Resolve a CONNECTED sender for a class: a tool whose connector serves that class AND whose name
   *  is a write/send action (per the out-of-band classifier + a send-verb name check). Returns the
   *  first match, or null. Read-only — draws no consent, invokes nothing. */
  private findSender(cls: ConnectorClass): { connector: string; tool: string } | null {
    const SEND = /(send|post|publish|create[_-]?(draft|message|comment)|dm|message|deploy|charge|invoice)/i;
    for (const t of this.deps.mcp.all()) {
      const id = connectorIdOf(t.name);
      if (!id || !(CONNECTOR_META[id]?.classes.includes(cls))) continue;
      const short = t.name.split("__").pop() ?? t.name;
      if (classifyTool(t.name) === "write" && SEND.test(short)) return { connector: id, tool: t.name };
    }
    return null;
  }

  /** DISPATCH an approved GATE move to a real sender (docs/COMPANY-OS.md §2b — the God's-Hands pattern
   *  in reverse). This is the ONLY path that fires an OUTWARD action for the autonomous company, and it
   *  is deliberately narrow:
   *    • It resolves a CONNECTED sender for the move's channel. None connected ⇒ `no-sender`, nothing
   *      leaves the machine — the honest "connect a sender first". (Every channel is no-sender today.)
   *    • With a sender, ASSISTED mode (default) raises the standard write-consent card — the founder's
   *      "one tap" at the notch — and only sends on approval. FULL-AUTO (`auto`, a standing per-company
   *      grant) skips the card but is still audited + stoppable (the routines master switch, the trail).
   *    • Every outcome is AUDITED as principal `routine@<id>`. We NEVER invoke an outward tool without
   *      either that tap or the standing grant — the send line never moves.
   *  NB: the per-connector argument shaping (recipient/subject/body) is filled in when a real sender is
   *  actually connected and founder-tested; until then no send tool exists to reach, by design. */
  async routineDispatch(routineId: string, p: DispatchParams): Promise<DispatchResult> {
    return this.dispatchSend(`routine@${routineId}`, p);
  }

  /** Page-initiated dispatch — the cockpit's "Approve & send" tap (via claude_callTool →
   *  relay__autopilot_dispatch). The principal is the calling wrapp origin, ALWAYS assisted (the
   *  write-consent card IS the tap), never auto; requires a connected grant so only a wrapp the user
   *  has Connected can reach it. Same gate + audit + honest no-sender as the routine path. */
  async pageDispatch(origin: string, args: { channel?: unknown; content?: unknown; company?: unknown; move?: unknown }): Promise<DispatchResult> {
    if (!this.deps.grants.get(origin)) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "connect Switchboard first");
    return this.dispatchSend(origin, {
      channel: String(args?.channel ?? ""),
      content: String(args?.content ?? ""),
      company: args?.company != null ? String(args.company) : undefined,
      move: args?.move != null ? String(args.move) : undefined,
      auto: false,
    });
  }

  private async dispatchSend(origin: string, p: DispatchParams): Promise<DispatchResult> {
    const channel = String(p.channel ?? "").trim();
    const cls = Broker.channelClass(channel);
    const sender = cls ? this.findSender(cls) : null;
    if (!sender) {
      const suggested = cls ? connectorsInClass(cls) : [];
      const note = cls
        ? `No ${cls} sender connected — connect one to send.`
        : `"${channel || "this channel"}" has no sender wired yet — social publishing waits on a connector.`;
      this.deps.audit.record({ origin, kind: "tool_call", toolName: `dispatch:${channel || "?"}`, outcome: "denied", note: `no sender (${cls ?? "no class"})` });
      return { ok: false, status: "no-sender", channel, class: cls, suggested, note };
    }
    // A real sender exists — gate it. Assisted: the write-consent card IS the founder's tap. Full-auto:
    // a standing grant pre-authorized this company's sends (the card is skipped, the audit is not).
    if (!p.auto) {
      const approved = await this.requestWriteConsent({
        id: randomUUID(), origin,
        tool: { name: sender.tool, arguments: { channel, company: p.company, move: p.move, preview: p.content.slice(0, 240) } },
        reason: "write-action",
      });
      if (!approved) {
        this.deps.audit.record({ origin, kind: "tool_call", toolName: sender.tool, outcome: "denied", note: `send declined · ${channel}` });
        return { ok: false, status: "declined", channel, class: cls, connector: sender.connector, note: `You declined the ${channel} send.` };
      }
    }
    const res = await this.deps.mcp.invoke({ name: sender.tool, arguments: { text: p.content } });
    this.deps.audit.record({ origin, kind: "tool_call", toolName: sender.tool, outcome: res.ok ? "ok" : "error", note: `${p.auto ? "auto-" : ""}send · ${channel}${res.ok ? "" : " · failed"}` });
    return res.ok
      ? { ok: true, status: "sent", channel, class: cls, connector: sender.connector, note: `Sent via ${sender.connector}.` }
      : { ok: false, status: "error", channel, class: cls, connector: sender.connector, note: `The ${sender.connector} send failed.` };
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
    params = this.selectCompletion(origin, params);
    if (params.model && !this.deps.backends.capabilityModels().includes(params.model)) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, `${params.model} is unavailable. Reconnect its provider or start a new conversation.`);
    const backend = this.deps.backends.backendFor(params.model);
    if (!backend) throw new ProviderError(BYOPErrorCode.PROVIDER_UNAVAILABLE, "no backend online");
    this.deps.gate.assertCompletionAllowed(origin, params.model, params.maxTokens ?? 4096);
    if (params.model) this.sessionRoutes.pin(origin, params.sessionId, params.model);
    const streamId = randomUUID();
    const controller = new AbortController();
    this.streams.set(streamId, controller);
    const skey = params.sessionId ? JSON.stringify([origin, backend.id, params.sessionId]) : null;
    // Deltas go to the socket that ASKED, not to every connected browser. Broadcasting leaked
    // one origin's model output into every other paired profile's extension (and from there into
    // every page port). sendTo falls back to broadcast only if the requesting socket is gone —
    // an MV3 worker evicted mid-stream reconnects as a NEW socket and must still get the tail.
    const emit = (delta: StreamDelta) => this.sendTo(ws, { type: "event", event: "delta", payload: { streamId, ...delta } });
    const ctx = {
      origin,
      allowedTools: params.agentic ? this.deps.gate.allowedToolsFor(origin) : [],
      tools: this.listTools(origin).filter((t) => !!this.deps.mcp.get(t.name)),
      authorizeToolCall: (call: ToolCallRequest) => this.deps.gate.authorize(origin, call).then((d) => (d.allow ? { allow: true, message: undefined } : { allow: false, message: d.message })),
      gateToolCall: (call: ToolCallRequest, signal?: AbortSignal) => this.deps.gate.gateToolCall(origin, call, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal),
      mcpServers: buildMcpServers(this.deps.mcp.sdkServersFor(origin, this.deps.grants.get(origin)?.tools.map((t) => t.name) ?? []), params.attachments, this.gitCtxFor(origin)),
      emit,
      signal: controller.signal,
      resumeSessionId: skey ? this.completionSessions.get(skey) : undefined,
    };
    // Fire and forget; deltas flow as events keyed by streamId. Lifecycle is LOGGED so a hung or
    // failed backend shows up in sidekick.log instead of a silent, undiagnosable stall.
    const t0 = Date.now();
    console.error(`[stream] ${streamId.slice(0, 8)} start origin=${origin} model=${params.model ?? backend.id} agentic=${!!params.agentic} prompt=${(params.prompt ?? "").length}ch`);
    backend.run(params, ctx)
      .then((out) => {
        if (skey && out.sessionId) this.completionSessions.set(skey, out.sessionId);
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
    const event = msg as { origin?: string; payload?: { origin?: string } };
    const origin = event.origin ?? event.payload?.origin;
    const frame = origin ? { ...event, origin } : msg;
    const s = JSON.stringify(frame);
    for (const ext of this.extensions) { try { ext.send(s); } catch { /* dropped */ } }
    for (const app of this.apps) {
      if (origin && this.appOrigins.get(app) !== origin) continue;
      try { app.send(s); } catch { /* dropped */ }
    }
    for (const client of this.nativeEvents) {
      if (origin && client.principal !== origin) continue;
      try { client.send(frame); } catch { /* dropped */ }
    }
  }

  // ---- Team Mode notifications. Both ride the existing `permissionsChanged` fan-out on purpose:
  // wrapps (Bank-style) already re-read their storage on that event, so a teammate's write shows
  // up live in every bound app with zero SDK/protocol change; the panel re-pulls on any event.
  // The payload is a bare reason — no member names, no file names — because non-delta events
  // reach EVERY connected page. ----

  /** A teammate's sync just changed files on this machine. When the changed folder maps to
   *  specific origins (apps bound to it), the nudge is ORIGIN-SCOPED — the extension routes it
   *  only to those origins' pages, so unrelated wrapps neither re-read nor learn anything.
   *  With no bound origin (or on an older extension, which ignores the extra field and keeps
   *  the fan-out) the unscoped legacy broadcast still does the job. */
  notifyTeamSync(folder?: string) {
    const payload = { reason: "storage-changed" };
    const targets = folder ? this.originsUsing(folder) : [];
    if (!targets.length) {
      this.broadcast({ type: "event", event: "permissionsChanged", payload });
      return;
    }
    for (const origin of targets) this.broadcast({ type: "event", event: "permissionsChanged", payload, origin });
  }

  /** Every LIVE granted origin whose storage resolves into (or under) `folder`. Containment,
   *  not equality: an app bound to a subfolder of the team folder holds synced files too (the
   *  git layer changes subtrees). Both sides are canonicalized the way bind() normalizes —
   *  tilde-expanded, resolved, realpath'd (symlinks like /tmp→/private/tmp, APFS casing) — so
   *  two spellings of the same directory can't silently break the scoping. */
  private originsUsing(folder: string): string[] {
    const want = canonPath(folder);
    const out: string[] = [];
    for (const g of this.deps.grants.list()) {
      if (g.expiresAt && Date.now() > g.expiresAt) continue; // a lapsed page learns nothing, even a nudge
      try {
        const f = canonPath(this.deps.storage.folderFor(g.origin).folder);
        if (f === want || f.startsWith(want + pathSep)) out.push(g.origin);
      } catch { /* skip */ }
    }
    return out;
  }

  /** Team membership/presence/mode changed — the panel should re-pull team.status. */
  notifyTeamChanged() {
    this.writeTeamMirror();   // keep the native app's read-back file fresh (members, online dots, invite state)
    this.broadcast({ type: "event", event: "permissionsChanged", payload: { reason: "team-changed" } });
  }

  /** Push a teammate's LIVE cursor straight to the native app(s) so it renders the remote sprite. Sent only to
   *  menubar surfaces, at cursor rate (~20-30Hz) — NOT a file mirror (too hot for that), NOT persisted. */
  pushTeamCursor(c: { deviceId: string; name: string; x: number; y: number }) {
    const frame = JSON.stringify({ type: "event", event: "teamCursor", payload: c });
    for (const ws of this.menubars) { try { ws.send(frame); } catch { /* dropped; next frame */ } }
  }

  /** Push a teammate's SURFACE COMMAND to the native app to execute (open/place a wrapp). Menubar-only. */
  pushSurfaceCommand(cmd: { from: string; action: string; wrappId?: string; url?: string; name?: string; placement?: { x: number; y: number; w: number; h: number } }) {
    const frame = JSON.stringify({ type: "event", event: "teamSurface", payload: cmd });
    for (const ws of this.menubars) { try { ws.send(frame); } catch { /* dropped */ } }
  }

  /** Mirror team.status() to ~/.relay/team.json so the native panel can READ team state (members, online,
   *  folder, git) — the app can fire team.* control actions but has no other way to see the result. Written
   *  on boot and on every membership/presence change. Best-effort; a stale/absent file just hides the section. */
  writeTeamMirror() {
    try {
      const path = joinPath(this.deps.config.stateDir, "team.json");
      writeFileSync(path, JSON.stringify(this.deps.team.status(), null, 2), { mode: 0o600 });
    } catch {}
  }
}

/** One canonical form for a user-facing folder path: tilde-expanded, resolved, realpath'd
 *  (falls back to the resolved string when the path doesn't exist yet). */
function canonPath(p: string): string {
  const abs = resolvePath(expandTilde(p));
  try { return (realpathSync.native ?? realpathSync)(abs); } catch { return abs; }
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
