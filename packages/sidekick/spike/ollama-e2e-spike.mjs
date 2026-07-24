/**
 * OLLAMA END-TO-END SPIKE: drive the REAL running sidekick over its WS as if we were the
 * extension, and run a completion on a LOCAL model (Ollama) instead of Claude. Proves the
 * "route any local model through the broker" half of the vision through the actual server +
 * pairing + connect consent + model grant + BackendRegistry → LocalOpenAIBackend path:
 *   1. pairing-token auth
 *   2. claude_connect requesting a local model → we (as the extension) approve the model grant
 *   3. claude_complete { model: <local>, agentic:false } → LocalOpenAIBackend hits Ollama → real text
 *
 * Prereq: Ollama running at OLLAMA_URL (default http://127.0.0.1:11434/v1) with MODEL pulled.
 * Run:  npm run build -w @relay/protocol && npm run build -w @relay/sidekick \
 *       && node packages/sidekick/spike/ollama-e2e-spike.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1";
const MODEL = process.env.MODEL ?? "llama3.2:latest";
const PORT = 8792;

const dir = mkdtempSync(join(tmpdir(), "relay-ollama-"));
// No MCP servers needed — this is a pure text completion.
writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  // RELAY_IMPORT_CLAUDE=0: this is a pure text completion — don't auto-import the user's real
  // ~/.claude.json MCP servers (irrelevant here, and a crashing one shouldn't affect the test).
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT), RELAY_LOCAL_OPENAI_URL: OLLAMA_URL, RELAY_IMPORT_CLAUDE: "0" },
  stdio: ["ignore", "inherit", "inherit"],
});
// Safety net: kill the daemon on ANY exit path (incl. uncaught ws-callback exceptions) — an
// orphaned daemon keeps the port and poisons every later run.
process.on("exit", () => { try { daemon.kill("SIGKILL"); } catch { /* gone */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForToken() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 40; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("token never appeared");
}

function connect(token) {
  return new Promise((resolveConn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); // no Origin header ⇒ treated as extension
    const pending = new Map();
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok") { resolveConn({ ws, request, control }); return; }
      if (msg.type === "response" && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.type === "control_result" && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
      if (msg.type === "prompt") {
        // We ARE the extension's consent UI. Grant exactly the requested local model.
        let result = false;
        if (msg.kind === "consent:connect") {
          // msg.body is the consent payload directly: { models: {available, requested}, tools, ... }
          const { available, requested } = msg.body.models;
          console.error(`  [ext] daemon offers models: ${JSON.stringify(available)}`);
          result = {
            models: requested?.length ? requested : available.slice(0, 1),
            tools: [],
            budgets: { maxTokensPerDay: 500000, maxCallsPerMin: 60 },
          };
          console.error(`  [ext] connect prompt → granting models ${JSON.stringify(result.models)}`);
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
  // Token file ≠ server listening (MCP + backend probes boot in between) — poll the dial.
  const t0 = Date.now();
  let conn;
  for (;;) {
    try { conn = await connect(token); break; } catch (err) { if (Date.now() - t0 > 20_000) throw err; await sleep(250); }
  }
  const { request, control } = conn;
  const ORIGIN = "https://demo.test";
  // Grant TWO local models so we can prove the user override substitutes one for the other.
  const APP_MODEL = "qwen2.5:3b";       // what the "app" asks for on every call
  const USER_CHOICE = MODEL;            // what the USER forces it to run on (default llama3.2)

  const connectRes = await request(ORIGIN, "claude_connect", {
    models: [APP_MODEL, USER_CHOICE],
    reason: "ollama e2e spike",
  });
  const granted = connectRes.result?.models ?? [];
  console.error(`\nconnect → granted models: ${JSON.stringify(granted)}`);

  const ask = (label) =>
    request(ORIGIN, "claude_complete", {
      model: APP_MODEL, // the app ALWAYS asks for qwen — it never knows about the override
      system: "You are terse. Answer in one short sentence.",
      prompt: "In one sentence, what is a consent broker?",
      agentic: false,
      maxTokens: 80,
    }).then((r) => {
      if (r.error) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
      console.error(`\n[${label}] app asked for ${APP_MODEL} → ran on: ${r.result?.model}`);
      console.error(`[${label}] reply: ${JSON.stringify(r.result?.text ?? "")}`);
      return r.result;
    });

  // 1. No override → honors the app's request (qwen).
  const plain = await ask("no-override");

  // 2. User sets an override to llama3.2 → the SAME app call now runs on llama, app unchanged.
  const set = await control("setModelOverride", { origin: ORIGIN, model: USER_CHOICE });
  console.error(`\n[user] setModelOverride(${USER_CHOICE}) → ok=${set?.ok}, grant.modelOverride=${set?.grant?.modelOverride}`);
  const overridden = await ask("with-override");

  console.error("\n================ VERDICT ================");
  const bothGranted = granted.includes(APP_MODEL) && granted.includes(USER_CHOICE);
  const plainHonored = plain?.model === APP_MODEL;
  const overrideApplied = overridden?.model === USER_CHOICE && (overridden?.text ?? "").trim().length > 0;
  console.error(`both models granted:                 ${bothGranted}   (want true)`);
  console.error(`no override → ran on app's model:    ${plainHonored}   (want true, got ${plain?.model})`);
  console.error(`override → ran on USER's model:      ${overrideApplied}   (want true, got ${overridden?.model})`);
  const pass = bothGranted && plainHonored && overrideApplied;
  console.error(`\n${pass ? "✅ OLLAMA E2E + USER OVERRIDE PASSED — user model choice beats the app's request." : "❌ FAILED"}`);
  daemon.kill("SIGKILL");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error("OLLAMA E2E ERROR:", err); daemon.kill("SIGKILL"); process.exit(3); });
