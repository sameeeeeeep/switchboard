import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
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

/** LITERAL dialects: a key ending in one of these extensions maps to that exact file on disk,
 *  instead of the classic `<key>.json`. `.md` came first (a bound folder doubles as an Obsidian
 *  vault); the web-text set lets a wrapp bind a real project folder and read/write its actual
 *  source — e.g. Redline opens `index.html` and edits it in place (the "warm thread"). Every one
 *  of these is a plain UTF-8 text file; no binary, no execution — the daemon only ever reads/writes
 *  bytes, isolation is still structural (KEY_RE forbids separators; the path must sit in the folder). */
const LITERAL_EXTS = [".md", ".html", ".htm", ".css", ".js", ".mjs", ".svg", ".txt", ".csv", ".xml", ".json5"];
const isLiteralKey = (key: string) => LITERAL_EXTS.some((ext) => key.endsWith(ext));

/** Turn an origin like "https://brandbrain.localhost:5174" into a safe, collision-resistant dirname. */
export function slugOrigin(origin: string): string {
  const safe = origin.replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "origin";
  return safe;
}

/** Expand a leading `~` to the user's home dir (bind paths are user-facing). Exported so every
 *  folder-comparing surface (e.g. Team Mode's origin scoping) normalizes the same way bind does. */
export function expandTilde(p: string): string {
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
    // A folder must be an absolute path we can actually create. A malformed path (e.g. missing the
    // home prefix, so it resolves under "/") throws EACCES/ENOENT from mkdir — catch it and surface a
    // clean StorageBindError instead of letting a raw fs error bubble up and wedge the control channel.
    if (!isAbsolute(abs)) throw new StorageBindError(folder, "path is not absolute");
    try { mkdirSync(abs, { recursive: true }); }
    catch (err) { throw new StorageBindError(abs, (err as NodeJS.ErrnoException)?.code || String((err as Error)?.message || err)); }
    const binding: StorageBinding = { folder: abs, boundAt: Date.now() };
    this.bindings.set(origin, binding);
    this.persist();
    return binding;
  }

  /** Drop an origin's folder binding, reverting it to the auto-assigned private sandbox. Panel-driven
   *  (the user stops pointing an app at a real folder). Returns whether a binding was actually removed. */
  unbind(origin: string): boolean {
    const had = this.bindings.delete(origin);
    if (had) this.persist();
    return had;
  }

  /** The explicit binding folder for an origin (resolved), or null if it's on the auto sandbox. Lets
   *  the Broker tell whether a binding is the one it set before reverting it. */
  boundFolder(origin: string): string | null {
    const b = this.bindings.get(origin);
    return b ? b.folder : null;
  }

  /** Resolve a key to its file, refusing any key that would escape the folder.
   *  Two record dialects share one namespace: a key ending in a LITERAL extension (`.md`, `.html`,
   *  `.css`, … — see LITERAL_EXTS) maps to that exact file on disk (so a bound folder doubles as a
   *  real vault / project source — Obsidian reads the .md, Redline edits the .html); every other key
   *  keeps the classic `<key>.json`. Isolation is unchanged: KEY_RE forbids separators, and the
   *  resolved path must still sit directly inside the folder. */
  private fileFor(origin: string, key: string): string {
    if (!KEY_RE.test(key)) throw new StorageKeyError(key);
    const { folder } = this.folderFor(origin);
    const root = resolve(folder);
    const name = isLiteralKey(key) ? key : `${key}.json`;
    const abs = resolve(root, name);
    // Defense-in-depth beyond KEY_RE: the resolved file must sit directly inside the folder.
    if (abs !== join(root, name) || !abs.startsWith(root + sep)) throw new StorageKeyError(key);
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
    try {
      mkdirSync(resolve(folder), { recursive: true });
      writeFileSync(file, value, { mode: 0o600 });
    } catch (err) {
      // Almost always a broken bound folder (missing/relative path). Give a clear reason, not ENOENT.
      throw new StorageBindError(folder, (err as NodeJS.ErrnoException)?.code || String((err as Error)?.message || err));
    }
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
      .filter((f) => f.endsWith(".json") || isLiteralKey(f))
      .map((f) => (f.endsWith(".json") ? f.slice(0, -5) : f)) // literal keys (.md/.html/…) keep their extension
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

/** Thrown when a bind folder can't be created (malformed/relative path, permission denied). The Broker
 *  turns it into a clean failure instead of letting a raw fs error wedge the control channel. */
export class StorageBindError extends Error {
  constructor(folder: string, reason: string) {
    super(`can't bind folder ${JSON.stringify(folder).slice(0, 120)}: ${reason}`);
    this.name = "StorageBindError";
  }
}
