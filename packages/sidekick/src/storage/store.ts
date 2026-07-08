import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { StorageInfo } from "@relay/protocol";

/**
 * Per-origin on-disk key/value store — the persistence half of the "self-contained backend".
 *
 * FOLDER RESOLUTION (auto-assign otherwise; custom per site):
 *   - Default: a private sandbox at `<stateDir>/storage/<origin-slug>/`, derived deterministically
 *     from the browser-verified origin. No config, no prompt — every app gets one for free.
 *   - Bound: the user can point an origin at any real folder (e.g. an existing project's `.data/`).
 *     Bindings persist in `<stateDir>/storage-bindings.json` (0600).
 *
 * ISOLATION IS STRUCTURAL: a record's path is `folderFor(origin) + <key>.json`, and `origin` is the
 * daemon's authoritative value (never page input). One origin's ops can never resolve into another's
 * folder. Keys are constrained so they can't traverse out of the folder.
 *
 * The store knows nothing about consent — the Broker gates `bind`/`set`/`delete` before calling in.
 */

export interface StorageBinding {
  /** Absolute, user-authorized folder. */
  folder: string;
  boundAt: number;
}

/** Keys map 1:1 to `<key>.json` files, so they must be plain filenames — no separators, no dots
 *  leading a traversal. Allow a conservative filename alphabet only. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Turn an origin like "https://brandbrain.localhost:5174" into a safe, collision-resistant dirname. */
export function slugOrigin(origin: string): string {
  const safe = origin.replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "origin";
  return safe;
}

/** Expand a leading `~` to the user's home dir (bind paths are user-facing). */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

export class StorageStore {
  private bindingsFile: string;
  private defaultRoot: string;
  private bindings = new Map<string, StorageBinding>();

  constructor(stateDir: string) {
    this.bindingsFile = join(stateDir, "storage-bindings.json");
    this.defaultRoot = join(stateDir, "storage");
    this.load();
  }

  private load() {
    if (!existsSync(this.bindingsFile)) return;
    try {
      const obj = JSON.parse(readFileSync(this.bindingsFile, "utf8")) as Record<string, StorageBinding>;
      for (const [origin, b] of Object.entries(obj)) this.bindings.set(origin, b);
    } catch (err) {
      console.error("[storage] bindings load failed:", err);
    }
  }

  private persist() {
    try {
      const obj = Object.fromEntries(this.bindings.entries());
      writeFileSync(this.bindingsFile, JSON.stringify(obj, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error("[storage] bindings persist failed:", err);
    }
  }

  /** The folder an origin's records resolve to, and whether it's the auto-assigned sandbox. */
  folderFor(origin: string): { folder: string; autoAssigned: boolean } {
    const b = this.bindings.get(origin);
    if (b) return { folder: b.folder, autoAssigned: false };
    return { folder: join(this.defaultRoot, slugOrigin(origin)), autoAssigned: true };
  }

  /** Point an origin's store at a real folder. Consent is the Broker's job — by the time we're here
   *  the user has authorized `folder`. Creates it if absent so first-write works. */
  bind(origin: string, folder: string): StorageBinding {
    const abs = resolve(expandTilde(folder));
    mkdirSync(abs, { recursive: true });
    const binding: StorageBinding = { folder: abs, boundAt: Date.now() };
    this.bindings.set(origin, binding);
    this.persist();
    return binding;
  }

  /** Resolve `<folder>/<key>.json`, refusing any key that would escape the folder. */
  private fileFor(origin: string, key: string): string {
    if (!KEY_RE.test(key)) throw new StorageKeyError(key);
    const { folder } = this.folderFor(origin);
    const root = resolve(folder);
    const abs = resolve(root, `${key}.json`);
    // Defense-in-depth beyond KEY_RE: the resolved file must sit directly inside the folder.
    if (abs !== join(root, `${key}.json`) || !abs.startsWith(root + sep)) throw new StorageKeyError(key);
    return abs;
  }

  get(origin: string, key: string): string | null {
    const file = this.fileFor(origin, key);
    if (!existsSync(file)) return null;
    return readFileSync(file, "utf8");
  }

  set(origin: string, key: string, value: string): void {
    const file = this.fileFor(origin, key);
    const { folder } = this.folderFor(origin);
    mkdirSync(resolve(folder), { recursive: true });
    writeFileSync(file, value, { mode: 0o600 });
  }

  delete(origin: string, key: string): boolean {
    const file = this.fileFor(origin, key);
    if (!existsSync(file)) return false;
    rmSync(file);
    return true;
  }

  list(origin: string): string[] {
    const { folder } = this.folderFor(origin);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((k) => KEY_RE.test(k))
      .sort();
  }

  info(origin: string): StorageInfo {
    const { folder, autoAssigned } = this.folderFor(origin);
    return { folder: resolve(folder), autoAssigned, count: this.list(origin).length };
  }
}

/** Thrown for a key that isn't a safe filename; the Broker maps it to INVALID_PARAMS. */
export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`invalid storage key: ${JSON.stringify(key).slice(0, 40)}`);
    this.name = "StorageKeyError";
  }
}
