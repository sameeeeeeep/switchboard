/**
 * PROOF: brandbrain's real gaps route runs on Switchboard, unchanged.
 *
 * We stand up a `window.claude`-shaped provider backed by the live daemon (acting as the extension
 * would), inject it into the adapter, mount brandbrain's gaps handler in the fetch-router, and
 * dispatch a POST — exactly what brandbrain's frontend does. Out comes real, scored openings, with
 * the model call having gone through the consented broker (the visitor's own Claude), no server.
 *
 * Run: node examples/adapter/proof/run-gaps.mjs
 */
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { setProvider } from "../claude.mjs";
import { createApp } from "../router.mjs";
import { POST as gapsPOST } from "./gaps-route.mjs";

const PORT = 8787;
const ORIGIN = "https://brandbrain.app";
const token = readFileSync(homedir() + "/.relay/pairing-token", "utf8").trim();

// A window.claude-shaped provider over the daemon WS (what the extension bridges in the browser).
function connectProvider() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map();
    const listeners = {};
    const rpc = (method, params) => new Promise((res, rej) => {
      const id = Math.random().toString(36).slice(2);
      pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result)));
      ws.send(JSON.stringify({ type: "request", origin: ORIGIN, method, params, id, sentAt: Date.now() }));
    });
    const provider = {
      isRelay: true,
      request: ({ method, params }) => rpc(method, params),
      on: (e, h) => (listeners[e] = listeners[e] || []).push(h),
      removeListener: (e, h) => { const a = listeners[e]; if (a) a.splice(a.indexOf(h) >>> 0, 1); },
    };
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "auth_ok") resolve(provider);
      else if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.type === "event" && m.event === "delta") (listeners.delta || []).forEach((fn) => fn(m.payload));
      else if (m.type === "prompt") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } })); // auto-approve connect
    });
  });
}

const provider = await connectProvider();
await provider.request({ method: "claude_connect", params: { reason: "brandbrain studio" } });
setProvider(provider); // ← this is the entire "migration": window.claude backs runClaude now

// The app mounts its own routes unchanged.
const app = createApp({ "/api/studio/gaps": { POST: gapsPOST } });

// A market canvas, as brandbrain's frontend would POST it.
const canvas = {
  category: { name: "functional tea", scope: "D2C wellness beverages" },
  segments: [{ name: "sleep", tag: "core", note: "" }, { name: "focus", tag: "adjacent", note: "" }],
  players: [
    { brand: "Pukka", kind: "incumbent", segment: "sleep", note: "herbal, mass, supermarket" },
    { brand: "Moonbrew", kind: "challenger", segment: "sleep", note: "adaptogen latte, premium DTC" },
  ],
};

console.error("→ POST /api/studio/gaps (brandbrain's real route, via the adapter, on the daemon's model)\n");
const res = await app.handle(new Request("http://switchboard.local/api/studio/gaps", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvas }),
}));
const json = await res.json();
console.error(`HTTP ${res.status}\n`);
console.log(JSON.stringify(json, null, 2));
console.error(`\n${res.status === 200 && json.gaps?.length ? "✅ brandbrain's route ran on Switchboard — real openings, scored, model via the broker, no server." : "❌ no gaps"}`);
process.exit(res.status === 200 && json.gaps?.length ? 0 : 1);
