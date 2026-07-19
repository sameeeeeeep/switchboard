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
  id: "petrait",                                // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Petrait",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Petrait — dream up regal portrait concepts of your pet and paint them on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // the whole-connector wildcard — image generation lives here
    // contextKinds: ["brand"],                 // only if the app lists the user's contexts of a kind
  },
  usesContext: "single",                        // "single" = consumes one lent context (the brand mascot as sitter)
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

// Petrait's pipeline: ONE line about your pet → stage 1 dreams up 3 regal portrait CONCEPTS as
// option cards (renaissance oil / astronaut / boardroom CEO / crowned royalty, exactly one ★) →
// stage 2 paints the chosen one on the user's Higgsfield. Stage 1 is a single cheap text stream and
// NEVER waits on an image; painting is a separate per-card action (1 portrait = 1 consent), auto-
// fired once for the recommended concept so the artifact is on screen with zero clicks (one-go).
const STEER_CHIPS = ["more regal", "sillier", "different setting", "another archetype"];
const PORTRAIT_ASPECT = "2:3"; // vertical — a portrait hangs tall
let running = false;           // stage-1 (concept) generation in flight

function autostart() {
  // THE COLD OPEN — the strongest selling moment: when a brand is lent, Petrait sits its MASCOT for
  // a portrait with ZERO input. Connect Switchboard and a regal oil painting of your brand's
  // character is already being dreamt up — no form, no prompt, no button. Fire only when the lent
  // context is unambiguously useful, and never re-fire over a saved run.
  if (state.run) return;
  if (brand) void start(seedFromBrand(brand));
}

// A brand becomes a sitter: its mascot/character is the "pet". The one-liner seeds the pipeline; the
// full brand data still rides along in the prompt so the palette and vibe steer the portrait.
function seedFromBrand(b) {
  const pos = b.data?.positioning || b.data?.voice || b.data?.tagline || "";
  return `the ${b.name} mascot as a regal pet` + (pos ? ` — ${String(pos).slice(0, 120)}` : "");
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Describe your pet in one line first.", true); return; }
  state.run = { id: uid(), input, concepts: null, selectedId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeConcepts();
}

// STAGE 1 — a single text-only stream that returns portrait CONCEPTS. No tools, no image call: the
// cards render the instant this resolves (the reliability contract — stage 1 never gates on Higgsfield).
async function proposeConcepts(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "dreaming up portrait concepts…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a court painter who turns ordinary pets into portraits fit for a palace wall.`,
      `The pet: "${r.input}".`,
      brand ? `The pet stands in for this brand — fold its palette, voice and character into every concept: ${JSON.stringify(brand.data).slice(0, 1600)}` : "",
      r.steers.length ? `Steering (honour the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Invent 3 distinct portrait CONCEPTS across different regal archetypes — draw from: a Renaissance oil painting in aristocratic dress, an astronaut in a spacesuit, a power-suited boardroom CEO, a crowned monarch in royal regalia, a Baroque general, a Victorian aristocrat. Keep the pet unmistakably ITSELF (same species, markings, colours, expression) — only the costume and setting change.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<2–4 word archetype name, e.g. "Renaissance Oil">,"text":<one playful sentence describing the portrait>,"imagePrompt":<a complete text-to-image prompt: the pet, its costume, setting, lighting, painting/photo style, mood — no text, no words, no watermarks in the image>,"recommended":<true for EXACTLY one — the one that fits this pet best>}',
    ]);
    if (!arr || !arr.length) throw new Error("no concepts came back — try again");
    r.concepts = arr.slice(0, 4).map((o) => ({
      id: uid(),
      label: String(o.label || "Portrait").slice(0, 60),
      text: String(o.text || "").slice(0, 300),
      imagePrompt: String(o.imagePrompt || o.text || "").slice(0, 700),
      recommended: !!o.recommended,
      imageUrl: null, painting: false, imgError: null,
    }));
    if (!r.concepts.some((o) => o.recommended)) r.concepts[0].recommended = true;
    r.selectedId = (r.concepts.find((o) => o.recommended) || r.concepts[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  // ONE-GO: auto-advance to the artifact by painting the recommended concept (unless it already hangs).
  if (r.concepts && !r.error) {
    const rec = r.concepts.find((o) => o.id === r.selectedId);
    if (rec && !rec.imageUrl && !rec.painting) void paintPortrait(rec.id);
  }
}

// STAGE 2 — paint ONE concept on the user's Higgsfield. Separate from stage 1, one portrait per call
// (1 generation = 1 consent). The agentic loop mirrors studio.js/imagegen.js; a vertical aspect and
// a live status keep it honest. The card is always resolved — a portrait, or an error with retry.
async function paintPortrait(id, opts = {}) {
  const r = state.run; if (!r || !relay) return;
  const c = (r.concepts || []).find((o) => o.id === id); if (!c) return;
  if (c.painting) return;
  c.painting = true; c.imgError = null; if (opts.repaint) c.imageUrl = null;
  render();
  const instruction =
    `Use the Higgsfield generate_image tool to paint this portrait: "${c.imagePrompt}", ` +
    `aspect_ratio "${PORTRAIT_ASPECT}". Keep the animal unmistakably itself — same species, markings and expression. ` +
    `Wait for it to finish (poll the job status if needed), then reply with ONLY the final image URL on its own line.`;
  try {
    let url = null, acc = "";
    for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
      if (d.type === "tool_result" && d.result?.ok) {
        const t = (d.result.content ?? []).map((x) => x.text ?? "").join("");
        const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0];
      } else if (d.type === "text") { acc += d.text; }
      else if (d.type === "error") { throw new Error(d.error?.message || "the painting was blocked"); }
    }
    if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
    if (!url) throw new Error("no portrait came back — retry usually lands on the second pass");
    c.imageUrl = url;
  } catch (e) { c.imgError = msg(e); }
  finally { c.painting = false; await saveState(); render(); }
}

// ==== render ================================================================================
// Portrait card: the house option atom, extended with a gilt-framed image, a paint/repaint action,
// and per-card painting status + error. Clicking an unpainted card selects AND paints it (a
// deliberate consent); the recommended one paints itself once via the one-go auto-advance.
function portraitCards(concepts, selectedId, onPick, onPaint) {
  const wrap = el("div", "opts");
  for (const c of concepts) {
    const card = el("div", "opt" + (c.id === selectedId ? " sel" : ""));
    card.onclick = () => onPick(c);
    card.append(el("div", "check", "✓"));
    if (c.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", c.label));
    if (c.text) card.append(el("div", "o-text", c.text));
    if (c.imageUrl) {
      const img = el("img", "o-img"); img.src = c.imageUrl; img.alt = c.label; img.loading = "lazy";
      img.addEventListener("error", () => { c.imageUrl = null; c.imgError = "the portrait link expired"; void saveState(); render(); });
      card.append(img);
    }
    if (c.painting) card.append(researching("painting the portrait on your Higgsfield…"));
    else if (c.imgError) card.append(el("div", "err", c.imgError));
    if (!c.painting) {
      const actions = el("div", "portrait-actions");
      const paint = el("button", "act paint", c.imageUrl ? "↻ repaint" : (c.imgError ? "try again" : "🖌 paint portrait"));
      paint.onclick = (e) => { e.stopPropagation(); void onPaint(c.id, { repaint: !!c.imageUrl }); };
      actions.append(paint);
      if (c.imageUrl) {
        const dl = el("a", "act"); dl.textContent = "open full size"; dl.href = c.imageUrl; dl.target = "_blank"; dl.rel = "noreferrer";
        dl.onclick = (e) => e.stopPropagation();
        actions.append(dl);
      }
      card.append(actions);
    }
    wrap.append(card);
  }
  return wrap;
}

function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) { view.append(connectSteps()); return; }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "working with your lent context — " + brand.name + "'s mascot sits for a portrait"));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line about your pet — e.g. a grumpy orange tabby named Biscuit";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Paint"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "sitter"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ new pet");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.concepts) {
    col.append(el("div", "kicker sect", "the concepts"));
    // Selecting an unpainted concept paints it (deliberate per-portrait consent); repaint via its button.
    col.append(portraitCards(r.concepts, r.selectedId, (c) => {
      r.selectedId = c.id; void saveState(); render();
      if (!c.imageUrl && !c.painting) void paintPortrait(c.id);
    }, (id, o) => void paintPortrait(id, o)));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeConcepts();
    col.append(t);
  }
  if (r.concepts && !running) col.append(steerRow((s) => void proposeConcepts(s)));
  view.append(col);
}
render();
