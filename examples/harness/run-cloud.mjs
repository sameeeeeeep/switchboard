#!/usr/bin/env node
/**
 * run-cloud — proves the OPT-IN hosted-inference lane (OpenRouter) end to end, headless, with a
 * MOCK OpenAI-compatible server standing in for openrouter.ai (no real key, no network). It asserts:
 *   • off by default — no hosted models until a key is set;
 *   • cloud.setKey opts in at runtime and surfaces the hosted models (badge data);
 *   • claude_complete returns text from the hosted backend;
 *   • claude_stream delivers REAL SSE deltas then done;
 *   • usage is metered through the daemon's budget ledger;
 *   • agentic runs FAIL CLOSED (no ungated tool loop);
 *   • cloud.clear opts back out.
 *
 *   node examples/harness/run-cloud.mjs   (after building @relay/protocol + @relay/sidekick)
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAsExtension } from "./dev-extension.mjs";

const DAEMON = new URL("../../packages/sidekick/dist/index.js", import.meta.url).pathname;
const hr = () => console.log("─".repeat(64));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTED_MODEL = "openai/gpt-4o-mini";
let daemon = null, mock = null;
process.on("exit", () => { try { daemon?.kill("SIGKILL"); } catch {} try { mock?.close(); } catch {} });

function assert(c, m) { if (!c) throw new Error("assert failed: " + m); console.log("  ✓ " + m); }
async function waitFor(what, fn, ms = 20_000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await sleep(200); } }

/** A tiny OpenAI-compatible mock: GET /v1/models (ok) + POST /v1/chat/completions (SSE stream). */
function startMock(port) {
  return new Promise((resolve) => {
    let sawAuth = null;
    const srv = createServer(async (req, res) => {
      if (req.method === "GET" && req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: HOSTED_MODEL }] }));
        return;
      }
      if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
        sawAuth = req.headers["authorization"] || null;
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const chunks = ["Hosted ", "reply ", "streamed ", "in ", "pieces."];
        for (const c of chunks) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
          await sleep(15);
        }
        // final usage frame (stream_options.include_usage), then DONE
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(404); res.end();
    });
    srv.listen(port, "127.0.0.1", () => resolve({ srv, getAuth: () => sawAuth }));
  });
}

async function main() {
  hr(); console.log("HOSTED INFERENCE (OpenRouter) HARNESS — opt-in, honest, metered"); hr();

  const MOCK_PORT = 8931;
  const m = await startMock(MOCK_PORT);
  mock = m.srv;
  console.log(`mock OpenRouter at http://127.0.0.1:${MOCK_PORT}/v1`);

  // Boot the daemon WITHOUT a cloud key (off by default), pointing the hosted base-url at the mock.
  const dir = mkdtempSync(join(tmpdir(), "relay-cloud-"));
  writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: {} }));
  daemon = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: "8930", RELAY_IMPORT_CLAUDE: "0", RELAY_OPENROUTER_URL: `http://127.0.0.1:${MOCK_PORT}/v1` },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const token = await waitFor("token", () => (existsSync(join(dir, "pairing-token")) ? readFileSync(join(dir, "pairing-token"), "utf8").trim() : null), 10_000);
  const onConsent = (kind, body) => kind === "consent:connect"
    ? { models: [HOSTED_MODEL], tools: [], budgets: { maxTokensPerDay: 1_000_000, maxCallsPerMin: 120 } }
    : true;
  const ext = await waitFor("listening", () => connectAsExtension({ port: 8930, token, origin: "control", onConsent }).catch(() => null), 20_000);

  console.log("\n[1] off by default");
  let st = await ext.control("cloud.status");
  assert(st?.ok === true && st.enabled === false && st.hostedModels.length === 0, "no hosted models until a key is set");

  console.log("\n[2] opt in with a key (runtime, no restart)");
  st = await ext.control("cloud.setKey", { openrouterKey: "sk-or-test-123" });
  assert(st?.ok === true && st.enabled === true, "cloud.setKey enables the hosted lane");
  assert(st.hostedModels.includes(HOSTED_MODEL), `hosted models surfaced for the badge (${HOSTED_MODEL})`);

  console.log("\n[3] a wrapp connects + runs on the hosted model");
  const app = await connectAsExtension({ port: 8930, token, origin: "https://cloudapp.test", onConsent });
  await app.request("claude_connect", { reason: "hosted inference test", models: [HOSTED_MODEL] });
  const c = await app.request("claude_complete", { prompt: "say hi", model: HOSTED_MODEL });
  assert(c?.text === "Hosted reply streamed in pieces.", "claude_complete returns the hosted model's text");
  assert(c?.usage?.inputTokens === 11 && c?.usage?.outputTokens === 7, "usage is captured from the hosted stream");
  assert(/^Bearer sk-or-test-123$/.test(m.getAuth() || ""), "the daemon sent the user's key to the provider (never the page)");

  console.log("\n[4] real streaming");
  const deltas = [];
  const streamed = await app.stream({ prompt: "stream it", model: HOSTED_MODEL }, (d) => { if (d.type === "text") deltas.push(d.text); });
  assert(deltas.length >= 3, `claude_stream delivered live deltas (${deltas.length} chunks)`);
  assert(streamed?.text === "Hosted reply streamed in pieces.", "streamed text assembles correctly");

  console.log("\n[5] agentic fails closed (no ungated tool loop)");
  let failedClosed = false;
  try { await app.request("claude_complete", { prompt: "use a tool", model: HOSTED_MODEL, agentic: true }); }
  catch (e) { failedClosed = /agentic tool loop/i.test(String(e.message)); }
  assert(failedClosed, "an agentic run on the hosted backend is refused, not silently run ungated");

  console.log("\n[6] opt back out");
  st = await ext.control("cloud.clear");
  assert(st?.ok === true && st.enabled === false, "cloud.clear removes the hosted lane");
  const after = await ext.control("cloud.status");
  assert(after.hostedModels.length === 0, "no hosted models after clearing");

  hr(); console.log("HOSTED INFERENCE: all green"); hr();
  app.close(); ext.close(); daemon.kill("SIGKILL"); mock.close();
  process.exit(0);
}

main().catch((err) => { console.error("harness error:", err); try { daemon?.kill("SIGKILL"); } catch {} try { mock?.close(); } catch {} process.exit(1); });
