import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelBackend } from "./types.js";

const directory = mkdtempSync(join(tmpdir(), "sb-routing-"));
process.env.RELAY_DIR = directory;
const { BackendRegistry } = await import("./registry.js");
const { Broker } = await import("../server.js");
const { GrantStore } = await import("../security/grant-store.js");
const { Gate } = await import("../security/gate.js");
const { BudgetLedger } = await import("../security/budgets.js");
const { AuditLog } = await import("../security/audit-log.js");
const { McpRegistry } = await import("../mcp/registry.js");
const { StorageStore } = await import("../storage/store.js");
const { ContextLibrary } = await import("../context/library.js");
const { LocalOpenAIBackend } = await import("./local-openai.js");

test("native discovery describes only implemented transport methods", async () => {
  const backends = new BackendRegistry();
  backends.register({ id: "ollama", healthy: async () => true, listModels: async () => ["local-text"], run: async () => ({ text: "ok" }) });
  await backends.refreshModels();
  const dir = mkdtempSync(join(tmpdir(), "sb-native-caps-"));
  const grants = new GrantStore(dir);
  const origin = "native@dev.test";
  grants.upsert(origin, { models: ["local-text"], tools: [], budgets: {} });
  const broker = new Broker({ config: { stateDir: dir }, backends, grants, audit: new AuditLog(dir) } as any);
  const caps = await broker.handleNativeRequest(origin, "claude_capabilities", {}) as any;
  assert.equal(caps.defaultModel, "local-text");
  assert.equal(typeof caps.local.stt, "boolean");
  assert.ok(caps.methods.includes("claude_storage") && caps.methods.includes("claude_context"));
  assert.ok(caps.methods.includes("claude_session") && caps.methods.includes("claude_permissions"));
  for (const method of ["claude_stream", "claude_cancel", "claude_connect", "claude_health"]) {
    assert.ok(!caps.methods.includes(method));
    await assert.rejects(broker.handleNativeRequest(origin, method, {}), /native apps cannot call/);
  }
});

test("native context and storage preserve ownership, lending and revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-native-context-"));
  const grants = new GrantStore(dir);
  const native = "native@dev.context-test", web = "https://context-test.invalid";
  for (const origin of [native, web]) grants.upsert(origin, { models: [], tools: [], budgets: {} });
  const broker = new Broker({ config: { stateDir: dir }, grants, audit: new AuditLog(dir),
    storage: new StorageStore(dir), contexts: new ContextLibrary(dir) } as any) as any;
  await broker.handleNativeRequest(native, "claude_storage", { op: "set", key: "note", value: "private" });
  assert.equal((await broker.storageOp(web, { op: "get", key: "note" })).value, null);
  const { id } = await broker.handleNativeRequest(native, "claude_context", { op: "publish", context: { name: "Test context", kind: "note", data: "shared" } });
  assert.deepEqual((await broker.contextOp(web, { op: "list" })).contexts, []);
  assert.equal((await broker.contextOp(web, { op: "use", id })).ok, false);
  await assert.rejects(broker.contextOp(web, { op: "publish", context: { id, name: "Stolen", data: "changed" } }), /another app's context/);
  broker.requestContextPick = async (origin: string) => { assert.equal(origin, web); return { contextId: id }; };
  assert.equal((await broker.contextOp(web, { op: "pick" })).context.data, "shared");
  // Lending a context does not transfer ownership or grant mutation rights.
  await assert.rejects(broker.contextOp(web, { op: "publish", context: { id, name: "Still stolen", data: "changed" } }), /another app's context/);
  // The current menubar has no context-picker card. Native requests must use the
  // extension's existing picker instead of timing out on an unsupported native card.
  delete broker.requestContextPick;
  broker.pushPrompt = (promptId: string, kind: string, body: any, surface: string) => {
    assert.equal(kind, "consent:context-pick");
    assert.equal(body.origin, native);
    assert.equal(surface, "extension");
    broker.pending.get(promptId).resolve(null);
  };
  assert.equal((await broker.handleNativeRequest(native, "claude_context", { op: "pick" })).context, null);
  grants.setMode(native, "readonly");
  await assert.rejects(broker.handleNativeRequest(native, "claude_storage", { op: "set", key: "note", value: "changed" }), /read-only/);
  grants.revoke(native);
  await assert.rejects(broker.handleNativeRequest(native, "claude_context", { op: "active" }), /connect before/);
});

test("scoped events reach only their native or hosted app; global model events reach both", () => {
  const broker = new Broker({ config: { stateDir: directory } } as any) as any;
  const a: any[] = [], b: any[] = [], hosted: any[] = [], extension: any[] = [];
  const unsubscribe = broker.subscribeNativeEvents("native@a", (event: any) => a.push(event));
  broker.subscribeNativeEvents("native@b", (event: any) => b.push(event));
  const socket = { send: (raw: string) => hosted.push(JSON.parse(raw)) };
  broker.apps.add(socket); broker.appOrigins.set(socket, "https://hosted.invalid");
  broker.extensions.add({ send: (raw: string) => extension.push(JSON.parse(raw)) });
  broker.broadcast({ type: "event", event: "permissionsChanged", payload: { origin: "native@a", models: ["private-model"] } });
  assert.equal(a.length, 1); assert.equal(b.length, 0); assert.equal(hosted.length, 0);
  assert.equal(extension[0].origin, "native@a");
  broker.broadcast({ type: "event", event: "capabilitiesChanged", payload: { reason: "models-changed" } });
  assert.equal(a.length, 2); assert.equal(b.length, 1); assert.equal(hosted.length, 1);
  broker.broadcast({ type: "event", event: "permissionsChanged", origin: "https://hosted.invalid", payload: {} });
  assert.equal(hosted.length, 2); assert.equal(a.length, 2); assert.equal(b.length, 1);
  unsubscribe();
  broker.broadcast({ type: "event", event: "capabilitiesChanged", payload: {} });
  assert.equal(a.length, 2); assert.equal(b.length, 2);
});

test("local text backend rejects vision and tools before sending a request", async () => {
  const backend = new LocalOpenAIBackend({ baseUrl: "http://unreachable.invalid/v1" });
  const context = { allowedTools: [], signal: new AbortController().signal } as any;
  assert.deepEqual(backend.capabilities, { vision: false, agentic: false, warmSessions: false });
  await assert.rejects(backend.run({ prompt: "image", attachments: [{ dataUrl: "data:image/png;base64,AA==", handle: "image", filename: "image.png", contentType: "image/png" }] }, context), /does not support image/);
  await assert.rejects(backend.run({ prompt: "tools", agentic: true }, context), /does not yet support the agentic tool loop/);
  await assert.rejects(backend.run({ prompt: "tools" }, { ...context, allowedTools: ["mcp__test__read"] }), /does not yet support the agentic tool loop/);
});

test("apps discover backend features and their own granted default", async () => {
  const backends = new BackendRegistry();
  backends.register({ id: "codex", capabilities: { vision: true, agentic: true, warmSessions: true },
    healthy: async () => true, listModels: async () => ["model-a", "model-b"], run: async () => ({ text: "ok" }) });
  backends.register({ id: "ollama", healthy: async () => true, listModels: async () => ["local-text"], run: async () => ({ text: "ok" }) });
  await backends.refreshModels();
  const grants = new GrantStore(mkdtempSync(join(tmpdir(), "sb-discovery-")));
  grants.upsert("https://a.test", { models: ["model-a"], tools: [], budgets: {} });
  grants.upsert("https://b.test", { models: ["model-b"], tools: [], budgets: {} });
  const broker = new Broker({ config: { stateDir: directory }, backends, grants } as any) as any;
  const a = await broker.capabilities("https://a.test");
  assert.equal(a.version, "1.3.0");
  assert.equal(a.defaultModel, "model-a");
  assert.equal(a.sessionModelPinning, true);
  assert.deepEqual(a.modelInfo.find((m: any) => m.id === "model-a"), {
    id: "model-a", backend: "codex", hosted: false,
    capabilities: { vision: true, agentic: true, warmSessions: true }, toolSource: "broker-mcp",
  });
  assert.deepEqual(a.modelInfo.find((m: any) => m.id === "local-text").capabilities,
    { vision: false, agentic: false, warmSessions: false });
  assert.equal((await broker.capabilities("https://b.test")).defaultModel, "model-b");
  assert.equal((await broker.capabilities("https://unconnected.test")).defaultModel, undefined);
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [], defaultModel: "model-b" }));
  try {
    // Catalog discovery must never imply that a global preference grants another app access.
    assert.equal((await broker.capabilities("https://a.test")).defaultModel, undefined);
    assert.deepEqual(grants.get("https://a.test")?.models, ["model-a"]);
  } finally { writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [] })); }
});

test("capability invalidation follows model preferences and preserves grants", async () => {
  const backends = new BackendRegistry();
  backends.register({ id: "codex", healthy: async () => true, listModels: async () => ["model-a", "model-b"], run: async () => ({ text: "ok" }) });
  await backends.refreshModels();
  const grants = new GrantStore(mkdtempSync(join(tmpdir(), "sb-model-events-")));
  grants.upsert("https://events.test", { models: ["model-a", "model-b"], tools: [], budgets: {} });
  const broker = new Broker({ config: { stateDir: directory }, backends, grants, audit: new AuditLog(directory) } as any) as any;
  const events: any[] = [];
  broker.extensions.add({ readyState: 1, OPEN: 1, send: (raw: string) => events.push(JSON.parse(raw)) });
  await broker.notifyModelsChanged();
  assert.equal(events.length, 0);
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: ["model-a"] }));
  try {
    await broker.notifyModelsChanged();
    await broker.notifyModelsChanged();
    assert.deepEqual(events.map((e) => e.event), ["capabilitiesChanged"]);
    const caps = await broker.capabilities("https://events.test");
    assert.deepEqual(caps.models, ["model-b"]);
    assert.equal(caps.defaultModel, "model-b");
    assert.deepEqual(grants.get("https://events.test")?.models, ["model-a", "model-b"]);
    assert.equal((await broker.handleControl("setModelOverride", { origin: "https://events.test", model: "model-a" })).ok, false);
    assert.equal((await broker.handleControl("setModelOverride", { origin: "https://events.test", model: "model-b" })).ok, true);
    assert.equal(events[1].event, "permissionsChanged");
    assert.equal(events[1].origin, "https://events.test");
    writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: ["model-a", "model-b"] }));
    await broker.notifyModelsChanged();
    const empty = await broker.capabilities("https://events.test");
    assert.deepEqual(empty.modelInfo, []);
    assert.equal(empty.defaultModel, undefined);
    assert.equal(empty.agentic, false);
  } finally { writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [] })); }
});

test("recovered providers appear in the first capability snapshot", async () => {
  let online = false;
  const backends = new BackendRegistry();
  backends.register({ id: "codex", healthy: async () => online, listModels: async () => ["recovered-model"], run: async () => ({ text: "ok" }) });
  await backends.refreshModels();
  const broker = new Broker({ config: { stateDir: directory }, backends, grants: new GrantStore(directory) } as any) as any;
  online = true;
  const caps = await broker.capabilities();
  assert.deepEqual(caps.backends, ["codex"]);
  assert.deepEqual(caps.models, ["recovered-model"]);
  assert.equal(caps.modelInfo[0].backend, "codex");
});

test("reconnecting preserves the user's selected default in the shared consent payload", async () => {
  const backends = new BackendRegistry();
  backends.register({ id: "codex", healthy: async () => true, listModels: async () => ["model-a", "model-b"], run: async () => ({ text: "ok" }) });
  await backends.refreshModels();
  const grants = new GrantStore(mkdtempSync(join(tmpdir(), "sb-reconnect-model-")));
  const origin = "https://reconnect.test";
  grants.upsert(origin, { models: ["model-a", "model-b"], tools: [], budgets: {} });
  grants.setModelOverride(origin, "model-b");
  const broker = new Broker({ config: { stateDir: directory }, backends, grants, mcp: new McpRegistry(), audit: new AuditLog(directory) } as any) as any;
  broker.requestConnectConsent = async (_origin: string, body: any) => {
    assert.equal(body.models.default, "model-b");
    assert.equal(body.models.requested[0], "model-b");
    return { models: body.models.requested, modelOverride: body.models.default, tools: [], budgets: {} };
  };
  const grant = await broker.connect(origin, { models: ["model-a"] });
  assert.equal(grant.modelOverride, "model-b");
  assert.deepEqual(grant.models, ["model-b", "model-a"]);
});

test("broker pins conversations, honors new app defaults, and never widens grants", async () => {
  const backends = new BackendRegistry();
  const backend: ModelBackend = { id: "codex", capabilities: { vision: true, agentic: true }, healthy: async () => true, listModels: async () => ["model-a", "model-b"], run: async (params) => ({ text: params.model!, usage: { inputTokens: 1, outputTokens: 1 } }) };
  backends.register(backend);
  await backends.refreshModels();
  const grants = new GrantStore(directory);
  const budgets = new BudgetLedger();
  const audit = new AuditLog(directory);
  const mcp = new McpRegistry();
  const gate = new Gate(grants, budgets, audit, { requestWriteConsent: async () => false } as any, mcp);
  const broker = new Broker({ config: { stateDir: directory }, backends, grants, budgets, audit, gate, mcp, storage: new StorageStore(directory), sessions: { end() {} } } as any) as any;
  const origin = "https://brandbrain.test";
  grants.upsert(origin, { models: ["model-a", "model-b"], tools: [], budgets: { maxCallsPerMin: 100, maxTokensPerDay: 100000 } });
  grants.setModelOverride(origin, "model-a");
  assert.equal((await broker.complete(origin, { prompt: "first", model: "sonnet", sessionId: "one" })).model, "model-a");
  grants.setModelOverride(origin, "model-b");
  assert.equal((await broker.complete(origin, { prompt: "continue", sessionId: "one" })).model, "model-a");
  assert.equal((await broker.complete(origin, { prompt: "new", sessionId: "two" })).model, "model-b");
  // Streaming uses the same pin as one-shot completions, despite the new app default.
  let streamed!: (value: any) => void;
  const completed = new Promise<any>((resolve) => { streamed = resolve; });
  const socket = { readyState: 1, OPEN: 1, send(raw: string) { const msg = JSON.parse(raw); if (msg.payload?.type === "done") streamed(msg.payload.result); } };
  await broker.startStream(origin, { prompt: "stream continuation", sessionId: "one" }, socket);
  assert.equal((await completed).model, "model-a");
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: ["model-a"] }));
  await assert.rejects(broker.complete(origin, { prompt: "paused", sessionId: "one" }), /turned off/);
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [] }));
  // A fresh broker restores the pinned model even though the app now defaults to model-b.
  const restored = new Broker(broker.deps) as any;
  assert.equal((await restored.complete(origin, { prompt: "resume", sessionId: "one" })).model, "model-a");
  await restored.sessionOp(origin, { op: "end", sessionId: "one" });
  assert.equal((await restored.complete(origin, { prompt: "restart", sessionId: "one" })).model, "model-b");
  grants.upsert(origin, { models: ["model-b"], tools: [], budgets: {} });
  await assert.rejects(broker.complete(origin, { prompt: "withdrawn", sessionId: "one" }), /scope|grant/i);
  assert.equal(grants.setModelOverride(origin, "model-a"), null);
  // Disabling every model must never resurrect the full catalog as a fallback.
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: ["model-a", "model-b"] }));
  assert.deepEqual(backends.allowedModels(), []);
  await assert.rejects(broker.complete(origin, { prompt: "all disabled", sessionId: "three" }), /enabled|turned off/);
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [] }));
  backends.register({ id: "ollama", healthy: async () => true, listModels: async () => ["local-test"], run: async () => ({ text: "local" }) });
  await backends.refreshModels();
  grants.upsert(origin, { models: ["local-test"], tools: [], budgets: {} });
  await assert.rejects(broker.sessionOp(origin, { op: "send", prompt: "local warm", model: "local-test", sessionId: "local" }), /does not support warm sessions/);
});

test("cancel while awaiting write approval prevents execution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-gate-cancel-"));
  const grants = new GrantStore(dir);
  grants.upsert("https://test", { models: ["test"], tools: [{ name: "mcp__test__send", access: "write" }], budgets: {} });
  let approve!: (value: boolean) => void;
  let prompted!: () => void;
  const shown = new Promise<void>((resolve) => { prompted = resolve; });
  let executions = 0;
  const mcp = { invoke: async () => { executions++; return { ok: true }; } };
  const gate = new Gate(grants, new BudgetLedger(), new AuditLog(dir), { requestWriteConsent: () => new Promise<boolean>((resolve) => { approve = resolve; prompted(); }) } as any, mcp as any);
  const controller = new AbortController();
  const call = gate.gateToolCall("https://test", { name: "mcp__test__send", arguments: {} }, controller.signal);
  await shown;
  controller.abort();
  approve(true);
  assert.equal((await call).ok, false);
  assert.equal(executions, 0);
});

for (const change of ["revoke", "remove-tool", "readonly"] as const) {
  test("pending write approval respects " + change, async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-gate-change-"));
    const grants = new GrantStore(dir);
    const origin = "https://approval.test";
    const tool = { name: "mcp__test__send", arguments: {} };
    grants.upsert(origin, { models: ["test"], tools: [{ name: tool.name, access: "write" }], budgets: {} });
    let approve!: (value: boolean) => void;
    let prompted!: () => void;
    const shown = new Promise<void>((resolve) => { prompted = resolve; });
    let executions = 0;
    const gate = new Gate(grants, new BudgetLedger(), new AuditLog(dir), {
      requestWriteConsent: () => new Promise<boolean>((resolve) => { approve = resolve; prompted(); }),
    } as any, { invoke: async () => { executions++; return { ok: true }; } } as any);
    const pending = gate.gateToolCall(origin, tool);
    await shown;
    if (change === "revoke") grants.revoke(origin);
    if (change === "remove-tool") grants.upsert(origin, { models: ["test"], tools: [], budgets: {} });
    if (change === "readonly") grants.setMode(origin, "readonly");
    approve(true);
    assert.equal((await pending).ok, false);
    assert.equal(executions, 0);
  });
}

test("background drafts do not run when all models are disabled", async () => {
  const backends = new BackendRegistry();
  let calls = 0;
  backends.register({ id: "codex", healthy: async () => true, listModels: async () => ["draft-model"],
    run: async () => { calls++; return { text: "unexpected" }; } });
  await backends.refreshModels();
  writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: ["draft-model"] }));
  const broker = new Broker({ config: { stateDir: directory }, backends, audit: new AuditLog(directory) } as any);
  try {
    assert.deepEqual(await broker.routineDraft("test-routine", "synthetic"), { text: "", tokens: 0 });
    assert.equal(calls, 0);
  } finally { writeFileSync(join(directory, "models.json"), JSON.stringify({ disabled: [] })); }
});

test("ending a conversation clears the completion backend's resume token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-session-end-"));
  const backends = new BackendRegistry();
  const resumes: Array<string | undefined> = [];
  backends.register({ id: "claude-code", healthy: async () => true, listModels: async () => ["sonnet"],
    run: async (_params, ctx) => { resumes.push(ctx.resumeSessionId); return { text: "ok", sessionId: "runtime-session" }; } });
  await backends.refreshModels();
  const grants = new GrantStore(dir);
  const origin = "https://session-end.test";
  grants.upsert(origin, { models: ["sonnet"], tools: [], budgets: { maxCallsPerMin: 100 } });
  const budgets = new BudgetLedger();
  const audit = new AuditLog(dir);
  const mcp = new McpRegistry();
  const gate = new Gate(grants, budgets, audit, {} as any, mcp);
  const broker = new Broker({ config: { stateDir: dir }, backends, grants, budgets, audit, gate, mcp,
    storage: new StorageStore(dir), sessions: { end() {} } } as any) as any;
  await broker.complete(origin, { prompt: "first", model: "sonnet", sessionId: "one" });
  await broker.complete(origin, { prompt: "second", model: "sonnet", sessionId: "one" });
  await broker.sessionOp(origin, { op: "end", sessionId: "one" });
  await broker.complete(origin, { prompt: "new", model: "sonnet", sessionId: "one" });
  assert.deepEqual(resumes, [undefined, "runtime-session", undefined]);
});
