// LOCAL RELAY — a protocol-identical, in-process stand-in for the Cloudflare Durable Object relay
// (packages/relay), so the team relay path can be proven headless with no cloud. Same wire contract
// the daemon's RelayHostTransport / relayMemberUrl speak:
//
//   GET /room/<teamId>?role=host     — the room's host. Receives {c,join}/{c,close}/{c,d:<frame>}
//                                       envelopes, and SENDS {c,d:<frame>} to address one member.
//   GET /room/<teamId>?role=member   — a joiner. Sends/receives BARE sealed frames; the relay
//                                       wraps member→host and unwraps host→member.
//
// The relay never opens a frame (it holds no team key) and stores nothing — a mailman, not a
// landlord. Rooms are pure in-memory socket bookkeeping.
import { WebSocketServer } from "ws";

export function startLocalRelay(port, host = "127.0.0.1") {
  const wss = new WebSocketServer({ host, port });
  const rooms = new Map(); // teamId -> { host: ws|null, members: Map<connId, ws> }
  let seq = 0;
  const roomOf = (teamId) => { let r = rooms.get(teamId); if (!r) { r = { host: null, members: new Map() }; rooms.set(teamId, r); } return r; };

  wss.on("error", (err) => console.error("[local-relay] error:", String(err).slice(0, 120)));
  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});
    let m;
    try { const u = new URL(req.url, "http://x"); m = { path: u.pathname, role: u.searchParams.get("role") }; } catch { ws.close(); return; }
    const match = /^\/room\/([^/]+)$/.exec(m.path || "");
    if (!match) { ws.close(1008, "bad path"); return; }
    const teamId = decodeURIComponent(match[1]);
    const room = roomOf(teamId);

    if (m.role === "host") {
      if (room.host) { try { room.host.close(); } catch {} }
      for (const mws of room.members.values()) { try { mws.close(); } catch {} } // stale members redial to the new host
      room.members.clear();
      room.host = ws;
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let o; try { o = JSON.parse(data.toString()); } catch { return; }
        if (!o || typeof o.c !== "string") return;
        const mws = room.members.get(o.c);
        if (o.close) { if (mws) { try { mws.close(); } catch {} room.members.delete(o.c); } }
        else if (typeof o.d === "string" && mws && mws.readyState === mws.OPEN) { try { mws.send(o.d); } catch {} }
      });
      ws.on("close", () => { if (room.host === ws) { room.host = null; for (const mws of room.members.values()) { try { mws.close(); } catch {} } room.members.clear(); } });
    } else {
      if (!room.host || room.host.readyState !== room.host.OPEN) { try { ws.close(1013, "no host"); } catch {} return; }
      const connId = "m" + (++seq);
      room.members.set(connId, ws);
      try { room.host.send(JSON.stringify({ c: connId, join: true })); } catch {}
      ws.on("message", (data, isBinary) => { if (isBinary) return; if (room.host && room.host.readyState === room.host.OPEN) { try { room.host.send(JSON.stringify({ c: connId, d: data.toString() })); } catch {} } });
      ws.on("close", () => { room.members.delete(connId); if (room.host && room.host.readyState === room.host.OPEN) { try { room.host.send(JSON.stringify({ c: connId, close: true })); } catch {} } });
    }
  });

  return { port, url: `ws://${host}:${port}`, close: () => { try { wss.close(); } catch {} } };
}
