// Idea-OS — the "operating system per sector" as DATA + one pure function (docs/IDEA-OS.md).
//
// An Idea OS is NOT a new app or a new engine. It is a COMPOSITION of things already in the catalog
// (docs/IDEA-OS.md §1): a named, project-scoped bundle of existing store items — wrapps + skills +
// routines + connectors + a home + a daily loop — selected BY SECTOR and grounded in ONE context.
// This module is exactly that, expressed the way §5 Phase 0 asks for it: a JSON/TS-shaped registry of
// six `Kit` rows referencing REAL catalog ids by role, plus a pure `fitKit(sector, context)` step.
//
// PURE ESM, NO DOM. This file imports cleanly in Node (a headless fit call / a test) and in a browser
// bundle (a future store install card). Nothing here touches document/window/localStorage.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// SPEC NOTE FOR THE MAIN THREAD — the additive `Kit` type in packages/protocol/src/store.ts.
// (This module owns the DATA; it deliberately does NOT edit store.ts. Lift the following interface in
//  when you wire the store install card — it composes `WrappListing` by id and forks no model, exactly
//  in the spirit of store.ts's "an item type is not a new data model" law. docs/IDEA-OS.md §2.1.)
//
//   export type SectorId =
//     | "saas" | "dtc" | "agency" | "creator" | "local" | "marketplace";
//
//   /** A member of a Kit: a catalog id tagged by role. `core` installs day-one (the spine); `grow`
//    *  is one tap away later (progressive disclosure, §4.5). `pending:true` = the ref isn't built
//    *  yet (⧗ Reachout) — rendered as a labelled "coming" slot, never as a broken install. */
//   export interface KitItem { ref: string; role: "core" | "grow"; why: string; pending?: boolean; }
//
//   /** A routine the Kit declares as a standing grant (the shell / §1 layer 5). `action` names the
//    *  core seam it ticks (e.g. adpulse `analyze`, reachout `tick`). `pending` mirrors KitItem. */
//   export interface RoutineRef {
//     id: string; ref: string; action: string; schedule: string;
//     tier: "daemon" | "claude-code"; why: string; pending?: boolean;
//   }
//
//   /** An honest gap (§2.4): a sector-critical job with no wrapp today. Rendered as a labelled slot
//    *  "— <slot> · no wrapp yet · [request it]", which doubles as the roadmap / ＋Create hook. */
//   export interface KitGap { slot: string; why: string; }
//
//   /** The Bank home layout for this sector (§1 layer 2): the hero context kind + facet chips. */
//   export interface HomeLayout { hero: string; facets: string[]; sections: string[]; }
//
//   /** A Kit is a META-LISTING: it never carries UI or a model of its own — it POINTS AT listings
//    *  that do. Resolving its requirements is just resolveRequirements() run over the union of its
//    *  members' `requires`, deduped (store.ts:162). Install gate / lazy-exclusion / ladder — reused. */
//   export interface Kit {
//     id: string;                    // "os-dtc"
//     sector: SectorId;              // 1:1 from ideabrain's detected category (§2.2)
//     name: string;                  // "The DTC operating system"
//     tagline: string;
//     spineKinds: string[];          // which context kinds ground it: ["brand"] | ["project"] | …
//     items: KitItem[];              // members: catalog ids tagged core|grow
//     routines: RoutineRef[];        // the shell (EMAIL-WRAPP.md §3 shape)
//     connectors: Requirement[];     // { kind:"connector", id } needs surfaced on the ladder
//     home: HomeLayout;
//     dailyLoop: string[];           // the shell narrative (§3), shown + used to seed routines
//     gaps: KitGap[];                // §2.4 — named, not faked
//   }
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The six Idea-OS sectors (docs/IDEA-OS.md §2.2). */
export const SECTORS = ["saas", "dtc", "agency", "creator", "local", "marketplace"];

/** ideabrain's 7 IDEA_TEMPLATES → sector (§2.2). Many-to-one (saas pulls 3) and one-to-many
 *  (`retail` splits DTC vs local by one follow-up question — "do you ship, or do people come to
 *  you?"). We default `retail` to DTC (the flagship, catalog is D2C-native) unless a `physical`
 *  hint says brick-and-mortar. */
export const SECTOR_OF_TEMPLATE = {
  saas: "saas", app: "saas", feature: "saas", hardware: "saas",
  retail: "dtc", // physical hint → "local"; see sectorFromCategory
  general: "agency", // services reading; a `creator` hint routes to "creator"
  marketplace: "marketplace",
};

/** Resolve ideabrain's detected category (+ optional disambiguation hints) to a sector id. Pure.
 *  hints: { physical?:bool (retail → local), creator?:bool (general → creator) }. */
export function sectorFromCategory(category, hints = {}) {
  const c = String(category || "").toLowerCase().trim();
  if (SECTORS.includes(c)) return c; // already a sector id
  let sector = SECTOR_OF_TEMPLATE[c] || null;
  if (c === "retail" && hints.physical) sector = "local";
  if ((c === "general" || c === "app") && hints.creator) sector = "creator";
  return sector; // null when unrecognized — the caller asks one follow-up rather than guessing
}

// Small builders so the six rows read as data, not boilerplate.
const item = (ref, role, why, pending = false) => ({ ref, role, why, pending });
const routine = (id, ref, action, schedule, why, { tier = "daemon", pending = false } = {}) =>
  ({ id, ref, action, schedule, tier, why, pending });
const connector = (id) => ({ kind: "connector", id });
const gap = (slot, why) => ({ slot, why });

/** Refs that don't exist in catalog.json yet — marked ⧗ so `fitKit` reports them as pending slots,
 *  never as installable members. Reachout's core is being built; its ROUTINE (the cadence sender,
 *  routine #2) rides the unmerged routines branch, so every reachout routine is `pending:true`. */
export const PENDING_REFS = new Set(["reachout"]);

// ─────────────────────────────── the six Kit rows (docs/IDEA-OS.md §3) ───────────────────────────────
// Every non-pending `ref` is a real id in examples/apps/wrapps/catalog.json. Members are tagged
// core (day-one spine) vs grow (progressive, §4.5). ⧗ refs are marked pending.

/** @type {Record<string, import('./kits.js').Kit>} */
export const KITS = {
  // 3.1 — SaaS / software: "ship it and reach the first users"
  saas: {
    id: "os-saas", sector: "saas",
    name: "The SaaS operating system", tagline: "Ship it and reach the first users.",
    spineKinds: ["project", "brand"],
    items: [
      item("ideabrain", "core", "The thesis — already run; kept for pivots."),
      item("redline", "core", "Line-by-line review of the landing page & docs."),
      item("marquee", "core", "A landing page that ships to a domain."),
      item("batch", "core", "Run one prompt across a list — changelogs, release notes."),
      item("autopilot", "core", "Plans the week, makes the moves."),
      item("huddle", "grow", "A working call with Claude over the real files."),
      item("meetnotes", "grow", "Transcript → notes + action items."),
      item("saas", "grow", "Re-run the thesis on a pivot."),
      item("feature", "grow", "Make the case for one feature."),
    ],
    routines: [
      routine("saas-standup", "standup", "run", "daily 09:00", "A standup drafted from last night's commits."),
      routine("saas-plan", "autopilot", "plan", "weekly Mon 08:00", "Lay out the week."),
      routine("saas-reachout", "reachout", "tick", "daily 09:00", "B2B outreach drafts staged nightly (routine #2).", { pending: true }),
    ],
    connectors: [connector("github"), connector("gmail"), connector("granola")],
    home: { hero: "project", facets: ["repo", "this week's plan", "the daily loop"], sections: ["Ship", "Reach", "Review"] },
    dailyLoop: [
      "overnight → reachout stages personalized outreach drafts · autopilot lays out the week",
      "morning   → Bank hero: project + this week's plan · standup drafted from last night's commits · approve the outreach sends at the notch (draft-not-send)",
      "in-flow   → God wears commit/errslate/shell as you code · redline reviews the landing before ship",
      "weekly    → marquee refreshes the page · batch writes the release notes",
    ],
    gaps: [
      gap("Billing / subscriptions", "No metering or checkout wrapp — a labelled slot, not faked."),
      gap("Analytics ingest", "No product-analytics wrapp yet."),
      gap("In-app support inbox", "No support-triage wrapp yet."),
    ],
  },

  // 3.2 — E-commerce / DTC brand: "run the brand" (the flagship; catalog is D2C-native)
  dtc: {
    id: "os-dtc", sector: "dtc",
    name: "The DTC operating system", tagline: "Run the brand.",
    spineKinds: ["brand"],
    items: [
      item("brandbrain", "core", "The brand system + home studio."),
      item("adpulse", "core", "Find the wasted ad spend."),
      item("adforge", "core", "Draft this week's ads from the brand."),
      item("prism", "core", "On-brand images."),
      item("shelf", "core", "Keep inventory honest."),
      item("adgen", "grow", "A wall of ad variations at once (Adwall)."),
      item("aplus", "grow", "Amazon A+ content in bulk."),
      item("studio", "grow", "Product photography on your own models."),
      item("reel", "grow", "Short-form video."),
      item("marquee", "grow", "A campaign landing page."),
      item("cast", "grow", "Personas for content."),
    ],
    routines: [
      routine("dtc-adpulse", "adpulse", "analyze", "weekly Mon 07:00", "Roll up spend, flag the leaks."),
      routine("dtc-adforge", "adforge", "run", "weekly Mon 07:00", "This week's ad drafts staged."),
      routine("dtc-shelf", "shelf", "triage", "weekly Wed 07:00", "Reorder / watch / dead-weight on a cadence."),
    ],
    connectors: [connector("shopify"), connector("meta-ads"), connector("gmail")],
    home: { hero: "brand", facets: ["brand", "sales", "3 SKUs to reorder"], sections: ["Make", "Sell", "Stock"] },
    dailyLoop: [
      "overnight → adpulse rolls up yesterday's spend and flags the leaks · adforge drafts this week's ads",
      "morning   → Bank hero: brand + sales + '3 SKUs to reorder' (shelf) · this week's ad drafts waiting",
      "in-flow   → Prism/studio shoot the week's creative on the palette · God wears caption/hooks for posts",
      "weekly    → reel + repurpose turn one shoot into every channel · aplus refreshes the Amazon page",
    ],
    gaps: [
      gap("Order management / fulfilment", "No OMS wrapp — labelled, not faked."),
      gap("Customer-support inbox", "No support wrapp yet."),
      gap("Returns flow", "No returns wrapp yet."),
      gap("Email-marketing sender", "Reachout is B2B outbound, not consumer broadcast — an honest boundary."),
    ],
  },

  // 3.3 — Agency / services: "win work and deliver it, per client"
  agency: {
    id: "os-agency", sector: "agency",
    name: "The agency operating system", tagline: "Win work and deliver it, per client.",
    spineKinds: ["project", "brand", "personal"],
    items: [
      item("reachout", "core", "New-business outreach.", true),
      item("redline", "core", "Review client deliverables."),
      item("meetnotes", "core", "Transcript → notes + action items."),
      item("batch", "core", "One prompt across a client roster."),
      item("huddle", "grow", "A working call with Claude."),
      item("marquee", "grow", "Client landing pages."),
      item("brandbrain", "grow", "A brand per client."),
      item("recap", "grow", "Long thread → recap."),
      item("identity", "grow", "A visual identity per client."),
    ],
    routines: [
      routine("agency-reachout", "reachout", "tick", "daily 09:00", "Keep the new-business pipeline warm while away.", { pending: true }),
      routine("agency-meetnotes", "meetnotes", "run", "on new transcript", "Auto-run on a new meeting transcript."),
      routine("agency-plan", "autopilot", "plan", "weekly Mon 08:00", "Plan across clients."),
    ],
    connectors: [connector("gmail"), connector("granola"), connector("gdrive"), connector("clickup")],
    home: { hero: "project", facets: ["today's client", "what's due", "the pipeline"], sections: ["Win", "Deliver", "Recap"] },
    dailyLoop: [
      "overnight → reachout advances the new-business cadence · action items from yesterday's calls land on the board",
      "morning   → Bank hero switched to today's client · what's due · the pipeline",
      "in-flow   → meetings → meetnotes → owners/dues on the board · God wears reply/recap between calls",
      "per-deliverable → redline reviews before it goes to the client",
    ],
    gaps: [
      gap("Invoicing / billing", "No billing wrapp — the clearest 'build next' slot."),
      gap("Contract / e-sign", "No contract wrapp yet."),
      gap("Time-tracking", "No time-tracking wrapp yet."),
      gap("Proposal builder", "No proposal wrapp yet."),
    ],
  },

  // 3.4 — Creator / media: "make it, cut it, ship it everywhere"
  creator: {
    id: "os-creator", sector: "creator",
    name: "The creator operating system", tagline: "Make it, cut it, ship it everywhere.",
    spineKinds: ["persona"],
    items: [
      item("identity", "core", "A visual identity from a few words."),
      item("cast", "core", "Personas you direct."),
      item("take", "core", "A recording script."),
      item("cut", "core", "Transcript → captions + a cut list."),
      item("reel", "core", "Short-form video."),
      item("prism", "grow", "Thumbnails / visuals."),
      item("studio", "grow", "Product / set photography."),
      item("marquee", "grow", "A link-in-bio / launch page."),
    ],
    routines: [
      routine("creator-repurpose", "repurpose", "run", "content-calendar cadence", "One piece → every channel."),
      routine("creator-hooks", "hooks", "run", "weekly Sun 18:00", "A hooks/titles batch for the upcoming slate."),
    ],
    connectors: [connector("tiktok"), connector("gmail"), connector("gdrive")],
    home: { hero: "persona", facets: ["persona", "this week's slate", "the cut list"], sections: ["Record", "Dress", "Spread"] },
    dailyLoop: [
      "record → take gives the script · you shoot · cut turns the transcript into captions + a cut list",
      "dress  → prism/reel make the thumbnail and the promo cut on the persona's look",
      "spread → repurpose fans one piece into X / LinkedIn / IG / short-form · God wears caption/hooks/titles",
      "weekly → the persona keeps every caption in one voice; identity refreshes the look for a series",
    ],
    gaps: [
      gap("Scheduler / auto-poster", "Publish stays a human act by design — no auto-poster."),
      gap("Analytics / retention", "No creator-analytics wrapp yet."),
      gap("Comment-management inbox", "No comment wrapp yet."),
    ],
  },

  // 3.5 — Local / brick-and-mortar: "run the shop"
  local: {
    id: "os-local", sector: "local",
    name: "The local operating system", tagline: "Run the shop.",
    spineKinds: ["brand", "personal"],
    items: [
      item("shelf", "core", "Inventory honesty — the most load-bearing wrapp here."),
      item("retail", "core", "Reality-check a concept / expansion."),
      item("adforge", "core", "Local promos."),
      item("marquee", "core", "A simple shopfront site."),
      item("reel", "grow", "Short-form promo."),
      item("prism", "grow", "On-brand images."),
      item("meetnotes", "grow", "Supplier / staff notes."),
      item("huddle", "grow", "A working call."),
    ],
    routines: [
      routine("local-shelf", "shelf", "triage", "weekly Mon 07:00", "Reorder cadence."),
      routine("local-reply", "reply", "run", "daily 09:00", "Draft replies to new customer messages (draft-not-send)."),
    ],
    connectors: [connector("gmail"), connector("pos"), connector("google-business")],
    home: { hero: "brand", facets: ["today's takings", "reorder these", "a local promo"], sections: ["Stock", "Promote", "Plan"] },
    dailyLoop: [
      "morning → Bank hero: today's takings + 'reorder these' (shelf) · adforge has a local promo ready",
      "in-flow → God drafts replies to customer messages in your voice + address/hours from the personal card",
      "weekly  → retail pressure-tests the next move (a second location, a new line) before you commit",
    ],
    gaps: [
      gap("POS / till integration", "No POS wrapp — the most under-served sector, high roadmap value."),
      gap("Reservations / bookings", "No bookings wrapp yet."),
      gap("Loyalty", "No loyalty wrapp yet."),
      gap("Local-reviews management", "No reviews wrapp yet."),
    ],
  },

  // 3.6 — Marketplace: "get liquidity on both sides"
  marketplace: {
    id: "os-marketplace", sector: "marketplace",
    name: "The marketplace operating system", tagline: "Get liquidity on both sides.",
    spineKinds: ["project", "idea"],
    items: [
      item("mkt", "core", "Marketplace Validator — is it worth building?"),
      item("ideabrain", "core", "The marketplace-template thesis."),
      item("reachout", "core", "Supply-side onboarding — the exact risk ideabrain flags.", true),
      item("adpulse", "core", "Demand-side acquisition efficiency."),
      item("batch", "grow", "Outreach across a supply list."),
      item("marquee", "grow", "A two-sided landing."),
      item("redline", "grow", "Review the two-sided page."),
      item("autopilot", "grow", "Plan the week across both sides."),
    ],
    routines: [
      routine("mkt-reachout", "reachout", "tick", "daily 09:00", "Onboard supply while you sleep.", { pending: true }),
      routine("mkt-adpulse", "adpulse", "analyze", "weekly Mon 07:00", "Demand-side CAC rollup."),
    ],
    connectors: [connector("gmail"), connector("meta-ads"), connector("payments"), connector("crm")],
    home: { hero: "project", facets: ["supply added vs demand served", "both sides' health", "the liquidity thesis"], sections: ["Supply", "Demand", "Balance"] },
    dailyLoop: [
      "overnight → reachout onboards supply while you sleep · adpulse watches demand-side CAC",
      "morning   → Bank hero: the liquidity dashboard — supply added vs. demand served · both sides' health",
      "in-flow   → mkt keeps the liquidity thesis honest as numbers come in · God wears coldemail/objection for supply calls",
      "weekly    → the two-sided balance is the north-star; the OS surfaces which side is starving",
    ],
    gaps: [
      gap("Payments / escrow", "No payments wrapp — marketplaces need real backend."),
      gap("Trust & safety / disputes", "No dispute wrapp yet."),
      gap("Matching engine", "No matching wrapp — the OS is the go-to-market layer, and says so."),
    ],
  },
};

// ─────────────────────────── a self-contained requirement resolver (mirrors store.ts) ───────────────────────────
// docs/IDEA-OS.md §4.3 step 2 says resolve a Kit's requirements with store.ts's resolveRequirements
// (store.ts:162) over the deduped union of the members' `requires`. This module can't import the TS
// resolver (and must not edit store.ts), so it carries a SMALL pure mirror below — same shape, same
// lazy-exclusion rule — for headless fit + tests. WIRING NOTE: at store integration, replace
// `resolveKitRequirements` with the real `resolveRequirements` run over the member listings' `requires`.

/** A one-line honest label for a requirement (mirrors store.ts reqLabel). */
function reqLabel(r) {
  switch (r.kind) {
    case "daemon": return "Mac app awake";
    case "model": return r.class === "cloud" ? "Signed in · a cloud model" : "A local model";
    case "capability": return r.name;
    case "connector": return `connect ${r.id}`;
    case "native": return `install ${r.appId}`;
    default: return String(r.kind);
  }
}
function isMet(r, p) {
  switch (r.kind) {
    case "daemon": return !!p.daemonRunning;
    case "model": return r.class === "cloud" ? !!p.models?.cloud : !!p.models?.local;
    case "capability": return (p.capabilities ?? []).includes(r.name);
    case "connector": return (p.connectors ?? []).includes(r.id);
    case "native": return (p.natives ?? []).includes(r.appId);
    default: return false;
  }
}
const reqKey = (r) => `${r.kind}:${r.id ?? r.name ?? r.class ?? r.appId ?? ""}`;

/** Dedupe a list of requirements by identity (kind + id/name/class/appId). Pure. */
export function dedupeRequirements(reqs) {
  const seen = new Map();
  for (const r of reqs) if (!seen.has(reqKey(r))) seen.set(reqKey(r), r);
  return [...seen.values()];
}

/** Resolve requirements against present state. Mirrors store.ts:162 (lazy capabilities → "lazy"). */
export function resolveKitRequirements(reqs, present = {}) {
  return dedupeRequirements(reqs).map((requirement) => {
    const lazy = requirement.kind === "capability" && requirement.lazy === true;
    const state = lazy ? "lazy" : isMet(requirement, present) ? "met" : "unmet";
    return { requirement, state, label: reqLabel(requirement) };
  });
}

// ─────────────────────────── the fit step (docs/IDEA-OS.md §4.3, Phase 1) ───────────────────────────

/**
 * fitKit — the one genuinely new seam. Given a sector (from ideabrain's detected category, §2.2) and
 * the established context (the spine, §2.3), produce the fitted OS: the Kit, the split members, the
 * resolved requirements (deduped connectors + daemon + model), the honest summed weight receipt (§1.2
 * R6), the pending ⧗ refs, and the gap slots (§2.4). PURE — no install, no I/O; a caller (a store
 * install card, an agent, or a test) renders/acts on the result.
 *
 * @param {string} sector - a sector id, OR an ideabrain category (mapped via sectorFromCategory).
 * @param {object|null} context - the active kind:"project"/"brand"/… context, or null (not yet bound).
 * @param {object} [opts] - { present?: PresentState, hints?: {physical?,creator?} }
 * @returns {object} the fitted OS (see fields below), or { error } when the sector is unknown.
 */
export function fitKit(sector, context = null, opts = {}) {
  const present = opts.present || {};
  const sid = SECTORS.includes(sector) ? sector : sectorFromCategory(sector, opts.hints || {});
  const kit = sid ? KITS[sid] : null;
  if (!kit) {
    return {
      error: `no Idea OS for sector ${JSON.stringify(sector)} — ask one follow-up (e.g. retail: "do you ship, or do people come to you?") rather than guessing.`,
      sector: sid || null,
    };
  }

  // Split members by role; separate the pending ⧗ refs so the card never offers a broken install.
  const buildable = kit.items.filter((i) => !i.pending && !PENDING_REFS.has(i.ref));
  const core = buildable.filter((i) => i.role === "core");
  const grow = buildable.filter((i) => i.role === "grow");
  const pending = kit.items.filter((i) => i.pending || PENDING_REFS.has(i.ref));

  // The spine: is a context bound, and does its kind match what the OS grounds on? (§2.3 — binding the
  // spine is what turns a pile of installed apps into an operating system.)
  const boundKind = context ? (context.kind || context?.data?.kind || null) : null;
  const grounded = !!context && (!boundKind || kit.spineKinds.includes(boundKind));
  const spine = {
    kinds: kit.spineKinds,
    bound: context ? { id: context.id, name: context.name, kind: boundKind } : null,
    grounded,
    note: !context
      ? `Point at your business once (a ${kit.spineKinds.join(" / ")} context) and every member opens pre-loaded.`
      : grounded ? "The whole OS opens pre-loaded on this context."
        : `Bound context is kind:${JSON.stringify(boundKind)}, but this OS grounds on ${JSON.stringify(kit.spineKinds)}.`,
  };

  // Requirements: the deduped union of the kit-level connectors + the always-on daemon + a cloud model.
  // (Member wrapps each add {kind:"daemon"} and a model class in catalog.json; at store integration
  // fitKit should union the members' real `requires` via store.ts resolveRequirements — see WIRING NOTE.)
  const baseReqs = [{ kind: "daemon" }, { kind: "model", class: "cloud" }, ...kit.connectors];
  const resolved = resolveKitRequirements(baseReqs, present);
  const routines = kit.routines.map((r) => ({ ...r, pending: r.pending || PENDING_REFS.has(r.ref) }));

  // The honest weight receipt (§1.2 R6): summed, before any Get button. Faces not engines — 0 MB now,
  // models load on use; routines sleep between fires.
  const weight = {
    wrapps: buildable.length,
    coreWrapps: core.length,
    growWrapps: grow.length,
    routines: routines.length,
    routinesPending: routines.filter((r) => r.pending).length,
    connectorsNeeded: resolved.filter((r) => r.requirement.kind === "connector" && r.state === "unmet").length,
    models: "load on use",
    downloadMB: 0,
    background: `${routines.length} routine${routines.length === 1 ? "" : "s"} that sleep between fires`,
    receipt: `${core.length} core wrapp${core.length === 1 ? "" : "s"} now · ${grow.length} more as you grow · 0 MB · models load on use · ${routines.length} routines that sleep`,
  };

  return {
    sector: sid,
    kit,
    spine,
    items: { core, grow, pending },
    resolved,
    connectors: kit.connectors,
    routines,
    weight,
    dailyLoop: kit.dailyLoop,
    gaps: kit.gaps,
    // Progressive install (§4.5): day one = spine + core; grow is one tap away later.
    install: { day1: core.map((i) => i.ref), later: grow.map((i) => i.ref) },
  };
}

/**
 * validateKits — the Phase 0 review gate (docs/IDEA-OS.md §5): every buildable member id must exist
 * in the catalog. Pass the catalog's listing ids (Set or array); returns problems (empty = valid),
 * the way validateListing validates a listing. Pending ⧗ refs are allowed to be absent.
 * @param {Iterable<string>} catalogIds
 * @returns {string[]}
 */
export function validateKits(catalogIds) {
  const ids = new Set(catalogIds);
  const problems = [];
  for (const [sid, kit] of Object.entries(KITS)) {
    if (kit.sector !== sid) problems.push(`${sid}: kit.sector ${JSON.stringify(kit.sector)} ≠ key ${JSON.stringify(sid)}`);
    for (const it of kit.items) {
      const isPending = it.pending || PENDING_REFS.has(it.ref);
      if (!isPending && !ids.has(it.ref)) problems.push(`${sid}: member ${JSON.stringify(it.ref)} not in catalog`);
    }
    for (const r of kit.routines) {
      const isPending = r.pending || PENDING_REFS.has(r.ref);
      if (!isPending && !ids.has(r.ref)) problems.push(`${sid}: routine ref ${JSON.stringify(r.ref)} not in catalog`);
    }
    if (!kit.items.some((i) => i.role === "core" && !i.pending && !PENDING_REFS.has(i.ref)))
      problems.push(`${sid}: no buildable core member (nothing to install day one)`);
  }
  return problems;
}

export default { SECTORS, KITS, fitKit, validateKits, sectorFromCategory, PENDING_REFS };
