// Cartridge — form → playable game, generated on the visitor's OWN Claude through Switchboard.
// The meta-wrapp: an app that manufactures apps. The generated game is a single self-contained
// .html artifact the user keeps. Generated code runs in a sandboxed iframe (opaque origin,
// allow-scripts only) — it can NEVER touch window.claude; the airgap holds even for code the
// user's own model just wrote.
import { whenRelayReady, mountConnect, BYOPErrorCode } from "@relay/sdk";

const $ = (id) => document.getElementById(id);
const INSTALL_URL = "https://thelastprompt.ai/switchboard/";

// State roams via relay.storage and is mirrored to localStorage, so an unconnected visit still
// restores instantly and a connected one adopts whichever side is newer.
const CART_KEY = "cartridge:cart";      // { at, cart }
const SHELF_KEY = "cartridge:shelf";    // { at, items: [cart...] } (legacy: raw array)
const FORM_KEY = "cartridge:form";      // { at, idea, twist, genre, vibe, diff }
const PITCH_KEY = "cartridge:pitches";  // { at, pitches: [...] }
const PITCH_TTL = 24 * 60 * 60 * 1000;  // pitches younger than this are reused on load

let relay = null;
let cart = null;          // { id, title, html, version, meta:{genre,vibe,diff,idea,twist} }
let generating = false;
let runId = 0;            // generation epoch — bumping it supersedes any in-flight stream
let shelf = [];           // newest first
let pitchState = null;    // { at, pitches }
let pitching = false;
let hydrated = false;     // chip onConnect + load probe can both land — hydrate once

const div = (cls, text) => { const e = document.createElement("div"); e.className = cls; if (text != null) e.textContent = text; return e; };
const span = (cls, text) => { const e = document.createElement("span"); e.className = cls; e.textContent = text; return e; };

// ---------- form ----------
const GENRES = ["platformer", "shooter", "puzzle", "arcade", "racer", "snake-like", "breakout", "dodge-em-up"];
const VIBES = ["neon", "retro pixel", "mono CRT", "pastel", "vaporwave"];
const DIFFS = ["chill", "normal", "brutal"];
const picked = { genre: "arcade", vibe: "neon", diff: "normal", twist: "" };

function seg(mountId, options, key) {
  const mount = $(mountId);
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt;
    if (opt === picked[key]) b.classList.add("on");
    b.addEventListener("click", () => {
      picked[key] = opt;
      mount.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      persistForm();
    });
    mount.append(b);
  });
}
seg("f-genre", GENRES, "genre");
seg("f-vibe", VIBES, "vibe");
seg("f-diff", DIFFS, "diff");

function syncSeg(mountId, value) {
  $(mountId).querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === value));
}

const DICE = [
  { title: "LANTERN THIEF", idea: "a tiny ninja dodges shuriken storms and steals lanterns", genre: "dodge-em-up", vibe: "neon", twist: "each lantern makes the night darker" },
  { title: "RAIN CHECK", idea: "a grumpy cloud rains on parades to score points", genre: "arcade", vibe: "pastel", twist: "umbrellas fight back" },
  { title: "MOTH RUSH", idea: "a moth racing toward streetlights without burning up", genre: "racer", vibe: "mono CRT", twist: "light heals AND hurts" },
  { title: "SUSHI STACK", idea: "stack runaway sushi into the tallest tower", genre: "arcade", vibe: "retro pixel", twist: "wasabi blocks are bouncy" },
  { title: "GHOST VAC", idea: "a ghost vacuuming souls in a haunted office", genre: "snake-like", vibe: "vaporwave", twist: "grow too long and doors close" },
  { title: "DECAF DOOM", idea: "defend the last coffee machine from monday meetings", genre: "shooter", vibe: "neon", twist: "bosses send calendar invites" },
  { title: "FLOE RIDER", idea: "a penguin breaks icebergs to surf the fastest melt", genre: "breakout", vibe: "pastel", twist: "the paddle is a narwhal" },
  { title: "GRIDLOCK", idea: "escape a collapsing synthwave grid on a light-cycle", genre: "racer", vibe: "vaporwave", twist: "your own trail is lava" },
];
$("dice").addEventListener("click", () => {
  applyPreset(DICE[Math.floor(Math.random() * DICE.length)]);
});

// The ONE free-text input is the idea; the twist is a chip row (suggested twists, re-sampled per
// pitch roll; pitch cards carry their own twist through applyPreset).
const NO_TWIST = "no twist";
function sampleTwists() {
  const pool = [...new Set(DICE.map((d) => d.twist))].sort(() => Math.random() - 0.5).slice(0, 5);
  return [NO_TWIST, ...pool];
}
function addTwistChip(mount, label, front = false) {
  const b = document.createElement("button");
  b.type = "button";
  const val = label === NO_TWIST ? "" : label;
  b.textContent = label.length > 46 ? label.slice(0, 44) + "…" : label;
  b.dataset.twist = val;
  b.addEventListener("click", () => { picked.twist = b.dataset.twist; syncTwist(); persistForm(); });
  if (front) mount.prepend(b); else mount.append(b);
}
function syncTwist() {
  $("f-twist").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.twist === picked.twist));
}
function renderTwistChips(list) {
  const mount = $("f-twist");
  mount.textContent = "";
  const items = [...list];
  if (picked.twist && !items.includes(picked.twist)) items.splice(1, 0, picked.twist);
  items.forEach((t) => addTwistChip(mount, t));
  syncTwist();
}
function selectTwist(twist) {
  picked.twist = String(twist || "").trim();
  const mount = $("f-twist");
  if (picked.twist && ![...mount.querySelectorAll("button")].some((b) => b.dataset.twist === picked.twist)) {
    addTwistChip(mount, picked.twist, true);
  }
  syncTwist();
}
renderTwistChips(sampleTwists());

// One place that fills the console — dice, pitch cards, ★ auto-prefill, and restore all use it.
function applyPreset(p, { keepIdea = false, persist: doPersist = true } = {}) {
  if (!keepIdea && p.idea != null) $("f-idea").value = p.idea;
  if (p.genre && GENRES.includes(p.genre)) { picked.genre = p.genre; syncSeg("f-genre", p.genre); }
  if (p.vibe && VIBES.includes(p.vibe)) { picked.vibe = p.vibe; syncSeg("f-vibe", p.vibe); }
  if (p.diff && DIFFS.includes(p.diff)) { picked.diff = p.diff; syncSeg("f-diff", p.diff); }
  if (p.twist !== undefined) selectTwist(p.twist);
  if (doPersist) persistForm();
}

// ---------- persistence (relay.storage + localStorage write-through) ----------
const lsGet = (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (key, obj) => { try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch { return false; } };
function persist(key, obj) {
  lsSet(key, obj);
  if (relay) relay.storage.set(key, JSON.stringify(obj)).catch(() => {});
}

let formTimer = null;
function persistForm() {
  clearTimeout(formTimer);
  formTimer = setTimeout(() => {
    persist(FORM_KEY, { at: Date.now(), idea: $("f-idea").value, twist: picked.twist, genre: picked.genre, vibe: picked.vibe, diff: picked.diff });
  }, 400);
}
$("f-idea").addEventListener("input", persistForm);

function applyForm(f) {
  if (!f) return;
  if (typeof f.idea === "string") $("f-idea").value = f.idea;
  // restore must not re-stamp `at` — a fresh stamp would beat the roaming copy at adopt time
  applyPreset({ genre: f.genre, vibe: f.vibe, diff: f.diff, twist: f.twist }, { keepIdea: true, persist: false });
}

function normEnvelope(key, v) {
  if (!v || typeof v !== "object") return null;
  if (key === SHELF_KEY && Array.isArray(v)) return { at: v[0]?.at || 1, items: v }; // legacy raw array
  return v;
}
// Read both sides of a key, keep whichever is newer, and write the winner back to both.
async function adopt(key) {
  const local = normEnvelope(key, lsGet(key));
  let remote = null;
  if (relay) {
    try { const s = await relay.storage.get(key); if (s) remote = normEnvelope(key, JSON.parse(s)); } catch {}
  }
  const win = (remote?.at || 0) > (local?.at || 0) ? remote : (local || remote);
  if (win) {
    if (win !== local) lsSet(key, win);
    if (relay && win !== remote) relay.storage.set(key, JSON.stringify(win)).catch(() => {});
  }
  return win;
}

async function restoreFromStorage() {
  const [c, s, f, p] = await Promise.all([adopt(CART_KEY), adopt(SHELF_KEY), adopt(FORM_KEY), adopt(PITCH_KEY)]);
  if (s?.items) { shelf = s.items; renderShelf(); }
  if (f) applyForm(f);
  if (p?.pitches) pitchState = p;
  if (c?.cart && (!cart || cart.id !== c.cart.id || cart.version !== c.cart.version)) {
    cart = c.cart;
    boot({ scroll: false, save: false }); // the returning user sees their last game immediately
  }
  updateSaveBtn();
}

// ---------- the standard connect chip (both orders funnel into onRelayLive) ----------
mountConnect($("chip-dock"), {
  scope: {
    models: ["sonnet"],
    // additive + reuse-safe: an older exact-match grant simply won't carry this row, and every
    // context call below is swallowed — behavior degrades to exactly what it was before.
    contextKinds: ["personal", "brand", "project"],
    reason: "Cartridge — generate playable mini-games on your own Claude.",
  },
  installUrl: INSTALL_URL,
  onConnect: (r) => { relay = r; reflectConn(); void onRelayLive(); },
  onDisconnect: () => { relay = null; reflectConn(); },
});
// Fast probe so a returning user's grant lights the whole app without a click.
(async () => {
  const r = await whenRelayReady(2000, { installUrl: INSTALL_URL });
  if (r && "connect" in r) {
    const grant = await r.permissions().catch(() => null);
    if (grant) { relay = r; reflectConn(); void onRelayLive(); return; }
  }
  reflectConn();
})();

// From the moment relay is live: restore the workspace (grant → storage reads, never raced),
// then put concrete pitches on screen with zero input.
async function onRelayLive() {
  if (hydrated) return;
  hydrated = true;
  try { await restoreFromStorage(); } catch {}
  void ensurePitches();
}

function reflectConn() {
  const on = !!relay;
  $("go").disabled = !on || generating;
  $("remix").disabled = !on || generating;
  $("pitch-roll").disabled = !on || pitching;
  $("conn-hint").innerHTML = on
    ? "runs on <b>your</b> Claude — the operator pays nothing"
    : "connect Switchboard (top right) to power the forge with your own Claude";
}
reflectConn();

// ---------- prompt ----------
const SYSTEM = `You are Cartridge, an expert arcade game developer. You produce COMPLETE, self-contained HTML5 games in a SINGLE file.

Hard requirements — every one matters:
- ONE complete html document: inline <style> and <script>, canvas-based (2D context), no external URLs of any kind (no CDNs, fonts, images, audio files — draw everything with canvas, synthesize any sound with WebAudio).
- Playable immediately: game starts on first key/tap after a brief title screen showing the controls.
- Controls: keyboard (arrows/WASD + space) AND touch (tap/drag) — both must work.
- Core loop: requestAnimationFrame, delta-time based movement, score displayed, lose/win state with a "play again" that fully resets.
- Juice: particles, hit flashes, subtle screen shake, a little WebAudio blip on events. Small file, big feel.
- The page must never scroll; the canvas scales to fit the window (letterboxed) and stays crisp.
- No console errors. No TODOs. No placeholder art comments — finished code only.
- Keep it TIGHT: one perfect mechanic beats three rough ones. Target under ~350 lines / ~12kb — ship the smallest game that feels great.

Respond with ONLY the html document. No prose, no markdown fences.`;

function buildPrompt() {
  const idea = $("f-idea").value.trim() || "an original tiny arcade game";
  const twist = picked.twist;
  return [
    `Make this game: ${idea}`,
    `Genre: ${picked.genre}. Difficulty: ${picked.diff}.`,
    `Art direction: ${picked.vibe} — commit to it fully in the palette, glow, and typography.`,
    twist ? `Signature twist (make it central to the design): ${twist}` : "",
    `Also choose a punchy 1-3 word arcade TITLE for it and put it in the <title> tag and on the title screen.`,
  ].filter(Boolean).join("\n");
}

// Grant was narrowed past our requested model → retry once on the origin default.
async function withModelFallback(run) {
  try {
    return await run("sonnet");
  } catch (err) {
    if (Number(err?.code) === BYOPErrorCode.SCOPE_EXCEEDED) return run(null);
    throw err;
  }
}

// ---------- generation ----------
const GEN_LINES = ["WIRING THE PHYSICS…", "PAINTING THE SPRITES…", "TUNING THE DIFFICULTY…", "SYNTHESIZING BLIPS…", "ADDING THE JUICE…", "PRESSING THE CARTRIDGE…"];
let genLineTimer = null;

function setGenerating(on) {
  generating = on;
  $("genbox").hidden = !on;
  $("go").disabled = on || !relay;
  $("remix").disabled = on || !relay;
  clearInterval(genLineTimer);
  if (on) {
    $("gen-meta").textContent = "0 kb"; // never show the previous run's count
    let i = 0;
    $("gen-line").textContent = GEN_LINES[0];
    genLineTimer = setInterval(() => { i = (i + 1) % GEN_LINES.length; $("gen-line").textContent = GEN_LINES[i]; }, 2600);
  }
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

async function runStream(prompt, { fresh, onSuccess } = {}) {
  if (!relay || generating) return;
  const myRun = ++runId; // this run owns the UI only while runId is still ours
  setGenerating(true);
  $("errbox").hidden = true;
  const rain = $("code-rain");
  let text = "";
  try {
    await withModelFallback(async (model) => {
      if (myRun !== runId) return;
      text = "";
      rain.textContent = "";
      const params = { prompt, system: SYSTEM, maxTokens: 16000, effort: "low" };
      if (model) params.model = model;
      for await (const d of relay.stream(params)) {
        if (myRun !== runId) return; // superseded/stopped — returning also closes the iterator
        if (d.type === "text") {
          text += d.text;
          rain.textContent = text.split("\n").slice(-14).join("\n");
          $("gen-meta").textContent = (text.length / 1024).toFixed(1) + " kb";
        } else if (d.type === "error") {
          throw Object.assign(new Error(d.error?.message || "stream error"), { code: d.error?.code });
        }
      }
    });
    if (myRun !== runId) return;
    const html = extractHtml(text);
    if (!html) throw new Error("the model didn't return a complete game — try GENERATE again (it usually lands on the second pull)");
    if (fresh) {
      cart = {
        id: "c_" + Date.now().toString(36),
        title: titleOf(html, ($("f-idea").value.trim() || "untitled").slice(0, 28)),
        html, version: 1,
        meta: { genre: picked.genre, vibe: picked.vibe, diff: picked.diff, idea: $("f-idea").value.trim(), twist: picked.twist },
      };
    } else {
      cart.html = html;
      cart.version += 1;
      cart.title = titleOf(html, cart.title);
      syncShelfEntry(); // a shelved cart follows its remix — never a silent stale copy
    }
    boot();
    onSuccess?.();
  } catch (err) {
    if (myRun === runId) showError(err);
  } finally {
    if (myRun === runId) setGenerating(false); // a superseded run may not unlock/relock the new one
  }
}

function showError(err) {
  const box = $("errbox");
  box.hidden = false;
  const code = Number(err?.code);
  // Error text can echo daemon/model output — never innerHTML it. Compose with textContent.
  let head, body;
  if (code === BYOPErrorCode.USER_REJECTED) { head = "Not connected."; body = "Connect Switchboard (top right) when you're ready — nothing runs without your say-so."; }
  else if (code === BYOPErrorCode.BUDGET_EXCEEDED) { head = "Budget cap reached."; body = "This app hit the daily token budget you granted it. Raise it in the Switchboard panel, or come back tomorrow."; }
  else if (code === BYOPErrorCode.PROVIDER_UNAVAILABLE) { head = "Your sidekick is unreachable."; body = "Start the Switchboard daemon and try again."; }
  else if (code === BYOPErrorCode.UNAUTHORIZED) { head = "Not connected yet."; body = "Click the chip (top right) and approve the connect."; }
  else { head = "Generation failed."; body = String(err?.message || err).slice(0, 240); }
  box.textContent = "";
  const b = document.createElement("b");
  b.textContent = head;
  box.append(b, " " + body);
}

$("go").addEventListener("click", () => runStream(buildPrompt(), { fresh: true }));
$("cancel").addEventListener("click", () => { runId++; setGenerating(false); }); // bump the epoch — the draining stream can't touch the UI again

// ---------- attract mode: the pitch deck ----------
const PITCH_SYSTEM = "You are Cartridge's attract-mode writer: you pitch tiny HTML5 arcade games people instantly want to play. Punchy, playful, specific — never generic. Respond with ONLY valid JSON: no prose, no markdown fences.";

function pitchPrompt(ctx) {
  const lines = [
    "Invent 4 wildly different pitches for tiny single-screen arcade games.",
    'Return ONLY a JSON array of exactly 4 objects, each: {"title": "1-3 word arcade title", "idea": "one line — what you do in the game (max 140 chars)", "twist": "one signature mechanic twist", "genre": one of ' + JSON.stringify(GENRES) + ', "vibe": one of ' + JSON.stringify(VIBES) + ', "recommended": boolean}.',
    "Exactly ONE pitch has recommended:true — the one you'd fire up first.",
  ];
  if (ctx) {
    const gist = typeof ctx.data === "string" ? ctx.data : JSON.stringify(ctx.data ?? "");
    lines.push(`2 of the 4 pitches should playfully star this (add "starring": true on those two): ${ctx.name} (${ctx.kind || "context"}) — ${gist.slice(0, 300)}`);
  }
  return lines.join("\n");
}

function parsePitches(raw) {
  let t = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a === -1 || b <= a) return null;
  let arr;
  try { arr = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const clean = arr
    .filter((p) => p && typeof p === "object" && p.title && p.idea)
    .slice(0, 4)
    .map((p) => ({
      title: String(p.title).slice(0, 40),
      idea: String(p.idea).slice(0, 200),
      twist: String(p.twist || "").slice(0, 160),
      genre: GENRES.includes(p.genre) ? p.genre : "arcade",
      vibe: VIBES.includes(p.vibe) ? p.vibe : "neon",
      recommended: !!p.recommended,
      starring: !!p.starring,
    }));
  if (clean.length < 2) return null;
  const ri = clean.findIndex((p) => p.recommended); // exactly one ★, whatever the model said
  clean.forEach((p, i) => { p.recommended = i === (ri === -1 ? 0 : ri); });
  return clean;
}

// Parse failure must never dead-end the deck — fall back to the house dice.
function dicePitches() {
  const pool = [...DICE].sort(() => Math.random() - 0.5).slice(0, 4);
  const star = Math.floor(Math.random() * pool.length);
  return pool.map((d, i) => ({ title: d.title, idea: d.idea, twist: d.twist, genre: d.genre, vibe: d.vibe, recommended: i === star, starring: false }));
}

function reflectPitchUI(loading) {
  $("pitch-roll").disabled = loading || !relay;
  $("pitch-line").hidden = !loading;
  if (loading) {
    $("pitches").hidden = false;
    $("pitch-err").hidden = true;
    const grid = $("pitch-grid");
    grid.textContent = "";
    for (let i = 0; i < 4; i++) grid.append(div("pitch skel"));
  }
}

function renderPitches(pitches) {
  $("pitches").hidden = false;
  $("pitch-err").hidden = true;
  const grid = $("pitch-grid");
  grid.textContent = "";
  pitches.forEach((p) => {
    const el = div("pitch" + (p.recommended ? " star" : ""));
    if (p.recommended || p.starring) {
      const badges = div("pbadges");
      if (p.recommended) badges.append(span("pb rec", "★ RECOMMENDED"));
      if (p.starring) badges.append(span("pb you", "STARRING YOU"));
      el.append(badges);
    }
    el.append(div("pt", p.title), div("pi", p.idea));
    if (p.twist) el.append(div("ptw", "twist: " + p.twist));
    const tags = div("ptags");
    tags.append(span("tag", p.genre), span("tag", p.vibe));
    el.append(tags);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "forge";
    btn.textContent = "▶ FORGE THIS";
    btn.addEventListener("click", () => {
      applyPreset(p);
      runStream(buildPrompt(), { fresh: true });
    });
    el.append(btn);
    grid.append(el);
  });
}

// The ★ pitch prefills the console so a full forge is ONE click — but never over a draft the
// user already has going (their restored workspace IS the proactive state then).
function prefillFromStar(pitches) {
  if ($("f-idea").value.trim()) return;
  const star = pitches.find((p) => p.recommended) || pitches[0];
  if (star) applyPreset(star);
}

function showPitchError(err) {
  $("pitch-grid").textContent = "";
  const box = $("pitch-err");
  box.hidden = false;
  box.textContent = "";
  const b = document.createElement("b");
  b.textContent = "Couldn't pull pitches.";
  box.append(b, " " + String(err?.message || err).slice(0, 160) + " ");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry";
  retry.textContent = "↻ retry";
  retry.addEventListener("click", () => rollPitches());
  box.append(retry);
}

async function rollPitches() {
  if (!relay || pitching) return;
  pitching = true;
  reflectPitchUI(true);
  try {
    // Personalize when the user lent a context — every call swallowed so pre-existing
    // exact-match grants (no contextKinds row) behave exactly as before.
    let ctx = null;
    try {
      ctx = await relay.context.active();
      if (!ctx) {
        const metas = await relay.context.list();
        const m = (metas || []).find((x) => /personal|brand|project/i.test(x.kind || ""));
        if (m) ctx = await relay.context.use(m.id);
      }
    } catch {}
    const res = await withModelFallback((model) => {
      const params = { prompt: pitchPrompt(ctx), system: PITCH_SYSTEM, maxTokens: 900, effort: "low" };
      if (model) params.model = model;
      return relay.complete(params);
    });
    const pitches = parsePitches(res?.text) || dicePitches();
    pitchState = { at: Date.now(), pitches };
    persist(PITCH_KEY, pitchState);
    renderTwistChips(sampleTwists()); // fresh twist suggestions ride along with every roll
    renderPitches(pitches);
    prefillFromStar(pitches);
  } catch (err) {
    showPitchError(err); // scoped to the deck — the manual console keeps working
  } finally {
    pitching = false;
    reflectPitchUI(false);
  }
}

// Fresh-enough persisted pitches render instantly; otherwise spend one small completion.
async function ensurePitches() {
  if (!relay) return;
  if (pitchState && Date.now() - (pitchState.at || 0) < PITCH_TTL && Array.isArray(pitchState.pitches) && pitchState.pitches.length) {
    renderPitches(pitchState.pitches);
    prefillFromStar(pitchState.pitches);
  } else {
    await rollPitches();
  }
}
$("pitch-roll").addEventListener("click", () => rollPitches());

// ---------- the cabinet ----------
function boot({ scroll = true, save = true } = {}) {
  $("cabinet").hidden = false;
  $("g-title").textContent = cart.title.toUpperCase();
  $("g-ver").textContent = "v" + cart.version + " · " + (cart.meta?.genre || "?") + " · " + (cart.meta?.vibe || "?");
  $("stage").srcdoc = cart.html;
  updateSaveBtn();
  if (save) persist(CART_KEY, { at: Date.now(), cart }); // refresh = same game, instantly
  if (scroll) $("cabinet").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("restart").addEventListener("click", () => { if (cart) $("stage").srcdoc = cart.html; });

$("remix").addEventListener("click", () => {
  const change = $("remix-in").value.trim();
  if (!change || !cart) return;
  const prompt = [
    "Here is the current complete game:",
    "```html", cart.html, "```",
    `Remix it: ${change}`,
    "Keep everything that works; apply the change cleanly. Same hard requirements as before.",
    "Respond with ONLY the full updated html document.",
  ].join("\n");
  // The typed instruction survives until the stream SUCCEEDS — an error must not eat it.
  runStream(prompt, { fresh: false, onSuccess: () => { $("remix-in").value = ""; } });
});
$("remix-in").addEventListener("keydown", (e) => { if (e.key === "Enter") $("remix").click(); });

// ---------- the artifact ----------
$("download").addEventListener("click", () => {
  if (!cart) return;
  const blob = new Blob([cart.html], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const slug = cart.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  a.download = (slug || "cartridge-" + cart.id) + ".html"; // an all-emoji title must not yield ".html"
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- the shelf ----------
// Quota-safe: localStorage can throw at the ~5MB cap. Drop the oldest and retry once; if it
// still fails, say so visibly instead of failing silently.
function persistShelf() {
  $("shelf-err").hidden = true;
  const env = () => ({ at: Date.now(), items: shelf });
  let ok = lsSet(SHELF_KEY, env());
  if (!ok && shelf.length > 1) {
    shelf = shelf.slice(0, -1); // newest-first — the last entry is the oldest
    ok = lsSet(SHELF_KEY, env());
  }
  if (!ok) {
    const box = $("shelf-err");
    box.hidden = false;
    box.textContent = "";
    const b = document.createElement("b");
    b.textContent = "Shelf full.";
    box.append(b, " This browser's storage is at its limit — delete a cartridge (✕) and save again.");
  }
  if (relay) relay.storage.set(SHELF_KEY, JSON.stringify(env())).catch(() => {});
}

function updateSaveBtn() {
  const btn = $("save");
  const shelved = !!cart && shelf.some((c) => c.id === cart.id);
  btn.disabled = shelved;
  btn.textContent = shelved ? "saved ✓" : "＋ shelf";
}

// After a remix of an already-shelved cart, the shelf copy follows in place.
function syncShelfEntry() {
  const i = shelf.findIndex((c) => c.id === cart.id);
  if (i === -1) return;
  shelf[i] = { ...cart, at: Date.now() };
  persistShelf();
  renderShelf();
}

$("save").addEventListener("click", () => {
  if (!cart) return;
  shelf = shelf.filter((c) => c.id !== cart.id);
  shelf.unshift({ ...cart, at: Date.now() });
  shelf = shelf.slice(0, 24); // storage is finite; keep the newest 24
  persistShelf();
  renderShelf();
  updateSaveBtn();
});

function renderShelf() {
  $("shelf-empty").hidden = shelf.length > 0;
  const mount = $("carts");
  mount.textContent = "";
  shelf.forEach((c) => {
    const el = div("cart");
    const t = div("ct", c.title);
    const m = div("cm", "v" + c.version + " · " + (c.meta?.genre || "?") + " · " + new Date(c.at).toLocaleDateString());
    const btns = div("cbtns");
    const play = document.createElement("button");
    play.textContent = "▶ play";
    play.addEventListener("click", () => { cart = { ...c }; boot(); });
    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "del";
    del.addEventListener("click", () => {
      shelf = shelf.filter((x) => x.id !== c.id);
      persistShelf();
      renderShelf();
      updateSaveBtn();
    });
    btns.append(play, del);
    el.append(t, m, btns);
    mount.append(el);
  });
}

// ---------- first paint: restore the local mirror before any connect answers ----------
(function restoreLocal() {
  const s = normEnvelope(SHELF_KEY, lsGet(SHELF_KEY));
  if (s?.items) shelf = s.items;
  renderShelf();
  const f = lsGet(FORM_KEY);
  if (f) applyForm(f);
  const p = lsGet(PITCH_KEY);
  if (p?.pitches) pitchState = p;
  const c = lsGet(CART_KEY);
  if (c?.cart) { cart = c.cart; boot({ scroll: false, save: false }); }
  updateSaveBtn();
})();
