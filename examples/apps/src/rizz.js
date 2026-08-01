// RIZZ — paste the situation, get the line, on the visitor's OWN Claude. The operator holds no key,
// pays for no inference, and never sees the user's chats — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + a sample app. Everything between here and the "APP LOGIC" line
// is proven idiom (distilled from redline.js) — keep it byte-identical unless the app truly needs
// otherwise. Edit the CONFIG block and everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED (the strategy Rizz liked, and wrote
// the first lines from) stays visually distinct from CHOSEN (a card a human clicked) so the accent
// never paints a machine decision (doctrine 5), and the slate gets an escape hatch (doctrine 4).
import { optionCards } from "./kit/ui.js";
// God's hands: expose Rizz's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "rizz",                                   // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Rizz",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Rizz — writes tasteful dating-app openers, replies, and bios on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text/markdown only — no tools, no images
  },
  usesContext: "single",                        // a lent persona tunes the voice; otherwise standalone
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
// names, plus the drafted-vs-chosen distinction and the escape hatch).
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
// RIZZ — one paste (their bio / their last message / the vibe) → stage 1 proposes 3 STRATEGIES
// (playful / sincere / witty, one recommended, auto-selected) → stage 2 streams a set of 4-5
// ready-to-send lines, rendered as copyable cards. A capture mode (openers / reply / bio) reshapes
// what stage 2 produces. Steering ("bolder", "cleaner", "funnier") redrafts the lines. Text only —
// no tools, no images. Tasteful and consent-forward by construction; you are always the one who
// hits send. If a persona context is lent, both stages tune to that voice (and the cold open fires).

const STEER_CHIPS = ["bolder", "cleaner", "funnier", "shorter"];
const MODES = [
  { key: "openers", label: "Openers", sub: "the first message to send", verb: "opening lines", noun: "opener" },
  { key: "reply",   label: "Reply",   sub: "respond to their last message", verb: "replies", noun: "reply" },
  { key: "bio",     label: "Dating bio", sub: "write my profile bio", verb: "dating-bio options", noun: "bio" },
];
let running = false;

// Parse a streamed markdown bullet list into individual send-ready lines (tolerant of numbering or
// bare lines if the model skips bullets). Never fabricates — just splits what came back.
function parseLines(md) {
  const raw = String(md || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const bulleted = raw
    .filter((s) => /^(?:[-*•]\s+|\d+[.)]\s+)/.test(s))
    .map((s) => s.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").replace(/^\*\*|\*\*$/g, "").trim())
    .filter(Boolean);
  const lines = bulleted.length >= 2 ? bulleted
    : raw.filter((s) => !/^#{1,4}\s/.test(s) && s.length > 1); // fallback: any non-heading line
  return lines.slice(0, 5);
}

function autostart() {
  // THE COLD OPEN — when a persona is lent, Rizz fires the FULL pipeline with ZERO input: it seeds a
  // universal dating-app moment and tunes every line to that persona's voice. Connect, and there are
  // already send-ready openers in your voice on screen — no form, no button. Never re-fires over a
  // saved run; the user can steer or start over at any point (one-go doctrine).
  if (state.run) return;
  if (brand) void start("We just matched on a dating app — I want a warm opener that breaks the ice.");
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Paste the situation first — their bio, their last message, or the vibe.", true); return; }
  // THREE ids, not one (doctrine 5). selectedId = the strategy the lines are currently written FROM
  // (the pipeline keeps auto-advancing on the recommendation, so the cold open still lands lines);
  // draftedId = Rizz's own pick, tagged neutrally; chosenId = a card a HUMAN clicked, and the only
  // thing that ever wears the accent.
  state.run = { id: uid(), input, mode: "openers", strategies: null, draftedId: null, selectedId: null, chosenId: null, steers: [], draft: "", lines: null, status: "", error: null };
  await saveState(); render();
  await proposeStrategies();
}

async function proposeStrategies() {
  const r = state.run; if (!r || !relay || running) return;
  const mode = MODES.find((m) => m.key === r.mode) || MODES[0];
  running = true; r.error = null; r.status = "reading the room…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, a sharp, warm wingperson with great taste. Someone needs help with a dating-app situation.`,
      `TASK: ${mode.label} — ${mode.sub}.`,
      `THE SITUATION (their paste — could be the other person's bio, their last message, or just the vibe): "${r.input}"`,
      brand ? `VOICE TO MATCH (the user's OWN persona — sound like them, not a template): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
      "Propose exactly 3 distinct STRATEGIES for how to play this: one playful, one sincere, one witty. All tasteful and consent-forward — confident and charming, never pushy, creepy, sexual, or negging. Each is a one-sentence read on the angle.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the vibe, 1-2 words e.g. "Playful">,"text":<one-sentence angle>,"recommended":<true for exactly one — the vibe that best fits this situation>}',
    ]);
    if (!arr || !arr.length) throw new Error("no read came back — try again");
    r.strategies = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Vibe").slice(0, 40), text: String(o.text || "").slice(0, 240), recommended: !!o.recommended }));
    if (!r.strategies.some((o) => o.recommended)) r.strategies[0].recommended = true;
    // Rizz may DRAFT the play it likes and write from it — but drafting is not choosing. A fresh
    // slate also drops any earlier pick: those cards no longer exist.
    r.draftedId = (r.strategies.find((o) => o.recommended) || r.strategies[0]).id;
    r.selectedId = r.draftedId;
    r.chosenId = null;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
  if (r.strategies && !r.error) await draftLines(r.selectedId); // ONE-GO: auto-advance on the recommendation
}

// `byHuman` is the ONLY route to the accent state — it is wired to a card click and to the escape
// hatch, and to nothing else. Auto-advance and steering redraft the same play without claiming a
// decision was made.
async function draftLines(id, steer, byHuman) {
  const r = state.run; if (!r || !relay || running) return;
  r.selectedId = id;
  if (byHuman) r.chosenId = id;
  const strat = (r.strategies || []).find((o) => o.id === id); if (!strat) return;
  const mode = MODES.find((m) => m.key === r.mode) || MODES[0];
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.draft = ""; r.lines = null; r.status = "writing your lines…"; render();
  try {
    const text = await streamText({
      prompt: [
        `You are ${APP.name}, a warm, witty wingperson with great taste. Produce ${mode.verb} for this dating-app situation.`,
        `TASK: ${mode.label} — ${mode.sub}.`,
        `THE SITUATION: "${r.input}"`,
        `CHOSEN VIBE: ${strat.label} — ${strat.text}`,
        brand ? `VOICE TO MATCH (sound like the user's own persona, not a template): ${JSON.stringify(brand.data).slice(0, 2000)}` : "",
        r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
        mode.key === "bio"
          ? "Write 4-5 distinct dating-bio options, each ready to paste into a profile. Specific and human — real detail, a little wit, no clichés, no emoji spam."
          : "Write 4-5 ready-to-send lines, each ready to paste as-is. Natural, specific to the situation, and varied in energy — not five rewrites of one line.",
        "RULES: tasteful and consent-forward. Confident and charming, never creepy, pushy, sexual, or negging. Sound like a clever real human — no pickup-artist scripts, no cheesy pet names, no fake urgency. Keep each line tight.",
        "Return ONLY the lines as a markdown bullet list (each starting with '- '). No preamble, no numbering, no commentary before or after.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1200,
    }, (p) => { if (p.text) { r.draft = p.text; const live = $("lines-live"); if (live) live.innerHTML = mdLite(r.draft); } });
    r.draft = text.trim();
    r.lines = parseLines(r.draft);
    if (!r.lines.length) throw new Error("no lines came back — try again");
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// Switching the task (openers / reply / bio) reshapes stage 2 — re-read the room and redraft.
async function setMode(key) {
  const r = state.run; if (!r || running || r.mode === key) return;
  r.mode = key; r.strategies = null; r.draftedId = null; r.selectedId = null; r.chosenId = null; r.steers = []; r.draft = ""; r.lines = null;
  await saveState(); render();
  await proposeStrategies();
}

async function copyLine(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { btn.textContent = "copied"; btn.classList.add("done"); setTimeout(() => { btn.textContent = "copy"; btn.classList.remove("done"); }, 1400); } }
  catch { toast("Couldn't copy.", true); }
}
async function copyAll() {
  const r = state.run; if (!r || !r.lines?.length) return;
  try { await navigator.clipboard.writeText(r.lines.join("\n\n")); toast("All lines copied ✓"); }
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
    if (brand) startBox.append(el("div", "ctx", "tuning every line to your lent persona — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "paste it — their bio, their last message, or the vibe";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Rizz it ▸"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "situation"), el("span", "run-input", r.input));
  const copyAllBtn = el("button", "act", "copy all"); copyAllBtn.onclick = () => void copyAll(); copyAllBtn.disabled = !r.lines?.length;
  const redo = el("button", "act", "↺ new situation");
  redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(copyAllBtn, redo);
  col.append(bar);

  // capture-mode toggle (openers / reply / bio) — reuses the option-card atom, laid out in a row
  const modeRow = el("div", "mode-row");
  for (const m of MODES) {
    const o = el("div", "opt" + (r.mode === m.key ? " sel" : ""));
    o.onclick = () => void setMode(m.key);
    o.append(el("div", "check", "✓"), el("div", "o-label", m.label), el("div", "o-text", m.sub));
    modeRow.append(o);
  }
  col.append(el("div", "kicker sect", "what do you need"));
  col.append(modeRow);

  if (r.strategies) {
    col.append(el("div", "kicker sect", r.chosenId ? "the play" : "the play — drafted, yours to change"));
    col.append(optionCards({
      options: r.strategies,
      chosenId: r.chosenId,     // accent — a human clicked, nothing else
      draftedId: r.draftedId,   // neutral tag — Rizz's pick, written from but not decided
      onChoose: (o) => void draftLines(o.id, null, true),
      disabled: running,
      // Rule 4 — three plays is a menu; this is the exit. Your own read becomes the vibe.
      escape: {
        label: "none of these — say how you'd play it",
        placeholder: "the vibe you actually want to send…",
        sendLabel: "use mine",
        onSubmit: (text) => {
          if (running) return;
          const mine = { id: uid(), label: "Yours", text, recommended: false, custom: true };
          r.strategies = [...r.strategies, mine];
          return draftLines(mine.id, null, true);
        },
      },
    }));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => (r.strategies ? void draftLines(r.selectedId) : void proposeStrategies());
    col.append(t);
  }

  if (running && r.draft && !r.lines) {
    // live stream — the raw markdown as it arrives, swapped for tidy cards on completion
    col.append(el("div", "kicker sect", "your lines"));
    const m = el("div", "md"); m.id = "lines-live"; m.innerHTML = mdLite(r.draft);
    col.append(m);
  } else if (r.lines?.length) {
    col.append(el("div", "kicker sect", "your lines"));
    const box = el("div", "lines");
    for (const text of r.lines) {
      const card = el("div", "line");
      card.append(el("div", "l-text", text));
      const cp = el("button", "l-copy", "copy");
      cp.onclick = () => void copyLine(text, cp);
      card.append(cp);
      box.append(card);
    }
    col.append(box);
    if (!running) col.append(steerRow((s) => void draftLines(r.selectedId, s)));
    col.append(el("div", "taste", "Rizz keeps it consent-forward — confident, never creepy. You're always the one who hits send."));
  }

  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `rizz_run` runs the SAME start() the "Rizz it" button runs — strategies are proposed and the
// recommended one's lines are written, live in the DOM — then returns the send-ready lines.
exposeToGod({
  name: "rizz_run",
  description: "Get send-ready dating-app lines for a situation (their bio, their last message, or the vibe). Writes them live on the page and returns them.",
  inputSchema: { situation: "string — the situation to work with. Required." },
  execute: async ({ situation } = {}) => {
    const val = String(situation || "").trim();
    if (!val) throw new Error("nothing to work with — pass { situation } with their bio, their last message, or the vibe");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Rizz isn't connected to Switchboard yet");
    // God may call DURING the context-first cold-open; start() early-returns while a run is in flight,
    // so wait for idle, run, and confirm the settled run is OURS (same input) before returning.
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(val);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === val && ((r.lines && r.lines.length) || r.error)) {
        if (r.error) throw new Error(r.error);
        const strat = (r.strategies || []).find((s) => s.id === r.selectedId);
        return { lines: r.lines, vibe: strat ? strat.label : null };
      }
    }
    throw new Error("Rizz stayed busy — try again");
  },
});
