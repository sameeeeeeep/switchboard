import { WebSocketServer, type WebSocket } from "ws";
import { resolveAppToken } from "../config.js";
import { nativePrincipal } from "@relay/protocol";

/**
 * The NATIVE listener — a SECOND loopback WS, fully separate from the extension's Broker socket
 * (the Team Mode precedent). It serves DIRECT-principal clients: local apps that talk to the daemon
 * without a browser, so there is no origin oracle to vouch for them.
 *
 * Two hard rules, stricter than the extension socket:
 *   1. Bind 127.0.0.1 only, and reject ANY connection that carries an Origin header — a browser
 *      always sends one on a WS handshake, so this shuts out web pages reaching the native port.
 *      A native process sends no Origin.
 *   2. Authenticate with a PER-APP token (never the extension's pairing token). The token maps to
 *      exactly one app id; the daemon derives the principal from the token and IGNORES any id the
 *      app claims — so a native app can only ever act as itself and can never forge a web origin or
 *      another app's identity.
 *
 * Everything past the principal stamp goes through the SAME grant/budget/gate/audit machinery as
 * web requests, via the injected handler — this listener adds a door, not a new security model.
 */
export interface NativeHandler {
  /** Dispatch a request already stamped with its verified native principal. Implemented by the
   *  Broker over a small allowlist of native-safe verbs. */
  handleNativeRequest(principal: string, method: string, params: unknown): Promise<unknown>;
  /** Interactive "Allow this app": an UNregistered app asked to connect. Pushes a consent prompt to
   *  the panel; on approval mints the app's per-app token + grant and returns it. null = denied. */
  requestNativeConnect(appId: string, reason?: string, name?: string): Promise<{ token: string; models: string[] } | null>;
  subscribeNativeEvents?(principal: string, send: (event: unknown) => void): () => void;
}

interface NativeMsg { type?: string; id?: string; token?: string; method?: string; params?: unknown; appId?: string; reason?: string; name?: string }

export class NativeListener {
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly host: "127.0.0.1",
    private readonly port: number,
    private readonly handler: NativeHandler,
  ) {}

  start() {
    this.wss = new WebSocketServer({ host: this.host, port: this.port });
    // A ws 'error' with no listener is an uncaught exception that kills the daemon — handle at both levels.
    this.wss.on("error", (err) => console.error("[relay:native] wss error:", String(err).slice(0, 160)));
    this.wss.on("connection", (ws, req) => {
      ws.on("error", (err) => console.error("[relay:native] ws error:", String(err).slice(0, 120)));
      // Rule 1: a real browser always sends Origin on a WS handshake — reject it outright.
      if (req.headers["origin"]) { ws.close(1008, "forbidden origin"); return; }
      // Rule 2: per-app token auth as the first message; the daemon derives the principal from it.
      let principal: string | null = null;
      let authenticatedToken = "";
      let authenticating = false;
      let unsubscribe: (() => void) | undefined;
      const validToken = () => {
        const appId = resolveAppToken(authenticatedToken);
        return !!appId && nativePrincipal(appId) === principal;
      };
      const subscribe = () => {
        if (!principal) return;
        unsubscribe = this.handler.subscribeNativeEvents?.(principal, (event) => {
          if (!validToken()) { ws.close(1008, "authorization revoked"); return; }
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
        });
      };
      ws.on("close", () => unsubscribe?.());
      ws.on("message", async (data) => {
        let msg: NativeMsg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (!principal) {
          if (authenticating) return;
          // Path A: a registered app presents its per-app token.
          if (msg?.type === "auth" && typeof msg.token === "string") {
            const appId = resolveAppToken(msg.token);
            if (appId) { principal = nativePrincipal(appId); authenticatedToken = msg.token; subscribe(); ws.send(JSON.stringify({ type: "auth_ok", appId })); }
            else ws.close(1008, "unauthorized");
            return;
          }
          // Path B: an UNregistered app asks to connect → interactive "Allow this app" consent. The
          // daemon derives the principal from the claimed appId (validated) and asks the human; on
          // approval it mints the token and hands it back for the app to store.
          if (msg?.type === "requestConnect" && typeof msg.appId === "string") {
            const appId = msg.appId;
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(appId)) { ws.close(1008, "bad appId"); return; }
            const reason = typeof msg.reason === "string" ? msg.reason.slice(0, 200) : undefined;
            const name = typeof msg.name === "string" ? msg.name.slice(0, 80) : undefined;
            authenticating = true;
            let res: { token: string; models: string[] } | null = null;
            try { res = await this.handler.requestNativeConnect(appId, reason, name); } catch { res = null; }
            if (ws.readyState !== ws.OPEN) return;
            if (res) { principal = nativePrincipal(appId); authenticatedToken = res.token; subscribe(); ws.send(JSON.stringify({ type: "registered", appId, token: res.token, models: res.models })); }
            else ws.close(1008, "denied");
            return;
          }
          ws.close(1008, "unauthorized");
          return;
        }
        if (!validToken()) { ws.close(1008, "authorization revoked"); return; }
        if (msg?.type === "request" && typeof msg.method === "string") {
          const id = msg.id;
          try {
            const result = await this.handler.handleNativeRequest(principal, msg.method, msg.params);
            ws.send(JSON.stringify({ type: "response", id, result }));
          } catch (err) {
            const e = err as { code?: string; message?: string };
            ws.send(JSON.stringify({ type: "response", id, error: { code: e?.code || "BACKEND_ERROR", message: e?.message || "internal error" } }));
          }
        }
      });
    });
    console.error(`[relay:native] listening on ws://${this.host}:${this.port} (per-app-token)`);
  }

  stop() { try { for (const ws of this.wss?.clients ?? []) ws.terminate(); this.wss?.close(); } catch { /* ignore */ } this.wss = null; }
}
