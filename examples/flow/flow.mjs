#!/usr/bin/env node
/**
 * Flow — a Wispr-Flow-style dictation app, built as a NATIVE (no-browser) client of the Switchboard
 * daemon. It proves the "beyond web apps" path end to end:
 *
 *     mic  ──▶  daemon `claude_transcribe`  ──▶  daemon `claude_complete` (cleanup)  ──▶  your cursor
 *              (local whisper, on-device)        (your own Claude, gated)               (paste)
 *
 * Flow is a thin SHELL. It ships no AI, no key, no model — it borrows the user's, through the
 * gateway, as its own least-privilege principal `native@ai.thelastprompt.flow`. Setup registers the
 * app once (the privileged consent step); every run after that uses only the per-app token.
 *
 * Commands:
 *   node flow.mjs demo ["some text to speak"]   # no mic: macOS `say` → the full pipeline → prints
 *   node flow.mjs run                           # push-to-talk mic → pipeline → pastes at cursor
 *   node flow.mjs setup                          # register + start the daemon, then exit
 *
 * For a self-contained demo Flow manages its OWN daemon instance (own RELAY_DIR + ports), so it
 * never touches your real ~/.relay. In production it would attach to the menubar daemon instead.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const DAEMON = resolve(REPO, "packages/sidekick/dist/index.js");
const STT_ADAPTER = resolve(__dirname, "whisper-stt.mjs");

const APP_ID = "ai.thelastprompt.flow";
const FLOW_HOME = process.env.FLOW_HOME || join(homedir(), ".flow");
const RELAY_DIR = join(FLOW_HOME, "relay");          // Flow's private daemon state
const TOKEN_FILE = join(FLOW_HOME, "token.json");    // the per-app token + granted models
const PORT = Number(process.env.FLOW_PORT || 8795);
const NATIVE_PORT = Number(process.env.FLOW_NATIVE_PORT || 8796);
const MIC = process.env.FLOW_MIC || ":0";            // avfoundation audio device (":0" = default)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("\x1b[2m[flow]\x1b[0m", ...a);

const CLEANUP_SYSTEM =
  "You are a dictation cleanup engine. Rewrite the user's raw speech transcript into clean, " +
  "well-punctuated prose. Remove filler words (um, uh, like, you know), fix obvious recognition " +
  "errors and capitalization, and keep the original meaning and wording as much as possible. " +
  "Output ONLY the cleaned text — no preamble, no quotes, no commentary.";

const isLocalModel = (m) => m.includes(":") || m.includes("/");
const modelSizeB = (m) => { const x = /(\d+(?:\.\d+)?)\s*b\b/i.exec(m); return x ? parseFloat(x[1]) : NaN; };
// Pick the cleanup model. Cleanup must FOLLOW the rewrite instruction; tiny (≤2B) local models
// hallucinate on it (a 1B rewrote "ship the flow thing" into "buy a boat"). So: honor an explicit
// FLOW_CLEANUP_MODEL; else the smallest LOCAL model ≥3B (fast AND faithful); else Claude (better
// than an unreliable tiny local); else, only if that's all there is, the biggest local we have.
function pickCleanupModel(models) {
  const want = process.env.FLOW_CLEANUP_MODEL;
  if (want && models.includes(want)) return want;
  const locals = models.filter(isLocalModel);
  const capable = locals.filter((m) => modelSizeB(m) >= 3).sort((a, b) => modelSizeB(a) - modelSizeB(b));
  if (capable.length) return capable[0];
  const claude = models.find((m) => !isLocalModel(m));
  if (claude) return claude;
  return locals.sort((a, b) => (modelSizeB(b) || 0) - (modelSizeB(a) || 0))[0] || models[0];
}

// ── daemon lifecycle ─────────────────────────────────────────────────────────────────────────
let daemonProc = null;
async function ensureDaemon() {
  mkdirSync(RELAY_DIR, { recursive: true });
  // Already up? (a prior `flow setup` or another run)
  if (await portOpen(NATIVE_PORT)) { log(`daemon already up on :${PORT}/:${NATIVE_PORT}`); return readPairingToken(); }
  log("starting Flow's private daemon…");
  daemonProc = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      RELAY_DIR, RELAY_PORT: String(PORT),
      RELAY_NATIVE: "1", RELAY_NATIVE_PORT: String(NATIVE_PORT),
      RELAY_STT_CMD: `${process.execPath} ${STT_ADAPTER}`,
      // Expose local models (Ollama/LM Studio) so cleanup can run 100% on-device.
      RELAY_LOCAL_OPENAI_URL: process.env.FLOW_LOCAL_OPENAI_URL || "http://127.0.0.1:11434/v1",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  daemonProc.on("exit", (c) => { if (c) log(`daemon exited (${c})`); });
  process.on("exit", () => { try { daemonProc?.kill("SIGKILL"); } catch { /* gone */ } });
  const token = await waitFor(() => readPairingToken(), "pairing token");
  await waitFor(async () => (await portOpen(NATIVE_PORT)) || null, "native listener");
  return token;
}
function readPairingToken() { const f = join(RELAY_DIR, "pairing-token"); return existsSync(f) ? readFileSync(f, "utf8").trim() : null; }
function portOpen(port) {
  return new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}`); const done = (v) => { try { ws.terminate(); } catch {} res(v); }; ws.on("open", () => done(true)); ws.on("error", () => done(false)); });
}
async function waitFor(fn, what, ms = 25_000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(200); }
}

// ── sockets ──────────────────────────────────────────────────────────────────────────────────
/** Extension/control socket (pairing token) — used ONLY at setup to register the app. */
function connectControl(pairingToken) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const pending = new Map();
    ws.on("close", () => rej(new Error("control socket closed before auth")));
    ws.on("error", rej);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: pairingToken })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === "auth_ok") return res({ control, close: () => ws.close() });
      if (m.type === "control_result" && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    });
    const control = (action, args) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "control", action, args, id })); });
  });
}

/** Native socket (per-app token) — the app's real, least-privilege channel. */
function connectNative(appToken) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${NATIVE_PORT}`);
    const pending = new Map();
    ws.on("close", () => rej(new Error("native socket closed before auth (token revoked?)")));
    ws.on("error", rej);
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: appToken })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === "auth_ok") return res({ request, close: () => ws.close() });
      if (m.type === "response" && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const request = (method, params) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "request", method, params, id })); });
  });
}

// ── setup (the privileged consent step) ────────────────────────────────────────────────────────
async function setup(pairingToken) {
  if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  log("registering Flow with the daemon (one-time consent)…");
  const { control, close } = await connectControl(pairingToken);
  const reg = await control("registerNativeApp", { appId: APP_ID });
  close();
  if (!reg?.token) throw new Error("registration failed");
  mkdirSync(FLOW_HOME, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(reg, null, 2), { mode: 0o600 });
  log(`registered as ${reg.principal} · models: ${reg.models?.join(", ") || "(none online)"}`);
  return reg;
}

// ── the pipeline ────────────────────────────────────────────────────────────────────────────
function wavToDataUrl(path) { return `data:audio/wav;base64,${readFileSync(path).toString("base64")}`; }

async function pipeline(reg, wavPath) {
  const { request, close } = await connectNative(reg.token);
  try {
    const t0 = Date.now();
    const trx = await request("claude_transcribe", { audio: wavToDataUrl(wavPath), language: "en" });
    if (trx.error) throw new Error(`transcribe: ${trx.error.message}`);
    const raw = (trx.result?.text || "").trim();
    log(`transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s via ${trx.result?.backend}`);

    let clean = raw;
    const model = pickCleanupModel(reg.models || []);
    if (raw && model) {
      log(`cleaning up via ${model}${isLocalModel(model) ? " (on-device)" : ""}…`);
      const cmp = await request("claude_complete", { model, system: CLEANUP_SYSTEM, prompt: raw, maxTokens: 500 });
      if (cmp.error) log(`cleanup unavailable (${cmp.error.message}) — using raw transcript`);
      else if (cmp.result?.text) clean = cmp.result.text.trim();
    }
    return { raw, clean, model };
  } finally { close(); }
}

// ── mic capture (push-to-talk) ──────────────────────────────────────────────────────────────
async function record() {
  const out = join(mkdtempSync(join(tmpdir(), "flow-rec-")), "rec.wav");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((r) => rl.question("\n🎙  Press ENTER to start recording…", () => r()));
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", MIC, "-ar", "16000", "-ac", "1", "-y", out], { stdio: ["pipe", "ignore", "inherit"] });
  process.stdout.write("🔴 recording… speak now, then press ENTER to stop.");
  await new Promise((r) => rl.question("", () => r()));
  ff.stdin.write("q"); // graceful stop → flushes a valid wav
  await new Promise((r) => ff.on("close", r));
  rl.close();
  return out;
}

// ── insert at cursor ──────────────────────────────────────────────────────────────────────────
function insertAtCursor(text) {
  spawnSync("pbcopy", [], { input: text }); // always land it on the clipboard
  // Best-effort auto-paste into the frontmost app (needs Accessibility permission for the terminal).
  const r = spawnSync("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
  return r.status === 0;
}

// ── commands ──────────────────────────────────────────────────────────────────────────────────
async function main() {
  const cmd = process.argv[2] || "demo";
  const pairing = await ensureDaemon();
  const reg = await setup(pairing);

  if (cmd === "setup") { log("ready."); return; }

  if (cmd === "demo") {
    const text = process.argv.slice(3).join(" ") || "um so basically i think the the plan is to ship this on friday you know and uh tell the team";
    log(`speaking sample with macOS \`say\`: "${text}"`);
    const dir = mkdtempSync(join(tmpdir(), "flow-demo-"));
    const aiff = join(dir, "s.aiff"), wav = join(dir, "s.wav");
    spawnSync("say", [text, "-o", aiff]);
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", aiff, "-ar", "16000", "-ac", "1", wav]);
    const { raw, clean, model } = await pipeline(reg, wav);
    print(raw, clean, model);
    return;
  }

  if (cmd === "run") {
    const wav = await record();
    const { raw, clean, model } = await pipeline(reg, wav);
    const pasted = insertAtCursor(clean);
    print(raw, clean, model);
    log(pasted ? "✍️  pasted at your cursor." : "📋 copied to clipboard (grant Accessibility to auto-paste).");
    return;
  }

  console.error(`unknown command: ${cmd}\nusage: flow.mjs [demo|run|setup]`);
  process.exit(2);
}

function print(raw, clean, model) {
  console.log("\n\x1b[2m── raw transcript ──\x1b[0m");
  console.log(raw || "(nothing recognized)");
  const via = model ? (isLocalModel(model) ? `on-device · ${model}` : `Claude · ${model}`) : "no cleanup";
  console.log(`\n\x1b[1m── cleaned (${via}) ──\x1b[0m`);
  console.log(clean || "(no cleanup)");
  console.log();
}

main().then(() => { daemonProc?.kill("SIGKILL"); process.exit(0); })
  .catch((e) => { console.error("\n❌", e.message); daemonProc?.kill("SIGKILL"); process.exit(1); });
