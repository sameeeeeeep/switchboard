// Arcade — one line → a PLAYABLE game you keep, generated on the visitor's OWN Claude. The operator
// holds no key, pays for no inference, and never sees the user's data — Switchboard brokers it all.
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
  id: "arcade",                                 // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Arcade",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Arcade — turn one line into a playable game, built on your own Claude.",
    models: ["sonnet"],
    tools: [],                                  // text/markup only — no tools; the game is a self-contained .html
    // contextKinds: ["brand"],                 // active() is enough for the cold open — no listing UI
  },
  usesContext: "single",                        // consumes one lent context — brand becomes the hero, products the pickups
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
// Arcade's pipeline: ONE line (or ZERO — cold open off a lent brand) → STAGE 1 pitches 3 game
// concepts as option cards (title/genre/twist, one recommended, auto-selected) → STAGE 2 generates
// the FULL playable game as a single self-contained .html and runs it in a SANDBOXED iframe
// (allow-scripts only → opaque origin; the model-written code can NEVER touch window.claude —
// the airgap holds even for code the user's own Claude just wrote). Picking another card or
// steering re-generates the game. Any "regenerate" is a fresh stage-2 pull on the same pick.

const GENRES = ["endless runner", "flappy", "platformer", "brick-breaker", "dodge", "snake-like", "shooter", "puzzle"];
const STEER_CHIPS = ["make it harder", "juicier / more particles", "faster pace", "brighter palette", "add a boss", "simpler controls"];
let running = false;

// The system prompt is a tuned contract — copied in spirit from cartridge.js, the proven forge.
const GAME_SYSTEM = `You are Arcade, an expert HTML5 game developer. You produce COMPLETE, self-contained playable games in a SINGLE html file.

Hard requirements — every one matters:
- ONE complete html document: inline <style> and <script>, canvas-based (2D context), NO external URLs of any kind (no CDNs, fonts, images, audio files — draw everything on canvas, synthesize any sound with WebAudio).
- The generated code MUST NOT reference window.parent, window.top, window.claude, postMessage, fetch, XMLHttpRequest, localStorage, or any network/storage API. It is a pure offline game.
- Playable immediately: a brief title screen shows the controls, then the game starts on the first key/tap.
- Controls: keyboard (arrows/WASD + space) AND touch (tap/drag) — both must work.
- Core loop: requestAnimationFrame, delta-time movement, a visible score, and a lose/win state with a "play again" that fully resets.
- Juice: particles, hit flashes, subtle screen shake, a little WebAudio blip on events. Small file, big feel.
- The page never scrolls; the canvas scales to fit its frame (letterboxed) and stays crisp.
- No console errors. No TODOs. No placeholder comments — finished code only.
- Keep it TIGHT: one perfect mechanic beats three rough ones. Target under ~350 lines — ship the smallest game that feels great.

Respond with ONLY the html document. No prose, no markdown fences.`;

// Pre-connect, honest sample pitches — visibly labeled, gone the moment a context lands.
const SAMPLE_PITCHES = [
  { label: "Lantern Thief", genre: "dodge", text: "A tiny ninja dodges shuriken storms and snatches lanterns.", twist: "each lantern makes the night darker", recommended: true },
  { label: "Moth Rush", genre: "endless runner", text: "Sprint a moth toward streetlights without burning up.", twist: "light both heals and hurts" },
  { label: "Decaf Doom", genre: "shooter", text: "Defend the last coffee machine from Monday meetings.", twist: "bosses send calendar invites" },
];

function autostart() {
  // THE COLD OPEN — the single strongest selling moment. The moment a brand is lent, Arcade pitches
  // a game STARRING that brand with ZERO input: the brand.name becomes the hero, its products become
  // the collectibles. No form, no prompt, no button — a game is already being designed on your stuff.
  // Fire only when the lent context is unambiguously useful; never re-fire over a saved run.
  if (state.run) return;
  if (brand) void start("", { fromContext: true });
}

// The lent context, distilled for the prompt: the hero + the pickups + the vibe.
function contextBrief() {
  if (!brand) return "";
  const d = brand.data || {};
  const products = Array.isArray(d.products) ? d.products : [];
  const pickups = products.map((p) => (typeof p === "string" ? p : (p?.name || p?.title || ""))).filter(Boolean).slice(0, 6);
  return [
    `The game must STAR "${brand.name}" as the playable hero.`,
    pickups.length ? `Its products are the collectibles/pickups: ${pickups.join(", ")}.` : "",
    d.positioning ? `Brand positioning (set the mood): ${String(d.positioning).slice(0, 240)}` : "",
    Array.isArray(d.palette) && d.palette.length ? `Use this palette: ${d.palette.slice(0, 5).join(", ")}.` : "",
    d.voice ? `Tone of the title screen and copy: ${String(d.voice).slice(0, 200)}` : "",
  ].filter(Boolean).join("\n");
}

async function start(input, { fromContext = false } = {}) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input && !fromContext) { toast("Give it one line — the game idea.", true); return; }
  state.run = { id: uid(), input, fromContext, pitches: null, selectedId: null, steers: [], html: "", title: "", status: "", error: null };
  await saveState(); render();
  await proposePitches();
}

async function proposePitches() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "designing your game…"; render();
  try {
    const arr = await askJsonArray([
      "You are Arcade's attract-mode designer: you pitch tiny single-screen HTML5 arcade games people instantly want to play. Punchy, playful, specific — never generic.",
      r.input ? `The player asked for: "${r.input}".` : "The player gave no brief — invent something irresistible from the context below.",
      r.fromContext && brand ? `Design every pitch to STAR the lent brand:\n${contextBrief()}` : "",
      "Invent 3 wildly different game concepts.",
      'Return ONLY a JSON array of exactly 3 objects, each: {"label":"1-3 word arcade title","genre":one of ' + JSON.stringify(GENRES) + ',"text":"one line — what you DO in the game (max 140 chars)","twist":"one signature mechanic twist","recommended":<true for exactly one — the one you\'d fire up first>}. No prose, no fences.',
    ]);
    if (!arr || !arr.length) throw new Error("no pitches came back — try again");
    r.pitches = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Untitled").slice(0, 40),
      genre: GENRES.includes(o.genre) ? o.genre : "arcade",
      text: String(o.text || "").slice(0, 200),
      twist: String(o.twist || "").slice(0, 160),
      recommended: !!o.recommended,
    }));
    if (!r.pitches.some((o) => o.recommended)) r.pitches[0].recommended = true;
    r.selectedId = (r.pitches.find((o) => o.recommended) || r.pitches[0]).id;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.pitches && !r.error) await buildFrom(r.selectedId); // ONE-GO: auto-build the recommended pitch
}

// Option cards carry genre + twist under the pitch line — so the pick reads like a real game concept.
function pitchCards(pitches, selectedId, onPick) {
  return optionCards(pitches.map((p) => ({
    id: p.id,
    label: p.label,
    text: p.text + (p.twist ? "\n\ntwist: " + p.twist : "") + "\n\n" + p.genre,
    recommended: p.recommended,
  })), selectedId, onPick);
}

function extractHtml(text) {
  let t = String(text).replace(/```(?:html)?/gi, "").trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  const end = t.lastIndexOf("</html>");
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + "</html>".length);
}
function titleOf(html, fallback) {
  const m = /<title>([^<]{1,60})<\/title>/i.exec(html);
  return (m && m[1].trim()) || fallback;
}

async function buildFrom(id, steer) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  const pitch = (r.pitches || []).find((o) => o.id === id); if (!pitch) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.html = ""; r.status = "building the game… (0 kb)"; render();
  let acc = "";
  try {
    const text = await streamText({
      prompt: [
        `Make this game: ${pitch.text}`,
        `Title: ${pitch.label}. Genre: ${pitch.genre}.`,
        pitch.twist ? `Signature twist (make it central to the design): ${pitch.twist}` : "",
        r.fromContext && brand ? contextBrief() : "",
        r.steers.length ? `Apply these changes in order (latest wins): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        `Put the title "${pitch.label}" in the <title> tag and on the title screen.`,
      ].filter(Boolean).join("\n"),
      system: GAME_SYSTEM,
      maxTokens: 16000,
    }, (p) => {
      if (p.text) {
        acc = p.text;
        const s = $("build-status");
        if (s) s.textContent = "building the game… (" + (acc.length / 1024).toFixed(1) + " kb)";
      }
    });
    const html = extractHtml(text);
    if (!html) throw new Error("the model didn't return a complete game — hit ↻ regenerate (it usually lands on the second pull)");
    r.html = html;
    r.title = titleOf(html, pitch.label);
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Download the generated game as a standalone .html the user keeps.
function downloadGame() {
  const r = state.run; if (!r || !r.html) return;
  const blob = new Blob([r.html], { type: "text/html" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  const slug = (r.title || "arcade").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.download = (slug || "arcade-" + r.id) + ".html";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "samples");
    s.append(el("div", "kicker sect", "sample pitches — connect to make one real"));
    s.append(optionCards(SAMPLE_PITCHES.map((p) => ({
      id: p.label, label: p.label, text: p.text + "\n\ntwist: " + p.twist + "\n\n" + p.genre, recommended: p.recommended,
    })), null, () => toast("Connect Switchboard (top right) to build it on your own Claude.")));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "starring your lent context — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = brand ? "one line, or just hit Go to star " + brand.name : "one line — the game idea (e.g. a penguin surfing melting icebergs)";
    const go = () => void start(input.value, { fromContext: !input.value.trim() && !!brand });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", brand ? "Make it" : "Make the game"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "game"), el("span", "run-input", r.input || (brand ? "starring " + brand.name : "surprise me")));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.pitches) {
    col.append(el("div", "kicker sect", "pick a concept"));
    col.append(pitchCards(r.pitches, r.selectedId, (o) => void buildFrom(o.id)));
  }
  if (r.status) { const w = researching(r.status); const live = w.querySelector("span"); if (live) live.id = "build-status"; col.append(w); }
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.pitches ? void buildFrom(r.selectedId) : void proposePitches());
    col.append(t);
  }
  if (r.html && !running) {
    const head = el("div", "cab-head");
    head.append(el("div", "cab-title", (r.title || "your game").toUpperCase()));
    const acts = el("div", "cab-acts");
    const regen = el("button", "act", "↻ regenerate");
    regen.onclick = () => void buildFrom(r.selectedId);
    const restart = el("button", "act", "▶ restart");
    const dl = el("button", "act", "↓ keep .html");
    dl.onclick = downloadGame;
    acts.append(regen, restart, dl);
    head.append(acts);
    col.append(el("div", "kicker sect", "your game — runs sandboxed, right here"));
    col.append(head);

    // SANDBOX: allow-scripts ONLY → opaque origin. The model-written game can't reach window.claude,
    // this page's storage, or its grant. Exactly the cartridge.js airgap.
    const frame = el("iframe", "stage");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", r.title || "your generated game");
    frame.srcdoc = r.html;
    restart.onclick = () => { frame.srcdoc = r.html; };
    col.append(frame);
    col.append(steerRow((s) => void buildFrom(r.selectedId, s)));
  }
  view.append(col);
}
render();
