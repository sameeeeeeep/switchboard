// REPLY — paste a message or thread, get three drafted reply options (concise / warm / firm), one
// recommended, on the visitor's OWN Claude. The operator holds no key, pays for no inference, and
// never sees the user's data — Switchboard brokers everything.
//
// This file is TEMPLATE PLUMBING + the app. Everything between here and the "APP LOGIC" line is
// proven idiom (distilled from roast.js) — keep it byte-identical. Edit the CONFIG block and
// everything below APP LOGIC.
//
// House doctrine (all five, every wrapp): context-first · single input · options with exactly ONE
// recommended · house design system · one-go auto-advancing pipeline the user can steer anywhere.
import { whenRelayReady, mountConnect } from "@relay/sdk";
// Option cards come from the shared kit (src/kit/ui.js): DRAFTED (the reply Reply liked) stays
// visually distinct from CHOSEN (a card a human clicked) so the accent never paints a machine
// decision (doctrine 5), and the slate gets an escape hatch (doctrine 4).
import { optionCards } from "./kit/ui.js";
// God's hands: expose Reply's one action as a page-tool so the native God webview (or any WebMCP
// host) can DRIVE it — reusing the same start() a click runs, so the user watches it happen.
import { exposeToGod } from "./kit/webmcp.js";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "reply",                                  // = build.mjs entry name = ./dist/<id>.js in the html
  name: "Reply",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Reply — reads a message or thread you paste and drafts reply options on your own Claude",
    models: ["sonnet"],
    tools: [],                                  // text-only; no tools, no image gen
  },
  usesContext: "single",                        // a lent context = reply in the brand's own voice
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
// REPLY — paste a message, email, or thread → stage 1 drafts 3 DISTINCT reply options as option
// cards (concise / warm / firm, one recommended, auto-selected). Each card is a full, ready-to-send
// reply. Clicking a card locks it (accent = a human chose) and copy grabs it. Steering re-drafts all
// three. THE COLD OPEN: a lent brand context autostarts a sample reply in that brand's own voice.
// Text-only — no tools, no image gen.

const STEER_CHIPS = ["shorter", "warmer", "firmer", "more formal"];
// Pre-connect ONLY — a visibly-labeled sample so the empty state isn't dead. Gone the moment Claude connects.
const SAMPLE = "Hey — just following up on the invoice from last month, it's now 3 weeks overdue. Can you let me know when we can expect payment? We really need to get this sorted this week.";
let running = false;

function autostart() {
  // THE COLD OPEN — when a brand context is lent, draft a reply in that brand's own voice with ZERO
  // input, using its positioning as the message to reply to. Fire only when useful, never over a saved run.
  if (state.run) return;
  if (brand) {
    const bits = [brand.name, brand.data?.positioning, brand.data?.tagline, brand.data?.oneLiner].filter(Boolean);
    const seed = bits.length ? bits.join(" — ") : brand.name;
    void start(seed, true);
  }
}

async function start(input, fromContext) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("Paste the message you want to reply to first.", true); return; }
  // THREE ids, not one (doctrine 5). selectedId = the reply currently shown as the working draft;
  // draftedId = Reply's own pick, tagged neutrally; chosenId = a card a HUMAN clicked, the only card
  // that ever wears the accent.
  state.run = { id: uid(), input, fromContext: !!fromContext, options: null, draftedId: null, selectedId: null, chosenId: null, steers: [], status: "", error: null };
  await saveState(); render();
  await propose();
}

async function propose(steer) {
  const r = state.run; if (!r || !relay || running) return;
  if (steer) r.steers.push(steer);
  running = true; r.error = null; r.status = "drafting three replies…"; render();
  try {
    const arr = await askJsonArray([
      `You are ${APP.name}, drafting reply options to a message the user received. The message/thread:`,
      `"""${r.input.slice(0, 4000)}"""`,
      r.fromContext ? `(This is the user's OWN brand voice — write replies that sound like this brand.)` : "",
      r.steers.length ? `Steering (apply the latest): ${r.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      "Draft 3 DISTINCT full replies, ready to send, each a different register: one CONCISE (short and to the point), one WARM (friendly and relational), one FIRM (direct, sets a clear boundary or expectation). Ground each in the ACTUAL message — reference specifics, don't be generic.",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<the register: "Concise" | "Warm" | "Firm">,"text":<the full reply text>,"recommended":<true for exactly one — the reply that best fits this message>}',
    ]);
    if (!arr || !arr.length) throw new Error("no replies came back — try again");
    r.options = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Reply").slice(0, 40), text: String(o.text || "").slice(0, 2000), recommended: !!o.recommended }));
    if (!r.options.some((o) => o.recommended)) r.options[0].recommended = true;
    r.draftedId = (r.options.find((o) => o.recommended) || r.options[0]).id;
    r.selectedId = r.draftedId;
    r.chosenId = null;
  } catch (e) { r.error = msg(e); }
  finally { running = false; r.status = ""; await saveState(); render(); }
}

// `byHuman` is the ONLY route to the accent state — wired to a card click and nothing else.
function choose(id, byHuman) {
  const r = state.run; if (!r) return;
  r.selectedId = id;
  if (byHuman) r.chosenId = id;
  void saveState(); render();
}

async function copyPick() {
  const r = state.run; if (!r || !r.options) return;
  const pick = r.options.find((o) => o.id === (r.chosenId || r.selectedId)); if (!pick) return;
  try { await navigator.clipboard.writeText(pick.text); toast("Reply copied ✓"); }
  catch { toast("Couldn't copy.", true); }
}

// ==== render ================================================================================
function render() {
  const hero = $("hero"), view = $("view");
  const r = state.run;
  hero.hidden = !!r;
  view.textContent = "";

  if (!relay) {
    view.append(connectSteps());
    const s = el("div", "sample");
    s.append(el("div", "kicker", "sample message (connect to reply to your own)"));
    s.append(el("div", "sample-text", SAMPLE));
    view.append(s);
    return;
  }

  if (!r) {
    const startBox = el("div", "start");
    if (brand) startBox.append(el("div", "ctx", "loaded your lent context — " + brand.name + " · replies in this voice"));
    const row = el("div", "bindrow");
    const input = el("textarea");
    input.rows = 3;
    input.placeholder = "paste a message, email, or thread you need to reply to…";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go(); });
    const btn = el("button", "primary", "Draft replies ✍️"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    startBox.append(el("div", "hint", "⌘/Ctrl + Enter · three options — concise, warm, firm"));
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const col = el("div", "run");
  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "replying to"), el("span", "run-input", r.input), el("span", "grow"));
  const cp = el("button", "act", "copy"); cp.onclick = () => void copyPick(); cp.disabled = !r.options;
  const redo = el("button", "act", "× new"); redo.onclick = () => { state.run = null; void saveState(); render(); };
  bar.append(cp, redo);
  col.append(bar);

  if (r.options) {
    col.append(el("div", "kicker sect", r.chosenId ? "your reply" : "three replies — drafted, yours to pick"));
    col.append(optionCards({
      options: r.options,
      chosenId: r.chosenId,     // accent — a human clicked, nothing else
      draftedId: r.draftedId,   // neutral tag — Reply's pick, shown but not decided
      onChoose: (o) => choose(o.id, true),
      disabled: running,
      // Rule 4 — three drafts is a menu; this is the exit. Describe the reply you'd send instead.
      escape: {
        label: "none of these — say what you'd send instead",
        placeholder: "the angle you'd take (e.g. 'push the deadline, stay friendly')…",
        sendLabel: "redraft mine",
        onSubmit: (text) => { if (running) return; return propose(text); },
      },
    }));
  }
  if (r.status) col.append(researching(r.status));
  if (r.error) {
    col.append(el("div", "err", r.error));
    const t = el("button", "act", "try again");
    t.onclick = () => void propose();
    col.append(t);
  }
  if (r.options && !running) col.append(steerRow((s) => void propose(s)));
  view.append(col);
}
render();

// ---- God's hand: one page-tool, driving the real pipeline ----------------------------------------
// `reply_run` runs the SAME start() a paste-and-go click runs — three replies are drafted, live in
// the DOM — then returns them (with the recommended one) for God to speak or send.
exposeToGod({
  name: "reply_run",
  description: "Draft reply options (concise, warm, firm) to a message or thread. Writes them live on the page and returns them.",
  inputSchema: { message: "string — the message or thread to reply to. Required." },
  execute: async ({ message } = {}) => {
    const input = String(message || "").trim();
    if (!input) throw new Error("nothing to reply to — pass { message } with the text to reply to");
    const waitFor = async (cond, ms) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 80)); } return true; };
    if (!await waitFor(() => !!relay, 6000)) throw new Error("Reply isn't connected to Switchboard yet");
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => !running, 180000);
      await start(input);
      await waitFor(() => !running, 180000);
      const r = state.run || {};
      if (r.input === input && (r.options || r.error)) {
        if (r.error) throw new Error(r.error);
        const rec = (r.options || []).find((o) => o.id === r.draftedId);
        return { replies: (r.options || []).map((o) => ({ register: o.label, text: o.text })), recommended: rec ? rec.text : null };
      }
    }
    throw new Error("Reply stayed busy — try again");
  },
});
