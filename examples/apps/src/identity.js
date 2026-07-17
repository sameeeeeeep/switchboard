// IDENTITY — compose an AI persona from a line + any lent context, then PUBLISH it as a context
// Cast (and any persona-consuming wrapp) picks up. CARVE of Cast's Foundation facet stage
// (cast/spec.js) into a standalone context PRODUCER: the five facets — person, voice, aesthetic,
// audience, pillars — each a decision (3 options, one recommended), grounded ONLY in the founder's
// line + the optionally-lent brand context. Locking all five publishes a `persona`-kind context.
// This is the data-bridge proof: Identity produces → Cast consumes, no shared code, just contexts.
//
// Plumbing between here and the "APP LOGIC" line is the /wrapp template, byte-identical.
import { whenRelayReady, mountConnect } from "@relay/sdk";

// ==== CONFIG — every new wrapp edits this block =============================================
const HIGGSFIELD = "mcp__claude_ai_Higgsfield__*"; // whole-connector wildcard — the ONLY form the gate accepts
const APP = {
  id: "identity",
  name: "Identity",
  installUrl: "https://thelastprompt.ai/switchboard/",
  scope: {
    reason: "Identity — compose an AI persona on your own Claude and publish it as a context Cast can use",
    models: ["sonnet"],
    tools: [],
    contextKinds: ["brand"],                    // lets a lent brand ground the persona
  },
  usesContext: "single",                        // a lent brand becomes ground truth for the persona
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
// IDENTITY — five facet decisions carved from Cast's Foundation (cast/spec.js). ONE line describes
// the person → each facet drafts 3 options (one recommended, auto-picked), grounded in the line +
// any lent brand. person is drafted first; the rest are conditioned on the picked person. Steer
// redrafts a facet. When all five are picked, PUBLISH composes a `persona`-kind context that Cast
// consumes. Ground truth = the line + lent brand only; never invent a real brand's name.

const STEER_CHIPS = ["different person", "sharper", "younger", "more niche"];

// The facet specs (carved from cast/spec.js — brief kept close to the tuned originals).
const FACETS = [
  { key: "person", title: "The person", deps: [],
    guide: 'A real human creator who could own this niche. Each option: label = a real first+last name (never a brand name); text = their one-line identity (age-ish, where, what they did before) + why they fit, and 3 personality traits. Three genuinely different people.' },
  { key: "voice", title: "Their voice", deps: ["person"],
    guide: 'How this exact person talks on camera. label = the voice in 2-3 words (e.g. "Dry & deadpan"); text = one sentence on how they sound + 2 example caption openers in that voice. Must plausibly belong to the picked person.' },
  { key: "aesthetic", title: "The look", deps: ["person"],
    guide: 'The visual world they film in. label = the aesthetic in 2-3 words; text = one sentence on the light/textures/framing + a 3-colour palette as hex. Consistent with the picked person.' },
  { key: "audience", title: "Who it's for", deps: ["person"],
    guide: 'Who this creator is for. label = the audience in 2-4 words; text = one sentence on who they are and what they want.' },
  { key: "pillars", title: "What they post", deps: ["person", "audience"],
    guide: 'The recurring content pillars. label = the pillar in 2-4 words; text = one sentence on the format/angle of that pillar. Three distinct pillars this person could post forever.' },
];
const mkFacets = () => Object.fromEntries(FACETS.map((f) => [f.key, { options: null, selectedId: null, steers: [], error: null }]));

let running = false;
let published = null; // { id, name } once published

function autostart() {
  if (state.run) { state.run.status = ""; render(); return; }
  // THE COLD OPEN: a lent brand is enough — connect and Identity is already composing the persona
  // that would create for it. Zero input; the facets start landing as cards on their own.
  if (brand) { const seed = "an on-camera creator for " + brand.name + (brand.data?.positioning ? " — " + brand.data.positioning : ""); void start(seed); }
}

function pick(key) { const f = state.run.facets[key]; return (f.options || []).find((o) => o.id === f.selectedId) || null; }
function digestSoFar(upto) {
  const parts = [];
  for (const f of FACETS) { if (f.key === upto) break; const p = pick(f.key); if (p) parts.push(`${f.title}: ${p.label} — ${p.text}`); }
  return parts.join("\n");
}

async function start(input) {
  if (!relay || running) return;
  input = String(input || "").trim();
  if (!input) { toast("One line describing the persona first.", true); return; }
  published = null;
  state.run = { id: uid(), input, name: "", status: "", facets: mkFacets() };
  await saveState(); render();
  await draftAll();
}

async function draftAll() {
  const r = state.run; if (!r || !relay || running) return;
  running = true;
  for (const f of FACETS) {
    const fs = r.facets[f.key];
    if (fs.options) continue;
    r.status = `drafting ${f.title.toLowerCase()}…`; render();
    await draftFacet(f.key);
  }
  running = false; r.status = "";
  // name the persona from the picked person, for the published context
  const person = pick("person"); if (person && !r.name) r.name = person.label;
  await saveState(); render();
}

async function draftFacet(key, steer) {
  const r = state.run; if (!r || !relay) return;
  const spec = FACETS.find((f) => f.key === key);
  const fs = r.facets[key];
  if (steer) fs.steers.push(steer);
  fs.error = null;
  try {
    const digest = digestSoFar(key);
    const arr = await askJsonArray([
      "You are Identity, composing an AI creator persona with a founder, on their own Claude.",
      `THE BRIEF (ground truth): "${r.input}"`,
      brand ? `LENT BRAND "${brand.name}" (this persona creates FOR it — ground the fit in it): ${JSON.stringify(brand.data).slice(0, 2500)}` : "",
      digest ? `ALREADY DECIDED (stay consistent with these):\n${digest}` : "",
      `FACET — ${spec.title}. ${spec.guide}`,
      fs.steers.length ? `Steering (apply the latest): ${fs.steers.map((s) => `"${s}"`).join(" → ")}` : "",
      'Return ONLY a JSON array — no prose, no fences. Each element: {"label":<short name>,"text":<the detail>,"recommended":<true for exactly one>}',
    ]);
    if (!arr || !arr.length) throw new Error("nothing came back — try again");
    fs.options = arr.slice(0, 3).map((o) => ({ id: uid(), label: String(o.label || "Option").slice(0, 60), text: String(o.text || "").trim(), recommended: !!o.recommended }));
    if (!fs.options.some((o) => o.recommended)) fs.options[0].recommended = true;
    fs.selectedId = (fs.options.find((o) => o.recommended) || fs.options[0]).id;
  } catch (e) { fs.error = msg(e); }
  await saveState(); render();
}

async function steerFacet(key, steer) {
  const r = state.run; if (!r || !relay || running) return;
  running = true; r.status = "redrafting…"; render();
  await draftFacet(key, steer);
  running = false; r.status = ""; render();
}

const allPicked = () => FACETS.every((f) => pick(f.key));

// PUBLISH — compose the picked facets into a persona-kind context Cast consumes. The publish itself
// is the consent beat (context.publish); the operator never sees it.
async function publish() {
  const r = state.run; if (!r || !relay || running || !allPicked()) return;
  running = true; r.status = "publishing the identity…"; render();
  try {
    const person = pick("person"), aes = pick("aesthetic");
    // pull any hex swatches the aesthetic facet named, so a lent persona ALSO fills Cast's brand
    // slot (which reads data.palette as flat hex strings — docs/CONTEXT-KINDS.md).
    const palette = (aes ? (aes.text.match(/#[0-9a-fA-F]{6}/g) || []) : []).slice(0, 5);
    const data = {
      brief: r.input,
      forBrand: brand ? { id: brand.id, name: brand.name } : null,
      persona: { name: person.label, identity: person.text },
      voice: pick("voice") && { title: pick("voice").label, body: pick("voice").text },
      aesthetic: aes && { title: aes.label, body: aes.text },
      audience: pick("audience") && { title: pick("audience").label, body: pick("audience").text },
      pillars: pick("pillars") && { title: pick("pillars").label, body: pick("pillars").text },
      // Cast-compatibility fields so a lent persona works as its brand context without any change:
      positioning: person.text,
      palette,
    };
    const id = await relay.context.publish({ name: person.label, kind: "persona", data });
    published = { id: id || null, name: person.label };
    toast("Published ✓ “" + person.label + "” — lend it to Cast from the panel");
  } catch (e) { toast("Couldn't publish — " + msg(e), true); }
  finally { running = false; r.status = ""; await saveState(); render(); }
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
    if (brand) startBox.append(el("div", "ctx", "the persona will create for your lent brand — " + brand.name));
    const row = el("div", "bindrow");
    const input = el("input");
    input.placeholder = "one line — describe the creator (niche, vibe, who they're for)";
    const go = () => { if (input.value.trim()) void start(input.value); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const btn = el("button", "primary", "Compose ▸"); btn.onclick = go;
    row.append(input, btn);
    startBox.append(row);
    view.append(startBox);
    setTimeout(() => input.focus(), 30);
    return;
  }

  const bar = el("div", "runbar");
  bar.append(el("span", "kicker", "persona"), el("span", "run-input", r.name || r.input), el("span", "grow"));
  if (!running && allPicked()) {
    const pub = el("button", "act", published ? "✓ published — re-publish" : "⇪ publish to Cast");
    pub.onclick = () => void publish();
    bar.append(pub);
  }
  const nu = el("button", "act", "× new"); nu.onclick = () => { published = null; state.run = null; void saveState(); render(); };
  bar.append(nu);
  view.append(bar);

  if (r.status) view.append(researching(r.status));

  for (const f of FACETS) view.append(facetCard(f));

  if (published) {
    const done = el("div", "q-card");
    done.append(el("span", "q-num", "published"));
    done.append(el("div", "q-text", "“" + published.name + "” is now a persona context."));
    const note = el("div", "gap-note"); note.style.color = "var(--ok)";
    note.textContent = "Open Cast, and lend this persona to it from the Switchboard panel — Identity produced it, Cast consumes it. No shared code; just the context bridge.";
    done.append(note);
    view.append(done);
  }
}

function facetCard(spec) {
  const r = state.run;
  const fs = r.facets[spec.key];
  const card = el("div", "q-card");
  card.append(el("span", "q-num", spec.title));
  const p = pick(spec.key);
  if (p) card.append(el("span", "stale-chip", "picked: " + p.label));
  if (fs.options) {
    card.append(optionCards(fs.options, fs.selectedId, (o) => { fs.selectedId = o.id; if (spec.key === "person") r.name = o.label; void saveState(); render(); }));
    if (!running) card.append(steerRow((s) => void steerFacet(spec.key, s)));
  } else if (fs.error) {
    card.append(el("div", "err", fs.error));
    const t = el("button", "act", "try again"); t.onclick = () => void steerFacet(spec.key, null); card.append(t);
  } else {
    card.append(researching(running ? "queued…" : "not drafted yet"));
  }
  return card;
}
render();
