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
  /** Per-user Slack INBOX rooms — one DO per handle, keyed by `idFromName(handle)`. Holds the
   *  handle's connected daemon socket(s) and briefly queues tasks while it's offline. Requires a
   *  binding + SQLite migration in wrangler.jsonc:
   *    "durable_objects": { "bindings": [ …, { "name": "INBOX_ROOM", "class_name": "InboxRoom" } ] }
   *    "migrations":      [ …, { "tag": "v2", "new_sqlite_classes": ["InboxRoom"] } ]              */
  INBOX_ROOM: DurableObjectNamespace;
  /** Slack app SIGNING SECRET (a Wrangler secret: `wrangler secret put SLACK_SIGNING_SECRET`).
   *  Every `/slack/command` request is HMAC-verified against it; UNSET ⇒ every Slack call is
   *  refused (fail closed — we never trust an unsigned body). See docs/SLACK-CONNECTOR.md. */
  SLACK_SIGNING_SECRET?: string;
  /** HMAC secret that signs entitlements (a Wrangler secret). Unset ⇒ self-host, ungated. */
  STORE_SECRET?: string;
  /** "1" ⇒ ungated (a self-hoster running this on their own account). */
  STORE_OPEN?: string;
  TRIAL_MS?: string;
  TRIAL_SEATS?: string;
  MAX_STORE_BYTES?: string;
  /** How long a superseded backup generation survives compaction (default 24h). */
  STORE_RETAIN_MS?: string;
}

const ROOM_RE = /^\/room\/([^/]+)$/;
/** A daemon subscribing to a handle's Slack inbox: `GET /inbox/<handle>` (WebSocket upgrade). */
const INBOX_RE = /^\/inbox\/([^/]+)$/;
/** Close codes the daemon maps to human upgrade prompts. */
const CLOSE_TRIAL_OVER = 4002;
const CLOSE_SEAT_LIMIT = 4003;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("switchboard team relay — sealed frames only, nothing readable stored", { status: 200 });
    }

    // ── SLACK INGRESS: `/notch @handle <task>` (docs/SLACK-CONNECTOR.md) ──────────────────────────
    // A Slack slash command POSTs here. We verify Slack's signature (never trusting an unsigned
    // body), parse `@handle <task>`, and hand the task to that handle's INBOX_ROOM, which fans it to
    // the connected daemon (or briefly queues it). Slack needs a 200 within 3s → we ack immediately.
    if (url.pathname === "/slack/command") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      return handleSlackCommand(request, env);
    }

    // ── A daemon subscribing to its handle's inbox: GET /inbox/<handle> (WebSocket) ───────────────
    const im = INBOX_RE.exec(url.pathname);
    if (im) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      const handle = decodeURIComponent(im[1]).toLowerCase();
      const id = env.INBOX_ROOM.idFromName(handle);
      return env.INBOX_ROOM.get(id).fetch(request);
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
  /** The entitlement's own expiry, re-checked on every WRITE — a long-lived socket must not keep
   *  writing on a token that expired after it connected. 0 = no expiry (self-host). */
  entExp: number;
  /** This socket's plan seat count, so the room caps on the PLAN, not on whoever arrived last. */
  maxSeats: number;
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
  /** How long a superseded backup generation is kept before compaction may rotate it again. */
  private get retainMs(): number {
    return Number(this.env.STORE_RETAIN_MS ?? 24 * 60 * 60 * 1000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "member";
    const teamId = decodeURIComponent(ROOM_RE.exec(url.pathname)![1]);

    // ---- the gate ----
    const ent = this.open ? { maxSeats: Number.MAX_SAFE_INTEGER, exp: 0 } : await verifyEntitlement(url.searchParams.get("ent"), teamId, this.env.STORE_SECRET!);
    const persistent = this.open || !!ent;
    const maxSeats = ent?.maxSeats ?? this.trialSeats;

    // ---- ROOM MEMBERSHIP (not merely knowing the teamId) ----
    // The teamId is a routing id that appears in URLs and logs, so it cannot be the authorization
    // boundary: without this check, anyone who saw one could claim `role=host` (evicting the real
    // team) or read the whole sealed backup. `ra` is HKDF'd from the invite secret under a label
    // unrelated to the content key — we can compare it, never decrypt with it. Trust-on-first-use:
    // the first party to present one fixes the room's authenticator.
    const ra = url.searchParams.get("ra");
    const raHash = ra ? await sha256b64(ra) : null;
    const known = await this.state.storage.get<string>("roomAuth");
    if (known) {
      if (raHash !== known) {
        // Wrong or missing proof — not this team. Say nothing more than "no".
        return new Response("not a member of this room", { status: 403 });
      }
    } else if (raHash) {
      await this.state.storage.put("roomAuth", raHash);
    } else if (role === "host") {
      // Never let an unproven socket become the room's host — that's the hijack.
      return new Response("host role requires team membership proof", { status: 403 });
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
      entExp: ent?.exp ?? 0,
      maxSeats,
    };

    if (role === "host") {
      // A new host RECLAIMS the room — the old host and its members are dropped — so it must be
      // replaced BEFORE counting seats, or a reconnecting host would be refused by the seat its own
      // half-open socket still occupies.
      for (const old of this.state.getWebSockets("host")) { try { old.close(1000, "replaced"); } catch { /* gone */ } }
      for (const mws of this.state.getWebSockets("member")) { try { mws.close(1000, "host-changed"); } catch { /* gone */ } }
    }

    // Seats = live sockets in this room, capped by the ROOM's plan (the highest seat count any live
    // socket proved), so an unentitled joiner can't shrink a paid team's capacity. Counting sockets
    // never reads sealed content. The refusal must be a WS close (a client can't read a code or
    // reason from a rejected HTTP handshake), so accept first, then close with 4003.
    const live = this.state.getWebSockets();
    const roomSeats = Math.max(maxSeats, ...live.map((w) => (w.deserializeAttachment() as SockMeta | null)?.maxSeats ?? 0));
    if (live.length >= roomSeats) {
      this.state.acceptWebSocket(server, ["overflow"]);
      try { server.close(CLOSE_SEAT_LIMIT, `seat-limit:${roomSeats}`); } catch { /* gone */ }
      return new Response(null, { status: 101, webSocket: client });
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
      // READ IS GATED TOO. Without this, any socket in the room could pull the entire sealed log —
      // ciphertext, op counts, batch sizes and the write timeline — plus unbounded egress on our
      // bill. The write path already denied; the read path must match it.
      if (!meta.persistent) {
        try { ws.send(JSON.stringify({ denied: "fetch", reason: "no-entitlement" })); } catch { /* gone */ }
        return true;
      }
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
      // Re-check the token's own expiry on every WRITE: a socket that connected while the plan was
      // valid must not keep writing for free after it lapsed. Close so the reconnect re-verifies.
      if (meta.entExp && Date.now() > meta.entExp) {
        try { ws.send(JSON.stringify({ denied: isSnap ? "snapshot" : "put", reason: "entitlement-expired" })); } catch { /* gone */ }
        try { ws.close(CLOSE_TRIAL_OVER, "entitlement-expired"); } catch { /* gone */ }
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
        // prior log is redundant. But compaction must never be able to DESTROY the backup: we keep
        // the previous generation under `prev:` and rotate it at most once per retention window, so
        // a run of snapshot frames (a buggy or hostile client) can't leave the team with nothing
        // recoverable. `fetch` still returns only the current generation.
        const rotatedAt = (await this.state.storage.get<number>("prevAt")) ?? 0;
        const current = await this.state.storage.list<string>({ prefix: "log:" });
        if (Date.now() - rotatedAt > this.retainMs && current.size) {
          const oldPrev = await this.state.storage.list<string>({ prefix: "prev:" });
          if (oldPrev.size) await this.state.storage.delete([...oldPrev.keys()]);
          const carry: Record<string, string> = {};
          for (const [k, v] of current) carry["prev:" + k.slice(4)] = v;
          await this.state.storage.put(carry);
          await this.state.storage.put("prevAt", Date.now());
        }
        if (current.size) await this.state.storage.delete([...current.keys()]);
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

// ── SLACK `/notch` INGRESS ───────────────────────────────────────────────────────────────────────
// Slack posts an `application/x-www-form-urlencoded` body. We NEVER act on it without a valid
// signature, then route `@handle <task>` to that handle's INBOX_ROOM and ack Slack ephemerally.

/** How much clock skew a signed Slack request may carry before we treat it as a replay (Slack's own
 *  recommended window). */
const SLACK_MAX_SKEW_S = 60 * 5;

async function handleSlackCommand(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const okSig = await verifySlackSignature(request, raw, env.SLACK_SIGNING_SECRET);
  if (!okSig) return new Response("bad slack signature", { status: 401 });

  const form = new URLSearchParams(raw);
  const command = form.get("command") || "/notch";
  const text = (form.get("text") || "").trim();
  const userName = form.get("user_name") || "someone";
  const teamId = form.get("team_id") || "";

  // Parse `@handle <task…>` or `handle <task…>`. A bare handle with no task is a usage nudge.
  const m = text.match(/^@?([A-Za-z0-9._-]+)\s+([\s\S]+)$/);
  if (!m) return slackEphemeral(`usage: ${command} @handle <task>`);
  const handle = m[1].toLowerCase();
  const task = m[2].trim();
  if (!task) return slackEphemeral(`usage: ${command} @handle <task>`);

  // The command name picks the mode: `/hijack` = the pester (spec + guided notch + a sprite that trails
  // their cursor); anything else (`/notch`) = the passive board drop. Same parse, same INBOX_ROOM route.
  const mode = command === "/hijack" ? "hijack" : "notch";
  const payload = { from: userName, text: task, mode, team: teamId, at: Date.now() };
  let delivered = 0;
  try {
    const id = env.INBOX_ROOM.idFromName(handle);
    const res = await env.INBOX_ROOM.get(id).fetch("https://inbox/deliver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = (await res.json().catch(() => ({}))) as { delivered?: number };
    delivered = j.delivered ?? 0;
  } catch { /* the ack still tells the sender it's queued */ }

  const offline = delivered === 0 ? " (queued — their Switchboard is offline)" : "";
  const ack = mode === "hijack"
    ? `🎯 hijacked @${handle} — specced it to a guided card + put your sprite on their tail${offline}`
    : `posted to @${handle}'s board${offline}`;
  return slackEphemeral(ack);
}

/** A 200 Slack renders as an ephemeral reply to just the sender (visible only to them). */
function slackEphemeral(text: string): Response {
  return new Response(JSON.stringify({ response_type: "ephemeral", text }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Verify `v0=HMAC-SHA256(SLACK_SIGNING_SECRET, "v0:<ts>:<rawBody>")` in constant time, rejecting a
 *  missing/stale timestamp (replay). Fails CLOSED when the secret is unset — an unsigned body is
 *  never trusted. */
async function verifySlackSignature(request: Request, rawBody: string, secret?: string): Promise<boolean> {
  if (!secret) return false;
  const ts = request.headers.get("x-slack-request-timestamp");
  const sig = request.headers.get("x-slack-signature");
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > SLACK_MAX_SKEW_S) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${rawBody}`));
  return timingSafeEqualStr(`v0=${hex(mac)}`, sig);
}

function hex(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Length-independent-branch string compare — accumulate XOR over the shorter length + fold the
 *  length difference in, so a match verdict never short-circuits on content. */
function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * One user's Slack INBOX. A single DO per handle (`INBOX_ROOM.idFromName(handle)`) that holds the
 * connected daemon socket(s) and fans Slack-delivered tasks to them. Hibernation-style like TeamRoom
 * (no room state in instance fields): sockets are found via `getWebSockets`, and the offline queue
 * lives in DO storage. When no daemon is connected, a task is queued (capped + TTL'd) so a daemon
 * that reconnects shortly after still receives it.
 *
 *   GET  /inbox/<handle>  — WebSocket upgrade; the daemon subscribes as this handle.
 *   POST …/deliver        — {from, text, mode} fanned to every connected daemon → {ok, delivered}.
 */
const INBOX_QUEUE_MAX = 50;
const INBOX_QUEUE_TTL_MS = 60 * 60 * 1000; // an offline daemon still gets tasks queued within the hour

export class InboxRoom {
  constructor(private state: DurableObjectState, private env: Env) {
    // Keepalive pings answered without waking the DO (same cost lever as TeamRoom).
    try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch { /* older runtime */ }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/deliver")) return this.deliver(request);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation accept: the DO may be evicted while the daemon socket stays open. The "daemon" tag
    // is how deliver() finds it again after eviction.
    this.state.acceptWebSocket(server, ["daemon"]);
    // Drain anything that arrived while this handle was offline, so a reconnecting daemon catches up.
    await this.flushQueueTo(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Fan a task to every connected daemon; queue it if none are connected. */
  private async deliver(request: Request): Promise<Response> {
    let task: unknown;
    try { task = await request.json(); } catch { return json({ ok: false, delivered: 0, error: "bad json" }); }
    const blob = JSON.stringify(task);
    let delivered = 0;
    for (const ws of this.state.getWebSockets("daemon")) { try { ws.send(blob); delivered++; } catch { /* gone */ } }
    if (delivered === 0) await this.enqueue(blob);
    return json({ ok: true, delivered });
  }

  /** Append to the offline queue (capped — drop the oldest beyond the cap). */
  private async enqueue(blob: string): Promise<void> {
    const seq = ((await this.state.storage.get<number>("qhead")) ?? 0) + 1;
    await this.state.storage.put({ [`q:${pad(seq)}`]: JSON.stringify({ blob, at: Date.now() }), qhead: seq });
    const all = await this.state.storage.list<string>({ prefix: "q:" });
    if (all.size > INBOX_QUEUE_MAX) {
      await this.state.storage.delete([...all.keys()].slice(0, all.size - INBOX_QUEUE_MAX));
    }
  }

  /** Deliver every non-expired queued task to a freshly connected socket, then clear the queue
   *  (deliver-once). Expired entries are simply dropped. */
  private async flushQueueTo(ws: WebSocket): Promise<void> {
    const all = await this.state.storage.list<string>({ prefix: "q:" });
    if (!all.size) return;
    const now = Date.now();
    const drop: string[] = [];
    for (const [k, v] of all) {
      drop.push(k); // consumed either way
      let rec: { blob?: string; at?: number };
      try { rec = JSON.parse(v); } catch { continue; }
      if (!rec.blob || now - (rec.at ?? 0) > INBOX_QUEUE_TTL_MS) continue;
      try { ws.send(rec.blob); } catch { /* gone */ }
    }
    if (drop.length) await this.state.storage.delete(drop);
  }

  // A daemon never needs to talk BACK over this socket (Slack is one-way ingress), so inbound frames
  // are ignored; close/error need no room-state cleanup (state lives in tags + storage).
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> { /* ignore */ }
  async webSocketClose(_ws: WebSocket): Promise<void> { /* nothing to clean up */ }
  async webSocketError(ws: WebSocket): Promise<void> { try { ws.close(1011, "error"); } catch { /* gone */ } }
}

/** A JSON 200 (the DO's own replies to the Worker, not to Slack). */
function json(o: unknown): Response {
  return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
}

/** Zero-padded so storage.list() prefix ordering is numeric. */
function pad(n: number): string {
  return String(n).padStart(12, "0");
}

/** Verify `<teamId>.<expMs>.<maxSeats>.<HMAC-SHA256 base64url>` — team-scoped and expiring, so a
 *  token can't be lifted to another team or replayed forever. Gates SERVICE, reveals no content. */
async function verifyEntitlement(token: string | null, teamId: string, secret: string): Promise<{ maxSeats: number; exp: number } | null> {
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
  return { maxSeats: Number(seats), exp: Number(exp) };
}

/** Hash of the room authenticator — we store only this, never the token itself. */
async function sha256b64(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
