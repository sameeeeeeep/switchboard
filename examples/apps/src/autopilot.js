// Autopilot — the operating cockpit for the company you already have, on the visitor's OWN Claude.
// The operator holds no key, pays for no inference, and never sees the user's data — Switchboard
// brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line
// is proven idiom (distilled from redline.js) — keep it byte-identical unless the app truly needs
// otherwise. Edit the CONFIG block and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { collection, mountLive } from "./kit/livestore.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const APP = {
  id: "autopilot",
  name: "Autopilot",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Autopilot — drafts and re-drafts the operating slate for the companies you lend it",
    models: ["sonnet"],
    tools: [],
    // Autopilot RUNS whatever you already have. brandbrain publishes `brand`, ideabrain publishes
    // `idea`, Bank + the store's pointer publish `brand`/`project` — all four are companies to
    // operate. Narrowing this to ["brand"] would re-narrow the app to D2C and break the
    // ideabrain → run graduation, which is the whole point of the verb.
    contextKinds: ["brand", "project", "idea"],
  },
  usesContext: "single",
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 160);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3200);
}

// ==== connect (standard chip + returning-user probe) ========================================
let relay = null;
let notInstalled = false;
let brand = null;         // the ONE lent context, when APP.usesContext === "single"
let wired = false;
let live = null;          // kit/mountLive handle — re-reads on teammate/Obsidian/git changes

mountConnect($("chip-dock"), {
  scope: APP.scope,
  context: APP.usesContext,
  installUrl: APP.installUrl,
  onConnect: (r) => { relay = r; wire(r); void onReady(); },
  onDisconnect: () => { relay = null; render(); },
  onProjectChange: () => { void syncContext(); },
});
(async () => {
  const r = await whenRelayReady(2000, { installUrl: APP.installUrl });
  if (r && "connect" in r) { const grant = await r.permissions().catch(() => null); if (grant) { relay = r; wire(r); void onReady(); return; } }
  else if (r && r.installed === false) notInstalled = true;
  render();
})();
function wire(r) {
  if (wired) return; wired = true;
  r.on("permissionsChanged", () => void syncContext());
  // TEAM-READY (doctrine gate 7): re-read persisted state whenever reality moves — a teammate's
  // Team Mode sync, your own edit in another window, an Obsidian save, a git pull. Throttled +
  // guarded by the kit; solo users never notice (no teammates ⇒ no nudges). `reloadState` re-reads
  // storage and re-renders; keep it idempotent.
  live = mountLive(r, reloadState);
}
// onReady fires TWICE by design — mountConnect's onConnect AND the returning-user probe above,
// whichever wins the race. Hydrating from storage on BOTH passes is a real (timing-dependent) bug:
// the second pass re-reads the run the first pass just saved, REPLACING the in-memory object the
// running pipeline still holds a reference to. The pipeline then finishes into a detached orphan
// and the UI sits forever on a run that never completes. Hydrate once. (cartridge.js already
// carried this fix as `hydrated`; it was never propagated to the other wrapps.)
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render();
  autostart();
  void discoverTools().then(() => render()).catch(() => {});   // learn which lanes have a connector
}
/** Re-read everything this wrapp persists, then render. Called on every live nudge. */
async function reloadState() { if (!relay) return; await loadState(); render(); }

// CONTEXT-FIRST: the moment a context is lent, everything derives from it.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state ======================================================================
// ACCUMULATED ITEMS, not a run: a portfolio grows over time, so companies are a `collection`
// (one company = one file) and NEVER an array in one blob. Under Team Mode, per-file LWW then
// merges two people operating DIFFERENT companies instead of clobbering each other. This is
// doctrine gate 7, and for a portfolio app it is the difference between multiplayer and data loss.
let companies = null;     // collection handle (created on first connect)
let cos = [];             // loaded records: [{ id, ...company }]
let activeId = null;
async function loadState() {
  if (!companies) companies = collection(relay, "autopilot-co");
  const stored = await companies.all();
  const byId = new Map(stored.map((c) => [c.id, c]));
  // MERGE, never blind-replace. `mountLive` re-reads on every nudge (a teammate's sync, an
  // Obsidian save, a git pull), and a blind `cos = await all()` has two failure modes that both
  // bit here: (a) a company created this tick but not yet round-tripped through storage vanishes
  // from the array, and (b) the object a draft is CURRENTLY writing into gets swapped for its
  // stored — optionless — snapshot, so generation lands in a detached orphan and the UI renders
  // an empty slate forever. In-memory wins while a draft is in flight; storage wins otherwise.
  for (const c of cos) if (!byId.has(c.id) || drafting.has(c.id)) byId.set(c.id, c);
  cos = [...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!cos.some((c) => c.id === activeId)) activeId = cos[0]?.id || null;
}
let saveFails = 0;
async function saveCo(co) {
  if (!companies || !co) return;
  co.at = co.at || Date.now();
  try { await companies.put(co.id, co); saveFails = 0; }
  catch (e) {
    // Swallowing this outright is how someone loses an afternoon: the board keeps working from
    // memory while nothing reaches disk, and everything looks fine until the tab closes. One
    // quiet retry's worth of tolerance, then say so plainly.
    if (++saveFails >= 2) { saveFails = 0; toast("Couldn't save to disk — your work is on screen but not written. " + msg(e), true); }
  }
}

// ==== llm helpers — the EXACT stream contract; never guess these shapes =====================
// relay.stream(params) is an async iterator of deltas:
//   { type:"text", text }  { type:"tool_proposed", call }  { type:"tool_result", result }
//   { type:"error", error:{ message } }  { type:"done", result }
// relay.complete(params) resolves { text, usage, stopReason }.
// Autopilot deliberately uses relay.complete(), NOT relay.stream(): option generation returns
// JSON (nothing renderable arrives mid-stream) and complete() is the only call that hands back
// real `usage`, which is what makes the token surface honest rather than an estimate. If a
// streaming stage is ever added, copy `streamText` back verbatim from
// .claude/skills/wrapp/template.js — it is the sanctioned wrapper (180s timeout + it.return()).
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}

// ==== house UI atoms ========================================================================
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Lend it a brand, project or idea — the slate drafts itself";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Choose an option; everything downstream rewrites";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
/* AUTOPILOT — the decision engine.
   (Ported from examples/autopilot/src/engine.js. The chassis — localStorage, the two seeded
   companies, the hand-written option copy — was left behind; THIS is the essence.)

   Every visible thing on the cockpit is derived from DECISIONS. A decision holds its options,
   which one the machine drafted, and which one a HUMAN chose. Nothing else may write the chosen id.

   Doctrine, enforced structurally:
     - draft(d)   sets draftedId. It can never set chosenId.
     - choose(d)  is the ONLY path to chosenId, and only a click calls it.
     - changing an upstream decision marks dependents STALE and re-drafts them,
       so a voice change visibly rewrites the ad copy downstream.
     - every option a human WROTE stays on the board, re-choosable forever.
*/

// The three modes a staged move can be in. This taxonomy is the one thing Autopilot takes from
// brandbrain's OS (lib/studio/os.ts) — as a concept, not as code. It is what makes "autonomous"
// honest: the machine may fully prepare anything reversible, and may only STAGE anything that
// spends money, faces the public, or can't be undone.
const MODES = {
  auto:    { tag: "Auto",     note: "Drafts and previews only — nothing leaves this machine." },
  approve: { tag: "Needs you", note: "Irreversible, costs money, or faces the public. It stages; you tap go." },
  manual:  { tag: "Yours",     note: "Only you can do this one, out in the real world." },
};

// The decision spec — DATA, not code. One entry = one decision, its dependencies, and the prompt
// contract for generating its options. Adding a decision is an entry here and nothing else.
const SPEC = [
  {
    id: "voice", label: "Voice", axis: "HOW IT TALKS, AND TO WHOM", deps: [], inherit: "voice",
    ask: "3 distinct voices this company could speak in. Each must create a genuinely DIFFERENT relationship with the customer — not three shades of friendly.",
    fields: '"label":<2-4 words>,"text":<one sentence on the relationship it creates>,"lines":[<exactly 3 sentences written IN that voice, as this company would actually say them>]',
  },
  {
    id: "angle", label: "Ad angle", axis: "WHAT THE AD IS ACTUALLY ABOUT", deps: ["voice"],
    ask: "3 ad angles. Each must answer a DIFFERENT objection a real buyer actually has. Write every line in the chosen voice.",
    fields: '"label":<2-4 words naming the angle>,"text":<the headline>,"body":<one sentence of body copy>,"cta":<2-3 word call to action>',
  },
  {
    id: "channel", label: "Channel", axis: "WHERE IT RUNS, AND WHY THERE", deps: ["angle"],
    ask: "3 places to run this angle. Each must be somewhere this specific buyer already is — say why there, and what it actually costs in effort to start.",
    fields: '"label":<the channel>,"text":<why this buyer is there>,"body":<what it takes to start — concrete effort, not money>',
  },
  {
    id: "next", label: "Next move", axis: "WHAT WIDENS THE COMPANY", deps: [],
    ask: "3 next moves that would widen the company — a new product, format, segment or surface. Each must be a specific named thing, not a category.",
    fields: '"label":<what kind of move it is, 2-3 words>,"text":<the move itself, specific and named>,"body":<one sentence on why now>',
  },
];
const SPEC_BY_ID = Object.fromEntries(SPEC.map((s) => [s.id, s]));

// ---- the decision primitive ----------------------------------------------------------------
function decision(s) {
  return { id: s.id, label: s.label, axis: s.axis, deps: s.deps.slice(),
           options: [], draftedId: null, chosenId: null, chosenAt: null, stale: false, inherited: null };
}
/** machine drafts — NEVER touches chosenId. */
function draft(d) {
  const rec = d.options.find((o) => o.rec) || d.options[0];
  d.draftedId = rec ? rec.id : null;
  d.stale = false;
  return d;
}
const optOf = (d) => d.options.find((o) => o.id === d.chosenId) || null;
const shownOf = (d) => optOf(d) || d.options.find((o) => o.id === d.draftedId) || d.options[0] || null;
const isChosen = (d, o) => d.chosenId === o.id;
const isDrafted = (d, o) => !d.chosenId && d.draftedId === o.id;
const clock = () => new Date().toTimeString().slice(0, 5);

/** the ONLY route to the accent state. Wired to a click and nothing else. */
async function choose(co, d, optId) {
  if (d.chosenId === optId) return;
  d.chosenId = optId;
  d.chosenAt = clock();
  d.stale = false;
  const o = optOf(d);
  logLine(co, "you chose " + (o ? o.label : "an option") + " for " + d.label.toLowerCase(), "done", d.id);
  const stale = markStale(co, d.id);
  await saveCo(co); render();
  if (stale.length) await restream(co, stale);
}
async function unchoose(co, d) {
  d.chosenId = null; d.chosenAt = null;
  const stale = markStale(co, d.id);
  await saveCo(co); render();
  if (stale.length) await restream(co, stale);
}
/** the escape hatch creates a REAL option, indistinguishable downstream. */
async function ownOption(co, d, text) {
  const o = { id: "own" + uid(), label: text.slice(0, 60), text: "", own: true };
  d.options.push(o);
  logLine(co, "you wrote your own " + d.label.toLowerCase(), "done", d.id);
  await choose(co, d, o.id);
}

/** upstream changed → dependents go stale. Synchronous, so the board reacts on the click; the
 *  actual re-drafting is `restream`, which costs model calls. Keying `rec` off the upstream pick
 *  (the original bug here) is what makes the graph real rather than decorative. */
function markStale(co, changedId) {
  const out = [];
  for (const d of Object.values(co.decisions)) {
    if (!d.deps.includes(changedId)) continue;
    d.stale = true;
    if (d.chosenId && !d.options.some((o) => o.id === d.chosenId)) d.chosenId = null;
    out.push(d.id, ...markStale(co, d.id));
  }
  return out;
}
/** re-draft everything that went stale, in order, rendering as each lands. */
async function restream(co, ids) {
  for (const id of ids) {
    const d = co.decisions[id];
    if (!d) continue;
    try { await genOptions(co, id, "restream"); } catch (e) { d.error = msg(e); }
    await saveCo(co); render();
  }
  logLine(co, "restreamed " + ids.length + " decision" + (ids.length === 1 ? "" : "s") + " downstream", "run", ids[0]);
  await saveCo(co); render();
}

// ---- tokens: the one number we can show honestly --------------------------------------------
// Real usage from the broker when the backend reports it, a marked estimate when it doesn't.
// An estimate that is LABELLED an estimate is honest; an estimate presented as a measurement is
// the exact lie this surface exists to avoid.
const estimateTokens = (s) => Math.ceil(String(s || "").length / 4);
function spend(co, n, area, estimated) {
  co.tokens.spent += n;
  co.tokens.by[area] = (co.tokens.by[area] || 0) + n;
  if (estimated) co.tokens.estimated = true;
}
function logLine(co, text, state, target) {
  co.log.unshift({ t: text, s: state, target, at: clock() });
  co.log = co.log.slice(0, 14);
}

// ---- generation ------------------------------------------------------------------------------
async function completeCounted(prompt, maxTokens) {
  const res = await relay.complete({ prompt, model: "sonnet", maxTokens: maxTokens || 1400 });
  const u = res?.usage;
  const text = res?.text || "";
  const tokens = u ? (u.inputTokens || 0) + (u.outputTokens || 0) : estimateTokens(prompt) + estimateTokens(text);
  return { text, tokens, estimated: !u };
}

/** What the model is allowed to know about this company: the lent context, and nothing invented. */
function groundingBlock(co) {
  const parts = [];
  if (co.oneLine) parts.push(co.name + " — " + co.oneLine);
  else parts.push(co.name);
  const inh = co.inherited || {};
  for (const [k, v] of Object.entries(inh)) {
    if (v == null || v === "") continue;
    if ((co.overridden || []).includes(k)) continue;   // the user replaced this one — the chosen
                                                       // value reaches the prompt as an upstream
                                                       // constraint instead; sending both is how
                                                       // a model gets told two conflicting voices

    const flat = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : typeof v === "string" ? v : "";
    if (flat) parts.push(k + ": " + flat.slice(0, 400));
  }
  return "The company:\n" + parts.join("\n");
}

async function genOptions(co, id, reason) {
  const s = SPEC_BY_ID[id];
  const d = co.decisions[id];
  if (!s || !d) return;
  d.busy = true; d.error = null; render();

  // Upstream picks are CONSTRAINTS, not suggestions — this is what makes the ripple visible.
  // An INHERITED decision has no options, so `shownOf` is null for it: reading only the options
  // would silently drop the lent brand's voice out of every downstream prompt, which is exactly
  // the constraint the inherit feature exists to enforce. Inherited value wins, then the pick.
  const upstream = s.deps.map((dep) => {
    const ud = co.decisions[dep];
    if (!ud) return "";
    if (ud.inherited) return `${ud.label} is "${ud.inherited.value}" — inherited, treat as settled.`;
    const uo = shownOf(ud);
    return uo ? `${ud.label} is "${uo.label}" — ${uo.text || ""}`.trim() : "";
  }).filter(Boolean);

  const prompt = [
    "You are Autopilot. You operate a real company and propose its next decisions.",
    groundingBlock(co),
    upstream.length ? "Already decided — obey these exactly:\n" + upstream.join("\n") : "",
    "Propose " + s.ask,
    `Return ONLY a JSON array of 3 objects — no prose, no fences. Each: {${s.fields},"recommended":<true for exactly one>}`,
    "Ground every option in the company above. If you don't know a fact, say what you'd need instead — never invent a metric, a customer, a price or a result.",
  ].filter(Boolean).join("\n\n");

  try {
    const { text, tokens, estimated } = await completeCounted(prompt);
    // the CALLER says why this ran; deriving it from decision state got the precedence wrong
    // (`a || b ? x : y`) and mis-attributed every first draft that had an upstream dep.
    spend(co, tokens, reason === "restream" ? "restream" : "draft", estimated);
    const arr = parseJsonArray(text);
    if (!arr || !arr.length) throw new Error("no options came back — try again");
    const own = d.options.filter((o) => o.own);          // human-written options survive forever
    const machine = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || "Option").slice(0, 60),
      text: String(o.text || "").slice(0, 400),
      body: o.body ? String(o.body).slice(0, 400) : "",
      cta: o.cta ? String(o.cta).slice(0, 40) : "",
      lines: Array.isArray(o.lines) ? o.lines.slice(0, 3).map((l) => String(l).slice(0, 240)) : null,
      rec: !!o.recommended,
    }));
    if (!machine.some((o) => o.rec)) machine[0].rec = true;
    d.options = machine.concat(own);
    draft(d);
  } catch (e) {
    d.error = msg(e);
  } finally {
    d.busy = false;
  }
}

// ---- companies -------------------------------------------------------------------------------
const PALETTE = ["#2f6b45", "#2b4a7a", "#6b3f2f", "#4a2f6b", "#6b2f4a", "#2f5f6b"];
const slugOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || uid();

// ---- KINDS: the venture is ONE object; its `kind` only resolves three slots — what the deployable
// IS, how it makes money, and where it lives. A consumer brand, a consumer tech product, and a wrapp
// are the same venture with different answers here. This is the whole "it doesn't matter what it is"
// insight, made data: everything else (decisions, ops, growth, CEO, autonomy, daemon) is shared.
const KINDS = {
  brand:   { label: "BRAND",   deployNoun: "landing page", deployVerb: "Build the site",  offerNoun: "product",   econ: "sales", host: (s) => s + ".site" },
  product: { label: "PRODUCT", deployNoun: "product site", deployVerb: "Build the site",  offerNoun: "product",   econ: "sales", host: (s) => s + ".app" },
  wrapp:   { label: "WRAPP",   deployNoun: "wrapp",        deployVerb: "Ship the wrapp",   offerNoun: "the wrapp", econ: "usage", host: (s) => s + ".wrapp.sh" },
};
// A lent context's raw kind → a venture kind. brandbrain publishes `brand`; ideabrain `idea`
// (a software project → a product); the store pointer `project`; and a wrapp idea is `wrapp`.
const KIND_OF = { brand: "brand", company: "brand", project: "product", idea: "product", product: "product", wrapp: "wrapp" };
const resolveKind = (raw) => KIND_OF[String(raw || "").toLowerCase()] || "brand";
const kindCfg = (co) => KINDS[co && co.kind] || KINDS.brand;

function newCompany(cfg) {
  const kind = resolveKind(cfg.kind);
  const co = {
    id: cfg.id, name: cfg.name, kind, kindLabel: KINDS[kind].label,
    oneLine: cfg.oneLine || "", ctxId: cfg.ctxId || null, ctxName: cfg.ctxName || null,
    inherited: cfg.inherited || {},
    glyph: (cfg.name || "?").trim().charAt(0).toUpperCase(),
    color: PALETTE[Math.abs(hashOf(cfg.id)) % PALETTE.length], ink: "#EAF2E4",
    tokens: { spent: 0, budget: 2_000_000, by: {}, estimated: false },
    // ---- the OS state: everything a company runs on, beyond its decisions. All of it derives
    // from the slate or from an explicit human action — nothing here is invented data.
    site: cfg.domain ? { host: cfg.domain, live: false } : null,
    // `revenue` for sales kinds, `uses`/`payout` for usage (wrapp) kinds. null = "not connected".
    metrics: { revenue: null, traffic: null, uses: null, payout: null },
    tasks: [],        // { id, title, detail, state: queued|running|done|blocked, recurring, at }
    posts: [],        // social drafts: { id, channel, text, state: draft|staged|posted, at, ref }
    inbox: [],        // outreach drafts: { id, to, subject, body, state, at, ref }
    chat: [],         // CEO thread: { id, who: ceo|you, text, at }
    autotweet: false, // when true, a generated post stages instead of sitting as a silent draft
    // AUTONOMY: off by default. Turning it on IS the authorizing human act — thereafter the CEO
    // advances the company on its own for everything REVERSIBLE (deciding, drafting, planning).
    // Anything that leaves the machine still stages for the daemon's per-action consent; autonomy
    // never widens to irreversible sends. `cursor` remembers what the loop did last so it advances
    // instead of repeating.
    auto: { on: false, cursor: 0, at: 0 },
    log: [], decisions: {}, at: Date.now(),
  };
  for (const s of SPEC) co.decisions[s.id] = decision(s);
  // INHERIT, don't re-ask: a lent context already answered some of these. An inherited decision is
  // viewable, not re-decidable — but it can always be taken back (doctrine: every screen has an exit).
  for (const s of SPEC) {
    if (!s.inherit) continue;
    const v = co.inherited[s.inherit];
    if (typeof v === "string" && v.trim()) {
      co.decisions[s.id].inherited = { from: cfg.ctxName || cfg.name, value: v.trim() };
    }
  }
  return co;
}
function hashOf(s) { let h = 0; const t = String(s || ""); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; }
const CO = () => cos.find((c) => c.id === activeId) || null;

/** Everything the lent context knows that a company should carry. */
function inheritFrom(ctx) {
  const d = ctx.data || {};
  const keep = ["voice", "positioning", "audience", "oneLine", "summary", "state", "category", "priceRange", "domain"];
  const out = {};
  for (const k of keep) if (typeof d[k] === "string" && d[k].trim()) out[k] = d[k].trim();
  for (const k of ["palette", "products", "stack", "roadmap"]) {
    if (Array.isArray(d[k]) && d[k].length) out[k] = d[k].filter((x) => typeof x === "string");
  }
  return out;
}

async function seedFromContext() {
  const inherited = inheritFrom(brand);
  const co = newCompany({
    id: slugOf(brand.id || brand.name),
    name: brand.name || "Company",
    kind: brand.kind || "company",   // resolveKind maps brand/project/idea/wrapp → a venture kind
    oneLine: inherited.oneLine || inherited.summary || inherited.positioning || "",
    ctxId: brand.id, ctxName: brand.name,
    inherited,
  });
  // idempotent by BOTH keys — the same context lent twice must never mint a second company
  if (cos.some((c) => c.id === co.id || (c.ctxId && c.ctxId === co.ctxId))) {
    activeId = cos.find((c) => c.id === co.id || (c.ctxId && c.ctxId === co.ctxId)).id;
    creating = false; render();
    toast("You're already running " + co.name + " — switched to it.");
    return;
  }
  cos.push(co); activeId = co.id; creating = false;
  logLine(co, "picked up " + co.name + " from your lent context", "done", null);
  await saveCo(co); render();
  await draftSlate(co);
}

async function seedFromLine(line, kind) {
  // "Kettle — a cold-brew subscription for offices" is a NAME and a description, not a 45-character
  // name. Split on the first dash/colon/pipe so the tab reads "Kettle" and the blurb carries the rest.
  const m = line.match(/^\s*([^\u2014\u2013\-:|]{2,40}?)\s*[\u2014\u2013\-:|]\s*(.+)$/);
  const name = (m ? m[1] : line).trim().slice(0, 40);
  const oneLine = (m ? m[2] : line).trim();
  const co = newCompany({ id: slugOf(name) + "-" + uid().slice(0, 4), name, oneLine, kind: kind || "brand" });
  cos.push(co); activeId = co.id; creating = false;
  logLine(co, "seeded a " + kindCfg(co).label.toLowerCase() + " from one line", "done", null);
  await saveCo(co); render();
  await draftSlate(co);
}

/** THE COLD OPEN's engine: draft the whole operating slate. The voice→angle→channel chain is
 *  sequential because each constrains the next; `next` is independent, so it runs alongside. */
const drafting = new Set();   // company ids mid-draft — PER COMPANY, never one global flag:
                              // Autopilot's whole point is holding several at once, and a shared
                              // boolean makes drafting one silently abandon the next.
async function draftSlate(co) {
  if (!co || drafting.has(co.id)) return;
  drafting.add(co.id);
  try {
    const chain = (async () => {
      for (const id of ["voice", "angle", "channel"]) {
        const d = co.decisions[id];
        if (d.inherited) { d.stale = false; continue; }   // inherited — nothing to ask
        await genOptions(co, id, "draft");
        await saveCo(co); render();
      }
    })();
    const solo = (async () => { await genOptions(co, "next", "draft"); await saveCo(co); render(); })();
    await Promise.all([chain, solo]);
    logLine(co, "drafted the operating slate — nothing chosen yet", "run", null);
  } finally {
    drafting.delete(co.id);
    await saveCo(co); render();
  }
}

// ---- execution: the half that makes it an OS, not a cockpit ---------------------------------
// Autopilot INITIATES; the Switchboard daemon is the consent surface. Every world-touching move is
// a `relay.callTool` — and the daemon's gate classifies it write-class and throws its own per-action
// confirm THE MODEL CANNOT CLICK. So "approve" here means: Autopilot stages the exact call, you tap
// go, the daemon asks you once more, and only then does it leave the machine. When no connector is
// wired for a lane, the move stages honestly and says what to connect — it never pretends to send.
let toolNames = null;                 // cached lowercased tool-name list from the broker
async function discoverTools() {
  if (toolNames) return toolNames;
  try { const t = await relay.listTools(); toolNames = (t || []).map((x) => String(x.name || x).toLowerCase()); }
  catch { toolNames = []; }
  return toolNames;
}
// Map an abstract lane to a real connected tool, if the user has one. Deliberately loose: any Gmail /
// mail / send tool satisfies "inbox"; any tweet / x / social tool satisfies "social".
const LANE_MATCH = {
  social: /tweet|twitter|\bx_|social|post_to|linkedin/i,
  inbox: /gmail|mail|email|send_message|outreach/i,
  ads: /\bad(s|_|-)|campaign|adset|boost/i,
  site: /deploy|publish|website|pages|vercel|netlify/i,
  payments: /stripe|payment|checkout|charge|invoice|billing/i,
  usage: /analytics|usage|meter|plausible|posthog|umami|events/i,
};
async function toolForLane(lane) {
  const names = await discoverTools();
  const rx = LANE_MATCH[lane];
  return names.find((n) => rx.test(n)) || null;
}
// The lanes an autonomous company sends on, and what each does out in the world. This is the map
// between "a staged move" and "a real connector" — the surface that makes the gate legible.
const LANES = [
  { lane: "site", label: "Site / deploy", what: "publish the page or ship the wrapp to a subdomain" },
  { lane: "social", label: "Social", what: "post to X / LinkedIn" },
  { lane: "inbox", label: "Inbox", what: "send outreach email" },
  { lane: "ads", label: "Ads", what: "launch an ad campaign" },
  { lane: "payments", label: "Payments", what: "charge for a product (sales ventures)" },
  { lane: "usage", label: "Usage", what: "meter uses → Spotify-style rev-share (wrapps)" },
];
/** Sync lane status off the cached tool list: a tool name (live), false (none), or null (unknown). */
function laneLive(lane) {
  if (!toolNames) return null;
  return toolNames.find((n) => LANE_MATCH[lane].test(n)) || false;
}

/** Run a staged move. approve/auto only — manual moves are the human's, out in the world. */
async function runMove(co, move) {
  if (move.mode === "manual") return;
  if (move.mode === "auto") {                         // reversible: do it locally, no gate
    if (move.lane === "social") await genPost(co, move);
    else if (move.lane === "inbox") await genOutreach(co, move);
    return;
  }
  // approve — real, gated. Find a connector; if none, stage honestly.
  const tool = move.lane ? await toolForLane(move.lane) : null;
  if (!tool) {
    logLine(co, "staged “" + move.n + "” — no " + (move.lane || "connector") + " connected yet", "run", null);
    toast("Staged — connect a " + (move.lane || "tool") + " in the Switchboard panel to send it for real.");
    await saveCo(co); render();
    return;
  }
  logLine(co, "sending “" + move.n + "” via " + tool + "…", "run", null);
  await saveCo(co); render();
  try {
    const res = await relay.callTool(tool, move.args || {});   // daemon gate fires here
    logLine(co, "ran “" + move.n + "” — done", "done", null);
    if (move.postId) { const p = co.posts.find((x) => x.id === move.postId); if (p) { p.state = "posted"; p.ref = res?.ref || res?.id || null; } }
    if (move.mailId) { const m = co.inbox.find((x) => x.id === move.mailId); if (m) { m.state = "sent"; m.ref = res?.ref || res?.id || null; } }
    if (move.lane === "site" && co.site) { co.site.live = true; co.site.url = res?.url || ("https://" + co.site.host); }
    if (move.lane === "payments" && co.product) { co.product.live = true; co.metrics.revenue = co.metrics.revenue ?? 0; }
    if (move.lane === "usage") { co.usageLive = true; co.metrics.uses = co.metrics.uses ?? 0; co.metrics.payout = co.metrics.payout ?? 0; }
    toast("Done — " + move.n);
  } catch (e) {
    logLine(co, "“" + move.n + "” didn't go through — " + msg(e), "run", null);
    toast(msg(e), true);
  }
  await saveCo(co); render();
}

// ---- staged moves: derived from the decisions, never invented -------------------------------
function movesFor(co) {
  const out = [];
  const angle = optOf(co.decisions.angle);
  const channel = optOf(co.decisions.channel);
  const next = optOf(co.decisions.next);
  const named = (o) => (o.label || o.text || "").trim();
  const stated = (o) => (o.text || o.label || "").trim();
  if (angle) out.push({ id: "creative", n: "Draft the creative for “" + named(angle) + "”", mode: "auto", lane: "social" });
  if (angle && channel) out.push({ id: "run", n: "Run “" + named(angle) + "” on " + named(channel), mode: "approve", lane: "ads",
    args: { angle: named(angle), channel: named(channel), body: angle?.body || "" } });
  if (angle) out.push({ id: "outreach", n: "Email leads about “" + named(angle) + "”", mode: "auto", lane: "inbox" });
  if (next) out.push({ id: "widen", n: stated(next), mode: "manual" });
  return out;
}

// ---- tasks: the operations list. Derived from the slate's own state, so it's always honest about
// what's actually pending — plus one standing recurring beat, the way a company plans daily.
// The TASK SYSTEM — every task is a pure function of the venture's state, tagged with a status and a
// runnable action, exactly like Acoco's. `run now` on any pending task executes it (the same call
// the clone/Autopilot would make); staged tasks are approve-class and gated; recurring is the daily
// beat; done is derived from real state; failed carries the error. Nothing here is hand-authored.
const runningTasks = new Set();     // task ids executing right now (transient)
const failedTasks = new Map();      // task id → last error message (transient)
function tasksFor(co) {
  const T = [];
  const kc = kindCfg(co);
  // decide the open forks
  for (const s of SPEC) {
    const d = co.decisions[s.id];
    if (d && !d.chosenId && !d.inherited && d.options.length)
      T.push({ id: "decide-" + s.id, title: "Decide " + s.label.toLowerCase(), detail: d.options.length + " options drafted — pick one", status: "pending", act: { kind: "decide", id: s.id } });
  }
  // reversible generative work the clone can prepare
  if (kc.econ === "sales" && (!co.product || !co.product.drafted)) T.push({ id: "gen-product", title: "Shape the product", detail: "a first paid offer, from your context + angle", status: "pending", act: { kind: "product" } });
  if (!co.site || !co.site.drafted) T.push({ id: "gen-site", title: kc.deployVerb, detail: "generate the " + kc.deployNoun + " from the context", status: "pending", act: { kind: "site" } });
  if ((co.posts || []).length < 3) T.push({ id: "gen-post", title: "Draft the launch social", detail: "posts in the company's voice", status: "pending", act: { kind: "post" } });
  if ((co.inbox || []).length < 2) T.push({ id: "gen-outreach", title: "Draft outreach", detail: "cold emails to your first " + (kc.econ === "usage" ? "users" : "buyers"), status: "pending", act: { kind: "outreach" } });
  // staged sends — approve-class, need your go
  for (const m of movesFor(co).filter((m) => m.mode === "approve")) T.push({ id: "move-" + m.id, title: m.n, detail: MODES.approve.note, status: "staged", move: m, act: { kind: "move", move: m } });
  // recurring beat
  T.push({ id: "daily-plan", title: "Daily company planning", detail: "the CEO reviews the board and queues the day", status: "recurring", act: { kind: "plan" } });
  // apply transient run state
  return T.map((t) => runningTasks.has(t.id) ? { ...t, status: "running" } : failedTasks.has(t.id) ? { ...t, status: "failed", err: failedTasks.get(t.id) } : t);
}
/** Tasks already done — derived from real state, so the Done tab is honest, never a hand-kept list. */
function tasksDone(co) {
  const D = [];
  for (const s of SPEC) { const d = co.decisions[s.id]; if (d && (d.chosenId || d.inherited)) D.push({ id: "done-" + s.id, title: "Decided " + s.label.toLowerCase(), detail: (optOf(d) || {}).label || (d.inherited || {}).value || "", status: "done" }); }
  if (co.site && co.site.drafted) D.push({ id: "done-site", title: kindCfg(co).econ === "usage" ? "Shipped the wrapp" : "Built the site", detail: co.site.host || "", status: "done" });
  if (co.product && co.product.drafted) D.push({ id: "done-product", title: "Shaped the product", detail: co.product.name || "", status: "done" });
  if ((co.posts || []).length) D.push({ id: "done-posts", title: "Drafted the launch social", detail: co.posts.length + " posts", status: "done" });
  if ((co.inbox || []).length) D.push({ id: "done-inbox", title: "Drafted outreach", detail: co.inbox.length + " emails", status: "done" });
  return D;
}
/** run now — execute a task's action, the same call the clone/Autopilot makes. Reversible ones run;
 *  staged (approve) ones go through runMove's gate; failures surface on the task, never silent. */
async function runTask(co, task) {
  const a = task.act; if (!a) return;
  runningTasks.add(task.id); failedTasks.delete(task.id); render();
  try {
    if (a.kind === "decide") { const d = co.decisions[a.id]; if (d && d.options.length) await autoChoose(co, d); }
    else if (a.kind === "product") await genProduct(co);
    else if (a.kind === "site") await genSite(co);
    else if (a.kind === "post") await genPost(co, { lane: "social" });
    else if (a.kind === "outreach") await genOutreach(co, { lane: "inbox" });
    else if (a.kind === "move") await runMove(co, a.move);
    else if (a.kind === "plan") await ceoProactive(co);
  } catch (e) { failedTasks.set(task.id, msg(e)); }
  finally { runningTasks.delete(task.id); await saveCo(co); render(); }
}

// ---- the CEO: the strategy surface. A persona grounded in THIS company that reviews the board,
// proposes the day, and answers you. Real model calls, your Claude, grounded — never invented facts.
async function ceoSay(co, text) {
  const you = { id: uid(), who: "you", text: text.trim(), at: clock() };
  co.chat.push(you);
  await saveCo(co); render();
  const chosen = SPEC.map((s) => { const d = co.decisions[s.id]; const o = optOf(d); return o ? s.label + ": " + o.label : (d.inherited ? s.label + ": " + d.inherited.value : null); }).filter(Boolean);
  const recent = co.chat.slice(-6).map((m) => (m.who === "you" ? "Founder" : "You (CEO)") + ": " + m.text).join("\n");
  const prompt = [
    "You are the operating CEO of " + co.name + ". You speak to the founder as a trusted partner — direct, concrete, no fluff, first person.",
    groundingBlock(co),
    chosen.length ? "Decided so far:\n" + chosen.join("\n") : "Nothing decided yet.",
    "Recent thread:\n" + (recent || "(new)"),
    "Reply to the founder's last message in 2-4 sentences. Propose concrete next moves this company could actually make. Never invent a metric, a customer, a price, or a result — if you'd need data, say what you'd need.",
  ].join("\n\n");
  try {
    const { text: reply, tokens, estimated } = await completeCounted(prompt, 500);
    spend(co, tokens, "ceo", estimated);
    co.chat.push({ id: uid(), who: "ceo", text: reply.trim(), at: clock() });
  } catch (e) {
    co.chat.push({ id: uid(), who: "ceo", text: "Couldn't reach your Claude just now — " + msg(e), at: clock() });
  }
  await saveCo(co); render();
}

// ---- social: a post drafted in the company's chosen voice, off the chosen angle. Stages (or, with
// autotweet on, auto-stages) — the actual send is a gated callTool through runMove.
async function genPost(co, move) {
  const angle = optOf(co.decisions.angle) || shownOf(co.decisions.angle);
  const prompt = [
    "You are running social for " + co.name + ".",
    groundingBlock(co),
    angle ? "The angle to lead with: " + (angle.label || "") + " — " + (angle.text || "") : "",
    "Write ONE post (under 260 chars) in this company's voice. No hashtags unless they're natural. Return only the post text.",
  ].filter(Boolean).join("\n\n");
  try {
    const { text, tokens, estimated } = await completeCounted(prompt, 300);
    spend(co, tokens, "social", estimated);
    const p = { id: uid(), channel: "x", text: text.trim().slice(0, 280), state: co.autotweet ? "staged" : "draft", at: clock() };
    co.posts.unshift(p); co.posts = co.posts.slice(0, 8);
    logLine(co, co.autotweet ? "drafted + staged a post" : "drafted a post — yours to send", "done", null);
  } catch (e) { logLine(co, "couldn't draft a post — " + msg(e), "run", null); }
  await saveCo(co); render();
}

// ---- inbox: outreach drafts. Finding real leads needs a connector; absent one, this drafts the
// message the company would send and stages it — honest about what it can and can't reach.
async function genOutreach(co, move) {
  const angle = optOf(co.decisions.angle) || shownOf(co.decisions.angle);
  const aud = (co.inherited || {}).audience || "";
  const prompt = [
    "You are doing cold outreach for " + co.name + ".",
    groundingBlock(co),
    aud ? "Who to reach: " + aud : "",
    angle ? "Lead with the angle: " + (angle.label || "") : "",
    "Write ONE short cold email — a subject line and 3-4 sentence body — this company could send to a prospect. Return as JSON: {\"subject\":..., \"body\":...}. Never invent the recipient's name or a fake result.",
  ].filter(Boolean).join("\n\n");
  try {
    const { text, tokens, estimated } = await completeCounted(prompt, 400);
    spend(co, tokens, "inbox", estimated);
    let subject = "Quick note", body = text.trim();
    const j = text.indexOf("{"); if (j !== -1) { try { const o = JSON.parse(text.slice(j, text.lastIndexOf("}") + 1)); subject = o.subject || subject; body = o.body || body; } catch {} }
    const m = { id: uid(), to: aud ? "(a " + aud.split(/[,.]/)[0].trim() + ")" : "(a prospect)", subject, body, state: "draft", at: clock() };
    co.inbox.unshift(m); co.inbox = co.inbox.slice(0, 8);
    logLine(co, "drafted outreach — yours to send", "done", null);
  } catch (e) { logLine(co, "couldn't draft outreach — " + msg(e), "run", null); }
  await saveCo(co); render();
}

// ---- the site: the one place a company points at. Generated from the context + the chosen slate,
// previewed LOCALLY (reversible, nothing public). Publishing it is a separate approve-class move
// behind a deploy connector — the same honest boundary as every other send.
async function genSite(co) {
  if (co.site && co.site.busy) return;
  const kc = kindCfg(co);
  const host = (co.site && co.site.host) || kc.host(slugOf(co.name));
  co.site = { ...(co.site || {}), host, busy: true };
  logLine(co, kc.econ === "usage" ? "building the wrapp's entry…" : "building the site…", "run", null); render();
  const voice = optOf(co.decisions.voice) || (co.decisions.voice.inherited ? { label: co.decisions.voice.inherited.value } : null);
  const angle = optOf(co.decisions.angle) || shownOf(co.decisions.angle);
  const pal = (co.inherited && co.inherited.palette) || [];
  const wrappBrief = kc.econ === "usage"
    ? "You are building the entry screen for a WRAPP — a single-purpose app that runs on the visitor's own Claude via Switchboard (they bring the compute; there is no signup and no charge). Make the ONE thing it does obvious, with a single primary action to start. It will live at " + host + "."
    : "You are building the launch landing page for " + co.name + ".";
  const prompt = [
    wrappBrief,
    groundingBlock(co),
    voice ? "Voice: " + (voice.label || "") : "",
    angle ? "Lead with the angle: " + (angle.label || "") + " — " + (angle.text || "") : "",
    pal.length ? "Palette to use: " + pal.join(", ") : "",
    "Return ONE self-contained HTML document — inline <style> only, no external assets, no <script>. A real, tasteful single screen: a headline, a subhead, ONE clear primary action, and 3 short points. Dark, modern, generous spacing. Ground every word in the company above — never invent a metric, a customer, a price, or a testimonial. Return ONLY the HTML, starting with <!doctype html>.",
  ].filter(Boolean).join("\n\n");
  try {
    const { text, tokens, estimated } = await completeCounted(prompt, 2200);
    spend(co, tokens, "site", estimated);
    let html = text.replace(/```[a-z]*\n?/gi, "").trim();
    const lo = html.toLowerCase();
    if (!lo.includes("<html") && !lo.includes("<!doctype") && !lo.includes("<body")) {
      // the backend didn't return a page (the harness mock never will) — wrap what came back into an
      // honest minimal page so the surface still works, rather than pretending nothing happened.
      html = "<!doctype html><meta charset=utf-8><body style=\"margin:0;font:16px/1.6 system-ui;background:#0A0C10;color:#E8EDF4;display:grid;place-items:center;min-height:100vh;text-align:center;padding:40px\">"
        + "<div style=\"max-width:560px\"><h1 style=\"font:700 2.2rem/1.1 system-ui;letter-spacing:-.02em\">" + esc(co.name) + "</h1>"
        + "<p style=\"color:#B4BECE\">" + esc(co.oneLine || "") + "</p>"
        + "<a style=\"display:inline-block;margin-top:18px;background:#C8F250;color:#0A0C10;font-weight:600;padding:11px 20px;border-radius:10px;text-decoration:none\">Get started</a>"
        + "<p style=\"color:#6E7C90;font:12px/1.6 monospace;margin-top:26px\">" + esc(html.slice(0, 240)) + "</p></div>";
    }
    co.site = { host, html, live: false, drafted: true, at: clock() };
    logLine(co, "drafted the site — preview it, then publish when you're ready", "done", null);
  } catch (e) { co.site.busy = false; logLine(co, "couldn't build the site — " + msg(e), "run", null); }
  await saveCo(co); render();
}

// ---- the product + the money path: what the company sells, and how it charges. The offer is
// drafted from context (reversible). Setting up payments to actually charge is an approve-class
// move behind a payments connector — Autopilot NEVER charges on its own, and revenue only ever
// shows a real number the connector reported, never a fabricated one.
async function genProduct(co) {
  if (co.product && co.product.busy) return;
  co.product = { ...(co.product || {}), busy: true };
  logLine(co, "shaping the product…", "run", null); render();
  const angle = optOf(co.decisions.angle) || shownOf(co.decisions.angle);
  const prompt = [
    "You are defining the first paid offer for " + co.name + ".",
    groundingBlock(co),
    angle ? "It should line up with the angle you're running: " + (angle.label || "") : "",
    "Propose ONE concrete first product to sell — a specific named offer at a specific price. Return JSON: {\"name\":<the offer, 2-5 words>, \"price\":<a realistic number in USD>, \"blurb\":<one sentence on exactly what the buyer gets>}. Never invent a result, a testimonial, or a customer count.",
  ].filter(Boolean).join("\n\n");
  try {
    const { text, tokens, estimated } = await completeCounted(prompt, 400);
    spend(co, tokens, "product", estimated);
    let p = { name: co.name + " — first offer", price: 0, blurb: "" };
    const j = text.indexOf("{");
    if (j !== -1) { try { const o = JSON.parse(text.slice(j, text.lastIndexOf("}") + 1)); p = { name: String(o.name || p.name).slice(0, 60), price: Math.max(0, Math.round(Number(o.price) || 0)), blurb: String(o.blurb || "").slice(0, 160) }; } catch {} }
    co.product = { ...p, drafted: true, live: false, at: clock() };
    logLine(co, "drafted the product — " + p.name + (p.price ? " · $" + p.price : ""), "done", null);
  } catch (e) { co.product.busy = false; logLine(co, "couldn't shape the product — " + msg(e), "run", null); }
  await saveCo(co); render();
}

// ==== autonomy: the company advances itself ==================================================
// The honest boundary: turning autopilot ON authorizes the CEO to do everything REVERSIBLE without
// you — decide the open slate, draft posts and outreach, plan, report. It NEVER auto-sends: anything
// that leaves the machine still stages for the daemon's per-action consent. One beat per tick, slow
// enough to read — a company that moves faster than you can follow is one you've stopped trusting.
const ticking = new Set();
let autoTimer = null;
const AUTO_MS = 9000;
const anyAuto = () => cos.some((c) => c.auto && c.auto.on);
function ensureAutoLoop() {
  if (relay && anyAuto() && !autoTimer) autoTimer = setInterval(() => void tickAll(), AUTO_MS);
  if ((!relay || !anyAuto()) && autoTimer) { clearInterval(autoTimer); autoTimer = null; }
}
async function tickAll() {
  if (!relay) return;
  for (const co of cos) {
    if (!co.auto || !co.auto.on || ticking.has(co.id) || drafting.has(co.id)) continue;
    ticking.add(co.id);
    try { await autoTick(co); } catch (e) { logLine(co, "autopilot hit a snag — " + msg(e), "run", null); await saveCo(co); render(); }
    finally { ticking.delete(co.id); }
  }
}
/** LAND ON THE OS FIRST — the fast-track. Draft the slate if needed, then let the CEO choose the
 *  recommended option at every open decision (in SPEC order so dependents see their upstream pick),
 *  and hand it to autopilot. You land in a running cockpit with the whole route decided and moves
 *  staged — then steer by re-choosing anything. This is "AI runs it; you pick the direction." */
async function runTheRoute(co) {
  if (!co) return;
  const anyDrafted = Object.values(co.decisions).some((d) => d.options.length || d.inherited);
  if (!anyDrafted) await draftSlate(co);
  for (const s of SPEC) {
    const d = co.decisions[s.id];
    if (!d || d.inherited || d.chosenId || !d.options.length) continue;
    await autoChoose(co, d);
  }
  if (co.auto) co.auto.on = true;
  logLine(co, "AI ran the route — the slate's decided and autopilot has it. Steer by re-choosing anything.", "run", null);
  await saveCo(co); render(); ensureAutoLoop();
}
/** Start box → land straight in a running cockpit: seed from context or the one-liner, then run it. */
async function letAiRunIt() {
  const input = document.querySelector(".bindrow input");
  const v = input ? input.value.trim() : "";
  if (v) await seedFromLine(v, seedKind);
  else if (brand) await seedFromContext();
  else return;
  await runTheRoute(CO());
}

/** the CEO decides, under the autonomy you granted by turning autopilot on. Reversible — every pick
 *  stays unlockable exactly like a human choice, and is logged as the CEO's, not yours. */
async function autoChoose(co, d) {
  const rec = d.options.find((o) => o.rec) || d.options[0];
  if (!rec) return false;
  d.chosenId = rec.id; d.chosenAt = clock(); d.stale = false;
  logLine(co, "CEO chose " + rec.label + " for " + d.label.toLowerCase(), "done", d.id);
  const stale = markStale(co, d.id);
  await saveCo(co); render();
  if (stale.length) await restream(co, stale);
  return true;
}
/** a short proactive status the CEO posts to the thread on its own — not a reply, no fake "you". */
async function ceoProactive(co) {
  const chosen = SPEC.map((s) => { const o = optOf(co.decisions[s.id]); return o ? s.label + ": " + o.label : null; }).filter(Boolean);
  const prompt = [
    "You are the operating CEO of " + co.name + ", running it while the founder is away.",
    groundingBlock(co),
    chosen.length ? "Decided so far:\n" + chosen.join("\n") : "",
    "Post a SHORT proactive status (1-2 sentences, first person) on what you just moved on and what's next. Never invent a metric, customer, price, or result.",
  ].filter(Boolean).join("\n\n");
  try {
    const { text, tokens, estimated } = await completeCounted(prompt, 300);
    spend(co, tokens, "ceo", estimated);
    co.chat.push({ id: uid(), who: "ceo", text: text.trim(), at: clock() });
  } catch { /* a missed status is not worth a toast */ }
  await saveCo(co); render();
}
/** ONE next action per tick — watchable, reversible, never a send. */
async function autoTick(co) {
  if (co.tokens.spent >= co.tokens.budget) {
    co.auto.on = false; ensureAutoLoop();
    logLine(co, "autopilot paused — out of runway this week. Fund more to keep it moving.", "run", null);
    toast(co.name + " paused — out of runway. Fund it to continue.");
    await saveCo(co); render(); return;
  }
  const open = SPEC.map((s) => co.decisions[s.id]).find((d) => d && !d.chosenId && !d.inherited && d.options.length && !d.busy);
  if (open) { await autoChoose(co, open); co.auto.at = Date.now(); return; }
  const salesKind = kindCfg(co).econ === "sales";
  const beats = [
    async () => { if (salesKind && (!co.product || !co.product.drafted)) { await genProduct(co); return true; } return false; },
    async () => { if (!co.site || !co.site.drafted) { await genSite(co); return true; } return false; },
    async () => { if (co.posts.length < 3) { await genPost(co, { lane: "social" }); return true; } return false; },
    async () => { if (co.inbox.length < 2) { await genOutreach(co, { lane: "inbox" }); return true; } return false; },
    async () => { await ceoProactive(co); return true; },
  ];
  for (let i = 0; i < beats.length; i++) {
    if (await beats[(co.auto.cursor + i) % beats.length]()) { co.auto.cursor = (co.auto.cursor + i + 1) % beats.length; co.auto.at = Date.now(); return; }
  }
  co.auto.at = Date.now();
}

// ---- the cold open ---------------------------------------------------------------------------
let coldOpened = false;
function autostart() {
  // THE COLD OPEN — when a context is lent, the wrapp launches its FULL workflow with ZERO input.
  // Connect Switchboard, and the operating slate for your actual company is already drafting.
  //
  // IDEMPOTENT ON PURPOSE: `onReady` legitimately runs twice — once from mountConnect's onConnect
  // and once from the returning-user probe, whichever wins the race. Guarding only on
  // `cos.length` is not enough, because the second pass re-reads storage before the first pass's
  // company has been persisted, sees an empty list, and seeds a SECOND copy of the same company.
  if (!relay || coldOpened || cos.length) return;
  if (!brand || !brand.name) return;
  coldOpened = true;
  void seedFromContext();
}

// ==== render ================================================================================
let pane = null;      // { kind } — the open slate, or "tokens"
let creating = false; // "+ New company" pressed — show the seed box over the portfolio
let portfolio = false; // the Companies overview — every company at a glance, the OS's front door

function render() {
  const hero = $("hero"), view = $("view");
  if (!hero || !view) return;
  const co = CO();
  const onDeck = !!(relay && cos.length);
  hero.hidden = onDeck;
  document.body.classList.toggle("cock-on", onDeck);   // full-width shell only once there's a board
  view.textContent = "";

  if (!relay) { view.append(connectSteps(), sampleSlate()); return; }
  // No companies yet, or "+ New company" was pressed: the seed box IS the screen. Previously the
  // second case fell through to cockpit(null), which drew the tabs and then nothing — the portfolio
  // claim ("several companies on one board") was unreachable because you could never add the second.
  if (!cos.length || creating) { view.append(startBox()); return; }
  if (portfolio) { view.append(portfolioView()); ensureAutoLoop(); return; }

  view.append(cockpit(co));
  renderPane(co);
  ensureAutoLoop();   // resume/settle the autonomous loop to match current auto-on state
}

// ---- the portfolio: every company on one board — the Companies overview you land on with more
// than one, and can always return to. Each row opens that company's cockpit. --------------------
function portfolioView() {
  const wrap = el("div", "port");
  const head = el("div", "porthead");
  const ht = el("div");
  ht.append(el("h2", "porttitle", "Companies"));
  ht.append(el("div", "portsub", cos.length + " compan" + (cos.length === 1 ? "y" : "ies") + " · " + cos.filter((c) => c.auto && c.auto.on).length + " on autopilot"));
  head.append(ht);
  const add = el("button", "primary", "+ New company");
  add.onclick = () => { creating = true; portfolio = false; render(); };
  head.append(add);
  wrap.append(head);

  const tiles = el("div", "porttiles");
  tiles.append(portTile("Companies", String(cos.length)));
  tiles.append(portTile("On autopilot", String(cos.filter((c) => c.auto && c.auto.on).length)));
  const anyRev = cos.some((c) => c.metrics && typeof c.metrics.revenue === "number");
  const rev = cos.reduce((s, c) => s + (c.metrics && typeof c.metrics.revenue === "number" ? c.metrics.revenue : 0), 0);
  tiles.append(portTile("Revenue MTD", anyRev ? "$" + rev : "— not connected", !anyRev));
  const spent = cos.reduce((s, c) => s + (c.tokens?.spent || 0), 0);
  tiles.append(portTile("Runway spent", fmtTok(spent)));
  wrap.append(tiles);

  const table = el("div", "porttable");
  const hr = el("div", "ptrow pthead");
  hr.append(el("div", null, "Company"), el("div", null, "Status"), el("div", null, "Decisions"), el("div", null, "Revenue MTD"), el("div", null, "Site"));
  table.append(hr);
  for (const c of cos) table.append(portRow(c));
  wrap.append(table);
  return wrap;
}
function portTile(label, value, na) {
  const t = el("div", "ptile");
  t.append(el("div", "ptlabel", label));
  t.append(el("div", "ptvalue" + (na ? " na" : ""), value));
  return t;
}
function portRow(c) {
  const r = el("button", "ptrow ptco");
  const who = el("div", "ptwho");
  const logo = el("div", "ptlogo", c.glyph); logo.style.background = c.color; logo.style.color = c.ink;
  const nm = el("div");
  nm.append(el("div", "ptname", c.name), el("div", "ptkind", c.kindLabel));
  who.append(logo, nm);
  const decided = Object.values(c.decisions || {}).filter((d) => d.chosenId || d.inherited).length;
  const status = c.auto && c.auto.on ? el("span", "ptstat on", "● Autopilot") : drafting.has(c.id) ? el("span", "ptstat run", "drafting") : el("span", "ptstat", "paused");
  const rev = c.metrics && typeof c.metrics.revenue === "number" ? "$" + c.metrics.revenue : el("span", "na", "— not connected");
  const site = c.site && c.site.live ? el("span", "ptsite on", c.site.host) : c.site && c.site.drafted ? el("span", "ptsite draft", "drafted") : el("span", "na", "no site");
  const revCell = typeof rev === "string" ? el("div", null, rev) : (() => { const d = el("div"); d.append(rev); return d; })();
  const siteCell = el("div"); siteCell.append(site);
  const decCell = el("div", null, decided + " / " + SPEC.length);
  const statCell = el("div"); statCell.append(status);
  r.append(who, statCell, decCell, revCell, siteCell);
  r.onclick = () => { activeId = c.id; portfolio = false; pane = null; render(); };
  return r;
}

/** the connectors chip — how many of the five send-lanes have a live connector. Clicking opens the
 *  readout that turns "staged" into "here's exactly what to connect". */
function connectorsChip() {
  const b = el("button", "connchip");
  const live = LANES.filter((l) => laneLive(l.lane)).length;
  const known = toolNames != null;
  b.append(el("span", "cbolt", "⚡"));
  b.append(el("span", "cbtxt", known ? live + "/" + LANES.length + " lanes live" : "connectors"));
  b.onclick = () => { pane = { kind: "connectors" }; render(); };
  return b;
}
/** the connectors readout — each send-lane, whether it's wired, and what it unlocks. The honest map
 *  from Autopilot's staged moves to the real world: sends stay gated until a connector exists. */
function connectorsPane(body) {
  body.append(el("h3", "ptitle", "Connectors"));
  body.append(el("div", "fundnote", "Autopilot drafts everything on its own, but a send only leaves the machine through a connector you've wired in Switchboard — and even then, each send asks for your go. This is the map."));
  if (toolNames == null) { body.append(researching("checking what's connected…")); void discoverTools().then(() => render()); return; }
  for (const l of LANES) {
    const tool = laneLive(l.lane);
    const row = el("div", "connrow");
    row.append(el("span", "conndot" + (tool ? " on" : "")));
    const mid = el("div", "connmid");
    mid.append(el("div", "connlabel", l.label));
    mid.append(el("div", "connwhat", l.what));
    row.append(mid);
    row.append(el("span", "connstate" + (tool ? " on" : ""), tool ? "live" : "not connected"));
    body.append(row);
  }
  body.append(el("div", "honest ember", "● Nothing here is a number we made up. A lane is 'live' only if the daemon actually reports a matching connected tool for this origin — otherwise every move on that lane stays staged, and Autopilot never pretends it sent."));
}

/** the master switch — turning it on IS the authorizing act; the CEO advances everything reversible
 *  from here, and the operating log tells you each move as it happens. */
function autoToggle(co) {
  const b = el("button", "autobtn" + (co.auto && co.auto.on ? " on" : ""));
  b.append(el("span", "autodot"), el("span", "autolab", co.auto && co.auto.on ? "Autopilot on" : "Autopilot off"));
  b.onclick = async () => {
    co.auto.on = !co.auto.on;
    logLine(co, co.auto.on ? "you handed " + co.name + " to autopilot — the CEO takes it from here" : "you took the wheel back — autopilot paused", "run", null);
    await saveCo(co); render(); ensureAutoLoop();
  };
  return b;
}

let seedKind = "brand";   // the venture kind chosen in the start box for a one-line venture
function startBox() {
  const box = el("div", "start");
  if (brand) box.append(el("div", "ctx", "ready to pick up your lent context — " + brand.name));

  // THE UNIFICATION, made visible: a brand, a product, and a wrapp are the same venture. Pick which
  // — it only changes what gets deployed and how it earns; everything else is identical.
  const picker = el("div", "kindpick");
  for (const [k, cfg] of Object.entries(KINDS)) {
    const b = el("button", "kindopt" + (seedKind === k ? " on" : ""));
    b.append(el("span", "kn", cfg.label.toLowerCase()));
    b.append(el("span", "kd", k === "wrapp" ? "a subdomain product · earns by usage" : k === "product" ? "an app · earns by sales" : "a brand · earns by sales"));
    b.onclick = () => { seedKind = k; render(); };
    picker.append(b);
  }
  box.append(picker);

  const row = el("div", "bindrow");
  const input = el("input");
  input.placeholder = seedKind === "wrapp" ? "one line — what should the wrapp do?" : "one line — what is the " + KINDS[seedKind].label.toLowerCase() + "?";
  const go = () => { const v = input.value.trim(); if (v) void seedFromLine(v, seedKind); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  const btn = el("button", "primary", brand ? "Pick it up" : "Start it");
  btn.onclick = () => { if (brand && !input.value.trim()) void seedFromContext(); else go(); };
  row.append(input, btn);
  box.append(row);

  // THE FAST-TRACK — land on the OS first. One tap: the AI drafts the whole route, picks the
  // recommended call at every fork, hands it to autopilot, and drops you in a running cockpit. You
  // steer by re-choosing. "Decide it yourself" is still right there (the Start button + each fork).
  const fast = el("button", "runit");
  fast.append(el("span", "bolt", "⚡"), el("span", null, "Let AI run it — land on the OS"));
  fast.onclick = () => void letAiRunIt();
  box.append(fast);
  box.append(el("div", "hint", brand
    ? "“Let AI run it” decides the whole route for you and starts operating; “Pick it up” drops you into the slate to decide each call yourself."
    : "“Let AI run it” decides the whole route and starts operating; “Start it” drops you in to decide each call yourself. Or lend a brand, project, idea or wrapp in the Switchboard panel."));
  // never a one-way door: if there's already a portfolio behind this, you can always go back to it
  if (creating && cos.length) {
    const back = el("button", "act", "← back to " + (CO()?.name || "the board"));
    back.onclick = () => { creating = false; render(); };
    box.append(back);
  }
  setTimeout(() => input.focus(), 30);
  return box;
}

/** Pre-connect only, and visibly labelled — doctrine allows a sample ONLY here. */
function sampleSlate() {
  const w = el("div", "sample");
  w.append(el("div", "kicker sect", "what a slate looks like · sample, not your data"));
  const rows = [
    ["Voice", "how it talks, and to whom", "3 options"],
    ["Ad angle", "what the ad is actually about", "follows the voice you pick"],
    ["Channel", "where it runs, and why there", "follows the angle"],
    ["Next move", "what widens the company", "3 options"],
  ];
  for (const [a, b, c] of rows) {
    const r = el("div", "srow");
    r.append(el("div", "rname", a), el("div", "rsub", b), el("div", "rmeta", c));
    w.append(r);
  }
  return w;
}

function cockpit(co) {
  const wrap = el("div", "cock");

  // ---- company switcher + tokens
  const top = el("div", "top");
  const tabs = el("div", "cosw");
  for (const c of cos) {
    const b = el("button", "cotab" + (c.id === activeId ? " on" : ""));
    const cl = el("span", "cl", c.glyph); cl.style.background = c.color; cl.style.color = c.ink;
    const nm = el("span"); nm.append(el("span", "cn", c.name), el("br"), el("span", "ck", c.kindLabel));
    b.append(cl, nm);
    b.onclick = () => { activeId = c.id; creating = false; pane = null; render(); };
    tabs.append(b);
  }
  const add = el("button", "cotab add", "+ New company");
  add.onclick = () => { creating = true; pane = null; render(); };
  tabs.append(add);
  const allBtn = el("button", "cotab port", "◱ Companies");
  allBtn.onclick = () => { portfolio = true; pane = null; render(); };
  tabs.prepend(allBtn);
  top.append(tabs, connectorsChip(), co ? autoToggle(co) : el("span"), tokenMeter(co));
  wrap.append(top);

  if (!co) return wrap;

  const grid = el("div", "grid");
  grid.append(companyCol(co), opsCol(co), growthCol(co), strategyCol(co));
  wrap.append(grid);
  return wrap;
}

// ---- COLUMN 1 · COMPANY — identity, the live site, the two real numbers, and runway -----------
function companyCol(co) {
  const c = el("div", "col");
  c.append(el("div", "chead", "COMPANY"));

  const idc = el("div", "card");
  const idrow = el("div", "idrow");
  const logo = el("div", "idlogo", co.glyph); logo.style.background = co.color; logo.style.color = co.ink;
  const who = el("div");
  who.append(el("h3", null, co.name));
  who.append(el("div", "ck", co.kindLabel + (co.ctxName ? " · lent from " + co.ctxName : "")));
  idrow.append(logo, who);
  idc.append(idrow);
  if (co.oneLine) idc.append(el("p", "blurb", co.oneLine));

  // the site line — kind-aware (a wrapp SHIPS to a subdomain; a brand builds a landing page), and
  // honest about whether anything is actually live vs merely drafted locally.
  const kc = kindCfg(co);
  const site = el("div", "siteline");
  if (co.site && co.site.drafted) {
    site.append(el("span", "dot" + (co.site.live ? " on" : " draft")));
    site.append(el("span", "sitehost", co.site.host), el("span", "sitestate", co.site.busy ? "building…" : co.site.live ? "live" : "drafted"));
    const pv = el("button", "sitebtn", "Preview"); pv.onclick = () => { pane = { kind: "site" }; render(); };
    site.append(pv);
  } else {
    site.append(el("span", "dot"), el("span", "sitestate", co.site && co.site.busy ? "building…" : "no " + kc.deployNoun + " yet"));
    const build = el("button", "sitebtn", kc.deployVerb); build.onclick = () => void genSite(co);
    site.append(build);
  }
  idc.append(site);

  const kv = el("div", "kvs");
  kv.append(kvRow("Decisions yours", Object.values(co.decisions).filter((d) => d.chosenId).length + " of " + SPEC.length));
  if (kc.econ === "usage") {
    // a wrapp earns on the Spotify model: pro-sub pool → rev-share by usage. Both stay "not
    // connected" until a real usage meter reports — never a fabricated play count or payout.
    kv.append(kvRow("Uses MTD", co.metrics.uses == null ? "— not connected" : String(co.metrics.uses), co.metrics.uses == null));
    kv.append(kvRow("Est. rev-share", co.metrics.payout == null ? "— not connected" : "$" + co.metrics.payout, co.metrics.payout == null));
  } else {
    kv.append(kvRow("Revenue MTD", co.metrics.revenue == null ? "— not connected" : "$" + co.metrics.revenue, co.metrics.revenue == null));
    kv.append(kvRow("Traffic", co.metrics.traffic == null ? "— not connected" : String(co.metrics.traffic), co.metrics.traffic == null));
  }
  idc.append(kv);
  const fund = el("button", "fundbtn", "Fund runway");
  fund.onclick = () => { pane = { kind: "tokens" }; render(); };
  idc.append(fund);
  idc.append(el("div", "fundnote", "runway is capacity to work on your own Claude — not a subscription, no key ever leaves you"));
  c.append(idc);

  c.append(productCard(co));
  // the middle box, by kind: a physical venture shows the SUPPLY SPINE (the moat software can't
  // copy); a software venture shows the TOKEN GAME (fuel it with your own tokens, watch it level up).
  if (kindCfg(co).econ === "sales") { c.append(supplyCard(co)); c.append(morCard()); }
  else c.append(gameCard(co));

  const stillInherited = Object.entries(co.inherited || {}).filter(([k]) => !(co.overridden || []).includes(k));
  if (stillInherited.length) {
    const ic = el("div", "card");
    ic.append(cardTitle("Inherited", "not re-decided"));
    for (const [k, v] of stillInherited) {
      const flat = Array.isArray(v) ? v.join(", ") : String(v);
      if (!flat) continue;
      const r = el("div", "inh");
      r.append(el("span", "ik", k), el("span", "iv", flat.slice(0, 90)));
      ic.append(r);
    }
    ic.append(el("div", "fundnote", "came from the brandbrain / ideabrain context you lent — Autopilot doesn't ask again"));
    c.append(ic);
  }
  return c;
}

/** the offer + its money path, resolved by kind. A sales venture drafts a priced offer and connects
 *  payments; a WRAPP earns on usage — the wrapp itself is the product, revenue is the Spotify-style
 *  rev-share, and the gated move connects a usage meter instead of a checkout. */
function productCard(co) {
  const c = el("div", "card");
  const usage = kindCfg(co).econ === "usage";
  const p = co.product;
  if (usage) {
    // wrapp: the money path is rev-share, and the "product" IS the shipped wrapp — no separate offer.
    c.append(cardTitle("Rev-share", co.usageLive ? "meter on" : "the money path"));
    c.append(el("div", "prodblurb", "The wrapp earns like a song on Spotify: pro members pay one sub, and you're paid from the pool by how much your wrapp gets used — no charge to the visitor, who runs it on their own Claude."));
    if (co.usageLive) {
      c.append(el("div", "fundnote", "usage meter connected — the Uses / rev-share lines above fill only from real, metered usage"));
    } else {
      const b = el("button", "growbtn", "Connect usage meter");
      b.onclick = () => void runMove(co, { mode: "approve", lane: "usage", n: "Connect the usage meter for " + co.name, args: { host: co.site?.host } });
      c.append(b);
      c.append(el("div", "fundnote", "a gated move — needs a usage/analytics connector and your go. Nothing here is a made-up number."));
    }
    return c;
  }
  c.append(cardTitle("Product", p && p.live ? "payments on" : p && p.drafted ? "drafted" : "the money path"));
  if (p && p.drafted) {
    const box = el("div", "prod");
    const top = el("div", "prodtop");
    top.append(el("div", "prodname", p.name));
    if (p.price) top.append(el("div", "prodprice", "$" + p.price));
    box.append(top);
    if (p.blurb) box.append(el("div", "prodblurb", p.blurb));
    c.append(box);
    if (p.live) {
      c.append(el("div", "fundnote", "payments connected — the revenue line above fills only when a real sale lands"));
    } else {
      const b = el("button", "growbtn", "Set up payments");
      b.onclick = () => void runMove(co, { mode: "approve", lane: "payments", n: "Set up payments for " + p.name, args: { name: p.name, price: p.price } });
      c.append(b);
      c.append(el("div", "fundnote", "a gated move — needs a payments connector and your go. Autopilot never charges on its own."));
    }
  } else {
    c.append(el("div", "empty", "No product yet. Autopilot shapes one from your context and the angle you're running."));
    const b = el("button", "growbtn ghost", p && p.busy ? "shaping…" : "Draft a product");
    b.onclick = () => void genProduct(co);
    c.append(b);
  }
  return c;
}

/** THE SUPPLY SPINE (physical ventures) — the thing a software company can't copy. The STRUCTURE is
 *  real (pooled MOQ across brands → co-pack → fulfil → ship); the live inventory numbers stay "not
 *  connected" until a real fulfilment provider reports them, never faked. What makes "or twenty
 *  brands" cheap: your small run rides the platform's pooled minimum. */
function supplyCard(co) {
  const c = el("div", "card");
  c.append(cardTitle("Supply", "the spine software can't copy"));
  c.append(el("div", "supplynote", "We hold the supply. Your small run rides the platform's pooled minimum — so it gets a real run's price."));
  const stages = el("div", "spine");
  for (const [name, on] of [["Sourced", true], ["Co-pack", true], ["Fulfil", false], ["Ship", false]]) {
    const s = el("div", "spinestage" + (on ? " on" : ""));
    s.append(el("span", "sdot"), el("span", "sname", name));
    stages.append(s);
  }
  c.append(stages);
  // the pooled-MOQ value prop — the modeled fill of the shared run this venture joins
  const pool = el("div", "pool");
  const ph = el("div", "poolhead");
  ph.append(el("span", null, "Shared MOQ pool"), el("b", null, "modeled"));
  pool.append(ph);
  const bar = el("div", "poolbar"); const fill = el("i"); fill.style.width = "64%"; bar.append(fill); pool.append(bar);
  pool.append(el("div", "poolnote", "Pooled across brands on the platform — your run alone would miss the minimum. Shared spine → your price."));
  c.append(pool);
  const kv = el("div", "kvs");
  kv.append(kvRow("Fulfilment", "— connect a 3PL", true));
  kv.append(kvRow("On hand", "— not connected", true));
  c.append(kv);
  c.append(el("div", "fundnote", "The spine is real; live inventory fills in once you connect a fulfilment provider — never a made-up count."));
  return c;
}
/** MERCHANT OF RECORD — a structural property of a platform brand: Switchboard carries the boring,
 *  ops-killing burden (tax, returns, compliance) so a solo operator doesn't have to. */
function morCard() {
  const c = el("div", "card mor");
  const head = el("div", "morhead");
  head.append(el("span", "morshield", "◈"), el("span", null, "MERCHANT OF RECORD"));
  c.append(head);
  c.append(el("div", "morbody", "Switchboard is the entity of record — tax, returns and compliance sit with the platform. You own and direct the brand."));
  return c;
}

/** The milestone ladder a software venture climbs. Honest: the build milestones flip on real state
 *  (decided, shipped); the money milestones stay LOCKED ("needs a connector") until a real usage
 *  meter reports — never a fabricated user or dollar. */
function gameMilestones(co) {
  const decided = Object.values(co.decisions).filter((d) => d.chosenId || d.inherited).length;
  return [
    { label: "Company decided · " + decided + "/" + SPEC.length, done: decided >= SPEC.length },
    { label: co.site && co.site.live ? "Shipped · " + co.site.host : "Ship the wrapp" + (co.site && co.site.drafted ? " · drafted" : ""), done: !!(co.site && co.site.live), staged: !!(co.site && co.site.drafted) },
    { label: "First user", done: (co.metrics.uses || 0) > 0, locked: co.metrics.uses == null },
    { label: "First rev-share $", done: (co.metrics.payout || 0) > 0, locked: co.metrics.payout == null },
  ];
}
/** THE TOKEN GAME (software ventures) — fuel it with your own tokens, watch it level up. The fuel is
 *  real (the broker's token budget); the levels are real progress; the money wins stay honestly
 *  locked until a usage meter is wired. Feeding it opens the runway dial (Trickle / Steady / Push). */
function gameCard(co) {
  const c = el("div", "card game");
  const ms = gameMilestones(co);
  const level = ms.filter((m) => m.done).length;
  const NAMES = ["Seed", "Sprout", "Traction", "Scaling", "Live"];
  c.append(cardTitle("Grow", "level " + level + " · " + NAMES[Math.min(level, 4)]));
  c.append(el("div", "gamenote", "Feed it your own tokens and it builds itself toward launch — pour a trickle and it moves one beat at a time, pour a tank and it works ahead of you."));

  // fuel gauge — real token budget
  const fuel = el("div", "fuel");
  const fh = el("div", "fuelhead");
  fh.append(el("span", null, "⛽ Fuel · your tokens"), el("b", null, fmtTok(co.tokens.spent) + " / " + fmtTok(co.tokens.budget)));
  fuel.append(fh);
  const bar = el("div", "fuelbar"); const i = el("i"); i.style.width = Math.min(100, (co.tokens.spent / co.tokens.budget) * 100) + "%"; bar.append(i); fuel.append(bar);
  c.append(fuel);
  const feed = el("button", "growbtn", "⛽ Feed it more fuel");
  feed.onclick = () => { pane = { kind: "tokens" }; render(); };
  c.append(feed);

  // milestone ladder — the game board
  const ladder = el("div", "ladder");
  for (const m of ms) {
    const r = el("div", "mile" + (m.done ? " done" : m.staged ? " staged" : m.locked ? " locked" : ""));
    r.append(el("span", "mdot", m.done ? "✓" : ""), el("span", "mlab", m.label));
    if (m.locked) r.append(el("span", "mtag", "needs a meter"));
    else if (m.staged) r.append(el("span", "mtag", "staged"));
    ladder.append(r);
  }
  c.append(ladder);
  c.append(el("div", "fundnote", "The money wins light up only from a real usage meter — never a made-up user or dollar."));
  return c;
}

// ---- COLUMN 2 · OPERATIONS — the live log, the task list, and the decision slate --------------
function opsCol(co) {
  const c = el("div", "col");
  c.append(el("div", "chead", "OPERATIONS"));

  // live operating log
  const lc = el("div", "card");
  lc.append(cardTitle("Live operating log", drafting.has(co.id) ? "working…" : "this company"));
  if (!co.log.length) lc.append(el("div", "empty", "Nothing yet."));
  for (const l of co.log.slice(0, 9)) {
    const r = el("div", "l" + (l.s === "run" ? " run" : ""));
    r.append(el("span", "g", l.s === "run" ? "⟳" : "✓"), el("span", null, l.t), el("time", null, l.at));
    lc.append(r);
  }
  c.append(lc);

  // tasks — a mini-list here; the full board (status tabs + run now) opens in the pane
  const tc = el("div", "card");
  const tasks = tasksFor(co);
  const th = el("div", "cthead");
  th.append(cardTitle("Tasks", tasks.filter((t) => t.status === "staged").length + " staged"));
  const manage = el("button", "taskmanage", "Manage →"); manage.onclick = () => { pane = { kind: "tasks" }; render(); };
  th.append(manage);
  tc.append(th);
  for (const t of tasks.slice(0, 5)) tc.append(taskRow(co, t));
  c.append(tc);

  c.append(docsCard(co));

  // the decision slate — HARNESS CONTRACT: decision rows are `.card .row` carrying "N options" /
  // "Inherited". The runner asserts the cold-open slate rendered by counting exactly these.
  const dc = el("div", "card");
  dc.append(cardTitle("The slate", drafting.has(co.id) ? "drafting…" : "choose any"));
  for (const s of SPEC) dc.append(decRow(co, co.decisions[s.id]));
  c.append(dc);
  return c;
}
function taskRow(co, t) {
  const r = el("div", "task");
  r.append(el("span", "tstate s-" + t.status));
  const mid = el("div", "tmid");
  mid.append(el("div", "ttitle", t.title));
  if (t.err) mid.append(el("div", "tdetail err", t.err));
  else if (t.detail) mid.append(el("div", "tdetail", t.detail));
  r.append(mid);
  // Run now on anything runnable; staged sends say "Go"; running spins; done/recurring just tag.
  if (t.status === "running") r.append(el("span", "ttag", "running…"));
  else if (t.act && t.status !== "recurring") {
    const b = el("button", "tgo" + (t.status === "staged" ? " go" : ""), t.status === "staged" ? "Go" : "Run now");
    b.onclick = (e) => { e.stopPropagation(); void runTask(co, t); };
    r.append(b);
  } else {
    r.append(el("span", "ttag", t.status));
  }
  return r;
}
/** THE TASKS BOARD — Acoco's Tasks modal: status tabs, every task with Run now. Pure function of
 *  state; the clone works the same list Autopilot does. */
let taskTab = "pending";
function tasksPane(body, co) {
  body.append(el("h3", "ptitle", "Tasks"));
  const live = tasksFor(co), done = tasksDone(co);
  const groups = {
    pending: live.filter((t) => t.status === "pending" || t.status === "running"),
    staged: live.filter((t) => t.status === "staged"),
    recurring: live.filter((t) => t.status === "recurring"),
    done: done,
    failed: live.filter((t) => t.status === "failed"),
  };
  const tabs = el("div", "ttabs");
  for (const [k, label] of [["pending", "Pending"], ["staged", "Staged"], ["recurring", "Recurring"], ["done", "Done"], ["failed", "Failed"]]) {
    const n = groups[k].length; if (k === "failed" && !n) continue;
    const b = el("button", "ttab" + (taskTab === k ? " on" : ""));
    b.append(el("span", null, label)); if (n) b.append(el("span", "tcount", String(n)));
    b.onclick = () => { taskTab = k; render(); };
    tabs.append(b);
  }
  body.append(tabs);
  const list = groups[taskTab] || [];
  if (!list.length) { body.append(el("div", "empty", "Nothing here.")); return; }
  for (const t of list) {
    const card = el("div", "taskcard");
    const top = el("div", "taskcardtop");
    top.append(el("div", "ttitle", t.title));
    if (t.act && t.status !== "recurring" && t.status !== "done") {
      const b = el("button", "tgo" + (t.status === "staged" ? " go" : ""), t.status === "running" ? "running…" : t.status === "staged" ? "Go →" : "Run now");
      if (t.status !== "running") b.onclick = () => void runTask(co, t);
      top.append(b);
    } else { top.append(el("span", "ttag", t.status)); }
    card.append(top);
    if (t.detail) card.append(el("div", "tdetail" + (t.status === "failed" ? " err" : ""), t.err || t.detail));
    body.append(card);
  }
}

// ---- DOCUMENTS — every real artifact the company produced, in one place (Acoco's Documents). Pure
// function of state: the CEO's briefing log, the site copy, the product brief, each social post and
// outreach draft. Nothing invented — if it's listed, the clone actually made it. -----------------
function docsFor(co) {
  const D = [];
  const ceo = (co.chat || []).filter((m) => m.who === "ceo");
  if (ceo.length) D.push({ id: "briefing", title: "Briefing log", tag: "DAILY", body: ceo.map((m) => m.at + " — " + m.text).join("\n\n") });
  if (co.site && co.site.drafted) D.push({ id: "site", title: kindCfg(co).econ === "usage" ? "The wrapp" : "Landing page", tag: "ARTIFACT", site: true });
  if (co.product && co.product.drafted) D.push({ id: "product", title: "Product brief", tag: "ARTIFACT", body: co.product.name + (co.product.price ? " · $" + co.product.price : "") + "\n\n" + (co.product.blurb || "") });
  (co.posts || []).forEach((p, i) => D.push({ id: "post-" + p.id, title: "Social post " + (i + 1), tag: "ARTIFACT", body: p.text }));
  (co.inbox || []).forEach((m) => D.push({ id: "mail-" + m.id, title: m.subject || "Outreach", tag: "ARTIFACT", body: "To: " + m.to + "\n\n" + m.body }));
  return D;
}
function docsCard(co) {
  const docs = docsFor(co);
  const c = el("div", "card");
  const h = el("div", "cthead");
  h.append(cardTitle("Documents", docs.length ? docs.length + " artifacts" : "none yet"));
  if (docs.length > 4) { const v = el("button", "taskmanage", "View all →"); v.onclick = () => { pane = { kind: "docs" }; render(); }; h.append(v); }
  c.append(h);
  if (!docs.length) { c.append(el("div", "empty", "The clone's artifacts land here as it works — briefings, the site, posts, outreach.")); return c; }
  for (const d of docs.slice(0, 4)) c.append(docRow(co, d));
  return c;
}
function docRow(co, d) {
  const r = el("button", "docrow");
  r.append(el("span", "docname", d.title), el("span", "doctag", d.tag));
  r.onclick = () => { if (d.site) pane = { kind: "site" }; else pane = { kind: "doc", docId: d.id }; render(); };
  return r;
}
function docsPane(body, co) {
  body.append(el("h3", "ptitle", "Documents"));
  const docs = docsFor(co);
  if (!docs.length) { body.append(el("div", "empty", "Nothing yet.")); return; }
  for (const d of docs) body.append(docRow(co, d));
}
function docPane(body, co) {
  const d = docsFor(co).find((x) => x.id === (pane.docId));
  if (!d) { body.append(el("div", "empty", "Not found.")); return; }
  body.append(el("h3", "ptitle", d.title));
  body.append(el("div", "kicker", d.tag + " · drafted by the clone"));
  body.append(el("pre", "doctext", d.body || ""));
}

// ---- COLUMN 3 · GROWTH — ads / distribution, social, and the inbox ---------------------------
function growthCol(co) {
  const c = el("div", "col");
  c.append(el("div", "chead", "GROWTH"));

  // ads / the run move
  const angle = optOf(co.decisions.angle) || shownOf(co.decisions.angle);
  const runMoveObj = movesFor(co).find((m) => m.id === "run");
  const ac = el("div", "card");
  ac.append(cardTitle("Ads", angle ? "ready" : "choose an angle"));
  if (angle) {
    const ad = el("div", "adprev");
    ad.append(el("div", "adkick", "SAMPLE AD · " + co.name));
    ad.append(el("div", "adhead", angle.text || angle.label));
    if (angle.body) ad.append(el("div", "adbody", angle.body));
    if (angle.cta) ad.append(el("span", "adcta", angle.cta));
    ac.append(ad);
    if (runMoveObj) { const b = el("button", "growbtn", "Set up ads"); b.onclick = () => void runMove(co, runMoveObj); ac.append(b); }
  } else {
    ac.append(el("div", "empty", "Pick an ad angle in the slate and a preview appears here."));
  }
  c.append(ac);

  // social
  const sc = el("div", "card");
  const at = el("div", "cthead");
  at.append(cardTitle("Social", co.posts.length ? co.posts.length + " drafts" : "none yet"));
  const tog = el("button", "toggle" + (co.autotweet ? " on" : ""), co.autotweet ? "Auto-post: on" : "Auto-post: off");
  tog.onclick = async () => { co.autotweet = !co.autotweet; await saveCo(co); render(); };
  sc.append(at, tog);
  const draftBtn = el("button", "growbtn ghost", "Draft a post");
  draftBtn.onclick = () => void genPost(co, { lane: "social" });
  sc.append(draftBtn);
  for (const p of co.posts.slice(0, 4)) {
    const pr = el("div", "post");
    pr.append(el("div", "ptext", p.text));
    const foot = el("div", "pfoot");
    foot.append(el("span", "ptag s-" + p.state, p.state));
    if (p.state !== "posted") { const send = el("button", "psend", "Post"); send.onclick = () => void runMove(co, { mode: "approve", lane: "social", n: "Post to social", postId: p.id, args: { text: p.text } }); foot.append(send); }
    pr.append(foot);
    sc.append(pr);
  }
  c.append(sc);

  // inbox
  const ic = el("div", "card");
  ic.append(cardTitle("Inbox", co.inbox.length ? co.inbox.length + " drafts" : "outreach"));
  const outBtn = el("button", "growbtn ghost", "Draft outreach");
  outBtn.onclick = () => void genOutreach(co, { lane: "inbox" });
  ic.append(outBtn);
  for (const m of co.inbox.slice(0, 3)) {
    const mr = el("div", "mail");
    mr.append(el("div", "msubj", m.subject));
    mr.append(el("div", "mto", "to " + m.to));
    mr.append(el("div", "mbody", m.body.slice(0, 140)));
    const foot = el("div", "pfoot");
    foot.append(el("span", "ptag s-" + m.state, m.state));
    if (m.state !== "sent") { const send = el("button", "psend", "Send"); send.onclick = () => void runMove(co, { mode: "approve", lane: "inbox", n: "Send outreach", mailId: m.id, args: { subject: m.subject, body: m.body } }); foot.append(send); }
    mr.append(foot);
    ic.append(mr);
  }
  c.append(ic);
  return c;
}

// ---- COLUMN 4 · STRATEGY — your CEO. A grounded persona that reviews the board and answers you --
function strategyCol(co) {
  const c = el("div", "col");
  c.append(el("div", "chead", "STRATEGY"));
  const cc = el("div", "card chatcard");
  const head = el("div", "chathead");
  const badge = el("div", "ceobadge", co.glyph); badge.style.background = co.color; badge.style.color = co.ink;
  head.append(badge, el("div", "ceoname", "Your CEO"), el("div", "ceosub", "runs " + co.name));
  cc.append(head);

  const thread = el("div", "thread");
  if (!co.chat.length) thread.append(el("div", "empty", "Ask your CEO what to do next — or type /plan, /post, /outreach, /ship."));
  for (const m of co.chat.slice(-12)) {
    const b = el("div", "msg " + (m.who === "you" ? "me" : "ceo"));
    b.append(el("div", "mbub", m.text), el("time", null, m.at));
    thread.append(b);
  }
  cc.append(thread);

  const row = el("div", "chatrow");
  const input = el("input"); input.placeholder = "Message your CEO, or / for commands";
  const send = async () => { const v = input.value.trim(); if (!v) return; input.value = ""; await ceoCommand(co, v); const th = document.querySelector(".thread"); if (th) th.scrollTop = th.scrollHeight; };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void send(); });
  const btn = el("button", "chatsend", "→"); btn.onclick = () => void send();
  row.append(input, btn);
  cc.append(row);
  c.append(cc);
  return c;
}
/** Chat input dispatch — slash commands drive the OS, everything else is a message to the CEO. */
async function ceoCommand(co, text) {
  const cmd = text.toLowerCase();
  if (cmd === "/post") return genPost(co, { lane: "social" });
  if (cmd === "/outreach") return genOutreach(co, { lane: "inbox" });
  if (cmd === "/ship") { const m = movesFor(co).find((x) => x.mode === "approve"); if (m) return runMove(co, m); toast("Nothing staged to ship — choose an angle and a channel first."); return; }
  if (cmd === "/plan") return ceoSay(co, "Review the board and tell me the 3 highest-leverage moves for today.");
  return ceoSay(co, text);
}

function cardTitle(t, more) {
  const d = el("div", "ct");
  d.append(el("span", null, t));
  if (more) d.append(el("span", "more", more));
  return d;
}
function kvRow(k, v, na) {
  const r = el("div", "kv");
  r.append(el("span", null, k), el("b", na ? "na" : null, v));
  return r;
}
const stateTag = (d) => d.inherited ? ["t-inh", "Inherited"]
  : d.chosenId ? ["t-done", "Yours"]
  : d.stale ? ["t-run", "Restreamed"]
  : d.busy ? ["t-run", "Drafting"]
  : d.options.length ? ["t-pend", "Drafted"] : ["t-pend", "—"];

function decRow(co, d) {
  const o = shownOf(d);
  const b = el("button", "row");
  b.append(el("div", "rname", d.label + (o ? " · " + o.label : d.inherited ? " · " + d.inherited.value.slice(0, 40) : "")));
  const meta = el("div", "rmeta");
  const [cls, txt] = stateTag(d);
  meta.append(el("span", "tag " + cls, txt));
  meta.append(el("span", null, d.error ? d.error
    : d.busy ? "drafting…"
    : d.inherited ? "from " + d.inherited.from
    : d.chosenId ? "locked " + d.chosenAt
    : d.options.length + " options"));
  b.append(meta);
  b.onclick = () => { pane = { kind: d.id }; render(); };
  return b;
}

// ---- the pane --------------------------------------------------------------------------------
function renderPane(co) {
  let host = $("pane");
  if (!host) { host = el("aside"); host.id = "pane"; document.body.append(host); }
  host.textContent = "";
  host.classList.toggle("open", !!pane);
  if (!pane || !co) return;

  const head = el("div", "phead");
  const isTok = pane.kind === "tokens";
  const isSite = pane.kind === "site";
  const isConn = pane.kind === "connectors";
  const isTasks = pane.kind === "tasks";
  const isDocs = pane.kind === "docs" || pane.kind === "doc";
  const d = isTok || isSite || isConn || isTasks || isDocs ? null : co.decisions[pane.kind];
  head.append(el("div", "pkind", isTok ? "RUNWAY" : isSite ? "THE SITE" : isConn ? "CONNECTORS" : isTasks ? "TASKS" : isDocs ? "DOCUMENTS" : (d ? d.axis : "")));
  const close = el("button", "pclose", "✕");
  close.onclick = () => { pane = null; render(); };
  head.append(close);
  host.append(head);

  const body = el("div", "pbody");
  host.append(body);
  if (isTok) { tokensPane(body, co); return; }
  if (isSite) { sitePane(body, co); return; }
  if (isConn) { connectorsPane(body); return; }
  if (isTasks) { tasksPane(body, co); return; }
  if (pane.kind === "docs") { docsPane(body, co); return; }
  if (pane.kind === "doc") { docPane(body, co); return; }
  if (!d) return;
  slate(body, co, d);
}

/* THE SITE — a real page, generated from the company and previewed locally. Publishing is a gated
   approve-class move; until then nothing is public. */
function sitePane(body, co) {
  body.append(el("h3", "ptitle", co.name + " — the site"));
  if (!co.site || !co.site.html) {
    body.append(el("div", "empty", "No site drafted yet. Autopilot builds it from your context and the angle you're running."));
    const b = el("button", "growbtn", "Build it now"); b.onclick = () => void genSite(co);
    body.append(b);
    return;
  }
  body.append(el("div", "kicker", co.site.host + " · " + (co.site.live ? "live" : "drafted locally — not public")));
  const frame = el("iframe", "siteframe"); frame.setAttribute("sandbox", ""); frame.setAttribute("title", co.name + " preview"); frame.srcdoc = co.site.html;
  body.append(frame);
  if (co.site.live) {
    body.append(el("div", "picknote", "published " + (co.site.at || "") + " · " + (co.site.url || "https://" + co.site.host)));
  } else {
    const pub = el("button", "growbtn", "Publish — make it live");
    pub.onclick = () => void runMove(co, { mode: "approve", lane: "site", n: "Publish " + co.site.host, args: { host: co.site.host, html: co.site.html } });
    body.append(pub);
    body.append(el("div", "fundnote", "Preview is local. Publishing is a gated move — it needs a deploy connector and your go; nothing is public until then."));
  }
  const re = el("button", "act", "↺ rebuild the page"); re.onclick = () => void genSite(co);
  body.append(re);
}

/* THE SLATE — options you can actually choose, a lock that records who chose it, alternatives
   that survive, and a working escape hatch. */
function slate(body, co, d) {
  body.append(el("h3", "ptitle", d.label));

  if (d.inherited) {
    const box = el("div", "inhbox");
    box.append(el("div", "kicker", "inherited from " + d.inherited.from));
    box.append(el("div", "inhval", d.inherited.value));
    box.append(el("div", "fundnote", "This came with the context you lent. Autopilot treats it as settled and writes everything downstream to match."));
    const take = el("button", "act", "decide it here instead");
    take.onclick = async () => {
      // Record the override. Without this the COMPANY column keeps advertising the lent value as
      // "inherited · not re-decided" while THE SLATE shows the one you just picked — two different
      // voices on one screen, and the model still gets told the stale one as grounding.
      const key = SPEC_BY_ID[d.id]?.inherit;
      if (key) co.overridden = [...new Set([...(co.overridden || []), key])];
      d.inherited = null;
      await saveCo(co); render();
      await genOptions(co, d.id, "draft"); await saveCo(co); render();
    };
    box.append(take);
    body.append(box);
    return;
  }

  if (d.stale) body.append(el("div", "stalenote", "● restreamed — an upstream decision changed, so these were rewritten"));
  if (d.busy) body.append(researching("drafting options…"));
  if (d.error) {
    body.append(el("div", "err", d.error));
    const again = el("button", "act", "try again");
    again.onclick = async () => { await genOptions(co, d.id, "draft"); await saveCo(co); render(); };
    body.append(again);
  }

  for (const o of d.options) body.append(optionCard(co, d, o));

  // the escape hatch
  const hatch = el("div", "optrow own");
  hatch.append(el("div", "on2", "none of these — say what you'd do instead"));
  hatch.append(el("div", "op", "it becomes a real option, indistinguishable from the drafted ones."));
  const row = el("div", "hatchrow");
  const input = el("input"); input.placeholder = "describe what you'd do…";
  const go = async () => { const v = input.value.trim(); if (!v) return; input.value = ""; await ownOption(co, d, v); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void go(); });
  const btn = el("button", "hatchgo", "use this"); btn.onclick = () => void go();
  row.append(input, btn);
  hatch.append(row);
  body.append(hatch);

  if (d.chosenId) {
    body.append(el("div", "sec", "YOUR PICK"));
    body.append(el("div", "picknote", "locked at " + d.chosenAt + " · by you"));
    const un = el("button", "unbtn", "unlock — go back to drafted");
    un.onclick = () => void unchoose(co, d);
    body.append(un);
  }
  if (!d.busy && d.options.length) {
    const re = el("button", "act", "↺ redraft these");
    re.onclick = async () => { await genOptions(co, d.id, "draft"); await saveCo(co); render(); };
    body.append(re);
  }
}

function optionCard(co, d, o) {
  const chosen = isChosen(d, o), drafted = isDrafted(d, o);
  const card = el("button", "optrow" + (chosen ? " chosen" : "") + (drafted ? " drafted" : ""));
  if (o.rec && !chosen) card.append(el("span", "rec draft", "RECOMMENDED"));
  if (chosen) card.append(el("span", "rec live", "✓ CHOSEN BY YOU"));
  card.append(el("div", "ol", o.label));
  if (o.text) card.append(el("div", "on2", o.text));
  if (o.body) card.append(el("div", "op", o.body));
  if (o.cta) card.append(el("div", "octa", o.cta));
  if (o.lines && o.lines.length) {
    const w = el("div", "olines");
    for (const l of o.lines) w.append(el("div", "oline", "“" + l + "”"));
    card.append(w);
  }
  if (drafted) card.append(el("div", "draftnote", "drafted by autopilot · tap to make it yours"));
  card.onclick = () => void choose(co, d, o.id);
  return card;
}

const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);

function tokenMeter(co) {
  const w = el("div", "tokmeter");
  if (!co) return w;
  const tl = el("div", "tl");
  tl.append(el("span", null, "TOKENS THIS WEEK"), el("b", null, fmtTok(co.tokens.spent) + " / " + fmtTok(co.tokens.budget)));
  w.append(tl);
  const bar = el("div", "tokbar");
  const areas = [["draft", "#C8F250"], ["restream", "#E9954A"]];
  for (const [k, col] of areas) {
    const pct = ((co.tokens.by[k] || 0) / co.tokens.budget) * 100;
    if (pct > 0.2) { const i = el("i"); i.style.width = Math.min(100, pct) + "%"; i.style.background = col; bar.append(i); }
  }
  w.append(bar);
  w.onclick = () => { pane = { kind: "tokens" }; render(); };
  return w;
}

function tokensPane(body, co) {
  const big = el("div", "tokbig");
  big.append(el("div", "tokn", fmtTok(co.tokens.spent)));
  big.append(el("div", "toklab", "tokens spent · " + fmtTok(co.tokens.budget) + " budgeted this week"));
  body.append(big);

  body.append(el("div", "sec", "WHERE THEY WENT"));
  for (const [k, n, col] of [["draft", "Drafting the slate", "#C8F250"], ["restream", "Rewriting downstream", "#E9954A"]]) {
    const r = el("div", "tokrow");
    const tk = el("span", "tk"); tk.style.background = col;
    r.append(tk, el("span", "tn", n), el("span", "tv", fmtTok(co.tokens.by[k] || 0)));
    body.append(r);
  }

  body.append(el("div", "sec", "FEED IT MORE"));
  const tiers = el("div", "tiers");
  for (const [n, v, note] of [
    ["Trickle", 500_000, "keeps one thing moving at a time"],
    ["Steady", 2_000_000, "a full week of drafting and revising"],
    ["Push", 5_000_000, "it works ahead of you — expect more staged than you can read"],
  ]) {
    const t = el("div", "tier" + (v === co.tokens.budget ? " on" : ""));
    t.append(el("span", "tl", n), el("span", "ta", fmtTok(v) + "/wk"), el("span", "tp", note));
    t.onclick = async () => { co.tokens.budget = v; await saveCo(co); render(); };
    tiers.append(t);
  }
  body.append(tiers);

  body.append(el("div", "honest",
    "You are not buying a subscription. A token budget is capacity to work — it runs as fast as you feed it, and stops when you stop."));
  body.append(el("div", "honest ember",
    co.tokens.estimated
      ? "● Some of these are ESTIMATES. Your backend didn't report usage for every call, so those were counted at ~4 characters per token and marked rather than quietly rounded."
      : "● Tokens are the only real number here. They come from the broker's own usage counts. Revenue needs a connected store, so it says “not connected” rather than drawing a chart of numbers that don't exist."));
}



document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pane) { pane = null; render(); } });

render();
