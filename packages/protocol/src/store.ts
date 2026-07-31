/**
 * The wrapp store — a listing is a BILL OF MATERIALS, not "a web app" (docs/WRAPP-STORE-MODAL.md §2).
 *
 * A wrapp is a composition of COMPONENTS (Axis A — what it's made of: skills, workflows, ui) plus a
 * declaration of which SURFACES it can be consumed on (Axis B — how you run it: god, batch, browser,
 * window, notch). The two axes are orthogonal; the same components may support several surfaces at
 * once, mounted over the identical `window.claude` contract — the wrapp never learns where it landed.
 *
 * `requires` is deliberately the SAME currency as the readiness ladder's unmet needs (health.ts /
 * STATES.md): a requirement is just an unmet need declared ahead of time, so the install-time resolver
 * reuses the ladder wholesale instead of inventing a second one. This file is types + pure functions
 * only (the `validateListing` / `resolveRequirements` / `primaryAction` trio), same posture as
 * `deriveStage`: one shared derivation so the native modal and any web renderer can never disagree.
 *
 * The standing law (DESIGN.md): honesty is a design constraint. The resolver never claims a capability
 * is present without checking, and the primary button is surface-aware so it never says Run and walls you.
 */

/** A skill the wrapp activates into God — a path under a skills root ("yc/register"). */
export type SkillRef = string;
/** A workflow the wrapp can run headless — a named/pathed workflow ("yc/batch-draft"). */
export type WorkflowRef = string;

/** Where the wrapp's UI code lives, when it has one. Absent `ui` = a headless wrapp. */
export type UiRef =
  | { kind: "web"; url: string } // a deployed Pages wrapp (<id>.thelastprompt.ai)
  | { kind: "native"; appId: string; download: DownloadRef };

/** How to obtain a companion native app (a `window`/`notch` wrapp shipped as a `.app`). */
export interface DownloadRef {
  url: string;
  /** bytes — shown at consent time so a download is never a surprise (Prohibited-actions posture). */
  size?: number;
}

/** Axis B — how a wrapp can be MOUNTED. Order in a listing = preference; `surfaces[0]` is the default.
 *    • god     — skill(s) worn by God; conversational, no UI. Run becomes "Activate into God".
 *    • batch   — workflow(s) run headless (God or a routine kicks them off).
 *    • browser — UI mounted in a browser tab (deep-link out).
 *    • window  — the same web UI framed in an in-app webview.
 *    • notch   — a small UI mounted as an ambient notch widget (the flagship surface). */
export type Surface = "god" | "batch" | "browser" | "window" | "notch";

/** Axis A — the bill of materials. Any subset; absent `ui` = headless. */
export interface WrappComponents {
  skills?: SkillRef[]; // prompt/knowledge layer
  workflows?: WorkflowRef[]; // orchestration
  ui?: UiRef; // optional shell + skin
}

/** A capability the daemon provides, gated per-origin (docs/CAPABILITIES.md + God's-eye/TTS). */
export type CapabilityName =
  | "sb_db" | "sb_http" | "sb_secrets" | "sb_exec"
  | "sb_speak" | "vision" | "screen-record";

/** What must hold before a wrapp runs. Diffed against `PresentState` by `resolveRequirements`.
 *  `lazy: true` (a capability only needed by one feature, e.g. `screen-record` for auto-demo capture)
 *  is EXCLUDED from the install gate and resolved in context the first time that feature fires. */
export type Requirement =
  | { kind: "capability"; name: CapabilityName; lazy?: boolean }
  | { kind: "connector"; id: string } // an origin grant / MCP connector
  | { kind: "model"; class: "cloud" | "local" } // needs inference of a class
  | { kind: "native"; appId: string } // a companion native app must be installed
  | { kind: "daemon" }; // the Mac app must be running

export type WrappCategory = "studio" | "tool" | "fun" | "agent" | "skill";

/** ONE listing = the object the store renders. This is exactly what a wrapp repo ships as its
 *  `switchboard.json` (manifest-in-repo, ingested — WRAPP-STORE-MODAL.md §9): the wrapp OWNS its
 *  listing; the aggregator only collects and validates them. */
export interface WrappListing {
  id: string; // "brandbrain", "yc-answers", "prism"
  name: string;
  tagline: string; // one line, shop-window copy
  icon?: string; // generated app icon (STORE-REDESIGN.md); falls back to a glyph
  category: WrappCategory;

  /** Axis A — the bill of materials. */
  components: WrappComponents;
  /** Axis B — the declared surfaces, in preference order. `surfaces[0]` is the launch default. */
  surfaces: Surface[];
  /** What must hold before it runs. */
  requires: Requirement[];

  /** Optional shop-window extras, mirroring the reference detail pane (HeyClicky Skills Library):
   *  a short list of what's inside, and who made it. Never fabricated relevance — no installs/ratings. */
  inside?: string[]; // "the YC dialect + live RFS hooks", "draft every answer at once"
  author?: string;
}

// ─────────────────────────── validation (the §2 consistency rule) ───────────────────────────

/** A surface IMPLIES a component: `god`⟹skills, `batch`⟹workflows, any UI surface⟹`ui`. The store
 *  validates this so a listing can't promise a surface it has no material for. Returns the list of
 *  problems (empty = valid), so an ingestion step can reject a malformed `switchboard.json` loudly. */
export function validateListing(l: WrappListing): string[] {
  const errs: string[] = [];
  if (!l.id) errs.push("missing id");
  if (!l.name) errs.push("missing name");
  if (!l.surfaces || l.surfaces.length === 0) errs.push("a listing must declare at least one surface");
  const has = (k: keyof WrappComponents) => l.components?.[k] != null &&
    (k === "ui" ? true : (l.components[k] as unknown[]).length > 0);
  for (const s of l.surfaces ?? []) {
    if (s === "god" && !has("skills")) errs.push("surface 'god' requires components.skills");
    if (s === "batch" && !has("workflows")) errs.push("surface 'batch' requires components.workflows");
    if ((s === "browser" || s === "window" || s === "notch") && !has("ui"))
      errs.push(`surface '${s}' requires components.ui`);
  }
  return errs;
}

// ─────────────────────────── the install-time resolver (read-only in Phase 1) ───────────────────────────

/** What is present RIGHT NOW, from the surfaces that already know it (the menubar derives most of this
 *  today). A superset so the resolver is total; every field a listing might name is answerable. */
export interface PresentState {
  daemonRunning: boolean;
  signedIn: boolean;
  models: { cloud: boolean; local: boolean };
  /** per-origin capabilities already consented for this wrapp. */
  capabilities?: readonly CapabilityName[];
  /** connector ids already granted. */
  connectors?: readonly string[];
  /** native appIds already installed. */
  natives?: readonly string[];
}

/** A requirement's live status. `lazy` is neither met nor unmet at install time — it's shown as ⧗
 *  ("on use") and excluded from the gate, so you only pay for what you actually invoke. */
export type ReqState = "met" | "unmet" | "lazy";

export interface ResolvedRequirement {
  requirement: Requirement;
  state: ReqState;
  /** a one-line, honest label for the rung (never a spinner that dead-ends). */
  label: string;
}

function reqLabel(r: Requirement): string {
  switch (r.kind) {
    case "daemon": return "Mac app awake";
    case "model": return r.class === "cloud" ? "Signed in · a cloud model" : "A local model";
    case "capability": return r.name;
    case "connector": return `connect ${r.id}`;
    case "native": return `install ${r.appId}`;
  }
}

function isMet(r: Requirement, p: PresentState): boolean {
  switch (r.kind) {
    case "daemon": return p.daemonRunning;
    case "model": return r.class === "cloud" ? p.models.cloud : p.models.local;
    case "capability": return (p.capabilities ?? []).includes(r.name);
    case "connector": return (p.connectors ?? []).includes(r.id);
    case "native": return (p.natives ?? []).includes(r.appId);
  }
}

/** Diff a listing's `requires` against what's present. Pure — the native modal and any web renderer
 *  call THIS instead of each re-deriving "what's missing?" (and disagreeing). Lazy capabilities are
 *  reported as `lazy`, never `unmet`, so Run lights up without them. */
export function resolveRequirements(l: WrappListing, p: PresentState): ResolvedRequirement[] {
  return (l.requires ?? []).map((requirement) => {
    const lazy = requirement.kind === "capability" && requirement.lazy === true;
    const state: ReqState = lazy ? "lazy" : isMet(requirement, p) ? "met" : "unmet";
    return { requirement, state, label: reqLabel(requirement) };
  });
}

/** The count that gates Run — unmet, non-lazy requirements. */
export function unmetCount(resolved: readonly ResolvedRequirement[]): number {
  return resolved.filter((r) => r.state === "unmet").length;
}

// ─────────────────────────── the surface-aware primary button (§5.1) ───────────────────────────

export type PrimaryKind = "activate" | "run" | "resolve" | "get";

export interface PrimaryAction {
  kind: PrimaryKind;
  label: string;
  /** the surface this action will launch on (`surfaces[0]`). */
  surface: Surface;
}

/** THE ONE button derivation. Honest and surface-aware so it never says "Run" then walls you:
 *    • surfaces[0] === "god"      → "Activate into God"  (a pure skill is activated, not "run")
 *    • a UI wrapp not yet obtained → "Get {name}"        (native download still ahead)
 *    • unmet needs remain          → "Resolve N thing(s) & Run"
 *    • all met                     → "Run"                                                        */
export function primaryAction(l: WrappListing, resolved: readonly ResolvedRequirement[]): PrimaryAction {
  // Empty surfaces is a validateListing error; fall back to a safe default so this stays total.
  const surface: Surface = l.surfaces[0] ?? "browser";
  if (surface === "god") return { kind: "activate", label: "Activate into God", surface };
  const uiMissing = l.components.ui?.kind === "native" &&
    resolved.some((r) => r.requirement.kind === "native" && r.state === "unmet");
  if (uiMissing) return { kind: "get", label: `Get ${l.name}`, surface };
  // A page/host is OPENED — its own in-page consent handles capabilities, so the store never says
  // "resolve" for something it doesn't gate. Only daemon-launched surfaces gate on unmet needs.
  if (surface === "browser" || surface === "window" || surface === "notch")
    return { kind: "run", label: "Open", surface };
  const n = unmetCount(resolved);
  if (n > 0) return { kind: "resolve", label: `Resolve ${n} thing${n > 1 ? "s" : ""} & Run`, surface };
  return { kind: "run", label: "Run", surface };
}
