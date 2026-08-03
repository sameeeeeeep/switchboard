// ideafetch — the existing-brand INGEST engine (docs/IDEAFETCH.md). The mirror image of ideabrain:
// ideabrain REASONS about a new idea; ideafetch GATHERS an existing one and turns it into the one
// `kind:"project"`/`kind:"brand"` context every wrapp grounds on. PURE ESM, NO DOM — so this file is
// node-checkable and the one model call ("structure these selections") is driveable headless with a
// mock `sb`, exactly like ideabrain.core.js's `brief`.
//
// Two seams live here:
//   1. THE READERS' SHAPES + the fact pool composer — a provenance-tagged candidate-fact pool the
//      define board seeds from and the publish shape composes over (docs/IDEAFETCH.md §2, §5).
//   2. THE DEFINE ENGINE — seedChips (pool → multi-select chips, zero model claims) + `structure`
//      (the SINGLE model call on Define: cluster near-dupes, name the project, INVENT NOTHING) +
//      composePublish (deterministic merge of readers + selections into one context, merge rules §5.2).
//
// The `sb_brand` daemon capability (the website reader) is NOT called here — it needs the raw provider
// and lives in the page (src/ideafetch.js). This file only defines the SHAPE ideafetch codes against,
// so the page and the daemon agent share one contract:
//
//   window.claude.request({ method: "sb_brand", params: { url: string, name?: string } })
//     => { domain, siteName?, description?, platform?, currency?, ogImage?,
//          palette: [{ hex, from }],                       // provenance-tagged, from served CSS
//          products: [{ short, price:number|null, type, url? }],
//          category?, priceRange?: { min, max }, socials: [{ label, url }],
//          reachable: boolean }                            // false ⇒ site couldn't be read — HONEST
//
export const SB_BRAND_METHOD = "sb_brand";

// ---------------------------------------------------------------------------------------------
// small helpers (mirrors of point.js / bank.js, kept local so this file has no imports)
// ---------------------------------------------------------------------------------------------
export const str = (v) => (typeof v === "string" ? v.trim() : "");
export const arr = (v, cap = 24) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, cap) : []);
export function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
export function parseJsonObject(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
const uniqCI = (list) => {
  const seen = new Set(), out = [];
  for (const v of list) { const k = String(v).toLowerCase().trim(); if (k && !seen.has(k)) { seen.add(k); out.push(String(v).trim()); } }
  return out;
};

// The four dimensions of "define your project" — order-free, all live at once (docs/IDEAFETCH.md §3.2).
export const DIMENSIONS = [
  { key: "category", label: "Category", note: "what kind of thing this is", cap: 2 },
  { key: "audience", label: "Audience", note: "who it's for", cap: 0 },
  { key: "essence", label: "Essence", note: "the non-negotiables that make it itself", cap: 0 },
  { key: "goals", label: "Goals", note: "what winning looks like right now", cap: 0 },
];

// ---------------------------------------------------------------------------------------------
// THE FACT POOL — every reader ends here (docs/IDEAFETCH.md §2). Provenance-tagged, additive.
// ---------------------------------------------------------------------------------------------
export function emptyPool() {
  return { name: "", kind: "project", domain: "", reachable: true, sources: [], brand: null, project: null, prose: null };
}

/** Map an `sb_brand` result (the website reader) into the pool's brand facts. Pure — the raw call
 *  happens in the page; this only normalizes what the daemon returned. */
export function poolFromBrand(res, url) {
  const palette = (Array.isArray(res?.palette) ? res.palette : [])
    .map((p) => ({ hex: str(p?.hex).toLowerCase(), from: str(p?.from) }))
    .filter((p) => /^#[0-9a-f]{6}$/.test(p.hex)).slice(0, 8);
  const products = (Array.isArray(res?.products) ? res.products : [])
    .map((p) => ({ short: str(p?.short), price: (typeof p?.price === "number" ? p.price : null), type: str(p?.type), url: str(p?.url) }))
    .filter((p) => p.short).slice(0, 24);
  const domain = str(res?.domain) || (() => { try { return new URL(/^https?:/i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return {
    name: str(res?.siteName) || domain,
    domain,
    description: str(res?.description),
    platform: str(res?.platform),
    currency: str(res?.currency),
    ogImage: str(res?.ogImage),
    category: str(res?.category),
    priceRange: res?.priceRange && typeof res.priceRange.min === "number" ? { min: res.priceRange.min, max: res.priceRange.max } : null,
    palette, products,
    socials: (Array.isArray(res?.socials) ? res.socials : []).map((s) => ({ label: str(s?.label), url: str(s?.url) })).filter((s) => /^https?:\/\//i.test(s.url)).slice(0, 8),
  };
}

/** Map a project reading (repo/folder) — the point.js PROJ_SHAPE facts — into pool project facts. */
export function poolFromProject(facts, reading, source) {
  return {
    summary: str(reading?.summary) || str(facts?.summary),
    state: str(reading?.state),
    status: str(facts?.status),
    stack: arr(facts?.stack, 12),
    packages: arr(facts?.packages, 12),
    docs: arr(facts?.docs, 10),
    files: arr(facts?.notableFiles ?? facts?.files, 10),
    links: (Array.isArray(facts?.links) ? facts.links : []).map((l) => ({ label: str(l?.label) || "link", url: str(l?.url) })).filter((l) => /^https?:\/\//i.test(l.url)).slice(0, 8),
    roadmap: arr(reading?.nextSteps ?? facts?.roadmap, 16),
    tasks: arr(facts?.tasks, 16),
    folder: str(source?.kind === "folder" ? source?.path : ""),
  };
}

// ---------------------------------------------------------------------------------------------
// SEEDING — pool → multi-select chips per dimension. ZERO model claims: every chip is a literal
// fact drawn from the user's own material, provenance attached. Unchecking is as meaningful as
// checking (docs/IDEAFETCH.md §3.2 "Seeding ≠ suggesting").
// ---------------------------------------------------------------------------------------------
export function seedChips(pool) {
  const chips = { category: [], audience: [], essence: [], goals: [] };
  const push = (dim, text, from, checked) => { const t = str(text); if (t) chips[dim].push({ text: t, from, checked: !!checked }); };
  const b = pool?.brand, p = pool?.project, pr = pool?.prose;

  if (b) {
    push("category", b.category, b.domain || "catalogue", true);
    for (const t of uniqCI((b.products || []).map((x) => x.type)).slice(0, 4)) push("category", t, "product type", false);
    if (b.audience) for (const a of String(b.audience).split(/[,;/]| and /).map(str).filter(Boolean).slice(0, 5)) push("audience", a, "brand copy", false);
    // essence: the brand's own words — oneLine/voice/positioning if present, else the meta description
    // sb_brand serves (its about/hero copy). Pre-check the first so a rich site starts asserted.
    push("essence", b.oneLine || b.description, "how the site introduces itself", true);
    push("essence", b.voice, "brand voice", false);
    push("essence", b.positioning, "positioning", false);
  }
  if (p) {
    for (const s of (p.stack || []).slice(0, 3)) push("category", s, "stack", false);
    push("essence", p.summary, "README summary", !!p.summary && !(b && b.oneLine));
    for (const r of (p.roadmap || []).slice(0, 6)) push("goals", r, "roadmap", false);
    for (const t of (p.tasks || []).slice(0, 6)) push("goals", t, "open task", false);
  }
  if (pr) {
    for (const line of (pr.cues || []).slice(0, 8)) push(line.dim || "essence", line.text, "pasted text", false);
  }
  // de-dupe within each dimension (case-insensitive), keep first (which carries the pre-check)
  for (const k of Object.keys(chips)) {
    const seen = new Set(); chips[k] = chips[k].filter((c) => { const key = c.text.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return chips;
}

/** The current selection set → a flat, deduped list per dimension (chip texts that are checked +
 *  any free-text the user added). This is the exact input the STRUCTURING call clusters over. */
export function collectSelections(chips, added) {
  const out = { category: [], audience: [], essence: [], goals: [] };
  for (const k of Object.keys(out)) {
    const fromChips = (chips?.[k] || []).filter((c) => c.checked).map((c) => c.text);
    const fromAdded = (added?.[k] || []).map(str).filter(Boolean);
    out[k] = uniqCI([...fromChips, ...fromAdded]);
  }
  return out;
}
export function selectionCount(sel) {
  return Object.values(sel || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

// ---------------------------------------------------------------------------------------------
// STRUCTURING — the SINGLE model call on Define. Its ONLY jobs: cluster near-duplicate selections,
// pick a project name/slug, and flatten to the CONTEXT-KINDS shape. It structurally CANNOT
// hallucinate a project the user didn't assert — the prompt hands it exactly the user's picks and
// forbids adding facts (docs/IDEAFETCH.md §3.3).
// ---------------------------------------------------------------------------------------------
export const STRUCTURE_SYSTEM =
  "You are ideafetch's structurer. The user has SELECTED, from a palette of facts drawn from their own " +
  "material, what their project is — its category, audience, essence, and goals. Your ONLY job is to " +
  "STRUCTURE those selections: cluster near-duplicates into a single clean phrase, pick a short project " +
  "name and slug, and write one honest one-line summary from the essence selections. You INVENT NOTHING: " +
  "never add a category, audience, essence, or goal the user did not select. Sentence case, tight, no " +
  "emoji. Output ONLY the JSON object — no prose, no markdown fences.";

export function buildStructurePrompt({ selections, name, kind, poolHint }) {
  const dim = (k) => (selections?.[k] || []).map((s) => `- ${s}`).join("\n") || "- (none — leave this empty, do not invent)";
  return [
    `The user is defining a ${kind === "brand" ? "brand" : "project"}${name ? ` they call "${name}"` : ""}.`,
    poolHint ? `Context read from their material (for naming only, do not add facts): ${poolHint}` : "",
    "THEIR SELECTIONS — cluster near-duplicates, keep the user's words, add nothing:",
    `CATEGORY:\n${dim("category")}`,
    `AUDIENCE:\n${dim("audience")}`,
    `ESSENCE:\n${dim("essence")}`,
    `GOALS:\n${dim("goals")}`,
    "Return ONLY this JSON:",
    `{"name":"short project name","slug":"kebab-case-slug","oneLine":"one honest sentence built ONLY from the essence selections","category":["clustered category phrases"],"audience":["clustered audience phrases"],"essence":["clustered essence phrases"],"goals":["clustered goal phrases"]}`,
  ].filter(Boolean).join("\n\n");
}

export function normalizeStructured(parsed, { selections, name, pool }) {
  const clamp = (v, fallback) => (Array.isArray(v) && v.length ? uniqCI(v.map(str).filter(Boolean)) : fallback);
  const s = selections || {};
  const nm = str(parsed?.name) || str(name) || str(pool?.name) || "Project";
  return {
    name: nm,
    slug: slug(parsed?.slug || nm) || slug(nm) || undefined,
    oneLine: str(parsed?.oneLine),
    category: clamp(parsed?.category, uniqCI(s.category || [])).slice(0, 2),
    audience: clamp(parsed?.audience, uniqCI(s.audience || [])),
    essence: clamp(parsed?.essence, uniqCI(s.essence || [])),
    goals: clamp(parsed?.goals, uniqCI(s.goals || [])),
  };
}

/**
 * THE ACTION (headless seam). Drive with a mock `sb` exactly like ideabrain's `brief`.
 * input: { selections:{category[],audience[],essence[],goals[]}, name?, kind?, pool? }
 * → { context: { id, name, kind, data } }  — a ready-to-publish CONTEXT-KINDS object.
 */
export async function structure(input, sb) {
  const selections = input?.selections || {};
  if (selectionCount(selections) === 0) throw new Error("define needs at least one selection: pass { selections } with checked facts.");
  const kind = input?.kind === "brand" ? "brand" : "project";
  const pool = input?.pool || null;
  const poolHint = pool ? [pool.name, pool.domain, pool.project?.summary].map(str).filter(Boolean).join(" · ").slice(0, 200) : "";
  const prompt = buildStructurePrompt({ selections, name: input?.name, kind, poolHint });

  let text = "";
  try {
    const res = await sb.complete({ prompt, system: STRUCTURE_SYSTEM, model: "sonnet", effort: "low" });
    text = res?.text || "";
  } catch (e) { throw new Error(`structuring failed: ${e?.message || e}`); }
  let parsed = parseJsonObject(text);
  if (!parsed) {
    const res2 = await sb.complete({ prompt: prompt + "\n\nReturn ONLY the JSON object — nothing else.", system: STRUCTURE_SYSTEM, model: "sonnet", effort: "low" });
    parsed = parseJsonObject(res2?.text || "");
  }
  if (!parsed) throw new Error("couldn't read a structured project from the reply — retry.");
  const structured = normalizeStructured(parsed, { selections, name: input?.name, pool });
  return { context: composePublish({ structured, pool, kind, priorFolder: input?.priorFolder }) };
}

// ---------------------------------------------------------------------------------------------
// COMPOSE — the six readers + the multi-select merge into ONE context (docs/IDEAFETCH.md §5).
// Merge rules §5.2: one stable id; user assertions beat model prose; `folder` is sticky; publish a
// SUPERSET; flatten palette/products to strings (paletteRich beside). Deterministic — the model only
// clustered the selections above; the composition never invents.
// ---------------------------------------------------------------------------------------------
export function composePublish({ structured, pool, kind, priorFolder }) {
  const b = pool?.brand || null;
  const p = pool?.project || null;
  const name = structured.name;
  const data = {};

  // essence → the human-facing understanding fields; the user's assertion wins over model prose.
  const oneLine = structured.oneLine || (b && b.oneLine) || (p && p.summary) || "";
  if (oneLine) { data.oneLine = oneLine; data.summary = oneLine; }
  if (structured.essence.length) { data.positioning = structured.essence[0]; data.voice = structured.essence.slice(0, 3).join("; "); data.essence = structured.essence; }
  if (structured.audience.length) data.audience = structured.audience.join(", ");
  if (structured.category.length) data.category = structured.category.join(" · ");
  if (structured.goals.length) { data.goals = structured.goals; data.roadmap = structured.goals; }

  // reader facts folded in as a SUPERSET — each consumer reads only the fields it knows.
  if (b) {
    if (b.palette?.length) { data.palette = b.palette.map((s) => s.hex); data.paletteRich = b.palette.map((s) => ({ hex: s.hex, name: s.from })); }
    if (b.products?.length) { data.products = b.products.map((x) => x.short); data.productsRich = b.products; }
    if (b.domain) data.domain = b.domain;
    if (b.ogImage) data.logo = b.ogImage;
    if (b.priceRange) data.priceRange = b.priceRange;
    if (b.socials?.length) data.socials = b.socials;
    if (!data.category && b.category) data.category = b.category;
  }
  if (p) {
    if (p.status) data.status = p.status;
    if (p.state) data.state = p.state;
    if (p.stack?.length) data.stack = p.stack;
    if (p.packages?.length) data.packages = p.packages;
    if (p.docs?.length) data.docs = p.docs;
    if (p.files?.length) data.files = p.files;
    if (p.links?.length) data.links = p.links;
    // roadmap: prefer the user's asserted goals; else carry the read roadmap forward (superset).
    if (!data.roadmap && p.roadmap?.length) data.roadmap = p.roadmap;
    if (p.tasks?.length) data.tasks = p.tasks;
  }
  // `folder` is sticky — never dropped by a later republish; it is what folderOf() reads to auto-bind.
  const folder = (p && p.folder) || str(priorFolder);
  if (folder) data.folder = folder;

  // provenance stays honest.
  const src = pool?.sources?.[pool.sources.length - 1] || null;
  data.source = src ? { kind: src.kind, ref: src.ref || src.url || src.path || "", readAt: Date.now(), by: "ideafetch" } : { kind: "define", readAt: Date.now(), by: "ideafetch" };

  const id = structured.slug || slug((b && b.domain) || (pool && pool.name) || name) || slug(name) || undefined;
  return { id, name, kind, data };
}

// ---------------------------------------------------------------------------------------------
// manifest — the headless action surface (mirrors ideabrain.core.js). The connector/agent path can
// call `define` to structure a set of selections into a publishable context on the user's own Claude.
// ---------------------------------------------------------------------------------------------
export const manifest = {
  name: "ideafetch",
  title: "ideafetch",
  origin: "https://ideafetch.thelastprompt.ai",
  scope: { models: ["sonnet", "claude-haiku-4-5"], contextKinds: ["project", "brand"] },
  actions: [
    {
      name: "define",
      summary:
        "Structure a set of user-selected facts (category, audience, essence, goals) into one publishable " +
        "kind:'project'/'brand' context. ideafetch's define step — the user asserts; the model only clusters " +
        "and names, inventing nothing. One call, on the user's own Claude.",
      input: {
        selections: "{ category[], audience[], essence[], goals[] } — the user's checked facts + free-text. Required.",
        kind: "string? — 'project' (default) or 'brand'.",
        name: "string? — a name to prefer for the project.",
        pool: "object? — the ideafetch fact pool from the readers, folded in as a superset (palette, products, folder, stack…).",
      },
      output: { context: "{ id, name, kind, data } — ready for relay.context.publish" },
      run: structure,
    },
  ],
};

export default manifest;
