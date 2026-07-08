/**
 * CONTEXT DEMO PROOF: the real agency loop, headless. brandbrain publishes YOUR real brands; Prism
 * (a different origin) gets nothing until you lend it one; after selection it reads the whole brand
 * with the fields it needs (product options + palette + voice). Throwaway daemon — never touches
 * your live setup. Read-only on your data.
 *
 * Run: npm run build -w @relay/sidekick && node examples/brandbrain-port/proof/run-context-demo.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/sidekick/dist/index.js");
const PORT = 8994;
const BB = "https://brandbrain.app", PRISM = "https://prism.app";
const relayDir = mkdtempSync(join(tmpdir(), "relay-demo-"));
const checks = [];
const check = (n, c, d = "") => { checks.push(!!c); console.error(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

// Same Brand → context mapping the port's bootstrap uses.
function brandToContext(b) {
  const L = b.locks || {}; const line = (c) => (c && (c.title || c.name)) || "";
  const palette = (L.identity && L.identity.palette) || b.palette || [];
  const products = [line(L.range), line(L.format), b.idea].filter(Boolean);
  return { id: b.id, name: b.name || "Brand", kind: "brand", data: { voice: line(L.voice) || (b.brief && b.brief.vibe) || "", positioning: line(L.positioning) || "", palette: Array.isArray(palette) ? palette : [], products } };
}

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => { let buf = ""; const t = setTimeout(() => reject(new Error("daemon start timeout")), 20000); daemon.stderr.on("data", (d) => { buf += d; const m = buf.match(/pairing token \(paste into the extension\): (\S+)/); if (m && /listening on ws/.test(buf)) { clearTimeout(t); resolve(m[1]); } }); daemon.on("exit", (c) => reject(new Error(`daemon exited ${c}`))); });

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const pending = new Map();
const rpc = (origin, method, params) => new Promise((res, rej) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result))); ws.send(JSON.stringify({ type: "request", origin, method, params, id, sentAt: Date.now() })); });
const control = (action, args) => new Promise((res) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ type: "control", id, action, args })); });
await new Promise((resolve, reject) => { ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token }))); ws.on("error", reject); ws.on("message", (d) => { const m = JSON.parse(d); if (m.type === "auth_ok") resolve(); else if ((m.type === "response" || m.type === "control_result") && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.type === "prompt" && m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } })); }); });

try {
  await rpc(BB, "claude_connect", { reason: "brandbrain" });
  await rpc(PRISM, "claude_connect", { reason: "prism", tools: ["mcp__claude_ai_Higgsfield__*"] });

  // brandbrain publishes your REAL brands.
  const ws0 = JSON.parse(readFileSync(join(homedir(), "Documents/Projects/brandbrain/.data/workspace.json"), "utf8"));
  const brands = (ws0.brands || []).filter((b) => b && b.name);
  for (const b of brands) await rpc(BB, "claude_context", { op: "publish", context: brandToContext(b) });
  check("brandbrain published your real brands", brands.length > 0, `${brands.length}: ${brands.map((b) => b.name).slice(0, 4).join(" · ")}`);

  // Prism sees nothing until lent, and can't enumerate the library.
  check("Prism active() is null before you lend one", (await rpc(PRISM, "claude_context", { op: "active" })).context === null);
  check("Prism list() sees only its own (none)", ((await rpc(PRISM, "claude_context", { op: "list" })).contexts ?? []).length === 0);

  // You pick one in the panel (control) → Prism reads the whole brand.
  const lib = (await control("listContexts")).contexts ?? [];
  const pick = lib[0];
  await control("selectContext", { origin: PRISM, contextId: pick.id });
  const active = (await rpc(PRISM, "claude_context", { op: "active" })).context;
  check("after you lend it, Prism reads the brand", active?.name === pick.name, active?.name);
  const d = active?.data || {};
  check("Prism has product options to choose from", Array.isArray(d.products) && d.products.length > 0, (d.products || []).slice(0, 3).join(" · "));
  check("Prism has the brand palette + voice", Array.isArray(d.palette), `palette:${(d.palette || []).length} voice:${d.voice ? "yes" : "—"}`);

  // NEW: the panel's global "Working on" project — one selection scopes every app (no per-app pick).
  await control("selectContext", { origin: PRISM, contextId: null });                 // clear Prism's per-app pick
  check("clearing per-app pick → Prism sees nothing again", (await rpc(PRISM, "claude_context", { op: "active" })).context === null);
  const aamras = lib.find((c) => /aamras/i.test(c.name)) || lib[1] || lib[0];
  await control("setActiveProject", { contextId: aamras.id });                        // set the GLOBAL working-on project
  const viaGlobal = (await rpc(PRISM, "claude_context", { op: "active" })).context;
  check("setting 'Working on' globally → Prism inherits it with no per-app step", viaGlobal?.name === aamras.name, viaGlobal?.name);
  const brandbrainSees = (await rpc(BB, "claude_context", { op: "active" })).context;  // any connected app inherits it
  check("a second app also inherits the global project", brandbrainSees?.name === aamras.name);
} finally { daemon.kill("SIGKILL"); }

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ CONTEXT DEMO PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} · build a brand once, lend it to Prism, generate on your own compute`);
process.exit(passed === checks.length ? 0 : 1);
