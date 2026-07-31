// DAEMON sb — the real capability surface, bridged over the daemon's WebSocket. This is the whole
// point of the connector: the wrapp's orchestration runs on the USER'S OWN Claude, gated by the
// SAME broker the browser uses. It is a second client of the broker, not a new engine.
//
// The wire (packages/sidekick/src/server.ts):
//   • bind ws://127.0.0.1:8787 (RELAY_PORT / RELAY_WS override), loopback only.
//   • Rule 1: connections with a browser-ish Origin header are rejected. Node's `ws` sends NO
//     Origin header ⇒ we pass as an "extension-class" client. (We are one: a paired local client.)
//   • Rule 2: first message must be { type:"auth", token }. The token lives at ~/.relay/pairing-token
//     (0600) — the same secret the extension pairs with. No token ⇒ we can't authenticate ⇒ mock only.
//   • request/response: { type:"request", id, origin, method, params, sentAt } → { type:"response", id, result, error }.
//     `origin` is the authoritative isolation key; the daemon uses IT, never trusting our claim to be safe.
//   • stream: claude_stream returns { streamId }; deltas arrive as { type:"event", event:"delta", payload:{ streamId, ...delta } }.
//
// THE MOAT, PRESERVED. Consent is a human click the model can never satisfy. In the browser the
// extension shows it; for this CLI path the proper surface is the menubar tray (WRAPPS-FOR-AGENTS §3),
// which isn't wired yet. So this client is deliberately conservative:
//   1. It PRE-FLIGHTS the grant (claude_permissions) and refuses to run an action whose origin isn't
//      already authorized — telling the user to connect the wrapp in Switchboard first. Fail-closed.
//   2. Actions in this pilot are NON-AGENTIC (no tools), so an in-scope completion raises ZERO
//      consent prompts. If a stray { type:"prompt" } arrives anyway (we happened to be extensions[0]
//      during unrelated browser activity), we do NOT answer it — never auto-approving, and never
//      denying a consent the user is trying to approve in their browser. It stays in the daemon's
//      durable queue and re-pushes to the extension. We also keep the connection SHORT-LIVED
//      (connect → run one action → close) to shrink that window to almost nothing.
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const RELAY_DIR = process.env.RELAY_DIR || join(homedir(), ".relay");
const WS_URL = process.env.RELAY_WS || `ws://127.0.0.1:${process.env.RELAY_PORT || 8787}`;

export function readPairingToken() {
  try { return readFileSync(join(RELAY_DIR, "pairing-token"), "utf8").trim() || null; }
  catch { return null; }
}

/** True when a token exists AND the daemon accepts an authenticated socket. Cheap probe used to
 *  decide mode (daemon vs mock). Never throws. */
export async function daemonAvailable(timeoutMs = 1200) {
  const token = readPairingToken();
  if (!token) return false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { ws.close(); } catch {} resolve(v); } };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    let ws;
    try { ws = new WebSocket(WS_URL); } catch { return finish(false); }
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("message", (d) => { try { if (JSON.parse(d.toString())?.type === "auth_ok") { clearTimeout(timer); finish(true); } } catch {} });
    ws.on("error", () => finish(false));
    ws.on("close", () => finish(false));
  });
}

class DaemonConnection {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();   // request id -> { resolve, reject }
    this.streams = new Map();   // streamId -> { push, close }
    this.strayPrompts = 0;
    ws.on("message", (data) => this._onMessage(data));
    ws.on("close", () => { for (const p of this.pending.values()) p.reject(new Error("daemon connection closed")); this.pending.clear(); for (const s of this.streams.values()) s.close(new Error("daemon connection closed")); this.streams.clear(); });
  }

  _onMessage(data) {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg?.type === "pong" || msg?.type === "ping") return;
    if (msg?.type === "response" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "daemon error"), { code: msg.error.code }));
      else p.resolve(msg.result);
      return;
    }
    if (msg?.type === "event" && msg.event === "delta" && msg.payload) {
      const s = this.streams.get(msg.payload.streamId);
      if (s) s.push(msg.payload);
      return;
    }
    // A consent prompt landed on us (we were extensions[0]). DO NOT answer — that click belongs to a
    // human, at the menubar/panel. Leaving it unanswered keeps it in the daemon's durable queue for
    // the extension. We only note it, so the connector can explain a stall if one ever happens.
    if (msg?.type === "prompt") { this.strayPrompts++; console.error(`[switchboard] ignoring an out-of-band consent prompt (kind=${msg.kind}) — consent is a human click, not the agent's to make`); }
  }

  request(origin, method, params) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: "request", id, origin, method, params, sentAt: Date.now() }));
    });
  }

  /** Async-iterable of StreamDelta for one claude_stream, keyed by the returned streamId. */
  async *stream(origin, params) {
    const { streamId } = await this.request(origin, "claude_stream", params);
    const queue = [];
    let notify = null, ended = false, err = null;
    this.streams.set(streamId, {
      push: (d) => { queue.push(d); if (d.type === "done" || d.type === "error") ended = true; notify?.(); },
      close: (e) => { err = e; ended = true; notify?.(); },
    });
    try {
      while (true) {
        if (queue.length) { yield queue.shift(); continue; }
        if (err) throw err;
        if (ended) break;
        await new Promise((r) => (notify = r)); notify = null;
      }
    } finally { this.streams.delete(streamId); }
  }

  close() { try { this.ws.close(); } catch {} }
}

/** Open an authenticated, short-lived daemon connection, run `fn(conn)`, then close. */
export async function withDaemon(fn) {
  const token = readPairingToken();
  if (!token) throw new Error("no pairing token at ~/.relay/pairing-token — is the Switchboard daemon set up on this machine?");
  const ws = new WebSocket(WS_URL); // no Origin header ⇒ passes the daemon's extension-only Rule 1
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`daemon not reachable at ${WS_URL}`)), 4000);
    ws.once("open", () => { clearTimeout(timer); resolve(); });
    ws.once("error", (e) => { clearTimeout(timer); reject(e); });
  });
  await new Promise((resolve, reject) => {
    const onMsg = (d) => { try { const m = JSON.parse(d.toString()); if (m?.type === "auth_ok") { ws.off("message", onMsg); resolve(); } } catch {} };
    ws.on("message", onMsg);
    ws.once("close", () => reject(new Error("daemon closed the socket during auth — is the pairing token current?")));
    ws.send(JSON.stringify({ type: "auth", token }));
  });
  const conn = new DaemonConnection(ws);
  try { return await fn(conn); } finally { conn.close(); }
}

/**
 * Build the `sb` an action receives, bound to one wrapp origin and pre-flighted against its grant.
 * Throws a founder-readable error when the origin isn't authorized — the fail-closed gate for the
 * headless path until the menubar consent bridge lands.
 */
export async function daemonSbForOrigin(conn, manifest) {
  const grant = await conn.request(manifest.origin, "claude_permissions").catch(() => null);
  if (!grant) {
    throw new Error(
      `“${manifest.title || manifest.name}” isn't authorized for headless use yet. Open ${manifest.origin} in your browser and Connect Switchboard once (that grant then covers this connector), or approve it from the Switchboard menubar. The agent can't grant this itself — that click is yours.`,
    );
  }
  const wantModels = (manifest.scope && manifest.scope.models) || [];
  const haveModels = new Set((grant.models || []));
  const missing = wantModels.filter((m) => !haveModels.has(m));
  if (missing.length) {
    throw new Error(
      `The grant for “${manifest.title || manifest.name}” is missing model(s) ${missing.join(", ")} (grants are exact-match). Re-connect it in Switchboard requesting: ${wantModels.join(", ")}.`,
    );
  }
  return {
    origin: manifest.origin,
    grant,
    stream: (params) => conn.stream(manifest.origin, params),
    complete: (params) => conn.request(manifest.origin, "claude_complete", params),
    storage: {
      get: (key) => conn.request(manifest.origin, "claude_storage", { op: "get", key }).then((r) => r?.value ?? null),
      list: () => conn.request(manifest.origin, "claude_storage", { op: "list" }).then((r) => r?.keys ?? []),
    },
    context: {
      active: () => conn.request(manifest.origin, "claude_context", { op: "active" }).then((r) => r?.context ?? null),
    },
  };
}

export { WS_URL };
