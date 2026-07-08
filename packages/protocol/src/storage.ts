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

/** The operation a claude_storage request performs. */
export type StorageOp = "get" | "set" | "list" | "delete" | "bind" | "info";

export interface StorageRequest {
  op: StorageOp;
  /** Record key for get/set/delete. Namespaced within the origin's folder as `<key>.json`.
   *  Constrained to `[A-Za-z0-9._-]` (no separators / traversal). */
  key?: string;
  /** Value to persist for `set` (opaque string; apps typically store JSON). */
  value?: string;
  /** For `bind`: the folder path the user is asked to authorize (absolute, or `~`-relative). */
  path?: string;
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
