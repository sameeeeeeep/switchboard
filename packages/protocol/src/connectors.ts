/**
 * The connector TAXONOMY and the needs RESOLVER (docs/STATES.md §5).
 *
 * The problem it solves — "if I have a different image connector, can the app not use that?": an app's
 * requirement today is a concrete tool-name string (`mcp__claude_ai_Higgsfield__*`), so the requirement
 * and the remedy are the same opaque thing and nothing can reason about it. This module adds the missing
 * layer: a CLASS per connector, a CLASS-level statement of need (`ScopeRequest.needs`, alongside `tools`),
 * and a pure resolver that turns "you asked for images, you have Leonardo not Higgsfield" into an offer.
 *
 * HARD BOUNDARIES (the moat, unchanged):
 *   • This is DECLARATIVE. The gate stays exact-match + fail-closed; nothing here grants anything.
 *   • Substitution is offered ONLY for a class the app EXPLICITLY declared as a `need` — never inferred
 *     from a `tools` entry. Declaring `needs` is the app's promise it calls that class GENERICALLY (it
 *     can take the substitute); an app hard-coded to one connector's tool names genuinely can't, so we
 *     must not pretend it can.
 *   • claude.ai connectors are inherited by the Agent SDK and live in no local file, so they are not
 *     enumerable here — the inventory degrades to `inherited: "unknown"` and the resolver says so rather
 *     than asserting absence.
 */

/** The capability a connector provides. One connector may carry several (Higgsfield is image + video).
 *  An unclassified connector carries NONE rather than a guessed class — a fact beats a lie. */
export type ConnectorClass =
  | "image" | "video" | "audio" | "design"
  | "store" | "ads" | "email" | "chat" | "meetings"
  | "files" | "data" | "docs" | "tasks" | "issues" | "code" | "search";

export interface ConnectorMeta {
  /** Human label for the connector, e.g. "Higgsfield". */
  label: string;
  /** The classes this connector serves. Empty = deliberately unclassified. */
  classes: ConnectorClass[];
}

/** THE canonical connector table — label + classes — SHARED so the daemon, the extension and the store
 *  cannot drift (they used to each carry their own copy). UI-only facets (brand colour, glyph) stay in
 *  the surface that renders them; identity lives here. */
export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  higgsfield: { label: "Higgsfield", classes: ["image", "video"] },
  leonardo: { label: "Leonardo", classes: ["image"] },
  ideogram: { label: "Ideogram", classes: ["image"] },
  runway: { label: "Runway", classes: ["video"] },
  elevenlabs: { label: "ElevenLabs", classes: ["audio"] },
  shopify: { label: "Shopify", classes: ["store"] },
  gmail: { label: "Gmail", classes: ["email"] },
  drive: { label: "Drive", classes: ["files"] },
  sheets: { label: "Sheets", classes: ["data"] },
  meta: { label: "Meta Ads", classes: ["ads"] },
  web: { label: "Web", classes: ["search"] },
  clickup: { label: "ClickUp", classes: ["tasks"] },
  notion: { label: "Notion", classes: ["docs"] },
  github: { label: "GitHub", classes: ["code", "issues"] },
  figma: { label: "Figma", classes: ["design"] },
  canva: { label: "Canva", classes: ["design"] },
  slack: { label: "Slack", classes: ["chat"] },
  granola: { label: "Granola", classes: ["meetings"] },
  linear: { label: "Linear", classes: ["issues"] },
  // Deliberately unclassified — not providers of any single class in the taxonomy:
  claude: { label: "Claude", classes: [] },
  huggingface: { label: "Hugging Face", classes: [] },
};

/** Map a raw connector/server/tool id ("mcp__claude_ai_Higgsfield", "clickup", "WebSearch") to a
 *  CONNECTOR_META key, or null if unknown. Same normalise-then-contains rule the icon table uses, so
 *  the daemon and the panel resolve the same id to the same connector. */
export function connectorIdOf(raw: string): string | null {
  if (/^web(search|fetch)$/i.test(raw)) return "web";
  const s = raw.toLowerCase().replace(/^mcp__/, "").replace(/^claude_ai_/, "").replace(/[^a-z0-9]/g, "");
  if (!s) return null;
  if (CONNECTOR_META[s]) return s;
  for (const key of Object.keys(CONNECTOR_META)) if (s.includes(key)) return key;
  return null;
}

/** The classes a raw connector/tool id serves (empty if unknown or unclassified). */
export function classesFor(raw: string): ConnectorClass[] {
  const id = connectorIdOf(raw);
  return id ? CONNECTOR_META[id]!.classes : [];
}

/** The connector ids known to serve a class — the "known to work" names shown when a class is missing. */
export function connectorsInClass(cls: ConnectorClass): string[] {
  return Object.entries(CONNECTOR_META).filter(([, m]) => m.classes.includes(cls)).map(([id]) => id);
}

/** A CLASS-level statement of intent, declared by the app in `ScopeRequest.needs` ALONGSIDE `tools`.
 *  The consent UI reasons over this; the gate never sees it. */
export interface ConnectorNeed {
  /** The capability the app needs (e.g. "image"). */
  class: ConnectorClass;
  /** The app's happy path — connector ids it's built around, e.g. ["higgsfield"]. */
  prefer?: string[];
  /** Shown verbatim in the consent row. Untrusted; displayed, never executed. */
  why: string;
  /** Absent = the app is degraded-but-usable without it; true = it's a nice-to-have. */
  optional?: boolean;
}

/** What `listConnectors` reports — with an explicit honesty boundary between what we CAN enumerate
 *  (local MCP servers, exact) and what we cannot (claude.ai connectors, inherited by the SDK). */
export interface ConnectorInventory {
  /** From ~/.relay/mcp.json — enumerable, with exact tool names. */
  local: Array<{ id: string; label: string; classes: ConnectorClass[]; tools: string[] }>;
  /** claude.ai connectors. `"unknown"` until enumeration is solved — surfaces must say so, never
   *  assert absence. An array (someday) would carry the same shape minus per-tool names. */
  inherited: Array<{ id: string; label: string; classes: ConnectorClass[] }> | "unknown";
  /** Epoch ms this inventory was taken. */
  checkedAt: number;
}

export type NeedStatus =
  /** The preferred connector is available — silence is the correct UI. */
  | "met"
  /** A DIFFERENT connector in the same class is available — the substitution offer. */
  | "substitute"
  /** Nothing in the class, and we can see everything — name the known-good ones + the app's fallback. */
  | "missing"
  /** We can't enumerate (inherited is "unknown" and nothing local matches) — state it, offer to try. */
  | "unknown";

export interface NeedOutcome {
  need: ConnectorNeed;
  status: NeedStatus;
  /** Connector ids available in the need's class (preferred first). Non-empty for met/substitute. */
  available: string[];
  /** Exact tool names for the LOCAL available connectors — what a substitution adds to the grant so
   *  the gate (exact-match) will pass them. Empty for inherited connectors (tools not enumerable). */
  tools: string[];
  /** Known-good connector ids to suggest when the class is missing/unknown. */
  suggested: string[];
}

/** Resolve ONE need against an inventory (docs/STATES.md §5.5). Pure; the single place the four
 *  outcomes are decided, so every surface agrees. */
export function resolveNeed(need: ConnectorNeed, inv: ConnectorInventory): NeedOutcome {
  const local = inv.local.filter((c) => c.classes.includes(need.class));
  const inheritedArr = inv.inherited === "unknown" ? [] : inv.inherited.filter((c) => c.classes.includes(need.class));
  const localIds = local.map((c) => c.id);
  const available = dedupe([...localIds, ...inheritedArr.map((c) => c.id)]);
  const localTools = local.flatMap((c) => c.tools);
  const prefer = need.prefer ?? [];
  const preferredAvail = available.filter((id) => prefer.includes(id));

  if (preferredAvail.length) {
    return { need, status: "met", available: dedupe([...preferredAvail, ...available]), tools: localTools, suggested: [] };
  }
  if (available.length) {
    // A connector in the class exists, just not the preferred one → offer the substitution.
    return { need, status: "substitute", available, tools: localTools, suggested: [] };
  }
  // Nothing in the class is visible. If claude.ai connectors can't be seen, we genuinely can't tell —
  // the preferred one might be inherited. Otherwise it's a confident "you have none in this class".
  const suggested = dedupe([...prefer, ...connectorsInClass(need.class)]);
  return inv.inherited === "unknown"
    ? { need, status: "unknown", available: [], tools: [], suggested }
    : { need, status: "missing", available: [], tools: [], suggested };
}

export function resolveNeeds(needs: readonly ConnectorNeed[], inv: ConnectorInventory): NeedOutcome[] {
  return needs.map((n) => resolveNeed(n, inv));
}

function dedupe<T>(xs: T[]): T[] { return [...new Set(xs)]; }
