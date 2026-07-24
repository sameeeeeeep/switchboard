// LIVESTORE — the shared "team-ready by construction" storage primitive for wrapps.
//
// Team Mode makes a bound folder MULTIPLAYER: a teammate's edit (or your own edit in Obsidian, or
// a git pull) lands as a file on disk, and the daemon fires a `permissionsChanged` nudge. A wrapp
// is "team-ready" when it does three things — and all three live HERE, not in each wrapp:
//
//   1. PER-RECORD storage: one logical item = one file. Sync is per-file last-writer-wins, so two
//      people editing DIFFERENT items never collide; a single `state.json` blob would let one
//      person's change clobber the other's. `collection()` gives you this shape for free.
//   2. RE-READ ON THE NUDGE: subscribe to `permissionsChanged` (+ tab-visible) and reload, throttled,
//      with a reentrancy guard so overlapping nudges share one read. `mountLive()` is exactly this.
//   3. TOLERATE churn: files appear and vanish between renders (a teammate created/deleted one). The
//      collection re-reads the whole set each time and never assumes a key it saw last time still exists.
//
// A wrapp using `collection()` + `mountLive()` is multiplayer without knowing Team Mode exists — and
// behaves identically when solo (no teammates ⇒ no nudges ⇒ it's just normal storage). Nothing here
// talks to Team Mode directly; it rides the same `relay.storage` + `permissionsChanged` surface every
// wrapp already has, so it works against any Switchboard daemon, old or new.
//
//   const notes = collection(relay, "note");          // files: note-<id>.json
//   await notes.put(id, { text, at });                // one record, one file
//   const all = await notes.all();                    // [{ id, ...record }], churn-tolerant
//   const live = mountLive(relay, reload, { onError });// reload() re-runs on every teammate change
//   // ... live.reloadNow() to force one; live.stop() on teardown.

/** Conservative record id: a plain filename segment, NO dots (so it can't collide with a literal
 *  `.md`/`.html` key or smuggle a second extension). Wrapps mint ids with uid() (alphanumeric);
 *  this guards against a hostile or malformed one. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,96}$/;
const safeId = (id) => (ID_RE.test(String(id)) ? String(id) : null);

/**
 * A per-record collection. Each record is its own file, so concurrent edits to DIFFERENT records
 * merge cleanly under Team Mode's per-file LWW. Values are plain JSON objects; the id rides in the
 * key, carried back on read as `.id`.
 *
 * KEY DIALECT (important): the storage layer appends `.json` to a non-literal key itself, and it
 * strips `.json` back off in `list()`. So the KEY we use is `<name>-<id>` (no extension) — on disk
 * it becomes `<name>-<id>.json`, and `list()` hands it back as `<name>-<id>`. We never write the
 * `.json` ourselves (that would produce a double-suffixed `<name>-<id>.json.json`).
 */
export function collection(relay, name) {
  if (!relay?.storage) throw new Error("collection(relay, name): relay.storage is required");
  const prefix = String(name).replace(/[^A-Za-z0-9]/g, "") || "rec";
  const keyOf = (id) => `${prefix}-${id}`; // storage appends .json
  const idOf = (key) => key.slice(prefix.length + 1);
  // Our keys only: `<prefix>-<id>` where id passes ID_RE (no dots) — so a literal file like
  // `<prefix>-x.md` (list keeps its extension) is excluded, and a sibling collection can't bleed in.
  const mine = (key) => key.startsWith(prefix + "-") && !!safeId(idOf(key));

  return {
    /** All records as `[{ id, ...record }]`. Re-reads the whole set — a record that vanished since
     *  last call simply isn't here; one that appeared is. Order is by id (stable across members). */
    async all() {
      let keys = [];
      try { keys = await relay.storage.list(); } catch { return []; }
      const ids = keys.filter(mine).map(idOf).sort();
      const out = await Promise.all(ids.map(async (id) => {
        try { const raw = await relay.storage.get(keyOf(id)); if (raw == null) return null; return { id, ...JSON.parse(raw) }; }
        catch { return null; } // a torn/half-synced file this tick — the next nudge re-reads it
      }));
      return out.filter(Boolean);
    },
    async get(id) {
      const sid = safeId(id); if (!sid) return null;
      try { const raw = await relay.storage.get(keyOf(sid)); return raw == null ? null : { id: sid, ...JSON.parse(raw) }; }
      catch { return null; }
    },
    /** Upsert one record. The stored value never includes `id` (it's in the filename). */
    async put(id, record) {
      const sid = safeId(id); if (!sid) throw new Error("collection.put: invalid id");
      const { id: _drop, ...body } = record || {};
      await relay.storage.set(keyOf(sid), JSON.stringify(body));
      return sid;
    },
    async remove(id) {
      const sid = safeId(id); if (!sid) return false;
      try { return await relay.storage.delete(keyOf(sid)); } catch { return false; }
    },
    key: keyOf,
  };
}

/**
 * Wire a wrapp's `reload` to fire whenever reality may have moved — a teammate's sync, your own
 * edit in another window, a git pull, an Obsidian save — WITHOUT a per-wrapp file-watcher:
 *   • the daemon's `permissionsChanged` event (Team Mode's storage-changed nudge rides this), and
 *   • the tab becoming visible again (covers edits made while this tab was backgrounded).
 * Throttled (default 1.5s) with a reentrancy guard, so a burst of nudges collapses into one read.
 * Returns a handle: `reloadNow()` forces one immediately (bypasses the throttle); `stop()` unwires.
 *
 * `reload` may be async; overlapping calls share its in-flight promise. Errors go to `opts.onError`
 * (or are swallowed) so a transient read failure never wedges the subscription.
 */
export function mountLive(relay, reload, opts = {}) {
  const throttleMs = opts.throttleMs ?? 1500;
  let last = 0;
  let inflight = null;
  let stopped = false;

  const run = () => {
    if (inflight) return inflight;
    last = Date.now();
    inflight = Promise.resolve()
      .then(() => reload())
      .catch((e) => { try { opts.onError?.(e); } catch { /* ignore */ } })
      .finally(() => { inflight = null; });
    return inflight;
  };
  const throttled = () => { if (stopped || !relay) return; if (Date.now() - last < throttleMs) return; void run(); };

  const onVisible = () => { if (document.visibilityState === "visible") throttled(); };
  document.addEventListener("visibilitychange", onVisible);
  try { relay?.on?.("permissionsChanged", throttled); } catch { /* older provider without on() */ }

  return {
    /** Force a reload now, ignoring the throttle (shares any in-flight read). */
    reloadNow: () => run(),
    /** Unwire — call on teardown. */
    stop: () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      try { relay?.removeListener?.("permissionsChanged", throttled); } catch { /* ignore */ }
    },
  };
}
