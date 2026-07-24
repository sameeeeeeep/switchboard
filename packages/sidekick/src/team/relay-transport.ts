import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

/**
 * The RELAY transport — the cross-network path. When a team's invite carries a `relay` URL, host
 * and members can't (or don't want to) reach each other directly, so both dial OUT to a dumb
 * store-and-forward relay (outbound connections always traverse NAT; no port-forwarding, no LAN).
 *
 * The relay only ever moves the ALREADY-SEALED application frames — it can't open one (it doesn't
 * hold the team key), stores nothing, and is a mailman, not a landlord. To keep the daemon's team
 * protocol 100% unchanged, this transport makes the relay look exactly like the direct path:
 *   • A MEMBER just points its normal dial() at the relay URL; the relay makes its socket behave
 *     byte-for-byte like a direct socket to the host, so no member code changes at all.
 *   • The HOST, instead of listening, dials the relay and receives a VIRTUAL per-member socket for
 *     each joiner — a ws-lookalike that `acceptPeer()` consumes with no idea a relay is involved.
 *
 * Relay envelope (plaintext, OUTSIDE the sealed frames): host↔relay frames are `{c, d}` /
 * `{c, join}` / `{c, close}` keyed by a relay-assigned connId; member↔relay frames are the bare
 * sealed strings. The relay wraps/unwraps; neither daemon ever exposes the team key to it.
 */

const OPEN = 1;
const CLOSED = 3;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** A ws-like handle for ONE member as seen by the host over the relay. It implements just the
 *  surface `acceptPeer()` / `sendSealed()` touch: send, on(message|close|error), readyState/OPEN,
 *  close. Frames the host "sends" here are forwarded to the relay tagged with this member's connId. */
class VirtualSocket extends EventEmitter {
  readyState = OPEN;
  readonly OPEN = OPEN;
  constructor(private connId: string, private up: (o: unknown) => void) { super(); }
  send(str: string) { if (this.readyState === OPEN) this.up({ c: this.connId, d: str }); }
  close(_code?: number, _reason?: string) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.up({ c: this.connId, close: true });
    this.emit("close");
  }
  /** Relay → host: deliver a member's sealed frame as a normal ws 'message' (Buffer, not binary). */
  deliver(d: string) { this.emit("message", Buffer.from(String(d)), false); }
  /** Relay told us the member's socket dropped. */
  remoteClose() { if (this.readyState === CLOSED) return; this.readyState = CLOSED; this.emit("close"); }
}

/**
 * Host-side relay transport. Dials the relay as the room's host and emits a `peer` event carrying a
 * VirtualSocket for every member that joins — feed each straight into `acceptPeer()`. Auto-reconnects
 * (the room is re-established host-first). Emits `listening` on connect, `down` on drop.
 */
export class RelayHostTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private peers = new Map<string, VirtualSocket>();
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private base: string, private teamId: string) { super(); }

  start() { this.dial(); }

  private dial() {
    if (this.closed) return;
    const url = `${this.base}/room/${encodeURIComponent(this.teamId)}?role=host`;
    let ws: WebSocket;
    try { ws = new WebSocket(url, { maxPayload: MAX_FRAME_BYTES }); } catch (err) { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.on("open", () => this.emit("listening"));
    ws.on("error", () => { /* close handler reconnects */ });
    ws.on("message", (data, isBinary) => {
      if (isBinary || (data as Buffer).length > MAX_FRAME_BYTES) return;
      let m: any;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m.c !== "string") return;
      if (m.join) {
        if (!this.peers.has(m.c)) { const vs = new VirtualSocket(m.c, (o) => this.up(o)); this.peers.set(m.c, vs); this.emit("peer", vs); }
      } else if (m.close) {
        this.peers.get(m.c)?.remoteClose();
        this.peers.delete(m.c);
      } else if (typeof m.d === "string") {
        let vs = this.peers.get(m.c);
        if (!vs) { vs = new VirtualSocket(m.c, (o) => this.up(o)); this.peers.set(m.c, vs); this.emit("peer", vs); }
        vs.deliver(m.d);
      }
    });
    ws.on("close", () => {
      for (const vs of this.peers.values()) vs.remoteClose();
      this.peers.clear();
      if (this.ws === ws) this.ws = null;
      this.emit("down");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.dial(); }, 2500);
    this.reconnectTimer.unref?.();
  }

  private up(o: unknown) {
    try { if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(o)); } catch { /* drop; reconnect re-syncs */ }
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const vs of this.peers.values()) vs.remoteClose();
    this.peers.clear();
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
  }
}

/** The URL a MEMBER dials for a relay-backed team. The relay makes this socket transparent — the
 *  member's existing dial() logic works unchanged once it uses this URL. */
export function relayMemberUrl(base: string, teamId: string): string {
  return `${base}/room/${encodeURIComponent(teamId)}?role=member`;
}
