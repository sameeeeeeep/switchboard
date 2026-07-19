// Cast — an AI-persona studio, rebuilt as a GATED PRODUCTION PIPELINE (brandbrain's shape). An
// account isn't filled in one screen; it's walked through six stages — Reference → Foundation →
// Base assets → Calendar → Scripts → Produce — and at every step the model proposes options and the
// human locks/approves before anything advances. Cast holds no model and no data of its own: each
// Account lives in the user's own claude_storage, the locked persona is published as a shareable
// CONTEXT, and every render + research call runs on the user's Claude + Higgsfield. Without
// Switchboard it boots a self-contained DEMO (a fully seeded account) so the pipeline is explorable.
//
// This file is only the SHELL: connect lifecycle, the account rail, the stepper, and the stage host.
// All flow logic lives in cast/spec.js (the pipeline), cast/state.js (the Account + locks + gates),
// cast/gen.js (generation) and cast/stages.js (the six renderers).
import { mountConnect, whenRelayReady } from "@relay/sdk";
import { STAGE_IDS } from "./cast/spec.js";
import { blankAccount, loadAccounts, persist, migrate, reachableStage, newId, personaName, safeParse } from "./cast/state.js";
import { renderStage, groundInBackground } from "./cast/stages.js";
import { $, el, clear, renderStepper } from "./cast/ui.js";
import { svgTile } from "./cast/gen.js";
import { harnessRelay } from "./cast/harness.js";

const state = { relay: null, mock: false, caps: null, brand: null, accounts: [], current: null, loading: new Set() };

// ?harness — boot the LIVE harness relay: Cast's real generation path (mock=false) backed by real
// Higgsfield assets, so a reel actually renders inside Cast without the browser extension present.
// When set, it is AUTHORITATIVE: a live Switchboard connection must NOT clobber the seeded demo, or
// the Nadia example would flash and then get replaced by a blank real account.
const HARNESS = new URLSearchParams(location.search).has("harness");
// ?fresh — boot the DEMO with EMPTY storage (no seeded Maya): exercises the context-first path a
// brand-new user hits live — a lent brand + zero accounts → auto-start straight into Foundation.
const FRESH = new URLSearchParams(location.search).has("fresh");

// ---------- connect ----------
// NOTE contextKinds: pre-existing grants are exact-match and will NOT gain the row on reconnect —
// loadBrand tolerates list()/use() failing and degrades to active()-only silently.
mountConnect($("sbchip"), {
  scope: { reason: "Cast — build AI personas and produce on-model content, stage by stage", tools: ["mcp__claude_ai_Higgsfield__*", "WebSearch", "WebFetch"], contextKinds: ["brand", "persona"] },
  onConnect: (r) => { if (!HARNESS) boot(r, false); },
  onDisconnect: () => {
    // The old relay is dead — a generation against it would just burn into an empty state. Keep the
    // studio visible but unpower it, and say so; the stage guards short-circuit on relay==null.
    if (HARNESS || state.mock || !state.relay) return;
    state.relay = null;
    setConnBanner(true);
  },
  onProjectChange: () => { if (!HARNESS) loadBrand(); },
});
if (HARNESS) boot(harnessRelay(), false);
else whenRelayReady(1800).then((r) => { if (!("connect" in r) && !state.relay) boot(mockRelay(), true); });

async function boot(relay, mock) {
  state.relay = relay; state.mock = mock;
  setConnBanner(false);
  state.caps = await (relay.capabilities ? relay.capabilities().catch(() => null) : null);
  $("hero").hidden = true; $("app").hidden = false;
  await loadBrand();
  state.accounts = await loadAccounts(relay);
  // Context-first: a brand is already lent (or banked) and there's no account yet → don't show a
  // blank entry asking for input Cast already has. Derive the brief from the brand, lock it, and
  // land in Foundation where autopilot streams the persona directions in with ★ auto-locked.
  if (!state.accounts.length) {
    if (state.brand) autoStart();
    else newAccount();
  } else selectAccount(state.accounts[0].id);
}

// First-run with a lent brand: the ONE thing Cast needs is the brand — so that IS the entry.
function autoStart() {
  newAccount(); // adopts state.brand onto the fresh account
  const a = state.current, b = state.brand, d = b.data || {};
  const pos = d.positioning || d.tagline || "";
  a.reference = {
    brief: `an independent creator making content for ${b.name}${pos ? " — " + pos : ""}`,
    niche: d.niche || d.category || "",
    moodNotes: "",
    inspirations: [],
    locked: true,
  };
  save();
  go("foundation");
  // background research refines niche/mood off the derived brief — never blocks the board
  groundInBackground({ account: a, relay: state.relay, mock: state.mock, caps: state.caps, save: () => save(a), rerender: renderActiveStage });
}

// The lent brand context. On boot / project change we read whatever the user has lent Cast via
// Switchboard (context.active); with nothing lent, we auto-select the first banked brand from the
// library (needs the contextKinds consent row — reused grants won't carry it, so this degrades
// silently). If the current account has no brand yet, adopt the found one.
async function loadBrand() {
  try { state.brand = state.relay ? await state.relay.context.active() : null; } catch { state.brand = null; }
  if (!state.brand && state.relay && !state.mock) {
    try {
      const metas = await state.relay.context.list();
      // accept a persona lent by Identity as well as a brand — a persona carries palette/positioning
      // so it fills the brand slot and grounds generation (deeper Foundation-preseed is a follow-up).
      const m = (metas || []).find((x) => ["brand", "persona"].includes((x.kind || "").toLowerCase()));
      if (m) state.brand = (await state.relay.context.use(m.id)) || null;
    } catch { /* grant without the contextKinds row, or an older daemon — active()-only is fine */ }
  }
  if (state.current && !state.current.brand && state.brand) state.current.brand = state.brand;
  renderBrandBar();
}

// The slim in-shell banner for a dead relay — visible above the stage until a reconnect re-boots.
function setConnBanner(show) {
  const b = $("connbanner"); if (b) b.hidden = !show;
}

// The always-visible brand affordance — THE Switchboard point: Cast consumes the ONE brand context
// you lend it, and every option/asset/script is then made FOR that brand. Pick opens the broker's
// context picker; the persona is published back as its own context that references the brand.
function renderBrandBar() {
  const box = $("brandbar"); if (!box) return; clear(box);
  const a = state.current; const b = a?.brand;
  box.append(el("span", "bk", "Brand context"));
  if (b) {
    const chip = el("span", "bchip");
    const pal = b.data?.palette; if (Array.isArray(pal) && pal.length) { const sw = el("span", "bsw"); for (const c of pal.slice(0, 3)) { const i = el("i"); i.style.background = c; sw.append(i); } chip.append(sw); }
    chip.append(document.createTextNode(b.name));
    box.append(chip);
    box.append(el("span", "empty-note", "— this persona creates for it"));
    const chg = el("button", "blink bspace", "Change"); chg.onclick = pickBrand; box.append(chg);
    const rm = el("button", "blink dim", "Remove"); rm.onclick = () => { a.brand = null; save(); renderShell(); }; box.append(rm);
  } else {
    box.append(el("span", "empty-note", "None lent. The persona will be generic until you lend a brand."));
    const b2 = el("button", "blink bspace", "＋ Lend a brand from Switchboard"); b2.onclick = pickBrand; box.append(b2);
  }
}
async function pickBrand() {
  if (!state.relay) return;
  try { const c = await state.relay.context.pick(); if (c && state.current) { state.current.brand = c; save(); renderShell(); } } catch {}
}

// ---------- account rail ----------
function newAccount() {
  flushSave();
  state.current = blankAccount();
  state.current.brand = state.brand || null; // adopt the lent/banked brand from the first breath
  state.loading = new Set();
  renderRail(); renderShell();
}
function selectAccount(id) {
  const a = state.accounts.find((x) => x.id === id); if (!a) return;
  flushSave(); // a pending debounced save must land on ITS account before we swap the working copy
  state.current = JSON.parse(JSON.stringify(a)); // work on a copy; save writes back
  if (!state.current.brand && state.brand) state.current.brand = state.brand;
  state.current.stage = reachableStage(state.current);
  state.loading = new Set();
  renderRail(); renderShell();
}
async function duplicateAccount(id, ev) {
  ev?.stopPropagation();
  flushSave();
  const a = state.accounts.find((x) => x.id === id); if (!a) return;
  const copy = JSON.parse(JSON.stringify(a)); copy.id = newId(); copy.handle = (personaName(a)) + " copy"; copy.updatedAt = Date.now();
  await persist(state.relay, copy); state.accounts = await loadAccounts(state.relay); selectAccount(copy.id);
}

function renderRail() {
  const box = $("plist"); clear(box);
  const rows = [...state.accounts];
  if (state.current && !rows.find((a) => a.id === state.current.id)) rows.unshift(state.current);
  if (!rows.length) { box.append(el("div", "empty", "No accounts yet. Create your first →")); return; }
  for (const a of rows) {
    const on = state.current && a.id === state.current.id;
    const row = el("div", "prow" + (on ? " on" : ""));
    const face = a.assets?.face?.url ? Object.assign(el("img", "face"), { src: a.assets.face.url }) : el("div", "face", (personaName(a) || "?")[0].toUpperCase());
    const txt = el("div"); txt.style.minWidth = "0";
    txt.append(el("div", "nm", personaName(a)), el("div", "ni", stageLabel(a)));
    row.append(face, txt);
    const dup = el("button", "dup", "⧉"); dup.title = "Duplicate"; dup.onclick = (e) => duplicateAccount(a.id, e); row.append(dup);
    row.onclick = () => selectAccount(a.id);
    box.append(row);
  }
}
function stageLabel(a) {
  const reach = reachableStage(a);
  const done = STAGE_IDS.indexOf(reach);
  return `Stage ${done + 1} of 6 · ${reach}`;
}

// ---------- shell: stepper + active stage ----------
function renderShell() {
  renderStepper($("stepper"), state.current, go);
  renderBrandBar();
  renderActiveStage();
}
function renderActiveStage() {
  const account = state.current;
  const ctx = {
    account, relay: state.relay, mock: state.mock, brand: state.brand, caps: state.caps, loading: state.loading,
    // save is bound to THIS ctx's account: a stage callback that resolves after an account switch
    // persists the account it actually mutated, never whatever state.current happens to be then.
    save: () => save(account), rerender: renderActiveStage, go,
  };
  renderStage(state.current.stage, $("stage"), ctx);
  renderStepper($("stepper"), state.current, go); // keep the stepper's progress in sync
}
function go(stageId) { state.current.stage = stageId; window.scrollTo({ top: 0, behavior: "smooth" }); renderShell(); }

// Persist the working copy and refresh the rail (name/stage may have changed). Debounced: called on
// every lock/approve, which is cheap against claude_storage. The account to persist is captured WHEN
// the save is scheduled — never read at fire time, or an account switch mid-debounce would write the
// wrong copy. flushSave() (called before any switch) lands a pending save immediately.
let saveT = null, pendingAcct = null;
function save(acct) {
  const a = acct || state.current; if (!a) return;
  if (pendingAcct && pendingAcct !== a) flushSave(); // two accounts in flight → land the older one now
  renderRail();
  clearTimeout(saveT);
  pendingAcct = a;
  saveT = setTimeout(() => { pendingAcct = null; void persistNow(a); }, 400);
}
async function persistNow(acct) {
  await persist(state.relay, acct);
  state.accounts = await loadAccounts(state.relay);
  // keep the working copy authoritative; just refresh the rail ordering
  if (state.current && !state.accounts.find((a) => a.id === state.current.id)) state.accounts.unshift(state.current);
  renderRail();
}
function flushSave() {
  if (!pendingAcct) return;
  clearTimeout(saveT); saveT = null;
  const acct = pendingAcct; pendingAcct = null;
  // sync the in-memory list synchronously so an immediate re-select sees this exact copy…
  const i = state.accounts.findIndex((x) => x.id === acct.id);
  if (i >= 0) state.accounts[i] = acct; else state.accounts.unshift(acct);
  void persist(state.relay, acct); // …and write through in the background
}

$("newAccount").addEventListener("click", newAccount);

// ---------- demo (mock) relay ----------
function mockRelay() {
  const store = new Map();
  const brand = { id: "aamras", name: "Aamras", kind: "brand", data: { palette: ["#8B1A1A", "#F4A000"] } };
  // one fully-seeded account so the whole pipeline is explorable end to end (?fresh skips it)
  if (!FRESH) {
    const seed = migrate({ id: "maya", name: "Maya Chen", niche: "sustainable skincare", vibe: "warm, plain-spoken, reads every label", story: "ex-lab chemist in Lisbon, small-batch serums", look: { referenceImage: svgTile("Maya", "#FF5A3C", "#FFB05A") }, wardrobe: [{ id: "w1", name: "Linen blazer", referenceImage: svgTile("Linen", "#E8DCC8", "#C9B89A") }], locations: [{ id: "l1", name: "Sunlit bathroom", referenceImage: svgTile("Bathroom", "#BFE3E0", "#7FBFB8") }], cast: [] });
    store.set("account:" + seed.id, JSON.stringify(seed));
  }
  return {
    __mock: true,
    identity: async () => ({ name: "Sameep" }),
    capabilities: async () => ({ version: "0.1", methods: [], models: [], backends: [], agentic: true, local: { tts: false } }),
    storage: { list: async () => [...store.keys()], get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
    context: { active: async () => brand, publish: async (c) => (store.set("ctx:" + (c.id || newId()), JSON.stringify(c.data)), c.id), list: async () => [], pick: async () => brand },
    speak: async () => null,
    stream: async function* () { yield { type: "text", text: "" }; },
  };
}
