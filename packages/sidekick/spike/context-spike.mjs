/**
 * CONTEXT SPIKE: the cross-app handoff, headless. Proves BYO-context's core guarantees on the REAL
 * compiled daemon (throwaway RELAY_DIR):
 *   1. brandbrain (origin BB) publishes a whole brand context ("Aamras")
 *   2. ad-generator (origin AD) active() → null — nothing lent yet (the moat: no auto-sharing)
 *   3. AD list() sees only ITS OWN contexts (none) — it can't enumerate BB's library
 *   4. the user SELECTS Aamras for AD (panel/control) → AD active() returns the WHOLE context
 *   5. a third origin (EVIL) active() → null — selection is per-origin, not global
 *   6. clearing the selection → AD active() → null again (revocable)
 *
 * Run: npm run build -w @relay/sidekick && node packages/sidekick/spike/context-spike.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const PORT = 8993;
const BB = "https://brandbrain.app", AD = "https://adgen.app", EVIL = "https://evil.example";
const relayDir = mkdtempSync(join(tmpdir(), "relay-ctx-"));
const checks = [];
const check = (name, cond, detail = "") => { checks.push(!!cond); console.error(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => {
  let buf = ""; const t = setTimeout(() => reject(new Error("daemon start timeout")), 20000);
  daemon.stderr.on("data", (d) => { buf += d; const m = buf.match(/pairing token \(paste into the extension\): (\S+)/); if (m && /listening on ws/.test(buf)) { clearTimeout(t); resolve(m[1]); } });
  daemon.on("exit", (c) => reject(new Error(`daemon exited ${c}`)));
});

// One socket acting as the extension: it stamps a per-call origin, drives the control channel, and
// auto-approves connect prompts (standing in for the human at the panel).
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const pending = new Map();
const rpc = (origin, method, params) => new Promise((res, rej) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result))); ws.send(JSON.stringify({ type: "request", origin, method, params, id, sentAt: Date.now() })); });
const control = (action, args) => new Promise((res) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ type: "control", id, action, args })); });
await new Promise((resolve, reject) => {
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  ws.on("error", reject);
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.type === "auth_ok") resolve();
    else if ((m.type === "response" || m.type === "control_result") && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.type === "prompt" && m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } }));
  });
});

try {
  await rpc(BB, "claude_connect", { reason: "brandbrain" });
  await rpc(AD, "claude_connect", { reason: "ad generator" });
  await rpc(EVIL, "claude_connect", { reason: "x" });

  // 1. brandbrain publishes a whole brand context (opaque data — no field schema).
  const brand = { positioning: "cold-pressed Indian mango, premium", voice: "warm, unfussy", palette: ["#F4A100", "#0A0C10"], range: ["Alphonso 250ml", "Kesar 1L"], pricing: "₹₹₹" };
  const pub = await rpc(BB, "claude_context", { op: "publish", context: { name: "Aamras", kind: "brand", data: brand } });
  check("brandbrain publishes a brand context", !!pub.id);
  const aamrasId = pub.id;

  // 2 + 3. ad-generator sees nothing until it's lent — and can't enumerate the library.
  check("ad-gen active() is null before selection (no auto-share)", (await rpc(AD, "claude_context", { op: "active" })).context === null);
  check("ad-gen list() sees only its own (empty)", ((await rpc(AD, "claude_context", { op: "list" })).contexts ?? []).length === 0);
  check("brandbrain list() sees its own Aamras", ((await rpc(BB, "claude_context", { op: "list" })).contexts ?? []).some((c) => c.id === aamrasId));

  // 4. the user selects Aamras for the ad-gen (panel/control) → whole context flows.
  await control("selectContext", { origin: AD, contextId: aamrasId });
  const active = (await rpc(AD, "claude_context", { op: "active" })).context;
  check("after selection ad-gen active() returns Aamras", active?.name === "Aamras");
  check("ad-gen receives the WHOLE brand data", active?.data?.palette?.[0] === "#F4A100" && active?.data?.voice === "warm, unfussy");

  // 5. selection is per-origin — a third app gets nothing.
  check("a different origin still gets null", (await rpc(EVIL, "claude_context", { op: "active" })).context === null);

  // 6. revocable — clear the selection.
  await control("selectContext", { origin: AD, contextId: null });
  check("clearing selection revokes the lend", (await rpc(AD, "claude_context", { op: "active" })).context === null);

  // panel sees the whole library (control only).
  const all = await control("listContexts");
  check("panel (control) can list the whole library", (all.contexts ?? []).some((c) => c.name === "Aamras"));
} finally {
  daemon.kill("SIGKILL");
}

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ CONTEXT SPIKE PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} · publish once, lend per-app by selection, moat holds`);
process.exit(passed === checks.length ? 0 : 1);
