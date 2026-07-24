import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Team Mode wire crypto — every frame between daemons is sealed, end to end.
 *
 * The trust model mirrors the pairing token, not TLS: possession of the invite secret IS
 * membership. The invite code carries {host, port, teamId, secret}; the AES-256-GCM key is
 * derived from (secret, teamId) via HKDF, so the transport can be any dumb pipe — LAN, a
 * tunnel, a future relay — and none of them can read a byte. The daemon's own extension WS
 * (loopback, pairing-token) is untouched; this is a SEPARATE socket that speaks only sealed
 * frames and drops anything it can't open. Fail-closed: a frame that doesn't decrypt is a
 * disconnect, never an error message that leaks why.
 */

export interface TeamInvite {
  /** Reachable address of the hosting daemon (LAN IP or 127.0.0.1 for same-machine). */
  host: string;
  port: number;
  teamId: string;
  /** Bearer secret — possession = membership. Regenerate the team to rotate. */
  secret: string;
  /** Human team name, shown before joining. */
  name: string;
  /** Optional relay base URL (ws://… or wss://…). When present, both host and members dial the
   *  relay instead of connecting directly — the cross-network path. The relay only ever moves
   *  sealed frames it can't open (a mailman, not a landlord), so this never weakens the trust model. */
  relay?: string;
}

const INVITE_PREFIX = "swb1.";

/** Encode an invite as `swb1.<base64url(JSON)>` — one string a teammate pastes into their panel. */
export function encodeInvite(invite: TeamInvite): string {
  return INVITE_PREFIX + Buffer.from(JSON.stringify(invite), "utf8").toString("base64url");
}

/** Decode + validate an invite code. Returns null on ANY malformation — the caller shows one
 *  generic "invalid invite code" and never echoes the parse failure (the code embeds a secret). */
export function decodeInvite(code: string): TeamInvite | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(INVITE_PREFIX)) return null;
    const obj = JSON.parse(Buffer.from(trimmed.slice(INVITE_PREFIX.length), "base64url").toString("utf8"));
    if (typeof obj?.host !== "string" || !obj.host) return null;
    const port = Number(obj.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (typeof obj.teamId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(obj.teamId)) return null;
    if (typeof obj.secret !== "string" || obj.secret.length < 22) return null;
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim().slice(0, 60) : "team";
    // Relay is optional and must be a ws/wss URL if present — anything else is dropped, never trusted.
    let relay: string | undefined;
    if (typeof obj.relay === "string" && /^wss?:\/\/[^\s]+$/.test(obj.relay) && obj.relay.length <= 300) relay = obj.relay.replace(/\/+$/, "");
    return relay ? { host: obj.host, port, teamId: obj.teamId, secret: obj.secret, name, relay } : { host: obj.host, port, teamId: obj.teamId, secret: obj.secret, name };
  } catch {
    return null;
  }
}

export function newTeamId(): string {
  return randomBytes(9).toString("base64url");
}

export function newTeamSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** One key per team: HKDF-SHA256(secret, salt="switchboard-team-v1", info=teamId) → 32 bytes. */
export function deriveTeamKey(secret: string, teamId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("switchboard-team-v1", "utf8"), Buffer.from(teamId, "utf8"), 32));
}

/** A sealed frame as it crosses the wire. `aad` (the connection's session id + sequence number)
 *  is authenticated but not encrypted — it's what makes a captured frame unreplayable elsewhere. */
export interface SealedFrame {
  v: 1;
  iv: string; // base64url, 12 bytes
  ct: string; // base64url, ciphertext || 16-byte GCM tag
  aad?: string;
}

export function seal(key: Buffer, payload: unknown, aad?: string): SealedFrame {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const pt = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, iv: iv.toString("base64url"), ct: ct.toString("base64url"), ...(aad ? { aad } : {}) };
}

/** Open a sealed frame. Returns null on ANY failure — wrong key, tampered ciphertext, replayed
 *  AAD, malformed JSON. The caller treats null as "not a member" and closes the connection. */
export function open(key: Buffer, frame: unknown, expectedAad?: string): unknown | null {
  try {
    const f = frame as SealedFrame;
    if (f?.v !== 1 || typeof f.iv !== "string" || typeof f.ct !== "string") return null;
    if (expectedAad !== undefined) {
      const got = Buffer.from(String(f.aad ?? ""), "utf8");
      const want = Buffer.from(expectedAad, "utf8");
      if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    }
    const iv = Buffer.from(f.iv, "base64url");
    const buf = Buffer.from(f.ct, "base64url");
    if (iv.length !== 12 || buf.length < 17) return null;
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(0, buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (f.aad) decipher.setAAD(Buffer.from(f.aad, "utf8"));
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    return null;
  }
}
