// Prism — the on-brand image studio, CONTEXT-FIRST. It runs on the visitor's own Higgsfield
// connector through their Claude (agentic loop: media_upload → relay put_blob → media_confirm →
// generate_image → poll → final URL), and it borrows a brand the user built elsewhere via
// claude_context. The doctrine move: the moment a grant exists — fresh chip click OR page-load with
// a persisted grant — Prism restores the last shot grid from storage, pulls the lent brand (else
// auto-selects the first brand in the library), and immediately drafts ~6 concrete SHOT CONCEPTS
// (one ★ recommended) as a cheap text-only stream. Renders stay one-click-per-image: each spends
// Higgsfield credits behind a per-action consent, never auto-fired.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const STORE_KEY = "prism:workspace";
const CONNECTOR = "mcp__claude_ai_Higgsfield__*";        // the user's inherited claude.ai connector
const GEN = "generate_image";
const URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
const ASPECTS = ["1:1", "16:9", "9:16"];
const MAX_SHOTS = 24;
const MAX_CONCEPTS = 18;
// Fallback styles when a brand context doesn't carry its own.
const DEFAULT_STYLES = ["editorial minimal", "vibrant maximal", "matte product studio", "lifestyle candid", "bold graphic", "soft pastel"];
// No brand in the library? Still never a blank form — concrete starters, zero tokens burned.
const STARTERS = [
  { label: "product hero", prompt: "A single hero product on a sculpted stone pedestal, soft directional window light, shallow depth of field, muted earthy backdrop, premium studio photography" },
  { label: "lifestyle candid", prompt: "Candid smartphone-style photo of someone using a beautifully designed product at a sunlit kitchen table, morning light, authentic and unstaged" },
  { label: "editorial flat-lay", prompt: "Overhead editorial flat-lay of a product with its raw ingredients arranged on textured linen, natural daylight, magazine styling" },
  { label: "bold graphic", prompt: "A product floating against a bold single-color backdrop with a hard geometric shadow, high-contrast studio strobe, art-directed minimalism" },
  { label: "moody macro", prompt: "Extreme macro shot of a product's surface texture, dramatic low-key lighting, glistening detail, cinematic mood" },
];

let relay = null;
let notInstalled = false;
let booted = false;        // boot() runs once per connected session (chip + probe both funnel in)
let brand = null;          // the normalized lent brand, or null
let brandId = null;        // its context id (for the in-app dropdown)
let brandOptions = [];     // [{id, name}] — metas only; data arrives per-pick via use()
let drafting = false;      // concept batch stream in flight
let autoDraftKey = null;   // brand name the auto-draft already fired for (dedupes chip vs probe)
let lastDraftOpts = null;  // what the draft error bar's Retry re-runs
let referenceDataUrl = null;

// ---------- workspace state (persisted; relay.storage values are strings) ----------
let state = {
  brandName: null,   // which brand the concepts were drafted for
  product: "",
  style: "",
  aspect: "1:1",
  extra: "",         // the one free-text knob
  concepts: [],      // [{title, product, style, imagePrompt, aspect, recommended}]
  shots: [],         // [{url, prompt, aspect, ts}] — newest first
  savedAt: 0,
};

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const str = (v, fb) => (typeof v === "string" && v.trim() ? v.trim() : fb);
const resultText = (d) => (d.result?.content ?? []).map((c) => c.text ?? "").join("");
const extractUrl = (t) => { const m = (t || "").match(URL_RE); return m ? (m[1] || m[2] || m[0]) : null; };

// ---------- persistence (two tiers: localStorage paints instantly, relay.storage is truth) ----------
function save() {
  state.savedAt = Date.now();
  const payload = JSON.stringify(state);
  try { localStorage.setItem(STORE_KEY, payload); } catch { /* storage full or blocked — non-fatal */ }
  if (relay && relay.storage && typeof relay.storage.set === "function") {
    try { void relay.storage.set(STORE_KEY, payload).catch(() => {}); } catch { /* fire-and-forget */ }
  }
}
function coerceState() {
  if (typeof state.brandName !== "string") state.brandName = null;
  if (typeof state.product !== "string") state.product = "";
  if (typeof state.style !== "string") state.style = "";
  if (!ASPECTS.includes(state.aspect)) state.aspect = "1:1";
  if (typeof state.extra !== "string") state.extra = "";
  if (typeof state.savedAt !== "number") state.savedAt = 0;
  state.concepts = (Array.isArray(state.concepts) ? state.concepts : []).map(coerceConcept).filter(Boolean).slice(0, MAX_CONCEPTS);
  state.shots = (Array.isArray(state.shots) ? state.shots : [])
    .filter((s) => s && typeof s === "object" && typeof s.url === "string" && s.url)
    .map((s) => ({ url: s.url, prompt: str(s.prompt, ""), aspect: ASPECTS.includes(s.aspect) ? s.aspect : "1:1", ts: typeof s.ts === "number" ? s.ts : 0 }))
    .slice(0, MAX_SHOTS);
  if (state.concepts.length && !state.concepts.some((c) => c.recommended)) state.concepts[0].recommended = true;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object") Object.assign(state, s);
  } catch { /* corrupt store — start clean */ }
  coerceState();
}
load();

// Pull the origin-store copy once connected; it wins only when strictly newer than the local
// paint. Sequenced by boot() — never raced against connect.
async function syncFromRelayStorage() {
  if (!relay || !relay.storage || typeof relay.storage.get !== "function") return;
  let raw = null, parsed = null;
  try {
    raw = await relay.storage.get(STORE_KEY);
    parsed = JSON.parse(raw);
  } catch { return; /* nothing banked yet — the local tier stands */ }
  if (!parsed || typeof parsed !== "object") return;
  if ((parsed.savedAt || 0) <= (state.savedAt || 0)) return;
  Object.assign(state, parsed);
  coerceState();
  try { localStorage.setItem(STORE_KEY, raw); } catch { /* cache refresh only */ }
  $("prompt").value = state.extra;
  $("aspect").value = state.aspect;
  renderGrid();
  renderConcepts();
}

// ---------- brand context: normalize defensively — no locked schema ----------
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arr(d.products).length ? arr(d.products) : arr(d.range);
  const styles = arr(d.styles).length ? arr(d.styles) : DEFAULT_STYLES;
  return {
    name: str(ctx && ctx.name, str(d.name, "Brand")),
    voice: String(d.voice || d.vibe || d.positioning || "").trim(),
    palette: arr(d.palette).slice(0, 6),
    products,
    styles,
  };
}

// Read whatever brand the user lent Prism; when nothing is lent, auto-select the first brand
// from the library via list()+use() — CONTEXT-FIRST, no dropdown idling on a placeholder.
// Reused grants are exact-match (they ignore newly requested kinds), so every call here
// tolerates a throw or an empty result and falls through to the freeform path.
async function loadBrandCtx() {
  brand = null; brandId = null; brandOptions = [];
  if (!relay || !relay.context || typeof relay.context.active !== "function") return;
  try {
    const ctx = await relay.context.active();
    if (ctx) { brand = normalizeBrand(ctx); brandId = ctx.id || null; }
  } catch { /* no active context */ }
  try {
    const metas = await relay.context.list();
    brandOptions = (metas || []).filter((m) => (m.kind || "").toLowerCase() === "brand").map((m) => ({ id: m.id, name: m.name }));
  } catch { /* library not visible on this grant */ }
  if (!brand && brandOptions.length && typeof relay.context.use === "function") {
    try {
      const ctx = await relay.context.use(brandOptions[0].id);
      if (ctx) { brand = normalizeBrand(ctx); brandId = ctx.id || brandOptions[0].id; }
    } catch { /* fall through — the panel picker still works */ }
  }
}

// ---------- connect: the standard chip + the load-with-grant probe (both funnel into boot) ----------
async function boot(r) {
  if (booted) return;
  booted = true;
  relay = r;
  notInstalled = false;
  await syncFromRelayStorage(); // FIRST: the saved grid + concepts paint instantly…
  renderGrid();
  renderConcepts();
  await loadBrandCtx();         // …THEN context refreshes…
  applyBrandUI();
  reflect();
  maybeAutoDraft();             // …and the proactive batch fires with zero input
}

mountConnect($("chip-dock"), {
  scope: {
    reason: "Prism — draft shot concepts from your brand and render them with your Higgsfield",
    tools: [CONNECTOR],
    contextKinds: ["brand"],
  },
  context: "single",
  installUrl: INSTALL_URL,
  onConnect: (r) => { void boot(r); },
  onDisconnect: () => {
    relay = null; booted = false;
    brand = null; brandId = null; brandOptions = [];
    autoDraftKey = null;
    applyBrandUI();
    reflect();
    flashHint("disconnected — reconnect with the chip to keep rendering");
  },
  // The chip's own "Switch" menu runs context.pick() itself — reflect the new brand in-page,
  // clear concepts that belong to the old one, and re-fire the proactive batch (adforge idiom).
  onProjectChange: async (project) => {
    if (!relay) return;
    const prev = brand ? brand.name : null;
    if (project) { brand = normalizeBrand(project); brandId = project.id || null; }
    else await loadBrandCtx();
    applyBrandUI();
    if ((brand ? brand.name : null) !== prev) { autoDraftKey = null; clearConcepts(); }
    reflect();
    maybeAutoDraft();
  },
});
// Fast probe so a returning user's grant boots everything without a click (home.js idiom).
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { await boot(r); return; }
  } else {
    notInstalled = true;
  }
  reflect();
})();

// ---------- brand bar UI ----------
function renderBrandSel() {
  const sel = $("brandSel");
  const has = brandOptions.length > 0 || !!brand;
  $("brandSelField").hidden = !has;
  sel.textContent = "";
  sel.append(new Option("no brand — freeform", ""));
  for (const b of brandOptions) sel.append(new Option(b.name, b.id));
  if (brandId && ![...sel.options].some((o) => o.value === brandId)) sel.append(new Option(brand.name, brandId));
  sel.value = brandId || "";
}

function applyBrandUI() {
  $("brandbar").hidden = !relay;
  renderBrandSel();
  const chip = $("bchip");
  if (brand) {
    chip.hidden = false;
    chip.textContent = "";
    chip.append(el("span", "dot"), el("span", null, brand.name));
    for (const c of brand.palette.slice(0, 4)) { const sw = el("span", "sw"); sw.style.background = c; sw.title = c; chip.append(sw); }
    $("brandFields").hidden = false;
    fillSelect($("product"), brand.products, brand.products.length ? null : "— brand has no products —");
    fillSelect($("style"), brand.styles);
    setSelVal($("product"), state.product);
    setSelVal($("style"), state.style);
    $("prompt").placeholder = "Add art direction (optional) — e.g. on a marble surface, morning light";
    $("note").textContent = `On-brand for ${brand.name} — concepts draft themselves; every render is a per-action consent on your Higgsfield.`;
  } else {
    chip.hidden = true;
    $("brandFields").hidden = true;
    $("prompt").placeholder = "Describe the image — subject, setting, lighting…";
    if (relay) $("note").textContent = "Freeform mode — describe a shot (or hit a starter below), then Generate. Lend Prism a brand to unlock auto-drafted concepts.";
  }
  renderStarters();
  // Panel-picker fallback only when the library gave us nothing to list.
  $("loadBrand").hidden = !(relay && !brandOptions.length);
}

function fillSelect(sel, items, emptyLabel) {
  sel.textContent = "";
  if (!items.length && emptyLabel) { sel.append(new Option(emptyLabel, "")); sel.disabled = true; return; }
  sel.disabled = false;
  for (const it of items) sel.append(new Option(it, it));
}
function setSelVal(sel, v) {
  if (!v) return;
  for (const o of sel.options) if (o.value.toLowerCase() === String(v).toLowerCase()) { sel.value = o.value; return; }
}
function showBrandErr(msg) {
  const e = $("branderr");
  e.hidden = false;
  e.textContent = msg;
  clearTimeout(showBrandErr.t);
  showBrandErr.t = setTimeout(() => { e.hidden = true; }, 6000);
}

// The in-app dropdown: choosing a brand calls use(id); the daemon hands that ONE context over and
// audits the read. Failures roll the select back to the previous brand — no silent state mismatch.
$("brandSel").addEventListener("change", async () => {
  if (!relay) return;
  const sel = $("brandSel");
  const prevId = brandId || "";
  const want = sel.value;
  if (want === prevId) return;
  if (!want) {
    // Explicit "no brand — freeform" mode: clear the brand, keep the studio alive.
    brand = null; brandId = null;
    autoDraftKey = null;
    clearConcepts();
    applyBrandUI();
    reflect();
    maybeAutoDraft();
    return;
  }
  sel.disabled = true;
  try {
    const ctx = await relay.context.use(want);
    if (!ctx) throw new Error("that context came back empty");
    brand = normalizeBrand(ctx);
    brandId = ctx.id || want;
    autoDraftKey = null;
    clearConcepts();
    applyBrandUI();
    reflect();
    maybeAutoDraft();
  } catch (err) {
    sel.value = prevId; // roll back — the select must never show a brand that isn't loaded
    showBrandErr("Couldn't load that brand: " + (err?.message || err));
  } finally {
    sel.disabled = false;
  }
});

// Panel-picker fallback (library visibility unchecked at connect).
$("loadBrand").addEventListener("click", async () => {
  if (!relay) return;
  const b = $("loadBrand");
  const was = b.textContent;
  b.textContent = "choosing in Switchboard…";
  b.disabled = true;
  try {
    const ctx = await relay.context.pick();
    if (ctx) {
      const prev = brand ? brand.name : null;
      brand = normalizeBrand(ctx);
      brandId = ctx.id || null;
      if (brand.name !== prev) { autoDraftKey = null; clearConcepts(); }
      applyBrandUI();
      maybeAutoDraft();
    }
  } catch (err) {
    showBrandErr("Brand pick failed: " + (err?.message || err));
  } finally {
    b.textContent = was;
    b.disabled = false;
    reflect();
  }
});

// ---------- 01 · the proactive concept batch (the core doctrine move) ----------
function coerceConcept(c) {
  if (!c || typeof c !== "object") return null;
  const title = str(c.title, "");
  const imagePrompt = str(c.imagePrompt, "");
  if (!title || !imagePrompt) return null;
  return {
    title,
    product: str(c.product, ""),
    style: str(c.style, ""),
    imagePrompt,
    aspect: ASPECTS.includes(c.aspect) ? c.aspect : "1:1",
    recommended: !!c.recommended,
  };
}

function buildConceptPrompt(b, priorTitles) {
  return [
    "You are Prism, a senior art director drafting photography and render concepts for a brand's image library.",
    "Work ONLY from this brand context — do NOT call any tools:",
    `Brand: ${b.name}`,
    b.voice ? `Voice / vibe: ${b.voice}` : "",
    b.palette.length ? `Palette — fold these into the art direction: ${b.palette.join(", ")}` : "",
    b.products.length ? `Products: ${b.products.join("; ")}` : "",
    b.styles.length ? `House design styles: ${b.styles.join("; ")}` : "",
    "Respond with ONLY a JSON object — no prose before or after, no markdown fences — in exactly this shape:",
    '{"concepts":[exactly 6 items, each {"title":string (2-4 word shot name),"product":string (the product featured, from the brand\'s range, or "" for a brand-wide shot),"style":string (the design style used, ideally one of the house styles),"imagePrompt":string (a vivid, complete text-to-image prompt: subject, setting, lighting, camera, mood — no text, no logos, no watermarks in the image),"aspect":"1:1"|"16:9"|"9:16","recommended":boolean}]}',
    'Exactly ONE concept must have "recommended": true — the shot you would render first.',
    priorTitles && priorTitles.length
      ? `These shot titles already exist — produce six NEW concepts with different titles and directions: ${priorTitles.join(", ")}.`
      : "",
  ].filter(Boolean).join("\n");
}

function parseConcepts(raw) {
  try {
    const cleaned = String(raw).replace(/```(?:json)?/gi, "");
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    const list = (Array.isArray(data.concepts) ? data.concepts : []).map(coerceConcept).filter(Boolean).slice(0, 6);
    if (list.length < 3) return null;
    // Exactly one recommended, whatever the model did (index 0 fallback).
    const recAt = list.findIndex((c) => c.recommended);
    list.forEach((c, i) => { c.recommended = i === (recAt === -1 ? 0 : recAt); });
    return list;
  } catch { return null; }
}

function clearConcepts() {
  state.concepts = [];
  state.brandName = brand ? brand.name : null;
  save();
  renderConcepts();
}

function showDraftErr(msg) { $("drafterr").hidden = false; $("drafterr-msg").textContent = msg; }
function hideDraftErr() { $("drafterr").hidden = true; }
$("draft-retry").addEventListener("click", () => { hideDraftErr(); void draftConcepts(lastDraftOpts || {}); });

// One streamed text-only turn on the user's Claude — cheap. NEVER auto-renders images (those
// spend Higgsfield credits behind per-action consents and stay one click away).
async function draftConcepts(opts = {}) {
  if (!relay || drafting || !brand) return;
  const forName = brand.name; // the brand this batch is FOR — a mid-draft switch discards it
  lastDraftOpts = opts;
  drafting = true;
  hideDraftErr();
  $("concepts-sec").hidden = false;
  $("draftline").hidden = false;
  $("draft-msg").textContent = "drafting shot concepts on your Claude… 0.0 kb";
  reflect();
  let acc = "";
  try {
    const prior = opts.more ? state.concepts.map((c) => c.title) : null;
    for await (const d of relay.stream({ prompt: buildConceptPrompt(brand, prior), agentic: true })) {
      if (d.type === "text") {
        acc += d.text;
        $("draft-msg").textContent = "drafting shot concepts on your Claude… " + (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    const list = parseConcepts(acc);
    if (!list) throw new Error("Your Claude returned malformed concepts — Retry usually lands clean on the second pass.");
    if (!brand || brand.name !== forName) return; // brand switched mid-draft — stale batch, drop it
    if (opts.more && state.concepts.length) {
      for (const c of list) c.recommended = false; // the existing ★ keeps its crown
      state.concepts = state.concepts.concat(list);
      if (state.concepts.length > MAX_CONCEPTS) state.concepts = state.concepts.slice(state.concepts.length - MAX_CONCEPTS);
      if (!state.concepts.some((c) => c.recommended)) state.concepts[0].recommended = true;
    } else {
      state.concepts = list;
    }
    state.brandName = brand.name;
    save();
    renderConcepts();
    prefillFromRecommended(!opts.more);
  } catch (err) {
    showDraftErr(String(err?.message || err)); // never leave the section blank — error bar + Retry
  } finally {
    drafting = false;
    $("draftline").hidden = true;
    reflect();
    // A brand switch mid-draft was parked by the `drafting` guard — pick it up now (the switch
    // handlers reset autoDraftKey, so maybeAutoDraft drafts the NEW brand's batch).
    if (brand && brand.name !== forName) maybeAutoDraft();
  }
}

$("more").addEventListener("click", () => { void draftConcepts({ more: true }); });

// Fires from every connect path. Dedupes chip-onConnect vs the fast probe by brand name; never
// re-burns tokens when the persisted bench already holds this brand's concepts.
function maybeAutoDraft() {
  if (!relay || drafting) return;
  if (!brand) {
    // No brand anywhere: proactive anyway — a concrete starter is prefilled, presets are visible.
    renderStarters();
    if (!state.extra.trim() && !$("prompt").value.trim()) {
      $("prompt").value = STARTERS[0].prompt;
      state.extra = STARTERS[0].prompt;
      save();
    }
    return;
  }
  if (autoDraftKey === brand.name) return;
  autoDraftKey = brand.name;
  if (state.brandName === brand.name && state.concepts.length) {
    renderConcepts(); // returning user — their bench matches; show it, burn nothing
    prefillFromRecommended(false);
    return;
  }
  if (state.concepts.length) clearConcepts(); // stale concepts belong to another brand
  void draftConcepts({});
}

function conceptRenderPrompt(c) {
  const bits = [c.imagePrompt];
  if (brand) {
    if (brand.palette.length) bits.push(`Brand palette: ${brand.palette.join(", ")}`);
    if (brand.voice) bits.push(`Brand mood: ${brand.voice}`);
  }
  bits.push("No text, no lettering, no logos, no watermarks");
  return bits.join(". ");
}

function renderConcepts() {
  const mount = $("concepts");
  mount.textContent = "";
  state.concepts.forEach((c) => {
    const card = el("div", "concept" + (c.recommended ? " rec" : ""));
    const top = el("div", "ctop");
    if (c.recommended) top.append(el("span", "recflag", "★ RECOMMENDED"));
    if (c.style) top.append(el("span", "cchip", c.style));
    top.append(el("span", "cchip dim", c.aspect));
    const prev = el("div", "cprev", c.imagePrompt);
    prev.title = c.imagePrompt;
    const foot = el("div", "cfoot");
    const btn = el("button", "rbtn", "Render image");
    btn.type = "button";
    btn.addEventListener("click", () => { void renderShot(conceptRenderPrompt(c), c.aspect, null, btn); });
    const use = el("button", "cuse", "edit in studio");
    use.type = "button";
    use.addEventListener("click", () => {
      $("prompt").value = c.imagePrompt;
      state.extra = c.imagePrompt;
      $("aspect").value = c.aspect;
      state.aspect = c.aspect;
      save();
      $("studio-sec").scrollIntoView({ behavior: "smooth", block: "center" });
      $("prompt").focus();
    });
    foot.append(btn, use);
    card.append(top, el("div", "ctitle", c.title), prev, foot);
    mount.append(card);
  });
  $("concepts-sec").hidden = !(state.concepts.length || drafting || (relay && brand));
  reflect();
}

// Prefill the pickers and the textarea placeholder from the ★ concept — never clobber typed text.
function prefillFromRecommended(fresh) {
  const rec = state.concepts.find((c) => c.recommended);
  if (!rec) return;
  if (!state.product) setSelVal($("product"), rec.product);
  if (!state.style) setSelVal($("style"), rec.style);
  if (fresh) { $("aspect").value = rec.aspect; state.aspect = rec.aspect; save(); }
  $("prompt").placeholder = "e.g. " + rec.imagePrompt.slice(0, 110) + (rec.imagePrompt.length > 110 ? "…" : "");
}

// ---------- starters (freeform mode / pre-connect — the page is never a blank form) ----------
function renderStarters() {
  const mount = $("starters");
  mount.textContent = "";
  for (const s of STARTERS) {
    const b = el("button", "starter", s.label);
    b.type = "button";
    b.addEventListener("click", () => {
      $("prompt").value = s.prompt;
      state.extra = s.prompt;
      save();
      $("prompt").focus();
    });
    mount.append(b);
  }
  mount.hidden = !!brand;
}

// ---------- the studio inputs (every change persists) ----------
$("prompt").addEventListener("input", () => { state.extra = $("prompt").value; save(); });
$("aspect").addEventListener("change", () => { state.aspect = $("aspect").value; save(); });
$("product").addEventListener("change", () => { state.product = $("product").value; save(); });
$("style").addEventListener("change", () => { state.style = $("style").value; save(); });

// Build the generation prompt: brand context + chosen product + style + any extra art direction.
function buildPrompt() {
  const extra = $("prompt").value.trim();
  if (!brand) return extra; // no brand loaded → plain text-to-image
  const product = $("product").value.trim();
  const style = $("style").value.trim();
  return [
    product ? `${product} for ${brand.name}` : `${brand.name} brand image`,
    style ? `${style} style` : "",
    brand.voice ? `brand voice: ${brand.voice}` : "",
    brand.palette.length ? `brand palette: ${brand.palette.join(", ")}` : "",
    extra,
    "no text, no logos, no watermarks",
  ].filter(Boolean).join(". ");
}

$("go").addEventListener("click", () => {
  const p = buildPrompt();
  if (!p) { $("prompt").focus(); flashHint("describe the image first — one line is enough"); return; }
  void renderShot(p, $("aspect").value, referenceDataUrl, $("go"));
});

// ---------- reference image (best-effort) ----------
function renderRef() {
  const ref = $("ref");
  const input = $("refInput");
  ref.textContent = "";
  ref.append(input);
  // The button SURVIVES a picked reference — it becomes "swap" instead of vanishing.
  const b = el("button", "refbtn", referenceDataUrl ? "swap reference" : "＋ reference image");
  b.type = "button";
  b.addEventListener("click", () => input.click());
  ref.append(b);
  if (referenceDataUrl) {
    const thumb = el("span", "refthumb");
    const img = el("img");
    img.src = referenceDataUrl;
    img.alt = "reference";
    const x = el("button", "x", "×");
    x.type = "button";
    x.title = "Remove reference";
    x.addEventListener("click", () => { referenceDataUrl = null; renderRef(); });
    thumb.append(img, x);
    ref.append(thumb);
  }
}
$("refInput").addEventListener("change", () => {
  const file = $("refInput").files?.[0];
  $("refInput").value = ""; // re-picking the SAME file must fire change again
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { referenceDataUrl = String(reader.result); renderRef(); };
  reader.onerror = () => flashHint("couldn't read that file — try another image");
  reader.readAsDataURL(file);
});
renderRef();

async function downscale(dataUrl, max = 1024) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("The reference image couldn't be decoded — try a different file."));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/png");
}

// ---------- 03 · rendered shots (persisted grid + the agentic Higgsfield loop) ----------
function showGrid() { $("grid-sec").hidden = $("grid").children.length === 0; }

function renderGrid() {
  const g = $("grid");
  g.textContent = "";
  for (const s of state.shots) g.append(shotCard(s));
  showGrid();
}

function dropShot(s) {
  state.shots = state.shots.filter((o) => !(o.ts === s.ts && o.url === s.url));
  save();
}

function shotCard(s) {
  const card = el("div", "shot");
  const x = el("button", "x", "×");
  x.type = "button";
  x.title = "Remove from workspace";
  x.addEventListener("click", () => { dropShot(s); card.remove(); showGrid(); });
  const img = el("img");
  img.src = s.url;
  img.alt = s.prompt;
  img.loading = "lazy";
  // Expired CDN link → a visible error tile with a Re-render, not a grey mystery box.
  img.addEventListener("error", () => {
    dropShot(s);
    failCard(card, "The image link expired.", () => { card.remove(); showGrid(); void renderShot(s.prompt, s.aspect, null, null); });
  });
  const cap = el("div", "cap", (s.prompt || "untitled shot").slice(0, 90) + ((s.prompt || "").length > 90 ? "…" : "") + " · " + s.aspect);
  cap.title = s.prompt;
  card.append(x, img, cap);
  return card;
}

function status(card, text) {
  const c = card.querySelector(".cap");
  if (c) c.textContent = text;
  else card.append(el("div", "cap", text));
}

// Failed cards are never dead tiles: Retry re-runs the same args, × dismisses.
function failCard(card, msg, retryFn) {
  card.className = "shot err";
  card.textContent = "";
  const x = el("button", "x", "×");
  x.type = "button";
  x.title = "Dismiss";
  x.addEventListener("click", () => { card.remove(); showGrid(); });
  const body = el("div", "errbody");
  body.append(el("div", "emsg", msg));
  if (retryFn) {
    const r = el("button", "mini", "Retry");
    r.type = "button";
    r.addEventListener("click", retryFn);
    body.append(r);
  }
  card.append(x, body);
}

// ONE hardened render path — concept cards, the manual Generate, and every Retry all call this.
// The loading card is ALWAYS resolved (image, or an error tile with Retry) — never left spinning.
async function renderShot(promptText, aspect, ref, btn) {
  if (!relay) { flashHint("connect Switchboard (top right) to render"); return; }
  const p = String(promptText || "").trim();
  if (!p) { $("prompt").focus(); flashHint("describe the image first — one line is enough"); return; }
  const a = ASPECTS.includes(aspect) ? aspect : "1:1";

  const card = el("div", "shot load");
  card.append(el("div", "scan"), el("div", "cap", ref ? "preparing reference…" : "queued…"));
  $("grid").prepend(card);
  showGrid();

  let was = null;
  if (btn) { was = btn.textContent; btn.dataset.busy = "1"; btn.disabled = true; btn.textContent = "Rendering…"; }
  let settled = false;
  const retry = () => { card.remove(); showGrid(); void renderShot(p, a, ref, btn && btn.isConnected ? btn : null); };

  try {
    let attachments;
    let instruction;
    if (ref) {
      const small = await downscale(ref); // inside the try — a corrupt file becomes an error tile
      attachments = [{ handle: "ref", filename: "ref.png", contentType: "image/png", dataUrl: small }];
      instruction =
        `Generate an image of: "${p}", aspect_ratio "${a}", guided by a reference image.\n` +
        `The reference is attached as relay handle "ref". To use it, do EXACTLY:\n` +
        `1) Call Higgsfield media_upload({ filename: "ref.png", content_type: "image/png" }) to get a presigned upload URL.\n` +
        `2) Call relay put_blob({ handle: "ref", url: <that upload URL> }) to upload the bytes (do NOT use bash/curl).\n` +
        `3) Call Higgsfield media_confirm as instructed by the upload result to get a media_id.\n` +
        `4) Call Higgsfield ${GEN} with the prompt and that media_id as a reference in medias.\n` +
        `5) Poll job status until done, then reply with ONLY the final image URL on its own line.`;
    } else {
      instruction =
        `Use the Higgsfield ${GEN} tool to generate an image of: "${p}", aspect_ratio "${a}". ` +
        `Wait for it to finish (poll the job status if needed), then reply with ONLY the final image URL on its own line.`;
    }

    status(card, "generating…");
    let url = null, acc = "";
    for await (const d of relay.stream({ prompt: instruction, agentic: true, attachments })) {
      if (d.type === "tool_proposed") {
        const n = d.call.name;
        if (n.endsWith("media_upload") || n.endsWith("put_blob") || n.endsWith("media_confirm")) status(card, "uploading reference…");
        else if (n.endsWith(GEN)) status(card, "generating (approve if asked)…");
        else if (/status|display|wait/.test(n)) status(card, "rendering…");
      } else if (d.type === "tool_result") {
        if (d.result?.ok) { const u = extractUrl(resultText(d)); if (u) url = u; }
        else status(card, "blocked: " + (d.result?.error?.message || d.call.name));
      } else if (d.type === "text") {
        acc += d.text;
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "The stream was blocked.");
      }
    }
    url = url || extractUrl(acc);
    if (!url) throw new Error("No image came back — Retry usually lands on the second pass.");
    const entry = { url, prompt: p, aspect: a, ts: Date.now() };
    state.shots.unshift(entry);
    if (state.shots.length > MAX_SHOTS) state.shots.length = MAX_SHOTS;
    save();
    card.replaceWith(shotCard(entry));
    settled = true;
  } catch (err) {
    failCard(card, String(err?.message || err), retry); // err.message surfaced, not just a code
    settled = true;
  } finally {
    if (btn) { delete btn.dataset.busy; btn.textContent = was; btn.disabled = false; }
    if (!settled) failCard(card, "The render stopped unexpectedly.", retry); // never left spinning
    reflect();
  }
}

// ---------- reflect: every control mirrors connection + busy state ----------
function reflect() {
  const on = !!relay;
  const go = $("go");
  if (!go.dataset.busy) { go.disabled = !on; go.textContent = "Generate"; }
  $("more").disabled = !on || drafting || !brand;
  document.querySelectorAll(".rbtn").forEach((b) => { if (!b.dataset.busy) b.disabled = !on; });
  if (!on) {
    $("note").textContent = notInstalled
      ? "Switchboard isn't installed — get it via the chip (top right); the studio wakes up the moment you connect."
      : "Connect Switchboard (top right) — Prism restores your grid and drafts shot concepts from your brand with zero clicks.";
  }
}

let hintTimer = null;
function flashHint(msg) {
  const h = $("hintline");
  h.textContent = msg;
  h.hidden = false;
  h.classList.remove("on");
  void h.offsetWidth; // restart the animation
  h.classList.add("on");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { h.hidden = true; }, 4000);
}

// ---------- first paint: whatever localStorage banked shows before any connect ----------
$("prompt").value = state.extra;
$("aspect").value = state.aspect;
renderGrid();
renderConcepts();
renderStarters();
reflect();
