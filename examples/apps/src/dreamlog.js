// Dreamlog — describe a dream, get an interpretation and a surreal dreamscape, on the visitor's OWN
// Claude. The operator holds no key, pays for no inference, and never sees the dream — Switchboard
// brokers everything. Gentle, non-clinical: it reads dreams, it doesn't diagnose them.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from redline.js) — kept byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// The shared decision atom. optionCards() keeps the accent for a human click and renders the
// model's pick as a neutral DRAFT; its `escape` option is the way out of the menu. (doctrine 4 + 5)
import { optionCards } from "./kit/ui.js";
// God's hands: expose Dreamlog's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "dreamlog",                               // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Dreamlog",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Dreamlog — reads your dream on your own Claude and (only when you ask) paints it on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // the dreamscape image runs on the user's Higgsfield, per-action
  },
  usesContext: "single",                        // a lent context can seed a cold-open reading; a dream needs none
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
// onReady fires TWICE by design — mountConnect's onConnect AND the returning-user probe,
// whichever wins the race. Hydrating from storage on BOTH passes is a real (timing-dependent) bug:
// the second pass re-reads the run the first pass just saved, REPLACING the in-memory object the
// running pipeline still holds a reference to. The pipeline then finishes into a detached orphan and
// the UI sits forever on a run that never completes. Hydrate once.
let hydrated = false;
async function onReady() {
  await syncContext();
  if (!hydrated) { hydrated = true; await loadState(); }
  render(); autostart();
}

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
// Option cards: 2–4 options, exactly ONE recommended — now imported from ./kit/ui.js (same class
// names the shell already styles), so DRAFTED (the lens Dreamlog suggested) and CHOSEN (the lens a
// human clicked) are different states and only the second one wears the accent.
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
// Dreamlog — ONE input: the dream, in your own words. Stage 1 proposes three interpretive LENSES as
// option cards (one recommended, auto-selected) — a single text-only call, NEVER gated on an image.
// Stage 2 streams the reading through the chosen lens as markdown. Stage 3 is OPTIONAL and manual:
// "conjure the dreamscape" paints a surreal image of the dream on the user's OWN Higgsfield, per
// action — it renders below and can never block the reading. Gentle, non-clinical throughout.

const STEER_CHIPS = ["gentler", "go deeper", "less literal", "focus on one symbol"];

// The three houses a dream can be read through. The model tailors each teaser to THIS dream and
// picks one to recommend; the flavor (voice, what it looks for) is fixed here so readings stay in
// character and reliable.
const LENSES = [
  { key: "jungian", name: "Jungian symbols",
    look: "Read the dream as the unconscious speaking in archetypes and symbols — the shadow, the anima/animus, the recurring motif. Name the symbols and what they might be circling, without prescribing.",
    teaser: "the symbols and archetypes underneath" },
  { key: "emotional", name: "Emotional undercurrent",
    look: "Read the dream for the feeling running beneath it — what the dreamer is carrying, avoiding, or longing for. Stay with the emotional weather, warm and grounded, never clinical.",
    teaser: "the feeling running beneath it" },
  { key: "omens", name: "Playful omens",
    look: "Read the dream the way an old superstition would — mischievous, folkloric, tongue-in-cheek fortune-telling. Light, winking, a little theatrical. Never solemn, never a real prediction.",
    teaser: "a wink of folklore and fortune" },
];

// A lens is either one of the three fixed houses above, or the one the dreamer wrote themselves via
// the escape hatch — in which case their own words ARE the lens. (doctrine 4)
function flavorFor(lens) {
  if (lens?.custom) return { name: "the dreamer's own lens", look: `Read the dream exactly the way the dreamer asked for it: "${lens.look}". Stay warm, curious and non-clinical.` };
  return LENSES.find((l) => l.key === lens?.key) || LENSES[0];
}

const SAMPLE_DREAM = "I was back in my childhood house but every door opened onto the ocean, and I kept looking for a room that wasn't there.";
let running = false;

function autostart() {
  // THE COLD OPEN — when a context is lent, Dreamlog reads it as a "dream" with ZERO input: the
  // full pipeline (lenses → reading) is already running before the visitor types a word. Never
  // re-fires over a saved run.
  if (state.run) return;
  if (brand) {
    const seed = brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : "");
    void start(seed, { seeded: true });
  }
}

async function start(input, { seeded = false } = {}) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Tell it the dream first.", true); return; }
  // selectedId = the lens the reading is currently written THROUGH (may be a draft the pipeline
  // auto-advanced on). chosenId = the lens a HUMAN clicked, and the only thing that lights a card
  // up in the brand accent. They are deliberately not the same field. (doctrine 5)
  state.run = { id: uid(), input, seeded, lenses: null, selectedId: null, draftedId: null, chosenId: null, steers: [], reading: "", image: null, status: "", error: null };
  await saveState(); render();
  await proposeLenses();
}

async function proposeLenses() {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.error = null; r.status = "reading the shape of the dream…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a gentle, non-clinical dream interpreter. A person shared this dream:`,
      `"${r.input}"`,
      r.seeded ? `(This came from a lent context, so read "${brand?.name || "it"}" as a waking dream — its hopes and tensions.)` : "",
      "You can read it through three lenses. For THIS specific dream, write a one-line teaser of how each lens would open it, and recommend exactly one that fits best. Warm, curious, never diagnostic.",
      "The three lenses, in order, are:",
      LENSES.map((l, i) => `${i + 1}. ${l.name} — ${l.look}`).join("\n"),
      'Return ONLY a JSON array of exactly 3 elements, in that same order — no prose, no fences. Each element: {"text":<one-sentence teaser tailored to this dream>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("the dream slipped away — try again");
    r.lenses = LENSES.map((l, i) => {
      const o = arr[i] || {};
      return { id: uid(), key: l.key, label: l.name, text: String(o.text || l.teaser).slice(0, 300), recommended: !!o.recommended };
    });
    if (!r.lenses.some((o) => o.recommended)) r.lenses[0].recommended = true;
    // The model may DRAFT, never LOCK: the pipeline still auto-advances on this lens, but the card
    // wears a neutral dashed "recommended" tag until a human actually clicks one. (doctrine 5)
    r.draftedId = (r.lenses.find((o) => o.recommended) || r.lenses[0]).id;
    r.chosenId = null;
    r.selectedId = r.draftedId;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.lenses && !r.error) await interpret(r.selectedId); // ONE-GO: auto-advance on the recommendation
}

async function interpret(id, steer) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  const lens = (r.lenses || []).find((o) => o.id === id);
  const flavor = flavorFor(lens);
  if (!lens) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.reading = ""; r.status = "interpreting…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}, a gentle, non-clinical dream interpreter. Never diagnose, never alarm, never claim certainty — offer, wonder, invite.`,
        `The dream: "${r.input}"`,
        r.seeded ? `(Seeded from a lent context "${brand?.name}" — read it as a waking dream.)` : "",
        `Read it through this lens — ${flavor.name}: ${flavor.look}`,
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        "Structure the reading in short markdown: open with a warm one-line take, then 2-3 short paragraphs on the images/symbols/feeling, then a single gentle closing line the dreamer can sit with. Use **bold** for the key symbols. Text-first — no images. Keep it under ~250 words.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1200,
    }, (p) => { if (p.text) { r.reading = p.text; const live = $("reading-live"); if (live) live.innerHTML = mdLite(r.reading); } });
    r.reading = text.trim();
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// STAGE 3 (optional, manual) — paint the dream on the user's OWN Higgsfield. Separate per-action
// step: it NEVER gates the reading, spends the user's credits behind their consent, and renders
// below. A steer/re-read clears a stale dreamscape so the image always matches the reading shown.
async function conjureImage() {
  const r = state.run; if (!r || !relay || r.image?.status === "working") return;
  r.image = { status: "working", url: null, error: null };
  await saveState(); render();
  try {
    const lens = (r.lenses || []).find((o) => o.id === r.selectedId);
    const flavor = flavorFor(lens);
    const prompt = `A surreal, dreamlike scene: ${r.input}. Ethereal, painterly, soft uncanny light, ${flavor.name === "Playful omens" ? "whimsical and folkloric" : "quiet and symbolic"}, no text, no watermark.`;
    const url = await genImage(prompt);
    if (!url) throw new Error("the dreamscape didn't come through — try again");
    r.image = { status: "done", url, error: null };
  } catch (e) { r.image = { status: "error", url: null, error: msg(e) }; }
  finally { await saveState(); render(); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    // Pre-connect: a visibly-labeled sample so the empty page still shows what a reading feels like.
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample dream"));
    s.append(el("div", "sample-dream", "“" + SAMPLE_DREAM + "”"));
    s.append(el("div", "sample-note", "Connect and tell it a real one — the reading runs on your own Claude, and the dream never leaves it."));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "a context is lent — Dreamlog can read " + brand.name + " as a waking dream"));
    const ta = el("textarea", "dream-input");
    ta.placeholder = "Describe your dream — the images, the feeling, whatever you still remember…";
    ta.rows = 4;
    const go = () => { if (ta.value.trim()) void start(ta.value); };
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    const btn = el("button", "primary", "Interpret ▸"); btn.onclick = go;
    startBox.append(ta, btn);
    const hint = el("div", "dream-hint", "⌘/Ctrl + Enter to interpret · nothing leaves your Claude");
    startBox.append(hint);
    view.append(startBox);
    setTimeout(() => ta.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "the dream"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ new dream");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.lenses) {
    col.append(el("div", "kicker sect", "the lens"));
    col.append(optionCards({
      options: r.lenses,
      chosenId: r.chosenId,        // null until a human clicks — the accent never lands here first
      draftedId: r.draftedId,      // the lens Dreamlog suggested, and read the dream through
      chosenNote: "you chose this",
      onChoose: (o) => { r.chosenId = o.id; r.image = null; void interpret(o.id); },
      // The way out of the menu: the dreamer knows how they want the dream read. (doctrine 4)
      escape: {
        label: "none of these — say how you'd like it read",
        hint: "your words become the lens",
        placeholder: "e.g. read it as a message from the house I grew up in…",
        sendLabel: "read it this way",
        onSubmit: (text) => {
          if (running) return;
          const o = { id: uid(), key: "custom", label: text.slice(0, 200), look: text, text: "your own lens", recommended: false, custom: true };
          r.lenses.push(o);
          r.chosenId = o.id;
          r.image = null;
          return interpret(o.id);
        },
      },
    }));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.lenses ? void interpret(r.selectedId) : void proposeLenses());
    col.append(t);
  }
  if (r.reading) {
    col.append(el("div", "kicker sect", "the reading"));
    const m = el("div", "md"); m.id = "reading-live"; m.innerHTML = mdLite(r.reading);
    col.append(m);
    if (!running) col.append(steerRow((s) => { r.image = null; void interpret(r.selectedId, s); }));

    // Stage 3 — the optional dreamscape, always AFTER the reading, never blocking it.
    if (!running) {
      col.append(el("div", "kicker sect", "the dreamscape"));
      const img = r.image;
      if (img?.status === "done" && img.url) {
        const im = el("img", "dreamscape"); im.src = img.url; im.alt = "a surreal image of the dream";
        col.append(im);
        const again = el("button", "act", "↺ conjure again"); again.onclick = () => void conjureImage();
        col.append(again);
      } else if (img?.status === "working") {
        col.append(researching("painting the dreamscape on your Higgsfield…"));
      } else {
        if (img?.status === "error") col.append(el("div", "err", img.error));
        const b = el("button", "primary conjure", img?.status === "error" ? "Try the dreamscape again" : "Conjure the dreamscape ✦");
        b.onclick = () => void conjureImage();
        col.append(el("div", "conjure-note", "Optional — paints the dream on your own Higgsfield, one image, your credits."));
        col.append(b);
      }
    }
  }
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `dreamlog_run` runs the SAME start() the "Interpret" button runs — lenses are proposed and the
// recommended one is written, live in the DOM — then returns the finished reading for God to speak.
exposeToGod({
  name: "dreamlog_run",
  description: "Interpret a dream. Writes the reading live on the page and returns it.",
  inputSchema: { dream: "string — the dream to interpret, in the dreamer's own words. Required." },
  execute: async ({ dream } = {}) => {
    const val = String(dream || "").trim();
    if (!val) throw new Error("nothing to interpret — pass { dream } with the dream to read");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Dreamlog isn't connected to Switchboard yet");
    // God may call DURING the context-first cold-open; start() early-returns while a run is in flight,
    // so wait for idle, run, and confirm the settled run is OURS (same input) before returning.
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(val);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === val && (r.reading || r.error)) {
        if (r.error) throw new Error(r.error);
        const lens = (r.lenses || []).find((l) => l.id === r.selectedId);
        return { reading: r.reading, lens: lens ? lens.label : null };
      }
    }
    throw new Error("Dreamlog stayed busy — try again");
  },
});
