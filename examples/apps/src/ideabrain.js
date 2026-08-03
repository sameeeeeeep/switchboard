// IDEABRAIN — the "I have an idea" widget. One line in the notch → an instant category read → a
// validation pulse (stage pips + live grounding) → a one-line VERDICT that states the risk, not the
// hype → the three artefacts (deck / reach-outs / brief) and "set as my project". This is the NEW-idea
// front door (the existing-brand path is a separate thing — ideafetch — and lives elsewhere).
//
// It does NOT rebuild ideabrain's studio engine. It stands on the existing `brief` seam
// (src/core/ideabrain.core.js — a one-line idea → a sharp structured brief in one web-free call) for
// the instant read, then runs ONE compact pressure-test pass for the pulse + verdict. On completion it
// publishes a kind:"idea" context (the same shape the port's ideaToContext produces), so a validated
// thesis becomes an active project like an extracted brand. Design: docs/BRAND-EXTRACTION.md §4 +
// docs/NOTCH-PANEL.md (black, glanceable, drops from the notch).
//
// This file is TEMPLATE PLUMBING + the widget. Everything between here and "WIDGET LOGIC" is proven
// idiom (distilled from nameit.js) — keep it byte-identical. Edit CONFIG and everything below.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// REUSE THE SEAM — the brief prompt/system/normalize are imported verbatim from the headless core, the
// SAME code `ideabrain/brief` runs as a workflow. The widget never re-implements the brief.
import { STUDIO_SYSTEM, buildBriefPrompt, normalizeBrief } from "./core/ideabrain.core.js";
// God's hands: expose the widget's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG =================================================================================
const APP = {
  id: "ideabrain",
  name: "ideabrain",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "ideabrain — reads a one-line idea and pressure-tests it on your own Claude",
    models: ["sonnet"],
    tools: [],                                    // text reasoning; the heavy web-grounded studio lives in the web app
  },
  usesContext: "single",                          // a lent idea/brand context can seed the field
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
let seed = null;          // the ONE lent context (brand or idea), when present — seeds the field
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
// onReady fires TWICE by design (mountConnect's onConnect AND the returning-user probe). Hydrate once —
// a second hydrate would re-read the run stage-1 just saved and orphan the running pipeline.
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render();
}

async function syncContext() {
  if (!relay) return;
  try { seed = await relay.context.active(); } catch { seed = null; }
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON) =============================
let state = { run: null };
async function loadState() { try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { run: null }; } }
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== llm helper — the EXACT stream contract; never guess these shapes =======================
const STREAM_TIMEOUT_MS = 180000;
async function streamText(params, onProgress) {
  const it = relay.stream(params);
  let text = "", settled = false, timer = null;
  try {
    return await Promise.race([
      (async () => {
        for await (const d of it) {
          if (d.type === "text") { text += d.text; onProgress && onProgress({ text }); }
          else if (d.type === "sources") { onProgress && onProgress({ sources: d.urls }); }
          else if (d.type === "error") throw new Error(d.error?.message || "stream error");
        }
        settled = true;
        return text;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          try { it.return?.(); } catch { /* already closed */ }
          reject(new Error("Switchboard didn't respond — is the sidekick running? Reload and try again."));
        }, STREAM_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

// ==== WIDGET LOGIC ═════════════════════════════════════════════════════════════════════════
// The idea → category read → validation pulse → verdict, rendered as ONE progress card (never a
// chat, never a form). Doctrine: one line in, a validated project out; the verdict states the RISK.

// The six pulse stages (spec §4.2 State 3). `brief` fills the moment the instant read lands; the
// pressure-test pass fills research→prove. 🌐 = pulled from live web (cite-or-omit grounding).
const STAGES = [
  { key: "brief", label: "brief" },
  { key: "research", label: "market", web: true },
  { key: "thesis", label: "thesis" },
  { key: "market", label: "demand", web: true },
  { key: "plan", label: "plan" },
  { key: "prove", label: "prove", web: true },
];
// detectIdeaCategory's job, coarse + local: map the brief's free-text category to one of ideabrain's
// 7 templates, each an ordered subset of the 46-task idea pool (spec §4.1 — 13–15 decisions).
const TEMPLATES = {
  marketplace: { label: "marketplace", decisions: 15 },
  app: { label: "consumer app", decisions: 14 },
  saas: { label: "SaaS", decisions: 14 },
  hardware: { label: "hardware", decisions: 15 },
  retail: { label: "retail / D2C", decisions: 13 },
  feature: { label: "feature", decisions: 13 },
  general: { label: "startup", decisions: 14 },
};
function detectTemplate(brief) {
  const s = `${brief?.category || ""} ${brief?.productIdea || ""}`.toLowerCase();
  if (/\bmarket\s?place|two-?sided|supply.?side|buyers? and sellers?/.test(s)) return "marketplace";
  if (/\bsaas|b2b|dashboard|workflow|api\b|platform for teams/.test(s)) return "saas";
  if (/hardware|device|wearable|robot|sensor|chip/.test(s)) return "hardware";
  if (/retail|d2c|dtc|ecommerce|e-commerce|brand|store|product line|cpg|fragrance|apparel/.test(s)) return "retail";
  if (/\bapp\b|mobile|ios|android|consumer/.test(s)) return "app";
  if (/feature|add-?on|plugin|integration/.test(s)) return "feature";
  return "general";
}

const SAMPLE = "a marketplace to buy billboard slots by the minute"; // pre-connect only, visibly labelled
let running = false;
let pulseTimer = null;

function seedLine() {
  if (!seed) return "";
  const bits = [seed.name, seed.data?.idea, seed.data?.positioning, seed.data?.tagline].filter(Boolean);
  return bits.length ? bits.join(" — ") : (seed.name || "");
}

function newRun(idea) {
  return {
    id: uid(), idea, phase: "reading",         // reading → read → validating → validated
    brief: null, template: null,
    stageIx: 0,                                 // how many pips are lit
    verdict: null,                              // { stance, headline, risk, wedge, whynow, stages:[{key,signal,grounded}], reachOutCount }
    published: false, error: null, status: "reading the idea…",
  };
}

async function start(idea) {
  if (!relay || running) return;
  idea = String(idea || "").trim();
  if (!idea) { toast("Type the idea in one line first.", true); return; }
  state.run = newRun(idea);
  await saveState(); render();
  await readBrief();
}

// STATE 2 — the instant read. One web-free `brief` call (the reused seam), ~2s, so the user sees a
// committed reading before any long research (the "never a blank screen" doctrine).
async function readBrief() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.phase = "reading"; r.status = "reading the idea…"; r.stageIx = 0; render();
  try {
    const prompt = buildBriefPrompt({ idea: r.idea, market: seed?.data?.market || "" });
    let text = await streamText({ prompt, system: STUDIO_SYSTEM, model: "sonnet", effort: "low" });
    let parsed = parseJson(text);
    if (!parsed) { text = await streamText({ prompt: prompt + "\n\nReturn ONLY the JSON object — nothing else.", system: STUDIO_SYSTEM, model: "sonnet", effort: "low" }); parsed = parseJson(text); }
    if (!parsed) throw new Error("couldn't read a brief from the reply — retry");
    r.brief = normalizeBrief(parsed, { idea: r.idea, market: seed?.data?.market || "" });
    r.template = detectTemplate(r.brief);
    r.phase = "read"; r.stageIx = 1;            // the `brief` pip is now lit
  } catch (e) { r.error = msg(e); r.phase = "reading"; }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// STATE 3→4 — the validation pulse. ONE compact pressure-test pass (the studio's heavy card loop
// stays in the web app). Pips fill on a timer while the call runs; the verdict states the RISK.
async function validate() {
  const r = state.run; if (!r || !relay || running || !r.brief) return;
  running = true; r.error = null; r.phase = "validating"; r.status = "pressure-testing the riskiest assumption"; render();
  // glanceable progress — advance the pips toward (but not past) the last one until the call resolves.
  clearInterval(pulseTimer);
  pulseTimer = setInterval(() => {
    if (state.run !== r || r.phase !== "validating") return;
    if (r.stageIx < STAGES.length - 1) { r.stageIx += 1; r.status = "now: " + STAGES[r.stageIx].label + (STAGES[r.stageIx].web ? " 🌐" : ""); render(); }
  }, 1400);
  try {
    const b = r.brief;
    const prompt = [
      `You are ideabrain. Pressure-test this idea for a founder — find where it BREAKS, not where it shines.`,
      `Idea: "${r.idea}"`,
      `Brief: product "${b.productIdea}"; category "${b.category}"; audience "${b.audience}"; market "${b.market}"; price tier ${b.priceTier}; angle "${b.positioningHint}".`,
      `Reason over what you know about this space: real alternatives, whether the timing is right, and the single riskiest assumption the whole thesis rests on.`,
      `Return ONLY this JSON (no prose, no fences):`,
      `{"stance":"holds|shaky|weak","headline":"<=8 words, the verdict — never hype","risk":"one line: the single biggest risk / what could kill it","wedge":"one line: the part that is genuinely real","whynow":"one line: why the timing is right (or empty if it isn't)","stages":[{"key":"research","signal":"one short finding","grounded":true},{"key":"thesis","signal":"...","grounded":false},{"key":"market","signal":"...","grounded":true},{"key":"prove","signal":"...","grounded":true}],"reachOutCount":<int 4-8>}`,
    ].join("\n\n");
    const text = await streamText({ prompt, system: STUDIO_SYSTEM, model: "sonnet", effort: "low" });
    const parsed = parseJson(text);
    if (!parsed) throw new Error("couldn't read a verdict from the reply — retry");
    const stances = ["holds", "shaky", "weak"];
    r.verdict = {
      stance: stances.includes(parsed.stance) ? parsed.stance : "shaky",
      headline: String(parsed.headline || "Thesis pressure-tested").slice(0, 80),
      risk: String(parsed.risk || "").slice(0, 200),
      wedge: String(parsed.wedge || "").slice(0, 200),
      whynow: String(parsed.whynow || "").slice(0, 200),
      stages: Array.isArray(parsed.stages) ? parsed.stages.slice(0, 6).map((s) => ({ key: String(s.key || ""), signal: String(s.signal || "").slice(0, 120), grounded: !!s.grounded })) : [],
      reachOutCount: Math.max(4, Math.min(8, parseInt(parsed.reachOutCount, 10) || 6)),
    };
    r.phase = "validated"; r.stageIx = STAGES.length;
  } catch (e) { r.error = msg(e); r.phase = "read"; }
  finally { clearInterval(pulseTimer); running = false; r.status = ""; await saveState(); render(); }
}

// "set as my project" — publish the validated thesis as a kind:"idea" context (the same shape the
// port's ideaToContext produces), so every downstream wrapp opens pre-loaded with this idea. The
// GLOBAL active-project pick is a daemon/side-panel op (see native hook spec); publishing banks it.
async function setProject() {
  const r = state.run; if (!r || !r.brief || !r.verdict || !relay?.context?.publish) return;
  try {
    const b = r.brief, v = r.verdict;
    const decisions = {};
    for (const s of v.stages) if (s.key && s.signal) decisions[s.key] = { title: s.key, body: s.signal };
    const id = await relay.context.publish({
      id: "idea-" + r.id,
      name: b.productIdea || r.idea,
      kind: "idea",
      data: {
        idea: r.idea,
        category: r.template || "general",
        market: b.market || "",
        problem: v.risk || "",
        insight: v.wedge || "",
        solution: b.positioningHint || "",
        moat: v.wedge || "",
        verdict: v.stance,
        whynow: v.whynow || "",
        decisions,
      },
    });
    r.published = true; await saveState(); render();
    toast(id ? "Set as your project ✓ — every wrapp now knows this idea" : "Banked this idea ✓");
  } catch (e) { toast("Couldn't set the project: " + msg(e), true); }
}

// ==== render ================================================================================
function pips(lit) {
  const wrap = el("div", "pips");
  STAGES.forEach((s, i) => {
    const p = el("span", "pip" + (i < lit ? " on" : "") + (s.web ? " web" : ""));
    p.title = s.label + (s.web ? " (web-grounded)" : "");
    wrap.append(p);
  });
  return wrap;
}
function stageLine(r) {
  const done = STAGES.slice(0, r.stageIx).map((s) => s.label).join(" ✓ · ");
  return done ? done + (r.phase === "validating" ? " …" : " ✓") : "";
}

function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  // ---- pre-connect ----
  if (!relay) {
    const steps = el("div", "steps");
    const s1 = el("div"); s1.innerHTML = notInstalled ? "<b>1</b> Install Switchboard (top-right)" : "<b>1</b> Connect Switchboard — lends this widget your Claude";
    const s2 = el("div"); s2.innerHTML = "<b>2</b> One line in — the idea gets pressure-tested";
    const s3 = el("div"); s3.innerHTML = "<b>3</b> Get a verdict that states the risk, then set it as your project";
    steps.append(s1, s2, s3);
    view.append(steps);
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample idea (connect to test your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  // ---- STATE 1: idle prompt ----
  if (!r) {
    const box = el("div", "prompt");
    if (seed) box.append(el("div", "ctx", "seeded from " + seed.name));
    const row = el("div", "field");
    const input = el("textarea"); input.rows = 2;
    input.placeholder = "a marketplace to buy billboard slots by the minute…";
    if (seed) input.value = seedLine();
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
    const btn = el("button", "primary", "Pressure-test it →"); btn.onclick = go;
    row.append(input, btn);
    box.append(row);
    box.append(el("div", "hint", "Enter to test · one line, a validated project out"));
    view.append(box);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const card = el("div", "card");
  const bar = el("div", "topbar");
  bar.append(el("span", "kicker", "idea"), el("span", "idea-line", r.idea), el("span", "grow"));
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  card.append(bar);

  // ---- STATE 2: instant read ----
  if (r.brief && (r.phase === "read" || r.phase === "validating" || r.phase === "validated")) {
    const t = TEMPLATES[r.template] || TEMPLATES.general;
    const head = el("div", "readhead");
    head.append(el("span", "cat", r.brief.category || t.label));
    if (r.brief.priceTier) head.append(el("span", "dot", "·"), el("span", "sub", r.brief.priceTier));
    card.append(head);
    if (r.brief.positioningHint) card.append(el("div", "oneliner", "“" + r.brief.positioningHint + "”"));
    const facts = el("div", "facts");
    if (r.brief.audience) facts.append(factEl("beachhead", r.brief.audience));
    if (r.brief.market) facts.append(factEl("market", r.brief.market));
    card.append(facts);
  }

  // ---- STATE 2 actions ----
  if (r.phase === "read") {
    const maps = el("div", "maps");
    const t = TEMPLATES[r.template] || TEMPLATES.general;
    maps.append(el("span", null, "maps to " + t.decisions + " decisions"));
    card.append(maps);
    const acts = el("div", "actions");
    const val = el("button", "primary sm", "Validate"); val.onclick = () => void validate();
    const tweak = el("button", "act", "Tweak"); tweak.onclick = () => { state.run = null; void saveState(); render(); };
    acts.append(val, tweak);
    card.append(acts);
  }

  // ---- STATE 3: validating pulse ----
  if (r.phase === "validating") {
    const pulse = el("div", "pulse");
    pulse.append(pips(r.stageIx));
    pulse.append(el("div", "stages", stageLine(r)));
    const now = el("div", "now"); now.innerHTML = '<span class="scan"></span><span>' + (r.status || "validating…") + "</span>";
    pulse.append(now);
    card.append(pulse);
  }

  // ---- STATE 4: verdict ----
  if (r.phase === "validated" && r.verdict) {
    const v = r.verdict;
    const mark = v.stance === "holds" ? "✓" : v.stance === "weak" ? "✕" : "◐";
    const verdict = el("div", "verdict " + v.stance);
    verdict.append(el("span", "vmark", mark), el("span", "vhead", v.headline));
    card.append(verdict);
    if (v.risk) card.append(riskEl("risk", v.risk));
    if (v.wedge) card.append(riskEl("what's real", v.wedge));
    if (v.stages && v.stages.length) {
      const sig = el("div", "signals");
      for (const s of v.stages) { const li = el("div", "sig"); li.innerHTML = (s.grounded ? '<span class="g">🌐</span> ' : "") + "<b>" + esc(s.key) + "</b> " + esc(s.signal); sig.append(li); }
      card.append(sig);
    }
    const arte = el("div", "artefacts");
    const deck = el("button", "act", "Open deck"); deck.onclick = () => openStudio("deck");
    const reach = el("button", "act", v.reachOutCount + " people to reach out to"); reach.onclick = () => openStudio("reach");
    const full = el("button", "act", "Full brief"); full.onclick = () => openStudio("");
    arte.append(deck, reach, full);
    card.append(arte);
    const set = el("button", "setproj" + (r.published ? " done" : ""), r.published ? "★ your project — wrapps know this idea" : "★ set as my project");
    set.disabled = r.published; set.onclick = () => void setProject();
    card.append(set);
  }

  if (r.error) {
    card.append(el("div", "err", r.error));
    const retry = el("button", "act", "try again");
    retry.onclick = () => (r.brief ? void validate() : void readBrief());
    card.append(retry);
  }
  view.append(card);
}
function factEl(label, val) { const f = el("div", "fact"); f.append(el("span", "fk", label), el("span", "fv", val)); return f; }
function riskEl(label, val) { const r = el("div", "riskrow"); r.append(el("span", "rk", label), el("span", "rv", val)); return r; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
// The heavy studio (research → deck) lives in the web app; the artefact buttons open it there, deep-
// linked to the just-validated idea. From the notch webview this is a hand-off to the full studio.
function openStudio(part) {
  const base = "https://brandbrain.thelastprompt.ai/build?studio=idea";
  const url = base + (part ? "&open=" + encodeURIComponent(part) : "");
  try { window.open(url, "_blank", "noreferrer"); } catch { /* notch host may intercept */ }
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `ideabrain_validate` runs the SAME start()→validate() a click runs — the read + pulse happen live in
// the DOM — then returns the verdict (stance, risk, wedge) for God to speak.
exposeToGod({
  name: "ideabrain_validate",
  description: "Pressure-test a one-line startup idea: reads it into a brief, runs a validation pass, and returns a verdict that states the risk (not hype). Writes it live on the page.",
  inputSchema: { idea: "string — one line describing the idea to validate. Required." },
  execute: async ({ idea } = {}) => {
    const line = String(idea || "").trim();
    if (!line) throw new Error("nothing to test — pass { idea } with the one-line idea");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("ideabrain isn't connected to Switchboard yet");
    await waitFor(() => !running, 180000);
    await start(line);
    await waitFor(() => !running, 180000);
    const r0 = state.run || {};
    if (r0.error) throw new Error(r0.error);
    if (!r0.brief) throw new Error("ideabrain couldn't read the idea — try again");
    await validate();
    await waitFor(() => !running, 180000);
    const r = state.run || {};
    if (r.error) throw new Error(r.error);
    if (!r.verdict) throw new Error("ideabrain stayed busy — try again");
    return { category: r.brief.category, verdict: r.verdict.stance, headline: r.verdict.headline, risk: r.verdict.risk, wedge: r.verdict.wedge };
  },
});
