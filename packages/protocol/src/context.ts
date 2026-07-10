/**
 * claude_context — the shared, cross-app CONTEXT primitive. Unlike claude_storage (private per
 * origin), a context is a whole, portable object you OWN and can lend to another app: an agency
 * builds a brand once and loads it into any wrapper (ad generator, landing builder, email tool),
 * all on their own compute. BYO context.
 *
 * A context is deliberately OPAQUE and un-schema'd — `data` is whatever the producing app puts
 * there (a whole brand blob). Ship fast; normalize later. What's locked is the SECURITY, not the
 * shape:
 *   - An app can `publish` contexts and `list`/read only the ones IT published.
 *   - An app reads someone else's context ONLY via `active` — the ONE context the user SELECTED
 *     for that app in the side panel. Selection = consent, set out of band. No selection → null.
 *   - Apps can NEVER enumerate the whole library; only the panel (control channel) can.
 */

/** A context can be BACKED BY an external source the user already keeps — most usefully a Google
 *  Sheet published as CSV. The daemon fetches + parses it to JSON on demand (cached), so a spreadsheet
 *  becomes live shared context with zero new infra. Read-only. */
export interface ContextSource {
  /** "csv" = any published CSV URL (incl. a Google Sheet's export/publish-to-web CSV link). */
  kind: "csv" | "gsheet";
  /** The CSV URL to fetch. Public/published — the daemon fetches it directly (no connector needed). */
  url: string;
  /** Epoch ms of the last successful fetch (for cache/TTL). */
  fetchedAt?: number;
}

/** A whole, shareable context object. `data` is opaque app-defined JSON (e.g. a full brand), OR the
 *  cached rows resolved from `source`. */
export interface Context {
  id: string;
  name: string;
  /** Free-form type tag, e.g. "brand". Not an enum — apps agree by convention, not lock. */
  kind?: string;
  /** The whole payload. Opaque to the daemon; the consuming app interprets it. For a source-backed
   *  context this holds the last resolved value ({ columns, rows, ... }). */
  data: unknown;
  /** When set, this context is backed by an external source and `data` is its cached resolution. */
  source?: ContextSource;
  /** Origin that published it (or a marker like "panel" for user-added sources). */
  publishedBy?: string;
  updatedAt: number;
}

/** Lightweight metadata for pickers/lists — never includes `data`. */
export interface ContextMeta {
  id: string;
  name: string;
  kind?: string;
  publishedBy?: string;
  updatedAt: number;
  /** Up to a few brand colours (hex) pulled from the context, so the panel can show a project in its
   *  own palette. Metadata only — not the payload. */
  swatches?: string[];
  /** Set when the context is backed by an external source (e.g. "csv"/"gsheet") — the panel badges it
   *  as live data and shows its row count. */
  sourceKind?: "csv" | "gsheet";
  rowCount?: number;
}

export type ContextOp = "publish" | "active" | "list" | "pick" | "use";

export interface ContextRequest {
  op: ContextOp;
  /** For `publish`: the context to save. Omit `id` to create; pass it to update in place. */
  context?: { id?: string; name: string; kind?: string; data: unknown };
  /** For `use`: the id of a listed context to read (and become this app's selection). */
  id?: string;
}

export interface ContextResult {
  ok: boolean;
  /** For `active` / `pick`: the whole selected context, or null. */
  context?: Context | null;
  /** For `list`: the caller's OWN published contexts, plus library metadata for any kinds the
   *  user granted at connect (ScopeRequest.contextKinds) — names, never data. */
  contexts?: ContextMeta[];
  /** For `publish`: the stored id. */
  id?: string;
  error?: string;
}
