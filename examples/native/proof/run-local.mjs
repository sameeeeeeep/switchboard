/** Standalone native + web proof against real Ollama, Whisper and macOS speech.
 * Isolates all Switchboard state and uses synthetic inputs. Does not alter the Mac app bundle.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { connectAsExtension } from "../../harness/dev-extension.mjs";

const model = process.env.SWITCHBOARD_TEST_MODEL || "llama3.2:1b";
const whisper = process.env.RELAY_WHISPER_BIN;
const whisperModel = process.env.RELAY_WHISPER_MODEL;
assert.ok(whisper && existsSync(whisper), "Set RELAY_WHISPER_BIN to an installed whisper-cli binary");
assert.ok(whisperModel && existsSync(whisperModel), "Set RELAY_WHISPER_MODEL to an installed ggml model");
assert.equal(process.platform, "darwin", "This proof uses Swift Foundation and macOS say");
const directory = mkdtempSync(join(tmpdir(), "switchboard-native-local-"));
const stateDir = join(directory, "state");
mkdirSync(stateDir, { mode: 0o700 });
writeFileSync(join(stateDir, "mcp.json"), JSON.stringify({ servers: {} }));
writeFileSync(join(stateDir, "routines-control.json"), JSON.stringify({ off: true }));
function setModels(disabled) { writeFileSync(join(stateDir, "models.json"), JSON.stringify({ disabled, defaultModel: model })); }
setModels([]);
const bundle = join(directory, "sidekick.mjs");
const executable = join(directory, "voicepad");
const tokenFile = join(directory, "native-token");
const contextFile = join(directory, "context.json");
const appId = "dev.switchboard.standalone-voice-test";
const origin = "https://native-voice-web-test.invalid";
const principal = "native@" + appId;
const checks = [];
let daemon, swift, compiler, controller;
const sockets = [];
function pass(message) { checks.push(message); console.log("PASS " + message); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function within(promise, label, ms = 90000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function waitFor(label, read, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (daemon && daemon.exitCode !== null) throw new Error("Daemon exited during " + label);
    try { const value = await read(); if (value) return value; } catch { /* boot or preference refresh */ }
    await pause(150);
  }
  throw new Error(label + " timed out");
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function finished(child, label, ms = 90000) {
  let stderr = "";
  child.stderr?.on("data", data => { stderr = (stderr + data.toString()).slice(-6000); });
  const code = await within(new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }), label, ms);
  assert.equal(code, 0, label + " failed: " + stderr);
}
function nativeSocket(url, options) {
  const ws = new WebSocket(url, options);
  sockets.push(ws);
  const frames = [];
  let closed = false;
  const closedWith = new Promise(resolve => ws.once("close", code => { closed = true; resolve(code); }));
  ws.on("message", data => frames.push(JSON.parse(data.toString())));
  const opened = new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return {
    ws, opened, closedWith,
    async next(type, id) {
      return waitFor("native " + type, () => {
        const index = frames.findIndex(frame => frame.type === type && (!id || frame.id === id));
        if (index >= 0) return frames.splice(index, 1)[0];
        if (closed) throw new Error("Native connection closed before response");
        return null;
      }, 10000);
    },
    send(message) { ws.send(JSON.stringify(message)); },
  };
}

try {
  await build({
    entryPoints: [fileURLToPath(new URL("../../../packages/sidekick/dist/index.js", import.meta.url))],
    bundle: true, platform: "node", format: "esm", target: "node18", external: ["bufferutil", "utf-8-validate"],
    banner: { js: "import { createRequire as __relayCreateRequire } from 'node:module'; const require = __relayCreateRequire(import.meta.url);" },
    outfile: bundle, logLevel: "silent",
  });
  compiler = spawn("swiftc", ["-parse-as-library", "-module-cache-path", process.env.SWITCHBOARD_TEST_SWIFT_CACHE || join(directory, "swift-cache"),
    fileURLToPath(new URL("../VoicepadSmoke.swift", import.meta.url)), "-o", executable], { stdio: ["ignore", "ignore", "pipe"] });
  await finished(compiler, "Standalone Swift compilation", 240000);
  const port = await freePort(), nativePort = await freePort();
  assert.notEqual(port, nativePort);
  const nativeUrl = `ws://127.0.0.1:${nativePort}`;
  const log = openSync(join(directory, "daemon.log"), "a", 0o600);
  daemon = spawn(process.execPath, [bundle], {
    env: { ...process.env, RELAY_DIR: stateDir, RELAY_HOME: stateDir, RELAY_PORT: String(port),
      RELAY_NATIVE_PORT: String(nativePort), RELAY_NATIVE: "1", RELAY_CODEX: "0", RELAY_BACKEND: "",
      RELAY_IMPORT_CLAUDE: "0", RELAY_LOCAL_OPENAI: "1", RELAY_LOCAL_OPENAI_URL: "http://127.0.0.1:11434/v1",
      RELAY_OPENROUTER_KEY: "", RELAY_TEAM: "0", RELAY_USER: "Native local test",
      RELAY_WHISPER_BIN: whisper, RELAY_WHISPER_MODEL: whisperModel,
      RELAY_LOCAL_STT_URL: "", RELAY_STT_CMD: "", RELAY_LOCAL_TTS_URL: "" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  await waitFor("local model discovery", () => {
    const status = JSON.parse(readFileSync(join(stateDir, "status.json"), "utf8"));
    return status.modelProviders?.some(provider => provider.online && provider.models.includes(model));
  });
  const pairingToken = readFileSync(join(stateDir, "pairing-token"), "utf8").trim();
  controller = await within(connectAsExtension({ port, token: pairingToken, origin,
    onConsent: (kind, body) => {
      if (kind === "consent:native-connect") return body.appId === appId;
      if (kind === "consent:connect" && body.origin === origin)
        return { models: [model], modelOverride: model, tools: [], budgets: { maxCallsPerMin: 100 } };
      if (kind === "consent:context-pick" && body.origin === origin && existsSync(contextFile))
        return { contextId: JSON.parse(readFileSync(contextFile, "utf8")).id };
      return false;
    },
  }), "Synthetic consent surface", 15000);
  swift = spawn(executable, [], {
    env: { ...process.env, SWITCHBOARD_TEST_NATIVE_URL: nativeUrl, SWITCHBOARD_TEST_MODEL: model,
      SWITCHBOARD_TEST_TOKEN_FILE: tokenFile, SWITCHBOARD_TEST_CONTEXT_FILE: contextFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  swift.stdout.on("data", data => {
    output += data.toString();
    while (output.includes("\n")) {
      const index = output.indexOf("\n"), line = output.slice(0, index); output = output.slice(index + 1);
      if (line.startsWith("PASS ")) pass(line.slice(5));
      if (line === "READY_FOR_MODEL_CHANGE") setModels([model]);
    }
  });
  await finished(swift, "Standalone Swift client", 180000);
  setModels([]);
  await waitFor("restored local model", async () => (await controller.request("claude_capabilities")).models.includes(model));
  await within(controller.request("claude_connect", { models: [model], tools: [], reason: "Synthetic web/native interoperability test" }), "Web consent");
  const webCaps = await controller.request("claude_capabilities");
  assert.equal(webCaps.local.stt, true);
  assert.equal(webCaps.local.tts, true);
  const localInfo = webCaps.modelInfo.find(info => info.id === model);
  assert.deepEqual(localInfo.capabilities, { vision: false, agentic: false, warmSessions: false });
  assert.equal(localInfo.toolSource, "none");
  const webText = await within(controller.request("claude_complete", { model, prompt: "The launch moves to Friday. Write one short sentence confirming the new day.", maxTokens: 64 }), "Web local completion");
  assert.equal(webText.model, model);
  assert.ok(webText.text.trim() && webText.usage.outputTokens > 0, "Expected generated text and usage from the local model");
  pass("web transport discovers local capabilities and runs the same real Ollama model");
  assert.equal((await controller.request("claude_storage", { op: "get", key: "private-note" })).value, null);
  const contextId = JSON.parse(readFileSync(contextFile, "utf8")).id;
  assert.ok(!(await controller.request("claude_context", { op: "list" })).contexts.some(context => context.id === contextId));
  assert.equal((await controller.request("claude_context", { op: "use", id: contextId })).ok, false);
  const picked = await within(controller.request("claude_context", { op: "pick" }), "Context lending consent");
  assert.equal(picked.context.id, contextId);
  assert.equal(picked.context.data.marker, "SHARED_WITH_CONSENT_824");
  pass("native private data stays isolated; the web app reads shared context only after consent");

  const token = readFileSync(tokenFile, "utf8");
  const native = nativeSocket(nativeUrl);
  await within(native.opened, "Native reconnect", 10000);
  native.send({ type: "auth", token, appId: "another.app" });
  assert.equal((await native.next("auth_ok")).appId, appId);
  native.send({ type: "request", id: "identity", method: "claude_permissions", origin, appId: "another.app" });
  assert.equal((await native.next("response", "identity")).result.origin, principal);
  assert.equal((await controller.control("disconnectNativeApp", { appId })).ok, true);
  native.send({ type: "request", id: "revoked", method: "claude_capabilities" });
  assert.equal(await within(native.closedWith, "Live token revocation", 10000), 1008);
  const oldToken = nativeSocket(nativeUrl);
  await oldToken.opened; oldToken.send({ type: "auth", token });
  assert.equal(await within(oldToken.closedWith, "Revoked token reconnect", 10000), 1008);
  const browser = nativeSocket(nativeUrl, { origin });
  await browser.opened;
  assert.equal(await within(browser.closedWith, "Browser-origin rejection", 10000), 1008);
  pass("native identity resists forged origins; revocation closes existing access; browser Origins are rejected");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ passed: true, model, checks, tts: "macos-say", stt: "whisper-cli" }, null, 2), { mode: 0o600 });
  console.log("Report: " + join(directory, "result.json"));
} finally {
  sockets.forEach(socket => socket.terminate());
  controller?.close();
  for (const child of [compiler, swift, daemon]) {
    if (child && child.exitCode === null) {
      const exit = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await exit; } finally { clearTimeout(force); }
    }
  }
}
