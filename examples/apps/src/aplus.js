// A-Plus — Amazon A+ content, context-first. Lend it a brand through Switchboard and it already
// knows the products, the voice, the palette: zero typing from connect to a full module stack,
// rendered like the real thing. The app ships ONLY the interface: every word is written by the
// visitor's own Claude through the Switchboard SDK (WebFetch only when the line is a URL).
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "aplus:v2";
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
// The one sample — exists ONLY pre-connect, visibly labeled, replaced the moment real context exists.
const SAMPLE_LINE = "Copper tongue cleaner, 2-pack — pure copper, flexible handle, replaces the plastic junk";
const CUSTOM = "__custom__";

let relay = null;
let notInstalled = false;
let brand = null;         // the normalized lent brand context, or null
let productChoice = "";   // brand mode: one of brand.products, or CUSTOM
let autoTone = "";        // the last tone we auto-filled from a brand voice (so we don't clobber edits)
let directions = null;    // [{name, heroHeadline, angle, chartArgues, recommended}] — stage 1
let chosenIdx = -1;       // which direction the user picked
let stack = null;         // the normalized A+ stack (see SHAPE) — stage 2
let busy = false;
let runSeq = 0;           // bumping this abandons any in-flight stream
let lastTask = null;      // what "Try again" re-runs

// ---------- small helpers ----------
const str = (v, fb = "") => (typeof v === "string" && v.trim() ? v.trim() : fb);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const cellVal = (v) => {
  if (v === true || v === "true") return true;
  if (v === false || v === "false" || v == null) return false;
  const t = String(v).trim();
  return t ? t : false;
};
function event(t) { $("events").append(el("div", "event", t)); }
function toast(t) {
  const box = $("toast");
  box.textContent = t;
  box.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.remove("show"), 1500);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* best effort */ }
    ta.remove();
  }
}

// ---------- persistence ----------
function save() {
  const data = {
    line: $("f-line").value, custom: $("f-custom").value, tone: $("f-tone").value,
    autoTone, productChoice, directions, chosenIdx, stack,
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
}
function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { /* corrupt */ }
  if (d) {
    if (typeof d.line === "string") $("f-line").value = d.line;
    if (typeof d.custom === "string") $("f-custom").value = d.custom;
    if (typeof d.tone === "string") $("f-tone").value = d.tone;
    if (typeof d.autoTone === "string") autoTone = d.autoTone;
    if (typeof d.productChoice === "string") productChoice = d.productChoice;
    if (Array.isArray(d.directions)) {
      try { directions = normalizeDirections({ directions: d.directions }); } catch { directions = null; }
    }
    if (directions && Number.isInteger(d.chosenIdx) && d.chosenIdx >= -1 && d.chosenIdx < directions.length) chosenIdx = d.chosenIdx;
    if (d.stack && typeof d.stack === "object") {
      try { stack = normalizeStack(d.stack); } catch { stack = null; }
    }
  }
  // The sample fills an empty box only; connect clears it (sample lives ONLY pre-connect).
  if (!$("f-line").value.trim()) $("f-line").value = SAMPLE_LINE;
  if (directions) { renderDirections(); $("directions").hidden = false; }
  if (stack) { renderStack(); $("preview").hidden = false; }
}

// ---------- brand context (context-first: everything derives from the lent brand) ----------
// Defensive normalization — data is opaque by convention, see docs/CONTEXT-KINDS.md kind "brand".
function normalizeBrand(ctx) {
  const d = (ctx && ctx.data) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  const products = arr(d.products).length ? arr(d.products) : arr(d.range);
  return {
    name: str(ctx.name) || str(d.name) || "Brand",
    voice: str(d.voice) || str(d.vibe) || str(d.positioning),
    positioning: str(d.positioning),
    audience: str(d.audience),
    palette: arr(d.palette).map((c) => c.trim()).filter((c) => /^(#[0-9a-f]{3,8}|rgb|hsl|[a-z]+)/i.test(c)),
    products,
  };
}
function applyBrand(ctx) {
  brand = normalizeBrand(ctx);
  if (!brand.products.includes(productChoice) && productChoice !== CUSTOM) {
    productChoice = brand.products.length ? brand.products[0] : CUSTOM;
  }
  // Derive the tone line from the brand voice — but never clobber a line the user edited.
  // Runs even when the new brand has no voice, so an auto-filled tone from the previous
  // brand is cleared instead of lingering as if the user wrote it.
  const t = $("f-tone");
  if (!t.value.trim() || t.value.trim() === autoTone) t.value = brand.voice;
  autoTone = brand.voice;
  if (stack) renderStack(); // re-tint the hero banner with the brand palette
  reflectEntry();
  save();
}
async function loadBrandContext() {
  if (!relay) return;
  try {
    const ctx = await relay.context.active();
    if (ctx) applyBrand(ctx);
    else reflectEntry();
  } catch { reflectEntry(); }
}
async function pickBrand() {
  if (!relay || busy) return;
  try {
    const ctx = await relay.context.pick(); // opens the side-panel picker; selecting one lends it here
    if (ctx) applyBrand(ctx);
  } catch { /* user closed the picker */ }
}
$("use-brand").addEventListener("click", pickBrand);
$("brand-switch").addEventListener("click", pickBrand);

// ---------- the standard connect chip ----------
async function onRelay() {
  // Real context exists now — the labeled sample dies the moment it can be replaced.
  if ($("f-line").value.trim() === SAMPLE_LINE) $("f-line").value = "";
  reflectEntry();
  await loadBrandContext(); // re-read the lent brand on connect AND on load with an existing grant
}
mountConnect($("chip-dock"), {
  scope: { reason: "write your Amazon A+ content", tools: ["WebFetch"], models: ["sonnet"] },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; onRelay(); },
  onDisconnect: () => { relay = null; brand = null; reflectEntry(); },
  // The chip's "Switch" (and the side panel) can change the lent brand — follow it live.
  onProjectChange: (ctx) => {
    if (ctx) { applyBrand(ctx); return; }
    // null can mean "picker dismissed" as well as "lend revoked" — re-read what's actually lent.
    brand = null;
    loadBrandContext();
  },
});
// Fast probe so a returning user's grant enables everything without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; await onRelay(); }
  } else if (r && r.installed === false) {
    notInstalled = true;
  }
  reflectEntry();
})();

// ---------- entry states ----------
// brand lent → zero typing (chips from the brand's products, tone from its voice)
// connected, no brand → one line + "use a brand" affordance
// not connected → one line, prefilled with the labeled sample
function reflectEntry() {
  const withBrand = !!(relay && brand);
  $("entry-brand").hidden = !withBrand;
  $("entry-line").hidden = withBrand;
  $("brandbar").hidden = !withBrand;
  if (withBrand) {
    $("brand-name").textContent = "A+ for " + brand.name;
    const sw = $("brand-swatches");
    sw.textContent = "";
    for (const c of brand.palette.slice(0, 5)) { const s = el("span", "sw"); s.style.background = c; sw.append(s); }
    renderProductChips();
    $("f-custom").hidden = productChoice !== CUSTOM;
    $("tone-note").hidden = false;
    $("tone-note").textContent = "from " + brand.name + "’s voice — edit freely";
  } else {
    $("use-brand-row").hidden = !relay;
    $("tone-note").hidden = true;
  }
  $("sample-chip").hidden = !(!relay && $("f-line").value.trim() === SAMPLE_LINE);
  reflect();
}
function chipBtn(label, on, fn) {
  const b = el("button", "pchip" + (on ? " on" : ""), label);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
function renderProductChips() {
  const m = $("product-chips");
  m.textContent = "";
  brand.products.slice(0, 8).forEach((p) => {
    m.append(chipBtn(p, productChoice === p, () => { productChoice = p; reflectEntry(); save(); }));
  });
  m.append(chipBtn("something else…", productChoice === CUSTOM, () => {
    productChoice = CUSTOM; reflectEntry(); save(); $("f-custom").focus();
  }));
}

function currentProduct() {
  if (relay && brand) {
    if (productChoice === CUSTOM) return str($("f-custom").value);
    return str(productChoice);
  }
  return str($("f-line").value);
}
// The single input takes a line OR a url — detect the url for the WebFetch step.
function lineUrl() {
  if (relay && brand && productChoice !== CUSTOM) return "";
  const line = currentProduct();
  const m = line.match(/https?:\/\/\S+/i);
  if (m) return m[0];
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(line)) return "https://" + line;
  return "";
}

function reflect() {
  const on = !!relay;
  $("go").disabled = !on || busy || !currentProduct();
  $("rg-directions").disabled = !on || busy || !currentProduct();
  ["rg-hero", "rg-features", "rg-comparison", "rg-brandstory", "rg-faqs", "rg-terms", "regen-all"]
    .forEach((id) => { $(id).disabled = !on || busy || !stack; });
  $("copy-all").disabled = !stack;
  $("copy-terms").disabled = !stack;
  const hint = $("conn-hint");
  hint.textContent = "";
  if (on) {
    hint.textContent = brand
      ? "writing as " + brand.name + " — on your Claude, the app never sees a key"
      : "connected — writes on your Claude, the app never sees a key";
  } else if (notInstalled) {
    hint.append("needs the Switchboard sidekick — ");
    const a = document.createElement("a");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer";
    a.textContent = "get it here";
    hint.append(a);
  } else {
    hint.textContent = "everything here is explorable — connect Switchboard (top right) to write the stack";
  }
}

// ---------- prompts (the lent brand is woven into every one) ----------
function brandBrief() {
  if (!brand) return "";
  return [
    "BRAND (lent to this app via Switchboard — write as this brand):",
    "name: " + brand.name,
    brand.voice ? "voice: " + brand.voice : "",
    brand.positioning ? "positioning: " + brand.positioning : "",
    brand.audience ? "audience: " + brand.audience : "",
  ].filter(Boolean).join("\n");
}
function productBrief() {
  const tone = str($("f-tone").value);
  return [
    "PRODUCT: " + (currentProduct() || "an unnamed product"),
    brandBrief(),
    tone ? "TONE: " + tone : "",
  ].filter(Boolean).join("\n\n");
}
function fetchStep() {
  const url = lineUrl();
  if (!url) return "";
  return "FIRST: use the WebFetch tool to read " + url +
    " and pull real details — materials, dimensions, claims, review language, brand voice. " +
    "Fold what you learn into the copy; never invent specs the page does not support. Then write the JSON.";
}
function directionBrief() {
  const d = directions && directions[chosenIdx];
  if (!d) return "";
  return [
    "CHOSEN DIRECTION — the user picked this; the whole stack must commit to it:",
    "name: " + d.name,
    d.angle ? "angle: " + d.angle : "",
    d.heroHeadline ? 'hero: build on "' + d.heroHeadline + '" (refine the wording, keep the idea)' : "",
    d.chartArgues ? "the comparison chart must argue: " + d.chartArgues : "",
  ].filter(Boolean).join("\n");
}

// stage 1 — three distinct directions, exactly one recommended (options, not answers)
const DIR_SHAPE = [
  "{",
  '"directions": exactly 3 of {',
  '  "name": 2-4 word name for the creative direction,',
  '  "heroHeadline": the hero banner line this direction would run, <= 9 words, sentence case,',
  '  "angle": one sentence — the buyer psychology this direction sells with,',
  '  "chartArgues": one sentence — what the comparison chart argues under this direction,',
  '  "recommended": true | false — exactly ONE true: the one most likely to convert',
  "}}",
].join("\n");
function buildDirectionsPrompt() {
  return [
    "You are a senior Amazon listing copywriter planning an A+ (Enhanced Brand Content) module stack.",
    fetchStep(),
    productBrief(),
    "Propose exactly 3 genuinely DISTINCT creative directions for the full stack — different buyer psychology each (e.g. ritual/sensory vs mechanism/evidence vs anti-generic value), not three wordings of one idea." +
      (brand ? " Every direction must still sound unmistakably like the brand." : ""),
    "Respond with ONLY one JSON object — no prose, no markdown fences — shaped exactly:\n" + DIR_SHAPE,
  ].filter(Boolean).join("\n\n");
}
function normalizeDirections(d) {
  if (!d || !Array.isArray(d.directions) || d.directions.length < 2) throw new Error("INCOMPLETE");
  const list = d.directions.slice(0, 4).map((x) => ({
    name: str(x?.name, "Direction"),
    heroHeadline: str(x?.heroHeadline),
    angle: str(x?.angle),
    chartArgues: str(x?.chartArgues) || str(x?.comparisonArgues),
    recommended: x?.recommended === true || x?.recommended === "true",
  }));
  let rec = list.findIndex((x) => x.recommended);
  if (rec < 0) rec = 0;
  list.forEach((x, i) => { x.recommended = i === rec; });
  return list;
}

// stage 2 — the full stack, committed to the chosen direction
const SHAPE = [
  "{",
  '"heroHeadline": string — the big banner line, <= 9 words, benefit-first, sentence case,',
  '"heroSub": string — one supporting sentence, <= 28 words,',
  '"features": exactly 4 of {"emoji": exactly one emoji, "title": 2-5 words, "body": 1-2 sentences (<= 30 words)},',
  '"comparison": {"ourName": short display name for THIS product, "otherName": the generic alternative buyers weigh it against, "rows": exactly 5 of {"feature": 2-6 words, "ours": true | false | short string (<= 3 words), "other": true | false | short string (<= 3 words)}},',
  '"brandStory": {"headline": 3-8 words, "body": 2-3 sentences in first-person-plural brand voice},',
  '"faqs": exactly 3 of {"q": a question real buyers actually ask, "a": 1-3 sentence honest answer},',
  '"searchTerms": 8 to 12 lowercase buyer search phrases, 2-4 words each, no punctuation, no duplicates, no brand names',
  "}",
].join("\n");
function buildStackPrompt() {
  return [
    "You are a senior Amazon listing copywriter writing a complete A+ (Enhanced Brand Content) module stack.",
    fetchStep(),
    productBrief(),
    directionBrief(),
    'Write tight, concrete, conversion-focused retail copy. Ban the words "elevate", "game-changer", "unleash" and empty superlatives. ' +
      'In comparison cells use true for a clear win (renders as a green check), false for a miss (gray dash), or a short string when a value reads better (e.g. "Pure copper" vs "Plastic").',
    "Respond with ONLY one JSON object — no prose, no markdown fences — shaped exactly:\n" + SHAPE,
  ].filter(Boolean).join("\n\n");
}
function buildModulePrompt(key) {
  const m = MODULES[key];
  return [
    "You are a senior Amazon listing copywriter. You already wrote this A+ stack (JSON):",
    JSON.stringify(stack),
    productBrief(),
    directionBrief(),
    "Rewrite ONLY the " + m.label + ": take a genuinely different angle than the current version — same product, same tone, same honesty.",
    "Respond with ONLY one JSON object — no prose, no markdown fences — shaped exactly:\n" + m.shape,
  ].filter(Boolean).join("\n\n");
}

// ---------- normalization ----------
const normFeat = (f) => ({ emoji: str(f?.emoji, "✦"), title: str(f?.title, "Feature"), body: str(f?.body) });
const normRow = (r) => ({ feature: str(r?.feature, "—"), ours: cellVal(r?.ours), other: cellVal(r?.other) });
const normFaq = (f) => ({ q: str(f?.q, "—"), a: str(f?.a) });
function normalizeStack(d) {
  if (!d || !str(d.heroHeadline) || !Array.isArray(d.features) || !d.features.length ||
      !d.comparison || !Array.isArray(d.comparison.rows) || !d.comparison.rows.length ||
      !d.brandStory || !Array.isArray(d.faqs) || !d.faqs.length ||
      !Array.isArray(d.searchTerms) || !d.searchTerms.length) {
    throw new Error("INCOMPLETE");
  }
  return {
    heroHeadline: str(d.heroHeadline),
    heroSub: str(d.heroSub),
    features: d.features.slice(0, 4).map(normFeat),
    comparison: {
      ourName: str(d.comparison.ourName, "This one"),
      otherName: str(d.comparison.otherName, "The usual option"),
      rows: d.comparison.rows.slice(0, 6).map(normRow),
    },
    brandStory: { headline: str(d.brandStory.headline, "Our story"), body: str(d.brandStory.body) },
    faqs: d.faqs.slice(0, 4).map(normFaq),
    searchTerms: d.searchTerms.map((t) => str(String(t))).filter(Boolean).slice(0, 12),
  };
}

// ---------- per-module regeneration ----------
const MODULES = {
  hero: {
    btn: "rg-hero", mod: "mod-hero", label: "hero module (headline + subheadline)",
    line: "Rewriting the hero…",
    shape: '{"heroHeadline": "<= 9 words, benefit-first, sentence case", "heroSub": "one supporting sentence, <= 28 words"}',
    patch(d) {
      if (!str(d.heroHeadline)) throw new Error("INCOMPLETE");
      stack.heroHeadline = str(d.heroHeadline);
      stack.heroSub = str(d.heroSub, stack.heroSub);
    },
  },
  features: {
    btn: "rg-features", mod: "mod-features", label: "four-feature grid",
    line: "Rewriting the feature grid…",
    shape: '{"features": [exactly 4 of {"emoji": "exactly one emoji", "title": "2-5 words", "body": "1-2 sentences, <= 30 words"}]}',
    patch(d) {
      if (!Array.isArray(d.features) || !d.features.length) throw new Error("INCOMPLETE");
      stack.features = d.features.slice(0, 4).map(normFeat);
    },
  },
  comparison: {
    btn: "rg-comparison", mod: "mod-comparison", label: "comparison chart",
    line: "Rebuilding the comparison chart…",
    shape: '{"comparison": {"ourName": "short display name for THIS product", "otherName": "the generic alternative", "rows": [exactly 5 of {"feature": "2-6 words", "ours": true | false | "short string", "other": true | false | "short string"}]}}',
    patch(d) {
      const c = d.comparison;
      if (!c || !Array.isArray(c.rows) || !c.rows.length) throw new Error("INCOMPLETE");
      stack.comparison = {
        ourName: str(c.ourName, stack.comparison.ourName),
        otherName: str(c.otherName, stack.comparison.otherName),
        rows: c.rows.slice(0, 6).map(normRow),
      };
    },
  },
  brandStory: {
    btn: "rg-brandstory", mod: "mod-brandstory", label: "brand story band",
    line: "Redrafting the brand story…",
    shape: '{"brandStory": {"headline": "3-8 words", "body": "2-3 sentences, first-person-plural brand voice"}}',
    patch(d) {
      const b = d.brandStory;
      if (!b || (!str(b.headline) && !str(b.body))) throw new Error("INCOMPLETE");
      stack.brandStory = { headline: str(b.headline, stack.brandStory.headline), body: str(b.body, stack.brandStory.body) };
    },
  },
  faqs: {
    btn: "rg-faqs", mod: "mod-faqs", label: "FAQ module (3 questions)",
    line: "Re-answering the FAQs…",
    shape: '{"faqs": [exactly 3 of {"q": "a question real buyers actually ask", "a": "1-3 sentence honest answer"}]}',
    patch(d) {
      if (!Array.isArray(d.faqs) || !d.faqs.length) throw new Error("INCOMPLETE");
      stack.faqs = d.faqs.slice(0, 4).map(normFaq);
    },
  },
  searchTerms: {
    btn: "rg-terms", mod: "terms-sec", label: "backend search terms (give a fresh set, avoid repeating the current ones)",
    line: "Mining a fresh set of search terms…",
    shape: '{"searchTerms": [8 to 12 lowercase buyer search phrases, 2-4 words each, no punctuation, no duplicates, no brand names]}',
    patch(d) {
      if (!Array.isArray(d.searchTerms) || !d.searchTerms.length) throw new Error("INCOMPLETE");
      stack.searchTerms = d.searchTerms.map((t) => str(String(t))).filter(Boolean).slice(0, 12);
    },
  },
};

// ---------- streaming ----------
const DIR_LINES = ["Reading the brief…", "Sketching three directions…", "Arguing three different ways…"];
const GEN_LINES = [
  "Reading the brief…", "Writing the hero…", "Filling the feature grid…",
  "Building the comparison chart…", "Drafting the brand story…",
  "Answering buyer questions…", "Mining backend search terms…",
];
let lineTimer = null;
function startLines(lines) {
  const arr = Array.isArray(lines) ? lines : [lines];
  let i = 0;
  $("status-line").textContent = arr[0];
  clearInterval(lineTimer);
  if (arr.length > 1) lineTimer = setInterval(() => { i = (i + 1) % arr.length; $("status-line").textContent = arr[i]; }, 2400);
}
function setBusy(on, lines) {
  busy = on;
  $("statusbox").hidden = !on;
  if (on) {
    $("errbox").hidden = true;
    $("events").textContent = "";
    $("status-meta").textContent = "0.0 kb written";
    startLines(lines || GEN_LINES);
  } else {
    clearInterval(lineTimer);
  }
  reflect();
}

async function streamJSON(prompt, my) {
  let text = "";
  for await (const d of relay.stream({ prompt, agentic: true })) {
    if (my !== runSeq) return null; // cancelled / superseded — abandon quietly
    if (d.type === "text") {
      text += d.text;
      $("status-meta").textContent = (text.length / 1024).toFixed(1) + " kb written";
    } else if (d.type === "tool_proposed") {
      if (d.call?.name === "WebFetch") event("→ reading your product page (WebFetch, read-only)…");
      else event("→ tool proposed: " + (d.call?.name || "?"));
    } else if (d.type === "tool_result") {
      if (d.result?.ok) {
        if (d.call?.name === "WebFetch") event("✓ page read — folding it into the copy");
      } else {
        event("⚠ " + (d.call?.name || "tool") + " failed: " + (d.result?.error?.message || "unknown") + " — continuing from your line");
      }
    } else if (d.type === "error") {
      throw Object.assign(new Error(d.error?.message || "stream error"), { code: d.error?.code });
    }
  }
  if (my !== runSeq) return null;
  const m = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("PARSE");
  try { return JSON.parse(m[0]); } catch { throw new Error("PARSE"); }
}

// ---------- actions ----------
async function generateDirections() {
  if (!relay || busy || !currentProduct()) return;
  lastTask = generateDirections;
  const my = ++runSeq;
  setBusy(true, DIR_LINES);
  try {
    const data = await streamJSON(buildDirectionsPrompt(), my);
    if (!data || my !== runSeq) return;
    directions = normalizeDirections(data);
    chosenIdx = -1;
    save();
    renderDirections();
    $("directions").hidden = false;
    $("directions").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (my === runSeq) showError(err);
  } finally {
    if (my === runSeq) setBusy(false);
  }
}

async function pickDirection(i) {
  if (busy || !directions || !directions[i]) return;
  if (!relay) { toast("connect Switchboard (top right) to write the stack"); return; }
  chosenIdx = i;
  renderDirections();
  save();
  await generateStack();
}

async function generateStack() {
  if (!relay || busy || !currentProduct()) return;
  lastTask = generateStack;
  const my = ++runSeq;
  setBusy(true, GEN_LINES);
  try {
    const data = await streamJSON(buildStackPrompt(), my);
    if (!data || my !== runSeq) return;
    stack = normalizeStack(data);
    save();
    renderStack();
    $("preview").hidden = false;
    $("preview").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (my === runSeq) showError(err);
  } finally {
    if (my === runSeq) setBusy(false);
  }
}

async function regenModule(key) {
  if (!relay || busy || !stack) return;
  lastTask = () => regenModule(key);
  const m = MODULES[key];
  const my = ++runSeq;
  setBusy(true, m.line);
  $(m.mod).classList.add("rewriting");
  try {
    const data = await streamJSON(buildModulePrompt(key), my);
    if (!data || my !== runSeq) return;
    m.patch(data);
    save();
    renderStack();
  } catch (err) {
    if (my === runSeq) showError(err);
  } finally {
    $(m.mod).classList.remove("rewriting");
    if (my === runSeq) setBusy(false);
  }
}

function showError(err) {
  const box = $("errbox");
  box.hidden = false;
  const msg = String(err?.message || err);
  const code = err?.code;
  let head, body;
  if (code === 4001) { head = "Not connected."; body = "Approve the connect in the Switchboard chip (top right), then try again."; }
  else if (code === 4290) { head = "Budget cap reached."; body = "This app hit the daily token budget you granted it. Raise it in the Switchboard panel, or come back tomorrow."; }
  else if (code === 4900) { head = "Your Claude is unreachable."; body = "Start the Switchboard daemon, then hit Try again."; }
  else if (code === 4100) { head = "Not connected yet."; body = "Click the chip (top right) and approve the connect."; }
  else if (msg === "PARSE") { head = "That reply wasn't clean JSON."; body = "It happens — models drift. Hit Try again; the second pass almost always lands."; }
  else if (msg === "INCOMPLETE") { head = "The reply came back missing pieces."; body = "Hit Try again for a full pass."; }
  else { head = "Generation failed."; body = msg.slice(0, 240); }
  // Error text can echo model/daemon output — compose with textContent, never innerHTML.
  const p = $("err-text");
  p.textContent = "";
  const b = document.createElement("b");
  b.textContent = head;
  p.append(b, " " + body);
}

// ---------- rendering: direction option cards ----------
function renderDirections() {
  const g = $("dir-grid");
  g.textContent = "";
  if (!directions) return;
  const hot = chosenIdx >= 0 ? chosenIdx : directions.findIndex((d) => d.recommended);
  directions.forEach((d, i) => {
    const card = el("button", "dir" + (i === hot ? " hot" : ""));
    card.type = "button";
    const top = el("div", "dir-top");
    top.append(el("span", "dir-name", d.name));
    if (d.recommended) top.append(el("span", "dtag", "recommended"));
    if (i === chosenIdx) top.append(el("span", "dtag sel", "picked"));
    card.append(top);
    if (d.heroHeadline) card.append(el("div", "dir-hero", "“" + d.heroHeadline + "”"));
    if (d.angle) card.append(el("p", "dir-angle", d.angle));
    if (d.chartArgues) card.append(el("p", "dir-chart", "chart argues — " + d.chartArgues));
    card.addEventListener("click", () => pickDirection(i));
    g.append(card);
  });
}

// ---------- rendering the A+ stack ----------
// The brand's palette tints the hero banner INSIDE the canvas — the deliverable, never the chrome.
function heroGradient() {
  const p = (brand?.palette || []).slice(0, 3);
  if (p.length >= 3) return `linear-gradient(118deg, ${p[0]}, ${p[1]} 48%, ${p[2]})`;
  if (p.length === 2) return `linear-gradient(118deg, ${p[0]}, ${p[1]})`;
  if (p.length === 1) return `linear-gradient(118deg, ${p[0]}, color-mix(in srgb, ${p[0]} 55%, #FFFFFF))`;
  return "linear-gradient(118deg, #22262C, #3E444D 48%, #7E8791)";
}
function cellNode(v) {
  const sp = document.createElement("span");
  if (v === true) { sp.className = "ck"; sp.textContent = "✓"; }
  else if (v === false) { sp.className = "dash"; sp.textContent = "—"; }
  else sp.textContent = String(v);
  return sp;
}
function renderComparison() {
  const wrap = $("cmp-wrap");
  wrap.textContent = "";
  const c = stack.comparison;
  const tbl = document.createElement("table");
  tbl.className = "cmp";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const h0 = document.createElement("th"); h0.className = "f";
  const h1 = document.createElement("th"); h1.className = "ours"; h1.textContent = c.ourName;
  const h2 = document.createElement("th"); h2.textContent = c.otherName;
  hr.append(h0, h1, h2);
  thead.append(hr);
  const tb = document.createElement("tbody");
  c.rows.forEach((r) => {
    const tr = document.createElement("tr");
    const tdf = document.createElement("td"); tdf.className = "f"; tdf.textContent = r.feature;
    const td1 = document.createElement("td"); td1.className = "ours"; td1.append(cellNode(r.ours));
    const td2 = document.createElement("td"); td2.append(cellNode(r.other));
    tr.append(tdf, td1, td2);
    tb.append(tr);
  });
  tbl.append(thead, tb);
  wrap.append(tbl);
}
function renderStack() {
  if (!stack) return;
  // hero
  $("hero-banner").style.background = heroGradient();
  $("hero-headline").textContent = stack.heroHeadline;
  $("hero-sub").textContent = stack.heroSub;
  $("hero-sub").hidden = !stack.heroSub;
  // features
  const fg = $("feat-grid");
  fg.textContent = "";
  stack.features.forEach((f) => {
    const box = el("div", "feat");
    box.append(el("div", "ic", f.emoji), el("h4", null, f.title), el("p", null, f.body));
    fg.append(box);
  });
  // comparison
  renderComparison();
  // brand story
  $("bs-headline").textContent = stack.brandStory.headline;
  $("bs-body").textContent = stack.brandStory.body;
  // faqs
  const fl = $("faq-list");
  fl.textContent = "";
  stack.faqs.forEach((f) => {
    const row = el("div", "faq-row");
    const q = el("div", "faq-q");
    q.append(el("span", "qm", "Q"), el("span", null, f.q));
    row.append(q, el("p", "faq-a", f.a));
    fl.append(row);
  });
  // search-term chips
  const tw = $("terms");
  tw.textContent = "";
  stack.searchTerms.forEach((t) => {
    const b = el("button", "term", t);
    b.type = "button";
    b.addEventListener("click", async () => {
      await copyText(t);
      b.classList.add("copied");
      toast("Copied “" + t + "”");
      setTimeout(() => b.classList.remove("copied"), 1200);
    });
    tw.append(b);
  });
}

// ---------- copy all text (Seller Central paste) ----------
function stackText() {
  if (!stack) return "";
  const cellTxt = (v) => (v === true ? "✓" : v === false ? "—" : String(v));
  const dir = directions && directions[chosenIdx];
  const tone = str($("f-tone").value);
  const L = [];
  L.push("A+ CONTENT — " + (currentProduct() || "product"));
  if (brand) L.push("brand: " + brand.name);
  if (dir) L.push("direction: " + dir.name);
  if (tone) L.push("tone: " + tone);
  L.push("");
  L.push("== HERO (standard image header with text) ==", stack.heroHeadline);
  if (stack.heroSub) L.push(stack.heroSub);
  L.push("", "== FOUR-FEATURE GRID (standard four image & text) ==");
  stack.features.forEach((f, i) => { L.push((i + 1) + ") " + f.title, f.body, ""); });
  L.push("== COMPARISON CHART — " + stack.comparison.ourName + " vs " + stack.comparison.otherName + " ==");
  stack.comparison.rows.forEach((r) => {
    L.push(r.feature + ": " + stack.comparison.ourName + " " + cellTxt(r.ours) + " · " + stack.comparison.otherName + " " + cellTxt(r.other));
  });
  L.push("", "== BRAND STORY ==", stack.brandStory.headline, stack.brandStory.body, "");
  L.push("== FAQ ==");
  stack.faqs.forEach((f) => { L.push("Q: " + f.q, "A: " + f.a, ""); });
  L.push("== BACKEND SEARCH TERMS (paste into Seller Central) ==", stack.searchTerms.join(" "));
  return L.join("\n");
}

// ---------- wiring ----------
$("go").addEventListener("click", generateDirections);
$("rg-directions").addEventListener("click", generateDirections);
$("regen-all").addEventListener("click", generateStack);
$("cancel").addEventListener("click", () => { runSeq++; setBusy(false); });
$("retry").addEventListener("click", () => { $("errbox").hidden = true; lastTask?.(); });
$("copy-all").addEventListener("click", async () => {
  if (!stack) return;
  await copyText(stackText());
  toast("Copied the whole stack — paste into Seller Central");
});
$("copy-terms").addEventListener("click", async () => {
  if (!stack) return;
  await copyText(stack.searchTerms.join(" "));
  toast("Copied " + stack.searchTerms.length + " terms, space-separated");
});
for (const [key, m] of Object.entries(MODULES)) {
  $(m.btn).addEventListener("click", () => regenModule(key));
}
["f-line", "f-custom", "f-tone"].forEach((id) => $(id).addEventListener("input", () => {
  save();
  $("sample-chip").hidden = !(!relay && $("f-line").value.trim() === SAMPLE_LINE);
  reflect();
}));

// ---------- boot ----------
restore();
reflectEntry();
