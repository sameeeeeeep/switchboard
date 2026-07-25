// Storage-key hygiene, shared by every wrapp that runs the two-tier persistence pattern
// (localStorage paints the first frame; relay.storage is the source of truth once connected).
//
// THE RULE: a relay.storage key maps 1:1 to a file — `<folder>/<key>.json` — so it must be a plain
// filename. The daemon enforces `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` (protocol STORAGE_KEY_RE)
// and rejects anything else outright.
//
// `:` IS NOT IN THAT ALPHABET, and that mattered: wrapps used to namespace with a colon
// ("adforge:state", "studio:sheet", "prism:workspace"). Every one of those daemon writes threw
// StorageKeyError, and every call site swallows storage errors as "not connected yet" — so the
// daemon tier NEVER worked for those wrapps, while the localStorage tier kept the app looking
// perfectly healthy. Colons are also genuinely unusable on disk: illegal in NTFS filenames, and on
// Windows `folder\app:state.json` is Alternate Data Stream syntax, so it would write a hidden
// stream that `list()` could never see. Since a bound folder is often a REAL user directory (an
// Obsidian vault, a project's source tree), keys have to be names those tools can display.
//
// So keys are namespaced with `-` now. These helpers carry the old localStorage data across.

/** Fold arbitrary text (a brand name, a slug) into the legal key alphabet. Use for any key segment
 *  that is INTERPOLATED rather than literal — spaces are outside the alphabet too, so
 *  `"studio-shotlist-" + "Acme Co"` is just as invalid as the colon it replaced. */
export function keySegment(text) {
  return String(text ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "default";
}

/**
 * One-time, in-place rename of a localStorage record: `oldKey` → `newKey`.
 *
 * Only the localStorage tier needs this. The daemon tier has nothing to migrate — by definition
 * nothing was ever written under the old colon keys, which is the bug being fixed. Safe to call on
 * every boot: it no-ops once the new key exists, and never clobbers newer data.
 */
export function migrateLocalKey(oldKey, newKey) {
  if (oldKey === newKey) return;
  try {
    if (localStorage.getItem(newKey) !== null) { localStorage.removeItem(oldKey); return; }
    const old = localStorage.getItem(oldKey);
    if (old === null) return;
    localStorage.setItem(newKey, old);
    localStorage.removeItem(oldKey);
  } catch { /* quota or blocked storage — the app just starts fresh, which is the old behaviour */ }
}

/** Convenience for the common shape: migrate a batch of `[oldKey, newKey]` pairs at module init. */
export function migrateLocalKeys(pairs) {
  for (const [oldKey, newKey] of pairs) migrateLocalKey(oldKey, newKey);
}
