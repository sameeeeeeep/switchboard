/**
 * Per-origin permissions — the "wallet" that a site connects to. This is the unit the
 * daemon enforces on out of band. A site must `claude_connect` and be approved once;
 * thereafter every request is checked against the grant for its browser-verified origin.
 *
 * SECURITY: the origin is never taken from page-supplied data. The extension derives it
 * from the browser (content-script sender) and stamps it on every request. See the
 * `RequestEnvelope.origin` field, which the daemon treats as authoritative.
 */

/** A tool's danger class, decided OUT OF BAND by the daemon's policy table — never by the
 *  model and never from page input. Default-deny: an unclassified tool is `write`. */
export type ToolAccess = "read" | "write";

/** Consent tier implied by a tool's access class:
 *  - read  → pre-approvable once, within the origin's scope + budget.
 *  - write → per-action consent popup EVERY invocation; never bypassable, never delegated
 *            to the model. Covers writes, deletes, sends, purchases — anything irreversible
 *            or money-moving. */
export type ConsentTier = "preapproved" | "per-action";

export function consentTierFor(access: ToolAccess): ConsentTier {
  return access === "read" ? "preapproved" : "per-action";
}

/**
 * Per-origin trust mode — how writes are handled for this site. Set by the USER in the panel,
 * out of band; a site/prompt can never change its own mode. Budgets + allowlist still apply in
 * every mode, so even a trusted site is bounded.
 *   - ask       → every write needs a per-action consent (default; safest)
 *   - trust     → writes auto-approve for this site (the "bypass") — no per-action prompt
 *   - readonly  → writes are denied outright; reads only
 */
export type ConsentMode = "ask" | "trust" | "readonly";

/** A single tool the origin is allowed to see/use, with the access class the daemon assigned. */
export interface ToolGrant {
  /** Server-qualified tool name, e.g. "gmail__create_draft" or a built-in like "WebSearch". */
  name: string;
  access: ToolAccess;
}

/** Spend + rate ceilings enforced by the daemon per origin. A request that would exceed a
 *  budget is denied out of band, regardless of scope. */
export interface Budgets {
  /** Hard ceiling on model output+input tokens attributed to this origin per rolling day. */
  maxTokensPerDay: number;
  /** Hard ceiling on model/tool calls per rolling minute. */
  maxCallsPerMin: number;
}

/** The grant object stored (authoritatively) in the daemon and mirrored to the extension UI. */
export interface OriginGrant {
  /** Browser-verified origin, e.g. "https://shop.example". The permission key. */
  origin: string;
  /** How writes are handled for this site — the user's per-origin trust setting. Default "ask". */
  mode: ConsentMode;
  /** Model ids this origin may request. Empty = none. Maps to daemon model backends. */
  models: string[];
  /** USER-chosen model override. When set, the daemon runs THIS model regardless of which granted
   *  model the app asks for (BYO-compute: model choice is the user's, not the app's). Must be one of
   *  `models`; cleared if it ever falls out of grant. undefined = honor the app's requested model. */
  modelOverride?: string;
  /** Tools this origin may see/call, each with its assigned access class. */
  tools: ToolGrant[];
  budgets: Budgets;
  /** Context kinds this origin may LIST from the library (metadata; data reads stay per-item). */
  contextKinds?: string[];
  /** Epoch ms; the grant is invalid past this. undefined = no expiry. */
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** What a site asks for at connect() time. The user approves, narrows, or denies each field
 *  in the consent popup — the granted scope may be smaller than requested, never larger. */
export interface ScopeRequest {
  models?: string[];
  /** Tool names the site wants; the daemon resolves each to an access class and the user
   *  approves per-tool. Omit to request "read-only tools only". */
  tools?: string[];
  budgets?: Partial<Budgets>;
  /** Context kinds (e.g. ["brand"]) this app asks to SEE in the user's library — names/metadata
   *  only, rendered as its own consent row. Reading a context's DATA stays one-at-a-time via
   *  {op:"use"} and is audited; omitting this keeps the classic lent-only model. */
  contextKinds?: string[];
  /** Human-readable reason shown in the consent UI. Untrusted; displayed, never executed. */
  reason?: string;
}

export const DEFAULT_BUDGETS: Budgets = {
  maxTokensPerDay: 200_000,
  maxCallsPerMin: 30,
};

/**
 * TABSIDEKICK ("Unconnected Mode") principal. When a site has NOT opted into Switchboard, the
 * EXTENSION acts for the user on that page — reading its content and running tasks on the user's
 * own Claude — without the page ever touching the daemon. Those requests carry a principal of the
 * form `tabsidekick@<host>` in the SAME `origin` slot on the envelope, so grants, budgets, audit,
 * storage, and revoke are all keyed to it and stay STRUCTURALLY SEPARATE from any page grant on the
 * same host (`https://<host>`). The host still comes from the browser (the origin oracle derives it
 * from the active tab), never from the page or from user-typed text.
 */
export const TAB_PRINCIPAL_PREFIX = "tabsidekick@";

/** Build the TabSidekick principal for a browser-verified host (e.g. "canva.com"). */
export function tabPrincipal(host: string): string {
  return `${TAB_PRINCIPAL_PREFIX}${host}`;
}

/** Is this origin a TabSidekick principal (vs a real web origin)? */
export function isTabPrincipal(origin: string): boolean {
  return origin.startsWith(TAB_PRINCIPAL_PREFIX);
}

/** The host a TabSidekick principal is acting on, e.g. "canva.com" (empty if not a principal). */
export function hostOfTabPrincipal(origin: string): string {
  return isTabPrincipal(origin) ? origin.slice(TAB_PRINCIPAL_PREFIX.length) : "";
}
