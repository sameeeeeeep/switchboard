// {{NAME}} — {{what it does}}, on the visitor's OWN Claude. The operator holds no key, pays for no
// inference, and never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + a sample app. Everything between here and the "APP LOGIC" line
// is proven idiom (distilled from redline.js) — keep it byte-identical unless the app truly needs
// otherwise. Edit the CONFIG block and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "wrapp",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Wrapp",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Wrapp — one honest line on what this app does with the user's Claude",
    models: ["sonnet"],
    tools: [],                                  // EXACT names only, e.g. "WebSearch", "WebFetch", HIGGSFIELD
    // contextKinds: ["brand"],                 // only if the app lists the user's contexts of a kind
  },
  usesContext: "single",                        // "single" = consumes one lent context; "none" = standalone
};

// ==== dom + string helpers ==================================================================
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const uid = () => Math.random().toString(36).slice(2, 9);
const msg = (e) => String(e?.message || e).slice(0, 160);
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function mdLite(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/gm, "• ");
}
function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
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
async function onReady() { await syncContext(); await loadState(); render(); autostart(); }

// CONTEXT-FIRST: the moment a context is lent, everything derives from it — options from
// data.products, tone from data.voice, colors from data.palette (FLAT hex strings — see
// docs/CONTEXT-KINDS.md). Hardcoded samples are allowed ONLY pre-connect, visibly labeled.
async function syncContext() {
  if (!relay) return;
  if (APP.usesContext === "single") brand = await relay.context.active().catch(() => null);
  render();
}

// ==== per-origin state (values are opaque STRINGS — store JSON) =============================
let state = { run: null };
async function loadState() { try { const raw = await relay.storage.get(APP.id + "-state"); if (raw) state = JSON.parse(raw); } catch { state = { run: null }; } }
async function saveState() { try { await relay.storage.set(APP.id + "-state", JSON.stringify(state)); } catch { /* non-fatal */ } }

// ==== llm helpers — the EXACT stream contract; never guess these shapes =====================
// relay.stream(params) is an async iterator of deltas:
//   { type:"text", text }  { type:"tool_proposed", call }  { type:"tool_result", result }
//   { type:"error", error:{ message } }  { type:"done", result }
// relay.complete(params) resolves { text, usage, stopReason }.
const STREAM_TIMEOUT_MS = 180000;
async function streamText(params, onProgress) {
  const it = relay.stream(params);
  let text = "", settled = false, timer = null;
  try {
    return await Promise.race([
      (async () => {
        for await (const d of it) {
          if (d.type === "text") { text += d.text; onProgress && onProgress({ text }); }
          else if (d.type === "tool_proposed") { onProgress && onProgress({ tool: d.call?.name }); }
          else if (d.type === "error") throw new Error(d.error?.message || "stream error");
        }
        settled = true;
        return text;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (settled) return;
          try { it.return?.(); } catch { /* already closed */ }
          reject(new Error("Switchboard didn't respond — is the sidekick running? Reload this tab and try again."));
        }, STREAM_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
async function askJson(parts) { return parseJson(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
async function askJsonArray(parts) { return parseJsonArray(await streamText({ prompt: parts.filter(Boolean).join("\n\n") })); }
function parseJson(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
function parseJsonArray(text) {
  const t = String(text || "").replace(/```[a-z]*\n?/gi, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e <= s) return null;
  try { const a = JSON.parse(t.slice(s, e + 1)); return Array.isArray(a) ? a : null; } catch { return null; }
}
// Image generation on the USER'S Higgsfield (agentic; needs HIGGSFIELD in the granted tools).
const IMG_URL_RE = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp))|"(?:rawUrl|url|minUrl)"\s*:\s*"([^"]+)"/i;
async function genImage(promptText) {
  const instruction = `Use the Higgsfield generate_image tool to generate an image of: "${promptText}", aspect_ratio "16:9". Wait for it to finish (poll job status if needed), then reply with ONLY the final image URL on its own line.`;
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) { const t = (d.result.content ?? []).map((x) => x.text ?? "").join(""); const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
    else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
  return url;
}

// ==== house UI atoms ========================================================================
// Option cards: 2–4 options, exactly ONE recommended. opts: [{ id, label, text?, imageUrl?, recommended? }]
function optionCards(opts, selectedId, onPick) {
  const wrap = el("div", "opts");
  for (const o of opts) {
    const card = el("div", "opt" + (o.id === selectedId ? " sel" : ""));
    card.onclick = () => onPick(o);
    card.append(el("div", "check", "✓"));
    if (o.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", o.label));
    if (o.text) card.append(el("div", "o-text", o.text));
    if (o.imageUrl) { const img = el("img", "o-img"); img.src = o.imageUrl; img.alt = o.label; card.append(img); }
    wrap.append(card);
  }
  return wrap;
}
function researching(status) { const r = el("div", "researching"); r.append(el("div", "scan"), el("span", null, status || "working…")); return r; }
function steerRow(onSteer, chips) {
  const wrap = el("div", "steer");
  wrap.append(el("span", "kicker", "not quite? steer it"));
  const row1 = el("div", "chips");
  for (const s of (chips || STEER_CHIPS)) { const c = el("button", "chip", s); c.onclick = () => onSteer(s); row1.append(c); }
  wrap.append(row1);
  const row = el("div", "row");
  const box = el("div", "box");
  const input = el("input"); input.placeholder = "tell it what to change…";
  const send = () => { const t = input.value.trim(); if (!t) return; input.value = ""; onSteer(t); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  box.append(input);
  const btn = el("button", "send", "send"); btn.onclick = send;
  row.append(box, btn); wrap.append(row);
  return wrap;
}
function connectSteps() {
  const card = el("div", "steps-card");
  const steps = el("div", "steps");
  const s1 = el("div"); s1.innerHTML = notInstalled
    ? "<b>1</b> · Install Switchboard (button, top-right)"
    : "<b>1</b> · Connect Switchboard (top-right) — lends this page your Claude";
  const s2 = el("div"); s2.innerHTML = "<b>2</b> · One line in — the pipeline runs itself";
  const s3 = el("div"); s3.innerHTML = "<b>3</b> · Pick a card, steer anywhere, keep what you like";
  steps.append(s1, s2, s3);
  card.append(steps);
  return card;
}

// ==== APP LOGIC ═════════════════════════════════════════════════════════════════════════════
// Everything below is THIS wrapp. The sample shape is the house pipeline: ONE input → stage 1
// proposes angles (option cards, one recommended, auto-selected) → stage 2 produces the artifact
// from the selection, AUTOMATICALLY. Picking a different card or steering re-runs stage 2.
// Replace the prompts, stages, and final render; keep the shape (and the one-go auto-advance).

const STEER_CHIPS = ["punchier", "shorter", "another angle", "go deeper"];
let running = false;

function autostart() {
  // THE COLD OPEN — the single strongest selling moment: when a context is lent, the wrapp launches
  // its FULL workflow with ZERO input (no form, no prompt, no button). "Connect Switchboard, and
  // something is already happening — on your stuff." The value is on screen before the user types a
  // character. This is the demo. Fire ONLY when there's enough context to be unambiguously useful,
  // and never re-fire over a saved run.
  if (state.run) return;
  if (brand) { const seed = brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it the one line first.", true); return; }
  state.run = { id: uid(), input, angles: null, selectedId: null, steers: [], draft: "", status: "", error: null };
  await saveState(); render();
  await proposeAngles();
}

async function proposeAngles() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "finding the angles…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}. The user asked for: "${r.input}".`,
      brand ? `Active context (derive tone, audience, specifics from it): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
      'Propose 3 distinct angles. Return ONLY a JSON array — no prose, no fences. Each element: {"label":<3–5 word name>,"text":<one-sentence pitch>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no options came back — try again");
    r.angles = arr.slice(0, 4).map((o) => ({ id: uid(), label: String(o.label || "Option").slice(0, 60), text: String(o.text || "").slice(0, 300), recommended: !!o.recommended }));
    if (!r.angles.some((o) => o.recommended)) r.angles[0].recommended = true;
    r.selectedId = (r.angles.find((o) => o.recommended) || r.angles[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.angles && !r.error) await draftFrom(r.selectedId); // ONE-GO: auto-advance on the recommendation
}

async function draftFrom(id, steer) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  const angle = (r.angles || []).find((o) => o.id === id); if (!angle) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.draft = ""; r.status = "drafting…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}. Produce the deliverable for: "${r.input}".`,
        `Chosen angle: ${angle.label} — ${angle.text}`,
        brand ? `Context (match its voice exactly): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        "Tight, concrete, no filler. Markdown.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1500,
    }, (p) => { if (p.text) { r.draft = p.text; const live = $("draft-live"); if (live) live.innerHTML = mdLite(r.draft); } });
    r.draft = text.trim();
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) { view.append(connectSteps()); return; }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "working with your lent context — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — what should " + APP.name + " make?";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Go"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "run"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.angles) {
    col.append(el("div", "kicker sect", "the angle"));
    col.append(optionCards(r.angles, r.selectedId, (o) => void draftFrom(o.id)));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.angles ? void draftFrom(r.selectedId) : void proposeAngles());
    col.append(t);
  }
  if (r.draft) {
    col.append(el("div", "kicker sect", "the draft"));
    const m = el("div", "md"); m.id = "draft-live"; m.innerHTML = mdLite(r.draft);
    col.append(m);
    if (!running) col.append(steerRow((s) => void draftFrom(r.selectedId, s)));
  }
  view.append(col);
}
render();
