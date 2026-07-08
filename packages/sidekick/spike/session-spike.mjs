/**
 * SESSION SPIKE: prove the warm session on the REAL daemon (throwaway RELAY_DIR). Sends several
 * studio-style turns to ONE sessionId and checks:
 *   • every turn returns parseable JSON (the card the app expects) — no stall
 *   • turns run SEQUENTIALLY on one warm process (not a concurrent cold-spawn herd)
 *   • later turns are typically faster than the first (warm reuse — the whole point)
 *
 * Uses your Claude (spawns `claude`), so it makes real model calls. Run:
 *   npm run build -w @relay/sidekick && node packages/sidekick/spike/session-spike.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const PORT = 8995;
const ORIGIN = "https://brandbrain.app";
const SID = "brand-build-1";
const relayDir = mkdtempSync(join(tmpdir(), "relay-sess-"));
const checks = [];
const check = (n, c, d = "") => { checks.push(!!c); console.error(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => { let b = ""; const t = setTimeout(() => reject(new Error("daemon start timeout")), 20000); daemon.stderr.on("data", (d) => { b += d; const m = b.match(/pairing token \(paste into the extension\): (\S+)/); if (m && /listening on ws/.test(b)) { clearTimeout(t); resolve(m[1]); } }); daemon.on("exit", (c) => reject(new Error(`daemon exited ${c}`))); });

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const pending = new Map();
const rpc = (method, params) => new Promise((res, rej) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result))); ws.send(JSON.stringify({ type: "request", origin: ORIGIN, method, params, id, sentAt: Date.now() })); });
await new Promise((resolve, reject) => { ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token }))); ws.on("error", reject); ws.on("message", (d) => { const m = JSON.parse(d); if (m.type === "auth_ok") resolve(); else if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.type === "prompt" && m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [{ name: "WebSearch", access: "read" }, { name: "WebFetch", access: "read" }], budgets: m.body.budgets } })); }); });

function parseJson(text) { const c = String(text).replace(/```(?:json)?/gi, "").trim(); const s = c.search(/[{[]/), e = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]")); try { return JSON.parse(c.slice(s, e + 1)); } catch { return null; } }
const turn = async (label, prompt) => {
  const t0 = Date.now();
  const r = await rpc("claude_session", { op: "send", sessionId: SID, prompt, system: "You are brandbrain. Output ONLY the JSON the turn asks for. No prose, no code fences.", effort: "low" });
  const ms = Date.now() - t0;
  const parsed = parseJson(r?.text || "");
  console.error(`  ${label}: ${ms}ms · options=${parsed?.options?.length ?? "—"}`);
  return { ms, ok: !!parsed && Array.isArray(parsed.options) && parsed.options.length > 0 };
};

try {
  await rpc("claude_connect", { reason: "brandbrain", models: ["sonnet"] });
  console.error("sending 3 sequential turns on ONE warm session…\n");
  const t1 = await turn("turn1 positioning", 'Premium men\'s skincare, tier-2 South India, ₹200-250. 3 positioning options. JSON {"options":[{"title":"...","body":"..."}]}');
  const t2 = await turn("turn2 audience", 'Now 3 audience segment options for the same brand. JSON {"options":[{"title":"...","body":"..."}]}');
  const t3 = await turn("turn3 names", 'Now 3 brand name options, consistent with the positioning + audience above. JSON {"options":[{"title":"...","body":"..."}]}');

  check("turn 1 returned a valid card", t1.ok);
  check("turn 2 returned a valid card", t2.ok);
  check("turn 3 returned a valid card", t3.ok);
  check("all three turns succeeded (no stall)", t1.ok && t2.ok && t3.ok);
  check("warm reuse — a later turn beat the first (cold) turn", Math.min(t2.ms, t3.ms) < t1.ms, `t1=${t1.ms}ms min(t2,t3)=${Math.min(t2.ms, t3.ms)}ms`);

  await rpc("claude_session", { op: "end", sessionId: SID });
  check("session ends cleanly", true);
} finally { daemon.kill("SIGKILL"); }

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ SESSION SPIKE PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} · warm thread, sequential turns, no stall`);
process.exit(passed === checks.length ? 0 : 1);
