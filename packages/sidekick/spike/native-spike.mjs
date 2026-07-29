/**
 * NATIVE (direct-principal) SPIKE: prove a LOCAL app — no browser, no extension — can talk to the
 * daemon over its SEPARATE native listener, be stamped as its own `native@<appId>` principal, and
 * reach the SAME gate/grant/audit machinery. Also proves the isolation rules that keep it from
 * breaking or bypassing the existing web path. Through the REAL running daemon:
 *
 *   1. native listener rejects a connection carrying an Origin header (a web page reaching the port)
 *   2. native listener rejects an UNKNOWN per-app token
 *   3. menubar control "registerNativeApp" mints a token + grant (the native connect-consent)
 *   4. app connects with its token → auth_ok, principal derived from the token (not app-claimed)
 *   5. claude_capabilities over the native socket advertises claude_transcribe
 *   6. claude_transcribe fails CLOSED with a clean BACKEND_ERROR when no local STT is installed
 *      (proves the principal→grant→gate→capability path runs even without the model present)
 *   7. a non-allowlisted verb (claude_complete) is refused for a native app (UNSUPPORTED_METHOD)
 *   8. the web pairing token is REJECTED on the native socket (the two doors don't share a key)
 *
 * Run: node packages/sidekick/spike/native-spike.mjs   (spawns the built daemon)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

const dir = mkdtempSync(join(tmpdir(), "relay-native-"));
const PORT = 8793;        // extension socket
const NATIVE_PORT = 8794; // native socket

const daemon = spawn(process.execPath, [resolve("packages/sidekick/dist/index.js")], {
  // RELAY_NATIVE=1 forces the native listener on even before any app is registered.
  env: { ...process.env, RELAY_DIR: dir, RELAY_PORT: String(PORT), RELAY_NATIVE: "1", RELAY_NATIVE_PORT: String(NATIVE_PORT) },
  stdio: ["ignore", "inherit", "inherit"],
});
process.on("exit", () => { try { daemon.kill("SIGKILL"); } catch { /* gone */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForToken() {
  const f = join(dir, "pairing-token");
  for (let i = 0; i < 40; i++) { if (existsSync(f)) return readFileSync(f, "utf8").trim(); await sleep(150); }
  throw new Error("token never appeared");
}
async function retry(fn, ms = 20_000) {
  const t0 = Date.now();
  for (;;) { try { return await fn(); } catch (err) { if (Date.now() - t0 > ms) throw err; await sleep(250); } }
}

/** Connect to the EXTENSION socket (the panel's channel): drive control actions AND auto-approve any
 *  consent prompt the daemon pushes (we stand in for the human clicking "Allow"). */
function connectExtension(token) {
  return new Promise((res, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); // no Origin ⇒ treated as extension
    const pending = new Map();
    let prompts = 0;
    ws.on("close", () => reject(new Error("ext socket closed before auth")));
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok") return res({ control, promptsSeen: () => prompts });
      if (msg.type === "control_result" && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
      if (msg.type === "prompt") { prompts++; ws.send(JSON.stringify({ type: "reply", id: msg.id, result: true })); } // approve
    });
    const control = (action, args) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "control", action, args, id })); });
  });
}

/** A native app connecting with NO token: send `requestConnect`, resolve the minted {token, models}. */
function requestNativeConnect({ appId, reason }) {
  return new Promise((res, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${NATIVE_PORT}`);
    let settled = false;
    ws.on("close", (c, r) => { if (!settled) { settled = true; reject(new Error(`closed ${c} ${r}`)); } });
    ws.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
    ws.on("open", () => ws.send(JSON.stringify({ type: "requestConnect", appId, reason })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "registered") { settled = true; res({ token: msg.token, models: msg.models }); }
    });
  });
}

/** Connect to the NATIVE socket. `origin` lets us test the origin-header rejection; `token` is the
 *  per-app secret. Resolves { authed, request } or rejects with the close reason. */
function connectNative({ token, appId, headers } = {}) {
  return new Promise((res, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${NATIVE_PORT}`, headers ? { headers } : undefined);
    const pending = new Map();
    let settled = false;
    ws.on("close", (code, reason) => { if (!settled) { settled = true; reject(new Error(`closed ${code} ${reason}`)); } });
    ws.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token, appId })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_ok") { settled = true; res({ appId: msg.appId, request }); return; }
      if (msg.type === "response" && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const request = (method, params) => new Promise((r) => { const id = crypto.randomUUID(); pending.set(id, r); ws.send(JSON.stringify({ type: "request", method, params, id })); });
  });
}

async function main() {
  const token = await waitForToken();
  const results = {};

  // (1) Origin header on the native port ⇒ rejected (a web page can't reach it).
  results.originRejected = await retry(() => connectNative({ headers: { origin: "https://evil.test" } })).then(() => false).catch(() => true);

  // (2) Unknown per-app token ⇒ rejected.
  results.unknownTokenRejected = await connectNative({ token: "not-a-real-token", appId: "com.x.y" }).then(() => false).catch(() => true);

  // (8) The web pairing token must NOT authenticate on the native socket.
  results.pairingTokenRejectedOnNative = await connectNative({ token, appId: "com.x.y" }).then(() => false).catch(() => true);

  // (3) Register the app via the menubar control channel (the out-of-band connect-consent).
  const ext = await retry(() => connectExtension(token));
  const control = ext.control;
  const reg = await control("registerNativeApp", { appId: "com.you.speechtotext" });
  results.registered = !!reg?.token && reg.principal === "native@com.you.speechtotext";

  // (4) The app connects with ITS token. Note we deliberately CLAIM a different appId to prove the
  //     daemon ignores it and derives the principal from the token.
  const app = await retry(() => connectNative({ token: reg.token, appId: "com.attacker.spoof" }));
  results.authedAsSelf = app.appId === "com.you.speechtotext";

  // (5) Capabilities over the native socket advertises transcribe.
  const caps = await app.request("claude_capabilities");
  results.transcribeAdvertised = Array.isArray(caps.result?.methods) && caps.result.methods.includes("claude_transcribe");

  // (6) Transcribe with no local STT installed ⇒ clean BACKEND_ERROR (the gate/grant path ran).
  const tiny = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  const trx = await app.request("claude_transcribe", { audio: tiny });
  results.transcribeFailsClosed = trx.error?.code === 4500; // BACKEND_ERROR (no local STT on this machine)

  // (7) A non-allowlisted verb is refused for a native app. (claude_complete IS allowed now — for
  //     transcript cleanup — so probe one that is NOT: claude_storage.)
  const forbidden = await app.request("claude_storage", { op: "list" });
  results.forbiddenVerbRefused = forbidden.error?.code === 4200; // UNSUPPORTED_METHOD

  // (9) INTERACTIVE "Allow this app": an UNREGISTERED app requests connect → the daemon pushes a
  //     consent:native-connect prompt to the panel (our ext auto-approves) → mints a token → the
  //     app authenticates with the minted token. No pairing token, no out-of-band step.
  const granted = await retry(() => requestNativeConnect({ appId: "com.you.interactive", reason: "dictation" }));
  results.interactiveMintedToken = !!granted.token && Array.isArray(granted.models);
  results.panelSawAllowPrompt = ext.promptsSeen() >= 1;
  const back = await connectNative({ token: granted.token, appId: "com.you.interactive" });
  results.mintedTokenAuthenticates = back.appId === "com.you.interactive";

  console.error("\n================ VERDICT ================");
  const want = (k, v = true) => console.error(`${k.padEnd(34)} ${results[k]}   (want ${v})`);
  want("originRejected"); want("unknownTokenRejected"); want("pairingTokenRejectedOnNative");
  want("registered"); want("authedAsSelf"); want("transcribeAdvertised");
  want("transcribeFailsClosed"); want("forbiddenVerbRefused");
  want("interactiveMintedToken"); want("panelSawAllowPrompt"); want("mintedTokenAuthenticates");
  const pass = Object.values(results).every(Boolean);
  console.error(`\n${pass ? "✅ NATIVE SPIKE PASSED — a local app reaches the gate as its own principal, isolated from the web path." : "❌ FAILED"}`);
  daemon.kill("SIGKILL");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error("NATIVE SPIKE ERROR:", err); daemon.kill("SIGKILL"); process.exit(3); });
