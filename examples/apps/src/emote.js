// Emote — one line describing a character → a whole PACK of transparent die-cut stickers of it,
// on the visitor's OWN Claude + Higgsfield. The operator holds no key, pays for no inference, and
// never sees the user's data — Switchboard brokers everything.
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
  id: "emote",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Emote",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Emote — draft sticker-pack styles from your character, then die-cut transparent stickers on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // generate_image → remove_background (the whole-connector wildcard)
    // contextKinds: ["brand"],                 // active() alone lends the mascot; no library listing needed
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
// Emote's one-go pipeline: ONE line describing a character → STAGE 1 proposes three pack STYLES as
// option cards (chunky-3D / kawaii / vaporwave…), each listing the six emotes it will contain, one
// recommended + auto-selected (a single cheap text stream — NEVER gated on an image). → STAGE 2
// die-cuts the six transparent stickers of the selected pack on the user's Higgsfield (per-emote
// generate_image → remove_background), sequentially, AFTER the cards are on screen. Picking a
// different pack renders its own six; steering re-draws the current pack.

const STEER_CHIPS = ["cuter", "thicker outline", "more chaotic", "another vibe"];
const N_EMOTES = 6;                              // stickers per pack
const FALLBACK_EMOTES = ["happy", "crying", "in love", "raging", "shook", "sleepy"];
let running = false;                             // stage-1 (pack proposal) stream guard
let genToken = 0;                                // stage-2 run token — a pack switch abandons stale sticker loops

function autostart() {
  // THE COLD OPEN — the strongest selling moment: a brand is lent, so with ZERO input Emote drafts a
  // sticker pack of that brand's MASCOT. No form, no prompt, no button — the pack styles are already
  // on screen, the recommended one already die-cutting. Fire only when the lent context is enough to
  // be unambiguously useful, and never re-fire over a saved run.
  if (state.run) return;
  if (brand) {
    const positioning = brand.data?.positioning || brand.data?.voice || brand.data?.vibe || "";
    const seed = `the ${brand.name} brand mascot` + (positioning ? ` — a character that embodies: ${positioning}` : "");
    void start(seed);
  }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Describe your character in one line first.", true); return; }
  state.run = { id: uid(), input, packs: null, selectedId: null, steers: [], stickers: {}, status: "", error: null };
  await saveState(); render();
  await proposePacks();
}

// STAGE 1 — three pack styles, each with its six emotes. One cheap text-only stream; the cards
// render off this alone, so headless verification of stage 1 never waits on Higgsfield.
async function proposePacks() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "sketching pack styles…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, an art director for die-cut sticker packs. The character is: "${r.input}".`,
      brand ? `Active brand context — keep the character's identity, colors and personality faithful to it: ${JSON.stringify(brand.data).slice(0, 1600)}` : "",
      `Propose exactly 3 DISTINCT visual pack styles for this character (e.g. chunky glossy 3D, flat kawaii, vaporwave chrome, sticker-book marker, pixel-art, papercut). Return ONLY a JSON array — no prose, no fences. Each element:`,
      `{"label":<2–4 word pack style name>,"style":<one concrete art-direction line: render style, linework, palette, finish>,"emotes":[exactly ${N_EMOTES} short single-word emotions, e.g. "happy","crying","in love","raging","shook","sleepy"],"recommended":<true for exactly one>}`,
    ]);
    if (!arr || !arr.length) throw new Error("no pack styles came back — try again");
    r.packs = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Sticker pack").slice(0, 48),
      style: String(o.style || "").slice(0, 240),
      emotes: coerceEmotes(o.emotes),
      recommended: !!o.recommended,
    }));
    if (!r.packs.some((p) => p.recommended)) r.packs[0].recommended = true;
    r.selectedId = (r.packs.find((p) => p.recommended) || r.packs[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.packs && !r.error) void makePack(r.selectedId); // ONE-GO: auto-advance to die-cutting the recommendation
}

function coerceEmotes(v) {
  const arr = (Array.isArray(v) ? v : []).map((s) => String(s || "").trim().toLowerCase().slice(0, 16)).filter(Boolean);
  const out = [];
  for (const e of arr) { if (!out.includes(e)) out.push(e); if (out.length === N_EMOTES) break; }
  for (const f of FALLBACK_EMOTES) { if (out.length === N_EMOTES) break; if (!out.includes(f)) out.push(f); }
  return out.slice(0, N_EMOTES);
}

// Pick a pack: if its stickers aren't drawn yet, die-cut them. Already-drawn packs just re-show.
function pickPack(id) {
  const r = state.run; if (!r) return;
  r.selectedId = id; void saveState(); render();
  const done = (r.stickers[id] || []).some((s) => s && s.status === "done");
  if (!done) void makePack(id);
}

// STAGE 2 — die-cut the selected pack's six transparent stickers, sequentially, on the user's
// Higgsfield (generate_image → remove_background per emote). Each tile resolves to an image or a
// retryable error tile; a pack switch bumps genToken and abandons the stale loop mid-flight.
async function makePack(id, { steer } = {}) {
  const r = state.run; if (!r || !relay) return;
  const pack = (r.packs || []).find((p) => p.id === id); if (!pack) return;
  if (steer) r.steers.push(steer);
  const run = ++genToken;
  r.error = null;
  r.stickers[id] = pack.emotes.map((emote) => ({ emote, status: "queued", url: "", error: null }));
  await saveState(); render();
  for (let i = 0; i < pack.emotes.length; i++) {
    if (run !== genToken) return;                // superseded by a newer pack/steer — drop this loop
    await drawSticker(id, i, run);
  }
}

async function drawSticker(packId, i, run) {
  const r = state.run; if (!r) return;
  const pack = (r.packs || []).find((p) => p.id === packId); if (!pack) return;
  const cells = r.stickers[packId]; if (!cells || !cells[i]) return;
  cells[i].status = "gen"; cells[i].error = null; render();
  try {
    const url = await genSticker(pack, cells[i].emote);
    if (run !== genToken) return;
    if (!url) throw new Error("no image came back");
    cells[i].url = url; cells[i].status = "done";
  } catch (e) {
    if (run !== genToken) return;
    cells[i].status = "err"; cells[i].error = msg(e);
  } finally {
    if (run === genToken) { await saveState(); render(); }
  }
}

// One emote sticker on the user's Higgsfield: generate the art, then remove_background to make it a
// transparent die-cut PNG. Agentic (the tool dance + poll happens on the user's Claude).
async function genSticker(pack, emote) {
  const r = state.run;
  const steer = r && r.steers.length ? ` Additional direction: ${r.steers.map((s) => `"${s}"`).join(", ")}.` : "";
  const instruction =
    `Use the Higgsfield generate_image tool to generate a single die-cut sticker of this character: "${r.input}". ` +
    `The character is clearly feeling "${emote}" (pose + facial expression must read that emotion unmistakably). ` +
    `Art style: ${pack.style}. Bold clean shapes, a thick solid white sticker border around the silhouette, the character centered on a plain flat solid-color background, no text, no logos, no watermark, aspect_ratio "1:1".${steer} ` +
    `THEN call the Higgsfield remove_background tool on that generated image so the sticker has a fully TRANSPARENT background. ` +
    `Poll job status until each step is done, then reply with ONLY the final transparent PNG image URL on its own line.`;
  let url = null, acc = "";
  for await (const d of relay.stream({ prompt: instruction, agentic: true })) {
    if (d.type === "tool_result" && d.result?.ok) {
      const t = (d.result.content ?? []).map((x) => x.text ?? "").join("");
      const m = t.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; // last successful tool URL wins (remove_background is last)
    } else if (d.type === "text") acc += d.text;
    else if (d.type === "error") throw new Error(d.error.message);
  }
  if (!url) { const m = acc.match(IMG_URL_RE); if (m) url = m[1] || m[2] || m[0]; }
  return url;
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
    input.placeholder = "one line — describe your character or mascot";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Make pack"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "character"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { genToken++; state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.packs) {
    col.append(el("div", "kicker sect", "the pack style"));
    col.append(packCards(r.packs, r.selectedId, (p) => pickPack(p.id)));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.packs ? void makePack(r.selectedId) : void proposePacks());
    col.append(t);
  }

  // STAGE 2 — the sticker grid for the selected pack (the artifact).
  const pack = (r.packs || []).find((p) => p.id === r.selectedId);
  const cells = pack ? r.stickers[pack.id] : null;
  if (pack && cells) {
    const done = cells.filter((c) => c.status === "done").length;
    const pbar = el("div", "packbar");
    pbar.append(el("span", "kicker", "the pack"));
    pbar.append(el("span", "pack-prog", done + "/" + cells.length + " die-cut"));
    col.append(pbar);
    col.append(stickerGrid(pack, cells));
    const anyBusy = cells.some((c) => c.status === "gen" || c.status === "queued");
    if (!anyBusy) col.append(steerRow((s) => void makePack(pack.id, { steer: s })));
  }
  view.append(col);
}

// Pack option cards — the house .opt atom, extended with an emote-chip row so the card shows the
// six emotes it will die-cut. Keeps class "opt" so the option-card contract (and harness) hold.
function packCards(packs, selectedId, onPick) {
  const wrap = el("div", "opts");
  for (const p of packs) {
    const card = el("div", "opt" + (p.id === selectedId ? " sel" : ""));
    card.onclick = () => onPick(p);
    card.append(el("div", "check", "✓"));
    if (p.recommended) card.append(el("div", "rec", "recommended"));
    card.append(el("div", "o-label", p.label));
    if (p.style) card.append(el("div", "o-text", p.style));
    const row = el("div", "emote-row");
    for (const e of p.emotes) row.append(el("span", "emote-chip", e));
    card.append(row);
    wrap.append(card);
  }
  return wrap;
}

function stickerGrid(pack, cells) {
  const grid = el("div", "pack-grid");
  cells.forEach((c, i) => grid.append(stickerTile(pack, c, i)));
  return grid;
}

function stickerTile(pack, c, i) {
  const tile = el("div", "sticker" + (c.status === "err" ? " err" : ""));
  if (c.status === "done" && c.url) {
    const img = el("img"); img.src = c.url; img.alt = c.emote + " sticker"; img.loading = "lazy";
    img.addEventListener("error", () => { c.status = "err"; c.error = "the image link expired"; render(); });
    tile.append(img);
    const actions = el("div", "st-actions");
    const dl = el("a", "st-act", "⬇"); dl.href = c.url; dl.target = "_blank"; dl.rel = "noopener"; dl.title = "open / download";
    dl.addEventListener("click", (e) => e.stopPropagation());
    const re = el("button", "st-act", "↺"); re.title = "regenerate this sticker";
    re.addEventListener("click", (e) => { e.stopPropagation(); void drawSticker(pack.id, i, genToken); });
    actions.append(dl, re);
    tile.append(actions);
    tile.append(el("div", "emote-tag", c.emote));
  } else if (c.status === "err") {
    const fail = el("div", "st-fail");
    fail.append(el("span", null, c.emote + " — " + (c.error || "failed")));
    const retry = el("button", "st-retry", "retry");
    retry.addEventListener("click", () => void drawSticker(pack.id, i, genToken));
    fail.append(retry);
    tile.append(fail);
  } else {
    tile.append(el("div", "st-scan"));
    tile.append(el("div", "emote-tag", c.emote));
  }
  return tile;
}
render();
