/**
 * LIVE PROOF: does the ported brandbrain actually work — the DATA path (your real brands) and the
 * MODEL path (your Claude) — end to end?
 *
 * Spins a throwaway daemon (temp RELAY_DIR, never touches your real ~/.relay or the live extension),
 * connects a window.claude-shaped provider, and drives the SAME adapter shims + a REAL brandbrain
 * route the ported app uses:
 *   1. bind your real ~/Documents/Projects/brandbrain/.data  → read your 6 brands back (data path)
 *   2. a plain completion on your Claude                     → model path is alive
 *   3. brandbrain's real /api/studio/gaps route              → real scored openings (model + route)
 *
 * Read-only on your data (only readWorkspace; never writes). Run:
 *   npm run build -w @relay/sidekick && node examples/brandbrain-port/proof/run-live.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setProvider } from "../../adapter/claude.mjs";
import { bindFolder, readWorkspace } from "../../adapter/claude_storage.mjs";
import { createApp } from "../../adapter/router.mjs";
import { POST as gapsPOST } from "../../adapter/proof/gaps-route.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(HERE, "../../../packages/sidekick/dist/index.js");
const PORT = 8992;
const ORIGIN = "https://brandbrain.app";
const REAL_DATA = join(homedir(), "Documents/Projects/brandbrain/.data");
const relayDir = mkdtempSync(join(tmpdir(), "relay-live-"));

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => {
  let buf = ""; const t = setTimeout(() => reject(new Error("daemon start timeout")), 25000);
  daemon.stderr.on("data", (d) => { buf += d; const m = buf.match(/pairing token \(paste into the extension\): (\S+)/); if (m && /listening on ws/.test(buf)) { clearTimeout(t); resolve(m[1]); } });
  daemon.on("exit", (c) => reject(new Error(`daemon exited ${c}`)));
});

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map(); const listeners = {};
    const rpc = (method, params) => new Promise((res, rej) => { const id = Math.random().toString(36).slice(2); pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result))); ws.send(JSON.stringify({ type: "request", origin: ORIGIN, method, params, id, sentAt: Date.now() })); });
    const provider = { isRelay: true, request: ({ method, params }) => rpc(method, params), on: (e, h) => (listeners[e] = listeners[e] || []).push(h), removeListener: (e, h) => { const a = listeners[e]; if (a) a.splice(a.indexOf(h) >>> 0, 1); } };
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "auth_ok") resolve(provider);
      else if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.type === "event" && m.event === "delta") (listeners.delta || []).forEach((fn) => fn(m.payload));
      else if (m.type === "prompt") {
        if (m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } }));
        else if (m.kind === "consent:storage-bind") ws.send(JSON.stringify({ type: "reply", id: m.id, result: true }));
        else ws.send(JSON.stringify({ type: "reply", id: m.id, result: false }));
      }
    });
  });
}

const log = (s) => console.error(s);
try {
  const provider = await connect();
  await provider.request({ method: "claude_connect", params: { reason: "brandbrain live proof", models: ["sonnet"] } });
  setProvider(provider);

  // 1. DATA PATH — bind your real .data and read your brands back.
  log("\n① DATA PATH — binding your real ~/Documents/Projects/brandbrain/.data …");
  await bindFolder(REAL_DATA);
  const ws = await readWorkspace();
  const brands = Array.isArray(ws?.brands) ? ws.brands : [];
  log(`   read ${brands.length} brands from your folder: ${brands.map((b) => b.name).slice(0, 8).join(" · ")}`);
  const dataOk = brands.length > 0;

  // 2. MODEL PATH — a plain completion on your Claude.
  log("\n② MODEL PATH — one completion on your Claude …");
  const r = await provider.request({ method: "claude_complete", params: { prompt: "Reply with exactly: brandbrain live.", model: "sonnet" } });
  log(`   model replied: ${JSON.stringify((r?.text || "").trim().slice(0, 60))}`);
  const modelOk = /brandbrain/i.test(r?.text || "");

  // 3. MODEL + ROUTE — brandbrain's real gaps route, dispatched through the fetch-router.
  log("\n③ MODEL + ROUTE — brandbrain's real /api/studio/gaps on your Claude …");
  const app = createApp({ "/api/studio/gaps": { POST: gapsPOST } });
  const canvas = { category: { name: "functional tea", scope: "D2C wellness" }, segments: [{ name: "sleep", tag: "core" }], players: [{ brand: "Pukka", kind: "incumbent", segment: "sleep" }, { brand: "Moonbrew", kind: "challenger", segment: "sleep" }] };
  const res = await app.handle(new Request("http://local/api/studio/gaps", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvas }) }));
  const gj = await res.json();
  const gaps = gj.gaps || [];
  log(`   HTTP ${res.status} · ${gaps.length} openings: ${gaps.map((g) => g.title).slice(0, 4).join(" · ")}`);
  const routeOk = res.status === 200 && gaps.length > 0;

  log("\n================ VERDICT ================");
  log(`① your real brands read through the shim: ${dataOk ? "✅" : "❌"} (${brands.length})`);
  log(`② model path (your Claude) alive:         ${modelOk ? "✅" : "❌"}`);
  log(`③ real brandbrain route returns results:  ${routeOk ? "✅" : "❌"} (${gaps.length} openings)`);
  const pass = dataOk && modelOk && routeOk;
  log(`\n${pass ? "✅ THE PORT WORKS END-TO-END — your data + your Claude." : "❌ something is not wired"}`);
  daemon.kill("SIGKILL");
  process.exit(pass ? 0 : 1);
} catch (e) {
  log(`\n❌ proof failed: ${e?.stack || e}`);
  daemon.kill("SIGKILL");
  process.exit(1);
}
