// A-Plus — Amazon A+ content in one pass. Product in, a full module stack out, rendered like
// the real thing. The app ships ONLY the interface: every word is written by the visitor's own
// Claude through the Switchboard SDK (WebFetch is used only if they hand us a URL).
import { whenRelayReady, mountConnect } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "aplus:v1";
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";

let relay = null;
let notInstalled = false;
let stack = null;   // the normalized A+ stack (see SHAPE)
let busy = false;
let runSeq = 0;     // bumping this abandons any in-flight stream
let lastTask = null; // what "Try again" re-runs

// ---------- tones & samples (never a blank box) ----------
const TONES = ["Premium minimal", "Ayurvedic heritage", "Clinical + evidence", "Playful DTC"];
const TONE_VOICE = {
  "Premium minimal": "restrained and confident — short sentences, zero hype words, no exclamation points, let the material speak",
  "Ayurvedic heritage": "warm and rooted — daily-ritual language, sensory detail, tradition treated with respect (never mystical woo)",
  "Clinical + evidence": "precise and mechanism-first — every claim earns its keep, name the how (copper ions, thermal mass, decibels), no fluff",
  "Playful DTC": "witty and conversational — first-person brand voice, one good joke per module max, still selling hard",
};
const SAMPLES = [
  {
    cat: "beauty", name: "Copper Tongue Cleaner — 2 pack", tone: "Ayurvedic heritage",
    bullets: [
      "pure copper, naturally antimicrobial — the ayurveda thing that actually works",
      "flexible handle so you don't gag, comfy for everyone in the house (that's why the 2 pack)",
      "replaces the plastic scraper junk — lasts forever, ships in a little cotton pouch",
    ].join("\n"),
  },
  {
    cat: "kitchen", name: "Cast Iron Tortilla Press — 8 inch", tone: "Premium minimal",
    bullets: [
      "restaurant-heavy cast iron — one squeeze, a perfect 8-inch tortilla, no rolling pin drama",
      "comes pre-seasoned, wipes clean, lives on the counter looking great",
      "not just tortillas — dumplings, empanadas, roti. we throw in 100 parchment rounds",
    ].join("\n"),
  },
  {
    cat: "gadget", name: "Pocket White Noise Machine — USB-C", tone: "Clinical + evidence",
    bullets: [
      "real fan inside, not a looped mp3 — actual non-repeating white noise",
      "hockey-puck small, lives in a carry-on side pocket, finally charges over USB-C",
      "remembers your last volume, 12 sounds, headphone jack for red-eyes",
    ].join("\n"),
  },
];
let sampleIdx = 0;
let tone = SAMPLES[0].tone;

// Soft product-gradient banner per tone.
const GRADS = {
  "Premium minimal": "linear-gradient(118deg, #22262C, #3E444D 48%, #7E8791)",
  "Ayurvedic heritage": "linear-gradient(118deg, #6E3317, #A85C2E 48%, #DDA36C)",
  "Clinical + evidence": "linear-gradient(118deg, #0E3A5C, #2C6E9E 48%, #8FC1E3)",
  "Playful DTC": "linear-gradient(118deg, #B03A52, #E56E5B 48%, #F7B08C)",
};

// ---------- small helpers ----------
const str = (v, fb = "") => (typeof v === "string" && v.trim() ? v.trim() : fb);
const cellVal = (v) => {
  if (v === true || v === "true") return true;
  if (v === false || v === "false" || v == null) return false;
  const t = String(v).trim();
  return t ? t : false;
};
function event(t) { const d = document.createElement("div"); d.className = "event"; d.textContent = t; $("events").append(d); }
function toast(t) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1500);
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
  const data = { name: $("f-name").value, bullets: $("f-bullets").value, url: $("f-url").value, tone, sampleIdx, stack };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
}
function restore() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { /* corrupt */ }
  if (d) {
    if (typeof d.name === "string") $("f-name").value = d.name;
    if (typeof d.bullets === "string") $("f-bullets").value = d.bullets;
    if (typeof d.url === "string") $("f-url").value = d.url;
    if (TONES.includes(d.tone)) tone = d.tone;
    if (Number.isInteger(d.sampleIdx) && SAMPLES[d.sampleIdx]) sampleIdx = d.sampleIdx;
    if (d.stack && typeof d.stack === "object") {
      try { stack = normalizeStack(d.stack); renderStack(); $("preview").hidden = false; } catch { stack = null; }
    }
  }
  renderTones();
  sampleNote();
}

// ---------- form ----------
function renderTones() {
  const mount = $("tones");
  mount.textContent = "";
  const rec = SAMPLES[sampleIdx].tone;
  TONES.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tone" + (t === tone ? " on" : "");
    if (t === rec) {
      const s = document.createElement("span");
      s.className = "star"; s.textContent = "★";
      b.append(s);
      b.title = "recommended for this sample";
    }
    b.append(document.createTextNode(t));
    b.addEventListener("click", () => { tone = t; renderTones(); save(); });
    mount.append(b);
  });
}
function sampleNote() {
  $("sample-note").textContent = "sample " + (sampleIdx + 1) + "/" + SAMPLES.length + " · " + SAMPLES[sampleIdx].cat;
}
function loadSample(i) {
  sampleIdx = ((i % SAMPLES.length) + SAMPLES.length) % SAMPLES.length;
  const smp = SAMPLES[sampleIdx];
  $("f-name").value = smp.name;
  $("f-bullets").value = smp.bullets;
  $("f-url").value = "";
  tone = smp.tone;
  renderTones();
  sampleNote();
  save();
}

// ---------- the standard connect chip ----------
mountConnect($("chip-dock"), {
  scope: { reason: "write your Amazon A+ content", tools: ["WebFetch"], models: ["sonnet"] },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflect(); },
  onDisconnect: () => { relay = null; reflect(); },
});
// Fast probe so a returning user's grant enables the buttons without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) relay = r;
  } else if (r && r.installed === false) {
    notInstalled = true;
  }
  reflect();
})();

const REGEN_IDS = ["rg-hero", "rg-features", "rg-comparison", "rg-brandstory", "rg-faqs", "rg-terms", "regen-all"];
function reflect() {
  const on = !!relay;
  $("go").disabled = !on || busy;
  REGEN_IDS.forEach((id) => { $(id).disabled = !on || busy || !stack; });
  $("copy-all").disabled = !stack;
  $("copy-terms").disabled = !stack;
  const hint = $("conn-hint");
  hint.textContent = "";
  if (on) {
    hint.textContent = "connected — writes on your Claude, the app never sees a key";
  } else if (notInstalled) {
    hint.append("needs the Switchboard sidekick — ");
    const a = document.createElement("a");
    a.href = INSTALL_URL; a.target = "_blank"; a.rel = "noreferrer";
    a.textContent = "get it here";
    hint.append(a);
  } else {
    hint.textContent = "everything below works now — connect Switchboard (top right) to write the stack";
  }
}

// ---------- prompts ----------
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

function productBrief() {
  const name = str($("f-name").value, "an unnamed product");
  const bullets = str($("f-bullets").value, "(no bullets given — infer sensible, honest claims from the product name)");
  return [
    "PRODUCT: " + name,
    "FOUNDER'S ROUGH BULLETS (raw notes — rewrite them properly, keep every real claim, invent nothing):\n" + bullets,
    "TONE: " + tone + " — " + (TONE_VOICE[tone] || ""),
  ].join("\n\n");
}
function fetchStep() {
  let url = str($("f-url").value);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return "FIRST: use the WebFetch tool to read " + url +
    " and pull real details — materials, dimensions, claims, review language, brand voice. " +
    "Fold what you learn into the copy; never invent specs the page does not support. Then write the JSON.";
}
function buildStackPrompt() {
  return [
    "You are a senior Amazon listing copywriter writing a complete A+ (Enhanced Brand Content) module stack.",
    fetchStep(),
    productBrief(),
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
    "Rewrite ONLY the " + m.label + ": take a genuinely different angle than the current version — same product, same tone, same honesty.",
    "Respond with ONLY one JSON object — no prose, no markdown fences — shaped exactly:\n" + m.shape,
  ].join("\n\n");
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
      ourName: str(d.comparison.ourName, str($("f-name").value, "This one")),
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
        event("⚠ " + (d.call?.name || "tool") + " failed: " + (d.result?.error?.message || "unknown") + " — continuing from your bullets");
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
async function generateStack() {
  if (!relay || busy) return;
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
  else if (msg === "INCOMPLETE") { head = "The stack came back missing pieces."; body = "Hit Try again for a full pass."; }
  else { head = "Generation failed."; body = msg.slice(0, 240); }
  // Error text can echo model/daemon output — compose with textContent, never innerHTML.
  const p = $("err-text");
  p.textContent = "";
  const b = document.createElement("b");
  b.textContent = head;
  p.append(b, " " + body);
}

// ---------- rendering the A+ stack ----------
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
  $("hero-banner").style.background = GRADS[tone] || GRADS["Ayurvedic heritage"];
  $("hero-headline").textContent = stack.heroHeadline;
  $("hero-sub").textContent = stack.heroSub;
  $("hero-sub").hidden = !stack.heroSub;
  // features
  const fg = $("feat-grid");
  fg.textContent = "";
  stack.features.forEach((f) => {
    const el = document.createElement("div"); el.className = "feat";
    const ic = document.createElement("div"); ic.className = "ic"; ic.textContent = f.emoji;
    const h = document.createElement("h4"); h.textContent = f.title;
    const p = document.createElement("p"); p.textContent = f.body;
    el.append(ic, h, p);
    fg.append(el);
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
    const row = document.createElement("div"); row.className = "faq-row";
    const q = document.createElement("div"); q.className = "faq-q";
    const qm = document.createElement("span"); qm.className = "qm"; qm.textContent = "Q";
    const qt = document.createElement("span"); qt.textContent = f.q;
    q.append(qm, qt);
    const a = document.createElement("p"); a.className = "faq-a"; a.textContent = f.a;
    row.append(q, a);
    fl.append(row);
  });
  // search-term chips
  const tw = $("terms");
  tw.textContent = "";
  stack.searchTerms.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "term"; b.textContent = t;
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
  const L = [];
  L.push("A+ CONTENT — " + str($("f-name").value, "product"));
  L.push("tone: " + tone, "");
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
$("go").addEventListener("click", generateStack);
$("regen-all").addEventListener("click", generateStack);
$("sample-btn").addEventListener("click", () => loadSample(sampleIdx + 1));
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
["f-name", "f-bullets", "f-url"].forEach((id) => $(id).addEventListener("input", save));

// ---------- boot ----------
restore();
reflect();
