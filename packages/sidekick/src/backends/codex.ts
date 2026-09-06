import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { BYOPErrorCode, ProviderError, type CompletionParams, type ToolCallResult } from "@relay/protocol";
import { RELAY_DIR } from "../config.js";
import type { BackendRunContext, ModelBackend } from "./types.js";
import { CodexRpc, type RpcMessage } from "./codex-rpc.js";

export function codexBin(): string {
  const candidates = [process.env.RELAY_CODEX_CLI, join(homedir(), ".local/bin/codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
  // GUI launches don't inherit nvm's PATH.
  try {
    for (const version of readdirSync(join(homedir(), ".nvm/versions/node")).sort().reverse())
      candidates.push(join(homedir(), ".nvm/versions/node", version, "bin/codex"));
  } catch { /* nvm is optional */ }
  return candidates.find((path) => path && existsSync(path)) ?? "codex";
}

// These are process-local overrides, never writes to the user's Codex config. No inherited
// browser, shell, apps, plugins, memories or hooks may act outside Switchboard's tool gate.
export const CODEX_CONFIG: Record<string, unknown> = {
  "features.shell_tool": false, "features.unified_exec": false,
  "features.apps": false, "features.plugins": false, "features.hooks": false,
  "features.multi_agent": false, "features.browser_use": false,
  "features.computer_use": false, "features.image_generation": false,
  "features.memories": false, "features.chronicle": false,
  "features.shell_snapshot": false, "features.tool_suggest": false,
  "features.request_permissions_tool": false, "features.workspace_dependencies": false,
  "tools.view_image": false, "web_search": "disabled", "project_doc_max_bytes": 0,
};
type Session = { threadId: string; fingerprint: string };
type CatalogModel = { model: string; isDefault?: boolean; hidden?: boolean };
export class CodexBackend implements ModelBackend {
  id = "codex";
  capabilities = { vision: true, agentic: true, warmSessions: true };
  private rpc?: CodexRpc;
  private starting?: Promise<CodexRpc>;
  private catalog: CatalogModel[] = [];
  private sessions = new Map<string, Session>();
  private loaded = new Set<string>();
  private queues = new Map<string, Promise<unknown>>();
  private active = new Map<string, { ctx: BackendRunContext; tools: Set<string>; turnId?: string; receive: (message: RpcMessage) => void }>();
  private config: Record<string, unknown> = { ...CODEX_CONFIG };
  private readonly cwd: string;
  private readonly stateFile: string;
  constructor(private options: { command?: string; args?: string[]; stateDir?: string; timeoutMs?: number } = {}) {
    const stateDir = options.stateDir ?? RELAY_DIR;
    this.cwd = join(stateDir, "codex-workspace");
    this.stateFile = join(stateDir, "codex-sessions.json");
    try { this.sessions = new Map(JSON.parse(readFileSync(this.stateFile, "utf8"))); } catch { /* first run */ }
  }
  private async server(): Promise<CodexRpc> {
    if (this.rpc?.alive && !this.starting) return this.rpc;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      mkdirSync(this.cwd, { recursive: true, mode: 0o700 });
      const args = this.options.args ?? ["app-server", ...Object.entries(CODEX_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])];
      const rpc = new CodexRpc(this.options.command ?? codexBin(), args, this.cwd);
      this.rpc = rpc;
      this.loaded.clear();
      rpc.onMessage((message) => {
        if (message.method === "transport/closed") {
          for (const run of this.active.values()) run.receive(message);
        } else if (message.id !== undefined && message.method) {
          void this.answer(rpc, message).catch(() => rpc.close(new Error("Codex tool bridge failed")));
        } else {
          this.active.get(message.params?.threadId)?.receive(message);
        }
      });
      try {
        await rpc.request("initialize", { clientInfo: { name: "switchboard", version: "0.1.0" }, capabilities: { experimentalApi: true } });
        rpc.send({ method: "initialized" });
        // Disable every inherited MCP server explicitly; an empty table may merge with user config.
        const result = await rpc.request("config/read", { includeLayers: false });
        this.config = { ...CODEX_CONFIG };
        for (const name of Object.keys(result.config?.mcp_servers ?? {})) this.config[`mcp_servers.${name}.enabled`] = false;
        let cursor: string | null = null;
        this.catalog = [];
        do {
          const page = await rpc.request("model/list", { cursor, limit: 100, includeHidden: false });
          this.catalog.push(...page.data);
          cursor = page.nextCursor ?? null;
        } while (cursor);
        return rpc;
      } catch (error) { rpc.close(); throw error; }
    })();
    try { return await this.starting; } finally { this.starting = undefined; }
  }
  async healthy() {
    try { await this.server(); return true; } catch { return false; }
  }
  async signedIn(): Promise<boolean | undefined> {
    try { return !!(await (await this.server()).request("account/read", { refreshToken: false })).account; }
    catch { return undefined; }
  }
  async listModels() { await this.server(); return this.catalog.filter((m) => !m.hidden).map((m) => m.model); }
  defaultModel(): string | undefined {
    const preferred = process.env.RELAY_CODEX_MODEL;
    if (preferred) return this.catalog.find((m) => m.model === preferred)?.model;
    return this.catalog.find((m) => m.isDefault)?.model ?? this.catalog[0]?.model;
  }
  private persist() {
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.sessions]), { mode: 0o600 });
    renameSync(temporary, this.stateFile);
  }
  async endSession(origin: string, sessionId: string) {
    const key = JSON.stringify([origin, sessionId]);
    await this.queues.get(key)?.catch(() => {});
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    if (session) {
      this.persist();
      this.loaded.delete(session.threadId);
      if (this.rpc?.alive) await this.rpc.request("thread/unsubscribe", { threadId: session.threadId });
    }
  }
  close() { this.rpc?.close(); }
  run(params: CompletionParams, ctx: BackendRunContext) {
    // Backend-owned mapping prevents a page from presenting a Codex thread ID to resume.
    const key = JSON.stringify([ctx.origin, params.sessionId ?? randomUUID()]);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const turn = previous.catch(() => {}).then(() => this.runTurn(key, params, ctx));
    this.queues.set(key, turn);
    void turn.finally(() => { if (this.queues.get(key) === turn) this.queues.delete(key); }).catch(() => {});
    return turn;
  }
  private async runTurn(key: string, params: CompletionParams, ctx: BackendRunContext) {
    const cancellation = new AbortController();
    const originalContext = ctx;
    const signal = AbortSignal.any([ctx.signal, cancellation.signal]);
    ctx = { ...ctx, signal, gateToolCall: (call) => originalContext.gateToolCall(call, signal) };
    ctx.signal.throwIfAborted();
    const rpc = await this.server();
    if (await this.signedIn() === false) throw new ProviderError(BYOPErrorCode.UNAUTHORIZED, "Codex is not signed in. Run codex login, then retry.");
    const model = params.model ?? this.defaultModel();
    if (!model || !this.catalog.some((m) => m.model === model)) throw new ProviderError(BYOPErrorCode.INVALID_PARAMS, "Select an available Codex model in Switchboard.");
    const tools = params.agentic ? (ctx.tools ?? []).filter((t) => ctx.allowedTools.some((p) => p === t.name || (p.endsWith("*") && t.name.startsWith(p.slice(0, -1))))) : [];
    if (params.agentic && ctx.allowedTools.length > 0 && !tools.length) {
      throw new ProviderError(BYOPErrorCode.UNSUPPORTED_METHOD, "These tools are available only inside Claude Code. Connect their MCP servers to Switchboard to use them with Codex.");
    }
    const dynamicTools = tools.map((t, i) => ({ name: `sb_tool_${i}`, description: `${t.name}: ${t.description ?? t.title ?? t.name}`, inputSchema: t.inputSchema ?? { type: "object", properties: {} } }));
    const fingerprint = createHash("sha256").update(JSON.stringify([model, params.system, tools])).digest("hex");
    let session = params.sessionId ? this.sessions.get(key) : undefined;
    // A different persona or tool set starts fresh rather than retaining withdrawn context/tools.
    if (session && session.fingerprint !== fingerprint) {
      if (this.loaded.has(session.threadId)) await rpc.request("thread/unsubscribe", { threadId: session.threadId });
      this.loaded.delete(session.threadId);
      session = undefined;
    }
    const threadOptions = { model, modelProvider: "openai", cwd: this.cwd, sandbox: "read-only", approvalPolicy: "untrusted", config: this.config, baseInstructions: params.system ?? "You are an assistant working inside a Switchboard app. Use only the supplied tools and context.", };
    if (!session) {
      const result = await rpc.request("thread/start", { ...threadOptions, environments: [], dynamicTools, ephemeral: !params.sessionId });
      session = { threadId: result.thread.id, fingerprint };
      this.loaded.add(session.threadId);
      if (params.sessionId) { this.sessions.set(key, session); this.persist(); }
    } else if (!this.loaded.has(session.threadId)) {
      await rpc.request("thread/resume", { ...threadOptions, threadId: session.threadId });
      this.loaded.add(session.threadId);
    }
    ctx.signal.throwIfAborted();
    const threadId = session.threadId;
    let text = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let turnId: string | undefined;
    let cancelled = false;
    let abortDeadline: NodeJS.Timeout | undefined;
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    // Attach rejection handling before awaiting turn/start, which may itself fail.
    void done.catch(() => {});
    const interrupt = () => {
      cancelled = true;
      if (turnId) void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      // Keep the per-thread queue locked until Codex confirms interruption. Otherwise a late
      // tool request from the cancelled turn could be attributed to the next app turn.
      abortDeadline ??= setTimeout(() => rpc.close(new Error("Codex cancellation timed out")), 5_000);
    };
    const timeout = setTimeout(() => cancellation.abort(), this.options.timeoutMs ?? 180_000);
    this.active.set(threadId, { ctx, tools: new Set(tools.map((t) => t.name)), receive: (message) => {
      const p = message.params;
      if (message.method === "transport/closed") { fail(p.error); return; }
      if (message.method === "turn/started") { turnId = p.turn.id; this.active.get(threadId)!.turnId = turnId; if (ctx.signal.aborted || cancelled) interrupt(); }
      if (p.turnId && turnId && p.turnId !== turnId) return;
      if (message.method === "item/agentMessage/delta") { text += p.delta; ctx.emit({ type: "text", text: p.delta }); }
      if (message.method === "thread/tokenUsage/updated") usage = { inputTokens: p.tokenUsage.last.inputTokens, outputTokens: p.tokenUsage.last.outputTokens };
      if (message.method === "turn/completed") {
        if (cancelled) fail(new Error("Codex turn cancelled"));
        else if (p.turn.status === "completed") finish();
        else fail(new ProviderError(BYOPErrorCode.BACKEND_ERROR, p.turn.error?.message ?? `Codex turn ${p.turn.status}`));
      }
    } });
    // Dynamic names are local aliases: resolve them from this turn's exact descriptor order.
    this.toolNames.set(threadId, tools.map((t) => t.name));
    ctx.signal.addEventListener("abort", interrupt, { once: true });
    try {
      const input: unknown[] = [{ type: "text", text: params.prompt ?? params.messages?.map((m) => `${m.role}: ${m.content}`).join("\n\n") ?? "", text_elements: [] }];
      for (const attachment of params.attachments ?? []) {
        if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(attachment.dataUrl)) input.push({ type: "image", url: attachment.dataUrl });
      }
      const result = await rpc.request("turn/start", { threadId, input, model, ...(params.effort ? { effort: params.effort } : {}) });
      turnId = result.turn.id;
      this.active.get(threadId)!.turnId = turnId;
      if (ctx.signal.aborted) interrupt();
      await done;
      return { text, usage, sessionId: threadId };
    } finally {
      clearTimeout(timeout);
      if (abortDeadline) clearTimeout(abortDeadline);
      ctx.signal.removeEventListener("abort", interrupt);
      // A crash or failed turn can leave a tool awaiting consent. Its authority ends with
      // this turn even when the caller never explicitly cancelled the request.
      cancellation.abort();
      this.active.delete(threadId);
      this.toolNames.delete(threadId);
      if (!params.sessionId && rpc.alive) void rpc.request("thread/unsubscribe", { threadId }).catch(() => {});
    }
  }
  private toolNames = new Map<string, string[]>();
  private async answer(rpc: CodexRpc, message: RpcMessage) {
    const p = message.params;
    const run = this.active.get(p?.threadId);
    if (message.method === "item/tool/call") {
      const index = /^sb_tool_(\d+)$/.exec(p.tool)?.[1];
      const name = index === undefined ? undefined : this.toolNames.get(p.threadId)?.[Number(index)];
      let result: ToolCallResult = { ok: false, error: { code: "denied", message: "Tool is not available for this app turn" } };
      if (run && run.turnId === p.turnId && name && run.tools.has(name) && !run.ctx.signal.aborted) {
        const call = { name, arguments: p.arguments ?? {} };
        run.ctx.emit({ type: "tool_proposed", call });
        try { result = await run.ctx.gateToolCall(call); }
        catch { result = { ok: false, error: { code: "tool_error", message: "Switchboard tool failed" } }; }
        run.ctx.emit({ type: "tool_result", call, result });
      }
      rpc.send({ id: message.id, result: { success: result.ok, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] } });
    } else if (message.method?.endsWith("requestApproval")) {
      // Built-in runtime actions never inherit a Switchboard tool grant.
      rpc.send({ id: message.id, result: message.method === "item/permissions/requestApproval" ? { permissions: {}, scope: "turn" } : { decision: "decline" } });
    } else {
      rpc.send({ id: message.id, error: { code: -32601, message: "Switchboard does not support this Codex request" } });
    }
  }
}
