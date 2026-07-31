// Toon — one line → a four-panel comic strip starring one consistent character, on the visitor's
// OWN Claude. The operator holds no key, pays for no inference, and never sees the user's data —
// Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + a sample app. Everything between here and the "APP LOGIC" line
// is proven idiom (distilled from redline.js) — keep it byte-identical unless the app truly needs
// otherwise. Edit the CONFIG block and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// The shared decision atoms: the accent means A HUMAN CHOSE (doctrine 5), and every slate has an
// exit for the answer the model never offered (doctrine 4).
import { optionCards } from "./kit/ui.js";
// God's hands: expose Toon's storyboard action as a page-tool the native God webview (or any WebMCP
// host) can DRIVE — reusing the same start() a click runs; inking stays a per-panel consent on the page.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "toon",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Toon",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Toon — storyboard your one line into a comic and ink each panel on your Higgsfield",
    models: ["sonnet"],
    tools: [HIGGSFIELD],                        // whole-connector wildcard — panels render on the user's Higgsfield
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
// Option cards now come from ./kit/ui.js — same class names, but a card can only reach the accent
// `.sel` state through a human click, and the slate carries its own escape hatch.
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
// Toon's pipeline: ONE line → stage 1 storyboards 3 comic TREATMENTS (option cards: an art style +
// a four-beat panel list, exactly one recommended, auto-selected). Selecting a treatment reveals
// its storyboard surface with zero token cost — the recurring character + four panels. Stage 2 is
// the INKING: each panel renders on the user's Higgsfield behind a per-panel consent (1 draw = 1
// consent, exactly like Studio/Prism), never auto-fired, so stage-1 cards never wait on an image.

const STEER_CHIPS = ["funnier", "more dramatic", "different art style", "wilder ending"];
let running = false;      // stage-1 treatment generation in flight
let busyDrawing = false;  // a panel is inking — serialize consents so they never stack

function autostart() {
  // THE COLD OPEN — the single strongest selling moment: when a brand is lent, Toon storyboards a
  // comic ABOUT that brand/founder with ZERO input (no form, no prompt, no button). Connect
  // Switchboard and a strip about your own company is already being drawn. Fire only when the lent
  // context makes the run unambiguously useful, and never re-fire over a saved run.
  if (state.run) return;
  if (brand) { const seed = brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Give it the one line first.", true); return; }
  // draftedId = what the model recommended (drives the free storyboard reveal — no token cost).
  // chosenId  = what a HUMAN clicked (drives the accent). Only the second one is a decision.
  state.run = { id: uid(), input, treatments: null, selectedId: null, draftedId: null, chosenId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await proposeTreatments();
}

async function proposeTreatments(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "storyboarding three ways to draw it…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a comic director. Turn this one line into a four-panel comic strip: "${r.input}".`,
      brand ? `Active context — this strip is ABOUT this brand/founder; mine it for the character, the world, and the specifics: ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
      r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Propose 3 DISTINCT comic treatments in different art styles (e.g. shonen manga, black-and-white newspaper strip, noir graphic novel, Saturday-morning cartoon, indie zine, ligne claire). Each must star ONE recurring character who stays visually identical across all four panels.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<3-5 word style name>,"style":<one vivid art-direction line: linework, palette, texture, era>,"characterName":<the lead\'s short name>,"character":<one line pinning the lead\'s exact look so it renders identical every panel: build, hair, outfit, signature detail>,"panels":[exactly 4 objects {"caption":<the story beat, one short punchy line>,"art":<what we SEE in this panel: subject, action, framing — one visual line>}],"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("no treatments came back — try again");
    r.treatments = arr.slice(0, 3).map((o) => ({
      id: uid(),
      label: String(o.label || "Comic").slice(0, 60),
      style: String(o.style || "").slice(0, 260),
      characterName: String(o.characterName || "Our hero").slice(0, 40),
      character: String(o.character || "").slice(0, 260),
      panels: (Array.isArray(o.panels) ? o.panels : []).slice(0, 4).map((p) => ({
        caption: String(p?.caption || "").slice(0, 180),
        art: String(p?.art || "").slice(0, 260),
        url: null, drawing: false, error: null,
      })).filter((p) => p.caption || p.art),
      recommended: !!o.recommended,
    })).filter((t) => t.panels.length);
    if (!r.treatments.length) throw new Error("the storyboard came back empty — try again");
    if (!r.treatments.some((t) => t.recommended)) r.treatments[0].recommended = true;
    // ONE-GO: reveal the recommended storyboard, no image call. It is a DRAFT, so it reveals but does
    // NOT light the card — a fresh slate also clears any stale pick, which no longer means anything.
    r.draftedId = (r.treatments.find((t) => t.recommended) || r.treatments[0]).id;
    r.chosenId = null;
    r.selectedId = r.draftedId;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Which strip is on screen: the human's pick if they made one, otherwise the model's draft. The
// trailing `selectedId` keeps runs saved by the previous build from losing their storyboard.
function selectedTreatment() {
  const r = state.run; if (!r) return undefined;
  const id = r.chosenId || r.draftedId || r.selectedId;
  return (r.treatments || []).find((t) => t.id === id);
}

// Build the text-to-image prompt for ONE panel — the art style + the LOCKED character description
// (so the lead stays identical strip-wide) + this panel's action.
function panelPrompt(t, p) {
  return [
    `${t.style || t.label} comic art.`,
    `Recurring lead character, keep visually IDENTICAL in every panel: ${t.characterName}${t.character ? " — " + t.character : ""}.`,
    `This panel shows: ${p.art || p.caption}.`,
    `Single comic book panel, ${t.label} style, expressive cinematic composition. No speech bubbles, no captions, no lettering, no text of any kind in the image.`,
  ].filter(Boolean).join(" ");
}

// Stage 2 — INK ONE PANEL on the user's Higgsfield (agentic; 1 draw = 1 consent). Serialized by
// busyDrawing so "ink the whole strip" fires consents one at a time, never a stack of popups.
async function drawPanel(pi) {
  const r = state.run; const t = selectedTreatment();
  if (!r || !t || !relay) return;
  const p = t.panels[pi]; if (!p || busyDrawing || p.drawing) return;
  busyDrawing = true; p.drawing = true; p.error = null; render();
  try {
    const url = await genImage(panelPrompt(t, p));
    if (!url) throw new Error("no panel came back — ink it again");
    p.url = url;
  } catch (e) { p.error = msg(e); }
  finally { p.drawing = false; busyDrawing = false; await saveState(); render(); }
}

// Ink every undrawn panel in order (or redraw all if the strip is already complete).
async function drawStrip() {
  const t = selectedTreatment(); if (!t || busyDrawing) return;
  const redoAll = t.panels.every((p) => p.url);
  for (let i = 0; i < t.panels.length; i++) {
    if (redoAll || !t.panels[i].url) { await drawPanel(i); if (t.panels[i].error) break; }
  }
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
    input.placeholder = "one line — the moment to turn into a comic";
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
  bar.append(el("span", "kicker", "story"), el("span", "run-input", r.input));
  const redo = el("button", "act", "↺ start over");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(redo);
  col.append(bar);

  if (r.treatments) {
    col.append(el("div", "kicker sect", "the treatment"));
    const opts = r.treatments.map((t) => ({
      id: t.id,
      label: t.label,
      text: [t.style, t.panels.map((p, i) => `${i + 1}. ${p.caption || p.art}`).join("\n")].filter(Boolean).join("\n\n"),
      recommended: t.recommended,
    }));
    col.append(optionCards({
      options: opts,
      chosenId: r.chosenId,     // accent — a human clicked
      draftedId: r.draftedId,   // neutral dashed tag — the model's suggestion
      chosenNote: "your treatment",
      onChoose: (o) => {
        if (busyDrawing) { toast("finish inking the current panel first.", true); return; }
        r.chosenId = o.id; r.selectedId = o.id; void saveState(); render();
      },
      // DOCTRINE 4 — three styles the model liked is a menu; this is the way out of it.
      escape: {
        label: "none of these — say how you'd draw it instead",
        placeholder: "e.g. scratchy 90s zine, two colors, hand-lettered",
        hint: "Toon re-storyboards around your direction instead of these three.",
        sendLabel: "storyboard mine",
        onSubmit: (text) => {
          if (busyDrawing) { toast("finish inking the current panel first.", true); return; }
          return proposeTreatments(`Discard the previous three treatments — the reader wants this instead: "${text}". Build every treatment around that direction.`);
        },
      },
    }));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void proposeTreatments();
    col.append(t);
  }

  const sel = selectedTreatment();
  if (sel && !r.status) {
    col.append(el("div", "kicker sect", "the strip"));
    col.append(stripView(sel));
    if (!busyDrawing) col.append(steerRow((s) => void proposeTreatments(s)));
  }
  view.append(col);
}

// The storyboard surface for the chosen treatment: the recurring character, a strip-wide ink
// button, and the four-panel grid where each panel inks on demand.
function stripView(t) {
  const wrap = el("div");

  const cast = el("div", "cast");
  const av = el("div", "avatar");
  const firstDrawn = t.panels.find((p) => p.url);
  if (firstDrawn) { const im = el("img"); im.src = firstDrawn.url; im.alt = t.characterName; av.append(im); }
  else av.textContent = (t.characterName || "?").slice(0, 1).toUpperCase();
  const who = el("div", "who");
  who.append(el("div", "nm", t.characterName), el("div", "desc", t.character || t.style));
  cast.append(av, who);
  wrap.append(cast);

  const actions = el("div", "strip-actions");
  const undrawn = t.panels.filter((p) => !p.url).length;
  const drawAll = el("button", "act", busyDrawing ? "inking…" : undrawn === t.panels.length ? "ink the whole strip →" : undrawn ? `ink the rest (${undrawn}) →` : "↺ redraw all panels");
  drawAll.disabled = busyDrawing;
  drawAll.onclick = () => void drawStrip();
  actions.append(drawAll);
  actions.append(el("span", "kicker", "each panel = one render on your Higgsfield"));
  wrap.append(actions);

  const grid = el("div", "strip");
  t.panels.forEach((p, i) => grid.append(panelCard(t, p, i)));
  wrap.append(grid);
  return wrap;
}

function panelCard(t, p, i) {
  const card = el("div", "panel");
  const frame = el("div", "frame");
  frame.append(el("div", "n", "panel " + (i + 1)));
  if (p.url) {
    const img = el("img"); img.src = p.url; img.alt = p.caption || p.art; img.loading = "lazy";
    img.addEventListener("error", () => { p.url = null; void saveState(); render(); });
    frame.append(img);
    const rd = el("button", "redraw", "redraw"); rd.disabled = busyDrawing; rd.onclick = () => void drawPanel(i);
    frame.append(rd);
  } else if (p.drawing) {
    frame.append(el("div", "pscan"));
  } else if (p.error) {
    frame.append(el("div", "pfail", p.error));
    const b = el("button", "draw", "try again"); b.disabled = busyDrawing; b.onclick = () => void drawPanel(i);
    frame.append(b);
  } else {
    const b = el("button", "draw", "ink this panel"); b.disabled = busyDrawing; b.onclick = () => void drawPanel(i);
    frame.append(b);
  }
  card.append(frame);
  const cap = el("div", "cap");
  cap.append(el("b", null, "panel " + (i + 1)), document.createTextNode("  " + (p.caption || p.art || "")));
  card.append(cap);
  return card;
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `toon_run` runs the SAME start() a draw-it click runs — the one line is storyboarded into a 4-panel
// treatment (art style + a recurring character + four beats), live in the DOM — then returns that
// storyboard. Inking each panel is a deliberate per-panel consent (never auto-fired), so it stays on
// the page: God gets the full comic script and the user inks panels from the UI.
exposeToGod({
  name: "toon_run",
  description: "Storyboard a one-line moment into a 4-panel comic treatment (art style + recurring character + four beats), rendered on the page. Returns the storyboard; ink each panel from the page.",
  inputSchema: { moment: "string — the one line to turn into a comic. Required." },
  execute: async ({ moment } = {}) => {
    const val = String(moment || "").trim();
    if (!val) throw new Error("nothing to draw — pass { moment } with the one line to turn into a comic");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Toon isn't connected to Switchboard yet");
    // God may call DURING the context-first cold open. Wait for idle, run our own, confirm the settled
    // run is OURS with a storyboard.
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running && !busyDrawing, 180000);  // let any in-flight run finish
      await start(val);                                        // proposeTreatments (awaited)
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === val && (r.treatments || r.error)) {
        if (r.error) throw new Error(r.error);
        const t = selectedTreatment();
        if (t) return { style: t.label, character: t.characterName, panels: (t.panels || []).map((p) => ({ caption: p.caption, art: p.art })) };
      }
    }
    throw new Error("Toon stayed busy — try again");
  },
});
