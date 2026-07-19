// The store HOME — itself a wrapp, and a dark Toolfolio-style directory with a Work-OS dashboard on
// top. The catalog works for anyone; connect Switchboard and the zone above the directory becomes
// YOUR dashboard: a greeting by name, your real PROJECTS (from the consented library-visibility
// primitive — context.list() metas), recommendations and one-click actions derived from your
// library, a personalized sidebar (your brands), plus a floating dock launcher. Nothing here is
// decorative data on the real path: no context flows until the user approves the one consent row, and
// the page never sees context DATA at all — names and kinds only, which is all a home needs.
//
// INVARIANT — this page calls context.list() and context.publish(), and NEVER context.use()/active().
// It writes to your library; it does not read inside it. With contextKinds granted the PLATFORM would
// happily hand this origin any context's full data (adforge.js does exactly that), so the discipline
// lives here, in one place: every context call goes through `ctx` below, and `ctx` has no reader.
// That is why the consent copy says "never OPENS the contents of" — a statement about behaviour —
// rather than "cannot see", which would be false.
//
// FIRST-PROJECT SETUP ("Point at it and it's yours") is the front door: every wrapp is proactive now,
// generating options FROM the user's project, so an empty library is the one thing that breaks the
// whole catalog at once. #point-sec (src/store/point.js) turns one pointer — a site URL, a GitHub
// repo, or a folder on this Mac — into a banked context every wrapp can borrow.
//
// The not-yet-built taskOS layer (stat tiles, ready-to-review cards, automations, sprint stats, plays)
// is fenced behind the localhost-gated `isDemo` flag, so the deployed store can NEVER show fabricated
// task numbers. On the real connected path those surfaces show a tasteful "coming" state instead.
// Plan/wallet surfaces are labeled SIMULATED per docs/TOKENS.md; the one standing law: your own Claude
// runs everything free, forever.
//
// The store cards + featured hero don't mock a screenshot — each renders a scaled, same-origin LIVE
// iframe of the wrapp's ./{id}-landing.html marketing page, so the colour comes from real product
// pages popping against the near-black chrome (the Toolfolio look), with zero screenshot step.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { APPS, APP_BY_ID, fmtTok } from "./store/catalog.js";
import { FAM, famOf, glyphSvg, glyphTile, thumbArt } from "./store/glyphs.js";
import {
  CATEGORIES, CATEGORY_BLURB, categoryOf, categoryFam, categoryGlyphSvg, categoryCounts,
} from "./store/taxonomy.js";
import { createPoint } from "./store/point.js";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";
const KINDS = ["brand", "personal", "project", "csv", "gsheet", "note"];

// The scope this page asks for. It grows by ONE model and ONE read-class tool over what the home
// used to need — enough for the three pointers, and not an inch of extra reach over the library:
//  · models  — all three pointers need a model (the folder pointer needs ONLY this, no tools).
//  · WebFetch — the site and repo pointers. Deliberately NOT WebSearch: the user names the exact
//    target, so there is nothing to search for, and it would let this page reach hosts they never named.
//  · contextKinds — UNCHANGED. context.publish is available to any connected origin; publishing does
//    not need a new kind or a new scope field.
// storage.bind is deliberately absent: it carries its own out-of-band consent showing the absolute
// path, and that prompt is a better consent moment than a line in a list.
const SCOPE = {
  reason:
    "your Switchboard home — greet you, show your library, and set up your first project: your Claude " +
    "reads the site, repo, or folder you point at, and banks what it finds. This page publishes what " +
    "you point it at; it still never opens the contents of your other contexts.",
  models: ["sonnet"],
  tools: ["WebFetch"],
  contextKinds: KINDS,
};
const isDemo = new URLSearchParams(location.search).has("demo") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// `?demo=empty` rehearses the thing the whole setup flow exists for: a brand-new install whose
// library is EMPTY. It is the same demo relay with nothing on the shelf — so the first-run can
// actually be walked and reviewed instead of only ever being seen over a pre-seeded library.
const isDemoEmpty = isDemo && new URLSearchParams(location.search).get("demo") === "empty";
// The fabricated task layer (drafts waiting, automations live, sprint bars) is a claim that work
// has ALREADY happened. Over an empty shelf nothing has, so it stays off and the honest real-path
// hero speaks instead — the same rule the rest of this file follows: never invent a count.
const demoTasks = isDemo && !isDemoEmpty;

// The newest arrivals — the founder-mandated icons list. Curated newest-first (the in-page ./ wrapps
// are the latest builds); each row carries the wrapp glyph + a category one-liner.
const RECENTLY_ADDED = ["huddle", "reel", "identity", "take", "batch", "marquee", "redline", "chat"];

let relay = null;
let booted = false;
const way = { installed: false, connected: false, brands: 0 };

// ---------- dashboard state (per-origin storage; values are strings, JSON in/out) ----------
let recents = [];
let plan = "free";
let wallet = { balance: 0, ledger: [] };
let metasCache = [];
let userName = "";
let promotedAction = null; // the action the hero's primary CTA took — Quick actions won't repeat it

// THE STORAGE-REBIND HAZARD. The folder pointer calls storage.bind, which repoints THIS ORIGIN's own
// per-origin store — the same store holding `recents`, `plan` and `wallet`. Without this freeze,
// pointing at ~/Projects/foo would write those three files into the user's repo. Every convenience
// write early-returns while frozen (dropping one costs nothing); the sandbox is re-bound after the
// pointer finishes. If that restore bind is declined we stay frozen for the session rather than
// silently resuming writes into someone's source tree.
let storageFrozen = false;

// THE ONE CONTEXT DOOR — list and publish, and no reader. See the INVARIANT in the header. The
// setup flow never gets the raw client either: `pointRelay` hands it a publish-only context surface,
// so the invariant holds for the whole page structurally, not by everyone remembering it.
const ctx = {
  list: () => relay.context.list(),
  publish: (c) => relay.context.publish(c),
};
const pointRelay = (r) => ({
  stream: (p) => r.stream(p),
  permissions: () => r.permissions(),
  connect: (sc) => r.connect(sc),
  storage: r.storage,
  context: { publish: (c) => ctx.publish(c) },
});

const now = () => new Date().getTime();
const s = (n) => (n === 1 ? "" : "s");
// Small counts read as words in a display line ("Three things need you"), as digits in the mono
// fact line. Anything past nine goes back to digits — spelled-out big numbers look like a typo.
const NUMWORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const word = (n) => (n >= 0 && n < NUMWORD.length ? NUMWORD[n] : String(n));
const low = (w) => w.charAt(0).toLowerCase() + w.slice(1);
function listNames(names, max = 3) {
  const l = names.filter(Boolean).slice(0, max);
  if (!l.length) return "";
  if (l.length === 1) return l[0];
  return `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}
function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function ago(ts) {
  const sec = Math.max(0, (now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
function kindCounts() {
  const c = {};
  for (const m of metasCache) { const k = (m.kind || "other").toLowerCase(); c[k] = (c[k] || 0) + 1; }
  return c;
}
function firstOf(kind) {
  return metasCache.find((m) => (m.kind || "").toLowerCase() === kind)?.name;
}

// A verified wrapp is one published to a live domain (https). The 8 in-page ./ preview wrapps don't
// carry the check yet. The check is the only blue-glyph on a card.
const isVerified = (app) => !!app && /^https:/.test(app.href);

// Every browsing surface in the store — catalog card, featured hero, recently-added row — points at
// the wrapp's DETAIL page (./{id}-landing.html), never straight at the app. The detail page is what
// carries the back link, the facts strip, the free/Pro split and the real "Open on your Claude"
// button, so the store introduces a wrapp before it hands you off to it. Action surfaces (the hero
// CTA, quick actions, recommendations, the dock) still go direct — those are "open it", not "see it".
const detailHref = (id) => `./${id}-landing.html`;
function pointAtDetail(a, app) {
  a.href = detailHref(app.id);
  a.removeAttribute("target"); // the detail page is ours — stay in the tab, the back link returns
  a.removeAttribute("rel");
  a.dataset.detail = "1"; // reading a detail page is browsing, not opening — keep it out of recents
}
const verifyBadge = () =>
  `<span class="verify" title="Verified — published to a live domain"><svg viewBox="0 0 24 24" fill="none">` +
  `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#0A0A0B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

// ---------- deterministic brand colour for a project card ----------
const FAMILIES = [FAM.gold, FAM.green, FAM.blue, FAM.pink, FAM.teal, FAM.violet];
function hashInt(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
function isHex(x) { return typeof x === "string" && /^#?[0-9a-fA-F]{6}$/.test(x.trim()); }
function normHex(x) { x = x.trim(); return x[0] === "#" ? x : "#" + x; }
function rgbOf(hex) { const h = normHex(hex).slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function hexLum(hex) { const [r, g, b] = rgbOf(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function mixToward(hex, target, amt) {
  const [r, g, b] = rgbOf(hex); const m = (c) => Math.round(c + (target - c) * amt);
  return `#${[m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const lighten = (hex, amt) => mixToward(hex, 255, amt);
const darken = (hex, amt) => mixToward(hex, 0, amt);
function colorFor(meta) {
  const swatch = Array.isArray(meta.swatches) ? meta.swatches.find(isHex) : null;
  let base, light;
  if (swatch) { base = normHex(swatch); light = lighten(base, 0.5); }
  else { const f = FAMILIES[hashInt(`${meta.name || ""}|${meta.kind || ""}`) % FAMILIES.length]; base = f.ink; light = f.light; }
  const mono = hexLum(base) > 0.62 ? "#1A1206" : "#FFFFFF";
  return { base, light, mono, pav: darken(base, 0.12) };
}

// ========================================================================================
// SIDEBAR — primary nav, personalized brands, category spine
// ========================================================================================
const NAV_GLYPH = {
  home: `<path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9"/>`,
  explore: `<circle cx="12" cy="12" r="8"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
  following: `<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z"/>`,
};
function renderNav() {
  const box = $("nav-primary");
  box.textContent = "";
  const rows = [
    { id: "home", label: "Home", target: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    { id: "explore", label: "Explore", target: () => $("store").scrollIntoView({ behavior: "smooth", block: "start" }) },
    { id: "following", label: "Following", connectedOnly: true, target: () => ($("dash").hidden ? $("recent-sec") : $("dash")).scrollIntoView({ behavior: "smooth", block: "start" }) },
  ];
  for (const r of rows) {
    if (r.connectedOnly && !way.connected) continue;
    const el = mk("button", "nav-row" + (r.id === "home" ? " active" : ""));
    el.type = "button";
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${NAV_GLYPH[r.id]}</svg>`;
    el.append(mk("span", null, r.label));
    el.onclick = () => {
      box.querySelectorAll(".nav-row").forEach((x) => x.classList.toggle("active", x === el));
      r.target();
      closeSide();
    };
    box.append(el);
  }
}

function renderCats() {
  const box = $("cats-list");
  box.textContent = "";
  const counts = categoryCounts(APPS);
  for (const cat of CATEGORIES) {
    const f = categoryFam(cat);
    const row = mk("button", "cat-row");
    row.type = "button";
    row.title = CATEGORY_BLURB[cat] || cat;
    const ic = mk("span", "cat-ic");
    ic.style.background = f.soft; ic.style.color = f.ink;
    ic.innerHTML = categoryGlyphSvg(cat);
    row.append(ic, mk("span", "cat-lbl", cat), mk("span", "cat-count", String(counts[cat] || 0)));
    row.onclick = () => {
      const h = [...document.querySelectorAll("#store .sec-h")].find((x) => x.dataset.cat === cat);
      h?.scrollIntoView({ behavior: "smooth", block: "start" });
      closeSide();
    };
    box.append(row);
  }
}

function renderBrands(metas) {
  const group = $("brands-group");
  const box = $("brands-list");
  box.textContent = "";
  let rows = metas.filter((m) => (m.kind || "").toLowerCase() === "brand");
  if (!rows.length) rows = metas.filter((m) => (m.kind || "").toLowerCase() === "project");
  if (!rows.length) { group.hidden = true; return; }
  group.hidden = false;
  for (const m of rows.slice(0, 8)) {
    const c = colorFor(m);
    const row = mk("div", "brand-row");
    const mkm = mk("span", "brand-mk", (m.name || "•")[0].toUpperCase());
    mkm.style.background = c.base; mkm.style.color = c.mono;
    row.append(mkm, mk("span", "brand-nm", m.name || "Untitled"));
    row.onclick = () => { $("projects").scrollIntoView({ behavior: "smooth", block: "center" }); closeSide(); };
    box.append(row);
  }
}

// mobile slide-over
function closeSide() { document.body.classList.remove("side-open"); }
$("side-toggle").onclick = () => document.body.classList.toggle("side-open");
$("side-scrim").onclick = closeSide;
$("side-search").onclick = () => { $("search").focus(); $("search").scrollIntoView({ block: "center" }); };

// ========================================================================================
// SCALED LIVE-PREVIEW MECHANISM — a same-origin iframe of ./{id}-landing.html, scaled + clipped
// ========================================================================================
const DESIGN_W = 1440;
function fitOne(thumb, fr) {
  const w = thumb.clientWidth;
  if (!w) return;
  const scale = w / DESIGN_W;
  fr.style.width = DESIGN_W + "px";
  fr.style.height = Math.round(w / (16 / 10)) / scale + "px";
  fr.style.transform = `scale(${scale})`;
  fr.style.transformOrigin = "top left";
}

// Iframe virtualization. Each `.thumb` keeps a lightweight tinted placeholder always; a live
// landing-page iframe is mounted only while the thumb is within ~1.3 viewports and removed once it
// scrolls far away. This bounds the compositor to the handful of previews actually near the screen
// instead of holding all 40+ scaled subframes at once (which discards the GPU surface on scroll).
const thumbInfo = new WeakMap(); // thumb -> { app, fr }
function mountThumb(thumb, info) {
  if (info.fr) return;
  const fr = document.createElement("iframe");
  fr.src = `./${info.app.id}-landing.html`;
  fr.loading = "lazy";
  fr.setAttribute("scrolling", "no");
  fr.setAttribute("tabindex", "-1");
  fr.setAttribute("aria-hidden", "true");
  fr.setAttribute("title", `${info.app.name} preview`);
  fr.addEventListener("load", () => fr.classList.add("ready"));
  info.fr = fr;
  thumb.appendChild(fr);
  requestAnimationFrame(() => info.fr && fitOne(thumb, info.fr));
}
function unmountThumb(info) {
  if (!info.fr) return;
  info.fr.remove();
  info.fr = null;
}
const thumbObserver = typeof IntersectionObserver !== "undefined"
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const info = thumbInfo.get(e.target);
        if (!info) continue;
        if (e.isIntersecting) mountThumb(e.target, info);
        else if (!info.keep) unmountThumb(info);
      }
    }, { rootMargin: "1200px 0px" })
  : null;

// `keep` thumbs (the 3 flagship hero previews) preload once and are never unmounted, so rotating
// the carousel reveals an already-loaded, already-fitted iframe with no placeholder flash. The rest
// stay virtualized. A hidden (display:none) slide's thumb mounts at width 0 and is re-fit by its
// ResizeObserver the instant it becomes visible.
function makeThumb(app, keep = false) {
  const thumb = mk("span", "thumb");
  const ph = mk("span", "thumb-ph");
  ph.style.setProperty("--fam", famOf(app.id).ink);
  ph.innerHTML = thumbArt(app.id);
  thumb.appendChild(ph);
  const info = { app, fr: null, keep };
  thumbInfo.set(thumb, info);
  const refit = () => info.fr && fitOne(thumb, info.fr);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(refit).observe(thumb);
  else window.addEventListener("resize", refit);
  if (keep) requestAnimationFrame(() => mountThumb(thumb, info)); // preload the flagship previews
  if (thumbObserver) thumbObserver.observe(thumb);
  else if (!keep) requestAnimationFrame(() => mountThumb(thumb, info)); // no IO — mount eagerly
  return thumb;
}

// ========================================================================================
// CATALOG DECORATION — iframe preview + glyph tile + verified + category + build-cost receipt
// ========================================================================================
function decorateCards() {
  document.querySelectorAll("a.featured[data-app]").forEach((card) => {
    const app = APP_BY_ID[card.dataset.app];
    if (!app) return;
    pointAtDetail(card, app);
    const cat = categoryOf(app.id);
    const f = categoryFam(cat);
    const desc = card.querySelector("p")?.textContent || "";
    const left = mk("span", "feat-l");
    left.append(mk("span", "fk", "Featured wrapp"));
    const head = mk("span", "feat-head");
    head.append(glyphTile(app.id, 56));
    const h = mk("h2");
    h.append(document.createTextNode(app.name));
    if (isVerified(app)) h.insertAdjacentHTML("beforeend", verifyBadge());
    head.append(h);
    left.append(head, mk("p", null, desc));
    const tag = mk("span", "feat-tag");
    const tic = mk("span", "cat-ic"); tic.style.background = f.soft; tic.style.color = f.ink; tic.innerHTML = categoryGlyphSvg(cat);
    tag.append(tic, document.createTextNode(cat));
    left.append(tag);
    const acts = mk("span", "feat-actions");
    const open = mk("span", "feat-open"); open.append(document.createTextNode("See the wrapp"), Object.assign(document.createElement("span"), { textContent: "→" }));
    acts.append(open, mk("span", "feat-cost", `built with ${fmtTok(app.tokens)} tokens`));
    left.append(acts);
    const right = mk("span", "feat-r");
    right.append(makeThumb(app, true));
    card.textContent = "";
    card.append(left, right);
  });

  document.querySelectorAll("a.card[data-app]").forEach((card) => {
    const app = APP_BY_ID[card.dataset.app];
    const body = card.querySelector(".body");
    const txt = card.querySelector(".txt") || body;
    if (!app || !body) return;
    pointAtDetail(card, app);
    // live preview thumbnail on top
    card.insertBefore(makeThumb(app), card.firstChild);
    // verified check beside the name
    if (isVerified(app)) card.querySelector("h4")?.insertAdjacentHTML("beforeend", verifyBadge());
    // glyph tile at the head of the body row
    body.insertBefore(glyphTile(app.id, 34), body.firstChild);
    // Toolfolio-clean footer: category (+ a small Pro pill only when there IS a pro tier —
    // "free core" is true of every wrapp, so labeling it on each card is just noise), then one
    // muted build-cost receipt. dev-reported is folded into the line, not a separate chip.
    const tags = mk("span", "cat-line");
    tags.append(mk("span", "cat-tag", categoryOf(app.id)));
    if (app.pro) {
      const pp = mk("span", "pro-pill", "Pro");
      pp.title = `Pro tier: ${app.pro.join(" · ")}. Free core is always complete and never gated.`;
      tags.append(pp);
    }
    txt.append(tags);
    const cost = mk("span", "cost");
    cost.innerHTML = `<b>${fmtTok(app.tokens)}</b> tokens · dev-reported`;
    cost.title = "Build-cost receipt — reported by the developer. Broker-metered receipts land with the creator pipeline; only measured numbers will ever drop this tag.";
    txt.append(cost);
    if (isDemo) {
      const pl = mk("span", "pl");
      pl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l14 8-14 8z"/></svg>`;
      pl.append(document.createTextNode(`${fmtTok(Math.round(app.tokens * 0.9))} plays · illustrative`));
      txt.append(pl);
    }
  });
}

// ========================================================================================
// FEATURED CAROUSEL
// ========================================================================================
function initFeatured() {
  const slides = [...document.querySelectorAll("#featured .featured")];
  const dotBox = $("featured-dots");
  if (!slides.length) return;
  let fi = 0, timer = null;
  dotBox.textContent = "";
  const dots = slides.map((_, i) => {
    const d = mk("button", "fdot");
    d.type = "button";
    d.setAttribute("aria-label", `Featured ${i + 1}`);
    d.onclick = () => { show(i); restart(); };
    dotBox.append(d);
    return d;
  });
  function show(i) {
    fi = (i + slides.length) % slides.length;
    slides.forEach((sl, k) => sl.classList.toggle("on", k === fi));
    dots.forEach((d, k) => d.classList.toggle("on", k === fi));
  }
  function restart() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => show(fi + 1), 6500);
  }
  $("featured").addEventListener("mouseenter", () => timer && clearInterval(timer));
  $("featured").addEventListener("mouseleave", restart);
  show(0);
  restart();
}

// ========================================================================================
// RECENTLY ADDED — the icons list (founder-mandated glyphs)
// ========================================================================================
function renderRecent() {
  const box = $("recent-list");
  box.textContent = "";
  for (const id of RECENTLY_ADDED) {
    const app = APP_BY_ID[id];
    if (!app) continue;
    const row = mk("a", "recent-row");
    row.dataset.app = id;
    pointAtDetail(row, app);
    row.append(glyphTile(id, 34));
    const t = mk("span", "rr-t");
    const n = mk("span", "rr-n");
    n.append(document.createTextNode(app.name));
    if (isVerified(app)) n.insertAdjacentHTML("beforeend", verifyBadge());
    t.append(n, mk("span", "rr-c", firstLine(app)));
    row.append(t, mk("span", "rr-cat", categoryOf(id)));
    box.append(row);
  }
}
function firstLine(app) {
  const card = document.querySelector(`a.card[data-app="${app.id}"] p`);
  return card ? card.textContent : categoryOf(app.id);
}

// ========================================================================================
// THE WAY — onboarding stepper (reflects reality, routes the click to the next move)
// ========================================================================================
const STEPS = [
  { title: "Get Switchboard", sub: "the extension + sidekick that lend apps your Claude",
    done: () => way.installed, act: () => window.open("https://thelastprompt.ai/switchboard/", "_blank", "noreferrer"),
    doneSub: "installed — your AI has a body" },
  { title: "Connect this page", sub: "one consent — then this home shows what you own",
    done: () => way.connected, act: () => clickConnect(), doneSub: "connected — this page is your dashboard now" },
  // Step 3 used to send people to brandbrain for a full brand build. Leaving the store to do
  // onboarding somewhere else is exactly the gap the pointer flow closes, so it opens inline now.
  { title: "Point at your first project", sub: "a site, a repo, or a folder — your Claude reads it and banks what it finds",
    done: () => way.brands > 0 || metasCache.some((m) => (m.kind || "").toLowerCase() === "project"),
    act: () => point.open(),
    doneSub: () => `${way.brands || metasCache.length} banked — every app below can borrow it` },
  { title: "Point an app at it", sub: "open any app — it asks for what it needs, you approve once",
    done: () => false, act: () => document.querySelector('a.card[data-app="adforge"]')?.scrollIntoView({ behavior: "smooth", block: "center" }),
    currentSub: "the founder stack below runs on the brand you just banked" },
];
function renderWay() {
  const box = $("way");
  box.textContent = "";
  let currentMarked = false;
  STEPS.forEach((st, i) => {
    const done = st.done();
    const isCurrent = !done && !currentMarked;
    if (isCurrent) currentMarked = true;
    const card = mk("div", "step " + (done ? "done" : isCurrent ? "current" : "todo"));
    const p = mk("p", null,
      done ? (typeof st.doneSub === "function" ? st.doneSub() : st.doneSub || st.sub)
           : (isCurrent && st.currentSub) ? st.currentSub : st.sub);
    card.append(mk("div", "n", `STEP ${i + 1}`), mk("h5", null, st.title), p, mk("div", "state", done ? "✓" : isCurrent ? "→" : ""));
    card.onclick = () => st.act();
    box.append(card);
  });
}
function clickConnect() { $("chip-dock").firstElementChild?.shadowRoot?.querySelector("button")?.click(); }

// ========================================================================================
// FIRST-PROJECT SETUP — one section, two homes
// ========================================================================================
// Disconnected it sits inside #hero above "The way", tiles live but the input disabled. Connected it
// moves to the top of #dash, before "Ready to review" — the first thing a signed-in user sees when
// their library is empty. Onboarding never leaves the store again.
const point = createPoint({
  scope: SCOPE,
  clickConnect: () => clickConnect(),
  isFrozen: () => storageFrozen,
  freeze: (on) => { storageFrozen = !!on; },
  buildActions: (focus) => buildActions(focus),
  onPublished: () => refreshLibrary(),
});
function movePoint(toDash) {
  const s = $("point-sec");
  if (!s) return;
  if (toDash) $("dash").insertBefore(s, $("review-sec"));
  else $("hero").insertBefore(s, $("way-sec"));
}

// ========================================================================================
// CONNECT — the standard chip + the load-with-grant probe (both funnel into onConnected)
// ========================================================================================
mountConnect($("chip-dock"), {
  scope: SCOPE,
  context: "none",
  installUrl: INSTALL_URL,
  onConnect: (r) => onConnected(r),
  onDisconnect: () => onDisconnected(),
});
function demoRelay() {
  const store = new Map();
  const t = new Date().getTime();
  // A fresh install has no history and nothing on the shelf. `?demo=empty` keeps both truly empty
  // so the setup flow is exercised from the same standing start a real new user has.
  if (!isDemoEmpty) store.set("recents", JSON.stringify([
    { app: "adforge", when: t - 3_600_000 },
    { app: "bank", when: t - 26_000_000 },
    { app: "redline", when: t - 90_000_000 },
    { app: "shelf", when: t - 120_000_000 },
  ]));
  const metas = isDemoEmpty ? [] : [
    { id: "aamras", name: "Aamras", kind: "brand", swatches: ["#C97A1E", "#8C1E1E"] },
    { id: "haazma", name: "Haazma", kind: "brand", swatches: ["#3A6EA5", "#1C3E63"] },
    { id: "piqual", name: "Piqual", kind: "brand", swatches: ["#5E8B23", "#385516"] },
    { id: "me", name: "Sameep", kind: "personal" },
    { id: "relay", name: "Relay", kind: "project", folder: "~/Projects/relay" },
    { id: "vendors", name: "Vendor book", kind: "gsheet", sourceKind: "gsheet", rowCount: 42 },
    { id: "n1", name: "Launch notes", kind: "note" },
    { id: "n2", name: "Pricing ideas", kind: "note" },
  ];
  // The setup flow is the front door, so it has to be walkable on the localhost ?demo path with no
  // daemon at all. The mock answers the REAL prompts with the REAL {facts,readings} shape and streams
  // them through the same code path — including the palette hexes, which appear verbatim in the
  // mocked page read so client-side hex verification passes honestly instead of being bypassed.
  const DEMO_SITE_READ =
    "Northbound Studio — small-batch outerwear made in Portland.\n" +
    "Shop: The Cascade Parka $389, The Foghorn Shell $265, The Basin Fleece $148.\n" +
    ':root{--color-primary:#1F3D2B;--color-accent:#D9743F;--color-ink:#141614}';
  const DEMO_REPO_READ =
    "# Switchboard — a BYO-Claude consent broker\n\nA local sidekick brokers your model and tools to any site.\n" +
    "Packages: sdk, sidekick, extension, protocol.\n" +
    '{"name":"switchboard","version":"1.0.0","license":"MIT","devDependencies":{"typescript":"^5.4.0","esbuild":"^0.21.0"}}';
  const demoSite = {
    facts: { name: "Northbound Studio", domain: "northbound.studio", category: "Outerwear",
      products: ["The Cascade Parka", "The Foghorn Shell", "The Basin Fleece"],
      priceBand: "$148–$389", paletteRaw: ["#1F3D2B", "#D9743F", "#141614"] },
    readings: [
      { lens: "How they describe themselves", oneLine: "Small-batch outerwear made in Portland.",
        positioning: "Technical shells and parkas built in small runs, sold direct, made to be repaired rather than replaced.",
        voice: "Plain, unhurried, quietly proud of the making.", audience: "People who walk to work in the rain and keep a coat for a decade.", recommended: true },
      { lens: "What the catalogue says", oneLine: "Three coats, built for wet cities.",
        positioning: "A tight range — one parka, one shell, one fleece — priced $148 to $389, layering into each other.",
        voice: "Spec-first: fabric, seams, weight.", audience: "Buyers comparing on construction, not on logo.", recommended: false },
      { lens: "How a buyer would describe it", oneLine: "The coat you buy once.",
        positioning: "The alternative to a $900 technical jacket and a $60 one that dies in a season.",
        voice: "Reassuring, a little anti-fashion.", audience: "Thirty-somethings replacing a coat that failed them.", recommended: false },
    ],
  };
  const demoProject = {
    facts: { name: "Switchboard", stack: ["TypeScript", "esbuild", "MCP"],
      packages: ["sdk", "sidekick", "extension", "protocol"],
      docs: ["Vision Spec — docs/VISION.md", "Context Kinds — docs/CONTEXT-KINDS.md"],
      links: [{ label: "repo", url: "https://github.com/sameeeeeeep/switchboard" }],
      notableFiles: ["packages/sdk/src/index.ts — the developer-facing SDK"], status: "v1.0.0 · MIT" },
    readings: [
      { lens: "What the README claims", summary: "A BYO-Claude consent broker — a local sidekick lends your model and tools to any site.",
        state: "v1.0.0, MIT, four packages published.", nextSteps: ["Ship the creator pipeline", "Meter real build-cost receipts"], recommended: true },
      { lens: "What the code actually is", summary: "A TypeScript monorepo: an MCP-speaking daemon, a browser extension, a protocol package and an SDK.",
        state: "esbuild bundles, no framework, no server.", nextSteps: ["Type the storage protocol end to end", "Cover the broker with tests"], recommended: false },
      { lens: "Where it is right now", summary: "Public, MIT, and shipping — the catalog is live and the broker is stable.",
        state: "Working end to end; the economics layer is still simulated.", nextSteps: ["Replace simulated wallet with real metering", "Open the wrapp submission path"], recommended: false },
    ],
  };
  async function* demoStream({ prompt }) {
    const p = String(prompt || "");
    const isRepo = /raw\.githubusercontent|github\.com/.test(p);
    const isFolder = /THE FOLDER:/.test(p);
    const isField = /Re-draft ONLY/.test(p);
    const body = isRepo || isFolder ? demoProject : demoSite;
    if (!/do NOT call/i.test(p) && !isFolder) {
      const url = isRepo ? "https://raw.githubusercontent.com/o/r/HEAD/README.md" : "https://northbound.studio/";
      yield { type: "tool_proposed", call: { name: "WebFetch", arguments: { url } } };
      await new Promise((res) => setTimeout(res, 420));
      yield { type: "tool_result", call: { name: "WebFetch" }, result: { ok: true, content: [{ text: isRepo ? DEMO_REPO_READ : DEMO_SITE_READ }] } };
    }
    if (isField) {
      const key = (p.match(/Re-draft ONLY "([a-zA-Z]+)"/) || [])[1] || "summary";
      yield { type: "text", text: JSON.stringify({ [key]: "A fresh take on the same fact, drafted from the read it already has." }) };
      yield { type: "done", result: {} };
      return;
    }
    const out = JSON.stringify(body);
    for (let i = 0; i < out.length; i += 220) {
      await new Promise((res) => setTimeout(res, 34));
      yield { type: "text", text: out.slice(i, i + 220) };
    }
    yield { type: "done", result: {} };
  }
  const files = new Map([
    ["README.md", DEMO_REPO_READ],
    ["package.json", '{"name":"switchboard","version":"1.0.0","license":"MIT"}'],
    ["docs/VISION.md", "# Vision Spec\nThe broker is the product."],
  ]);
  let bound = null;
  return {
    permissions: async () => ({ origin: location.origin, models: ["sonnet"], tools: [{ name: "WebFetch", access: "read" }], contextKinds: KINDS }),
    identity: async () => ({ name: "Sameep" }),
    connect: async () => ({ origin: location.origin, models: ["sonnet"], tools: [{ name: "WebFetch", access: "read" }] }),
    stream: (params) => demoStream(params),
    storage: {
      get: async (k) => (bound ? files.get(k) ?? null : store.get(k) ?? null),
      set: async (k, v) => { store.set(k, String(v)); },
      delete: async (k) => store.delete(k),
      list: async () => (bound ? [...files.keys()] : [...store.keys()]),
      info: async () => ({ folder: bound || "~/Library/Switchboard/sandbox/store", autoAssigned: !bound, count: 3 }),
      bind: async (path) => { bound = /sandbox/.test(path) ? null : path; return { folder: path, autoAssigned: !bound, count: 3 }; },
    },
    context: {
      list: async () => metas.slice(),
      publish: async (c) => {
        const id = c.id || String(metas.length + 1);
        const swatches = Array.isArray(c.data?.palette) ? c.data.palette : undefined;
        const i = metas.findIndex((m) => m.id === id);
        const meta = { id, name: c.name, kind: c.kind, ...(swatches ? { swatches } : {}), ...(c.data?.folder ? { folder: c.data.folder } : {}) };
        if (i >= 0) metas[i] = meta; else metas.push(meta);
        return id;
      },
    },
  };
}
if (isDemo) {
  $("chip-dock").hidden = true;
  onConnected(demoRelay());
} else {
  (async () => {
    const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
    if (r && "connect" in r) {
      way.installed = true;
      const grant = await r.permissions().catch(() => null);
      if (grant) { onConnected(r); return; }
    }
    renderWay();
  })();
}
renderWay();

function onConnected(r) {
  relay = r;
  way.installed = true;
  way.connected = true;
  renderWay();
  renderNav();
  movePoint(true);
  void point.onConnect(pointRelay(r));
  if (booted) return;
  booted = true;
  void initDash(r);
}
function onDisconnected() {
  relay = null;
  booted = false;
  way.connected = false;
  storageFrozen = false;
  renderWay();
  renderNav();
  $("brands-group").hidden = true;
  hideDash();
  movePoint(false);       // back to its disconnected home in the hero
  point.onDisconnect();   // aborts any in-flight read
}

function showDash() {
  $("hero").hidden = true;
  $("dash").hidden = false;
  $("wallet-chip").hidden = false;
  $("dock").hidden = false;
  document.body.classList.toggle("is-demo", isDemo);
  $("ws").hidden = !demoTasks;      // no workspace to switch to when the shelf is empty
  $("autorun").hidden = !demoTasks;
  $("stat-tiles").hidden = !demoTasks;
  $("demo-ribbon").hidden = !isDemo;
}
function hideDash() {
  $("dash").hidden = true;
  $("dash-body").classList.remove("on"); // next connect fades a true statement in, not a stale one
  promotedAction = null;
  $("hero").hidden = false;
  $("wallet-chip").hidden = true;
  $("dock").hidden = true;
  document.body.classList.remove("plan-pro", "is-demo");
}

async function initDash(r) {
  try {
    const [recRaw, planRaw, walRaw] = await Promise.all([
      r.storage.get("recents"), r.storage.get("plan"), r.storage.get("wallet"),
    ]);
    const rec = safeParse(recRaw, []);
    recents = Array.isArray(rec) ? rec.filter((x) => x && typeof x.app === "string" && typeof x.when === "number") : [];
    plan = planRaw === "pro" ? "pro" : "free";
    const w = safeParse(walRaw, null);
    wallet = w && typeof w.balance === "number"
      ? { balance: w.balance, ledger: Array.isArray(w.ledger) ? w.ledger : [] }
      : { balance: 0, ledger: [] };
  } catch { /* storage unavailable — defaults stand */ }
  if (!relay) return;
  document.body.classList.toggle("plan-pro", plan === "pro");
  const d = new Date();
  $("dash-date").textContent = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  showDash();
  if (demoTasks) applyDemoChrome();
  renderPlan();
  renderWallet();
  renderTaskOS();
  renderDock();

  const user = await r.identity().catch(() => null);
  if (!relay) return;
  userName = user?.name?.trim() || "";
  await refreshLibrary();
}

// One repaint of everything the library feeds. Called on first load AND the moment the setup flow
// banks a context — the first project has to visibly land in the hero, Projects, the sidebar and the
// shelf all at once, or it doesn't feel like it landed anywhere.
async function refreshLibrary() {
  if (!relay) return;
  const metas = await ctx.list().catch(() => []);
  if (!relay) return;
  metasCache = metas;
  way.brands = metas.filter((m) => (m.kind || "").toLowerCase() === "brand").length;
  renderWay();
  // the hero waits for identity + library so its statement is true on first paint, not corrected
  renderHero();
  renderProjects(metas);
  renderBrands(metas);
  renderActions();
  renderRecs();
  point.setLibrary(metas);
  if (metas.length) renderLibrary(metas);
  else renderLibraryEmpty("No contexts yet — point this page at a site, a repo, or a folder above and your Claude will read it.");
}

function applyDemoChrome() {
  $("search").placeholder = "Tell Switchboard what to do, or search…";
  const ws = $("ws");
  ws.textContent = "";
  const m = mk("span", "m", "N"); m.style.background = "linear-gradient(135deg,#3E7D6A,#1C4A3C)";
  ws.append(m, document.createTextNode("Northbound Studio "));
  ws.insertAdjacentHTML("beforeend", `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>`);
}

// ========================================================================================
// THE EDITORIAL HERO — one true statement about today, composed from real state
// ========================================================================================
// The connected view earns the same instrument the disconnected view uses: kicker → display
// statement → sub-paragraph → ONE primary pill. The statement is never a greeting; it is the day's
// truth, generated from what actually exists. On the REAL path the only truth available is the
// library (there is no task layer yet), so the line says exactly that and never invents a count.
// The demo path — and only the demo path, behind its ribbon — may speak in task numbers, and it
// takes them from DEMO_REVIEW/DEMO_TASKS so the hero and the review cards can never disagree.
const DEMO_REVIEW = [
  { brand: "Aamras", base: "#C97A1E", title: "Diwali gift-box ad set", app: "adforge", name: "AdForge", btn: "Review",
    pv: `<rect width="300" height="74" fill="#2A2410"/><circle cx="250" cy="37" r="26" fill="#B4802A"/><rect x="22" y="22" width="120" height="11" rx="4" fill="#B4802A"/><rect x="22" y="42" width="70" height="14" rx="7" fill="#E9C56B"/>` },
  { brand: "Haazma", base: "#3A6EA5", title: "Yesterday's spend — digest", app: "adpulse", name: "AdPulse", btn: "Open",
    pv: `<rect width="300" height="74" fill="#101B2A"/><polyline points="14,56 60,48 106,52 152,34 198,38 288,16" fill="none" stroke="#7FB0E0" stroke-width="3"/><circle cx="288" cy="16" r="4" fill="#7FB0E0"/>` },
  { brand: "Piqual", base: "#5E8B23", title: "Low-stock — reorder 4 SKUs", app: "shelf", name: "Shelf", btn: "Review",
    pv: `<rect width="300" height="74" fill="#16220E"/><rect x="18" y="14" width="130" height="9" rx="4" fill="#9FCB6E"/><rect x="18" y="32" width="90" height="9" rx="4" fill="#9FCB6E" opacity=".8"/><rect x="18" y="50" width="160" height="9" rx="4" fill="#9FCB6E" opacity=".6"/>` },
];
const DEMO_TASKS = { inflight: 5, automations: 3, done: 12, routine: 4 };

function brandNames() {
  return metasCache.filter((m) => (m.kind || "").toLowerCase() === "brand").map((m) => m.name).filter(Boolean);
}
// the non-brand things worth naming in the sub-paragraph, in reading order
function shelfExtras(c) {
  const bits = [];
  if (c.project) bits.push(`${c.project} project${s(c.project)}`);
  if (c.note) bits.push(`${c.note} note${s(c.note)}`);
  const live = (c.csv || 0) + (c.gsheet || 0);
  if (live) bits.push(`${live} live source${s(live)}`);
  return bits;
}

function renderHero() {
  const c = kindCounts();
  const who = userName ? `, ${userName}` : "";
  const brands = brandNames();
  const head = $("dash-greeting");
  const sub = $("dash-line");
  const link = $("dash-cta");
  const run = $("autorun");
  const facts = $("stat-tiles");
  const inNote = $("dash-in");
  inNote.textContent = "";

  if (demoTasks) {
    const ready = DEMO_REVIEW.length;
    const readyBrands = [...new Set(DEMO_REVIEW.map((x) => x.brand))];
    const across = listNames(brands.length ? brands : readyBrands);
    if (ready === 0) {
      head.textContent = `Nothing needs you${who}. Everything's running.`;
      sub.textContent = `${word(DEMO_TASKS.inflight)} in flight across ${across} — Switchboard is carrying them; nothing is waiting on a decision.`;
    } else if (readyBrands.length === 1) {
      head.textContent = `${word(ready)} draft${s(ready)} ${ready === 1 ? "is" : "are"} waiting on ${readyBrands[0]}.`;
      sub.textContent = `${word(DEMO_TASKS.inflight)} in flight across ${across} — Switchboard ran ${low(word(ready))} already; ${ready === 1 ? "it just needs" : "they just need"} a look.`;
    } else {
      head.textContent = `${word(ready)} thing${s(ready)} need${ready === 1 ? "s" : ""} you${who}.`;
      sub.textContent = `${word(DEMO_TASKS.inflight)} in flight across ${across} — Switchboard ran ${low(word(ready))} already; ${ready === 1 ? "it just needs" : "they just need"} a look.`;
    }
    link.hidden = true;
    run.hidden = false;
    run.lastChild.textContent = ready > 0
      ? `Review the ${low(word(ready))} waiting`
      : `Auto-run ${DEMO_TASKS.routine} routine tasks`;
    run.onclick = () => (ready > 0 ? $("review-sec") : $("actions")).scrollIntoView({ behavior: "smooth", block: "start" });
    // the two facts left over after the statement — a line of type, not a row of boxes
    facts.hidden = false;
    facts.innerHTML =
      `<span><b>${DEMO_TASKS.automations}</b> automations live</span><span class="sep"></span>` +
      `<span><b>${DEMO_TASKS.done}</b> done this week</span>`;
    $("dash-body").classList.add("on");
    return;
  }

  // ---- the real path: the library IS the truth; no task count is ever invented ----
  const extras = shelfExtras(c);
  const tail = extras.length ? `, alongside ${listNames(extras)}` : "";
  if (brands.length) {
    const n = brands.length;
    head.textContent = n === 1
      ? `${brands[0]} is banked${who}. Nothing's waiting on you.`
      : `${word(n)} brand${s(n)} banked${who}. Nothing's waiting on you.`;
    sub.textContent = `${listNames(brands)} ${n === 1 ? "sits" : "sit"} on your shelf${tail}. ` +
      `Every app below can borrow ${n === 1 ? "it" : "them"} — you approve each lend once, and nothing else ever sees it.`;
  } else if (c.project || c.note) {
    const k = (c.project || 0) + (c.note || 0);
    head.textContent = `Nothing's waiting on you${who}. Your shelf is still thin.`;
    sub.textContent = `${k} item${s(k)} in the bank and no brand yet — bank one and the founder stack below starts working on real ground instead of guesses.`;
  } else if (metasCache.length) {
    head.textContent = `Nothing's waiting on you${who}.`;
    sub.textContent = `${listNames(metasCache.map((m) => m.name))} ${metasCache.length === 1 ? "is" : "are"} all that's on the shelf so far. ` +
      "Bank a brand and every app below can borrow it — you approve each lend once.";
  } else {
    head.textContent = `Nothing's on your shelf yet${who}.`;
    sub.textContent = "Bank one brand and every app below stops asking you questions — it just knows who you are and what you sell. You approve each lend, once.";
  }

  // ONE primary CTA, inline in the hero: the top derived action, straight into the wrapp that does it
  const top = buildActions()[0];
  promotedAction = top || null;
  facts.hidden = true;
  run.hidden = true;
  if (top && top.point) {
    // in-page action: the setup flow is already on this screen, so open it rather than navigate away
    link.hidden = false;
    link.textContent = top.label;
    link.href = "#point-sec";
    link.removeAttribute("target");
    delete link.dataset.app;
    link.onclick = (e) => { e.preventDefault(); point.open(top.point); };
    inNote.textContent = "right here — nothing leaves this page";
  } else if (top && APP_BY_ID[top.app]) {
    link.onclick = null;
    const app = APP_BY_ID[top.app];
    link.hidden = false;
    link.textContent = top.label;
    link.href = app.href;
    link.dataset.app = app.id;
    if (/^https:/.test(app.href)) { link.target = "_blank"; link.rel = "noreferrer"; }
    inNote.textContent = `in ${app.name}`;
  } else {
    link.hidden = true;
  }
  $("dash-body").classList.add("on");
}

// ---------- PROJECTS — the personalization centerpiece ----------
const PROJ_KINDS = new Set(["brand", "project"]);
function kindLabel(kind) {
  if (kind === "brand") return "Brand";
  if (kind === "project") return "Project";
  return kind ? kind[0].toUpperCase() + kind.slice(1) : "Context";
}
function renderProjects(metas) {
  const box = $("projects");
  box.textContent = "";
  const projs = metas.filter((m) => PROJ_KINDS.has((m.kind || "").toLowerCase()));
  $("projects-sub").textContent = projs.length ? `${projs.length} in your workspace` : "";
  if (!projs.length) {
    const a = mk("div", "proj new");
    a.style.cursor = "pointer";
    a.onclick = () => point.open();
    const npb = mk("div", "npb");
    npb.append(mk("div", "plus", "+"), mk("div", "nt", "No projects yet"),
      mk("div", "ns", "Point at a site, a repo, or a folder — every app below can borrow what it finds."));
    a.append(npb);
    box.append(a);
    return;
  }
  for (const m of projs) {
    const c = colorFor(m);
    const kind = (m.kind || "").toLowerCase();
    const card = mk("div", "proj");
    const ph = mk("div", "ph");
    ph.style.background = `linear-gradient(120deg, ${c.light}, ${c.base})`;
    const pav = mk("span", "pav", (m.name || "•")[0].toUpperCase());
    pav.style.background = c.pav; pav.style.color = c.mono;
    ph.append(pav);
    const pb = mk("div", "pb");
    pb.append(mk("div", "nm", m.name || "Untitled"), mk("div", "ty", kindLabel(kind)));
    if (demoTasks) {
      const h = hashInt(m.name || "");
      const tasks = 3 + (h % 4), rev = 1 + (h % 2), pct = 30 + (h % 45);
      const stats = mk("div", "stats");
      const st1 = mk("span", "st"); const d1 = mk("span", "d"); d1.style.background = c.base;
      st1.append(d1, document.createTextNode(`${tasks} tasks`));
      const st2 = mk("span", "st"); const d2 = mk("span", "d"); d2.style.background = "var(--ok)";
      st2.append(d2, document.createTextNode(`${rev} to review`));
      stats.append(st1, st2);
      const bar = mk("div", "bar"); const fill = mk("i"); fill.style.width = pct + "%"; fill.style.background = c.base;
      bar.append(fill);
      pb.append(stats, bar, mk("div", "barl", `${pct}% of this sprint`));
    } else {
      if (m.sourceKind) {
        const det = mk("div", "det"); const live = mk("span", "live");
        live.append(mk("span", "d"), document.createTextNode(`live · ${m.rowCount ?? 0} rows`));
        det.append(live); pb.append(det);
      } else if (Array.isArray(m.swatches) && m.swatches.some(isHex)) {
        const dots = mk("div", "dots");
        for (const sw of m.swatches.filter(isHex).slice(0, 4)) { const i = mk("i"); i.style.background = normHex(sw); dots.append(i); }
        pb.append(dots);
      } else if (m.folder) {
        pb.append(mk("div", "det", `folder · ${m.folder.split("/").filter(Boolean).pop() || "bound"}`));
      } else {
        pb.append(mk("div", "det", "in your library"));
      }
    }
    card.append(ph, pb);
    box.append(card);
  }
}

// ---------- taskOS band — DEMO shows the full view; REAL shows a "coming" preview ----------
function renderTaskOS() {
  const review = $("review");
  if (demoTasks) {
    $("review-sub").textContent = "Switchboard ran these — just approve or tweak";
    review.innerHTML = DEMO_REVIEW.map(reviewCard).join("");
  } else {
    $("review-sub").textContent = "your tasks, auto-extracted, will land here";
    review.innerHTML =
      `<div class="coming"><span class="ci"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/></svg></span><div>` +
      `<h4>taskOS is coming</h4>` +
      `<p>Your tasks — auto-extracted from what you tell Switchboard and the connectors you allow — will surface here for one-tap review. Nothing is invented.</p>` +
      `<span class="tag">Your real projects are below · nothing fabricated</span></div></div>`;
  }
}
function reviewCard(it) {
  const f = famOf(it.app);
  return `<div class="rv"><div class="pv"><svg viewBox="0 0 300 74" preserveAspectRatio="none">${it.pv}</svg></div><div class="b">` +
    `<div class="top"><span class="bav" style="background:${it.base}">${it.brand[0]}</span><span class="bname">${it.brand}</span>` +
    `<span class="sic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg></span></div>` +
    `<div class="nm">${it.title}</div>` +
    `<div class="foot"><span class="wtag"><span class="wi" style="background:${f.soft};color:${f.ink}">${glyphSvg(it.app)}</span>${it.name}</span>` +
    `<button class="rvbtn" type="button">${it.btn}</button></div></div></div>`;
}

// ---------- the dock ----------
const DOCK_FALLBACK = ["adforge", "redline", "bank", "cast", "cartridge"];
function renderDock() {
  const box = $("dock");
  box.textContent = "";
  let ids = [...new Set(recents.map((r) => r.app).filter((id) => APP_BY_ID[id]))].slice(0, 6);
  if (!ids.length) ids = DOCK_FALLBACK.filter((id) => APP_BY_ID[id]);
  for (const id of ids) {
    const app = APP_BY_ID[id];
    const f = famOf(id);
    const a = mk("a", "di");
    a.href = app.href; a.dataset.app = id; a.title = app.name;
    a.style.background = f.soft; a.style.color = f.ink;
    a.innerHTML = glyphSvg(id);
    box.append(a);
  }
  box.append(mk("div", "sep"));
  const add = mk("button", "add"); add.type = "button"; add.title = "Explore the store";
  add.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>`;
  add.onclick = () => $("store").scrollIntoView({ behavior: "smooth", block: "start" });
  box.append(add);
}

async function recordRecent(id) {
  if (!relay || !APP_BY_ID[id]) return;
  if (storageFrozen) return; // the folder pointer has our store pointed at the user's own directory
  try {
    const raw = await relay.storage.get("recents");
    let list = safeParse(raw, []);
    if (!Array.isArray(list)) list = [];
    list = list.filter((r) => r && r.app !== id);
    list.unshift({ app: id, when: now() });
    list = list.slice(0, 12);
    recents = list;
    await relay.storage.set("recents", JSON.stringify(list));
    renderDock();
  } catch { /* recents are a convenience — never block navigation on them */ }
}
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-app]");
  if (!a || !relay) return;
  // detail links are same-origin browsing — let the browser navigate natively and don't log a "recent"
  if (a.dataset.detail) return;
  const id = a.dataset.app;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
    void recordRecent(id);
    return;
  }
  e.preventDefault();
  const href = a.href;
  const go = () => { window.location.href = href; };
  Promise.race([recordRecent(id), new Promise((res) => setTimeout(res, 450))]).then(go, go);
});

// ---------- recommendations ----------
function buildRecs() {
  const c = kindCounts();
  const tried = new Set(recents.map((r) => r.app));
  const out = [];
  const push = (id, why) => {
    if (!APP_BY_ID[id] || out.some((o) => o.app === id)) return;
    out.push({ app: id, why, tried: tried.has(id) });
  };
  if (c.brand) {
    const why = c.brand === 1 ? `you banked “${firstOf("brand")}”` : `you banked ${c.brand} brands`;
    for (const id of ["adforge", "adpulse", "redline"]) push(id, why);
  }
  const knowledge = (c.note || 0) + (c.project || 0);
  if (knowledge) {
    const bits = [];
    if (c.note) bits.push(`${c.note} note${s(c.note)}`);
    if (c.project) bits.push(`${c.project} project${s(c.project)}`);
    push("bank", `you keep ${bits.join(" and ")}`);
  }
  if (c.personal) {
    const why = `your personal card (“${firstOf("personal")}”) is on the shelf`;
    for (const id of ["cast", "natal", "arcana"]) push(id, why);
  }
  const live = (c.csv || 0) + (c.gsheet || 0);
  if (live) {
    push("adpulse", `you connected ${live} live data source${s(live)}`);
    push("shelf", `you connected ${live} live data source${s(live)}`);
  }
  if (!out.length) {
    push("brandbrain", "your library is empty — this is the app that fills it");
    push("ideabrain", "not a company yet? validate the idea first");
  }
  out.sort((a, b) => (a.tried ? 1 : 0) - (b.tried ? 1 : 0));
  return out.slice(0, 4);
}
function renderRecs() {
  const box = $("recs");
  box.textContent = "";
  for (const r of buildRecs()) {
    const app = APP_BY_ID[r.app];
    const a = mk("a", "rec");
    a.href = app.href;
    a.dataset.app = app.id;
    const h = mk("h5", null, app.name);
    if (!r.tried) h.append(mk("span", "new", "not tried yet"));
    a.append(h, mk("span", "why", `because ${r.why}`));
    box.append(a);
  }
}

// ---------- quick actions ----------
// `focus` names the context the caller is talking about right now — the setup flow passes the thing
// it just banked, so the ready screen's pill says "…for Northbound Studio" instead of naming
// whichever brand happens to sort first. The hero calls this with no focus, so its behaviour is
// unchanged; both surfaces still come out of ONE builder and so can never disagree.
function buildActions(focus) {
  const c = kindCounts();
  const brand = (focus?.kind === "brand" && focus.name) || firstOf("brand");
  const project = (focus?.kind === "project" && focus.name) || firstOf("project");
  const personal = firstOf("personal");
  const knowledge = (c.note || 0) + (c.project || 0);
  const acts = [];
  if (focus?.kind === "project" && project) {
    acts.push({ app: "redline", label: `Review ${project}'s landing page against what it actually is` });
    acts.push({ app: "bank", label: `Open ${project} as a vault — notes and tasks beside the work` });
  }
  if (brand) acts.push({ app: "adforge", label: `Generate this week's ads for ${brand}` });
  if (knowledge) acts.push({ app: "bank", label: `Ask your second brain — ${knowledge} item${s(knowledge)} in the vault` });
  if (brand) acts.push({ app: "adpulse", label: `Find the wasted Meta spend behind ${brand}` });
  if (personal) acts.push({ app: "arcana", label: `Pull three cards on today for ${personal}` });
  if (brand) acts.push({ app: "redline", label: `Redline ${brand}'s landing page before the next push` });
  if (!acts.length) {
    // An empty shelf used to lead with a twenty-minute build in another app. The pointer flow is
    // right here and takes one paste, so it goes first; brandbrain stays as the deeper option for
    // someone who wants the full build rather than a reading of what already exists.
    acts.push({ point: "site", label: "Point at your site — about a minute" });
    // the label carries no app name — the hero CTA and the Quick-actions row both name the wrapp beside it
    acts.push({ app: "brandbrain", label: "Bank your first brand — about twenty minutes" });
    acts.push({ app: "cartridge", label: "Make a game instead — describe it, keep the cartridge" });
  }
  return acts.slice(0, 5);
}
function renderActions() {
  const box = $("actions");
  box.textContent = "";
  // the hero already promoted one of these to its primary pill — don't say it twice
  const acts = buildActions()
    // in-page actions (the pointer flow) live in their own section on this screen — the row would
    // only be repeating a control the user can already see
    .filter((a) => !a.point)
    .filter((a) => !(promotedAction && a.app === promotedAction.app && a.label === promotedAction.label))
    .filter((a) => APP_BY_ID[a.app])
    .slice(0, 4);
  for (const act of acts) {
    const app = APP_BY_ID[act.app];
    const a = mk("a", "act");
    a.href = app.href;
    a.dataset.app = app.id;
    a.append(mk("span", "o", act.label), mk("span", "in", app.name), mk("span", "go", "open ▸"));
    box.append(a);
  }
}

// ---------- plan card (SIMULATED) ----------
function renderPlan() {
  const el = $("plan-card");
  el.textContent = "";
  const k = mk("div", "sc-k");
  k.append(mk("span", null, "your plan"));
  if (plan === "pro") k.append(mk("span", "sim", "simulated"));
  el.append(k);
  el.append(mk("div", "sc-big", plan === "pro" ? "Pro" : "Free"));
  if (plan === "pro") {
    el.append(mk("p", "sc-copy", "Pro tier unlocked in every wrapp — one sub for the whole catalog. 75% of it is paid to the developers of what you actually run, metered by the broker."));
  } else {
    el.append(mk("p", "sc-copy", "The complete core of every wrapp, forever. Your data and your exports are never gated."));
    el.append(mk("p", "sc-copy dim", "Pro — one $20/mo sub — unlocks the pro tier of EVERY wrapp at once. 75% of it goes to the developers you actually use."));
  }
  const btn = mk("button", "sc-btn", plan === "pro" ? "Back to Free · simulated" : "Upgrade to Pro · simulated");
  btn.type = "button";
  btn.onclick = () => void togglePlan();
  el.append(btn);
  el.append(mk("p", "sc-foot", "No payment rails yet — this toggle is a labeled simulation of the entitlement flag."));
}
async function togglePlan() {
  plan = plan === "pro" ? "free" : "pro";
  document.body.classList.toggle("plan-pro", plan === "pro");
  renderPlan();
  if (storageFrozen) return; // simulated state — dropping one write costs nothing, a stray file in someone's repo does not
  try { await relay?.storage.set("plan", plan); } catch { /* re-toggle next visit at worst */ }
}

// ---------- wallet (SIMULATED) + token pack sheet ----------
function renderWallet() {
  $("wallet-bal").textContent = wallet.balance.toLocaleString("en-US");
  const el = $("wallet-card");
  el.textContent = "";
  const k = mk("div", "sc-k");
  k.append(mk("span", null, "wallet"), mk("span", "sim", "simulated"));
  el.append(k);
  el.append(mk("div", "sc-big num", `${wallet.balance.toLocaleString("en-US")} SB`));
  el.append(mk("p", "sc-copy", "You run on your own Claude — nothing burns, this stays at zero and everything still works. Packs are the on-ramp for people with no AI set up."));
  const btn = mk("button", "sc-btn", "Get tokens ▸");
  btn.type = "button";
  btn.onclick = openPacks;
  el.append(btn);
  const led = mk("div", "ledger");
  led.append(mk("div", "led-k", "ledger"));
  if (!wallet.ledger.length) {
    led.append(mk("div", "led-empty", "no entries — you're BYO; nothing mints, nothing burns"));
  } else {
    for (const e of wallet.ledger.slice(0, 4)) {
      const row = mk("div", "led-row");
      row.append(mk("span", null, `${e.t} · ${e.ref} · ${ago(e.when)}`), mk("span", "amt", `+${fmtTok(e.amount)}`));
      led.append(row);
    }
  }
  el.append(led);
}
function openPacks() {
  $("pack-note").textContent = "Checkout here is a labeled simulation — no card, no charge; it credits a preview balance in your local wallet stub.";
  $("pack-overlay").hidden = false;
}
function closePacks() { $("pack-overlay").hidden = true; }
async function buyPack(amt, price) {
  wallet.balance += amt;
  wallet.ledger.unshift({ t: "mint:pack", amount: amt, when: now(), ref: `audit:sim-${wallet.ledger.length + 1}` });
  wallet.ledger = wallet.ledger.slice(0, 20);
  renderWallet();
  $("pack-note").textContent = `SIMULATED checkout complete — ${amt.toLocaleString("en-US")} SB credited to the preview stub. ${price} was NOT charged; no card exists here. Packs never expire.`;
  if (storageFrozen) return;
  try { await relay?.storage.set("wallet", JSON.stringify(wallet)); } catch { /* stub only */ }
}
$("pack-close").onclick = closePacks;
$("pack-overlay").addEventListener("click", (e) => { if (e.target === $("pack-overlay")) closePacks(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("pack-overlay").hidden) closePacks(); });
document.querySelectorAll(".pack").forEach((b) => {
  b.addEventListener("click", () => void buyPack(Number(b.dataset.amt), b.dataset.price));
});
$("wallet-chip").onclick = () => { $("wallet-card").scrollIntoView({ behavior: "smooth", block: "center" }); };

// ---------- your library ----------
const KIND_LABEL = { brand: "Brands", personal: "You", project: "Projects", csv: "Data sources", gsheet: "Data sources", note: "Notes" };
const KIND_ORDER = ["Brands", "You", "Projects", "Data sources", "Notes"];
function renderLibrary(metas) {
  const box = $("library");
  box.textContent = "";
  const groups = new Map();
  for (const m of metas) {
    const label = KIND_LABEL[(m.kind || "").toLowerCase()] || "Other";
    (groups.get(label) ?? groups.set(label, []).get(label)).push(m);
  }
  const names = [...groups.keys()].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a), ib = KIND_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  for (const g of names) {
    box.append(mk("div", "lib-kicker", g));
    const row = mk("div", "lib-row");
    for (const m of groups.get(g)) {
      const card = mk("div", "lib-card");
      card.append(mk("span", "lib-mk", (m.name || "•")[0].toUpperCase()), mk("span", "lib-nm", m.name));
      if (m.sourceKind) card.append(mk("span", "lib-badge", `live · ${m.rowCount ?? 0} rows`));
      row.append(card);
    }
    box.append(row);
  }
  box.append(mk("div", "lib-foot", "Lending happens per app — each app you connect asks for what it needs, and remembers its own pick."));
  $("library-sec").hidden = false;
}
function renderLibraryEmpty(text) {
  const box = $("library");
  box.textContent = "";
  box.append(mk("div", "lib-empty", text));
  $("library-sec").hidden = false;
}

// ========================================================================================
// SEARCH + TIER FILTER + VIEW TABS + SORT (client-side, instant)
// ========================================================================================
const search = $("search");
let tierFilter = "all";
let sortKey = "trending";

// capture the authored (curated) order per grid so 'Explore' can restore it
const gridOrder = new Map();
document.querySelectorAll("#store .grid").forEach((g) => gridOrder.set(g, [...g.querySelectorAll("a.card")]));
const catIndex = Object.fromEntries(APPS.map((a, i) => [a.id, i])); // higher index = newer arrival

function sortCards(key) {
  sortKey = key;
  for (const [grid, original] of gridOrder) {
    let cards = [...original];
    if (key === "trending") cards.sort((a, b) => (APP_BY_ID[b.dataset.app]?.updates || 0) - (APP_BY_ID[a.dataset.app]?.updates || 0));
    else if (key === "newest") cards.sort((a, b) => (catIndex[b.dataset.app] ?? 0) - (catIndex[a.dataset.app] ?? 0));
    else if (key === "cost") cards.sort((a, b) => (APP_BY_ID[b.dataset.app]?.tokens || 0) - (APP_BY_ID[a.dataset.app]?.tokens || 0));
    // 'curated' → keep original order
    for (const c of cards) grid.append(c);
  }
}

function applyFilters() {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#store a.card").forEach((card) => {
    const app = APP_BY_ID[card.dataset.app];
    const hasPro = !!(app && app.pro);
    const tierOk = tierFilter === "all" || (tierFilter === "pro" ? hasPro : !hasPro);
    const hit = tierOk && (!q || (card.textContent + " " + (card.dataset.tags || "")).toLowerCase().includes(q));
    card.style.display = hit ? "" : "none";
    if (hit) shown++;
  });
  document.querySelectorAll("#store .sec-h").forEach((h) => {
    let el = h.nextElementSibling;
    let hasCards = false, visible = false;
    while (el && !el.classList.contains("sec-h")) {
      if (el.classList?.contains("grid")) {
        el.querySelectorAll("a.card").forEach((c) => { hasCards = true; if (c.style.display !== "none") visible = true; });
      }
      el = el.nextElementSibling;
    }
    h.style.display = hasCards && !visible ? "none" : "";
  });
  $("no-hits").hidden = shown > 0;
  $("showing-count").textContent = `Showing ${shown} wrapp${s(shown)}`;
}

search.addEventListener("input", applyFilters);
document.querySelectorAll("#tier-bar .tf").forEach((b) => {
  b.addEventListener("click", () => {
    tierFilter = b.dataset.tier;
    document.querySelectorAll("#tier-bar .tf").forEach((x) => x.classList.toggle("on", x === b));
    applyFilters();
  });
});
document.querySelectorAll("#view-tabs .vt").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#view-tabs .vt").forEach((x) => x.classList.toggle("on", x === b));
    const view = b.dataset.view;
    if (view === "latest") { sortCards("newest"); $("sort").value = "newest"; }
    else { sortCards("curated"); }
    $("store").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
$("sort").addEventListener("change", (e) => {
  document.querySelectorAll("#view-tabs .vt").forEach((x) => x.classList.remove("on"));
  sortCards(e.target.value);
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); search.focus(); }
});

$("hero-connect").onclick = () => clickConnect();
$("projects-new").onclick = () => point.open();

// ========================================================================================
// FIRST PAINT
// ========================================================================================
point.mount();
renderNav();
renderCats();
decorateCards();
initFeatured();
renderRecent();
sortCards("trending");
applyFilters();
