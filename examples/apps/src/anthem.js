// ANTHEM — one line → a full original song, on the visitor's OWN Claude. The operator holds no key,
// pays for no inference, and never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app pipeline. Everything between here and the "APP LOGIC"
// line is proven idiom (distilled from redline.js) — keep it byte-identical. Edit the CONFIG block
// and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "anthem",                                 // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Anthem",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Anthem — writes an original song (lyrics + a copy-ready generation prompt) on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only for reliability; audio generation is a Pro extension
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
// ANTHEM — ONE line (a person, a moment, or a brand) → stage 1 proposes 3 SONG CONCEPTS as option
// cards (genre + hook + mood, one recommended, auto-selected) → stage 2 writes the FULL song from
// the pick: structured lyrics (verse/chorus/bridge) + a copy-ready "Suno-style" generation prompt
// (genre, BPM, instruments, vocal style), streamed as markdown. Picking a different concept or
// steering re-writes the song. Text-only for reliability — actual audio rendering is a Pro extension.

const STEER_CHIPS = ["more anthemic", "make it a ballad", "punch up the hook", "add a bridge"];
let running = false;

function autostart() {
  // THE COLD OPEN — the single strongest selling moment: when a brand context is lent, Anthem writes
  // that brand its anthem with ZERO input (no form, no prompt, no button). "Connect Switchboard, and
  // a song about your company is already being written." The value is on screen before the user types
  // a character. Fire ONLY when the lent context makes it unambiguously useful; never re-fire over a
  // saved run.
  if (state.run) return;
  if (brand) {
    const seed = "an anthem for " + brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : "");
    void start(seed);
  }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it one line first — a person, a moment, a brand.", true); return; }
  state.run = { id: uid(), input, concepts: null, selectedId: null, steers: [], song: "", status: "", error: null };
  await saveState(); render();
  await proposeConcepts();
}

async function proposeConcepts() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "tuning up — sketching concepts…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a songwriter. Someone wants an original song about: "${r.input}".`,
      brand ? `Active context (derive who/what the song is about, its voice, its specifics, from this): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
      "Propose 3 genuinely DISTINCT song concepts — different genres and emotional registers, not variations on one idea. For each: a genre/style, a central HOOK (the one line the chorus turns on), and the mood.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the genre/style, 2-5 words e.g. "Stadium synth-pop">,"hook":<the central hook line, in quotes it could actually sing>,"mood":<2-4 word mood>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no concepts came back — try again");
    r.concepts = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Concept").slice(0, 60),
      hook: String(o.hook || "").slice(0, 200),
      mood: String(o.mood || "").slice(0, 40),
      text: [String(o.mood || "").trim(), String(o.hook || "").trim()].filter(Boolean).join(" · ").slice(0, 300),
      recommended: !!o.recommended,
    }));
    if (!r.concepts.some((o) => o.recommended)) r.concepts[0].recommended = true;
    r.selectedId = (r.concepts.find((o) => o.recommended) || r.concepts[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.concepts && !r.error) await writeSong(r.selectedId); // ONE-GO: auto-advance on the recommendation
}

async function writeSong(id, steer) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  const c = (r.concepts || []).find((o) => o.id === id); if (!c) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.song = ""; r.status = "writing the song…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}, a songwriter. Write a complete, ORIGINAL song about: "${r.input}".`,
        `Chosen concept — Genre/style: ${c.label}. Mood: ${c.mood || "—"}. Central hook: ${c.hook || "—"}. Build the chorus around that hook.`,
        brand ? `Context (make it specific and true to this — real details, its voice; never invent facts about it): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        "Write 100% original lyrics — never quote or pastiche any existing song. Structure it fully with section labels.",
        "Output EXACTLY this markdown, nothing before or after:",
        "## <song title>",
        "**[Verse 1]**\\n<4-8 lines>\\n\\n**[Pre-Chorus]** (optional)\\n<2-4 lines>\\n\\n**[Chorus]**\\n<4-6 lines, built on the hook>\\n\\n**[Verse 2]**\\n<4-8 lines>\\n\\n**[Chorus]**\\n<repeat or evolve>\\n\\n**[Bridge]**\\n<2-4 lines that turn the emotion>\\n\\n**[Final Chorus]**\\n<the payoff>",
        "Then a horizontal rule (---), then:",
        "**Generation prompt** (copy-ready, Suno-style — one paragraph): a vivid production brief naming the **genre**, **BPM**, key **instruments**, **vocal style/gender**, and overall **energy**. Write it so it can be pasted straight into a music generator.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2000,
    }, (p) => { if (p.text) { r.song = p.text; const live = $("song-live"); if (live) live.innerHTML = mdLite(r.song); } });
    r.song = text.trim();
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

async function copySong() {
  const r = state.run; if (!r || !r.song) return;
  try { await navigator.clipboard.writeText(r.song); toast("Song + prompt copied ✓"); }
  catch { toast("Couldn't copy.", true); }
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
    if (brand) startBox.append(el("div", "ctx", "your lent context is on deck — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — a person, a moment, or a brand to write a song about";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Write it ▸"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "writing"), el("span", "run-input", r.input), el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copySong(); cp.disabled = !r.song;
  const redo = el("button", "act", "× new");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(cp, redo);
  col.append(bar);

  if (r.concepts) {
    col.append(el("div", "kicker sect", "the concept"));
    col.append(optionCards(r.concepts, r.selectedId, (o) => void writeSong(o.id)));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.concepts ? void writeSong(r.selectedId) : void proposeConcepts());
    col.append(t);
  }
  if (r.song) {
    col.append(el("div", "kicker sect", "the song"));
    const m = el("div", "md song"); m.id = "song-live"; m.innerHTML = mdLite(r.song);
    col.append(m);
    if (!running) {
      col.append(steerRow((s) => void writeSong(r.selectedId, s)));
      col.append(el("div", "pro-note", "Text-only for reliability. One-click audio rendering is a Pro extension."));
    }
  }
  view.append(col);
}
render();
