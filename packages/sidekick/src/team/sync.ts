import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * File-level sync for one shared folder — the storage dialect made multiplayer.
 *
 * The unit of change in Switchboard storage IS a whole file (`claude_storage.set` writes
 * `<key>.json` or a literal `.md`/`.html`/…), so the semantically honest merge is per-file
 * last-writer-wins ordered by a Lamport clock, with the writer's deviceId as a deterministic
 * tiebreak. No CRDT dependency, no keystroke merging — two daemons that see the same set of
 * ops converge to identical folders, byte for byte.
 *
 * Deletions leave TOMBSTONES in the index (never on disk) so a delete propagates instead of
 * resurrecting on the next full exchange. The index persists per team beside the daemon's
 * other state (0600), NEVER inside the shared folder — the folder stays exactly what the
 * user's apps see, nothing synthetic added. The index records WHICH folder it describes; an
 * index found describing a different folder is discarded, so a re-join pointed at a new
 * folder can never replay stale tombstones into a wipe.
 *
 * Change detection is a SCAN (mtime+size, hash on suspicion, not fs.watch): it catches writes
 * from `claude_storage`, from Obsidian, from anything — and it means Team Mode needs zero
 * hooks inside StorageStore. The fast path distrusts fingerprints younger than the worst-case
 * filesystem mtime granularity (git's "racily clean" rule), so a same-size rewrite within one
 * mtime granule still gets hashed.
 */

/** Same conservative shape storage keys resolve to: a plain filename, no separators, no
 *  traversal. Anything else in the folder (subdirs, dotfiles, binaries) is left alone. */
const SYNC_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SYNC_EXTS = [".json", ".md", ".html", ".htm", ".css", ".js", ".mjs", ".svg", ".txt", ".csv", ".xml", ".json5"];
/** Files past this size don't sync (the storage dialect is text, not media). Logged once. */
const MAX_SYNC_BYTES = 2 * 1024 * 1024;
/** Ceiling on any clock we accept — far above honest use (an op/second for 8,900 millennia),
 *  far below 2^53 where += 1 stops incrementing. Blocks clock-saturation pinning attacks. */
const MAX_CLOCK = 2 ** 48;
/** Distrust mtime+size fingerprints younger than this (worst real-world granule is exFAT's 2s). */
const RACY_WINDOW_MS = 3000;

export const isSyncableName = (name: string): boolean =>
  SYNC_NAME_RE.test(name) && SYNC_EXTS.some((ext) => name.endsWith(ext));

/** The version stamp on one file: a Lamport clock plus the stamping device, totally ordered. */
export interface FileVersion {
  clock: number;
  deviceId: string;
}

/** remote > local ⇒ the remote write wins. Equal clocks fall back to deviceId — arbitrary but
 *  identical on every member, which is what convergence needs. */
export function versionWins(remote: FileVersion, local: FileVersion): boolean {
  if (remote.clock !== local.clock) return remote.clock > local.clock;
  if (remote.deviceId === local.deviceId) return false; // same stamp = same write, nothing to do
  return remote.deviceId > local.deviceId;
}

interface IndexEntry extends FileVersion {
  /** sha256 of content (empty string for tombstones). */
  hash: string;
  deleted?: true;
  /** Local fs fingerprint at last index time — the cheap "did it change" check. */
  mtimeMs?: number;
  size?: number;
}

/** One file's change, as shipped to teammates. Content is base64 so odd encodings survive JSON. */
export interface SyncOp {
  file: string;
  clock: number;
  deviceId: string;
  hash: string;
  deleted?: true;
  contentB64?: string;
}

/** What applying a remote op did:
 *  applied — accepted, and the folder visibly changed (notify apps)
 *  noop    — accepted (stamp adopted), nothing visible changed
 *  stale   — rejected for good: op loses LWW, is malformed, or targets an unsyncable file
 *  failed  — a LOCAL fault (disk full, perm) — worth retrying; the op itself may still win */
export type ApplyResult = "applied" | "noop" | "stale" | "failed";

/** The handshake digest: every file's version, no content. Small enough to send whole. */
export type IndexSummary = Record<string, { clock: number; deviceId: string; hash: string; deleted?: true }>;

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

export class FolderSync {
  private index = new Map<string, IndexEntry>();
  private clock = 0;
  private indexFile: string;
  private root: string;
  private warnedOversize = new Set<string>();

  constructor(
    folder: string,
    private deviceId: string,
    /** Where the index persists — per-team state dir, NOT the synced folder. */
    stateDir: string,
  ) {
    this.root = resolve(folder);
    mkdirSync(this.root, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    this.indexFile = join(stateDir, "sync-index.json");
    this.load();
  }

  private load() {
    try {
      if (!existsSync(this.indexFile)) return;
      const obj = JSON.parse(readFileSync(this.indexFile, "utf8")) as { folder?: string; clock?: number; files?: Record<string, IndexEntry> };
      // An index describing a DIFFERENT folder is someone else's history — using it would replay
      // stale tombstones/versions against the wrong tree (worst case: a team-wide wipe on rejoin).
      if (obj.folder && resolve(obj.folder) !== this.root) {
        console.error("[team] sync index was for another folder — starting fresh");
        return;
      }
      this.clock = Math.min(Number(obj.clock) || 0, MAX_CLOCK);
      for (const [name, e] of Object.entries(obj.files ?? {})) if (isSyncableName(name)) this.index.set(name, e);
    } catch (err) {
      console.error("[team] sync index load failed (starting fresh):", String(err).slice(0, 120));
      this.index.clear();
      this.clock = 0;
    }
  }

  /** Persist the index. Returns false on failure — callers must NOT let unpersisted stamps
   *  escape (a broadcast stamp that a restart forgets would make our own later edits lose). */
  private persist(): boolean {
    try {
      const tmp = this.indexFile + ".tmp";
      writeFileSync(tmp, JSON.stringify({ folder: this.root, clock: this.clock, files: Object.fromEntries(this.index) }), { mode: 0o600 });
      renameSync(tmp, this.indexFile);
      return true;
    } catch (err) {
      console.error("[team] sync index persist failed:", String(err).slice(0, 120));
      return false;
    }
  }

  /** Resolve a synced name inside the folder, refusing anything that could escape it. The name
   *  already passed isSyncableName, but defense-in-depth matches StorageStore.fileFor. */
  private fileFor(name: string): string {
    if (!isSyncableName(name)) throw new Error(`unsyncable name: ${JSON.stringify(name).slice(0, 40)}`);
    const abs = resolve(this.root, name);
    if (abs !== join(this.root, name) || !abs.startsWith(this.root + sep)) throw new Error(`unsyncable name: ${JSON.stringify(name).slice(0, 40)}`);
    return abs;
  }

  /**
   * Scan the folder for local changes since the last index and stamp them. Returns the ops to
   * broadcast (empty most ticks). Stamps only escape AFTER they persist: if the index can't be
   * written, every in-memory change is rolled back and the tick returns nothing — the next
   * tick re-detects and retries, so a crash or full disk never leaks a stamp peers remember
   * but we forget.
   */
  scan(): SyncOp[] {
    const ops: SyncOp[] = [];
    const touched: Array<[string, IndexEntry | undefined]> = []; // rollback log
    const prevClock = this.clock;
    let names: string[] = [];
    try { names = readdirSync(this.root).filter(isSyncableName); } catch { return ops; } // folder unobservable — stamp nothing
    const seen = new Set<string>();
    for (const name of names) {
      const abs = this.fileFor(name);
      let st;
      try { st = statSync(abs); } catch (err) {
        // Only a confirmed disappearance may ever become a tombstone. A transient error
        // (EACCES/EBUSY/EIO on a network/iCloud folder) is "couldn't observe", not "deleted".
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") seen.add(name);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > MAX_SYNC_BYTES) {
        seen.add(name); // present, just unsyncable — never tombstone it
        if (!this.warnedOversize.has(name)) {
          this.warnedOversize.add(name);
          console.error(`[team] ${name} is over ${MAX_SYNC_BYTES / 1024 / 1024}MB — it stays local and stops syncing`);
        }
        continue;
      }
      seen.add(name);
      const prev = this.index.get(name);
      // Fast path — but never trust a fingerprint younger than the fs's mtime granularity
      // (git's "racily clean" rule): a same-size rewrite within one granule must still hash.
      if (prev && !prev.deleted && prev.mtimeMs === st.mtimeMs && prev.size === st.size && Date.now() - st.mtimeMs > RACY_WINDOW_MS) continue;
      let content: Buffer;
      try { content = readFileSync(abs); } catch { continue; }
      const hash = sha256(content);
      if (prev && !prev.deleted && prev.hash === hash) {
        // Touched but identical (or a remote apply we just wrote) — refresh the fingerprint only.
        this.index.set(name, { ...prev, mtimeMs: st.mtimeMs, size: st.size });
        continue;
      }
      this.clock += 1;
      touched.push([name, prev]);
      const entry: IndexEntry = { clock: this.clock, deviceId: this.deviceId, hash, mtimeMs: st.mtimeMs, size: st.size };
      this.index.set(name, entry);
      ops.push({ file: name, clock: entry.clock, deviceId: this.deviceId, hash, contentB64: content.toString("base64") });
    }
    // Indexed but gone from disk → the user deleted it here; stamp a tombstone.
    for (const [name, entry] of this.index) {
      if (seen.has(name) || entry.deleted) continue;
      this.clock += 1;
      touched.push([name, entry]);
      this.index.set(name, { clock: this.clock, deviceId: this.deviceId, hash: "", deleted: true });
      ops.push({ file: name, clock: this.clock, deviceId: this.deviceId, hash: "", deleted: true });
    }
    if (ops.length && !this.persist()) {
      for (const [name, prev] of touched) prev ? this.index.set(name, prev) : this.index.delete(name);
      this.clock = prevClock;
      return [];
    }
    return ops;
  }

  /**
   * Apply a teammate's op if its version beats ours. Writes are tmp+rename so a reader never
   * sees a torn file; the Lamport clock advances past the remote stamp so our NEXT local write
   * is ordered after everything we've seen. See ApplyResult for the outcome contract — the
   * caller retries "failed" (local fault), and drops everything else.
   */
  applyRemote(op: SyncOp): ApplyResult {
    if (!isSyncableName(op.file)) return "stale";
    if (!Number.isInteger(op.clock) || op.clock < 1 || op.clock > MAX_CLOCK || typeof op.deviceId !== "string" || !op.deviceId) return "stale";
    const local = this.index.get(op.file);
    if (local && !versionWins(op, local)) return "stale";
    const prevClock = this.clock;
    const abs = this.fileFor(op.file);
    if (op.deleted) {
      // Unlink BEFORE the tombstone persists: if the rm fails, our index keeps the live entry,
      // the peer's tombstone still wins the next exchange, and the delete retries — instead of
      // a durable tombstone + a still-present file being re-detected as a fresh create
      // (which would resurrect the deleted file team-wide).
      let existed = false;
      try { rmSync(abs); existed = true; } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
          console.error("[team] delete failed (will retry):", op.file, String(err).slice(0, 120));
          return "failed";
        }
      }
      this.clock = Math.max(this.clock, op.clock);
      this.index.set(op.file, { clock: op.clock, deviceId: op.deviceId, hash: "", deleted: true });
      if (!this.persist()) {
        local ? this.index.set(op.file, local) : this.index.delete(op.file);
        this.clock = prevClock;
        return "failed"; // file may already be gone; retry re-runs the (idempotent) delete
      }
      return existed && !!local && !local.deleted ? "applied" : "noop";
    }
    let content: Buffer;
    try { content = Buffer.from(String(op.contentB64 ?? ""), "base64"); } catch { return "stale"; }
    if (content.length > MAX_SYNC_BYTES) return "stale";
    if (sha256(content) !== op.hash) return "stale"; // corrupt/forged content never lands
    // An oversized on-disk file is local content the index does not represent (it stopped
    // syncing at the cap) — no remote stamp may clobber it.
    try {
      const cur = statSync(abs);
      if (cur.isFile() && cur.size > MAX_SYNC_BYTES) {
        if (!this.warnedOversize.has(op.file)) {
          this.warnedOversize.add(op.file);
          console.error(`[team] refusing to overwrite oversized unsynced file: ${op.file}`);
        }
        return "stale";
      }
    } catch { /* absent is fine */ }
    try {
      const tmp = abs + ".swb-tmp";
      writeFileSync(tmp, content, { mode: 0o600 });
      renameSync(tmp, abs);
      const st = statSync(abs);
      this.clock = Math.max(this.clock, op.clock);
      this.index.set(op.file, { clock: op.clock, deviceId: op.deviceId, hash: op.hash, mtimeMs: st.mtimeMs, size: st.size });
      if (!this.persist()) {
        local ? this.index.set(op.file, local) : this.index.delete(op.file);
        this.clock = prevClock;
        return "failed"; // content landed but the stamp didn't stick — retry is idempotent
      }
      return "applied";
    } catch (err) {
      console.error("[team] apply failed (will retry):", op.file, String(err).slice(0, 120));
      return "failed";
    }
  }

  /** The digest exchanged on (re)connect: versions only, no content. */
  summary(): IndexSummary {
    const out: IndexSummary = {};
    for (const [name, e] of this.index) out[name] = { clock: e.clock, deviceId: e.deviceId, hash: e.hash, ...(e.deleted ? { deleted: true as const } : {}) };
    return out;
  }

  /** Which of MY files the peer needs, given their summary: everything where my version wins
   *  (including tombstones) or they've never heard of. Equal bytes do NOT suppress a winning
   *  stamp — the peer must adopt it, or its own next edit would carry a losing clock and be
   *  silently rejected team-wide. Content is loaded fresh per op. */
  opsFor(theirs: IndexSummary): SyncOp[] {
    const ops: SyncOp[] = [];
    for (const [name, mine] of this.index) {
      const their = theirs[name];
      if (their && typeof their.clock === "number" && typeof their.deviceId === "string" && !versionWins(mine, their as FileVersion)) continue;
      if (mine.deleted) {
        ops.push({ file: name, clock: mine.clock, deviceId: mine.deviceId, hash: "", deleted: true });
        continue;
      }
      try {
        const content = readFileSync(this.fileFor(name));
        ops.push({ file: name, clock: mine.clock, deviceId: mine.deviceId, hash: mine.hash, contentB64: content.toString("base64") });
      } catch { /* raced a local delete; the next scan will tombstone it */ }
    }
    return ops;
  }
}
