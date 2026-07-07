/**
 * END-TO-END DAEMON SPIKE: drive the REAL running sidekick over its WS as if we were the
 * extension. Proves, through the actual server + control channel + consent round-trip + gate +
 * MCP client:
 *   1. pairing-token auth
 *   2. claude_connect → daemon asks for consent → we (as the extension) approve a scope → grant persisted
 *   3. control "listGrants" returns the grant
 *   4. claude_callTool on a READ tool → auto-approved → real MCP result
 *   5. claude_callTool on a WRITE tool → daemon asks for per-action consent → we DENY → CONSENT_DENIED
 *
 * Run: node packages/sidekick/spike/e2e-daemon-spike.mjs   (spawns the built daemon)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const dir = mkdtempSync(join(tmpdir(), "relay-e2e-"));
const serverPath = resolve("packages/sidekick/spike/test-mcp-server.mjs");
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { test: { command: process.execPath, args: [serverPath] } } }));
const PORT = 8791;

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForToken() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 40; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("token never appeared");
}

function connect(token) {
  return new Promise((resolveConn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); // no Origin header ⇒ treated as extension
    const pending = new Map();     // request id → resolver
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok") { resolveConn({ ws, request, control }); return; }
      if (msg.type === "response" && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.type === "control_result" && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
      if (msg.type === "prompt") {
        // We ARE the extension's consent UI. Approve connect (grant exactly what was requested,
        // with the daemon's classification), DENY every write.
        let result;
        if (msg.kind === "consent:connect") {
          const { requested, available } = msg.body.requested;
          const want = new Set(requested.tools ?? []);
          result = {
            models: requested.models ?? available.models.slice(0, 1),
            tools: available.tools.filter((t) => want.has(t.name)).map((t) => ({ name: t.name, access: t.access })),
            budgets: { maxTokensPerDay: 500000, maxCallsPerMin: 60 },
          };
          console.error(`  [ext] connect prompt → approving ${result.tools.length} tools`);
        } else {
          console.error(`  [ext] WRITE prompt for ${msg.body.tool?.name} → DENY`);
          result = false;
        }
        ws.send(JSON.stringify({ type: "reply", id: msg.id, result }));
      }
    });
    ws.on("error", reject);
    const send = (obj) => new Promise((res) => { const id = crypto.randomUUID(); pending.set(id, res); ws.send(JSON.stringify({ ...obj, id })); });
    const request = (origin, method, params) => send({ type: "request", origin, method, params, sentAt: Date.now() });
    const control = (action, args) => send({ type: "control", action, args });
  });
}

async function main() {
  const token = await waitForToken();
  await sleep(400); // let the MCP server finish connecting
  const { request, control } = await connect(token);
  const ORIGIN = "https://demo.test";
  const results = {};

  const connectRes = await request(ORIGIN, "claude_connect", { tools: ["mcp__test__read_note", "mcp__test__send_note"], reason: "e2e spike" });
  results.connected = !!connectRes.result && connectRes.result.tools?.length === 2;

  const grants = await control("listGrants");
  results.grantListed = grants?.grants?.some((g) => g.origin === ORIGIN);

  const readRes = await request(ORIGIN, "claude_callTool", { name: "mcp__test__read_note", arguments: { id: "7" } });
  const readText = readRes.result?.content?.map((c) => c.text ?? "").join("") ?? "";
  results.readOk = readRes.result?.ok === true && readText.includes("hello from mcp");

  const writeRes = await request(ORIGIN, "claude_callTool", { name: "mcp__test__send_note", arguments: { to: "bob", body: "hi" } });
  // Denied write comes back as a ToolCallResult with ok:false (consent denied).
  results.writeDenied = writeRes.result?.ok === false;

  console.error("\n================ VERDICT ================");
  console.error(`connect consent round-trip → grant:  ${results.connected}   (want true)`);
  console.error(`control listGrants shows origin:      ${results.grantListed}   (want true)`);
  console.error(`read tool auto-approved + executed:   ${results.readOk}   (want true)`);
  console.error(`write tool denied at consent:         ${results.writeDenied}   (want true)`);
  const pass = results.connected && results.grantListed && results.readOk && results.writeDenied;
  console.error(`\n${pass ? "✅ E2E DAEMON SPIKE PASSED — full server + consent + gate + MCP path works." : "❌ FAILED"}`);
  daemon.kill("SIGKILL");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error("E2E ERROR:", err); daemon.kill("SIGKILL"); process.exit(3); });
