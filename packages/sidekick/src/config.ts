import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Daemon configuration + runtime state directory. The daemon binds to loopback only and
 * authenticates every connection with a pairing token that lives in ~/.relay (0600). The
 * page NEVER holds this token — only the extension does, established during pairing — so a
 * hostile web page cannot reach the daemon even though the port is open on 127.0.0.1.
 */

/** State dir: ~/.relay by default; overridable via RELAY_DIR (relocation + tests). */
export const RELAY_DIR = process.env.RELAY_DIR || join(homedir(), ".relay");
const TOKEN_FILE = join(RELAY_DIR, "pairing-token");
const PROFILE_FILE = join(RELAY_DIR, "profile.json");

/** The paired user's public identity — a display name (and optional avatar) any connected app can
 *  greet them with. This is the user's own machine, so it lives beside the token in ~/.relay. */
export interface UserProfile {
  name: string;
  avatar?: string;
}

export interface DaemonConfig {
  /** Loopback only. Never bind 0.0.0.0. */
  host: "127.0.0.1";
  port: number;
  /** Secret the extension must present (Authorization: Bearer / WS subprotocol). */
  pairingToken: string;
  stateDir: string;
  /** Who to greet in connected apps. */
  profile: UserProfile;
}

function ensureDir() {
  if (!existsSync(RELAY_DIR)) mkdirSync(RELAY_DIR, { recursive: true, mode: 0o700 });
}

/** Load the pairing token, generating + persisting one (0600) on first run. The token is what
 *  the user copies into the extension during pairing (or the extension reads via a one-time
 *  local handshake). Rotating the file invalidates all paired extensions — the kill switch. */
export function loadPairingToken(): string {
  ensureDir();
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, "utf8").trim();
  const token = randomBytes(32).toString("base64url");
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

export function rotatePairingToken(): string {
  ensureDir();
  const token = randomBytes(32).toString("base64url");
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The user's REAL first name from the OS account (not the login short-name). On macOS `id -F`
 *  returns the full display name ("Sameep Rehlan") — we take the first token ("Sameep"). This is
 *  the honest zero-setup default; if it's unavailable we fall back to the login name, then "there". */
function defaultName(): string {
  // macOS: the account's real display name.
  if (process.platform === "darwin") {
    try {
      const full = execFileSync("id", ["-F"], { timeout: 1500 }).toString().trim();
      const first = full.split(/\s+/)[0]?.trim();
      if (first) return cap(first);
    } catch { /* fall through */ }
  }
  // Fallback: the login username ("sameep.rehlan" → "Sameep").
  let raw = "";
  try { raw = userInfo().username || ""; } catch { /* sandboxed */ }
  const first = raw.split(/[.\-_ ]/)[0]?.trim() ?? "";
  return first ? cap(first) : "there";
}

/** Load the user's display identity. Order: an EXPLICITLY set name (profile.json, written when the
 *  user tells us / a connected account provides it) > RELAY_USER > the OS real name > "there".
 *  Never throws — a malformed file degrades to the default. */
export function loadProfile(): UserProfile {
  ensureDir();
  let fromFile: Partial<UserProfile> = {};
  try { if (existsSync(PROFILE_FILE)) fromFile = JSON.parse(readFileSync(PROFILE_FILE, "utf8")); } catch { /* ignore bad JSON */ }
  const name = (fromFile.name || process.env.RELAY_USER || defaultName()).trim() || defaultName();
  const avatar = fromFile.avatar || process.env.RELAY_AVATAR || undefined;
  return avatar ? { name, avatar } : { name };
}

/** Persist an explicitly chosen identity (the user told us, or a connected account did). This is
 *  the real source of truth — a guessed OS name is only the placeholder until this is set. */
export function saveProfile(profile: Partial<UserProfile>): UserProfile {
  ensureDir();
  let existing: Partial<UserProfile> = {};
  try { if (existsSync(PROFILE_FILE)) existing = JSON.parse(readFileSync(PROFILE_FILE, "utf8")); } catch { /* ignore */ }
  const merged = { ...existing, ...profile };
  if (merged.name) merged.name = String(merged.name).trim();
  writeFileSync(PROFILE_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return loadProfile();
}

export function loadConfig(): DaemonConfig {
  ensureDir();
  return {
    host: "127.0.0.1",
    port: Number(process.env.RELAY_PORT ?? 8787),
    pairingToken: loadPairingToken(),
    stateDir: RELAY_DIR,
    profile: loadProfile(),
  };
}
