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
import { renderStage } from "./cast/stages.js";
import { $, el, clear, renderStepper } from "./cast/ui.js";
import { svgTile } from "./cast/gen.js";
import { harnessRelay } from "./cast/harness.js";

const state = { relay: null, mock: false, caps: null, brand: null, accounts: [], current: null, loading: new Set() };

// ?harness — boot the LIVE harness relay: Cast's real generation path (mock=false) backed by real
// Higgsfield assets, so a reel actually renders inside Cast without the browser extension present.
// When set, it is AUTHORITATIVE: a live Switchboard connection must NOT clobber the seeded demo, or
// the Nadia example would flash and then get replaced by a blank real account.
const HARNESS = new URLSearchParams(location.search).has("harness");

// ---------- connect ----------
mountConnect($("sbchip"), {
  scope: { reason: "Cast — build AI personas and produce on-model content, stage by stage", tools: ["mcp__claude_ai_Higgsfield__*", "WebSearch", "WebFetch"] },
  onConnect: (r) => { if (!HARNESS) boot(r, false); },
  onDisconnect: () => { /* keep the studio up; a reconnect re-boots */ },
  onProjectChange: () => { if (!HARNESS) loadBrand(); },
});
if (HARNESS) boot(harnessRelay(), false);
else whenRelayReady(1800).then((r) => { if (!("connect" in r) && !state.relay) boot(mockRelay(), true); });

async function boot(relay, mock) {
  state.relay = relay; state.mock = mock;
  state.caps = await (relay.capabilities ? relay.capabilities().catch(() => null) : null);
  $("hero").hidden = true; $("app").hidden = false;
  await loadBrand();
  state.accounts = await loadAccounts(relay);
  if (!state.accounts.length) newAccount();
  else selectAccount(state.accounts[0].id);
}

// The lent brand context. On boot / project change we read whatever the user has lent Cast via
// Switchboard (context.active). If the current account has no brand yet, adopt the lent one.
async function loadBrand() {
  try { state.brand = state.relay ? await state.relay.context.active() : null; } catch { state.brand = null; }
  if (state.current && !state.current.brand && state.brand) state.current.brand = state.brand;
  renderBrandBar();
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
function newAccount() { state.current = blankAccount(); state.loading = new Set(); renderRail(); renderShell(); }
function selectAccount(id) {
  const a = state.accounts.find((x) => x.id === id); if (!a) return;
  state.current = JSON.parse(JSON.stringify(a)); // work on a copy; save writes back
  state.current.stage = reachableStage(state.current);
  state.loading = new Set();
  renderRail(); renderShell();
}
async function duplicateAccount(id, ev) {
  ev?.stopPropagation();
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
  const ctx = {
    account: state.current, relay: state.relay, mock: state.mock, brand: state.brand, caps: state.caps, loading: state.loading,
    save, rerender: renderActiveStage, go,
  };
  renderStage(state.current.stage, $("stage"), ctx);
  renderStepper($("stepper"), state.current, go); // keep the stepper's progress in sync
}
function go(stageId) { state.current.stage = stageId; window.scrollTo({ top: 0, behavior: "smooth" }); renderShell(); }

// Persist the working copy and refresh the rail (name/stage may have changed). Debounced-ish: called
// on every lock/approve, which is cheap against claude_storage.
let saveT = null;
async function save() {
  renderRail();
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    await persist(state.relay, state.current);
    state.accounts = await loadAccounts(state.relay);
    // keep the working copy authoritative; just refresh the rail ordering
    if (!state.accounts.find((a) => a.id === state.current.id)) state.accounts.unshift(state.current);
    renderRail();
  }, 400);
}

$("newAccount").addEventListener("click", newAccount);

// ---------- demo (mock) relay ----------
function mockRelay() {
  const store = new Map();
  const brand = { id: "aamras", name: "Aamras", kind: "brand", data: { palette: ["#8B1A1A", "#F4A000"] } };
  // one fully-seeded account so the whole pipeline is explorable end to end
  const seed = migrate({ id: "maya", name: "Maya Chen", niche: "sustainable skincare", vibe: "warm, plain-spoken, reads every label", story: "ex-lab chemist in Lisbon, small-batch serums", look: { referenceImage: svgTile("Maya", "#FF5A3C", "#FFB05A") }, wardrobe: [{ id: "w1", name: "Linen blazer", referenceImage: svgTile("Linen", "#E8DCC8", "#C9B89A") }], locations: [{ id: "l1", name: "Sunlit bathroom", referenceImage: svgTile("Bathroom", "#BFE3E0", "#7FBFB8") }], cast: [] });
  store.set("account:" + seed.id, JSON.stringify(seed));
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
