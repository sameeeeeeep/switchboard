// Shelf — your inventory, triaged. Paste stock + sales, get reorder-now / watch / dead-weight,
// the cash locked on the shelf, and 2-4 one-week plans (one recommended) that refine into a
// worksheet on pick. The parse + count are pure client-side; the triage runs on the VISITOR'S
// own Claude through Switchboard. No tools, one model, ONLY-JSON contract.
//
// CONTEXT-FIRST: after connect Shelf reads the brand the user lent it (kind "brand" — see
// docs/CONTEXT-KINDS.md) and derives from it: the strap ("triaging Aamras' shelf"), brand-aware
// steer chips, and the triage prompt itself (positioning/heroes shape dead-stock and reorder calls).
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
  const s = computeStats(rows);
  $("s-units").textContent = fmtNum(s.units);
  $("s-value").textContent = fmtINR(s.value);
  $("s-risk").textContent = String(s.risk.length);
  $("s-dead").textContent = String(s.dead.length);
  if (isSample()) {
    msg.className = "parse-msg smp";
    msg.textContent = "sample sheet — DTC skincare, " + rows.length + " SKUs · paste yours to replace it";
  } else {
    msg.className = "parse-msg ok";
    msg.textContent = "✓ " + rows.length + " SKUs read";
  }
}
function reparse(persist = true) {
  rows = parseCsv($("csv").value);
  if (persist) { try { localStorage.setItem(K_CSV, $("csv").value); } catch { /* full/blocked */ } }
  renderStats();
  reflect();
}

let debounceT = null;
$("csv").addEventListener("input", () => { clearTimeout(debounceT); debounceT = setTimeout(() => reparse(), 250); });
$("load-sample").addEventListener("click", () => { $("csv").value = SAMPLE_CSV; reparse(); });
$("clear-csv").addEventListener("click", () => { $("csv").value = ""; reparse(); });

// ---------- brand context: read what the user lent Shelf, derive everything from it ----------
// Normalize an opaque brand context defensively (docs/CONTEXT-KINDS.md kind "brand" — no locked schema).
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arrs = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arrs(d.products).length ? arrs(d.products) : arrs(d.range);
  return {
    name: String(ctx.name || d.name || "Brand"),
    voice: String(d.voice || d.vibe || "").trim(),
    positioning: String(d.positioning || "").trim(),
    audience: String(d.audience || "").trim(),
    palette: arrs(d.palette), // FLAT color strings per the contract
    products,
  };
}
async function loadBrand() {
  if (!relay || !relay.context || typeof relay.context.active !== "function") { brand = null; afterBrandChange(); return; }
  try {
    const ctx = await relay.context.active();
    brand = ctx ? normalizeBrand(ctx) : null;
  } catch { brand = null; }
  afterBrandChange();
}
async function pickBrand() {
  if (!relay || !relay.context || typeof relay.context.pick !== "function") return;
  try {
    const ctx = await relay.context.pick(); // opens the side-panel picker; selecting lends it to Shelf
    if (ctx) { brand = normalizeBrand(ctx); afterBrandChange(); }
  } catch { /* picker dismissed */ }
}
$("brand-load").addEventListener("click", pickBrand);
$("brand-switch").addEventListener("click", pickBrand);

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
      try { localStorage.setItem(K_STEER, c.steer); } catch { /* ignore */ }
    });
    mount.append(b);
  }
}
$("steer").addEventListener("input", () => { try { localStorage.setItem(K_STEER, $("steer").value); } catch { /* ignore */ } });
$("steer").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("go").disabled) runTriage(); });

// ---------- the standard connect chip + returning-user probe ----------
function onRelay(r) {
  relay = r;
  $("load-sample").hidden = true; // sample is a not-connected affordance only
  if (isSample()) { $("csv").value = ""; reparse(); } // real context replaces the sample the moment it can exist
  loadBrand(); // context-first: read the lent brand on connect AND on load with a standing grant
  reflect();
}
function offRelay() {
  relay = null;
  brand = null;
  $("load-sample").hidden = false;
  afterBrandChange();
}
mountConnect($("chip-dock"), {
  scope: { models: ["sonnet"], reason: "triage your inventory" },
  installUrl: INSTALL_URL,
  onConnect: (r) => onRelay(r),
  onDisconnect: () => offRelay(),
  onProjectChange: () => loadBrand(), // the chip's own "Switch ▸" must re-derive strap/chips/prompts too
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
    const result = { data, steer: $("steer").value.trim(), at: Date.now(), skuCount: rows.length };
    try { localStorage.setItem(K_LAST, JSON.stringify(result)); } catch { /* ignore */ }
    renderBoard(result, { fresh: true });
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
    const chosen = selectedTitle ? p.title === selectedTitle : p.recommended;
    if (chosen) card.classList.add("lit");
    if (selectedTitle && p.title === selectedTitle) selectedPlan = p;
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
    try { localStorage.setItem(K_PLAY, JSON.stringify({ planTitle: selectedPlan.title, playbook: pb, at: Date.now() })); } catch { /* ignore */ }
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
  $("board").hidden = false;
  const when = new Date(result.at || Date.now());
  $("b-meta").textContent =
    "triaged " + when.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " + (result.skuCount || arr(d.reorderNow).length + arr(d.watch).length + arr(d.deadWeight).length) + " SKUs" +
    (brand ? " · " + brand.name : "") +
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
    try { localStorage.removeItem(K_PLAY); } catch { /* ignore */ }
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
  // Pre-connect the sample keeps the page explorable; the probe clears it the moment a grant exists.
  $("csv").value = savedCsv != null && savedCsv.trim() ? savedCsv : SAMPLE_CSV;
  $("steer").value = savedSteer;
  renderSteerChips();
  reparse(false);
  if (savedLast && savedLast.data) {
    renderBoard(savedLast, { selectedTitle: savedPlay?.planTitle || null });
    if (savedPlay?.playbook && selectedPlan && selectedPlan.title === savedPlay.planTitle) renderPlaybook(savedPlay.playbook);
  }
})();
