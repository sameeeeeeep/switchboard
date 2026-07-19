// Shelf — your inventory, triaged. Paste stock + sales, get reorder-now / watch / dead-weight,
// the cash locked on the shelf, and 2-4 one-week plans (one recommended) that refine into a
// worksheet on pick. The parse + count are pure client-side; the triage runs on the VISITOR'S
// own Claude through Switchboard. No tools, one model, ONLY-JSON contract.
//
// CONTEXT-FIRST, PROACTIVE, ZERO-INPUT: after connect (fresh chip click OR page-load with a
// standing grant) Shelf reads the brand the user lent it (kind "brand" — see docs/CONTEXT-KINDS.md;
// falls back to the first banked brand via list()+use()) and LOADS THE SHEET ITSELF:
//   · the context carries inventory  → that is the sheet, verbatim (source "context")
//   · it carries only a catalogue    → a representative sheet off the product list (source "derived")
//   · nothing is lent                → the built-in demo sheet (source "sample")
// Then the triage auto-runs and the ★ recommended plan auto-details into the week-one worksheet —
// the board is on screen before the user types anything. Pasting stays available and always wins:
// the moment the user edits the sheet it becomes source "user" and Shelf never overwrites it.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const K_CSV = "shelf:csv";
const K_STEER = "shelf:steer";
const K_LAST = "shelf:last";
const K_PLAY = "shelf:playbook";

let relay = null;
let installed = true; // optimistic until the probe says otherwise
let running = false;
let triageSeq = 0; // per-op tokens — a stale run bails once its own op's seq moves past its number.
let refineSeq = 0; // Separate on purpose: a triage and a refine may overlap, and each cleans up only its own UI.
let rows = [];
let brand = null; // the lent brand context (normalized), or null
let plans = [];
let selectedPlan = null;
let autoTriaged = false; // one proactive triage per page life — chip onConnect + the probe both funnel here
let lastRendered = null; // the board result currently on screen (stale-marking on brand switch reads it)
// WHERE THE SHEET ON DECK CAME FROM. "user" is sacred — Shelf never overwrites a sheet the person
// typed, pasted, or banked. Everything else is Shelf's own doing and is free to be replaced when a
// context arrives or the brand switches.
let sheetSource = "sample"; // "context" | "derived" | "sample" | "user"
let autoCsv = null;         // the exact text Shelf last loaded on its own

// ---------- persistence: two tiers ----------
// localStorage paints instantly (works pre-connect, same profile only); relay.storage mirrors it
// into the user's own Switchboard origin store once connected — fire-and-forget on write,
// restore-if-local-empty on connect (see syncFromRelayStorage).
function persist(key, val) {
  try { localStorage.setItem(key, val); } catch { /* full/blocked */ }
  if (relay && relay.storage && typeof relay.storage.set === "function") {
    try { void relay.storage.set(key, val).catch(() => {}); } catch { /* fire-and-forget */ }
  }
}
function unpersist(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (relay && relay.storage && typeof relay.storage.delete === "function") {
    try { void relay.storage.delete(key).catch(() => {}); } catch { /* fire-and-forget */ }
  }
}

// ---------- the sample: ONLY for the not-connected state, always labeled as a sample ----------
// A DTC skincare brand, 24 SKUs with a story: 3 heroes about to stock out, 5 dead SKUs on cash.
// TODO(someday): a Shopify connector scope could pull the sheet straight from the user's store —
// paste stays the single primary entry until that is real. Do not build it here.
const SAMPLE_CSV = `SKU,Product,On hand,Avg weekly sales,Unit cost (INR),Price (INR),Lead time (days)
VCS-10,Vitamin C Serum 10%,96,84,210,649,21
SPF-50,Daily SPF 50 Gel,140,120,165,499,18
NIA-05,Niacinamide 5% Toner,60,46,140,449,14
HYA-02,Hyaluronic Acid Serum 2%,210,32,190,599,21
RET-03,Retinol Night Cream 0.3%,160,24,260,799,28
SAL-02,Salicylic Acid Face Wash,340,55,110,349,14
CER-01,Ceramide Moisturizer 50g,190,28,175,549,21
KOJ-02,Kojic Acid Soap (pack of 2),280,40,60,199,14
GRN-01,Green Tea Face Wash,260,38,95,299,14
UBT-01,Ubtan Face Pack,220,26,90,299,14
ONX-01,Onion Hair Oil 200ml,300,42,85,349,14
SHM-01,Anti-Dandruff Shampoo 250ml,270,36,120,399,18
BOD-01,Shea Body Lotion 400ml,230,30,130,449,21
SCR-01,Coffee Body Scrub 100g,240,34,75,249,14
TON-02,Rice Water Toner,180,22,105,349,21
MSK-05,Multani Clay Mask 100g,200,21,80,279,14
SUN-30,SPF 30 Body Lotion,210,26,145,449,18
ALV-90,Aloe Vera Gel 300ml,900,25,70,249,10
RSW-01,Rose Water Mist,620,18,55,199,10
CHR-01,Charcoal Peel-Off Mask,420,0,95,299,30
GLD-24,24K Gold Sheet Mask (pack of 4),380,0.2,180,599,45
BRD-77,Beard Growth Oil,240,0,120,399,21
CUC-30,Cucumber Eye Pads (30s),310,0.4,88,249,30
LIP-09,Lip Plumping Gloss,150,0.1,105,349,25`;
const isSample = () => $("csv").value.trim() === SAMPLE_CSV.trim();

// ---------- csv parsing (client-side, instant) ----------
function splitCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, "");
  const first = splitCsvLine(lines[0]).map(norm);
  const looksHeader = first.some((h) => h.includes("sku") || h.includes("onhand") || h.includes("product"));
  const idx = { sku: 0, product: 1, onHand: 2, weekly: 3, cost: 4, price: 5, lead: 6 };
  if (looksHeader) {
    first.forEach((h, i) => {
      if (h.includes("sku")) idx.sku = i;
      else if (h.includes("product") || h.includes("name") || h.includes("title")) idx.product = i;
      else if (h.includes("onhand") || h.includes("stock") || h.includes("qty") || h.includes("units")) idx.onHand = i;
      else if (h.includes("weekly") || h.includes("sales") || h.includes("velocity")) idx.weekly = i;
      else if (h.includes("cost")) idx.cost = i;
      else if (h.includes("price") || h.includes("mrp")) idx.price = i;
      else if (h.includes("lead")) idx.lead = i;
    });
  }
  const body = looksHeader ? lines.slice(1) : lines;
  const out = [];
  for (const line of body) {
    const c = splitCsvLine(line);
    const r = {
      sku: c[idx.sku] || "",
      product: c[idx.product] || "",
      onHand: num(c[idx.onHand]),
      weekly: num(c[idx.weekly]),
      cost: num(c[idx.cost]),
      price: num(c[idx.price]),
      lead: num(c[idx.lead]),
    };
    if (!r.sku || !Number.isFinite(r.onHand)) continue;
    if (!Number.isFinite(r.weekly)) r.weekly = 0;
    if (!Number.isFinite(r.cost)) r.cost = 0;
    if (!Number.isFinite(r.price)) r.price = 0;
    if (!Number.isFinite(r.lead)) r.lead = 14;
    out.push(r);
  }
  return out;
}

// ---------- the count: instant mono stat strip, no AI ----------
const isDead = (r) => r.weekly < 0.5 && r.onHand > 0;
const isRisk = (r) => r.weekly >= 0.5 && r.onHand / r.weekly < r.lead / 7;
const fmtNum = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtINR = (n) => "₹" + fmtNum(n);

function computeStats(rs) {
  return {
    units: rs.reduce((a, r) => a + r.onHand, 0),
    value: rs.reduce((a, r) => a + r.onHand * r.cost, 0),
    risk: rs.filter(isRisk),
    dead: rs.filter(isDead),
    deadValue: rs.filter(isDead).reduce((a, r) => a + r.onHand * r.cost, 0),
  };
}
function renderStats() {
  const msg = $("parse-msg");
  if (!rows.length) {
    ["s-units", "s-value", "s-risk", "s-dead"].forEach((id) => { $(id).textContent = "—"; });
    const has = $("csv").value.trim().length > 0;
    msg.className = "parse-msg" + (has ? " bad" : "");
    msg.textContent = has
      ? "couldn't read that — need columns like SKU, Product, On hand, Avg weekly sales, Unit cost, Price, Lead time"
      : (relay
          ? "paste " + (brand ? brand.name + "'s" : "your") + " sheet — the count is instant"
          : "paste a sheet or load the sample — the count is instant");
    return;
  }
  const n = rows.length;
  const s = computeStats(rows);
  $("s-units").textContent = fmtNum(s.units);
  $("s-value").textContent = fmtINR(s.value);
  $("s-risk").textContent = String(s.risk.length);
  $("s-dead").textContent = String(s.dead.length);
  // Say exactly where the sheet came from — a loaded-for-you sheet must never pass as the real one.
  if (sheetSource === "context") {
    msg.className = "parse-msg ok";
    msg.textContent = "✓ " + n + " SKUs loaded from " + (brand ? brand.name + "'s" : "your") + " inventory"
      + (inventoryEstimated ? " · weekly sales estimated from reorder points — paste real sales to sharpen it" : "");
  } else if (sheetSource === "derived") {
    msg.className = "parse-msg smp";
    msg.textContent = "representative sheet — " + n + " SKUs off " + (brand ? brand.name + "'s" : "the") + " catalogue; the products are real, the stock and sales are stand-ins · paste the real sheet to replace it";
  } else if (isSample()) {
    msg.className = "parse-msg smp";
    msg.textContent = relay
      ? "sample sheet — DTC skincare, " + n + " SKUs · paste " + (brand ? brand.name + "'s" : "your") + " real sheet to replace it"
      : "sample sheet — DTC skincare, " + n + " SKUs · paste yours to replace it";
  } else {
    msg.className = "parse-msg ok";
    msg.textContent = "✓ " + n + " SKUs read";
  }
}
function reparse(save = true) {
  rows = parseCsv($("csv").value);
  if (save) persist(K_CSV, $("csv").value);
  renderStats();
  reflect();
}

let debounceT = null;
// A keystroke in the box makes the sheet the USER'S. From here on Shelf loads nothing over it.
$("csv").addEventListener("input", () => {
  if ($("csv").value !== autoCsv) { sheetSource = "user"; autoCsv = null; }
  clearTimeout(debounceT); debounceT = setTimeout(() => reparse(), 250);
});
$("load-sample").addEventListener("click", () => { $("csv").value = SAMPLE_CSV; autoCsv = SAMPLE_CSV; sheetSource = "sample"; reparse(); });
$("clear-csv").addEventListener("click", () => { $("csv").value = ""; autoCsv = null; sheetSource = "user"; reparse(); });

// ---------- brand context: read what the user lent Shelf, derive everything from it ----------
// Normalize an opaque brand context defensively (docs/CONTEXT-KINDS.md kind "brand" — no locked schema).
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arrs = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arrs(d.products).length ? arrs(d.products) : arrs(d.range);
  // Commerce contexts may carry a real stock list. It is the whole point of this wrapp, so take it
  // defensively from any of the shapes a publisher might use and let csvFromInventory() sort it out.
  const inv = Array.isArray(d.inventory) ? d.inventory : Array.isArray(d.stock) ? d.stock : Array.isArray(d.skus) ? d.skus : [];
  return {
    name: String(ctx.name || d.name || "Brand"),
    voice: String(d.voice || d.vibe || "").trim(),
    positioning: String(d.positioning || "").trim(),
    audience: String(d.audience || "").trim(),
    palette: arrs(d.palette), // FLAT color strings per the contract
    products,
    inventory: inv.filter((x) => x && typeof x === "object"),
  };
}

// ---------- the sheet Shelf loads for you (doctrine: never an empty box, never "paste first") ----
const CSV_HEAD = "SKU,Product,On hand,Avg weekly sales,Unit cost (INR),Price (INR),Lead time (days)";
function skuFor(name, i) {
  const w = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const stem = (w[0] || "SKU").slice(0, 4) + (w[1] ? "-" + w[1].slice(0, 3) : "");
  return stem + "-" + String(i + 1).padStart(2, "0");
}
const cnum = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
// Real inventory → the sheet, verbatim. Contexts rarely carry a SALES column, so when it is missing
// weekly demand is estimated from the reorder point (a reorder point IS ~ weekly demand × lead
// weeks). The UI says "sales estimated" whenever that estimate was used — never silently.
let inventoryEstimated = false;
function csvFromInventory(inv) {
  inventoryEstimated = false;
  const rows = inv.slice(0, 60).map((it, i) => {
    const lead = Math.max(1, cnum(it.leadDays ?? it.lead ?? it.leadTime, 21));
    const stock = Math.max(0, cnum(it.stock ?? it.onHand ?? it.qty, 0));
    let weekly = cnum(it.weekly ?? it.avgWeeklySales ?? it.sales, NaN);
    if (!Number.isFinite(weekly) || weekly < 0) {
      const reorderAt = cnum(it.reorderAt ?? it.reorderPoint, Math.max(2, Math.round(stock / 4)));
      weekly = Math.round((reorderAt / Math.max(1, lead / 7)) * 10) / 10;
      inventoryEstimated = true;
    }
    return [
      String(it.sku || skuFor(it.name || it.product || "SKU", i)),
      csvField(String(it.name || it.product || "Item " + (i + 1))),
      stock, weekly, cnum(it.cost ?? it.unitCost, 0), cnum(it.price, 0), lead,
    ].join(",");
  });
  return CSV_HEAD + "\n" + rows.join("\n");
}
// Only a catalogue → a REPRESENTATIVE sheet: the products are real, the numbers are stand-ins, and
// the strip under the box says exactly that. It gets the person to a board they can react to.
function csvFromProducts(products) {
  inventoryEstimated = false;
  const ON = [8, 140, 60, 15, 3, 220, 45, 90];
  const WK = [10, 34, 18, 6, 4, 0.2, 12, 26];
  const CO = [210, 165, 140, 340, 90, 120, 260, 75];
  const PR = [649, 499, 449, 1290, 300, 399, 799, 249];
  const LD = [21, 18, 14, 28, 26, 21, 30, 14];
  const rows = products.slice(0, 12).map((p, i) =>
    [skuFor(p, i), csvField(String(p)), ON[i % ON.length], WK[i % WK.length], CO[i % CO.length], PR[i % PR.length], LD[i % LD.length]].join(","));
  return CSV_HEAD + "\n" + rows.join("\n");
}
function contextSheet() {
  if (!brand) return null;
  if (brand.inventory.length) return { csv: csvFromInventory(brand.inventory), source: "context" };
  if (brand.products.length) return { csv: csvFromProducts(brand.products), source: "derived" };
  return null;
}
// Loads the lent project's shelf into the box. Returns true when the sheet on deck actually changed.
function applyContextSheet() {
  if (sheetSource === "user") return false; // the person's own sheet is never overwritten
  const s = contextSheet();
  if (!s) return false;
  const changed = $("csv").value.trim() !== s.csv.trim();
  sheetSource = s.source;
  autoCsv = s.csv;
  if (!changed) return false;
  $("csv").value = s.csv;
  reparse(false); // never persist Shelf's own sheet over a sheet the user banked
  return true;
}
async function loadBrand() {
  if (!relay || !relay.context || typeof relay.context.active !== "function") { brand = null; afterBrandChange(); return; }
  try {
    const ctx = await relay.context.active();
    brand = ctx ? normalizeBrand(ctx) : null;
  } catch { brand = null; }
  // Doctrine fallback: nothing lent → auto-select the first banked kind-"brand" context.
  // Needs contextKinds granted at connect, and reused grants are exact-match (they ignore newly
  // requested kinds) — so every failure or empty list degrades to blind mode + "use a brand".
  if (!brand && typeof relay.context.list === "function" && typeof relay.context.use === "function") {
    try {
      const metas = await relay.context.list();
      const m = (metas || []).find((x) => (x.kind || "").toLowerCase() === "brand");
      if (m) {
        const ctx = await relay.context.use(m.id);
        brand = ctx ? normalizeBrand(ctx) : null;
      }
    } catch { /* grant without the kind, or an older daemon — the manual picker still works */ }
  }
  afterBrandChange();
}
async function pickBrand(btn) {
  if (!relay || !relay.context || typeof relay.context.pick !== "function") return;
  const was = btn.textContent;
  btn.textContent = "choosing in Switchboard…";
  btn.disabled = true;
  const prev = brand ? brand.name : null;
  try {
    const ctx = await relay.context.pick(); // opens the side-panel picker; selecting lends it to Shelf
    if (ctx) { brand = normalizeBrand(ctx); afterBrandChange(); afterBrandSwitch(prev); }
  } catch { /* picker dismissed */ }
  finally {
    btn.textContent = was;
    btn.disabled = false;
  }
}
$("brand-load").addEventListener("click", () => pickBrand($("brand-load")));
$("brand-switch").addEventListener("click", () => pickBrand($("brand-switch")));

// A switched brand must never leave a board triaged under the OLD brand looking current:
// real sheet on deck → re-triage proactively (the new heroes/positioning reshape the calls);
// otherwise mark the board with who it was triaged under so the staleness is visible.
function afterBrandSwitch(prevName) {
  const nowName = brand ? brand.name : null;
  if ((prevName || null) === nowName) return;
  applyContextSheet(); // a new brand brings its own shelf — unless the user pasted one
  if (relay && rows.length && !running) { runTriage(); return; }
  if ($("board").hidden) return;
  markBoardStale();
}
function markBoardStale() {
  const meta = $("b-meta");
  if (meta.textContent.includes(" — re-triage")) return;
  meta.textContent += " · triaged under " + (lastRendered && lastRendered.brandName ? lastRendered.brandName : "no brand") + " — re-triage";
}

function afterBrandChange() {
  updateCtxbar();
  renderSteerChips();
  renderStats();
  reflect();
}
function updateCtxbar() {
  const bar = $("ctxbar");
  if (!relay) { bar.hidden = true; return; }
  bar.hidden = false;
  const chip = $("bchip");
  if (brand) {
    chip.hidden = false;
    chip.textContent = "";
    chip.append(el("span", "dot"), el("span", null, brand.name));
    // The brand's palette shows INSIDE content (this chip), never as the app chrome.
    for (const c of brand.palette.slice(0, 4)) { const sw = el("span", "sw"); sw.style.background = c; chip.append(sw); }
    $("ctx-line").textContent = "triaging " + brand.name + "'s shelf — heroes and positioning shape the calls";
    $("brand-switch").hidden = false;
    $("brand-load").hidden = true;
  } else {
    chip.hidden = true;
    $("ctx-line").textContent = "no brand lent — the foreman triages blind";
    $("brand-switch").hidden = true;
    $("brand-load").hidden = false;
  }
}

// ---------- steer: chips gain brand-aware suggestions once a brand is lent ----------
const DEFAULT_STEERS = [
  { label: "Plan for a festive sale spike", steer: "Plan for a festive sale spike — Diwali is 6 weeks out." },
  { label: "I have ₹2,00,000 — what do I reorder?", steer: "I have ₹2,00,000 to spend — what do I reorder first?" },
  { label: "What do I discount to free up cash?", steer: "What do I discount to free up cash the fastest?" },
];
function steerChoices() {
  if (!brand) return DEFAULT_STEERS;
  const out = [];
  const hero = brand.products[0];
  if (hero) out.push({ label: "Never let " + hero + " stock out", steer: "Protect " + brand.name + "'s heroes — never let " + hero + " stock out; size the reorders to guarantee it.", brandy: true });
  if (brand.positioning) out.push({ label: "What clashes with our positioning?", steer: brand.name + " positions as \"" + brand.positioning + "\" — which SKUs no longer fit, and should the dead ones be cut or folded into hero bundles?", brandy: true });
  for (const d of DEFAULT_STEERS) { if (out.length >= 4) break; out.push(d); }
  return out.slice(0, 4);
}
function renderSteerChips() {
  const mount = $("schips");
  mount.textContent = "";
  for (const c of steerChoices()) {
    const b = el("button", "schip" + (c.brandy ? " brandy" : ""), c.label);
    b.addEventListener("click", () => {
      $("steer").value = c.steer;
      persist(K_STEER, c.steer);
    });
    mount.append(b);
  }
}
$("steer").addEventListener("input", () => { persist(K_STEER, $("steer").value); });
$("steer").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("go").disabled) runTriage(); });

// ---------- the standard connect chip + returning-user probe ----------
// Once connected, prefer the user's own Switchboard origin store over an empty local cache —
// a returning user on a fresh profile gets their sheet, board, and worksheet back before the
// auto-triage decides whether anything needs regenerating. Local copies (already painted at
// boot) always win; only empty keys are backfilled. Sequenced by onRelay, never raced.
async function syncFromRelayStorage() {
  if (!relay || !relay.storage || typeof relay.storage.get !== "function") return;
  const pull = async (key) => {
    let local = null;
    try { local = localStorage.getItem(key); } catch { /* blocked */ }
    if (local != null && local !== "") return null; // the local tier stands
    let v = null;
    try { v = await relay.storage.get(key); } catch { return null; }
    if (typeof v !== "string" || !v) return null;
    try { localStorage.setItem(key, v); } catch { /* cache refresh only */ }
    return v;
  };
  const [csv, steer, last, play] = await Promise.all([pull(K_CSV), pull(K_STEER), pull(K_LAST), pull(K_PLAY)]);
  if (steer != null) $("steer").value = steer;
  // A banked sheet is the USER'S — it outranks anything Shelf would load from the context.
  if (csv != null && csv.trim()) { $("csv").value = csv; sheetSource = "user"; autoCsv = null; reparse(false); }
  let lastObj = null, playObj = null;
  try { lastObj = JSON.parse(last || "null"); } catch { /* corrupt — skip */ }
  try { playObj = JSON.parse(play || "null"); } catch { /* corrupt — skip */ }
  if (lastObj && lastObj.data && $("board").hidden) {
    renderBoard(lastObj, { selectedTitle: playObj?.planTitle || null });
    if (playObj?.playbook && selectedPlan && selectedPlan.title === playObj.planTitle) renderPlaybook(playObj.playbook);
  }
}

// Context-first, PROACTIVE: the moment we're connected with a sheet on deck and no fresh board
// that matches it, the triage runs itself — progress strip up, zero clicks, and the recommended
// plan details itself into the worksheet when the board lands (runTriage does that). This fires
// for EVERY source, including the representative and demo sheets: the doctrine is that a connected
// visitor sees a real board without typing, and a board on stand-in numbers (clearly labeled as
// such under the box and on the board itself) beats an empty page telling them to paste.
// autoTriaged dedupes the chip-onConnect vs fast-probe double fire and chip reconnects.
function maybeAutoTriage() {
  if (!relay || !rows.length || running || autoTriaged) return;
  let savedLast = null;
  try { savedLast = JSON.parse(localStorage.getItem(K_LAST) || "null"); } catch { /* corrupt — treat as absent */ }
  const sig = sheetCsv().length + ":" + rows.length;
  const fresh = !!(savedLast && savedLast.data && savedLast.csvSig === sig && Date.now() - (savedLast.at || 0) <= 24 * 3600 * 1000);
  autoTriaged = true;
  if (!fresh) { runTriage(); return; }
  // Board is fresh — but a lit recommended plan with no worksheet is a promise unkept: top it up.
  let savedPlay = null;
  try { savedPlay = JSON.parse(localStorage.getItem(K_PLAY) || "null"); } catch { /* ignore */ }
  if (selectedPlan && !savedPlay?.playbook) runRefine();
}

async function onRelay(r) {
  relay = r;
  $("load-sample").hidden = true; // the sample is already loaded when it matters; the button is a not-connected affordance
  await syncFromRelayStorage(); // origin store first — the sheet/board a returning user banked
  await loadBrand(); // context-first: the lent brand (or the first banked one) shapes the prompt BEFORE any auto-run
  applyContextSheet(); // …and brings the shelf with it, so nothing has to be pasted
  reflect();
  maybeAutoTriage();
}
function offRelay() {
  relay = null;
  brand = null;
  $("load-sample").hidden = false;
  afterBrandChange();
}
mountConnect($("chip-dock"), {
  scope: {
    models: ["sonnet"],
    reason: "triage your inventory",
    // Lets loadBrand auto-select a banked brand via list()+use() when nothing is lent. NOT relied
    // on for returning users: reused grants are exact-match and ignore newly requested kinds, so
    // every list()/use() caller tolerates an empty result or a throw.
    contextKinds: ["brand"],
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => onRelay(r),
  onDisconnect: () => offRelay(),
  // The chip's own "Switch ▸" must re-derive strap/chips/prompts too — and a board triaged under
  // the old brand either re-triages (real sheet) or gets visibly marked stale.
  onProjectChange: async () => {
    const prev = brand ? brand.name : null;
    await loadBrand();
    afterBrandSwitch(prev);
  },
});
// Fast probe so a returning user's grant enables the button (and loads the brand) without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    installed = true;
    const grant = await r.permissions().catch(() => null);
    if (grant) { onRelay(r); return; }
  } else {
    installed = false;
  }
  reflect();
})();

function reflect() {
  $("go").disabled = !relay || running || !rows.length;
  $("b-regen").disabled = !relay || running;
  const hint = $("conn-hint");
  hint.textContent = "";
  if (running) { hint.append("the foreman is counting…"); return; }
  if (relay) {
    if (!rows.length) { hint.append("connected — paste " + (brand ? brand.name + "'s" : "a") + " sheet to triage"); return; }
    if (sheetSource === "derived") { hint.append("board built on stand-in numbers off " + (brand ? brand.name + "'s" : "the") + " catalogue — paste the real sheet and it re-triages"); return; }
    if (sheetSource === "sample") { hint.append("connected — the board below is the demo sheet; paste " + (brand ? brand.name + "'s" : "your") + " real sheet to replace it"); return; }
    const b = el("em", "you", "your own Claude");
    hint.append("runs on ", b, " — the sheet goes to your sidekick, nowhere else");
  } else if (installed) {
    hint.append("connect Switchboard (top right) to run the triage — the count above already works");
  } else {
    const a = el("a", null, "get Switchboard");
    a.href = INSTALL_URL;
    a.target = "_blank";
    a.rel = "noreferrer";
    hint.append("needs the Switchboard sidekick — ", a, " and come straight back");
  }
}

// ---------- triage: build prompt, stream, parse ONLY-JSON ----------
const csvField = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
const sheetCsv = () => rows.map((r) => [r.sku, csvField(r.product), r.onHand, r.weekly, r.cost, r.price, r.lead].join(",")).join("\n");
// The lent brand is woven INTO the prompt: positioning/audience sharpen the calls, heroes anchor
// dead-stock rescues, voice colors the copy.
function brandLines() {
  if (!brand) return "";
  return [
    "This is " + brand.name + "'s shelf.",
    brand.positioning ? "Positioning: " + brand.positioning + "." : "",
    brand.audience ? "Audience: " + brand.audience + "." : "",
    brand.products.length
      ? "Hero products: " + brand.products.join(", ") + " — protect their cover first, and make dead-stock actions lean on them (bundles, gift-with-purchase beside a hero)."
      : "",
    brand.voice ? "Write the summary/why/action lines in the brand's voice: " + brand.voice + "." : "",
  ].filter(Boolean).join(" ");
}
function buildPrompt() {
  const steer = $("steer").value.trim();
  return [
    "You are the sharpest inventory foreman a small e-commerce brand ever hired. Blunt, numerate, practical. Currency: INR.",
    brandLines(),
    "Stock + sales sheet (CSV columns: sku,product,on_hand,avg_weekly_sales,unit_cost_inr,price_inr,lead_time_days):",
    sheetCsv(),
    "",
    "Ground rules:",
    "- weeks_of_cover = on_hand / avg_weekly_sales. A SKU is a stockout risk when weeks_of_cover < lead_time_days / 7.",
    "- dead = avg_weekly_sales near zero with stock still on hand.",
    "- orderQty covers lead-time demand plus ~4 weeks of buffer, minus stock on hand, rounded to a sensible round number.",
    steer
      ? 'Owner\'s steer: "' + steer + '" — let it shape the reorder calls, the discount calls, and the plans.'
      : "No steer given — optimize for the highest-value week this shelf can have.",
    "",
    "Respond with ONLY a JSON object — no prose, no markdown fences — exactly this shape:",
    '{"summary":"two plain-talk sentences on the shape of the situation","cashLockedInDead":0,"reorderNow":[{"sku":"","product":"","orderQty":0,"why":""}],"watch":[{"sku":"","product":"","why":""}],"deadWeight":[{"sku":"","product":"","action":"","recoverable":0}],"abc":{"a":["SKU"],"b":["SKU"],"c":["SKU"]},"plans":[{"title":"","angle":"","moves":[""],"recommended":false}]}',
    "- cashLockedInDead: number = sum of on_hand × unit_cost across the deadWeight SKUs.",
    '- deadWeight: action is one concrete move ("40% off, bundle with the Vitamin C hero", "liquidate to a reseller lot"); recoverable is the realistic INR you can pull back (number).',
    "- abc: classify EVERY sku by weekly revenue (price × avg_weekly_sales): a = the head that drives most revenue, b = middle, c = tail. Use only SKU codes from the sheet, each exactly once.",
    "- why/action lines: one specific sentence each, use the actual numbers (cover weeks, lead time, cash).",
    "- plans: exactly 3 genuinely DIFFERENT one-week playbooks for this sheet (e.g. cash-first vs growth-first vs balanced — pick the angles that fit THIS data). title ≤ 4 words; angle = one sentence on the tradeoff; moves = 2-3 concrete moves quoting real SKUs and numbers. EXACTLY ONE plan has recommended:true — the one you would run" + (steer ? " given the owner's steer." : "."),
  ].filter(Boolean).join("\n");
}

const PROG_LINES = [
  "Counting the shelves…",
  "Checking lead times…",
  "Weighing the dead stock…",
  "Splitting A / B / C…",
  "Drafting three plans…",
];
let progTimer = null;
function setRunning(on) {
  running = on;
  $("progress").hidden = !on;
  if (on) {
    let i = 0;
    $("prog-line").textContent = PROG_LINES[0];
    $("prog-meta").textContent = "";
    progTimer = setInterval(() => { i = (i + 1) % PROG_LINES.length; $("prog-line").textContent = PROG_LINES[i]; }, 2400);
  } else {
    clearInterval(progTimer);
  }
  reflect();
}
function showError(err) {
  const p = $("err-text");
  p.textContent = "";
  const b = el("b", null, "Triage failed. ");
  p.append(b, String(err?.message || err).slice(0, 240));
  $("errbox").hidden = false;
}

async function runTriage() {
  if (!relay || running || !rows.length) return;
  const myRun = ++triageSeq;
  // Snapshot what this run is actually triaging — a brand switch or CSV edit mid-stream must not
  // mislabel the result (its attribution/signature describe the prompt, not the finish line).
  const ranSteer = $("steer").value.trim();
  const ranBrand = brand ? brand.name : null;
  const ranSource = sheetSource;
  const ranSample = sheetSource !== "user" && sheetSource !== "context"; // stand-in numbers — say so on the board
  const ranSig = sheetCsv().length + ":" + rows.length;
  const ranCount = rows.length;
  $("errbox").hidden = true;
  setRunning(true);
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt: buildPrompt() })) {
      if (myRun !== triageSeq) return; // cancelled or superseded by a newer triage — don't touch the UI
      if (d.type === "text") {
        acc += d.text;
        $("prog-meta").textContent = (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    if (myRun !== triageSeq) return;
    const raw = acc.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) throw new Error("the model replied without a manifest — hit Re-run triage, it lands on the retry");
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error("the manifest came back smudged (bad JSON) — hit Re-run triage"); }
    const result = {
      data,
      steer: ranSteer,
      at: Date.now(),
      skuCount: ranCount,
      csvSig: ranSig, // maybeAutoTriage matches this against the live sheet
      brandName: ranBrand, // the board carries its own attribution — restores never lose it
      sample: ranSample, // a stand-in-numbers board is never mistaken for real inventory
      source: ranSource,
    };
    persist(K_LAST, JSON.stringify(result));
    renderBoard(result, { fresh: true });
    // The ★ is a call, not a decoration: the recommended plan (renderPlans just selected it)
    // details itself into the week-one worksheet with zero clicks. Ordering is safe — the fresh
    // renderBoard bumped refineSeq before runRefine takes its own token.
    if (selectedPlan) runRefine();
    $("board").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (myRun === triageSeq) showError(err);
  } finally {
    if (myRun === triageSeq) setRunning(false);
  }
}
$("go").addEventListener("click", runTriage);
$("retry").addEventListener("click", runTriage);
$("b-regen").addEventListener("click", runTriage);
$("prog-cancel").addEventListener("click", () => { triageSeq++; setRunning(false); });

// ---------- the board ----------
const arr = (v) => (Array.isArray(v) ? v : []);
const coerceNum = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

function tagCard(kind, item) {
  const card = el("div", "tagcard " + kind);
  const row = el("div", "trow");
  row.append(el("span", "skutag", String(item.sku ?? "?")));
  if (kind === "reorder") {
    const q = coerceNum(item.orderQty);
    row.append(el("span", "tstamp", q != null ? "order " + fmtNum(q) : "order"));
  } else if (kind === "dead") {
    row.append(el("span", "tstamp", "dead"));
  }
  card.append(row, el("div", "tname", String(item.product ?? "")), el("div", "twhy", String(item.why ?? item.action ?? "")));
  if (kind === "dead") {
    const rn = coerceNum(item.recoverable);
    card.append(el("div", "trecover", "recover ≈ " + (rn != null ? fmtINR(rn) : String(item.recoverable ?? "?"))));
  }
  return card;
}
function fillColumn(mountId, countId, kind, items) {
  const mount = $(mountId);
  mount.textContent = "";
  $(countId).textContent = items.length ? items.length + (items.length === 1 ? " SKU" : " SKUs") : "";
  if (!items.length) { mount.append(el("div", "col-empty", "— nothing on this hook")); return; }
  items.forEach((it) => mount.append(tagCard(kind, it)));
}
function fillAbc(mountId, skus) {
  const mount = $(mountId);
  mount.textContent = "";
  if (!skus.length) { mount.append(el("span", "abcchip", "—")); return; }
  skus.forEach((s) => {
    mount.append(el("span", "abcchip", String(typeof s === "object" && s !== null ? s.sku ?? JSON.stringify(s) : s)));
  });
}

// ---------- the plans: options, not answers — 2-4 cards, one recommended, pick → refine ----------
function normPlans(v) {
  const ps = arr(v).map((p) => ({
    title: String(p?.title ?? "").trim() || "Plan",
    angle: String(p?.angle ?? "").trim(),
    moves: arr(p?.moves).map((m) => String(m)).slice(0, 4),
    recommended: p?.recommended === true,
  })).slice(0, 4);
  if (ps.length && !ps.some((p) => p.recommended)) ps[0].recommended = true;
  let seen = false;
  for (const p of ps) { if (p.recommended) { if (seen) p.recommended = false; else seen = true; } }
  return ps;
}
function renderPlans(ps, selectedTitle) {
  plans = ps;
  selectedPlan = null;
  const grid = $("plangrid");
  grid.textContent = "";
  $("plans-wrap").hidden = !ps.length;
  ps.forEach((p) => {
    const card = el("div", "plancard");
    const top = el("div", "ptop");
    top.append(el("div", "ptitle", p.title));
    if (p.recommended) top.append(el("span", "rec", "recommended"));
    card.append(top);
    if (p.angle) card.append(el("div", "pangle", p.angle));
    if (p.moves.length) {
      const ul = el("ul", "pmoves");
      p.moves.forEach((m) => ul.append(el("li", null, m)));
      card.append(ul);
    }
    // The lit card IS the selection: with no explicit pick the recommended plan is selected,
    // not merely highlighted — callers (fresh triage, auto-triage) can refine it immediately.
    const chosen = selectedTitle ? p.title === selectedTitle : p.recommended;
    if (chosen) { card.classList.add("lit"); selectedPlan = p; }
    card.addEventListener("click", () => {
      grid.querySelectorAll(".plancard").forEach((c) => c.classList.remove("lit"));
      card.classList.add("lit");
      selectedPlan = p;
      runRefine();
    });
    grid.append(card);
  });
}

function buildRefinePrompt(plan) {
  const steer = $("steer").value.trim();
  return [
    "You are the sharpest inventory foreman a small e-commerce brand ever hired. Blunt, numerate, practical. Currency: INR.",
    brandLines(),
    "Stock + sales sheet (CSV columns: sku,product,on_hand,avg_weekly_sales,unit_cost_inr,price_inr,lead_time_days):",
    sheetCsv(),
    "",
    'The owner picked this one-week plan: "' + plan.title + '"' + (plan.angle ? " — " + plan.angle : ""),
    plan.moves.length ? "Planned moves: " + plan.moves.join(" · ") : "",
    steer ? 'Owner\'s steer: "' + steer + '".' : "",
    "Turn the picked plan into a concrete week-one worksheet.",
    "",
    "Respond with ONLY a JSON object — no prose, no markdown fences — exactly this shape:",
    '{"title":"","steps":[{"move":"","detail":"","impact":""}],"outcome":""}',
    "- steps: 4-6, in the order to do them. move = an imperative of ≤ 8 words; detail = one sentence naming the actual SKUs and numbers; impact = the INR or cover-weeks effect, short (e.g. \"+₹28,400 back\", \"6 wks cover\").",
    "- outcome: one sentence on where the shelf stands at the end of the week.",
  ].filter(Boolean).join("\n");
}

async function runRefine() {
  if (!selectedPlan) return;
  if (!relay || !rows.length) {
    // Gated, not dead: say what unblocks it (pre-connect the board stays explorable).
    $("playwrap").hidden = false;
    $("play-err").hidden = false;
    $("play-err-text").textContent = !relay
      ? "connect Switchboard (top right) to detail a plan"
      : "the sheet is empty — paste it back, then pick again";
    return;
  }
  const myRun = ++refineSeq;
  $("play-err").hidden = true;
  $("playwrap").hidden = false;
  $("play-prog").hidden = false;
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt: buildRefinePrompt(selectedPlan) })) {
      if (myRun !== refineSeq) return; // superseded by a cancel, another pick, or a fresh board landing
      if (d.type === "text") acc += d.text;
      else if (d.type === "error") throw new Error(d.error?.message || "stream error");
    }
    if (myRun !== refineSeq) return;
    const raw = acc.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) throw new Error("no worksheet came back — retry lands it");
    let pb;
    try { pb = JSON.parse(raw); }
    catch { throw new Error("the worksheet came back smudged (bad JSON) — retry"); }
    renderPlaybook(pb);
    persist(K_PLAY, JSON.stringify({ planTitle: selectedPlan.title, playbook: pb, at: Date.now() }));
  } catch (err) {
    if (myRun === refineSeq) {
      $("play-err").hidden = false;
      $("play-err-text").textContent = "Worksheet failed. " + String(err?.message || err).slice(0, 200);
    }
  } finally {
    if (myRun === refineSeq) $("play-prog").hidden = true;
  }
}
function renderPlaybook(pb) {
  $("playwrap").hidden = false; // boot's restore calls this directly — the parent ships hidden in the HTML
  const box = $("playbook");
  box.hidden = false;
  box.textContent = "";
  $("play-kicker").textContent = "week one — " + String(pb?.title || selectedPlan?.title || "the plan");
  const steps = arr(pb?.steps).slice(0, 8);
  steps.forEach((s, i) => {
    const row = el("div", "step");
    row.append(el("span", "sn", String(i + 1).padStart(2, "0")));
    const body = el("div", "sbody");
    body.append(el("div", "smv", String(s?.move ?? "")));
    const dt = String(s?.detail ?? "").trim();
    if (dt) body.append(el("div", "sdt", dt));
    row.append(body);
    const imp = String(s?.impact ?? "").trim();
    if (imp) row.append(el("span", "simp", imp));
    box.append(row);
  });
  if (!steps.length) box.append(el("div", "step", "— the worksheet came back empty; regenerate"));
  const out = String(pb?.outcome ?? "").trim();
  if (out) box.append(el("div", "outcome", "→ " + out));
}
$("play-regen").addEventListener("click", runRefine);
$("play-retry").addEventListener("click", runRefine);
$("play-cancel").addEventListener("click", () => { refineSeq++; $("play-prog").hidden = true; });

function renderBoard(result, opts = {}) {
  const d = result.data || {};
  lastRendered = result;
  $("board").hidden = false;
  const when = new Date(result.at || Date.now());
  // Attribution comes from the STORED result, never the live brand global — a board restored at
  // boot (brand still null, the probe takes up to 2s) keeps naming the brand it was triaged under.
  const SRC_TAG = { context: "", derived: "representative sheet · ", sample: "sample sheet · ", user: "" };
  $("b-meta").textContent =
    (SRC_TAG[result.source] ?? (result.sample ? "sample · " : "")) +
    "triaged " + when.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " + (result.skuCount || arr(d.reorderNow).length + arr(d.watch).length + arr(d.deadWeight).length) + " SKUs" +
    (result.brandName ? " · " + result.brandName : "") +
    (result.steer ? " · steer: “" + result.steer.slice(0, 48) + (result.steer.length > 48 ? "…" : "") + "”" : "");
  $("b-summary").textContent = String(d.summary ?? "");
  const cash = coerceNum(d.cashLockedInDead);
  $("b-cash").textContent = cash != null ? fmtINR(cash) : (rows.length ? fmtINR(computeStats(rows).deadValue) : "—");
  fillColumn("col-reorder", "n-reorder", "reorder", arr(d.reorderNow));
  fillColumn("col-watch", "n-watch", "watch", arr(d.watch));
  fillColumn("col-dead", "n-dead", "dead", arr(d.deadWeight));
  const abc = d.abc || {};
  fillAbc("abc-a", arr(abc.a));
  fillAbc("abc-b", arr(abc.b));
  fillAbc("abc-c", arr(abc.c));
  renderPlans(normPlans(d.plans), opts.selectedTitle || null);
  if (opts.fresh) {
    // A fresh triage means fresh plans — the old worksheet no longer applies, and a refine
    // still detailing an old plan is superseded here (its spinner goes with it).
    refineSeq++;
    $("playwrap").hidden = true;
    $("playbook").hidden = true;
    $("play-prog").hidden = true;
    unpersist(K_PLAY);
  }
}

// ---------- boot: restore state, never a blank box ----------
(function boot() {
  let savedCsv = null, savedSteer = "", savedLast = null, savedPlay = null;
  try {
    savedCsv = localStorage.getItem(K_CSV);
    savedSteer = localStorage.getItem(K_STEER) || "";
    savedLast = JSON.parse(localStorage.getItem(K_LAST) || "null");
    savedPlay = JSON.parse(localStorage.getItem(K_PLAY) || "null");
  } catch { /* ignore */ }
  // The demo sheet keeps the page explorable pre-connect and is the last-resort sheet after it
  // (nothing lent). A banked sheet is the user's and outranks everything Shelf would load.
  if (savedCsv != null && savedCsv.trim()) { $("csv").value = savedCsv; sheetSource = "user"; autoCsv = null; }
  else { $("csv").value = SAMPLE_CSV; sheetSource = "sample"; autoCsv = SAMPLE_CSV; }
  $("steer").value = savedSteer;
  renderSteerChips();
  reparse(false);
  if (savedLast && savedLast.data) {
    renderBoard(savedLast, { selectedTitle: savedPlay?.planTitle || null });
    if (savedPlay?.playbook && selectedPlan && selectedPlan.title === savedPlay.planTitle) renderPlaybook(savedPlay.playbook);
  }
})();
