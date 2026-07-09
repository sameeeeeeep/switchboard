// Shelf — your inventory, triaged. Paste stock + sales, get reorder-now / watch / dead-weight
// and the cash locked on the shelf. The parse + count are pure client-side; the triage runs on
// the VISITOR'S own Claude through Switchboard. No tools, one model, ONLY-JSON contract.
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const K_CSV = "shelf:csv";
const K_STEER = "shelf:steer";
const K_LAST = "shelf:last";

let relay = null;
let installed = true; // optimistic until the probe says otherwise
let running = false;
let runSeq = 0; // per-run token — a stale run bails once runSeq moves past its own number
let rows = [];

// ---------- the embedded sample: a DTC skincare brand, 24 SKUs with a story ----------
// 3 heroes about to stock out, 5 dead SKUs sitting on cash, 2 overstocked, the rest healthy.
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
      : "paste a sheet or load the sample — the count is instant";
    return;
  }
  const s = computeStats(rows);
  $("s-units").textContent = fmtNum(s.units);
  $("s-value").textContent = fmtINR(s.value);
  $("s-risk").textContent = String(s.risk.length);
  $("s-dead").textContent = String(s.dead.length);
  msg.className = "parse-msg ok";
  msg.textContent = "✓ " + rows.length + " SKUs read";
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

// ---------- steer ----------
document.querySelectorAll(".schip").forEach((chip) => {
  chip.addEventListener("click", () => {
    $("steer").value = chip.dataset.steer || chip.textContent;
    try { localStorage.setItem(K_STEER, $("steer").value); } catch { /* ignore */ }
  });
});
$("steer").addEventListener("input", () => { try { localStorage.setItem(K_STEER, $("steer").value); } catch { /* ignore */ } });
$("steer").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("go").disabled) runTriage(); });

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: { models: ["sonnet"], reason: "triage your inventory" },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables the button without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    installed = true;
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
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
    if (!rows.length) { hint.append("connected — now paste a sheet or load the sample"); return; }
    const b = document.createElement("b");
    b.textContent = "your own Claude";
    hint.append("runs on ", b, " — the sheet goes to your sidekick, nowhere else");
  } else if (installed) {
    hint.append("connect Switchboard (top right) to run the triage — the count above already works");
  } else {
    const a = document.createElement("a");
    a.href = INSTALL_URL;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = "get Switchboard";
    hint.append("needs the Switchboard sidekick — ", a, " and come straight back");
  }
}
reflect();

// ---------- triage: build prompt, stream, parse ONLY-JSON ----------
const csvField = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
function buildPrompt() {
  const clean = rows
    .map((r) => [r.sku, csvField(r.product), r.onHand, r.weekly, r.cost, r.price, r.lead].join(","))
    .join("\n");
  const steer = $("steer").value.trim();
  return [
    "You are the sharpest inventory foreman a small e-commerce brand ever hired. Blunt, numerate, practical. Currency: INR.",
    "Stock + sales sheet (CSV columns: sku,product,on_hand,avg_weekly_sales,unit_cost_inr,price_inr,lead_time_days):",
    clean,
    "",
    "Ground rules:",
    "- weeks_of_cover = on_hand / avg_weekly_sales. A SKU is a stockout risk when weeks_of_cover < lead_time_days / 7.",
    "- dead = avg_weekly_sales near zero with stock still on hand.",
    "- orderQty covers lead-time demand plus ~4 weeks of buffer, minus stock on hand, rounded to a sensible round number.",
    steer
      ? 'Owner\'s steer: "' + steer + '" — answer it head-on in steerAnswer and let it shape the reorder and discount calls.'
      : "No steer given — make steerAnswer the single highest-value move for this week.",
    "",
    "Respond with ONLY a JSON object — no prose, no markdown fences — exactly this shape:",
    '{"summary":"two plain-talk sentences on the shape of the situation","cashLockedInDead":0,"reorderNow":[{"sku":"","product":"","orderQty":0,"why":""}],"watch":[{"sku":"","product":"","why":""}],"deadWeight":[{"sku":"","product":"","action":"","recoverable":0}],"abc":{"a":["SKU"],"b":["SKU"],"c":["SKU"]},"steerAnswer":""}',
    "- cashLockedInDead: number = sum of on_hand × unit_cost across the deadWeight SKUs.",
    '- deadWeight: action is one concrete move ("40% off, bundle with the Vitamin C hero", "liquidate to a reseller lot"); recoverable is the realistic INR you can pull back (number).',
    "- abc: classify EVERY sku by weekly revenue (price × avg_weekly_sales): a = the head that drives most revenue, b = middle, c = tail. Use only SKU codes from the sheet, each exactly once.",
    "- why/action lines: one specific sentence each, use the actual numbers (cover weeks, lead time, cash).",
  ].filter(Boolean).join("\n");
}

const PROG_LINES = [
  "Counting the shelves…",
  "Checking lead times…",
  "Weighing the dead stock…",
  "Splitting A / B / C…",
  "Stamping the manifest…",
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
  const b = document.createElement("b");
  b.textContent = "Triage failed. ";
  p.append(b, String(err?.message || err).slice(0, 240));
  $("errbox").hidden = false;
}

async function runTriage() {
  if (!relay || running || !rows.length) return;
  const myRun = ++runSeq;
  $("errbox").hidden = true;
  setRunning(true);
  let acc = "";
  try {
    for await (const d of relay.stream({ prompt: buildPrompt() })) {
      if (myRun !== runSeq) return; // cancelled or superseded — don't touch the UI
      if (d.type === "text") {
        acc += d.text;
        $("prog-meta").textContent = (acc.length / 1024).toFixed(1) + " kb";
      } else if (d.type === "error") {
        throw new Error(d.error?.message || "stream error");
      }
    }
    if (myRun !== runSeq) return;
    const raw = acc.match(/\{[\s\S]*\}/)?.[0];
    if (!raw) throw new Error("the model replied without a manifest — hit Re-run triage, it lands on the retry");
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error("the manifest came back smudged (bad JSON) — hit Re-run triage"); }
    const result = { data, steer: $("steer").value.trim(), at: Date.now(), skuCount: rows.length };
    try { localStorage.setItem(K_LAST, JSON.stringify(result)); } catch { /* ignore */ }
    renderBoard(result);
    $("board").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (myRun === runSeq) showError(err);
  } finally {
    if (myRun === runSeq) setRunning(false);
  }
}
$("go").addEventListener("click", runTriage);
$("retry").addEventListener("click", runTriage);
$("b-regen").addEventListener("click", runTriage);
$("prog-cancel").addEventListener("click", () => { runSeq++; setRunning(false); });

// ---------- the board ----------
const arr = (v) => (Array.isArray(v) ? v : []);
const coerceNum = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

function tagCard(kind, item) {
  const el = document.createElement("div");
  el.className = "tagcard " + kind;
  const row = document.createElement("div");
  row.className = "trow";
  const sku = document.createElement("span");
  sku.className = "skutag";
  sku.textContent = String(item.sku ?? "?");
  row.append(sku);
  if (kind === "reorder") {
    const st = document.createElement("span");
    st.className = "tstamp";
    const q = coerceNum(item.orderQty);
    st.textContent = q != null ? "order " + fmtNum(q) : "order";
    row.append(st);
  } else if (kind === "dead") {
    const st = document.createElement("span");
    st.className = "tstamp";
    st.textContent = "dead";
    row.append(st);
  }
  const name = document.createElement("div");
  name.className = "tname";
  name.textContent = String(item.product ?? "");
  const why = document.createElement("div");
  why.className = "twhy";
  why.textContent = String(item.why ?? item.action ?? "");
  el.append(row, name, why);
  if (kind === "dead") {
    const rec = document.createElement("div");
    rec.className = "trecover";
    const rn = coerceNum(item.recoverable);
    rec.textContent = "recover ≈ " + (rn != null ? fmtINR(rn) : String(item.recoverable ?? "?"));
    el.append(rec);
  }
  return el;
}
function fillColumn(mountId, countId, kind, items) {
  const mount = $(mountId);
  mount.textContent = "";
  $(countId).textContent = items.length ? items.length + (items.length === 1 ? " SKU" : " SKUs") : "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "col-empty";
    empty.textContent = "— nothing on this hook";
    mount.append(empty);
    return;
  }
  items.forEach((it) => mount.append(tagCard(kind, it)));
}
function fillAbc(mountId, skus) {
  const mount = $(mountId);
  mount.textContent = "";
  if (!skus.length) {
    const s = document.createElement("span");
    s.className = "abcchip";
    s.textContent = "—";
    mount.append(s);
    return;
  }
  skus.forEach((s) => {
    const chip = document.createElement("span");
    chip.className = "abcchip";
    chip.textContent = String(typeof s === "object" && s !== null ? s.sku ?? JSON.stringify(s) : s);
    mount.append(chip);
  });
}

function renderBoard(result) {
  const d = result.data || {};
  $("board").hidden = false;
  const when = new Date(result.at || Date.now());
  $("b-meta").textContent =
    "triaged " + when.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
    " · " + (result.skuCount || arr(d.reorderNow).length + arr(d.watch).length + arr(d.deadWeight).length) + " SKUs" +
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
  const note = String(d.steerAnswer ?? "").trim();
  $("note-wrap").hidden = !note;
  $("note-text").textContent = note;
}

// ---------- boot: restore state, never a blank box ----------
(function boot() {
  let savedCsv = null, savedSteer = "", savedLast = null;
  try {
    savedCsv = localStorage.getItem(K_CSV);
    savedSteer = localStorage.getItem(K_STEER) || "";
    savedLast = JSON.parse(localStorage.getItem(K_LAST) || "null");
  } catch { /* ignore */ }
  $("csv").value = savedCsv != null && savedCsv.trim() ? savedCsv : SAMPLE_CSV;
  $("steer").value = savedSteer;
  reparse(false);
  if (savedLast && savedLast.data) renderBoard(savedLast);
})();
