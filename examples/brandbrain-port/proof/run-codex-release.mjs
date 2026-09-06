/**
 * Release smoke test: the packaged daemon, real WebSocket protocol and signed-in Codex.
 * All grants, projects, logs and thread mappings are isolated in a temporary directory.
 * No personal MCP servers are imported. No external tool actions are executed.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { connectAsExtension } from "../../harness/dev-extension.mjs";

const directory = mkdtempSync(join(tmpdir(), "switchboard-codex-release-"));
const stateDir = join(directory, "state");
mkdirSync(stateDir, { mode: 0o700 });
writeFileSync(join(stateDir, "mcp.json"), JSON.stringify({ servers: {} }));
writeFileSync(join(stateDir, "routines-control.json"), JSON.stringify({ off: true }));
const bundle = join(directory, "sidekick.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../../../packages/sidekick/dist/index.js", import.meta.url))],
  bundle: true, platform: "node", format: "esm", target: "node18",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);" },
  outfile: bundle, logLevel: "silent",
});
const listener = createServer();
await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const checks = [];
let child;
let exited;
let clients = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function within(promise, label, ms = 90000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(label, fn) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error("Packaged daemon exited during " + label);
    try { const result = await fn(); if (result) return result; } catch { /* boot in progress */ }
    await pause(150);
  }
  throw new Error(label + " timed out");
}
async function start() {
  const log = openSync(join(directory, "daemon.log"), "a", 0o600);
  child = spawn(process.execPath, [bundle], {
    env: { ...process.env, RELAY_DIR: stateDir, RELAY_HOME: stateDir, RELAY_PORT: String(port),
      RELAY_BACKEND: "codex", RELAY_NATIVE: "0", RELAY_IMPORT_CLAUDE: "0", RELAY_LOCAL_OPENAI: "0",
      RELAY_OPENROUTER_KEY: "", RELAY_TEAM: "0", RELAY_USER: "Codex release test" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  exited = new Promise(resolve => child.once("exit", resolve));
  const bootedAt = Date.now();
  return waitFor("provider inventory", () => {
    const file = join(stateDir, "status.json");
    if (!existsSync(file) || statSync(file).mtimeMs < bootedAt) return null;
    const provider = JSON.parse(readFileSync(file, "utf8")).modelProviders?.find(p => p.id === "codex");
    return provider?.online && provider.signedIn && provider.models.length ? provider : null;
  });
}
async function stop() {
  clients.forEach(client => client.close()); clients = [];
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exited; } finally { clearTimeout(forced); }
  }
}
function pass(message) { checks.push(message); console.log("PASS " + message); }
function storedThread(origin) {
  const rows = JSON.parse(readFileSync(join(stateDir, "codex-sessions.json"), "utf8"));
  return rows.find(([key]) => key === JSON.stringify([origin, "release-session"]))?.[1]?.threadId;
}
async function connect(origin, model, onEvent) {
  const token = readFileSync(join(stateDir, "pairing-token"), "utf8").trim();
  const client = await within(connectAsExtension({ port, token, origin, onEvent,
    onConsent: (kind, body) => kind === "consent:connect" && ["https://codex-release-a.invalid", "https://codex-release-b.invalid"].includes(body.origin)
      ? { models: [model], modelOverride: model, tools: [], budgets: { maxCallsPerMin: 100, maxTokensPerDay: 200000 } }
      : false,
  }), "WebSocket authentication", 15000);
  clients.push(client);
  await within(client.request("claude_connect", { models: ["sonnet"], tools: [], reason: "Isolated Codex release test" }), "connect consent");
  return client;
}
function redPng() {
  function chunk(type, data) {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

try {
  const inventory = await start();
  const model = process.env.RELAY_CODEX_MODEL || inventory.models[0];
  console.log("Packaged daemon using " + model);
  const originA = "https://codex-release-a.invalid", originB = "https://codex-release-b.invalid";
  const events = [];
  let a = await connect(originA, model, event => events.push(event));
  const b = await connect(originB, model);
  pass("packaged daemon discovers Codex and completes the model-selection consent round trip");
  const capabilities = await within(a.request("claude_capabilities"), "app model discovery");
  const info = capabilities.modelInfo.find(m => m.id === model);
  assert.equal(info.backend, "codex");
  assert.deepEqual(info.capabilities, { vision: true, agentic: true, warmSessions: true });
  assert.equal(info.toolSource, "broker-mcp");
  assert.equal(capabilities.defaultModel, model);
  assert.equal(capabilities.sessionModelPinning, true);
  writeFileSync(join(stateDir, "models.json"), JSON.stringify({ disabled: [model] }));
  await waitFor("model disable notification", () => events.some(e => e.event === "capabilitiesChanged"));
  const disabled = await within(a.request("claude_capabilities"), "disabled model discovery");
  assert.ok(!disabled.models.includes(model));
  assert.equal(disabled.defaultModel, undefined);
  assert.deepEqual((await a.request("claude_permissions")).models, [model]);
  assert.equal((await a.control("setModelOverride", { origin: originA, model })).ok, false);
  const eventCount = events.filter(e => e.event === "capabilitiesChanged").length;
  writeFileSync(join(stateDir, "models.json"), JSON.stringify({ disabled: [] }));
  await waitFor("model restore notification", () => events.filter(e => e.event === "capabilitiesChanged").length > eventCount);
  assert.equal((await a.request("claude_capabilities")).defaultModel, model);
  pass("open apps discover model features and receive preference changes without widening grants");
  const common = { model: "sonnet", sessionId: "release-session" };
  const first = await within(Promise.all([
    a.request("claude_complete", { ...common, prompt: "Remember our marker is OCEAN_612. Reply only STORED." }),
    b.request("claude_complete", { ...common, prompt: "Remember our marker is FOREST_934. Reply only STORED." }),
  ]), "parallel app turns");
  assert.ok(first.every(result => result.model === model));
  const threadA = storedThread(originA), threadB = storedThread(originB);
  assert.ok(threadA && threadB && threadA !== threadB);
  pass("two apps run in parallel with separate warm threads and legacy model translation");

  let streamed = "";
  const stream = await within(a.stream({ ...common, prompt: "What is our marker? Reply only with the exact marker." },
    delta => { if (delta.type === "text") streamed += delta.text; }), "streamed continuation");
  assert.match(stream.text, /OCEAN_612/); assert.equal(streamed, stream.text);
  assert.ok(stream.usage?.inputTokens > 0 && stream.usage?.outputTokens > 0);
  const other = await within(b.request("claude_complete", { ...common, prompt: "What is our marker? Reply only with the exact marker." }), "second app recall");
  assert.match(other.text, /FOREST_934/); assert.doesNotMatch(other.text, /OCEAN_612/);
  pass("streaming delivers text and usage while warm memory remains isolated by app");

  await stop(); await start(); a = await connect(originA, model);
  const resumed = await within(a.request("claude_complete", { ...common, prompt: "What is our marker? Reply only with the exact marker." }), "restart recovery");
  assert.match(resumed.text, /OCEAN_612/); assert.equal(storedThread(originA), threadA);
  assert.equal(statSync(join(stateDir, "codex-sessions.json")).mode & 0o777, 0o600);
  assert.equal(statSync(join(stateDir, "session-models.json")).mode & 0o777, 0o600);
  pass("daemon restart resumes the original thread with private session files");

  const vision = await within(a.request("claude_complete", { model: "sonnet",
    prompt: "What is the dominant color of this image? Reply with one color word.",
    attachments: [{ dataUrl: redPng(), handle: "color", filename: "synthetic-color.png", contentType: "image/png" }],
  }), "image input");
  assert.match(vision.text, /red/i);
  pass("image attachments reach Codex vision");

  await within(a.request("claude_session", { op: "end", sessionId: common.sessionId }), "end conversation");
  await within(a.request("claude_complete", { ...common, prompt: "Reply only FRESH." }), "fresh conversation");
  assert.ok(storedThread(originA) && storedThread(originA) !== threadA);
  pass("ending a conversation creates a fresh Codex thread on the next request");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ model, checks, passed: true }, null, 2), { mode: 0o600 });
  console.log("Report: " + join(directory, "result.json"));
} finally { await stop(); }
