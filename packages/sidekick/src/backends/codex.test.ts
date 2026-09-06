import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CodexBackend } from "./codex.js";
import type { BackendRunContext } from "./types.js";

function fixture(stateDir = mkdtempSync(`${tmpdir()}/sb-codex-test-`), timeoutMs?: number) {
  const backend = new CodexBackend({ command: process.execPath, args: [resolve("packages/sidekick/src/backends/fixtures/codex-server.mjs")], stateDir, timeoutMs });
  return { backend, stateDir };
}
function context(origin = "https://one.test"): BackendRunContext {
  return { origin, allowedTools: [], emit() {}, signal: new AbortController().signal, authorizeToolCall: async () => ({ allow: false }), gateToolCall: async () => ({ ok: false }) };
}
test("warm threads queue simultaneous turns and isolate origins", async () => {
  const { backend } = fixture();
  try {
    const [first, second, other] = await Promise.all([
      backend.run({ prompt: "first", sessionId: "same" }, context()),
      backend.run({ prompt: "second", sessionId: "same" }, context()),
      backend.run({ prompt: "other", sessionId: "same" }, context("https://two.test")),
    ]);
    assert.equal(first.sessionId, second.sessionId);
    assert.notEqual(first.sessionId, other.sessionId);
    assert.deepEqual(JSON.parse(second.text), ["first", "second"]);
    assert.deepEqual(second.usage, { inputTokens: 100, outputTokens: 5 });
  } finally { backend.close(); }
});
test("persisted app mapping resumes after restart; end starts fresh", async () => {
  const first = fixture();
  const one = await first.backend.run({ prompt: "remember", sessionId: "s" }, context());
  first.backend.close();
  const second = fixture(first.stateDir);
  try {
    const two = await second.backend.run({ prompt: "recall", sessionId: "s" }, context());
    assert.equal(one.sessionId, two.sessionId);
    assert.deepEqual(JSON.parse(two.text), ["remember", "recall"]);
    await second.backend.endSession(context().origin, "s");
    const three = await second.backend.run({ prompt: "new", sessionId: "s" }, context());
    assert.notEqual(two.sessionId, three.sessionId);
  } finally { second.backend.close(); }
});
test("dynamic tools execute only through the gate; unknown and tool-free calls denied", async () => {
  const { backend } = fixture();
  let calls = 0;
  const ctx = context();
  ctx.allowedTools = ["mcp__test__*"];
  ctx.tools = [{ name: "mcp__test__read", server: "test", title: "read", access: "read", inputSchema: { type: "object", properties: {} } }];
  ctx.gateToolCall = async () => { calls++; return { ok: true }; };
  try {
    assert.equal((await backend.run({ prompt: "tool", agentic: true }, ctx)).text, "tool allowed");
    assert.equal(calls, 1);
    assert.equal((await backend.run({ prompt: "unknown-tool", agentic: true }, ctx)).text, "tool denied");
    assert.equal((await backend.run({ prompt: "tool" }, ctx)).text, "tool denied");
    assert.equal(calls, 1);
    ctx.gateToolCall = async () => ({ ok: false });
    assert.equal((await backend.run({ prompt: "tool", agentic: true }, ctx)).text, "tool denied");
  } finally { backend.close(); }
});
test("cancellation and process failure reject instead of hanging", async () => {
  const { backend } = fixture();
  try {
    await backend.healthy();
    const controller = new AbortController();
    // Abort once the fixture is actually running, not while a slow host starts its thread.
    const pending = backend.run({ prompt: "wait" }, { ...context(), signal: controller.signal,
      emit: delta => { if (delta.type === "text") controller.abort(); } });
    await assert.rejects(pending, /cancelled/);
    await assert.rejects(backend.run({ prompt: "crash" }, context()), /exited/);
    assert.ok((await backend.run({ prompt: "recovered" }, context())).text.includes("recovered"));
  } finally { backend.close(); }
});

test("a runtime timeout aborts the signal passed to a pending tool gate", async () => {
  const { backend } = fixture(undefined, 100);
  const ctx = context();
  ctx.allowedTools = ["mcp__test__read"];
  ctx.tools = [{ name: "mcp__test__read", server: "test", title: "read", access: "read" }];
  let gateSignal: AbortSignal | undefined;
  ctx.gateToolCall = async (_call, signal) => {
    gateSignal = signal;
    await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
    return { ok: false };
  };
  try {
    await assert.rejects(backend.run({ prompt: "tool", agentic: true }, ctx), /cancelled/);
    assert.equal(gateSignal?.aborted, true);
    assert.equal(ctx.signal.aborted, false);
  } finally { backend.close(); }
});

test("a crashed runtime cancels a tool still awaiting approval", async () => {
  const { backend } = fixture();
  const ctx = context();
  ctx.allowedTools = ["mcp__test__write"];
  ctx.tools = [{ name: "mcp__test__write", server: "test", title: "write", access: "write" }];
  let gateSignal: AbortSignal | undefined;
  let release: (() => void) | undefined;
  ctx.gateToolCall = async (_call, signal) => {
    gateSignal = signal;
    await new Promise<void>((resolve) => { release = resolve; });
    return { ok: !signal!.aborted };
  };
  try {
    await assert.rejects(backend.run({ prompt: "tool-crash", agentic: true }, ctx), /exited/);
    assert.ok(gateSignal, "the tool must reach the approval gate before the crash");
    assert.equal(gateSignal.aborted, true, "a late approval must not execute after the runtime fails");
    assert.equal(ctx.signal.aborted, false);
  } finally { release?.(); backend.close(); }
});

test("an absent Codex executable reports offline without crashing the daemon", async () => {
  const stateDir = mkdtempSync(`${tmpdir()}/sb-codex-absent-`);
  const backend = new CodexBackend({ command: resolve(stateDir, "codex-does-not-exist"), stateDir });
  try { assert.equal(await backend.healthy(), false); }
  finally { backend.close(); }
});

test("changed persona or tool schema starts a fresh thread", async () => {
  const { backend } = fixture();
  const ctx = context();
  ctx.allowedTools = ["mcp__test__read"];
  ctx.tools = [{ name: "mcp__test__read", server: "test", title: "read", access: "read",
    inputSchema: { type: "object", properties: {} } }];
  try {
    const first = await backend.run({ prompt: "old context", system: "persona one", sessionId: "s", agentic: true }, ctx);
    const second = await backend.run({ prompt: "new persona", system: "persona two", sessionId: "s", agentic: true }, ctx);
    assert.notEqual(first.sessionId, second.sessionId);
    assert.deepEqual(JSON.parse(second.text), ["new persona"]);
    ctx.tools = [{ ...ctx.tools[0]!, inputSchema: { type: "object", properties: { query: { type: "string" } } } }];
    const third = await backend.run({ prompt: "new schema", system: "persona two", sessionId: "s", agentic: true }, ctx);
    assert.notEqual(second.sessionId, third.sessionId);
    assert.deepEqual(JSON.parse(third.text), ["new schema"]);
    const fourth = await backend.run({ prompt: "no tools", system: "persona two", sessionId: "s" }, ctx);
    assert.notEqual(third.sessionId, fourth.sessionId);
    assert.deepEqual(JSON.parse(fourth.text), ["no tools"]);
  } finally { backend.close(); }
});
