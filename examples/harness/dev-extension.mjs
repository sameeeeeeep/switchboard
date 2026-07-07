/**
 * dev-extension — a headless stand-in for the browser extension, for TRYING apps without loading
 * the MV3 extension in Chrome. It does exactly what the real extension does: connects to the
 * daemon over the loopback WS with the pairing token, stamps a (here: caller-supplied) origin on
 * every request, relays consent prompts to a callback, and exposes request/stream/control.
 *
 * The real extension derives the origin from the browser; here the caller passes it, since there's
 * no browser. Everything else — the daemon, the gate, the model, the MCP tools, the consent
 * round-trip — is the real thing.
 */
import { WebSocket } from "ws";

export function connectAsExtension({ port, token, origin, onConsent }) {
  return new Promise((resolveConn, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); // no Origin header ⇒ accepted as extension
    const pending = new Map();          // request/control id → resolver
    const streams = new Map();          // streamId → { onDelta }

    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
    ws.on("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case "auth_ok": resolveConn(api); break;
        case "response": pending.get(msg.id)?.(msg); pending.delete(msg.id); break;
        case "control_result": pending.get(msg.id)?.(msg.result); pending.delete(msg.id); break;
        case "event":
          if (msg.event === "delta") streams.get(msg.payload.streamId)?.(msg.payload);
          break;
        case "prompt": {
          // A consent prompt from the daemon — connect scope or a per-action write. Ask the
          // caller's handler (a human in a real UI; here a policy fn) and reply.
          Promise.resolve(onConsent(msg.kind, msg.body)).then((result) =>
            ws.send(JSON.stringify({ type: "reply", id: msg.id, result })));
          break;
        }
      }
    });

    const rpc = (obj) => new Promise((res) => { const id = crypto.randomUUID(); pending.set(id, res); ws.send(JSON.stringify({ ...obj, id })); });

    const api = {
      request: (method, params) => rpc({ type: "request", origin, method, params, sentAt: Date.now() }).then((m) => { if (m.error) throw Object.assign(new Error(m.error.message), m.error); return m.result; }),
      control: (action, args) => rpc({ type: "control", action, args }),
      /** Stream a completion; calls onDelta for each delta; resolves the final result on 'done'. */
      stream: (params, onDelta) => new Promise(async (res, rej) => {
        const { streamId } = await api.request("claude_stream", params);
        streams.set(streamId, (d) => {
          onDelta?.(d);
          if (d.type === "done") { streams.delete(streamId); res(d.result); }
          else if (d.type === "error") { streams.delete(streamId); rej(Object.assign(new Error(d.error.message), d.error)); }
        });
      }),
      close: () => ws.close(),
    };
  });
}
