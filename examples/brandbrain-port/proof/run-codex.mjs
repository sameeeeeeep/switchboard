/** Live Brandbrain transport proof. Synthetic data, temporary grants, no personal vault access.
 * Build sidekick first, then: node examples/brandbrain-port/proof/run-codex.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

const stateDir = mkdtempSync(join(tmpdir(), "switchboard-brandbrain-codex-"));
process.env.RELAY_DIR = stateDir;
process.env.RELAY_BACKEND = "codex";
const { CodexBackend } = await import("../../../packages/sidekick/dist/backends/codex.js");
const { BackendRegistry } = await import("../../../packages/sidekick/dist/backends/registry.js");
const { Broker } = await import("../../../packages/sidekick/dist/server.js");
const { GrantStore } = await import("../../../packages/sidekick/dist/security/grant-store.js");
const { BudgetLedger } = await import("../../../packages/sidekick/dist/security/budgets.js");
const { AuditLog } = await import("../../../packages/sidekick/dist/security/audit-log.js");
const { Gate } = await import("../../../packages/sidekick/dist/security/gate.js");
const { McpRegistry } = await import("../../../packages/sidekick/dist/mcp/registry.js");
const { StorageStore } = await import("../../../packages/sidekick/dist/storage/store.js");
const { setProvider } = await import("../../adapter/claude.mjs");
const { sessionSend } = await import("../shims/claude-session.mjs");
const origin = "https://brandbrain-codex-proof.invalid";
const backend = new CodexBackend({ stateDir });
const backends = new BackendRegistry();
backends.register(backend); // Claude deliberately absent: a hidden fallback cannot pass this test.
const grants = new GrantStore(stateDir);
const budgets = new BudgetLedger();
const audit = new AuditLog(stateDir);
const mcp = new McpRegistry();
let executions = 0;
const tool = { name: "mcp__proof__read_brand", server: "proof", title: "Read synthetic brand", description: "Read the synthetic test brand name. Call this when asked for the test brand.", access: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
mcp.all = () => [tool]; mcp.get = (name) => name === tool.name ? tool : null;
mcp.invoke = async () => { executions++; return { ok: true, content: [{ type: "text", text: "Test brand: Lumen tea" }] }; };
const gate = new Gate(grants, budgets, audit, { requestWriteConsent: async () => false }, mcp);
const broker = new Broker({ config: { stateDir }, backends, grants, budgets, audit, gate, mcp, storage: new StorageStore(stateDir), sessions: { end() {}, send() { throw Error("Claude session path used"); } } });
const events = new EventEmitter();
const socket = { readyState: 1, OPEN: 1, send(raw) { const message = JSON.parse(raw); if (message.type === "event") events.emit(message.event, message.payload); } };
const receipts = [];
const provider = {
  isRelay: true,
  async request({ method, params }) {
    const result = await broker.dispatch({ origin, method, params }, socket);
    if (result?.model) receipts.push(result.model);
    return result;
  },
  on: (event, listener) => events.on(event, listener),
  removeListener: (event, listener) => events.removeListener(event, listener),
};
try {
  await backends.refreshModels();
  const model = backend.defaultModel();
  assert.ok(model, "no Codex models discovered");
  assert.equal(await backend.signedIn(), true, "run codex login first");
  // These grants belong only to the synthetic test principal in the temporary directory.
  grants.upsert(origin, { models: [model], tools: [{ name: tool.name, access: "read" }], budgets: { maxTokensPerDay: 100000, maxCallsPerMin: 100 } });
  grants.setModelOverride(origin, model);
  setProvider(provider);
  console.log(`Brandbrain proof using ${model}; Claude backend is absent.`);

  const first = await sessionSend("brand-build", 'Remember: our synthetic brand is Lumen tea. Reply ONLY {"remembered":true}.');
  assert.equal(JSON.parse(first).remembered, true);
  const second = await sessionSend("brand-build", 'What brand are we building? Reply ONLY {"brand":"the name"}.');
  assert.match(JSON.parse(second).brand, /Lumen/i);
  console.log("PASS Brandbrain's real warm-session shim remembers its previous turn.");

  // Exercise the built app's actual route bundle, including its bundled transport adapter.
  // The isolated JS realm supplies browser primitives without touching this process's globals.
  const browser = { window: {}, Request, Response, URL, TextEncoder, TextDecoder, ReadableStream, AbortController, setTimeout, clearTimeout, console, location: { href: origin } };
  runInNewContext(readFileSync(new URL("../dist/sb/routes.js", import.meta.url), "utf8"), browser);
  assert.ok(browser.window.__switchboardRoutes.paths.includes("/api/studio/gaps"));
  const app = browser.window.__switchboardRoutes.mount(provider);
  const response = await app.handle(new Request("http://local/api/studio/gaps", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ canvas: { category: { name: "functional tea", scope: "D2C wellness" }, segments: [{ name: "evening ritual", tag: "core" }], players: [{ brand: "Pukka", kind: "incumbent", segment: "evening ritual" }] } }),
  }));
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.gaps.length, 3);
  writeFileSync(join(stateDir, "brandbrain-result.json"), JSON.stringify({ model, report }, null, 2));
  console.log(`PASS Brandbrain's real ${browser.window.__switchboardRoutes.paths.length}-route bundle returned three scored openings.`);

  const allowed = await provider.request({ method: "claude_complete", params: { prompt: "Call the supplied read-brand tool now and report the test brand name.", model: "sonnet", agentic: true } });
  assert.ok(executions > 0, "model did not exercise the gated tool");
  assert.match(allowed.text, /Lumen/i);
  assert.equal(allowed.model, model);
  console.log("PASS legacy sonnet request resolves to the selected Codex model; tool executes through Gate.");

  const before = executions;
  grants.revoke(origin);
  const denied = await gate.gateToolCall(origin, { name: tool.name, arguments: {} });
  assert.equal(denied.ok, false);
  assert.equal(executions, before);
  console.log("PASS revoked grant blocks execution.");
  assert.ok(receipts.every((m) => m === model));
  console.log(`Result: ${join(stateDir, "brandbrain-result.json")}`);
} finally { backend.close(); }
