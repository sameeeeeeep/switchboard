// Inkling — one idea → three tattoo flash designs, on the visitor's OWN Claude. The operator holds
// no key, pays for no inference, and never sees the user's data — Switchboard brokers everything.
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
  id: "inkling",                                // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Inkling",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Inkling — turn one tattoo idea into three flash concepts and render the line art on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // agentic line-art generation on the user's own Higgsfield
    // contextKinds: ["brand"],                 // brand is lent via context.active(); no library listing needed
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

// Inkling's pipeline: ONE line (the idea + placement) → stage 1 proposes 3 flash CONCEPTS as option
// cards, one per style (fine-line / american-traditional / blackwork), exactly one recommended and
// auto-selected → stage 2 renders that concept's line art on the user's Higgsfield, AUTOMATICALLY.
// Picking or steering re-runs stage 2 for that card. Stage 1 is a single askJsonArray text stream —
// it NEVER waits on an image call; every image is a separate per-card render behind the same idiom.
const STYLES = ["fine-line", "american-traditional", "blackwork"];
const STEER_CHIPS = ["finer line", "bolder & heavier", "more ornamental", "simpler & smaller", "more negative space"];
let running = false;      // stage-1 concept stream in flight

function autostart() {
  // THE COLD OPEN — when a brand is lent, Inkling designs a tattoo derived from that brand with ZERO
  // input: no form, no prompt. Connect Switchboard and three flash concepts of YOUR mark are already
  // being drawn. Fire only when the lent context is unambiguously useful; never re-fire over a saved
  // run (one-go doctrine keeps it interruptible).
  if (state.run) return;
  if (brand) {
    const pos = brand.data?.positioning || brand.data?.voice || brand.data?.vibe || "";
    const seed = `A tattoo emblem inspired by the brand "${brand.name}"${pos ? " — " + pos : ""}, as a small forearm piece`;
    void start(seed, { fromBrand: true });
  }
}

async function start(input, opts = {}) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it the one line — the idea and where it goes.", true); return; }
  state.run = { id: uid(), input, fromBrand: !!opts.fromBrand, concepts: null, selectedId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeConcepts();
}

async function proposeConcepts() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "sketching three flash concepts…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a tattoo flash artist. The client's idea (and placement/size): "${r.input}".`,
      r.fromBrand && brand ? `This is derived from a brand — distil its identity into a wearable emblem, not a literal logo. Brand context: ${JSON.stringify(brand.data).slice(0, 1500)}` : "",
      r.steers.length ? `Design steering to honour: ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      `Propose exactly 3 distinct flash concepts, ONE in each of these styles: ${STYLES.join(", ")}.`,
      'Return ONLY a JSON array — no prose, no fences. Each element:',
      '{"style":<one of fine-line|american-traditional|blackwork>,"label":<2–4 word design name>,"text":<one-sentence description of the composition and why it works at that placement>,"imagePrompt":<a complete, detailed text-to-image prompt for clean tattoo flash: name the subject and every element, the linework weight for the style, isolated on a plain white background, pure black line art, high contrast, no color unless the style demands it, no lettering or watermark>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no concepts came back — try again");
    r.concepts = arr.slice(0, 3).map((o, i) => ({
      id: uid(),
      style: STYLES.includes(String(o.style || "").toLowerCase()) ? String(o.style).toLowerCase() : STYLES[i % STYLES.length],
      label: String(o.label || "Flash concept").slice(0, 60),
      text: String(o.text || "").slice(0, 260),
      imagePrompt: String(o.imagePrompt || o.text || r.input).slice(0, 700),
      recommended: !!o.recommended,
      imageUrl: null, imgStatus: "", imgError: null,
    }));
    if (!r.concepts.some((o) => o.recommended)) r.concepts[0].recommended = true;
    r.selectedId = (r.concepts.find((o) => o.recommended) || r.concepts[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  // ONE-GO: as soon as the cards are on screen, auto-render the recommended flash (stage 2). Image
  // generation is per-card and never gates the cards themselves.
  if (r.concepts && !r.error) void renderFlash(r.selectedId);
}

// Stage 2 — render ONE concept's line art on the user's Higgsfield. Runs after the cards exist;
// tracks its own per-card status so other cards stay interactive while one renders.
async function renderFlash(id) {
  const r = state.run; if (!r || !relay) return;
  const c = (r.concepts || []).find((o) => o.id === id); if (!c) return;
  r.selectedId = id;
  if (c.imgStatus === "rendering") { render(); return; }        // already in flight
  c.imgStatus = "rendering"; c.imgError = null; render();
  try {
    const prompt = flashPrompt(c, r);
    const url = await genImage(prompt);
    if (!url) throw new Error("no image came back — try render again");
    c.imageUrl = url; c.imgStatus = "done"; c.imgError = null;
  } catch (e) { c.imgStatus = "error"; c.imgError = msg(e); }
  await saveState(); render();
}

// Build the line-art generation prompt: the concept's own imagePrompt, hardened with the style's
// linework and the non-negotiable flash-sheet constraints (white ground, pure line, no text).
function flashPrompt(c, r) {
  const styleNote = c.style === "american-traditional"
    ? "American traditional tattoo flash: bold even outlines, limited flat classic palette, iconic bold-shaded forms"
    : c.style === "blackwork"
      ? "Blackwork tattoo flash: heavy solid black fills, strong negative space, high-contrast graphic silhouette, no grey shading"
      : "Fine-line tattoo flash: delicate thin single-weight linework, minimal, elegant, no heavy fills";
  return [
    c.imagePrompt,
    styleNote,
    r.steers.length ? `Honour this steering: ${r.steers.map((s) => `"${s}"`).join(", ")}` : "",
    "Presented as clean tattoo flash isolated dead-centre on a plain solid white background",
    "crisp high-contrast linework, no photo, no skin, no background scene, no lettering, no signature, no watermark",
  ].filter(Boolean).join(". ");
}

// steering re-draws the CONCEPTS (a new sketch honouring the note), then re-renders the recommended.
async function steerConcepts(note) {
  const r = state.run; if (!r || running) return;
  const t = String(note || "").trim(); if (!t) return;
  r.steers.push(t);
  await saveState();
  await proposeConcepts();
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
    if (brand) startBox.append(el("div", "ctx", "brand lent — connect fires a " + brand.name + " tattoo automatically, or type your own idea"));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — e.g. a crescent moon with a moth, small on the inner forearm";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Draw it"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "idea"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ new idea");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeConcepts();
    col.append(t);
  }

  if (r.concepts && r.concepts.length) {
    col.append(el("div", "kicker sect", "the flash"));
    col.append(flashCards(r));
    if (!running) col.append(steerRow((s) => void steerConcepts(s)));
  }
  view.append(col);
}

// Inkling's card atom: a concept (style + name + description) over a white line-art plate. The plate
// renders empty (with a per-card render button) until stage 2 fills it; the recommended one fires
// automatically. Clicking a card selects it and renders its flash if not yet drawn.
function flashCards(r) {
  const wrap = el("div", "flash");
  for (const c of r.concepts) {
    const card = el("div", "fcard" + (c.id === r.selectedId ? " sel" : ""));
    card.onclick = () => { if (c.imgStatus !== "rendering") void renderFlash(c.id); };

    const top = el("div", "ftop");
    top.append(el("span", "fstyle", c.style));
    if (c.recommended) top.append(el("span", "frec", "recommended"));
    card.append(top);
    card.append(el("div", "flabel", c.label));
    if (c.text) card.append(el("div", "ftext", c.text));

    const plate = el("div", "plate" + (c.imageUrl ? "" : " empty"));
    if (c.imageUrl) {
      const img = el("img"); img.src = c.imageUrl; img.alt = c.label; img.loading = "lazy";
      img.addEventListener("error", () => { c.imageUrl = null; c.imgStatus = "error"; c.imgError = "the image link expired — render again"; render(); });
      plate.append(img);
    } else if (c.imgStatus === "rendering") {
      const ph = el("div", "ph", "inking the line art…");
      const scan = el("div", "scan");
      plate.append(ph, scan);
    } else {
      plate.append(el("div", "ph", c.imgStatus === "error" ? "render didn't land" : "tap to render this flash"));
    }
    card.append(plate);

    if (c.imgError) card.append(el("div", "ferr", c.imgError));

    if (c.imageUrl) {
      const dl = el("a", "fdl", "open full-size ↗");
      dl.href = c.imageUrl; dl.target = "_blank"; dl.rel = "noreferrer";
      dl.onclick = (e) => e.stopPropagation();
      card.append(dl);
      const re = el("button", "fbtn ghost", "re-render");
      re.onclick = (e) => { e.stopPropagation(); void renderFlash(c.id); };
      card.append(re);
    } else {
      const btn = el("button", "fbtn", c.imgStatus === "error" ? "try render again" : "render flash");
      btn.disabled = c.imgStatus === "rendering";
      btn.onclick = (e) => { e.stopPropagation(); void renderFlash(c.id); };
      card.append(btn);
    }
    wrap.append(card);
  }
  return wrap;
}
render();
