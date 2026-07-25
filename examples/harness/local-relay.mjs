// LOCAL RELAY — a protocol-identical, in-process stand-in for the Cloudflare Durable Object relay
// (packages/relay), so the hosted team path can be proven headless with no cloud.
//
//   GET /room/<teamId>?role=host|member[&ent=<entitlement>]
//     host   — receives {c,join}/{c,close}/{c,d:<frame>} envelopes; sends {c,d:<frame>} to one member
//     member — sends/receives BARE sealed frames
//
// THE PRICING MODEL, ENFORCED HERE ("your infra = free, our cloud = Pro"):
//   • LAN P2P and a SELF-HOSTED relay are free and never touch this gate (RELAY_STORE_OPEN=1, or no
//     RELAY_STORE_SECRET configured ⇒ everything unlocked; that's the self-hoster's own infra).
//   • On OUR hosted relay, a connection with a valid entitlement (the host's Pro sub) gets a full
//     session + persistence + its plan's seat count.
//   • Without one it's a FREE TRIAL: TRIAL_MS of live sync (unlimited restarts), no persistence, a
//     small seat cap — then the socket closes with a reason the daemon turns into an upgrade prompt.
//   • Seats are enforced by COUNTING LIVE CONNECTIONS — counting sockets never reads sealed content,
//     so zero-knowledge holds and MEMBERS STILL NEED NO ACCOUNT. Only the host subscribes.
//
// Forwarding stores nothing. PERSISTENCE (Pro) keeps a per-team append log of SEALED blobs
// (ciphertext the relay cannot read) so an offline/rejoining member or a fresh device catches up:
//   {put:<b64 sealed op>}   → append; {stored:seq} | {full:true} | {denied:"put"}
//   {snapshot:<b64 sealed>} → compact the whole log to this one entry (bounded storage)
//   {fetch:<sinceSeq>}      → {log:[{seq,blob}…], head}
import { WebSocketServer } from "ws";
import { createHmac, timingSafeEqual } from "node:crypto";

const STORE_SECRET = process.env.RELAY_STORE_SECRET || "";
/** Self-host escape: no secret configured, or explicitly opened ⇒ their infra, no gate at all. */
const STORE_OPEN = process.env.RELAY_STORE_OPEN === "1" || !process.env.RELAY_STORE_SECRET;
const MAX_STORE_BYTES = Number(process.env.RELAY_STORE_MAX_BYTES || 8 * 1024 * 1024);
/** Free-trial session length on our hosted relay. Unlimited restarts; ~free for us (hibernation). */
export const TRIAL_MS = Number(process.env.RELAY_TRIAL_MS || 10 * 60 * 1000);
/** Seats a trial team may use at once (the paste-a-code wow works for a small group). */
const TRIAL_SEATS = Number(process.env.RELAY_TRIAL_SEATS || 3);

/** Close codes the daemon maps to human upgrade prompts (surfaced in TeamStatus.error). */
export const CLOSE_TRIAL_OVER = 4002;
export const CLOSE_SEAT_LIMIT = 4003;

/** Mint an entitlement for a Pro team. Billing issues these; only the HOST needs one.
 *  Token = `<teamId>.<expMs>.<maxSeats>.<sig>` where sig = HMAC(secret, "teamId.exp.maxSeats"). */
export function mintEntitlement(teamId, secret, opts = {}) {
  const exp = String(Date.now() + (opts.ttlMs ?? 30 * 24 * 3600 * 1000));
  const seats = String(opts.maxSeats ?? 5);
  const sig = createHmac("sha256", secret).update(`${teamId}.${exp}.${seats}`).digest("base64url");
  return `${teamId}.${exp}.${seats}.${sig}`;
}

/** Verify an entitlement against a team. Returns { maxSeats } or null. Team-scoped + expiring, so a
 *  token can't be lifted to another team or reused forever. Gates SERVICE, never reveals content. */
export function verifyEntitlement(token, teamId, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4) return null;
  const [tid, exp, seats, sig] = parts;
  if (tid !== teamId) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  if (!/^\d+$/.test(seats)) return null;
  const want = createHmac("sha256", secret).update(`${tid}.${exp}.${seats}`).digest("base64url");
  const a = Buffer.from(sig, "utf8"), b = Buffer.from(want, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { maxSeats: Number(seats) };
}

export function startLocalRelay(port, host = "127.0.0.1") {
  const wss = new WebSocketServer({ host, port });
  // teamId -> { host, members, store, seats:Set<ws> }
  const rooms = new Map();
  let seq = 0;
  const roomOf = (teamId) => { let r = rooms.get(teamId); if (!r) { r = { host: null, members: new Map(), store: null, seats: new Set() }; rooms.set(teamId, r); } return r; };
  const storeOf = (room) => { if (!room.store) room.store = { log: [], bytes: 0, head: 0 }; return room.store; };

  /** Store frames, handled on any connection that proved entitlement. True = it was a store op. */
  const handleStore = (ws, room, persistent, o) => {
    if (typeof o.fetch === "number") {
      const st = room.store;
      const log = st ? st.log.filter((e) => e.seq > (o.fetch | 0)) : [];
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
      // The daemon (which CAN read) rolled the folder into one sealed snapshot — drop the prior log.
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

    // ---- the gate: self-host open · Pro entitlement · else free trial ----
    const ent = STORE_OPEN ? { maxSeats: Infinity } : verifyEntitlement(m.ent, teamId, STORE_SECRET);
    const persistent = STORE_OPEN || !!ent;
    const maxSeats = ent?.maxSeats ?? TRIAL_SEATS;

    // Seats = live connections in this room (host + members). Counting sockets ≠ reading content.
    if (room.seats.size >= maxSeats) {
      try { ws.close(CLOSE_SEAT_LIMIT, `seat-limit:${maxSeats}`); } catch {}
      return;
    }
    room.seats.add(ws);

    // Free trial: a time-boxed session, unlimited restarts. Entitled connections never expire.
    let trial = null;
    if (!persistent) {
      trial = setTimeout(() => { try { ws.close(CLOSE_TRIAL_OVER, "trial-over"); } catch {} }, TRIAL_MS);
      trial.unref?.();
    }
    const cleanup = () => { if (trial) clearTimeout(trial); room.seats.delete(ws); };

    if (m.role === "host") {
      if (room.host) { try { room.host.close(); } catch {} }
      for (const mws of room.members.values()) { try { mws.close(); } catch {} }
      room.members.clear();
      room.host = ws;
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        let o; try { o = JSON.parse(data.toString()); } catch { return; }
        if (!o) return;
        if (handleStore(ws, room, persistent, o)) return;
        if (typeof o.c !== "string") return;
        const mws = room.members.get(o.c);
        if (o.close) { if (mws) { try { mws.close(); } catch {} room.members.delete(o.c); } }
        else if (typeof o.d === "string" && mws && mws.readyState === mws.OPEN) { try { mws.send(o.d); } catch {} }
      });
      ws.on("close", () => { cleanup(); if (room.host === ws) { room.host = null; for (const mws of room.members.values()) { try { mws.close(); } catch {} } room.members.clear(); } });
    } else {
      // A member may fetch/put the store with NO host online — that's the point of persistence — so
      // don't refuse a hostless member; only live forwarding needs a host.
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
      ws.on("close", () => { cleanup(); room.members.delete(connId); if (room.host && room.host.readyState === room.host.OPEN) { try { room.host.send(JSON.stringify({ c: connId, close: true })); } catch {} } });
    }
  });

  return { port, url: `ws://${host}:${port}`, close: () => { try { wss.close(); } catch {} } };
}
