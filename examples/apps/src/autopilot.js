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

function newCompany(cfg) {
  const co = {
    id: cfg.id, name: cfg.name, kind: cfg.kind || "company", kindLabel: (cfg.kindLabel || cfg.kind || "COMPANY").toUpperCase(),
    oneLine: cfg.oneLine || "", ctxId: cfg.ctxId || null, ctxName: cfg.ctxName || null,
    inherited: cfg.inherited || {},
    glyph: (cfg.name || "?").trim().charAt(0).toUpperCase(),
    color: PALETTE[Math.abs(hashOf(cfg.id)) % PALETTE.length], ink: "#EAF2E4",
    tokens: { spent: 0, budget: 2_000_000, by: {}, estimated: false },
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
    kind: brand.kind || "company",
    kindLabel: brand.kind === "idea" ? "IDEA" : brand.kind === "project" ? "PROJECT" : "BRAND",
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

async function seedFromLine(line) {
  // "Kettle — a cold-brew subscription for offices" is a NAME and a description, not a 45-character
  // name. Split on the first dash/colon/pipe so the tab reads "Kettle" and the blurb carries the rest.
  const m = line.match(/^\s*([^\u2014\u2013\-:|]{2,40}?)\s*[\u2014\u2013\-:|]\s*(.+)$/);
  const name = (m ? m[1] : line).trim().slice(0, 40);
  const oneLine = (m ? m[2] : line).trim();
  const co = newCompany({ id: slugOf(name) + "-" + uid().slice(0, 4), name, oneLine });
  cos.push(co); activeId = co.id; creating = false;
  logLine(co, "seeded from one line", "done", null);
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

// ---- staged moves: derived from the decisions, never invented -------------------------------
function movesFor(co) {
  const out = [];
  const angle = optOf(co.decisions.angle);
  const channel = optOf(co.decisions.channel);
  const next = optOf(co.decisions.next);
  // Which field carries the human-readable NAME differs by decision, so this can't be one helper:
  // for angle/channel `label` is the name and `text` is the rationale ("Paid search" vs "they
  // search the problem by name…"), while for `next` the move itself lives in `text`. Both fall
  // back the other way, because a human-written option (the escape hatch) puts its whole wording
  // in `label` and leaves `text` empty.
  const named = (o) => (o.label || o.text || "").trim();
  const stated = (o) => (o.text || o.label || "").trim();
  if (angle) out.push({ n: "Draft the creative for “" + named(angle) + "”", mode: "auto" });
  if (angle && channel) out.push({ n: "Run it on " + named(channel), mode: "approve" });
  if (next) out.push({ n: stated(next), mode: "manual" });
  return out;
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

  view.append(cockpit(co));
  renderPane(co);
}

function startBox() {
  const box = el("div", "start");
  if (brand) box.append(el("div", "ctx", "ready to pick up your lent context — " + brand.name));
  const row = el("div", "bindrow");
  const input = el("input");
  input.placeholder = "one line — what is the company?";
  const go = () => { const v = input.value.trim(); if (v) void seedFromLine(v); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  const btn = el("button", "primary", brand ? "Pick it up" : "Start it");
  btn.onclick = () => { if (brand && !input.value.trim()) void seedFromContext(); else go(); };
  row.append(input, btn);
  box.append(row);
  box.append(el("div", "hint", brand
    ? "Lend a different context in the Switchboard panel and it picks that up instead."
    : "Or lend Autopilot a brand, project or idea in the Switchboard panel — it drafts the whole slate with no input at all."));
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
  top.append(tabs, tokenMeter(co));
  wrap.append(top);

  if (!co) return wrap;

  const grid = el("div", "grid");

  // ---- COMPANY
  const c1 = el("div", "col");
  c1.append(el("div", "chead", "COMPANY"));
  const idc = el("div", "card");
  const idrow = el("div", "idrow");
  const logo = el("div", "idlogo", co.glyph); logo.style.background = co.color; logo.style.color = co.ink;
  const who = el("div");
  who.append(el("h3", null, co.name));
  who.append(el("div", "ck", co.kindLabel + (co.ctxName ? " · lent from " + co.ctxName : "")));
  idrow.append(logo, who);
  idc.append(idrow);
  if (co.oneLine) idc.append(el("p", "blurb", co.oneLine));
  const kv = el("div", "kvs");
  kv.append(kvRow("Decisions yours", Object.values(co.decisions).filter((d) => d.chosenId).length + " of " + SPEC.length));
  kv.append(kvRow("Revenue", "— not connected", true));
  idc.append(kv);
  const fund = el("button", "fundbtn", "Feed it tokens");
  fund.onclick = () => { pane = { kind: "tokens" }; render(); };
  idc.append(fund);
  idc.append(el("div", "fundnote", "tokens are capacity to work — not a subscription"));
  c1.append(idc);

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
    ic.append(el("div", "fundnote", "came from the lent context — Autopilot doesn't ask again"));
    c1.append(ic);
  }
  grid.append(c1);

  // ---- THE SLATE
  const c2 = el("div", "col");
  c2.append(el("div", "chead", "THE SLATE"));
  const dc = el("div", "card");
  // `drafting` is a Set now — a bare truthiness test is always true and pinned this to "drafting…"
  dc.append(cardTitle("Decisions", drafting.has(co.id) ? "drafting…" : "choose any"));
  for (const s of SPEC) dc.append(decRow(co, co.decisions[s.id]));
  c2.append(dc);
  grid.append(c2);

  // ---- STAGED + LOG
  const c3 = el("div", "col");
  c3.append(el("div", "chead", "STAGED"));
  const mc = el("div", "card");
  const moves = movesFor(co);
  mc.append(cardTitle("Moves", moves.length ? moves.filter((m) => m.mode === "approve").length + " need you" : "choose first"));
  if (!moves.length) mc.append(el("div", "empty", "Choose an angle and a channel — the moves they imply appear here."));
  for (const m of moves) {
    const r = el("div", "row static");
    r.append(el("div", "rname", m.n));
    const meta = el("div", "rmeta");
    meta.append(el("span", "tag t-" + m.mode, MODES[m.mode].tag), el("span", null, MODES[m.mode].note));
    r.append(meta);
    mc.append(r);
  }
  mc.append(el("div", "fundnote", "nothing here has happened — Autopilot stages, you decide"));
  c3.append(mc);

  const lc = el("div", "card");
  lc.append(cardTitle("Log", "this company"));
  if (!co.log.length) lc.append(el("div", "empty", "Nothing yet."));
  for (const l of co.log.slice(0, 8)) {
    const r = el("div", "l" + (l.s === "run" ? " run" : ""));
    r.append(el("span", "g", l.s === "run" ? "⟳" : "✓"), el("span", null, l.t), el("time", null, l.at));
    lc.append(r);
  }
  c3.append(lc);
  grid.append(c3);

  wrap.append(grid);
  return wrap;
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
  const d = isTok ? null : co.decisions[pane.kind];
  head.append(el("div", "pkind", isTok ? "TOKENS" : (d ? d.axis : "")));
  const close = el("button", "pclose", "✕");
  close.onclick = () => { pane = null; render(); };
  head.append(close);
  host.append(head);

  const body = el("div", "pbody");
  host.append(body);
  if (isTok) { tokensPane(body, co); return; }
  if (!d) return;
  slate(body, co, d);
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
