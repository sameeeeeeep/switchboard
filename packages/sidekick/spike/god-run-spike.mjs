/**
 * God's "run things" hand — the LIVE proof that a native app (God's principal) can enumerate and
 * invoke a wrapp/connector tool through the daemon, gated + audited, over the native listener.
 *
 * Asserts, against the REAL built daemon + a real stdio MCP server:
 *   1. registerNativeApp({connectors:true}) grants the mcp__* wildcard in TRUST mode
 *   2. claude_listTools (native) enumerates the connector's tools (wildcard grant expands in listTools)
 *   3. claude_callTool (native) runs a READ tool → result flows back
 *   4. claude_callTool (native) runs a WRITE tool → trust-mode auto-approves (God's notch is the
 *      upstream human gate; here we prove the daemon executes + audits it)
 *   5. a tool OUTSIDE the grant (no mcp__ prefix, ungranted) is DENIED — the wildcard isn't a skeleton key
 *   6. the run is written to the AUDIT log
 *
 * Run: node packages/sidekick/spike/god-run-spike.mjs   (spawns the built daemon; no Claude sign-in needed)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const DAEMON = resolve("packages/sidekick/dist/index.js");
const TEST_MCP = resolve("packages/sidekick/spike/test-mcp-server.mjs");
const PORT = 8795, NATIVE_PORT = 8796;
const dir = mkdtempSync(join(tmpdir(), "god-run-"));
// Configure ONE local connector "cxn" → the test MCP server (read_note + send_note).
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { cxn: { command: process.execPath, args: [TEST_MCP] } } }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`  ${cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${extra ? "  — " + extra : ""}`); cond ? pass++ : fail++; };

const daemon = spawn(process.execPath, [DAEMON], {
  // RELAY_IMPORT_CLAUDE=0 → do NOT pull in the user's real ~/.claude.json servers; this spike must
  // see ONLY the "cxn" test connector (isolation + no network flakiness from real servers).
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT), RELAY_NATIVE: "1", RELAY_NATIVE_PORT: String(NATIVE_PORT), RELAY_IMPORT_CLAUDE: "0" },
  stdio: ["ignore", "ignore", "inherit"],
});
process.on("exit", () => { try { daemon.kill("SIGKILL"); } catch {} });

async function waitFile(f, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); } throw new Error(`no ${f}`); }

function connectExtension(token) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map();
    ws.on("error", rej);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (d) => { const m = JSON.parse(d.toString());
      if (m.type === "auth_ok") return res({ control, close: () => ws.close() });
      if (m.type === "control_result" && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
    const control = (action, args) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "control", action, args, id })); });
  });
}
function connectNative(token) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${NATIVE_PORT}`);
    const pending = new Map();
    ws.on("error", rej);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (d) => { const m = JSON.parse(d.toString());
      if (m.type === "auth_ok") return res({ request, close: () => ws.close() });
      if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const request = (method, params) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "request", method, params, id })); });
  });
}

try {
  const pairing = await waitFile(join(dir, "pairing-token"));
  await sleep(1500); // let the MCP server connect
  const { control, close: closeExt } = await connectExtension(pairing);

  // 1. register God WITH the connector scope
  const reg = await control("registerNativeApp", { appId: "ai.thelastprompt.god", name: "God", connectors: true });
  ok("registerNativeApp returns a token", !!reg?.token, reg?.principal);
  const grants = await control("listGrants", {});
  const g = grants.grants.find((x) => x.origin === reg.principal);
  ok("God's grant is TRUST mode", g?.mode === "trust", g?.mode);
  ok("God's grant carries the mcp__* wildcard", g?.tools?.some((t) => t.name === "mcp__*"));

  const { request, close: closeNative } = await connectNative(reg.token);

  // 2. enumerate — the wildcard must expand in listTools
  const lt = await request("claude_listTools", {});
  const names = (lt.result?.tools || []).map((t) => t.name);
  ok("listTools enumerates the connector's READ tool", names.includes("mcp__cxn__read_note"), names.filter(n => n.startsWith("mcp__")).join(", "));
  ok("listTools enumerates the connector's WRITE tool", names.includes("mcp__cxn__send_note"));

  // 3. run the READ tool
  const rd = await request("claude_callTool", { name: "mcp__cxn__read_note", arguments: { id: "42" } });
  const rdText = rd.result?.content?.map?.((c) => c.text).join("") || "";
  ok("callTool runs the READ tool, result flows back", !rd.error && /hello from mcp/.test(rdText), rd.error?.message || rdText);

  // 4. run the WRITE tool — trust mode auto-approves (God's notch already gated upstream)
  const wr = await request("claude_callTool", { name: "mcp__cxn__send_note", arguments: { to: "sam", body: "hi" } });
  const wrText = wr.result?.content?.map?.((c) => c.text).join("") || "";
  ok("callTool runs the WRITE tool under trust mode", !wr.error && /sent to sam/.test(wrText), wr.error?.message || wrText);

  // 5. a tool OUTSIDE the grant is denied — the wildcard covers mcp__ only, not arbitrary builtins.
  // A gate denial comes back as result.ok:false with a stable BYOP code (SCOPE_EXCEEDED), not a
  // transport-level .error, so check both.
  const denied = await request("claude_callTool", { name: "claude_storage", arguments: {} });
  const isDenied = !!denied.error || denied.result?.ok === false;
  ok("a NON-connector tool is denied (wildcard is not a skeleton key)", isDenied, denied.error?.code || denied.result?.error?.code || "(unexpectedly allowed)");

  // 6. the run is audited
  const audit = await control("audit", { origin: reg.principal, limit: 50 });
  const ran = (audit.entries || []).some((e) => e.toolName === "mcp__cxn__read_note" || e.toolName === "mcp__cxn__send_note");
  ok("the tool run is recorded in the audit log", ran);

  closeNative(); closeExt();
} catch (e) {
  console.error("spike error:", e.message); fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
daemon.kill("SIGKILL");
process.exit(fail === 0 ? 0 : 1);
