/**
 * claude_storage — the per-origin local persistence primitive. This is the "self-contained
 * backend": an app gets a private, on-disk key/value store that only IT can touch, plus the
 * ability to have the user BIND that store to a real folder on their machine.
 *
 * SECURITY MODEL (mirrors the rest of BYOP — enforced OUT OF BAND by the daemon):
 *   - Every op is keyed to the browser-verified `RequestEnvelope.origin`; the folder is derived
 *     from that origin, never from page input. An app can only ever read/write its own store.
 *   - By DEFAULT the store auto-assigns a sandbox folder (~/.relay/storage/<origin>/) — like
 *     localStorage, no prompt: an app writing to its own private sandbox is not a consent event.
 *   - `bind` is the one privileged op: pointing the store at a real user folder (e.g. an existing
 *     project's `.data/`) is a filesystem-access escalation, so it ALWAYS requires an explicit
 *     human consent showing the exact absolute path. The bind is the consent; subsequent set/get
 *     against the bound folder don't re-prompt.
 *   - Writes (`set`/`delete`) are denied when the site's trust mode is "readonly".
 *
 * VALUE ENCODING: a record's value is an opaque UTF-8 string (apps store JSON). A key `k` maps
 * to the file `<folder>/<k>.json`, and the file's contents ARE the value verbatim. This is what
 * lets an app bind an existing project folder and have its current files (e.g. `workspace.json`)
 * appear as records with zero migration.
 */

/**
 * The canonical record-key alphabet, shared by the daemon (which enforces it) and the SDK (which
 * warns on it). Keys map 1:1 to files inside the origin's folder, so a key must be a plain
 * filename: no separators, nothing that could lead a traversal, and nothing a real filesystem
 * would refuse.
 *
 * NOTE FOR APP AUTHORS — `:` IS NOT IN THIS ALPHABET. Namespace with `-` or `.` instead
 * (`adforge-state`, not `adforge:state`). Colons are illegal in NTFS filenames, and on Windows
 * `folder\app:state.json` is Alternate Data Stream syntax — it would write a hidden stream rather
 * than a file, which `list()` could never see. Since a bound folder is frequently a REAL user
 * directory (an Obsidian vault, a project's source), keys have to be names those tools can show.
 */
export const STORAGE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** True when `key` is a legal record key. Kept next to STORAGE_KEY_RE so both tiers test identically. */
export function isValidStorageKey(key: unknown): key is string {
  return typeof key === "string" && STORAGE_KEY_RE.test(key);
}

/** The operation a claude_storage request performs. */
export type StorageOp = "get" | "set" | "list" | "delete" | "bind" | "info" | "pick";

export interface StorageRequest {
  op: StorageOp;
  /** Record key for get/set/delete. Namespaced within the origin's folder as `<key>.json`.
   *  Must match {@link STORAGE_KEY_RE} — `[A-Za-z0-9._-]`, no separators / traversal, NO colon. */
  key?: string;
  /** Value to persist for `set` (opaque string; apps typically store JSON). */
  value?: string;
  /** For `bind`: the folder path the user is asked to authorize (absolute, or `~`-relative). */
  path?: string;
  /** For `pick`: a short purpose line shown in the daemon's native folder dialog (sanitized and
   *  truncated daemon-side; the dialog always names the requesting origin regardless). */
  reason?: string;
}

/** Where an origin's storage currently resolves, surfaced by `info` / after `bind`. */
export interface StorageInfo {
  /** Absolute folder this origin's records live in right now. */
  folder: string;
  /** True when the folder was auto-assigned (private sandbox); false when user-bound to a real path. */
  autoAssigned: boolean;
  /** Number of records currently stored. */
  count: number;
}

export interface StorageResult {
  ok: boolean;
  /** For `get`: the stored value, or null when the key is absent. */
  value?: string | null;
  /** For `list`: the keys currently present (without the `.json` suffix). */
  keys?: string[];
  /** For `info` and a successful `bind`: where storage resolves. */
  info?: StorageInfo;
  /** Set when `ok` is false. */
  error?: string;
}
