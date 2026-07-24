/**
 * Switchboard team relay — a Cloudflare Worker + Durable Object that store-and-forwards the
 * ALREADY-SEALED frames between a team's daemons when they can't reach each other directly
 * (different networks, NAT). Both host and members dial OUT to `wss://<relay>/room/<teamId>`;
 * outbound connections always traverse NAT, so no port-forwarding and no LAN requirement.
 *
 * THE RELAY CANNOT READ A BYTE. It never holds the team key (HKDF of the invite secret) — every
 * frame it moves is AES-256-GCM sealed by the daemons. It keeps no history: rooms are pure
 * in-memory socket bookkeeping inside a per-team Durable Object. A mailman, not a landlord.
 *
 * Wire contract (matches the daemon's RelayHostTransport / relayMemberUrl):
 *   /room/<teamId>?role=host    — the room host. Receives {c,join}/{c,close}/{c,d} envelopes and
 *                                 sends {c,d:<frame>} to address one member by relay-assigned connId.
 *   /room/<teamId>?role=member  — a joiner. Bare sealed frames in/out; the DO wraps toward the host.
 *
 * One Durable Object instance per teamId (idFromName), so all of a team's sockets share one room
 * with no cross-team leakage. Uses the standard accept()/addEventListener API — a relay room holds
 * live sockets for the session's duration, which is exactly what a forwarding hub should do.
 */

export interface Env {
  TEAM_ROOM: DurableObjectNamespace;
}

const ROOM_RE = /^\/room\/([^/]+)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("switchboard team relay — sealed frames only, nothing stored", { status: 200 });
    }
    const m = ROOM_RE.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const teamId = decodeURIComponent(m[1]);
    // One room per team; all sockets for a team land in the same Durable Object.
    const id = env.TEAM_ROOM.idFromName(teamId);
    return env.TEAM_ROOM.get(id).fetch(request);
  },
};

/** One team's forwarding room. Holds the host socket + a connId→socket map of members. */
export class TeamRoom {
  private host: WebSocket | null = null;
  private members = new Map<string, WebSocket>();
  private seq = 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.accept(server, role === "host" ? "host" : "member");
    return new Response(null, { status: 101, webSocket: client });
  }

  private accept(ws: WebSocket, role: "host" | "member") {
    ws.accept();
    if (role === "host") {
      if (this.host) { try { this.host.close(); } catch { /* gone */ } }
      for (const mws of this.members.values()) { try { mws.close(); } catch { /* gone */ } } // stale members redial to the new host
      this.members.clear();
      this.host = ws;
      ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        let o: any;
        try { o = JSON.parse(e.data); } catch { return; }
        if (!o || typeof o.c !== "string") return;
        const mws = this.members.get(o.c);
        if (o.close) { if (mws) { try { mws.close(); } catch { /* gone */ } this.members.delete(o.c); } }
        else if (typeof o.d === "string" && mws) { try { mws.send(o.d); } catch { /* gone */ } }
      });
      ws.addEventListener("close", () => {
        if (this.host === ws) {
          this.host = null;
          for (const mws of this.members.values()) { try { mws.close(); } catch { /* gone */ } }
          this.members.clear();
        }
      });
    } else {
      if (!this.host) { try { ws.close(1013, "no host"); } catch { /* gone */ } return; }
      const connId = "m" + (++this.seq);
      this.members.set(connId, ws);
      try { this.host.send(JSON.stringify({ c: connId, join: true })); } catch { /* gone */ }
      ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        if (this.host) { try { this.host.send(JSON.stringify({ c: connId, d: e.data })); } catch { /* gone */ } }
      });
      ws.addEventListener("close", () => {
        this.members.delete(connId);
        if (this.host) { try { this.host.send(JSON.stringify({ c: connId, close: true })); } catch { /* gone */ } }
      });
    }
  }
}
