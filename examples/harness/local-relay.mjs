// LOCAL RELAY — a protocol-identical, in-process stand-in for the Cloudflare Durable Object relay
// (packages/relay), so the team relay path can be proven headless with no cloud. Same wire contract
// the daemon's RelayHostTransport / relayMemberUrl speak:
//
//   GET /room/<teamId>?role=host     — the room's host. Receives {c,join}/{c,close}/{c,d:<frame>}
//                                       envelopes, and SENDS {c,d:<frame>} to address one member.
//   GET /room/<teamId>?role=member   — a joiner. Sends/receives BARE sealed frames.
//
// FORWARDING is free + ephemeral (a mailman): stores nothing, holds no key. PERSISTENCE is the
// OPT-IN, PRO-GATED, COST-BOUNDED layer — the relay keeps a per-team append log of SEALED blobs
// (ciphertext it can't read) so an offline/rejoining member or a fresh device replays and catches
// up. It is UNLOCKED only by a valid entitlement (?ent=…, HMAC-signed by the store secret) so
// randoms with the relay URL get only the free forwarding path, never our disk — and it's byte-
// CAPPED per team, with daemon-driven snapshot compaction, so cost stays bounded. Store frames:
//   {put:<b64 sealed op>}      → append (persistent only), reply {stored:seq} or {full:true}
//   {snapshot:<b64 sealed>}    → compact: replace the whole log with just this snapshot
//   {fetch:<sinceSeq>}         → reply {log:[{seq,blob}…], head}
import { WebSocketServer } from "ws";
import { createHmac, timingSafeEqual } from "node:crypto";

const STORE_SECRET = process.env.RELAY_STORE_SECRET || "";
const STORE_OPEN = process.env.RELAY_STORE_OPEN === "1"; // self-host escape: persistence without a token
const MAX_STORE_BYTES = Number(process.env.RELAY_STORE_MAX_BYTES || 8 * 1024 * 1024);

/** Mint an entitlement a Pro daemon presents to unlock persistence. Real billing issues these;
 *  the harness uses it directly. Token = `<teamId>.<expMs>.<sig>` (sig = HMAC(secret, id.exp)). */
export function mintEntitlement(teamId, secret, ttlMs = 30 * 24 * 3600 * 1000) {
  const exp = String(Date.now() + ttlMs);
  const sig = createHmac("sha256", secret).update(`${teamId}.${exp}`).digest("base64url");
  return `${teamId}.${exp}.${sig}`;
}

/** Verify an entitlement for a team. Zero-knowledge: gates STORAGE, reveals nothing about content. */
export function verifyEntitlement(token, teamId, secret) {
  if (!token || !secret) return false;
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  const [tid, exp, sig] = parts;
  if (tid !== teamId) return false;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = createHmac("sha256", secret).update(`${tid}.${exp}`).digest("base64url");
  const a = Buffer.from(sig, "utf8"), b = Buffer.from(want, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startLocalRelay(port, host = "127.0.0.1") {
  const wss = new WebSocketServer({ host, port });
  // teamId -> { host, members, store: { log:[{seq,blob}], bytes, head } | null }
  const rooms = new Map();
  let seq = 0;
  const roomOf = (teamId) => { let r = rooms.get(teamId); if (!r) { r = { host: null, members: new Map(), store: null }; rooms.set(teamId, r); } return r; };
  const storeOf = (room) => { if (!room.store) room.store = { log: [], bytes: 0, head: 0 }; return room.store; };

  /** Persistence is available for this connection when a valid entitlement is presented (or, for a
   *  self-hoster, RELAY_STORE_OPEN=1). No secret + not open ⇒ never persist (safe default). */
  const canPersist = (teamId, ent) => STORE_OPEN || (!!STORE_SECRET && verifyEntitlement(ent, teamId, STORE_SECRET));

  /** Handle the store frames on ANY connection (host or member) that proved entitlement. Returns
   *  true if the frame was a store op (so the caller skips forwarding it). */
  const handleStore = (ws, room, persistent, o) => {
    if (typeof o.fetch === "number") {
      const st = room.store;
      const since = o.fetch | 0;
      const log = st ? st.log.filter((e) => e.seq > since) : [];
      try { ws.send(JSON.stringify({ log, head: st ? st.head : 0 })); } catch {}
      return true;
    }
    if (typeof o.put === "string") {
      if (!persistent) { try { ws.send(JSON.stringify({ denied: "put", reason: "no-entitlement" })); } catch {} return true; }
      const st = storeOf(room);
      const size = Buffer.byteLength(o.put, "utf8");
      if (st.bytes + size > MAX_STORE_BYTES) { try { ws.send(JSON.stringify({ full: true, head: st.head })); } catch {} return true; }
      st.head += 1; st.bytes += size; st.log.push({ seq: st.head, blob: o.put });
      try { ws.send(JSON.stringify({ stored: st.head })); } catch {}
      return true;
    }
    if (typeof o.snapshot === "string") {
      if (!persistent) { try { ws.send(JSON.stringify({ denied: "snapshot", reason: "no-entitlement" })); } catch {} return true; }
      const st = storeOf(room);
      const size = Buffer.byteLength(o.snapshot, "utf8");
      if (size > MAX_STORE_BYTES) { try { ws.send(JSON.stringify({ full: true, head: st.head })); } catch {} return true; }
      // Compaction: the daemon (which CAN read) has rolled the folder into one sealed snapshot; drop
      // the whole prior log and keep just this. Storage per team ≈ folder size, not edit history.
      st.head += 1; st.log = [{ seq: st.head, blob: o.snapshot, snapshot: true }]; st.bytes = size;
      try { ws.send(JSON.stringify({ stored: st.head, compacted: true })); } catch {}
      return true;
    }
    return false;
  };

  wss.on("error", (err) => console.error("[local-relay] error:", String(err).slice(0, 120)));
  wss.on("connection", (ws, req) => {
    ws.on("error", () => {});
    let m;
    try { const u = new URL(req.url, "http://x"); m = { path: u.pathname, role: u.searchParams.get("role"), ent: u.searchParams.get("ent") }; } catch { ws.close(); return; }
    const match = /^\/room\/([^/]+)$/.exec(m.path || "");
    if (!match) { ws.close(1008, "bad path"); return; }
    const teamId = decodeURIComponent(match[1]);
    const room = roomOf(teamId);
    const persistent = canPersist(teamId, m.ent);

    if (m.role === "host") {
      if (room.host) { try { room.host.close(); } catch {} }
      for (const mws of room.members.values()) { try { mws.close(); } catch {} }
      room.members.clear();
      room.host = ws;
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let o; try { o = JSON.parse(data.toString()); } catch { return; }
        if (!o) return;
        if (handleStore(ws, room, persistent, o)) return; // store frames aren't forwarding frames
        if (typeof o.c !== "string") return;
        const mws = room.members.get(o.c);
        if (o.close) { if (mws) { try { mws.close(); } catch {} room.members.delete(o.c); } }
        else if (typeof o.d === "string" && mws && mws.readyState === mws.OPEN) { try { mws.send(o.d); } catch {} }
      });
      ws.on("close", () => { if (room.host === ws) { room.host = null; for (const mws of room.members.values()) { try { mws.close(); } catch {} } room.members.clear(); } });
    } else {
      // A member may fetch/put the store even if no host is online (that's the whole point of
      // persistence), so DON'T reject a hostless member outright; only the live-forward needs a host.
      const connId = "m" + (++seq);
      if (room.host && room.host.readyState === room.host.OPEN) {
        room.members.set(connId, ws);
        try { room.host.send(JSON.stringify({ c: connId, join: true })); } catch {}
      }
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let o; try { o = JSON.parse(data.toString()); } catch { return; }
        if (!o) return;
        if (handleStore(ws, room, persistent, o)) return;
        if (room.host && room.host.readyState === room.host.OPEN) { try { room.host.send(JSON.stringify({ c: connId, d: data.toString() })); } catch {} }
      });
      ws.on("close", () => { room.members.delete(connId); if (room.host && room.host.readyState === room.host.OPEN) { try { room.host.send(JSON.stringify({ c: connId, close: true })); } catch {} } });
    }
  });

  return { port, url: `ws://${host}:${port}`, close: () => { try { wss.close(); } catch {} } };
}
