/**
 * Switchboard team relay — a Cloudflare Worker + Durable Object that store-and-forwards the
 * ALREADY-SEALED frames between a team's daemons when they can't reach each other directly
 * (different networks, NAT). Both host and members dial OUT to `wss://<relay>/room/<teamId>`;
 * outbound connections always traverse NAT, so no port-forwarding and no LAN requirement.
 *
 * THE RELAY CANNOT READ A BYTE. It never holds the team key (HKDF of the invite secret) — every
 * frame it moves is AES-256-GCM sealed by the daemons. Persistence stores that same ciphertext.
 * A mailman, not a landlord.
 *
 * ── COST: HIBERNATION IS MANDATORY ────────────────────────────────────────────────────────────
 * Durable Objects bill for the wall-clock time they are AWAKE. A relay whose rooms sit awake
 * holding idle-but-connected sockets would bill 24/7 for teams that aren't even editing. So this
 * uses the WebSocket **Hibernation API**: `state.acceptWebSocket()` lets the DO be evicted from
 * memory while sockets stay open, waking only when a real frame arrives, and
 * `setWebSocketAutoResponse()` answers keepalive pings WITHOUT waking it at all. Cost therefore
 * tracks actual editing, not open tabs. Because the DO can be evicted, NO room state may live in
 * instance fields — roles/ids live in socket TAGS + `serializeAttachment`, and the op-log lives in
 * DO storage. Trial expiry uses an ALARM so it survives hibernation too.
 *
 * ── THE COMMERCIAL GATE ("your infra = free, our cloud = Pro") ─────────────────────────────────
 *   • Self-host (their own Cloudflare): no STORE_SECRET, or STORE_OPEN=1 ⇒ ungated, unlimited.
 *   • Pro: a valid, team-scoped entitlement (`<teamId>.<exp>.<maxSeats>.<HMAC>`) ⇒ full session,
 *     persistence, and that plan's seat count.
 *   • Otherwise a FREE TRIAL: TRIAL_MS of live sync (unlimited restarts), no persistence, a small
 *     seat cap; then the socket closes with a code the daemon turns into an upgrade prompt.
 *   • SEATS are enforced by COUNTING LIVE SOCKETS — never by reading sealed content — so members
 *     still need no account. Only the host subscribes.
 *
 * Wire contract (matches the daemon's RelayHostTransport / relayMemberUrl):
 *   /room/<teamId>?role=host    — receives {c,join}/{c,close}/{c,d} envelopes; sends {c,d:<frame>}
 *   /room/<teamId>?role=member  — bare sealed frames in/out; the DO wraps toward the host
 * Store frames (either role, Pro only):
 *   {put:<b64 sealed>} → {stored:seq}|{full:true}|{denied}   {snapshot:<b64>} → {stored,compacted}
 *   {fetch:<sinceSeq>} → {log:[{seq,blob}…],head}
 */

export interface Env {
  TEAM_ROOM: DurableObjectNamespace;
  /** HMAC secret that signs entitlements (a Wrangler secret). Unset ⇒ self-host, ungated. */
  STORE_SECRET?: string;
  /** "1" ⇒ ungated (a self-hoster running this on their own account). */
  STORE_OPEN?: string;
  TRIAL_MS?: string;
  TRIAL_SEATS?: string;
  MAX_STORE_BYTES?: string;
}

const ROOM_RE = /^\/room\/([^/]+)$/;
/** Close codes the daemon maps to human upgrade prompts. */
const CLOSE_TRIAL_OVER = 4002;
const CLOSE_SEAT_LIMIT = 4003;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("switchboard team relay — sealed frames only, nothing readable stored", { status: 200 });
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

/** Per-socket metadata that must survive hibernation (instance fields do not). */
interface SockMeta {
  role: "host" | "member";
  connId: string;
  /** Pro/self-host ⇒ may use the store and never expires. */
  persistent: boolean;
  /** Epoch ms when a free-trial socket must close; 0 for entitled/self-host. */
  trialEndsAt: number;
}

/** One team's room: forwarding + (Pro) a zero-knowledge op-log. Hibernation-safe throughout. */
export class TeamRoom {
  constructor(private state: DurableObjectState, private env: Env) {
    // Keepalive pings are auto-answered WITHOUT waking the DO — the single biggest cost lever.
    try {
      this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch { /* older runtime: harmless */ }
  }

  private get open(): boolean {
    return this.env.STORE_OPEN === "1" || !this.env.STORE_SECRET;
  }
  /** Free-session length. 0/absent ⇒ NO time limit: live sync stays free and unlimited while
   *  storage remains Pro-gated. That's the pre-billing posture (cost-safe: forwarding is cheap and
   *  hibernates; only persistence costs real money). Set TRIAL_MS=600000 to switch sync to Pro. */
  private get trialMs(): number {
    return Number(this.env.TRIAL_MS ?? 0);
  }
  private get trialSeats(): number {
    return Number(this.env.TRIAL_SEATS ?? 3);
  }
  private get maxBytes(): number {
    return Number(this.env.MAX_STORE_BYTES ?? 8 * 1024 * 1024);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "member";
    const teamId = decodeURIComponent(ROOM_RE.exec(url.pathname)![1]);

    // ---- the gate ----
    const ent = this.open ? { maxSeats: Number.MAX_SAFE_INTEGER } : await verifyEntitlement(url.searchParams.get("ent"), teamId, this.env.STORE_SECRET!);
    const persistent = this.open || !!ent;
    const maxSeats = ent?.maxSeats ?? this.trialSeats;

    // Seats = live sockets in this room. Counting sockets never reads sealed content.
    if (this.state.getWebSockets().length >= maxSeats) {
      return new Response(`seat-limit:${maxSeats}`, { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const meta: SockMeta = {
      role,
      connId: "m" + Math.random().toString(36).slice(2, 10),
      persistent,
      // 0 = never expires (entitled, self-host, or the pre-billing "sync is free" posture).
      trialEndsAt: persistent || this.trialMs <= 0 ? 0 : Date.now() + this.trialMs,
    };

    if (role === "host") {
      // A new host replaces the old one; stale members redial to it.
      for (const old of this.state.getWebSockets("host")) { try { old.close(1000, "replaced"); } catch { /* gone */ } }
      for (const mws of this.state.getWebSockets("member")) { try { mws.close(1000, "host-changed"); } catch { /* gone */ } }
    }

    // HIBERNATION ACCEPT (not ws.accept()): the DO may now be evicted while this socket stays open.
    // Tags are how we find sockets again after eviction; the attachment carries the rest.
    this.state.acceptWebSocket(server, [role, meta.connId]);
    server.serializeAttachment(meta);

    if (role === "member") {
      // A member may use the store with NO host online (that's the point of persistence), so a
      // hostless member is NOT refused — only live forwarding needs a host.
      const host = this.state.getWebSockets("host")[0];
      if (host) { try { host.send(JSON.stringify({ c: meta.connId, join: true })); } catch { /* gone */ } }
    }

    // Free-trial deadline via ALARM so it fires even if the DO hibernates in the meantime.
    if (meta.trialEndsAt > 0) await this.armTrialAlarm(meta.trialEndsAt);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Wake just once, at the earliest pending trial deadline. */
  private async armTrialAlarm(at: number) {
    const existing = await this.state.storage.getAlarm();
    if (existing === null || at < existing) await this.state.storage.setAlarm(at);
  }

  /** Close expired trial sockets; re-arm for the next one. Entitled sockets are untouched. */
  async alarm(): Promise<void> {
    const now = Date.now();
    let next = Infinity;
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SockMeta | null;
      if (!meta || meta.persistent || !meta.trialEndsAt) continue;
      if (meta.trialEndsAt <= now) { try { ws.close(CLOSE_TRIAL_OVER, "trial-over"); } catch { /* gone */ } }
      else next = Math.min(next, meta.trialEndsAt);
    }
    if (next !== Infinity) await this.state.storage.setAlarm(next);
  }

  /** Hibernation message handler — replaces addEventListener("message"). */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const meta = ws.deserializeAttachment() as SockMeta | null;
    if (!meta) return;
    let o: any;
    try { o = JSON.parse(message); } catch { return; }
    if (!o) return;

    // Store frames first (Pro only) — they are not forwarding frames.
    if (await this.handleStore(ws, meta, o)) return;

    if (meta.role === "host") {
      if (typeof o.c !== "string") return;
      const target = this.state.getWebSockets(o.c)[0];
      if (o.close) { if (target) { try { target.close(1000, "host-closed"); } catch { /* gone */ } } }
      else if (typeof o.d === "string" && target) { try { target.send(o.d); } catch { /* gone */ } }
      return;
    }
    // member → host, wrapped with this member's connId
    const host = this.state.getWebSockets("host")[0];
    if (host) { try { host.send(JSON.stringify({ c: meta.connId, d: message })); } catch { /* gone */ } }
  }

  /** Hibernation close handler. */
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _clean: boolean): Promise<void> {
    const meta = ws.deserializeAttachment() as SockMeta | null;
    if (!meta) return;
    if (meta.role === "host") {
      // Host gone: drop the members so they redial (and land on the next host).
      for (const mws of this.state.getWebSockets("member")) { try { mws.close(1000, "host-gone"); } catch { /* gone */ } }
      return;
    }
    const host = this.state.getWebSockets("host")[0];
    if (host) { try { host.send(JSON.stringify({ c: meta.connId, close: true })); } catch { /* gone */ } }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, "error"); } catch { /* gone */ }
  }

  // ---- the zero-knowledge op-log (Pro) ----
  // Stored as `log:<paddedSeq>` → sealed b64 string. The DO never opens a blob; `head`/`bytes` are
  // plain counters. Compaction (a daemon-supplied sealed snapshot) drops the whole prior log, so
  // storage ≈ the folder's size rather than its entire edit history.

  private async handleStore(ws: WebSocket, meta: SockMeta, o: any): Promise<boolean> {
    if (typeof o.fetch === "number") {
      const since = o.fetch | 0;
      const head = (await this.state.storage.get<number>("head")) ?? 0;
      const log: Array<{ seq: number; blob: string }> = [];
      if (head > since) {
        const entries = await this.state.storage.list<string>({ prefix: "log:", start: `log:${pad(since + 1)}` });
        for (const [k, blob] of entries) log.push({ seq: Number(k.slice(4)), blob });
      }
      try { ws.send(JSON.stringify({ log, head })); } catch { /* gone */ }
      return true;
    }
    if (typeof o.put === "string" || typeof o.snapshot === "string") {
      const isSnap = typeof o.snapshot === "string";
      const blob: string = isSnap ? o.snapshot : o.put;
      if (!meta.persistent) {
        try { ws.send(JSON.stringify({ denied: isSnap ? "snapshot" : "put", reason: "no-entitlement" })); } catch { /* gone */ }
        return true;
      }
      const size = blob.length; // b64 ASCII ⇒ length is the byte count
      const head = (await this.state.storage.get<number>("head")) ?? 0;
      const bytes = (await this.state.storage.get<number>("bytes")) ?? 0;
      if (size > this.maxBytes || (!isSnap && bytes + size > this.maxBytes)) {
        try { ws.send(JSON.stringify({ full: true, head })); } catch { /* gone */ }
        return true;
      }
      const seq = head + 1;
      if (isSnap) {
        // Compaction: the daemon (which CAN read) rolled the folder into one sealed snapshot, so the
        // entire prior log is redundant — drop it and keep only this entry.
        const old = await this.state.storage.list<string>({ prefix: "log:" });
        if (old.size) await this.state.storage.delete([...old.keys()]);
        await this.state.storage.put({ [`log:${pad(seq)}`]: blob, head: seq, bytes: size });
        try { ws.send(JSON.stringify({ stored: seq, compacted: true })); } catch { /* gone */ }
        return true;
      }
      await this.state.storage.put({ [`log:${pad(seq)}`]: blob, head: seq, bytes: bytes + size });
      try { ws.send(JSON.stringify({ stored: seq })); } catch { /* gone */ }
      return true;
    }
    return false;
  }
}

/** Zero-padded so storage.list() prefix ordering is numeric. */
function pad(n: number): string {
  return String(n).padStart(12, "0");
}

/** Verify `<teamId>.<expMs>.<maxSeats>.<HMAC-SHA256 base64url>` — team-scoped and expiring, so a
 *  token can't be lifted to another team or replayed forever. Gates SERVICE, reveals no content. */
async function verifyEntitlement(token: string | null, teamId: string, secret: string): Promise<{ maxSeats: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [tid, exp, seats, sig] = parts;
  if (tid !== teamId) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  if (!/^\d+$/.test(seats)) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${tid}.${exp}.${seats}`));
  if (b64url(mac) !== sig) return null;
  return { maxSeats: Number(seats) };
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
