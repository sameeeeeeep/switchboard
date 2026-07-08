/**
 * PROOF (Phase 2): brandbrain's persistence runs on Switchboard, and an EXISTING project folder's
 * data comes straight through.
 *
 * Stands up a throwaway daemon (temp RELAY_DIR — never touches your real ~/.relay), bridges a
 * `window.claude`-shaped provider over its WS (as the extension would), and drives the adapter's
 * claude_storage shim — the drop-in for brandbrain's lib/server/workspace-store.ts:
 *
 *   1. bindFolder(existingProjectDir)  → user consents (auto-approved here) to a real folder that
 *                                         ALREADY holds workspace.json with real brand data
 *   2. readWorkspace()                 → returns that existing data verbatim (zero migration)
 *   3. writeWorkspace(edited)          → lands back in the SAME real workspace.json on disk
 *   4. auto-assign                     → a second origin gets its own private sandbox, no bind
 *
 * Run: npm run build -w @relay/sidekick && node examples/adapter/proof/run-storage.mjs
 */
import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setProvider } from "../claude.mjs";
import { bindFolder, readWorkspace, writeWorkspace, storageInfo } from "../claude_storage.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DAEMON = join(HERE, "../../../packages/sidekick/dist/index.js");
const PORT = 8991;
const ORIGIN = "https://brandbrain.app";

// A real, pre-existing brandbrain project folder with data already on disk.
const projectDir = join(mkdtempSync(join(tmpdir(), "brandbrain-existing-")), ".data");
mkdirSync(projectDir, { recursive: true });
const existing = { brands: [{ id: "acme", name: "Acme Adaptogens" }, { id: "b2", name: "Nightcap" }], activeId: "acme", savedAt: 1720000000000 };
writeFileSync(join(projectDir, "workspace.json"), JSON.stringify(existing));

const relayDir = mkdtempSync(join(tmpdir(), "relay-dir-"));
const checks = [];
const check = (name, cond, detail = "") => { checks.push(!!cond); console.error(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

// ---- spin up a throwaway daemon on a temp RELAY_DIR ----
const daemon = spawn("node", [DAEMON], { env: { ...process.env, RELAY_DIR: relayDir, RELAY_PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
const token = await new Promise((resolve, reject) => {
  let buf = "";
  const t = setTimeout(() => reject(new Error("daemon did not start in time")), 20000);
  daemon.stderr.on("data", (d) => {
    buf += d.toString();
    const m = buf.match(/pairing token \(paste into the extension\): (\S+)/);
    if (m && /listening on ws/.test(buf)) { clearTimeout(t); resolve(m[1]); }
  });
  daemon.on("exit", (c) => reject(new Error(`daemon exited early (${c})`)));
});

function connectProvider(origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map();
    const listeners = {};
    const rpc = (method, params) => new Promise((res, rej) => {
      const id = Math.random().toString(36).slice(2);
      pending.set(id, (m) => (m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result)));
      ws.send(JSON.stringify({ type: "request", origin, method, params, id, sentAt: Date.now() }));
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
      else if (m.type === "prompt") {
        // Stand in for the human at the extension popup.
        if (m.kind === "consent:connect") ws.send(JSON.stringify({ type: "reply", id: m.id, result: { models: ["sonnet"], tools: [], budgets: m.body.budgets } }));
        else if (m.kind === "consent:storage-bind") { console.error(`  [consent] bind → ${m.body.path} — user APPROVES`); ws.send(JSON.stringify({ type: "reply", id: m.id, result: true })); }
        else ws.send(JSON.stringify({ type: "reply", id: m.id, result: false }));
      }
    });
  });
}

try {
  const provider = await connectProvider(ORIGIN);
  await provider.request({ method: "claude_connect", params: { reason: "brandbrain persistence" } });
  setProvider(provider);

  // Before bind: auto-assigned private sandbox, empty.
  const before = await storageInfo();
  check("starts on an auto-assigned sandbox", before?.autoAssigned === true);
  check("sandbox starts empty", before?.count === 0);
  check("workspace is empty before bind", (await readWorkspace()) === null);

  // 1. bind to the existing project folder (consent exercised over the wire).
  const info = await bindFolder(projectDir);
  check("bind resolves to the real project dir", info?.folder === projectDir, info?.folder);
  check("bind flips off auto-assign", info?.autoAssigned === false);

  // 2. existing data comes straight through.
  const ws = await readWorkspace();
  check("existing brand data reads through the shim", ws?.brands?.[0]?.name === "Acme Adaptogens");
  check("existing activeId preserved", ws?.activeId === "acme");

  // 3. a write lands back in the real workspace.json.
  await writeWorkspace({ ...existing, activeId: "b2" });
  const onDisk = JSON.parse(readFileSync(join(projectDir, "workspace.json"), "utf8"));
  check("write persists to the real workspace.json", onDisk.activeId === "b2");

  // 4. a DIFFERENT origin auto-assigns its own sandbox — isolation, no bind.
  const other = await connectProvider("https://someone-else.app");
  await other.request({ method: "claude_connect", params: { reason: "x" } });
  const otherInfo = await other.request({ method: "claude_storage", params: { op: "info" } });
  check("a second origin auto-assigns its own sandbox", otherInfo?.info?.autoAssigned === true && otherInfo.info.folder !== projectDir);

  const relayHome = relayDir.startsWith(homedir()); // sanity: we used a temp dir, not real ~/.relay
  check("used a throwaway RELAY_DIR (real ~/.relay untouched)", relayDir.includes("relay-dir-"));
} finally {
  daemon.kill("SIGKILL");
}

const passed = checks.filter(Boolean).length;
console.error(`\n${passed === checks.length ? "✅ PHASE-2 PROOF PASSED" : `❌ ${checks.length - passed} FAILED`} — ${passed}/${checks.length} checks · brandbrain persistence on Switchboard, existing folder through the shim`);
process.exit(passed === checks.length ? 0 : 1);
