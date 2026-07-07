import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Daemon configuration + runtime state directory. The daemon binds to loopback only and
 * authenticates every connection with a pairing token that lives in ~/.relay (0600). The
 * page NEVER holds this token — only the extension does, established during pairing — so a
 * hostile web page cannot reach the daemon even though the port is open on 127.0.0.1.
 */

/** State dir: ~/.relay by default; overridable via RELAY_DIR (relocation + tests). */
export const RELAY_DIR = process.env.RELAY_DIR || join(homedir(), ".relay");
const TOKEN_FILE = join(RELAY_DIR, "pairing-token");

export interface DaemonConfig {
  /** Loopback only. Never bind 0.0.0.0. */
  host: "127.0.0.1";
  port: number;
  /** Secret the extension must present (Authorization: Bearer / WS subprotocol). */
  pairingToken: string;
  stateDir: string;
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

export function loadConfig(): DaemonConfig {
  ensureDir();
  return {
    host: "127.0.0.1",
    port: Number(process.env.RELAY_PORT ?? 8787),
    pairingToken: loadPairingToken(),
    stateDir: RELAY_DIR,
  };
}
