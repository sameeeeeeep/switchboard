/**
 * DURABLE CONSENT SPIKE: reproduce the exact failure — an extension socket drops mid-consent (MV3
 * worker eviction) — and prove the fix. A consent must NOT fail-close when the socket that would
 * show it goes away; it must RE-PUSH to the extension when it reconnects, and approving it there
 * must complete the original request.
 *
 *   1. socket A connects, triggers a connect (needs consent) → daemon pushes the prompt to A
 *   2. A drops WITHOUT replying (simulates the worker being evicted while the prompt is open)
 *   3. socket B connects → daemon RE-PUSHES the queued prompt to B
 *   4. B approves → the origin ends up GRANTED (the consent survived the socket death)
 *
 * Run: npm run build -w @relay/sidekick && node packages/sidekick/spike/consent-durable-spike.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const PORT = 8996;
const ORIGIN = "https://prism.app";
const relayDir = mkdtempSync(join(tmpdir(), "relay-consent-"));
const checks = [];
const check = (n, c, d = "") => { checks.push(!!c); console.error(`${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => { let b = ""; const t = setTimeout(() => reject(new Error("start timeout")), 20000); daemon.stderr.on("data", (d) => { b += d; const m = b.match(/pairing token \(paste into the extension\): (\S+)/); if (m && /listening on ws/.test(b)) { clearTimeout(t); resolve(m[1]); } }); daemon.on("exit", (c) => reject(new Error(`daemon exited ${c}`))); });

function sock() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const api = { ws, prompts: [], responses: [], onprompt: null };
    ws.on("message", (d) => {
      const m = JSON.parse(d);
      if (m.type === "auth_ok") api.authed?.();
      else if (m.type === "prompt") { api.prompts.push(m); api.onprompt?.(m); }
      else if (m.type === "response") api.responses.push(m);
      else if (m.type === "control_result") api.onctrl?.(m);
    });
    ws.on("open", () => { api.authed = () => resolve(api); ws.send(JSON.stringify({ type: "auth", token })); });
  });
}

try {
  // 1. socket A triggers a connect that needs consent.
  const A = await sock();
  A.ws.send(JSON.stringify({ type: "request", origin: ORIGIN, method: "claude_connect", params: { reason: "prism", models: ["sonnet"] }, id: "req1", sentAt: Date.now() }));
  await sleep(600);
  check("daemon pushed the connect prompt to socket A", A.prompts.some((p) => p.kind === "consent:connect"));
  const promptId = A.prompts.find((p) => p.kind === "consent:connect")?.id;

  // 2. A drops WITHOUT replying — the worker got evicted mid-consent.
  A.ws.terminate();
  await sleep(400);

  // 3. socket B connects → daemon should RE-PUSH the still-open prompt.
  const B = await sock();
  await sleep(400);
  const rePushed = B.prompts.find((p) => p.id === promptId && p.kind === "consent:connect");
  check("daemon RE-PUSHED the queued prompt to the reconnected socket B", !!rePushed, rePushed ? "same prompt id" : "not re-pushed");

  // 4. B approves → reply with the granted scope.
  B.ws.send(JSON.stringify({ type: "reply", id: promptId, result: { models: ["sonnet"], tools: [], budgets: rePushed.body.budgets } }));
  await sleep(500);

  // Verify the origin is now GRANTED (the consent survived A's death and completed on B).
  B.onctrl = null;
  const grants = await new Promise((res) => { B.onctrl = (m) => res(m.result); B.ws.send(JSON.stringify({ type: "control", id: "c1", action: "listGrants" })); });
  const granted = (grants?.grants ?? []).some((g) => g.origin === ORIGIN);
  check("the origin is GRANTED after approving on B (consent survived the drop)", granted);
} finally { daemon.kill("SIGKILL"); }

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ DURABLE CONSENT SPIKE PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} · consent survives a mid-prompt socket drop`);
process.exit(passed === checks.length ? 0 : 1);
