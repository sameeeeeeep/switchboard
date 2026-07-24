import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { decodeInvite, deriveTeamKey, encodeInvite, newTeamId, newTeamSecret, open, seal, type TeamInvite } from "./crypto.js";
import { GitBacking, type GitConfig } from "./git.js";
import { FolderSync, type IndexSummary, type SyncOp } from "./sync.js";
import { RelayHostTransport, relayMemberUrl } from "./relay-transport.js";
import { expandTilde } from "../storage/store.js";

/**
 * Team Mode — N people, N Claudes, ONE shared folder. Entirely additive and OFF by default:
 * nothing here is constructed unless the flag is set, no existing code path changes, and a
 * page can never reach any of it (team ops are control-channel only — the panel is the sole
 * driver, exactly like revoke/bind today).
 *
 * Topology is a star: one member HOSTS (their daemon listens on a separate port — the
 * extension's loopback WS is untouched), teammates JOIN with an invite code. Every frame in
 * both directions is sealed with the team key (see crypto.ts). The host is SILENT until a
 * connection proves membership: the joiner speaks first with a sealed "knock", so a port
 * scanner receives zero bytes; anything that doesn't open with the team key is dropped.
 * After the knock → challenge → hello handshake, every frame carries an AAD of
 * `<nonce>:<direction>:<seq>` — session-bound, direction-bound, strictly ordered — so a
 * captured frame can't be replayed or reflected. Each member points the team at a real local
 * folder; FolderSync converges them file-by-file (LWW). The inference side never changes
 * hands — each member's OWN model works on the shared folder, under their OWN grants.
 */

interface PersistedTeam {
  role: "host" | "member";
  teamId: string;
  teamName: string;
  secret: string;
  folder: string;
  /** host: the port we listen on. member: the host's address we dial. */
  port?: number;
  lan?: boolean;
  hostAddr?: string;
  hostPort?: number;
  /** Team-level git backing (host-authored, learned by members over the sealed channel). */
  git?: GitConfig;
  /** THIS member's opt-in to push/pull with their own git auth. Never implied by the team. */
  gitEnabled?: boolean;
  /** Optional relay base URL (ws://… / wss://…). When set, host + members dial the relay instead
   *  of connecting directly — the cross-network path. Frames stay sealed; the relay can't read them. */
  relay?: string;
}

export interface TeamMember {
  deviceId: string;
  name: string;
  online: boolean;
  lastSeen: number;
  you?: boolean;
}

export interface TeamStatus {
  enabled: boolean;
  role: "off" | "host" | "member";
  teamId?: string;
  teamName?: string;
  folder?: string;
  /** Host only — what a teammate pastes to join. Carries the secret; the panel shows it once. */
  invite?: string;
  connected?: boolean;
  members: TeamMember[];
  lastSyncAt?: number;
  /** Why the team isn't healthy (e.g. the listener failed to bind). */
  error?: string;
  /** Git backing, when the team has a repo. `enabled` is THIS machine's opt-in. */
  git?: { remote: string; branch: string; enabled: boolean; lastPushAt?: number; lastPullAt?: number; error?: string };
  /** Relay base URL when the team syncs cross-network through one; absent = direct LAN. */
  relay?: string;
}

export interface TeamEngineDeps {
  stateDir: string;
  /** The user's display name (config profile) — what teammates see in presence. */
  userName: () => string;
  /** Audit hook — wired to the daemon's AuditLog with origin "team". */
  audit: (method: string, outcome: "ok" | "denied" | "error", note?: string) => void;
  /** Fired after remote ops actually changed the folder — the Broker turns this into events. */
  onFolderChanged: (folder: string, files: string[]) => void;
  /** Fired on any membership/role change — the Broker nudges the panel to refresh. */
  onTeamChanged: () => void;
}

const SCAN_MS = 1500;
const HEARTBEAT_MS = 15_000;
const OFFLINE_AFTER_MS = 40_000;
const JOIN_TIMEOUT_MS = 10_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
/** Hard cap on inbound frame size (a 2MB file base64s to ~2.7MB; sealed adds ~33%). */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** Keep each plaintext ops batch well under MAX_FRAME_BYTES after sealing+base64 (~4/3×). */
const OPS_FRAME_BUDGET = 4 * 1024 * 1024;
/** Unauthenticated connections allowed to sit in the handshake at once — bounds the FDs,
 *  timers and crypto a keyless LAN client can make us burn. Members are capped separately. */
const MAX_PENDING_HANDSHAKES = 32;
const MAX_MEMBERS = 24;
/** Locally-failed applies kept for retry (disk full, EBUSY). Oldest dropped past the cap. */
const MAX_RETRY_QUEUE = 256;
/** Git backing cadence + the quiet window before a commit ("pushed when done"). Env-tunable
 *  so the harness can run the whole cycle in seconds. */
const GIT_MS = Math.max(1000, Number(process.env.RELAY_TEAM_GIT_MS ?? 30_000));
const GIT_QUIET_MS = Math.max(500, Number(process.env.RELAY_TEAM_GIT_QUIET_MS ?? 10_000));

/** One authenticated connection: the socket plus its session AAD state. `nonce` is the
 *  challenge nonce = the session id; seqs make every frame direction-bound and ordered. */
interface Session {
  ws: WebSocket;
  nonce: string;
  sendSeq: number;
  recvSeq: number;
}

interface Peer extends Session {
  deviceId: string;
  name: string;
  lastSeen: number;
}

export class TeamEngine {
  private stateFile: string;
  private deviceIdFile: string;
  private enabledMarker: string;
  private teamDir: string;
  private deviceId: string;
  private state: PersistedTeam | null = null;
  private key: Buffer | null = null;
  private sync: FolderSync | null = null;

  private wss: WebSocketServer | null = null; // host role, direct LAN
  private relayHost: RelayHostTransport | null = null; // host role, via relay
  private hostListening = false;
  private hostError: string | null = null;
  private pendingHandshakes = 0;
  private peers = new Map<string, Peer>(); // host role: joined members by deviceId
  private client: Session | null = null; // member role
  private clientConnected = false;
  private hostPresence: TeamMember[] = []; // member role: presence as told by the host

  /** Ops that failed to apply for a LOCAL reason (disk) — retried every scan tick. */
  private retryQueue = new Map<string, SyncOp>();

  private gitBacking: GitBacking | null = null;
  private gitTimer: NodeJS.Timeout | null = null;
  private gitError: string | null = null;

  private scanTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private lastSyncAt = 0;
  private stopped = false;

  constructor(private deps: TeamEngineDeps) {
    this.teamDir = join(deps.stateDir, "team");
    mkdirSync(this.teamDir, { recursive: true, mode: 0o700 });
    this.stateFile = join(this.teamDir, "team.json");
    this.deviceIdFile = join(this.teamDir, "device-id");
    this.enabledMarker = join(this.teamDir, "enabled");
    this.deviceId = this.loadDeviceId();
    this.loadState();
  }

  /** THE mode switch. Team Mode is ON only when the user flipped it in the panel (marker file)
   *  or the env forces it (harness). Everything else in this engine is inert until this is true. */
  enabled(): boolean {
    if (process.env.RELAY_TEAM === "1") return true;
    return existsSync(this.enabledMarker);
  }

  /** Panel-driven toggle. Turning it OFF tears the network down but KEEPS the team config, so
   *  flipping back on resumes the same team — a mode switch, not a leave. */
  setEnabled(on: boolean): TeamStatus {
    if (on) {
      try { writeFileSync(this.enabledMarker, "1", { mode: 0o600 }); } catch (err) { console.error("[team] enable failed:", String(err).slice(0, 120)); }
      this.deps.audit("team:enable", "ok");
      if (this.state) this.resume();
    } else {
      try { if (existsSync(this.enabledMarker)) rmSync(this.enabledMarker); } catch { /* already off */ }
      this.teardownNetwork();
      this.deps.audit("team:disable", "ok");
    }
    this.deps.onTeamChanged();
    return this.status();
  }

  private loadDeviceId(): string {
    try { if (existsSync(this.deviceIdFile)) return readFileSync(this.deviceIdFile, "utf8").trim(); } catch { /* regenerate */ }
    const id = randomBytes(8).toString("base64url");
    writeFileSync(this.deviceIdFile, id, { mode: 0o600 });
    return id;
  }

  private loadState() {
    try {
      if (!existsSync(this.stateFile)) return;
      const obj = JSON.parse(readFileSync(this.stateFile, "utf8")) as PersistedTeam;
      if (obj?.teamId && obj?.secret && obj?.folder && (obj.role === "host" || obj.role === "member")) this.state = obj;
    } catch { /* corrupt state = no team; the user re-hosts/re-joins */ }
  }

  private persistState() {
    try {
      if (this.state) writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      else if (existsSync(this.stateFile)) rmSync(this.stateFile);
    } catch (err) { console.error("[team] state persist failed:", String(err).slice(0, 120)); }
  }

  /** The per-team sync index. Removed on leave/re-join (membership boundaries) so a stale
   *  index can never replay old tombstones against a different folder — resume() keeps it,
   *  which is the legitimate continuation case. */
  private syncIndexFile(teamId: string): string {
    return join(this.teamDir, teamId, "sync-index.json");
  }

  private dropSyncIndex(teamId: string) {
    try { const f = this.syncIndexFile(teamId); if (existsSync(f)) rmSync(f); } catch { /* best effort */ }
  }

  /** Resume a persisted team on daemon start (or when the mode is switched back on). A disabled
   *  or absent team does nothing at all; an already-live network is left alone. */
  resume() {
    if (!this.enabled() || !this.state || this.wss || this.client) return;
    try {
      if (this.state.role === "host") this.startHosting();
      else this.startJoining().catch((err) => console.error("[team] resume failed:", String((err as Error)?.message || err).slice(0, 160)));
    } catch (err) {
      console.error("[team] resume failed:", String(err).slice(0, 160));
    }
  }

  // ---- control-channel verbs (panel-only; the Broker routes team.* actions here) ----

  /** Create a team around a local folder and start listening. Returns the invite code. */
  host(opts: { folder: string; teamName?: string; lan?: boolean; port?: number; relay?: string }): { invite: string; status: TeamStatus } {
    if (!this.enabled()) throw new Error("Team Mode is off — enable it first");
    this.teardownNetwork();
    const teamId = newTeamId();
    this.dropSyncIndex(teamId); // paranoia: a fresh team must start from a fresh index
    const relay = normalizeRelay(opts.relay);
    this.state = {
      role: "host",
      teamId,
      teamName: (opts.teamName ?? "").trim().slice(0, 60) || "My team",
      secret: newTeamSecret(),
      // Normalized the same way storage bind() normalizes, so folder comparisons (origin
      // scoping) can't be defeated by a typed "~/Team" vs a picked absolute path.
      folder: resolve(expandTilde(opts.folder)),
      port: opts.port && Number.isInteger(opts.port) ? opts.port : 8790,
      lan: !!opts.lan,
      ...(relay ? { relay } : {}),
    };
    this.persistState();
    this.startHosting();
    this.deps.audit(`team:host`, "ok", `${this.state.teamName} @ ${opts.folder}`);
    this.deps.onTeamChanged();
    return { invite: this.inviteCode()!, status: this.status() };
  }

  /** Join a teammate's team. The invite embeds host address + secret; `folder` is where the
   *  shared vault materializes locally (defaults to a private spot under the state dir). */
  async join(code: string, opts?: { folder?: string }): Promise<TeamStatus> {
    if (!this.enabled()) throw new Error("Team Mode is off — enable it first");
    const invite = decodeInvite(code);
    if (!invite) throw new Error("invalid invite code");
    this.teardownNetwork();
    this.dropSyncIndex(invite.teamId); // a JOIN is a fresh membership — never inherit an old index
    const folder = resolve(expandTilde((opts?.folder ?? "").trim() || defaultJoinFolder(invite.name, invite.teamId)));
    this.state = {
      role: "member",
      teamId: invite.teamId,
      teamName: invite.name,
      secret: invite.secret,
      folder,
      hostAddr: invite.host,
      hostPort: invite.port,
      ...(invite.relay ? { relay: invite.relay } : {}),
    };
    this.persistState();
    try {
      await this.startJoining(); // resolves on welcome, rejects on timeout/refusal
    } catch (err) {
      // A failed join leaves NO half-joined team behind — clean slate, clear error.
      this.teardownNetwork();
      this.state = null;
      this.persistState();
      this.deps.audit("team:join", "error", String((err as Error)?.message).slice(0, 120));
      this.deps.onTeamChanged();
      throw err;
    }
    this.deps.audit(`team:join`, "ok", `${invite.name} @ ${invite.host}:${invite.port}`);
    this.deps.onTeamChanged();
    return this.status();
  }

  /** Leave (member) or disband-locally (host: stops listening; members fail to reconnect). */
  leave(): TeamStatus {
    const had = this.state?.teamName;
    const teamId = this.state?.teamId;
    this.teardownNetwork();
    this.state = null;
    this.persistState();
    if (teamId) this.dropSyncIndex(teamId); // membership over — the index must not outlive it
    if (had) this.deps.audit("team:leave", "ok", had);
    this.deps.onTeamChanged();
    return this.status();
  }

  status(): TeamStatus {
    const on = this.enabled();
    if (!on || !this.state) return { enabled: on, role: "off", members: [] };
    const you: TeamMember = { deviceId: this.deviceId, name: this.deps.userName(), online: true, lastSeen: Date.now(), you: true };
    let members: TeamMember[];
    if (this.state.role === "host") {
      const now = Date.now();
      members = [you, ...[...this.peers.values()].map((p) => ({ deviceId: p.deviceId, name: p.name, online: now - p.lastSeen < OFFLINE_AFTER_MS, lastSeen: p.lastSeen }))];
    } else {
      members = this.hostPresence.length ? this.hostPresence.map((m) => (m.deviceId === this.deviceId ? { ...m, you: true, name: you.name } : { ...m, you: undefined })) : [you];
    }
    return {
      enabled: on,
      role: this.state.role,
      teamId: this.state.teamId,
      teamName: this.state.teamName,
      folder: this.state.folder,
      invite: this.state.role === "host" ? this.inviteCode() ?? undefined : undefined,
      connected: this.state.role === "host" ? this.hostListening : this.clientConnected,
      members,
      lastSyncAt: this.lastSyncAt || undefined,
      error: this.state.role === "host" && this.hostError ? this.hostError : undefined,
      git: this.state.git ? {
        remote: this.state.git.remote,
        branch: this.state.git.branch,
        enabled: !!this.state.gitEnabled,
        lastPushAt: this.gitBacking?.state.lastPushAt,
        lastPullAt: this.gitBacking?.state.lastPullAt,
        error: this.gitBacking?.state.error ?? this.gitError ?? undefined,
      } : undefined,
      relay: this.state.relay,
    };
  }

  /** Full shutdown on daemon exit. */
  stop() {
    this.stopped = true;
    this.teardownNetwork();
  }

  // ---- git backing ("the folder when live, the repo when apart") ----

  /** Host-only: set (or clear, with null) the team's git remote. Setting it is the host's
   *  explicit consent moment — the panel names the folder and the remote before calling. */
  async setGit(remote: string | null): Promise<TeamStatus> {
    if (!this.state) throw new Error("no team");
    if (this.state.role !== "host") throw new Error("only the host sets the team repo");
    if (remote === null) {
      this.state.git = undefined;
      this.state.gitEnabled = undefined;
      this.persistState();
      this.stopGit();
      for (const p of this.peers.values()) this.sendSealed(p, "h", { kind: "git", git: null });
      this.deps.audit("team:git-clear", "ok");
      this.deps.onTeamChanged();
      return this.status();
    }
    const url = remote.trim();
    if (!url || url.length > 300) throw new Error("that doesn't look like a git remote URL");
    const config: GitConfig = { remote: url, branch: "main" };
    // Prove the folder can safely become the team repo BEFORE persisting anything.
    const backing = new GitBacking(this.state.folder, config, () => this.deps.userName());
    await backing.ensureRepo(); // throws a user-readable reason on refusal
    this.state.git = config;
    this.state.gitEnabled = true; // setting the repo IS the host's opt-in
    this.persistState();
    this.gitBacking = backing;
    this.gitError = null;
    this.armGitTimer();
    for (const p of this.peers.values()) this.sendSealed(p, "h", { kind: "git", git: config });
    this.deps.audit("team:git-set", "ok", url);
    this.deps.onTeamChanged();
    return this.status();
  }

  /** Any member: opt THIS machine in/out of pushing/pulling with its own git auth. */
  async setGitEnabled(on: boolean): Promise<TeamStatus> {
    if (!this.state) throw new Error("no team");
    if (!this.state.git) throw new Error("this team has no repo — the host sets one first");
    if (on) {
      const backing = new GitBacking(this.state.folder, this.state.git, () => this.deps.userName());
      await backing.ensureRepo();
      this.state.gitEnabled = true;
      this.persistState();
      this.gitBacking = backing;
      this.gitError = null;
      this.armGitTimer();
      this.deps.audit("team:git-enable", "ok", this.state.git.remote);
    } else {
      this.state.gitEnabled = false;
      this.persistState();
      this.stopGit();
      this.deps.audit("team:git-disable", "ok");
    }
    this.deps.onTeamChanged();
    return this.status();
  }

  /** Fire-and-forget start on resume/host/join when the member already opted in. */
  private maybeStartGit() {
    const st = this.state;
    if (!st?.git || !st.gitEnabled || this.gitBacking) return;
    const backing = new GitBacking(st.folder, st.git, () => this.deps.userName());
    backing.ensureRepo()
      .then(() => { this.gitBacking = backing; this.gitError = null; this.armGitTimer(); })
      .catch((err) => { this.gitError = String((err as Error)?.message || err).slice(0, 140); this.deps.onTeamChanged(); });
  }

  private armGitTimer() {
    if (this.gitTimer) return;
    this.gitTimer = setInterval(() => this.runGitCycle(), GIT_MS);
    this.gitTimer.unref?.();
    this.runGitCycle(); // first cycle now — resume shouldn't wait a full interval
  }

  private runGitCycle() {
    const backing = this.gitBacking;
    if (!backing || !this.state) return;
    // "Pushed when done": only commit once the folder has been quiet for a beat, so a burst
    // of live edits becomes one commit, not thirty. Pulls always run.
    const quiet = Date.now() - this.lastSyncAt > GIT_QUIET_MS;
    void backing.cycle({ quiet }).then((pulled) => {
      if (pulled && this.state) {
        // The pull changed the working tree — the next scan tick stamps + fans the files out
        // to live peers; this nudge just tells apps/panel to look now.
        this.lastSyncAt = Date.now();
        this.deps.onFolderChanged(this.state.folder, []);
        this.deps.onTeamChanged();
      }
    });
  }

  private stopGit() {
    if (this.gitTimer) { clearInterval(this.gitTimer); this.gitTimer = null; }
    this.gitBacking = null;
    this.gitError = null;
  }

  // ---- host role ----

  private inviteCode(): string | null {
    if (this.state?.role !== "host") return null;
    const invite: TeamInvite = {
      host: this.state.lan ? lanAddress() ?? "127.0.0.1" : "127.0.0.1",
      port: this.state.port ?? 8790,
      teamId: this.state.teamId,
      secret: this.state.secret,
      name: this.state.teamName,
      ...(this.state.relay ? { relay: this.state.relay } : {}),
    };
    return encodeInvite(invite);
  }

  private startHosting() {
    const st = this.state!;
    this.key = deriveTeamKey(st.secret, st.teamId);
    this.sync = new FolderSync(st.folder, this.deviceId, join(this.teamDir, st.teamId));
    this.hostListening = false;
    this.hostError = null;
    if (st.relay) {
      // RELAY host: dial OUT to the relay and take a virtual socket per member. No listening port;
      // the relay is the reachable rendezvous. Same acceptPeer() path, same sealed handshake.
      const t = new RelayHostTransport(st.relay, st.teamId);
      t.on("listening", () => { this.hostListening = true; this.hostError = null; this.deps.onTeamChanged(); });
      t.on("down", () => { this.hostListening = false; this.deps.onTeamChanged(); });
      t.on("peer", (ws) => this.acceptPeer(ws as any));
      this.relayHost = t;
      t.start();
      console.error(`[team] hosting "${st.teamName}" via relay ${st.relay} (sealed frames only)`);
    } else {
      // DIRECT host: bind loopback unless the user chose LAN. The extension WS invariant ("never bind
      // 0.0.0.0") is about the UNsealed pairing-token port — this socket answers nothing until a
      // connection proves membership with a sealed knock.
      const host = st.lan ? "0.0.0.0" : "127.0.0.1";
      const port = st.port ?? 8790;
      this.wss = new WebSocketServer({ host, port, maxPayload: MAX_FRAME_BYTES, backlog: 64 });
      this.wss.on("listening", () => { this.hostListening = true; this.hostError = null; this.deps.onTeamChanged(); });
      this.wss.on("error", (err) => {
        // EADDRINUSE etc. — status() must not claim a dead listener is hosting.
        this.hostListening = false;
        this.hostError = String((err as Error)?.message || err).slice(0, 120);
        console.error("[team] listener error:", this.hostError);
        this.deps.audit("team:host", "error", this.hostError);
        this.deps.onTeamChanged();
      });
      this.wss.on("connection", (ws) => this.acceptPeer(ws));
      console.error(`[team] hosting "${st.teamName}" on ws://${host}:${port} (sealed frames only)`);
    }
    this.startScanLoop();
    this.maybeStartGit();
    this.heartbeatTimer = setInterval(() => this.hostHeartbeat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  private acceptPeer(ws: WebSocket) {
    if (!this.key || !this.sync) { try { ws.close(); } catch { /* gone */ } return; } // torn down mid-accept
    // Resource bound BEFORE any crypto: a keyless LAN client may cost us at most a refused
    // socket. Handshakes in flight and member count are both capped.
    if (this.pendingHandshakes >= MAX_PENDING_HANDSHAKES || this.peers.size >= MAX_MEMBERS) { try { ws.close(); } catch { /* gone */ } return; }
    this.pendingHandshakes += 1;
    let counted = true;
    const uncount = () => { if (counted) { counted = false; this.pendingHandshakes -= 1; } };
    ws.on("error", () => { /* handled by close */ });
    // The host is SILENT until the peer proves membership: first frame must be a sealed knock.
    // A scanner that connects and waits gets zero bytes, then a timeout close.
    const nonce = randomBytes(16).toString("base64url");
    let knocked = false;
    let peer: Peer | null = null;
    const guard = setTimeout(() => { if (!peer) try { ws.close(1008, "handshake timeout"); } catch { /* gone */ } }, JOIN_TIMEOUT_MS);
    (guard as NodeJS.Timeout).unref?.();
    ws.on("message", (data, isBinary) => {
      try {
        if (!this.key || !this.sync) { ws.close(); return; }
        if (isBinary || (data as Buffer).length > MAX_FRAME_BYTES) { ws.close(1009, "oversize"); return; }
        let frame: unknown;
        try { frame = JSON.parse(data.toString()); } catch { ws.close(1008, "bad frame"); return; }
        if (!peer) {
          // Handshake frames carry no AAD (the session id IS the nonce being established).
          const msg = open(this.key, frame) as any;
          if (!msg) { ws.close(1008, "not a member"); return; } // fail closed: can't open ⇒ not our team
          if (!knocked) {
            if (msg.kind !== "knock") { ws.close(1008, "bad knock"); return; }
            knocked = true;
            try { ws.send(JSON.stringify(seal(this.key, { kind: "challenge", nonce }))); } catch { try { ws.close(); } catch { /* gone */ } }
            return;
          }
          if (msg.kind !== "hello" || msg.nonce !== nonce || typeof msg.deviceId !== "string" || !msg.deviceId) { ws.close(1008, "bad hello"); return; }
          clearTimeout(guard);
          uncount();
          // One live connection per device: a reconnect replaces the stale socket.
          const prior = this.peers.get(msg.deviceId);
          if (prior) { try { prior.ws.close(); } catch { /* gone */ } }
          peer = { ws, nonce, sendSeq: 0, recvSeq: 0, deviceId: msg.deviceId, name: String(msg.name ?? "teammate").slice(0, 40) || "teammate", lastSeen: Date.now() };
          this.peers.set(msg.deviceId, peer);
          this.deps.audit("team:member-join", "ok", peer.name);
          this.sendSealed(peer, "h", { kind: "welcome", teamName: this.state!.teamName, summary: this.sync.summary(), git: this.state!.git ?? null });
          this.broadcastPresence();
          this.deps.onTeamChanged();
          return;
        }
        // Post-handshake: every member frame must carry the member-direction AAD in sequence.
        const msg = open(this.key, frame, `${peer.nonce}:m:${peer.recvSeq}`) as any;
        if (!msg) { ws.close(1008, "bad frame"); return; } // wrong session/order/direction ⇒ drop the link
        peer.recvSeq += 1;
        peer.lastSeen = Date.now();
        this.handlePeerMessage(peer, msg);
      } catch (err) {
        // A malformed frame must never take the daemon down — drop the connection instead.
        console.error("[team] peer frame error:", String(err).slice(0, 120));
        try { ws.close(1008, "bad frame"); } catch { /* gone */ }
      }
    });
    ws.on("close", () => {
      clearTimeout(guard);
      uncount();
      if (peer && this.peers.get(peer.deviceId)?.ws === ws) {
        this.peers.delete(peer.deviceId);
        this.deps.audit("team:member-leave", "ok", peer.name);
        this.broadcastPresence();
        this.deps.onTeamChanged();
      }
    });
  }

  private handlePeerMessage(peer: Peer, msg: any) {
    switch (msg.kind) {
      case "summary": {
        // The joiner's index digest — reply with everything of ours that beats theirs.
        const theirs = (msg.summary && typeof msg.summary === "object" && !Array.isArray(msg.summary)) ? (msg.summary as IndexSummary) : {};
        this.sendOps(peer, "h", this.sync!.opsFor(theirs));
        return;
      }
      case "ops": {
        // AUTHORSHIP IS BOUND HERE: a member may only submit ops stamped with its own
        // authenticated deviceId. Anything else (spoofed tiebreak identities) is dropped.
        // Members trust the host's fan-out, which relays each author's ops verbatim.
        const ops = (Array.isArray(msg.ops) ? msg.ops : []).filter((o: any) => o && o.deviceId === peer.deviceId);
        this.applyOps(ops as SyncOp[], peer.deviceId);
        return;
      }
      case "hb":
        return; // lastSeen already bumped
      case "bye":
        try { peer.ws.close(); } catch { /* gone */ }
        return;
    }
  }

  private hostHeartbeat() {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > OFFLINE_AFTER_MS) { try { p.ws.close(); } catch { /* gone */ } this.peers.delete(id); this.broadcastPresence(); this.deps.onTeamChanged(); continue; }
      this.sendSealed(p, "h", { kind: "hb" });
    }
  }

  private broadcastPresence() {
    const members = this.status().members.map(({ you: _you, ...m }) => m);
    for (const p of this.peers.values()) this.sendSealed(p, "h", { kind: "presence", members });
  }

  // ---- member role ----

  private startJoining(): Promise<void> {
    const st = this.state!;
    this.key = deriveTeamKey(st.secret, st.teamId);
    this.sync = new FolderSync(st.folder, this.deviceId, join(this.teamDir, st.teamId));
    this.startScanLoop();
    this.maybeStartGit(); // resume path: this member may already have opted in
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => { if (!settled) { settled = true; err ? reject(err) : resolve(); } };
      this.dial(settle);
      setTimeout(() => settle(new Error("could not reach the host — check the invite and that the host is online")), JOIN_TIMEOUT_MS).unref?.();
    });
  }

  private dial(onFirstWelcome?: (err?: Error) => void) {
    if (this.stopped || this.state?.role !== "member") return;
    const st = this.state;
    // Relay-backed teams dial the relay (which makes the socket transparent to the host); direct
    // teams dial the host address. Everything after this line is identical either way.
    const url = st.relay ? relayMemberUrl(st.relay, st.teamId) : `ws://${st.hostAddr}:${st.hostPort}`;
    const ws = new WebSocket(url, { maxPayload: MAX_FRAME_BYTES });
    const session: Session = { ws, nonce: "", sendSeq: 0, recvSeq: 0 };
    this.client = session;
    let welcomed = false;
    ws.on("error", () => { /* close handler schedules the retry */ });
    ws.on("open", () => { try { ws.send(JSON.stringify(seal(this.key!, { kind: "knock" }))); } catch { /* close handles it */ } });
    ws.on("message", (data, isBinary) => {
      try {
        if (!this.key || !this.sync) { ws.close(); return; }
        if (isBinary || (data as Buffer).length > MAX_FRAME_BYTES) return;
        let frame: unknown;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        if (!session.nonce) {
          // Pre-session: the only expected frame is the sealed challenge (no AAD yet).
          const msg = open(this.key, frame) as any;
          if (!msg) { ws.close(); return; } // not our team (or a MITM) — fail closed
          if (msg.kind !== "challenge" || typeof msg.nonce !== "string" || !msg.nonce) { ws.close(); return; }
          session.nonce = String(msg.nonce);
          try { ws.send(JSON.stringify(seal(this.key, { kind: "hello", nonce: session.nonce, deviceId: this.deviceId, name: this.deps.userName() }))); } catch { /* close handles it */ }
          return;
        }
        // Post-handshake: every host frame must carry the host-direction AAD in sequence.
        const msg = open(this.key, frame, `${session.nonce}:h:${session.recvSeq}`) as any;
        if (!msg) { ws.close(); return; }
        session.recvSeq += 1;
        switch (msg.kind) {
          case "welcome": {
            welcomed = true;
            this.clientConnected = true;
            this.reconnectDelay = RECONNECT_MIN_MS;
            // Two-way initial exchange: apply what the host has, send what we have.
            const theirs = (msg.summary && typeof msg.summary === "object" && !Array.isArray(msg.summary)) ? (msg.summary as IndexSummary) : {};
            this.sendOps(session, "m", this.sync.opsFor(theirs));
            this.sendSealed(session, "m", { kind: "summary", summary: this.sync.summary() });
            this.adoptGitConfig(msg.git);
            this.deps.onTeamChanged();
            onFirstWelcome?.();
            return;
          }
          case "git":
            this.adoptGitConfig(msg.git);
            return;
          case "ops":
            this.applyOps(Array.isArray(msg.ops) ? msg.ops : [], "host");
            return;
          case "presence":
            this.hostPresence = Array.isArray(msg.members)
              ? msg.members.filter((m: any): m is TeamMember => !!m && typeof m === "object" && typeof m.deviceId === "string" && typeof m.name === "string")
              : [];
            this.deps.onTeamChanged();
            return;
          case "hb":
            this.sendSealed(session, "m", { kind: "hb" });
            return;
        }
      } catch (err) {
        console.error("[team] host frame error:", String(err).slice(0, 120));
        try { ws.close(); } catch { /* gone */ }
      }
    });
    ws.on("close", () => {
      if (this.client === session) { this.client = null; this.clientConnected = false; }
      if (!welcomed) onFirstWelcome?.(new Error("the host refused the connection — the invite may be stale"));
      this.deps.onTeamChanged();
      if (!this.stopped && this.state?.role === "member" && this.enabled()) {
        this.reconnectTimer = setTimeout(() => this.dial(), this.reconnectDelay);
        (this.reconnectTimer as NodeJS.Timeout).unref?.();
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      }
    });
  }

  // ---- shared plumbing ----

  /** A member learning the team's repo from the host (welcome or a live "git" frame). This
   *  only records the CONFIG — pushing/pulling stays off until this member explicitly enables
   *  it (their machine, their git auth, their click). */
  private adoptGitConfig(git: unknown) {
    if (!this.state || this.state.role !== "member") return;
    const valid = git && typeof git === "object" && typeof (git as GitConfig).remote === "string" && typeof (git as GitConfig).branch === "string";
    if (valid) {
      const g = git as GitConfig;
      if (this.state.git?.remote === g.remote && this.state.git?.branch === g.branch) return;
      this.state.git = { remote: g.remote.slice(0, 300), branch: g.branch.slice(0, 100) };
      this.state.gitEnabled = false; // a new repo always re-asks this member
      this.persistState();
      this.stopGit();
      this.deps.onTeamChanged();
    } else if (git === null && this.state.git) {
      this.state.git = undefined;
      this.state.gitEnabled = undefined;
      this.persistState();
      this.stopGit();
      this.deps.onTeamChanged();
    }
  }

  private startScanLoop() {
    // One synchronous scan BEFORE anything can talk: pre-existing local files must be stamped
    // into the index before the welcome/summary exchange runs, or they'd lose to the peer's
    // files without ever getting their LWW contest (silent data loss on first join).
    try { this.sync?.scan(); } catch (err) { console.error("[team] initial scan failed:", String(err).slice(0, 120)); }
    this.scanTimer = setInterval(() => {
      if (!this.sync) return;
      this.drainRetryQueue();
      let ops: SyncOp[] = [];
      try { ops = this.sync.scan(); } catch (err) { console.error("[team] scan failed:", String(err).slice(0, 120)); return; }
      if (!ops.length) return;
      this.lastSyncAt = Date.now();
      this.broadcastOps(ops);
    }, SCAN_MS);
    this.scanTimer.unref?.();
  }

  /** Re-apply ops that failed for a local reason (disk full, EBUSY). versionWins makes the
   *  retry idempotent and self-cancelling: if a newer version landed meanwhile it comes back
   *  "stale" and drops. Restores convergence with no protocol round-trip. */
  private drainRetryQueue() {
    if (!this.retryQueue.size || !this.sync) return;
    const changed: string[] = [];
    for (const [file, op] of [...this.retryQueue]) {
      let r;
      try { r = this.sync.applyRemote(op); } catch { r = "stale" as const; }
      if (r === "failed") continue; // still failing — keep for the next tick
      this.retryQueue.delete(file);
      if (r === "applied") changed.push(file);
    }
    if (changed.length && this.state) {
      this.lastSyncAt = Date.now();
      this.deps.onFolderChanged(this.state.folder, changed);
    }
  }

  /** Send one logical ops batch as as many frames as it takes to stay under the frame cap —
   *  an unchunked 3×2MB batch would seal past maxPayload and wedge the link in a reconnect loop. */
  private sendOps(to: Session, dir: "h" | "m", ops: SyncOp[]) {
    if (!ops.length) return;
    let batch: SyncOp[] = [];
    let size = 0;
    for (const op of ops) {
      const opSize = (op.contentB64?.length ?? 0) + 200;
      if (batch.length && size + opSize > OPS_FRAME_BUDGET) { this.sendSealed(to, dir, { kind: "ops", ops: batch }); batch = []; size = 0; }
      batch.push(op);
      size += opSize;
    }
    if (batch.length) this.sendSealed(to, dir, { kind: "ops", ops: batch });
  }

  private broadcastOps(ops: SyncOp[], excludeDeviceId?: string) {
    if (this.state?.role === "host") {
      for (const p of this.peers.values()) if (p.deviceId !== excludeDeviceId) this.sendOps(p, "h", ops);
    } else if (this.client && this.clientConnected) {
      this.sendOps(this.client, "m", ops);
    }
  }

  private applyOps(ops: SyncOp[], fromDeviceId: string) {
    if (!this.sync || !this.state) return;
    const changed: string[] = [];
    let accepted = 0;
    for (const op of ops) {
      let r;
      try { r = this.sync.applyRemote(op); } catch { r = "stale" as const; } // one bad op never blocks the rest
      if (r === "applied") { changed.push(op.file); accepted += 1; }
      else if (r === "noop") accepted += 1;
      else if (r === "failed") {
        // Local fault (disk) — remember the op and retry each tick; cap the queue.
        if (this.retryQueue.size >= MAX_RETRY_QUEUE) { const oldest = this.retryQueue.keys().next().value; if (oldest !== undefined) this.retryQueue.delete(oldest); }
        this.retryQueue.set(op.file, op);
      }
    }
    // Star topology: the host fans a member's (authorship-verified) ops out to everyone else,
    // even when the host itself already had newer content — another member may still need them.
    if (this.state.role === "host" && ops.length) this.broadcastOps(ops, fromDeviceId);
    if (!changed.length) return;
    this.lastSyncAt = Date.now();
    if (accepted) this.deps.audit("team:sync", "ok", `${changed.length} file(s) from ${fromDeviceId === "host" ? "the host" : "a teammate"}`);
    this.deps.onFolderChanged(this.state.folder, changed);
  }

  /** Seal + send one frame on an authenticated session, stamping the direction-bound AAD. */
  private sendSealed(to: Session, dir: "h" | "m", payload: unknown) {
    if (to.ws.readyState !== to.ws.OPEN) return;
    try {
      to.ws.send(JSON.stringify(seal(this.key!, payload, `${to.nonce}:${dir}:${to.sendSeq}`)));
      to.sendSeq += 1;
    } catch { /* peer dropped; close handles it */ }
  }

  private teardownNetwork() {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    for (const p of this.peers.values()) { try { p.ws.close(); } catch { /* gone */ } }
    this.peers.clear();
    if (this.client) {
      const c = this.client;
      try { if (c.nonce) this.sendSealed(c, "m", { kind: "bye" }); c.ws.close(); } catch { /* gone */ }
      this.client = null;
    }
    this.clientConnected = false;
    this.hostPresence = [];
    if (this.wss) { try { this.wss.close(); } catch { /* gone */ } this.wss = null; }
    if (this.relayHost) { try { this.relayHost.stop(); } catch { /* gone */ } this.relayHost = null; }
    this.hostListening = false;
    this.hostError = null;
    this.pendingHandshakes = 0;
    this.retryQueue.clear();
    this.stopGit();
    this.sync = null;
    this.key = null;
  }
}

/** Where a joined team's folder lands when the member doesn't choose one: a VISIBLE, named
 *  spot — `~/Switchboard Teams/<team name>/` — not a hidden corner of the state dir. People
 *  find their team's files in Finder under the team's name; rejoining the same team lands in
 *  the same folder (a natural continuation, contested per-file by LWW like any join).
 *  RELAY_TEAMS_DIR overrides the base for harnesses so tests never touch the real home dir. */
function defaultJoinFolder(teamName: string, teamId: string): string {
  const base = process.env.RELAY_TEAMS_DIR || join(homedir(), "Switchboard Teams");
  const safe = teamName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60) || teamId;
  return join(base, safe);
}

/** Accept a ws/wss relay URL (trailing slashes trimmed), or undefined for anything else. Env
 *  RELAY_TEAM_RELAY provides a default so a deployment can make every new team relay-backed. */
function normalizeRelay(v?: string): string | undefined {
  const raw = (v ?? process.env.RELAY_TEAM_RELAY ?? "").trim();
  if (!raw) return undefined;
  if (!/^wss?:\/\/[^\s]+$/.test(raw) || raw.length > 300) return undefined;
  return raw.replace(/\/+$/, "");
}

/** First non-internal IPv4 — the address a LAN invite embeds. Null on an offline machine. */
function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.family === "IPv4") return a.address;
    }
  }
  return null;
}
