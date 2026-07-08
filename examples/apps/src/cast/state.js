// The Account document — Cast's unit of work — plus its persistence, lock/cascade, and publish.
// An Account replaces the old flat Persona: it is a production that walks the pipeline in spec.js,
// carrying its locks, generated option cards, base assets, calendar, scripts and shots on itself so
// the whole thing survives a reload or a switch (brandbrain's "cards live on the brand" trick).
// Cast still holds no data of its own — every Account lives in the user's own claude_storage under
// "account:<id>", and the locked persona is published as a shareable CONTEXT for other wrapps.
import { STAGE_IDS, FACET_IDS, FACETS, facetAt, cardSummary } from "./spec.js";

export const newId = () => "a_" + Math.random().toString(36).slice(2, 9);
export const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// A fresh, empty Account parked at the first stage.
export function blankAccount() {
  return {
    id: newId(),
    handle: "",
    stage: "reference",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    brand: null, // the ONE brand context lent from Switchboard — a {id,name,kind,data} snapshot
    reference: { brief: "", niche: "", inspirations: [], moodNotes: "", locked: false },
    foundation: { locks: {}, cards: {}, more: {}, auto: {} }, // more: facetId → extra picks for select:many
    assets: { face: null, setting: null, wardrobe: [], cast: [] }, // each asset: {id?,url,status,approved,prompt}
    calendar: { slots: [] },  // {id,date,pillar,title,angle,source,status,approved}
    scripts: {},              // slotId → {beats:[{shot,line}],approved,status}
    productions: {},          // slotId → {shots:[{id,desc,url,status,approved}],stitchedUrl,approved,status}
  };
}

// ---------- storage (the user's claude_storage — Cast's private DB) ----------
export async function loadAccounts(relay) {
  try {
    const keys = (await relay.storage.list()).filter((k) => k.startsWith("account:"));
    const raw = await Promise.all(keys.map((k) => relay.storage.get(k)));
    return raw.map(safeParse).filter(Boolean).map(migrate).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

export async function persist(relay, a) {
  a.updatedAt = Date.now();
  try {
    await relay.storage.set("account:" + a.id, JSON.stringify(a));
    // Publish the locked persona as a shareable context so other wrapps (UGC, ads, shorts) can run
    // on it — but only once there's a real face and a locked person to stand behind.
    if (a.assets?.face?.approved && a.foundation?.locks?.persona) {
      await relay.context.publish({ id: a.id, name: personaName(a), kind: "persona", data: personaContext(a) });
    }
  } catch { /* offline / mock — the mock store still holds it */ }
}

// The public, portable shape other wrapps receive — a flattened persona, not Cast's internal doc.
export function personaContext(a) {
  const f = a.foundation?.locks || {};
  return {
    name: personaName(a),
    niche: a.reference?.niche || "",
    brand: a.brand ? { id: a.brand.id, name: a.brand.name } : null, // which brand this persona creates for
    persona: cardSummary(f.persona),
    voice: cardSummary(f.voice),
    aesthetic: cardSummary(f.aesthetic),
    setting: cardSummary(f.setting),
    audience: cardSummary(f.audience),
    pillars: pillarList(a).map(cardSummary),
    face: a.assets?.face?.url || null,
    wardrobe: (a.assets?.wardrobe || []).filter((x) => x.approved).map((x) => ({ name: x.name, url: x.url })),
    locations: a.assets?.setting?.url ? [{ name: "Setting", url: a.assets.setting.url }] : [],
  };
}
export function personaName(a) {
  return (a.foundation?.locks?.persona?.title || a.handle || "Untitled account").trim();
}
// The pillars the founder actually picked (select:many): the primary lock + any extra "more" picks.
export function pillarList(a) {
  const locks = a.foundation?.locks || {}, more = a.foundation?.more || {};
  const out = [];
  if (locks.pillars) out.push(locks.pillars);
  (more.pillars || []).forEach((c) => out.push(c));
  return out;
}

// ---------- lock + cascade ----------
// Lock a card for a facet. When a facet that others depend on changes, its dependents' generated
// cards go stale — we clear them so the assembly board re-researches them in the new light. This is
// brandbrain's lock cascade: a late change never leaves a downstream decision quietly inconsistent.
export function lockFacet(a, facetId, card, opts = {}) {
  const fnd = a.foundation;
  const prev = fnd.locks[facetId];
  const facet = facetAt(facetId);
  if (facet.select === "many") {
    // toggle membership; first pick is the primary lock, the rest live in `more`
    const all = [prev, ...(fnd.more[facetId] || [])].filter(Boolean);
    const has = all.find((c) => c.id === card.id);
    const next = has ? all.filter((c) => c.id !== card.id) : [...all, card];
    fnd.locks[facetId] = next[0] || null;
    fnd.more[facetId] = next.slice(1);
    if (!fnd.locks[facetId]) delete fnd.locks[facetId];
  } else {
    fnd.locks[facetId] = card;
  }
  delete fnd.auto[facetId];
  const changed = !prev || prev.id !== card.id;
  if (changed) cascadeStale(a, facetId);
  return staleDependents(facetId);
}

export function unlockFacet(a, facetId) {
  delete a.foundation.locks[facetId];
  delete a.foundation.more[facetId];
  delete a.foundation.auto[facetId];
  cascadeStale(a, facetId);
}

// Clear generated cards for every facet that (transitively) depends on `facetId`, so they regenerate
// against the new lock. Locks on dependents are kept but flagged auto-stale via the cleared cards.
function cascadeStale(a, facetId) {
  for (const dep of staleDependents(facetId)) {
    delete a.foundation.cards[dep];
  }
}
// The facet ids that depend on `facetId`, directly or transitively.
export function staleDependents(facetId) {
  const out = new Set();
  const walk = (id) => {
    for (const f of FACETS) if (f.deps.includes(id) && !out.has(f.id)) { out.add(f.id); walk(f.id); }
  };
  walk(facetId);
  return [...out];
}

// Is a facet ready to generate? (all its deps are locked)
export function facetUnlocked(a, facetId) {
  return facetAt(facetId).deps.every((d) => a.foundation.locks[d]);
}
// The kanban column a facet sits in, derived (never stored) from locks + cards + loading.
export function facetStatus(a, facetId, loading) {
  const fnd = a.foundation;
  if (fnd.locks[facetId]) return "locked";
  if (loading?.has?.(facetId)) return "researching";
  if (fnd.cards[facetId]?.length) return "ready";
  if (!facetUnlocked(a, facetId)) return "blocked";
  return "queued";
}

// ---------- stage gating ----------
// Whether the account has satisfied a stage's advance condition (spec STAGES[i].advance).
export function stageReady(a, stageId) {
  switch (stageId) {
    case "reference": return !!a.reference?.locked;
    case "foundation": return FACET_IDS.every((id) => a.foundation.locks[id]);
    case "assets": return !!(a.assets?.face?.approved && a.assets?.setting?.approved);
    case "calendar": return (a.calendar?.slots || []).some((s) => s.approved);
    case "scripts": return Object.values(a.scripts || {}).some((s) => s.approved);
    case "produce": return Object.values(a.productions || {}).some((p) => p.approved);
    default: return false;
  }
}
// The furthest stage the account is allowed to be on (can't skip an unmet gate).
export function reachableStage(a) {
  let last = STAGE_IDS[0];
  for (let i = 0; i < STAGE_IDS.length; i++) {
    last = STAGE_IDS[i];
    if (!stageReady(a, STAGE_IDS[i])) break;
    if (i + 1 < STAGE_IDS.length) last = STAGE_IDS[i + 1];
  }
  return last;
}
// Overall completion 0..1 across all six gates — drives the stepper's progress line.
export function progress(a) {
  const done = STAGE_IDS.filter((id) => stageReady(a, id)).length;
  return done / STAGE_IDS.length;
}

// ---------- migration: adopt an old flat Persona into the new Account shape ----------
// Old Cast stored "persona:*" as {name,niche,vibe,story,look,wardrobe,locations,cast}. If we find one
// (or a half-built new doc), fold it forward so nobody loses work.
export function migrate(doc) {
  if (doc && doc.stage && doc.foundation) return doc; // already an Account
  const a = blankAccount();
  if (!doc) return a;
  a.id = doc.id || a.id;
  a.handle = doc.name || doc.handle || "";
  a.reference = { brief: doc.story || "", niche: doc.niche || "", inspirations: [], moodNotes: doc.vibe || "", locked: !!(doc.niche || doc.story) };
  if (doc.name) {
    a.foundation.locks.persona = { id: newId(), title: doc.name, subtitle: doc.niche || "", body: doc.story || "" };
    if (doc.vibe) a.foundation.locks.voice = { id: newId(), title: "Imported voice", body: doc.vibe };
  }
  if (doc.look?.referenceImage) a.assets.face = { url: doc.look.referenceImage, status: "done", approved: true };
  a.assets.wardrobe = (doc.wardrobe || []).map((w) => ({ id: w.id || newId(), name: w.name, url: w.referenceImage, status: "done", approved: true }));
  if (doc.locations?.[0]) a.assets.setting = { url: doc.locations[0].referenceImage, status: "done", approved: true, name: doc.locations[0].name };
  a.assets.cast = (doc.cast || []).map((c) => ({ id: c.id || newId(), name: c.name, url: c.referenceImage, relationship: c.relationship, status: "done", approved: true }));
  a.stage = reachableStage(a);
  return a;
}
