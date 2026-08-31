import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Context, ContextMeta, ContextSource } from "@relay/protocol";

/**
 * The user-owned CONTEXT LIBRARY — the shared layer above per-origin storage. Producers publish
 * whole context objects (e.g. brands); consumers read one ONLY when the user has SELECTED it for
 * their origin (selection = consent, set out of band from the panel).
 *
 * Two persisted files (0600):
 *   contexts.json          — the library: Context[] (id, name, kind, opaque data, source origin)
 *   context-selection.json — origin → contextId : which context each app is currently lent
 *
 * Enumeration is deliberately NOT exposed to apps here beyond their own published contexts; the
 * whole-library view (`listAll`) is for the panel/control channel only.
 */
export class ContextLibrary {
  private file: string;
  private selFile: string;
  private items = new Map<string, Context>();
  private selection = new Map<string, string>(); // origin → contextId
  private selMtime = 0;                           // mtime of selFile at our last read/write (foreign-change detector)

  constructor(stateDir: string) {
    this.file = join(stateDir, "contexts.json");
    this.selFile = join(stateDir, "context-selection.json");
    this.load();
  }

  private load() {
    try { if (existsSync(this.file)) for (const c of JSON.parse(readFileSync(this.file, "utf8")) as Context[]) this.items.set(c.id, c); }
    catch (err) { console.error("[context] load failed:", err); }
    this.reloadSel();
  }

  /** The selection file has OTHER writers (the menu-bar's project switch writes `*global*` straight to
   *  the file; god.mjs / autopilot read it directly). We used to load it once in the constructor and serve
   *  every read from memory — so a project switch was invisible to the daemon (stale context lent to apps)
   *  and, worse, the daemon rewrote the file from its stale map on any persist, snapping the switch back
   *  ("switching project isn't working", founder 2026-08-31). Make selection READ-THROUGH: re-read the file
   *  whenever its mtime changed, before every read AND before every mutation that rewrites it. Every writer
   *  (here and the menu-bar) persists immediately, so disk is always authoritative — replacing the map is safe. */
  private reloadSel() {
    try {
      if (!existsSync(this.selFile)) { this.selection.clear(); this.selMtime = 0; return; }
      const m = statSync(this.selFile).mtimeMs;
      if (m === this.selMtime) return;                 // unchanged since we last touched it
      const obj = JSON.parse(readFileSync(this.selFile, "utf8")) as Record<string, string>;
      this.selection = new Map(Object.entries(obj));
      this.selMtime = m;
    } catch (err) { console.error("[context] selection reload failed:", err); }
  }

  private persist() {
    try { writeFileSync(this.file, JSON.stringify([...this.items.values()], null, 2), { mode: 0o600 }); }
    catch (err) { console.error("[context] persist failed:", err); }
  }
  private persistSel() {
    try {
      writeFileSync(this.selFile, JSON.stringify(Object.fromEntries(this.selection), null, 2), { mode: 0o600 });
      try { this.selMtime = statSync(this.selFile).mtimeMs; } catch {}   // our own write isn't a foreign change
    }
    catch (err) { console.error("[context] selection persist failed:", err); }
  }

  /** Producer: create or update a context. `publishedBy` is the authoritative publishing origin (or a
   *  marker like "panel" for user-added sources). A `source` makes it externally-backed (CSV/Sheet). */
  publish(publishedBy: string, input: { id?: string; name: string; kind?: string; data?: unknown; source?: ContextSource }): Context {
    const id = input.id && this.items.has(input.id) ? input.id : (input.id || randomUUID());
    const ctx: Context = { id, name: input.name, kind: input.kind, data: input.data ?? null, source: input.source, publishedBy, updatedAt: Date.now() };
    this.items.set(id, ctx);
    this.persist();
    return ctx;
  }

  get(id: string): Context | null { return this.items.get(id) ?? null; }

  /** Cache a source-backed context's freshly resolved value (rows + fetchedAt). */
  setResolved(id: string, data: unknown, fetchedAt: number): void {
    const c = this.items.get(id);
    if (!c || !c.source) return;
    c.data = data;
    c.source = { ...c.source, fetchedAt };
    c.updatedAt = Date.now();
    this.persist();
  }

  /** Force the next read to re-fetch a source-backed context. */
  markStale(id: string): void {
    const c = this.items.get(id);
    if (c?.source) { c.source = { ...c.source, fetchedAt: 0 }; this.persist(); }
  }

  /** Consumer read: the ONE context an app currently sees — its own per-origin pick if it has one,
   *  else the user's GLOBAL "working on" project (`GLOBAL` key). One project selection thus scopes
   *  every connected app at once, while a per-app pick can still override it. Null if neither is set. */
  active(origin: string): Context | null {
    this.reloadSel();
    const id = this.selection.get(origin) ?? this.selection.get(GLOBAL);
    return id ? this.items.get(id) ?? null : null;
  }

  /** The user's global "working on" project — the default context lent to every app. */
  setActiveProject(contextId: string | null): void { this.select(GLOBAL, contextId); }
  activeProject(): string | null { this.reloadSel(); return this.selection.get(GLOBAL) ?? null; }

  /** Metadata for the caller's OWN published contexts — safe for an app to see (it made them). */
  listOwn(origin: string): ContextMeta[] {
    return [...this.items.values()].filter((c) => c.publishedBy === origin).map(meta).sort(byRecent);
  }

  /** The whole library — PANEL/control only, never handed to an app. */
  /** Panel-only: delete a context outright and clear any selections pointing at it. */
  remove(id: string): boolean {
    if (!this.items.delete(id)) return false;
    this.reloadSel();   // merge any out-of-band selection writes before we rewrite the file
    for (const [o, cid] of [...this.selection]) if (cid === id) this.selection.delete(o);
    this.persist();
    this.persistSel();
    return true;
  }

  listAll(): ContextMeta[] {
    return [...this.items.values()].map(meta).sort(byRecent);
  }

  /** Set (or clear, with null) which context an origin is lent. Panel-driven, out of band. */
  select(origin: string, contextId: string | null): void {
    this.reloadSel();   // pick up out-of-band writes (menu-bar *global*) before we rewrite the whole file
    if (contextId && this.items.has(contextId)) this.selection.set(origin, contextId);
    else this.selection.delete(origin);
    this.persistSel();
  }

  selectionFor(origin: string): string | null { this.reloadSel(); return this.selection.get(origin) ?? null; }
}

/** Reserved selection key for the user's global "working on" project (not a real origin). */
const GLOBAL = "*global*";

/** Pull up to 4 hex colours out of a context's opaque data (data.palette: [{hex}] | ["#.."]). */
function swatchesOf(data: unknown): string[] {
  const p = (data as any)?.palette;
  if (!Array.isArray(p)) return [];
  return p.map((c) => (typeof c === "string" ? c : c?.hex)).filter((h) => typeof h === "string" && /^#[0-9a-f]{3,8}$/i.test(h)).slice(0, 4);
}

const meta = (c: Context): ContextMeta => ({
  id: c.id, name: c.name, kind: c.kind, publishedBy: c.publishedBy, updatedAt: c.updatedAt,
  swatches: swatchesOf(c.data),
  sourceKind: c.source?.kind,
  rowCount: c.source ? (c.data as any)?.rowCount : undefined,
  folder: folderOf(c.data),
});
const byRecent = (a: ContextMeta, b: ContextMeta) => b.updatedAt - a.updatedAt;

/** A "project" context stores the folder it points at in `data.folder`. Pull it out for the panel
 *  (so a project shows its path) and so the Broker can bind an app's storage when the project is lent. */
export function folderOf(data: unknown): string | undefined {
  const f = (data as any)?.folder;
  return typeof f === "string" && f.trim() ? f.trim() : undefined;
}
