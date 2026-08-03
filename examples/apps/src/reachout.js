// REACHOUT — a lead list into a personalized N-touch sequence, drafted on your own Claude, grounded
// in your ICP/brand context, staged as Gmail DRAFTS. Nothing is ever auto-sent — every send is a
// human click (docs/EMAIL-WRAPP.md §6). On the visitor's OWN Claude; the operator holds no key, pays
// for no inference, and never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. The block between here and "APP LOGIC" is proven idiom
// (distilled from coldemail.js) — keep it byte-identical. Edit the CONFIG block and everything below.
//
// House doctrine (all five): context-first · single input · options with exactly ONE recommended ·
// house design system · one-go auto-advancing pipeline the user can steer anywhere. The valuable
// middle (parseLeads / buildSequencePrompt / draftSequence / stageNextTouch / the ledger) lives in
// src/core/reachout.core.js — ONE definition, shared with the MCP connector and the routine tick.
import { whenRelayReady, mountConnect } from "@relay/sdk";
import { optionCards } from "./kit/ui.js";
import { exposeToGod } from "./kit/webmcp.js";
import {
  parseLeads, newCampaign, loadCampaign, saveCampaign, campaignKey,
  draftSequence, stageNextTouch, isTouchDue, SEQUENCE_OPTIONS, DEFAULT_SEQUENCE,
} from "./core/reachout.core.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const GMAIL = "mcp__claude_ai_Gmail__*"; // whole-connector wildcard — the ONLY form the gate accepts.
const APP = {
  id: "reachout",
  name: "Reachout",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Reachout — draft a personalized outreach sequence per lead on your own Claude and stage it as Gmail drafts (never sends)",
    models: ["sonnet"],
    tools: [GMAIL], // create_draft rides this grant; a send tool would too — so the no-send rule is enforced in OUR code (§6)
  },
  usesContext: "single", // the ICP / brand — the sender's side
};
const GMAIL_COMPOSE = "https://mail.google.com/mail/u/0/#drafts";

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 200);
let toastT = null;
function toast(text, err) {
  clearTimeout(toastT);
  let t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.append(t); }
  t.className = "toast" + (err ? " err" : ""); t.textContent = text;
  toastT = setTimeout(() => t.remove(), 3600);
}

// ==== connect (standard chip + returning-user probe) ========================================
let relay = null;
let notInstalled = false;
let brand = null; // the ONE lent context (the ICP)
let wired = false;

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
function wire(r) { if (wired) return; wired = true; r.on("permissionsChanged", () => void syncContext()); }

// onReady fires TWICE by design (mountConnect + the returning-user probe). Hydrate ONCE, or the second
// pass re-reads the campaign the first just saved and orphans the running pipeline (coldemail note).
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render();
}

async function syncContext() {
  if (!relay) return;
  brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state ======================================================================
// The authoritative campaign ledger lives in sb.storage under campaignKey() (the core owns it). The
// DOM keeps a pointer to the active campaign id + an in-memory mirror for rendering.
let state = { campaignId: null };
let campaign = null; // the loaded ledger record

async function loadState() {
  try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { campaignId: null }; }
  if (state.campaignId) campaign = await loadCampaign(relay, state.campaignId).catch(() => null);
}
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== house UI atoms ========================================================================
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude + your brand";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · Paste your leads — each with one real reason to reach them";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Drafts stage in Gmail — you read each one and send it yourself";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
const SAMPLE = "email,name,company,role,hook\nana@acme.com,Ana,Acme,Founder,shipped a Claude-powered onboarding flow last week\nlee@bolt.io,Lee,Bolt,Head of Growth,posted about doing cold outreach by hand";
const STEER_CHIPS = ["warmer", "shorter", "more direct", "different angle"];
let running = false;
let seqChoice = SEQUENCE_OPTIONS.find((s) => s.recommended) || SEQUENCE_OPTIONS[0];
let leadsText = "";

const activeSequence = () => ({ touches: seqChoice.touches, spacingDays: seqChoice.spacingDays });

// Draft the whole campaign: parse leads, create the ledger, and draft each lead's sequence as a
// preview (pure — no side effects, nothing staged yet). Staging is a separate, explicit step.
async function draftCampaign() {
  if (!relay || running) return;
  const leads = parseLeads(leadsText);
  if (!leads.length) { toast("Paste at least one lead with an email and a hook.", true); return; }
  running = true;
  const id = "camp-" + uid();
  campaign = newCampaign({ id, leads, sequence: activeSequence() });
  state.campaignId = id;
  await saveCampaign(relay, id, campaign);
  await saveState();
  render();
  // Draft previews per lead (touch 1 shown on the board; the full sequence is stored for staging).
  for (const lead of campaign.leads) {
    try {
      const icp = brand ? (brand.data ? brand : { data: brand, name: brand.name }) : undefined;
      const seq = await draftSequence({ lead, icp, sequence: campaign.sequence }, relay);
      lead.preview = seq.touches;
      await saveCampaign(relay, id, campaign);
      render();
    } catch (e) { lead.previewError = msg(e); render(); }
  }
  running = false;
  render();
}

// Stage a lead's next DUE touch as a Gmail draft (the write-class step; create_draft ONLY, never send).
async function stageRow(email) {
  if (!relay || !campaign) return;
  try {
    const icp = brand ? (brand.data ? brand : { data: brand, name: brand.name }) : undefined;
    const res = await stageNextTouch({ campaignId: campaign.id, email, icp }, relay);
    campaign = await loadCampaign(relay, campaign.id);
    if (res.staged) toast(`Touch ${res.touch} staged in Gmail — read it, then send it yourself.`);
    else toast(res.reason || "Nothing due for this lead.");
    render();
  } catch (e) {
    const m = msg(e);
    if (/scope|allowlist|not granted/i.test(m)) toast("Connect Gmail in the chip to stage drafts.", true);
    else toast(m, true);
  }
}

// Stage every lead whose next touch is due (manual stand-in for the routine tick until it merges).
async function stageAllDue() {
  if (!relay || !campaign || running) return;
  running = true; render();
  const due = campaign.leads.filter((l) => isTouchDue(l, campaign.sequence));
  if (!due.length) { toast("No touches are due right now."); running = false; render(); return; }
  for (const lead of due) { await stageRow(lead.email); }
  running = false; render();
}

function newCampaignReset() { campaign = null; state.campaignId = null; leadsText = ""; void saveState(); render(); }

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  hero.hidden = !!campaign;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample leads (connect to run your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!campaign) { view.append(setupScreen()); return; }
  view.append(boardScreen());
}

function setupScreen() {
  const box = el("div", "start");
  if (brand) box.append(el("div", "ctx", `Grounded in your brand: ${brand.name || "context"}`));
  else box.append(el("div", "ctx", "Tip: lend your brand in the chip so the copy sounds like you."));

  const f1 = el("div", "field");
  f1.append(el("span", "kicker", "your leads — one per row, with a real hook"));
  const row = el("div", "bindrow");
  const ta = el("textarea"); ta.rows = 6; ta.value = leadsText;
  ta.placeholder = "email,name,company,role,hook\nana@acme.com,Ana,Acme,Founder,shipped a Claude-powered onboarding flow";
  ta.addEventListener("input", () => { leadsText = ta.value; });
  row.append(ta);
  f1.append(row);
  box.append(f1);

  const f2 = el("div", "field");
  f2.append(el("span", "kicker", "how many touches"));
  f2.append(optionCards({
    options: SEQUENCE_OPTIONS.map((s) => ({ id: s.id, label: s.label, recommended: s.recommended })),
    chosenId: seqChoice.id,
    onChoose: (o) => { seqChoice = SEQUENCE_OPTIONS.find((s) => s.id === o.id) || seqChoice; render(); },
    chosenNote: "",
  }));
  box.append(f2);

  const btn = el("button", "primary", "Draft the sequence ✉️");
  btn.style.marginTop = "18px";
  btn.onclick = () => void draftCampaign();
  box.append(btn);
  box.append(el("div", "hint", "Drafts on your Claude · staged as Gmail drafts · you send each one yourself"));
  return box;
}

function boardScreen() {
  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "campaign"), el("span", "grow"));
  const na = el("button", "act", "× new campaign"); na.onclick = newCampaignReset;
  bar.append(na);
  col.append(bar);

  const T = campaign.sequence.touches;
  let staged = 0, sent = 0, due = 0;
  for (const l of campaign.leads) {
    staged += (l.drafts || []).length;
    sent += (l.drafts || []).filter((d) => d.sent).length;
    if (isTouchDue(l, campaign.sequence)) due += 1;
  }
  const head = el("div", "boardhead");
  const st = el("div", "stat"); st.innerHTML = `<b>${staged}</b> drafts staged in Gmail`;
  const se = el("div", "stat"); se.innerHTML = `${sent} sent`;
  const dn = el("div", "stat"); dn.innerHTML = `<b>${due}</b> due now`;
  head.append(st, se, dn);
  col.append(head);

  if (running) col.append(researching("drafting on your Claude…"));

  const board = el("div", "board");
  board.style.setProperty("--touches", String(T));
  const hrow = el("div", "brow");
  hrow.append(el("div", "bcell h", "lead"));
  for (let i = 1; i <= T; i++) hrow.append(el("div", "bcell h", "touch " + i));
  hrow.append(el("div", "bcell h", ""));
  board.append(hrow);

  for (const lead of campaign.leads) {
    const r = el("div", "brow");
    const lc = el("div", "bcell lead");
    lc.append(el("div", "nm", lead.name || lead.email));
    const hk = el("div", "hk" + (lead.hook ? "" : " warn"), lead.hook ? `“${lead.hook}”` : "no hook — add one so it isn't a blast");
    lc.append(hk);
    r.append(lc);

    for (let i = 1; i <= T; i++) {
      const cell = el("div", "bcell");
      const d = (lead.drafts || []).find((x) => x.touch === i);
      let pill;
      if (d && d.sent) pill = el("span", "pill sent", "sent");
      else if (d) pill = el("span", "pill staged", "staged ✓");
      else if (lead.stage < i - 1) pill = el("span", "pill none", "—");
      else if (running && lead.stage === i - 1) pill = el("span", "pill drafting", "drafting…");
      else if (lead.preview && lead.preview[i - 1] && lead.preview[i - 1].subject) pill = el("span", "pill", "drafted");
      else pill = el("span", "pill none", "—");
      cell.append(pill);
      r.append(cell);
    }

    const ac = el("div", "bcell rowact");
    const done = lead.stage >= T || lead.status !== "active";
    const b = el("button", "act", done ? "done" : "stage next");
    b.disabled = done || running;
    b.onclick = () => void stageRow(lead.email);
    ac.append(b);
    r.append(ac);
    board.append(r);
  }
  col.append(board);

  const actions = el("div"); actions.style.marginTop = "14px";
  const all = el("button", "act", "Stage all due"); all.disabled = running || due === 0;
  all.onclick = () => void stageAllDue();
  actions.append(all);
  col.append(actions);

  const link = el("a", "gmail", "Review & send in Gmail →");
  link.href = GMAIL_COMPOSE; link.target = "_blank"; link.rel = "noreferrer";
  col.append(link);

  const ns = el("div", "neversend");
  ns.innerHTML = "<b>Drafts are autonomous. Sends are human.</b> Reachout stages every message as a Gmail draft and never sends — you read each one and send it yourself. There is no “send all” button, by design.";
  col.append(ns);
  return col;
}
render();

// ---- God's hand: one page-tool driving the real pipeline (docs/GOD-HANDS.md) ---------------------
// `reachout_draft` stages the next due touches for the active campaign — DRAFTS only. Adding the hand
// is the one-time draft grant; a SEND stays the reserved notch confirm (§2.1), never something God fakes.
exposeToGod({
  name: "reachout_draft",
  description: "Draft and stage (as Gmail DRAFTS — never sends) the next due outreach touches for the active Reachout campaign. Renders the board live and returns a summary.",
  inputSchema: { campaignId: "string — optional; defaults to the active campaign." },
  execute: async ({ campaignId } = {}) => {
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Reachout isn't connected to Switchboard yet");
    const id = campaignId || state.campaignId;
    if (!id) throw new Error("no active campaign — set one up first");
    if (state.campaignId !== id) { state.campaignId = id; campaign = await loadCampaign(relay, id); }
    await stageAllDue();
    const staged = (campaign?.leads || []).reduce((n, l) => n + (l.drafts || []).length, 0);
    return { campaignId: id, draftsStaged: staged, sent: 0, note: "Drafts staged in Gmail. Every send stays a human click." };
  },
});
